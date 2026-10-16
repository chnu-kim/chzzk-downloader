//! 맡은 채널 확인·편집자 API의 서비스 층 표(delegation.md §9.4·§14, app.md 구현 중 변경 79).
//!
//! 가짜 `WorkerApi`·`Clock`을 주입한다. 시각 기준 V = 2030-01-01T00:00:00Z.
//! 채널: 나 `CH`, 맡은 주인 `X`·`Y`, 다른 계정 `B`.

mod common;

use std::sync::Arc;

use chzzk_shell::auth::*;
use common::auth::*;
use time::{Duration, OffsetDateTime};
use tokio::sync::Notify;

type Svc = AuthService<FakeWorkerApi, FakeClock>;

const X: &str = "000000000000000000000000000000d4";
const Y: &str = "000000000000000000000000000000e5";
const Z: &str = "000000000000000000000000000000c3";
const B: &str = "000000000000000000000000000000b2";

/// 응답 유실이 이어질 때 갱신 한 번의 요청 수(첫 시도 + 즉시·10초·30초)
const ATTEMPTS: usize = 4;

fn h(n: i64) -> Duration {
    Duration::hours(n)
}
fn mins(n: i64) -> Duration {
    Duration::minutes(n)
}
fn acc(n: u32) -> String {
    tok("cda_", &format!("acc{n}"))
}

struct Env {
    dir: tempfile::TempDir,
    api: FakeWorkerApi,
    clock: FakeClock,
    grants: FakeGrantSource,
    svc: Arc<Svc>,
}

impl Env {
    fn build(dir: tempfile::TempDir, now: Duration) -> Self {
        let api = FakeWorkerApi::default();
        let clock = FakeClock::at(t0() + now);
        let grants = FakeGrantSource::default();
        let svc = Arc::new(service(dir.path(), &api, &clock, &grants));
        Self {
            dir,
            api,
            clock,
            grants,
            svc,
        }
    }

    /// V+1h, 디스크 세션(30일) + 디스크의 맡은 채널 목록. startup은 하지 않는다(낙관 SignedIn)
    fn disk(delegated: &[&str]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut s = stored(1, t0(), t0() + Duration::days(30));
        s.delegated_channels = delegated.iter().map(|d| delegated_channel(d)).collect();
        store(dir.path()).save(&s).unwrap();
        Self::build(dir, h(1))
    }

    /// 디스크 세션 없음
    fn signed_out() -> Self {
        Self::build(tempfile::tempdir().unwrap(), h(1))
    }

    /// 디스크 세션 + startup refresh가 `bundle_delegated(2, [delegated])`를 받아 온라인
    async fn online_with(delegated: &[&str]) -> Self {
        let e = Self::disk(&[]);
        e.api
            .push_refresh(Reply::Now(Ok(bundle_delegated(2, e.now(), delegated))));
        e.svc.startup().await;
        e
    }

    fn path(&self) -> &std::path::Path {
        self.dir.path()
    }

    fn now(&self) -> OffsetDateTime {
        self.clock.now()
    }

    fn me_ok(&self, delegated: &[&str]) {
        self.api.push_me(Reply::Now(Ok(me_ok(CH, delegated))));
    }

    fn delegated_now(&self) -> Vec<String> {
        self.svc.signer().unwrap().delegated.to_vec()
    }

    fn file_delegated(&self) -> serde_json::Value {
        read_session(self.path()).unwrap()["delegatedChannels"].clone()
    }

    fn file_exists(&self) -> bool {
        self.path().join("session.json").exists()
    }

    fn refresh_count(&self) -> usize {
        self.api.refresh_calls().len()
    }

    fn me_count(&self) -> usize {
        self.api.me_calls().len()
    }

    /// 응답 유실 재시도 묶음 전체가 연결 실패한다
    fn refresh_fail_all(&self) {
        for _ in 0..ATTEMPTS {
            self.api.push_refresh(Reply::Now(Err(transport())));
        }
    }
}

async fn wait_me_calls(e: &Env, n: usize) {
    while e.me_count() < n {
        tokio::task::yield_now().await;
    }
}

async fn settle() {
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }
}

fn fresh(c: &DelegationCheck) -> &MeResponse {
    match c {
        DelegationCheck::Fresh(m) => m,
        other => panic!("Fresh가 아님: {other:?}"),
    }
}

// ------------------------------------------------------------ 상태 읽기

#[tokio::test(start_paused = true)]
async fn s1_signer_reads_delegated_with_channel() {
    let e = Env::online_with(&[X]).await;
    assert_eq!(e.delegated_now(), vec![X.to_string()]);
    let st = e.svc.status();
    assert_eq!(st.delegated_channels, vec![delegated_channel(X)]);
    assert!(st.delegations_verified);
}

#[tokio::test(start_paused = true)]
async fn s2_disk_list_counts_while_optimistic() {
    let e = Env::disk(&[X]);
    assert_eq!(e.delegated_now(), vec![X.to_string()]);
    assert!(!e.svc.status().delegations_verified);
}

// ------------------------------------------------------------ 간격

#[tokio::test(start_paused = true)]
async fn s3_first_check_always_sends() {
    let e = Env::online_with(&[X]).await;
    e.me_ok(&[X]);
    let c = e.svc.check_delegations(false).await;
    fresh(&c);
    // startup refresh가 있었어도 앱을 켠 뒤 첫 판정은 /api/me를 보낸다
    assert_eq!(e.me_count(), 1);
}

#[tokio::test(start_paused = true)]
async fn s4_auto_gap_skips_then_sends() {
    let e = Env::online_with(&[X]).await;
    e.me_ok(&[X]);
    e.me_ok(&[X]);
    fresh(&e.svc.check_delegations(false).await);
    assert_eq!(
        e.svc.check_delegations(false).await,
        DelegationCheck::Skipped
    );
    assert_eq!(e.me_count(), 1);
    e.clock.advance(mins(5));
    fresh(&e.svc.check_delegations(false).await);
    assert_eq!(e.me_count(), 2);
}

#[tokio::test(start_paused = true)]
async fn s5_forced_ignores_gap() {
    let e = Env::online_with(&[X]).await;
    e.me_ok(&[X]);
    e.me_ok(&[X]);
    fresh(&e.svc.check_delegations(false).await);
    fresh(&e.svc.check_delegations(true).await);
    assert_eq!(e.me_count(), 2);
}

#[tokio::test(start_paused = true)]
async fn s6_clock_rollback_counts_as_due() {
    let e = Env::online_with(&[X]).await;
    e.me_ok(&[X]);
    e.me_ok(&[X]);
    fresh(&e.svc.check_delegations(false).await);
    e.clock.advance(-mins(10));
    fresh(&e.svc.check_delegations(false).await);
    assert_eq!(e.me_count(), 2);
}

#[tokio::test(start_paused = true)]
async fn s7_offline_skips_auto_but_not_forced() {
    let e = Env::disk(&[X]);
    e.refresh_fail_all();
    let st = e.svc.startup().await;
    assert!(st.offline.is_some());
    assert_eq!(
        e.svc.check_delegations(false).await,
        DelegationCheck::Skipped
    );
    assert_eq!(e.me_count(), 0);
    e.me_ok(&[X]);
    fresh(&e.svc.check_delegations(true).await);
    assert_eq!(e.me_count(), 1);
}

// ------------------------------------------------------------ 결과 적용

#[tokio::test(start_paused = true)]
async fn s8_network_failure_changes_nothing() {
    let e = Env::online_with(&[X]).await;
    let before = read_session(e.path());
    e.api.push_me(Reply::Now(Err(transport())));
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Unreachable
    );
    let st = e.svc.status();
    assert_eq!(st.phase, AuthPhase::SignedIn);
    assert!(st.offline.is_none());
    assert_eq!(read_session(e.path()), before);
    assert_eq!(e.delegated_now(), vec![X.to_string()]);
}

#[tokio::test(start_paused = true)]
async fn s9_success_replaces_list_and_writes_file() {
    let e = Env::online_with(&[X]).await;
    e.clock.advance(h(1));
    e.me_ok(&[Y]);
    let c = e.svc.check_delegations(true).await;
    fresh(&c);
    assert_eq!(e.delegated_now(), vec![Y.to_string()]);
    assert_eq!(
        e.file_delegated(),
        serde_json::json!([{"channelId": Y, "channelName": "맡은채널"}])
    );
    assert_eq!(e.svc.status().delegations_checked_at, Some(e.now()));
}

#[tokio::test(start_paused = true)]
async fn s10_channel_mismatch_is_discarded() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Ok(me_ok(B, &[Y]))));
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Discarded
    );
    assert_eq!(e.delegated_now(), vec![X.to_string()]);
}

// ------------------------------------------------------------ single-flight

#[tokio::test(start_paused = true)]
async fn s11_auto_single_flight() {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    e.api.push_me(Reply::Hold(n.clone(), Ok(me_ok(CH, &[X]))));
    let a = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(false).await }
    });
    wait_me_calls(&e, 1).await;
    let b = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(false).await }
    });
    settle().await;
    n.notify_one();
    let (a, b) = (a.await.unwrap(), b.await.unwrap());
    fresh(&a);
    fresh(&b);
    assert_eq!(e.me_count(), 1);
}

#[tokio::test(start_paused = true)]
async fn s12_forced_after_inflight_sends_again() {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    e.api.push_me(Reply::Hold(n.clone(), Ok(me_ok(CH, &[X]))));
    e.me_ok(&[X]);
    let a = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(false).await }
    });
    wait_me_calls(&e, 1).await;
    let b = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    settle().await;
    n.notify_one();
    fresh(&a.await.unwrap());
    fresh(&b.await.unwrap());
    assert_eq!(e.me_count(), 2);
}

#[tokio::test(start_paused = true)]
async fn s13_me_reads_access_after_lock() {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    e.api
        .push_refresh(Reply::Hold(n.clone(), Ok(bundle(3, e.now()))));
    e.me_ok(&[X]);
    let r = tokio::spawn({
        let s = e.svc.clone();
        async move { s.refresh().await }
    });
    while e.refresh_count() < 2 {
        tokio::task::yield_now().await;
    }
    let c = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    settle().await;
    assert_eq!(e.me_count(), 0, "refresh가 끝나기 전에는 보내지 않는다");
    n.notify_one();
    r.await.unwrap();
    fresh(&c.await.unwrap());
    // 기다리는 동안 회전한 access를 쓴다: invalid_token 고리가 없다
    assert_eq!(e.api.me_calls(), vec![acc(3)]);
}

#[tokio::test(start_paused = true)]
async fn s14_me_does_not_bump_refresh_gen() {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    e.api.push_me(Reply::Hold(n.clone(), Ok(me_ok(CH, &[X]))));
    e.api.push_refresh(Reply::Now(Ok(bundle(3, e.now()))));
    let c = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    wait_me_calls(&e, 1).await;
    let before = e.refresh_count();
    let r = tokio::spawn({
        let s = e.svc.clone();
        async move { s.refresh().await }
    });
    settle().await;
    n.notify_one();
    fresh(&c.await.unwrap());
    r.await.unwrap();
    // me가 refresh_gen을 올렸다면 refresh는 "다른 호출이 방금 끝냈다"고 보고 보내지 않는다
    assert_eq!(e.refresh_count(), before + 1);
}

// ------------------------------------------------------------ 실패 뒤 간격

/// 자동 확인이 실패해도(5xx·연결 실패·계정 불일치) 간격이 시작된다: 판정마다 /api/me를 다시 보내지 않는다.
/// 수동은 그대로 보내고, 간격이 지나면 자동도 다시 보낸다
#[tokio::test(start_paused = true)]
async fn s15_auto_failure_starts_gap() {
    for fail in [
        Err(worker(503, "unavailable")),
        Err(transport()),
        Ok(me_ok(B, &[Y])),
    ] {
        let e = Env::online_with(&[X]).await;
        let want = if fail.is_ok() {
            DelegationCheck::Discarded
        } else {
            DelegationCheck::Unreachable
        };
        e.api.push_me(Reply::Now(fail));
        assert_eq!(e.svc.check_delegations(false).await, want);
        assert_eq!(
            e.svc.check_delegations(false).await,
            DelegationCheck::Skipped
        );
        assert_eq!(e.me_count(), 1);
        e.me_ok(&[X]);
        fresh(&e.svc.check_delegations(true).await);
        assert_eq!(e.me_count(), 2);
        e.clock.advance(mins(5));
        e.me_ok(&[X]);
        fresh(&e.svc.check_delegations(false).await);
        assert_eq!(e.me_count(), 3);
    }
}

/// 재전송도 (차단이 아닌) 401이면 다음 자동 확인은 건너뛴다: 판정마다 refresh(토큰 회전)를 되풀이하지 않는다.
/// 재전송의 invalid_token은 이제 차단이라(n1_6) 상태를 바꾸지 않는 모르는 코드로 본다
#[tokio::test(start_paused = true)]
async fn s16_resend_401_does_not_repeat_refresh() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api.push_refresh(Reply::Now(Ok(bundle(3, e.now()))));
    e.api.push_me(Reply::Now(Err(worker(401, "unknown_code"))));
    assert_eq!(
        e.svc.check_delegations(false).await,
        DelegationCheck::Unreachable
    );
    let (me, refresh) = (e.me_count(), e.refresh_count());
    assert_eq!(me, 2);
    for _ in 0..3 {
        assert_eq!(
            e.svc.check_delegations(false).await,
            DelegationCheck::Skipped
        );
    }
    assert_eq!(e.me_count(), me);
    assert_eq!(e.refresh_count(), refresh);
}

/// 자동 확인 둘이 겹치고 앞 호출이 실패하면 뒤 호출은 다시 보내지 않는다(실패도 single-flight)
#[tokio::test(start_paused = true)]
async fn s17_auto_single_flight_on_failure() {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    e.api
        .push_me(Reply::Hold(n.clone(), Err(worker(503, "unavailable"))));
    let a = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(false).await }
    });
    wait_me_calls(&e, 1).await;
    let b = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(false).await }
    });
    settle().await;
    n.notify_one();
    assert_eq!(a.await.unwrap(), DelegationCheck::Unreachable);
    assert_eq!(b.await.unwrap(), DelegationCheck::Skipped);
    assert_eq!(e.me_count(), 1);
}

/// 계정이 바뀌면 앞 계정의 실패 간격은 새 계정에 남지 않는다
#[tokio::test(start_paused = true)]
async fn s18_failure_gap_resets_on_account_switch() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(503, "unavailable"))));
    assert_eq!(
        e.svc.check_delegations(false).await,
        DelegationCheck::Unreachable
    );
    switch_to_b(&e).await;
    e.api.push_me(Reply::Now(Ok(me_ok(B, &[Z]))));
    fresh(&e.svc.check_delegations(false).await);
    assert_eq!(e.me_count(), 2);
}

// ------------------------------------------------------------ N1 거부 전이

#[tokio::test(start_paused = true)]
async fn n1_1_me_not_allowed_denies_without_refresh() {
    let e = Env::online_with(&[X]).await;
    let before = e.refresh_count();
    e.api.push_me(Reply::Now(Err(worker(403, "not_allowed"))));
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Blocked
    );
    let st = e.svc.status();
    assert_eq!(st.phase, AuthPhase::Denied);
    assert_eq!(st.reason, Some(AuthReason::RemovedFromAllowlist));
    assert!(!e.file_exists());
    assert_eq!(e.refresh_count(), before);
    assert!(e.svc.signer().is_none());
}

#[tokio::test(start_paused = true)]
async fn n1_2_me_session_revoked_expires_without_refresh() {
    let e = Env::online_with(&[X]).await;
    let before = e.refresh_count();
    e.api
        .push_me(Reply::Now(Err(worker(401, "session_revoked"))));
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Blocked
    );
    let st = e.svc.status();
    assert_eq!(st.phase, AuthPhase::Expired);
    assert_eq!(st.reason, Some(AuthReason::Revoked));
    assert!(!e.file_exists());
    assert_eq!(e.refresh_count(), before);
}

#[tokio::test(start_paused = true)]
async fn n1_3a_me_invalid_token_refreshes_then_resends() {
    let e = Env::online_with(&[X]).await;
    let before = e.refresh_count();
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api
        .push_refresh(Reply::Now(Ok(bundle_delegated(3, e.now(), &[Y]))));
    e.me_ok(&[Y]);
    let c = e.svc.check_delegations(true).await;
    fresh(&c);
    assert_eq!(e.refresh_count(), before + 1);
    assert_eq!(e.api.me_calls(), vec![acc(2), acc(3)]);
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
    assert_eq!(e.delegated_now(), vec![Y.to_string()]);
}

#[tokio::test(start_paused = true)]
async fn n1_3b_me_invalid_token_then_refresh_denied() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api
        .push_refresh(Reply::Now(Err(worker(403, "not_allowed"))));
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Blocked
    );
    assert_eq!(e.svc.status().phase, AuthPhase::Denied);
}

#[tokio::test(start_paused = true)]
async fn n1_3c_me_invalid_token_then_refresh_offline() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.refresh_fail_all();
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Unreachable
    );
    let st = e.svc.status();
    assert_eq!(st.phase, AuthPhase::SignedIn);
    assert!(st.offline.is_some());
    // 오프라인 유예 중에도 디스크 목록 그대로 판정한다(신뢰 수준 (b))
    assert_eq!(e.delegated_now(), vec![X.to_string()]);
}

#[tokio::test(start_paused = true)]
async fn n1_4_access_expired_me_is_not_logout() {
    let e = Env::online_with(&[X]).await;
    e.clock.advance(h(24));
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api.push_refresh(Reply::Now(Ok(bundle(3, e.now()))));
    e.me_ok(&[X]);
    fresh(&e.svc.check_delegations(false).await);
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
    assert!(e.file_exists());
}

/// Codex 재현 2(PR 리뷰 P1): 형식 있는 세션 거부(`session_expired`)는 refresh의 네트워크 실패로 유예가 되지 않는다.
/// ROADMAP "Worker의 형식 있는 401·403은 즉시 차단": refresh를 보내지 않고 바로 Expired(SessionExpired, 파일 삭제)
#[tokio::test(start_paused = true)]
async fn n1_5_me_session_expired_blocks_without_refresh() {
    let e = Env::online_with(&[X]).await;
    let before = e.refresh_count();
    e.api
        .push_me(Reply::Now(Err(worker(401, "session_expired"))));
    // 예전 코드는 여기서 refresh를 보냈고, 연결 실패로 오프라인 SignedIn이 남았다
    e.refresh_fail_all();
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Blocked
    );
    let st = e.svc.status();
    assert_eq!(st.phase, AuthPhase::Expired);
    assert_eq!(st.reason, Some(AuthReason::SessionExpired));
    assert!(!e.file_exists());
    assert_eq!(e.refresh_count(), before);
    assert!(
        e.svc.signer().is_none(),
        "맡은 채널 X로 새 작업을 받지 않는다"
    );
}

/// 모르는 401 코드는 refresh 쪽 표(`outcome_of_error`)처럼 형식 거부로 보지 않는다: refresh 한 번으로 서버에 다시 묻는다
#[tokio::test(start_paused = true)]
async fn n1_5b_me_unknown_401_code_needs_refresh() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(401, "unknown_code"))));
    e.api.push_refresh(Reply::Now(Ok(bundle(3, e.now()))));
    e.me_ok(&[X]);
    fresh(&e.svc.check_delegations(true).await);
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
}

/// 재전송도 invalid_token: 방금 성공한 refresh가 준 access를 서버가 거부했다 = 세션이 이미 끝났다.
/// refresh 표의 invalid_token과 같이 Expired(SessionExpired, 파일 삭제)다(예전: 로그아웃 없이 Unreachable)
#[tokio::test(start_paused = true)]
async fn n1_6_resend_invalid_token_blocks() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api.push_refresh(Reply::Now(Ok(bundle(3, e.now()))));
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Blocked
    );
    let st = e.svc.status();
    assert_eq!(st.phase, AuthPhase::Expired);
    assert_eq!(st.reason, Some(AuthReason::SessionExpired));
    assert!(!e.file_exists());
}

/// 재전송의 401도 그 코드의 분류대로: session_revoked → Expired(Revoked), 모르는 코드 → 상태 불변(refresh 표의 Transient)
#[tokio::test(start_paused = true)]
async fn n1_6b_resend_401_follows_its_code() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api.push_refresh(Reply::Now(Ok(bundle(3, e.now()))));
    e.api.push_me(Reply::Now(Err(worker(401, "unknown_code"))));
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Unreachable
    );
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
    assert!(e.file_exists());

    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api.push_refresh(Reply::Now(Ok(bundle(3, e.now()))));
    e.api
        .push_me(Reply::Now(Err(worker(401, "session_revoked"))));
    assert_eq!(
        e.svc.check_delegations(true).await,
        DelegationCheck::Blocked
    );
    let st = e.svc.status();
    assert_eq!(st.phase, AuthPhase::Expired);
    assert_eq!(st.reason, Some(AuthReason::Revoked));
    assert!(!e.file_exists());
}

/// 쓰기 API도 같은 표다: session_expired는 refresh 없이 차단
#[tokio::test(start_paused = true)]
async fn n1_8_write_session_expired_blocks() {
    let e = Env::online_with(&[X]).await;
    let before = e.refresh_count();
    e.api
        .push_remove(Reply::Now(Err(worker(401, "session_expired"))));
    e.refresh_fail_all();
    assert_eq!(e.svc.remove_editor(Y).await, Err(EditorsError::Blocked));
    assert_eq!(e.svc.status().phase, AuthPhase::Expired);
    assert_eq!(e.refresh_count(), before);
}

#[tokio::test(start_paused = true)]
async fn n1_7_invalid_token_path_terminates() {
    let e = Env::online_with(&[X]).await;
    e.api.push_me(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api
        .push_refresh(Reply::Now(Ok(bundle_delegated(3, e.now(), &[Y]))));
    e.me_ok(&[Y]);
    let c = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        e.svc.check_delegations(true),
    )
    .await
    .expect("멈추지 않는다");
    fresh(&c);
}

// ------------------------------------------------------------ N2 순서

/// 이 테스트가 잠금 쪽에서 고정하는 것은 순서다: me가 refresh_lock을 쥐는 동안 refresh는 me 응답 전에 나가지 않는다
/// (중간 단언). 끝 상태(늦은 me가 빈 목록을 덮지 않음)는 잠금이 없어도 refresh_gen 비교가 늦은 me를 버려 녹색이다:
/// 덮어쓰기는 세대 검사와 잠금 두 겹으로 막고, 잠금만의 몫은 순서와 회전 뒤 access 읽기(s13)다
#[tokio::test(start_paused = true)]
async fn n2_late_me_does_not_overwrite_revocation() {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    // 서버는 회수 전에 이 응답을 처리했다
    e.api.push_me(Reply::Hold(n.clone(), Ok(me_ok(CH, &[X]))));
    let c = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    wait_me_calls(&e, 1).await;
    // 회수 뒤의 refresh 묶음은 빈 목록
    e.api
        .push_refresh(Reply::Now(Ok(bundle_delegated(3, e.now(), &[]))));
    let startup_refreshes = e.refresh_count();
    let r = tokio::spawn({
        let s = e.svc.clone();
        async move { s.refresh().await }
    });
    settle().await;
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    assert_eq!(
        e.refresh_count(),
        startup_refreshes,
        "me가 refresh_lock을 쥐고 있으니 refresh는 아직 나가지 못한다"
    );
    n.notify_one();
    fresh(&c.await.unwrap());
    r.await.unwrap();
    assert_eq!(e.refresh_count(), startup_refreshes + 1);
    // 늦은 me 응답이 뒤 refresh의 빈 목록을 덮지 못한다(세대 검사로도 막힌다)
    assert!(e.delegated_now().is_empty());
    assert_eq!(e.file_delegated(), serde_json::json!([]));
}

// ------------------------------------------------------------ E 세대

/// A 계정을 로그아웃하고 B 계정으로 로그인한다(묶음의 맡은 채널은 [Z])
async fn switch_to_b(e: &Env) {
    e.api.push_logout(Reply::Now(Ok(())));
    e.svc.logout().await.unwrap();
    e.api.push_start(Reply::Now(Ok(start_ok(&base()))));
    assert!(matches!(e.svc.begin_login().await, BeginLogin::Started(_)));
    let mut b = bundle_delegated(5, e.now(), &[Z]);
    b.channel_id = B.to_string();
    e.api.push_redeem(Reply::Now(Ok(RedeemResponse::Ok(b))));
    let page = e.grants.deliver(&grant_str());
    e.svc.run_login_wait().await;
    page.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn e1_late_me_of_old_account_is_discarded() {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    e.api.push_me(Reply::Hold(n.clone(), Ok(me_ok(CH, &[Y]))));
    let c = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    wait_me_calls(&e, 1).await;
    switch_to_b(&e).await;
    n.notify_one();
    assert_eq!(c.await.unwrap(), DelegationCheck::Discarded);
    let sg = e.svc.signer().unwrap();
    assert_eq!(sg.channel_id, B);
    assert_eq!(sg.delegated.to_vec(), vec![Z.to_string()]);
    assert_eq!(
        e.file_delegated(),
        serde_json::json!([{"channelId": Z, "channelName": "맡은채널"}])
    );
    let st = e.svc.status();
    assert_eq!(st.delegations_checked_at, st.verified_at);
}

#[tokio::test(start_paused = true)]
async fn e2_late_denial_of_old_account_keeps_new_signed_in() {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    e.api
        .push_me(Reply::Hold(n.clone(), Err(worker(403, "not_allowed"))));
    let c = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    wait_me_calls(&e, 1).await;
    switch_to_b(&e).await;
    n.notify_one();
    assert_eq!(c.await.unwrap(), DelegationCheck::Discarded);
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
    assert!(e.file_exists());
}

// ------------------------------------------------------------ 편집자 쓰기 API

#[tokio::test(start_paused = true)]
async fn w1_invite_ok_returns_url() {
    let e = Env::online_with(&[]).await;
    e.api.push_invite(Reply::Now(Ok(invite_ok("one"))));
    let r = e.svc.create_invite().await.unwrap();
    assert!(r.invite_url.expose().starts_with(ORIGIN));
    assert_eq!(
        e.api
            .count(|c| matches!(c, Call::CreateInvite { access } if *access == acc(2))),
        1
    );
}

#[tokio::test(start_paused = true)]
async fn w2_invite_invalid_token_refresh_retry() {
    let e = Env::online_with(&[]).await;
    let before = e.refresh_count();
    e.api
        .push_invite(Reply::Now(Err(worker(401, "invalid_token"))));
    e.api.push_refresh(Reply::Now(Ok(bundle(3, e.now()))));
    e.api.push_invite(Reply::Now(Ok(invite_ok("two"))));
    e.svc.create_invite().await.unwrap();
    assert_eq!(e.refresh_count(), before + 1);
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
}

#[tokio::test(start_paused = true)]
async fn w3_invite_not_allowed_denies() {
    let e = Env::online_with(&[]).await;
    e.api
        .push_invite(Reply::Now(Err(worker(403, "not_allowed"))));
    assert_eq!(
        e.svc.create_invite().await.unwrap_err(),
        EditorsError::Blocked
    );
    assert_eq!(e.svc.status().phase, AuthPhase::Denied);
}

#[tokio::test(start_paused = true)]
async fn w4_not_enabled_is_not_a_block() {
    let e = Env::online_with(&[X]).await;
    let before = e.refresh_count();
    let file = read_session(e.path());
    e.api
        .push_invite(Reply::Now(Err(worker(404, "not_enabled"))));
    e.api
        .push_remove(Reply::Now(Err(worker(404, "not_enabled"))));
    e.api
        .push_leave(Reply::Now(Err(worker(404, "not_enabled"))));
    assert_eq!(
        e.svc.create_invite().await.unwrap_err(),
        EditorsError::NotEnabled
    );
    assert_eq!(
        e.svc.remove_editor(Y).await.unwrap_err(),
        EditorsError::NotEnabled
    );
    assert_eq!(
        e.svc.leave_delegation(X).await.unwrap_err(),
        EditorsError::NotEnabled
    );
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
    assert_eq!(read_session(e.path()), file);
    assert_eq!(e.refresh_count(), before);
}

#[tokio::test(start_paused = true)]
async fn w5_invite_limit() {
    let e = Env::online_with(&[]).await;
    e.api.push_invite(Reply::Now(Err(worker(409, "limit"))));
    assert_eq!(
        e.svc.create_invite().await.unwrap_err(),
        EditorsError::Limit
    );
}

/// 편집자 목록에 `editors`가 있는 `/api/me`
fn me_with_editors(e: &Env, delegated: &[&str], editors: &[&str]) -> MeResponse {
    let mut m = me_ok(CH, delegated);
    m.editors = editors
        .iter()
        .map(|id| EditorEntry {
            channel_id: id.to_string(),
            channel_name: "편집자".into(),
            since: e.now(),
            status: EditorStatus::Active,
        })
        .collect();
    m
}

/// 404 `not_found`는 같은 access의 `/api/me`가 대상이 없다고 확인할 때만 멱등 성공이다(Codex 확인 2, 79 (하))
#[tokio::test(start_paused = true)]
async fn w6_not_found_is_ok_only_when_me_confirms_absent() {
    let e = Env::online_with(&[X]).await;
    let me0 = e.me_count();
    e.api.push_remove(Reply::Now(Err(worker(404, "not_found"))));
    e.api
        .push_me(Reply::Now(Ok(me_with_editors(&e, &[X], &[Z]))));
    e.svc.remove_editor(Y).await.unwrap();
    e.api.push_leave(Reply::Now(Err(worker(404, "not_found"))));
    e.me_ok(&[]);
    e.svc.leave_delegation(X).await.unwrap();
    assert!(e.delegated_now().is_empty());
    assert_eq!(e.file_delegated(), serde_json::json!([]));
    // 확인은 쓰기와 같은 access(같은 세션)로 나갔다
    assert_eq!(e.api.me_calls()[me0..], [acc(2), acc(2)]);
    // 초대에는 멱등 not_found가 없다: 경로 표 밖 404라 아직 안 열린 것이다
    e.api.push_invite(Reply::Now(Err(worker(404, "not_found"))));
    assert_eq!(
        e.svc.create_invite().await.unwrap_err(),
        EditorsError::NotEnabled
    );
}

/// 경로가 없는 Worker(①-2만, `routes.ts` 경로 표 밖 404 `not_found`): 대상이 `/api/me`에 남아 있으면 성공이 아니라
/// NotEnabled이고, 그만두기는 로컬 목록을 건드리지 않는다(다음 refresh 묶음이 되살리는 거짓 성공을 막는다)
#[tokio::test(start_paused = true)]
async fn w10_not_found_while_still_listed_is_not_enabled() {
    let e = Env::online_with(&[X]).await;
    e.me_ok(&[X]);
    fresh(&e.svc.check_delegations(true).await);
    let before = e.refresh_count();
    let file = read_session(e.path());
    e.api.push_remove(Reply::Now(Err(worker(404, "not_found"))));
    e.api.push_me(Reply::Now(Ok(me_with_editors(
        &e,
        &[X],
        &[&Y.to_ascii_uppercase()],
    ))));
    assert_eq!(
        e.svc.remove_editor(Y).await.unwrap_err(),
        EditorsError::NotEnabled
    );
    e.api.push_leave(Reply::Now(Err(worker(404, "not_found"))));
    e.me_ok(&[X]);
    assert_eq!(
        e.svc.leave_delegation(X).await.unwrap_err(),
        EditorsError::NotEnabled
    );
    assert_eq!(e.delegated_now(), vec![X.to_string()]);
    assert_eq!(read_session(e.path()), file);
    assert_eq!(e.svc.status().delegated_channels.len(), 1);
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
    assert_eq!(e.refresh_count(), before);
}

/// 확인 `/api/me`가 실패하거나 다른 계정을 말하면 성공이 아니다(로컬 목록 그대로)
#[tokio::test(start_paused = true)]
async fn w11_unconfirmed_not_found_is_unreachable() {
    let e = Env::online_with(&[X]).await;
    // 확인 me 줄이 비어 있다 → 연결 실패
    e.api.push_leave(Reply::Now(Err(worker(404, "not_found"))));
    assert_eq!(
        e.svc.leave_delegation(X).await.unwrap_err(),
        EditorsError::Unreachable
    );
    e.api.push_leave(Reply::Now(Err(worker(404, "not_found"))));
    e.api.push_me(Reply::Now(Ok(me_ok(B, &[]))));
    assert_eq!(
        e.svc.leave_delegation(X).await.unwrap_err(),
        EditorsError::Unreachable
    );
    e.api.push_remove(Reply::Now(Err(worker(404, "not_found"))));
    e.api.push_me(Reply::Now(Ok(me_ok(B, &[]))));
    assert_eq!(
        e.svc.remove_editor(Y).await.unwrap_err(),
        EditorsError::Unreachable
    );
    assert_eq!(e.delegated_now(), vec![X.to_string()]);
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
}

#[tokio::test(start_paused = true)]
async fn w7_remove_sends_editor_id_leave_sends_owner_id() {
    let e = Env::online_with(&[X]).await;
    e.api.push_remove(Reply::Now(Ok(())));
    e.api.push_leave(Reply::Now(Ok(())));
    e.svc.remove_editor(Y).await.unwrap();
    e.svc.leave_delegation(X).await.unwrap();
    let calls = e.api.calls();
    assert!(calls.contains(&Call::RemoveEditor {
        access: acc(2),
        channel: Y.into()
    }));
    assert!(calls.contains(&Call::LeaveDelegation {
        access: acc(2),
        channel: X.into()
    }));
}

#[tokio::test(start_paused = true)]
async fn w8_writes_need_sign_in() {
    let e = Env::signed_out();
    assert_eq!(
        e.svc.create_invite().await.unwrap_err(),
        EditorsError::NotSignedIn
    );
    assert_eq!(
        e.svc.remove_editor(Y).await.unwrap_err(),
        EditorsError::NotSignedIn
    );
    assert_eq!(
        e.svc.leave_delegation(X).await.unwrap_err(),
        EditorsError::NotSignedIn
    );
    assert!(e.api.calls().is_empty());
}

#[tokio::test(start_paused = true)]
async fn w9_server_trouble_is_unreachable() {
    let e = Env::online_with(&[]).await;
    e.api.push_invite(Reply::Now(Err(worker(503, "internal"))));
    e.api.push_remove(Reply::Now(Err(transport())));
    e.api
        .push_leave(Reply::Now(Err(worker(400, "bad_request"))));
    assert_eq!(
        e.svc.create_invite().await.unwrap_err(),
        EditorsError::Unreachable
    );
    assert_eq!(
        e.svc.remove_editor(Y).await.unwrap_err(),
        EditorsError::Unreachable
    );
    assert_eq!(
        e.svc.leave_delegation(X).await.unwrap_err(),
        EditorsError::Rejected
    );
    assert_eq!(e.svc.status().phase, AuthPhase::SignedIn);
}

// ------------------------------------------------------------ X 쓰기는 시작한 계정에 묶인다(PR 리뷰 P1)

/// 편집자 쓰기 셋
#[derive(Clone, Copy, Debug)]
enum Write {
    Invite,
    Remove,
    Leave,
}

impl Write {
    fn push_ok(self, e: &Env) {
        match self {
            Write::Invite => e.api.push_invite(Reply::Now(Ok(invite_ok("x")))),
            Write::Remove => e.api.push_remove(Reply::Now(Ok(()))),
            Write::Leave => e.api.push_leave(Reply::Now(Ok(()))),
        }
    }

    async fn run(self, s: Arc<Svc>) -> Result<(), EditorsError> {
        match self {
            Write::Invite => s.create_invite().await.map(|_| ()),
            Write::Remove => s.remove_editor(Y).await,
            Write::Leave => s.leave_delegation(X).await,
        }
    }

    fn sent(self, e: &Env) -> usize {
        e.api.count(|c| match self {
            Write::Invite => matches!(c, Call::CreateInvite { .. }),
            Write::Remove => matches!(c, Call::RemoveEditor { .. }),
            Write::Leave => matches!(c, Call::LeaveDelegation { .. }),
        })
    }
}

/// Codex 재현 1~6: A의 `/api/me`가 refresh_lock을 쥔 동안 A에서 쓰기를 부르고, A를 로그아웃해 B로 로그인한 뒤
/// me를 풀어 준다. 쓰기는 B의 토큰으로 나가면 안 된다(보내지 않고 버린다)
async fn write_queued_across_switch(w: Write) {
    let e = Env::online_with(&[X]).await;
    let n = Arc::new(Notify::new());
    e.api.push_me(Reply::Hold(n.clone(), Ok(me_ok(CH, &[X]))));
    let c = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    wait_me_calls(&e, 1).await;
    let wr = tokio::spawn(w.run(e.svc.clone()));
    settle().await;
    switch_to_b(&e).await;
    // 오늘 코드가 B의 토큰으로 보냈다면 이 응답을 받아 성공했을 것이다
    w.push_ok(&e);
    n.notify_one();
    assert_eq!(c.await.unwrap(), DelegationCheck::Discarded);
    assert_eq!(wr.await.unwrap(), Err(EditorsError::Discarded), "{w:?}");
    assert_eq!(w.sent(&e), 0, "{w:?}: B 계정으로 나가면 안 된다");
    // B 계정은 그대로다
    let sg = e.svc.signer().unwrap();
    assert_eq!(sg.channel_id, B);
    assert_eq!(sg.delegated.to_vec(), vec![Z.to_string()]);
}

#[tokio::test(start_paused = true)]
async fn x1_remove_queued_across_switch_is_not_sent() {
    write_queued_across_switch(Write::Remove).await;
}

#[tokio::test(start_paused = true)]
async fn x2_invite_queued_across_switch_is_not_sent() {
    write_queued_across_switch(Write::Invite).await;
}

#[tokio::test(start_paused = true)]
async fn x3_leave_queued_across_switch_is_not_sent() {
    write_queued_across_switch(Write::Leave).await;
}

/// 재전송 직전: 첫 시도가 401 invalid_token → refresh 성공 → 재전송이 잠금을 다시 기다리는 동안 계정이 바뀌면 보내지 않는다
#[tokio::test(start_paused = true)]
async fn x4_resend_after_refresh_is_bound_to_initiating_account() {
    let e = Env::online_with(&[X]).await;
    e.api
        .push_remove(Reply::Now(Err(worker(401, "invalid_token"))));
    let r = Arc::new(Notify::new());
    e.api.push_refresh(Reply::Hold(
        r.clone(),
        Ok(bundle_delegated(3, e.now(), &[X])),
    ));
    let before = e.refresh_count();
    let wr = tokio::spawn(Write::Remove.run(e.svc.clone()));
    while e.refresh_count() == before {
        tokio::task::yield_now().await;
    }
    // refresh가 잠금을 쥔 동안 me가 그 뒤에 줄 선다(재전송보다 먼저 잠금을 얻는다)
    let m = Arc::new(Notify::new());
    e.api.push_me(Reply::Hold(m.clone(), Ok(me_ok(CH, &[X]))));
    let me_before = e.me_count();
    let c = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    settle().await;
    r.notify_one();
    wait_me_calls(&e, me_before + 1).await;
    // 재전송은 잠금을 기다리는 중이다. 이제 B로 바꾼다
    switch_to_b(&e).await;
    e.api.push_remove(Reply::Now(Ok(())));
    m.notify_one();
    assert_eq!(c.await.unwrap(), DelegationCheck::Discarded);
    assert_eq!(wr.await.unwrap(), Err(EditorsError::Discarded));
    assert_eq!(Write::Remove.sent(&e), 1, "첫 시도(A)만 나갔다");
    assert!(!e.api.calls().contains(&Call::RemoveEditor {
        access: acc(5),
        channel: Y.into()
    }));
}

/// 첫 시도 401 뒤 refresh가 잠금을 기다리는 동안 A→B로 바뀌면 B의 refresh 토큰으로 회전하지 않는다(Codex 확인 5)
#[tokio::test(start_paused = true)]
async fn x5_refresh_after_401_is_bound_to_initiating_account() {
    let e = Env::online_with(&[X]).await;
    let w = Arc::new(Notify::new());
    e.api
        .push_remove(Reply::Hold(w.clone(), Err(worker(401, "invalid_token"))));
    let wr = tokio::spawn(Write::Remove.run(e.svc.clone()));
    while Write::Remove.sent(&e) == 0 {
        tokio::task::yield_now().await;
    }
    // 쓰기가 잠금을 쥔 동안 me가 줄 선다: 401 뒤 refresh는 me 다음으로 잠금을 기다린다
    let m = Arc::new(Notify::new());
    e.api.push_me(Reply::Hold(m.clone(), Ok(me_ok(CH, &[X]))));
    let me_before = e.me_count();
    let c = tokio::spawn({
        let s = e.svc.clone();
        async move { s.check_delegations(true).await }
    });
    settle().await;
    w.notify_one();
    wait_me_calls(&e, me_before + 1).await;
    settle().await;
    let before = e.refresh_count();
    switch_to_b(&e).await;
    // 오늘 코드가 B로 회전했다면 이 응답을 받았을 것이다
    e.api
        .push_refresh(Reply::Now(Ok(bundle_delegated(6, e.now(), &[Z]))));
    m.notify_one();
    assert_eq!(c.await.unwrap(), DelegationCheck::Discarded);
    assert_eq!(wr.await.unwrap(), Err(EditorsError::Discarded));
    assert_eq!(e.refresh_count(), before, "B의 refresh가 나가면 안 된다");
    let sg = e.svc.signer().unwrap();
    assert_eq!(sg.channel_id, B);
    assert_eq!(sg.delegated.to_vec(), vec![Z.to_string()]);
}

/// 그만두기 404 뒤 확인 `/api/me`를 기다리는 동안 A→B로 바뀌면 버리고 B의 목록을 건드리지 않는다
#[tokio::test(start_paused = true)]
async fn x6_confirm_me_across_switch_is_discarded() {
    let e = Env::online_with(&[X]).await;
    e.api.push_leave(Reply::Now(Err(worker(404, "not_found"))));
    let m = Arc::new(Notify::new());
    e.api.push_me(Reply::Hold(m.clone(), Ok(me_ok(CH, &[]))));
    let me_before = e.me_count();
    let wr = tokio::spawn({
        let s = e.svc.clone();
        async move { s.leave_delegation(Z).await }
    });
    // 확인 me가 나가지 않는 구현이면 여기서 멈추지 않고 실패한다
    for _ in 0..1000 {
        if e.me_count() > me_before {
            break;
        }
        tokio::task::yield_now().await;
    }
    assert_eq!(
        e.me_count(),
        me_before + 1,
        "404 뒤 확인 /api/me가 나가야 한다"
    );
    switch_to_b(&e).await;
    m.notify_one();
    assert_eq!(wr.await.unwrap(), Err(EditorsError::Discarded));
    assert_eq!(e.delegated_now(), vec![Z.to_string()]);
}

// ------------------------------------------------------------ L 그만두기 성공은 그 자리에서 회수한다(PR 리뷰 P2)

/// 204와 (확인된) 멱등 성공 404 not_found 모두: 메모리·session.json·공유 응답에서 그 채널을 뺀다(다른 맡은 채널은 남는다)
#[tokio::test(start_paused = true)]
async fn l1_leave_success_drops_channel_locally() {
    for reply in [Ok(()), Err(worker(404, "not_found"))] {
        let e = Env::online_with(&[X, Y]).await;
        e.me_ok(&[X, Y]);
        fresh(&e.svc.check_delegations(true).await);
        e.api.push_leave(Reply::Now(reply.clone()));
        if reply.is_err() {
            // 멱등 404는 같은 세션의 /api/me가 X가 없다고 확인해야 성공이다(79 (하))
            e.me_ok(&[Y]);
        }
        // 대소문자가 달라도 같은 채널이다
        e.svc
            .leave_delegation(&X.to_ascii_uppercase())
            .await
            .unwrap();
        assert_eq!(e.delegated_now(), vec![Y.to_string()], "{reply:?}");
        assert_eq!(
            e.file_delegated(),
            serde_json::json!([{"channelId": Y, "channelName": "맡은채널"}]),
            "{reply:?}"
        );
        let st = e.svc.status();
        assert_eq!(st.delegated_channels.len(), 1);
        // 간격 안의 자동 확인이 함께 쓰는 마지막 응답에서도 빠졌다
        let me = e.me_count();
        match e.svc.check_delegations(false).await {
            DelegationCheck::Skipped => {}
            DelegationCheck::Fresh(m) => {
                assert!(m.delegated.iter().all(|d| d.channel.channel_id != X));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(e.me_count(), me, "간격 안이라 다시 묻지 않는다");
    }
}
