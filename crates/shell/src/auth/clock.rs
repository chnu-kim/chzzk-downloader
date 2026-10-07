//! 벽시계. 유예·만료 판정은 모두 이것으로 한다.

use time::OffsetDateTime;

/// 벽시계(UTC). 유예·만료 판정은 모두 이것으로 한다(tokio 타이머는 절전 동안 멈출 수 있다, worker.md §11.3).
pub trait Clock: Send + Sync + 'static {
    /// 지금 시각(UTC)
    fn now(&self) -> OffsetDateTime;
}

/// `OffsetDateTime::now_utc()`
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}
