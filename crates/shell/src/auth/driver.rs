//! AuthService를 깨우는 셸 쪽 고리(worker.md §11.3·구현 중 변경 51, A2-3).
//!
//! - `run_driver`: 시작 갱신 한 번 → `next_wake()`까지(최대 `HEARTBEAT`) 자고 `tick`. 상태가 바뀌면 다시 계산한다.
//! - 절전 복귀: Tauri 데스크톱에는 복귀 이벤트가 없다. 잔 시간보다 벽시계가 `RESUME_SLACK` 넘게 더 갔으면 `Trigger::Resume`.
//!   (macOS 단조 시계는 절전 동안 멈춰 tokio 타이머가 늦게 끝나고, 그 사이 벽시계는 간다.)
//! - `forward_status`: 상태가 바뀔 때마다(처음 상태 포함) 콜백. 앱은 프런트 이벤트·자동 이어받기에 쓴다.

use std::sync::Arc;
use std::time::Duration;

use time::OffsetDateTime;
use tokio::sync::watch;

use super::api::WorkerApi;
use super::clock::Clock;
use super::service::{AuthService, AuthStatus, Trigger};

/// 최대 잠(이보다 오래 자지 않는다). `tick`은 예정 전이면 네트워크 없이 끝난다
pub const HEARTBEAT: Duration = Duration::from_secs(30);
/// 최소 잠(예정이 이미 지났을 때 바쁜 고리를 막는다)
pub const MIN_SLEEP: Duration = Duration::from_secs(1);
/// 잔 시간보다 벽시계가 이만큼 넘게 더 갔으면 절전에서 돌아온 것으로 본다
pub const RESUME_SLACK: time::Duration = time::Duration::seconds(60);

/// 다음 잠 길이: 예정 없음 → HEARTBEAT, 예정이 지났거나 지금 → MIN_SLEEP, 그 밖 → [MIN_SLEEP, HEARTBEAT]로 자른 남은 시간
pub fn sleep_for(now: OffsetDateTime, wake: Option<OffsetDateTime>) -> Duration {
    let Some(w) = wake else { return HEARTBEAT };
    let left = w - now;
    if left <= time::Duration::ZERO {
        return MIN_SLEEP;
    }
    Duration::try_from(left)
        .unwrap_or(HEARTBEAT)
        .clamp(MIN_SLEEP, HEARTBEAT)
}

/// 깨어난 까닭: 벽시계 경과 > 잔 시간 + RESUME_SLACK이면 Resume, 아니면(음수·같음 포함) Timer
pub fn wake_trigger(slept: Duration, wall_elapsed: time::Duration) -> Trigger {
    match time::Duration::try_from(slept) {
        Ok(s) if wall_elapsed > s + RESUME_SLACK => Trigger::Resume,
        _ => Trigger::Timer,
    }
}

/// 시작 갱신(`startup`) 한 번 뒤 끝없이 돈다. 서비스가 사라지면(watch 송신단 drop) 끝난다.
pub async fn run_driver<A: WorkerApi, C: Clock>(auth: Arc<AuthService<A, C>>) {
    auth.startup().await;
    let mut rx = auth.subscribe();
    loop {
        rx.mark_unchanged();
        let before = auth.now();
        let slept = sleep_for(before, auth.next_wake());
        match tokio::time::timeout(slept, rx.changed()).await {
            Ok(Ok(())) => continue,
            Ok(Err(_)) => return,
            Err(_) => {
                let trigger = wake_trigger(slept, auth.now() - before);
                auth.tick(trigger).await;
            }
        }
    }
}

/// 처음 상태와 이후 바뀐 상태마다 `on`을 부른다. 송신단이 사라지면 끝난다.
/// `on` 안에서 watch를 빌린 채 서비스를 부르지 않도록 값을 복사해 넘긴다.
pub async fn forward_status(
    mut rx: watch::Receiver<AuthStatus>,
    mut on: impl FnMut(AuthStatus) + Send,
) {
    loop {
        let st = rx.borrow_and_update().clone();
        on(st);
        if rx.changed().await.is_err() {
            return;
        }
    }
}
