//! 미리보기 PD 중계 통합 테스트(preview.md §4.1, §11.2 PV-1). 네트워크는 wiremock과 로컬 raw TCP뿐이다.

mod common;

use chzzk_core::{Chzzk, ClientConfig, Error, NaverCookies, WatchFail};
use common::{config, test_bytes};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::JoinHandle;
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const MEDIA: &str = "/m1/pd/a.mp4";
/// 서명 쿼리 자리. 어떤 출력에도 나오면 안 된다.
const SIG: &str = "hdnts=SECRETSIG";

fn media_url(base: &str) -> Url {
    Url::parse(&format!("{base}{MEDIA}?{SIG}")).unwrap()
}

fn client(server: &MockServer) -> Chzzk {
    Chzzk::new(config(server)).unwrap()
}

/// `bytes=a-b` 닫힌 구간을 읽어 `data`의 그 조각을 206으로 준다. total은 `data.len()`.
struct Closed(Vec<u8>);

impl Respond for Closed {
    fn respond(&self, req: &Request) -> ResponseTemplate {
        let r = req.headers.get("range").unwrap().to_str().unwrap();
        let (a, b) = r.strip_prefix("bytes=").unwrap().split_once('-').unwrap();
        let (a, b): (usize, usize) = (a.parse().unwrap(), b.parse().unwrap());
        let b = b.min(self.0.len() - 1);
        ResponseTemplate::new(206)
            .insert_header(
                "content-range",
                format!("bytes {a}-{b}/{}", self.0.len()).as_str(),
            )
            .insert_header("content-type", "video/mp4")
            .set_body_bytes(self.0[a..=b].to_vec())
    }
}

async fn mount(server: &MockServer, r: impl Respond + 'static) {
    Mock::given(method("GET"))
        .and(path(MEDIA))
        .respond_with(r)
        .mount(server)
        .await;
}

async fn upstream_requests(server: &MockServer) -> Vec<Request> {
    server.received_requests().await.unwrap()
}

/// 요청마다 `responses[i]` 원문을 쓰고 연결을 끊는 raw TCP 서버. 받은 요청 원문들을 돌려준다.
fn raw_server(responses: Vec<Vec<u8>>) -> (String, JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let h = std::thread::spawn(move || {
        let mut seen = Vec::new();
        for resp in responses {
            let (mut s, _) = listener.accept().unwrap();
            let mut req = Vec::new();
            let mut buf = [0u8; 4096];
            while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = s.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                req.extend_from_slice(&buf[..n]);
            }
            seen.push(String::from_utf8_lossy(&req).into_owned());
            let _ = s.write_all(&resp);
            let _ = s.flush();
        }
        seen
    });
    (format!("http://{addr}"), h)
}

fn raw_206(content_range: &str, content_length: Option<usize>, body: &[u8]) -> Vec<u8> {
    let mut head = format!("HTTP/1.1 206 Partial Content\r\nContent-Range: {content_range}\r\n");
    if let Some(n) = content_length {
        head.push_str(&format!("Content-Length: {n}\r\n"));
    }
    head.push_str("Connection: close\r\n\r\n");
    let mut v = head.into_bytes();
    v.extend_from_slice(body);
    v
}

fn assert_no_secret(label: &str, s: &str) {
    assert!(
        !s.contains("hdnts") && !s.contains("SECRETSIG"),
        "{label}에 서명이 있다: {s}"
    );
}

#[tokio::test]
async fn range_206_passes_bytes_and_total() {
    let server = MockServer::start().await;
    let data = test_bytes(100, 1);
    mount(&server, Closed(data.clone())).await;
    let c = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await
        .unwrap();
    assert_eq!((c.start, c.end_incl, c.total), (0, 9, 100));
    assert_eq!(c.body, data[..10]);
    assert_eq!(c.content_type.as_deref(), Some("video/mp4"));
}

#[tokio::test]
async fn upstream_short_206_uses_upstream_end() {
    let server = MockServer::start().await;
    mount(
        &server,
        ResponseTemplate::new(206)
            .insert_header("content-range", "bytes 0-4/5")
            .set_body_bytes(vec![7u8; 5]),
    )
    .await;
    let c = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await
        .unwrap();
    assert_eq!((c.start, c.end_incl, c.total), (0, 4, 5));
    assert_eq!(c.body.len(), 5);
}

#[tokio::test]
async fn body_shorter_than_content_range_is_retry() {
    let (base, h) = raw_server(vec![raw_206("bytes 0-9/100", Some(10), &[1u8; 5])]);
    let r = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_range(&media_url(&base), 0, 9, None)
        .await;
    assert!(matches!(r, Err(WatchFail::Retry(_))), "{r:?}");
    // 조기 EOF는 같은 함수 안에서 다시 시도하지 않는다(웹뷰가 다시 요청한다)
    assert_eq!(h.join().unwrap().len(), 1);
}

#[tokio::test]
async fn eof_without_content_length_shorter_than_range_is_retry() {
    // Content-Length가 없으면 전송 오류 없이 깨끗이 끝난다. 그래도 짧으면 Retry다
    let (base, _h) = raw_server(vec![raw_206("bytes 0-9/100", None, &[1u8; 5])]);
    let r = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_range(&media_url(&base), 0, 9, None)
        .await;
    assert!(
        matches!(
            r,
            Err(WatchFail::Retry(Error::LengthMismatch {
                expected: 10,
                actual: 5
            }))
        ),
        "{r:?}"
    );
}

#[tokio::test]
async fn content_length_mismatch_is_source_changed() {
    let (base, _h) = raw_server(vec![raw_206("bytes 0-9/100", Some(8), &[1u8; 8])]);
    let r = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_range(&media_url(&base), 0, 9, None)
        .await;
    assert!(matches!(r, Err(WatchFail::SourceChanged)), "{r:?}");
}

#[tokio::test]
async fn total_differs_from_expected_is_source_changed() {
    let server = MockServer::start().await;
    mount(
        &server,
        ResponseTemplate::new(206)
            .insert_header("content-range", "bytes 0-9/200")
            .set_body_bytes(vec![1u8; 10]),
    )
    .await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, Some(100))
        .await;
    assert!(matches!(r, Err(WatchFail::SourceChanged)), "{r:?}");
    // 같은 응답이어도 기대 total이 없으면(탐색) 받아들인다
    let ok = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await
        .unwrap();
    assert_eq!(ok.total, 200);
}

#[tokio::test]
async fn end_beyond_request_is_source_changed() {
    let server = MockServer::start().await;
    mount(
        &server,
        ResponseTemplate::new(206)
            .insert_header("content-range", "bytes 0-19/100")
            .set_body_bytes(vec![1u8; 20]),
    )
    .await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await;
    assert!(matches!(r, Err(WatchFail::SourceChanged)), "{r:?}");
}

#[tokio::test]
async fn start_mismatch_is_source_changed() {
    let server = MockServer::start().await;
    mount(
        &server,
        ResponseTemplate::new(206)
            .insert_header("content-range", "bytes 5-9/100")
            .set_body_bytes(vec![1u8; 5]),
    )
    .await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await;
    assert!(matches!(r, Err(WatchFail::SourceChanged)), "{r:?}");
}

#[tokio::test]
async fn unparsable_or_missing_content_range_is_source_changed() {
    for header in [
        Some("bytes 0-9/*"),
        Some("bytes */100"),
        Some("garbage"),
        None,
    ] {
        let server = MockServer::start().await;
        let mut t = ResponseTemplate::new(206).set_body_bytes(vec![1u8; 10]);
        if let Some(h) = header {
            t = t.insert_header("content-range", h);
        }
        mount(&server, t).await;
        let r = client(&server)
            .watch_range(&media_url(&server.uri()), 0, 9, None)
            .await;
        assert!(
            matches!(r, Err(WatchFail::SourceChanged)),
            "{header:?}: {r:?}"
        );
    }
}

#[tokio::test]
async fn body_longer_than_range_is_source_changed() {
    // Content-Length 없이 Content-Range보다 많이 보내고 끊는다
    let (base, _h) = raw_server(vec![raw_206("bytes 0-9/100", None, &[1u8; 30])]);
    let r = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_range(&media_url(&base), 0, 9, None)
        .await;
    assert!(matches!(r, Err(WatchFail::SourceChanged)), "{r:?}");
}

#[tokio::test]
async fn sends_closed_range_header() {
    let server = MockServer::start().await;
    mount(&server, Closed(test_bytes(100, 2))).await;
    let c = client(&server);
    c.watch_range(&media_url(&server.uri()), 10, 19, None)
        .await
        .unwrap();
    let reqs = upstream_requests(&server).await;
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].headers.get("range").unwrap(), "bytes=10-19");
}

#[tokio::test]
async fn no_cookie_even_when_cookies_on_media() {
    let server = MockServer::start().await;
    mount(&server, Closed(test_bytes(100, 3))).await;
    let cfg = ClientConfig {
        cookies: Some(NaverCookies::new("a-fake", "s-fake")),
        cookies_on_media: true,
        ..config(&server)
    };
    Chzzk::new(cfg)
        .unwrap()
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await
        .unwrap();
    let reqs = upstream_requests(&server).await;
    assert!(reqs[0].headers.get("cookie").is_none());
    assert!(reqs[0].headers.get("referer").is_some());
    assert!(reqs[0].headers.get("user-agent").is_some());
}

#[tokio::test]
async fn no_cookie_on_watch_bytes() {
    let server = MockServer::start().await;
    mount(
        &server,
        ResponseTemplate::new(200).set_body_bytes(vec![1u8; 4]),
    )
    .await;
    let cfg = ClientConfig {
        cookies: Some(NaverCookies::new("a-fake", "s-fake")),
        cookies_on_media: true,
        ..config(&server)
    };
    Chzzk::new(cfg)
        .unwrap()
        .watch_bytes(&media_url(&server.uri()), 1024)
        .await
        .unwrap();
    let reqs = upstream_requests(&server).await;
    assert!(reqs[0].headers.get("cookie").is_none());
    assert!(reqs[0].headers.get("range").is_none());
}

#[tokio::test]
async fn upstream_200_is_range_ignored() {
    // 64 MiB를 약속하고 64 KiB씩 쓰다가, 클라이언트가 끊으면 멈춘다
    const TOTAL: usize = 64 * 1024 * 1024;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let h = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut req = Vec::new();
        let mut buf = [0u8; 4096];
        while !req.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = s.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            req.extend_from_slice(&buf[..n]);
        }
        let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {TOTAL}\r\n\r\n");
        s.write_all(head.as_bytes()).unwrap();
        let chunk = vec![0u8; 64 * 1024];
        let mut sent = 0usize;
        while sent < TOTAL {
            if s.write_all(&chunk).is_err() {
                break;
            }
            sent += chunk.len();
        }
        sent
    });
    let r = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_range(&media_url(&format!("http://{addr}")), 0, 9, None)
        .await;
    assert!(matches!(r, Err(WatchFail::RangeIgnored)), "{r:?}");
    // 단일 스레드 런타임이 연결 태스크를 돌려 소켓을 닫을 수 있게, 합류는 블로킹 풀에서 한다
    let sent = tokio::task::spawn_blocking(move || h.join().unwrap())
        .await
        .unwrap();
    assert!(sent < TOTAL / 2, "본문을 끝까지 읽었다: {sent}바이트 보냄");
}

#[tokio::test]
async fn upstream_416_reports_total() {
    let server = MockServer::start().await;
    mount(
        &server,
        ResponseTemplate::new(416).insert_header("content-range", "bytes */100"),
    )
    .await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 200, 209, None)
        .await;
    assert!(
        matches!(r, Err(WatchFail::Unsatisfiable { total: 100 })),
        "{r:?}"
    );
}

#[tokio::test]
async fn upstream_416_without_total_is_fatal() {
    let server = MockServer::start().await;
    mount(&server, ResponseTemplate::new(416)).await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 200, 209, None)
        .await;
    assert!(
        matches!(
            r,
            Err(WatchFail::Fatal(Error::HttpStatus { status: 416, .. }))
        ),
        "{r:?}"
    );
}

#[tokio::test]
async fn upstream_403_is_expired() {
    let server = MockServer::start().await;
    mount(&server, ResponseTemplate::new(403)).await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await;
    assert!(matches!(r, Err(WatchFail::Expired)), "{r:?}");
    // 403은 이 함수 안에서 다시 시도하지 않는다(재조회는 셸이 한다)
    assert_eq!(upstream_requests(&server).await.len(), 1);
}

#[tokio::test]
async fn http_5xx_retries_once_then_fatal() {
    let server = MockServer::start().await;
    mount(&server, ResponseTemplate::new(503)).await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await;
    assert!(
        matches!(
            r,
            Err(WatchFail::Fatal(Error::HttpStatus { status: 503, .. }))
        ),
        "{r:?}"
    );
    assert_eq!(upstream_requests(&server).await.len(), 2);
}

#[tokio::test]
async fn http_5xx_then_ok_succeeds() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MEDIA))
        .respond_with(ResponseTemplate::new(502))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    mount(&server, Closed(test_bytes(100, 4))).await;
    let c = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await
        .unwrap();
    assert_eq!(c.body.len(), 10);
}

#[tokio::test]
async fn http_404_is_fatal_without_retry() {
    let server = MockServer::start().await;
    mount(&server, ResponseTemplate::new(404)).await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await;
    assert!(
        matches!(
            r,
            Err(WatchFail::Fatal(Error::HttpStatus { status: 404, .. }))
        ),
        "{r:?}"
    );
    assert_eq!(upstream_requests(&server).await.len(), 1);
}

#[tokio::test]
async fn watch_bytes_caps_size() {
    let server = MockServer::start().await;
    mount(
        &server,
        ResponseTemplate::new(200).set_body_bytes(vec![1u8; 101]),
    )
    .await;
    let c = client(&server);
    let url = media_url(&server.uri());
    assert!(matches!(
        c.watch_bytes(&url, 100).await,
        Err(WatchFail::TooLarge)
    ));
    assert_eq!(c.watch_bytes(&url, 101).await.unwrap().len(), 101);
}

#[tokio::test]
async fn watch_bytes_caps_size_without_content_length() {
    // Content-Length 없이 흘려도 상한에서 끊는다
    let mut resp = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
    resp.extend_from_slice(&[1u8; 500]);
    let (base, _h) = raw_server(vec![resp]);
    let r = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_bytes(&media_url(&base), 100)
        .await;
    assert!(matches!(r, Err(WatchFail::TooLarge)), "{r:?}");
}

#[tokio::test]
async fn watch_bytes_non_success_statuses() {
    let server = MockServer::start().await;
    mount(&server, ResponseTemplate::new(403)).await;
    let r = client(&server)
        .watch_bytes(&media_url(&server.uri()), 100)
        .await;
    assert!(matches!(r, Err(WatchFail::Expired)), "{r:?}");
}

#[tokio::test]
async fn debug_has_no_signed_query() {
    let server = MockServer::start().await;
    mount(&server, Closed(test_bytes(100, 5))).await;
    let c = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await
        .unwrap();
    let s = format!("{c:?}");
    assert_no_secret("RangeChunk Debug", &s);
    assert!(s.contains("10"), "본문 길이만 찍는다: {s}");
    for f in [
        WatchFail::Expired,
        WatchFail::SourceChanged,
        WatchFail::RangeIgnored,
        WatchFail::TooLarge,
        WatchFail::Unsatisfiable { total: 1 },
        WatchFail::Fatal(Error::HttpStatus {
            status: 404,
            kind: chzzk_core::RequestKind::Media,
        }),
    ] {
        assert_no_secret("WatchFail", &format!("{f:?} {f}"));
    }
    // 실제 실패 경로에서 나온 값도 본다
    let server = MockServer::start().await;
    mount(&server, ResponseTemplate::new(404)).await;
    let e = client(&server)
        .watch_range(&media_url(&server.uri()), 0, 9, None)
        .await
        .unwrap_err();
    assert_no_secret("404 WatchFail", &format!("{e:?} {e}"));
}

#[tokio::test]
async fn transport_errors_have_no_signed_query() {
    // 연결 거부
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    drop(l);
    let e = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_range(&media_url(&format!("http://{addr}")), 0, 9, None)
        .await
        .unwrap_err();
    assert!(matches!(e, WatchFail::Retry(_)), "{e:?}");
    assert_no_secret("연결 거부", &format!("{e:?} | {e}"));

    // 본문 도중 끊김(range·bytes 둘 다)
    let (base, _h) = raw_server(vec![raw_206("bytes 0-9/100", Some(10), &[1u8; 3])]);
    let e = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_range(&media_url(&base), 0, 9, None)
        .await
        .unwrap_err();
    assert_no_secret("본문 끊김(range)", &format!("{e:?} | {e}"));
    let (base, _h) = raw_server(vec![
        b"HTTP/1.1 200 OK\r\nContent-Length: 50\r\nConnection: close\r\n\r\nabc".to_vec(),
        b"HTTP/1.1 200 OK\r\nContent-Length: 50\r\nConnection: close\r\n\r\nabc".to_vec(),
    ]);
    let e = Chzzk::new(ClientConfig::default())
        .unwrap()
        .watch_bytes(&media_url(&base), 100)
        .await
        .unwrap_err();
    assert_no_secret("본문 끊김(bytes)", &format!("{e:?} | {e}"));
}

#[tokio::test]
async fn edge_last_byte_and_probe() {
    let server = MockServer::start().await;
    let data = test_bytes(100, 6);
    mount(&server, Closed(data.clone())).await;
    let c = client(&server);
    let url = media_url(&server.uri());
    let last = c.watch_range(&url, 99, 99, Some(100)).await.unwrap();
    assert_eq!((last.start, last.end_incl, last.total), (99, 99, 100));
    assert_eq!(last.body, data[99..]);
    // open의 total 탐색: bytes=0-0, expect_total 없음
    let probe = c.watch_range(&url, 0, 0, None).await.unwrap();
    assert_eq!((probe.end_incl, probe.total), (0, 100));
    assert_eq!(probe.body.len(), 1);
}

#[tokio::test]
async fn reversed_range_is_rejected_without_request() {
    let server = MockServer::start().await;
    mount(&server, Closed(test_bytes(100, 7))).await;
    let r = client(&server)
        .watch_range(&media_url(&server.uri()), 9, 5, None)
        .await;
    assert!(matches!(r, Err(WatchFail::Fatal(_))), "{r:?}");
    assert!(upstream_requests(&server).await.is_empty());
}
