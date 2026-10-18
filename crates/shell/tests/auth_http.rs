//! `HttpWorkerApi` × wiremock(worker.md §11.3, 구현 중 변경 42 (라)).

mod common;

use std::time::Duration;

use chzzk_core::Secret;
use chzzk_shell::auth::*;
use common::auth::*;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

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

fn start_body(url: &str) -> String {
    json!({"loginUrl": url, "expiresAt": "2030-01-01T00:10:00.000Z"}).to_string()
}

fn good_start(server: &MockServer) -> String {
    start_body(&format!("{}/auth/login/{HANDLE}", server.uri()))
}

fn start_req() -> StartRequest {
    StartRequest {
        port: 50000,
        login_verifier: tok("", "verifier"),
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
        json!({"port": 50000, "loginVerifier": tok("", "verifier"), "client": "app/0.1.0 test"})
    );
    assert_eq!(
        reqs[0].headers.get("content-type").unwrap(),
        "application/json"
    );
    assert_eq!(r.expires_at, t0() + time::Duration::minutes(10));
    assert_eq!(
        r.login_url.expose(),
        format!("{}/auth/login/{HANDLE}", server.uri())
    );
}

#[tokio::test]
async fn start_rejects_foreign_login_url() {
    let (server, _, api) = setup().await;
    let b = start_body(&format!("https://evil.example.invalid/auth/login/{HANDLE}"));
    mount(&server, "/auth/start", json_resp(201, &b)).await;
    assert_eq!(
        api.start(&start_req()).await.unwrap_err(),
        ApiError::Contract { status: 201 }
    );
}

#[tokio::test]
async fn start_rejects_login_url_with_extra() {
    let (server, _, api) = setup().await;
    let b = start_body(&format!("{}/auth/login/{HANDLE}?x=1", server.uri()));
    mount(&server, "/auth/start", json_resp(201, &b)).await;
    assert_eq!(
        api.start(&start_req()).await.unwrap_err(),
        ApiError::Contract { status: 201 }
    );
}

#[tokio::test]
async fn start_missing_keys_is_contract() {
    for body in [
        json!({"loginUrl": format!("{}/auth/login/{HANDLE}", "x")}),
        json!({"expiresAt": "2030-01-01T00:10:00.000Z"}),
    ] {
        let (server, _, api) = setup().await;
        let mut body = body;
        if let Some(u) = body.get_mut("loginUrl") {
            *u = format!("{}/auth/login/{HANDLE}", server.uri()).into();
        }
        mount(&server, "/auth/start", json_resp(201, &body.to_string())).await;
        assert_eq!(
            api.start(&start_req()).await.unwrap_err(),
            ApiError::Contract { status: 201 }
        );
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
async fn redeem_variants() {
    let (server, _, api) = setup().await;
    let long = "가".repeat(200);
    let bodies = [
        bundle_json().to_string(),
        json!({"status": "denied", "channelName": long}).to_string(),
        r#"{"status":"cancelled"}"#.to_string(),
        r#"{"status":"failed","code":"token"}"#.to_string(),
        r#"{"status":"failed","code":"Bad Code"}"#.to_string(),
        r#"{"status":"pending"}"#.to_string(),
        r#"{"status":"weird"}"#.to_string(),
        r#"{"status":"denied","channelName":"새","reason":"daily_limit"}"#.to_string(),
        r#"{"status":"denied","channelName":"막","reason":"blocked"}"#.to_string(),
        r#"{"status":"denied","channelName":"뒤","reason":"future_value"}"#.to_string(),
        r#"{"status":"denied","channelName":"숫자","reason":7}"#.to_string(),
    ];
    // 먼저 올린 mock부터 한 번씩 맞는다(up_to_n_times(1)).
    for b in &bodies {
        Mock::given(method("POST"))
            .and(path("/auth/redeem"))
            .respond_with(json_resp(200, b))
            .up_to_n_times(1)
            .mount(&server)
            .await;
    }
    let grant = Grant::parse(&grant_str()).unwrap();
    let sec = Secret::new(tok("", "login"));
    let mut got = Vec::new();
    for _ in 0..bodies.len() {
        got.push(api.redeem(&grant, &sec).await);
    }
    let Ok(RedeemResponse::Ok(b)) = &got[0] else {
        panic!("{:?}", got[0])
    };
    assert_eq!(b.channel_id, CH);
    assert_eq!(b.access_token.expose(), &tok("cda_", "acc1"));
    assert_eq!(
        got[1],
        Ok(RedeemResponse::Denied {
            channel_name: "가".repeat(128),
            reason: None
        })
    );
    assert_eq!(got[2], Ok(RedeemResponse::Cancelled));
    assert_eq!(
        got[3],
        Ok(RedeemResponse::Failed {
            code: "token".into()
        })
    );
    assert_eq!(
        got[4],
        Ok(RedeemResponse::Failed {
            code: "unknown".into()
        })
    );
    // pending은 수령 응답에 없다
    assert_eq!(got[5], Err(ApiError::Contract { status: 200 }));
    assert_eq!(got[6], Err(ApiError::Contract { status: 200 }));
    // 거부 이유는 선택 키다: 아는 낱말 둘만 이유가 되고 모르는 낱말·숫자는 이유 없음(옛 응답과 같다)
    let denied = |name: &str, reason| {
        Ok(RedeemResponse::Denied {
            channel_name: name.into(),
            reason,
        })
    };
    assert_eq!(got[7], denied("새", Some(DenyReason::DailyLimit)));
    assert_eq!(got[8], denied("막", Some(DenyReason::Blocked)));
    assert_eq!(got[9], denied("뒤", None));
    assert_eq!(got[10], denied("숫자", None));
}

#[tokio::test]
async fn redeem_sends_grant_and_secret() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/auth/redeem",
        json_resp(200, &bundle_json().to_string()),
    )
    .await;
    let sec = tok("", "login");
    api.redeem(
        &Grant::parse(&grant_str()).unwrap(),
        &Secret::new(sec.clone()),
    )
    .await
    .unwrap();
    let reqs = server.received_requests().await.unwrap();
    assert_eq!(reqs[0].url.path(), "/auth/redeem");
    assert_eq!(
        last_body(&server).await,
        json!({"grant": grant_str(), "loginSecret": sec})
    );
}

#[tokio::test]
async fn redeem_errors() {
    let (server, _, api) = setup().await;
    let grant = Grant::parse(&grant_str()).unwrap();
    let sec = Secret::new(tok("", "login"));
    for (status, body, want) in [
        (
            404,
            r#"{"code":"not_found"}"#,
            ApiError::Worker {
                status: 404,
                code: "not_found".into(),
            },
        ),
        (
            400,
            r#"{"code":"bad_request"}"#,
            ApiError::Worker {
                status: 400,
                code: "bad_request".into(),
            },
        ),
    ] {
        server.reset().await;
        mount(&server, "/auth/redeem", json_resp(status, body)).await;
        assert_eq!(api.redeem(&grant, &sec).await.unwrap_err(), want);
    }
    server.reset().await;
    mount(
        &server,
        "/auth/redeem",
        ResponseTemplate::new(503).set_body_raw(CF_HTML.as_bytes().to_vec(), "text/html"),
    )
    .await;
    assert_eq!(
        api.redeem(&grant, &sec).await.unwrap_err(),
        ApiError::NotWorker { status: 503 }
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

#[test]
fn debug_and_display_hide_values() {
    let base = base();
    let sr = start_ok(&base);
    let t = format!("{sr:?}");
    assert!(t.contains("***") && !t.contains(&"H".repeat(22)), "{t}");
    assert_eq!(format!("{:?}", sr.login_url), "LoginUrl(***)");
    let b = bundle(1, t0());
    let t = format!("{b:?}");
    assert!(
        t.contains("***") && !t.contains("acc1") && !t.contains("ref1"),
        "{t}"
    );
    let e = BaseError::HasPath;
    assert_eq!(
        e.to_string(),
        "Worker 주소 형식이 올바르지 않습니다(HasPath)"
    );
    let api = HttpWorkerApi::new(base.clone()).unwrap();
    assert_eq!(api.base(), &base);
}

#[test]
fn offset_time_bounds_in_bundle_and_start() {
    // 오프셋을 UTC로 옮겨 10000년·−1년이 되는 시각은 panic 없이 계약 위반(None), 범위 안의 오프셋은 UTC로 받는다
    let bad = ["9999-12-31T23:30:00-01:00", "0000-01-01T00:30:00+01:00"];
    for key in ["accessExpiresAt", "refreshExpiresAt"] {
        for t in bad {
            let mut b = bundle_json();
            b[key] = t.into();
            assert!(
                parse_bundle(b.to_string().as_bytes()).is_none(),
                "{key} {t}"
            );
        }
    }
    let mut b = bundle_json();
    b["accessExpiresAt"] = "2030-01-02T09:00:00+09:00".into();
    let got = parse_bundle(b.to_string().as_bytes()).unwrap();
    assert_eq!(got.access_expires_at, t0() + time::Duration::hours(24));
    assert!(got.access_expires_at.offset().is_utc());

    let base = WorkerBase::parse(ORIGIN).unwrap();
    let url = format!("{ORIGIN}/auth/login/{HANDLE}");
    for t in bad {
        let body = json!({"loginUrl": url, "expiresAt": t});
        assert!(
            parse_start(body.to_string().as_bytes(), &base).is_none(),
            "{t}"
        );
    }
}

// ---- /api/me·편집자 API ----

const X: &str = "000000000000000000000000000000d4";
const Y: &str = "000000000000000000000000000000e5";

async fn mount_get(server: &MockServer, p: &str, r: ResponseTemplate) {
    Mock::given(method("GET"))
        .and(path(p))
        .respond_with(r)
        .mount(server)
        .await;
}

fn me_json() -> Value {
    json!({
        "channelId": CH,
        "channelName": "채널",
        "accessExpiresAt": "2030-01-02T00:00:00.000Z",
        "serverTime": "2030-01-01T00:00:00.000Z",
        "delegatedChannels": [{"channelId": X, "channelName": "맡은채널", "since": "2030-01-01T00:00:00.000Z"}],
        "editors": [{"channelId": Y, "channelName": "편집자", "since": "2030-01-01T00:00:00.000Z", "status": "pending"}],
        "pendingInviteUntil": "2030-01-08T00:00:00.000Z",
        "limits": {"editors": 10, "delegations": 20},
    })
}

#[tokio::test]
async fn h1_me_get_with_bearer() {
    let (server, _, api) = setup().await;
    mount_get(&server, "/api/me", json_resp(200, &me_json().to_string())).await;
    let me = api.me(&at()).await.unwrap();
    let reqs = server.received_requests().await.unwrap();
    assert_eq!(reqs[0].method.as_str(), "GET");
    assert_eq!(
        reqs[0]
            .headers
            .get("authorization")
            .unwrap()
            .to_str()
            .unwrap(),
        format!("Bearer {}", tok("cda_", "acc1"))
    );
    assert!(reqs[0].body.is_empty());
    assert_eq!(me.channel_id, CH);
    assert_eq!(me.delegated.len(), 1);
    assert_eq!(me.delegated[0].channel.channel_id, X);
    assert!(me.delegated[0].since.is_some());
    assert_eq!(me.editors[0].status, EditorStatus::Pending);
    assert!(me.pending_invite_until.is_some());
}

#[tokio::test]
async fn h2_invite_post_empty_object() {
    let (server, _, api) = setup().await;
    let url = format!("{}/invite/{}", server.uri(), tok("cdi_", "one"));
    mount(
        &server,
        "/api/editors/invite",
        json_resp(
            200,
            &json!({"inviteUrl": url, "expiresAt": "2030-01-08T00:00:00.000Z"}).to_string(),
        ),
    )
    .await;
    let r = api.create_invite(&at()).await.unwrap();
    assert_eq!(r.invite_url.expose(), url);
    assert_eq!(last_body(&server).await, json!({}));
    let reqs = server.received_requests().await.unwrap();
    assert!(
        reqs[0]
            .headers
            .get("authorization")
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("Bearer cda_")
    );
}

#[tokio::test]
async fn h3_remove_and_leave_bodies() {
    let (server, _, api) = setup().await;
    mount(&server, "/api/editors/remove", ResponseTemplate::new(204)).await;
    mount(
        &server,
        "/api/delegations/leave",
        ResponseTemplate::new(204),
    )
    .await;
    api.remove_editor(&at(), Y).await.unwrap();
    assert_eq!(last_body(&server).await, json!({"channelId": Y}));
    api.leave_delegation(&at(), X).await.unwrap();
    assert_eq!(last_body(&server).await, json!({"channelId": X}));
}

#[tokio::test]
async fn h4_not_enabled_is_worker_error() {
    let (server, _, api) = setup().await;
    mount(
        &server,
        "/api/editors/invite",
        json_resp(404, r#"{"code":"not_enabled"}"#),
    )
    .await;
    mount(
        &server,
        "/api/editors/remove",
        json_resp(404, r#"{"code":"not_found"}"#),
    )
    .await;
    assert_eq!(
        api.create_invite(&at()).await.unwrap_err(),
        ApiError::Worker {
            status: 404,
            code: "not_enabled".into()
        }
    );
    assert_eq!(
        api.remove_editor(&at(), Y).await.unwrap_err(),
        ApiError::Worker {
            status: 404,
            code: "not_found".into()
        }
    );
}

// ---- 파서(P1~P5) ----

fn delegated_el(id: &str, name: Value) -> Value {
    json!({"channelId": id, "channelName": name})
}

fn bundle_with_delegated(list: Value) -> Vec<u8> {
    let mut b = bundle_json();
    b["delegatedChannels"] = list;
    b.to_string().into_bytes()
}

#[test]
fn p1_bundle_without_key_is_empty_list() {
    let b = parse_bundle(bundle_json().to_string().as_bytes()).unwrap();
    assert!(b.delegated_channels.is_empty());
}

#[test]
fn p2_delegated_element_rules() {
    let upper = "000000000000000000000000000000D4";
    let short = &X[1..];
    let long_name = "가".repeat(200);
    let mut many: Vec<Value> = (0..25)
        .map(|n| delegated_el(&format!("{:032x}", 0x1000 + n), json!("c")))
        .collect();
    let list = json!([
        delegated_el(upper, json!("대문자")),
        delegated_el(short, json!("31자")),
        delegated_el(Y, json!(7)),
        5,
        delegated_el(X, json!(long_name)),
        delegated_el(X, json!("중복")),
        delegated_el(CH, json!("자기 채널")),
    ]);
    let b = parse_bundle(&bundle_with_delegated(list)).unwrap();
    assert_eq!(b.delegated_channels.len(), 1);
    assert_eq!(b.delegated_channels[0].channel_id, X);
    assert_eq!(b.delegated_channels[0].channel_name.chars().count(), 128);
    // 25개는 20개까지
    many.insert(0, delegated_el(X, json!("x")));
    let b = parse_bundle(&bundle_with_delegated(Value::Array(many))).unwrap();
    assert_eq!(b.delegated_channels.len(), DELEGATED_MAX);
}

#[test]
fn p3_bad_delegated_does_not_reject_bundle() {
    for bad in [json!(5), json!("x"), json!({"a": 1}), json!([null, 1, "z"])] {
        let b = parse_bundle(&bundle_with_delegated(bad)).expect("묶음은 Some");
        assert!(b.delegated_channels.is_empty());
    }
}

#[test]
fn p4_parse_me_rules() {
    let body = |f: &dyn Fn(&mut Value)| {
        let mut v = me_json();
        f(&mut v);
        v.to_string().into_bytes()
    };
    // channelId 없음·틀림·channelName 없음 → None
    assert!(
        parse_me(&body(&|v| {
            v.as_object_mut().unwrap().remove("channelId");
        }))
        .is_none()
    );
    assert!(parse_me(&body(&|v| v["channelId"] = json!("ABC"))).is_none());
    assert!(
        parse_me(&body(&|v| {
            v.as_object_mut().unwrap().remove("channelName");
        }))
        .is_none()
    );
    // editors: 모르는 status·since 없음 버림, 중복 버림
    let me = parse_me(&body(&|v| {
        v["editors"] = json!([
            {"channelId": Y, "channelName": "a", "since": "2030-01-01T00:00:00Z", "status": "weird"},
            {"channelId": Y, "channelName": "b", "status": "active"},
            {"channelId": Y, "channelName": "c", "since": "2030-01-01T00:00:00Z", "status": "active"},
            {"channelId": Y, "channelName": "d", "since": "2030-01-01T00:00:00Z", "status": "pending"},
        ]);
    }))
    .unwrap();
    assert_eq!(me.editors.len(), 1);
    assert_eq!(me.editors[0].channel_name, "c");
    assert_eq!(me.editors[0].status, EditorStatus::Active);
    // pendingInviteUntil null, limits 없음 → 기본
    let me = parse_me(&body(&|v| {
        v["pendingInviteUntil"] = Value::Null;
        v.as_object_mut().unwrap().remove("limits");
    }))
    .unwrap();
    assert!(me.pending_invite_until.is_none());
    assert_eq!((me.editors_max, me.delegations_max), (10, 20));
    // limits 범위 밖 → 기본
    let me = parse_me(&body(&|v| {
        v["limits"] = json!({"editors": 0, "delegations": 5000})
    }))
    .unwrap();
    assert_eq!((me.editors_max, me.delegations_max), (10, 20));
    // 키가 모두 없는 옛 Worker: 빈 목록
    let me = parse_me(
        json!({"channelId": CH, "channelName": "채널"})
            .to_string()
            .as_bytes(),
    )
    .unwrap();
    assert!(me.delegated.is_empty() && me.editors.is_empty());
    // delegated since 있음/없음
    let me = parse_me(&body(&|v| {
        v["delegatedChannels"] = json!([
            {"channelId": X, "channelName": "a", "since": "2030-01-01T00:00:00Z"},
            {"channelId": Y, "channelName": "b"},
        ]);
    }))
    .unwrap();
    assert!(me.delegated[0].since.is_some());
    assert!(me.delegated[1].since.is_none());
}

#[test]
fn p5_parse_invite_rules() {
    let b = base();
    let good = format!("{ORIGIN}/invite/{}", tok("cdi_", "one"));
    let body =
        |url: &str| json!({"inviteUrl": url, "expiresAt": "2030-01-08T00:00:00Z"}).to_string();
    assert!(parse_invite(body(&good).as_bytes(), &b).is_some());
    // 다른 출처
    let other = format!("https://evil.example.invalid/invite/{}", tok("cdi_", "one"));
    assert!(parse_invite(body(&other).as_bytes(), &b).is_none());
    // cdi_ 42자
    let short = format!("{ORIGIN}/invite/cdi_{}", "A".repeat(42));
    assert!(parse_invite(body(&short).as_bytes(), &b).is_none());
    // 접두가 다른 토큰
    let wrong = format!("{ORIGIN}/invite/{}", tok("cdr_", "one"));
    assert!(parse_invite(body(&wrong).as_bytes(), &b).is_none());
    // 만료가 시각이 아님
    assert!(
        parse_invite(
            json!({"inviteUrl": good, "expiresAt": "soon"})
                .to_string()
                .as_bytes(),
            &b
        )
        .is_none()
    );
}
