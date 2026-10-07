//! `auth::driver`: 잠 길이·복귀 판정 표와 루프(worker.md 구현 중 변경 A2-3).

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_shell::auth::*;
use common::auth::*;
use time::OffsetDateTime;

fn secs(n: i64) -> time::Duration {
    time::Duration::seconds(n)
}

#[test]
fn sleep_for_table() {
    let now = t0();
    let rows: [(Option<OffsetDateTime>, Duration); 6] = [
        (None, Duration::from_secs(30)),
        (Some(now - secs(1)), Duration::from_secs(1)),
        (Some(now), Duration::from_secs(1)),
        (
            Some(now + time::Duration::milliseconds(500)),
            Duration::from_secs(1),
        ),
        (Some(now + secs(5)), Duration::from_secs(5)),
        (
            Some(now + time::Duration::hours(1)),
            Duration::from_secs(30),
        ),
    ];
    for (wake, want) in rows {
        assert_eq!(sleep_for(now, wake), want, "{wake:?}");
    }
}

#[test]
fn wake_trigger_table() {
    let s30 = Duration::from_secs(30);
    let rows = [
        (s30, secs(30), Trigger::Timer),
        (s30, secs(90), Trigger::Timer),
        (
            s30,
            secs(90) + time::Duration::milliseconds(1),
            Trigger::Resume,
        ),
        (s30, -time::Duration::hours(1), Trigger::Timer),
        (
            Duration::from_secs(1),
            time::Duration::hours(2),
            Trigger::Resume,
        ),
    ];
    for (slept, wall, want) in rows {
        assert_eq!(wake_trigger(slept, wall), want, "{slept:?} {wall:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn driver_refreshes_at_startup_then_when_due() {
    let dir = tempfile::TempDir::new().unwrap();
    store(dir.path())
        .save(&stored(
            1,
            t0() - time::Duration::hours(1),
            t0() + time::Duration::days(30),
        ))
        .unwrap();
    let api = FakeWorkerApi::default();
    let clock = FakeClock::at(t0());
    let auth = Arc::new(service(dir.path(), &api, &clock));
    api.push_refresh(Reply::Now(Ok(bundle(2, t0()))));
    api.push_refresh(Reply::Now(Ok(bundle(3, t0()))));
    let h = tokio::spawn(run_driver(auth.clone()));
    tokio::time::sleep(Duration::from_secs(300)).await;
    assert_eq!(api.refresh_calls().len(), 1);
    assert_eq!(auth.status().phase, AuthPhase::SignedIn);
    clock.set(t0() + time::Duration::hours(25));
    tokio::time::sleep(Duration::from_secs(31)).await;
    assert_eq!(api.refresh_calls().len(), 2);
    h.abort();
}

#[tokio::test(start_paused = true)]
async fn driver_retries_on_resume_while_offline() {
    let dir = tempfile::TempDir::new().unwrap();
    store(dir.path())
        .save(&stored(
            1,
            t0() - time::Duration::hours(1),
            t0() + time::Duration::days(30),
        ))
        .unwrap();
    let api = FakeWorkerApi::default();
    let clock = FakeClock::at(t0());
    let auth = Arc::new(service(dir.path(), &api, &clock));
    for _ in 0..8 {
        api.push_refresh(Reply::Now(Err(transport())));
    }
    let h = tokio::spawn(run_driver(auth.clone()));
    tokio::time::sleep(Duration::from_secs(300)).await;
    assert!(auth.status().offline.is_some());
    let n0 = api.refresh_calls().len();
    clock.advance(time::Duration::hours(2));
    tokio::time::sleep(Duration::from_secs(31)).await;
    assert!(api.refresh_calls().len() > n0);
    h.abort();
}

#[tokio::test]
async fn forward_status_sends_initial_and_changes() {
    let dir = tempfile::TempDir::new().unwrap();
    let api = FakeWorkerApi::default();
    let clock = FakeClock::at(t0());
    let auth = Arc::new(service(dir.path(), &api, &clock));
    api.push_start(Reply::Now(Ok(start_ok(&base()))));
    let seen: Arc<Mutex<Vec<AuthPhase>>> = Arc::default();
    let s = seen.clone();
    let h = tokio::spawn(forward_status(auth.subscribe(), move |st| {
        s.lock().unwrap().push(st.phase);
    }));
    // 처음 상태가 먼저 전달되도록 태스크가 한 번 돌게 한다
    tokio::time::sleep(Duration::from_millis(20)).await;
    auth.begin_login().await;
    for _ in 0..100 {
        if seen.lock().unwrap().len() >= 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        seen.lock().unwrap()[..2],
        [AuthPhase::SignedOut, AuthPhase::Pending]
    );
    h.abort();
}
