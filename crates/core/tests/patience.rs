//! 연결 대기(인내 모드) 통합 테스트(core.md 구현 중 변경 56).
//!
//! 단절은 wiremock 앞의 `GateProxy`가 만든다. 30분은 기다릴 수 없어서 예산을 1초대로 줄이고, 비례한 경계는
//! 단위 테스트(`retry::tests::patience_budget_boundaries`)가 실제 상수로 본다. 지터 때문에 경계는 넉넉히 둔다.

mod common;

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, Endpoints, Error, Phase, PlaybackKind, RetryPolicy,
};
use common::{
    Events, GateProxy, HLS_NO, RangeBody, ThenOutage, VOD_NO, VOD_VIDEO_ID, fixture, hls_info,
    mount_synth_hls, pd_mpd, phase_order, synth_expected, test_bytes,
};
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const QUALITY: &str = "PD_720P_TEST";
const MEDIA_PATH: &str = "/m1/pd/a.mp4";

/// 빠른 재시도는 짧게, 인내 예산은 `patience_ms`.
fn policy(patience_ms: u64) -> RetryPolicy {
    RetryPolicy {
        max_attempts: 5,
        base: Duration::from_millis(10),
        cap: Duration::from_millis(20),
        patience: Duration::from_millis(patience_ms),
        patience_cap: Duration::from_millis(150),
    }
}

fn cfg(api: &str, patience_ms: u64) -> ClientConfig {
    let base = Url::parse(api).unwrap();
    ClientConfig {
        endpoints: Endpoints {
            chzzk_api: base.clone(),
            vodplay_api: base,
        },
        retry: policy(patience_ms),
        progress_interval: Duration::ZERO,
        connect_timeout: Duration::from_secs(2),
        read_timeout: Duration::from_secs(2),
        ..ClientConfig::default()
    }
}

fn out_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path().join("[261004] 채널 - 제목.mp4")
}

fn pd_request(out: &Path) -> DownloadRequest {
    DownloadRequest {
        content: ContentRef::Video { video_no: VOD_NO },
        quality_id: QUALITY.into(),
        expected_kind: PlaybackKind::Progressive,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
    }
}

fn hls_request(out: &Path) -> DownloadRequest {
    DownloadRequest {
        content: ContentRef::Video { video_no: HLS_NO },
        quality_id: "144p".into(),
        expected_kind: PlaybackKind::LiveRewindHls,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: std::num::NonZeroU8::new(1).unwrap(),
    }
}

async fn mount_pd_info(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("testdata/vod/video_info.json"), "application/json"),
        )
        .mount(server)
        .await;
}

/// MPD를 mount한다. `after`가 있으면 응답을 보내면서 단절을 건다(그 뒤 첫 미디어 요청이 단절 중에 일어난다).
async fn mount_pd_mpd(
    server: &MockServer,
    media_base: &str,
    after: Option<(common::Gate, Duration)>,
) {
    let tpl = ResponseTemplate::new(200).set_body_raw(
        pd_mpd(
            QUALITY,
            720,
            &format!("{media_base}{MEDIA_PATH}?_lsu_sa_=sig"),
        ),
        "application/dash+xml",
    );
    let m = Mock::given(method("GET")).and(path(format!(
        "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
    )));
    match after {
        Some((gate, outage)) => {
            m.respond_with(ThenOutage {
                gate,
                outage,
                template: tpl,
            })
            .mount(server)
            .await
        }
        None => m.respond_with(tpl).mount(server).await,
    }
}

async fn run(
    cfg: ClientConfig,
    req: DownloadRequest,
    cancel: CancellationToken,
    events: &Events,
) -> Result<DownloadOutcome, Error> {
    let cb = events.callback();
    Chzzk::new(cfg).unwrap().download(req, cancel, &cb).await
}

fn completed_bytes(r: Result<DownloadOutcome, Error>, out: &Path) -> Vec<u8> {
    match r {
        Ok(DownloadOutcome::Completed { path, .. }) => {
            assert_eq!(path, out);
            std::fs::read(out).unwrap()
        }
        other => panic!("{other:?}"),
    }
}

/// 예산 안의 단절: 조용히 다섯 번, 이어서 `WaitingNetwork`, 연결이 돌아오면 `Downloading`으로 완료한다.
#[tokio::test]
async fn progressive_outage_within_patience_completes() {
    let body = test_bytes(50_000, 3);
    let server = MockServer::start().await;
    let proxy = GateProxy::start(*server.address());
    mount_pd_info(&server).await;
    mount_pd_mpd(
        &server,
        &proxy.url(),
        Some((proxy.gate(), Duration::from_millis(900))),
    )
    .await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let r = run(
        cfg(&proxy.url(), 1500),
        pd_request(&out),
        CancellationToken::new(),
        &events,
    )
    .await;
    assert_eq!(completed_bytes(r, &out), body);
    assert_eq!(
        phase_order(&events),
        [
            Phase::Resolving,
            Phase::Downloading,
            Phase::WaitingNetwork,
            Phase::Downloading,
            Phase::Finalizing
        ]
    );
    // 단절 중 빠른 5회 + 인내 재시도가 있었다.
    assert!(proxy.refused() >= 6, "{}", proxy.refused());
}

/// 예산을 넘긴 단절: 마지막 연결 오류로 끝나고, 끝난 뒤에야 돌아올 연결을 기다리지 않는다.
#[tokio::test]
async fn progressive_outage_beyond_patience_fails() {
    let server = MockServer::start().await;
    let proxy = GateProxy::start(*server.address());
    mount_pd_info(&server).await;
    mount_pd_mpd(
        &server,
        &proxy.url(),
        Some((proxy.gate(), Duration::from_secs(10))),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let t0 = Instant::now();
    let r = run(
        cfg(&proxy.url(), 1000),
        pd_request(&out),
        CancellationToken::new(),
        &events,
    )
    .await;
    let took = t0.elapsed();
    let e = r.unwrap_err();
    assert!(matches!(e, Error::Network(_)), "{e:?}");
    assert!(e.is_resumable());
    assert!(took >= Duration::from_millis(900), "{took:?}");
    assert!(took < Duration::from_secs(5), "{took:?}");
    assert!(phase_order(&events).contains(&Phase::WaitingNetwork));
}

/// 5xx는 인내 대상이 아니다: 현행대로 다섯 번에 끝난다.
#[tokio::test]
async fn progressive_5xx_stops_after_five() {
    let server = MockServer::start().await;
    mount_pd_info(&server).await;
    mount_pd_mpd(&server, &server.uri(), None).await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let t0 = Instant::now();
    let r = run(
        cfg(&server.uri(), 5000),
        pd_request(&out),
        CancellationToken::new(),
        &events,
    )
    .await;
    assert!(
        matches!(r, Err(Error::HttpStatus { status: 503, .. })),
        "{r:?}"
    );
    assert!(t0.elapsed() < Duration::from_secs(2));
    let n = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path() == MEDIA_PATH)
        .count();
    assert_eq!(n, 5);
    assert!(!phase_order(&events).contains(&Phase::WaitingNetwork));
}

/// 진전이 인내 시계를 되돌린다: 단절마다는 예산 안이지만 합은 예산을 넘는 회선에서도 끝까지 받는다.
#[tokio::test]
async fn progressive_progress_resets_patience() {
    let body = test_bytes(1000, 9);
    let server = MockServer::start().await;
    let api = GateProxy::start(*server.address());
    // 미디어 연결은 400바이트(헤더 포함)만 흘리고 끊고, 600ms 단절한다.
    let media = GateProxy::start_with(*server.address(), Some(400), Duration::from_millis(600));
    mount_pd_info(&server).await;
    mount_pd_mpd(
        &server,
        &media.url(),
        Some((media.gate(), Duration::from_millis(600))),
    )
    .await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody(body.clone()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let t0 = Instant::now();
    let r = run(
        cfg(&api.url(), 1000),
        pd_request(&out),
        CancellationToken::new(),
        &events,
    )
    .await;
    let took = t0.elapsed();
    assert_eq!(completed_bytes(r, &out), body);
    // 단절이 합쳐서 예산(1초)을 넘었다.
    assert!(took > Duration::from_millis(1500), "{took:?}");
    let waits = phase_order(&events)
        .iter()
        .filter(|p| **p == Phase::WaitingNetwork)
        .count();
    assert!(waits >= 3, "{waits}");
}

/// 대기 중 취소는 즉시 `Cancelled`다.
#[tokio::test]
async fn cancel_while_waiting_is_immediate() {
    let server = MockServer::start().await;
    let proxy = GateProxy::start(*server.address());
    mount_pd_info(&server).await;
    mount_pd_mpd(
        &server,
        &proxy.url(),
        Some((proxy.gate(), Duration::from_secs(60))),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cancel = CancellationToken::new();
    let canceller = async {
        // 연결 대기가 알려질 때까지 기다린 뒤 취소한다.
        let t0 = Instant::now();
        while !events
            .all()
            .iter()
            .any(|p| p.phase == Phase::WaitingNetwork)
        {
            assert!(t0.elapsed() < Duration::from_secs(10), "대기 phase가 없다");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let at = Instant::now();
        cancel.cancel();
        at
    };
    // 30분 예산: 취소가 아니면 끝나지 않는다.
    let (r, at) = tokio::join!(
        run(
            cfg(&proxy.url(), 1_800_000),
            pd_request(&out),
            cancel.clone(),
            &events
        ),
        canceller
    );
    assert!(matches!(r, Err(Error::Cancelled)), "{r:?}");
    assert!(
        at.elapsed() < Duration::from_millis(500),
        "{:?}",
        at.elapsed()
    );
}

/// HLS 세그먼트 사이의 단절: 스트림을 버리고 기다렸다가 `next`부터 이어 받는다.
#[tokio::test]
async fn segmented_outage_recovers() {
    const N: usize = 4;
    let server = MockServer::start().await;
    let proxy = GateProxy::start(*server.address());
    Mock::given(method("GET"))
        .and(path("/service/v2/videos/9000001"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            hls_info(&format!("{}/g0/master.m3u8?hdnts=st=1~hmac=x", proxy.url())),
            "application/json",
        ))
        .mount(&server)
        .await;
    // seg1을 주면서 단절을 건다.
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg1.m4v"))
        .respond_with(ThenOutage {
            gate: proxy.gate(),
            outage: Duration::from_millis(900),
            template: ResponseTemplate::new(200).set_body_bytes(common::synth_segment(1)),
        })
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let r = run(
        cfg(&proxy.url(), 1500),
        hls_request(&out),
        CancellationToken::new(),
        &events,
    )
    .await;
    assert_eq!(completed_bytes(r, &out), synth_expected(N));
    assert_eq!(
        phase_order(&events),
        [
            Phase::Resolving,
            Phase::Downloading,
            Phase::WaitingNetwork,
            Phase::Downloading,
            Phase::Finalizing
        ]
    );
}

/// 403으로 재조회하는 순간의 단절도 같은 인내로 기다린다(작업 안의 `Job::resolve`).
#[tokio::test]
async fn segmented_reresolve_during_outage_recovers() {
    const N: usize = 3;
    let server = MockServer::start().await;
    let proxy = GateProxy::start(*server.address());
    Mock::given(method("GET"))
        .and(path("/service/v2/videos/9000001"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            hls_info(&format!("{}/g0/master.m3u8?hdnts=st=1~hmac=x", proxy.url())),
            "application/json",
        ))
        .mount(&server)
        .await;
    // seg1이 한 번 403이고, 그 직후 재조회 요청이 단절 중에 일어난다.
    Mock::given(method("GET"))
        .and(path("/g0/144p/seg1.m4v"))
        .respond_with(ThenOutage {
            gate: proxy.gate(),
            outage: Duration::from_millis(900),
            template: ResponseTemplate::new(403),
        })
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&server)
        .await;
    mount_synth_hls(&server, "/g0", N).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let r = run(
        cfg(&proxy.url(), 1500),
        hls_request(&out),
        CancellationToken::new(),
        &events,
    )
    .await;
    assert_eq!(completed_bytes(r, &out), synth_expected(N));
    let order = phase_order(&events);
    let i = order
        .iter()
        .position(|p| *p == Phase::Reresolving)
        .expect("재조회");
    assert_eq!(order[i + 1], Phase::WaitingNetwork, "{order:?}");
    assert_eq!(order[i + 2], Phase::Downloading, "{order:?}");
}
