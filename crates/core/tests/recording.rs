//! 생방송 녹화 통합 테스트(core.md 구현 중 변경 "생방송"). 네트워크는 wiremock뿐이다.
//!
//! 가짜 방송 서버는 playlist를 읽을 때마다 창을 밀고(`Pl`), `live-detail`은 호출 횟수에 따라 방송 중·종료·다른
//! 방송을 낸다(`Detail`). 세그먼트 본문은 msn이 들어 있어 이어 붙인 순서를 검사할 수 있다.

mod common;

use std::num::NonZeroU8;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, Error, PlaybackKind, Progress,
};
use common::{Events, config, fixture, part_files, rewrite_hosts};
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
}

/// `live-detail` 응답.
#[derive(Clone)]
enum Detail {
    Open(u64),
    Closed,
}

struct Stream {
    server: MockServer,
    polls: Arc<AtomicUsize>,
    details: Arc<AtomicUsize>,
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

impl Stream {
    /// `pl(n)`은 n번째(0부터) playlist 요청에, `detail(n)`은 n번째 `live-detail` 요청에 답한다.
    async fn start(
        pl: impl Fn(usize) -> Pl + Send + Sync + 'static,
        detail: impl Fn(usize) -> Detail + Send + Sync + 'static,
    ) -> Stream {
        let server = MockServer::start().await;
        let polls = Arc::new(AtomicUsize::new(0));
        let details = Arc::new(AtomicUsize::new(0));
        let uri = server.uri();

        let (d, u) = (details.clone(), uri.clone());
        Mock::given(method("GET"))
            .and(path(DETAIL_PATH))
            .respond_with(move |_: &Request| {
                let n = d.fetch_add(1, Ordering::SeqCst);
                let body = match detail(n) {
                    Detail::Open(id) => {
                        let b = rewrite_hosts(&fixture("testdata/live/live_detail.json"), &u);
                        String::from_utf8(b)
                            .unwrap()
                            .replace(FIXTURE_LIVE_ID, &format!("\"liveId\": {id}"))
                            .into_bytes()
                    }
                    Detail::Closed => fixture("testdata/live/live_detail_closed.json"),
                };
                ResponseTemplate::new(200).set_body_raw(body, "application/json")
            })
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path(format!("{DIR}/hls_playlist.m3u8")))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=256x144\n144p/chunklist.m3u8\n",
            ))
            .mount(&server)
            .await;

        let p = polls.clone();
        Mock::given(method("GET"))
            .and(path(format!("{DIR}/144p/chunklist.m3u8")))
            .respond_with(move |_: &Request| {
                let n = p.fetch_add(1, Ordering::SeqCst);
                match pl(n) {
                    Pl::Status(s) => ResponseTemplate::new(s),
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
                        ResponseTemplate::new(200).set_body_string(t)
                    }
                }
            })
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path(format!("{DIR}/144p/init.mp4")))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(init_bytes()))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path_regex(r"^/live/kr/streamkey0/144p/seg\d+\.m4v$"))
            .respond_with(|r: &Request| {
                let name = r.url.path().rsplit('/').next().unwrap().to_string();
                let msn: u64 = name[3..name.len() - 4].parse().unwrap();
                ResponseTemplate::new(200).set_body_bytes(seg_bytes(msn))
            })
            .mount(&server)
            .await;
        Stream {
            server,
            polls,
            details,
        }
    }

    fn cfg(&self) -> ClientConfig {
        ClientConfig {
            live_poll_interval: Duration::from_millis(1),
            live_idle_check: Duration::from_millis(60),
            ..config(&self.server)
        }
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
    }
}

fn out_path(dir: &tempfile::TempDir) -> PathBuf {
    dir.path()
        .join("[라이브 260102-1200] 생방송채널 - 테스트 생방송.mp4")
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
    let s2 = stop.clone();
    let canceller = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(400)).await;
        s2.cancel();
    });
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
