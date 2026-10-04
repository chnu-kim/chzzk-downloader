//! 빠른 다시보기 HLS(fMP4) 다운로드 통합 테스트(설계 §5.4, §8.2 segmented). 네트워크는 wiremock뿐이다.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, Error, Phase, PlaybackKind, Progress,
};
use common::{
    Events, HLS_NO, config, fixture, hls_info, mount_synth_hls, part_files, rewrite_hosts, suffix,
    synth_expected, synth_media, synth_segment,
};
use std::num::NonZeroU8;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const INFO_PATH: &str = "/service/v2/videos/9000001";

fn request(out: &Path, concurrency: u8) -> DownloadRequest {
    DownloadRequest {
        content: ContentRef::Video { video_no: HLS_NO },
        quality_id: "144p".into(),
        expected_kind: PlaybackKind::LiveRewindHls,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: NonZeroU8::new(concurrency).unwrap(),
    }
}

fn out_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("[261005] 테스트채널 - 123.mp4")
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

/// 실물 fixture(init·seg0·seg1)로 이어 붙인 결과가 init‖seg0‖seg1이고 상자 순서가 맞다.
#[tokio::test]
async fn fixture_concat_box_order() {
    let server = MockServer::start().await;
    let info = rewrite_hosts(&fixture("testdata/hls/video_info.json"), &server.uri());
    Mock::given(method("GET"))
        .and(path(INFO_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_raw(info, "application/json"))
        .mount(&server)
        .await;
    // 실물 media playlist에서 앞 두 세그먼트만 남긴다.
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
        (
            "/144p_1000_1700000000000_0_0_0.m4v",
            fixture("testdata/hls/seg0.m4v"),
        ),
        (
            "/144p_1000_1700000000000_2_0_1.m4v",
            fixture("testdata/hls/seg1.m4v"),
        ),
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
    let mut want = fixture("testdata/hls/init.mp4");
    want.extend(fixture("testdata/hls/seg0.m4v"));
    want.extend(fixture("testdata/hls/seg1.m4v"));
    assert_eq!(
        r,
        DownloadOutcome::Completed {
            path: out.clone(),
            bytes: want.len() as u64,
            resumed_from: 0
        }
    );
    let got = std::fs::read(&out).unwrap();
    assert_eq!(got, want);
    let types = box_types(&got);
    assert_eq!(&types[..4], ["ftyp", "moov", "styp", "moof"]);
    assert!(types.contains(&"mdat".to_string()));
    assert!(types.contains(&"emsg".to_string()));
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

/// 없는 화질은 `QualityNotFound`(세그먼트 요청 없음).
#[tokio::test]
async fn quality_not_found() {
    let server = MockServer::start().await;
    mount_info(&server, "/g0", None).await;
    mount_synth_hls(&server, "/g0", 3).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let req = DownloadRequest {
        quality_id: "1080p".into(),
        ..request(&out, 1)
    };
    let r = run(config(&server), req, CancellationToken::new(), &|_| {}).await;
    assert!(matches!(r, Err(Error::QualityNotFound { .. })), "{r:?}");
    assert!(requests(&server, "/g0/144p/seg0.m4v").await.is_empty());
    let (part, _) = part_files(&out);
    assert!(!part.exists());
}
