//! 받기 전 미리보기 세션(preview.md §5, PV-2): 열기 판정·total 탐색, `handle`의 scheme 요청 표(mp4 경로),
//! 403 재조회(세대 번호), 유휴 만료, 비밀값.
//!
//! 네트워크 없이 가짜 Backend의 대본(`push_range`·`push_resolve`)으로 상태 기계만 본다.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_core::{
    ContentKind, ContentMeta, ContentRef, Error, PdRep, Quality, RangeChunk, Resolved, Source,
    WatchFail,
};
use chzzk_shell::dto::WatchKindDto;
use chzzk_shell::ownership::{SignedInChannel, Signer};
use chzzk_shell::watch::{CHUNK, IDLE_TTL, RecheckFn, ReqCtx, WatchService};
use chzzk_shell::{ErrorCode, OwnershipGate};
use common::fake::{FakeBackend, RangeStep};
use tokio::sync::Notify;
use url::Url;

const VIDEO_URL: &str = "https://chzzk.naver.com/video/9000002";
const OTHER_URL: &str = "https://chzzk.naver.com/video/9000003";
const ME: &str = "000000000000000000000000000000b2";
const OTHER_CH: &str = "000000000000000000000000000000a1";
const APP_ORIGIN: &str = "tauri://localhost";
const TOTAL: u64 = 100;

fn content() -> ContentRef {
    ContentRef::Video { video_no: 9000002 }
}

fn pd_url(tag: &str) -> Url {
    Url::parse(&format!(
        "https://media.example.invalid/m/{tag}.mp4?hdnts=SIGNEDSECRET_{tag}"
    ))
    .unwrap()
}

fn quality(id: &str, res: Option<u32>, audio_only: bool) -> Quality {
    Quality {
        id: id.into(),
        label: res.map_or_else(|| id.to_string(), |r| format!("{r}p")),
        resolution: res,
        width: None,
        height: None,
        bandwidth: None,
        frame_rate: None,
        audio_only,
    }
}

fn meta(channel: Option<&str>) -> ContentMeta {
    ContentMeta {
        kind: ContentKind::Video,
        title: "테스트 영상".into(),
        channel_name: "테스트 채널".into(),
        channel_id: channel.map(str::to_string),
        live_open_date: None,
        publish_date: None,
        adult: false,
        duration_secs: Some(60.0),
    }
}

fn resolved_with(source: Source, channel: Option<&str>) -> Resolved {
    Resolved {
        content: content(),
        meta: meta(channel),
        source,
        thumbnail_url: None,
    }
}

/// 화질 `(id, 짧은 변, 오디오만, 주소 태그)`들로 만든 PD 결과
fn resolved_pd(reps: &[(&str, Option<u32>, bool, &str)], channel: Option<&str>) -> Resolved {
    resolved_with(
        Source::Progressive {
            reps: reps
                .iter()
                .map(|(id, res, audio, tag)| PdRep {
                    quality: quality(id, *res, *audio),
                    url: pd_url(tag),
                })
                .collect(),
        },
        channel,
    )
}

/// 기본 PD 결과: 720p 하나. 주소 태그만 고른다.
fn pd(tag: &str, channel: Option<&str>) -> Resolved {
    resolved_pd(&[("PD_720P", Some(720), false, tag)], channel)
}

fn chunk(start: u64, end_incl: u64, total: u64) -> RangeChunk {
    RangeChunk {
        start,
        end_incl,
        total,
        content_type: Some("video/mp4".into()),
        body: vec![7; (end_incl - start + 1) as usize],
    }
}

/// 로그인 가짜: 채널·관리자·맡은 채널을 테스트가 바꾼다.
struct FakeSigner(Mutex<Option<Signer>>);

impl FakeSigner {
    fn new(channel: Option<&str>) -> Arc<Self> {
        let s = Arc::new(FakeSigner(Mutex::new(None)));
        s.set(channel);
        s
    }

    fn set(&self, channel: Option<&str>) {
        *self.0.lock().unwrap() = channel.map(|c| Signer {
            channel_id: c.into(),
            is_admin: false,
            admin_pending: false,
            delegated: Arc::from(Vec::<String>::new()),
        });
    }

    fn edit(&self, f: impl FnOnce(&mut Signer)) {
        if let Some(s) = self.0.lock().unwrap().as_mut() {
            f(s);
        }
    }
}

impl SignedInChannel for FakeSigner {
    fn signed_in(&self) -> Option<Signer> {
        self.0.lock().unwrap().clone()
    }
}

type Hook = Arc<Mutex<Option<Box<dyn Fn() + Send + Sync>>>>;

struct Env {
    svc: Arc<WatchService<FakeBackend>>,
    fake: Arc<FakeBackend>,
    signer: Option<Arc<FakeSigner>>,
    rechecks: Arc<AtomicUsize>,
    hook: Hook,
}

impl Env {
    /// 로그인을 쓰지 않는 빌드
    fn disabled() -> Env {
        Env::build(None)
    }

    /// 로그인 채널 `ME`로 로그인한 빌드
    fn signed_in() -> Env {
        Env::build(Some(FakeSigner::new(Some(ME))))
    }

    fn build(signer: Option<Arc<FakeSigner>>) -> Env {
        let fake = FakeBackend::new();
        let gate = match &signer {
            Some(s) => {
                let s: Arc<dyn SignedInChannel> = s.clone();
                OwnershipGate::enabled(s)
            }
            None => OwnershipGate::disabled(),
        };
        let rechecks = Arc::new(AtomicUsize::new(0));
        let hook: Hook = Arc::new(Mutex::new(None));
        let recheck: RecheckFn = {
            let (n, h) = (rechecks.clone(), hook.clone());
            Arc::new(move || {
                let (n, h) = (n.clone(), h.clone());
                Box::pin(async move {
                    n.fetch_add(1, Ordering::SeqCst);
                    if let Some(f) = h.lock().unwrap().as_ref() {
                        f();
                    }
                })
            })
        };
        let client = fake.clone();
        let svc = Arc::new(WatchService::new(
            Arc::new(move || client.clone()),
            Arc::new(gate),
            recheck,
        ));
        Env {
            svc,
            fake,
            signer,
            rechecks,
            hook,
        }
    }

    /// 열기 대본: (게이트 캐시에 채널이 있으면 fetch 없이) resolve 하나 + total 탐색 하나
    fn script_open(&self, r: Resolved, total: u64) {
        self.fake.push_resolve(Ok(r));
        self.fake.push_range(RangeStep::ok(chunk(0, 0, total)));
    }

    /// 판정을 통과하는 열기 대본으로 열고 id를 돌려준다.
    async fn open(&self, tag: &str) -> String {
        if self.signer.is_some() {
            // 로그인 빌드는 게이트 캐시 미스라 fetch가 resolve를 한 번 더 쓴다
            self.fake.push_resolve(Ok(pd(tag, Some(ME))));
        }
        self.script_open(pd(tag, Some(ME)), TOTAL);
        self.open_script_ready().await
    }

    /// 대본이 이미 있을 때 연다.
    async fn open_script_ready(&self) -> String {
        self.svc
            .open(VIDEO_URL, &content())
            .await
            .expect("열려야 한다")
            .id
    }

    async fn get(&self, id: &str, path: &str, range: Option<&str>) -> http::Response<Vec<u8>> {
        self.send(http::Method::GET, id, path, range, None, "main")
            .await
    }

    async fn send(
        &self,
        method: http::Method,
        id: &str,
        path: &str,
        range: Option<&str>,
        origin: Option<&str>,
        label: &str,
    ) -> http::Response<Vec<u8>> {
        let mut b = http::Request::builder()
            .method(method)
            .uri(format!("watch://localhost/{id}{path}"));
        if let Some(r) = range {
            b = b.header("range", r);
        }
        if let Some(o) = origin {
            b = b.header("origin", o);
        }
        let req = b.body(Vec::new()).unwrap();
        self.svc
            .handle(
                &req,
                ReqCtx {
                    webview_label: label,
                },
            )
            .await
    }
}

fn header<'a>(r: &'a http::Response<Vec<u8>>, name: &str) -> Option<&'a str> {
    r.headers().get(name).and_then(|v| v.to_str().ok())
}

fn status(r: &http::Response<Vec<u8>>) -> u16 {
    r.status().as_u16()
}

// ── 열기 ────────────────────────────────────────────────

#[tokio::test]
async fn open_requires_url_content_match() {
    let env = Env::disabled();
    let err = env.svc.open(OTHER_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert!(env.fake.calls().is_empty(), "resolve를 부르면 안 된다");
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn open_denied_by_gate_not_own() {
    let env = Env::signed_in();
    // 게이트 캐시 미스 → fetch가 resolve 한 번. 컨텐츠 채널은 남의 것
    env.fake.push_resolve(Ok(pd("a", Some(OTHER_CH))));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::NotOwnContent);
    assert!(!env.svc.has_session());
    assert!(env.fake.range_calls().is_empty(), "탐색 전에 막는다");
}

#[tokio::test]
async fn open_unknown_ownership_fails_closed() {
    let env = Env::signed_in();
    env.fake.push_resolve(Ok(pd("a", None)));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::OwnershipUnknown);
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn open_not_logged_in() {
    let env = Env::signed_in();
    env.signer.as_ref().unwrap().set(None);
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::NotLoggedIn);
    assert!(env.fake.calls().is_empty());
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn open_verdict_table() {
    #[derive(Clone, Copy)]
    enum Setup {
        Plain,
        Delegate,
        Admin,
    }
    // (이름, 로그인 빌드인가, 설정, 컨텐츠 채널, 열려야 하는가)
    let cases = [
        ("own", true, Setup::Plain, Some(ME), true),
        ("delegated", true, Setup::Delegate, Some(OTHER_CH), true),
        ("adminOverride", true, Setup::Admin, Some(OTHER_CH), true),
        (
            "unchecked(auth 없음)",
            false,
            Setup::Plain,
            Some(OTHER_CH),
            true,
        ),
        ("notOwn", true, Setup::Plain, Some(OTHER_CH), false),
        ("unknown", true, Setup::Plain, None, false),
    ];
    for (name, auth, setup, channel, opens) in cases {
        let env = if auth {
            Env::signed_in()
        } else {
            Env::disabled()
        };
        if let Some(sg) = &env.signer {
            match setup {
                Setup::Plain => {}
                Setup::Delegate => sg.edit(|s| s.delegated = Arc::from(vec![OTHER_CH.to_string()])),
                Setup::Admin => sg.edit(|s| s.is_admin = true),
            }
        }
        if auth {
            // 게이트 fetch resolve + 열기 resolve
            env.fake.push_resolve(Ok(pd("a", channel)));
        }
        env.fake.push_resolve(Ok(pd("a", channel)));
        env.fake.push_range(RangeStep::ok(chunk(0, 0, TOTAL)));
        let r = env.svc.open(VIDEO_URL, &content()).await;
        assert_eq!(r.is_ok(), opens, "{name}: {r:?}");
        assert_eq!(env.svc.has_session(), opens, "{name}");
    }
}

#[tokio::test]
async fn open_passes_recheck() {
    let env = Env::signed_in();
    // 남의 채널로 보이지만 확인하는 사이 위임이 생긴다(받기와 같은 결과)
    let signer = env.signer.clone().unwrap();
    *env.hook.lock().unwrap() = Some(Box::new(move || {
        signer.edit(|s| s.delegated = Arc::from(vec![OTHER_CH.to_string()]))
    }));
    env.fake.push_resolve(Ok(pd("a", Some(OTHER_CH)))); // fetch
    env.fake.push_resolve(Ok(pd("a", Some(OTHER_CH)))); // 열기
    env.fake.push_range(RangeStep::ok(chunk(0, 0, TOTAL)));
    env.svc
        .open(VIDEO_URL, &content())
        .await
        .expect("열려야 한다");
    assert_eq!(env.rechecks.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn auth_disabled_open_and_handle_skip_login_checks() {
    let env = Env::disabled();
    let id = env.open("a").await;
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    let r = env.get(&id, "/v", Some("bytes=0-9")).await;
    assert_eq!(status(&r), 206);
}

#[tokio::test]
async fn open_rejects_live() {
    let env = Env::disabled();
    env.fake.push_resolve(Ok(resolved_with(
        Source::Live {
            master_url: pd_url("live"),
            tracks: vec![quality("720p", Some(720), false)],
            live_id: 1,
        },
        Some(ME),
    )));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert!(env.fake.range_calls().is_empty());

    // 생방송 주소는 resolve 전에 거부한다
    let env = Env::disabled();
    let live = ContentRef::Live {
        channel_id: ME.into(),
    };
    let err = env
        .svc
        .open(&format!("https://chzzk.naver.com/live/{ME}"), &live)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert!(env.fake.calls().is_empty());
}

#[tokio::test]
async fn open_probes_total_once() {
    let env = Env::disabled();
    env.script_open(pd("a", Some(ME)), TOTAL);
    env.open_script_ready().await;
    let calls = env.fake.range_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        (calls[0].start, calls[0].end_incl, calls[0].expect_total),
        (0, 0, None)
    );

    // 서버가 Range를 무시하면 unsupported, 세션 없음
    let env = Env::disabled();
    env.fake.push_resolve(Ok(pd("a", Some(ME))));
    env.fake
        .push_range(RangeStep::fail(WatchFail::RangeIgnored));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Unsupported);
    assert!(!env.svc.has_session());

    // 416도 같다
    let env = Env::disabled();
    env.fake.push_resolve(Ok(pd("a", Some(ME))));
    env.fake
        .push_range(RangeStep::fail(WatchFail::Unsatisfiable { total: 0 }));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Unsupported);

    // 403은 받기와 같은 변환(미디어 HTTP 403)
    let env = Env::disabled();
    env.fake.push_resolve(Ok(pd("a", Some(ME))));
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Http);
    assert!(!env.svc.has_session());

    // 네트워크 오류도 그대로 올라간다
    let env = Env::disabled();
    env.fake.push_resolve(Ok(pd("a", Some(ME))));
    env.fake
        .push_range(RangeStep::fail(WatchFail::Fatal(Error::HttpStatus {
            status: 404,
            kind: chzzk_core::RequestKind::Media,
        })));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Http);
}

#[tokio::test]
async fn open_picks_lowest_video_not_audio() {
    let env = Env::disabled();
    env.fake.push_resolve(Ok(resolved_pd(
        &[
            ("PD_720P", Some(720), false, "q720"),
            ("PD_AUDIO", None, true, "audio"),
            ("PD_360P", Some(360), false, "q360"),
            ("PD_480P", Some(480), false, "q480"),
        ],
        Some(ME),
    )));
    env.fake.push_range(RangeStep::ok(chunk(0, 0, TOTAL)));
    env.open_script_ready().await;
    let url = &env.fake.range_calls()[0].url;
    assert!(url.contains("q360.mp4"), "{url}");
}

#[tokio::test]
async fn open_with_only_audio_rows_is_invalid() {
    let env = Env::disabled();
    env.fake.push_resolve(Ok(resolved_pd(
        &[("PD_AUDIO", None, true, "audio")],
        Some(ME),
    )));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
}

#[tokio::test]
async fn open_returns_opaque_src() {
    let env = Env::disabled();
    env.script_open(pd("a", Some(ME)), TOTAL);
    let dto = env.svc.open(VIDEO_URL, &content()).await.unwrap();
    assert_eq!(dto.id.len(), 32);
    assert!(
        dto.id
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    );
    assert_eq!(dto.src, format!("watch://localhost/{}/v", dto.id));
    let json = serde_json::to_string(&dto).unwrap();
    assert!(
        !json.contains("hdnts") && !json.contains("media.example"),
        "{json}"
    );
    assert_eq!(
        serde_json::to_value(&dto).unwrap()["kind"],
        serde_json::json!("mp4")
    );
}

#[tokio::test]
async fn second_open_replaces_first() {
    let env = Env::disabled();
    let first = env.open("a").await;
    let second = env.open("b").await;
    assert_ne!(first, second);
    assert_eq!(status(&env.get(&first, "/v", None).await), 404);
    env.fake.push_range(RangeStep::ok(chunk(0, 99, TOTAL)));
    assert_eq!(status(&env.get(&second, "/v", None).await), 206);
}

#[tokio::test]
async fn close_is_idempotent() {
    let env = Env::disabled();
    let id = env.open("a").await;
    env.svc.close(&id);
    env.svc.close(&id);
    env.svc.close("not-an-id");
    assert!(!env.svc.has_session());
    assert_eq!(status(&env.get(&id, "/v", None).await), 404);
}

#[tokio::test]
async fn close_other_id_keeps_session() {
    let env = Env::disabled();
    let id = env.open("a").await;
    env.svc.close(&"0".repeat(32));
    assert!(env.svc.has_session());
    env.fake.push_range(RangeStep::ok(chunk(0, 99, TOTAL)));
    assert_eq!(status(&env.get(&id, "/v", None).await), 206);
}

// ── handle: 경로·거부 ────────────────────────────────────

#[tokio::test]
async fn handle_unknown_session_404() {
    let env = Env::disabled();
    assert_eq!(status(&env.get(&"0".repeat(32), "/v", None).await), 404);
    // 세션이 있어도 다른 ID는 404
    let id = env.open("a").await;
    assert_ne!(id, "f".repeat(32));
    assert_eq!(status(&env.get(&"f".repeat(32), "/v", None).await), 404);
}

#[tokio::test]
async fn handle_bad_path_404() {
    let env = Env::disabled();
    let id = env.open("a").await;
    let upper = id.to_uppercase();
    let long = format!("{id}0");
    let short = &id[..31];
    let cases = [
        format!("watch://localhost/{id}/v/x"),
        "watch://localhost/../v".to_string(),
        format!("watch://localhost/{id}/s/01"),
        format!("watch://localhost/{id}/s/0"),
        format!("watch://localhost/{id}"),
        format!("watch://localhost/{upper}/v"),
        format!("watch://localhost/{long}/v"),
        format!("watch://localhost/{short}/v"),
        format!("watch://localhost/{id}/other"),
        "watch://localhost/".to_string(),
    ];
    for uri in cases {
        let req = http::Request::builder().uri(&uri).body(Vec::new()).unwrap();
        let r = env
            .svc
            .handle(
                &req,
                ReqCtx {
                    webview_label: "main",
                },
            )
            .await;
        assert_eq!(status(&r), 404, "{uri}");
    }
    // 여전히 쓸 수 있다
    env.fake.push_range(RangeStep::ok(chunk(0, 99, TOTAL)));
    assert_eq!(status(&env.get(&id, "/v", None).await), 206);
}

#[tokio::test]
async fn handle_ignores_query() {
    let env = Env::disabled();
    let id = env.open("a").await;
    env.fake.push_range(RangeStep::ok(chunk(0, 99, TOTAL)));
    let r = env.get(&id, "/v?x=1&hdnts=zzz", None).await;
    assert_eq!(status(&r), 206);
    // 업스트림 주소는 세션의 것이다
    let last = env.fake.range_calls().pop().unwrap();
    assert!(!last.url.contains("zzz"), "{}", last.url);
}

#[tokio::test]
async fn handle_wrong_webview_403() {
    let env = Env::disabled();
    let id = env.open("a").await;
    let r = env
        .send(http::Method::GET, &id, "/v", None, None, "other")
        .await;
    assert_eq!(status(&r), 403);
    // 세션은 그대로다
    env.fake.push_range(RangeStep::ok(chunk(0, 99, TOTAL)));
    assert_eq!(status(&env.get(&id, "/v", None).await), 206);
}

#[tokio::test]
async fn handle_foreign_origin_403_without_acao() {
    let env = Env::disabled();
    let id = env.open("a").await;
    let r = env
        .send(
            http::Method::GET,
            &id,
            "/v",
            None,
            Some("https://evil.example"),
            "main",
        )
        .await;
    assert_eq!(status(&r), 403);
    assert!(header(&r, "access-control-allow-origin").is_none());
    // 앱 출처는 통과하고 ACAO가 그 값이다
    env.fake.push_range(RangeStep::ok(chunk(0, 99, TOTAL)));
    let r = env
        .send(http::Method::GET, &id, "/v", None, Some(APP_ORIGIN), "main")
        .await;
    assert_eq!(status(&r), 206);
    assert_eq!(header(&r, "access-control-allow-origin"), Some(APP_ORIGIN));
}

#[tokio::test]
async fn handle_logged_out_403_and_drops() {
    let env = Env::signed_in();
    let id = env.open("a").await;
    env.signer.as_ref().unwrap().set(None);
    assert_eq!(status(&env.get(&id, "/v", None).await), 403);
    // 다시 로그인해도 세션은 이미 버려졌다
    env.signer.as_ref().unwrap().set(Some(ME));
    assert_eq!(status(&env.get(&id, "/v", None).await), 404);
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn handle_channel_switched_403() {
    let env = Env::signed_in();
    let id = env.open("a").await;
    env.signer.as_ref().unwrap().set(Some(OTHER_CH));
    assert_eq!(status(&env.get(&id, "/v", None).await), 403);
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn handle_non_get_405() {
    let env = Env::disabled();
    let id = env.open("a").await;
    for m in [http::Method::POST, http::Method::PUT, http::Method::DELETE] {
        let r = env.send(m, &id, "/v", None, None, "main").await;
        assert_eq!(status(&r), 405);
    }
    let r = env
        .send(http::Method::HEAD, &id, "/pl.m3u8", None, None, "main")
        .await;
    assert_eq!(status(&r), 405);
}

// ── handle: Range ────────────────────────────────────────

/// total이 `total`인 세션을 연다.
async fn open_total(env: &Env, total: u64) -> String {
    env.script_open(pd("a", Some(ME)), total);
    env.open_script_ready().await
}

#[tokio::test]
async fn range_open_ended_clamped_to_chunk() {
    let env = Env::disabled();
    let total = CHUNK * 5;
    let id = open_total(&env, total).await;
    env.fake
        .push_range(RangeStep::ok(chunk(0, CHUNK - 1, total)));
    let r = env.get(&id, "/v", Some("bytes=0-")).await;
    assert_eq!(status(&r), 206);
    let last = env.fake.range_calls().pop().unwrap();
    assert_eq!(
        (last.start, last.end_incl, last.expect_total),
        (0, CHUNK - 1, Some(total))
    );
    assert_eq!(
        header(&r, "content-range"),
        Some(format!("bytes 0-{}/{total}", CHUNK - 1).as_str())
    );
    assert_eq!(r.body().len() as u64, CHUNK);
}

#[tokio::test]
async fn range_end_clamped_to_total() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    env.fake.push_range(RangeStep::ok(chunk(90, 99, TOTAL)));
    let r = env.get(&id, "/v", Some("bytes=90-200")).await;
    assert_eq!(status(&r), 206);
    let last = env.fake.range_calls().pop().unwrap();
    assert_eq!((last.start, last.end_incl), (90, 99));
}

#[tokio::test]
async fn range_start_at_total_416() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    let r = env.get(&id, "/v", Some("bytes=100-")).await;
    assert_eq!(status(&r), 416);
    assert_eq!(header(&r, "content-range"), Some("bytes */100"));
    assert_eq!(env.fake.range_calls().len(), 1, "탐색 하나뿐이다");
}

#[tokio::test]
async fn range_suffix_maps_to_tail() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    env.fake.push_range(RangeStep::ok(chunk(90, 99, TOTAL)));
    let r = env.get(&id, "/v", Some("bytes=-10")).await;
    assert_eq!(status(&r), 206);
    let last = env.fake.range_calls().pop().unwrap();
    assert_eq!((last.start, last.end_incl), (90, 99));

    // 길이보다 큰 접미사는 처음부터
    env.fake.push_range(RangeStep::ok(chunk(0, 99, TOTAL)));
    let r = env.get(&id, "/v", Some("bytes=-500")).await;
    assert_eq!(status(&r), 206);
    let last = env.fake.range_calls().pop().unwrap();
    assert_eq!((last.start, last.end_incl), (0, 99));
}

#[tokio::test]
async fn range_multi_uses_first() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    env.fake.push_range(RangeStep::ok(chunk(0, 1, TOTAL)));
    let r = env.get(&id, "/v", Some("bytes=0-1,5-6")).await;
    assert_eq!(status(&r), 206);
    let last = env.fake.range_calls().pop().unwrap();
    assert_eq!((last.start, last.end_incl), (0, 1));
    assert_eq!(r.body().len(), 2);
}

#[tokio::test]
async fn range_invalid_forms_416() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    for h in [
        "bytes=5-3",
        "bytes=-0",
        "bytes=abc",
        "bytes=-",
        "bytes=",
        "items=0-1",
        "bytes=1-2-3",
    ] {
        let r = env.get(&id, "/v", Some(h)).await;
        assert_eq!(status(&r), 416, "{h}");
        assert_eq!(header(&r, "content-range"), Some("bytes */100"), "{h}");
    }
    assert_eq!(env.fake.range_calls().len(), 1, "업스트림을 부르지 않는다");
}

#[tokio::test]
async fn range_non_ascii_header_416() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    let req = http::Request::builder()
        .uri(format!("watch://localhost/{id}/v"))
        .header(
            "range",
            http::HeaderValue::from_bytes(b"bytes=0-\x80").unwrap(),
        )
        .body(Vec::new())
        .unwrap();
    let r = env
        .svc
        .handle(
            &req,
            ReqCtx {
                webview_label: "main",
            },
        )
        .await;
    assert_eq!(status(&r), 416);
    assert_eq!(header(&r, "content-range"), Some("bytes */100"));
    assert_eq!(env.fake.range_calls().len(), 1, "업스트림을 부르지 않는다");
}

#[tokio::test]
async fn range_missing_treated_as_zero() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    env.fake.push_range(RangeStep::ok(chunk(0, 99, TOTAL)));
    let r = env.get(&id, "/v", None).await;
    assert_eq!(status(&r), 206);
    let last = env.fake.range_calls().pop().unwrap();
    assert_eq!((last.start, last.end_incl), (0, 99));
}

#[tokio::test]
async fn head_v_answers_from_session_total() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    let r = env
        .send(http::Method::HEAD, &id, "/v", None, None, "main")
        .await;
    assert_eq!(status(&r), 200);
    assert_eq!(header(&r, "content-length"), Some("100"));
    assert_eq!(header(&r, "accept-ranges"), Some("bytes"));
    assert_eq!(header(&r, "content-type"), Some("video/mp4"));
    assert!(r.body().is_empty());
    assert_eq!(env.fake.range_calls().len(), 1, "업스트림 호출 0회");
}

#[tokio::test]
async fn upstream_short_206_relayed_as_is() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    env.fake.push_range(RangeStep::ok(chunk(0, 4, TOTAL)));
    let r = env.get(&id, "/v", Some("bytes=0-9")).await;
    assert_eq!(status(&r), 206);
    assert_eq!(header(&r, "content-range"), Some("bytes 0-4/100"));
    assert_eq!(header(&r, "content-length"), Some("5"));
    assert_eq!(r.body().len(), 5);
    assert_eq!(header(&r, "content-type"), Some("video/mp4"));
    assert_eq!(header(&r, "accept-ranges"), Some("bytes"));
}

#[tokio::test]
async fn total_changed_without_refresh_409_and_drops() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    // 코어가 SourceChanged를 낸 경우
    env.fake
        .push_range(RangeStep::fail(WatchFail::SourceChanged));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 409);
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 404);

    // 코어가 대조하지 못한 채 total이 다른 조각이 와도 셸이 막는다
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    env.fake.push_range(RangeStep::ok(chunk(0, 9, 200)));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 409);
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn upstream_early_eof_502_keeps_session() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    env.fake
        .push_range(RangeStep::fail(WatchFail::Retry(Error::Parse {
            what: "t",
            detail: "eof".into(),
        })));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 502);
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 206);
}

#[tokio::test]
async fn upstream_other_failures_502() {
    for f in [
        WatchFail::RangeIgnored,
        WatchFail::TooLarge,
        WatchFail::Fatal(Error::Cancelled),
        WatchFail::Unsatisfiable { total: TOTAL },
    ] {
        let env = Env::disabled();
        let id = open_total(&env, TOTAL).await;
        env.fake.push_range(RangeStep::fail(f));
        assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 502);
        assert!(env.svc.has_session());
    }
}

// ── 403 재조회 ───────────────────────────────────────────

#[tokio::test]
async fn expired_refresh_then_retry_ok() {
    let env = Env::signed_in();
    // 위임 판정은 확인 대상이라 열기와 재조회 둘 다 recheck를 거친다
    env.signer
        .as_ref()
        .unwrap()
        .edit(|s| s.delegated = Arc::from(vec![OTHER_CH.to_string()]));
    env.fake.push_resolve(Ok(pd("old", Some(OTHER_CH)))); // fetch
    env.fake.push_resolve(Ok(pd("old", Some(OTHER_CH)))); // 열기
    env.fake.push_range(RangeStep::ok(chunk(0, 0, TOTAL)));
    let id = env.open_script_ready().await;
    assert_eq!(env.rechecks.load(Ordering::SeqCst), 1);

    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Ok(pd("new", Some(OTHER_CH))));
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    let r = env.get(&id, "/v", Some("bytes=0-9")).await;
    assert_eq!(status(&r), 206);
    let calls = env.fake.range_calls();
    assert!(calls[1].url.contains("old.mp4"));
    assert!(calls[2].url.contains("new.mp4"), "{}", calls[2].url);
    assert_eq!(
        (calls[2].start, calls[2].end_incl, calls[2].expect_total),
        (0, 9, Some(TOTAL))
    );
    assert_eq!(env.rechecks.load(Ordering::SeqCst), 2, "재조회 뒤 재판정");
    // 새 주소가 세션에 남는다
    env.fake.push_range(RangeStep::ok(chunk(10, 19, TOTAL)));
    env.get(&id, "/v", Some("bytes=10-19")).await;
    assert!(
        env.fake
            .range_calls()
            .pop()
            .unwrap()
            .url
            .contains("new.mp4")
    );
}

#[tokio::test]
async fn refresh_reselects_same_quality_id() {
    let env = Env::disabled();
    env.fake.push_resolve(Ok(resolved_pd(
        &[
            ("PD_720P", Some(720), false, "o720"),
            ("PD_360P", Some(360), false, "o360"),
        ],
        Some(ME),
    )));
    env.fake.push_range(RangeStep::ok(chunk(0, 0, TOTAL)));
    let id = env.open_script_ready().await;
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    // 재조회 결과는 순서가 달라도 같은 quality_id를 고른다
    env.fake.push_resolve(Ok(resolved_pd(
        &[
            ("PD_720P", Some(720), false, "n720"),
            ("PD_360P", Some(360), false, "n360"),
        ],
        Some(ME),
    )));
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 206);
    assert!(
        env.fake
            .range_calls()
            .pop()
            .unwrap()
            .url
            .contains("n360.mp4")
    );
}

#[tokio::test]
async fn expired_twice_403() {
    let env = Env::disabled();
    let id = env.open("old").await;
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Ok(pd("new", Some(ME))));
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 403);
    assert_eq!(env.fake.resolve_count(), 2, "재조회는 한 번뿐");
    // 세션은 남는다
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 206);
}

#[tokio::test]
async fn refresh_total_changed_409_and_drops() {
    let env = Env::disabled();
    let id = env.open("old").await;
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Ok(pd("new", Some(ME))));
    env.fake.push_range(RangeStep::ok(chunk(0, 9, 200)));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 409);
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 404);
}

#[tokio::test]
async fn refresh_playback_changed_409_and_drops() {
    // 방식이 바뀌었다
    let env = Env::disabled();
    let id = env.open("old").await;
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Ok(resolved_with(
        Source::LiveRewindHls {
            master_url: pd_url("m"),
            tracks: vec![quality("PD_720P", Some(720), false)],
        },
        Some(ME),
    )));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 409);
    assert!(!env.svc.has_session());

    // 같은 quality_id가 사라졌다
    let env = Env::disabled();
    let id = env.open("old").await;
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Ok(resolved_pd(
        &[("PD_1080P", Some(1080), false, "x")],
        Some(ME),
    )));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 409);
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn refresh_resolve_failure_502_keeps_session() {
    let env = Env::disabled();
    let id = env.open("old").await;
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Err(Error::Cancelled));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 502);
    assert!(env.svc.has_session());
}

#[tokio::test]
async fn refresh_limit_8() {
    let env = Env::disabled();
    let id = env.open("t0").await;
    for i in 1..=8 {
        env.fake.push_range(RangeStep::fail(WatchFail::Expired));
        env.fake.push_resolve(Ok(pd(&format!("t{i}"), Some(ME))));
        env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
        assert_eq!(
            status(&env.get(&id, "/v", Some("bytes=0-9")).await),
            206,
            "{i}"
        );
    }
    let resolves = env.fake.resolve_count();
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 403);
    assert_eq!(
        env.fake.resolve_count(),
        resolves,
        "9번째는 resolve하지 않는다"
    );
}

#[tokio::test]
async fn refresh_limit_counts_failed_resolves() {
    let env = Env::disabled();
    let id = env.open("t0").await;
    // resolve가 계속 실패해도 시도 수로 센다: 8번 502, 9번째는 resolve 없이 403
    for i in 1..=8 {
        env.fake.push_range(RangeStep::fail(WatchFail::Expired));
        env.fake.push_resolve(Err(Error::Cancelled));
        assert_eq!(
            status(&env.get(&id, "/v", Some("bytes=0-9")).await),
            502,
            "{i}"
        );
    }
    let resolves = env.fake.resolve_count();
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 403);
    assert_eq!(
        env.fake.resolve_count(),
        resolves,
        "9번째는 resolve하지 않는다"
    );
    assert!(env.svc.has_session(), "상한은 이 요청만 막는다");
}

#[tokio::test]
async fn concurrent_expired_single_refresh() {
    let env = Env::disabled();
    let id = env.open("old").await;
    let (s1, s2) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
    let (rs, rr) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
    env.fake
        .push_range(RangeStep::fail(WatchFail::Expired).started(s1.clone()));
    env.fake
        .push_range(RangeStep::fail(WatchFail::Expired).started(s2.clone()));
    env.fake
        .push_resolve_held(rs.clone(), rr.clone(), Ok(pd("new", Some(ME))));
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));

    let spawn = |svc: Arc<WatchService<FakeBackend>>, id: String| {
        tokio::spawn(async move {
            let req = http::Request::builder()
                .uri(format!("watch://localhost/{id}/v"))
                .header("range", "bytes=0-9")
                .body(Vec::new())
                .unwrap();
            svc.handle(
                &req,
                ReqCtx {
                    webview_label: "main",
                },
            )
            .await
        })
    };
    let a = spawn(env.svc.clone(), id.clone());
    let b = spawn(env.svc.clone(), id.clone());
    s1.notified().await;
    s2.notified().await;
    rs.notified().await;
    rr.notify_one();
    let (a, b) = (a.await.unwrap(), b.await.unwrap());
    assert_eq!((status(&a), status(&b)), (206, 206));
    assert_eq!(env.fake.resolve_count(), 2, "열기 + 재조회 한 번");
}

#[tokio::test]
async fn stale_403_after_refresh_no_resolve() {
    let env = Env::disabled();
    let id = env.open("old").await;
    let (bs, br) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
    // B: 옛 주소로 나가 붙들려 있다가 403
    env.fake.push_range(
        RangeStep::fail(WatchFail::Expired)
            .started(bs.clone())
            .hold(br.clone()),
    );
    // A: 403 → 재조회 → 재시도 성공
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Ok(pd("new", Some(ME))));
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    // B의 재시도
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));

    let svc = env.svc.clone();
    let b = {
        let id = id.clone();
        tokio::spawn(async move {
            let req = http::Request::builder()
                .uri(format!("watch://localhost/{id}/v"))
                .header("range", "bytes=0-9")
                .body(Vec::new())
                .unwrap();
            svc.handle(
                &req,
                ReqCtx {
                    webview_label: "main",
                },
            )
            .await
        })
    };
    bs.notified().await;
    let a = env.get(&id, "/v", Some("bytes=0-9")).await;
    assert_eq!(status(&a), 206);
    assert_eq!(env.fake.resolve_count(), 2);
    br.notify_one();
    let b = b.await.unwrap();
    assert_eq!(status(&b), 206);
    assert_eq!(env.fake.resolve_count(), 2, "B는 resolve하지 않는다");
    let last = env.fake.range_calls().pop().unwrap();
    assert!(last.url.contains("new.mp4"), "{}", last.url);
}

/// 재조회 중(resolve를 붙들어 둔다) `disturb`를 하고 풀면 결과를 쓰지 않고 그 요청은 404다.
async fn refresh_disturbed(env: &Env, id: &str, disturb: impl FnOnce()) -> http::Response<Vec<u8>> {
    let (rs, rr) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake
        .push_resolve_held(rs.clone(), rr.clone(), Ok(pd("new", Some(ME))));
    let svc = env.svc.clone();
    let id = id.to_string();
    let t = tokio::spawn(async move {
        let req = http::Request::builder()
            .uri(format!("watch://localhost/{id}/v"))
            .header("range", "bytes=0-9")
            .body(Vec::new())
            .unwrap();
        svc.handle(
            &req,
            ReqCtx {
                webview_label: "main",
            },
        )
        .await
    });
    rs.notified().await;
    disturb();
    rr.notify_one();
    t.await.unwrap()
}

#[tokio::test]
async fn refresh_result_dropped_on_close() {
    let env = Env::disabled();
    let id = env.open("old").await;
    let before = env.fake.range_calls().len();
    let svc = env.svc.clone();
    let idc = id.clone();
    let r = refresh_disturbed(&env, &id, move || svc.close(&idc)).await;
    assert_eq!(status(&r), 404);
    assert_eq!(env.fake.range_calls().len(), before + 1, "재시도 없음");
}

#[tokio::test]
async fn refresh_result_dropped_on_new_open() {
    let env = Env::disabled();
    let id = env.open("old").await;
    let svc = env.svc.clone();
    // 새 open은 resolve 대본을 뒤에 쌓는다: 붙들린 resolve는 이미 꺼내졌다
    let fake = env.fake.clone();
    let new_id = Arc::new(Mutex::new(None::<String>));
    let slot = new_id.clone();
    let r = {
        let (rs, rr) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
        env.fake.push_range(RangeStep::fail(WatchFail::Expired));
        env.fake
            .push_resolve_held(rs.clone(), rr.clone(), Ok(pd("stale", Some(ME))));
        let svc2 = env.svc.clone();
        let idc = id.clone();
        let t = tokio::spawn(async move {
            let req = http::Request::builder()
                .uri(format!("watch://localhost/{idc}/v"))
                .header("range", "bytes=0-9")
                .body(Vec::new())
                .unwrap();
            svc2.handle(
                &req,
                ReqCtx {
                    webview_label: "main",
                },
            )
            .await
        });
        rs.notified().await;
        fake.push_resolve(Ok(pd("fresh", Some(ME))));
        fake.push_range(RangeStep::ok(chunk(0, 0, TOTAL)));
        let dto = svc.open(VIDEO_URL, &content()).await.unwrap();
        *slot.lock().unwrap() = Some(dto.id);
        rr.notify_one();
        t.await.unwrap()
    };
    assert_eq!(status(&r), 404);
    // 새 세션의 주소는 그대로다
    let new_id = new_id.lock().unwrap().clone().unwrap();
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    assert_eq!(
        status(&env.get(&new_id, "/v", Some("bytes=0-9")).await),
        206
    );
    let last = env.fake.range_calls().pop().unwrap();
    assert!(last.url.contains("fresh.mp4"), "{}", last.url);
}

#[tokio::test]
async fn refresh_result_dropped_on_sign_out() {
    let env = Env::disabled();
    let id = env.open("old").await;
    let svc = env.svc.clone();
    let r = refresh_disturbed(&env, &id, move || svc.on_signed_out()).await;
    assert_eq!(status(&r), 404);
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn refresh_result_dropped_on_real_sign_out() {
    let env = Env::signed_in();
    env.fake.push_resolve(Ok(pd("old", Some(ME)))); // fetch
    env.fake.push_resolve(Ok(pd("old", Some(ME)))); // 열기
    env.fake.push_range(RangeStep::ok(chunk(0, 0, TOTAL)));
    let id = env.open_script_ready().await;
    // 재조회 중에 로그아웃: signer가 사라져 판정이 not_logged_in이어도 404다
    let (svc, signer) = (env.svc.clone(), env.signer.clone().unwrap());
    let r = refresh_disturbed(&env, &id, move || {
        signer.set(None);
        svc.on_signed_out();
    })
    .await;
    assert_eq!(status(&r), 404);
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn refresh_gate_revoked_403() {
    let env = Env::signed_in();
    env.fake.push_resolve(Ok(pd("old", Some(ME)))); // fetch
    env.fake.push_resolve(Ok(pd("old", Some(ME)))); // 열기
    env.fake.push_range(RangeStep::ok(chunk(0, 0, TOTAL)));
    let id = env.open_script_ready().await;
    assert_eq!(env.rechecks.load(Ordering::SeqCst), 0);

    // 재조회해 보니 채널이 남의 것이다: 재판정에도 recheck가 넘어가고 막힌다
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Ok(pd("new", Some(OTHER_CH))));
    let r = env.get(&id, "/v", Some("bytes=0-9")).await;
    assert_eq!(status(&r), 403);
    assert_eq!(env.rechecks.load(Ordering::SeqCst), 1);
    assert_eq!(
        env.fake.range_calls().len(),
        2,
        "새 주소로 재시도하지 않는다"
    );
    assert!(!env.svc.has_session(), "막히면 세션을 버린다");
}

// ── 유휴·응답 머리·비밀값 ────────────────────────────────

#[tokio::test(start_paused = true)]
async fn idle_expired_404() {
    let env = Env::disabled();
    let id = env.open("a").await;
    tokio::time::advance(IDLE_TTL).await;
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    assert_eq!(
        status(&env.get(&id, "/v", Some("bytes=0-9")).await),
        206,
        "정확히 10분은 아직 유효하다"
    );
    // 마지막 요청부터 다시 센다
    tokio::time::advance(IDLE_TTL - Duration::from_secs(1)).await;
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 206);
    tokio::time::advance(IDLE_TTL + Duration::from_secs(1)).await;
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 404);
    assert!(!env.svc.has_session(), "만료된 세션은 버린다");
}

#[tokio::test]
async fn responses_have_acao_vary_nostore() {
    let env = Env::disabled();
    let id = open_total(&env, TOTAL).await;
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    let mut all = vec![
        env.get(&id, "/v", Some("bytes=0-9")).await,
        env.get(&id, "/v", Some("bytes=100-")).await,
        env.get(&id, "/nope", None).await,
        env.get(&"0".repeat(32), "/v", None).await,
        env.send(http::Method::HEAD, &id, "/v", None, None, "main")
            .await,
        env.send(http::Method::POST, &id, "/v", None, None, "main")
            .await,
    ];
    all.push(env.get(&id, "/v", Some("bytes=5-3")).await);
    assert_eq!(
        all.iter().map(status).collect::<Vec<_>>(),
        [206, 416, 404, 404, 200, 405, 416]
    );
    for r in &all {
        assert_eq!(header(r, "access-control-allow-origin"), Some(APP_ORIGIN));
        assert_eq!(header(r, "vary"), Some("Origin"));
        assert_eq!(header(r, "cache-control"), Some("no-store"));
    }
}

#[tokio::test]
async fn endpoints_are_configurable() {
    let env = Env::disabled();
    env.svc
        .set_endpoints("http://watch.localhost", "http://tauri.localhost");
    let dto = {
        env.script_open(pd("a", Some(ME)), TOTAL);
        env.svc.open(VIDEO_URL, &content()).await.unwrap()
    };
    assert_eq!(dto.src, format!("http://watch.localhost/{}/v", dto.id));
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    let r = env.get(&dto.id, "/v", Some("bytes=0-9")).await;
    assert_eq!(
        header(&r, "access-control-allow-origin"),
        Some("http://tauri.localhost")
    );
    // 옛 기본 출처는 이제 외부 출처다
    let r = env
        .send(
            http::Method::GET,
            &dto.id,
            "/v",
            None,
            Some(APP_ORIGIN),
            "main",
        )
        .await;
    assert_eq!(status(&r), 403);
}

/// 로그를 문자열로 모으는 writer
#[derive(Clone, Default)]
struct LogBuf(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for LogBuf {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for LogBuf {
    type Writer = LogBuf;

    fn make_writer(&'a self) -> LogBuf {
        self.clone()
    }
}

#[tokio::test]
async fn misaligned_chunk_409_drops_session() {
    // 요청 bytes=0-9에 어긋난 조각: 시작이 다르다 / 끝이 요청을 넘는다 / 본문 길이가 다르다
    let short_body = RangeChunk {
        body: vec![7; 5],
        ..chunk(0, 9, TOTAL)
    };
    for (name, bad) in [
        ("start", chunk(1, 9, TOTAL)),
        ("end", chunk(0, 19, TOTAL)),
        ("len", short_body),
    ] {
        let env = Env::disabled();
        let id = env.open("t").await;
        env.fake.push_range(RangeStep::ok(bad));
        let r = env.get(&id, "/v", Some("bytes=0-9")).await;
        assert_eq!(status(&r), 409, "{name}");
        assert!(!env.svc.has_session(), "{name}");
    }
}

#[tokio::test]
async fn responses_carry_no_secret() {
    let env = Env::disabled();
    let id = env.open("leak").await;
    let mut all = Vec::new();
    // 206
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    all.push(("206", env.get(&id, "/v", Some("bytes=0-9")).await));
    // 416
    all.push(("416", env.get(&id, "/v", Some("bytes=500-")).await));
    // HEAD
    all.push((
        "head",
        env.send(http::Method::HEAD, &id, "/v", None, None, "main")
            .await,
    ));
    // 403(다른 웹뷰)
    all.push((
        "403",
        env.send(http::Method::GET, &id, "/v", None, None, "other")
            .await,
    ));
    // 409
    env.fake
        .push_range(RangeStep::fail(WatchFail::SourceChanged));
    all.push(("409", env.get(&id, "/v", Some("bytes=0-9")).await));
    for (name, r) in &all {
        let mut text = String::from_utf8_lossy(r.body()).into_owned();
        for (k, v) in r.headers() {
            text.push_str(k.as_str());
            text.push_str(&String::from_utf8_lossy(v.as_bytes()));
        }
        for needle in ["SIGNEDSECRET", "hdnts", "hdntl", "exp=", "media.example"] {
            assert!(!text.contains(needle), "{name}: {needle}");
        }
    }
}

#[tokio::test]
async fn debug_and_logs_have_no_secret() {
    use tracing_subscriber::Layer;
    use tracing_subscriber::layer::SubscriberExt;

    let buf = LogBuf::default();
    let layer = tracing_subscriber::fmt::layer()
        .with_writer(buf.clone())
        .with_ansi(false)
        .with_filter(tracing_subscriber::filter::LevelFilter::DEBUG);
    let sub = tracing_subscriber::registry().with(layer);
    // current_thread 런타임이라 이 스레드의 기본 subscriber가 모든 await를 덮는다
    let _guard = tracing::subscriber::set_default(sub);

    let env = Env::disabled();
    let id = env.open("leak").await;
    env.fake.push_range(RangeStep::fail(WatchFail::Expired));
    env.fake.push_resolve(Ok(pd("leak2", Some(ME))));
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 206);
    env.fake
        .push_range(RangeStep::fail(WatchFail::SourceChanged));
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 409);

    let logs = String::from_utf8(buf.0.lock().unwrap().clone()).unwrap();
    assert!(!logs.is_empty(), "로그가 잡혀야 대조가 의미 있다");
    assert!(
        !logs.contains("SIGNEDSECRET") && !logs.contains("hdnts"),
        "{logs}"
    );
    assert!(!logs.contains(&id), "전체 ID는 로그에 없다: {logs}");

    // 열린 세션의 Debug
    let env = Env::disabled();
    let id = env.open("leak3").await;
    let dbg = format!("{:?}", env.svc);
    assert!(
        !dbg.contains("SIGNEDSECRET") && !dbg.contains("hdnts"),
        "{dbg}"
    );
    assert!(!dbg.contains(&id), "{dbg}");
    assert!(dbg.contains(&id[..4]), "{dbg}");
}

#[tokio::test]
async fn kind_mismatch_paths_are_404() {
    // mp4 세션에 HLS 경로는 PV-5 전에도 404다
    let env = Env::disabled();
    let id = env.open("a").await;
    for p in ["/pl.m3u8", "/init", "/s/0", "/s/12"] {
        assert_eq!(status(&env.get(&id, p, None).await), 404, "{p}");
    }
}

// ── PV-5: 빠른 다시보기 HLS ────────────────────────────────

/// 합성 fixture(`testdata/hls/`)를 바이트 그대로 읽는다.
fn hls_fixture(name: &str) -> Vec<u8> {
    let p = format!("{}/../../testdata/hls/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

fn hls_resolved(channel: Option<&str>) -> Resolved {
    resolved_with(
        Source::LiveRewindHls {
            master_url: Url::parse(
                "https://media.example.invalid/hls/master.m3u8?hdntl=SIGNEDSECRET_m",
            )
            .unwrap(),
            // 일부러 높은 화질을 앞에 둔다: 가장 낮은 것은 144p(fixture의 media playlist)
            tracks: vec![
                quality("1080p", Some(1080), false),
                quality("720p", Some(720), false),
                quality("144p", Some(144), false),
            ],
        },
        channel,
    )
}

impl Env {
    /// HLS 열기 대본: resolve 하나 + master + media(바이트 그대로)
    fn script_hls_open(&self, media: Vec<u8>) {
        self.fake.push_resolve(Ok(hls_resolved(Some(ME))));
        self.fake.push_bytes(Ok(hls_fixture("master.m3u8")));
        self.fake.push_bytes(Ok(media));
    }

    async fn open_hls(&self) -> String {
        self.script_hls_open(hls_fixture("media.m3u8"));
        self.open_script_ready().await
    }
}

#[tokio::test]
async fn hls_open_ok() {
    // 옛 `open_rejects_hls_until_pv5`: 이제 열린다
    let env = Env::disabled();
    env.script_hls_open(hls_fixture("media.m3u8"));
    let dto = env.svc.open(VIDEO_URL, &content()).await.unwrap();
    assert_eq!(dto.kind, WatchKindDto::Hls);
    assert_eq!(dto.src, format!("watch://localhost/{}/pl.m3u8", dto.id));
    assert!(env.svc.has_session());
    // 열기에서 total 탐색(watch_range)은 없다
    assert!(env.fake.range_calls().is_empty());
}

#[tokio::test]
async fn hls_open_builds_session_from_fixture() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    let r = env.get(&id, "/pl.m3u8", None).await;
    assert_eq!(status(&r), 200);
    assert_eq!(
        header(&r, "content-type"),
        Some("application/vnd.apple.mpegurl")
    );
    assert_eq!(header(&r, "cache-control"), Some("no-store"));
    assert_eq!(header(&r, "access-control-allow-origin"), Some(APP_ORIGIN));
    let text = String::from_utf8(r.body().clone()).unwrap();
    assert!(text.starts_with("#EXTM3U\n#EXT-X-VERSION:7\n"), "{text}");
    assert!(text.contains("#EXT-X-MAP:URI=\"init\"\n"));
    assert_eq!(text.matches("#EXTINF:2.000,\n").count(), 30);
    assert!(text.contains("\ns/0\n") && text.contains("\ns/29\n"));
    assert!(!text.contains("s/30"));
    assert!(text.ends_with("#EXT-X-ENDLIST\n"));
    // 서명 주소·원래 파일 이름은 한 글자도 나가지 않는다
    for needle in [
        "SIGNED",
        "hdntl",
        "media.example",
        "seg0.m4v",
        "m4s",
        "http",
    ] {
        assert!(!text.contains(needle), "{needle}\n{text}");
    }
}

#[tokio::test]
async fn hls_open_picks_lowest_quality_variant() {
    // 가짜 백엔드는 주소를 보지 않으므로, 고른 화질은 세션이 들고 있는 이름으로 확인한다:
    // 재조회가 같은 화질(144p)을 다시 고르지 못하면 409가 된다(tracks에 144p가 없으면 QualityNotFound)
    let env = Env::disabled();
    let id = env.open_hls().await;
    env.fake.push_bytes(Err(WatchFail::Expired));
    env.fake.push_resolve(Ok(hls_resolved(Some(ME))));
    env.fake.push_bytes(Ok(hls_fixture("master.m3u8")));
    env.fake.push_bytes(Ok(hls_fixture("media.m3u8")));
    env.fake.push_bytes(Ok(vec![1, 2, 3]));
    let r = env.get(&id, "/s/0", None).await;
    assert_eq!(status(&r), 200, "{}", String::from_utf8_lossy(r.body()));
}

#[tokio::test]
async fn hls_open_rejects_what_download_rejects() {
    let media = String::from_utf8(hls_fixture("media.m3u8")).unwrap();
    let broken = [
        (
            "discontinuity",
            media.replacen("#EXTINF", "#EXT-X-DISCONTINUITY\n#EXTINF", 1),
        ),
        ("noEndlist", media.replace("#EXT-X-ENDLIST\n", "")),
        ("noMap", {
            let mut out = String::new();
            for l in media.lines().filter(|l| !l.starts_with("#EXT-X-MAP")) {
                out.push_str(l);
                out.push('\n');
            }
            out
        }),
        ("empty", String::new()),
    ];
    for (name, text) in broken {
        let env = Env::disabled();
        env.script_hls_open(text.into_bytes());
        let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
        assert!(!env.svc.has_session(), "{name}");
        assert_ne!(err.code, ErrorCode::Internal, "{name}: {}", err.message);
    }
    // 이전 세션이 있으면 실패한 열기는 그것을 건드리지 않는다
    let env = Env::disabled();
    let old = env.open("keep").await;
    env.script_hls_open(b"#EXTM3U\n".to_vec());
    assert!(env.svc.open(VIDEO_URL, &content()).await.is_err());
    env.fake.push_range(RangeStep::ok(chunk(0, 9, TOTAL)));
    assert_eq!(status(&env.get(&old, "/v", Some("bytes=0-9")).await), 206);
}

#[tokio::test]
async fn hls_open_failures_map_like_download() {
    // master 받기 403은 받기와 같은 미디어 HTTP 오류
    let env = Env::disabled();
    env.fake.push_resolve(Ok(hls_resolved(Some(ME))));
    env.fake.push_bytes(Err(WatchFail::Expired));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::Http);
    assert!(!env.svc.has_session());

    // tracks에 없는 화질(비디오가 하나도 없음)
    let env = Env::disabled();
    env.fake.push_resolve(Ok(resolved_with(
        Source::LiveRewindHls {
            master_url: pd_url("m"),
            tracks: vec![quality("audio", None, true)],
        },
        Some(ME),
    )));
    let err = env.svc.open(VIDEO_URL, &content()).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);

    // master에 고른 화질이 없음
    let env = Env::disabled();
    env.fake.push_resolve(Ok(resolved_with(
        Source::LiveRewindHls {
            master_url: pd_url("m"),
            tracks: vec![quality("2160p", Some(2160), false)],
        },
        Some(ME),
    )));
    env.fake.push_bytes(Ok(hls_fixture("master.m3u8")));
    assert!(env.svc.open(VIDEO_URL, &content()).await.is_err());
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn hls_init_and_segment_bodies() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    env.fake.push_bytes(Ok(b"INITBYTES".to_vec()));
    let r = env.get(&id, "/init", None).await;
    assert_eq!(status(&r), 200);
    assert_eq!(header(&r, "content-type"), Some("video/mp4"));
    assert_eq!(header(&r, "access-control-allow-origin"), Some(APP_ORIGIN));
    assert_eq!(r.body().as_slice(), b"INITBYTES");
    env.fake.push_bytes(Ok(b"SEG29".to_vec()));
    let r = env.get(&id, "/s/29", None).await;
    assert_eq!(
        (status(&r), r.body().as_slice()),
        (200, b"SEG29".as_slice())
    );
    assert_eq!(header(&r, "cache-control"), Some("no-store"));
}

#[tokio::test]
async fn seg_index_out_of_range_404() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    // 대본이 없어 업스트림을 부르면 502가 된다: 404이면 부르지 않은 것이다
    assert_eq!(status(&env.get(&id, "/s/30", None).await), 404);
    assert_eq!(status(&env.get(&id, "/s/4294967295", None).await), 404);
    assert!(env.svc.has_session(), "범위 밖 번호는 세션을 버리지 않는다");
}

#[tokio::test]
async fn seg_index_leading_zero_404() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    env.fake.push_bytes(Ok(b"S".to_vec()));
    for bad in [
        "/s/00",
        "/s/01",
        "/s/-1",
        "/s/+1",
        "/s/",
        "/s/1.5",
        "/s/12345678901",
    ] {
        assert_eq!(status(&env.get(&id, bad, None).await), 404, "{bad}");
    }
    // 위 요청이 대본(바이트)을 먹지 않았다
    assert_eq!(status(&env.get(&id, "/s/1", None).await), 200);
}

#[tokio::test]
async fn init_on_mp4_session_404() {
    let env = Env::disabled();
    let id = env.open("a").await;
    for p in ["/init", "/pl.m3u8", "/s/0"] {
        assert_eq!(status(&env.get(&id, p, None).await), 404, "{p}");
    }
    assert!(env.svc.has_session());
}

#[tokio::test]
async fn v_on_hls_session_404() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    assert_eq!(status(&env.get(&id, "/v", Some("bytes=0-9")).await), 404);
    // HEAD /v도 mp4 세션 것이다
    let r = env
        .send(http::Method::HEAD, &id, "/v", None, None, "main")
        .await;
    assert_eq!(status(&r), 404);
    // HEAD는 /v에만 받는다
    let r = env
        .send(http::Method::HEAD, &id, "/pl.m3u8", None, None, "main")
        .await;
    assert_eq!(status(&r), 405);
}

#[tokio::test]
async fn hls_requests_pass_the_same_gates() {
    // 창 라벨·로그인·채널 일치는 mp4와 같은 표를 지난다
    let env = Env::signed_in();
    env.fake.push_resolve(Ok(hls_resolved(Some(ME)))); // fetch
    env.script_hls_open(hls_fixture("media.m3u8"));
    let id = env.open_script_ready().await;
    let r = env
        .send(http::Method::GET, &id, "/pl.m3u8", None, None, "other")
        .await;
    assert_eq!(status(&r), 403);
    let r = env
        .send(
            http::Method::GET,
            &id,
            "/pl.m3u8",
            None,
            Some("https://evil.example"),
            "main",
        )
        .await;
    assert_eq!(status(&r), 403);
    assert_eq!(header(&r, "access-control-allow-origin"), None);
    assert_eq!(status(&env.get(&id, "/pl.m3u8", None).await), 200);
    env.signer.as_ref().unwrap().set(Some(OTHER_CH));
    assert_eq!(status(&env.get(&id, "/init", None).await), 403);
    assert!(!env.svc.has_session());
}

/// 403 재조회 한 번의 대본: 실패한 세그먼트 요청 + resolve + master + media + 재시도 본문
fn script_hls_refresh(env: &Env, media: Vec<u8>, body: &[u8]) {
    env.fake.push_bytes(Err(WatchFail::Expired));
    env.fake.push_resolve(Ok(hls_resolved(Some(ME))));
    env.fake.push_bytes(Ok(hls_fixture("master.m3u8")));
    env.fake.push_bytes(Ok(media));
    env.fake.push_bytes(Ok(body.to_vec()));
}

#[tokio::test]
async fn seg_403_refresh_same_crc_ok() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    let before = String::from_utf8(env.get(&id, "/pl.m3u8", None).await.body().clone()).unwrap();
    script_hls_refresh(&env, hls_fixture("media.m3u8"), b"SEG");
    let r = env.get(&id, "/s/3", None).await;
    assert_eq!((status(&r), r.body().as_slice()), (200, b"SEG".as_slice()));
    assert_eq!(env.fake.resolve_count(), 2, "열기 1회 + 재조회 1회");
    // 같은 지문이면 세션이 그대로 이어진다: playlist는 바뀌지 않는다
    let after = String::from_utf8(env.get(&id, "/pl.m3u8", None).await.body().clone()).unwrap();
    assert_eq!(before, after);
    // 두 번째 403은 세션 안에서 다시 재조회할 수 있다(상한 안)
    script_hls_refresh(&env, hls_fixture("media.m3u8"), b"SEG2");
    assert_eq!(status(&env.get(&id, "/init", None).await), 200);
    assert_eq!(env.fake.resolve_count(), 3);
}

#[tokio::test]
async fn seg_403_refresh_crc_changed_409() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    // 조각 하나의 길이가 달라진 playlist
    let changed = String::from_utf8(hls_fixture("media.m3u8"))
        .unwrap()
        .replacen("#EXTINF:2.000000,", "#EXTINF:2.500000,", 1);
    script_hls_refresh(&env, changed.into_bytes(), b"UNUSED");
    let r = env.get(&id, "/s/3", None).await;
    assert_eq!(status(&r), 409);
    assert!(!env.svc.has_session(), "지문이 바뀌면 세션을 버린다");
    assert_eq!(status(&env.get(&id, "/pl.m3u8", None).await), 404);
}

#[tokio::test]
async fn hls_refresh_playback_changed_409() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    env.fake.push_bytes(Err(WatchFail::Expired));
    env.fake.push_resolve(Ok(pd("a", Some(ME))));
    assert_eq!(status(&env.get(&id, "/s/0", None).await), 409);
    assert!(!env.svc.has_session());
}

#[tokio::test]
async fn hls_refresh_reload_failure_502_keeps_session() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    env.fake.push_bytes(Err(WatchFail::Expired));
    env.fake.push_resolve(Ok(hls_resolved(Some(ME))));
    env.fake
        .push_bytes(Err(WatchFail::Retry(Error::LengthMismatch {
            expected: 2,
            actual: 1,
        })));
    assert_eq!(status(&env.get(&id, "/s/0", None).await), 502);
    assert!(env.svc.has_session());
}

#[tokio::test]
async fn hls_expired_right_after_refresh_403() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    env.fake.push_bytes(Err(WatchFail::Expired));
    env.fake.push_resolve(Ok(hls_resolved(Some(ME))));
    env.fake.push_bytes(Ok(hls_fixture("master.m3u8")));
    env.fake.push_bytes(Ok(hls_fixture("media.m3u8")));
    env.fake.push_bytes(Err(WatchFail::Expired));
    assert_eq!(status(&env.get(&id, "/s/0", None).await), 403);
}

#[tokio::test]
async fn seg_too_large_502() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    env.fake.push_bytes(Err(WatchFail::TooLarge));
    assert_eq!(status(&env.get(&id, "/s/0", None).await), 502);
    assert!(env.svc.has_session(), "상한 초과는 이 요청만 실패시킨다");
    env.fake.push_bytes(Err(WatchFail::Fatal(Error::HttpStatus {
        status: 404,
        kind: chzzk_core::RequestKind::Media,
    })));
    assert_eq!(status(&env.get(&id, "/init", None).await), 502);
}

#[tokio::test]
async fn hls_idle_expiry_and_close() {
    let env = Env::disabled();
    let id = env.open_hls().await;
    env.svc.close(&id);
    assert_eq!(status(&env.get(&id, "/pl.m3u8", None).await), 404);
}

#[tokio::test]
async fn hls_open_replaces_previous_session() {
    let env = Env::disabled();
    let first = env.open("a").await;
    let second = env.open_hls().await;
    assert_ne!(first, second);
    assert_eq!(status(&env.get(&first, "/v", Some("bytes=0-9")).await), 404);
    assert_eq!(status(&env.get(&second, "/pl.m3u8", None).await), 200);
}

#[test]
fn pick_variant_visibility_only() {
    // 셸에서 코어의 `pick_variant`를 부를 수 있다(시그니처·동작은 받기와 같다)
    let base = Url::parse("https://media.example.invalid/m/master.m3u8").unwrap();
    let variants = chzzk_core::hls::parse_master(
        &String::from_utf8(hls_fixture("master.m3u8")).unwrap(),
        &base,
    )
    .unwrap();
    let tracks = [quality("144p", Some(144), false)];
    let v = chzzk_core::download::pick_variant(&variants, "144p", &tracks).unwrap();
    assert_eq!(v.track_id, "144p");
    assert!(matches!(
        chzzk_core::download::pick_variant(&variants, "9999p", &tracks),
        Err(Error::QualityNotFound { .. })
    ));
}

#[tokio::test]
async fn hls_fetch_caps() {
    // 텍스트(master·media)는 1 MiB, init·세그먼트는 32 MiB
    let env = Env::disabled();
    let id = env.open_hls().await;
    assert_eq!(env.fake.byte_caps(), [1 << 20, 1 << 20]);
    env.fake.push_bytes(Ok(vec![1]));
    env.get(&id, "/init", None).await;
    env.fake.push_bytes(Ok(vec![1]));
    env.get(&id, "/s/1", None).await;
    assert_eq!(env.fake.byte_caps()[2..], [32 << 20, 32 << 20]);
}
