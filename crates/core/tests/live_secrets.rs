//! 생방송 서명 누출 검사(core.md 61 F5, 설계 live-audit (5)).
//!
//! 생방송의 서명(`hdnts` 쿼리, `hdntl=…~hmac=…` 경로 토큰)이 로그·오류·진행률·sidecar·`resolve` 결과의 `Debug`
//! 어디에도 나오지 않는지 본다. 서명이 실제로 요청에 실렸는지(양성 대조)를 먼저 확인한다.
//! 전역 subscriber를 쓰므로 이 바이너리에는 테스트를 **하나만** 둔다(셸 `secrets.rs`와 같은 이유).

mod common;

use std::io::Write;
use std::num::NonZeroU8;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadRequest, DuplicatePolicy, Error,
    PlaybackKind,
};
use common::{Events, config, fixture, part_files, rewrite_hosts};
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const CHANNEL: &str = "000000000000000000000000000000e5";
const DETAIL_PATH: &str = "/service/v3/channels/000000000000000000000000000000e5/live-detail";
const DIR: &str = "/live/kr/streamkey0";
/// 경로 토큰(합성 값). 실제 서명은 아니다
const TOKEN_DIR: &str = "hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=0000";

/// 로그를 모으는 writer.
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

/// 16바이트 fMP4 상자(`ftyp`·`styp`)
fn box16(kind: &[u8; 4]) -> Vec<u8> {
    let mut v = vec![0, 0, 0, 16];
    v.extend_from_slice(kind);
    v.extend_from_slice(&[7u8; 8]);
    v
}

/// 서명 조각이 들어 있으면 그 이름을 돌려준다.
fn leaks(text: &str) -> Option<&'static str> {
    ["hmac=", "hdntl=exp", "hdnts="]
        .into_iter()
        .find(|needle| text.contains(needle))
}

#[tokio::test]
async fn live_signatures_never_leak() {
    let logs = LogBuf::default();
    let w = logs.clone();
    let subscriber = tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(move || w.clone()),
        )
        .with(
            Targets::new()
                .with_default(tracing::Level::INFO)
                .with_target("chzzk_core", tracing::Level::TRACE),
        );
    tracing::subscriber::set_global_default(subscriber).unwrap();

    let server = MockServer::start().await;
    let uri = server.uri();
    let details = Arc::new(AtomicUsize::new(0));
    let polls = Arc::new(AtomicUsize::new(0));

    // live-detail: 처음은 방송 중(master 주소에 `hdnts` 서명), 재조회는 500
    let (d, u) = (details.clone(), uri.clone());
    Mock::given(method("GET"))
        .and(path(DETAIL_PATH))
        .respond_with(move |_: &Request| {
            if d.fetch_add(1, Ordering::SeqCst) == 0 {
                let b = rewrite_hosts(&fixture("testdata/live/live_detail.json"), &u);
                ResponseTemplate::new(200).set_body_raw(b, "application/json")
            } else {
                ResponseTemplate::new(500)
            }
        })
        .mount(&server)
        .await;
    // master: variant 주소가 경로 토큰을 품는다
    Mock::given(method("GET"))
        .and(path(format!("{DIR}/hls_playlist.m3u8")))
        .respond_with(ResponseTemplate::new(200).set_body_string(format!(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=256x144\n{TOKEN_DIR}/144p/chunklist.m3u8\n"
        )))
        .mount(&server)
        .await;
    // media playlist: 두 번은 창 2개, 그 뒤는 서명 만료(403)
    let p = polls.clone();
    Mock::given(method("GET"))
        .and(path_regex(r"/hdntl=.*/144p/chunklist\.m3u8$"))
        .respond_with(move |_: &Request| {
            let n = p.fetch_add(1, Ordering::SeqCst);
            if n >= 2 {
                return ResponseTemplate::new(403);
            }
            let mut t = format!(
                "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:{n}\n#EXT-X-MAP:URI=\"init.mp4?t=1\"\n"
            );
            for m in n..n + 2 {
                t.push_str(&format!("#EXTINF:2.000,\nseg{m}.m4v?t=1\n"));
            }
            ResponseTemplate::new(200).set_body_string(t)
        })
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path_regex(r"/hdntl=.*/144p/init\.mp4$"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(box16(b"ftyp")))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path_regex(r"/hdntl=.*/144p/seg\d+\.m4v$"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(box16(b"styp")))
        .mount(&server)
        .await;

    let cfg = ClientConfig {
        live_poll_interval: Duration::from_millis(1),
        live_idle_check: Duration::from_millis(60),
        ..config(&server)
    };
    let chzzk = Chzzk::new(cfg).unwrap();
    let content = ContentRef::Live {
        channel_id: CHANNEL.into(),
    };

    // `resolve` 결과의 Debug(`Source::Live`는 Debug를 손으로 구현한다)
    let resolved = chzzk.resolve(&content).await.unwrap();
    let resolved_debug = format!("{resolved:?}");
    assert!(resolved_debug.contains("Live"), "{resolved_debug}");
    details.store(0, Ordering::SeqCst); // 이어지는 다운로드의 첫 조회도 방송 중이어야 한다

    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("[생방송] 채널 - 제목.mp4");
    let req = DownloadRequest {
        content,
        quality_id: "144p".into(),
        expected_kind: PlaybackKind::Live,
        output: out.clone(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: NonZeroU8::new(2).unwrap(),
        live_stop: None,
        recording_id: Some("a".repeat(32)),
        range: None,
    };
    let events = Events::default();
    let cb = events.callback();
    let r = chzzk
        .download(req, CancellationToken::new(), &cb)
        .await
        .unwrap_err();

    // 서명 403 → 재조회가 500이라 오류로 끝난다. 받은 부분은 남는다
    assert!(matches!(r, Error::HttpStatus { status: 500, .. }), "{r:?}");
    let (part, sidecar) = part_files(&out);
    assert!(
        part.exists() && sidecar.exists(),
        "{}",
        String::from_utf8(logs.0.lock().unwrap().clone()).unwrap()
    );

    // 양성 대조: 서명 경로를 실제로 탔다
    let reqs = server.received_requests().await.unwrap();
    assert!(
        reqs.iter().any(|q| q.url.path().contains("hdntl=")),
        "경로 토큰 요청이 없다: 대조가 아무것도 증명하지 못한다"
    );
    assert!(
        reqs.iter().any(|q| q.url.path().contains("/seg")),
        "세그먼트 요청이 없다"
    );
    // 로그 수집이 실제로 동작한다
    let log = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(
        log.contains("chzzk_core"),
        "로그가 수집되지 않았다: {log:?}"
    );

    let progress_debug: String = events.all().iter().map(|p| format!("{p:?}\n")).collect();
    assert!(!progress_debug.is_empty());
    let sidecar_json = std::fs::read_to_string(&sidecar).unwrap();
    // 검사기 자체의 대조: 서명이 있으면 잡는다
    assert_eq!(leaks("x?hdnts=st=0"), Some("hdnts="));
    assert_eq!(leaks("/hdntl=exp=0~hmac=00/"), Some("hmac="));
    for (what, text) in [
        ("로그", log),
        ("오류 Display", format!("{r}")),
        ("오류 Debug", format!("{r:?}")),
        ("진행률 Debug", progress_debug),
        ("sidecar", sidecar_json),
        ("resolve 결과 Debug", resolved_debug),
    ] {
        assert_eq!(leaks(&text), None, "{what}에 서명이 있다: {text}");
    }
}
