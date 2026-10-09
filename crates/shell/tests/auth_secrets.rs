//! 앱 로그인 비밀 누출 검사(worker.md §11.2·§11.3).
//!
//! 카나리 `LEAKCANARY`를 토큰·grant·handle·채널 이름에 심고 **실제 `HttpWorkerApi`**(wiremock 상대)로
//! 로그인·갱신·로그아웃을 끝까지 돌린다. 토큰이 실제로 요청과 session.json에 실렸는지(양성 대조)를 먼저 확인하고,
//! 로그·모든 단계의 `Debug` 출력에 카나리와 Worker 주소, 루프백 수신기 주소·state·loginSecret이 없는지 본다.
//! 수신기는 실제 `LoopbackGrantSource`다(브라우저 대신 테스트가 소켓으로 grant를 들고 온다).
//!
//! 로그는 전역 subscriber로 모든 스레드에서 잡는다(이 바이너리에는 테스트가 하나뿐이다).

mod common;

use std::io::Write;
use std::sync::{Arc, Mutex};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
    let grant = format!("cdg_{:A<43}", "LEAKCANARYgrant");
    let handle = format!("{:A<22}", "LEAKCANARYhdl");
    let now = OffsetDateTime::now_utc();
    Mock::given(method("POST"))
        .and(path("/auth/start"))
        .respond_with(json_resp(
            201,
            json!({
                "loginUrl": format!("{}/auth/login/{handle}", server.uri()),
                "expiresAt": rfc(now + time::Duration::minutes(10)),
            })
            .to_string(),
        ))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/auth/redeem"))
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
    let svc = Arc::new(AuthService::open(
        api.clone(),
        SystemClock,
        store,
        client_label("0.1.0"),
    ));

    let port = server.address().port();
    let mut dumps: Vec<String> = vec![format!("{api:?}"), format!("{base:?}"), format!("{svc:?}")];
    let mut statuses: Vec<String> = vec![format!("{:?}", svc.status())];

    let begin = svc.begin_login().await;
    dumps.push(format!("{begin:?}"));
    statuses.push(format!("{:?}", svc.status()));
    dumps.push(format!("{:?}", svc.login_ticket()));
    // start 본문에서 수신기 포트와 verifier를 읽고, 브라우저 대신 수신기로 grant를 들고 간다
    let reqs = server.received_requests().await.unwrap();
    let start_req = reqs.iter().find(|r| r.url.path() == "/auth/start").unwrap();
    let start_body: serde_json::Value = serde_json::from_slice(&start_req.body).unwrap();
    let rport = start_body["port"].as_u64().unwrap() as u16;
    let verifier = start_body["loginVerifier"].as_str().unwrap().to_string();
    let state = token::loopback_state(&verifier);
    let waiter = tokio::spawn({
        let svc = svc.clone();
        async move { svc.run_login_wait().await }
    });
    let mut conn = tokio::net::TcpStream::connect(("127.0.0.1", rport))
        .await
        .unwrap();
    let req = format!(
        "GET /chzzk-downloader/login?grant={grant}&state={state} HTTP/1.1\r\nHost: 127.0.0.1:{rport}\r\nConnection: close\r\n\r\n"
    );
    conn.write_all(req.as_bytes()).await.unwrap();
    let mut resp = Vec::new();
    conn.read_to_end(&mut resp).await.unwrap();
    let resp = String::from_utf8_lossy(&resp).into_owned();
    assert!(resp.starts_with("HTTP/1.1 200"), "{resp}");
    assert!(resp.contains(ReceiverPage::SignedIn.message()), "{resp}");
    let s = waiter.await.unwrap();
    assert_eq!(s.phase, AuthPhase::SignedIn, "{s:?}");
    // 양성 대조: grant와 loginSecret이 실제 수령 요청에 실렸다
    let reqs = server.received_requests().await.unwrap();
    let redeem_req = reqs
        .iter()
        .find(|r| r.url.path() == "/auth/redeem")
        .unwrap();
    let redeem_body: serde_json::Value = serde_json::from_slice(&redeem_req.body).unwrap();
    assert_eq!(redeem_body["grant"], grant.as_str());
    let login_secret = redeem_body["loginSecret"].as_str().unwrap().to_string();
    assert_eq!(token::login_verifier(&login_secret), verifier);
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
    let addrs = [
        server.uri(),
        format!("127.0.0.1:{port}"),
        format!("127.0.0.1:{rport}"),
    ];
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
    for secret in [&state, &login_secret, &verifier] {
        assert!(!log.contains(secret.as_str()), "로그에 비밀이 있다:\n{log}");
        for t in dumps.iter().chain(&statuses) {
            assert!(!t.contains(secret.as_str()), "Debug에 비밀이 있다: {t}");
        }
    }
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
