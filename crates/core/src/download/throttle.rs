//! 속도 제한(rate-limit.md §3.2). 토큰 버킷(빚 방식) 하나를 `Throttle`로 감싸 엔진의 본문 읽기 루프가 쓴다.
//!
//! - `Bucket`: 시각을 인자로 받는 순수 상태 기계(`Meter::observe`와 같은 방식). 테스트가 가상 시각으로 돌린다.
//! - `RateKnob`: 상한 값(바이트/초) 하나를 여러 `Throttle`이 공유한다. 값을 바꾸면 기다리는 쪽을 깨운다(R5).
//! - `Throttle`: knob + bucket. 복제하면 같은 bucket이다(공유 합계 상한은 복제해서 모든 작업이 쓴다).
//! - `Throttles`: 엔진이 받는 묶음. 작업 bucket을 먼저, 공유 bucket을 나중에 치른다.
//!
//! 코어는 최소값을 강제하지 않는다(최소는 설정 정책, `settings::MIN_RATE_LIMIT_BPS`). 이 모듈은 어떤 값이든 지킨다.

use std::fmt;
use std::num::NonZeroU64;
use std::pin::pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tokio::sync::Notify;
use tokio::time::{Instant, sleep_until};

/// 채우기 상한(burst)의 길이. `capacity = rate × THROTTLE_BURST`. **[잠정] 근거 없음**(ADR-0009 묶음).
/// 작게 두는 이유: 속도 창(`Meter`, 5초)이 상한을 빨리 따라가야 ETA가 낙관적이지 않다(rate-limit.md §5.5).
pub const THROTTLE_BURST: Duration = Duration::from_millis(250);

/// 빚 상한의 길이. 한 번의 대기가 이보다 길면 남는 빚을 버린다. reqwest `read_timeout` 30초의 절반이다
/// (`client.rs`). 최소값(`settings::MIN_RATE_LIMIT_BPS`)이 지켜지면 닿지 않는 방어선이다.
pub const THROTTLE_MAX_WAIT: Duration = Duration::from_secs(15);

/// 순수 토큰 버킷(빚 방식). `tokens`가 음수면 빚이다.
///
/// 받은 뒤에 치른다(reqwest는 조각 크기를 미리 알려 주지 않는다). 빚이 있으면 그만큼 다음 읽기를 늦춘다.
pub(crate) struct Bucket {
    /// 마지막으로 반영한 속도(바이트/초). 0 = 끔
    rate: u64,
    tokens: f64,
    last: Instant,
}

fn capacity(rate: u64) -> f64 {
    rate as f64 * THROTTLE_BURST.as_secs_f64()
}

impl Bucket {
    pub(crate) fn new(now: Instant) -> Self {
        Bucket {
            rate: 0,
            tokens: 0.0,
            last: now,
        }
    }

    /// 시각 `now`까지 채우고 `n`바이트를 뺀 뒤, 빚을 갚는 데 필요한 대기 시간을 돌려준다.
    ///
    /// 속도가 바뀌었으면 `now`까지는 옛 속도로 채우고 새 속도로 넘어간다. 끔(`None`)이면 빚을 0으로 지우고
    /// 곧바로 돌려준다. 꺼져 있다가 켜지면 burst가 가득 찬 채 시작한다.
    pub(crate) fn take(&mut self, rate: Option<NonZeroU64>, n: u64, now: Instant) -> Duration {
        let new = rate.map_or(0, NonZeroU64::get);
        if self.rate > 0 {
            let dt = now.saturating_duration_since(self.last).as_secs_f64();
            self.tokens = (self.tokens + dt * self.rate as f64).min(capacity(self.rate));
        }
        self.last = self.last.max(now);
        if new == 0 {
            self.rate = 0;
            self.tokens = 0.0;
            return Duration::ZERO;
        }
        if self.rate == 0 {
            self.tokens = capacity(new);
        } else if new != self.rate {
            self.tokens = self.tokens.min(capacity(new));
        }
        self.rate = new;
        self.tokens -= n as f64;
        let floor = -(new as f64 * THROTTLE_MAX_WAIT.as_secs_f64());
        if self.tokens < floor {
            self.tokens = floor;
        }
        if self.tokens >= 0.0 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(-self.tokens / new as f64)
        }
    }
}

struct KnobInner {
    /// 바이트/초, 0 = 끔
    bps: AtomicU64,
    changed: Notify,
}

/// 상한 값(바이트/초) 하나. 같은 knob을 따르는 `Throttle` 모두가 다음 `consume`에서 새 값을 읽는다.
#[derive(Clone)]
pub struct RateKnob(Arc<KnobInner>);

impl RateKnob {
    pub fn new(bps: Option<NonZeroU64>) -> Self {
        RateKnob(Arc::new(KnobInner {
            bps: AtomicU64::new(bps.map_or(0, NonZeroU64::get)),
            changed: Notify::new(),
        }))
    }

    /// 값을 바꾸고 기다리는 `consume`을 깨운다(바뀐 값으로 다시 계산한다).
    pub fn set(&self, bps: Option<NonZeroU64>) {
        self.0
            .bps
            .store(bps.map_or(0, NonZeroU64::get), Ordering::Release);
        self.0.changed.notify_waiters();
    }

    pub fn get(&self) -> Option<NonZeroU64> {
        NonZeroU64::new(self.0.bps.load(Ordering::Acquire))
    }
}

impl Default for RateKnob {
    /// 끔
    fn default() -> Self {
        RateKnob::new(None)
    }
}

impl fmt::Debug for RateKnob {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "RateKnob({:?})", self.get())
    }
}

/// 토큰 버킷 하나. 복제하면 같은 bucket이다.
#[derive(Clone)]
pub struct Throttle {
    knob: RateKnob,
    bucket: Arc<Mutex<Bucket>>,
}

impl Throttle {
    pub fn new(knob: RateKnob) -> Self {
        Throttle {
            knob,
            bucket: Arc::new(Mutex::new(Bucket::new(Instant::now()))),
        }
    }

    /// 두 `Throttle`이 같은 bucket을 쓰는지(복제본인지). 공유 합계 bucket 확인용.
    pub fn same_bucket(&self, other: &Throttle) -> bool {
        Arc::ptr_eq(&self.bucket, &other.bucket)
    }

    /// 지금 knob 값.
    pub fn rate(&self) -> Option<NonZeroU64> {
        self.knob.get()
    }

    fn bucket(&self) -> MutexGuard<'_, Bucket> {
        // 잠금 안에서는 산술만 한다. 다른 스레드가 패닉했어도 값은 쓸 수 있다.
        self.bucket.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// 방금 받은 `n`바이트를 치르고, 빚이 있으면 갚을 때까지 기다린다. 끔이면 곧바로 돌아온다.
    ///
    /// 취소는 부르는 쪽이 future를 drop해서 한다. 빚은 남는다(받은 바이트는 실제로 쓴 대역폭이다).
    /// 기다리는 동안 knob 값이 바뀌면 남은 대기를 새 값으로 다시 계산한다(끄면 곧바로 돌아온다).
    pub async fn consume(&self, n: u64) {
        if n == 0 {
            return;
        }
        // 값을 읽기 전에 알림을 등록해야 읽기와 등록 사이의 `set`을 놓치지 않는다.
        let mut changed = pin!(self.knob.0.changed.notified());
        changed.as_mut().enable();
        let Some(mut rate) = self.knob.get() else {
            return;
        };
        let now = Instant::now();
        // 잠금은 이 문장 안에서만 잡는다(`.await` 너머로 들고 있지 않는다).
        let wait = self.bucket().take(Some(rate), n, now);
        // 이 호출의 몫이 끝나는 시각. 뒤에 온 호출이 빚을 더 쌓아도 이 시각은 늘지 않는다(도착 순서).
        let mut deadline = now + wait;
        loop {
            if Instant::now() >= deadline {
                return;
            }
            tokio::select! {
                _ = sleep_until(deadline) => return,
                _ = changed.as_mut() => {
                    changed.set(self.knob.0.changed.notified());
                    changed.as_mut().enable();
                    let now = Instant::now();
                    let Some(new) = self.knob.get() else {
                        self.bucket().take(None, 0, now);
                        return;
                    };
                    // 내 앞에 남은 바이트는 그대로이고 갚는 속도만 달라진다.
                    let ahead = deadline.saturating_duration_since(now).as_secs_f64() * rate.get() as f64;
                    deadline = now + Duration::from_secs_f64(ahead / new.get() as f64);
                    rate = new;
                    // bucket도 옛 속도로 now까지 채우고 새 속도로 넘긴다(뒤에 오는 호출이 낡은 속도로 갚은 빚을 보지 않게).
                    self.bucket().take(Some(new), 0, now);
                }
            }
        }
    }
}

impl fmt::Debug for Throttle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Throttle({:?})", self.knob.get())
    }
}

/// 엔진이 받는 묶음. 둘 다 `None`이면 지금과 같다(제한 없음).
#[derive(Clone, Debug, Default)]
pub struct Throttles {
    /// 작업마다 상한
    pub job: Option<Throttle>,
    /// 전체 합계 상한(모든 작업이 같은 bucket을 복제해서 쓴다)
    pub shared: Option<Throttle>,
}

impl Throttles {
    /// 작업 bucket을 먼저, 공유 bucket을 나중에 치른다. 공유를 먼저 치르면 작업 상한에 걸려 기다리는 동안
    /// 이미 가져간 공유 몫을 아무도 쓰지 못한다.
    pub async fn consume(&self, n: u64) {
        if let Some(job) = &self.job {
            job.consume(n).await;
        }
        if let Some(shared) = &self.shared {
            shared.consume(n).await;
        }
    }

    /// 둘 다 없으면 제한이 없다.
    pub fn is_unlimited(&self) -> bool {
        self.job.is_none() && self.shared.is_none()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = 1_000_000;

    fn nz(n: u64) -> Option<NonZeroU64> {
        NonZeroU64::new(n)
    }

    fn secs(d: Duration) -> f64 {
        d.as_secs_f64()
    }

    /// tokio 타이머는 1ms 단위로 올림하므로 약간의 오차를 둔다.
    #[track_caller]
    fn near(d: Duration, ms: u64) {
        let diff = d.as_millis().abs_diff(u128::from(ms));
        assert!(diff <= 2, "{d:?} vs {ms}ms");
    }

    /// 가상 시각 도우미
    struct Clock(Instant);
    impl Clock {
        fn new() -> Self {
            Clock(Instant::now())
        }
        fn at(&self, ms: u64) -> Instant {
            self.0 + Duration::from_millis(ms)
        }
    }

    // ---- 10.1 순수 상태 기계 ----

    #[test]
    fn off_never_waits_and_keeps_no_debt() {
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        for i in 0..100 {
            assert_eq!(b.take(None, 10 * MB, c.at(i)), Duration::ZERO);
        }
        // 꺼진 동안 빚이 쌓이지 않았으니 켜도 burst만큼은 공짜다.
        assert_eq!(b.take(nz(MB), 250_000, c.at(100)), Duration::ZERO);
    }

    #[test]
    fn wait_is_bytes_over_rate_after_burst() {
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        // burst(0.25초 = 250,000바이트)는 공짜
        assert_eq!(b.take(nz(MB), 250_000, c.at(0)), Duration::ZERO);
        // burst 소진 뒤 500,000바이트 → 0.5초
        let w = b.take(nz(MB), 500_000, c.at(0));
        assert!((secs(w) - 0.5).abs() < 1e-9, "{w:?}");
    }

    #[test]
    fn consecutive_takes_accumulate_debt() {
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        b.take(nz(MB), 250_000, c.at(0));
        let w1 = b.take(nz(MB), 100_000, c.at(0));
        let w2 = b.take(nz(MB), 100_000, c.at(0));
        let w3 = b.take(nz(MB), 100_000, c.at(0));
        assert!((secs(w1) - 0.1).abs() < 1e-9);
        assert!((secs(w2) - 0.2).abs() < 1e-9);
        assert!((secs(w3) - 0.3).abs() < 1e-9);
    }

    #[test]
    fn refills_over_time_but_not_past_capacity() {
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        b.take(nz(MB), 250_000, c.at(0));
        b.take(nz(MB), 500_000, c.at(0)); // 빚 0.5초
        // 0.5초 지나면 빚이 갚아져 다음 burst 안쪽은 공짜가 아니라 0에서 시작
        assert_eq!(b.take(nz(MB), 0, c.at(500)), Duration::ZERO);
        // 10초를 쉬어도 capacity(250,000)까지만 찬다 → 400,000바이트면 150,000이 남는다
        let w = b.take(nz(MB), 400_000, c.at(10_500));
        assert!((secs(w) - 0.15).abs() < 1e-9, "{w:?}");
    }

    #[test]
    fn rate_change_fills_with_old_rate_until_now_then_switches() {
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        b.take(nz(MB), 250_000, c.at(0));
        let w = b.take(nz(MB), 1_000_000, c.at(0)); // 빚 1초
        assert!((secs(w) - 1.0).abs() < 1e-9);
        // 0.5초 뒤 속도를 10배로: 앞 0.5초는 1MB/s로 갚아 빚 500,000 → 새 속도로 0.05초
        let w = b.take(nz(10 * MB), 0, c.at(500));
        assert!((secs(w) - 0.05).abs() < 1e-9, "{w:?}");
    }

    #[test]
    fn turning_off_clears_debt() {
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        b.take(nz(MB), 250_000, c.at(0));
        b.take(nz(MB), 5_000_000, c.at(0));
        assert_eq!(b.take(None, 1, c.at(1)), Duration::ZERO);
        // 다시 켜면 빚 없이 burst부터 시작한다.
        assert_eq!(b.take(nz(MB), 250_000, c.at(2)), Duration::ZERO);
    }

    #[test]
    fn debt_is_capped_at_max_wait() {
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        let w = b.take(nz(MB), 1_000 * MB, c.at(0));
        assert_eq!(w, THROTTLE_MAX_WAIT);
        // 버려진 빚은 되돌아오지 않는다: 이어지는 작은 조각의 대기도 상한 안이다.
        let w = b.take(nz(MB), MB, c.at(0));
        assert_eq!(w, THROTTLE_MAX_WAIT);
    }

    #[test]
    fn long_run_average_matches_rate() {
        // 가상의 1시간 동안 무작위 크기 조각을 받는 한 스트림. 대기가 끝나면 다음 조각을 받는다.
        let rate = 3 * MB;
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        let mut t = Duration::ZERO;
        let mut bytes = 0u64;
        let mut x = 0x2545_f491_4f6c_dd1du64;
        while t < Duration::from_secs(3600) {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            let n = 1 + x % 400_000;
            bytes += n;
            t += b.take(nz(rate), n, c.0 + t);
        }
        let avg = bytes as f64 / t.as_secs_f64();
        // 처음 burst(0.25초분)가 공짜라 아주 조금 높게 나온다.
        assert!(
            (avg / rate as f64 - 1.0).abs() < 0.01,
            "평균 {avg} vs {rate}"
        );
    }

    #[test]
    fn many_streams_share_one_bucket_fairly_in_total() {
        // 24개 스트림이 같은 bucket을 쓴다. 합계가 상한이어야 한다.
        let rate = MB;
        let c = Clock::new();
        let mut b = Bucket::new(c.at(0));
        let mut next_at = vec![Duration::ZERO; 24];
        let mut bytes = 0u64;
        let end = Duration::from_secs(600);
        loop {
            // 가장 이른 스트림이 읽는다.
            let (i, &t) = next_at.iter().enumerate().min_by_key(|(_, t)| **t).unwrap();
            if t >= end {
                break;
            }
            bytes += 417_792;
            next_at[i] = t + b.take(nz(rate), 417_792, c.0 + t);
        }
        let avg = bytes as f64 / end.as_secs_f64();
        assert!((avg / rate as f64 - 1.0).abs() < 0.05, "평균 {avg}");
    }

    // ---- 10.2 async 래퍼(paused 시계, 네트워크 없음) ----

    fn throttle(bps: u64) -> Throttle {
        Throttle::new(RateKnob::new(nz(bps)))
    }

    #[tokio::test(start_paused = true)]
    async fn consume_ends_exactly_at_computed_deadline() {
        let t = throttle(MB);
        t.consume(250_000).await; // burst
        let start = Instant::now();
        t.consume(500_000).await;
        near(start.elapsed(), 500);
    }

    #[tokio::test(start_paused = true)]
    async fn consume_when_off_returns_immediately() {
        let t = Throttle::new(RateKnob::default());
        let start = Instant::now();
        t.consume(100 * MB).await;
        assert_eq!(start.elapsed(), Duration::ZERO);
        // n = 0도 곧바로
        throttle(MB).consume(0).await;
        assert_eq!(start.elapsed(), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn job_bucket_is_paid_before_shared_bucket() {
        // 작업 A는 작업 상한이 아주 낮다(100KB/s). 공유 합계는 1MB/s다.
        // 작업 B는 작업 상한이 없다. A가 큰 조각을 치르는 동안 B가 공유 몫을 쓸 수 있어야 한다.
        let shared = throttle(MB);
        let a = Throttles {
            job: Some(throttle(100_000)),
            shared: Some(shared.clone()),
        };
        let b = Throttles {
            job: None,
            shared: Some(shared.clone()),
        };
        let ha = tokio::spawn(async move { a.consume(MB).await });
        tokio::task::yield_now().await;
        let start = Instant::now();
        // 공유 burst 250,000을 지나 500,000바이트 → 0.25초. A의 1MB가 공유 빚으로 쌓였다면 1.25초다.
        b.consume(500_000).await;
        near(start.elapsed(), 250);
        ha.abort();
    }

    #[tokio::test(start_paused = true)]
    async fn two_streams_on_shared_bucket_split_the_rate() {
        let shared = Throttles {
            job: None,
            shared: Some(throttle(MB)),
        };
        shared.consume(250_000).await;
        let start = Instant::now();
        let a = shared.clone();
        let b = shared.clone();
        let (ra, rb) = tokio::join!(
            async move {
                for _ in 0..5 {
                    a.consume(100_000).await;
                }
                Instant::now()
            },
            async move {
                for _ in 0..5 {
                    b.consume(100_000).await;
                }
                Instant::now()
            }
        );
        // 합쳐서 1,000,000바이트 → 1초
        let end = ra.max(rb);
        near(end - start, 1000);
    }

    #[tokio::test(start_paused = true)]
    async fn cancel_while_waiting_ends_immediately() {
        let t = throttle(MB);
        t.consume(250_000).await;
        let token = tokio_util::sync::CancellationToken::new();
        let tk = token.clone();
        let t2 = t.clone();
        let h = tokio::spawn(async move {
            tokio::select! {
                _ = t2.consume(10 * MB) => false, // 10초 대기
                _ = tk.cancelled() => true,
            }
        });
        tokio::task::yield_now().await;
        let start = Instant::now();
        token.cancel();
        assert!(h.await.unwrap(), "취소가 대기를 이겨야 한다");
        assert_eq!(start.elapsed(), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn turning_off_while_waiting_ends_immediately() {
        let knob = RateKnob::new(nz(MB));
        let t = Throttle::new(knob.clone());
        t.consume(250_000).await;
        let t2 = t.clone();
        let h = tokio::spawn(async move { t2.consume(10 * MB).await });
        tokio::task::yield_now().await;
        let start = Instant::now();
        knob.set(None);
        h.await.unwrap();
        assert_eq!(start.elapsed(), Duration::ZERO);
    }

    #[tokio::test(start_paused = true)]
    async fn raising_rate_while_waiting_recomputes_remaining_wait() {
        let knob = RateKnob::new(nz(MB));
        let t = Throttle::new(knob.clone());
        t.consume(250_000).await;
        let t2 = t.clone();
        // 10,000,000바이트 → 1MB/s로 10초
        let h = tokio::spawn(async move {
            let s = Instant::now();
            t2.consume(10 * MB).await;
            s.elapsed()
        });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(2)).await; // 8초 남음(8,000,000바이트)
        tokio::task::yield_now().await;
        knob.set(nz(10 * MB)); // 남은 8,000,000 / 10MB/s = 0.8초
        let took = h.await.unwrap();
        near(took, 2800);
    }

    #[tokio::test(start_paused = true)]
    async fn lowering_rate_while_waiting_stretches_remaining_wait() {
        let knob = RateKnob::new(nz(10 * MB));
        let t = Throttle::new(knob.clone());
        t.consume(2_500_000).await;
        let t2 = t.clone();
        // 10MB / 10MB/s = 1초
        let h = tokio::spawn(async move {
            let s = Instant::now();
            t2.consume(10 * MB).await;
            s.elapsed()
        });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_millis(500)).await; // 남은 5,000,000바이트
        tokio::task::yield_now().await;
        knob.set(nz(MB)); // 5초
        near(h.await.unwrap(), 5500);
    }

    #[tokio::test(start_paused = true)]
    async fn turning_on_while_running_applies_from_next_consume() {
        let knob = RateKnob::default();
        let t = Throttle::new(knob.clone());
        let start = Instant::now();
        t.consume(100 * MB).await;
        assert_eq!(start.elapsed(), Duration::ZERO);
        knob.set(nz(MB));
        t.consume(250_000).await; // burst
        t.consume(500_000).await;
        near(start.elapsed(), 500);
    }

    #[tokio::test(start_paused = true)]
    async fn waiter_after_value_change_still_gets_its_share() {
        // 값을 바꾼 뒤에도 늦게 온 스트림은 앞 스트림 뒤에 줄을 선다(빚이 새 속도로 갚아진다).
        let knob = RateKnob::new(nz(MB));
        let t = Throttle::new(knob.clone());
        t.consume(250_000).await;
        let a = t.clone();
        let h = tokio::spawn(async move { a.consume(2 * MB).await });
        tokio::task::yield_now().await;
        knob.set(nz(2 * MB)); // 남은 빚 2MB → 1초
        tokio::task::yield_now().await;
        let start = Instant::now();
        t.consume(MB).await; // 앞의 2MB 뒤에 1MB → 합 3MB / 2MB/s = 1.5초
        near(start.elapsed(), 1500);
        h.await.unwrap();
    }

    #[test]
    fn debug_shows_only_rate() {
        let t = throttle(MB);
        assert_eq!(format!("{t:?}"), "Throttle(Some(1000000))");
        let th = Throttles::default();
        assert_eq!(format!("{th:?}"), "Throttles { job: None, shared: None }");
    }

    #[test]
    fn clones_share_bucket_and_new_ones_do_not() {
        let t = throttle(MB);
        assert!(t.same_bucket(&t.clone()));
        let other = Throttle::new(RateKnob::new(nz(MB)));
        assert!(!t.same_bucket(&other));
    }
}
