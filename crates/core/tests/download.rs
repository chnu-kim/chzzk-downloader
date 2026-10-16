//! 다운로드 공통 골격 테스트(설계 §4.2, spec §8.3 TestDirectDuplicateChoice 변경 이식).

mod common;

use chzzk_core::{
    CancellationToken, Chzzk, ContentRef, DownloadOutcome, DownloadRequest, DuplicatePolicy, Error,
    PartOwner, PlaybackKind, discard_partial,
};
use common::{RangeBody, VOD_NO, VOD_VIDEO_ID, config, fixture, part_files, pd_mpd, test_bytes};
use std::path::Path;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn request(out: &Path, on_existing: DuplicatePolicy) -> DownloadRequest {
    DownloadRequest {
        content: ContentRef::Video { video_no: VOD_NO },
        quality_id: "PD_720P_TEST".into(),
        expected_kind: PlaybackKind::Progressive,
        output: out.to_path_buf(),
        on_existing,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: None,
        recording_id: None,
    }
}

async fn setup(server: &MockServer, body: Vec<u8>) {
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("testdata/vod/video_info.json"), "application/json"),
        )
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
        )))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            pd_mpd("PD_720P_TEST", 720, &format!("{}/x/pd/a.mp4", server.uri())),
            "application/dash+xml",
        ))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path("/x/pd/a.mp4"))
        .respond_with(RangeBody(body))
        .mount(server)
        .await;
}

#[tokio::test]
async fn duplicate_skip() {
    let server = MockServer::start().await;
    setup(&server, test_bytes(100, 0)).await;
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("a.mp4");
    std::fs::write(&out, b"existing").unwrap();
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(
            request(&out, DuplicatePolicy::Skip),
            CancellationToken::new(),
            &|_| {},
        )
        .await
        .unwrap();
    assert_eq!(r, DownloadOutcome::Skipped { path: out.clone() });
    assert_eq!(std::fs::read(&out).unwrap(), b"existing");
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn duplicate_overwrite() {
    let server = MockServer::start().await;
    let body = test_bytes(100, 0);
    setup(&server, body.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("a.mp4");
    std::fs::write(&out, b"existing").unwrap();
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(
            request(&out, DuplicatePolicy::Overwrite),
            CancellationToken::new(),
            &|_| {},
        )
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }));
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

/// Tauri 셸이 `spawn`할 수 있도록 `download` future는 `Send`다.
#[tokio::test]
async fn download_future_is_send() {
    fn assert_send<T: Send>(_: &T) {}
    let server = MockServer::start().await;
    let chzzk = Chzzk::new(config(&server)).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("a.mp4");
    let cb = |_| {};
    let fut = chzzk.download(
        request(&out, DuplicatePolicy::Skip),
        CancellationToken::new(),
        &cb,
    );
    assert_send(&fut);
}

#[tokio::test]
async fn discard_partial_removes_files() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("a.mp4");
    let (part, sidecar) = part_files(&out);
    std::fs::write(&part, b"x").unwrap();
    std::fs::write(&sidecar, b"{}").unwrap();
    // 깨진 sidecar는 주인을 모르는 파일이라 지운다
    let content = ContentRef::Video { video_no: VOD_NO };
    let owner = PartOwner {
        content: &content,
        quality_id: "PD_720P_TEST",
        kind: PlaybackKind::Progressive,
        recording_id: None,
    };
    discard_partial(&out, &owner).unwrap();
    assert!(!part.exists());
    assert!(!sidecar.exists());
}

/// N4: 같은 경로에 생방송 녹화 `.part`가 있으면 VOD 요청이 그것을 지우지도 덮어쓰지도 않고(서버에도 가지 않고) 거부한다.
#[tokio::test]
async fn vod_download_onto_recording_part_keeps_it() {
    use chzzk_core::download::part::{HlsState, PartFile, Sidecar};
    let server = MockServer::start().await; // mock 없음: 요청이 닿으면 404
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("a.mp4");
    let mut sc = Sidecar::new(
        ContentRef::Live {
            channel_id: "000000000000000000000000000000e5".into(),
        },
        "144p",
        PlaybackKind::Live,
    );
    sc.recording_id = Some("a".repeat(32));
    sc.hls = Some(HlsState {
        init_len: 16,
        ..HlsState::default()
    });
    let mut p = PartFile::create(&out, sc).unwrap();
    p.write(&[1u8; 16]).unwrap();
    p.write(&[2u8; 32]).unwrap();
    p.checkpoint(|_| {}).await.unwrap();
    drop(p);
    let (part, sidecar) = part_files(&out);
    let (part_before, sc_before) = (
        std::fs::read(&part).unwrap(),
        std::fs::read(&sidecar).unwrap(),
    );

    let cb = |_| {};
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(
            request(&out, DuplicatePolicy::Overwrite),
            CancellationToken::new(),
            &cb,
        )
        .await;
    assert!(matches!(r, Err(Error::PartialRecording { .. })), "{r:?}");
    assert_eq!(std::fs::read(&part).unwrap(), part_before);
    assert_eq!(std::fs::read(&sidecar).unwrap(), sc_before);
    assert!(server.received_requests().await.unwrap().is_empty());
}
