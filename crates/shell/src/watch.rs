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
//! - 이 단계(PV-2)는 mp4(PD)만 중계한다. HLS 경로는 PV-5에서 더한다.
//!
//! `handle`은 Tauri에 의존하지 않는 결정 함수라 셸 테스트가 직접 부른다. 앱 크레이트(`watch_protocol`)가 얇게 감싼다.

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use chzzk_core::http::redact_url;
use chzzk_core::mpd::select_pd;
use chzzk_core::{
    ContentRef, Error, PdRep, RangeChunk, RequestKind, Source, WatchFail, parse_content_url,
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

/// 원천 상태: 재조회가 바꾸는 것들.
struct SourceState {
    /// 재조회로 주소가 바뀔 때마다 1씩 는다
    generation: u64,
    /// 서명 주소. 래퍼 없이 두고 `Debug`에는 `redact_url`만 쓴다(app.md 구현 중 변경에 적음)
    url: Url,
    /// 열 때 정한 전체 길이. 바뀌면 영상이 바뀐 것이다(`409`)
    total: u64,
    refreshes: u8,
    last_used: tokio::time::Instant,
}

impl fmt::Debug for SourceState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SourceState")
            .field("generation", &self.generation)
            .field("url", &redact_url(&self.url))
            .field("total", &self.total)
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

    /// `(세대, 주소, total)`
    fn snapshot(&self) -> (u64, Url, u64) {
        let s = self.state();
        (s.generation, s.url.clone(), s.total)
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
        let reps = match resolved.source {
            Source::Progressive { reps } => reps,
            // 빠른 다시보기는 PV-5부터다
            Source::LiveRewindHls { .. } => {
                return Err(AppError::invalid_input("이 영상은 아직 미리볼 수 없습니다"));
            }
            Source::Live { .. } => {
                return Err(AppError::invalid_input("생방송은 미리볼 수 없습니다"));
            }
        };
        let rep = pick_lowest(&reps)
            .ok_or_else(|| AppError::invalid_input("미리볼 수 있는 화질이 없습니다"))?;

        // total은 열 때 한 번 정한다(PV3). 이후 조각은 이 값과 같아야 한다
        let probe = client
            .watch_range(&rep.url, 0, 0, None)
            .await
            .map_err(open_error)?;

        let id = new_id();
        let session = Arc::new(Session {
            id: id.clone(),
            content: content.clone(),
            me,
            quality_id: rep.quality.id.clone(),
            kind: WatchKindDto::Mp4,
            state: Mutex::new(SourceState {
                generation: 0,
                url: rep.url.clone(),
                total: probe.total,
                refreshes: 0,
                last_used: tokio::time::Instant::now(),
            }),
            refresh: tokio::sync::Mutex::new(()),
        });
        // 이전 세션은 이 교체로 버려진다(PV5)
        *self.current.lock().unwrap_or_else(PoisonError::into_inner) = Some(session);
        tracing::debug!(session = short(&id), quality = %rep.quality.id, "미리보기 세션을 열었다");
        Ok(WatchOpenDto {
            src: format!("{}/{id}/v", self.endpoints().base),
            id,
            kind: WatchKindDto::Mp4,
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
        // PV-2는 mp4 세션만 있다: 다른 경로는 모두 없는 주소다
        if session.kind != WatchKindDto::Mp4 || target != Target::Video {
            return plain(404);
        }

        let (_, _, total) = session.snapshot();
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
        match self.fetch_chunk(&session, start, end).await {
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

    /// 업스트림에서 한 조각을 받는다. 403이면 세션 안에서 한 번 재조회하고 같은 요청을 1회 다시 보낸다(PV7).
    /// 실패는 응답 상태 코드로 돌려준다.
    async fn fetch_chunk(&self, s: &Arc<Session>, start: u64, end: u64) -> Result<RangeChunk, u16> {
        let client = (self.client)();
        let (generation, url, total) = s.snapshot();
        match client.watch_range(&url, start, end, Some(total)).await {
            Ok(c) => self.check_chunk(s, c, total, start, end),
            Err(WatchFail::Expired) => {
                let url = self.refresh(s, generation).await?;
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
    async fn refresh(&self, s: &Arc<Session>, used_gen: u64) -> Result<Url, u16> {
        let _one_at_a_time = s.refresh.lock().await;
        if !self.is_current(s) {
            return Err(404);
        }
        {
            let mut st = s.state();
            if st.generation > used_gen {
                return Ok(st.url.clone());
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
        // 재조회 중에 닫힘·새 open·로그아웃이 있었으면 결과를 버린다
        if !self.is_current(s) {
            return Err(404);
        }
        let new_url = match resolved.source {
            Source::Progressive { reps } => match select_pd(&reps, &s.quality_id) {
                Ok(rep) => rep.url.clone(),
                Err(_) => {
                    self.drop_if_current(s);
                    return Err(409);
                }
            },
            // 재생 방식이 바뀌었다
            _ => {
                self.drop_if_current(s);
                return Err(409);
            }
        };
        // 세대를 바꾸는 곳은 여기뿐이고 재조회 잠금을 쥐고 있으므로 세대는 `used_gen`에서 그대로다
        let mut st = s.state();
        st.url = new_url.clone();
        st.generation += 1;
        Ok(new_url)
    }
}

/// 가장 낮은 비디오 화질(PV13). 오디오만 행은 뺀다. 짧은 변을 모르면 가장 높은 것으로 본다. 같으면 앞의 것.
fn pick_lowest(reps: &[PdRep]) -> Option<&PdRep> {
    reps.iter()
        .filter(|r| !r.quality.audio_only)
        .min_by_key(|r| {
            r.quality
                .resolution
                .or(r.quality.height)
                .unwrap_or(u32::MAX)
        })
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
