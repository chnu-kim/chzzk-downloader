//! 앱 로그인 비밀 누출 검사(worker.md §11.2·§11.3).
//!
//! 카나리 `LEAKCANARY`를 토큰·loginId·handle·채널 이름에 심고 **실제 `HttpWorkerApi`**(wiremock 상대)로
//! 로그인·갱신·로그아웃을 끝까지 돌린다. 토큰이 실제로 요청과 session.json에 실렸는지(양성 대조)를 먼저 확인하고,
//! 로그·모든 단계의 `Debug` 출력에 카나리와 Worker 주소가 없는지 본다.
//!
//! 로그는 전역 subscriber로 모든 스레드에서 잡는다(이 바이너리에는 테스트가 하나뿐이다).

mod common;

use std::io::Write;
use std::sync::{Arc, Mutex};

use chzzk_shell::auth::*;
use common::auth::{CH, tok};
use serde_json::json;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const CANARY: &str = "LEAKCANARY";
const NAME: &str = "LEAKCANARYname";

#[derive(Clone, Default)]
struct LogBuf(Arc<Mutex<Vec<u8>>>);

impl Write for LogBuf {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl LogBuf {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }
}

fn rfc(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap()
}

fn bundle_body(acc: &str, refresh: &str) -> serde_json::Value {
    let now = OffsetDateTime::now_utc();
    json!({
        "status": "ok",
        "accessToken": tok("cda_", acc),
        "accessExpiresAt": rfc(now + time::Duration::hours(24)),
        "refreshToken": tok("cdr_", refresh),
        "refreshExpiresAt": rfc(now + time::Duration::days(30)),
        "channelId": CH,
        "channelName": NAME,
        "isAdmin": false,
    })
}

fn json_resp(status: u16, body: String) -> ResponseTemplate {
    ResponseTemplate::new(status).set_body_raw(body.into_bytes(), "application/json")
}

#[tokio::test]
async fn full_flow_leaks_nothing() {
    let logs = LogBuf::default();
    let w = logs.clone();
    let subscriber = tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .without_time()
                .with_writer(move || w.clone()),
        )
        .with(
            Targets::new()
                .with_target("chzzk_core", tracing::Level::TRACE)
                .with_target("chzzk_shell", tracing::Level::TRACE),
        );
    tracing::subscriber::set_global_default(subscriber).unwrap();

    let server = MockServer::start().await;
    let login_id = format!("{:A<22}", "LEAKCANARYlid");
    let handle = format!("{:A<22}", "LEAKCANARYhdl");
    let now = OffsetDateTime::now_utc();
    Mock::given(method("POST"))
        .and(path("/auth/start"))
        .respond_with(json_resp(
            201,
            json!({
                "loginId": login_id,
                "loginUrl": format!("{}/auth/login/{handle}", server.uri()),
                "userCode": "K7QX-4MRA",
                "expiresAt": rfc(now + time::Duration::minutes(10)),
                "pollIntervalMs": 2000,
            })
            .to_string(),
        ))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/poll"))
        .respond_with(json_resp(
            200,
            bundle_body("LEAKCANARYacc", "LEAKCANARYref").to_string(),
        ))
        .mount(&server)
        .await;
    // refresh: 첫 응답은 Cloudflare 모양 HTML 오류(응답 유실 재시도를 일으킨다), 둘째는 새 묶음
    Mock::given(method("POST"))
        .and(path("/auth/refresh"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_raw(b"<html>Error 1027 LEAKCANARY</html>".to_vec(), "text/html"),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/refresh"))
        .respond_with(json_resp(
            200,
            bundle_body("LEAKCANARYacc2", "LEAKCANARYref2").to_string(),
        ))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;

    let dir = tempfile::tempdir().unwrap();
    let base = WorkerBase::parse(&server.uri()).unwrap();
    let api = HttpWorkerApi::new(base.clone()).unwrap();
    let store = SessionStore::new(dir.path().to_path_buf(), &base);
    let svc = AuthService::open(api.clone(), SystemClock, store, client_label("0.1.0"));

    let port = server.address().port();
    let mut dumps: Vec<String> = vec![format!("{api:?}"), format!("{base:?}"), format!("{svc:?}")];
    let mut statuses: Vec<String> = vec![format!("{:?}", svc.status())];

    let begin = svc.begin_login().await;
    dumps.push(format!("{begin:?}"));
    statuses.push(format!("{:?}", svc.status()));
    dumps.push(format!("{:?}", svc.login_ticket()));
    let s = svc.poll_login_once().await;
    assert_eq!(s.phase, AuthPhase::SignedIn, "{s:?}");
    statuses.push(format!("{s:?}"));
    // 양성 대조: 토큰이 실제로 저장됐다
    let saved = std::fs::read_to_string(dir.path().join("session.json")).unwrap();
    assert!(saved.contains("LEAKCANARYacc") && saved.contains("LEAKCANARYref"));
    let s = svc.refresh().await;
    assert_eq!(s.phase, AuthPhase::SignedIn, "{s:?}");
    statuses.push(format!("{s:?}"));
    // 양성 대조: refresh 토큰이 실제 요청에 실렸다
    let reqs = server.received_requests().await.unwrap();
    let refresh_bodies: Vec<_> = reqs
        .iter()
        .filter(|r| r.url.path() == "/auth/refresh")
        .map(|r| String::from_utf8_lossy(&r.body).into_owned())
        .collect();
    assert_eq!(refresh_bodies.len(), 2);
    assert!(refresh_bodies[0].contains("LEAKCANARYref"));
    let s = svc.logout().await.unwrap();
    statuses.push(format!("{s:?}"));
    dumps.push(format!("{:?}", svc.status()));

    let log = logs.text();
    let addrs = [server.uri(), format!("127.0.0.1:{port}")];
    for a in &addrs {
        assert!(
            !log.contains(a.as_str()),
            "로그에 Worker 주소가 있다:\n{log}"
        );
        for t in dumps.iter().chain(&statuses) {
            assert!(!t.contains(a.as_str()), "Debug에 Worker 주소가 있다: {t}");
        }
    }
    assert!(!log.contains(CANARY), "로그에 카나리가 있다:\n{log}");
    for t in &dumps {
        assert!(!t.contains(CANARY), "Debug에 카나리가 있다: {t}");
    }
    // 채널 이름은 비밀이 아니라 AuthStatus에 들어간다(그것만 예외)
    for t in &statuses {
        assert!(
            !t.replace(NAME, "").contains(CANARY),
            "상태에 카나리가 있다: {t}"
        );
    }
    assert!(!log.is_empty(), "로그가 비어 있다(subscriber 확인)");
}
