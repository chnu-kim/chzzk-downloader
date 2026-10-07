//! `AuthService`: 앱 로그인 상태 머신(worker.md §11.3·§11.4, 구현 중 변경 A1-1~A1-6).
//!
//! `WorkerApi`·`Clock`을 주입받아 Tauri 없이 검사한다. 상태 잠금(`std::sync::Mutex`)은 `await`를 넘겨 잡지 않는다.
//! 로그에는 낱말·숫자만 남긴다(토큰·pollSecret·loginId·로그인 주소·채널 정보·Worker 주소 금지).

use std::fmt;
use std::sync::{Mutex, MutexGuard, PoisonError};

use chzzk_core::Secret;
use time::OffsetDateTime;
use tokio::sync::{Mutex as AsyncMutex, watch};
use tracing::{info, warn};

use super::api::{ApiError, LoginUrl, PollResponse, StartRequest, WorkerApi};
use super::clock::Clock;
use super::session::{LoadOutcome, SessionStore, StoreError, StoredSession};
use super::status::{AuthPhase, AuthReason};
use super::token;
use super::verify::{
    Cause, FOCUS_MIN_GAP, LOGIN_TTL, LoadDecision, Next, VerifyOutcome, classify_verify,
    is_lost_response, load_decision, outcome_of_error, refresh_due_at, retry_delay,
};
use crate::error::AppError;

/// 시작 판정 이후 화면·command가 보는 대기 중 로그인 정보
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingInfo {
    /// 확인 코드
    pub user_code: String,
    /// 로컬 기한(start 요청 직전 + 10분)
    pub expires_at: OffsetDateTime,
}

/// 오프라인 유예 정보
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OfflineInfo {
    /// 오프라인이 시작된 시각
    pub since: OffsetDateTime,
    /// 유예 끝
    pub grace_until: OffsetDateTime,
    /// 원인
    pub cause: Cause,
}

/// 화면·command가 보는 상태 한 장(비밀 없음 → Debug 파생 가능)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthStatus {
    /// 단계
    pub phase: AuthPhase,
    /// 사유
    pub reason: Option<AuthReason>,
    /// 채널 ID
    pub channel_id: Option<String>,
    /// 채널 이름
    pub channel_name: Option<String>,
    /// 관리자 여부
    pub is_admin: bool,
    /// 대기 중 로그인
    pub pending: Option<PendingInfo>,
    /// 오프라인 유예
    pub offline: Option<OfflineInfo>,
    /// 마지막 서버 확인 시각
    pub verified_at: Option<OffsetDateTime>,
}

/// 확인 페이지를 열 주소(A2가 opener로 연다)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoginTicket {
    /// 확인 페이지 주소
    pub login_url: LoginUrl,
}

/// `begin_login` 결과
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BeginLogin {
    /// 새 로그인을 시작했다
    Started(LoginTicket),
    /// 이미 진행 중이다(같은 티켓)
    AlreadyPending(LoginTicket),
    /// 이미 로그인되어 있다
    AlreadySignedIn,
    /// 시작하지 못했다(상태는 `Error`)
    Failed,
    /// start 요청 중에 취소·로그아웃되어 결과를 버렸다(상태는 그대로, 확인 페이지를 열지 않는다)
    Discarded,
}

/// `tick`을 부른 까닭(D20)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trigger {
    /// 타이머
    Timer,
    /// 창 포커스
    Focus,
    /// 절전 복귀
    Resume,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FirstOnline {
    NotYet,
    Ready,
    Taken,
}

struct OfflineTrack {
    since: OffsetDateTime,
    grace_until: OffsetDateTime,
    cause: Cause,
    failures: u32,
    next_retry_at: OffsetDateTime,
}

struct Login {
    seq: u64,
    login_id: Secret<String>,
    poll_secret: Secret<String>,
    user_code: String,
    login_url: LoginUrl,
    deadline: OffsetDateTime,
    interval: std::time::Duration,
    last_transient: Option<Cause>,
}

struct Inner {
    phase: AuthPhase,
    reason: Option<AuthReason>,
    held: Option<StoredSession>,
    /// D10: 메모리 held가 파일보다 새롭다
    dirty: bool,
    /// D11: logout·로그인 ok 때 +1
    session_epoch: u64,
    /// single-flight: refresh가 끝날 때마다 +1
    refresh_gen: u64,
    offline: Option<OfflineTrack>,
    last_attempt: Option<OffsetDateTime>,
    login: Option<Login>,
    login_seq: u64,
    denied_name: Option<String>,
    first_online: FirstOnline,
}

fn cause_reason(c: Cause) -> AuthReason {
    match c {
        Cause::Network => AuthReason::Network,
        Cause::Server => AuthReason::Server,
    }
}

fn cause_word(c: Cause) -> &'static str {
    match c {
        Cause::Network => "network",
        Cause::Server => "server",
    }
}

/// 오류 → 원인(폴링·시작 실패용)
fn cause_of(e: &ApiError) -> Cause {
    match e {
        ApiError::Transport { .. } | ApiError::NotWorker { .. } => Cause::Network,
        ApiError::Worker { .. } | ApiError::Contract { .. } => Cause::Server,
    }
}

/// 실행 중에 시계가 되돌려졌는가: 마지막 서버 확인·마지막 시도보다 지금이 이르다(§11.3 "now < verifiedAt이면 유예하지 않는다").
/// 그러면 예정 시각을 기다리지 않고 바로 갱신한다(성공하면 verifiedAt이 새 시계로, 실패하면 유예 밖으로 판정된다)
fn clock_rolled_back(i: &Inner, now: OffsetDateTime) -> bool {
    i.held.as_ref().is_some_and(|h| now < h.verified_at) || i.last_attempt.is_some_and(|a| now < a)
}

/// 상태 표시 규칙(worker.md §11.4)
fn status_of(i: &Inner) -> AuthStatus {
    let held_visible = matches!(i.phase, AuthPhase::SignedIn | AuthPhase::Checking)
        || (i.phase == AuthPhase::Expired && i.reason == Some(AuthReason::GraceExpired));
    let held = i.held.as_ref().filter(|_| held_visible);
    let verified_visible = held_visible || i.phase == AuthPhase::Pending;
    AuthStatus {
        phase: i.phase,
        reason: i.reason,
        channel_id: held.map(|h| h.channel_id.clone()),
        channel_name: match i.phase {
            AuthPhase::Denied => i.denied_name.clone(),
            _ => held.map(|h| h.channel_name.clone()),
        },
        is_admin: held.is_some_and(|h| h.is_admin),
        pending: match (&i.phase, &i.login) {
            (AuthPhase::Pending, Some(l)) => Some(PendingInfo {
                user_code: l.user_code.clone(),
                expires_at: l.deadline,
            }),
            _ => None,
        },
        offline: match (&i.phase, &i.offline) {
            (AuthPhase::SignedIn, Some(t)) => Some(OfflineInfo {
                since: t.since,
                grace_until: t.grace_until,
                cause: t.cause,
            }),
            _ => None,
        },
        verified_at: i
            .held
            .as_ref()
            .filter(|_| verified_visible)
            .map(|h| h.verified_at),
    }
}

/// 앱 로그인 상태 머신
pub struct AuthService<A: WorkerApi, C: Clock> {
    api: A,
    clock: C,
    store: SessionStore,
    inner: Mutex<Inner>,
    refresh_lock: AsyncMutex<()>,
    login_lock: AsyncMutex<()>,
    tx: watch::Sender<AuthStatus>,
    client: String,
}

impl<A: WorkerApi, C: Clock> fmt::Debug for AuthService<A, C> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let phase = self.lock().phase;
        f.debug_struct("AuthService")
            .field("phase", &phase)
            .finish_non_exhaustive()
    }
}

impl<A: WorkerApi, C: Clock> AuthService<A, C> {
    /// session.json을 읽어 첫 상태를 정한다(동기, 네트워크 없음, D8·D21).
    /// `client`는 `auth::client_label(앱 버전)`(Worker `/auth/start`의 client)
    pub fn open(api: A, clock: C, store: SessionStore, client: String) -> Self {
        let now = clock.now();
        let mut inner = Inner {
            phase: AuthPhase::SignedOut,
            reason: None,
            held: None,
            dirty: false,
            session_epoch: 0,
            refresh_gen: 0,
            offline: None,
            last_attempt: None,
            login: None,
            login_seq: 0,
            denied_name: None,
            first_online: FirstOnline::NotYet,
        };
        match store.load() {
            LoadOutcome::Loaded(s) => {
                match load_decision(now, s.verified_at, s.refresh_expires_at) {
                    LoadDecision::Optimistic => {
                        info!(result = "optimistic", "앱 세션 읽기");
                        inner.phase = AuthPhase::SignedIn;
                        inner.held = Some(s);
                    }
                    LoadDecision::Checking => {
                        info!(result = "checking", "앱 세션 읽기");
                        inner.phase = AuthPhase::Checking;
                        inner.held = Some(s);
                    }
                    LoadDecision::CapPassed => {
                        warn!(result = "cap_passed", "앱 세션 읽기");
                        if let Err(e) = store.clear() {
                            warn!(op = e.op, "session.json을 지우지 못함");
                        }
                        inner.phase = AuthPhase::Expired;
                        inner.reason = Some(AuthReason::SessionExpired);
                    }
                }
            }
            LoadOutcome::Missing => {}
            LoadOutcome::OtherOrigin => warn!(result = "other_origin", "앱 세션 읽기"),
            LoadOutcome::Corrupt => warn!(result = "corrupt", "앱 세션 읽기"),
            LoadOutcome::Unreadable => warn!(result = "unreadable", "앱 세션 읽기"),
        }
        let (tx, _) = watch::channel(status_of(&inner));
        Self {
            api,
            clock,
            store,
            inner: Mutex::new(inner),
            refresh_lock: AsyncMutex::new(()),
            login_lock: AsyncMutex::new(()),
            tx,
            client,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn publish(&self, inner: &Inner) {
        self.tx.send_if_modified(|cur| {
            let new = status_of(inner);
            if *cur != new {
                *cur = new;
                true
            } else {
                false
            }
        });
    }

    /// 지금 상태
    pub fn status(&self) -> AuthStatus {
        status_of(&self.lock())
    }

    /// 상태 변화 구독
    pub fn subscribe(&self) -> watch::Receiver<AuthStatus> {
        self.tx.subscribe()
    }

    /// 새 세션을 받아 쓴다(D10: 쓰기가 실패해도 메모리가 권위다). refresh 성공·로그인 ok 공용.
    fn accept_session(&self, i: &mut Inner, new: StoredSession) {
        match self.store.save(&new) {
            Ok(()) => i.dirty = false,
            Err(e) => {
                i.dirty = true;
                warn!(op = e.op, "session.json을 쓰지 못함(메모리 세션으로 계속)");
            }
        }
        i.held = Some(new);
        i.offline = None;
        i.login = None;
        i.denied_name = None;
        i.phase = AuthPhase::SignedIn;
        i.reason = None;
        if i.first_online == FirstOnline::NotYet {
            i.first_online = FirstOnline::Ready;
        }
    }

    /// 세션을 버린다(파일·메모리)
    fn drop_session(&self, i: &mut Inner) {
        if let Err(e) = self.store.clear() {
            warn!(op = e.op, "session.json을 지우지 못함");
        }
        i.held = None;
        i.offline = None;
        i.dirty = false;
    }

    /// 쓰기에 실패했던 메모리 세션을 다시 쓴다
    fn try_flush(&self, i: &mut Inner) {
        if i.dirty
            && let Some(h) = &i.held
            && self.store.save(h).is_ok()
        {
            i.dirty = false;
        }
    }

    /// 시작 직후 한 번: held가 있고 SignedIn(낙관)·Checking이면 refresh
    pub async fn startup(&self) -> AuthStatus {
        let go = {
            let i = self.lock();
            i.held.is_some() && matches!(i.phase, AuthPhase::SignedIn | AuthPhase::Checking)
        };
        if go {
            self.refresh_inner().await
        } else {
            self.status()
        }
    }

    /// 지금 갱신(`auth_retry`, [다시 연결]). held가 없으면 아무것도 안 한다
    pub async fn refresh(&self) -> AuthStatus {
        self.refresh_inner().await
    }

    async fn refresh_inner(&self) -> AuthStatus {
        let gen0 = self.lock().refresh_gen;
        let _g = self.refresh_lock.lock().await;
        let (sess, epoch) = {
            let mut i = self.lock();
            if i.refresh_gen != gen0 {
                // 다른 호출이 방금 끝냈다(single-flight)
                return status_of(&i);
            }
            let Some(sess) = i.held.clone() else {
                return status_of(&i);
            };
            self.try_flush(&mut i);
            let epoch = i.session_epoch;
            if !matches!(i.phase, AuthPhase::SignedIn | AuthPhase::Pending) {
                i.phase = AuthPhase::Checking;
                i.reason = None;
            }
            i.last_attempt = Some(self.clock.now());
            self.publish(&i);
            (sess, epoch)
        };

        let mut res = self.api.refresh(&sess.refresh_token).await;
        let mut retried = false;
        if let Err(e) = &res
            && is_lost_response(e)
        {
            // D9: 요청이 서버에 닿았는지 모르는 경우만 같은 토큰으로 즉시 1회
            retried = true;
            res = self.api.refresh(&sess.refresh_token).await;
        }

        let now = self.clock.now();
        let mut i = self.lock();
        i.refresh_gen += 1;
        if i.session_epoch != epoch {
            info!(result = "discarded", retried, "앱 세션 갱신");
            return status_of(&i);
        }
        match res {
            Ok(b) => {
                self.accept_session(&mut i, StoredSession::from_bundle(b, now));
                info!(result = "ok", retried, "앱 세션 갱신");
            }
            Err(e) => self.apply_refresh_error(&mut i, &sess, now, &e, retried),
        }
        self.publish(&i);
        status_of(&i)
    }

    fn apply_refresh_error(
        &self,
        i: &mut Inner,
        sess: &StoredSession,
        now: OffsetDateTime,
        e: &ApiError,
        retried: bool,
    ) {
        let outcome = outcome_of_error(e, retried);
        let pending = i.phase == AuthPhase::Pending;
        let cause = match outcome {
            VerifyOutcome::Transient(c) => Some(c),
            _ => None,
        };
        let next = classify_verify(now, sess.verified_at, sess.refresh_expires_at, outcome);
        let result = match next {
            Next::Online => "ok",
            Next::Offline { grace_until, cause } => {
                let t = i.offline.get_or_insert(OfflineTrack {
                    since: now,
                    grace_until,
                    cause,
                    failures: 0,
                    next_retry_at: now,
                });
                t.grace_until = grace_until;
                t.cause = cause;
                t.failures += 1;
                t.next_retry_at = now + retry_delay(t.failures);
                if !pending {
                    i.phase = AuthPhase::SignedIn;
                    i.reason = Some(cause_reason(cause));
                }
                "offline"
            }
            Next::Expired {
                reason,
                delete_file: true,
            } => {
                self.drop_session(i);
                if !pending {
                    i.phase = AuthPhase::Expired;
                    i.reason = Some(reason);
                }
                match reason {
                    AuthReason::Revoked => "revoked",
                    AuthReason::ReuseDetected => "reuse",
                    _ => "session_expired",
                }
            }
            Next::Expired {
                reason,
                delete_file: false,
            } => {
                i.offline = None;
                if !pending {
                    i.phase = AuthPhase::Expired;
                    i.reason = Some(reason);
                }
                "grace_expired"
            }
            Next::Denied => {
                let name = sess.channel_name.clone();
                self.drop_session(i);
                if !pending {
                    i.phase = AuthPhase::Denied;
                    i.reason = Some(AuthReason::RemovedFromAllowlist);
                    i.denied_name = Some(name);
                }
                "denied"
            }
        };
        match cause {
            Some(c) => info!(result, cause = cause_word(c), retried, "앱 세션 갱신"),
            None => info!(result, retried, "앱 세션 갱신"),
        }
    }

    /// 타이머·포커스·절전 복귀(D20)
    pub async fn tick(&self, trigger: Trigger) -> AuthStatus {
        let now = self.clock.now();
        let go = {
            let mut i = self.lock();
            self.try_flush(&mut i);
            match (i.phase, &i.held, &i.offline) {
                (AuthPhase::SignedIn, Some(_), _) if clock_rolled_back(&i, now) => true,
                (AuthPhase::SignedIn, Some(h), None) => {
                    now >= refresh_due_at(h.verified_at, h.access_expires_at)
                }
                (AuthPhase::SignedIn, Some(_), Some(t)) => {
                    now >= t.grace_until
                        || match trigger {
                            Trigger::Timer => now >= t.next_retry_at,
                            Trigger::Focus | Trigger::Resume => {
                                i.last_attempt.is_none_or(|a| now - a >= FOCUS_MIN_GAP)
                            }
                        }
                }
                _ => false,
            }
        };
        if go {
            self.refresh_inner().await
        } else {
            self.status()
        }
    }

    /// 다음에 `tick`을 부를 시각. SignedIn 온라인: `refresh_due_at`, 오프라인: `min(next_retry_at, grace_until)`,
    /// 시계가 되돌려졌으면 지금, 그 밖 None
    pub fn next_wake(&self) -> Option<OffsetDateTime> {
        let now = self.clock.now();
        let i = self.lock();
        if i.phase != AuthPhase::SignedIn {
            return None;
        }
        let h = i.held.as_ref()?;
        if clock_rolled_back(&i, now) {
            return Some(now);
        }
        match &i.offline {
            None => Some(refresh_due_at(h.verified_at, h.access_expires_at)),
            Some(t) => Some(t.next_retry_at.min(t.grace_until)),
        }
    }

    /// 로그인 시작(D13·D16). `SignedIn`이 아니면 언제나 시작한다(저장 세션은 그대로 둔다).
    pub async fn begin_login(&self) -> BeginLogin {
        let _g = self.login_lock.lock().await;
        let seq0 = {
            let i = self.lock();
            if i.phase == AuthPhase::Pending
                && let Some(l) = &i.login
            {
                return BeginLogin::AlreadyPending(LoginTicket {
                    login_url: l.login_url.clone(),
                });
            }
            if i.phase == AuthPhase::SignedIn {
                return BeginLogin::AlreadySignedIn;
            }
            i.login_seq
        };
        let secret = token::new_poll_secret();
        let verifier = token::poll_verifier(secret.expose());
        let t0 = self.clock.now();
        let res = self
            .api
            .start(&StartRequest {
                poll_verifier: verifier,
                client: self.client.clone(),
            })
            .await;
        let mut i = self.lock();
        if i.login_seq != seq0 {
            // 요청 중에 취소·로그아웃됐다: 성공이든 실패든 결과를 버리고 상태를 건드리지 않는다
            info!(result = "discarded", "로그인 시작");
            return BeginLogin::Discarded;
        }
        if i.phase == AuthPhase::SignedIn {
            // 요청 중에 refresh가 성공했다: 성공이든 실패든 로그인·오류 화면으로 뒤집지 않는다
            return BeginLogin::AlreadySignedIn;
        }
        let out = match res {
            Ok(r) => {
                i.login_seq += 1;
                let ticket = LoginTicket {
                    login_url: r.login_url.clone(),
                };
                i.login = Some(Login {
                    seq: i.login_seq,
                    login_id: r.login_id,
                    poll_secret: secret,
                    user_code: r.user_code,
                    login_url: r.login_url,
                    deadline: t0 + LOGIN_TTL,
                    interval: r.poll_interval,
                    last_transient: None,
                });
                i.phase = AuthPhase::Pending;
                i.reason = None;
                i.denied_name = None;
                info!(result = "started", "로그인 시작");
                BeginLogin::Started(ticket)
            }
            Err(e) => {
                let cause = match outcome_of_error(&e, false) {
                    VerifyOutcome::Transient(c) => c,
                    _ => Cause::Server,
                };
                i.login = None;
                i.phase = AuthPhase::Error;
                i.reason = Some(cause_reason(cause));
                info!(result = "failed", cause = cause_word(cause), "로그인 시작");
                BeginLogin::Failed
            }
        };
        self.publish(&i);
        out
    }

    /// 폴링 한 번(D14). 로그인이 없으면 현재 상태
    pub async fn poll_login_once(&self) -> AuthStatus {
        self.poll_step(None).await.0
    }

    /// 로그인 종결(held는 건드리지 않는다, D19)
    fn end_login(i: &mut Inner, phase: AuthPhase, reason: Option<AuthReason>) {
        i.login = None;
        i.phase = phase;
        i.reason = reason;
        i.denied_name = None;
    }

    /// 기한 도달: 마지막 결과가 일시 오류면 오류, 아니면 시간 초과
    fn finish_timeout(i: &mut Inner) {
        let last = i.login.as_ref().and_then(|l| l.last_transient);
        match last {
            Some(c) => {
                info!(result = cause_word(c), "로그인 끝");
                Self::end_login(i, AuthPhase::Error, Some(cause_reason(c)));
            }
            None => {
                info!(result = "timeout", "로그인 끝");
                Self::end_login(i, AuthPhase::Expired, Some(AuthReason::LoginTimeout));
            }
        }
    }

    async fn poll_step(&self, expect_seq: Option<u64>) -> (AuthStatus, bool) {
        let (seq, id, secret) = {
            let mut i = self.lock();
            let Some(l) = &i.login else {
                return (status_of(&i), false);
            };
            if expect_seq.is_some_and(|s| s != l.seq) {
                return (status_of(&i), false);
            }
            if self.clock.now() >= l.deadline {
                Self::finish_timeout(&mut i);
                self.publish(&i);
                return (status_of(&i), false);
            }
            (l.seq, l.login_id.clone(), l.poll_secret.clone())
        };
        let res = self.api.poll(&id, &secret).await;
        let now = self.clock.now();
        let mut i = self.lock();
        let Some(l) = i.login.as_mut() else {
            return (status_of(&i), false);
        };
        if l.seq != seq {
            // 취소·새 로그인 뒤 도착한 응답은 버린다
            return (status_of(&i), false);
        }
        let past_deadline = now >= l.deadline;
        match res {
            Ok(PollResponse::Pending) => {
                l.last_transient = None;
                if past_deadline {
                    Self::finish_timeout(&mut i);
                }
            }
            Ok(PollResponse::Ok(b)) => {
                i.session_epoch += 1;
                self.accept_session(&mut i, StoredSession::from_bundle(b, now));
                info!(result = "ok", "로그인 끝");
            }
            Ok(PollResponse::Denied { channel_name }) => {
                info!(result = "denied", "로그인 끝");
                Self::end_login(&mut i, AuthPhase::Denied, None);
                i.denied_name = Some(channel_name);
            }
            Ok(PollResponse::Cancelled) => {
                info!(result = "cancelled", "로그인 끝");
                Self::end_login(&mut i, AuthPhase::Cancelled, None);
            }
            Ok(PollResponse::Failed { code }) => {
                info!(result = "failed", code = code.as_str(), "로그인 끝");
                Self::end_login(&mut i, AuthPhase::Error, Some(AuthReason::Server));
            }
            Err(ApiError::Worker { status: 404, .. }) => {
                if past_deadline {
                    info!(result = "timeout", "로그인 끝");
                    Self::end_login(&mut i, AuthPhase::Expired, Some(AuthReason::LoginTimeout));
                } else {
                    info!(result = "lost", "로그인 끝");
                    Self::end_login(&mut i, AuthPhase::Error, Some(AuthReason::LoginLost));
                }
            }
            Err(ApiError::Worker { status: 429, code }) if code == "too_soon" => {}
            Err(e) => {
                l.last_transient = Some(cause_of(&e));
                if past_deadline {
                    Self::finish_timeout(&mut i);
                }
            }
        }
        self.publish(&i);
        let more = i.phase == AuthPhase::Pending && i.login.is_some();
        (status_of(&i), more)
    }

    /// 로그인이 끝날 때까지 간격마다 폴링(A2가 spawn). 끝난 상태를 돌려준다
    pub async fn run_login_poll(&self) -> AuthStatus {
        // 잠금 guard가 `match` 끝까지 살아 있어 안에서 `self.status()`를 부르면 교착한다: 값만 꺼내 먼저 푼다.
        let seq = self.lock().login.as_ref().map(|l| l.seq);
        let Some(seq) = seq else {
            return self.status();
        };
        loop {
            let interval = self
                .lock()
                .login
                .as_ref()
                .filter(|l| l.seq == seq)
                .map(|l| l.interval);
            let Some(interval) = interval else {
                return self.status();
            };
            tokio::time::sleep(interval).await;
            let (st, more) = self.poll_step(Some(seq)).await;
            if !more {
                return st;
            }
        }
    }

    /// Pending일 때 확인 페이지 주소(`auth_reopen`·`auth_copy_login_url`)
    pub fn login_ticket(&self) -> Option<LoginTicket> {
        let i = self.lock();
        match (&i.phase, &i.login) {
            (AuthPhase::Pending, Some(l)) => Some(LoginTicket {
                login_url: l.login_url.clone(),
            }),
            _ => None,
        }
    }

    /// 로그인 취소(D17): 저장 세션이 없으면 `SignedOut`, 유예 안 오프라인이면 `SignedIn`, 아니면 `Expired{GraceExpired}`
    pub fn cancel_login(&self) -> AuthStatus {
        let now = self.clock.now();
        let mut i = self.lock();
        // 진행 중인 start 요청의 결과도 버리게 세대를 올린다(로그인이 아직 없어도)
        i.login_seq += 1;
        if i.login.is_none() {
            return status_of(&i);
        }
        i.login = None;
        let (phase, reason) = match (&i.held, &i.offline) {
            (None, _) => (AuthPhase::SignedOut, None),
            (Some(_), Some(t)) if now < t.grace_until => {
                (AuthPhase::SignedIn, Some(cause_reason(t.cause)))
            }
            (Some(_), _) => (AuthPhase::Expired, Some(AuthReason::GraceExpired)),
        };
        i.phase = phase;
        i.reason = reason;
        self.publish(&i);
        status_of(&i)
    }

    /// 로그아웃(D12): 로컬 먼저, 서버는 그 다음(실패 무시). 파일 삭제 실패면 Err(상태는 그래도 `SignedOut`)
    pub async fn logout(&self) -> Result<AuthStatus, StoreError> {
        let (held, cleared) = {
            let mut i = self.lock();
            let held = i.held.take();
            i.login = None;
            i.login_seq += 1;
            i.offline = None;
            i.dirty = false;
            i.session_epoch += 1;
            let cleared = self.store.clear();
            i.phase = AuthPhase::SignedOut;
            i.reason = None;
            i.denied_name = None;
            self.publish(&i);
            (held, cleared)
        };
        if let Some(h) = held
            && let Err(e) = self
                .api
                .logout(Some(&h.access_token), Some(&h.refresh_token))
                .await
        {
            info!(error = %e, "서버 로그아웃 실패(무시)");
        }
        cleared.map(|()| self.status())
    }

    /// updater(A4)용 access. SignedIn 온라인이고 `now < accessExpiresAt − 60초`면 그대로, 아니면 refresh 뒤 온라인이면 Some
    pub async fn ensure_fresh_access(&self) -> Option<Secret<String>> {
        let now = self.clock.now();
        {
            let i = self.lock();
            if let Some(h) = &i.held {
                if i.phase == AuthPhase::SignedIn
                    && i.offline.is_none()
                    && now < h.access_expires_at - super::verify::ACCESS_SKEW
                {
                    return Some(h.access_token.clone());
                }
            } else {
                return None;
            }
        }
        self.refresh_inner().await;
        let i = self.lock();
        if i.phase == AuthPhase::SignedIn && i.offline.is_none() {
            i.held.as_ref().map(|h| h.access_token.clone())
        } else {
            None
        }
    }

    /// command 층 게이트(D22): `SignedIn`(온라인·오프라인·낙관)이면 Ok, 아니면 `not_logged_in`
    pub fn require_signed_in(&self) -> Result<(), AppError> {
        if self.is_signed_in() {
            Ok(())
        } else {
            Err(AppError::not_logged_in())
        }
    }

    /// `SignedIn`인가
    pub fn is_signed_in(&self) -> bool {
        self.lock().phase == AuthPhase::SignedIn
    }

    /// SignedIn일 때 본인 판정 채널 ID(A5 OwnershipGate)
    pub fn signed_in_channel(&self) -> Option<String> {
        let i = self.lock();
        match (&i.phase, &i.held) {
            (AuthPhase::SignedIn, Some(h)) => Some(h.channel_id.clone()),
            _ => None,
        }
    }

    /// D23: 이 실행에서 처음 `Ok`(refresh 또는 로그인)를 받은 뒤 한 번만 true
    pub fn take_first_online(&self) -> bool {
        let mut i = self.lock();
        if i.first_online == FirstOnline::Ready {
            i.first_online = FirstOnline::Taken;
            true
        } else {
            false
        }
    }
}
