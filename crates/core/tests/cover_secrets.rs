//! 표지 썸네일 주소의 서명 누출 검사(mp4-metadata.md §11·§13.4).
//!
//! 표지 주소의 쿼리는 서명일 수 있다(`hdnts`·토큰). 표지를 받지 못해 경고가 남는 경로에서도 로그·오류·진행률·`resolve`
//! 결과·파일 안 글자 어디에도 쿼리가 나오면 안 된다. 쿼리가 실제 요청에 실렸는지(양성 대조)를 먼저 확인한다.
//! 전역 subscriber를 쓰므로 이 바이너리에는 테스트를 **하나만** 둔다(`live_secrets.rs`와 같은 이유).

mod common;
#[path = "support/mp4.rs"]
mod mp4;

use std::io::Write;
use std::sync::{Arc, Mutex};

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, PlaybackKind,
};
use common::{Events, RangeBody, VOD_NO, VOD_VIDEO_ID, config, fixture, pd_mpd, with_thumbnail};
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const MEDIA_PATH: &str = "/m1/pd/a.mp4";
const COVER_PATH: &str = "/thumb/cover.jpg";
const QUALITY: &str = "PD_720P_TEST";

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

/// 서명 조각이 들어 있으면 그 이름을 돌려준다.
fn leaks(text: &str) -> Option<&'static str> {
    ["hmac=", "hdntl=exp", "hdnts=", "SECRETTOKEN"]
        .into_iter()
        .find(|needle| text.contains(needle))
}

#[tokio::test]
async fn cover_query_never_leaks() {
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
    let cover_url = format!(
        "{}{COVER_PATH}?hdnts=st=0~hmac=0000&token=SECRETTOKEN",
        server.uri()
    );
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            with_thumbnail(&fixture("testdata/vod/video_info.json"), Some(&cover_url)),
            "application/json",
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
        )))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            pd_mpd(
                QUALITY,
                720,
                &format!("{}{MEDIA_PATH}?_lsu_sa_=sig", server.uri()),
            ),
            "application/dash+xml",
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(fixture("testdata/vod/pd_faststart.mp4")))
        .mount(&server)
        .await;
    // 표지는 404라 "받지 못했다" 경고가 주소와 함께 남는 경로를 탄다
    Mock::given(method("GET"))
        .and(path(COVER_PATH))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;

    let chzzk = Chzzk::new(ClientConfig {
        allow_loopback_http_images: true,
        ..config(&server)
    })
    .unwrap();
    let content = ContentRef::Video { video_no: VOD_NO };
    let resolved = chzzk.resolve(&content).await.unwrap();
    let resolved_debug = format!("{resolved:?}");

    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("a.mp4");
    let req = DownloadRequest {
        embed_metadata: true,
        throttle: Default::default(),
        content,
        quality_id: QUALITY.into(),
        expected_kind: PlaybackKind::Progressive,
        output: out.clone(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: None,
        recording_id: None,
        range: None,
    };
    let events = Events::default();
    let cb = events.callback();
    let r = chzzk
        .download(req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");

    // 양성 대조: 쿼리가 표지 요청에 실제로 실렸다(대조가 아무것도 증명하지 못하면 안 된다)
    let reqs = server.received_requests().await.unwrap();
    let cover_req = reqs
        .iter()
        .find(|q| q.url.path() == COVER_PATH)
        .expect("표지 요청이 없다");
    assert!(
        cover_req.url.query().unwrap().contains("hdnts="),
        "{:?}",
        cover_req.url.query()
    );
    // 로그가 실제로 모였고, 가린 주소(경로까지)로 경고가 남았다
    let log = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(
        log.contains("chzzk_core"),
        "로그가 수집되지 않았다: {log:?}"
    );
    assert!(
        log.contains("표지를 받지 못했다") && log.contains(COVER_PATH),
        "표지 경고가 주소 없이 남았다: {log}"
    );
    // 검사기 자체의 대조: 서명이 있으면 잡는다
    assert_eq!(leaks("x?hdnts=st=0"), Some("hdnts="));
    assert_eq!(leaks("?token=SECRETTOKEN"), Some("SECRETTOKEN"));

    let progress_debug: String = events.all().iter().map(|p| format!("{p:?}\n")).collect();
    assert!(!progress_debug.is_empty());
    let file = std::fs::read(&out).unwrap();
    let items =
        mp4::ilst_items(mp4::find_path_last(&file, &["moov", "udta", "meta", "ilst"]).unwrap())
            .unwrap();
    let tag_text: String = items
        .iter()
        .map(|(_, _, v)| String::from_utf8_lossy(v).into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!tag_text.is_empty());
    for (what, text) in [
        ("로그", log),
        ("진행률 Debug", progress_debug),
        ("resolve 결과 Debug", resolved_debug),
        ("결과 Debug", format!("{r:?}")),
        ("태그 글자", tag_text),
        ("파일 바이트", String::from_utf8_lossy(&file).into_owned()),
    ] {
        assert_eq!(leaks(&text), None, "{what}에 서명이 있다: {text}");
    }
}
