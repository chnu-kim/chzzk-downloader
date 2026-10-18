//! 속도 제한 엔진 통합 테스트(rate-limit.md §10.3). 네트워크는 wiremock뿐이고 시계는 실제다.
//!
//! 코어 `Throttle`은 최소값을 강제하지 않으므로(최소는 설정 정책) 작은 값(수백 KB/s)으로 1~2초 안에 끝낸다.
//! 시간은 아래 한계만 단정한다(위쪽은 느린 CI에서 흔들린다). paused 시계는 소켓과 섞지 않는다.

mod common;

use std::num::{NonZeroU8, NonZeroU64};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chzzk_core::download::{RateKnob, Throttle, Throttles};
use chzzk_core::{
    CancellationToken, Chzzk, ContentRef, DownloadOutcome, DownloadRequest, DuplicatePolicy, Error,
    PlaybackKind,
};
use common::{
    HLS_NO, RangeBody, VOD_NO, VOD_VIDEO_ID, config, fixture, hls_info, part_files, pd_mpd,
    synth_init, test_bytes,
};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const KB: u64 = 1_000;

fn throttle(bps: u64) -> Throttle {
    Throttle::new(RateKnob::new(NonZeroU64::new(bps)))
}

// ---- progressive ----

const PD_QUALITY: &str = "PD_720P_TEST";
const PD_MEDIA: &str = "/m1/pd/a.mp4";

fn pd_request(out: &Path, throttles: Throttles) -> DownloadRequest {
    DownloadRequest {
        throttle: throttles,
        content: ContentRef::Video { video_no: VOD_NO },
        quality_id: PD_QUALITY.into(),
        expected_kind: PlaybackKind::Progressive,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: None,
        recording_id: None,
        range: None,
    }
}

async fn pd_setup(server: &MockServer, body: Vec<u8>) {
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
            pd_mpd(
                PD_QUALITY,
                720,
                &format!("{}{PD_MEDIA}?_lsu_sa_=sig", server.uri()),
            ),
            "application/dash+xml",
        ))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(PD_MEDIA))
        .respond_with(RangeBody(body))
        .mount(server)
        .await;
}

fn out_in(dir: &tempfile::TempDir, name: &str) -> PathBuf {
    dir.path().join(name)
}

#[tokio::test]
async fn progressive_job_limit_slows_the_body() {
    let server = MockServer::start().await;
    let body = test_bytes(300_000, 1);
    pd_setup(&server, body.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_in(&dir, "a.mp4");
    // 200KB/s: burst 50KB는 공짜, 나머지 250KB는 1.25초
    let th = Throttles {
        job: Some(throttle(200 * KB)),
        shared: None,
    };
    let started = Instant::now();
    let r = Chzzk::new(config(&server))
        .unwrap()
        .download(pd_request(&out, th), CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    let took = started.elapsed();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert!(took >= Duration::from_millis(1000), "{took:?}");
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

#[tokio::test]
async fn two_downloads_share_one_total_limit() {
    let server = MockServer::start().await;
    let body = test_bytes(200_000, 2);
    pd_setup(&server, body.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let shared = throttle(200 * KB);
    let chzzk = Arc::new(Chzzk::new(config(&server)).unwrap());
    let start = Instant::now();
    let mut handles = Vec::new();
    for name in ["a.mp4", "b.mp4"] {
        let out = out_in(&dir, name);
        let th = Throttles {
            job: None,
            shared: Some(shared.clone()),
        };
        let c = chzzk.clone();
        handles.push(tokio::spawn(async move {
            c.download(pd_request(&out, th), CancellationToken::new(), &|_| {})
                .await
        }));
    }
    for h in handles {
        h.await.unwrap().unwrap();
    }
    // 합쳐서 400KB, burst 50KB → 1.75초. 각자 따로 200KB/s였다면 0.75초다.
    let took = start.elapsed();
    assert!(took >= Duration::from_millis(1500), "{took:?}");
    for name in ["a.mp4", "b.mp4"] {
        assert_eq!(std::fs::read(out_in(&dir, name)).unwrap(), body);
    }
}

#[tokio::test]
async fn cancel_while_throttled_is_prompt_and_resumes() {
    let server = MockServer::start().await;
    let body = test_bytes(300_000, 3);
    pd_setup(&server, body.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_in(&dir, "a.mp4");
    // 아주 낮은 상한(40KB/s): 끝까지 받으려면 6초 넘게 걸린다.
    let th = Throttles {
        job: Some(throttle(40 * KB)),
        shared: None,
    };
    let cancel = CancellationToken::new();
    let chzzk = Chzzk::new(config(&server)).unwrap();
    let c2 = cancel.clone();
    let canceller = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let at = Instant::now();
        c2.cancel();
        at
    });
    let r = chzzk.download(pd_request(&out, th), cancel, &|_| {}).await;
    let cancelled_at = canceller.await.unwrap();
    assert!(matches!(r, Err(Error::Cancelled)), "{r:?}");
    assert!(
        cancelled_at.elapsed() < Duration::from_millis(500),
        "취소가 대기에 막혔다: {:?}",
        cancelled_at.elapsed()
    );
    let (part, _) = part_files(&out);
    assert!(part.exists(), ".part가 남아야 한다");
    assert!(!out.exists());

    // 제한 없이 이어받으면 바이트가 같다.
    let r = chzzk
        .download(
            pd_request(&out, Throttles::default()),
            CancellationToken::new(),
            &|_| {},
        )
        .await
        .unwrap();
    assert!(
        matches!(r, DownloadOutcome::Completed { resumed_from, .. } if resumed_from > 0),
        "{r:?}"
    );
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

#[tokio::test]
async fn turning_the_limit_off_mid_download_speeds_it_up() {
    // 받는 중에 끄면 다음 조각부터 곧바로 풀린다(R5).
    let server = MockServer::start().await;
    let body = test_bytes(300_000, 4);
    pd_setup(&server, body.clone()).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_in(&dir, "a.mp4");
    let knob = RateKnob::new(NonZeroU64::new(40 * KB));
    let th = Throttles {
        job: Some(Throttle::new(knob.clone())),
        shared: None,
    };
    let k2 = knob.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        k2.set(None);
    });
    let started = Instant::now();
    Chzzk::new(config(&server))
        .unwrap()
        .download(pd_request(&out, th), CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    // 40KB/s로는 6초가 넘게 걸린다.
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(std::fs::read(&out).unwrap(), body);
}

// ---- segmented ----

const SEG_BYTES: usize = 50_000;

fn big_segment(i: usize) -> Vec<u8> {
    let mut v = vec![0, 0, 0, 8];
    v.extend_from_slice(b"styp");
    v.extend(test_bytes(SEG_BYTES, i as u8));
    v
}

/// 요청이 닿은 시각을 적어 두는 응답기.
struct Stamped {
    body: Vec<u8>,
    at: Arc<Mutex<Option<Instant>>>,
}

impl Respond for Stamped {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        self.at.lock().unwrap().get_or_insert_with(Instant::now);
        ResponseTemplate::new(200).set_body_bytes(self.body.clone())
    }
}

fn hls_request(out: &Path, concurrency: u8, throttles: Throttles) -> DownloadRequest {
    DownloadRequest {
        throttle: throttles,
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

#[tokio::test]
async fn segmented_throttles_the_body_read_not_the_write_loop() {
    const N: usize = 6;
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/service/v2/videos/9000001"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            hls_info(&format!(
                "{}/g0/master.m3u8?hdnts=st=1~hmac=x",
                server.uri()
            )),
            "application/json",
        ))
        .mount(&server)
        .await;
    common::mount_synth_hls(&server, "/g0", N).await;
    // 세그먼트를 50KB로 키운다(합성 기본은 1KB). 우선순위 1이 먼저 쓰인다.
    let stamps: Vec<Arc<Mutex<Option<Instant>>>> = (0..N).map(|_| Arc::default()).collect();
    for (i, at) in stamps.iter().enumerate() {
        Mock::given(method("GET"))
            .and(path(format!("/g0/144p/seg{i}.m4v")))
            .respond_with(Stamped {
                body: big_segment(i),
                at: at.clone(),
            })
            .with_priority(1)
            .mount(&server)
            .await;
    }
    let dir = tempfile::tempdir().unwrap();
    let out = out_in(&dir, "[260102] 테스트채널 - 테스트 다시보기.mp4");
    // 200KB/s: burst 50KB는 공짜, 300KB 중 250KB는 1.25초
    let th = Throttles {
        job: Some(throttle(200 * KB)),
        shared: None,
    };
    let started = Instant::now();
    Chzzk::new(config(&server))
        .unwrap()
        .download(hls_request(&out, 4, th), CancellationToken::new(), &|_| {})
        .await
        .unwrap();
    let took = started.elapsed();
    assert!(took >= Duration::from_millis(1000), "{took:?}");
    let mut expected = synth_init();
    for i in 0..N {
        expected.extend(big_segment(i));
    }
    assert_eq!(std::fs::read(&out).unwrap(), expected);
    // 늦춰지는 곳이 본문 읽기라는 증거: 동시 4개가 모두 읽기를 시작해 제한에 막혀 있으면 6번째 요청은
    // 앞 세그먼트가 읽힌 뒤에야 나간다. 쓰기 루프에서 늦췄다면 본문은 곧바로 다 읽혀 요청이 한꺼번에 나간다.
    let sixth = stamps[5].lock().unwrap().expect("6번째 요청");
    assert!(
        sixth.duration_since(started) >= Duration::from_millis(150),
        "6번째 요청이 너무 일찍 나갔다: {:?}",
        sixth.duration_since(started)
    );
}
