//! 미디어 요청 재시도 정책과 실패 분류(설계 §5.2).
//!
//! | 결과 | 판정 |
//! |---|---|
//! | 연결 실패, read timeout, reset, 조기 EOF, 5xx, 408, 429 | `Retry` (지수 백오프 + ±25% jitter) |
//! | 403 | `Expired` → 재조회 |
//! | 404, 410, 그 밖의 4xx | `Fatal(HttpStatus)` |

use std::hash::{BuildHasher, Hasher};
use std::time::Duration;

/// 연결 계열 실패를 기다려 주는 기본 시간(30분). 이 안에 연결이 돌아오면 이어서 받는다.
///
/// foundations §14의 파일 열 `Rust(core)` 상수라 셸 `consts.rs`가 아니라 여기에 둔다(DT15).
pub const NETWORK_PATIENCE_MS: u64 = 1_800_000;
/// 인내 모드의 백오프 상한(30초).
pub const RETRY_BACKOFF_MAX_MS: u64 = 30_000;

use crate::error::Error;
use crate::http::RequestKind;

/// 재시도 정책.
///
/// `max_attempts`는 **첫 시도를 포함한** 요청 횟수다. 1이면 재시도하지 않는다(`RetryPolicy::none()`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RetryPolicy {
    /// 기본 5
    pub max_attempts: u32,
    /// 기본 500ms
    pub base: Duration,
    /// 기본 8초
    pub cap: Duration,
    /// 빠른 재시도를 다 쓴 뒤 연결 계열(`Error::Network`) 실패를 기다려 주는 총 예산. 기본 30분, 0이면 인내 없음.
    pub patience: Duration,
    /// 인내 모드의 백오프 상한이자 시도 한 번이 예산에서 차지하는 시간의 상한. 기본 30초
    pub patience_cap: Duration,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        RetryPolicy {
            max_attempts: 5,
            base: Duration::from_millis(500),
            cap: Duration::from_secs(8),
            patience: Duration::from_millis(NETWORK_PATIENCE_MS),
            patience_cap: Duration::from_millis(RETRY_BACKOFF_MAX_MS),
        }
    }
}

impl RetryPolicy {
    /// 재시도하지 않는 정책(테스트의 `ZeroRetry`).
    pub const fn none() -> Self {
        RetryPolicy {
            max_attempts: 1,
            base: Duration::ZERO,
            cap: Duration::ZERO,
            patience: Duration::ZERO,
            patience_cap: Duration::ZERO,
        }
    }

    /// `attempts`번 시도해 실패한 뒤 한 번 더 시도해도 되는가.
    pub fn allows_retry(&self, attempts: u32) -> bool {
        attempts < self.max_attempts
    }

    /// `retry`번째 재시도(0부터) 전에 기다릴 시간. `min(base * 2^retry, cap)`에 ±25% jitter.
    pub fn delay(&self, retry: u32) -> Duration {
        self.delay_capped(retry, self.cap)
    }

    /// `delay`와 같되 상한을 `cap`으로 바꾼다(인내 모드는 `patience_cap`).
    fn delay_capped(&self, retry: u32, cap: Duration) -> Duration {
        let exp = self
            .base
            .checked_mul(1u32.checked_shl(retry).unwrap_or(u32::MAX))
            .unwrap_or(cap);
        let d = exp.min(cap);
        // jitter는 std RandomState 해시로 충분하다(인스턴스마다 키가 달라진다. 암호학적 난수는 필요 없다).
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u32(retry);
        let unit = (h.finish() % 1001) as f64 / 1000.0; // 0.0..=1.0
        d.mul_f64(0.75 + 0.5 * unit)
    }
}

/// 인내 모드의 예산 장부(core.md 구현 중 변경 56).
///
/// 소비 = Σ(요청한 대기 시간) + Σ min(시도 한 번에 걸린 시간, `patience_cap`).
/// 시도 시간을 `patience_cap`으로 묶어서, 노트북이 잠든 동안 흐른 벽시계 시간이 예산을 한 번에 태우지 않는다.
/// 진전(받은 바이트가 늘어남)이 있으면 `reset`으로 장부를 0으로 되돌린다.
#[derive(Debug, Default)]
pub(crate) struct Patience {
    spent: Duration,
    waits: u32,
}

impl Patience {
    pub(crate) fn reset(&mut self) {
        *self = Patience::default();
    }

    /// 연결 계열 실패 한 번을 장부에 적고 다음 대기 시간을 돌려준다. `None`이면 예산을 다 썼다.
    ///
    /// `took`는 실패한 시도가 걸린 시간이다. 마지막 대기는 남은 예산으로 줄여, 예산이 끝나는 시각에
    /// 시도가 한 번 더 일어나게 한다.
    pub(crate) fn on_failure(&mut self, policy: &RetryPolicy, took: Duration) -> Option<Duration> {
        if policy.patience.is_zero() {
            return None;
        }
        self.spent = self.spent.saturating_add(took.min(policy.patience_cap));
        if self.spent >= policy.patience {
            return None;
        }
        // 빠른 재시도가 쓴 지수에서 이어 간다(상한은 patience_cap).
        let k = policy
            .max_attempts
            .saturating_sub(1)
            .saturating_add(self.waits);
        let wait = policy
            .delay_capped(k, policy.patience_cap)
            .min(policy.patience - self.spent);
        self.spent += wait;
        self.waits = self.waits.saturating_add(1);
        Some(wait)
    }
}

/// 인내 모드로 기다려 줄 실패인가(연결 실패·timeout·reset·조기 EOF). 5xx·429·`Parse`는 아니다.
pub(crate) fn is_connection_failure(e: &Error) -> bool {
    matches!(e, Error::Network(_))
}

/// 미디어 요청 실패의 분류.
#[derive(Debug)]
pub enum Failure {
    /// 같은 요청을 다시 해 볼 만하다. 재시도를 다 쓰면 담긴 오류로 끝낸다.
    Retry(Error),
    /// 서명 주소 만료(403). `resolve`를 다시 한다.
    Expired,
    /// 다시 해도 안 된다.
    Fatal(Error),
}

/// 상태 코드 또는 전송 오류를 분류한다. 둘 다 없으면 `Fatal(Parse)`다.
///
/// 2xx 상태는 호출하는 쪽이 먼저 걸러야 한다(넘기면 `Fatal`).
pub fn classify_failure(status: Option<u16>, err: Option<reqwest::Error>) -> Failure {
    if let Some(status) = status {
        let e = Error::HttpStatus {
            status,
            kind: RequestKind::Media,
        };
        return match status {
            403 => Failure::Expired,
            408 | 429 | 500..=599 => Failure::Retry(e),
            _ => Failure::Fatal(e),
        };
    }
    match err {
        // 요청을 만들 수 없거나 redirect 정책 위반은 다시 해도 같다.
        Some(e) if e.is_builder() || e.is_redirect() => Failure::Fatal(Error::network(e)),
        // 연결 실패, timeout, reset, 조기 EOF(body 오류)
        Some(e) => Failure::Retry(Error::network(e)),
        None => Failure::Fatal(Error::Parse {
            what: "response",
            detail: "실패 원인이 없습니다".into(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_status() {
        assert!(matches!(
            classify_failure(Some(403), None),
            Failure::Expired
        ));
        for s in [500, 502, 503, 429, 408] {
            assert!(
                matches!(classify_failure(Some(s), None), Failure::Retry(_)),
                "{s}"
            );
        }
        for s in [404, 410, 400, 401] {
            assert!(
                matches!(
                    classify_failure(Some(s), None),
                    Failure::Fatal(Error::HttpStatus { status, kind: RequestKind::Media }) if status == s
                ),
                "{s}"
            );
        }
        assert!(matches!(
            classify_failure(None, None),
            Failure::Fatal(Error::Parse { .. })
        ));
    }

    #[tokio::test]
    async fn classify_connect_error_retries() {
        let client = reqwest::Client::new();
        let e = client.get("http://127.0.0.1:1/").send().await.unwrap_err();
        assert!(matches!(
            classify_failure(None, Some(e)),
            Failure::Retry(Error::Network(_))
        ));
    }

    #[test]
    fn delay_backoff_with_jitter() {
        let p = RetryPolicy::default();
        for (retry, want) in [(0u32, 500u64), (1, 1000), (2, 2000), (3, 4000), (4, 8000)] {
            let d = p.delay(retry).as_millis() as u64;
            assert!(
                d >= want * 3 / 4 && d <= want * 5 / 4,
                "retry {retry}: {d}ms"
            );
        }
        // cap을 넘지 않는다(jitter 25% 여유). 큰 지수도 넘치지 않는다.
        for retry in [5, 10, 31, 32, 1000] {
            assert!(p.delay(retry) <= Duration::from_secs(10), "{retry}");
        }
        assert_eq!(RetryPolicy::none().delay(3), Duration::ZERO);
    }

    /// 인내 예산: 연결이 29분 끊겼다 돌아오면 이어 가고, 31분이면 끝난다. 실제 시간은 기다리지 않고
    /// 장부만 돌린다(시도 시간 0, 대기는 요청한 만큼 소비). 지터 때문에 경계는 1분 여유를 둔다.
    #[test]
    fn patience_budget_boundaries() {
        let p = RetryPolicy::default();
        let outage = |mins: u64| {
            let mut ledger = Patience::default();
            let mut elapsed = Duration::ZERO;
            // 끊긴 시간(elapsed)이 outage보다 짧을 동안 시도는 실패한다.
            loop {
                match ledger.on_failure(&p, Duration::ZERO) {
                    None => return (false, elapsed),
                    Some(w) => {
                        elapsed += w;
                        if elapsed >= Duration::from_secs(mins * 60) {
                            return (true, elapsed);
                        }
                    }
                }
            }
        };
        assert!(outage(29).0, "29분 단절은 버텨야 한다");
        let (survived, at) = outage(31);
        assert!(!survived, "31분 단절은 끝나야 한다");
        // 예산 30분에서 끝난다(마지막 대기를 남은 예산으로 줄이므로 정확히 30분).
        assert_eq!(at, p.patience);
    }

    /// 시도가 오래 걸려도 한 번에 `patience_cap`까지만 센다(잠든 시간을 세지 않는다).
    #[test]
    fn patience_counts_attempt_time_capped() {
        let p = RetryPolicy::default();
        let mut ledger = Patience::default();
        // 하루 걸린 시도 한 번이 예산 전부를 태우지 않는다.
        let w = ledger.on_failure(&p, Duration::from_secs(86_400)).unwrap();
        assert!(w <= Duration::from_secs(38), "{w:?}");
        assert!(ledger.spent <= p.patience_cap + w);
    }

    #[test]
    fn patience_reset_and_zero() {
        let p = RetryPolicy::default();
        let mut ledger = Patience::default();
        for _ in 0..10 {
            ledger.on_failure(&p, Duration::ZERO).unwrap();
        }
        ledger.reset();
        assert_eq!(ledger.spent, Duration::ZERO);
        assert_eq!(ledger.waits, 0);
        // 인내 0이면 바로 끝낸다.
        assert!(
            Patience::default()
                .on_failure(&RetryPolicy::none(), Duration::ZERO)
                .is_none()
        );
        // 백오프는 patience_cap(30초) ±25%를 넘지 않는다.
        for _ in 0..40 {
            let Some(w) = ledger.on_failure(&p, Duration::ZERO) else {
                break;
            };
            assert!(w <= Duration::from_millis(37_500), "{w:?}");
        }
    }

    #[test]
    fn attempts_include_first() {
        let p = RetryPolicy::default();
        assert!(p.allows_retry(4));
        assert!(!p.allows_retry(5));
        assert!(!RetryPolicy::none().allows_retry(1));
    }
}
