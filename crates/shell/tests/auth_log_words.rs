//! 앱 로그인 로그 낱말(worker.md 구현 중 변경 88 (자)·92).
//!
//! - 루프백 수신기: 실제 `LoopbackGrantSource`에 거부 요청(grant 든 Referer의 favicon·state 불일치·Host 불일치)과
//!   정상 수령을 보낸 뒤, 로그에 grant·state·Referer·Host·포트 값이 없고 낱말만 남는지 본다.
//!   거부 줄은 수신기마다 `REJECT_LOG_LIMIT`개까지이고 나머지는 닫힐 때 요약 한 줄이다.
//! - 수령: 일시 오류 뒤의 404는 `lost_after_retry`, 첫 시도의 404는 `lost`다.
//!
//! 수신기 연결은 다른 태스크·스레드에서 돌므로 전역 subscriber로 잡는다(스레드 기본 subscriber는 병렬 테스트에서
//! callsite 관심 캐시 때문에 줄을 놓친다). 두 테스트는 서로 다른 낱말만 본다.

mod common;

use std::io::Write;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use chzzk_core::Secret;
use chzzk_shell::auth::{
    AuthReason, BeginLogin, GrantSource, LOOPBACK_PATH, LoopbackGrantSource, REJECT_LOG_LIMIT,
    ReceiverPage,
};
use common::auth::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;

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

/// 전역 subscriber를 한 번만 걸고 그 버퍼를 돌려준다
fn logs() -> LogBuf {
    static LOGS: OnceLock<LogBuf> = OnceLock::new();
    LOGS.get_or_init(|| {
        let logs = LogBuf::default();
        let w = logs.clone();
        let subscriber = tracing_subscriber::registry()
            .with(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .without_time()
                    .with_writer(move || w.clone()),
            )
            .with(Targets::new().with_target("chzzk_shell", tracing::Level::TRACE));
        tracing::subscriber::set_global_default(subscriber).unwrap();
        logs
    })
    .clone()
}

async fn exchange(port: u16, raw: String) -> u16 {
    let mut conn = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    conn.write_all(raw.as_bytes()).await.unwrap();
    let mut buf = Vec::new();
    timeout(Duration::from_secs(5), conn.read_to_end(&mut buf))
        .await
        .unwrap()
        .unwrap();
    let text = String::from_utf8_lossy(&buf);
    text.split(' ').nth(1).unwrap().parse().unwrap()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn receiver_logs_words_only_and_caps_rejects() {
    let logs = logs();

    // 카나리를 심은 grant·state(b64url 형식)
    let grant = format!("cdg_{:A<43}", "LEAKCANARYgrant");
    let state = format!("{:B<43}", "LEAKCANARYstate");
    let bad_state = format!("{:D<43}", "LEAKCANARYother");
    let referer = "http://referer-canary.invalid/page";
    let b = LoopbackGrantSource::with_timeouts(Duration::from_millis(500), Duration::from_secs(2))
        .bind(&Secret::new(state.clone()))
        .unwrap();
    let (port, mut rx, close) = (b.port, b.rx, b.close);
    let host = format!("127.0.0.1:{port}");
    let get = |st: &str, host: &str| {
        format!("GET {LOOPBACK_PATH}?grant={grant}&state={st} HTTP/1.1\r\nHost: {host}\r\n\r\n")
    };

    // 거부 셋: favicon(Referer에 grant), state 불일치, Host 불일치
    let favicon = format!(
        "GET /favicon.ico HTTP/1.1\r\nHost: {host}\r\nReferer: {referer}?grant={grant}&state={state}\r\n\r\n"
    );
    assert_eq!(exchange(port, favicon).await, 404);
    assert_eq!(exchange(port, get(&bad_state, &host)).await, 400);
    assert_eq!(
        exchange(port, get(&state, &format!("localhost:{port}"))).await,
        400
    );
    // 상한을 넘기도록 state 불일치를 더 보낸다
    let extra = REJECT_LOG_LIMIT as usize + 2;
    for _ in 0..extra {
        assert_eq!(exchange(port, get(&bad_state, &host)).await, 400);
    }
    // 거부는 아무것도 넘기지 않는다
    assert!(
        timeout(Duration::from_millis(100), rx.recv())
            .await
            .is_err()
    );

    // 정상 수령
    let client = tokio::spawn(exchange(port, get(&state, &host)));
    let d = timeout(Duration::from_secs(2), rx.recv())
        .await
        .unwrap()
        .unwrap();
    d.reply(ReceiverPage::SignedIn);
    assert_eq!(client.await.unwrap(), 200);

    // 닫으면 요약 줄이 나온다
    close.close();
    let total = 3 + extra;
    let mut log = String::new();
    for _ in 0..100 {
        log = logs.text();
        if log.contains("loopback.reject.summary") {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }

    let rejects = log
        .lines()
        .filter(|l| l.contains("loopback.reject") && !l.contains("loopback.reject.summary"))
        .count();
    assert_eq!(rejects, REJECT_LOG_LIMIT as usize, "{log}");
    let summary = log
        .lines()
        .find(|l| l.contains("loopback.reject.summary"))
        .unwrap_or_else(|| panic!("요약 줄이 없다: {log}"));
    assert!(summary.contains(&format!("count={total}")), "{summary}");
    assert!(
        summary.contains(&format!("suppressed={}", total - REJECT_LOG_LIMIT as usize)),
        "{summary}"
    );
    assert!(log.contains("loopback.grant"), "{log}");
    for word in ["path", "state", "host"] {
        assert!(log.contains(&format!("reason=\"{word}\"")), "{log}");
    }

    // 값은 하나도 없다
    for needle in [
        "LEAKCANARY",
        grant.as_str(),
        state.as_str(),
        bad_state.as_str(),
        "referer",
        "Referer",
        "favicon",
        "localhost",
        host.as_str(),
        &format!(":{port}"),
        &format!("={port}"),
    ] {
        assert!(!log.contains(needle), "로그에 {needle:?}가 있다: {log}");
    }
}

/// 일시 오류 뒤의 404는 앞 시도가 서버에서 이미 끝났을 수 있어 낱말을 따로 둔다(worker.md 93 (가))
#[tokio::test(start_paused = true)]
async fn redeem_404_after_retry_has_its_own_word() {
    let logs = logs();
    for transient_first in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let api = FakeWorkerApi::default();
        let clock = FakeClock::at(t0());
        let grants = FakeGrantSource::default();
        let svc = service(dir.path(), &api, &clock, &grants);
        api.push_start(Reply::Now(Ok(start_ok(&base()))));
        assert!(matches!(svc.begin_login().await, BeginLogin::Started(_)));
        if transient_first {
            api.push_redeem(Reply::Now(Err(transport())));
        }
        api.push_redeem(Reply::Now(Err(worker(404, "not_found"))));
        let page = grants.deliver(&grant_str());
        let s = svc.run_login_wait().await;
        assert_eq!(s.reason, Some(AuthReason::LoginLost));
        assert_eq!(page.await.unwrap(), ReceiverPage::Lost);
    }
    let log = logs.text();
    let ends: Vec<&str> = log.lines().filter(|l| l.contains("로그인 끝")).collect();
    let count = |w: &str| {
        ends.iter()
            .filter(|l| l.contains(&format!("result=\"{w}\"")))
            .count()
    };
    assert_eq!((count("lost"), count("lost_after_retry")), (1, 1), "{log}");
}
