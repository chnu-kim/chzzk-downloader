//! App 수준 로그인 배선(Phase 3b A2): AuthGate 판정, 로그인 command, 로그인 뒤 자동 이어받기.

mod common;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_core::{ClientConfig, Endpoints, RetryPolicy, Secret};
use chzzk_shell::auth::{AuthPhase, AuthStatus, SessionStore, StoredSession, WorkerBase};
use chzzk_shell::dto::{
    AuthReasonDto, AuthState, AuthStatusDto, JobStatus, SettingsPatch, UpdateCheckDto,
    UpdateInstallDto, UpdateProgressEvent,
};
use chzzk_shell::gate;
use chzzk_shell::services::AppPaths;
use chzzk_shell::update::{FoundUpdate, InstallHost, SourceError, UpdateSource};
use chzzk_shell::{App, AuthSetup, ErrorCode, JobId};
use common::harness::request;
use tempfile::TempDir;
use time::OffsetDateTime;
use url::Url;
use wiremock::matchers::{any, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const CH: &str = "000000000000000000000000000000a1";

fn paths(root: &Path) -> AppPaths {
    AppPaths::new(
        root.join("config"),
        root.join("data"),
        root.join("log"),
        None,
        None,
    )
}

fn config(server: &MockServer) -> ClientConfig {
    let base = Url::parse(&server.uri()).unwrap();
    ClientConfig {
        endpoints: Endpoints {
            chzzk_api: base.clone(),
            vodplay_api: base,
        },
        retry: RetryPolicy {
            max_attempts: 1,
            base: Duration::from_millis(1),
            cap: Duration::from_millis(1),
        },
        ..ClientConfig::default()
    }
}

fn enabled(worker: &MockServer) -> AuthSetup {
    AuthSetup::Enabled {
        base: WorkerBase::parse(&worker.uri()).unwrap(),
        app_version: "0.1.0".into(),
    }
}

fn open_auth(root: &Path, api: &MockServer, worker: &MockServer) -> App {
    App::open_with_auth(
        paths(root),
        config(api),
        None,
        tokio::runtime::Handle::current(),
        enabled(worker),
    )
    .unwrap()
}

fn open_plain(root: &Path, api: &MockServer) -> App {
    App::open_with(
        paths(root),
        config(api),
        None,
        tokio::runtime::Handle::current(),
    )
    .unwrap()
}

fn save_session(root: &Path, worker: &MockServer, verified: OffsetDateTime) {
    std::fs::create_dir_all(root.join("config")).unwrap();
    let store = SessionStore::new(
        root.join("config"),
        &WorkerBase::parse(&worker.uri()).unwrap(),
    );
    store
        .save(&StoredSession {
            channel_id: CH.into(),
            channel_name: "채널".into(),
            is_admin: false,
            access_token: Secret::new(format!("cda_{}", "A".repeat(43))),
            access_expires_at: verified + time::Duration::hours(24),
            refresh_token: Secret::new(format!("cdr_{}", "B".repeat(43))),
            refresh_expires_at: verified + time::Duration::days(30),
            verified_at: verified,
        })
        .unwrap();
}

fn start_body(origin: &str) -> String {
    serde_json::json!({
        "loginId": "L".repeat(22),
        "loginUrl": format!("{origin}/auth/login/{}", "H".repeat(22)),
        "userCode": "K7QX-4MRA",
        "expiresAt": "2030-01-01T00:10:00.000Z",
        "pollIntervalMs": 2000,
    })
    .to_string()
}

fn json_response(status: u16, body: String) -> ResponseTemplate {
    ResponseTemplate::new(status).set_body_raw(body, "application/json")
}

async fn mock_start_ok(worker: &MockServer) {
    Mock::given(method("POST"))
        .and(path("/auth/start"))
        .respond_with(json_response(201, start_body(&worker.uri())))
        .mount(worker)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/poll"))
        .respond_with(json_response(200, r#"{"status":"pending"}"#.into()))
        .mount(worker)
        .await;
}

fn login_url(worker: &MockServer) -> String {
    format!("{}/auth/login/{}", worker.uri(), "H".repeat(22))
}

fn plain_status(phase: AuthPhase) -> AuthStatus {
    AuthStatus {
        phase,
        reason: None,
        channel_id: None,
        channel_name: None,
        is_admin: false,
        pending: None,
        offline: None,
        verified_at: None,
        has_session: false,
    }
}

async fn wait_status(app: &App, id: JobId, want: JobStatus) {
    for _ in 0..500 {
        if app
            .manager
            .list()
            .iter()
            .any(|j| j.id == id && j.status == want)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("{id:?}가 {want:?}가 되지 않음: {:?}", app.manager.list());
}

async fn hanging_server() -> MockServer {
    let s = MockServer::start().await;
    Mock::given(any())
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
        .mount(&s)
        .await;
    s
}

#[test]
fn open_commands_are_fixed() {
    assert_eq!(
        gate::OPEN_COMMANDS,
        [
            "app_info",
            "auth_cancel",
            "auth_copy_login_url",
            "auth_login",
            "auth_logout",
            "auth_reopen",
            "auth_retry",
            "auth_status",
            "frontend_ready",
            "list_jobs",
            "quit",
            "subscribe_jobs",
        ]
    );
    let mut sorted = gate::OPEN_COMMANDS.to_vec();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted, gate::OPEN_COMMANDS);
}

/// 앱 상태가 없을 때(시작 실패): 허용 목록만 통과, 나머지(새 이름 포함)는 notLoggedIn(worker.md 구현 중 변경 55)
#[test]
fn gate_without_app_allows_only_open_commands() {
    for c in gate::OPEN_COMMANDS {
        assert!(gate::gate_without_app(c).is_ok(), "{c}");
    }
    for c in [
        "resolve",
        "enqueue",
        "resume_job",
        "get_settings",
        "update_settings",
        "made_up_command",
        "",
    ] {
        let e = gate::gate_without_app(c).unwrap_err();
        assert_eq!(e.code, ErrorCode::NotLoggedIn, "{c}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disabled_auth_passes_every_command() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let app = open_plain(t.path(), &api);
    assert!(!app.auth_enabled());
    assert!(!app.info("0").features.auth);
    assert_eq!(app.auth_status(), AuthStatusDto::disabled());
    for c in [
        "resolve",
        "enqueue",
        "resume_job",
        "get_settings",
        "pick_folder",
        "app_info",
        "made_up_command",
    ] {
        assert!(app.gate_command(c).is_ok(), "{c}");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signed_out_blocks_app_commands() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    let app = open_auth(t.path(), &api, &worker);
    assert!(app.info("0").features.auth);
    assert_eq!(app.auth_status().state, AuthState::SignedOut);
    for c in [
        "resolve",
        "enqueue",
        "resume_job",
        "get_settings",
        "pick_folder",
        "clipboard_link",
        "made_up_command",
    ] {
        let e = app.gate_command(c).unwrap_err();
        assert_eq!(e.code, ErrorCode::NotLoggedIn, "{c}");
    }
    for c in gate::OPEN_COMMANDS {
        assert!(app.gate_command(c).is_ok(), "{c}");
    }
    assert!(worker.received_requests().await.unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stored_session_signs_in_optimistically() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    save_session(
        t.path(),
        &worker,
        OffsetDateTime::now_utc() - time::Duration::hours(1),
    );
    let app = open_auth(t.path(), &api, &worker);
    let st = app.auth_status();
    assert_eq!(st.state, AuthState::SignedIn);
    assert_eq!(st.channel_id.as_deref(), Some(CH));
    assert!(app.gate_command("resolve").is_ok());
    assert!(worker.received_requests().await.unwrap().is_empty());
    // [다시 연결] 연타: 온라인 SignedIn이고 갱신 예정 전이면 Worker를 부르지 않는다(구현 중 변경 61)
    for _ in 0..2 {
        assert_eq!(app.auth_retry().await.state, AuthState::SignedIn);
    }
    assert!(worker.received_requests().await.unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auto_resume_waits_for_sign_in() {
    let t = TempDir::new().unwrap();
    let api = hanging_server().await;
    let worker = MockServer::start().await;
    {
        let app = open_plain(t.path(), &api);
        app.update_settings(SettingsPatch {
            auto_resume_interrupted: Some(true),
            ..SettingsPatch::default()
        })
        .unwrap();
        let job = app.enqueue(request("영상")).unwrap();
        wait_status(&app, job.id, JobStatus::Running).await;
        app.manager.quit(Duration::from_secs(3)).await;
    }
    let app = open_auth(t.path(), &api, &worker);
    let id = app.manager.list()[0].id;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(app.manager.list()[0].status, JobStatus::Interrupted);

    assert_eq!(app.on_auth_status(&plain_status(AuthPhase::SignedOut)), 0);
    assert_eq!(app.on_auth_status(&plain_status(AuthPhase::SignedIn)), 1);
    assert!(
        app.manager
            .list()
            .iter()
            .any(|j| j.id == id && j.status != JobStatus::Interrupted)
    );
    assert_eq!(app.on_auth_status(&plain_status(AuthPhase::SignedIn)), 0);
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auto_resume_runs_at_open_when_auth_disabled() {
    let t = TempDir::new().unwrap();
    let api = hanging_server().await;
    {
        let app = open_plain(t.path(), &api);
        app.update_settings(SettingsPatch {
            auto_resume_interrupted: Some(true),
            ..SettingsPatch::default()
        })
        .unwrap();
        let job = app.enqueue(request("영상")).unwrap();
        wait_status(&app, job.id, JobStatus::Running).await;
        app.manager.quit(Duration::from_secs(3)).await;
    }
    let app = open_plain(t.path(), &api);
    assert_ne!(app.manager.list()[0].status, JobStatus::Interrupted);
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_login_opens_the_ticket_only_when_started() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    mock_start_ok(&worker).await;
    let app = open_auth(t.path(), &api, &worker);
    let url = login_url(&worker);

    let opened: Arc<Mutex<Vec<String>>> = Arc::default();
    let rec = |o: &Arc<Mutex<Vec<String>>>| {
        let o = o.clone();
        move |u: &str| {
            o.lock().unwrap().push(u.to_string());
            true
        }
    };
    let st = app.auth_login(rec(&opened)).await;
    assert_eq!(st.state, AuthState::Pending);
    assert_eq!(st.pending.unwrap().user_code, "K7QX-4MRA");
    assert_eq!(*opened.lock().unwrap(), vec![url.clone()]);

    assert!(app.auth_reopen(rec(&opened)));
    assert_eq!(*opened.lock().unwrap(), vec![url.clone(), url.clone()]);
    let copied: Arc<Mutex<Vec<String>>> = Arc::default();
    assert!(app.auth_copy_login_url(rec(&copied)));
    assert_eq!(*copied.lock().unwrap(), vec![url.clone()]);

    let st = app.auth_login(rec(&opened)).await;
    assert_eq!(st.state, AuthState::Pending);
    assert_eq!(opened.lock().unwrap().len(), 2);

    assert_eq!(app.auth_cancel().state, AuthState::SignedOut);
    assert!(!app.auth_reopen(|_| panic!("열면 안 된다")));
    assert!(!app.auth_copy_login_url(|_| panic!("복사하면 안 된다")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_login_failure_opens_nothing() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/auth/start"))
        .respond_with(ResponseTemplate::new(503).set_body_raw("<html>", "text/html"))
        .mount(&worker)
        .await;
    let app = open_auth(t.path(), &api, &worker);
    let opened: Arc<Mutex<Vec<String>>> = Arc::default();
    let o = opened.clone();
    let st = app
        .auth_login(move |u| {
            o.lock().unwrap().push(u.to_string());
            true
        })
        .await;
    assert_eq!(st.state, AuthState::Error);
    assert_eq!(st.reason, Some(AuthReasonDto::Network));
    assert!(opened.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_login_discarded_by_cancel_opens_nothing() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/auth/start"))
        .respond_with(
            json_response(201, start_body(&worker.uri())).set_delay(Duration::from_millis(500)),
        )
        .mount(&worker)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/poll"))
        .respond_with(json_response(200, r#"{"status":"pending"}"#.into()))
        .mount(&worker)
        .await;
    let app = Arc::new(open_auth(t.path(), &api, &worker));
    let opened: Arc<Mutex<Vec<String>>> = Arc::default();
    let o = opened.clone();
    let app2 = app.clone();
    let join = tokio::spawn(async move {
        app2.auth_login(move |u| {
            o.lock().unwrap().push(u.to_string());
            true
        })
        .await
    });
    tokio::time::sleep(Duration::from_millis(100)).await;
    app.auth_cancel();
    join.await.unwrap();
    assert!(opened.lock().unwrap().is_empty());
    assert_eq!(app.auth_status().state, AuthState::SignedOut);
    let polls = worker
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path() == "/auth/poll")
        .count();
    assert_eq!(polls, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_logout_clears_the_session() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/auth/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&worker)
        .await;
    save_session(
        t.path(),
        &worker,
        OffsetDateTime::now_utc() - time::Duration::hours(1),
    );
    let app = open_auth(t.path(), &api, &worker);
    let st = app.auth_logout().await.unwrap();
    assert_eq!(st.state, AuthState::SignedOut);
    assert!(!t.path().join("config/session.json").exists());
    let n = worker
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path() == "/auth/logout")
        .count();
    assert_eq!(n, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auth_commands_are_noops_when_disabled() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let app = open_plain(t.path(), &api);
    assert_eq!(
        app.auth_login(|_| panic!("열면 안 된다")).await,
        AuthStatusDto::disabled()
    );
    assert_eq!(app.auth_cancel(), AuthStatusDto::disabled());
    assert_eq!(app.auth_retry().await, AuthStatusDto::disabled());
    assert_eq!(app.auth_logout().await.unwrap(), AuthStatusDto::disabled());
    assert!(!app.auth_reopen(|_| panic!("열면 안 된다")));
    assert!(!app.auth_copy_login_url(|_| panic!("복사하면 안 된다")));
}

// ---- 업데이트(Phase 3b A4) ----

/// 확인한 endpoint를 적고 같은 Worker 출처의 업데이트를 찾는 가짜 원천
struct FakeSource {
    origin: String,
    endpoints: Mutex<Vec<String>>,
}

impl FakeSource {
    fn new(origin: &str) -> Self {
        Self {
            origin: origin.to_string(),
            endpoints: Mutex::default(),
        }
    }
    fn calls(&self) -> Vec<String> {
        self.endpoints.lock().unwrap().clone()
    }
}

impl UpdateSource for FakeSource {
    fn check(
        &self,
        endpoint: &str,
        _bearer: &Secret<String>,
    ) -> impl Future<Output = Result<Option<FoundUpdate>, SourceError>> + Send {
        self.endpoints.lock().unwrap().push(endpoint.to_string());
        let f = FoundUpdate {
            version: "9.9.9".into(),
            current: "0.1.0".into(),
            notes: None,
            pub_date: None,
            download_url: format!("{}/releases/9.9.9/app.bin", self.origin),
        };
        async move { Ok(Some(f)) }
    }
    async fn download(
        &self,
        _on_chunk: &mut (dyn FnMut(u64, Option<u64>) + Send),
    ) -> Result<(), SourceError> {
        Ok(())
    }
    fn install(&self) -> Result<(), SourceError> {
        Ok(())
    }
}

struct FakeHost(usize);

impl InstallHost for FakeHost {
    fn running(&self) -> usize {
        self.0
    }
    async fn pause_for_install(&self) -> bool {
        true
    }
    fn resume_after_failed_install(&self) {}
    fn restart(&self) {}
    fn progress(&self, _e: UpdateProgressEvent) {}
}

fn refresh_ok_body() -> String {
    use time::format_description::well_known::Rfc3339;
    let now = OffsetDateTime::now_utc();
    serde_json::json!({
        "status": "ok",
        "accessToken": format!("cda_{}", "C".repeat(43)),
        "accessExpiresAt": (now + time::Duration::hours(24)).format(&Rfc3339).unwrap(),
        "refreshToken": format!("cdr_{}", "D".repeat(43)),
        "refreshExpiresAt": (now + time::Duration::days(30)).format(&Rfc3339).unwrap(),
        "channelId": CH,
        "channelName": "채널",
        "isAdmin": false,
        "serverTime": now.format(&Rfc3339).unwrap(),
    })
    .to_string()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn update_wrappers_fail_without_auth() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let app = open_plain(t.path(), &api);
    let src = FakeSource::new("https://w.example.invalid");
    assert_eq!(app.update_check(&src).await, UpdateCheckDto::Failed);
    assert_eq!(
        app.update_install(&src, &FakeHost(0), true).await,
        UpdateInstallDto::Failed
    );
    assert!(src.calls().is_empty());
    assert_eq!(app.update_available(), None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn update_check_through_app_uses_the_build_base() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    save_session(
        t.path(),
        &worker,
        OffsetDateTime::now_utc() - time::Duration::hours(1),
    );
    let app = open_auth(t.path(), &api, &worker);
    let src = FakeSource::new(&worker.uri());
    let UpdateCheckDto::Available { info } = app.update_check(&src).await else {
        panic!("available이어야 한다");
    };
    assert_eq!(
        src.calls(),
        [format!("{}/update/{{{{current_version}}}}", worker.uri())]
    );
    assert_eq!(app.update_available(), Some(info));
    assert!(worker.received_requests().await.unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn update_install_through_app_asks_first() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    save_session(
        t.path(),
        &worker,
        OffsetDateTime::now_utc() - time::Duration::hours(1),
    );
    let app = open_auth(t.path(), &api, &worker);
    let src = FakeSource::new(&worker.uri());
    assert_eq!(
        app.update_install(&src, &FakeHost(1), false).await,
        UpdateInstallDto::NeedsConfirm { running: 1 }
    );
    assert!(src.calls().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn take_auto_update_check_once_after_first_ok() {
    let t = TempDir::new().unwrap();
    let api = MockServer::start().await;
    let worker = MockServer::start().await;
    save_session(
        t.path(),
        &worker,
        OffsetDateTime::now_utc() - time::Duration::hours(1),
    );
    let app = open_auth(t.path(), &api, &worker);
    // 낙관 SignedIn: 서버 확인 전이라 아직 아니다
    assert!(!app.take_auto_update_check(&app.auth.as_ref().unwrap().status()));

    // 오프라인 유예(Worker 형식 4xx라 응답 유실 재시도 없이 끝난다): take를 부르지 않으므로 소모되지 않는다
    Mock::given(method("POST"))
        .and(path("/auth/refresh"))
        .respond_with(json_response(429, r#"{"code":"rate_limited"}"#.into()))
        .mount(&worker)
        .await;
    let off = app.auth.as_ref().unwrap().refresh().await;
    assert!(off.offline.is_some());
    assert!(!app.take_auto_update_check(&off));

    // 온라인 Ok 뒤 한 번
    worker.reset().await;
    Mock::given(method("POST"))
        .and(path("/auth/refresh"))
        .respond_with(json_response(200, refresh_ok_body()))
        .mount(&worker)
        .await;
    let on = app.auth.as_ref().unwrap().refresh().await;
    assert!(on.offline.is_none());
    assert!(app.take_auto_update_check(&on));
    assert!(!app.take_auto_update_check(&on));
}
