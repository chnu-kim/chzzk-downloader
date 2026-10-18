//! 오디오만 받기(docs/design/features/audio-only.md) 통합 테스트. 네트워크는 wiremock뿐이다.
//!
//! 오디오 rep은 progressive 경로로 받고(`.part` 이어받기·403 재조회), 마무리에서 CMAF 조각 구조를 일반 m4a로 바꾼다(A6).
//! 평탄화 뒤 `.part`는 `total_len`보다 길어지므로 그 상태의 재시작은 요청 없이 마무리로 간다(A7).

mod common;
#[path = "support/mp4.rs"]
mod mp4;

use chzzk_core::download::part::{PartFile, ProgressiveState, Sidecar};
use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, Error, Phase, PlaybackKind, Unsupported,
};
use common::{Events, RangeBody, VOD_NO, VOD_VIDEO_ID, config, fixture, part_files, pd_mpd};
use std::path::{Path, PathBuf};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const SRC: &str = "testdata/vod/audio_cmaf.m4a";
const FLAT: &str = "testdata/vod/audio_cmaf_flat.m4a";
const AUDIO_PATH: &str = "/m1/audio/a.m4a";

fn content() -> ContentRef {
    ContentRef::Video { video_no: VOD_NO }
}

fn request(out: &Path) -> DownloadRequest {
    DownloadRequest {
        throttle: Default::default(),
        content: content(),
        quality_id: "audio".into(),
        expected_kind: PlaybackKind::Progressive,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: None,
        recording_id: None,
        range: None,
    }
}

/// 비디오 PD 하나 + 오디오 rep 하나짜리 MPD. 오디오 주소는 `audio_url`이다.
fn audio_mpd(video_url: &str, audio_url: &str) -> String {
    pd_mpd("PD_720P_TEST", 720, video_url).replace(
        "</Period>",
        &format!(
            r#"<AdaptationSet mimeType="audio/mp4"><Representation id="aud1" bandwidth="128000" mimeType="audio/mp4" codecs="mp4a.40.2"><BaseURL>{audio_url}</BaseURL></Representation></AdaptationSet></Period>"#
        ),
    )
}

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
async fn mount_mpd(server: &MockServer, audio_path: &str, times: Option<u64>) {
    let uri = server.uri();
    let mut m = Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
        )))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            audio_mpd(
                &format!("{uri}/v/pd/a.mp4?_lsu_sa_=sig"),
                &format!("{uri}{audio_path}?_lsu_sa_=sig"),
            ),
            "application/dash+xml",
        ));
    if let Some(n) = times {
        m = m.up_to_n_times(n);
    }
    m.mount(server).await;
}

async fn setup(server: &MockServer, body: Vec<u8>) {
    mount_info(server).await;
    mount_mpd(server, AUDIO_PATH, None).await;
    Mock::given(method("GET"))
        .and(path(AUDIO_PATH))
        .respond_with(RangeBody(body))
        .mount(server)
        .await;
}

async fn requests_to(server: &MockServer, prefix: &str) -> Vec<Request> {
    server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.url.path().starts_with(prefix))
        .collect()
}

async fn run_download(
    cfg: ClientConfig,
    req: DownloadRequest,
    events: &Events,
) -> Result<DownloadOutcome, Error> {
    let cb = events.callback();
    Chzzk::new(cfg)
        .unwrap()
        .download(req, CancellationToken::new(), &cb)
        .await
}

/// 미리 받은 앞부분으로 `.part`와 sidecar를 만든다.
async fn make_partial(out: &Path, bytes: &[u8], total: Option<u64>) {
    let mut sc = Sidecar::new(content(), "audio", PlaybackKind::Progressive);
    sc.progressive = Some(ProgressiveState { total_len: total });
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    let mut p = PartFile::create(out, sc).unwrap();
    p.write(bytes).unwrap();
    p.checkpoint(|_| {}).await.unwrap();
}

fn out_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("sub").join("[261004] 채널 - 제목.m4a")
}

fn assert_no_partial(out: &Path) {
    let (p, s) = part_files(out);
    assert!(!p.exists(), ".part가 남았다");
    assert!(!s.exists(), "sidecar가 남았다");
}

/// 정적 golden. 다시 만들기: `UPDATE_AUDIO_GOLDEN=1 cargo test -p chzzk-core --test audio full_download_is_flat_m4a`
fn golden() -> Vec<u8> {
    fixture(FLAT)
}

/// 평탄화한 결과의 구조 검사: 조각(`moof`)·`sidx`의 동작이 없고, 오디오 트랙 하나, 미디어 데이터는 조각 순서대로.
fn assert_flat_audio(got: &[u8]) {
    mp4::assert_flat_mp4(got);
    let types = mp4::walk_boxes(got).unwrap().types().join(",");
    assert!(!types.contains("moof"), "moof가 남았다: {types}");
    let src = fixture(SRC);
    let have: Vec<u8> = mp4::mdat_payloads(got).into_iter().flatten().collect();
    let want: Vec<u8> = mp4::mdat_payloads(&src).into_iter().flatten().collect();
    assert_eq!(have, want, "미디어 데이터가 순서대로 보존돼야 한다");
    // 새로 붙은 `moov`(마지막 상자)에는 오디오 트랙 하나와 샘플 12개(조각 셋 × 4)가 있고, 동기 샘플 표(`stss`)는 없다
    // (모든 샘플이 동기). 옛 `moov`와 `sidx`는 `free`로 바뀌어 상자 종류에 남지 않는다.
    let w = mp4::walk_boxes(got).unwrap();
    let types = w.types();
    assert_eq!(
        types.iter().filter(|t| **t == "sidx").count(),
        0,
        "{types:?}"
    );
    let (ty, size) = w.boxes.last().unwrap();
    assert_eq!(ty, "moov");
    let moov = &got[got.len() - *size as usize..];
    let count = |tag: &[u8]| moov.windows(4).filter(|w| *w == tag).count();
    assert_eq!(count(b"trak"), 1);
    assert_eq!(count(b"soun"), 1);
    assert_eq!(count(b"stss"), 0);
    let stsz = moov.windows(4).position(|w| w == b"stsz").unwrap();
    // stsz: 종류 4바이트 뒤 version/flags(4) · sample_size(4) · sample_count(4)
    let sample_count = u32::from_be_bytes(moov[stsz + 12..stsz + 16].try_into().unwrap());
    assert_eq!(sample_count, 12);
}

/// 오디오 rep을 끝까지 받으면 마무리가 일반 m4a로 바꾼다. 결과는 golden과 바이트가 같다(A6).
#[tokio::test]
async fn full_download_is_flat_m4a() {
    let server = MockServer::start().await;
    let src = fixture(SRC);
    setup(&server, src.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let r = run_download(config(&server), request(&out), &events)
        .await
        .unwrap();
    let got = std::fs::read(&out).unwrap();
    if std::env::var_os("UPDATE_AUDIO_GOLDEN").is_some() {
        let p = format!("{}/../../{FLAT}", env!("CARGO_MANIFEST_DIR"));
        std::fs::write(p, &got).unwrap();
    }
    assert_eq!(
        got,
        golden(),
        "다시 만들기: UPDATE_AUDIO_GOLDEN=1 cargo test -p chzzk-core --test audio full_download_is_flat_m4a"
    );
    assert_flat_audio(&got);
    // 평탄화하면 받은 길이보다 길다(`moov`를 뒤에 붙인다). 완료 바이트는 결과 파일 길이다
    assert!(got.len() > src.len());
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: got.len() as u64,
            resumed_from: 0,
            live: None,
        }
    );
    assert_no_partial(&out);
    assert_eq!(events.last().phase, Phase::Finalizing);
    // 오디오 주소만 요청한다(비디오 PD 주소는 건드리지 않는다), 쿠키는 보내지 않는다
    let media = requests_to(&server, AUDIO_PATH).await;
    assert_eq!(media.len(), 1);
    assert!(media[0].headers.get("cookie").is_none());
    assert!(requests_to(&server, "/v/").await.is_empty());
}

/// 중간까지 받은 `.part`는 Range로 이어 받고, 결과는 끝까지 받은 것과 같다.
#[tokio::test]
async fn resume_with_range_gives_same_result() {
    let src = fixture(SRC);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &src[..1500], Some(src.len() as u64)).await;
    let server = MockServer::start().await;
    setup(&server, src.clone()).await;
    let r = run_download(config(&server), request(&out), &Events::default())
        .await
        .unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 1500,
            ..
        }
    ));
    assert_eq!(std::fs::read(&out).unwrap(), golden());
    let media = requests_to(&server, AUDIO_PATH).await;
    assert_eq!(media.len(), 1);
    assert_eq!(
        media[0].headers.get("range").map(|v| v.to_str().unwrap()),
        Some("bytes=1500-")
    );
    assert_no_partial(&out);
}

/// 403(서명 만료) → 재조회 → 같은 `"audio"` 키의 새 주소로 같은 offset부터 이어 받는다.
#[tokio::test]
async fn expired_403_reresolves_to_new_audio_url() {
    let src = fixture(SRC);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &src[..1000], Some(src.len() as u64)).await;
    let server = MockServer::start().await;
    mount_info(&server).await;
    mount_mpd(&server, "/m1/audio/a.m4a", Some(1)).await;
    mount_mpd(&server, "/m2/audio/a.m4a", None).await;
    Mock::given(method("GET"))
        .and(path("/m1/audio/a.m4a"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/m2/audio/a.m4a"))
        .respond_with(RangeBody(src.clone()))
        .mount(&server)
        .await;
    let events = Events::default();
    let r = run_download(config(&server), request(&out), &events)
        .await
        .unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 1000,
            ..
        }
    ));
    assert_eq!(std::fs::read(&out).unwrap(), golden());
    assert_eq!(events.last().refreshes, 1);
    assert_eq!(requests_to(&server, "/m1/").await.len(), 1);
    let m2 = requests_to(&server, "/m2/").await;
    assert_eq!(m2.len(), 1);
    assert_eq!(
        m2[0].headers.get("range").map(|v| v.to_str().unwrap()),
        Some("bytes=1000-")
    );
}

/// A7: 평탄화 뒤 `finalize`가 `TargetExists`로 끝나 `.part`(평탄화 결과)가 남은 상태에서 다시 실행하면, 미디어 요청 없이
/// 마무리한다. 규칙이 없으면 `Range: bytes={written}-`에 416이 와 `SourceChanged`가 된다.
#[tokio::test]
async fn flattened_part_restarts_without_media_request() {
    let src = fixture(SRC);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);

    // 1회차: 마무리 단계에서 같은 이름의 파일이 생기게 해(Skip) 평탄화한 `.part`만 남긴다.
    let server = MockServer::start().await;
    setup(&server, src.clone()).await;
    let blocker = out.clone();
    let cb = move |p: chzzk_core::Progress| {
        if p.phase == Phase::Finalizing {
            std::fs::write(&blocker, b"someone else").unwrap();
        }
    };
    let mut req = request(&out);
    req.on_existing = DuplicatePolicy::Skip;
    let first = Chzzk::new(config(&server))
        .unwrap()
        .download(req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert_eq!(first, DownloadOutcome::Skipped { path: out.clone() });
    let (part, sidecar) = part_files(&out);
    assert_eq!(std::fs::read(&part).unwrap(), golden());
    assert!(sidecar.exists());
    drop(server);

    // 2회차: 막던 파일을 지우고 다시 실행한다. 미디어 주소는 한 번도 불리지 않아야 한다.
    std::fs::remove_file(&out).unwrap();
    let server = MockServer::start().await;
    mount_info(&server).await;
    mount_mpd(&server, AUDIO_PATH, None).await;
    Mock::given(method("GET"))
        .and(path(AUDIO_PATH))
        .respond_with(RangeBody(src.clone()))
        .expect(0)
        .mount(&server)
        .await;
    let r = run_download(config(&server), request(&out), &Events::default())
        .await
        .unwrap();
    assert!(
        matches!(r, DownloadOutcome::Completed { .. }),
        "AlreadyFlat으로 마무리돼야 한다: {r:?}"
    );
    assert_eq!(std::fs::read(&out).unwrap(), golden());
    assert!(requests_to(&server, AUDIO_PATH).await.is_empty());
    assert_no_partial(&out);
}

/// 평탄화 3단계(상자 종류를 `free`로 바꾸기) 도중 끊긴 상태에서 다시 실행하면 요청 없이 같은 결과로 다시 평탄화한다.
///
/// 3단계는 받은 길이(`committed_len`) 안의 상자 종류를 오프셋 오름차순으로 바꾸므로, 끊긴 파일은 앞쪽 상자 몇 개만
/// `free`가 되어 있고 끝에 붙인 `moov`(committed 밖)는 `resume`이 자른다. golden과 원본의 차이에서 바꾼 자리를 읽어
/// 패치 `done`개까지 적용한 파일을 모든 `done`에 대해 만든다(`defrag/tests.rs`의 같은 이름 계열 시험을 오디오 단일
/// 트랙 + `sidx` 입력으로 되풀이한다).
#[tokio::test]
async fn interrupted_flatten_is_redone_from_committed_length() {
    let src = fixture(SRC);
    let flat = golden();
    // 원본과 golden이 다른 자리 = 3단계가 바꾼 4바이트 종류들(`moov`·`sidx`·`moof` × 3)
    let diffs: Vec<usize> = (0..src.len()).filter(|&i| src[i] != flat[i]).collect();
    assert_eq!(diffs.len() % 4, 0);
    let patches: Vec<usize> = diffs.chunks(4).map(|c| c[0]).collect();
    assert_eq!(patches.len(), 5, "moov·sidx·moof 셋: {patches:?}");
    for done in 0..=patches.len() {
        let dir = tempfile::tempdir().unwrap();
        let out = out_path(&dir);
        make_partial(&out, &src, Some(src.len() as u64)).await;
        // 끊기기 전 디스크 상태: 앞쪽 패치 `done`개 + 끝에 붙인 새 `moov`(아직 checkpoint되지 않았다)
        let (part, _) = part_files(&out);
        let mut b = std::fs::read(&part).unwrap();
        for &at in &patches[..done] {
            b[at..at + 4].copy_from_slice(&flat[at..at + 4]);
        }
        b.extend_from_slice(&flat[src.len()..]);
        std::fs::write(&part, &b).unwrap();

        let server = MockServer::start().await;
        mount_info(&server).await;
        mount_mpd(&server, AUDIO_PATH, None).await;
        Mock::given(method("GET"))
            .and(path(AUDIO_PATH))
            .respond_with(RangeBody(src.clone()))
            .expect(0)
            .mount(&server)
            .await;
        let r = run_download(config(&server), request(&out), &Events::default())
            .await
            .unwrap();
        assert!(
            matches!(r, DownloadOutcome::Completed { .. }),
            "{done}: {r:?}"
        );
        assert_eq!(std::fs::read(&out).unwrap(), flat, "패치 {done}개 뒤 끊김");
        assert!(requests_to(&server, AUDIO_PATH).await.is_empty(), "{done}");
        assert_no_partial(&out);
    }
}

/// 서버가 Range를 무시하고 200으로 주면 처음부터 다시 받고 결과는 같다.
#[tokio::test]
async fn range_ignored_restarts_and_flattens() {
    let src = fixture(SRC);
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    make_partial(&out, &src[..1000], Some(src.len() as u64)).await;
    let server = MockServer::start().await;
    mount_info(&server).await;
    mount_mpd(&server, AUDIO_PATH, None).await;
    Mock::given(method("GET"))
        .and(path(AUDIO_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(src.clone()))
        .mount(&server)
        .await;
    let r = run_download(config(&server), request(&out), &Events::default())
        .await
        .unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 0,
            ..
        }
    ));
    assert_eq!(std::fs::read(&out).unwrap(), golden());
}

/// 오디오 요청의 화질과 출력 확장자가 어긋나면 네트워크 전에 거부한다(A5). 같은 경로의 남의 `.part`는 그대로다.
#[tokio::test]
async fn quality_and_extension_mismatch_rejected_before_resume() {
    let server = MockServer::start().await; // mock 없음
    let dir = tempfile::tempdir().unwrap();

    // "audio" + .mp4
    let mp4_out = dir.path().join("a.mp4");
    make_other_partial(&mp4_out).await;
    let (part, sidecar) = part_files(&mp4_out);
    let (pb, sb) = (
        std::fs::read(&part).unwrap(),
        std::fs::read(&sidecar).unwrap(),
    );
    let r = run_download(config(&server), request(&mp4_out), &Events::default()).await;
    assert!(
        matches!(r, Err(Error::Unsupported(Unsupported::AudioOutputMismatch))),
        "{r:?}"
    );
    assert_eq!(std::fs::read(&part).unwrap(), pb);
    assert_eq!(std::fs::read(&sidecar).unwrap(), sb);

    // PD id + .m4a
    let m4a_out = dir.path().join("b.m4a");
    make_other_partial(&m4a_out).await;
    let (part, sidecar) = part_files(&m4a_out);
    let (pb, sb) = (
        std::fs::read(&part).unwrap(),
        std::fs::read(&sidecar).unwrap(),
    );
    let req = DownloadRequest {
        quality_id: "PD_720P_TEST".into(),
        ..request(&m4a_out)
    };
    let r = run_download(config(&server), req, &Events::default()).await;
    assert!(
        matches!(r, Err(Error::Unsupported(Unsupported::AudioOutputMismatch))),
        "{r:?}"
    );
    assert_eq!(std::fs::read(&part).unwrap(), pb);
    assert_eq!(std::fs::read(&sidecar).unwrap(), sb);

    // "audio" + .m4a라도 progressive가 아니면 거부
    let hls_out = dir.path().join("c.m4a");
    let req = DownloadRequest {
        expected_kind: PlaybackKind::LiveRewindHls,
        ..request(&hls_out)
    };
    let r = run_download(config(&server), req, &Events::default()).await;
    assert!(
        matches!(r, Err(Error::Unsupported(Unsupported::AudioOutputMismatch))),
        "{r:?}"
    );
    // 어느 쪽도 네트워크를 쓰지 않았다
    assert!(server.received_requests().await.unwrap().is_empty());
}

/// 이미 있는 파일이 `Skip`이어도 어긋난 요청은 `Skipped`로 조용히 성공하지 않는다.
#[tokio::test]
async fn mismatch_is_error_even_when_target_exists_and_skip() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("a.mp4");
    std::fs::write(&out, b"existing").unwrap();
    let req = DownloadRequest {
        on_existing: DuplicatePolicy::Skip,
        ..request(&out)
    };
    let r = run_download(config(&server), req, &Events::default()).await;
    assert!(
        matches!(r, Err(Error::Unsupported(Unsupported::AudioOutputMismatch))),
        "{r:?}"
    );
    assert_eq!(std::fs::read(&out).unwrap(), b"existing");
}

/// 다른 작업(다른 화질)의 `.part`.
async fn make_other_partial(out: &Path) {
    let mut sc = Sidecar::new(content(), "PD_OTHER", PlaybackKind::Progressive);
    sc.progressive = Some(ProgressiveState {
        total_len: Some(100),
    });
    let mut p = PartFile::create(out, sc).unwrap();
    p.write(&[7u8; 40]).unwrap();
    p.checkpoint(|_| {}).await.unwrap();
}

/// 오디오 단일 트랙 + `sidx` 입력(CMAF m4a)은 트랙 1개로 바뀌고, 한 번 더 돌리면 이미 일반 mp4다(멱등).
#[test]
fn defrag_converts_single_audio_track_with_sidx() {
    use chzzk_core::download::defrag::{DefragReport, defragment};
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.m4a");
    std::fs::write(&p, fixture(SRC)).unwrap();
    let mut f = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&p)
        .unwrap();
    let r = defragment(&mut f).unwrap();
    assert_eq!(
        r,
        DefragReport::Converted {
            tracks: 1,
            samples: 12,
            discontinuities: 0
        }
    );
    drop(f);
    assert_eq!(std::fs::read(&p).unwrap(), golden());
    let mut f = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&p)
        .unwrap();
    assert_eq!(defragment(&mut f).unwrap(), DefragReport::AlreadyFlat);
}
