//! 루프백 로그인 수신기(worker.md 구현 중 변경 88·91, RFC 8252).
//!
//! 앱이 IPv4 루프백의 임의 포트에 1회용 수신기를 열면, Worker가 치지직 로그인 뒤 브라우저를
//! `http://127.0.0.1:<port>/chzzk-downloader/login?grant=…&state=…`로 보낸다. 수신기는 요청을 엄격하게 해석하고
//! state를 상수 시간으로 비교한 뒤 grant 하나만 서비스에 넘기고, 서비스가 정한 결과 페이지를 브라우저에 보여 준다.
//!
//! Tauri에 기대지 않는다. grant·state는 `Debug`·로그에 내지 않는다(로그는 낱말만: `loopback.reject`·`loopback.grant`).

use std::fmt;
use std::io;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use chzzk_core::Secret;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::runtime::Handle;
use tokio::sync::{Semaphore, mpsc, oneshot};
use tracing::info;

use super::token::{self, Grant};

/// 수신기가 받는 유일한 경로
pub const LOOPBACK_PATH: &str = "/chzzk-downloader/login";
/// 요청 머리를 다 읽기까지의 기한
pub const READ_TIMEOUT: Duration = Duration::from_secs(5);
/// 서비스의 결과 페이지 답장을 기다리는 기한
pub const REPLY_WAIT: Duration = Duration::from_secs(15);
/// 요청 머리 상한
pub const MAX_HEAD: usize = 8 * 1024;
/// 동시 연결 상한
pub const MAX_CONNECTIONS: usize = 8;
/// 쓸 수 있는 포트를 얻으려는 바인딩 시도 상한
pub const BIND_ATTEMPTS: usize = 5;
/// 수신기가 스스로 끝나는 상한(로그인 기한 10분 + 1분. 서비스가 닫지 못한 경우의 안전판)
pub const MAX_LIFETIME: Duration = Duration::from_secs(11 * 60);
/// 결과 페이지의 CSP 헤더 값
pub const CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/// WHATWG Fetch "port blocking"의 bad port 표(https://fetch.spec.whatwg.org/#port-blocking, 2026-10-09 원문에서 옮김)
pub const FETCH_BAD_PORTS: &[u16] = &[
    0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101,
    102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427,
    465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
    993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667,
    6668, 6669, 6679, 6697, 10080,
];

/// 1024 이상이고 Fetch bad port가 아니다(Worker가 받는 포트 범위와 브라우저가 막지 않는 포트)
pub fn is_usable_port(port: u16) -> bool {
    port >= 1024 && !FETCH_BAD_PORTS.contains(&port)
}

/// 브라우저에 보이는 결과 페이지 종류
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReceiverPage {
    /// 로그인 성공
    SignedIn,
    /// 허가되지 않은 채널
    Denied,
    /// 로그인 취소
    Cancelled,
    /// 서버 쪽 실패
    Failed,
    /// 로그인 요청을 서버가 잃음
    Lost,
    /// 결과를 알 수 없음(기다림 초과·동시 요청·답장 없음)
    Pending,
}

impl ReceiverPage {
    /// 페이지 문구(바깥 값을 끼워 넣지 않는다)
    pub fn message(self) -> &'static str {
        match self {
            ReceiverPage::SignedIn => {
                "로그인했어요. 치지직 다운로더로 돌아가세요. 이 창은 닫아도 돼요."
            }
            ReceiverPage::Denied => "허가되지 않은 채널이에요. 앱에서 안내를 확인해 주세요.",
            ReceiverPage::Cancelled => "로그인을 취소했어요. 앱에서 다시 시도할 수 있어요.",
            ReceiverPage::Failed => "로그인을 마치지 못했어요. 앱에서 다시 시도해 주세요.",
            ReceiverPage::Lost => "이 로그인 요청은 처리할 수 없어요. 앱에서 다시 시도해 주세요.",
            ReceiverPage::Pending => "앱으로 돌아가 결과를 확인해 주세요.",
        }
    }
}

/// 400·404·405 공통 문구
pub const PAGE_REJECTED: &str = "치지직 다운로더가 처리할 수 없는 요청이에요.";

/// 결과 페이지 HTML(외부 리소스 없음)
fn page_html(message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><link rel=\"icon\" href=\"data:,\"><title>치지직 다운로더</title><style>body{{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#fff;color:#111}}@media (prefers-color-scheme:dark){{body{{background:#111;color:#eee}}}}p{{max-width:28em;padding:0 16px;font-size:18px;line-height:1.5;text-align:center}}</style></head><body><p>{message}</p></body></html>"
    )
}

fn reason_phrase(code: u16) -> &'static str {
    match code {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Bad Request",
    }
}

/// 응답 바이트 전체(상태줄·헤더·본문)
fn response_bytes(code: u16, message: &str) -> Vec<u8> {
    let body = page_html(message);
    let allow = if code == 405 { "Allow: GET\r\n" } else { "" };
    let head = format!(
        "HTTP/1.1 {code} {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: {CSP}\r\n{allow}Connection: close\r\n\r\n",
        reason_phrase(code),
        body.len()
    );
    let mut out = head.into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

/// 해석한 요청(grant와 state만 보관한다. 다른 헤더 값은 버린다)
pub struct Request {
    /// 1회용 grant
    pub grant: Grant,
    /// 브라우저가 가져온 state(비교 전)
    pub state: Secret<String>,
}

impl fmt::Debug for Request {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Request(***)")
    }
}

/// 요청을 받지 않는 까닭
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reject {
    /// 요청 줄·머리 모양이 틀림
    Malformed,
    /// 머리가 8 KiB를 넘음
    TooLarge,
    /// HTTP/1.1·1.0이 아님
    Version,
    /// GET이 아님
    Method,
    /// 경로가 다름
    Path,
    /// 쿼리가 `grant`·`state` 하나씩이 아님
    Query,
    /// grant 형식이 아님
    GrantFormat,
    /// state 형식이 아님
    StateFormat,
    /// Host 헤더가 이 수신기 주소가 아님
    Host,
}

impl Reject {
    /// 응답 상태
    pub fn status(self) -> u16 {
        match self {
            Reject::Method => 405,
            Reject::Path => 404,
            _ => 400,
        }
    }

    /// 로그 낱말
    pub fn word(self) -> &'static str {
        match self {
            Reject::Malformed | Reject::TooLarge | Reject::Version | Reject::Query => "request",
            Reject::Method => "method",
            Reject::Path => "path",
            Reject::Host => "host",
            Reject::GrantFormat => "grant_format",
            Reject::StateFormat => "state",
        }
    }
}

/// 요청 머리(요청 줄부터 빈 줄까지)를 엄격하게 해석한다. `port`는 이 수신기의 포트.
/// 판정은 위에서 아래로 하고 앞에서 걸리면 거기서 끝낸다.
pub fn parse_request(head: &[u8], port: u16) -> Result<Request, Reject> {
    if head.len() > MAX_HEAD {
        return Err(Reject::TooLarge);
    }
    if !head.is_ascii() {
        return Err(Reject::Malformed);
    }
    let text = std::str::from_utf8(head).map_err(|_| Reject::Malformed)?;
    let body = text.strip_suffix("\r\n\r\n").ok_or(Reject::Malformed)?;
    // 줄 구분은 CRLF만: 나눈 줄 안에 CR·LF가 남아 있으면 맨 LF·맨 CR이다
    let mut lines = body.split("\r\n");
    let request_line = lines.next().ok_or(Reject::Malformed)?;
    let headers: Vec<&str> = lines.collect();
    if request_line.contains(['\r', '\n']) || headers.iter().any(|l| l.contains(['\r', '\n'])) {
        return Err(Reject::Malformed);
    }

    let tokens: Vec<&str> = request_line.split(' ').collect();
    let [method, target, version] = tokens[..] else {
        return Err(Reject::Malformed);
    };
    if method.is_empty() || target.is_empty() || version.is_empty() {
        return Err(Reject::Malformed);
    }
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return Err(Reject::Version);
    }
    if method != "GET" {
        return Err(Reject::Method);
    }
    let (path, query) = match target.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (target, None),
    };
    if path != LOOPBACK_PATH {
        return Err(Reject::Path);
    }

    let mut hosts: Vec<&str> = Vec::new();
    for line in &headers {
        if line.starts_with([' ', '\t']) {
            return Err(Reject::Malformed);
        }
        let Some((name, value)) = line.split_once(':') else {
            return Err(Reject::Malformed);
        };
        if name.eq_ignore_ascii_case("host") {
            hosts.push(value.trim_matches([' ', '\t']));
        }
    }
    let want = format!("127.0.0.1:{port}");
    if hosts.len() != 1 || hosts[0] != want {
        return Err(Reject::Host);
    }

    let query = query.ok_or(Reject::Query)?;
    let pairs: Vec<&str> = query.split('&').collect();
    if pairs.len() != 2 {
        return Err(Reject::Query);
    }
    let mut grant: Option<&str> = None;
    let mut state: Option<&str> = None;
    for pair in pairs {
        let Some((k, v)) = pair.split_once('=') else {
            return Err(Reject::Query);
        };
        if v.contains('=') {
            return Err(Reject::Query);
        }
        let slot = match k {
            "grant" => &mut grant,
            "state" => &mut state,
            _ => return Err(Reject::Query),
        };
        if slot.replace(v).is_some() {
            return Err(Reject::Query);
        }
    }
    let (Some(grant), Some(state)) = (grant, state) else {
        return Err(Reject::Query);
    };
    // 값은 디코딩하지 않는다: `%`·`+`가 든 값은 형식 밖이다
    let grant = Grant::parse(grant).ok_or(Reject::GrantFormat)?;
    if !token::is_secret(state) {
        return Err(Reject::StateFormat);
    }
    Ok(Request {
        grant,
        state: Secret::new(state.to_string()),
    })
}

/// 상수 시간 비교(길이가 다르면 false)
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// state를 통과한 grant 하나와 결과 페이지 답장
pub struct Delivery {
    grant: Grant,
    reply: oneshot::Sender<ReceiverPage>,
}

impl fmt::Debug for Delivery {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Delivery(***)")
    }
}

impl Delivery {
    /// grant와 답장 수신 쪽
    pub fn new(grant: Grant) -> (Delivery, oneshot::Receiver<ReceiverPage>) {
        let (reply, rx) = oneshot::channel();
        (Delivery { grant, reply }, rx)
    }

    /// 받은 grant
    pub fn grant(&self) -> &Grant {
        &self.grant
    }

    /// 브라우저에 보일 결과 페이지를 정한다(받는 쪽이 없으면 무시)
    pub fn reply(self, page: ReceiverPage) {
        let _ = self.reply.send(page);
    }
}

/// 수신기 쪽 보내기
#[derive(Clone)]
pub struct GrantTx(mpsc::Sender<Delivery>);

/// 서비스 쪽 받기
pub struct GrantRx(mpsc::Receiver<Delivery>);

/// 용량 1의 grant 줄
pub fn grant_channel() -> (GrantTx, GrantRx) {
    let (tx, rx) = mpsc::channel(1);
    (GrantTx(tx), GrantRx(rx))
}

impl GrantTx {
    /// 자리가 없거나 받는 쪽이 없으면 되돌려 준다
    pub fn try_deliver(&self, d: Delivery) -> Result<(), Delivery> {
        self.0.try_send(d).map_err(|e| match e {
            mpsc::error::TrySendError::Full(d) | mpsc::error::TrySendError::Closed(d) => d,
        })
    }

    /// 받는 쪽이 버려질 때까지
    pub async fn closed(&self) {
        self.0.closed().await;
    }
}

impl GrantRx {
    /// 다음 grant. 수신기가 끝나 보내는 쪽이 모두 없으면 None
    pub async fn recv(&mut self) -> Option<Delivery> {
        self.0.recv().await
    }
}

/// 수신기 닫기 손잡이. `close()`를 부르거나 버려지면 닫힌다
pub struct CloseHandle(Option<oneshot::Sender<()>>);

/// 수신기 쪽에서 보는 닫힘 신호
pub struct CloseSignal(oneshot::Receiver<()>);

/// 닫기 손잡이와 신호 한 쌍
pub fn close_pair() -> (CloseHandle, CloseSignal) {
    let (tx, rx) = oneshot::channel();
    (CloseHandle(Some(tx)), CloseSignal(rx))
}

impl CloseHandle {
    /// 새 연결 받기를 멈춘다
    pub fn close(mut self) {
        if let Some(tx) = self.0.take() {
            let _ = tx.send(());
        }
    }
}

impl CloseSignal {
    /// 닫힐 때까지
    pub async fn closed(&mut self) {
        let _ = (&mut self.0).await;
    }

    /// 이미 닫혔는가
    pub fn is_closed(&mut self) -> bool {
        !matches!(self.0.try_recv(), Err(oneshot::error::TryRecvError::Empty))
    }
}

/// 열린 수신기
pub struct Bound {
    /// 바인딩한 포트
    pub port: u16,
    /// grant 받는 쪽
    pub rx: GrantRx,
    /// 닫기 손잡이
    pub close: CloseHandle,
}

/// 수신기를 열지 못함
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BindError;

/// 수신기 seam(worker.md 91 (가)). state 검사는 수신기 안이다. 동기다(tokio 런타임 안에서 부른다)
pub trait GrantSource: Send + Sync + 'static {
    /// 수신기를 열고 포트·줄·닫기 손잡이를 돌려준다
    fn bind(&self, expected_state: &Secret<String>) -> Result<Bound, BindError>;
}

/// 실제 수신기
#[derive(Clone, Copy, Debug)]
pub struct LoopbackGrantSource {
    read_timeout: Duration,
    reply_wait: Duration,
}

impl Default for LoopbackGrantSource {
    fn default() -> Self {
        Self {
            read_timeout: READ_TIMEOUT,
            reply_wait: REPLY_WAIT,
        }
    }
}

impl LoopbackGrantSource {
    /// 테스트용: 기한을 줄인다
    pub fn with_timeouts(read_timeout: Duration, reply_wait: Duration) -> Self {
        Self {
            read_timeout,
            reply_wait,
        }
    }
}

/// IPv4 루프백의 임의 포트에만 바인딩한다
pub(crate) fn bind_std() -> io::Result<std::net::TcpListener> {
    std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
}

impl GrantSource for LoopbackGrantSource {
    fn bind(&self, expected_state: &Secret<String>) -> Result<Bound, BindError> {
        let std_listener = bind_std().map_err(|_| BindError)?;
        std_listener.set_nonblocking(true).map_err(|_| BindError)?;
        let handle = Handle::try_current().map_err(|_| BindError)?;
        // from_std는 런타임 컨텍스트가 필요하다
        let _enter = handle.enter();
        let listener = TcpListener::from_std(std_listener).map_err(|_| BindError)?;
        let port = listener.local_addr().map_err(|_| BindError)?.port();
        let (tx, rx) = grant_channel();
        let (close, signal) = close_pair();
        let shared = Arc::new(Shared {
            expected: expected_state.clone(),
            port,
            first: Mutex::new(None),
            tx: tx.clone(),
            read_timeout: self.read_timeout,
            reply_wait: self.reply_wait,
        });
        handle.spawn(accept_loop(listener, shared, tx, signal));
        Ok(Bound { port, rx, close })
    }
}

struct Shared {
    expected: Secret<String>,
    port: u16,
    /// 먼저 받은 grant 문자열. 다시 비우지 않는다(수령 결과가 나면 수신기도 닫힌다, 91 (나))
    first: Mutex<Option<String>>,
    tx: GrantTx,
    read_timeout: Duration,
    reply_wait: Duration,
}

async fn accept_loop(
    listener: TcpListener,
    shared: Arc<Shared>,
    tx: GrantTx,
    mut close: CloseSignal,
) {
    let permits = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let life = tokio::time::sleep(MAX_LIFETIME);
    tokio::pin!(life);
    loop {
        tokio::select! {
            () = close.closed() => return,
            () = tx.closed() => return,
            () = &mut life => return,
            res = listener.accept() => match res {
                Ok((stream, _)) => match permits.clone().try_acquire_owned() {
                    Ok(permit) => {
                        let sh = shared.clone();
                        tokio::spawn(async move {
                            handle_conn(stream, &sh).await;
                            drop(permit);
                        });
                    }
                    Err(_) => {
                        info!(reason = "full", "loopback.reject");
                        drop(stream);
                    }
                },
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            },
        }
    }
}

/// `\r\n\r\n`이 나올 때까지(상한 안에서) 읽는다. 기한·EOF·읽기 오류면 None
async fn read_head(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut buf: Vec<u8> = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            buf.truncate(pos + 4);
            return Some(buf);
        }
        if buf.len() > MAX_HEAD {
            return Some(buf);
        }
    }
}

async fn write_and_close(mut stream: TcpStream, code: u16, message: &str) {
    let bytes = response_bytes(code, message);
    let _ = stream.write_all(&bytes).await;
    let _ = stream.shutdown().await;
}

async fn handle_conn(mut stream: TcpStream, sh: &Shared) {
    let Ok(Some(head)) = tokio::time::timeout(sh.read_timeout, read_head(&mut stream)).await else {
        return;
    };
    let req = match parse_request(&head, sh.port) {
        Ok(r) => r,
        Err(r) => {
            info!(reason = r.word(), "loopback.reject");
            write_and_close(stream, r.status(), PAGE_REJECTED).await;
            return;
        }
    };
    if !ct_eq(
        req.state.expose().as_bytes(),
        sh.expected.expose().as_bytes(),
    ) {
        info!(reason = "state", "loopback.reject");
        write_and_close(stream, 400, PAGE_REJECTED).await;
        return;
    }
    // 잠금은 await를 넘기지 않는다
    let seen = {
        let mut first = sh.first.lock().unwrap_or_else(PoisonError::into_inner);
        match first.as_deref() {
            Some(g) if g == req.grant.expose() => Some("duplicate"),
            Some(_) => Some("busy"),
            None => {
                *first = Some(req.grant.expose().to_string());
                None
            }
        }
    };
    if let Some(reason) = seen {
        info!(reason, "loopback.reject");
        write_and_close(stream, 200, ReceiverPage::Pending.message()).await;
        return;
    }
    let (delivery, reply_rx) = Delivery::new(req.grant);
    if sh.tx.try_deliver(delivery).is_err() {
        info!(reason = "busy", "loopback.reject");
        write_and_close(stream, 200, ReceiverPage::Pending.message()).await;
        return;
    }
    info!("loopback.grant");
    let page = match tokio::time::timeout(sh.reply_wait, reply_rx).await {
        Ok(Ok(page)) => page,
        _ => ReceiverPage::Pending,
    };
    write_and_close(stream, 200, page.message()).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bind_std_is_ipv4_loopback() {
        let l = bind_std().unwrap();
        assert_eq!(l.local_addr().unwrap().ip(), Ipv4Addr::LOCALHOST);
    }
}
