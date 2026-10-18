//! 빠른 다시보기 HLS(fMP4) 다운로드 통합 테스트(설계 §5.4, §8.2 segmented). 네트워크는 wiremock뿐이다.

mod common;
#[path = "support/mp4.rs"]
mod mp4;

use std::path::{Path, PathBuf};
use std::time::Duration;

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, Error, Phase, PlaybackKind, Progress, TimeRange,
};
use common::{
    Events, HLS_NO, config, fixture, hls_info, mount_synth_hls, part_files, rewrite_hosts, suffix,
    synth_expected, synth_init, synth_media, synth_segment,
};
use std::num::NonZeroU8;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const INFO_PATH: &str = "/service/v2/videos/9000001";

fn request(out: &Path, concurrency: u8) -> DownloadRequest {
    DownloadRequest {
        embed_metadata: false,
        throttle: Default::default(),
        content: ContentRef::Video { video_no: HLS_NO },
        quality_id: "144p".into(),
        expected_kind: PlaybackKind::LiveRewindHls,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: NonZeroU8::new(concurrency).unwrap(),
        live_stop: None,
        recording_id: None,
        range: None,
    }
}

fn out_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("[260102] 테스트채널 - 테스트 다시보기.mp4")
}

/// info가 `{server}{prefix}/master.m3u8`를 가리키게 mount한다. `times`면 그 횟수만.
async fn mount_info(server: &MockServer, prefix: &str, times: Option<u64>) {
    let body = hls_info(&format!(
        "{}{prefix}/master.m3u8?hdnts=st=1~hmac=x",
        server.uri()
    ));
    let mut m = Mock::given(method("GET"))
        .and(path(INFO_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_raw(body, "application/json"));
    if let Some(n) = times {
        m = m.up_to_n_times(n);
    }
    m.mount(server).await;
}

async fn requests(server: &MockServer, p: &str) -> Vec<Request> {
    server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.url.path() == p)
        .collect()
}

async fn run(
    cfg: ClientConfig,
    req: DownloadRequest,
    cancel: CancellationToken,
    cb: &(dyn Fn(Progress) + Send + Sync),
) -> Result<DownloadOutcome, Error> {
    Chzzk::new(cfg).unwrap().download(req, cancel, cb).await
}

fn sidecar_json(out: &Path) -> serde_json::Value {
    serde_json::from_slice(&std::fs::read(part_files(out).1).unwrap()).unwrap()
}

/// 상위 상자 종류 목록.
fn box_types(mut b: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    while b.len() >= 8 {
        let size = u32::from_be_bytes(b[..4].try_into().unwrap()) as usize;
        out.push(String::from_utf8_lossy(&b[4..8]).into_owned());
        if size < 8 || size > b.len() {
            break;
        }
        b = &b[size..];
    }
    out
}

/// init‖seg0‖seg1을 마무리에서 일반 mp4로 바꾼 정적 golden(testdata/README.md).
const FULL2_FLAT: &str = "testdata/hls/full2_flat.mp4";

/// 합성 fixture(init·seg0·seg1)를 받은 결과는 그 조각들을 일반 mp4로 바꾼 것이고(golden과 같다) 미디어 순서가 맞다.
#[tokio::test]
async fn fixture_concat_box_order() {
    let server = MockServer::start().await;
    let info = rewrite_hosts(&fixture("testdata/hls/video_info.json"), &server.uri());
    Mock::given(method("GET"))
        .and(path(INFO_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_raw(info, "application/json"))
        .mount(&server)
        .await;
    // fixture media playlist에서 앞 두 세그먼트만 남긴다.
    let media = String::from_utf8(fixture("testdata/hls/media.m3u8")).unwrap();
    let mut kept = Vec::new();
    let mut uris = 0;
    for line in media.lines() {
        if uris == 2 {
            break;
        }
        if !line.is_empty() && !line.starts_with('#') {
            uris += 1;
        }
        kept.push(line);
    }
    let media = format!("{}\n#EXT-X-ENDLIST\n", kept.join("\n"));
    let mounts: [(&str, Vec<u8>); 5] = [
        ("/vod_playlist.m3u8", fixture("testdata/hls/master.m3u8")),
        ("/vod_chunklist.m3u8", media.into_bytes()),
        ("/144p_0_0_0.m4s", fixture("testdata/hls/init.mp4")),
        ("/144p_seg0.m4v", fixture("testdata/hls/seg0.m4v")),
        ("/144p_seg1.m4v", fixture("testdata/hls/seg1.m4v")),
    ];
    for (s, body) in mounts {
        Mock::given(method("GET"))
            .and(suffix(s))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(body))
            .mount(&server)
            .await;
    }
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = run(
        config(&server),
        request(&out, 4),
        CancellationToken::new(),
        &cb,
    )
    .await
    .unwrap();
    let got = std::fs::read(&out).unwrap();
    // 받은 init‖seg0‖seg1은 상자 순서가 맞는 조각 구조이고(`.part`), 마무리가 일반 mp4로 바꾼다(core.md 71).
    // 결과는 정적 golden `testdata/hls/full2_flat.mp4`와 바이트가 같다(네이티브 E2E가 같은 파일로 판정한다).
    if std::env::var_os("UPDATE_FLAT_GOLDEN").is_some() {
        let path = format!("{}/../../{FULL2_FLAT}", env!("CARGO_MANIFEST_DIR"));
        std::fs::write(path, &got).unwrap();
    }
    let want = fixture(FULL2_FLAT);
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: want.len() as u64,
            resumed_from: 0,
            live: None,
        }
    );
    assert_eq!(
        got, want,
        "다시 만들기: UPDATE_FLAT_GOLDEN=1 cargo test -p chzzk-core --test segmented fixture_concat_box_order"
    );
    mp4::assert_flat_mp4(&got);
    let mut concat = fixture("testdata/hls/init.mp4");
    concat.extend(fixture("testdata/hls/seg0.m4v"));
    concat.extend(fixture("testdata/hls/seg1.m4v"));
    let types = box_types(&concat);
    assert_eq!(&types[..4], ["ftyp", "moov", "styp", "moof"]);
    assert!(types.contains(&"emsg".to_string()));
    // 미디어 데이터는 조각 순서 그대로 옮긴다(데이터는 움직이지 않고 `moov`가 끝에 붙는다)
    let have: Vec<u8> = mp4::mdat_payloads(&got).into_iter().flatten().collect();
    let want_media: Vec<u8> = mp4::mdat_payloads(&concat).into_iter().flatten().collect();
    assert_eq!(have, want_media);
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());

    // 144p variant를 골랐고 init은 쿼리를 보존해 요청했다.
    let reqs = server.received_requests().await.unwrap();
    let init = reqs
        .iter()
        .find(|r| r.url.path().ends_with("/144p_0_0_0.m4s"))
        .unwrap();
    assert_eq!(init.url.query(), Some("type=hls&filetype=.m4s"));
    let media_req = reqs
        .iter()
        .find(|r| r.url.path().ends_with("/vod_chunklist.m3u8"))
        .unwrap();
    assert!(media_req.url.path().contains("/144p/hdntl="));
    // master의 hdnts 쿼리는 하위 요청에 붙지 않는다.
    assert_eq!(media_req.url.query(), None);

    let last = events.last();
    assert_eq!(last.phase, Phase::Finalizing);
    assert_eq!(last.segments, Some((2, 2)));
    assert_eq!(last.media_secs, Some((4.0, 4.0)));
}

/// 200인데 HTML 본문(CDN 오류 페이지)이면 이어 붙이지 않고 재시도한다.
#[tokio::test]
async fn html_body_rejected() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg2.m4v"))
        .respond_with(ResponseTemplate::new(200).set_body_string("<html><body>error</body></html>"))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 5).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(5));
    assert_eq!(requests(&server, "/g0/144p/seg2.m4v").await.len(), 2);
}

/// HTML 본문이 계속되면 재시도를 다 쓰고 `Parse`. 받은 세그먼트는 `.part`에 남는다.
#[tokio::test]
async fn html_body_exhausts_retries() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg2.m4v"))
        .respond_with(ResponseTemplate::new(200).set_body_string("<html></html>"))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 5).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(
        matches!(
            r,
            Err(Error::Parse {
                what: "segment",
                ..
            })
        ),
        "{r:?}"
    );
    let sc = sidecar_json(&out);
    assert_eq!(sc["hls"]["nextIndex"], 2);
    let expected = synth_expected(2);
    assert_eq!(sc["committedLen"], expected.len() as u64);
    assert_eq!(std::fs::read(part_files(&out).0).unwrap(), expected);
}

/// 요청이 닿으면 취소 토큰을 당기고 오래 걸리는 응답기.
struct CancelOnRequest(CancellationToken, Vec<u8>);

impl wiremock::Respond for CancelOnRequest {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        self.0.cancel();
        ResponseTemplate::new(200)
            .set_body_bytes(self.1.clone())
            .set_delay(Duration::from_secs(30))
    }
}

/// seg10을 기다리는 중에 취소 → `Cancelled`, sidecar `next_index ≤ 10`.
/// 다시 받으면 커밋된 세그먼트는 다시 요청하지 않고 결과는 바이트 동일하다.
#[tokio::test]
async fn cancel_then_resume_byte_identical() {
    const N: usize = 20;
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    let cancel = CancellationToken::new();
    // 1회차의 seg10은 요청이 닿는 순간 취소를 당기고 오래 걸린다.
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg10.m4v"))
        .respond_with(CancelOnRequest(cancel.clone(), synth_segment(10)))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);

    let r = run(config(&server), request(&out, 1), cancel, &|_| {}).await;
    assert!(matches!(r, Err(Error::Cancelled)), "{r:?}");
    let sc = sidecar_json(&out);
    let next = sc["hls"]["nextIndex"].as_u64().unwrap();
    assert!(next <= 10, "{next}");
    let committed = synth_expected(next as usize);
    assert_eq!(sc["committedLen"], committed.len() as u64);
    assert_eq!(std::fs::read(part_files(&out).0).unwrap(), committed);
    assert!(!out.exists());

    // 2회차(동시 4)
    let events = Events::default();
    let cb = events.callback();
    let r = run(
        config(&server),
        request(&out, 4),
        CancellationToken::new(),
        &cb,
    )
    .await
    .unwrap();
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: synth_expected(N).len() as u64,
            resumed_from: committed.len() as u64,
            live: None,
        }
    );
    assert_eq!(events.all()[0].resumed_from, committed.len() as u64);
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(N));
    for i in 0..next as usize {
        assert_eq!(
            requests(&server, &format!("/g0/144p/seg{i}.m4v"))
                .await
                .len(),
            1,
            "seg{i}"
        );
    }
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
}

/// `create` 직후(init을 쓰고 첫 checkpoint 전) 죽은 sidecar(`committedLen 0`, `nextIndex 0`)에서
/// 재개하면 꼬리를 잘라 init부터 다시 쓴다(구현 중 변경 32). init이 두 번 들어가지 않는다.
#[tokio::test]
async fn resume_from_empty_commit_writes_init() {
    const N: usize = 4;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);

    // 1회차: seg0이 503이고 재시도가 없어 init만 쓰고 끝난다.
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg0.m4v"))
        .respond_with(ResponseTemplate::new(503))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", N).await;
    let cfg = ClientConfig {
        retry: chzzk_core::RetryPolicy::none(),
        ..config(&server)
    };
    assert!(
        run(cfg, request(&out, 1), CancellationToken::new(), &|_| {})
            .await
            .is_err()
    );
    // init을 쓴 뒤 checkpoint 전에 죽은 상태로 만든다: `.part`에는 init이 있고 sidecar는 0이다.
    let (part, sidecar) = part_files(&out);
    assert_eq!(std::fs::read(&part).unwrap(), common::synth_init());
    let mut sc = sidecar_json(&out);
    sc["committedLen"] = 0.into();
    sc["hls"]["nextIndex"] = 0.into();
    std::fs::write(&sidecar, serde_json::to_vec(&sc).unwrap()).unwrap();

    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_synth_hls(&server, "/g0", N).await;
    let r = run(
        config(&server),
        request(&out, 2),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: synth_expected(N).len() as u64,
            resumed_from: 0,
            live: None,
        }
    );
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(N));
    assert_eq!(requests(&server, "/g0/144p/init.m4s").await.len(), 1);
    assert!(!part.exists() && !sidecar.exists());
}

/// 같은 출력으로 두 번째 다운로드를 시작하면 `FileLocked`이고, 먼저 받는 작업의 `.part`·sidecar는
/// 건드리지 않는다(§8.2 `double_download_file_locked`의 다운로드 수준 검사).
#[tokio::test]
async fn double_download_file_locked() {
    const N: usize = 3;
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    // seg0을 오래 붙잡아 1번 작업이 init만 쓴 채 잠금을 쥐고 있게 한다.
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg0.m4v"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_bytes(synth_segment(0))
                .set_delay(Duration::from_secs(30)),
        )
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let (part, sidecar) = part_files(&out);

    let cancel = CancellationToken::new();
    let first = tokio::spawn({
        let cfg = config(&server);
        let req = request(&out, 1);
        let cancel = cancel.clone();
        async move {
            let cb = |_: Progress| {};
            Chzzk::new(cfg).unwrap().download(req, cancel, &cb).await
        }
    });
    // init이 durable해지고 seg0 요청(지연 응답을 소비)이 닿을 때까지 기다린다.
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !(sidecar.exists()
        && sidecar_json(&out)["committedLen"].as_u64() > Some(0)
        && !requests(&server, "/g0/144p/seg0.m4v").await.is_empty())
    {
        assert!(
            std::time::Instant::now() < deadline,
            "1번 작업이 시작하지 않았다"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    // Windows의 바이트 범위 잠금은 다른 핸들의 읽기도 막으므로, 잠긴 동안에는 내용 대신 길이를 본다.
    let part_len_before = std::fs::metadata(&part).unwrap().len();
    let sidecar_before = std::fs::read(&sidecar).unwrap();

    let r = run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(matches!(r, Err(Error::FileLocked { .. })), "{r:?}");
    // 다른 화질로 시작해도(불일치 정리 경로) 지우지 않는다.
    let mut other = request(&out, 1);
    other.quality_id = "1080p".into();
    let r = run(config(&server), other, CancellationToken::new(), &|_| {}).await;
    assert!(matches!(r, Err(Error::FileLocked { .. })), "{r:?}");
    assert!(!first.is_finished());
    assert_eq!(std::fs::metadata(&part).unwrap().len(), part_len_before);
    assert_eq!(std::fs::read(&sidecar).unwrap(), sidecar_before);

    // 1번 작업은 취소하면 `.part`를 남기고, 이어서 끝까지 받을 수 있다.
    cancel.cancel();
    let r = first.await.unwrap();
    assert!(matches!(r, Err(Error::Cancelled)), "{r:?}");
    // 잠금이 풀린 뒤 내용 확인: 두 번째·세 번째 시도가 쓴 바이트가 없고, 커밋된 길이 그대로다.
    let part_after = std::fs::read(&part).unwrap();
    assert_eq!(part_after.len() as u64, part_len_before);
    assert_eq!(
        Some(part_len_before),
        serde_json::from_slice::<serde_json::Value>(&sidecar_before).unwrap()["committedLen"]
            .as_u64()
    );
    run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(N));
}

/// 이어받기 전에 playlist가 바뀌었으면(세그먼트 수) `SourceChanged`. 이어받을 수 없으므로 지운다.
#[tokio::test]
async fn resume_fingerprint_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);

    // 1회차: seg3이 503이고 재시도가 없어 끊긴다(.part 남음).
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg3.m4v"))
        .respond_with(ResponseTemplate::new(503))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 6).await;
    let cfg = ClientConfig {
        retry: chzzk_core::RetryPolicy::none(),
        ..config(&server)
    };
    let r = run(cfg, request(&out, 1), CancellationToken::new(), &|_| {}).await;
    assert!(
        matches!(r, Err(Error::HttpStatus { status: 503, .. })),
        "{r:?}"
    );
    assert_eq!(sidecar_json(&out)["hls"]["nextIndex"], 3);

    // 2회차: 세그먼트가 7개로 바뀌었다.
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_synth_hls(&server, "/g0", 7).await;
    let r = run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(matches!(r, Err(Error::SourceChanged { .. })), "{r:?}");
    assert!(requests(&server, "/g0/144p/seg3.m4v").await.is_empty());
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
}

/// EXTINF가 바뀌어도(세그먼트 수는 같음) `SourceChanged`.
#[tokio::test]
async fn resume_durations_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg2.m4v"))
        .respond_with(ResponseTemplate::new(503))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 4).await;
    let cfg = ClientConfig {
        retry: chzzk_core::RetryPolicy::none(),
        ..config(&server)
    };
    assert!(
        run(cfg, request(&out, 1), CancellationToken::new(), &|_| {})
            .await
            .is_err()
    );

    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/media.m3u8"))
        .respond_with(ResponseTemplate::new(200).set_body_string(synth_media(4, "1.500")))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 4).await;
    let r = run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(matches!(r, Err(Error::SourceChanged { .. })), "{r:?}");
}

/// 길이가 다른 init(`ftyp`로 시작). 지문의 init 길이만 바뀐다.
fn longer_init() -> Vec<u8> {
    let mut v = common::synth_init();
    v.extend_from_slice(b"MORE");
    v
}

/// init 길이만 바뀌어도(playlist는 같음) 재개 때 `SourceChanged`이고 `.part`를 지운다(결정 13).
#[tokio::test]
async fn resume_init_len_mismatch() {
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg2.m4v"))
        .respond_with(ResponseTemplate::new(503))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 4).await;
    let cfg = ClientConfig {
        retry: chzzk_core::RetryPolicy::none(),
        ..config(&server)
    };
    assert!(
        run(cfg, request(&out, 1), CancellationToken::new(), &|_| {})
            .await
            .is_err()
    );
    assert_eq!(sidecar_json(&out)["hls"]["nextIndex"], 2);

    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/init.m4s"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(longer_init()))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 4).await;
    let r = run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    match r {
        Err(Error::SourceChanged { ref detail }) => assert!(detail.contains("init"), "{detail}"),
        r => panic!("{r:?}"),
    }
    assert!(requests(&server, "/g0/144p/seg2.m4v").await.is_empty());
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
}

/// 없는 화질은 `QualityNotFound`(세그먼트 요청 없음).
#[tokio::test]
async fn quality_not_found() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_synth_hls(&server, "/g0", 3).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let req = DownloadRequest {
        throttle: Default::default(),
        quality_id: "1080p".into(),
        ..request(&out, 1)
    };
    let r = run(config(&server), req, CancellationToken::new(), &|_| {}).await;
    assert!(matches!(r, Err(Error::QualityNotFound { .. })), "{r:?}");
    assert!(requests(&server, "/g0/144p/seg0.m4v").await.is_empty());
    let (part, _) = part_files(&out);
    assert!(!part.exists());
}

// ---- 12단계: 동시 요청과 재조회 ----

/// 무작위 지연이 있어도 동시 6개로 받은 결과의 순서가 입력 순서와 같다.
#[tokio::test]
async fn ordered_with_jitter() {
    const N: usize = 30;
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    for i in 0..N {
        // 결정적인 "무작위" 지연(0~45ms). 뒤 세그먼트가 먼저 끝나기도 한다.
        let ms = ((i * 37 + 11) % 10) as u64 * 5;
        Mock::given(method("GET"))
            .and(path(format!("/g0/144p/seg{i}.m4v")))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(synth_segment(i))
                    .set_delay(Duration::from_millis(ms)),
            )
            .with_priority(1)
            .mount(&server)
            .await;
    }
    mount_synth_hls(&server, "/g0", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    run(
        config(&server),
        request(&out, 6),
        CancellationToken::new(),
        &cb,
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(N));
    // 진행률의 세그먼트 수는 하나씩 늘어난다.
    let ks: Vec<u32> = events
        .all()
        .iter()
        .filter(|p| p.phase == Phase::Downloading)
        .filter_map(|p| p.segments.map(|(k, _)| k))
        .collect();
    assert_eq!(ks, (0..=N as u32).collect::<Vec<_>>());
}

/// 상한(8)보다 큰 동시 요청 수도 받아들인다.
#[tokio::test]
async fn concurrency_clamped() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_synth_hls(&server, "/g0", 12).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    run(
        config(&server),
        request(&out, 200),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(12));
}

/// 503 두 번 뒤 성공하면 이어 간다.
#[tokio::test]
async fn retry_5xx() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg3.m4v"))
        .respond_with(ResponseTemplate::new(503))
        .up_to_n_times(2)
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 8).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    run(
        config(&server),
        request(&out, 4),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(8));
    assert_eq!(requests(&server, "/g0/144p/seg3.m4v").await.len(), 3);
}

/// seg k≥5에서 403 → info를 다시 받아(`/g0/` → `/g1/`) 같은 index부터 잇는다.
#[tokio::test]
async fn expired_resume_same_index() {
    const N: usize = 12;
    let server = MockServer::start().await;
    mount_info(&server, "/g0", Some(1)).await;
    mount_info(&server, "/g1", None).await;
    for i in 5..N {
        Mock::given(method("GET"))
            .and(path(format!("/g0/144p/seg{i}.m4v")))
            .respond_with(ResponseTemplate::new(403))
            .with_priority(1)
            .mount(&server)
            .await;
    }
    mount_synth_hls(&server, "/g0", N).await;
    mount_synth_hls(&server, "/g1", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = run(
        config(&server),
        request(&out, 4),
        CancellationToken::new(),
        &cb,
    )
    .await
    .unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 0,
            ..
        }
    ));
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(N));
    assert_eq!(requests(&server, INFO_PATH).await.len(), 2);
    for i in 0..5 {
        assert_eq!(
            requests(&server, &format!("/g0/144p/seg{i}.m4v"))
                .await
                .len(),
            1
        );
        assert!(
            requests(&server, &format!("/g1/144p/seg{i}.m4v"))
                .await
                .is_empty()
        );
    }
    for i in 5..N {
        assert_eq!(
            requests(&server, &format!("/g1/144p/seg{i}.m4v"))
                .await
                .len(),
            1
        );
    }
    assert_eq!(events.last().refreshes, 1);
    assert!(events.all().iter().any(|p| p.phase == Phase::Reresolving));
}

/// playlist(master) 요청이 403이어도 재조회한다.
#[tokio::test]
async fn expired_playlist_reresolves() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", Some(1)).await;
    mount_info(&server, "/g1", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/master.m3u8"))
        .respond_with(ResponseTemplate::new(403))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g1", 3).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    run(
        config(&server),
        request(&out, 2),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(3));
}

/// 재조회한 media playlist의 세그먼트 수·EXTINF가 다르면 `SourceChanged`.
#[tokio::test]
async fn refresh_fingerprint_mismatch() {
    for changed in [synth_media(13, "2.000"), synth_media(12, "1.000")] {
        let server = MockServer::start().await;
        mount_info(&server, "/g0", Some(1)).await;
        mount_info(&server, "/g1", None).await;
        Mock::given(method("GET"))
            .and(path("/g0/144p/seg5.m4v"))
            .respond_with(ResponseTemplate::new(403))
            .with_priority(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/g1/144p/media.m3u8"))
            .respond_with(ResponseTemplate::new(200).set_body_string(changed))
            .with_priority(1)
            .mount(&server)
            .await;
        mount_synth_hls(&server, "/g0", 12).await;
        mount_synth_hls(&server, "/g1", 12).await;
        let dir = tempfile::tempdir().unwrap();
        let out = out_path(&dir);
        let r = run(
            config(&server),
            request(&out, 1),
            CancellationToken::new(),
            &|_| {},
        )
        .await;
        assert!(matches!(r, Err(Error::SourceChanged { .. })), "{r:?}");
        assert!(requests(&server, "/g1/144p/seg5.m4v").await.is_empty());
        // 작업 도중 재조회의 지문 불일치는 `.part`를 남긴다(설계 §8.2, 구현 중 변경 35).
        let (part, _) = part_files(&out);
        assert_eq!(std::fs::read(part).unwrap(), synth_expected(5));
        assert_eq!(sidecar_json(&out)["hls"]["nextIndex"], 5);
    }
}

/// 재조회 뒤 init 길이만 바뀌면 `SourceChanged`이고, 작업 도중이므로 `.part`는 남긴다(구현 중 변경 35).
#[tokio::test]
async fn refresh_init_len_mismatch() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", Some(1)).await;
    mount_info(&server, "/g1", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg5.m4v"))
        .respond_with(ResponseTemplate::new(403))
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/g1/144p/init.m4s"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(longer_init()))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 12).await;
    mount_synth_hls(&server, "/g1", 12).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    match r {
        Err(Error::SourceChanged { ref detail }) => assert!(detail.contains("init"), "{detail}"),
        r => panic!("{r:?}"),
    }
    assert_eq!(requests(&server, "/g1/144p/init.m4s").await.len(), 1);
    assert!(requests(&server, "/g1/144p/seg5.m4v").await.is_empty());
    let (part, _) = part_files(&out);
    assert_eq!(std::fs::read(part).unwrap(), synth_expected(5));
    assert_eq!(sidecar_json(&out)["hls"]["nextIndex"], 5);
}

/// 재조회 결과에 `inKey`가 생겼으면(DASH) `PlaybackChanged`.
#[tokio::test]
async fn refresh_became_dash() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", Some(1)).await;
    Mock::given(method("GET"))
        .and(path(INFO_PATH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("testdata/vod/video_info.json"), "application/json"),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{}",
            common::VOD_VIDEO_ID
        )))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("testdata/vod/playback.mpd"), "application/dash+xml"),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg5.m4v"))
        .respond_with(ResponseTemplate::new(403))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 8).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        request(&out, 2),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(
        matches!(
            r,
            Err(Error::PlaybackChanged {
                was: PlaybackKind::LiveRewindHls,
                now: PlaybackKind::Progressive
            })
        ),
        "{r:?}"
    );
}

/// 재조회 직후 같은 세그먼트가 또 403이면 `AuthRequired`이고 `.part`를 지운다.
#[tokio::test]
async fn forbidden_after_refresh() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg5.m4v"))
        .respond_with(ResponseTemplate::new(403))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 8).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        request(&out, 3),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(
        matches!(r, Err(Error::AuthRequired { status: 403 })),
        "{r:?}"
    );
    assert_eq!(requests(&server, INFO_PATH).await.len(), 2);
    assert_eq!(requests(&server, "/g0/144p/seg5.m4v").await.len(), 2);
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
}

/// 세그먼트마다 한 번씩 403(매번 재조회 후 성공) → 9번째 재조회에서 `RefreshExhausted`.
/// 이어받을 수 있으므로 `.part`는 남는다.
#[tokio::test]
async fn refresh_exhausted() {
    const N: usize = 12;
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    for i in 1..N {
        Mock::given(method("GET"))
            .and(path(format!("/g0/144p/seg{i}.m4v")))
            .respond_with(ResponseTemplate::new(403))
            .up_to_n_times(1)
            .with_priority(1)
            .mount(&server)
            .await;
    }
    mount_synth_hls(&server, "/g0", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = run(
        config(&server),
        request(&out, 1),
        CancellationToken::new(),
        &cb,
    )
    .await;
    assert!(matches!(r, Err(Error::RefreshExhausted)), "{r:?}");
    assert_eq!(events.last().refreshes, 8);
    let sc = sidecar_json(&out);
    assert_eq!(sc["hls"]["nextIndex"], 9);
    assert_eq!(
        std::fs::read(part_files(&out).0).unwrap(),
        synth_expected(9)
    );
}

// ---- 구간 받기(기능 ②, core.md 64) ----

fn range_request(out: &Path, conc: u8, start_ms: u64, end_ms: Option<u64>) -> DownloadRequest {
    DownloadRequest {
        throttle: Default::default(),
        range: Some(TimeRange { start_ms, end_ms }),
        ..request(out, conc)
    }
}

/// 합성 바이트(변환되지 않는다)의 구간 결과: init ‖ seg[first..last_excl].
fn synth_range(first: usize, last_excl: usize) -> Vec<u8> {
    let mut v = synth_init();
    for i in first..last_excl {
        v.extend(synth_segment(i));
    }
    v
}

async fn seg_count(server: &MockServer, prefix: &str, i: usize) -> usize {
    requests(server, &format!("{prefix}/144p/seg{i}.m4v"))
        .await
        .len()
}

/// 고른 조각만 요청하고, 진행률의 분모는 구간이다.
#[tokio::test]
async fn range_requests_only_selected_segments() {
    const N: usize = 20;
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_synth_hls(&server, "/g0", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = run(
        config(&server),
        range_request(&out, 4, 7000, Some(23000)),
        CancellationToken::new(),
        &cb,
    )
    .await
    .unwrap();
    let want = synth_range(3, 12);
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: want.len() as u64,
            resumed_from: 0,
            live: None,
        }
    );
    // 합성 바이트는 진짜 fMP4가 아니라 변환되지 않는다.
    assert_eq!(std::fs::read(&out).unwrap(), want);
    for i in (0..3).chain(12..N) {
        assert_eq!(seg_count(&server, "/g0", i).await, 0, "seg{i}");
    }
    for i in 3..12 {
        assert_eq!(seg_count(&server, "/g0", i).await, 1, "seg{i}");
    }
    let last = events.last();
    assert_eq!(last.segments, Some((9, 9)));
    assert_eq!(last.media_secs, Some((18.0, 18.0)));
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
}

/// seg8에서 취소한 구간 `.part`: sidecar는 v2이고 구간·위치를 적는다.
async fn cancel_range_at_seg8(server: &MockServer, out: &Path, n: usize) -> serde_json::Value {
    let cancel = CancellationToken::new();
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg8.m4v"))
        .respond_with(CancelOnRequest(cancel.clone(), synth_segment(8)))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(server)
        .await;
    mount_info(server, "/g0", None).await;
    mount_synth_hls(server, "/g0", n).await;
    let r = run(
        config(server),
        range_request(out, 1, 7000, Some(23000)),
        cancel,
        &|_| {},
    )
    .await;
    assert!(matches!(r, Err(Error::Cancelled)), "{r:?}");
    sidecar_json(out)
}

#[tokio::test]
async fn range_sidecar_is_v2() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let sc = cancel_range_at_seg8(&server, &out, 20).await;
    assert_eq!(sc["v"], 2);
    assert_eq!(
        sc["hls"]["range"],
        serde_json::json!({"first": 3, "lastExcl": 12, "startMs": 7000, "endMs": 23000})
    );
    let next = sc["hls"]["nextIndex"].as_u64().unwrap() as usize;
    assert!((3..=8).contains(&next), "{next}");
    assert_eq!(
        sc["committedLen"],
        synth_range(3, next).len() as u64,
        "committedLen은 조각 경계다"
    );
    assert_eq!(
        std::fs::read(part_files(&out).0).unwrap(),
        synth_range(3, next)
    );
}

#[tokio::test]
async fn range_cancel_then_resume_byte_identical() {
    const N: usize = 20;
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let sc = cancel_range_at_seg8(&server, &out, N).await;
    let next = sc["hls"]["nextIndex"].as_u64().unwrap() as usize;
    let committed = synth_range(3, next).len() as u64;

    let events = Events::default();
    let cb = events.callback();
    let r = run(
        config(&server),
        range_request(&out, 4, 7000, Some(23000)),
        CancellationToken::new(),
        &cb,
    )
    .await
    .unwrap();
    let want = synth_range(3, 12);
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: want.len() as u64,
            resumed_from: committed,
            live: None,
        }
    );
    assert_eq!(events.all()[0].resumed_from, committed);
    let resumed = std::fs::read(&out).unwrap();
    assert_eq!(resumed, want);

    // 끊김 없이 받은 같은 구간과 바이트가 같다.
    let server2 = MockServer::start().await;
    mount_info(&server2, "/g0", None).await;
    mount_synth_hls(&server2, "/g0", N).await;
    let dir2 = tempfile::tempdir().unwrap();
    let out2 = out_path(&dir2);
    run(
        config(&server2),
        range_request(&out2, 4, 7000, Some(23000)),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&out2).unwrap(), resumed);

    // 1회차에 커밋된 조각은 2회차에 다시 요청하지 않는다.
    for i in 3..next {
        assert_eq!(seg_count(&server, "/g0", i).await, 1, "seg{i}");
    }
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
}

/// init만 쓰고 첫 checkpoint 전에 죽은 구간 sidecar(`committedLen 0`, `nextIndex 3`)에서 재개하면
/// init을 다시 쓰고 `nextIndex`를 구간 시작(3)으로 둔다. init이 두 번 들어가지 않는다.
#[tokio::test]
async fn range_resume_from_empty_commit_writes_init_at_first() {
    const N: usize = 20;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    // 1회차: 구간 첫 조각(seg3)이 503이고 재시도가 없어 init만 쓰고 끝난다.
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg3.m4v"))
        .respond_with(ResponseTemplate::new(503))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", N).await;
    let cfg = ClientConfig {
        retry: chzzk_core::RetryPolicy::none(),
        ..config(&server)
    };
    assert!(
        run(
            cfg,
            range_request(&out, 1, 7000, Some(23000)),
            CancellationToken::new(),
            &|_| {}
        )
        .await
        .is_err()
    );
    let (part, sidecar) = part_files(&out);
    assert_eq!(std::fs::read(&part).unwrap(), synth_init());
    let mut sc = sidecar_json(&out);
    assert_eq!(sc["hls"]["nextIndex"], 3);
    // init을 쓴 뒤 checkpoint 전에 죽은 상태: sidecar는 0이고 `.part`에는 init과 쓰레기 꼬리가 있다.
    sc["committedLen"] = 0.into();
    std::fs::write(&sidecar, serde_json::to_vec(&sc).unwrap()).unwrap();
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&part)
            .unwrap();
        f.write_all(b"GARBAGE-TAIL").unwrap();
    }

    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_synth_hls(&server, "/g0", N).await;
    let r = run(
        config(&server),
        range_request(&out, 2, 7000, Some(23000)),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    let want = synth_range(3, 12);
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: want.len() as u64,
            resumed_from: 0,
            live: None,
        }
    );
    assert_eq!(std::fs::read(&out).unwrap(), want);
    assert_eq!(requests(&server, "/g0/144p/init.m4s").await.len(), 1);
    for i in (0..3).chain(12..N) {
        assert_eq!(seg_count(&server, "/g0", i).await, 0, "seg{i}");
    }
    assert!(!part.exists() && !sidecar.exists());
}

/// 구간 중간에 주소가 만료돼도(403) 같은 위치부터 구간 끝까지 잇는다.
#[tokio::test]
async fn range_expired_mid_range_reresolves() {
    const N: usize = 20;
    let server = MockServer::start().await;
    mount_info(&server, "/g0", Some(1)).await;
    mount_info(&server, "/g1", None).await;
    for i in 6..N {
        Mock::given(method("GET"))
            .and(path(format!("/g0/144p/seg{i}.m4v")))
            .respond_with(ResponseTemplate::new(403))
            .with_priority(1)
            .mount(&server)
            .await;
    }
    mount_synth_hls(&server, "/g0", N).await;
    mount_synth_hls(&server, "/g1", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    run(
        config(&server),
        range_request(&out, 4, 7000, Some(23000)),
        CancellationToken::new(),
        &cb,
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&out).unwrap(), synth_range(3, 12));
    for i in 3..6 {
        assert_eq!(seg_count(&server, "/g0", i).await, 1, "g0 seg{i}");
        assert_eq!(seg_count(&server, "/g1", i).await, 0, "g1 seg{i}");
    }
    for i in 6..12 {
        assert_eq!(seg_count(&server, "/g1", i).await, 1, "g1 seg{i}");
    }
    for i in (0..3).chain(12..N) {
        assert_eq!(seg_count(&server, "/g0", i).await, 0, "g0 seg{i}");
        assert_eq!(seg_count(&server, "/g1", i).await, 0, "g1 seg{i}");
    }
    assert_eq!(events.last().refreshes, 1);
}

/// 재조회 직후 같은 조각이 또 403이면 `AuthRequired`이고 `.part`를 지운다.
#[tokio::test]
async fn range_forbidden_after_refresh_is_auth_required() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg6.m4v"))
        .respond_with(ResponseTemplate::new(403))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 20).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        range_request(&out, 3, 7000, Some(23000)),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(
        matches!(r, Err(Error::AuthRequired { status: 403 })),
        "{r:?}"
    );
    assert_eq!(requests(&server, INFO_PATH).await.len(), 2);
    assert_eq!(seg_count(&server, "/g0", 6).await, 2);
    for i in 0..3 {
        assert_eq!(seg_count(&server, "/g0", i).await, 0, "seg{i}");
    }
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
}

/// 재조회한 playlist가 다르면 `SourceChanged`이고 받은 구간은 남긴다.
#[tokio::test]
async fn range_refresh_fingerprint_mismatch_keeps_part() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", Some(1)).await;
    mount_info(&server, "/g1", None).await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg6.m4v"))
        .respond_with(ResponseTemplate::new(403))
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/g1/144p/media.m3u8"))
        .respond_with(ResponseTemplate::new(200).set_body_string(synth_media(21, "2.000")))
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", 20).await;
    mount_synth_hls(&server, "/g1", 20).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        range_request(&out, 1, 7000, Some(23000)),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(matches!(r, Err(Error::SourceChanged { .. })), "{r:?}");
    let sc = sidecar_json(&out);
    assert!(sc["committedLen"].as_u64().unwrap() > 0);
    assert_eq!(sc["v"], 2);
    assert_eq!(
        std::fs::read(part_files(&out).0).unwrap(),
        synth_range(3, 6)
    );
}

/// 구간이 영상 밖이면 `.part`를 만들지 않고 조각도 받지 않는다.
#[tokio::test]
async fn range_out_of_bounds_creates_no_part() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_synth_hls(&server, "/g0", 5).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        range_request(&out, 2, 10000, None),
        CancellationToken::new(),
        &|_| {},
    )
    .await;
    assert!(matches!(r, Err(Error::RangeOutOfBounds { .. })), "{r:?}");
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
    for i in 0..5 {
        assert_eq!(seg_count(&server, "/g0", i).await, 0, "seg{i}");
    }
}

/// 다른 구간의 `.part`는 이어받지 않고 새로 시작한다.
#[tokio::test]
async fn range_different_from_sidecar_restarts() {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    cancel_range_at_seg8(&server, &out, 20).await;
    let r = run(
        config(&server),
        range_request(&out, 2, 2000, Some(9000)),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    let want = synth_range(1, 5);
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: want.len() as u64,
            resumed_from: 0,
            live: None,
        }
    );
    assert_eq!(std::fs::read(&out).unwrap(), want);
}

/// 구간 `.part` 뒤의 전체 받기는 새로 시작한다(전체 받기 회귀). 합성 조각은 해석할 수 없는 상자라 마무리 변환이
/// 바꾸기 전에 멈추고(`DefragError::Unchanged`) 받은 바이트 그대로 마무리한다.
#[tokio::test]
async fn full_after_range_part_restarts() {
    const N: usize = 20;
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    cancel_range_at_seg8(&server, &out, N).await;
    let r = run(
        config(&server),
        request(&out, 4),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert!(matches!(
        r,
        DownloadOutcome::Completed {
            resumed_from: 0,
            ..
        }
    ));
    assert_eq!(std::fs::read(&out).unwrap(), synth_expected(N));
}

// ---- 실제 fMP4 조각(합성)으로 일반 mp4 변환 ----

static REAL: std::sync::LazyLock<(Vec<u8>, Vec<Vec<u8>>)> =
    std::sync::LazyLock::new(|| mp4::split_fragments(&fixture("testdata/live/synthetic_frag.mp4")));

/// init·조각을 합성 fMP4(`REAL`)로 준다. 조각 수를 돌려준다.
async fn mount_real_hls(server: &MockServer, prefix: &str) -> usize {
    let n = REAL.1.len();
    Mock::given(method("GET"))
        .and(path(format!("{prefix}/master.m3u8")))
        .respond_with(ResponseTemplate::new(200).set_body_string(common::SYNTH_MASTER))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("{prefix}/144p/media.m3u8")))
        .respond_with(ResponseTemplate::new(200).set_body_string(synth_media(n, "2.000")))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("{prefix}/144p/init.m4s")))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(REAL.0.clone()))
        .mount(server)
        .await;
    for (i, seg) in REAL.1.iter().enumerate() {
        Mock::given(method("GET"))
            .and(path(format!("{prefix}/144p/seg{i}.m4v")))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(seg.clone()))
            .mount(server)
            .await;
    }
    n
}

/// 조각의 `tfdt` baseMediaDecodeTime(v0 32비트, v1 64비트). 상자 탐색 없이 첫 `tfdt`를 찾는다.
fn tfdt_of(seg: &[u8]) -> u64 {
    let at = seg.windows(4).position(|w| w == b"tfdt").expect("tfdt");
    let body = &seg[at + 4..];
    match body[0] {
        0 => u64::from(u32::from_be_bytes(body[4..8].try_into().unwrap())),
        _ => u64::from_be_bytes(body[4..12].try_into().unwrap()),
    }
}

/// 구간 결과는 일반 mp4이고, 고른 조각의 미디어 데이터가 순서대로 들어 있다.
#[tokio::test]
async fn range_result_is_flat_mp4_from_nonzero_tfdt() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    let n = mount_real_hls(&server, "/g0").await;
    assert_eq!(n, 7);
    // fixture 가정: 구간 첫 조각의 시각은 0이 아니다(시각을 0부터 다시 쌓는지 보려면 필요하다).
    assert_ne!(tfdt_of(&REAL.1[2]), 0, "fixture 가정이 틀렸다");
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        range_request(&out, 2, 4000, Some(10000)),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    let got = std::fs::read(&out).unwrap();
    let DownloadOutcome::Completed { bytes, .. } = r else {
        panic!("{r:?}")
    };
    assert_eq!(bytes, got.len() as u64);
    mp4::assert_flat_mp4(&got);
    let want: Vec<u8> = REAL.1[2..5]
        .iter()
        .flat_map(|s| mp4::mdat_payloads(s))
        .flatten()
        .collect();
    let have: Vec<u8> = mp4::mdat_payloads(&got).into_iter().flatten().collect();
    assert_eq!(have, want);
    for i in [0, 1, 5, 6] {
        assert_eq!(seg_count(&server, "/g0", i).await, 0, "seg{i}");
    }
}

/// 전체 받기 결과도 일반 mp4이고, 모든 조각의 미디어 데이터가 순서대로 들어 있다(R5, core.md 구현 중 변경 71).
/// 조각 구조로 두면 QuickTime이 첫 조각만 재생한다(core.md 60과 같은 증상).
#[tokio::test]
async fn full_download_result_is_flat_mp4() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    let n = mount_real_hls(&server, "/g0").await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = run(
        config(&server),
        request(&out, 2),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    let got = std::fs::read(&out).unwrap();
    let DownloadOutcome::Completed { bytes, .. } = r else {
        panic!("{r:?}")
    };
    assert_eq!(bytes, got.len() as u64);
    mp4::assert_flat_mp4(&got);
    let want: Vec<u8> = REAL
        .1
        .iter()
        .flat_map(|s| mp4::mdat_payloads(s))
        .flatten()
        .collect();
    let have: Vec<u8> = mp4::mdat_payloads(&got).into_iter().flatten().collect();
    assert_eq!(have, want);
    for i in 0..n {
        assert_eq!(seg_count(&server, "/g0", i).await, 1, "seg{i}");
    }
    let (part, sidecar) = part_files(&out);
    assert!(!part.exists() && !sidecar.exists());
}

/// 전체 받기도 변환이 끝난 뒤 rename 전에 끊기면(`Skipped`) 다음 실행이 조각을 다시 받지 않고 마무리한다.
/// 구간 sidecar(v2)가 아닌 전체 받기 sidecar(v1) 위의 일반 mp4 `.part`를 이어받는 경로다.
#[tokio::test]
async fn full_converted_then_skipped_resumes_without_refetch() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    let n = mount_real_hls(&server, "/g0").await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let (part, sidecar) = part_files(&out);

    let out2 = out.clone();
    let cb = move |p: Progress| {
        if p.phase == Phase::Finalizing {
            std::fs::write(&out2, b"someone else").unwrap();
        }
    };
    let req = DownloadRequest {
        throttle: Default::default(),
        on_existing: DuplicatePolicy::Skip,
        ..request(&out, 2)
    };
    let r = run(config(&server), req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Skipped { .. }), "{r:?}");
    let converted = std::fs::read(&part).unwrap();
    mp4::assert_flat_mp4(&converted);
    assert!(sidecar.exists());

    std::fs::remove_file(&out).unwrap();
    let r = run(
        config(&server),
        request(&out, 2),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    for i in 0..n {
        assert_eq!(seg_count(&server, "/g0", i).await, 1, "seg{i}");
    }
    assert_eq!(std::fs::read(&out).unwrap(), converted);
    assert!(!part.exists() && !sidecar.exists());
}

/// 변환이 끝난 뒤 rename 전에 끊긴 구간 `.part`는 조각을 다시 받지 않고 마무리한다.
#[tokio::test]
async fn range_converted_then_skipped_resumes_without_refetch() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_real_hls(&server, "/g0").await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let (part, sidecar) = part_files(&out);

    // 1회차: 마무리 단계에서 최종 경로에 파일이 생겨 `Skipped`로 끝난다(변환은 끝난 뒤다).
    let out2 = out.clone();
    let cb = move |p: Progress| {
        if p.phase == Phase::Finalizing {
            std::fs::write(&out2, b"someone else").unwrap();
        }
    };
    let req = DownloadRequest {
        throttle: Default::default(),
        on_existing: DuplicatePolicy::Skip,
        ..range_request(&out, 2, 4000, Some(10000))
    };
    let r = run(config(&server), req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Skipped { .. }), "{r:?}");
    let converted = std::fs::read(&part).unwrap();
    mp4::assert_flat_mp4(&converted);
    assert!(sidecar.exists());

    // 2회차: 최종 파일을 지우고 덮어쓰기로. 조각은 다시 받지 않는다.
    std::fs::remove_file(&out).unwrap();
    let r = run(
        config(&server),
        range_request(&out, 2, 4000, Some(10000)),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    for i in 0..7 {
        let want = usize::from((2..5).contains(&i));
        assert_eq!(seg_count(&server, "/g0", i).await, want, "seg{i}");
    }
    assert_eq!(std::fs::read(&out).unwrap(), converted);
    assert!(!part.exists() && !sidecar.exists());
}

// ---- mp4 메타데이터(`embed_metadata`, mp4-metadata.md §6.1·§13.4) ----

const COVER_PATH: &str = "/thumb/cover.jpg";

/// info의 표지 주소를 mock 서버로 돌리고 표지를 mount한다.
async fn mount_info_with_cover(server: &MockServer, prefix: &str) {
    let master = format!("{}{prefix}/master.m3u8?hdnts=st=1~hmac=x", server.uri());
    let body = common::with_thumbnail(
        &hls_info(&master),
        Some(&format!("{}{COVER_PATH}", server.uri())),
    );
    Mock::given(method("GET"))
        .and(path(INFO_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_raw(body, "application/json"))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(COVER_PATH))
        .respond_with(
            ResponseTemplate::new(200).set_body_bytes(fixture("testdata/synthetic/thumb.png")),
        )
        .mount(server)
        .await;
}

fn meta_cfg(server: &MockServer) -> ClientConfig {
    ClientConfig {
        allow_loopback_http_images: true,
        ..config(server)
    }
}

fn ilst_last(b: &[u8]) -> Vec<(String, u32, Vec<u8>)> {
    mp4::ilst_items(mp4::find_path_last(b, &["moov", "udta", "meta", "ilst"]).unwrap()).unwrap()
}

/// 전체 받기: 변환이 만든 새 moov에 태그와 표지가 함께 들어가고, moov는 하나뿐이다.
#[tokio::test]
async fn full_download_gets_tags_and_cover_in_the_converted_moov() {
    let server = MockServer::start().await;
    mount_info_with_cover(&server, "/g0").await;
    mount_real_hls(&server, "/g0").await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let req = DownloadRequest {
        embed_metadata: true,
        ..request(&out, 2)
    };
    let r = run(meta_cfg(&server), req, CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    let b = std::fs::read(&out).unwrap();
    mp4::assert_flat_mp4(&b);
    assert_eq!(mp4::top_moov_count(&b), 1);
    let items = ilst_last(&b);
    let kinds: Vec<&str> = items.iter().map(|i| i.0.as_str()).collect();
    assert_eq!(kinds, ["©nam", "©ART", "©day", "©cmt", "covr"]);
    assert_eq!(items[0].2, "테스트 다시보기".as_bytes());
    assert_eq!(items[1].2, "테스트채널".as_bytes());
    assert_eq!(items[2].2, b"2026-01-02");
    assert_eq!(items[3].2, b"https://chzzk.naver.com/video/9000001");
    assert_eq!(
        (items[4].1, items[4].2.clone()),
        (14, fixture("testdata/synthetic/thumb.png"))
    );
    // 표지 요청에는 쿠키가 없다
    let cover = requests(&server, COVER_PATH).await;
    assert_eq!(cover.len(), 1);
    assert!(cover[0].headers.get("cookie").is_none());
}

/// 끄면 지금까지와 같다: 태그도 표지 요청도 없다.
#[tokio::test]
async fn full_download_with_metadata_off_has_no_udta() {
    let server = MockServer::start().await;
    mount_info_with_cover(&server, "/g0").await;
    mount_real_hls(&server, "/g0").await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    run(
        meta_cfg(&server),
        request(&out, 2),
        CancellationToken::new(),
        &|_| {},
    )
    .await
    .unwrap();
    let b = std::fs::read(&out).unwrap();
    mp4::assert_flat_mp4(&b);
    assert!(mp4::find_path_last(&b, &["moov", "udta"]).is_none());
    assert!(requests(&server, COVER_PATH).await.is_empty());
}

/// 구간 받기: 제목 뒤에 파일 이름과 같은 접미사가 붙는다.
#[tokio::test]
async fn range_download_name_has_the_range_suffix() {
    let server = MockServer::start().await;
    mount_info_with_cover(&server, "/g0").await;
    mount_real_hls(&server, "/g0").await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let req = DownloadRequest {
        embed_metadata: true,
        ..range_request(&out, 2, 4000, Some(10000))
    };
    run(meta_cfg(&server), req, CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    let b = std::fs::read(&out).unwrap();
    mp4::assert_flat_mp4(&b);
    let items = ilst_last(&b);
    assert_eq!(items[0].0, "©nam");
    assert_eq!(items[0].2, "테스트 다시보기 (0.00.04~0.00.10)".as_bytes());
}

/// 변환(+태그) 뒤 rename 전에 끊기면(`Skipped`) 다음 실행이 조각을 다시 받지 않고, 같은 결과로 마무리한다.
#[tokio::test]
async fn tagged_full_then_skipped_resumes_without_refetch() {
    let server = MockServer::start().await;
    mount_info_with_cover(&server, "/g0").await;
    let n = mount_real_hls(&server, "/g0").await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let (part, sidecar) = part_files(&out);

    let out2 = out.clone();
    let cb = move |p: Progress| {
        if p.phase == Phase::Finalizing {
            std::fs::write(&out2, b"someone else").unwrap();
        }
    };
    let req = DownloadRequest {
        embed_metadata: true,
        on_existing: DuplicatePolicy::Skip,
        ..request(&out, 2)
    };
    let r = run(meta_cfg(&server), req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Skipped { .. }), "{r:?}");
    let converted = std::fs::read(&part).unwrap();
    mp4::assert_flat_mp4(&converted);
    assert_eq!(ilst_last(&converted).len(), 5);
    assert!(sidecar.exists());

    std::fs::remove_file(&out).unwrap();
    let req = DownloadRequest {
        embed_metadata: true,
        ..request(&out, 2)
    };
    let r = run(meta_cfg(&server), req, CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    for i in 0..n {
        assert_eq!(seg_count(&server, "/g0", i).await, 1, "seg{i}");
    }
    // 이미 일반 mp4라 다시 쓰지 않는다: 첫 실행이 넣은 태그가 그대로다
    assert_eq!(std::fs::read(&out).unwrap(), converted);
}

/// 앱 기본 설정(메타데이터 켬)으로 합성 fixture를 받은 결과의 golden(네이티브 E2E가 같은 파일로 판정한다, mp4-metadata.md §13.5).
/// `©ART`·`©cmt`(영상 번호)가 채널마다 달라 golden이 둘이다: 본인 채널, 맡은 채널(`scripts/ci/e2e-fixture-server.mjs`의 같은 변형 규칙).
/// 태그는 info에서만 만들고 벽시계·버전을 넣지 않아 릴리스마다 바뀌지 않는다.
/// 다시 만들기: `UPDATE_FLAT_GOLDEN=1 cargo test -p chzzk-core --test segmented fixture_tagged_goldens`
#[tokio::test]
async fn fixture_tagged_goldens() {
    // (golden, 영상 번호, 채널 ID, 채널 이름, `©ART`)
    let variants: [(&str, u64, &str, &str); 2] = [
        (
            "testdata/hls/full2_tagged_own.mp4",
            9000001,
            "000000000000000000000000000000a1",
            "테스트채널",
        ),
        (
            "testdata/hls/full2_tagged_delegated.mp4",
            9000201,
            "000000000000000000000000000000b2",
            "맡은채널",
        ),
    ];
    let mut outputs = Vec::new();
    for (golden, video_no, channel_id, channel_name) in variants {
        let server = MockServer::start().await;
        // 영상 번호·채널 ID·채널 이름만 바꾼 info(표지 주소의 영상 번호도 따라 바뀐다)
        let info = String::from_utf8(rewrite_hosts(
            &fixture("testdata/hls/video_info.json"),
            &server.uri(),
        ))
        .unwrap()
        .replace("9000001", &video_no.to_string())
        .replace("000000000000000000000000000000a1", channel_id)
        .replace("테스트채널", channel_name);
        Mock::given(method("GET"))
            .and(path(format!("/service/v2/videos/{video_no}")))
            .respond_with(ResponseTemplate::new(200).set_body_raw(info, "application/json"))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(format!("/thumb/{video_no}.jpg")))
            .respond_with(
                ResponseTemplate::new(200).set_body_bytes(fixture("testdata/synthetic/thumb.jpg")),
            )
            .mount(&server)
            .await;
        let media = String::from_utf8(fixture("testdata/hls/media.m3u8")).unwrap();
        let mut kept = Vec::new();
        let mut uris = 0;
        for line in media.lines() {
            if uris == 2 {
                break;
            }
            if !line.is_empty() && !line.starts_with('#') {
                uris += 1;
            }
            kept.push(line);
        }
        let media = format!("{}\n#EXT-X-ENDLIST\n", kept.join("\n"));
        let mounts: [(&str, Vec<u8>); 5] = [
            ("/vod_playlist.m3u8", fixture("testdata/hls/master.m3u8")),
            ("/vod_chunklist.m3u8", media.into_bytes()),
            ("/144p_0_0_0.m4s", fixture("testdata/hls/init.mp4")),
            ("/144p_seg0.m4v", fixture("testdata/hls/seg0.m4v")),
            ("/144p_seg1.m4v", fixture("testdata/hls/seg1.m4v")),
        ];
        for (s, body) in mounts {
            Mock::given(method("GET"))
                .and(suffix(s))
                .respond_with(ResponseTemplate::new(200).set_body_bytes(body))
                .mount(&server)
                .await;
        }
        let dir = tempfile::tempdir().unwrap();
        let out = out_path(&dir);
        let req = DownloadRequest {
            embed_metadata: true,
            content: ContentRef::Video { video_no },
            ..request(&out, 4)
        };
        run(meta_cfg(&server), req, CancellationToken::new(), &|_| {})
            .await
            .unwrap();
        let got = std::fs::read(&out).unwrap();
        mp4::assert_flat_mp4(&got);
        let items = ilst_last(&got);
        let kinds: Vec<&str> = items.iter().map(|i| i.0.as_str()).collect();
        assert_eq!(kinds, ["©nam", "©ART", "©day", "©cmt", "covr"]);
        assert_eq!(items[1].2, channel_name.as_bytes());
        assert_eq!(
            items[3].2,
            format!("https://chzzk.naver.com/video/{video_no}").as_bytes()
        );
        if std::env::var_os("UPDATE_FLAT_GOLDEN").is_some() {
            let p = format!("{}/../../{golden}", env!("CARGO_MANIFEST_DIR"));
            std::fs::write(p, &got).unwrap();
        }
        assert_eq!(
            got,
            fixture(golden),
            "다시 만들기: UPDATE_FLAT_GOLDEN=1 cargo test -p chzzk-core --test segmented fixture_tagged_goldens"
        );
        // 끈 결과(`full2_flat.mp4`)와 미디어 데이터는 같다(태그만 더해진다)
        assert_eq!(
            mp4::mdat_payloads(&got),
            mp4::mdat_payloads(&fixture("testdata/hls/full2_flat.mp4"))
        );
        outputs.push(got);
    }
    assert_ne!(
        outputs[0], outputs[1],
        "채널마다 태그가 달라 golden이 둘이다"
    );
}
