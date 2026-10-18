//! progressive(PD mp4) 다운로드 통합 테스트(설계 §5.3, §8.1 §8.2 이식, §8.2 progressive).
//! 네트워크는 wiremock과 로컬 raw TCP뿐이다.

mod common;
#[path = "support/mp4.rs"]
mod mp4;

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
        embed_metadata: false,
        content: content(),
        quality_id: QUALITY.into(),
        expected_kind: PlaybackKind::Progressive,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: None,
        recording_id: None,
        range: None,
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
            resumed_from: 0,
            live: None,
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
            resumed_from: 500,
            live: None,
        }
    );
    let reqs = media_requests(&server, MEDIA_PATH).await;
    assert_eq!(header(&reqs[0], "range"), Some("bytes=500-"));
    assert_eq!(std::fs::read(&out).unwrap(), body);
    assert_no_partial(&out);
}

/// 206이 계속 짧게(빈 본문) 끝나 재시도를 다 써도, 받은 바이트는 Content-Range로 확인된 것이므로
/// 이어받을 수 있는 오류로 끝나고 `.part`를 남긴다.
#[tokio::test]
async fn short_body_exhausted_keeps_part() {
    let body = test_bytes(1000, 9);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &body[..300], Some(1000)).await;
    let server = MockServer::start().await;
    setup(&server).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(
            ResponseTemplate::new(206).insert_header("content-range", "bytes 300-999/1000"),
        )
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default()).await;
    let e = r.unwrap_err();
    assert!(e.is_resumable(), "{e:?}");
    assert!(!matches!(e, Error::LengthMismatch { .. }), "{e:?}");
    assert_eq!(media_requests(&server, MEDIA_PATH).await.len(), 5);
    let (part, sidecar) = part_files(&out);
    assert_eq!(std::fs::read(&part).unwrap(), &body[..300]);
    let sc: serde_json::Value = serde_json::from_slice(&std::fs::read(&sidecar).unwrap()).unwrap();
    assert_eq!(sc["committedLen"], 300);
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
            resumed_from: 2000,
            live: None,
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

/// 이어받는 중 info API가 403(로그인 만료 등)이어도 받은 `.part`는 지우지 않는다.
#[tokio::test]
async fn api_auth_error_keeps_partial() {
    let body = test_bytes(SIZE, 12);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &body[..1000], Some(SIZE as u64)).await;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default()).await;
    assert!(
        matches!(r, Err(Error::AuthRequired { status: 403 })),
        "{r:?}"
    );
    let (part, sidecar) = part_files(&out);
    assert_eq!(std::fs::read(part).unwrap(), &body[..1000]);
    assert!(sidecar.exists());
}

/// 재조회(403 뒤) 때 info API가 403이어도 받은 `.part`는 남는다.
#[tokio::test]
async fn reresolve_api_error_keeps_partial() {
    let body = test_bytes(SIZE, 13);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &body[..2000], Some(SIZE as u64)).await;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("testdata/vod/video_info.json"), "application/json"),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    mount_mpd(&server, &format!("{}{MEDIA_PATH}", server.uri()), None).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let r = download(config(&server), &out, &Events::default()).await;
    assert!(
        matches!(r, Err(Error::AuthRequired { status: 401 })),
        "{r:?}"
    );
    let (part, sidecar) = part_files(&out);
    assert_eq!(std::fs::read(part).unwrap(), &body[..2000]);
    assert!(sidecar.exists());
}

/// `Skip`: 시작 전 검사를 지난 뒤(받는 중) 같은 이름의 파일이 생기면 마무리에서 덮어쓰지 않고 `Skipped`다.
/// 받은 `.part`·sidecar는 남고, 같은 요청을 `Overwrite`로 다시 부르면 416으로 이어받아 곧바로 마무리한다.
#[tokio::test]
async fn skip_does_not_clobber_file_created_while_downloading() {
    let server = MockServer::start().await;
    setup(&server).await;
    let body = test_bytes(SIZE, 9);
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);

    let theirs = out.clone();
    let written = std::sync::atomic::AtomicBool::new(false);
    let cb = move |p: chzzk_core::Progress| {
        if p.phase == Phase::Downloading && !written.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            std::fs::write(&theirs, b"theirs").unwrap();
        }
    };
    let mut req = request(&out);
    req.on_existing = DuplicatePolicy::Skip;
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(req.clone(), CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert_eq!(r, DownloadOutcome::Skipped { path: out.clone() });
    assert_eq!(std::fs::read(&out).unwrap(), b"theirs");
    let (p, s) = part_files(&out);
    assert_eq!(std::fs::read(&p).unwrap(), body);
    assert!(s.exists());

    // "덮어쓰고 받기": 다 받은 `.part`라 Range 416으로 곧바로 마무리한다.
    req.on_existing = DuplicatePolicy::Overwrite;
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(req, CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: SIZE as u64,
            resumed_from: SIZE as u64,
            live: None,
        }
    );
    assert_eq!(std::fs::read(&out).unwrap(), body);
    assert_no_partial(&out);
}

/// PD mp4는 마무리에서 바꾸지 않는다(core.md 구현 중 변경 71). 조각 구조 본문을 줘도 받은 그대로 남는다
/// (일반 mp4 본문이면 변환이 `AlreadyFlat`으로 넘어가 이 검사가 아무것도 가르지 못한다).
#[tokio::test]
async fn fragmented_body_is_not_converted() {
    let server = MockServer::start().await;
    setup(&server).await;
    let body = fixture("testdata/live/synthetic_frag.mp4");
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = download(config(&server), &out, &Events::default())
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(std::fs::read(&out).unwrap(), body);
    assert_no_partial(&out);
}

// ---- mp4 메타데이터(`embed_metadata`, mp4-metadata.md §6.2·§13.4) ----

const COVER_PATH: &str = "/thumb/cover.jpg";

fn pd_bytes() -> Vec<u8> {
    fixture("testdata/vod/pd_faststart.mp4")
}

fn meta_request(out: &Path) -> DownloadRequest {
    DownloadRequest {
        embed_metadata: true,
        ..request(out)
    }
}

/// 표지 주소를 mock 서버로 돌린 VOD info + MPD + PD 미디어(`pd_faststart.mp4`).
async fn setup_meta(server: &MockServer, thumb_url: Option<&str>) {
    let info = common::with_thumbnail(&fixture("testdata/vod/video_info.json"), thumb_url);
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(ResponseTemplate::new(200).set_body_raw(info, "application/json"))
        .mount(server)
        .await;
    mount_mpd(server, &format!("{}{MEDIA_PATH}", server.uri()), None).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(pd_bytes()))
        .mount(server)
        .await;
}

async fn mount_cover(server: &MockServer, body: Vec<u8>) {
    Mock::given(method("GET"))
        .and(path(COVER_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(body))
        .mount(server)
        .await;
}

/// 표지를 루프백 http로 받게 하고, 쿠키를 켠 채(미디어에도 보내는 스위치까지) 설정한다.
fn meta_config(server: &MockServer) -> ClientConfig {
    ClientConfig {
        cookies: Some(NaverCookies::new("aut", "ses")),
        cookies_on_media: true,
        allow_loopback_http_images: true,
        ..config(server)
    }
}

fn ilst_of(b: &[u8]) -> Vec<(String, u32, Vec<u8>)> {
    mp4::ilst_items(mp4::find_path_last(b, &["moov", "udta", "meta", "ilst"]).unwrap()).unwrap()
}

fn kinds(items: &[(String, u32, Vec<u8>)]) -> Vec<&str> {
    items.iter().map(|(k, _, _)| k.as_str()).collect()
}

fn box_kinds(b: &[u8]) -> Vec<String> {
    mp4::top_boxes(b).into_iter().map(|(k, _)| k).collect()
}

/// 켜면 새 moov가 끝에 붙고 옛 moov는 free가 된다. 표지 요청에는 쿠키가 없다.
#[tokio::test]
async fn pd_metadata_moov_at_end() {
    let server = MockServer::start().await;
    setup_meta(&server, Some(&format!("{}{COVER_PATH}", server.uri()))).await;
    mount_cover(&server, fixture("testdata/synthetic/thumb.jpg")).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = Chzzk::new(meta_config(&server))
        .unwrap()
        .download(meta_request(&out), CancellationToken::new(), &cb)
        .await
        .unwrap();
    let b = std::fs::read(&out).unwrap();
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: b.len() as u64,
            resumed_from: 0,
            live: None,
        }
    );
    assert_eq!(box_kinds(&b), ["ftyp", "free", "free", "mdat", "moov"]);
    let orig = pd_bytes();
    assert!(b.len() > orig.len());
    assert_eq!(mp4::mdat_payloads(&b), mp4::mdat_payloads(&orig));
    // mdat까지의 앞부분은 옛 moov의 종류 4바이트(moov→free)만 다르다
    let before_mdat = mp4::top_boxes(&orig)
        .into_iter()
        .find(|(k, _)| k == "mdat")
        .unwrap()
        .1
        .end;
    let changed = orig[..before_mdat]
        .iter()
        .zip(&b)
        .filter(|(a, b)| a != b)
        .count();
    assert_eq!(changed, 4, "m→f, o→r, o→e, v→e");
    let items = ilst_of(&b);
    assert_eq!(kinds(&items), ["©nam", "©ART", "©day", "©cmt", "covr"]);
    assert_eq!(items[0].2, "가상 일반 VOD 제목 (괄호) 테스트".as_bytes());
    assert_eq!(items[1].2, "가상채널".as_bytes());
    assert_eq!(items[2].2, b"2026-01-01");
    assert_eq!(
        items[3].2,
        format!("https://chzzk.naver.com/video/{VOD_NO}").as_bytes()
    );
    assert_eq!(
        (items[4].1, items[4].2.clone()),
        (13, fixture("testdata/synthetic/thumb.jpg"))
    );
    assert_no_partial(&out);

    // 표지 요청에는 쿠키가 없고(`cookies_on_media`가 켜져 있어도), 미디어에는 있다
    let cover = media_requests(&server, COVER_PATH).await;
    assert_eq!(cover.len(), 1);
    assert_eq!(header(&cover[0], "cookie"), None);
    assert_eq!(header(&cover[0], "accept"), Some("image/jpeg, image/png"));
    assert!(header(&media_requests(&server, MEDIA_PATH).await[0], "cookie").is_some());
}

#[tokio::test]
async fn pd_metadata_off_is_byte_identical() {
    let server = MockServer::start().await;
    setup_meta(&server, Some(&format!("{}{COVER_PATH}", server.uri()))).await;
    mount_cover(&server, fixture("testdata/synthetic/thumb.jpg")).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    download(meta_config(&server), &out, &Events::default())
        .await
        .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), pd_bytes());
    assert!(
        media_requests(&server, COVER_PATH).await.is_empty(),
        "끄면 표지도 받지 않는다"
    );
    assert_no_partial(&out);
}

/// 썸네일 주소가 없어도(키 없음) 글자 태그는 들어간다.
#[tokio::test]
async fn pd_metadata_without_thumbnail_url_has_text_tags_only() {
    let server = MockServer::start().await;
    setup_meta(&server, None).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    Chzzk::new(meta_config(&server))
        .unwrap()
        .download(meta_request(&out), CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    let b = std::fs::read(&out).unwrap();
    assert_eq!(kinds(&ilst_of(&b)), ["©nam", "©ART", "©day", "©cmt"]);
}

/// 표지를 못 받아도 받기는 `Completed`이고 covr만 빠진다. 재시도는 없다.
#[tokio::test]
async fn cover_failures_do_not_fail_the_download() {
    let big = {
        let mut v = vec![0xff, 0xd8, 0xff];
        v.resize(2 * 1024 * 1024 + 1, 0);
        v
    };
    // (이름, 표지 응답, 표지 주소를 바꾸는 법, 설정 변경, 표지 요청 수)
    type Case = (
        &'static str,
        Option<ResponseTemplate>,
        Option<&'static str>,
        fn(&mut ClientConfig),
        usize,
    );
    let cases: Vec<Case> = vec![
        ("404", Some(ResponseTemplate::new(404)), None, |_| {}, 1),
        ("403", Some(ResponseTemplate::new(403)), None, |_| {}, 1),
        (
            "webp",
            Some(
                ResponseTemplate::new(200).set_body_bytes(fixture("testdata/synthetic/thumb.webp")),
            ),
            None,
            |_| {},
            1,
        ),
        (
            "html",
            Some(ResponseTemplate::new(200).set_body_string("<html>not an image</html>")),
            None,
            |_| {},
            1,
        ),
        (
            "2MiB+1",
            Some(ResponseTemplate::new(200).set_body_bytes(big)),
            None,
            |_| {},
            1,
        ),
        (
            "timeout",
            Some(
                ResponseTemplate::new(200)
                    .set_body_bytes(fixture("testdata/synthetic/thumb.jpg"))
                    .set_delay(std::time::Duration::from_secs(5)),
            ),
            None,
            |c| c.image_timeout = std::time::Duration::from_millis(150),
            1,
        ),
        // 틀 자리표시자가 남은 주소와 http 주소는 요청하지 않는다
        ("placeholder", None, Some("/live/{type}.jpg"), |_| {}, 0),
        (
            "http",
            None,
            None,
            |c| c.allow_loopback_http_images = false,
            0,
        ),
    ];
    for (name, resp, alt_path, tweak, want_requests) in cases {
        let server = MockServer::start().await;
        let thumb_path = alt_path.unwrap_or(COVER_PATH);
        setup_meta(&server, Some(&format!("{}{thumb_path}", server.uri()))).await;
        if let Some(r) = resp {
            Mock::given(method("GET"))
                .and(path(COVER_PATH))
                .respond_with(r)
                .mount(&server)
                .await;
        }
        let mut cfg = meta_config(&server);
        tweak(&mut cfg);
        let dir = tempfile::tempdir().unwrap();
        let out = out_path(&dir);
        let r = Chzzk::new(cfg)
            .unwrap()
            .download(meta_request(&out), CancellationToken::new(), &|_| {})
            .await;
        assert!(
            matches!(r, Ok(DownloadOutcome::Completed { .. })),
            "{name}: {r:?}"
        );
        let b = std::fs::read(&out).unwrap();
        assert_eq!(
            kinds(&ilst_of(&b)),
            ["©nam", "©ART", "©day", "©cmt"],
            "{name}"
        );
        assert_eq!(
            mp4::mdat_payloads(&b),
            mp4::mdat_payloads(&pd_bytes()),
            "{name}"
        );
        let all = server.received_requests().await.unwrap();
        let n = all
            .iter()
            .filter(|q| q.url.path().starts_with("/thumb") || q.url.path().starts_with("/live"))
            .count();
        assert_eq!(n, want_requests, "{name}: 표지 요청 수");
        assert_no_partial(&out);
    }
}

/// 표지 요청의 이동(redirect)은 **요청을 보내기 전에** 거른다(mp4-metadata.md §7). 호스트가 이름(`localhost`)이라
/// 루프백 허용 스위치로도 받지 않는 주소로 보내면 따라가지 않아(그 주소로 요청이 나가지 않는다) 표지 없이 `Completed`로
/// 끝난다. 대조로 허용되는 주소(`127.0.0.1`)로의 이동은 따라가 표지가 들어간다.
#[tokio::test]
async fn cover_redirect_is_filtered_before_the_request() {
    const FINAL: &str = "/thumb/final.jpg";
    for (allowed, host) in [(true, "127.0.0.1"), (false, "localhost")] {
        let server = MockServer::start().await;
        setup_meta(&server, Some(&format!("{}{COVER_PATH}", server.uri()))).await;
        let port = server.address().port();
        Mock::given(method("GET"))
            .and(path(COVER_PATH))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("location", format!("http://{host}:{port}{FINAL}")),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(FINAL))
            .respond_with(
                ResponseTemplate::new(200).set_body_bytes(fixture("testdata/synthetic/thumb.jpg")),
            )
            .mount(&server)
            .await;
        let dir = tempfile::tempdir().unwrap();
        let out = out_path(&dir);
        let r = Chzzk::new(meta_config(&server))
            .unwrap()
            .download(meta_request(&out), CancellationToken::new(), &|_| {})
            .await;
        assert!(
            matches!(r, Ok(DownloadOutcome::Completed { .. })),
            "{host}: {r:?}"
        );
        assert_eq!(media_requests(&server, COVER_PATH).await.len(), 1, "{host}");
        assert_eq!(
            media_requests(&server, FINAL).await.len(),
            usize::from(allowed),
            "{host}: 이동한 주소로 요청이 나갔는가"
        );
        let b = std::fs::read(&out).unwrap();
        let want: &[&str] = if allowed {
            &["©nam", "©ART", "©day", "©cmt", "covr"]
        } else {
            &["©nam", "©ART", "©day", "©cmt"]
        };
        assert_eq!(kinds(&ilst_of(&b)), want, "{host}");
        assert_no_partial(&out);
    }
}

/// 표지 주소의 서명 같은 쿼리는 태그·오류·`Debug`에 남지 않는다.
#[tokio::test]
async fn signed_thumbnail_query_stays_out_of_tags() {
    let server = MockServer::start().await;
    setup_meta(
        &server,
        Some(&format!(
            "{}{COVER_PATH}?hdnts=SECRET&_lsu_sa_=SECRET",
            server.uri()
        )),
    )
    .await;
    mount_cover(&server, fixture("testdata/synthetic/thumb.jpg")).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let chzzk = Chzzk::new(meta_config(&server)).unwrap();
    let resolved = chzzk.resolve(&content()).await.unwrap();
    assert!(resolved.thumbnail_url.is_some());
    assert!(!format!("{resolved:?}").contains("SECRET"));
    chzzk
        .download(meta_request(&out), CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    let b = std::fs::read(&out).unwrap();
    // 요청에는 쿼리가 실렸지만(양성 대조) 파일 안 글자에는 없다
    let cover = media_requests(&server, COVER_PATH).await;
    assert!(cover[0].url.query().unwrap().contains("SECRET"));
    for (k, _, v) in ilst_of(&b) {
        if k != "covr" {
            assert!(!String::from_utf8_lossy(&v).contains("SECRET"), "{k}");
        }
    }
    assert!(!b.windows(6).any(|w| w == b"SECRET"));
}

/// 마무리에서 최종 경로에 파일이 생겨 `Skipped`로 끝난 뒤, 같은 요청을 다시 부르면 처음부터 받지 않고 마무리한다.
/// 태그 뒤 checkpoint를 하지 않아(`committed_len`이 원래 크기) 416이 `SourceChanged`가 되지 않는다.
#[tokio::test]
async fn pd_tagged_then_skipped_resumes_without_refetch() {
    let server = MockServer::start().await;
    setup_meta(&server, Some(&format!("{}{COVER_PATH}", server.uri()))).await;
    mount_cover(&server, fixture("testdata/synthetic/thumb.jpg")).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let (part, sidecar) = part_files(&out);
    let chzzk = Chzzk::new(meta_config(&server)).unwrap();

    let out2 = out.clone();
    let cb = move |p: chzzk_core::Progress| {
        if p.phase == Phase::Finalizing {
            std::fs::create_dir_all(out2.parent().unwrap()).unwrap();
            std::fs::write(&out2, b"someone else").unwrap();
        }
    };
    let req = DownloadRequest {
        on_existing: DuplicatePolicy::Skip,
        ..meta_request(&out)
    };
    let r = chzzk
        .download(req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Skipped { .. }), "{r:?}");
    let tagged = std::fs::read(&part).unwrap();
    assert_eq!(box_kinds(&tagged).last().map(String::as_str), Some("moov"));
    assert!(sidecar.exists());
    // sidecar는 원래 PD 크기를 가리킨다(태그 뒤 checkpoint 없음)
    let sc: serde_json::Value = serde_json::from_slice(&std::fs::read(&sidecar).unwrap()).unwrap();
    assert_eq!(
        sc["committedLen"].as_u64(),
        Some(pd_bytes().len() as u64),
        "{sc}"
    );

    std::fs::remove_file(&out).unwrap();
    let r = chzzk
        .download(meta_request(&out), CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    // 미디어 GET은 두 번: 처음 200 전체, 다시 부를 때 416 한 번(전체를 다시 받지 않는다)
    let media = media_requests(&server, MEDIA_PATH).await;
    assert_eq!(media.len(), 2);
    assert_eq!(header(&media[0], "range"), None);
    assert_eq!(
        header(&media[1], "range"),
        Some(&*format!("bytes={}-", pd_bytes().len()))
    );
    assert_eq!(std::fs::read(&out).unwrap(), tagged);
    assert_no_partial(&out);
}

/// 옛 moov를 free로 바꾼 직후 죽은 `.part`(새 moov는 resume이 잘라 냈다)를 이어받는 실행:
/// 켜면 다시 붙여 태그를 마치고, 끄면 옛 moov로 되돌려 원본과 바이트가 같아진다.
#[tokio::test]
async fn pd_crash_after_patch_recovers() {
    let orig = pd_bytes();
    let (_, moov_body) = mp4::top_boxes(&orig)
        .into_iter()
        .find(|(k, _)| k == "moov")
        .unwrap();
    let mut crashed = orig.clone();
    crashed[moov_body.start - 4..moov_body.start].copy_from_slice(b"free");
    assert_eq!(mp4::freed_moovs(&crashed).len(), 1);
    assert_eq!(mp4::top_moov_count(&crashed), 0);

    for embed in [true, false] {
        let server = MockServer::start().await;
        setup_meta(&server, Some(&format!("{}{COVER_PATH}", server.uri()))).await;
        mount_cover(&server, fixture("testdata/synthetic/thumb.jpg")).await;
        let dir = tempfile::tempdir().unwrap();
        let out = out_path(&dir);
        make_partial(&out, &crashed, Some(crashed.len() as u64)).await;
        let req = DownloadRequest {
            embed_metadata: embed,
            ..request(&out)
        };
        let r = Chzzk::new(meta_config(&server))
            .unwrap()
            .download(req, CancellationToken::new(), &|_| {})
            .await
            .unwrap();
        assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
        let b = std::fs::read(&out).unwrap();
        if embed {
            assert_eq!(box_kinds(&b), ["ftyp", "free", "free", "mdat", "moov"]);
            assert_eq!(
                kinds(&ilst_of(&b)),
                ["©nam", "©ART", "©day", "©cmt", "covr"]
            );
        } else {
            assert_eq!(b, orig, "끈 실행은 옛 moov로 되돌린다");
        }
        // 받은 바이트를 다시 받지 않았다: 416 한 번뿐
        assert_eq!(media_requests(&server, MEDIA_PATH).await.len(), 1);
        assert_no_partial(&out);
    }
}

/// 표지를 받는 동안 취소되면 `Cancelled`이고 `.part`는 바뀌지 않는다. 다음 실행이 이어서 마무리한다.
#[tokio::test]
async fn cancel_during_cover_fetch_leaves_part_untouched() {
    let server = MockServer::start().await;
    setup_meta(&server, Some(&format!("{}{COVER_PATH}", server.uri()))).await;
    Mock::given(method("GET"))
        .and(path(COVER_PATH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_bytes(fixture("testdata/synthetic/thumb.jpg"))
                .set_delay(std::time::Duration::from_secs(10)),
        )
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let (part, sidecar) = part_files(&out);
    let chzzk = Chzzk::new(meta_config(&server)).unwrap();

    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    let cb = move |p: chzzk_core::Progress| {
        if p.phase == Phase::Finalizing {
            let c3 = c2.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                c3.cancel();
            });
        }
    };
    let r = chzzk.download(meta_request(&out), cancel, &cb).await;
    assert!(matches!(r, Err(Error::Cancelled)), "{r:?}");
    assert_eq!(
        media_requests(&server, COVER_PATH).await.len(),
        1,
        "표지 요청은 시작했다"
    );
    assert_eq!(
        std::fs::read(&part).unwrap(),
        pd_bytes(),
        "파일은 바뀌지 않았다"
    );
    assert!(sidecar.exists() && !out.exists());

    // 다음 실행: 표지를 빨리 주면 이어받아 태그를 마친다
    server.reset().await;
    setup_meta(&server, Some(&format!("{}{COVER_PATH}", server.uri()))).await;
    mount_cover(&server, fixture("testdata/synthetic/thumb.jpg")).await;
    let r = chzzk
        .download(meta_request(&out), CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(
        media_requests(&server, MEDIA_PATH).await.len(),
        1,
        "416 한 번뿐"
    );
    assert_eq!(kinds(&ilst_of(&std::fs::read(&out).unwrap())).len(), 5);
}

/// 구조를 모르는 PD 본문(가짜 바이트)은 켜도 그대로 마무리한다(`Unchanged`, 경고만).
#[tokio::test]
async fn pd_metadata_on_non_mp4_body_is_left_alone() {
    let server = MockServer::start().await;
    setup(&server).await;
    let body = test_bytes(5000, 7);
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = Chzzk::new(meta_config(&server))
        .unwrap()
        .download(meta_request(&out), CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(std::fs::read(&out).unwrap(), body);
}
