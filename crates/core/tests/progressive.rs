//! progressive(PD mp4) 다운로드 통합 테스트(설계 §5.3, §8.1 §8.2 이식, §8.2 progressive).
//! 네트워크는 wiremock과 로컬 raw TCP뿐이다.

mod common;

use chzzk_core::download::part::{PartFile, ProgressiveState, Sidecar};
use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, Error, NaverCookies, Phase, PlaybackKind, RequestKind, RetryPolicy,
};
use common::{
    Events, RangeBody, VOD_NO, VOD_VIDEO_ID, config, fixture, part_files, pd_mpd, test_bytes,
    truncating_server,
};
use std::path::{Path, PathBuf};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const QUALITY: &str = "PD_720P_TEST";
const MEDIA_PATH: &str = "/m1/pd/a.mp4";
const SIZE: usize = 140_000;

fn content() -> ContentRef {
    ContentRef::Video { video_no: VOD_NO }
}

fn request(out: &Path) -> DownloadRequest {
    DownloadRequest {
        content: content(),
        quality_id: QUALITY.into(),
        expected_kind: PlaybackKind::Progressive,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
    }
}

/// info(VOD fixture)를 mount한다.
async fn mount_info(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("testdata/vod/video_info.json"), "application/json"),
        )
        .mount(server)
        .await;
}

/// MPD를 mount한다. `times`가 있으면 그 횟수만 응답한다(먼저 mount한 것이 먼저 쓰인다).
async fn mount_mpd(server: &MockServer, media_url: &str, times: Option<u64>) {
    let mut m = Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
        )))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            pd_mpd(QUALITY, 720, &format!("{media_url}?_lsu_sa_=sig")),
            "application/dash+xml",
        ));
    if let Some(n) = times {
        m = m.up_to_n_times(n);
    }
    m.mount(server).await;
}

/// info + MPD(미디어는 같은 서버의 `MEDIA_PATH`).
async fn setup(server: &MockServer) {
    mount_info(server).await;
    mount_mpd(server, &format!("{}{MEDIA_PATH}", server.uri()), None).await;
}

async fn media_requests(server: &MockServer, prefix: &str) -> Vec<Request> {
    server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.url.path().starts_with(prefix))
        .collect()
}

fn header<'a>(r: &'a Request, name: &str) -> Option<&'a str> {
    r.headers.get(name).map(|v| v.to_str().unwrap())
}

async fn download(
    cfg: ClientConfig,
    out: &Path,
    events: &Events,
) -> Result<DownloadOutcome, Error> {
    let cb = events.callback();
    Chzzk::new(cfg)
        .unwrap()
        .download(request(out), CancellationToken::new(), &cb)
        .await
}

/// 미리 받은 앞부분으로 `.part`와 sidecar를 만든다.
async fn make_partial(out: &Path, bytes: &[u8], total: Option<u64>) {
    let mut sc = Sidecar::new(content(), QUALITY, PlaybackKind::Progressive);
    sc.progressive = Some(ProgressiveState { total_len: total });
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    let mut p = PartFile::create(out, sc).unwrap();
    p.write(bytes).unwrap();
    p.checkpoint(|_| {}).await.unwrap();
}

fn out_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("sub").join("[261004] 채널 - 제목.mp4")
}

fn assert_no_partial(out: &Path) {
    let (p, s) = part_files(out);
    assert!(!p.exists(), ".part가 남았다");
    assert!(!s.exists(), "sidecar가 남았다");
}

/// spec §8.2 ByteIdentity
#[tokio::test]
async fn byte_identity() {
    let server = MockServer::start().await;
    setup(&server).await;
    let body = test_bytes(SIZE, 1);
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let r = download(config(&server), &out, &events).await.unwrap();
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: SIZE as u64,
            resumed_from: 0
        }
    );
    assert_eq!(std::fs::read(&out).unwrap(), body);
    assert_no_partial(&out);

    let ev = events.all();
    assert_eq!(ev.first().unwrap().phase, Phase::Resolving);
    let last = events.last();
    assert_eq!(last.phase, Phase::Finalizing);
    assert_eq!(last.bytes, SIZE as u64);
    assert_eq!(last.total_bytes, Some(SIZE as u64));
    assert!(ev.iter().any(|p| p.phase == Phase::Downloading));
}

/// spec §8.2 SendsHeaders(설계 §4.2로 변경): 미디어에는 UA·Referer만, 쿠키는 보내지 않는다.
#[tokio::test]
async fn media_no_cookie() {
    for on_media in [false, true] {
        let server = MockServer::start().await;
        setup(&server).await;
        Mock::given(method("GET"))
            .and(path(MEDIA_PATH))
            .respond_with(RangeBody(test_bytes(100, 0)))
            .mount(&server)
            .await;
        let dir = tempfile::tempdir().unwrap();
        let out = out_path(&dir);
        let cfg = ClientConfig {
            cookies: Some(NaverCookies::new("a", "b")),
            cookies_on_media: on_media,
            ..config(&server)
        };
        download(cfg, &out, &Events::default()).await.unwrap();

        let api = media_requests(&server, "/service/").await;
        assert_eq!(header(&api[0], "cookie"), Some("NID_AUT=a; NID_SES=b"));
        let media = media_requests(&server, MEDIA_PATH).await;
        assert_eq!(media.len(), 1);
        let m = &media[0];
        assert_eq!(
            header(m, "user-agent"),
            Some(chzzk_core::http::user_agent())
        );
        assert_eq!(header(m, "referer"), Some("https://chzzk.naver.com/"));
        assert_eq!(header(m, "origin"), None);
        assert_eq!(header(m, "range"), None);
        if on_media {
            assert_eq!(header(m, "cookie"), Some("NID_AUT=a; NID_SES=b"));
        } else {
            assert_eq!(header(m, "cookie"), None);
        }
    }
}

/// spec §8.2 Non200DeletesPartial: 상태 확인 전에는 `.part`를 만들지 않는다.
#[tokio::test]
async fn status_404_creates_nothing() {
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = download(config(&server), &out, &Events::default()).await;
    assert!(matches!(
        r,
        Err(Error::HttpStatus {
            status: 404,
            kind: RequestKind::Media
        })
    ));
    assert!(!out.exists());
    assert_no_partial(&out);
    // 404는 재시도하지 않는다.
    assert_eq!(media_requests(&server, MEDIA_PATH).await.len(), 1);
}

/// 중간에 끊긴 본문: 재시도가 없으면 `.part` 500B를 남기고, 다음 실행이 `Range: bytes=500-`로 잇는다.
#[tokio::test]
async fn truncated_body_resumes() {
    let body = test_bytes(1000, 7);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);

    // 1회차: raw TCP가 1000B라고 하고 500B만 보낸 뒤 끊는다.
    let (tcp, handle) = truncating_server(1000, body[..500].to_vec());
    let api1 = MockServer::start().await;
    mount_info(&api1).await;
    mount_mpd(&api1, &format!("{tcp}{MEDIA_PATH}"), None).await;
    let cfg = ClientConfig {
        retry: RetryPolicy::none(),
        ..config(&api1)
    };
    let r = download(cfg, &out, &Events::default()).await;
    assert!(matches!(r, Err(Error::Network(_))), "{r:?}");
    assert!(r.unwrap_err().is_resumable());
    handle.join().unwrap();
    let (part, sidecar) = part_files(&out);
    assert_eq!(std::fs::read(&part).unwrap(), &body[..500]);
    let sc: serde_json::Value = serde_json::from_slice(&std::fs::read(&sidecar).unwrap()).unwrap();
    assert_eq!(sc["committedLen"], 500);
    assert_eq!(sc["progressive"]["totalLen"], 1000);
    assert!(!out.exists());

    // 2회차: Range를 지원하는 서버
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default())
        .await
        .unwrap();
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: 1000,
            resumed_from: 500
        }
    );
    let reqs = media_requests(&server, MEDIA_PATH).await;
    assert_eq!(header(&reqs[0], "range"), Some("bytes=500-"));
    assert_eq!(std::fs::read(&out).unwrap(), body);
    assert_no_partial(&out);
}

/// 끊긴 본문도 재시도가 있으면 같은 실행 안에서 Range로 잇는다.
#[tokio::test]
async fn truncated_body_retries_with_range() {
    let body = test_bytes(1000, 9);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &body[..300], Some(1000)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    // 첫 요청: 206인데 본문이 짧다(조기 EOF). 둘째: 정상.
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(
            ResponseTemplate::new(206)
                .insert_header("content-range", "bytes 300-999/1000")
                .set_body_bytes(body[300..600].to_vec()),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    download(config(&server), &out, &Events::default())
        .await
        .unwrap();
    let reqs = media_requests(&server, MEDIA_PATH).await;
    assert_eq!(header(&reqs[0], "range"), Some("bytes=300-"));
    assert_eq!(header(&reqs[1], "range"), Some("bytes=600-"));
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

#[tokio::test]
async fn range_resume_206() {
    let body = test_bytes(SIZE, 3);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &body[..50_000], Some(SIZE as u64)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let events = Events::default();
    let r = download(config(&server), &out, &events).await.unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 50_000,
            ..
        }
    ));
    assert_eq!(events.all()[0].resumed_from, 50_000);
    assert_eq!(events.all()[0].bytes, 50_000);
    let reqs = media_requests(&server, MEDIA_PATH).await;
    assert_eq!(reqs.len(), 1);
    assert_eq!(header(&reqs[0], "range"), Some("bytes=50000-"));
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

/// 서버가 Range를 무시하고 200을 주면 처음부터 받는다.
#[tokio::test]
async fn range_ignored_200_restarts() {
    let body = test_bytes(SIZE, 4);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &test_bytes(1000, 99), Some(SIZE as u64)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(body.clone()))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default())
        .await
        .unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 0,
            ..
        }
    ));
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

/// 206의 전체 크기가 sidecar와 다르면 원본이 바뀐 것이다. 이어받을 수 없으므로 `.part`를 지운다.
#[tokio::test]
async fn content_range_total_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &test_bytes(1000, 1), Some(SIZE as u64)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(test_bytes(SIZE + 1, 1)))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default()).await;
    assert!(matches!(r, Err(Error::SourceChanged { .. })), "{r:?}");
    assert_no_partial(&out);
    assert!(!out.exists());
}

/// 다 받은 `.part`에 Range를 보내 416이 오면 완료로 본다.
#[tokio::test]
async fn range_416_complete() {
    let body = test_bytes(2000, 5);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &body, Some(2000)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default())
        .await
        .unwrap();
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: 2000,
            resumed_from: 2000
        }
    );
    assert_eq!(std::fs::read(&out).unwrap(), body);
    assert_no_partial(&out);
}

/// 416인데 크기가 맞지 않으면 `SourceChanged`.
#[tokio::test]
async fn range_416_size_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &test_bytes(2000, 5), Some(2000)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(test_bytes(1000, 5)))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default()).await;
    assert!(matches!(r, Err(Error::SourceChanged { .. })), "{r:?}");
}

/// 403(서명 만료) → 재조회 → 새 주소로 같은 offset부터.
#[tokio::test]
async fn expired_403_reresolves_and_ranges() {
    let body = test_bytes(SIZE, 6);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &body[..40_000], Some(SIZE as u64)).await;
    let server = MockServer::start().await;
    mount_info(&server).await;
    mount_mpd(&server, &format!("{}/m1/pd/a.mp4", server.uri()), Some(1)).await;
    mount_mpd(&server, &format!("{}/m2/pd/a.mp4", server.uri()), None).await;
    Mock::given(method("GET"))
        .and(path("/m1/pd/a.mp4"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/m2/pd/a.mp4"))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let events = Events::default();
    let r = download(config(&server), &out, &events).await.unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 40_000,
            ..
        }
    ));
    assert_eq!(std::fs::read(&out).unwrap(), body);
    assert_eq!(events.last().refreshes, 1);
    assert!(events.all().iter().any(|p| p.phase == Phase::Reresolving));
    let m1 = media_requests(&server, "/m1/").await;
    let m2 = media_requests(&server, "/m2/").await;
    assert_eq!(m1.len(), 1);
    assert_eq!(header(&m1[0], "range"), Some("bytes=40000-"));
    assert_eq!(m2.len(), 1);
    assert_eq!(header(&m2[0], "range"), Some("bytes=40000-"));
    assert_eq!(media_requests(&server, "/service/").await.len(), 2);
    assert_eq!(media_requests(&server, "/neonplayer/").await.len(), 2);
}

/// 재조회 직후 같은 요청이 또 403이면 인증 문제다. `AuthRequired`로 끝내고 `.part`를 지운다.
#[tokio::test]
async fn forbidden_after_refresh_is_auth() {
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &test_bytes(1000, 0), Some(SIZE as u64)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default()).await;
    assert!(
        matches!(r, Err(Error::AuthRequired { status: 403 })),
        "{r:?}"
    );
    assert_eq!(media_requests(&server, MEDIA_PATH).await.len(), 2);
    assert_eq!(media_requests(&server, "/service/").await.len(), 2);
    assert_no_partial(&out);
}

#[tokio::test]
async fn status_5xx_then_ok() {
    let body = test_bytes(5000, 2);
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(2)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    download(config(&server), &out, &Events::default())
        .await
        .unwrap();
    assert_eq!(media_requests(&server, MEDIA_PATH).await.len(), 3);
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

/// 5xx가 계속되면 재시도를 다 쓰고 `HttpStatus`. `.part`는 만들지 않는다.
#[tokio::test]
async fn status_5xx_exhausted() {
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = download(config(&server), &out, &Events::default()).await;
    assert!(matches!(r, Err(Error::HttpStatus { status: 503, .. })));
    assert_eq!(media_requests(&server, MEDIA_PATH).await.len(), 5);
    assert_no_partial(&out);
}

#[tokio::test]
async fn status_404_no_retry() {
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &test_bytes(10, 0), Some(SIZE as u64)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default()).await;
    assert!(matches!(r, Err(Error::HttpStatus { status: 404, .. })));
    assert_eq!(media_requests(&server, MEDIA_PATH).await.len(), 1);
    // 4xx는 같은 요청이 끝내 실패하므로 `.part`를 지운다.
    assert_no_partial(&out);
}

/// 다른 화질의 `.part`는 버리고 새로 받는다.
#[tokio::test]
async fn other_quality_partial_discarded() {
    let body = test_bytes(3000, 8);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let mut sc = Sidecar::new(content(), "PD_144P_OTHER", PlaybackKind::Progressive);
    sc.progressive = Some(ProgressiveState {
        total_len: Some(3000),
    });
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    let mut p = PartFile::create(&out, sc).unwrap();
    p.write(&[0u8; 100]).unwrap();
    p.checkpoint(|_| {}).await.unwrap();
    drop(p);
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default())
        .await
        .unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 0,
            ..
        }
    ));
    let reqs = media_requests(&server, MEDIA_PATH).await;
    assert_eq!(header(&reqs[0], "range"), None);
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

/// 목록을 볼 때와 방식이 다르면 `PlaybackChanged`(미디어 요청 없음).
#[tokio::test]
async fn playback_changed() {
    let server = MockServer::start().await;
    setup(&server).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let req = DownloadRequest {
        expected_kind: PlaybackKind::LiveRewindHls,
        ..request(&out)
    };
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(req, CancellationToken::new(), &|_| {})
        .await;
    assert!(matches!(
        r,
        Err(Error::PlaybackChanged {
            was: PlaybackKind::LiveRewindHls,
            now: PlaybackKind::Progressive
        })
    ));
    assert!(media_requests(&server, MEDIA_PATH).await.is_empty());
}

/// 없는 화질은 `QualityNotFound`.
#[tokio::test]
async fn quality_not_found() {
    let server = MockServer::start().await;
    setup(&server).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let req = DownloadRequest {
        quality_id: "PD_NONE".into(),
        ..request(&out)
    };
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(req, CancellationToken::new(), &|_| {})
        .await;
    assert!(matches!(r, Err(Error::QualityNotFound { .. })));
}

/// 시작 전에 취소되면 네트워크 없이 `Cancelled`.
#[tokio::test]
async fn cancelled_before_start() {
    let server = MockServer::start().await;
    setup(&server).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let cancel = CancellationToken::new();
    cancel.cancel();
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(request(&out), cancel, &|_| {})
        .await;
    assert!(matches!(r, Err(Error::Cancelled)));
    assert!(server.received_requests().await.unwrap().is_empty());
}

/// 간격이 길면 청크마다 보내지 않는다. 단계가 바뀔 때(마지막 `Finalizing` 포함)는 반드시 보낸다.
#[tokio::test]
async fn progress_throttled() {
    let body = test_bytes(SIZE, 11);
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cfg = ClientConfig {
        progress_interval: std::time::Duration::from_secs(3600),
        ..config(&server)
    };
    download(cfg, &out, &events).await.unwrap();
    let phases: Vec<Phase> = events.all().iter().map(|p| p.phase).collect();
    assert_eq!(
        phases,
        [Phase::Resolving, Phase::Downloading, Phase::Finalizing]
    );
    let last = events.last();
    assert_eq!(last.bytes, SIZE as u64);
    assert_eq!(last.total_bytes, Some(SIZE as u64));
}
