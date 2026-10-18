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
use wiremock::{Mock, MockServer, ResponseTemplate};

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

const SEG_BYTES: usize = 4_000_000;
const SEG_N: usize = 3;

fn big_segment(i: usize) -> Vec<u8> {
    let mut v = vec![0, 0, 0, 8];
    v.extend_from_slice(b"styp");
    v.extend(test_bytes(SEG_BYTES, i as u8));
    v
}

/// 서버가 적은 시각. `first`는 첫 세그먼트 요청이 닿은 시각이고 `done[i]`는 i번째 본문을 다 보낸 시각이다.
#[derive(Default)]
struct Stamps {
    first: Mutex<Option<Instant>>,
    done: Mutex<Vec<Option<Instant>>>,
}

/// 세그먼트 본문을 조용히 보내고 **서버가 본문을 다 보낸 시각**을 적는 원시 TCP 서버.
///
/// 보내는 버퍼를 작게 줘서(`SO_SNDBUF`) 클라이언트가 읽어 주지 않으면 `write_all`이 끝나지 않는다.
/// 그래서 서버가 다 보낸 시각은 클라이언트가 본문을 얼마나 빨리 읽었는지를 비춘다.
/// 읽기를 제한하면 본문 전송이 시간에 걸쳐 퍼지고, 읽기는 곧바로 하고 쓰기 루프에서 늦추면 곧바로 끝난다.
async fn serve_segments(stamps: Arc<Stamps>) -> std::net::SocketAddr {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let socket = tokio::net::TcpSocket::new_v4().unwrap();
    socket.set_send_buffer_size(16 * 1024).unwrap();
    socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
    let listener = socket.listen(16).unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut conn, _)) = listener.accept().await else {
                return;
            };
            let stamps = stamps.clone();
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut buf = [0u8; 1024];
                while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                    match conn.read(&mut buf).await {
                        Ok(0) | Err(_) => return,
                        Ok(n) => head.extend_from_slice(&buf[..n]),
                    }
                }
                stamps
                    .first
                    .lock()
                    .unwrap()
                    .get_or_insert_with(Instant::now);
                let text = String::from_utf8_lossy(&head);
                let i: usize = text
                    .split_whitespace()
                    .nth(1)
                    .and_then(|p| p.strip_prefix("/seg"))
                    .and_then(|p| p.strip_suffix(".m4v"))
                    .and_then(|p| p.parse().ok())
                    .expect("세그먼트 경로");
                let body = big_segment(i);
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                if conn.write_all(header.as_bytes()).await.is_err()
                    || conn.write_all(&body).await.is_err()
                {
                    return;
                }
                stamps.done.lock().unwrap()[i] = Some(Instant::now());
                let _ = conn.shutdown().await;
            });
        }
    });
    addr
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

/// 제한이 쓰기 루프가 아니라 본문 읽기에 걸린다는 증거(rate-limit.md §3.2).
///
/// 동시 수를 세그먼트 수와 같게 두어 요청이 모두 곧바로 나가게 한다(`buffered`가 요청 시각을 늦추지 않는다).
/// 읽기에서 늦추면 세 본문이 한 bucket을 나눠 읽으므로 **가장 먼저 끝나는** 서버 전송도 한참 뒤에야 끝난다.
/// 읽기는 곧바로 하고 쓰기 루프에서 늦추면 첫 세그먼트는 제한 없이 읽혀 서버 전송이 곧바로 끝난다.
/// (`buffered`는 폴링하지 않는 동안 읽지 않으므로 *마지막* 전송 시각은 두 경우 모두 늦다. 그래서 가장 이른 시각을 본다.
/// 깨서 확인: `fetch`에 `None`을 넘기고 `segs.next()` 뒤에서 `consume`하면 이 테스트가 실패한다.)
#[tokio::test]
async fn segmented_throttles_the_body_read_not_the_write_loop() {
    let server = MockServer::start().await;
    let stamps = Arc::new(Stamps {
        done: Mutex::new(vec![None; SEG_N]),
        ..Stamps::default()
    });
    let seg_addr = serve_segments(stamps.clone()).await;
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
    Mock::given(method("GET"))
        .and(path("/g0/master.m3u8"))
        .respond_with(ResponseTemplate::new(200).set_body_string(common::SYNTH_MASTER))
        .mount(&server)
        .await;
    // 세그먼트는 다른 출처(원시 서버)에 있다. 재생 목록에는 절대 주소로 적는다.
    let mut media = format!(
        "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n\
         #EXT-X-MAP:URI=\"{}/g0/144p/init.m4s?type=hls\"\n",
        server.uri()
    );
    for i in 0..SEG_N {
        media.push_str(&format!("#EXTINF:2.000,\nhttp://{seg_addr}/seg{i}.m4v\n"));
    }
    media.push_str("#EXT-X-ENDLIST\n");
    Mock::given(method("GET"))
        .and(path("/g0/144p/media.m3u8"))
        .respond_with(ResponseTemplate::new(200).set_body_string(media))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/g0/144p/init.m4s"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(synth_init()))
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_in(&dir, "[260102] 테스트채널 - 테스트 다시보기.mp4");
    // 6MB/s: burst 1.5MB는 공짜, 12MB 중 10.5MB는 1.75초
    let th = Throttles {
        job: Some(throttle(6 * 1_000 * KB)),
        shared: None,
    };
    let started = Instant::now();
    Chzzk::new(config(&server))
        .unwrap()
        .download(
            hls_request(&out, SEG_N as u8, th),
            CancellationToken::new(),
            &|_| {},
        )
        .await
        .unwrap();
    let took = started.elapsed();
    assert!(took >= Duration::from_millis(1400), "{took:?}");
    let mut expected = synth_init();
    for i in 0..SEG_N {
        expected.extend(big_segment(i));
    }
    assert_eq!(std::fs::read(&out).unwrap(), expected);
    // Windows는 제외한다: 루프백에서 받는 쪽 수신 버퍼가 자동 조정으로 4MB 본문 하나쯤은 삼켜서(CI 실측 56ms)
    // 서버의 `write_all` 완료 시각이 클라이언트의 읽기 속도를 비추지 못한다. 제한은 OS와 무관한 본문 읽기 경로에
    // 있으므로 아래 단정은 Linux·macOS가 맡고, 위의 총 소요 하한(1.4초)은 모든 OS가 본다.
    if cfg!(windows) {
        return;
    }
    // 가장 먼저 끝난 서버 전송도 첫 요청이 닿고 한참 뒤에 끝난다(세 본문이 제한을 나눠 읽었다는 뜻).
    // 커널 버퍼가 일부를 흡수하므로 실측은 1.2~1.7초(쓰기 루프 변형은 0.2~0.5초)라 그 사이의 하한을 단정한다.
    let t0 = stamps.first.lock().unwrap().expect("요청이 닿았다");
    let first = stamps
        .done
        .lock()
        .unwrap()
        .iter()
        .map(|t| t.expect("서버가 본문을 다 보냈다"))
        .min()
        .unwrap();
    assert!(
        first.duration_since(t0) >= Duration::from_millis(800),
        "서버 전송이 너무 일찍 끝났다(읽기가 제한되지 않았다): {:?}",
        first.duration_since(t0)
    );
}
