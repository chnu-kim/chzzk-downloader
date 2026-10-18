//! 명령줄 `login`(cli-mode.md §5.3·§14.1): 앱과 같은 루프백 로그인, 끝 상태별 출력·종료 코드, 취소, 비밀값.

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_shell::cli::{OpenUrl, exit};
use chzzk_shell::dto::AuthState;
use common::cli_env::*;
use tempfile::TempDir;
use time::OffsetDateTime;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const HANDLE: &str = "HHHHHHHHHHHHHHHHHHHHHH";

fn json(status: u16, body: String) -> ResponseTemplate {
    ResponseTemplate::new(status).set_body_raw(body, "application/json")
}

fn rfc(t: OffsetDateTime) -> String {
    // Worker와 같은 모양: 밀리초 세 자리 + Z
    let t = t.to_offset(time::UtcOffset::UTC);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second(),
        t.millisecond()
    )
}

/// start 본문을 기록하고 201을 주는 응답기
struct CaptureStart {
    seen: Arc<Mutex<Option<serde_json::Value>>>,
    origin: String,
    expires: OffsetDateTime,
}

impl Respond for CaptureStart {
    fn respond(&self, req: &Request) -> ResponseTemplate {
        *self.seen.lock().unwrap() = serde_json::from_slice(&req.body).ok();
        json(
            201,
            serde_json::json!({
                "loginUrl": format!("{}/auth/login/{HANDLE}", self.origin),
                "expiresAt": rfc(self.expires),
            })
            .to_string(),
        )
    }
}

type Seen = Arc<Mutex<Option<serde_json::Value>>>;

async fn mock_start(worker: &MockServer, expires_in: time::Duration) -> Seen {
    let seen: Seen = Arc::default();
    Mock::given(method("POST"))
        .and(path("/auth/start"))
        .respond_with(CaptureStart {
            seen: seen.clone(),
            origin: worker.uri(),
            expires: OffsetDateTime::now_utc() + expires_in,
        })
        .mount(worker)
        .await;
    seen
}

async fn mock_redeem(worker: &MockServer, body: serde_json::Value) {
    Mock::given(method("POST"))
        .and(path("/auth/redeem"))
        .respond_with(json(200, body.to_string()))
        .mount(worker)
        .await;
}

fn redeem_ok() -> serde_json::Value {
    let now = OffsetDateTime::now_utc();
    serde_json::json!({
        "status": "ok",
        "accessToken": format!("cda_{}", "A".repeat(43)),
        "accessExpiresAt": rfc(now + time::Duration::hours(24)),
        "refreshToken": format!("cdr_{}", "B".repeat(43)),
        "refreshExpiresAt": rfc(now + time::Duration::days(30)),
        "channelId": OWN,
        "channelName": "채널",
        "isAdmin": false,
    })
}

/// 브라우저가 돌아오는 것을 흉내 낸다: 수신기에 grant를 GET으로 건넨다(2-thread 런타임 전제).
fn deliver(seen: &Seen) -> String {
    use std::io::{Read, Write};
    let start = seen.lock().unwrap().clone().expect("start 본문");
    let port = start["port"].as_u64().unwrap() as u16;
    let state = chzzk_shell::auth::token::loopback_state(start["loginVerifier"].as_str().unwrap());
    let mut c = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
    let grant = format!("cdg_{}", "G".repeat(43));
    write!(
        c,
        "GET /chzzk-downloader/login?grant={grant}&state={state} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut out = String::new();
    c.read_to_string(&mut out).unwrap();
    out
}

/// 열릴 때 grant를 건네는 `open`
fn delivering_open(seen: Seen, log: Arc<Mutex<Vec<String>>>) -> OpenUrl {
    Box::new(move |u: &str| {
        log.lock().unwrap().push(u.to_string());
        deliver(&seen);
        true
    })
}

fn port_of(seen: &Seen) -> u16 {
    seen.lock().unwrap().clone().unwrap()["port"]
        .as_u64()
        .unwrap() as u16
}

async fn refused(port: u16) -> bool {
    for _ in 0..40 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_err()
        {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

async fn worker_paths(worker: &MockServer) -> Vec<String> {
    worker
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| r.url.path().to_string())
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn already_signed_in_opens_nothing() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    mock_start(&worker, time::Duration::minutes(10)).await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_cli(t.path(), &api, Some(&worker));
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    let (_tx, mut rx) = ctrl();
    let r = run_with(
        &app,
        &["login"],
        t.path(),
        &mut rx,
        Some(recording_open(log.clone(), true)),
        None,
    )
    .await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert!(r.err.contains("이미 로그인되어 있어요: 채널"), "{r:?}");
    assert!(log.lock().unwrap().is_empty());
    assert_eq!(count(&worker, "/auth/start").await, 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn login_succeeds_and_the_gui_sees_the_same_session() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let seen = mock_start(&worker, time::Duration::minutes(10)).await;
    mock_redeem(&worker, redeem_ok()).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    let (_tx, mut rx) = ctrl();
    let r = run_with(
        &app,
        &["login"],
        t.path(),
        &mut rx,
        Some(delivering_open(seen.clone(), log.clone())),
        None,
    )
    .await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert!(r.err.contains("브라우저에서 로그인해 주세요"), "{r:?}");
    assert!(r.err.contains("로그인했어요: 채널"), "{r:?}");
    assert_eq!(log.lock().unwrap().len(), 1);
    assert!(t.path().join("config/session.json").exists());
    // 같은 데이터 폴더를 GUI 경로(`open_with_auth`)로 열면 로그인되어 있다
    let gui = open_gui(t.path(), &api, &worker);
    assert_eq!(gui.auth_status().state, AuthState::SignedIn);
    // 로그인만 한다: Worker에는 start와 redeem뿐(업데이트 확인·/api/me 없음)
    let paths = worker_paths(&worker).await;
    assert!(
        paths
            .iter()
            .all(|p| p == "/auth/start" || p == "/auth/redeem"),
        "{paths:?}"
    );
    // 토큰은 출력되지 않는다
    assert!(!r.out.contains("cda_") && !r.err.contains("cda_") && !r.err.contains("cdr_"));
}

/// 브라우저를 열지 못하면 로그인을 그만두고 코드 1. 로그인 주소는 어디에도 쓰지 않는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_failure_cancels_and_never_prints_the_url() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let seen = mock_start(&worker, time::Duration::minutes(10)).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    let (_tx, mut rx) = ctrl();
    let r = run_with(
        &app,
        &["login"],
        t.path(),
        &mut rx,
        Some(recording_open(log.clone(), false)),
        None,
    )
    .await;
    assert_eq!(r.code, exit::FAILED, "{r:?}");
    assert!(r.err.contains("브라우저를 열지 못했어요"), "{r:?}");
    let opened = log.lock().unwrap().clone();
    assert_eq!(opened.len(), 1);
    for text in [&r.out, &r.err] {
        assert!(!text.contains(&opened[0]), "로그인 주소가 출력됐다");
        assert!(
            !text.contains("/auth/login/") && !text.contains(HANDLE),
            "{text}"
        );
    }
    assert_eq!(app.auth_status().state, AuthState::SignedOut);
    assert!(refused(port_of(&seen)).await, "수신기가 열려 있다");
    assert!(!t.path().join("config/session.json").exists());
}

/// 서버가 정한 기한이 지나면 시간 초과(코드 3)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn deadline_passes_exit_3() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    mock_start(&worker, time::Duration::seconds(1)).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    let (_tx, mut rx) = ctrl();
    let r = run_with(
        &app,
        &["login"],
        t.path(),
        &mut rx,
        Some(recording_open(log.clone(), true)),
        None,
    )
    .await;
    assert_eq!(r.code, exit::LOGIN, "{r:?}");
    assert!(r.err.contains("로그인 시간이 지났어요"), "{r:?}");
}

/// 거부: 이유 없음·오늘 한도·차단 → 코드 3과 이유 줄
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn denied_variants_exit_3() {
    for (reason, first, next) in [
        (
            None,
            "사용 허가가 없는 채널이에요",
            "허가를 받은 뒤 다시 `login`을 실행해 주세요.",
        ),
        (
            Some("blocked"),
            "사용 허가가 없는 채널이에요",
            "허가를 받은 뒤 다시 `login`을 실행해 주세요.",
        ),
        (
            Some("daily_limit"),
            "오늘은 새로 시작할 수 없어요",
            "다음 날 다시 `login`을 실행해 주세요.",
        ),
    ] {
        let api = mock_api(None, false).await;
        let worker = MockServer::start().await;
        let seen = mock_start(&worker, time::Duration::minutes(10)).await;
        let mut body = serde_json::json!({"status": "denied", "channelName": "채널"});
        if let Some(r) = reason {
            body["reason"] = r.into();
        }
        mock_redeem(&worker, body).await;
        let t = TempDir::new().unwrap();
        let app = open_cli(t.path(), &api, Some(&worker));
        let log: Arc<Mutex<Vec<String>>> = Arc::default();
        let (_tx, mut rx) = ctrl();
        let r = run_with(
            &app,
            &["login"],
            t.path(),
            &mut rx,
            Some(delivering_open(seen, log)),
            None,
        )
        .await;
        assert_eq!(r.code, exit::LOGIN, "{reason:?} {r:?}");
        assert!(
            r.err.contains(first) && r.err.contains(next),
            "{reason:?} {r:?}"
        );
        assert!(!t.path().join("config/session.json").exists());
    }
}

/// 서버 실패(redeem `failed`)와 시작 실패(5xx) → 코드 1
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn server_failures_exit_1() {
    // redeem가 실패로 끝남
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let seen = mock_start(&worker, time::Duration::minutes(10)).await;
    mock_redeem(
        &worker,
        serde_json::json!({"status": "failed", "code": "internal"}),
    )
    .await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    let (_tx, mut rx) = ctrl();
    let r = run_with(
        &app,
        &["login"],
        t.path(),
        &mut rx,
        Some(delivering_open(seen, log)),
        None,
    )
    .await;
    assert_eq!(r.code, exit::FAILED, "{r:?}");
    assert!(r.err.contains("로그인 요청을 처리하지 못했어요"), "{r:?}");

    // /auth/start 5xx: 브라우저를 열지 않는다
    let worker = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/auth/start"))
        .respond_with(ResponseTemplate::new(503).set_body_raw("<html>", "text/html"))
        .mount(&worker)
        .await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    let (_tx, mut rx) = ctrl();
    let r = run_with(
        &app,
        &["login"],
        t.path(),
        &mut rx,
        Some(recording_open(log.clone(), true)),
        None,
    )
    .await;
    assert_eq!(r.code, exit::FAILED, "{r:?}");
    assert!(r.err.contains("로그인 서버에 연결하지 못했어요"), "{r:?}");
    assert!(log.lock().unwrap().is_empty());
}

/// Ctrl+C: 로그인을 지우고 수신기를 닫는다(코드 130). 그 뒤 들어온 grant는 세션을 만들지 못한다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ctrl_c_cancels_and_closes_the_receiver() {
    let api = mock_api(None, false).await;
    let worker = MockServer::start().await;
    let seen = mock_start(&worker, time::Duration::minutes(10)).await;
    mock_redeem(&worker, redeem_ok()).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, Some(&worker));
    let (tx, mut rx) = ctrl();
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    let open: OpenUrl = {
        let log = log.clone();
        Box::new(move |u: &str| {
            log.lock().unwrap().push(u.to_string());
            // 브라우저가 열린 직후 사용자가 Ctrl+C를 누른다
            tx.send(()).unwrap();
            true
        })
    };
    let r = run_with(&app, &["login"], t.path(), &mut rx, Some(open), None).await;
    assert_eq!(r.code, exit::INTERRUPTED, "{r:?}");
    assert!(r.err.contains("로그인을 그만뒀어요"), "{r:?}");
    assert_eq!(app.auth_status().state, AuthState::SignedOut);
    assert!(refused(port_of(&seen)).await, "수신기가 열려 있다");
    assert!(!t.path().join("config/session.json").exists());
    assert_eq!(count(&worker, "/auth/redeem").await, 0);
}

/// 로그인을 쓰지 않는 빌드는 안내만 하고 브라우저를 열지 않는다(코드 0)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disabled_build_does_not_login() {
    let api = mock_api(None, false).await;
    let t = TempDir::new().unwrap();
    let app = open_cli(t.path(), &api, None);
    let log: Arc<Mutex<Vec<String>>> = Arc::default();
    let (_tx, mut rx) = ctrl();
    let r = run_with(
        &app,
        &["login"],
        t.path(),
        &mut rx,
        Some(recording_open(log.clone(), true)),
        None,
    )
    .await;
    assert_eq!(r.code, exit::OK, "{r:?}");
    assert!(r.err.contains("로그인을 쓰지 않아요"), "{r:?}");
    assert!(log.lock().unwrap().is_empty());
}
