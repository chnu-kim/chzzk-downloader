//! `HttpWorkerApi` × wiremock(worker.md §11.3, 구현 중 변경 42 (라)).

mod common;

use std::time::Duration;

use chzzk_core::Secret;
use chzzk_shell::auth::*;
use common::auth::*;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const LID: &str = "LLLLLLLLLLLLLLLLLLLLLL";
const HANDLE: &str = "HHHHHHHHHHHHHHHHHHHHHH";
const CF_HTML: &str = "<!DOCTYPE html><title>Error 1027</title><body>blocked</body>";

async fn setup() -> (MockServer, WorkerBase, HttpWorkerApi) {
    let server = MockServer::start().await;
    let base = WorkerBase::parse(&server.uri()).unwrap();
    let api = HttpWorkerApi::new(base.clone()).unwrap();
    (server, base, api)
}

fn json_resp(status: u16, body: &str) -> ResponseTemplate {
    // set_body_string은 Content-Type을 text/plain으로 덮어쓰므로 set_body_raw를 쓴다.
    ResponseTemplate::new(status).set_body_raw(body.as_bytes().to_vec(), "application/json")
}

async fn mount(server: &MockServer, p: &str, r: ResponseTemplate) {
    Mock::given(method("POST"))
        .and(path(p))
        .respond_with(r)
        .mount(server)
        .await;
}

fn start_body(url: &str, code: &str, interval: Value) -> String {
    json!({
        "loginId": LID, "loginUrl": url, "userCode": code,
        "expiresAt": "2030-01-01T00:10:00.000Z", "pollIntervalMs": interval,
    })
    .to_string()
}

fn good_start(server: &MockServer) -> String {
    start_body(
        &format!("{}/auth/login/{HANDLE}", server.uri()),
        "K7QX-4MRA",
        json!(2000),
    )
}

fn start_req() -> StartRequest {
    StartRequest {
        poll_verifier: tok("", "verifier"),
        client: "app/0.1.0 test".into(),
    }
}

fn bundle_json() -> Value {
    json!({
        "status": "ok",
        "accessToken": tok("cda_", "acc1"),
        "accessExpiresAt": "2030-01-02T00:00:00.000Z",
        "refreshToken": tok("cdr_", "ref1"),
        "refreshExpiresAt": "2030-01-31T00:00:00.000Z",
        "channelId": CH,
        "channelName": "채널",
        "isAdmin": false,
        "serverTime": "2030-01-01T00:00:00.000Z",
    })
}

async fn last_body(server: &MockServer) -> Value {
    let reqs = server.received_requests().await.unwrap();
    serde_json::from_slice(&reqs.last().unwrap().body).unwrap()
}

#[tokio::test]
async fn start_sends_contract_and_parses() {
    let (server, _, api) = setup().await;
    mount(&server, "/auth/start", json_resp(201, &good_start(&server))).await;
    let r = api.start(&start_req()).await.unwrap();
    let reqs = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&reqs[0].body).unwrap();
    assert_eq!(
        body,
        json!({"pollVerifier": tok("", "verifier"), "client": "app/0.1.0 test"})
    );
    assert_eq!(
        reqs[0].headers.get("content-type").unwrap(),
        "application/json"
    );
    assert_eq!(r.user_code, "K7QX-4MRA");
    assert_eq!(r.poll_interval, Duration::from_secs(2));
    assert_eq!(
        r.login_url.expose(),
        format!("{}/auth/login/{HANDLE}", server.uri())
    );
    assert_eq!(r.login_id.expose(), LID);
}

#[tokio::test]
async fn start_rejects_foreign_login_url() {
    let (server, _, api) = setup().await;
    let b = start_body(
        &format!("https://evil.example.invalid/auth/login/{HANDLE}"),
        "K7QX-4MRA",
        json!(2000),
    );
    mount(&server, "/auth/start", json_resp(201, &b)).await;
    assert_eq!(
        api.start(&start_req()).await.unwrap_err(),
        ApiError::Contract { status: 201 }
    );
}

#[tokio::test]
async fn start_rejects_login_url_with_extra() {
    let (server, _, api) = setup().await;
    let b = start_body(
        &format!("{}/auth/login/{HANDLE}?x=1", server.uri()),
        "K7QX-4MRA",
        json!(2000),
    );
    mount(&server, "/auth/start", json_resp(201, &b)).await;
    assert_eq!(
        api.start(&start_req()).await.unwrap_err(),
        ApiError::Contract { status: 201 }
    );
}

#[tokio::test]
async fn start_bad_user_code() {
    let (server, _, api) = setup().await;
    let b = start_body(
        &format!("{}/auth/login/{HANDLE}", server.uri()),
        "k7qx-4mra",
        json!(2000),
    );
    mount(&server, "/auth/start", json_resp(201, &b)).await;
    assert_eq!(
        api.start(&start_req()).await.unwrap_err(),
        ApiError::Contract { status: 201 }
    );
}

#[tokio::test]
async fn start_interval_clamped() {
    for (interval, want) in [
        (json!(0), Ok(Duration::from_secs(2))),
        (json!(999_999), Ok(Duration::from_secs(30))),
        (json!("2000"), Err(ApiError::Contract { status: 201 })),
    ] {
        let (server, _, api) = setup().await;
        let b = start_body(
            &format!("{}/auth/login/{HANDLE}", server.uri()),
            "K7QX-4MRA",
            interval,
        );
        mount(&server, "/auth/start", json_resp(201, &b)).await;
        let got = api.start(&start_req()).await.map(|r| r.poll_interval);
        assert_eq!(got, want);
    }
}

#[tokio::test]
async fn start_200_is_not_expected_status() {
    let (server, _, api) = setup().await;
    mount(&server, "/auth/start", json_resp(200, &good_start(&server))).await;
    assert_eq!(
        api.start(&start_req()).await.unwrap_err(),
        ApiError::NotWorker { status: 200 }
    );
}

#[tokio::test]
async fn start_rate_limited() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/auth/start",
        json_resp(429, r#"{"code":"rate_limited"}"#).insert_header("retry-after", "60"),
    )
    .await;
    assert_eq!(
        api.start(&start_req()).await.unwrap_err(),
        ApiError::Worker {
            status: 429,
            code: "rate_limited".into()
        }
    );
}

#[tokio::test]
async fn poll_variants() {
    let (server, _, api) = setup().await;
    let bodies = [
        r#"{"status":"pending"}"#.to_string(),
        bundle_json().to_string(),
        r#"{"status":"denied","channelName":"이름"}"#.to_string(),
        r#"{"status":"cancelled"}"#.to_string(),
        r#"{"status":"failed","code":"token"}"#.to_string(),
        r#"{"status":"failed","code":"Bad Code"}"#.to_string(),
        r#"{"status":"weird"}"#.to_string(),
    ];
    // 먼저 올린 mock부터 한 번씩 맞는다(up_to_n_times(1)).
    for b in &bodies {
        Mock::given(method("POST"))
            .and(path("/auth/poll"))
            .respond_with(json_resp(200, b))
            .up_to_n_times(1)
            .mount(&server)
            .await;
    }
    let (lid, sec) = (Secret::new(LID.to_string()), Secret::new(tok("", "poll")));
    let mut got = Vec::new();
    for _ in 0..bodies.len() {
        got.push(api.poll(&lid, &sec).await);
    }
    assert_eq!(got[0], Ok(PollResponse::Pending));
    let Ok(PollResponse::Ok(b)) = &got[1] else {
        panic!("{:?}", got[1])
    };
    assert_eq!(b.channel_id, CH);
    assert_eq!(b.access_token.expose(), &tok("cda_", "acc1"));
    assert_eq!(
        got[2],
        Ok(PollResponse::Denied {
            channel_name: "이름".into()
        })
    );
    assert_eq!(got[3], Ok(PollResponse::Cancelled));
    assert_eq!(
        got[4],
        Ok(PollResponse::Failed {
            code: "token".into()
        })
    );
    assert_eq!(
        got[5],
        Ok(PollResponse::Failed {
            code: "unknown".into()
        })
    );
    assert_eq!(got[6], Err(ApiError::Contract { status: 200 }));
}

#[tokio::test]
async fn poll_sends_login_and_secret() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/auth/poll",
        json_resp(200, r#"{"status":"pending"}"#),
    )
    .await;
    let sec = tok("", "poll");
    api.poll(&Secret::new(LID.to_string()), &Secret::new(sec.clone()))
        .await
        .unwrap();
    assert_eq!(
        last_body(&server).await,
        json!({"loginId": LID, "pollSecret": sec})
    );
}

#[tokio::test]
async fn poll_404_and_429() {
    let (server, _, api) = setup().await;
    let (lid, sec) = (Secret::new(LID.to_string()), Secret::new(tok("", "poll")));
    mount(
        &server,
        "/auth/poll",
        json_resp(404, r#"{"code":"not_found"}"#),
    )
    .await;
    assert_eq!(
        api.poll(&lid, &sec).await.unwrap_err(),
        ApiError::Worker {
            status: 404,
            code: "not_found".into()
        }
    );
    server.reset().await;
    mount(
        &server,
        "/auth/poll",
        json_resp(429, r#"{"code":"too_soon"}"#),
    )
    .await;
    assert_eq!(
        api.poll(&lid, &sec).await.unwrap_err(),
        ApiError::Worker {
            status: 429,
            code: "too_soon".into()
        }
    );
}

fn rt() -> Secret<String> {
    Secret::new(tok("cdr_", "ref1"))
}

#[tokio::test]
async fn refresh_ok_parses_bundle() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/auth/refresh",
        json_resp(200, &bundle_json().to_string()),
    )
    .await;
    let b = api.refresh(&rt()).await.unwrap();
    assert_eq!(b.access_token.expose(), &tok("cda_", "acc1"));
    assert_eq!(b.refresh_token.expose(), &tok("cdr_", "ref1"));
    assert_eq!(b.channel_id, CH);
    assert_eq!(b.channel_name, "채널");
    assert!(!b.is_admin);
    assert_eq!(
        b.access_expires_at.unix_timestamp(),
        t0().unix_timestamp() + 86_400
    );
    assert_eq!(
        b.refresh_expires_at.unix_timestamp(),
        t0().unix_timestamp() + 30 * 86_400
    );
    assert_eq!(
        last_body(&server).await,
        json!({"refreshToken": tok("cdr_", "ref1")})
    );
}

#[tokio::test]
async fn refresh_bundle_contract_table() {
    #[allow(clippy::type_complexity)]
    let mutate: Vec<(&str, Box<dyn Fn(&mut Value)>)> = vec![
        ("status", Box::new(|v| v["status"] = "pending".into())),
        (
            "access_prefix",
            Box::new(|v| v["accessToken"] = tok("cdr_", "x").into()),
        ),
        (
            "refresh_42",
            Box::new(|v| v["refreshToken"] = format!("cdr_{}", "A".repeat(42)).into()),
        ),
        (
            "channel_upper",
            Box::new(|v| v["channelId"] = CH.replace('a', "A").into()),
        ),
        (
            "access_time_num",
            Box::new(|v| v["accessExpiresAt"] = 5.into()),
        ),
        (
            "no_is_admin",
            Box::new(|v| {
                v.as_object_mut().unwrap().remove("isAdmin");
            }),
        ),
        ("name_num", Box::new(|v| v["channelName"] = 7.into())),
    ];
    for (name, f) in mutate {
        let (server, _, api) = setup().await;
        let mut v = bundle_json();
        f(&mut v);
        mount(&server, "/auth/refresh", json_resp(200, &v.to_string())).await;
        assert_eq!(
            api.refresh(&rt()).await.unwrap_err(),
            ApiError::Contract { status: 200 },
            "{name}"
        );
    }
}

#[tokio::test]
async fn refresh_long_channel_name_truncated() {
    let (server, _, api) = setup().await;
    let mut v = bundle_json();
    v["channelName"] = "가".repeat(200).into();
    mount(&server, "/auth/refresh", json_resp(200, &v.to_string())).await;
    assert_eq!(
        api.refresh(&rt())
            .await
            .unwrap()
            .channel_name
            .chars()
            .count(),
        128
    );
}

#[tokio::test]
async fn refresh_200_html_is_not_worker() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/auth/refresh",
        ResponseTemplate::new(200).set_body_raw(b"<html></html>".to_vec(), "text/html"),
    )
    .await;
    assert_eq!(
        api.refresh(&rt()).await.unwrap_err(),
        ApiError::NotWorker { status: 200 }
    );
}

#[tokio::test]
async fn refresh_401_json() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/auth/refresh",
        json_resp(401, r#"{"code":"session_revoked"}"#),
    )
    .await;
    assert_eq!(
        api.refresh(&rt()).await.unwrap_err(),
        ApiError::Worker {
            status: 401,
            code: "session_revoked".into()
        }
    );
}

#[tokio::test]
async fn refresh_cloudflare_html_403_and_429() {
    for status in [403u16, 429] {
        let (server, _, api) = setup().await;
        mount(
            &server,
            "/auth/refresh",
            ResponseTemplate::new(status)
                .set_body_raw(CF_HTML.as_bytes().to_vec(), "text/html; charset=UTF-8"),
        )
        .await;
        assert_eq!(
            api.refresh(&rt()).await.unwrap_err(),
            ApiError::NotWorker { status }
        );
    }
}

#[tokio::test]
async fn redirect_not_followed() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/auth/refresh",
        ResponseTemplate::new(302).insert_header("location", format!("{}/elsewhere", server.uri())),
    )
    .await;
    Mock::given(method("POST"))
        .and(path("/elsewhere"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    assert_eq!(
        api.refresh(&rt()).await.unwrap_err(),
        ApiError::NotWorker { status: 302 }
    );
}

#[tokio::test]
async fn oversized_body_is_not_worker() {
    let (server, _, api) = setup().await;
    let body = format!(
        r#"{{"code":"invalid_token","pad":"{}"}}"#,
        "x".repeat(70 * 1024)
    );
    mount(&server, "/auth/refresh", json_resp(401, &body)).await;
    assert_eq!(
        api.refresh(&rt()).await.unwrap_err(),
        ApiError::NotWorker { status: 401 }
    );
}

#[tokio::test]
async fn timeout_is_transport() {
    let server = MockServer::start().await;
    let api = HttpWorkerApi::with_timeout(
        WorkerBase::parse(&server.uri()).unwrap(),
        Duration::from_millis(200),
    )
    .unwrap();
    mount(
        &server,
        "/auth/refresh",
        json_resp(200, &bundle_json().to_string()).set_delay(Duration::from_secs(2)),
    )
    .await;
    assert_eq!(
        api.refresh(&rt()).await.unwrap_err(),
        ApiError::Transport { timed_out: true }
    );
}

#[tokio::test]
async fn connection_refused_is_transport() {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    drop(l);
    let api = HttpWorkerApi::new(WorkerBase::parse(&format!("http://{addr}")).unwrap()).unwrap();
    assert_eq!(
        api.refresh(&rt()).await.unwrap_err(),
        ApiError::Transport { timed_out: false }
    );
}

fn at() -> Secret<String> {
    Secret::new(tok("cda_", "acc1"))
}

#[tokio::test]
async fn logout_sends_bearer_and_body() {
    let (server, _, api) = setup().await;
    mount(&server, "/auth/logout", ResponseTemplate::new(204)).await;
    api.logout(Some(&at()), Some(&rt())).await.unwrap();
    let reqs = server.received_requests().await.unwrap();
    assert_eq!(
        reqs[0]
            .headers
            .get("authorization")
            .unwrap()
            .to_str()
            .unwrap(),
        format!("Bearer {}", tok("cda_", "acc1"))
    );
    assert_eq!(
        last_body(&server).await,
        json!({"refreshToken": tok("cdr_", "ref1")})
    );
}

#[tokio::test]
async fn logout_without_access() {
    let (server, _, api) = setup().await;
    mount(&server, "/auth/logout", ResponseTemplate::new(204)).await;
    api.logout(None, Some(&rt())).await.unwrap();
    let reqs = server.received_requests().await.unwrap();
    assert!(reqs[0].headers.get("authorization").is_none());
    assert_eq!(
        last_body(&server).await,
        json!({"refreshToken": tok("cdr_", "ref1")})
    );
}

#[tokio::test]
async fn logout_without_refresh() {
    let (server, _, api) = setup().await;
    mount(&server, "/auth/logout", ResponseTemplate::new(204)).await;
    api.logout(Some(&at()), None).await.unwrap();
    assert_eq!(last_body(&server).await, json!({}));
}

#[tokio::test]
async fn logout_401() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/auth/logout",
        json_resp(401, r#"{"code":"invalid_token"}"#),
    )
    .await;
    assert_eq!(
        api.logout(Some(&at()), None).await.unwrap_err(),
        ApiError::Worker {
            status: 401,
            code: "invalid_token".into()
        }
    );
}

#[test]
fn base_parse_table() {
    let ok = [
        ("https://a.example.invalid", "https://a.example.invalid"),
        ("https://a.example.invalid/", "https://a.example.invalid"),
        ("HTTPS://A.Example.Invalid:443", "https://a.example.invalid"),
        ("http://127.0.0.1:8787", "http://127.0.0.1:8787"),
        ("http://localhost:8787", "http://localhost:8787"),
        ("http://[::1]:8787", "http://[::1]:8787"),
        ("http://127.1.2.3", "http://127.1.2.3"),
    ];
    for (s, origin) in ok {
        assert_eq!(WorkerBase::parse(s).unwrap().origin(), origin, "{s}");
    }
    let err = [
        ("http://example.com", BaseError::NotLoopbackHttp),
        ("ftp://a", BaseError::Scheme),
        ("https://a/x", BaseError::HasPath),
        ("https://a/?q", BaseError::HasQuery),
        ("https://a/#f", BaseError::HasFragment),
        ("https://u:p@a", BaseError::HasUserInfo),
        ("not a url", BaseError::Parse),
    ];
    for (s, e) in err {
        assert_eq!(WorkerBase::parse(s).unwrap_err(), e, "{s}");
    }
}

#[test]
fn client_label_shape() {
    let l = client_label("0.1.0");
    assert!(l.starts_with("app/0.1.0 "));
    assert!(l.ends_with(std::env::consts::OS));
    assert!(client_label("가").starts_with("app/? "));
    assert_eq!(client_label(&"v".repeat(300)).chars().count(), 128);
}

#[tokio::test]
async fn errors_carry_no_url() {
    let (server, base, api) = setup().await;
    let port = server.address().port().to_string();
    mount(
        &server,
        "/auth/refresh",
        json_resp(401, r#"{"code":"invalid_token"}"#),
    )
    .await;
    let errs = [
        api.refresh(&rt()).await.unwrap_err(),
        ApiError::Transport { timed_out: true },
        ApiError::NotWorker { status: 403 },
        ApiError::Contract { status: 200 },
    ];
    let mut texts: Vec<String> = errs
        .iter()
        .flat_map(|e| [format!("{e}"), format!("{e:?}")])
        .collect();
    texts.push(format!("{api:?}"));
    texts.push(format!("{base:?}"));
    for t in texts {
        assert!(!t.contains(&port) && !t.contains("127.0.0.1"), "{t}");
    }
}
