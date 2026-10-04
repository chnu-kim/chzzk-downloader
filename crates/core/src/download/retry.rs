//! 미디어 요청 재시도 정책과 실패 분류(설계 §5.2).
//!
//! | 결과 | 판정 |
//! |---|---|
//! | 연결 실패, read timeout, reset, 조기 EOF, 5xx, 408, 429 | `Retry` (지수 백오프 + ±25% jitter) |
//! | 403 | `Expired` → 재조회 |
//! | 404, 410, 그 밖의 4xx | `Fatal(HttpStatus)` |

use std::hash::{BuildHasher, Hasher};
use std::time::Duration;

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
}

impl Default for RetryPolicy {
    fn default() -> Self {
        RetryPolicy {
            max_attempts: 5,
            base: Duration::from_millis(500),
            cap: Duration::from_secs(8),
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
        }
    }

    /// `attempts`번 시도해 실패한 뒤 한 번 더 시도해도 되는가.
    pub fn allows_retry(&self, attempts: u32) -> bool {
        attempts < self.max_attempts
    }

    /// `retry`번째 재시도(0부터) 전에 기다릴 시간. `min(base * 2^retry, cap)`에 ±25% jitter.
    pub fn delay(&self, retry: u32) -> Duration {
        let exp = self
            .base
            .checked_mul(1u32.checked_shl(retry).unwrap_or(u32::MAX))
            .unwrap_or(self.cap);
        let d = exp.min(self.cap);
        // jitter는 std RandomState 해시로 충분하다(인스턴스마다 키가 달라진다. 암호학적 난수는 필요 없다).
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u32(retry);
        let unit = (h.finish() % 1001) as f64 / 1000.0; // 0.0..=1.0
        d.mul_f64(0.75 + 0.5 * unit)
    }
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

    #[test]
    fn attempts_include_first() {
        let p = RetryPolicy::default();
        assert!(p.allows_retry(4));
        assert!(!p.allows_retry(5));
        assert!(!RetryPolicy::none().allows_retry(1));
    }
}
