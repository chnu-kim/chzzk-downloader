//! `AuthService` 상태 전이 표(worker.md §11.3·§11.4, 구현 중 변경 47~52).
//!
//! 가짜 `WorkerApi`·`Clock`을 주입한다. 시각 기준 V = 2030-01-01T00:00:00Z.

mod common;

use std::sync::Arc;

use chzzk_shell::ErrorCode;
use chzzk_shell::auth::*;
use common::auth::*;
use time::{Duration, OffsetDateTime};
use tokio::sync::Notify;

type Svc = AuthService<FakeWorkerApi, FakeClock>;

/// 응답 유실이 이어질 때 갱신 한 번의 요청 수(첫 시도 + 즉시·10초·30초)
const ATTEMPTS: usize = 4;
/// 그 묶음이 걸리는 시간(가짜 응답은 즉시라 마지막 재시도 시각)
fn chain() -> Duration {
    Duration::seconds(30)
}

fn h(n: i64) -> Duration {
    Duration::hours(n)
}
fn d(n: i64) -> Duration {
    Duration::days(n)
}
fn mins(n: i64) -> Duration {
    Duration::minutes(n)
}

struct Env {
    dir: tempfile::TempDir,
    api: FakeWorkerApi,
    clock: FakeClock,
    svc: Arc<Svc>,
}

impl Env {
    /// `now`는 V에서의 거리, `file`은 저장 세션의 refresh 만료(V에서의 거리, verified = V)
    fn new(now: Duration, file: Option<Duration>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        if let Some(r) = file {
            store(dir.path()).save(&stored(1, t0(), t0() + r)).unwrap();
        }
        let api = FakeWorkerApi::default();
        let clock = FakeClock::at(t0() + now);
        let svc = Arc::new(service(dir.path(), &api, &clock));
        Self {
            dir,
            api,
            clock,
            svc,
        }
    }

    /// o4: V+1h에 유예 안 낙관
    fn optimistic() -> Self {
        Self::new(h(1), Some(d(30)))
    }

    /// o5: V+72h에 유예 밖(Checking)
    fn checking() -> Self {
        Self::new(h(72), Some(d(30)))
    }

    fn path(&self) -> &std::path::Path {
        self.dir.path()
    }

    fn now(&self) -> OffsetDateTime {
        self.clock.now()
    }

    fn file_access(&self) -> Option<String> {
        read_session(self.path()).map(|v| v["accessToken"].as_str().unwrap().to_string())
    }

    fn file_exists(&self) -> bool {
        self.path().join("session.json").exists()
    }

    fn refresh_ok(&self, n: u32) {
        self.api.push_refresh(Reply::Now(Ok(bundle(n, self.now()))));
    }

    /// 응답 유실 재시도 묶음 전체(첫 시도 + 재시도 3회)가 연결 실패한다. 묶음은 30초 걸린다(즉시·10초·30초)
    fn refresh_fail_all(&self) {
        for _ in 0..ATTEMPTS {
            self.api.push_refresh(Reply::Now(Err(transport())));
        }
    }

    /// o4 뒤 refresh 성공(온라인, b2)
    async fn online() -> Self {
        let e = Self::optimistic();
        e.refresh_ok(2);
        e.svc.startup().await;
        e
    }

    fn start_ok(&self) {
        self.api.push_start(Reply::Now(Ok(start_ok(&base()))));
    }
}

fn is_poll(c: &Call) -> bool {
    matches!(c, Call::Poll { .. })
}

fn acc(n: u32) -> String {
    tok("cda_", &format!("acc{n}"))
}
fn rf(n: u32) -> String {
    tok("cdr_", &format!("ref{n}"))
}

fn assert_signed_in_online(s: &AuthStatus) {
    assert_eq!(s.phase, AuthPhase::SignedIn, "{s:?}");
    assert_eq!(s.reason, None);
    assert!(s.offline.is_none());
}

fn assert_offline(s: &AuthStatus, cause: Cause) {
    assert_eq!(s.phase, AuthPhase::SignedIn, "{s:?}");
    let o = s.offline.as_ref().expect("오프라인 정보");
    assert_eq!(o.cause, cause);
    assert_eq!(
        s.reason,
        Some(match cause {
            Cause::Network => AuthReason::Network,
            Cause::Server => AuthReason::Server,
        })
    );
}

// ---------------------------------------------------------------- 시작(open)

#[tokio::test(start_paused = true)]
async fn o1_no_file_signed_out() {
    let e = Env::new(h(1), None);
    let s = e.svc.status();
    assert_eq!((s.phase, s.reason), (AuthPhase::SignedOut, None));
    assert!(e.api.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn o2_other_origin_signed_out_file_kept() {
    let dir = tempfile::tempdir().unwrap();
    SessionStore::new(
        dir.path().to_path_buf(),
        &WorkerBase::parse("https://other.example.invalid").unwrap(),
    )
    .save(&stored(1, t0(), t0() + d(30)))
    .unwrap();
    let api = FakeWorkerApi::default();
    let svc = service(dir.path(), &api, &FakeClock::at(t0() + h(1)));
    assert_eq!(svc.status().phase, AuthPhase::SignedOut);
    assert!(dir.path().join("session.json").exists());
}

#[tokio::test(start_paused = true)]
async fn o3_corrupt_signed_out_file_kept() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("session.json"), b"{").unwrap();
    let svc = service(dir.path(), &FakeWorkerApi::default(), &FakeClock::at(t0()));
    assert_eq!(svc.status().phase, AuthPhase::SignedOut);
    assert!(dir.path().join("session.json").exists());
}

#[tokio::test(start_paused = true)]
async fn o4_within_grace_optimistic() {
    let e = Env::optimistic();
    let s = e.svc.status();
    assert_signed_in_online(&s);
    assert_eq!(s.channel_id.as_deref(), Some(CH));
    assert_eq!(s.verified_at, Some(t0()));
    assert!(e.api.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn o5_grace_over_checking() {
    let s = Env::checking().svc.status();
    assert_eq!(s.phase, AuthPhase::Checking);
    assert_eq!(s.channel_id.as_deref(), Some(CH));
}

#[tokio::test(start_paused = true)]
async fn o6_clock_rollback_checking() {
    let e = Env::new(-mins(1), Some(d(30)));
    assert_eq!(e.svc.status().phase, AuthPhase::Checking);
}

#[tokio::test(start_paused = true)]
async fn o7_cap_passed_expired_without_network() {
    let e = Env::new(h(2), Some(h(1)));
    let s = e.svc.status();
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::SessionExpired))
    );
    assert!(!e.file_exists());
    assert!(e.api.calls().is_empty());
}

// ------------------------------------------------- startup·refresh(첫 시도)

#[tokio::test(start_paused = true)]
async fn s1_optimistic_ok() {
    let e = Env::optimistic();
    e.refresh_ok(2);
    let s = e.svc.startup().await;
    assert_signed_in_online(&s);
    assert_eq!(e.file_access(), Some(acc(2)));
    assert_eq!(
        read_session(e.path()).unwrap()["verifiedAt"],
        "2030-01-01T01:00:00Z"
    );
    assert!(e.svc.take_first_online());
    assert!(!e.svc.take_first_online());
    assert_eq!(e.api.refresh_calls(), vec![rf(1)]);
}

#[tokio::test(start_paused = true)]
async fn s2_optimistic_transport_offline() {
    let e = Env::optimistic();
    let since = e.now();
    e.refresh_fail_all();
    let s = e.svc.startup().await;
    assert_offline(&s, Cause::Network);
    let o = s.offline.unwrap();
    assert_eq!((o.since, o.grace_until), (since, t0() + h(72)));
    assert_eq!(e.file_access(), Some(acc(1)));
    assert_eq!(e.api.refresh_calls().len(), ATTEMPTS);
    assert!(!e.svc.take_first_online());
}

#[tokio::test(start_paused = true)]
async fn s3_checking_ok() {
    let e = Env::checking();
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.startup().await);
}

#[tokio::test(start_paused = true)]
async fn s4_checking_transport_grace_expired_keeps_file() {
    let e = Env::checking();
    e.refresh_fail_all();
    let s = e.svc.startup().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::GraceExpired))
    );
    assert!(e.file_exists());
    assert_eq!(s.channel_id.as_deref(), Some(CH));
}

#[tokio::test(start_paused = true)]
async fn s5_session_expired_deletes() {
    let e = Env::checking();
    e.api
        .push_refresh(Reply::Now(Err(worker(401, "session_expired"))));
    let s = e.svc.startup().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::SessionExpired))
    );
    assert!(!e.file_exists());
    assert_eq!(e.api.refresh_calls().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn s6_invalid_token_deletes() {
    let e = Env::optimistic();
    e.api
        .push_refresh(Reply::Now(Err(worker(401, "invalid_token"))));
    let s = e.svc.startup().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::SessionExpired))
    );
    assert!(!e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn s7_revoked_deletes() {
    let e = Env::optimistic();
    e.api
        .push_refresh(Reply::Now(Err(worker(401, "session_revoked"))));
    let s = e.svc.startup().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::Revoked))
    );
    assert!(!e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn s8_not_allowed_denied() {
    let e = Env::optimistic();
    e.api
        .push_refresh(Reply::Now(Err(worker(403, "not_allowed"))));
    let s = e.svc.startup().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Denied, Some(AuthReason::RemovedFromAllowlist))
    );
    assert_eq!(s.channel_name.as_deref(), Some("채널"));
    assert_eq!(s.channel_id, None);
    assert!(!e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn s9_cloudflare_403_html_in_grace() {
    let e = Env::optimistic();
    for _ in 0..ATTEMPTS {
        e.api
            .push_refresh(Reply::Now(Err(ApiError::NotWorker { status: 403 })));
    }
    assert_offline(&e.svc.startup().await, Cause::Network);
    assert_eq!(e.api.refresh_calls().len(), ATTEMPTS);
}

#[tokio::test(start_paused = true)]
async fn s10_worker_400_in_grace_server() {
    let e = Env::optimistic();
    e.api
        .push_refresh(Reply::Now(Err(worker(400, "bad_request"))));
    assert_offline(&e.svc.startup().await, Cause::Server);
    assert_eq!(e.api.refresh_calls().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn s11_rate_limited_in_grace() {
    let e = Env::optimistic();
    e.api
        .push_refresh(Reply::Now(Err(worker(429, "rate_limited"))));
    assert_offline(&e.svc.startup().await, Cause::Server);
    assert_eq!(e.api.refresh_calls().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn s12_cap_passed_during_offline() {
    let e = Env::new(h(79), Some(h(80)));
    assert_eq!(e.svc.status().phase, AuthPhase::Checking);
    e.clock.set(t0() + h(80));
    e.refresh_fail_all();
    let s = e.svc.startup().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::SessionExpired))
    );
    assert!(!e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn s13_mismatched_pair_is_server() {
    let e = Env::optimistic();
    e.api
        .push_refresh(Reply::Now(Err(worker(401, "not_allowed"))));
    assert_offline(&e.svc.startup().await, Cause::Server);
}

// ------------------------------------------------------ 응답 유실(D9·D7)

#[tokio::test(start_paused = true)]
async fn l1_lost_then_ok_recovers() {
    let e = Env::optimistic();
    e.api.push_refresh(Reply::Now(Err(transport())));
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.startup().await);
    assert_eq!(e.api.refresh_calls(), vec![rf(1), rf(1)]);
}

#[tokio::test(start_paused = true)]
async fn l2_lost_then_revoked_is_reuse() {
    let e = Env::optimistic();
    e.api.push_refresh(Reply::Now(Err(transport())));
    e.api
        .push_refresh(Reply::Now(Err(worker(401, "session_revoked"))));
    let s = e.svc.startup().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::ReuseDetected))
    );
    assert!(!e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn l3_lost_all_offline() {
    let e = Env::optimistic();
    let t = tokio::time::Instant::now();
    e.refresh_fail_all();
    assert_offline(&e.svc.startup().await, Cause::Network);
    assert_eq!(e.api.refresh_calls(), vec![rf(1); ATTEMPTS]);
    // 즉시·10초·30초: 마지막 재시도도 첫 시도부터 30초(Worker 복구 창 60초 안)
    assert_eq!(t.elapsed(), std::time::Duration::from_secs(30));
}

#[tokio::test(start_paused = true)]
async fn l4_worker_5xx_retried() {
    // DO가 회전을 커밋한 뒤 Worker가 500 internal을 낼 수 있다: 같은 토큰으로 다시 내 복구한다
    let e = Env::optimistic();
    e.api.push_refresh(Reply::Now(Err(worker(500, "internal"))));
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.startup().await);
    assert_eq!(e.api.refresh_calls(), vec![rf(1), rf(1)]);
}

#[tokio::test(start_paused = true)]
async fn l8_lost_twice_then_ok_within_window() {
    // 이중 유실도 창 안의 세 번째 시도(10초)에서 복구한다(예전: 즉시 1회 뒤 1분 백오프 → 창 밖 → 재사용 감지)
    let e = Env::optimistic();
    let t = tokio::time::Instant::now();
    e.api.push_refresh(Reply::Now(Err(transport())));
    e.api.push_refresh(Reply::Now(Err(worker(502, "internal"))));
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.startup().await);
    assert_eq!(e.api.refresh_calls(), vec![rf(1), rf(1), rf(1)]);
    assert_eq!(t.elapsed(), std::time::Duration::from_secs(10));
}

#[tokio::test(start_paused = true)]
async fn l9_no_retry_past_window() {
    // 첫 요청이 오래 걸려(절전 등으로 벽시계가 70초 흐름) 창 끝을 넘겼으면 다시 내지 않는다
    let e = Env::optimistic();
    let n = Arc::new(Notify::new());
    e.api.push_refresh(Reply::Hold(n.clone(), Err(transport())));
    let svc = e.svc.clone();
    let t = tokio::spawn(async move { svc.startup().await });
    while e.api.refresh_calls().is_empty() {
        tokio::task::yield_now().await;
    }
    e.clock.advance(Duration::seconds(70));
    n.notify_one();
    assert_offline(&t.await.unwrap(), Cause::Network);
    assert_eq!(e.api.refresh_calls().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn l10_slow_attempts_back_to_back() {
    // 매 시도가 10초 시간 초과로 끝나면 기다리지 않고 0·10·20·30초에 낸다(마지막 송신은 45초 안)
    let e = Env::optimistic();
    let svc = e.svc.clone();
    let mut ns = Vec::new();
    for _ in 0..ATTEMPTS {
        let n = Arc::new(Notify::new());
        e.api.push_refresh(Reply::Hold(
            n.clone(),
            Err(ApiError::Transport { timed_out: true }),
        ));
        ns.push(n);
    }
    let t = tokio::spawn(async move { svc.startup().await });
    for (k, n) in ns.iter().enumerate() {
        while e.api.refresh_calls().len() <= k {
            tokio::task::yield_now().await;
        }
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        n.notify_one();
    }
    assert_offline(&t.await.unwrap(), Cause::Network);
    assert_eq!(e.api.refresh_calls().len(), ATTEMPTS);
}

#[tokio::test(start_paused = true)]
async fn l11_rate_limited_in_chain_stops() {
    // 묶음 중의 429는 서버가 커밋 전에 판정한 것이라 거기서 멈춘다(받아들인 위험, 구현 중 변경 53)
    let e = Env::optimistic();
    e.api.push_refresh(Reply::Now(Err(transport())));
    e.api
        .push_refresh(Reply::Now(Err(worker(429, "rate_limited"))));
    assert_offline(&e.svc.startup().await, Cause::Server);
    assert_eq!(e.api.refresh_calls().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn l12_logout_during_retry_wait_stops() {
    let e = Env::optimistic();
    e.api.push_refresh(Reply::Now(Err(transport())));
    e.api.push_refresh(Reply::Now(Err(transport())));
    let svc = e.svc.clone();
    let t = tokio::spawn(async move { svc.refresh().await });
    while e.api.refresh_calls().len() < 2 {
        tokio::task::yield_now().await;
    }
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    e.svc.logout().await.unwrap();
    assert_eq!(t.await.unwrap().phase, AuthPhase::SignedOut);
    assert_eq!(e.api.refresh_calls().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn l5_not_worker_retried() {
    let e = Env::optimistic();
    e.api
        .push_refresh(Reply::Now(Err(ApiError::NotWorker { status: 502 })));
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.startup().await);
    assert_eq!(e.api.refresh_calls().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn l6_contract_200_retried() {
    let e = Env::optimistic();
    e.api
        .push_refresh(Reply::Now(Err(ApiError::Contract { status: 200 })));
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.startup().await);
    assert_eq!(e.api.refresh_calls(), vec![rf(1), rf(1)]);
}

#[tokio::test(start_paused = true)]
async fn l7_contract_200_all_offline() {
    let e = Env::optimistic();
    for _ in 0..ATTEMPTS {
        e.api
            .push_refresh(Reply::Now(Err(ApiError::Contract { status: 200 })));
    }
    assert_offline(&e.svc.startup().await, Cause::Server);
    assert_eq!(e.api.refresh_calls().len(), ATTEMPTS);
}

// ------------------------------------------------------------ single-flight

#[tokio::test(start_paused = true)]
async fn f1_concurrent_refresh_calls_once() {
    let e = Env::optimistic();
    let n = Arc::new(Notify::new());
    e.api
        .push_refresh(Reply::Hold(n.clone(), Ok(bundle(2, e.now()))));
    let svc = e.svc.clone();
    let a = tokio::spawn({
        let s = svc.clone();
        async move { s.refresh().await }
    });
    let b = tokio::spawn({
        let s = svc.clone();
        async move { s.refresh().await }
    });
    while e.api.refresh_calls().is_empty() {
        tokio::task::yield_now().await;
    }
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    n.notify_one();
    let (a, b) = (a.await.unwrap(), b.await.unwrap());
    assert_eq!(e.api.refresh_calls().len(), 1);
    assert_signed_in_online(&a);
    assert_signed_in_online(&b);
}

#[tokio::test(start_paused = true)]
async fn f2_sequential_refresh_calls_twice() {
    let e = Env::optimistic();
    e.refresh_ok(2);
    e.svc.refresh().await;
    e.refresh_ok(3);
    e.svc.refresh().await;
    assert_eq!(e.api.refresh_calls(), vec![rf(1), rf(2)]);
}

#[tokio::test(start_paused = true)]
async fn f3_ensure_fresh_during_refresh_waits() {
    let dir = tempfile::tempdir().unwrap();
    let now = t0() + h(1);
    let b = bundle_with(1, now + Duration::seconds(30), t0() + d(30));
    store(dir.path())
        .save(&StoredSession::from_bundle(b, t0()))
        .unwrap();
    let api = FakeWorkerApi::default();
    let clock = FakeClock::at(now);
    let svc = Arc::new(service(dir.path(), &api, &clock));
    let n = Arc::new(Notify::new());
    api.push_refresh(Reply::Hold(n.clone(), Ok(bundle(2, now))));
    let a = tokio::spawn({
        let s = svc.clone();
        async move { s.refresh().await }
    });
    while api.refresh_calls().is_empty() {
        tokio::task::yield_now().await;
    }
    let b = tokio::spawn({
        let s = svc.clone();
        async move { s.ensure_fresh_access().await }
    });
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    n.notify_one();
    a.await.unwrap();
    let got = b.await.unwrap().expect("새 access");
    assert_eq!(api.refresh_calls().len(), 1);
    assert_eq!(got.expose(), &acc(2));
}

// ------------------------------------------------------------ 쓰기 실패(D10)

#[tokio::test(start_paused = true)]
async fn w1_refresh_ok_write_fails_keeps_new_in_memory() {
    let e = Env::optimistic();
    break_dir(e.path());
    e.refresh_ok(2);
    let s = e.svc.refresh().await;
    assert_signed_in_online(&s);
    // due까지 옮긴 뒤 다시 갱신: 옛 ref1이 아니라 ref2를 낸다
    e.clock.set(e.svc.next_wake().unwrap());
    e.refresh_ok(3);
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls(), vec![rf(1), rf(2)]);
    fix_dir(e.path());
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.file_access(), Some(acc(3)));
}

#[tokio::test(start_paused = true)]
async fn w2_dirty_flushed_on_tick() {
    let e = Env::optimistic();
    break_dir(e.path());
    e.refresh_ok(2);
    e.svc.refresh().await;
    fix_dir(e.path());
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), 1);
    assert_eq!(e.file_access(), Some(acc(2)));
}

#[tokio::test(start_paused = true)]
async fn w3_login_ok_write_fails_signed_in() {
    let e = Env::new(h(1), None);
    break_dir(e.path());
    e.start_ok();
    e.svc.begin_login().await;
    e.api
        .push_poll(Reply::Now(Ok(PollResponse::Ok(bundle(1, e.now())))));
    e.svc.poll_login_once().await;
    assert!(e.svc.is_signed_in());
    fix_dir(e.path());
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.file_access(), Some(acc(1)));
}

#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn w4_delete_failure_still_expired() {
    use std::os::unix::fs::PermissionsExt;
    let e = Env::optimistic();
    std::fs::set_permissions(e.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
    let probe = e.path().join("probe");
    if std::fs::write(&probe, b"x").is_ok() {
        eprintln!("읽기 전용 폴더에도 쓸 수 있어(root) 건너뜀");
        std::fs::remove_file(&probe).unwrap();
        return;
    }
    e.api
        .push_refresh(Reply::Now(Err(worker(401, "session_expired"))));
    let s = e.svc.refresh().await;
    std::fs::set_permissions(e.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::SessionExpired))
    );
    assert_eq!(s.channel_id, None);
}

// ----------------------------------------------------------- tick·스케줄(D20)

#[tokio::test(start_paused = true)]
async fn t1_not_due_no_call() {
    let e = Env::online().await;
    e.clock.advance(h(23) - mins(2));
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), 1);
    assert_eq!(
        e.svc.next_wake(),
        Some(t0() + h(1) + h(24) - Duration::seconds(60))
    );
}

#[tokio::test(start_paused = true)]
async fn t2_due_calls() {
    let e = Env::online().await;
    e.clock.set(e.svc.next_wake().unwrap());
    e.refresh_ok(3);
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn t3_access_skew_rules() {
    let e = Env::optimistic();
    let now = e.now();
    e.api
        .push_refresh(Reply::Now(Ok(bundle_with(2, now + h(2), now + d(30)))));
    e.svc.refresh().await;
    assert_eq!(e.svc.next_wake(), Some(now + h(2) - Duration::seconds(60)));
}

#[tokio::test(start_paused = true)]
async fn t4_offline_backoff_schedule() {
    let e = Env::optimistic();
    let s0 = e.now();
    e.refresh_fail_all();
    e.svc.startup().await;
    // 백오프는 재시도 묶음이 끝난 뒤부터 센다(1분 뒤 시도가 Worker 복구 창 밖이게)
    assert_eq!(e.svc.next_wake(), Some(s0 + chain() + mins(1)));
    e.clock.set(s0 + chain() + Duration::seconds(59));
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), ATTEMPTS);
    for delay in [2, 5, 10, 30, 30] {
        let at = e.svc.next_wake().unwrap();
        e.clock.set(at);
        let before = e.api.refresh_calls().len();
        e.refresh_fail_all();
        e.svc.tick(Trigger::Timer).await;
        assert_eq!(e.api.refresh_calls().len(), before + ATTEMPTS);
        assert_eq!(e.svc.next_wake(), Some(at + chain() + mins(delay)));
    }
}

#[tokio::test(start_paused = true)]
async fn t5_grace_passes_then_tries_once() {
    let e = Env::optimistic();
    e.refresh_fail_all();
    e.svc.startup().await;
    e.clock.set(t0() + h(72));
    e.refresh_fail_all();
    let s = e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), 2 * ATTEMPTS);
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::GraceExpired))
    );
    assert!(e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn t6_reconnect_from_grace_expired() {
    let e = Env::optimistic();
    e.refresh_fail_all();
    e.svc.startup().await;
    e.clock.set(t0() + h(72));
    e.refresh_fail_all();
    e.svc.tick(Trigger::Timer).await;
    let n = Arc::new(Notify::new());
    e.api
        .push_refresh(Reply::Hold(n.clone(), Ok(bundle(2, e.now()))));
    let svc = e.svc.clone();
    let t = tokio::spawn({
        let s = svc.clone();
        async move { s.refresh().await }
    });
    while e.api.refresh_calls().len() < 2 * ATTEMPTS + 1 {
        tokio::task::yield_now().await;
    }
    assert_eq!(svc.status().phase, AuthPhase::Checking);
    n.notify_one();
    assert_signed_in_online(&t.await.unwrap());
    assert_eq!(e.api.count(|c| matches!(c, Call::Start { .. })), 0);
}

#[tokio::test(start_paused = true)]
async fn t7_focus_min_gap() {
    let e = Env::optimistic();
    let s0 = e.now();
    e.refresh_fail_all();
    e.svc.startup().await;
    e.clock.set(s0 + Duration::seconds(59));
    e.svc.tick(Trigger::Focus).await;
    assert_eq!(e.api.refresh_calls().len(), ATTEMPTS);
    e.clock.set(s0 + Duration::seconds(61));
    e.refresh_fail_all();
    e.svc.tick(Trigger::Focus).await;
    assert_eq!(e.api.refresh_calls().len(), 2 * ATTEMPTS);
}

#[tokio::test(start_paused = true)]
async fn t8_resume_online_due_by_wall_clock() {
    let e = Env::online().await;
    e.clock.advance(h(25));
    e.refresh_ok(3);
    e.svc.tick(Trigger::Resume).await;
    assert_eq!(e.api.refresh_calls().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn t9_tick_noop_when_signed_out() {
    let e = Env::new(h(1), None);
    e.svc.tick(Trigger::Timer).await;
    e.svc.tick(Trigger::Focus).await;
    assert!(e.api.calls().is_empty());
    assert_eq!(e.svc.next_wake(), None);
}

// ------------------------------------------------------- 로그인(D13~D19)

/// 파일 없는 환경에서 로그인을 시작해 Pending으로 둔다
async fn pending_env() -> Env {
    let e = Env::new(h(1), None);
    e.start_ok();
    assert!(matches!(e.svc.begin_login().await, BeginLogin::Started(_)));
    e
}

#[tokio::test(start_paused = true)]
async fn g1_begin_login_starts() {
    let e = Env::new(h(1), None);
    e.start_ok();
    let now = e.now();
    let BeginLogin::Started(t) = e.svc.begin_login().await else {
        panic!("Started가 아님");
    };
    assert!(t.login_url.expose().ends_with(&"H".repeat(22)));
    let s = e.svc.status();
    assert_eq!(s.phase, AuthPhase::Pending);
    let p = s.pending.unwrap();
    assert_eq!(p.user_code, "K7QX-4MRA");
    assert_eq!(p.expires_at, now + mins(10));
    let Call::Start { verifier, client } = e.api.calls()[0].clone() else {
        panic!()
    };
    assert!(token::is_secret(&verifier));
    assert_eq!(client, "app/0.1.0 test");
    e.api.push_poll(Reply::Now(Ok(PollResponse::Pending)));
    e.svc.poll_login_once().await;
    let Call::Poll { secret, .. } = e.api.calls()[1].clone() else {
        panic!()
    };
    assert_eq!(token::poll_verifier(&secret), verifier);
}

#[tokio::test(start_paused = true)]
async fn g2_begin_twice_already_pending() {
    let e = pending_env().await;
    assert!(matches!(
        e.svc.begin_login().await,
        BeginLogin::AlreadyPending(_)
    ));
    assert_eq!(e.api.count(|c| matches!(c, Call::Start { .. })), 1);
}

#[tokio::test(start_paused = true)]
async fn g3_begin_when_signed_in() {
    let e = Env::optimistic();
    assert_eq!(e.svc.begin_login().await, BeginLogin::AlreadySignedIn);
    assert!(e.api.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn g4_start_failures() {
    for (err, reason) in [
        (transport(), AuthReason::Network),
        (worker(429, "rate_limited"), AuthReason::Server),
        (worker(503, "busy"), AuthReason::Server),
    ] {
        let e = Env::new(h(1), None);
        e.api.push_start(Reply::Now(Err(err)));
        assert_eq!(e.svc.begin_login().await, BeginLogin::Failed);
        let s = e.svc.status();
        assert_eq!((s.phase, s.reason), (AuthPhase::Error, Some(reason)));
    }
}

#[tokio::test(start_paused = true)]
async fn g5_poll_ok_signs_in() {
    let e = pending_env().await;
    e.api
        .push_poll(Reply::Now(Ok(PollResponse::Ok(bundle(1, e.now())))));
    let s = e.svc.poll_login_once().await;
    assert_signed_in_online(&s);
    assert_eq!(e.file_access(), Some(acc(1)));
    assert!(e.svc.take_first_online());
    assert!(e.svc.login_ticket().is_none());
}

#[tokio::test(start_paused = true)]
async fn g6_poll_denied() {
    let e = pending_env().await;
    e.api.push_poll(Reply::Now(Ok(PollResponse::Denied {
        channel_name: "남의 채널".into(),
    })));
    let s = e.svc.poll_login_once().await;
    assert_eq!((s.phase, s.reason), (AuthPhase::Denied, None));
    assert_eq!(s.channel_name.as_deref(), Some("남의 채널"));
    assert_eq!(s.channel_id, None);
    assert!(!e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn g7_poll_cancelled() {
    let e = pending_env().await;
    e.api.push_poll(Reply::Now(Ok(PollResponse::Cancelled)));
    assert_eq!(e.svc.poll_login_once().await.phase, AuthPhase::Cancelled);
}

#[tokio::test(start_paused = true)]
async fn g8_poll_failed() {
    let e = pending_env().await;
    e.api.push_poll(Reply::Now(Ok(PollResponse::Failed {
        code: "token".into(),
    })));
    let s = e.svc.poll_login_once().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Error, Some(AuthReason::Server))
    );
}

#[tokio::test(start_paused = true)]
async fn g9_poll_404_before_deadline_lost() {
    let e = pending_env().await;
    e.api.push_poll(Reply::Now(Err(worker(404, "not_found"))));
    let s = e.svc.poll_login_once().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Error, Some(AuthReason::LoginLost))
    );
}

#[tokio::test(start_paused = true)]
async fn g10_poll_404_after_deadline_timeout() {
    let e = pending_env().await;
    let deadline = e.svc.status().pending.unwrap().expires_at;
    let n = Arc::new(Notify::new());
    e.api
        .push_poll(Reply::Hold(n.clone(), Err(worker(404, "not_found"))));
    let svc = e.svc.clone();
    let t = tokio::spawn({
        let s = svc.clone();
        async move { s.poll_login_once().await }
    });
    while e.api.count(is_poll) == 0 {
        tokio::task::yield_now().await;
    }
    e.clock.set(deadline + Duration::seconds(1));
    n.notify_one();
    let s = t.await.unwrap();
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::LoginTimeout))
    );
}

#[tokio::test(start_paused = true)]
async fn g11_too_soon_keeps_pending() {
    let e = pending_env().await;
    e.api.push_poll(Reply::Now(Err(worker(429, "too_soon"))));
    assert_eq!(e.svc.poll_login_once().await.phase, AuthPhase::Pending);
}

#[tokio::test(start_paused = true)]
async fn g12_transient_keeps_polling() {
    let e = pending_env().await;
    e.api.push_poll(Reply::Now(Err(transport())));
    e.api.push_poll(Reply::Now(Err(worker(503, "busy"))));
    e.api.push_poll(Reply::Now(Ok(PollResponse::Pending)));
    e.api
        .push_poll(Reply::Now(Ok(PollResponse::Ok(bundle(1, e.now())))));
    for _ in 0..3 {
        assert_eq!(e.svc.poll_login_once().await.phase, AuthPhase::Pending);
    }
    assert_eq!(e.svc.poll_login_once().await.phase, AuthPhase::SignedIn);
}

#[tokio::test(start_paused = true)]
async fn g13_deadline_with_last_transient_is_error() {
    let e = pending_env().await;
    let deadline = e.svc.status().pending.unwrap().expires_at;
    e.api.push_poll(Reply::Now(Err(transport())));
    assert_eq!(e.svc.poll_login_once().await.phase, AuthPhase::Pending);
    e.clock.set(deadline);
    let s = e.svc.poll_login_once().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Error, Some(AuthReason::Network))
    );
    assert_eq!(e.api.count(is_poll), 1);
}

#[tokio::test(start_paused = true)]
async fn g14_deadline_without_transient_is_timeout() {
    let e = pending_env().await;
    let deadline = e.svc.status().pending.unwrap().expires_at;
    e.api.push_poll(Reply::Now(Ok(PollResponse::Pending)));
    e.svc.poll_login_once().await;
    e.clock.set(deadline);
    let s = e.svc.poll_login_once().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::LoginTimeout))
    );
}

#[tokio::test(start_paused = true)]
async fn g15_cancel_discards_late_ok() {
    let e = pending_env().await;
    let n = Arc::new(Notify::new());
    e.api.push_poll(Reply::Hold(
        n.clone(),
        Ok(PollResponse::Ok(bundle(1, e.now()))),
    ));
    let svc = e.svc.clone();
    let t = tokio::spawn({
        let s = svc.clone();
        async move { s.poll_login_once().await }
    });
    while e.api.count(is_poll) == 0 {
        tokio::task::yield_now().await;
    }
    assert_eq!(svc.cancel_login().phase, AuthPhase::SignedOut);
    n.notify_one();
    let s = t.await.unwrap();
    assert_eq!(s.phase, AuthPhase::SignedOut);
    assert!(!e.file_exists());
}

/// s4 상태: GraceExpired, 파일 있음
async fn grace_expired_env() -> Env {
    let e = Env::checking();
    e.refresh_fail_all();
    let s = e.svc.startup().await;
    assert_eq!(s.reason, Some(AuthReason::GraceExpired));
    e
}

#[tokio::test(start_paused = true)]
async fn g16_cancel_from_grace_expired_keeps_held() {
    let e = grace_expired_env().await;
    e.start_ok();
    assert!(matches!(e.svc.begin_login().await, BeginLogin::Started(_)));
    let s = e.svc.cancel_login();
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::GraceExpired))
    );
    assert!(e.file_exists());
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.refresh().await);
}

#[tokio::test(start_paused = true)]
async fn g17_cancel_while_offline_in_grace() {
    let e = Env::new(h(73), Some(d(30)));
    assert_eq!(e.svc.status().phase, AuthPhase::Checking);
    e.start_ok();
    e.svc.begin_login().await;
    e.clock.set(t0() + h(71));
    e.refresh_fail_all();
    let s = e.svc.refresh().await;
    assert_eq!(s.phase, AuthPhase::Pending);
    let s = e.svc.cancel_login();
    assert_eq!(s.phase, AuthPhase::SignedIn);
    assert_eq!(s.offline.unwrap().grace_until, t0() + h(72));
}

#[tokio::test(start_paused = true)]
async fn g18_refresh_ok_during_pending_ends_login() {
    let e = Env::checking();
    e.start_ok();
    e.svc.begin_login().await;
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.refresh().await);
    assert!(e.svc.login_ticket().is_none());
    e.svc.poll_login_once().await;
    assert_eq!(e.api.count(is_poll), 0);
}

#[tokio::test(start_paused = true)]
async fn g19_login_failure_keeps_held() {
    let e = grace_expired_env().await;
    e.start_ok();
    e.svc.begin_login().await;
    e.api.push_poll(Reply::Now(Ok(PollResponse::Cancelled)));
    assert_eq!(e.svc.poll_login_once().await.phase, AuthPhase::Cancelled);
    assert!(e.file_exists());
    let before = e.api.refresh_calls().len();
    e.svc.refresh().await;
    assert!(e.api.refresh_calls().len() > before);
}

#[tokio::test(start_paused = true)]
async fn g20_run_login_poll_paced() {
    let e = pending_env().await;
    e.api.push_poll(Reply::Now(Ok(PollResponse::Pending)));
    e.api.push_poll(Reply::Now(Ok(PollResponse::Pending)));
    e.api
        .push_poll(Reply::Now(Ok(PollResponse::Ok(bundle(1, e.now())))));
    let t = tokio::time::Instant::now();
    let s = e.svc.run_login_poll().await;
    assert_eq!(s.phase, AuthPhase::SignedIn);
    assert_eq!(e.api.count(is_poll), 3);
    assert!(t.elapsed() >= std::time::Duration::from_secs(6));
}

#[tokio::test(start_paused = true)]
async fn g21_run_login_poll_times_out() {
    let e = pending_env().await;
    for _ in 0..400 {
        e.api.push_poll(Reply::Now(Ok(PollResponse::Pending)));
    }
    let t = tokio::time::Instant::now();
    let s = e.svc.run_login_poll().await;
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::LoginTimeout))
    );
    assert!(t.elapsed() <= std::time::Duration::from_secs(602));
}

#[tokio::test(start_paused = true)]
async fn g22_interval_from_start() {
    let e = Env::new(h(1), None);
    e.api
        .push_start(Reply::Now(Ok(start_ok_with(&base(), 5000))));
    e.svc.begin_login().await;
    e.api.push_poll(Reply::Now(Ok(PollResponse::Pending)));
    e.api
        .push_poll(Reply::Now(Ok(PollResponse::Ok(bundle(1, e.now())))));
    let t = tokio::time::Instant::now();
    e.svc.run_login_poll().await;
    assert!(t.elapsed() >= std::time::Duration::from_secs(10));
}

// ------------------------------------------------------------ 로그아웃(D12)

#[tokio::test(start_paused = true)]
async fn x1_logout_clears_and_calls_server() {
    let e = Env::online().await;
    let s = e.svc.logout().await.unwrap();
    assert_eq!(s.phase, AuthPhase::SignedOut);
    assert!(!e.file_exists());
    assert_eq!(
        e.api.calls().last().unwrap(),
        &Call::Logout {
            access: Some(acc(2)),
            refresh: Some(rf(2))
        }
    );
}

#[tokio::test(start_paused = true)]
async fn x2_logout_server_failure_ignored() {
    let e = Env::online().await;
    e.api.push_logout(Reply::Now(Err(transport())));
    assert_eq!(e.svc.logout().await.unwrap().phase, AuthPhase::SignedOut);
    assert!(!e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn x3_logout_during_refresh_discards_result() {
    let e = Env::optimistic();
    let n = Arc::new(Notify::new());
    e.api
        .push_refresh(Reply::Hold(n.clone(), Ok(bundle(2, e.now()))));
    let svc = e.svc.clone();
    let t = tokio::spawn({
        let s = svc.clone();
        async move { s.refresh().await }
    });
    while e.api.refresh_calls().is_empty() {
        tokio::task::yield_now().await;
    }
    svc.logout().await.unwrap();
    n.notify_one();
    t.await.unwrap();
    assert_eq!(svc.status().phase, AuthPhase::SignedOut);
    assert!(!e.file_exists());
    assert!(!svc.is_signed_in());
}

#[tokio::test(start_paused = true)]
async fn x4_logout_cancels_pending_login() {
    let e = pending_env().await;
    assert_eq!(e.svc.logout().await.unwrap().phase, AuthPhase::SignedOut);
    assert!(e.svc.login_ticket().is_none());
    assert_eq!(e.api.count(|c| matches!(c, Call::Logout { .. })), 0);
}

// ------------------------------------------------- ensure_fresh_access·게이트

#[tokio::test(start_paused = true)]
async fn e1_fresh_access_no_call() {
    let e = Env::online().await;
    let got = e.svc.ensure_fresh_access().await.unwrap();
    assert_eq!(got.expose(), &acc(2));
    assert_eq!(e.api.refresh_calls().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn e2_expiring_access_refreshes() {
    let e = Env::online().await;
    e.clock.set(t0() + h(1) + h(24) - Duration::seconds(30));
    e.refresh_ok(3);
    let got = e.svc.ensure_fresh_access().await.unwrap();
    assert_eq!(got.expose(), &acc(3));
}

#[tokio::test(start_paused = true)]
async fn e3_offline_none() {
    let e = Env::optimistic();
    e.refresh_fail_all();
    e.svc.refresh().await;
    assert!(e.svc.ensure_fresh_access().await.is_none());
}

#[tokio::test(start_paused = true)]
async fn e4_signed_out_none() {
    let e = Env::new(h(1), None);
    assert!(e.svc.ensure_fresh_access().await.is_none());
    assert!(e.api.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn gate_table() {
    let mut cases: Vec<(&str, Env, bool)> = Vec::new();
    cases.push(("signed_in_optimistic", Env::optimistic(), true));
    cases.push(("signed_in_online", Env::online().await, true));
    let offline = Env::optimistic();
    offline.refresh_fail_all();
    offline.svc.refresh().await;
    cases.push(("signed_in_offline", offline, true));
    cases.push(("checking", Env::checking(), false));
    cases.push(("signed_out", Env::new(h(1), None), false));
    cases.push(("pending", pending_env().await, false));
    let denied = pending_env().await;
    denied.api.push_poll(Reply::Now(Ok(PollResponse::Denied {
        channel_name: "x".into(),
    })));
    denied.svc.poll_login_once().await;
    cases.push(("denied", denied, false));
    cases.push(("expired", Env::new(h(2), Some(h(1))), false));
    let cancelled = pending_env().await;
    cancelled
        .api
        .push_poll(Reply::Now(Ok(PollResponse::Cancelled)));
    cancelled.svc.poll_login_once().await;
    cases.push(("cancelled", cancelled, false));
    let err = pending_env().await;
    err.api.push_poll(Reply::Now(Ok(PollResponse::Failed {
        code: "token".into(),
    })));
    err.svc.poll_login_once().await;
    cases.push(("error", err, false));
    for (name, e, signed_in) in cases {
        assert_eq!(e.svc.is_signed_in(), signed_in, "{name}");
        match e.svc.require_signed_in() {
            Ok(()) => assert!(signed_in, "{name}"),
            Err(err) => {
                assert!(!signed_in, "{name}");
                assert_eq!(err.code, ErrorCode::NotLoggedIn, "{name}");
            }
        }
        assert_eq!(
            e.svc.signed_in_channel(),
            signed_in.then(|| CH.to_string()),
            "{name}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn subscribe_sees_transitions() {
    let e = Env::optimistic();
    let mut rx = e.svc.subscribe();
    e.refresh_ok(2);
    e.svc.refresh().await;
    rx.changed().await.unwrap();
    let s = rx.borrow().clone();
    assert_eq!(s.phase, AuthPhase::SignedIn);
    assert!(s.offline.is_none());
}

fn assert_send_sync<T: Send + Sync>() {}
fn assert_send<T: Send>(_: T) {}

#[tokio::test(start_paused = true)]
async fn service_is_send_sync() {
    assert_send_sync::<Svc>();
    let e = Env::optimistic();
    assert_send(e.svc.refresh());
    assert_send(e.svc.begin_login());
    assert_send(e.svc.run_login_poll());
}

#[tokio::test(start_paused = true)]
async fn service_debug_no_secrets() {
    // 저장 세션(held 토큰)과 대기 중 로그인(loginId·주소)이 둘 다 메모리에 있는 상태에서 찍는다
    let e = grace_expired_env().await;
    e.start_ok();
    assert!(matches!(e.svc.begin_login().await, BeginLogin::Started(_)));
    let t = format!("{:?}{:?}{:?}", e.svc, e.svc.status(), e.svc.login_ticket());
    for s in [acc(1), rf(1), "L".repeat(22), "H".repeat(22)] {
        assert!(!t.contains(&s), "{t}");
    }
}

#[tokio::test(start_paused = true)]
async fn n1_noops_without_session_or_login() {
    let e = Env::new(h(1), None);
    assert_eq!(e.svc.startup().await.phase, AuthPhase::SignedOut);
    assert_eq!(e.svc.refresh().await.phase, AuthPhase::SignedOut);
    assert_eq!(e.svc.poll_login_once().await.phase, AuthPhase::SignedOut);
    assert_eq!(e.svc.run_login_poll().await.phase, AuthPhase::SignedOut);
    assert_eq!(e.svc.cancel_login().phase, AuthPhase::SignedOut);
    assert!(e.svc.login_ticket().is_none());
    assert!(e.api.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn n2_unreadable_file_signed_out() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("session.json")).unwrap();
    let svc = service(dir.path(), &FakeWorkerApi::default(), &FakeClock::at(t0()));
    assert_eq!(svc.status().phase, AuthPhase::SignedOut);
}

#[tokio::test(start_paused = true)]
async fn n3_stale_poll_loop_stops_after_new_login() {
    // 취소 뒤 새 로그인이 시작되면 옛 폴링 루프는 새 로그인을 건드리지 않고 끝난다
    let e = pending_env().await;
    let svc = e.svc.clone();
    let t = tokio::spawn(async move { svc.run_login_poll().await });
    tokio::task::yield_now().await;
    e.svc.cancel_login();
    e.start_ok();
    assert!(matches!(e.svc.begin_login().await, BeginLogin::Started(_)));
    t.await.unwrap();
    assert_eq!(e.svc.status().phase, AuthPhase::Pending);
    assert_eq!(e.api.count(is_poll), 0);
}

#[tokio::test(start_paused = true)]
async fn n4_poll_unexpected_error_during_deadline() {
    // 기한이 지난 뒤 도착한 일시 오류와 Pending은 시간 초과/오류로 끝난다
    let e = pending_env().await;
    let deadline = e.svc.status().pending.unwrap().expires_at;
    let n = Arc::new(Notify::new());
    e.api.push_poll(Reply::Hold(n.clone(), Err(transport())));
    let svc = e.svc.clone();
    let t = tokio::spawn(async move { svc.poll_login_once().await });
    while e.api.count(is_poll) == 0 {
        tokio::task::yield_now().await;
    }
    e.clock.set(deadline + Duration::seconds(1));
    n.notify_one();
    let s = t.await.unwrap();
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Error, Some(AuthReason::Network))
    );

    let e = pending_env().await;
    let deadline = e.svc.status().pending.unwrap().expires_at;
    let n = Arc::new(Notify::new());
    e.api
        .push_poll(Reply::Hold(n.clone(), Ok(PollResponse::Pending)));
    let svc = e.svc.clone();
    let t = tokio::spawn(async move { svc.poll_login_once().await });
    while e.api.count(is_poll) == 0 {
        tokio::task::yield_now().await;
    }
    e.clock.set(deadline + Duration::seconds(1));
    n.notify_one();
    let s = t.await.unwrap();
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::LoginTimeout))
    );
}

#[tokio::test(start_paused = true)]
async fn n5_start_unexpected_rejection_is_server() {
    // start가 401을 돌려주는 일은 없지만 오면 서버 문제로 둔다
    let e = Env::new(h(1), None);
    e.api
        .push_start(Reply::Now(Err(worker(401, "invalid_token"))));
    assert_eq!(e.svc.begin_login().await, BeginLogin::Failed);
    assert_eq!(e.svc.status().reason, Some(AuthReason::Server));
}

#[tokio::test(start_paused = true)]
async fn n6_refresh_during_login_start_keeps_signed_in() {
    // start 요청 중에 refresh가 성공하면 로그인 화면으로 뒤집지 않는다
    let e = Env::checking();
    let n = Arc::new(Notify::new());
    e.api
        .push_start(Reply::Hold(n.clone(), Ok(start_ok(&base()))));
    let svc = e.svc.clone();
    let t = tokio::spawn(async move { svc.begin_login().await });
    while e.api.count(|c| matches!(c, Call::Start { .. })) == 0 {
        tokio::task::yield_now().await;
    }
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.refresh().await);
    n.notify_one();
    assert_eq!(t.await.unwrap(), BeginLogin::AlreadySignedIn);
    assert!(e.svc.is_signed_in());
    assert!(e.svc.login_ticket().is_none());
}

// ------------------------------------- start 요청과 겹친 동작(리뷰 반영, 50 (라))

/// Checking 환경에서 start를 붙잡은 채 begin_login을 띄운다
async fn held_start(
    e: &Env,
    reply: Result<StartResponse, ApiError>,
) -> (Arc<Notify>, tokio::task::JoinHandle<BeginLogin>) {
    let n = Arc::new(Notify::new());
    e.api.push_start(Reply::Hold(n.clone(), reply));
    let svc = e.svc.clone();
    let t = tokio::spawn(async move { svc.begin_login().await });
    while e.api.count(|c| matches!(c, Call::Start { .. })) == 0 {
        tokio::task::yield_now().await;
    }
    (n, t)
}

#[tokio::test(start_paused = true)]
async fn n7_refresh_during_failed_start_keeps_signed_in() {
    // start가 실패해도 그사이 refresh로 SignedIn이 됐으면 Error로 덮지 않는다
    let e = Env::checking();
    let (n, t) = held_start(&e, Err(transport())).await;
    e.refresh_ok(2);
    assert_signed_in_online(&e.svc.refresh().await);
    n.notify_one();
    assert_eq!(t.await.unwrap(), BeginLogin::AlreadySignedIn);
    assert_signed_in_online(&e.svc.status());
    assert!(e.svc.require_signed_in().is_ok());
}

#[tokio::test(start_paused = true)]
async fn n8_cancel_during_start_discards_ticket() {
    for ok in [true, false] {
        let e = Env::new(h(1), None);
        let reply = if ok {
            Ok(start_ok(&base()))
        } else {
            Err(transport())
        };
        let (n, t) = held_start(&e, reply).await;
        assert_eq!(e.svc.cancel_login().phase, AuthPhase::SignedOut);
        n.notify_one();
        assert_eq!(t.await.unwrap(), BeginLogin::Discarded, "ok={ok}");
        let s = e.svc.status();
        assert_eq!((s.phase, s.reason), (AuthPhase::SignedOut, None), "ok={ok}");
        assert!(e.svc.login_ticket().is_none());
        e.svc.poll_login_once().await;
        assert_eq!(e.api.count(is_poll), 0);
    }
}

#[tokio::test(start_paused = true)]
async fn n9_logout_during_start_discards_ticket() {
    let e = Env::checking();
    let (n, t) = held_start(&e, Ok(start_ok(&base()))).await;
    assert_eq!(e.svc.logout().await.unwrap().phase, AuthPhase::SignedOut);
    n.notify_one();
    assert_eq!(t.await.unwrap(), BeginLogin::Discarded);
    assert_eq!(e.svc.status().phase, AuthPhase::SignedOut);
    assert!(e.svc.login_ticket().is_none());
    assert!(!e.file_exists());
}

#[tokio::test(start_paused = true)]
async fn n10_new_login_after_discarded_start() {
    // 버린 start 뒤에도 새 로그인은 평소대로 시작한다
    let e = Env::new(h(1), None);
    let (n, t) = held_start(&e, Ok(start_ok(&base()))).await;
    e.svc.cancel_login();
    n.notify_one();
    assert_eq!(t.await.unwrap(), BeginLogin::Discarded);
    e.start_ok();
    assert!(matches!(e.svc.begin_login().await, BeginLogin::Started(_)));
    assert_eq!(e.svc.status().phase, AuthPhase::Pending);
}

// ---------------------------------------------- 상한으로 잘린 유예(서비스 수준)

#[tokio::test(start_paused = true)]
async fn t10_capped_grace_wakes_at_cap_and_expires() {
    // 파일 refreshExpiresAt = V+10h: 유예 끝은 V+72h가 아니라 V+10h이고, next_retry_at보다 먼저 온다
    let e = Env::new(h(10) - Duration::seconds(80), Some(h(10)));
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
    e.refresh_fail_all();
    let s = e.svc.startup().await;
    assert_offline(&s, Cause::Network);
    assert_eq!(s.offline.unwrap().grace_until, t0() + h(10));
    assert_eq!(e.svc.next_wake(), Some(t0() + h(10)));
    e.clock.set(t0() + h(10));
    e.refresh_fail_all();
    let s = e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), 2 * ATTEMPTS);
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::SessionExpired))
    );
    assert!(!e.file_exists());
}

// ------------------------------------------ 실행 중 시계 되돌리기(§11.3, 리뷰 반영)

#[tokio::test(start_paused = true)]
async fn r1_rollback_while_offline_rechecks_and_expires() {
    let e = Env::optimistic();
    e.refresh_fail_all();
    assert!(e.svc.startup().await.offline.is_some());
    e.clock.set(t0() - d(365));
    assert_eq!(e.svc.next_wake(), Some(e.now()));
    e.refresh_fail_all();
    let s = e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), 2 * ATTEMPTS);
    assert_eq!(
        (s.phase, s.reason),
        (AuthPhase::Expired, Some(AuthReason::GraceExpired))
    );
    assert!(e.file_exists());
    assert!(e.svc.require_signed_in().is_err());
    assert_eq!(e.svc.next_wake(), None);
}

#[tokio::test(start_paused = true)]
async fn r2_rollback_while_online_rechecks() {
    for trigger in [Trigger::Timer, Trigger::Focus, Trigger::Resume] {
        let e = Env::online().await;
        e.clock.set(t0() - d(365));
        assert_eq!(e.svc.next_wake(), Some(e.now()));
        e.api
            .push_refresh(Reply::Now(Err(worker(401, "session_revoked"))));
        let s = e.svc.tick(trigger).await;
        assert_eq!(e.api.refresh_calls().len(), 2, "{trigger:?}");
        assert_eq!(
            (s.phase, s.reason),
            (AuthPhase::Expired, Some(AuthReason::Revoked)),
            "{trigger:?}"
        );
    }
}

#[tokio::test(start_paused = true)]
async fn r3_rollback_then_ok_settles() {
    // 되돌린 시계에서 갱신이 성공하면 verifiedAt이 새 시계로 바뀌어 다시 즉시 깨우지 않는다
    let e = Env::online().await;
    e.clock.set(t0() - d(365));
    e.refresh_ok(3);
    assert_signed_in_online(&e.svc.tick(Trigger::Timer).await);
    let now = e.now();
    assert_eq!(e.svc.next_wake(), Some(now + h(24) - Duration::seconds(60)));
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn o8_far_future_file_does_not_panic() {
    // 9999년 verifiedAt + 72h는 범위를 넘는다: 깨진 파일로 보고 SignedOut(파일 유지)
    let dir = tempfile::tempdir().unwrap();
    let mut v = serde_json::to_value(read_or_save(dir.path())).unwrap();
    v["verifiedAt"] = "9999-12-31T00:00:00Z".into();
    v["refreshExpiresAt"] = "9999-12-31T00:00:00Z".into();
    std::fs::write(dir.path().join("session.json"), v.to_string()).unwrap();
    let svc = service(dir.path(), &FakeWorkerApi::default(), &FakeClock::at(t0()));
    assert_eq!(svc.status().phase, AuthPhase::SignedOut);
    assert!(dir.path().join("session.json").exists());
}

fn read_or_save(dir: &std::path::Path) -> serde_json::Value {
    store(dir).save(&stored(1, t0(), t0() + d(30))).unwrap();
    read_session(dir).unwrap()
}

// ------------------------------------------------ PR 리뷰 반영(구현 중 변경 53)

#[tokio::test(start_paused = true)]
async fn m1_fast_local_clock_does_not_loop() {
    // 로컬 시계가 서버보다 25시간 빠르다: 받은 accessExpiresAt(서버 기준 +24h)이 로컬로는 이미 지났다.
    // 다음 갱신은 확인 뒤 5분이고, updater용 access도 그 사이에는 회전하지 않는다
    let e = Env::optimistic();
    let now = e.now();
    e.api
        .push_refresh(Reply::Now(Ok(bundle_with(2, now - h(1), now + d(30)))));
    assert_signed_in_online(&e.svc.refresh().await);
    assert_eq!(e.svc.next_wake(), Some(now + mins(5)));
    e.svc.tick(Trigger::Timer).await;
    e.svc.tick(Trigger::Focus).await;
    assert_eq!(e.svc.ensure_fresh_access().await.unwrap().expose(), &acc(2));
    assert_eq!(e.api.refresh_calls().len(), 1);
    e.clock.set(now + mins(5));
    e.api
        .push_refresh(Reply::Now(Ok(bundle_with(3, now - h(1), now + d(30)))));
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls(), vec![rf(1), rf(2)]);
}

#[tokio::test(start_paused = true)]
async fn m2_cap_last_minute_does_not_loop() {
    // 60일 상한의 마지막 60초: 서버는 accessExpiresAt을 상한으로 자른다(now + 30초) → 다음 갱신은 5분 뒤
    let e = Env::optimistic();
    let now = e.now();
    let cap = now + Duration::seconds(30);
    e.api.push_refresh(Reply::Now(Ok(bundle_with(2, cap, cap))));
    e.svc.refresh().await;
    assert_eq!(e.svc.next_wake(), Some(now + mins(5)));
    e.svc.tick(Trigger::Timer).await;
    assert_eq!(e.api.refresh_calls().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn m3_poll_single_flight() {
    // 겹친 poll은 한 번에 하나: 먼저 낸 poll이 ok를 받으면 기다리던 poll은 다시 내지 않는다(404가 ok를 덮지 않는다)
    let e = pending_env().await;
    let n = Arc::new(Notify::new());
    e.api.push_poll(Reply::Hold(
        n.clone(),
        Ok(PollResponse::Ok(bundle(1, e.now()))),
    ));
    e.api.push_poll(Reply::Now(Err(worker(404, "not_found"))));
    let a = tokio::spawn({
        let s = e.svc.clone();
        async move { s.poll_login_once().await }
    });
    while e.api.count(is_poll) == 0 {
        tokio::task::yield_now().await;
    }
    let b = tokio::spawn({
        let s = e.svc.clone();
        async move { s.poll_login_once().await }
    });
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
    assert_eq!(e.api.count(is_poll), 1);
    n.notify_one();
    assert_signed_in_online(&a.await.unwrap());
    assert_signed_in_online(&b.await.unwrap());
    assert_eq!(e.api.count(is_poll), 1);
    assert_eq!(e.file_access(), Some(acc(1)));
}

#[tokio::test(start_paused = true)]
async fn m4_relogin_revokes_old_session() {
    // 저장 세션(유예 지남)을 둔 채 다시 로그인하면 ok 뒤 옛 세션을 서버에서도 끝낸다(실패해도 로그인은 유지)
    for ok in [true, false] {
        let e = grace_expired_env().await;
        e.start_ok();
        e.svc.begin_login().await;
        e.api
            .push_poll(Reply::Now(Ok(PollResponse::Ok(bundle(5, e.now())))));
        e.api
            .push_logout(Reply::Now(if ok { Ok(()) } else { Err(transport()) }));
        let s = e.svc.poll_login_once().await;
        assert_signed_in_online(&s);
        assert_eq!(e.file_access(), Some(acc(5)), "ok={ok}");
        assert_eq!(
            e.api.calls().last().unwrap(),
            &Call::Logout {
                access: Some(acc(1)),
                refresh: Some(rf(1))
            },
            "ok={ok}"
        );
        assert!(e.svc.is_signed_in());
    }
    // 저장 세션이 없으면 로그아웃을 부르지 않는다
    let e = pending_env().await;
    e.api
        .push_poll(Reply::Now(Ok(PollResponse::Ok(bundle(1, e.now())))));
    e.svc.poll_login_once().await;
    assert_eq!(e.api.count(|c| matches!(c, Call::Logout { .. })), 0);
}

/// 폴더를 읽기 전용으로 바꾼다. root라 막히지 않으면 false(테스트 건너뜀)
#[cfg(unix)]
fn make_dir_readonly(dir: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    let probe = dir.join("probe");
    if std::fs::write(&probe, b"x").is_ok() {
        eprintln!("읽기 전용 폴더에도 쓸 수 있어(root) 건너뜀");
        let _ = std::fs::remove_file(&probe);
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        return false;
    }
    true
}

#[cfg(unix)]
fn make_dir_writable(dir: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).unwrap();
}

#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn m5_logout_remove_failure_not_signed_in_after_restart() {
    let e = Env::online().await;
    if !make_dir_readonly(e.path()) {
        return;
    }
    let r = e.svc.logout().await;
    let again = service(e.path(), &e.api, &e.clock);
    let st = again.status();
    make_dir_writable(e.path());
    assert_eq!(r.unwrap().phase, AuthPhase::SignedOut);
    assert_eq!(st.phase, AuthPhase::SignedOut);
    assert!(e.file_access().is_none());
}

#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn m6_drop_session_remove_failure_not_signed_in_after_restart() {
    for err in [
        worker(401, "session_revoked"),
        worker(403, "not_allowed"),
        worker(401, "session_expired"),
    ] {
        let e = Env::optimistic();
        if !make_dir_readonly(e.path()) {
            return;
        }
        e.api.push_refresh(Reply::Now(Err(err.clone())));
        let s = e.svc.refresh().await;
        let again = service(e.path(), &e.api, &e.clock);
        let st = again.status();
        make_dir_writable(e.path());
        assert!(!s.phase.eq(&AuthPhase::SignedIn), "{err:?}");
        assert_eq!(st.phase, AuthPhase::SignedOut, "{err:?}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn m7_publish_outside_state_lock() {
    // 구독자가 watch borrow를 쥔 채 status()를 불러도 교착하지 않는다(송신은 상태 잠금 밖)
    let e = pending_env().await;
    let rx = e.svc.subscribe();
    let guard = rx.borrow();
    let svc = e.svc.clone();
    let publisher = std::thread::spawn(move || svc.cancel_login().phase);
    std::thread::sleep(std::time::Duration::from_millis(200));
    let (tx, got) = std::sync::mpsc::channel();
    let svc = e.svc.clone();
    std::thread::spawn(move || {
        let _ = tx.send(svc.status().phase);
    });
    let phase = got.recv_timeout(std::time::Duration::from_secs(5));
    drop(guard);
    assert_eq!(
        phase.expect("status()가 막혔다(교착)"),
        AuthPhase::SignedOut
    );
    assert_eq!(publisher.join().unwrap(), AuthPhase::SignedOut);
    assert_eq!(rx.borrow().phase, AuthPhase::SignedOut);
}

#[tokio::test(start_paused = true)]
async fn m8_publish_order_latest_wins() {
    // 잠금 밖 송신이어도 마지막 상태가 watch에 남는다
    let e = pending_env().await;
    let rx = e.svc.subscribe();
    e.svc.cancel_login();
    e.start_ok();
    e.svc.begin_login().await;
    assert_eq!(rx.borrow().phase, AuthPhase::Pending);
    assert_eq!(*rx.borrow(), e.svc.status());
}
