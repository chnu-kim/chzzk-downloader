//! 받기 전 미리보기 세션(docs/design/features/preview.md §5, PV-2).
//!
//! 웹뷰 `<video>`는 Tauri 사용자 정의 주소(`watch:`)로 Range 요청을 보낸다. 이 서비스가 그 요청을 받아 세션에 든 서명 주소로
//! 업스트림에 닫힌 구간 하나를 다시 보내고(코어 `watch_range`), 206 조각으로 돌려준다. 서명 주소는 이 모듈 밖으로 나가지 않는다:
//! 프런트는 불투명 세션 ID와 `watch:` 주소만 안다.
//!
//! - 세션은 앱 전체에서 하나다(PV5). 새로 열면 이전 것을 버리고, 유휴 10분이면 버리고, 로그아웃하면 모두 버린다.
//! - 게이트는 두 지점이다(PV6). 열 때는 받기와 같은 `admit_checked`, 요청마다는 창 라벨·로그인·채널 일치다.
//! - 403(서명 만료)은 세션 안에서 재조회한다(PV7). 세션은 `Arc<Session>`이고 원천 상태에 세대 번호(`generation`)가 있어,
//!   같은 만료로 몰린 요청들이 재조회를 한 번만 하고 닫힌 세션의 결과는 쓰지 않는다.
//! - mp4(PD)는 `/v`의 Range 조각 중계(PV-2), 빠른 다시보기 HLS는 `/pl.m3u8`(우리가 만든 VOD playlist)·`/init`·`/s/<i>`(통짜
//!   GET 중계)다(PV-5). playlist에는 서명 주소가 한 글자도 없고, 세그먼트 주소는 세션에만 있다.
//!
//! `handle`은 Tauri에 의존하지 않는 결정 함수라 셸 테스트가 직접 부른다. 앱 크레이트(`watch_protocol`)가 얇게 감싼다.

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use chzzk_core::download::pick_variant;
use chzzk_core::hls;
use chzzk_core::http::redact_url;
use chzzk_core::mpd::select_pd;
use chzzk_core::{
    ContentRef, Error, PdRep, Quality, RangeChunk, RequestKind, Source, Unsupported, WatchFail,
    parse_content_url,
};
use http::header::{ORIGIN, RANGE};
use http::{Method, Request, Response};
use url::Url;

use crate::backend::Backend;
use crate::dto::{WatchKindDto, WatchOpenDto};
use crate::error::AppError;
use crate::manager::ClientFn;
use crate::ownership::OwnershipGate;

/// 한 응답에 담는 최대 조각 크기 **[잠정]**(PV3). 응답 본문은 한 번에 전달되므로 스트림이 아니라 자른 206이다.
pub const CHUNK: u64 = 4 * 1024 * 1024;

/// 요청이 없으면 세션을 버리는 시간 **[잠정]**(PV5).
pub const IDLE_TTL: Duration = Duration::from_secs(10 * 60);

/// 세션당 재조회(실제 resolve) 상한(PV7). 받기의 `MAX_REFRESHES`와 같은 값이다.
pub const MAX_REFRESHES: u8 = 8;

/// playlist(master·media) 한 장의 상한 **[잠정]**(preview.md §4.1).
const TEXT_CAP: usize = 1024 * 1024;

/// init·세그먼트 하나의 상한 **[잠정]**(preview.md §4.1).
const SEGMENT_CAP: usize = 32 * 1024 * 1024;

/// 허용하는 창 라벨(PV6).
const MAIN_LABEL: &str = "main";

/// 판정 직전 확인(`App::recheck`)을 부르는 함수. 세션이 `App` 밖에서 재조회할 때 같은 확인을 거치게 한다.
pub type RecheckFn = Arc<dyn Fn() -> Pin<Box<dyn Future<Output = ()> + Send>> + Send + Sync>;

/// scheme 요청의 호출 환경(Tauri가 알려 주는 것).
#[derive(Clone, Copy, Debug)]
pub struct ReqCtx<'a> {
    /// 요청을 보낸 웹뷰 창 라벨
    pub webview_label: &'a str,
}

/// 주소 만들기에 쓰는 값(앱 크레이트가 OS·dev 여부로 정한다, PV1·PV11).
#[derive(Clone, Debug)]
struct Endpoints {
    /// `watch://localhost`(Windows는 `http://watch.localhost`)
    base: String,
    /// 앱 출처. ACAO 값이고 이것과 다른 `Origin`은 거부한다
    app_origin: String,
}

/// 세션이 중계하는 원천(서명 주소가 든다). 래퍼 없이 두고 `Debug`에는 `redact_url`·개수만 쓴다(app.md 구현 중 변경에 적음).
#[derive(Clone)]
enum Origin {
    /// PD mp4: 서명 주소와 열 때 정한 전체 길이(바뀌면 영상이 바뀐 것이다, `409`)
    Mp4 { url: Url, total: u64 },
    /// 빠른 다시보기 HLS. 조각 목록이 커서 `Arc`로 나눠 쥔다
    Hls(Arc<HlsOrigin>),
}

/// HLS 원천: init·세그먼트의 서명 주소와, 재조회 전후가 같은 playlist인지 보는 지문.
struct HlsOrigin {
    init: Url,
    segments: Vec<Url>,
    /// `hls::durations_crc`
    crc: u32,
    /// 웹뷰에 내보내는 VOD playlist(주소 없음). 열 때 한 번 만들고 재조회로 바꾸지 않는다(같은 지문이므로 같다)
    playlist: String,
}

impl Origin {
    fn mp4(&self) -> Option<(Url, u64)> {
        match self {
            Origin::Mp4 { url, total } => Some((url.clone(), *total)),
            Origin::Hls(_) => None,
        }
    }
}

impl fmt::Debug for Origin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Origin::Mp4 { url, total } => f
                .debug_struct("Mp4")
                .field("url", &redact_url(url))
                .field("total", total)
                .finish(),
            Origin::Hls(h) => f
                .debug_struct("Hls")
                .field("segments", &h.segments.len())
                .field("crc", &h.crc)
                .finish(),
        }
    }
}

/// 원천 상태: 재조회가 바꾸는 것들.
struct SourceState {
    /// 재조회로 주소가 바뀔 때마다 1씩 는다
    generation: u64,
    origin: Origin,
    refreshes: u8,
    last_used: tokio::time::Instant,
}

impl fmt::Debug for SourceState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SourceState")
            .field("generation", &self.generation)
            .field("origin", &self.origin)
            .field("refreshes", &self.refreshes)
            .finish()
    }
}

/// 열린 미리보기 하나.
struct Session {
    /// hex 32자. 로그에는 앞 4자만 남긴다
    id: String,
    content: ContentRef,
    /// 연 순간의 로그인 채널. 로그인을 쓰지 않는 빌드는 `None`(PV6)
    me: Option<String>,
    quality_id: String,
    kind: WatchKindDto,
    state: Mutex<SourceState>,
    /// 재조회를 한 번에 하나로 묶는다
    refresh: tokio::sync::Mutex<()>,
}

impl fmt::Debug for Session {
    /// ID 앞 4자와 방식만. 전체 ID는 주소를 만드는 열쇠라 찍지 않는다.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Session")
            .field("id", &format_args!("{}…", short(&self.id)))
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

impl Session {
    fn state(&self) -> std::sync::MutexGuard<'_, SourceState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// `(세대, 원천)`
    fn snapshot(&self) -> (u64, Origin) {
        let s = self.state();
        (s.generation, s.origin.clone())
    }
}

/// 로그용 ID 앞 4자.
fn short(id: &str) -> &str {
    id.get(..4).unwrap_or(id)
}

/// 미리보기 서비스. `App`이 하나 들고 있다.
pub struct WatchService<B: Backend> {
    client: ClientFn<B>,
    gate: Arc<OwnershipGate>,
    recheck: RecheckFn,
    endpoints: Mutex<Endpoints>,
    /// 지금 열린 세션(최대 1개). 잠금은 `Arc`를 꺼내는 동안만 잡고 await 너머로 들고 가지 않는다
    current: Mutex<Option<Arc<Session>>>,
}

impl<B: Backend> fmt::Debug for WatchService<B> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("WatchService")
            .field("session", &self.current_session())
            .finish_non_exhaustive()
    }
}

impl<B: Backend> WatchService<B> {
    /// `client`는 부를 때마다 그 시점의 코어 클라이언트를 준다(설정이 바뀌면 바뀐다).
    /// 주소 base·앱 출처는 `set_endpoints`로 정한다(앱 크레이트, 기본은 macOS·Linux 릴리스 값).
    pub fn new(client: ClientFn<B>, gate: Arc<OwnershipGate>, recheck: RecheckFn) -> Self {
        WatchService {
            client,
            gate,
            recheck,
            endpoints: Mutex::new(Endpoints {
                base: "watch://localhost".into(),
                app_origin: "tauri://localhost".into(),
            }),
            current: Mutex::new(None),
        }
    }

    /// `src`의 base(`watch://localhost`·`http://watch.localhost`)와 앱 출처(ACAO 값)를 정한다(PV1·PV11).
    pub fn set_endpoints(&self, base: &str, app_origin: &str) {
        *self
            .endpoints
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Endpoints {
            base: base.trim_end_matches('/').to_string(),
            app_origin: app_origin.to_string(),
        };
    }

    fn endpoints(&self) -> Endpoints {
        self.endpoints
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn current_session(&self) -> Option<Arc<Session>> {
        self.current
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// 열린 세션이 있는가.
    pub fn has_session(&self) -> bool {
        self.current_session().is_some()
    }

    fn is_current(&self, s: &Arc<Session>) -> bool {
        self.current_session().is_some_and(|c| Arc::ptr_eq(&c, s))
    }

    /// `s`가 아직 현재 세션이면 버린다(다른 세션이 이미 들어와 있으면 건드리지 않는다).
    fn drop_if_current(&self, s: &Arc<Session>) {
        let mut cur = self.current.lock().unwrap_or_else(PoisonError::into_inner);
        if cur.as_ref().is_some_and(|c| Arc::ptr_eq(c, s)) {
            *cur = None;
        }
    }

    /// `close`: 같은 ID면 버린다. 없거나 다른 ID여도 `Ok`(멱등)다.
    pub fn close(&self, id: &str) {
        let mut cur = self.current.lock().unwrap_or_else(PoisonError::into_inner);
        if cur.as_ref().is_some_and(|s| s.id == id) {
            *cur = None;
        }
    }

    /// 로그아웃(또는 로그인 상태가 풀림): 모두 버린다(PV5).
    pub fn on_signed_out(&self) {
        *self.current.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }

    /// `watch_open`. 게이트 → 재생 방식·화질 고르기 → total 탐색(1회) → 세션 교체.
    ///
    /// 순서는 `enqueue_checked`와 같다(PV6): 주소와 컨텐츠가 같은 영상인지 → `admit_checked`(관리자 확인·위임 갱신 포함).
    pub async fn open(&self, url: &str, content: &ContentRef) -> Result<WatchOpenDto, AppError> {
        if !parse_content_url(url).is_ok_and(|c| &c == content) {
            return Err(AppError::invalid_input("요청 주소와 영상이 맞지 않습니다"));
        }
        // 생방송은 미리보기 대상이 아니다(PV18). 네트워크 전에 거절한다
        if matches!(content, ContentRef::Live { .. }) {
            return Err(AppError::invalid_input("생방송은 미리볼 수 없습니다"));
        }
        let client = (self.client)();
        self.gate
            .admit_checked(
                content,
                || async {
                    client
                        .resolve(content)
                        .await
                        .map(|r| r.meta.channel_id)
                        .map_err(AppError::from)
                },
                || (self.recheck)(),
            )
            .await?;
        // 판정을 통과한 순간의 로그인 채널을 세션에 묶는다(로그인을 쓰지 않는 빌드는 None)
        let me = if self.gate.is_enabled() {
            Some(
                self.gate
                    .signer()
                    .ok_or_else(AppError::not_logged_in)?
                    .channel_id,
            )
        } else {
            None
        };

        let resolved = client.resolve(content).await?;
        let (kind, origin, quality_id) = match resolved.source {
            Source::Progressive { reps } => {
                let rep = pick_lowest(&reps)
                    .ok_or_else(|| AppError::invalid_input("미리볼 수 있는 화질이 없습니다"))?;
                // total은 열 때 한 번 정한다(PV3). 이후 조각은 이 값과 같아야 한다
                let probe = client
                    .watch_range(&rep.url, 0, 0, None)
                    .await
                    .map_err(open_error)?;
                (
                    WatchKindDto::Mp4,
                    Origin::Mp4 {
                        url: rep.url.clone(),
                        total: probe.total,
                    },
                    rep.quality.id.clone(),
                )
            }
            Source::LiveRewindHls { master_url, tracks } => {
                let quality = lowest_by(&tracks, |q| q)
                    .ok_or_else(|| AppError::invalid_input("미리볼 수 있는 화질이 없습니다"))?;
                // 받기와 같은 거절(DISCONTINUITY·ENDLIST 없음·MAP 없음 등)과 같은 오류 변환을 쓴다
                let loaded = load_hls(&*client, &master_url, &quality.id, &tracks)
                    .await
                    .map_err(LoadError::into_open_error)?;
                (
                    WatchKindDto::Hls,
                    Origin::Hls(Arc::new(loaded)),
                    quality.id.clone(),
                )
            }
            Source::Live { .. } => {
                return Err(AppError::invalid_input("생방송은 미리볼 수 없습니다"));
            }
        };

        let id = new_id();
        let session = Arc::new(Session {
            id: id.clone(),
            content: content.clone(),
            me,
            quality_id: quality_id.clone(),
            kind,
            state: Mutex::new(SourceState {
                generation: 0,
                origin,
                refreshes: 0,
                last_used: tokio::time::Instant::now(),
            }),
            refresh: tokio::sync::Mutex::new(()),
        });
        // 이전 세션은 이 교체로 버려진다(PV5)
        *self.current.lock().unwrap_or_else(PoisonError::into_inner) = Some(session);
        tracing::debug!(session = short(&id), quality = %quality_id, "미리보기 세션을 열었다");
        let entry = match kind {
            WatchKindDto::Mp4 => "v",
            WatchKindDto::Hls => "pl.m3u8",
        };
        Ok(WatchOpenDto {
            src: format!("{}/{id}/{entry}", self.endpoints().base),
            id,
            kind,
        })
    }

    /// scheme 요청 한 건(§5.3 표). 위에서부터 판정해 처음 걸린 행이 답이다.
    pub async fn handle(&self, req: &Request<Vec<u8>>, ctx: ReqCtx<'_>) -> Response<Vec<u8>> {
        let ep = self.endpoints();
        let parsed = parse_path(req.uri().path());
        let tag = parsed.as_ref().map_or("-", |(id, _)| short(id));
        let resp = self.handle_inner(req, ctx, &ep, parsed).await;
        tracing::debug!(
            session = tag,
            status = resp.status().as_u16(),
            bytes = resp.body().len(),
            "미리보기 요청"
        );
        resp
    }

    async fn handle_inner(
        &self,
        req: &Request<Vec<u8>>,
        ctx: ReqCtx<'_>,
        ep: &Endpoints,
        parsed: Option<(&str, Target)>,
    ) -> Response<Vec<u8>> {
        let cors = Some(ep.app_origin.as_str());
        let plain = |status: u16| reply(cors, status, &[], Vec::new());
        let head = req.method() == Method::HEAD;
        if req.method() != Method::GET && !head {
            return plain(405);
        }
        if head && !matches!(parsed, Some((_, Target::Video))) {
            return plain(405);
        }
        if ctx.webview_label != MAIN_LABEL {
            return plain(403);
        }
        // 로그인을 쓰지 않는 빌드는 로그인·채널 검사를 건너뛴다(PV6)
        let signer = self.gate.signer();
        if self.gate.is_enabled() && signer.is_none() {
            self.on_signed_out();
            return plain(403);
        }
        if let Some(origin) = req.headers().get(ORIGIN)
            && origin.as_bytes() != ep.app_origin.as_bytes()
        {
            // 다른 출처에는 ACAO를 주지 않는다
            return reply(None, 403, &[], Vec::new());
        }
        let Some((id, target)) = parsed else {
            return plain(404);
        };
        let Some(session) = self.current_session().filter(|s| s.id == id) else {
            return plain(404);
        };
        {
            let mut st = session.state();
            if st.last_used.elapsed() > IDLE_TTL {
                drop(st);
                self.drop_if_current(&session);
                return plain(404);
            }
            st.last_used = tokio::time::Instant::now();
        }
        if self.gate.is_enabled() {
            let same = signer
                .as_ref()
                .zip(session.me.as_ref())
                .is_some_and(|(now, then)| &now.channel_id == then);
            if !same {
                self.drop_if_current(&session);
                return plain(403);
            }
        }
        // 세션 방식과 경로 종류가 맞지 않으면(mp4 세션에 `/s/0`, HLS 세션에 `/v` 등) 없는 주소다
        let (_, origin) = session.snapshot();
        match (origin, target) {
            (Origin::Mp4 { total, .. }, Target::Video) => {
                self.serve_video(&session, req, head, total, cors).await
            }
            (Origin::Hls(h), Target::Playlist) => reply(
                cors,
                200,
                &[("content-type", "application/vnd.apple.mpegurl".into())],
                h.playlist.clone().into_bytes(),
            ),
            (Origin::Hls(_), Target::Init) => self.serve_part(&session, Part::Init, cors).await,
            (Origin::Hls(h), Target::Segment(i)) => {
                // 범위 밖 번호는 업스트림을 부르지 않는다
                if usize::try_from(i).is_ok_and(|i| i < h.segments.len()) {
                    self.serve_part(&session, Part::Segment(i as usize), cors)
                        .await
                } else {
                    plain(404)
                }
            }
            _ => plain(404),
        }
    }

    /// `/v`(mp4): HEAD 또는 Range 조각.
    async fn serve_video(
        &self,
        session: &Arc<Session>,
        req: &Request<Vec<u8>>,
        head: bool,
        total: u64,
        cors: Option<&str>,
    ) -> Response<Vec<u8>> {
        let plain = |status: u16| reply(cors, status, &[], Vec::new());
        if head {
            return reply(
                cors,
                200,
                &[
                    ("content-length", total.to_string()),
                    ("accept-ranges", "bytes".into()),
                    ("content-type", "video/mp4".into()),
                ],
                Vec::new(),
            );
        }
        // ASCII가 아닌 값은 문법 오류다(헤더가 없는 것과 다르다)
        let range = match req.headers().get(RANGE) {
            None => RangeReq::Absent,
            Some(v) => v
                .to_str()
                .map_or(RangeReq::Invalid, |s| parse_range(Some(s))),
        };
        let Some((start, end)) = resolve_range(range, total) else {
            return reply(
                cors,
                416,
                &[("content-range", format!("bytes */{total}"))],
                Vec::new(),
            );
        };
        match self.fetch_chunk(session, start, end).await {
            Ok(c) => reply(
                cors,
                206,
                &[
                    (
                        "content-range",
                        format!("bytes {}-{}/{}", c.start, c.end_incl, c.total),
                    ),
                    ("content-length", c.body.len().to_string()),
                    ("content-type", "video/mp4".into()),
                    ("accept-ranges", "bytes".into()),
                ],
                c.body,
            ),
            Err(status) => plain(status),
        }
    }

    /// `/init`·`/s/<i>`(HLS): 통짜 본문.
    async fn serve_part(
        &self,
        session: &Arc<Session>,
        part: Part,
        cors: Option<&str>,
    ) -> Response<Vec<u8>> {
        match self.fetch_part(session, part).await {
            Ok(body) => reply(cors, 200, &[("content-type", "video/mp4".into())], body),
            Err(status) => reply(cors, status, &[], Vec::new()),
        }
    }

    /// init·세그먼트 하나를 받는다. 403이면 세션 안에서 한 번 재조회하고 1회 다시 보낸다(PV7).
    async fn fetch_part(&self, s: &Arc<Session>, part: Part) -> Result<Vec<u8>, u16> {
        let client = (self.client)();
        let (generation, origin) = s.snapshot();
        let url = part.url(&origin).ok_or(404u16)?;
        match client.watch_bytes(&url, SEGMENT_CAP).await {
            Ok(b) => Ok(b),
            Err(WatchFail::Expired) => {
                self.refresh(s, generation).await?;
                let url = part.url(&s.snapshot().1).ok_or(404u16)?;
                match client.watch_bytes(&url, SEGMENT_CAP).await {
                    Ok(b) => Ok(b),
                    // 재조회 직후에도 403이면 더 하지 않는다
                    Err(WatchFail::Expired) => Err(403),
                    Err(f) => Err(self.fail_status(s, f, 0)),
                }
            }
            Err(f) => Err(self.fail_status(s, f, 0)),
        }
    }

    /// 업스트림에서 한 조각을 받는다. 403이면 세션 안에서 한 번 재조회하고 같은 요청을 1회 다시 보낸다(PV7).
    /// 실패는 응답 상태 코드로 돌려준다.
    async fn fetch_chunk(&self, s: &Arc<Session>, start: u64, end: u64) -> Result<RangeChunk, u16> {
        let client = (self.client)();
        let (generation, origin) = s.snapshot();
        let (url, total) = origin.mp4().ok_or(404u16)?;
        match client.watch_range(&url, start, end, Some(total)).await {
            Ok(c) => self.check_chunk(s, c, total, start, end),
            Err(WatchFail::Expired) => {
                self.refresh(s, generation).await?;
                let (url, _) = s.snapshot().1.mp4().ok_or(404u16)?;
                match client.watch_range(&url, start, end, Some(total)).await {
                    Ok(c) => self.check_chunk(s, c, total, start, end),
                    // 재조회 직후에도 403이면 더 하지 않는다
                    Err(WatchFail::Expired) => Err(403),
                    Err(f) => Err(self.fail_status(s, f, total)),
                }
            }
            Err(f) => Err(self.fail_status(s, f, total)),
        }
    }

    /// 코어가 이미 대조한 값을 셸이 한 번 더 본다(§5.3). total이 다르거나, 시작이 요청과 다르거나,
    /// 끝이 요청을 넘거나, 본문 길이가 Content-Range와 다르면 영상이 바뀐 것으로 본다(`409`, 세션 버림).
    fn check_chunk(
        &self,
        s: &Arc<Session>,
        c: RangeChunk,
        total: u64,
        start: u64,
        end: u64,
    ) -> Result<RangeChunk, u16> {
        let len = c.end_incl.checked_sub(c.start).map(|d| d + 1);
        if c.total != total
            || c.start != start
            || c.end_incl > end
            || len != Some(c.body.len() as u64)
        {
            tracing::warn!(session = short(&s.id), "조각이 요청·전체 길이와 어긋난다");
            self.drop_if_current(s);
            return Err(409);
        }
        Ok(c)
    }

    /// 업스트림 실패 → 응답 상태. 영상이 바뀌었으면 세션을 버린다.
    fn fail_status(&self, s: &Arc<Session>, f: WatchFail, total: u64) -> u16 {
        tracing::debug!(
            session = short(&s.id),
            kind = fail_name(&f),
            "미리보기 업스트림 실패"
        );
        match f {
            WatchFail::SourceChanged => {
                self.drop_if_current(s);
                409
            }
            WatchFail::Unsatisfiable { total: t } if t != total => {
                self.drop_if_current(s);
                409
            }
            // 전송이 끊겼으면 웹뷰가 다시 요청한다. 나머지도 이 요청만 실패시키고 세션은 둔다
            _ => 502,
        }
    }

    /// 서명 주소를 다시 얻는다. `used_gen`은 실패한 요청이 쓴 세대다.
    ///
    /// 재조회 잠금을 잡은 뒤 현재 세대가 더 크면 다른 요청이 이미 끝낸 것이라 resolve 없이 새 주소를 쓴다.
    /// resolve 결과는 세션이 그대로(`Arc::ptr_eq`)일 때만 쓴다(닫힘·교체·로그아웃이면 `404`).
    /// 세대는 이 잠금 안에서만 바뀌므로 resolve 사이에 달라지지 않는다.
    async fn refresh(&self, s: &Arc<Session>, used_gen: u64) -> Result<(), u16> {
        let _one_at_a_time = s.refresh.lock().await;
        if !self.is_current(s) {
            return Err(404);
        }
        {
            let mut st = s.state();
            if st.generation > used_gen {
                return Ok(());
            }
            if st.refreshes >= MAX_REFRESHES {
                return Err(403);
            }
            // 성공 여부와 상관없이 resolve 시도마다 센다(PV7: 실패가 이어져도 끝없이 부르지 않는다)
            st.refreshes += 1;
        }
        let client = (self.client)();
        let resolved = client.resolve(&s.content).await.map_err(|e| {
            tracing::debug!(session = short(&s.id), error = %e, "미리보기 재조회 실패");
            502u16
        })?;
        // 재조회로 알게 된 채널로 다시 판정한다(위임이 취소됐으면 막는다, PV6)
        self.gate.on_resolved(&s.content, &resolved.meta);
        let channel = resolved.meta.channel_id.clone();
        if let Err(e) = self
            .gate
            .admit_checked(&s.content, || async { Ok(channel) }, || (self.recheck)())
            .await
        {
            // 재조회 중에 닫힘·로그아웃이 먼저 있었으면 판정 실패가 아니라 없는 세션이다
            if !self.is_current(s) {
                return Err(404);
            }
            tracing::debug!(session = short(&s.id), code = ?e.code, "재조회 뒤 판정에서 막혔다");
            self.drop_if_current(s);
            return Err(403);
        }
        // 새 원천. HLS는 master·media를 다시 받는 await이 있으므로 그 뒤에 세션이 그대로인지 본다
        let renewed = match (s.kind, resolved.source) {
            (WatchKindDto::Mp4, Source::Progressive { reps }) => select_pd(&reps, &s.quality_id)
                .map(|rep| Renewed::Mp4(rep.url.clone()))
                .map_err(|_| ()),
            (WatchKindDto::Hls, Source::LiveRewindHls { master_url, tracks }) => {
                match load_hls(&*client, &master_url, &s.quality_id, &tracks).await {
                    Ok(h) => Ok(Renewed::Hls(h)),
                    // 받는 쪽 문제(전송·상한)는 이 요청만 실패시킨다. 세션은 둔다
                    Err(LoadError::Watch(f)) => {
                        if !self.is_current(s) {
                            return Err(404);
                        }
                        // 막 얻은 주소가 곧바로 403이면 만료가 아니라 거부다(재시도 직후 403과 같다)
                        if matches!(f, WatchFail::Expired) {
                            return Err(403);
                        }
                        return Err(self.fail_status(s, f, 0));
                    }
                    // playlist 모양이 달라졌거나 그 화질이 사라졌다
                    Err(LoadError::Core(_)) => Err(()),
                }
            }
            // 재생 방식이 바뀌었다
            _ => Err(()),
        };
        // 재조회 중에 닫힘·새 open·로그아웃이 있었으면 결과를 버린다
        if !self.is_current(s) {
            return Err(404);
        }
        let Ok(renewed) = renewed else {
            self.drop_if_current(s);
            return Err(409);
        };
        // 세대를 바꾸는 곳은 여기뿐이고 재조회 잠금을 쥐고 있으므로 세대는 `used_gen`에서 그대로다
        let mut st = s.state();
        match (&st.origin, renewed) {
            (Origin::Mp4 { total, .. }, Renewed::Mp4(url)) => {
                st.origin = Origin::Mp4 { url, total: *total };
            }
            (Origin::Hls(old), Renewed::Hls(new))
                if new.crc == old.crc && new.segments.len() == old.segments.len() =>
            {
                // 같은 playlist다: 웹뷰가 이미 가진 playlist를 그대로 두고 주소만 바꾼다
                let playlist = old.playlist.clone();
                st.origin = Origin::Hls(Arc::new(HlsOrigin { playlist, ..new }));
            }
            // 지문이 바뀌었다(조각 수·길이): 이어 볼 수 없다
            _ => {
                drop(st);
                self.drop_if_current(s);
                return Err(409);
            }
        }
        st.generation += 1;
        Ok(())
    }
}

/// 재조회로 새로 얻은 원천.
enum Renewed {
    Mp4(Url),
    Hls(HlsOrigin),
}

/// `/init`·`/s/<i>`가 가리키는 업스트림 파일.
#[derive(Clone, Copy)]
enum Part {
    Init,
    Segment(usize),
}

impl Part {
    /// 그 원천에서의 서명 주소. mp4 원천이거나 번호가 범위 밖이면 `None`.
    fn url(self, origin: &Origin) -> Option<Url> {
        match (self, origin) {
            (Part::Init, Origin::Hls(h)) => Some(h.init.clone()),
            (Part::Segment(i), Origin::Hls(h)) => h.segments.get(i).cloned(),
            (_, Origin::Mp4 { .. }) => None,
        }
    }
}

/// HLS 불러오기 실패: 받는 중 문제(`WatchFail`)와 playlist 내용 문제(`Error`).
enum LoadError {
    Watch(WatchFail),
    Core(Error),
}

impl LoadError {
    /// 열기: 받기와 같은 오류 변환.
    fn into_open_error(self) -> AppError {
        match self {
            LoadError::Watch(f) => open_error(f),
            LoadError::Core(e) => AppError::from(e),
        }
    }
}

/// master → variant → media playlist까지 받아 세션 원천과 웹뷰 playlist를 만든다.
/// init·세그먼트 본문은 받지 않는다(요청이 올 때 받는다). 거절 규칙은 `parse_media`(받기와 같다)이고,
/// TS playlist(MAP 없음)도 받기처럼 거절한다.
async fn load_hls<B: Backend>(
    client: &B,
    master_url: &Url,
    quality_id: &str,
    tracks: &[Quality],
) -> Result<HlsOrigin, LoadError> {
    let master = client
        .watch_bytes(master_url, TEXT_CAP)
        .await
        .map_err(LoadError::Watch)?;
    let master = utf8(&master, "master playlist")?;
    let variants = hls::parse_master(master, master_url).map_err(LoadError::Core)?;
    let variant = pick_variant(&variants, quality_id, tracks).map_err(LoadError::Core)?;
    let media = client
        .watch_bytes(&variant.uri, TEXT_CAP)
        .await
        .map_err(LoadError::Watch)?;
    let media = utf8(&media, "media playlist")?;
    let playlist = hls::parse_media(media, &variant.uri).map_err(LoadError::Core)?;
    let init = playlist
        .init
        .clone()
        .ok_or(LoadError::Core(Error::Unsupported(Unsupported::MissingMap)))?;
    Ok(HlsOrigin {
        init,
        crc: hls::durations_crc(&playlist),
        playlist: hls::render_watch_playlist(&playlist),
        segments: playlist.segments.into_iter().map(|s| s.uri).collect(),
    })
}

fn utf8<'a>(b: &'a [u8], what: &'static str) -> Result<&'a str, LoadError> {
    std::str::from_utf8(b).map_err(|e| {
        LoadError::Core(Error::Parse {
            what,
            detail: e.to_string(),
        })
    })
}

/// 가장 낮은 비디오 화질(PV13). 오디오만 행은 뺀다. 짧은 변을 모르면 가장 높은 것으로 본다. 같으면 앞의 것.
fn lowest_by<T>(items: &[T], quality: impl Fn(&T) -> &Quality) -> Option<&T> {
    items
        .iter()
        .filter(|r| !quality(r).audio_only)
        .min_by_key(|r| {
            let q = quality(r);
            q.resolution.or(q.height).unwrap_or(u32::MAX)
        })
}

fn pick_lowest(reps: &[PdRep]) -> Option<&PdRep> {
    lowest_by(reps, |r| &r.quality)
}

/// 열기 때 total 탐색 실패 → 사용자에게 갈 오류. 403은 받기와 같은 미디어 HTTP 오류로 바꾼다.
fn open_error(f: WatchFail) -> AppError {
    match f {
        WatchFail::RangeIgnored | WatchFail::Unsatisfiable { .. } => {
            AppError::unsupported("이 영상의 서버가 구간 요청을 지원하지 않아 미리볼 수 없습니다")
        }
        WatchFail::Expired => AppError::from(Error::HttpStatus {
            status: 403,
            kind: RequestKind::Media,
        }),
        WatchFail::SourceChanged => AppError::from(Error::SourceChanged {
            detail: "미리보기 응답이 어긋납니다".into(),
        }),
        WatchFail::TooLarge => AppError::from(Error::Parse {
            what: "watch",
            detail: "응답이 상한을 넘었습니다".into(),
        }),
        WatchFail::Retry(e) | WatchFail::Fatal(e) => AppError::from(e),
    }
}

/// 로그용 종류 이름(오류 본문은 찍지 않는다).
fn fail_name(f: &WatchFail) -> &'static str {
    match f {
        WatchFail::Retry(_) => "retry",
        WatchFail::Fatal(_) => "fatal",
        WatchFail::Expired => "expired",
        WatchFail::SourceChanged => "sourceChanged",
        WatchFail::RangeIgnored => "rangeIgnored",
        WatchFail::Unsatisfiable { .. } => "unsatisfiable",
        WatchFail::TooLarge => "tooLarge",
    }
}

/// 128비트 난수의 hex 32자.
fn new_id() -> String {
    let mut b = [0u8; 16];
    getrandom::fill(&mut b).expect("OS 난수원을 쓸 수 없다");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// 요청 경로가 가리키는 것.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Target {
    /// `/v`: mp4 본문
    Video,
    /// `/pl.m3u8`
    Playlist,
    /// `/init`
    Init,
    /// `/s/<i>`
    Segment(u64),
}

/// `/<id32hex>/v`·`/pl.m3u8`·`/init`·`/s/<i>`만 받는다. 앞 0·부호·10자 넘는 번호, 대문자 hex, 다른 길이의 ID는 거부한다.
fn parse_path(path: &str) -> Option<(&str, Target)> {
    let rest = path.strip_prefix('/')?;
    let (id, tail) = rest.split_once('/')?;
    if id.len() != 32 || !id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
        return None;
    }
    let target = match tail {
        "v" => Target::Video,
        "pl.m3u8" => Target::Playlist,
        "init" => Target::Init,
        _ => {
            let n = tail.strip_prefix("s/")?;
            let digits_only =
                !n.is_empty() && n.len() <= 10 && n.bytes().all(|b| b.is_ascii_digit());
            let no_leading_zero = n == "0" || !n.starts_with('0');
            if !(digits_only && no_leading_zero) {
                return None;
            }
            Target::Segment(n.parse().ok()?)
        }
    };
    Some((id, target))
}

/// `Range` 헤더를 읽은 결과(첫 구간만).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RangeReq {
    /// 헤더 없음: `bytes=0-`로 본다
    Absent,
    /// 문법 오류
    Invalid,
    /// `a-b`·`a-`·`-n`
    Spec {
        start: Option<u64>,
        end: Option<u64>,
    },
}

fn parse_range(h: Option<&str>) -> RangeReq {
    let Some(h) = h else {
        return RangeReq::Absent;
    };
    let Some(specs) = h.trim().strip_prefix("bytes=") else {
        return RangeReq::Invalid;
    };
    // 재생기는 여러 구간을 보내지 않는다. 오면 첫 구간만 본다(206 한 구간)
    let first = specs.split(',').next().unwrap_or("").trim();
    let Some((a, b)) = first.split_once('-') else {
        return RangeReq::Invalid;
    };
    let num = |s: &str| -> Result<Option<u64>, ()> {
        let s = s.trim();
        if s.is_empty() {
            Ok(None)
        } else {
            s.parse().map(Some).map_err(|_| ())
        }
    };
    match (num(a), num(b)) {
        (Ok(None), Ok(None)) | (Err(()), _) | (_, Err(())) => RangeReq::Invalid,
        (Ok(start), Ok(end)) => RangeReq::Spec { start, end },
    }
}

/// 요청 구간 → 업스트림에 보낼 닫힌 `(시작, 끝)`. 만족할 수 없으면 `None`(`416`).
/// 끝은 `시작 + CHUNK - 1`과 `total - 1`로 자른다(PV3).
fn resolve_range(r: RangeReq, total: u64) -> Option<(u64, u64)> {
    let (start, end) = match r {
        RangeReq::Invalid => return None,
        RangeReq::Absent => (0, u64::MAX),
        RangeReq::Spec {
            start: Some(a),
            end: b,
        } => {
            if b.is_some_and(|b| b < a) {
                return None;
            }
            (a, b.unwrap_or(u64::MAX))
        }
        // 접미(`bytes=-n`): 끝에서 n바이트
        RangeReq::Spec {
            start: None,
            end: Some(n),
        } => {
            // `-0`은 시작이 total이 되어 아래 검사에서 416이다
            (total.saturating_sub(n), u64::MAX)
        }
        RangeReq::Spec {
            start: None,
            end: None,
        } => return None,
    };
    if start >= total {
        return None;
    }
    let end = end.min(start.saturating_add(CHUNK - 1)).min(total - 1);
    Some((start, end))
}

/// 응답을 만든다. 모든 응답에 `Vary: Origin`·`Cache-Control: no-store`를 붙이고, `cors`가 있으면 ACAO를 붙인다(PV11).
fn reply(
    cors: Option<&str>,
    status: u16,
    extra: &[(&'static str, String)],
    body: Vec<u8>,
) -> Response<Vec<u8>> {
    let mut b = Response::builder()
        .status(status)
        .header("cache-control", "no-store")
        .header("vary", "Origin");
    if let Some(o) = cors {
        b = b.header("access-control-allow-origin", o);
    }
    for (k, v) in extra {
        b = b.header(*k, v.as_str());
    }
    b.body(body).unwrap_or_else(|_| {
        let mut r = Response::new(Vec::new());
        *r.status_mut() = http::StatusCode::INTERNAL_SERVER_ERROR;
        r
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Debug는 서명 주소를 찍지 않는다(비밀값 규칙): mp4는 `redact_url`을 거치고 HLS는 조각 수·지문만 보인다.
    #[test]
    fn origin_and_state_debug_hide_signed_urls() {
        let signed = Url::parse("https://media.example.invalid/a.mp4?hdnts=SIGNEDSECRET").unwrap();
        let mp4 = Origin::Mp4 {
            url: signed.clone(),
            total: 100,
        };
        let hls = Origin::Hls(Arc::new(HlsOrigin {
            init: signed.clone(),
            segments: vec![signed.clone(), signed],
            crc: 7,
            playlist: String::new(),
        }));
        let mp4_text = format!("{mp4:?}");
        assert!(
            mp4_text.contains("Mp4") && mp4_text.contains("100"),
            "{mp4_text}"
        );
        let hls_text = format!("{hls:?}");
        assert!(
            hls_text.contains("Hls")
                && hls_text.contains("segments: 2")
                && hls_text.contains("crc: 7"),
            "{hls_text}"
        );
        let state = SourceState {
            generation: 3,
            origin: mp4,
            refreshes: 2,
            last_used: tokio::time::Instant::now(),
        };
        let state_text = format!("{state:?}");
        assert!(
            state_text.contains("generation: 3") && state_text.contains("refreshes: 2"),
            "{state_text}"
        );
        for text in [mp4_text, hls_text, state_text] {
            assert!(
                !text.contains("SIGNEDSECRET") && !text.contains("hdnts"),
                "{text}"
            );
        }
    }

    /// 응답을 만들 수 없는 헤더 값이 오면 빈 500으로 떨어진다(패닉 없이).
    #[test]
    fn reply_falls_back_to_500_on_bad_header() {
        let r = reply(None, 200, &[("x-bad", "줄바꿈\n".into())], b"x".to_vec());
        assert_eq!(r.status().as_u16(), 500);
        assert!(r.body().is_empty());
    }

    #[test]
    fn path_forms() {
        let id = "ab".repeat(16);
        let id = id.as_str();
        let p = |s: &str| parse_path(&format!("/{id}{s}")).map(|(_, t)| t);
        assert_eq!(p("/v"), Some(Target::Video));
        assert_eq!(p("/pl.m3u8"), Some(Target::Playlist));
        assert_eq!(p("/init"), Some(Target::Init));
        assert_eq!(p("/s/0"), Some(Target::Segment(0)));
        assert_eq!(p("/s/4294967295"), Some(Target::Segment(4_294_967_295)));
        for bad in [
            "/s/01",
            "/s/-1",
            "/s/+1",
            "/s/",
            "/s/12345678901",
            "/s/1a",
            "/v/",
            "/x",
        ] {
            assert_eq!(p(bad), None, "{bad}");
        }
        assert!(parse_path(&format!("/{}/v", id.to_uppercase())).is_none());
        assert!(parse_path(&format!("/{}0/v", id)).is_none());
        assert!(parse_path("/v").is_none());
    }

    #[test]
    fn range_resolution() {
        use RangeReq::*;
        let spec = |s, e| Spec { start: s, end: e };
        assert_eq!(resolve_range(Absent, 100), Some((0, 99)));
        assert_eq!(resolve_range(spec(Some(10), None), 100), Some((10, 99)));
        assert_eq!(resolve_range(spec(Some(10), Some(20)), 100), Some((10, 20)));
        assert_eq!(
            resolve_range(spec(Some(90), Some(200)), 100),
            Some((90, 99))
        );
        assert_eq!(resolve_range(spec(Some(100), None), 100), None);
        assert_eq!(resolve_range(spec(Some(5), Some(3)), 100), None);
        assert_eq!(resolve_range(spec(None, Some(10)), 100), Some((90, 99)));
        assert_eq!(resolve_range(spec(None, Some(500)), 100), Some((0, 99)));
        assert_eq!(resolve_range(spec(None, Some(0)), 100), None);
        assert_eq!(resolve_range(Invalid, 100), None);
        // 조각 상한
        let total = CHUNK * 3;
        assert_eq!(
            resolve_range(spec(Some(7), None), total),
            Some((7, 7 + CHUNK - 1))
        );
        // 끝 구간은 total에서 자른다
        assert_eq!(
            resolve_range(spec(Some(total - 3), None), total),
            Some((total - 3, total - 1))
        );
    }

    #[test]
    fn range_header_parsing() {
        use RangeReq::*;
        assert_eq!(parse_range(None), Absent);
        assert_eq!(
            parse_range(Some("bytes=0-")),
            Spec {
                start: Some(0),
                end: None
            }
        );
        assert_eq!(
            parse_range(Some("bytes=-5")),
            Spec {
                start: None,
                end: Some(5)
            }
        );
        assert_eq!(
            parse_range(Some("bytes=1-2,5-6")),
            Spec {
                start: Some(1),
                end: Some(2)
            }
        );
        for bad in [
            "bytes=-",
            "bytes=",
            "bytes=a-b",
            "bytes=1-2-3",
            "items=0-1",
            "0-1",
        ] {
            assert_eq!(parse_range(Some(bad)), Invalid, "{bad}");
        }
    }
}
