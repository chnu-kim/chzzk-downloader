//! 루프백 수신기(worker.md 구현 중 변경 88·92): 요청 해석 표, 결과 페이지, 실제 소켓 동작.
//!
//! 소켓 테스트는 기한을 줄인 `LoopbackGrantSource`와 tokio `TcpStream` 클라이언트로 돈다.

use std::time::Duration;

use chzzk_core::Secret;
use chzzk_shell::auth::token::{self, Grant};
use chzzk_shell::auth::{
    BindError, Delivery, FETCH_BAD_PORTS, GrantSource, LOOPBACK_PATH, LoopbackGrantSource,
    MAX_CONNECTIONS, ReceiverPage, Reject, is_usable_port, parse_request,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

const LOOPBACK_VECTORS: &str = include_str!("../../../worker/test/vectors/loopback-vectors.json");

fn grant() -> String {
    format!("cdg_{}", "A".repeat(43))
}
fn other_grant() -> String {
    format!("cdg_{}", "C".repeat(43))
}
fn state() -> String {
    "B".repeat(43)
}

fn get(port: u16, grant: &str, state: &str) -> String {
    format!(
        "GET {LOOPBACK_PATH}?grant={grant}&state={state} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"
    )
}

// ---------------------------------------------------------------- 요청 해석(순수)

fn head(line: &str, headers: &[&str]) -> Vec<u8> {
    let mut s = format!("{line}\r\n");
    for h in headers {
        s.push_str(h);
        s.push_str("\r\n");
    }
    s.push_str("\r\n");
    s.into_bytes()
}

#[test]
fn parse_request_table() {
    let p = 50000u16;
    let host = format!("Host: 127.0.0.1:{p}");
    let (g, s) = (grant(), state());
    let ok_line = format!("GET {LOOPBACK_PATH}?grant={g}&state={s} HTTP/1.1");
    let q = |query: &str| format!("GET {LOOPBACK_PATH}{query} HTTP/1.1");
    let long_header = format!("X-Pad: {}", "a".repeat(9000));

    let ok: Vec<(&str, Vec<u8>)> = vec![
        ("1.1", head(&ok_line, &[&host])),
        (
            "1.0",
            head(
                &format!("GET {LOOPBACK_PATH}?grant={g}&state={s} HTTP/1.0"),
                &[&host],
            ),
        ),
        (
            "순서 반대",
            head(&q(&format!("?state={s}&grant={g}")), &[&host]),
        ),
        (
            "host 소문자",
            head(&ok_line, &[&format!("host: 127.0.0.1:{p}")]),
        ),
        (
            "HOST 대문자",
            head(&ok_line, &[&format!("HOST: 127.0.0.1:{p}")]),
        ),
        (
            "OWS",
            head(&ok_line, &[&format!("Host: \t 127.0.0.1:{p} \t")]),
        ),
        (
            "다른 헤더(Referer에 grant)",
            head(
                &ok_line,
                &[&host, &format!("Referer: https://x.invalid/?grant={g}")],
            ),
        ),
    ];
    for (name, h) in ok {
        let r = parse_request(&h, p).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        assert_eq!(r.grant.expose(), g, "{name}");
        assert_eq!(r.state.expose(), &s, "{name}");
    }

    let rows: Vec<(&str, Vec<u8>, Reject)> = vec![
        (
            "Version 2",
            head(
                &format!("GET {LOOPBACK_PATH}?grant={g}&state={s} HTTP/2"),
                &[&host],
            ),
            Reject::Version,
        ),
        (
            "Version 0.9",
            head(
                &format!("GET {LOOPBACK_PATH}?grant={g}&state={s} HTTP/0.9"),
                &[&host],
            ),
            Reject::Version,
        ),
        (
            "POST",
            head(
                &format!("POST {LOOPBACK_PATH}?grant={g}&state={s} HTTP/1.1"),
                &[&host],
            ),
            Reject::Method,
        ),
        (
            "HEAD",
            head(
                &format!("HEAD {LOOPBACK_PATH}?grant={g}&state={s} HTTP/1.1"),
                &[&host],
            ),
            Reject::Method,
        ),
        (
            "favicon",
            head("GET /favicon.ico HTTP/1.1", &[&host]),
            Reject::Path,
        ),
        (
            "끝 슬래시",
            head(
                &format!("GET {LOOPBACK_PATH}/?grant={g}&state={s} HTTP/1.1"),
                &[&host],
            ),
            Reject::Path,
        ),
        (
            "대문자 경로",
            head(
                &format!("GET /Chzzk-Downloader/login?grant={g}&state={s} HTTP/1.1"),
                &[&host],
            ),
            Reject::Path,
        ),
        (
            "절대형",
            head(
                &format!("GET http://127.0.0.1:{p}{LOOPBACK_PATH}?grant={g}&state={s} HTTP/1.1"),
                &[&host],
            ),
            Reject::Path,
        ),
        (
            "경로가 Host보다 먼저",
            head("GET /x HTTP/1.1", &["Host: evil.invalid"]),
            Reject::Path,
        ),
        ("쿼리 없음", head(&q(""), &[&host]), Reject::Query),
        (
            "키 하나",
            head(&q(&format!("?grant={g}")), &[&host]),
            Reject::Query,
        ),
        (
            "추가 키",
            head(&q(&format!("?grant={g}&state={s}&x=1")), &[&host]),
            Reject::Query,
        ),
        (
            "grant 중복",
            head(&q(&format!("?grant={g}&grant={g}")), &[&host]),
            Reject::Query,
        ),
        (
            "모르는 키",
            head(&q(&format!("?grant={g}&other={s}")), &[&host]),
            Reject::Query,
        ),
        (
            "= 없음",
            head(&q(&format!("?grant&state={s}")), &[&host]),
            Reject::Query,
        ),
        (
            "값에 =",
            head(&q(&format!("?grant={g}=&state={s}")), &[&host]),
            Reject::Query,
        ),
        (
            "grant 접두",
            head(
                &q(&format!("?grant=cdx_{}&state={s}", "A".repeat(43))),
                &[&host],
            ),
            Reject::GrantFormat,
        ),
        (
            "grant 42자",
            head(
                &q(&format!("?grant=cdg_{}&state={s}", "A".repeat(42))),
                &[&host],
            ),
            Reject::GrantFormat,
        ),
        (
            "grant %",
            head(
                &q(&format!("?grant=cdg_{}%41&state={s}", "A".repeat(41))),
                &[&host],
            ),
            Reject::GrantFormat,
        ),
        (
            "grant +",
            head(
                &q(&format!("?grant=cdg_{}+&state={s}", "A".repeat(42))),
                &[&host],
            ),
            Reject::GrantFormat,
        ),
        (
            "grant 빈 값",
            head(&q(&format!("?grant=&state={s}")), &[&host]),
            Reject::GrantFormat,
        ),
        (
            "state 42자",
            head(
                &q(&format!("?grant={g}&state={}", "B".repeat(42))),
                &[&host],
            ),
            Reject::StateFormat,
        ),
        (
            "state %",
            head(
                &q(&format!("?grant={g}&state={}%41", "B".repeat(41))),
                &[&host],
            ),
            Reject::StateFormat,
        ),
        ("Host 없음", head(&ok_line, &[]), Reject::Host),
        ("Host 둘", head(&ok_line, &[&host, &host]), Reject::Host),
        (
            "Host 포트 없음",
            head(&ok_line, &["Host: 127.0.0.1"]),
            Reject::Host,
        ),
        (
            "Host localhost",
            head(&ok_line, &[&format!("Host: localhost:{p}")]),
            Reject::Host,
        ),
        (
            "Host 다른 포트",
            head(&ok_line, &[&format!("Host: 127.0.0.1:{}", p + 1)]),
            Reject::Host,
        ),
        (
            "Host가 쿼리보다 먼저",
            head(&q("?x=1"), &["Host: evil.invalid"]),
            Reject::Host,
        ),
        (
            "콜론 없는 헤더",
            head(&ok_line, &[&host, "NoColonHere"]),
            Reject::Malformed,
        ),
        (
            "obs-fold",
            head(&ok_line, &[&host, " folded: x"]),
            Reject::Malformed,
        ),
        (
            "비ASCII",
            head(&ok_line, &[&host, "X-Name: 한글"]),
            Reject::Malformed,
        ),
        (
            "LF만",
            format!("{ok_line}\n{host}\n\n").into_bytes(),
            Reject::Malformed,
        ),
        (
            "요청 줄 토큰 둘",
            head(&format!("GET {LOOPBACK_PATH}"), &[&host]),
            Reject::Malformed,
        ),
        ("빈 요청", b"\r\n\r\n".to_vec(), Reject::Malformed),
        (
            "머리 끝 없음",
            ok_line.clone().into_bytes(),
            Reject::Malformed,
        ),
        (
            "8 KiB 초과",
            head(&ok_line, &[&host, &long_header]),
            Reject::TooLarge,
        ),
    ];
    for (name, h, want) in rows {
        match parse_request(&h, p) {
            Ok(_) => panic!("{name}: 받으면 안 된다"),
            Err(e) => assert_eq!(e, want, "{name}"),
        }
    }
}

#[test]
fn reject_status_and_words() {
    use Reject::*;
    for (r, status, word) in [
        (Malformed, 400, "request"),
        (TooLarge, 400, "request"),
        (Version, 400, "request"),
        (Query, 400, "request"),
        (Method, 405, "method"),
        (Path, 404, "path"),
        (Host, 400, "host"),
        (GrantFormat, 400, "grant_format"),
        (StateFormat, 400, "state"),
    ] {
        assert_eq!((r.status(), r.word()), (status, word), "{r:?}");
    }
}

#[test]
fn kat_url_rows_parse() {
    let v: serde_json::Value = serde_json::from_str(LOOPBACK_VECTORS).unwrap();
    let rows = v["url"].as_array().unwrap();
    assert!(!rows.is_empty());
    for r in rows {
        let port = r["port"].as_u64().unwrap() as u16;
        let url = r["url"].as_str().unwrap();
        let rest = url
            .strip_prefix(&format!("http://127.0.0.1:{port}"))
            .unwrap();
        let h = head(
            &format!("GET {rest} HTTP/1.1"),
            &[&format!("Host: 127.0.0.1:{port}")],
        );
        let req = parse_request(&h, port).unwrap();
        assert_eq!(req.grant.expose(), r["grant"].as_str().unwrap());
        assert_eq!(req.state.expose(), r["state"].as_str().unwrap());
    }
}

#[test]
fn is_usable_port_table() {
    assert!(!is_usable_port(1023));
    assert!(is_usable_port(1024));
    assert!(is_usable_port(65535));
    assert!(is_usable_port(50000));
    for p in FETCH_BAD_PORTS {
        assert!(!is_usable_port(*p), "{p}");
    }
    let v: serde_json::Value = serde_json::from_str(LOOPBACK_VECTORS).unwrap();
    for p in v["portValid"].as_array().unwrap() {
        let p = p.as_u64().unwrap() as u16;
        if !FETCH_BAD_PORTS.contains(&p) {
            assert!(is_usable_port(p), "{p}");
        }
    }
}

#[test]
fn pages_are_fixed_strings() {
    for (p, m) in [
        (
            ReceiverPage::SignedIn,
            "로그인했어요. VOD 클립 다운로더 앱으로 돌아가 주세요. 이 창은 닫아도 돼요.",
        ),
        (
            ReceiverPage::Denied,
            "이 채널은 사용 허가가 없어요. 앱에서 안내를 확인해 주세요.",
        ),
        (
            ReceiverPage::Cancelled,
            "로그인을 취소했어요. 앱에서 다시 로그인할 수 있어요.",
        ),
        (
            ReceiverPage::Failed,
            "로그인하지 못했어요. 앱에서 다시 시도해 주세요.",
        ),
        (
            ReceiverPage::Lost,
            "이 로그인 요청은 처리할 수 없어요. 앱에서 다시 로그인해 주세요.",
        ),
        (ReceiverPage::Pending, "앱으로 돌아가 결과를 확인해 주세요."),
    ] {
        assert_eq!(p.message(), m);
    }
}

#[test]
fn debug_hides_secrets() {
    let g = format!("cdg_{}", "Q".repeat(43));
    let s = "Z".repeat(43);
    let grant = Grant::parse(&g).unwrap();
    assert_eq!(format!("{grant:?}"), "Grant(***)");
    let req = parse_request(get(1234, &g, &s).as_bytes(), 1234).unwrap();
    let (d, _rx) = Delivery::new(grant.clone());
    for t in [format!("{req:?}"), format!("{d:?}"), format!("{grant:?}")] {
        assert!(t.contains("***"), "{t}");
        assert!(!t.contains('Q') && !t.contains('Z'), "{t}");
    }
}

#[test]
fn source_binds_ipv4_loopback_only() {
    let src = include_str!("../src/auth/loopback.rs");
    assert!(src.contains("Ipv4Addr::LOCALHOST"));
    for bad in ["0.0.0.0", "Ipv6Addr", "\"localhost\"", "UNSPECIFIED"] {
        assert!(!src.contains(bad), "{bad}");
    }
}

#[test]
fn bind_outside_runtime_fails() {
    let r = LoopbackGrantSource::default().bind(&Secret::new(state()));
    assert!(matches!(r, Err(BindError)));
}

// ---------------------------------------------------------------- 실제 소켓

struct Resp {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Resp {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

async fn read_all(conn: &mut TcpStream) -> Option<Resp> {
    let mut buf = Vec::new();
    timeout(Duration::from_secs(5), conn.read_to_end(&mut buf))
        .await
        .ok()?
        .ok();
    if buf.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    let (head, body) = text.split_once("\r\n\r\n")?;
    let mut lines = head.split("\r\n");
    let status = lines.next()?.split(' ').nth(1)?.parse().ok()?;
    let headers = lines
        .filter_map(|l| l.split_once(": "))
        .map(|(k, v)| (k.to_ascii_lowercase(), v.to_string()))
        .collect();
    Some(Resp {
        status,
        headers,
        body: body.to_string(),
    })
}

async fn exchange(port: u16, raw: String) -> Option<Resp> {
    let mut conn = TcpStream::connect(("127.0.0.1", port)).await.ok()?;
    conn.write_all(raw.as_bytes()).await.ok()?;
    read_all(&mut conn).await
}

fn bound(
    read: Duration,
    reply: Duration,
) -> (
    u16,
    chzzk_shell::auth::GrantRx,
    chzzk_shell::auth::CloseHandle,
) {
    let b = LoopbackGrantSource::with_timeouts(read, reply)
        .bind(&Secret::new(state()))
        .unwrap();
    (b.port, b.rx, b.close)
}

fn quick() -> (
    u16,
    chzzk_shell::auth::GrantRx,
    chzzk_shell::auth::CloseHandle,
) {
    bound(Duration::from_millis(200), Duration::from_millis(300))
}

async fn refused_within(port: u16, d: Duration) -> bool {
    let end = tokio::time::Instant::now() + d;
    while tokio::time::Instant::now() < end {
        if TcpStream::connect(("127.0.0.1", port)).await.is_err() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    false
}

fn assert_page_headers(r: &Resp) {
    let mut names: Vec<&str> = r.headers.iter().map(|(k, _)| k.as_str()).collect();
    names.sort_unstable();
    let mut want = vec![
        "cache-control",
        "connection",
        "content-length",
        "content-security-policy",
        "content-type",
        "referrer-policy",
        "x-content-type-options",
    ];
    if r.status == 405 {
        want.push("allow");
        want.sort_unstable();
    }
    assert_eq!(names, want);
    assert_eq!(r.header("content-type"), Some("text/html; charset=utf-8"));
    assert_eq!(r.header("cache-control"), Some("no-store"));
    assert_eq!(r.header("referrer-policy"), Some("no-referrer"));
    assert_eq!(r.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(r.header("connection"), Some("close"));
    assert_eq!(
        r.header("content-security-policy"),
        Some(chzzk_shell::auth::CSP)
    );
    assert_eq!(
        r.header("content-length")
            .unwrap()
            .parse::<usize>()
            .unwrap(),
        r.body.len()
    );
    assert!(r.body.contains("<link rel=\"icon\" href=\"data:,\">"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn good_get_delivers_and_writes_result_page() {
    let (port, mut rx, _close) = quick();
    let client = tokio::spawn(exchange(port, get(port, &grant(), &state())));
    let d = timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(d.grant().expose(), grant());
    d.reply(ReceiverPage::SignedIn);
    let r = client.await.unwrap().unwrap();
    assert_eq!(r.status, 200);
    assert_page_headers(&r);
    assert!(r.body.contains(ReceiverPage::SignedIn.message()));
    assert!(!r.body.contains("http") && !r.body.contains("//") && !r.body.contains("<script"));
    assert!(
        r.headers
            .iter()
            .all(|(k, _)| !k.starts_with("access-control-"))
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rejects_keep_listening_and_deliver_nothing() {
    let (port, mut rx, _close) = quick();
    let g = grant();
    let host = format!("127.0.0.1:{port}");
    let cases: Vec<(u16, String)> = vec![
        (
            405,
            format!(
                "POST {LOOPBACK_PATH}?grant={g}&state={} HTTP/1.1\r\nHost: {host}\r\n\r\n",
                state()
            ),
        ),
        (
            404,
            format!(
                "GET /favicon.ico HTTP/1.1\r\nHost: {host}\r\nReferer: http://x.invalid/?grant={g}\r\n\r\n"
            ),
        ),
        (
            400,
            format!(
                "GET {LOOPBACK_PATH}?grant={g}&state={} HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n",
                state()
            ),
        ),
        (400, get(port, &g, &"D".repeat(43))),
    ];
    for (status, raw) in cases {
        let r = exchange(port, raw).await.unwrap();
        assert_eq!(r.status, status);
        assert_page_headers(&r);
        assert!(r.body.contains(chzzk_shell::auth::PAGE_REJECTED));
    }
    assert!(
        timeout(Duration::from_millis(100), rx.recv())
            .await
            .is_err()
    );
    let client = tokio::spawn(exchange(port, get(port, &g, &state())));
    let d = timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    d.reply(ReceiverPage::Denied);
    assert!(
        client
            .await
            .unwrap()
            .unwrap()
            .body
            .contains(ReceiverPage::Denied.message())
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn many_state_mismatches_then_good_passes() {
    let (port, mut rx, _close) = quick();
    for _ in 0..5 {
        let r = exchange(port, get(port, &grant(), &"D".repeat(43)))
            .await
            .unwrap();
        assert_eq!(r.status, 400);
    }
    let client = tokio::spawn(exchange(port, get(port, &grant(), &state())));
    let d = timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    d.reply(ReceiverPage::SignedIn);
    assert_eq!(client.await.unwrap().unwrap().status, 200);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn idle_connection_does_not_block_others() {
    let (port, mut rx, _close) = bound(Duration::from_secs(5), Duration::from_secs(5));
    let _idle = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let client = tokio::spawn(exchange(port, get(port, &grant(), &state())));
    let d = timeout(Duration::from_secs(1), rx.recv())
        .await
        .unwrap()
        .unwrap();
    d.reply(ReceiverPage::SignedIn);
    assert_eq!(client.await.unwrap().unwrap().status, 200);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ninth_connection_gets_503() {
    let (port, _rx, _close) = bound(Duration::from_secs(5), Duration::from_secs(5));
    let mut idle = Vec::new();
    for _ in 0..MAX_CONNECTIONS {
        idle.push(TcpStream::connect(("127.0.0.1", port)).await.unwrap());
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    let mut ninth = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut buf = Vec::new();
    let _ = timeout(Duration::from_secs(2), ninth.read_to_end(&mut buf))
        .await
        .expect("9번째 연결은 503을 받고 바로 닫혀야 한다");
    let text = String::from_utf8_lossy(&buf);
    assert!(text.starts_with("HTTP/1.1 503 "), "{text}");
    assert!(text.contains(ReceiverPage::Pending.message()));
    drop(idle);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn slow_head_times_out() {
    let (port, _rx, _close) = quick();
    let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    conn.write_all(b"GET /chzzk-down").await.unwrap();
    let mut buf = Vec::new();
    let n = timeout(Duration::from_secs(2), conn.read_to_end(&mut buf))
        .await
        .expect("읽기 기한 뒤 닫혀야 한다");
    assert!(n.is_err() || buf.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn second_request_while_processing_gets_pending_page() {
    let (port, mut rx, _close) = bound(Duration::from_millis(200), Duration::from_secs(5));
    let first = tokio::spawn(exchange(port, get(port, &grant(), &state())));
    let d = timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    let same = exchange(port, get(port, &grant(), &state())).await.unwrap();
    assert_eq!(same.status, 200);
    assert!(same.body.contains(ReceiverPage::Pending.message()));
    let other = exchange(port, get(port, &other_grant(), &state()))
        .await
        .unwrap();
    assert_eq!(other.status, 200);
    assert!(other.body.contains(ReceiverPage::Pending.message()));
    assert!(
        timeout(Duration::from_millis(100), rx.recv())
            .await
            .is_err()
    );
    d.reply(ReceiverPage::SignedIn);
    let r = first.await.unwrap().unwrap();
    assert!(r.body.contains(ReceiverPage::SignedIn.message()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn reply_timeout_and_dropped_sender_give_pending_page() {
    // 답하지 않으면 답장 기한 뒤 기다림 페이지
    let (port, mut rx, _close) = quick();
    let client = tokio::spawn(exchange(port, get(port, &grant(), &state())));
    let d = timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    let r = client.await.unwrap().unwrap();
    assert_eq!(r.status, 200);
    assert!(r.body.contains(ReceiverPage::Pending.message()));
    drop(d);
    // Delivery를 버리면 바로 기다림 페이지
    let (port, mut rx, _close) = bound(Duration::from_millis(200), Duration::from_secs(5));
    let client = tokio::spawn(exchange(port, get(port, &grant(), &state())));
    let d = timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    drop(d);
    let r = client.await.unwrap().unwrap();
    assert!(r.body.contains(ReceiverPage::Pending.message()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn close_stops_accept_but_in_flight_page_is_written() {
    let (port, mut rx, close) = bound(Duration::from_millis(200), Duration::from_secs(5));
    let client = tokio::spawn(exchange(port, get(port, &grant(), &state())));
    let d = timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    close.close();
    assert!(refused_within(port, Duration::from_secs(1)).await);
    d.reply(ReceiverPage::SignedIn);
    let r = client.await.unwrap().unwrap();
    assert!(r.body.contains(ReceiverPage::SignedIn.message()));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropping_grant_rx_stops_receiver() {
    let (port, rx, _close) = quick();
    drop(rx);
    assert!(refused_within(port, Duration::from_secs(1)).await);
}

#[test]
fn token_state_matches_loopback_state() {
    // 수신기에 넘기는 state는 토큰 계약의 loopback_state다(공유 KAT는 auth_token.rs)
    let v = token::login_verifier("x");
    assert!(token::is_secret(&token::loopback_state(&v)));
}
