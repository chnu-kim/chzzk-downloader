//! `Chzzk::fetch_chat_page`·`info_chat_flag` 통합 테스트. 네트워크는 wiremock뿐이다.
//! (`collect_chat` 통합 테스트는 `tests/chat.rs`다.)

mod common;

use chzzk_core::chat::ChatCursor;
use chzzk_core::chat::probe::{Attempt, attempt_class};
use chzzk_core::chat::retry::{ChatFailure, classify};
use chzzk_core::{Chzzk, ClientConfig, Error, NaverCookies, RequestKind};
use common::{config, fixture};
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const VOD_NO: u64 = 9000002;
const CHATS: &str = "/service/v1/videos/9000002/chats";

fn json(body: Vec<u8>) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_raw(body, "application/json")
}

async fn mount_page(server: &MockServer, cursor: &str, body: Vec<u8>) {
    Mock::given(method("GET"))
        .and(path(CHATS))
        .and(query_param("playerMessageTime", cursor))
        .and(query_param("previousVideoChatSize", "50"))
        .respond_with(json(body))
        .mount(server)
        .await;
}

async fn mount_status(server: &MockServer, status: u16) {
    Mock::given(method("GET"))
        .and(path(CHATS))
        .respond_with(ResponseTemplate::new(status))
        .mount(server)
        .await;
}

fn chzzk(server: &MockServer) -> Chzzk {
    Chzzk::new(config(server)).unwrap()
}

#[tokio::test]
async fn fetch_page_path_and_query() {
    let server = MockServer::start().await;
    mount_page(&server, "15000", fixture("testdata/chat/page_first.json")).await;
    let page = chzzk(&server)
        .fetch_chat_page(VOD_NO, ChatCursor(15000))
        .await
        .unwrap();
    assert_eq!(page.messages.len(), 5);
    assert_eq!(page.next, Some(ChatCursor(15000)));
}

#[tokio::test]
async fn fetch_page_api_headers_no_cookie() {
    let server = MockServer::start().await;
    mount_page(&server, "0", fixture("testdata/chat/page_first.json")).await;
    chzzk(&server)
        .fetch_chat_page(VOD_NO, ChatCursor(0))
        .await
        .unwrap();
    let reqs = server.received_requests().await.unwrap();
    let h = &reqs[0].headers;
    let accept = h.get("accept").unwrap().to_str().unwrap();
    assert!(accept.starts_with("application/json"), "{accept}");
    assert!(h.get("origin").is_some());
    assert!(h.get("cookie").is_none());
}

#[tokio::test]
async fn fetch_page_cookie_when_enabled() {
    let server = MockServer::start().await;
    mount_page(&server, "0", fixture("testdata/chat/page_first.json")).await;
    let cfg = ClientConfig {
        cookies: Some(NaverCookies::new("a-fake", "s-fake")),
        ..config(&server)
    };
    Chzzk::new(cfg)
        .unwrap()
        .fetch_chat_page(VOD_NO, ChatCursor(0))
        .await
        .unwrap();
    let reqs = server.received_requests().await.unwrap();
    let cookie = reqs[0].headers.get("cookie").unwrap().to_str().unwrap();
    assert!(cookie.contains("NID_AUT="), "{cookie}");
}

#[tokio::test]
async fn fetch_page_400_is_error() {
    let server = MockServer::start().await;
    mount_status(&server, 400).await;
    let e = chzzk(&server)
        .fetch_chat_page(VOD_NO, ChatCursor(0))
        .await
        .unwrap_err();
    assert!(
        matches!(
            e,
            Error::HttpStatus {
                status: 400,
                kind: RequestKind::Api
            }
        ),
        "{e:?}"
    );
    // 400은 정상 끝이 아니라 늘 오류다
    assert_eq!(classify(&e), ChatFailure::Fatal);
    assert_eq!(attempt_class(Some(&e)), Attempt::Http400);
}

#[tokio::test]
async fn fetch_page_auth() {
    for status in [401u16, 403] {
        let server = MockServer::start().await;
        mount_status(&server, status).await;
        let e = chzzk(&server)
            .fetch_chat_page(VOD_NO, ChatCursor(0))
            .await
            .unwrap_err();
        assert!(
            matches!(e, Error::AuthRequired { status: s } if s == status),
            "{e:?}"
        );
    }
}

#[tokio::test]
async fn fetch_page_429_retry_class() {
    let server = MockServer::start().await;
    mount_status(&server, 429).await;
    let e = chzzk(&server)
        .fetch_chat_page(VOD_NO, ChatCursor(0))
        .await
        .unwrap_err();
    assert!(matches!(e, Error::HttpStatus { status: 429, .. }), "{e:?}");
    assert_eq!(classify(&e), ChatFailure::Retry);
}

#[tokio::test]
async fn fetch_page_api_code() {
    let server = MockServer::start().await;
    mount_page(
        &server,
        "0",
        br#"{"code":500,"message":"x","content":null}"#.to_vec(),
    )
    .await;
    let e = chzzk(&server)
        .fetch_chat_page(VOD_NO, ChatCursor(0))
        .await
        .unwrap_err();
    assert!(matches!(e, Error::Api { code: 500, .. }), "{e:?}");
}

#[tokio::test]
async fn fetch_page_network() {
    // 연결을 받는 곳이 없는 주소(바인드했다가 닫은 포트)
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = url::Url::parse(&format!("http://{}", l.local_addr().unwrap())).unwrap();
    drop(l);
    let cfg = ClientConfig {
        endpoints: chzzk_core::Endpoints {
            chzzk_api: base.clone(),
            vodplay_api: base,
        },
        ..ClientConfig::default()
    };
    let e = Chzzk::new(cfg)
        .unwrap()
        .fetch_chat_page(VOD_NO, ChatCursor(0))
        .await
        .unwrap_err();
    assert!(matches!(e, Error::Network(_)), "{e:?}");
    assert_eq!(classify(&e), ChatFailure::Retry);
    assert_eq!(attempt_class(Some(&e)), Attempt::Network);
}

#[tokio::test]
async fn info_chat_flag_absent() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/service/v2/videos/9000002"))
        .respond_with(json(fixture("testdata/vod/video_info.json")))
        .mount(&server)
        .await;
    assert_eq!(chzzk(&server).info_chat_flag(VOD_NO).await.unwrap(), None);
}

#[tokio::test]
async fn info_chat_flag_present() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/service/v2/videos/9000002"))
        .respond_with(json(
            br#"{"code":200,"content":{"videoChatEnabled":true}}"#.to_vec(),
        ))
        .mount(&server)
        .await;
    assert_eq!(
        chzzk(&server).info_chat_flag(VOD_NO).await.unwrap(),
        Some(true)
    );
}
