//! 생방송 녹화 통합 테스트(core.md 구현 중 변경 "생방송"). 네트워크는 wiremock뿐이다.
//!
//! 가짜 방송 서버는 playlist를 읽을 때마다 창을 밀고(`Pl`), `live-detail`은 호출 횟수에 따라 방송 중·종료·다른
//! 방송을 낸다(`Detail`). 세그먼트 본문은 msn이 들어 있어 이어 붙인 순서를 검사할 수 있다.

mod common;
#[path = "support/mp4.rs"]
mod mp4;

use std::num::NonZeroU8;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, Error, PlaybackKind, Progress,
};
use common::{Events, GateProxy, config, fixture, part_files, rewrite_hosts};
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const CHANNEL: &str = "000000000000000000000000000000e5";
const DETAIL_PATH: &str = "/service/v3/channels/000000000000000000000000000000e5/live-detail";
const DIR: &str = "/live/kr/streamkey0";
const FIXTURE_LIVE_ID: &str = "\"liveId\": 9000003";

/// media playlist 응답.
#[derive(Clone)]
enum Pl {
    /// `first`부터 `len`개. `ended`면 ENDLIST, `tail`은 마지막에 덧붙이는 줄
    Window {
        first: u64,
        len: u64,
        ended: bool,
        tail: &'static str,
    },
    Status(u16),
    /// 빈 창을 아주 늦게(30초) 답한다(읽는 도중 멈춤이 먹는지 본다)
    Hang,
}

/// `live-detail` 응답.
#[derive(Clone)]
enum Detail {
    Open(u64),
    Closed,
    /// 이 상태 코드로 답한다(서버 오류)
    Status(u16),
    /// 영상 화질이 하나도 없다(오디오 트랙뿐)
    AudioOnly,
    /// `Open(1)`과 같은 본문을 이만큼 늦게 답한다(조회하는 도중 멈춤이 먹는지 본다)
    Slow(Duration),
}

struct Stream {
    server: MockServer,
    polls: Arc<AtomicUsize>,
    details: Arc<AtomicUsize>,
    /// `Opts::via_proxy`일 때 미디어 요청이 지나는 단절 프록시
    proxy: Option<GateProxy>,
}

/// 방송 중 `live-detail` 본문(방송 번호만 바꾼다).
fn open_body(base: &str, id: u64) -> Vec<u8> {
    let b = rewrite_hosts(&fixture("testdata/live/live_detail.json"), base);
    String::from_utf8(b)
        .unwrap()
        .replace(FIXTURE_LIVE_ID, &format!("\"liveId\": {id}"))
        .into_bytes()
}

/// `n`이 `at` 이상이 되면 `stop`을 취소한다(요청이 서버에 닿았다는 뜻: wiremock은 도착할 때 센다).
fn stop_when(n: Arc<AtomicUsize>, at: usize, stop: CancellationToken) {
    tokio::spawn(async move {
        while n.load(Ordering::SeqCst) < at {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        stop.cancel();
    });
}

/// 멈춤이 3초 안에 먹어야 한다.
async fn record_bounded(
    s: &Stream,
    out: &Path,
    stop: CancellationToken,
) -> Result<DownloadOutcome, Error> {
    match tokio::time::timeout(Duration::from_secs(3), record(s, out, Some(stop))).await {
        Ok(r) => r,
        Err(_) => panic!("멈춤이 먹지 않았다"),
    }
}

fn init_bytes() -> Vec<u8> {
    let mut v = vec![0, 0, 0, 16];
    v.extend_from_slice(b"ftyp");
    v.extend_from_slice(b"initinit");
    v
}

fn seg_bytes(msn: u64) -> Vec<u8> {
    let mut v = vec![0, 0, 0, 16];
    v.extend_from_slice(b"styp");
    v.extend_from_slice(&msn.to_be_bytes());
    v
}

/// 가짜 서버의 세그먼트 응답 옵션.
#[derive(Default, Clone, Copy)]
struct Opts {
    /// 이 msn의 세그먼트는 늘 503이다
    bad_seg: Option<u64>,
    /// 모든 세그먼트 응답을 이만큼 늦춘다
    seg_delay: Option<Duration>,
    /// init·세그먼트를 가짜 바이트 대신 합성 fMP4(`REAL`)의 조각으로 준다
    real_media: bool,
    /// 이 msn의 세그먼트는 늘 404다(창에서 밀려난 조각)
    gone_seg: Option<u64>,
    /// 이 msn의 세그먼트는 처음 한 번만 403이다(서명 만료)
    expire_seg: Option<u64>,
    /// 이 msn부터는 모든 세그먼트가 503이다
    bad_from: Option<u64>,
    /// master playlist가 이 상태 코드로 답한다
    master_status: Option<u16>,
    /// 미디어(master·playlist·세그먼트) 주소를 단절 프록시로 낸다. 연결 대기(인내) 예산도 켠다
    via_proxy: bool,
}

/// `testdata/live/synthetic_frag.mp4`(ffmpeg lavfi 합성)를 init(`ftyp`+`moov`)과 `moof`+`mdat` 세그먼트로 나눈 것.
/// 끝의 `mfra`는 생방송 세그먼트에 없으므로 뺀다.
static REAL: LazyLock<(Vec<u8>, Vec<Vec<u8>>)> = LazyLock::new(|| {
    let b = fixture("testdata/live/synthetic_frag.mp4");
    let w = mp4::walk_boxes(&b).unwrap();
    let mut off = 0usize;
    let mut init = Vec::new();
    let mut segs: Vec<Vec<u8>> = Vec::new();
    for (ty, size) in &w.boxes {
        let bx = &b[off..off + *size as usize];
        match ty.as_str() {
            "ftyp" | "moov" => init.extend_from_slice(bx),
            "moof" => segs.push(bx.to_vec()),
            "mdat" => segs.last_mut().unwrap().extend_from_slice(bx),
            _ => {}
        }
        off += *size as usize;
    }
    (init, segs)
});

impl Stream {
    async fn start(
        pl: impl Fn(usize) -> Pl + Send + Sync + 'static,
        detail: impl Fn(usize) -> Detail + Send + Sync + 'static,
    ) -> Stream {
        Self::start_with(Opts::default(), pl, detail).await
    }

    /// `pl(n)`은 n번째(0부터) playlist 요청에, `detail(n)`은 n번째 `live-detail` 요청에 답한다.
    async fn start_with(
        opts: Opts,
        pl: impl Fn(usize) -> Pl + Send + Sync + 'static,
        detail: impl Fn(usize) -> Detail + Send + Sync + 'static,
    ) -> Stream {
        let server = MockServer::start().await;
        let polls = Arc::new(AtomicUsize::new(0));
        let details = Arc::new(AtomicUsize::new(0));
        let proxy = opts.via_proxy.then(|| GateProxy::start(*server.address()));
        // `live-detail`은 서버에 직접, 그 안의 미디어 주소는 프록시로 낸다
        let uri = proxy.as_ref().map_or_else(|| server.uri(), GateProxy::url);
        let expired_once = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let (d, u) = (details.clone(), uri.clone());
        Mock::given(method("GET"))
            .and(path(DETAIL_PATH))
            .respond_with(move |_: &Request| {
                let n = d.fetch_add(1, Ordering::SeqCst);
                let body = match detail(n) {
                    Detail::Status(code) => return ResponseTemplate::new(code),
                    Detail::AudioOnly => {
                        let b = rewrite_hosts(&fixture("testdata/live/live_detail.json"), &u);
                        let mut v: serde_json::Value = serde_json::from_slice(&b).unwrap();
                        let mut j: serde_json::Value = serde_json::from_str(
                            v["content"]["livePlaybackJson"].as_str().unwrap(),
                        )
                        .unwrap();
                        for m in j["media"].as_array_mut().unwrap() {
                            m["encodingTrack"]
                                .as_array_mut()
                                .unwrap()
                                .retain(|t| t["encodingTrackId"] == "audioOnly");
                        }
                        v["content"]["livePlaybackJson"] = serde_json::Value::String(j.to_string());
                        serde_json::to_vec(&v).unwrap()
                    }
                    Detail::Open(id) => open_body(&u, id),
                    Detail::Slow(delay) => {
                        return ResponseTemplate::new(200)
                            .set_body_raw(open_body(&u, 1), "application/json")
                            .set_delay(delay);
                    }
                    Detail::Closed => fixture("testdata/live/live_detail_closed.json"),
                };
                ResponseTemplate::new(200).set_body_raw(body, "application/json")
            })
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path(format!("{DIR}/hls_playlist.m3u8")))
            .respond_with(match opts.master_status {
                Some(code) => ResponseTemplate::new(code),
                None => ResponseTemplate::new(200).set_body_string(
                    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=256x144\n144p/chunklist.m3u8\n",
                ),
            })
            .mount(&server)
            .await;

        let p = polls.clone();
        Mock::given(method("GET"))
            .and(path(format!("{DIR}/144p/chunklist.m3u8")))
            .respond_with(move |_: &Request| {
                let n = p.fetch_add(1, Ordering::SeqCst);
                let via = opts.via_proxy;
                let close = move |t: ResponseTemplate| {
                    if via {
                        t.insert_header("connection", "close")
                    } else {
                        t
                    }
                };
                match pl(n) {
                    Pl::Status(s) => close(ResponseTemplate::new(s)),
                    Pl::Hang => close(
                        ResponseTemplate::new(200)
                            .set_body_string(
                                "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI=\"init.mp4?t=1\"\n",
                            )
                            .set_delay(Duration::from_secs(30)),
                    ),
                    Pl::Window {
                        first,
                        len,
                        ended,
                        tail,
                    } => {
                        let mut t = format!(
                            "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:{first}\n#EXT-X-MAP:URI=\"init.mp4?t=1\"\n"
                        );
                        for m in first..first + len {
                            t.push_str(&format!("#EXTINF:2.000,\nseg{m}.m4v?t=1\n"));
                        }
                        t.push_str(tail);
                        if ended {
                            t.push_str("#EXT-X-ENDLIST\n");
                        }
                        close(ResponseTemplate::new(200).set_body_string(t))
                    }
                }
            })
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path(format!("{DIR}/144p/init.mp4")))
            .respond_with(
                ResponseTemplate::new(200).set_body_bytes(if opts.real_media {
                    REAL.0.clone()
                } else {
                    init_bytes()
                }),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/live/kr/streamkey0/144p/seg\d+\.m4v$"))
            .respond_with(move |r: &Request| {
                let name = r.url.path().rsplit('/').next().unwrap().to_string();
                let msn: u64 = name[3..name.len() - 4].parse().unwrap();
                let t = if opts.bad_seg == Some(msn) || opts.bad_from.is_some_and(|f| msn >= f) {
                    ResponseTemplate::new(503)
                } else if opts.gone_seg == Some(msn) {
                    ResponseTemplate::new(404)
                } else if opts.expire_seg == Some(msn) && !expired_once.swap(true, Ordering::SeqCst)
                {
                    ResponseTemplate::new(403)
                } else if opts.real_media {
                    match REAL.1.get(msn as usize) {
                        Some(b) => ResponseTemplate::new(200).set_body_bytes(b.clone()),
                        None => ResponseTemplate::new(404),
                    }
                } else {
                    ResponseTemplate::new(200).set_body_bytes(seg_bytes(msn))
                };
                let t = if opts.via_proxy {
                    t.insert_header("connection", "close")
                } else {
                    t
                };
                match opts.seg_delay {
                    Some(d) => t.set_delay(d),
                    None => t,
                }
            })
            .mount(&server)
            .await;
        Stream {
            server,
            polls,
            details,
            proxy,
        }
    }

    fn cfg(&self) -> ClientConfig {
        let mut cfg = ClientConfig {
            live_poll_interval: Duration::from_millis(1),
            live_idle_check: Duration::from_millis(60),
            ..config(&self.server)
        };
        if self.proxy.is_some() {
            // 단절을 기다려 주는 인내 예산(공용 설정은 0이다)
            cfg.retry.patience = Duration::from_secs(5);
            cfg.retry.patience_cap = Duration::from_millis(100);
        }
        cfg
    }

    fn client(&self) -> Chzzk {
        Chzzk::new(self.cfg()).unwrap()
    }
}

fn request(out: &Path, stop: Option<CancellationToken>) -> DownloadRequest {
    DownloadRequest {
        content: ContentRef::Live {
            channel_id: CHANNEL.into(),
        },
        quality_id: "144p".into(),
        expected_kind: PlaybackKind::Live,
        output: out.to_path_buf(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: NonZeroU8::new(2).unwrap(),
        live_stop: stop,
        recording_id: None,
    }
}

fn out_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path()
        .join("[생방송 260102-1200] 생방송채널 - 테스트 생방송.mp4")
}

/// 최종 파일에서 init 뒤의 세그먼트 msn 목록을 읽는다.
fn recorded_msns(path: &Path) -> Vec<u64> {
    let b = std::fs::read(path).unwrap();
    let init = init_bytes();
    assert!(b.starts_with(&init), "init으로 시작해야 한다");
    let body = &b[init.len()..];
    assert_eq!(body.len() % 16, 0, "세그먼트 경계에서 끝나야 한다");
    body.chunks(16)
        .map(|c| {
            assert_eq!(&c[..8], &[0, 0, 0, 16, b's', b't', b'y', b'p']);
            u64::from_be_bytes(c[8..].try_into().unwrap())
        })
        .collect()
}

fn no_part(out: &Path) {
    let (p, s) = part_files(out);
    assert!(!p.exists() && !s.exists(), "`.part`가 남아 있다");
}

async fn record(
    s: &Stream,
    out: &Path,
    stop: Option<CancellationToken>,
) -> Result<DownloadOutcome, Error> {
    let events = Events::default();
    let cb = events.callback();
    s.client()
        .download(request(out, stop), CancellationToken::new(), &cb)
        .await
}

/// 창이 한 칸씩 밀리다 ENDLIST가 나오면 구멍 없이 마무리한다.
/// 재조회(`details`)가 `target`번 이상 쌓일 때까지 기다렸다가 멈춘다.
/// 고정 sleep은 느린 CI에서 횟수가 모자라 흔들리므로, 횟수로 기다리고 상한(30초)만 시간으로 둔다.
fn stop_after_details(
    details: Arc<AtomicUsize>,
    target: usize,
    stop: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
        while details.load(Ordering::SeqCst) < target {
            if tokio::time::Instant::now() >= deadline {
                stop.cancel();
                panic!(
                    "30초 안에 재조회 {target}번에 이르지 못했다(현재 {}번)",
                    details.load(Ordering::SeqCst)
                );
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        stop.cancel();
    })
}

#[tokio::test]
async fn endlist_finishes_without_gaps() {
    let end = 5usize;
    let s = Stream::start(
        move |n| Pl::Window {
            first: n as u64,
            len: 3,
            ended: n >= end,
            tail: "",
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = s
        .client()
        .download(request(&out, None), CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    // poll 0: 0,1,2 → poll k: k+2가 새로 생김. 마지막 poll(5)의 끝은 7
    assert_eq!(recorded_msns(&out), (0..=7).collect::<Vec<_>>());
    no_part(&out);
    let last = events.all().into_iter().rev().find_map(|p| p.live).unwrap();
    assert_eq!(last.gaps, 0);
    assert_eq!(last.recorded_secs, 16.0);
}

/// `live_stop`은 취소가 아니라 마무리다: 받은 만큼 최종 파일이 되고 `Completed`다.
#[tokio::test]
async fn stop_finalizes_recording() {
    let s = Stream::start(
        |n| Pl::Window {
            first: n as u64,
            len: 3,
            ended: false,
            tail: "",
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    let events = Events::default();
    let cb = events.callback();
    let chzzk = s.client();
    let req = request(&out, Some(stop.clone()));
    let task =
        tokio::spawn(async move { chzzk.download(req, CancellationToken::new(), &cb).await });
    let started = std::time::Instant::now();
    loop {
        if events
            .all()
            .iter()
            .any(|p| p.live.is_some_and(|l| l.recorded_secs >= 12.0))
        {
            break;
        }
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "녹화가 진행되지 않는다"
        );
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    stop.cancel();
    let r = task.await.unwrap().unwrap();
    let DownloadOutcome::Completed { path, bytes, .. } = r else {
        panic!("{r:?}")
    };
    assert_eq!(path, out);
    assert_eq!(bytes, std::fs::metadata(&out).unwrap().len());
    let msns = recorded_msns(&out);
    assert!(msns.len() >= 6, "{msns:?}");
    assert!(msns.windows(2).all(|w| w[1] == w[0] + 1), "{msns:?}");
    no_part(&out);
}

/// 취소는 `.part`를 남기고 `Cancelled`다(멈춤과 다르다).
#[tokio::test]
async fn cancel_keeps_part() {
    let s = Stream::start(
        |n| Pl::Window {
            first: n as u64,
            len: 3,
            ended: false,
            tail: "",
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let cancel = CancellationToken::new();
    let events = Events::default();
    let cb = events.callback();
    let chzzk = s.client();
    let (req, c2) = (
        request(&out, Some(CancellationToken::new())),
        cancel.clone(),
    );
    let task = tokio::spawn(async move { chzzk.download(req, c2, &cb).await });
    let started = std::time::Instant::now();
    while !events
        .all()
        .iter()
        .any(|p| p.live.is_some_and(|l| l.recorded_secs >= 6.0))
    {
        assert!(started.elapsed() < Duration::from_secs(20));
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    cancel.cancel();
    assert!(matches!(task.await.unwrap(), Err(Error::Cancelled)));
    let (part, side) = part_files(&out);
    assert!(part.exists() && side.exists());
    assert!(!out.exists());

    // 끊긴 `.part`는 다음 실행에서 이어 받지 않고 받은 만큼 마무리한다(서버를 다시 부르지 않는다).
    let polls = s.polls.load(Ordering::SeqCst);
    let r = record(&s, &out, Some(CancellationToken::new()))
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(s.polls.load(Ordering::SeqCst), polls);
    let msns = recorded_msns(&out);
    assert!(msns.len() >= 3, "{msns:?}");
    no_part(&out);
}

/// 창이 우리를 지나가 버리면 구멍으로 세고 계속한다(실패하지 않는다). 순서는 늘 앞으로만 간다.
#[tokio::test]
async fn gaps_are_counted_and_recording_continues() {
    let s = Stream::start(
        |n| Pl::Window {
            first: n as u64 * 5,
            len: 3,
            ended: n >= 3,
            tail: "",
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = s
        .client()
        .download(request(&out, None), CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }));
    // poll k: 5k..5k+3. 사이마다 2개씩 놓친다.
    assert_eq!(
        recorded_msns(&out),
        [0, 1, 2, 5, 6, 7, 10, 11, 12, 15, 16, 17]
    );
    let live = events.all().into_iter().rev().find_map(|p| p.live).unwrap();
    assert_eq!(live.gaps, 6);
}

/// 403이 오면 재조회하고 계속한다. 새 세그먼트를 받을 때마다 재조회 횟수를 다시 세므로,
/// 한도(8)보다 많이 만료되어도 끝까지 간다.
#[tokio::test]
async fn expired_then_resolve_again_and_continue() {
    // 3번 중 1번은 403. 만료가 12번 쌓인다.
    let s = Stream::start(
        |n| {
            if n % 3 == 2 {
                Pl::Status(403)
            } else {
                let k = n - n / 3; // 성공한 요청 수
                Pl::Window {
                    first: k as u64,
                    len: 3,
                    ended: k >= 24,
                    tail: "",
                }
            }
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    let msns = recorded_msns(&out);
    assert_eq!(msns, (0..=26).collect::<Vec<_>>());
    assert!(
        s.details.load(Ordering::SeqCst) > 9,
        "재조회가 9번을 넘었어야 한다"
    );
}

/// 재조회가 다른 방송(`liveId`가 다름)이면 이어 붙이지 않고 끝낸다.
#[tokio::test]
async fn different_live_id_ends_recording() {
    let s = Stream::start(
        |n| {
            if n < 4 {
                Pl::Window {
                    first: n as u64,
                    len: 3,
                    ended: false,
                    tail: "",
                }
            } else {
                Pl::Status(403)
            }
        },
        // 처음(resolve)은 1번 방송, 만료 뒤 재조회는 2번 방송
        |n| Detail::Open(if n == 0 { 1 } else { 2 }),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), (0..=5).collect::<Vec<_>>());
    no_part(&out);
}

/// 재조회가 방송 종료면 받은 만큼 마무리한다.
#[tokio::test]
async fn closed_after_expiry_finishes() {
    let s = Stream::start(
        |n| {
            if n < 3 {
                Pl::Window {
                    first: n as u64,
                    len: 3,
                    ended: false,
                    tail: "",
                }
            } else {
                Pl::Status(403)
            }
        },
        |n| {
            if n == 0 {
                Detail::Open(1)
            } else {
                Detail::Closed
            }
        },
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), (0..=4).collect::<Vec<_>>());
}

/// 시작할 때 방송 중이 아니면 `NotLive`이고 파일이 남지 않는다.
#[tokio::test]
async fn not_live_at_start() {
    let s = Stream::start(|_| Pl::Status(404), |_| Detail::Closed).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(matches!(r, Err(Error::NotLive)), "{r:?}");
    assert_eq!(s.polls.load(Ordering::SeqCst), 0);
    no_part(&out);
    assert!(!out.exists());
}

/// 스트림이 다시 시작되면(DISCONTINUITY) 그 앞까지만 받고 끝낸다.
#[tokio::test]
async fn discontinuity_ends_recording() {
    let s = Stream::start(
        |n| Pl::Window {
            first: n as u64,
            len: 3,
            ended: false,
            tail: if n >= 2 {
                "#EXT-X-DISCONTINUITY\n#EXTINF:2.000,\nafter.m4v\n"
            } else {
                ""
            },
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), (0..=4).collect::<Vec<_>>());
}

/// 새 세그먼트가 한참 없으면 방송이 끝났는지 다시 조회하고, 끝났으면 마무리한다.
#[tokio::test]
async fn idle_rechecks_status() {
    let s = Stream::start(
        |_| Pl::Window {
            first: 0,
            len: 3,
            ended: false,
            tail: "",
        },
        |n| {
            if n == 0 {
                Detail::Open(1)
            } else {
                Detail::Closed
            }
        },
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), [0, 1, 2]);
    assert_eq!(s.details.load(Ordering::SeqCst), 2);
}

/// 새 세그먼트가 없어도 같은 방송이 계속 중이면 계속 기다린다(멈춤으로 끝낼 수 있다).
#[tokio::test]
async fn idle_but_still_live_keeps_waiting() {
    let s = Stream::start(
        |_| Pl::Window {
            first: 0,
            len: 2,
            ended: false,
            tail: "",
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    let canceller = stop_after_details(s.details.clone(), 3, stop.clone());
    let r = record(&s, &out, Some(stop)).await.unwrap();
    canceller.await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), [0, 1]);
    assert!(
        s.details.load(Ordering::SeqCst) >= 3,
        "idle 재조회가 반복되어야 한다"
    );
}

/// 아무것도 받지 못하고 멈추면 init만 든 파일을 남기지 않는다.
#[tokio::test]
async fn stop_before_any_segment_leaves_nothing() {
    let s = Stream::start(
        |_| Pl::Window {
            first: 0,
            len: 0,
            ended: false,
            tail: "",
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    let s2 = stop.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        s2.cancel();
    });
    let r = record(&s, &out, Some(stop)).await;
    assert!(matches!(r, Err(Error::NothingRecorded)), "{r:?}");
    no_part(&out);
    assert!(!out.exists());
}

/// 방송 시작 직후(세그먼트 0개)에도 기다렸다가 이어서 녹화한다.
#[tokio::test]
async fn waits_for_first_segments() {
    let s = Stream::start(
        |n| {
            if n < 3 {
                Pl::Window {
                    first: 0,
                    len: 0,
                    ended: false,
                    tail: "",
                }
            } else {
                Pl::Window {
                    first: 0,
                    len: 2,
                    ended: true,
                    tail: "",
                }
            }
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), [0, 1]);
}

/// `resolve`는 `mediaId == "HLS"`를 고르고 `audioOnly`를 화질에서 뺀다.
#[tokio::test]
async fn resolve_live() {
    let s = Stream::start(|_| Pl::Status(404), |_| Detail::Open(7)).await;
    let r = s
        .client()
        .resolve(&ContentRef::Live {
            channel_id: CHANNEL.into(),
        })
        .await
        .unwrap();
    assert_eq!(r.kind(), PlaybackKind::Live);
    let ids: Vec<&str> = r.qualities().iter().map(|q| q.id.as_str()).collect();
    assert_eq!(ids, ["720p", "480p", "360p", "144p", "1080p"]);
    assert_eq!(r.meta.title, "테스트 생방송");
    let chzzk_core::Source::Live { live_id, .. } = r.source else {
        panic!()
    };
    assert_eq!(live_id, 7);
}

/// 진행률 값 하나를 읽기 위한 도우미가 컴파일되는지(미사용 경고 방지).
#[allow(dead_code)]
fn _progress(_: Progress) {}

// ---- 리뷰 지적(적대적·일반 서브에이전트) 재현 ----

fn window(first: u64, len: u64, ended: bool) -> Pl {
    Pl::Window {
        first,
        len,
        ended,
        tail: "",
    }
}

/// A: 녹화 중 되돌릴 수 없는 오류(암호화 태그 등)가 나도 받은 `.part`를 지우지 않는다.
/// 다음에 같은 요청을 부르면 받은 만큼 마무리한다.
#[tokio::test]
async fn unsupported_midway_keeps_part_and_next_run_finalizes() {
    let s = Stream::start(
        |n| Pl::Window {
            first: n as u64,
            len: 3,
            ended: false,
            tail: if n >= 4 {
                "#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n"
            } else {
                ""
            },
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(matches!(r, Err(Error::Unsupported(_))), "{r:?}");
    let (part, side) = part_files(&out);
    assert!(part.exists() && side.exists(), "`.part`가 지워졌다");
    let polls = s.polls.load(Ordering::SeqCst);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(
        s.polls.load(Ordering::SeqCst),
        polls,
        "마무리는 서버를 부르지 않는다"
    );
    assert!(recorded_msns(&out).len() >= 4);
}

/// B: 새 조각이 오래 없어서 하는 재조회는 403 재조회 예산(8회)을 쓰지 않는다.
#[tokio::test]
async fn long_idle_does_not_exhaust_refresh_budget() {
    let s = Stream::start(|_| window(0, 2, false), |_| Detail::Open(1)).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    // 예산(8회)보다 많은 13번 넘게 idle 재조회가 일어날 때까지 기다린다
    let canceller = stop_after_details(s.details.clone(), 13, stop.clone());
    let r = record(&s, &out, Some(stop)).await;
    canceller.await.unwrap();
    assert!(matches!(r, Ok(DownloadOutcome::Completed { .. })), "{r:?}");
    assert!(s.details.load(Ordering::SeqCst) > 12);
}

/// C: 방송 시작 직후 playlist가 404여도 재조회 예산을 몇 ms에 다 쓰지 않고 기다린다.
#[tokio::test]
async fn playlist_not_ready_waits_instead_of_exhausting() {
    let s = Stream::start(
        |n| {
            if n < 12 {
                Pl::Status(404)
            } else {
                window(0, 2, true)
            }
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(matches!(r, Ok(DownloadOutcome::Completed { .. })), "{r:?}");
    assert_eq!(recorded_msns(&out), [0, 1]);
}

/// C: 첫 playlist를 기다리는 동안에도 멈춤이 먹는다(받은 것이 없으니 `NothingRecorded`).
#[tokio::test]
async fn stop_while_waiting_for_first_playlist() {
    let s = Stream::start(|_| Pl::Status(404), |_| Detail::Open(1)).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    let s2 = stop.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        s2.cancel();
    });
    let started = std::time::Instant::now();
    let r = record(&s, &out, Some(stop)).await;
    assert!(matches!(r, Err(Error::NothingRecorded)), "{r:?}");
    assert!(started.elapsed() < Duration::from_secs(5));
    no_part(&out);
}

/// D: init만 든 `.part`는 마무리하지 않는다(재생할 수 없는 완료 파일이 된다). 지우고 새로 녹화한다.
#[tokio::test]
async fn init_only_part_is_not_finalized() {
    use chzzk_core::download::part::{HlsState, PartFile, Sidecar};
    let s = Stream::start(|n| window(n as u64, 3, n >= 2), |_| Detail::Open(1)).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let init = init_bytes();
    let mut sc = Sidecar::new(
        ContentRef::Live {
            channel_id: CHANNEL.into(),
        },
        "144p",
        PlaybackKind::Live,
    );
    sc.hls = Some(HlsState {
        init_len: init.len() as u32,
        ..HlsState::default()
    });
    let mut p = PartFile::create(&out, sc).unwrap();
    p.write(&init).unwrap();
    p.checkpoint(|_| {}).await.unwrap();
    drop(p);

    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert!(s.polls.load(Ordering::SeqCst) > 0, "새로 녹화해야 한다");
    assert!(!recorded_msns(&out).is_empty());
}

/// E: CDN 엣지가 한 번 낡은 playlist(msn이 뒤로 감)를 줘도 스트림 재시작으로 보지 않는다.
#[tokio::test]
async fn single_stale_playlist_is_not_a_restart() {
    let s = Stream::start(
        |n| match n {
            0..=5 => window(n as u64, 3, false),
            6 => window(0, 3, false), // 낡은 응답
            _ => window(n as u64, 3, n >= 10),
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), (0..=12).collect::<Vec<_>>());
}

/// E: 정상적인 서명 갱신으로 init 주소의 경로가 바뀌어도(파일 이름은 그대로) 재시작이 아니다.
#[tokio::test]
async fn init_path_change_with_same_file_is_not_a_restart() {
    // 재조회(403)가 오면 서명이 경로에 든 주소로 바뀌었다고 흉내 낸다: 같은 서버, 같은 파일 이름
    let s = Stream::start(
        |n| {
            if n == 3 {
                Pl::Status(403)
            } else {
                let k = if n > 3 { n - 1 } else { n };
                window(k as u64, 3, k >= 8)
            }
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), (0..=10).collect::<Vec<_>>());
}

/// F: 세그먼트 하나가 계속 5xx여도 구멍으로 세고 계속한다(몇 시간 녹화가 실패하지 않는다).
#[tokio::test]
async fn persistent_5xx_segment_becomes_a_gap() {
    let s = Stream::start_with(
        Opts {
            bad_seg: Some(4),
            ..Opts::default()
        },
        |n| window(n as u64, 3, n >= 8),
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = s
        .client()
        .download(request(&out, None), CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    let msns = recorded_msns(&out);
    assert!(!msns.contains(&4), "{msns:?}");
    assert!(msns.contains(&3) && msns.contains(&5), "{msns:?}");
    let live = events.all().into_iter().rev().find_map(|p| p.live).unwrap();
    assert_eq!(live.gaps, 1);
}

/// F: 아무것도 안 되는 서버(모든 세그먼트가 5xx)는 계속 구멍으로 세지 않고 오류로 끝난다. `.part`는 남는다.
#[tokio::test]
async fn every_segment_failing_ends_with_error() {
    // msn 0..2 중 하나만 나빠서는 연속 실패가 한도에 닿지 않는다: 새 조각이 모두 나쁜 서버
    let s = Stream::start_with(
        Opts {
            bad_seg: Some(0),
            ..Opts::default()
        },
        |_| window(0, 1, false),
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    let s2 = stop.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        s2.cancel();
    });
    let r = record(&s, &out, Some(stop)).await;
    // 한 조각만 있는 창이 계속 그 조각을 가리키므로 구멍 하나 뒤 새 조각이 없다: 멈춤으로 끝나면 받은 것이 없다
    assert!(matches!(r, Err(Error::NothingRecorded)), "{r:?}");
    no_part(&out);
}

/// H: 멈춤 때 이미 받아 둔 세그먼트는 버리지 않고 마저 쓴다.
#[tokio::test]
async fn stop_keeps_segments_already_downloaded() {
    let s = Stream::start_with(
        Opts {
            seg_delay: Some(Duration::from_millis(40)),
            ..Opts::default()
        },
        |_| window(0, 6, false),
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    let events = Events::default();
    let cb = {
        let (stop, inner) = (stop.clone(), events.callback());
        move |p: Progress| {
            // 첫 세그먼트를 쓰는 순간 멈춘다. 같이 요청한 앞쪽 세그먼트들이 이미 도착해 있다
            if p.live.is_some_and(|l| l.recorded_secs >= 2.0) {
                stop.cancel();
            }
            inner(p);
        }
    };
    let mut req = request(&out, Some(stop.clone()));
    req.concurrency = NonZeroU8::new(4).unwrap();
    let r = s
        .client()
        .download(req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    let msns = recorded_msns(&out);
    assert!(msns.len() >= 4, "받아 둔 조각을 버렸다: {msns:?}");
    assert!(msns.windows(2).all(|w| w[1] == w[0] + 1), "{msns:?}");
}

/// 최상위 상자가 일반 mp4 모양인지 본다: `moof` 없음, 끝은 `moov` 하나, `mdat` 있음.
fn assert_flat_mp4(path: &Path) {
    let b = std::fs::read(path).unwrap();
    let w = mp4::walk_boxes(&b).unwrap();
    assert!(!w.truncated);
    let types = w.types();
    assert!(!types.contains(&"moof"), "{types:?}");
    assert_eq!(types.last(), Some(&"moov"), "{types:?}");
    assert_eq!(
        types.iter().filter(|t| **t == "moov").count(),
        1,
        "{types:?}"
    );
    assert!(types.contains(&"mdat"), "{types:?}");
    assert_eq!(types[0], "ftyp");
}

/// I: 실제 fMP4 조각(합성)을 녹화하면 마무리에서 일반 mp4로 바뀐다(core.md 구현 중 변경 60).
#[tokio::test]
async fn real_fragments_are_converted_to_flat_mp4() {
    let n = REAL.1.len() as u64;
    assert!(n >= 4, "fixture 조각 수 {n}");
    let s = Stream::start_with(
        Opts {
            real_media: true,
            ..Opts::default()
        },
        move |_| window(0, n, true),
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    let DownloadOutcome::Completed { bytes, .. } = r else {
        panic!("{r:?}")
    };
    assert_flat_mp4(&out);
    // 보고한 크기는 붙인 moov까지 포함한 최종 파일 크기다
    assert_eq!(std::fs::metadata(&out).unwrap().len(), bytes);
    let raw: usize = REAL.0.len() + REAL.1.iter().map(Vec::len).sum::<usize>();
    assert!(bytes as usize > raw);
    // 원래 바이트 자리는 그대로다(종류 4바이트만 free로 바뀐다)
    let b = std::fs::read(&out).unwrap();
    let orig: Vec<u8> = REAL
        .0
        .iter()
        .chain(REAL.1.iter().flatten())
        .copied()
        .collect();
    let changed = orig.iter().zip(&b).filter(|(a, b)| a != b).count();
    assert!(changed <= 4 * (2 + REAL.1.len()), "{changed}");
    no_part(&out);
}

/// J: 끊긴 `.part`를 다음 실행이 마무리할 때도 변환한다.
#[tokio::test]
async fn interrupted_real_recording_is_converted_when_finalized() {
    let s = Stream::start_with(
        Opts {
            real_media: true,
            ..Opts::default()
        },
        |n| Pl::Window {
            first: 0,
            len: 3,
            ended: false,
            tail: if n >= 1 {
                "#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n"
            } else {
                ""
            },
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(matches!(r, Err(Error::Unsupported(_))), "{r:?}");
    let (part, _) = part_files(&out);
    assert!(part.exists());
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_flat_mp4(&out);
    no_part(&out);
}

// ---- 커버리지: 엔진의 오류·재조회 분기 ----

/// 첫 playlist가 403이면 재조회하고 다시 읽어 녹화한다.
#[tokio::test]
async fn first_playlist_403_refreshes_then_records() {
    let s = Stream::start(
        |n| {
            if n < 2 {
                Pl::Status(403)
            } else {
                window(0, 2, true)
            }
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), [0, 1]);
    assert!(s.details.load(Ordering::SeqCst) >= 3, "403마다 재조회한다");
}

/// 첫 playlist가 403이고 재조회가 방송 종료면 `NotLive`다.
#[tokio::test]
async fn first_playlist_403_then_closed_is_not_live() {
    let s = Stream::start(
        |_| Pl::Status(403),
        |n| {
            if n == 0 {
                Detail::Open(1)
            } else {
                Detail::Closed
            }
        },
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(matches!(r, Err(Error::NotLive)), "{r:?}");
    no_part(&out);
}

/// 창에서 밀려난 세그먼트(404)는 구멍으로 세고 계속한다.
#[tokio::test]
async fn gone_segment_becomes_a_gap() {
    let s = Stream::start_with(
        Opts {
            gone_seg: Some(4),
            ..Opts::default()
        },
        |n| window(n as u64, 3, n >= 8),
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let events = Events::default();
    let cb = events.callback();
    let r = s
        .client()
        .download(request(&out, None), CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert!(!recorded_msns(&out).contains(&4));
    let live = events.all().into_iter().rev().find_map(|p| p.live).unwrap();
    assert_eq!(live.gaps, 1);
}

/// 세그먼트가 403(서명 만료)이면 재조회하고 같은 자리부터 이어서 받는다(빠지는 조각이 없다).
#[tokio::test]
async fn segment_403_refreshes_and_continues_without_gap() {
    let s = Stream::start_with(
        Opts {
            expire_seg: Some(4),
            ..Opts::default()
        },
        |n| window(n as u64, 3, n >= 8),
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    let msns = recorded_msns(&out);
    assert!(msns.contains(&4), "{msns:?}");
    assert!(msns.windows(2).all(|w| w[1] == w[0] + 1), "{msns:?}");
    assert!(s.details.load(Ordering::SeqCst) >= 2);
}

/// 새 세그먼트가 연달아 한도(10)를 넘게 5xx면 서버가 아무것도 못 주는 것이라 오류로 끝난다. `.part`는 남는다.
#[tokio::test]
async fn many_consecutive_bad_segments_end_with_error() {
    let s = Stream::start_with(
        Opts {
            bad_from: Some(3),
            ..Opts::default()
        },
        |n| window(n as u64, 4, false),
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(
        matches!(r, Err(Error::HttpStatus { status: 503, .. })),
        "{r:?}"
    );
    let (part, side) = part_files(&out);
    assert!(part.exists() && side.exists(), "`.part`가 지워졌다");
}

/// playlist가 계속 5xx면 연달아 한도 뒤에 오류로 끝난다(받은 것이 없으니 파일도 없다).
#[tokio::test]
async fn playlist_5xx_forever_ends_with_error() {
    let s = Stream::start(|_| Pl::Status(503), |_| Detail::Open(1)).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(
        matches!(r, Err(Error::HttpStatus { status: 503, .. })),
        "{r:?}"
    );
    no_part(&out);
}

/// 녹화 중 playlist가 잠깐 404여도(아직 없음) 기다렸다가 이어서 녹화한다.
#[tokio::test]
async fn midstream_playlist_404_waits_and_continues() {
    let s = Stream::start(
        |n| match n {
            0..=2 => window(n as u64, 3, false),
            3..=5 => Pl::Status(404),
            _ => window(n as u64 - 3, 3, n >= 9),
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    let msns = recorded_msns(&out);
    assert!(msns.windows(2).all(|w| w[1] == w[0] + 1), "{msns:?}");
    assert!(msns.len() >= 8, "{msns:?}");
}

/// 시작하자마자 연결이 끊겨 있어도(master 읽기) 기다렸다가 녹화한다.
#[tokio::test]
async fn outage_at_start_is_waited_out() {
    let s = Stream::start_with(
        Opts {
            via_proxy: true,
            ..Opts::default()
        },
        |n| window(n as u64, 3, n >= 4),
        |_| Detail::Open(1),
    )
    .await;
    s.proxy
        .as_ref()
        .unwrap()
        .down_for(Duration::from_millis(250));
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert!(s.proxy.as_ref().unwrap().refused() > 0, "단절이 없었다");
    assert_eq!(recorded_msns(&out), (0..=6).collect::<Vec<_>>());
}

/// 녹화 도중 연결이 끊겨도(playlist·세그먼트) 기다렸다가 이어서 녹화한다(구멍이 없다).
#[tokio::test]
async fn outage_midstream_is_waited_out() {
    let s = Stream::start_with(
        Opts {
            via_proxy: true,
            seg_delay: Some(Duration::from_millis(15)),
            ..Opts::default()
        },
        |n| window(n as u64, 3, n >= 60),
        |_| Detail::Open(1),
    )
    .await;
    let gate = s.proxy.as_ref().unwrap().gate();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(100)).await;
        gate.down_for(Duration::from_millis(250));
    });
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert!(s.proxy.as_ref().unwrap().refused() > 0, "단절이 없었다");
    let msns = recorded_msns(&out);
    assert!(msns.windows(2).all(|w| w[1] == w[0] + 1), "{msns:?}");
    assert!(msns.len() >= 40, "{msns:?}");
}

/// 이미 멈춤 신호가 와 있으면 아무것도 받지 않고 `NothingRecorded`다.
#[tokio::test]
async fn stop_already_requested_records_nothing() {
    let s = Stream::start(|n| window(n as u64, 3, false), |_| Detail::Open(1)).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    stop.cancel();
    let r = record(&s, &out, Some(stop)).await;
    assert!(matches!(r, Err(Error::NothingRecorded)), "{r:?}");
    no_part(&out);
}

/// master가 403이면 `AuthRequired`로 끝난다(받은 것이 없다).
#[tokio::test]
async fn master_403_is_auth_required() {
    let s = Stream::start_with(
        Opts {
            master_status: Some(403),
            ..Opts::default()
        },
        |_| window(0, 2, true),
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(
        matches!(r, Err(Error::AuthRequired { status: 403 })),
        "{r:?}"
    );
    no_part(&out);
}

/// 재조회 중 서버가 오류를 내면 그 오류로 끝난다. 받은 `.part`는 남는다.
#[tokio::test]
async fn refresh_failure_ends_with_that_error_and_keeps_part() {
    let s = Stream::start(
        |n| {
            if n < 3 {
                window(n as u64, 3, false)
            } else {
                Pl::Status(403)
            }
        },
        |n| {
            if n == 0 {
                Detail::Open(1)
            } else {
                Detail::Status(500)
            }
        },
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await;
    assert!(
        matches!(r, Err(Error::HttpStatus { status: 500, .. })),
        "{r:?}"
    );
    let (part, side) = part_files(&out);
    assert!(part.exists() && side.exists(), "`.part`가 지워졌다");
}

/// 세그먼트가 403이고 재조회가 방송 종료면 받은 만큼 마무리한다.
#[tokio::test]
async fn segment_403_then_closed_finishes() {
    let s = Stream::start_with(
        Opts {
            expire_seg: Some(4),
            ..Opts::default()
        },
        |n| window(n as u64, 3, false),
        |n| {
            if n == 0 {
                Detail::Open(1)
            } else {
                Detail::Closed
            }
        },
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), (0..=3).collect::<Vec<_>>());
}

/// 세그먼트를 받는 도중 연결이 끊기면(아직 시작하지 않은 요청이 거부된다) 기다렸다가 같은 자리부터 이어 받는다.
#[tokio::test]
async fn outage_during_segment_fetch_is_waited_out() {
    let s = Stream::start_with(
        Opts {
            via_proxy: true,
            seg_delay: Some(Duration::from_millis(40)),
            ..Opts::default()
        },
        |n| window(0, 8, n >= 1),
        |_| Detail::Open(1),
    )
    .await;
    let gate = s.proxy.as_ref().unwrap().gate();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        gate.down_for(Duration::from_millis(250));
    });
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let r = record(&s, &out, None).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert!(s.proxy.as_ref().unwrap().refused() > 0, "단절이 없었다");
    assert_eq!(recorded_msns(&out), (0..=7).collect::<Vec<_>>());
}

/// 세그먼트를 받다가 끊긴 연결을 기다리는 동안 멈춤이 오면 받은 만큼 마무리한다.
#[tokio::test]
async fn stop_while_waiting_out_a_segment_outage_finalizes() {
    let s = Stream::start_with(
        Opts {
            via_proxy: true,
            seg_delay: Some(Duration::from_millis(40)),
            ..Opts::default()
        },
        |_| window(0, 8, false),
        |_| Detail::Open(1),
    )
    .await;
    let gate = s.proxy.as_ref().unwrap().gate();
    let stop = CancellationToken::new();
    let s2 = stop.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        gate.down_for(Duration::from_secs(20));
        tokio::time::sleep(Duration::from_millis(300)).await;
        s2.cancel();
    });
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let started = std::time::Instant::now();
    let r = record(&s, &out, Some(stop)).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert!(
        started.elapsed() < Duration::from_secs(10),
        "멈춤이 먹지 않았다"
    );
    let msns = recorded_msns(&out);
    assert!(
        !msns.is_empty() && msns.windows(2).all(|w| w[1] == w[0] + 1),
        "{msns:?}"
    );
}

/// 영상 화질이 하나도 없으면(오디오 트랙뿐) `NoQualities`다.
#[tokio::test]
async fn live_without_video_tracks_has_no_qualities() {
    let s = Stream::start(|_| Pl::Status(404), |_| Detail::AudioOnly).await;
    let r = s
        .client()
        .resolve(&ContentRef::Live {
            channel_id: CHANNEL.into(),
        })
        .await;
    assert!(matches!(r, Err(Error::NoQualities)), "{r:?}");
}

/// 세그먼트 403 뒤 재조회를 기다리는 동안 멈춤이 오면 받은 만큼 마무리한다(core.md 61 F1).
#[tokio::test]
async fn stop_during_refresh_after_segment_403_finalizes() {
    let s = Stream::start_with(
        Opts {
            expire_seg: Some(3),
            ..Opts::default()
        },
        |n| window(n as u64, 3, false),
        |n| {
            if n == 0 {
                Detail::Open(1)
            } else {
                Detail::Slow(Duration::from_secs(30))
            }
        },
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    stop_when(s.details.clone(), 2, stop.clone());
    let r = record_bounded(&s, &out, stop).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), vec![0, 1, 2]);
    no_part(&out);
}

/// 받은 조각이 없을 때 재조회 중 멈춤이 오면 `NothingRecorded`다.
#[tokio::test]
async fn stop_during_refresh_before_any_segment_records_nothing() {
    let s = Stream::start_with(
        Opts {
            expire_seg: Some(0),
            ..Opts::default()
        },
        |n| window(n as u64, 3, false),
        |n| {
            if n == 0 {
                Detail::Open(1)
            } else {
                Detail::Slow(Duration::from_secs(30))
            }
        },
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    stop_when(s.details.clone(), 2, stop.clone());
    let r = record_bounded(&s, &out, stop).await;
    assert!(matches!(r, Err(Error::NothingRecorded)), "{r:?}");
    no_part(&out);
}

/// 다음 playlist를 읽는 동안 멈춤이 오면 받은 만큼 마무리한다.
#[tokio::test]
async fn stop_while_reading_next_playlist_finalizes() {
    let s = Stream::start(
        |n| {
            if n < 2 {
                window(n as u64, 3, false)
            } else {
                Pl::Hang
            }
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    stop_when(s.polls.clone(), 3, stop.clone());
    let r = record_bounded(&s, &out, stop).await.unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(recorded_msns(&out), vec![0, 1, 2, 3]);
    no_part(&out);
}

/// 받은 조각이 없을 때 playlist를 읽는 동안 멈춤이 오면 `NothingRecorded`다.
#[tokio::test]
async fn stop_while_reading_playlist_before_any_segment_records_nothing() {
    let s = Stream::start(
        |n| {
            if n == 0 {
                window(0, 0, false)
            } else {
                Pl::Hang
            }
        },
        |_| Detail::Open(1),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    stop_when(s.polls.clone(), 2, stop.clone());
    let r = record_bounded(&s, &out, stop).await;
    assert!(matches!(r, Err(Error::NothingRecorded)), "{r:?}");
    no_part(&out);
}

/// 첫 조회를 기다리는 동안에도 멈춤이 먹는다.
#[tokio::test]
async fn stop_during_first_resolve_records_nothing() {
    let s = Stream::start(
        |n| window(n as u64, 3, false),
        |_| Detail::Slow(Duration::from_secs(30)),
    )
    .await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let stop = CancellationToken::new();
    stop_when(s.details.clone(), 1, stop.clone());
    let r = record_bounded(&s, &out, stop).await;
    assert!(matches!(r, Err(Error::NothingRecorded)), "{r:?}");
    no_part(&out);
    assert_eq!(s.polls.load(Ordering::SeqCst), 0);
}

/// 이전 녹화가 남긴 `.part`(init + 영상 조각 하나)를 `recording_id`와 함께 만든다.
async fn leave_recording(out: &Path, id: &str) -> (Vec<u8>, Vec<u8>) {
    use chzzk_core::download::part::{HlsState, PartFile, Sidecar};
    let init = init_bytes();
    let mut sc = Sidecar::new(
        ContentRef::Live {
            channel_id: CHANNEL.into(),
        },
        "144p",
        PlaybackKind::Live,
    );
    sc.recording_id = Some(id.to_owned());
    sc.hls = Some(HlsState {
        init_len: init.len() as u32,
        ..HlsState::default()
    });
    let mut p = PartFile::create(out, sc).unwrap();
    p.write(&init).unwrap();
    p.write(&seg_bytes(0)).unwrap();
    p.checkpoint(|_| {}).await.unwrap();
    drop(p);
    let (part, sidecar) = part_files(out);
    (
        std::fs::read(part).unwrap(),
        std::fs::read(sidecar).unwrap(),
    )
}

/// 7-b: 같은 방송을 다시 붙여넣어도(새 작업 = 새 `recording_id`) 옛 녹화를 마무리하지 않고 건드리지도 않는다.
#[tokio::test]
async fn repaste_same_broadcast_does_not_finalize_old_part() {
    let s = Stream::start(|n| window(n as u64, 3, n >= 2), |_| Detail::Open(1)).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    let (part_before, sc_before) = leave_recording(&out, &"a".repeat(32)).await;

    let events = Events::default();
    let cb = events.callback();
    let mut req = request(&out, None);
    req.recording_id = Some("b".repeat(32));
    let r = s
        .client()
        .download(req, CancellationToken::new(), &cb)
        .await;
    assert!(matches!(r, Err(Error::PartialRecording { .. })), "{r:?}");
    assert_eq!(s.polls.load(Ordering::SeqCst), 0);
    assert_eq!(s.details.load(Ordering::SeqCst), 0);
    assert!(!out.exists(), "최종 파일이 생기면 안 된다");
    let (part, sidecar) = part_files(&out);
    assert_eq!(std::fs::read(part).unwrap(), part_before);
    assert_eq!(std::fs::read(sidecar).unwrap(), sc_before);
}

/// 대조: 같은 `recording_id`의 요청(= 저장)은 받은 만큼 마무리한다.
#[tokio::test]
async fn own_recording_part_is_finalized_by_same_id() {
    let s = Stream::start(|n| window(n as u64, 3, n >= 2), |_| Detail::Open(1)).await;
    let dir = tempfile::tempdir().unwrap();
    let out = out_path(&dir);
    leave_recording(&out, &"a".repeat(32)).await;

    let events = Events::default();
    let cb = events.callback();
    let mut req = request(&out, None);
    req.recording_id = Some("a".repeat(32));
    let r = s
        .client()
        .download(req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    assert!(matches!(r, DownloadOutcome::Completed { .. }), "{r:?}");
    assert_eq!(s.polls.load(Ordering::SeqCst), 0);
    assert_eq!(recorded_msns(&out), vec![0]);
    no_part(&out);
}
