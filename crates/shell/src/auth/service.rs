//! `AuthService`: 앱 로그인 상태 머신(worker.md §11.3·§11.4, 구현 중 변경 47~52).
//!
//! `WorkerApi`·`Clock`을 주입받아 Tauri 없이 검사한다. 상태 잠금(`std::sync::Mutex`)은 `await`를 넘겨 잡지 않고,
//! watch 송신도 상태 잠금을 푼 뒤에 한다(구독자가 `borrow()`를 쥔 채 서비스를 불러도 교착하지 않게, 구현 중 변경 53).
//! 로그에는 낱말·숫자만 남긴다(토큰·loginSecret·grant·state·로그인 주소·포트·채널 정보·Worker 주소 금지).
//!
//! 로그인은 루프백 수령이다(worker.md 구현 중 변경 88·91): `begin_login`이 수신기를 열고 start를 부르면,
//! 브라우저가 grant를 들고 수신기로 돌아오고 `run_login_wait`가 grant와 loginSecret으로 토큰을 수령(redeem)한다.

use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use chzzk_core::Secret;
use time::OffsetDateTime;
use tokio::sync::{Mutex as AsyncMutex, watch};
use tracing::{info, warn};

use super::api::{ApiError, LoginUrl, RedeemResponse, StartRequest, TokenBundle, WorkerApi};
use super::clock::Clock;
use super::loopback::{
    BIND_ATTEMPTS, Bound, CloseHandle, Delivery, GrantRx, GrantSource, LoopbackGrantSource,
    ReceiverPage, is_usable_port,
};
use super::session::{LoadOutcome, SessionStore, StoreError, StoredSession};
use super::status::{AuthPhase, AuthReason};
use super::token;
use super::verify::{
    ACCESS_SKEW, Cause, FOCUS_MIN_GAP, LOGIN_TTL, LOST_RETRY_LAST_SEND, LoadDecision,
    MIN_REFRESH_GAP, Next, VerifyOutcome, classify_verify, is_lost_response, load_decision,
    lost_retry_wait, outcome_of_error, refresh_due_at, retry_delay,
};
use crate::error::AppError;

/// 시작 판정 이후 화면·command가 보는 대기 중 로그인 정보
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingInfo {
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
    /// 저장 세션이 메모리에 있다(= [다시 연결]로 확인할 수 있다, A4)
    pub has_session: bool,
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
    login_secret: Secret<String>,
    login_url: LoginUrl,
    deadline: OffsetDateTime,
    /// 버려지면 수신기가 닫힌다
    #[allow(dead_code)]
    close: CloseHandle,
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
    /// `run_login_wait`가 가져갈 grant 줄(로그인 세대와 함께)
    pending_rx: Option<(u64, GrantRx)>,
    /// 내보낸 상태의 순번(잠금 밖 송신이 순서를 뒤집지 않게)
    pub_seq: u64,
}

/// 수령 재시도 창(grant를 받은 시각부터)
pub const REDEEM_WINDOW: time::Duration = time::Duration::seconds(100);
/// 수령 시도 상한
pub const REDEEM_MAX_ATTEMPTS: usize = 10;
/// n번째 일시 실패 뒤 기다림(초). 마지막 값이 이어진다
pub const REDEEM_BACKOFF_SECS: [u64; 5] = [1, 2, 4, 8, 15];
/// 기다리는 동안 벽시계 기한을 다시 보는 간격
pub const WALL_TICK: std::time::Duration = std::time::Duration::from_secs(5);

/// 수령 응답에서 확정된 결과
enum Final {
    Ok(TokenBundle),
    Denied(String),
    Cancelled,
    Failed(String),
    /// 서버가 이 로그인 흐름을 모른다(404)
    Lost,
    /// 그 밖 4xx·계약 위반(다시 하지 않는다)
    Server,
}

enum Step {
    Final(Final),
    Transient(Cause),
}

/// 수령 응답 분류(worker.md 91 (마))
fn classify_redeem(res: Result<RedeemResponse, ApiError>) -> Step {
    match res {
        Ok(RedeemResponse::Ok(b)) => Step::Final(Final::Ok(b)),
        Ok(RedeemResponse::Denied { channel_name }) => Step::Final(Final::Denied(channel_name)),
        Ok(RedeemResponse::Cancelled) => Step::Final(Final::Cancelled),
        Ok(RedeemResponse::Failed { code }) => Step::Final(Final::Failed(code)),
        Err(ApiError::Worker { status: 404, .. }) => Step::Final(Final::Lost),
        Err(ApiError::Worker { status, .. }) if status >= 500 => Step::Transient(Cause::Server),
        Err(ApiError::Worker { .. } | ApiError::Contract { .. }) => Step::Final(Final::Server),
        Err(ApiError::Transport { .. } | ApiError::NotWorker { .. }) => {
            Step::Transient(Cause::Network)
        }
    }
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
        has_session: i.held.is_some(),
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
    grants: Arc<dyn GrantSource>,
    tx: watch::Sender<AuthStatus>,
    /// watch에 마지막으로 반영한 `pub_seq`. watch 송신 클로저 안에서만 잡는다
    sent_seq: Mutex<u64>,
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
    /// 실제 루프백 수신기(`LoopbackGrantSource::default()`)로 연다.
    /// `client`는 `auth::client_label(앱 버전)`(Worker `/auth/start`의 client)
    pub fn open(api: A, clock: C, store: SessionStore, client: String) -> Self {
        Self::open_with_grants(
            api,
            clock,
            Arc::new(LoopbackGrantSource::default()),
            store,
            client,
        )
    }

    /// 수신기를 주입한다(테스트). session.json을 읽어 첫 상태를 정한다(동기, 네트워크 없음, D8·D21)
    pub fn open_with_grants(
        api: A,
        clock: C,
        grants: Arc<dyn GrantSource>,
        store: SessionStore,
        client: String,
    ) -> Self {
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
            pending_rx: None,
            pub_seq: 0,
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
            grants,
            tx,
            sent_seq: Mutex::new(0),
            client,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// 상태를 내보내고 돌려준다. 상태 잠금 안에서 순번과 상태를 정하고, 잠금을 푼 뒤 watch에 보낸다.
    /// 잠금 안에서 watch 쓰기 잠금을 기다리면, 구독자가 `borrow()`를 쥔 채 `status()`를 부를 때 교착한다.
    /// 늦게 도착한 옛 순번은 버린다(새 상태를 덮지 않는다)
    fn publish(&self, mut i: MutexGuard<'_, Inner>) -> AuthStatus {
        i.pub_seq += 1;
        let seq = i.pub_seq;
        let st = status_of(&i);
        drop(i);
        self.tx.send_if_modified(|cur| {
            let mut sent = self.sent_seq.lock().unwrap_or_else(PoisonError::into_inner);
            if seq <= *sent {
                return false;
            }
            *sent = seq;
            if *cur != st {
                *cur = st.clone();
                true
            } else {
                false
            }
        });
        st
    }

    /// 주입한 벽시계의 지금(driver가 절전 복귀를 가를 때 쓴다)
    pub fn now(&self) -> OffsetDateTime {
        self.clock.now()
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
        i.pending_rx = None;
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

    /// 사용자의 [다시 연결](`auth_retry`, 구현 중 변경 61). 온라인 `SignedIn`이고 갱신 예정 전이면 네트워크 없이 지금
    /// 상태를 돌려준다(연타가 토큰 회전·DO 쓰기를 늘리지 않게). 오프라인·확인 실패·시계 되돌림이면 바로 갱신한다
    pub async fn retry(&self) -> AuthStatus {
        let now = self.clock.now();
        let skip = {
            let i = self.lock();
            match (i.phase, &i.held, &i.offline) {
                (AuthPhase::SignedIn, Some(h), None) => {
                    !clock_rolled_back(&i, now)
                        && now < refresh_due_at(h.verified_at, h.access_expires_at)
                }
                _ => false,
            }
        };
        if skip {
            self.status()
        } else {
            self.refresh_inner().await
        }
    }

    async fn refresh_inner(&self) -> AuthStatus {
        let gen0 = self.lock().refresh_gen;
        let _g = self.refresh_lock.lock().await;
        let (sess, epoch, started) = {
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
            let started = self.clock.now();
            i.last_attempt = Some(started);
            self.publish(i);
            (sess, epoch, started)
        };

        let mono = tokio::time::Instant::now();
        let mut res = self.api.refresh(&sess.refresh_token).await;
        // D9·구현 중 변경 53: 서버가 회전을 커밋했는지 모르는 실패면 같은 토큰으로 Worker 복구 창(첫 회전부터 60초) 안에서만
        // 즉시·10초·30초에 다시 낸다. 창 밖에서 옛 토큰을 내면 재사용 감지로 세션이 끊긴다
        let mut retries = 0usize;
        while let Err(e) = &res
            && is_lost_response(e)
        {
            let Some(wait) = self.lost_retry_wait(retries, started, mono) else {
                break;
            };
            if !wait.is_zero() {
                tokio::time::sleep(wait).await;
                // 자는 동안(절전 포함) 창 끝을 넘겼으면 보내지 않는다
                if self.lost_retry_wait(retries, started, mono).is_none() {
                    break;
                }
            }
            if self.lock().session_epoch != epoch {
                break;
            }
            retries += 1;
            res = self.api.refresh(&sess.refresh_token).await;
        }
        let now = self.clock.now();
        let mut i = self.lock();
        i.refresh_gen += 1;
        if i.session_epoch != epoch {
            info!(result = "discarded", retries, "앱 세션 갱신");
            return status_of(&i);
        }
        match res {
            Ok(b) => {
                self.accept_session(&mut i, StoredSession::from_bundle(b, now));
                info!(result = "ok", retries, "앱 세션 갱신");
            }
            Err(e) => self.apply_refresh_error(&mut i, &sess, started, now, &e, retries),
        }
        self.publish(i)
    }

    /// 다음 응답 유실 재시도까지 기다릴 시간. 경과는 벽시계와 단조 시계 중 큰 값이다(macOS 단조 시계는 절전 동안 멈추고,
    /// 벽시계는 조정될 수 있다). 벽시계가 첫 시도보다 뒤로 갔으면 경과를 믿을 수 없어 재시도하지 않는다
    fn lost_retry_wait(
        &self,
        done: usize,
        started: OffsetDateTime,
        mono: tokio::time::Instant,
    ) -> Option<std::time::Duration> {
        let wall = self.clock.now() - started;
        if wall.is_negative() {
            return None;
        }
        let mono = time::Duration::try_from(mono.elapsed()).ok()?;
        let elapsed = wall.max(mono);
        if elapsed > LOST_RETRY_LAST_SEND {
            return None;
        }
        std::time::Duration::try_from(lost_retry_wait(done, elapsed)?).ok()
    }

    fn apply_refresh_error(
        &self,
        i: &mut Inner,
        sess: &StoredSession,
        started: OffsetDateTime,
        now: OffsetDateTime,
        e: &ApiError,
        retries: usize,
    ) {
        // 재시도가 있었다 = 서버에 닿았을지 모르는 앞 시도가 있었다(그 뒤의 revoked는 재사용 감지로 본다)
        let outcome = outcome_of_error(e, retries > 0);
        let pending = i.phase == AuthPhase::Pending;
        let cause = match outcome {
            VerifyOutcome::Transient(c) => Some(c),
            _ => None,
        };
        let next = classify_verify(now, sess.verified_at, sess.refresh_expires_at, outcome);
        let result = match next {
            Next::Online => "ok",
            Next::Offline { grace_until, cause } => {
                // since는 이 갱신 시도의 시작, 다음 재시도는 재시도 묶음이 끝난 뒤부터 센다(1분 백오프가 창 밖이게)
                let t = i.offline.get_or_insert(OfflineTrack {
                    since: started,
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
            Some(c) => info!(result, cause = cause_word(c), retries, "앱 세션 갱신"),
            None => info!(result, retries, "앱 세션 갱신"),
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
    /// 수신기를 먼저 열고(실패하면 start를 보내지 않는다) 그 포트로 `/auth/start`를 부른다.
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
        let secret = token::new_login_secret();
        let verifier = token::login_verifier(secret.expose());
        let state = Secret::new(token::loopback_state(&verifier));
        let Ok(bound) = self.bind_receiver(&state) else {
            let mut i = self.lock();
            if i.login_seq != seq0 {
                info!(result = "discarded", "로그인 시작");
                return BeginLogin::Discarded;
            }
            if i.phase == AuthPhase::SignedIn {
                return BeginLogin::AlreadySignedIn;
            }
            i.login = None;
            i.pending_rx = None;
            i.phase = AuthPhase::Error;
            i.reason = Some(AuthReason::Receiver);
            info!(result = "failed", cause = "receiver", "로그인 시작");
            self.publish(i);
            return BeginLogin::Failed;
        };
        let t0 = self.clock.now();
        let res = self
            .api
            .start(&StartRequest {
                port: bound.port,
                login_verifier: verifier,
                client: self.client.clone(),
            })
            .await;
        let mut i = self.lock();
        if i.login_seq != seq0 {
            // 요청 중에 취소·로그아웃됐다: 성공이든 실패든 결과를 버리고 상태를 건드리지 않는다(수신기는 닫힌다)
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
                let seq = i.login_seq;
                let ticket = LoginTicket {
                    login_url: r.login_url.clone(),
                };
                i.login = Some(Login {
                    seq,
                    login_secret: secret,
                    login_url: r.login_url,
                    deadline: t0 + LOGIN_TTL,
                    close: bound.close,
                    last_transient: None,
                });
                i.pending_rx = Some((seq, bound.rx));
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
                i.pending_rx = None;
                i.phase = AuthPhase::Error;
                i.reason = Some(cause_reason(cause));
                info!(result = "failed", cause = cause_word(cause), "로그인 시작");
                BeginLogin::Failed
            }
        };
        self.publish(i);
        out
    }

    /// 쓸 수 있는 포트의 수신기를 연다. Fetch bad port이면 앞 리스너를 쥔 채 다시 바인딩한다(같은 포트를 다시 받지 않게).
    /// 새 바인딩이 성공한 뒤에야 앞 리스너를 닫는다
    fn bind_receiver(&self, state: &Secret<String>) -> Result<Bound, ()> {
        let mut held: Vec<Bound> = Vec::new();
        for _ in 0..BIND_ATTEMPTS {
            match self.grants.bind(state) {
                Ok(b) if is_usable_port(b.port) => {
                    drop(held);
                    return Ok(b);
                }
                Ok(b) => {
                    warn!(result = "bad_port", "로그인 수신기");
                    held.push(b);
                }
                Err(_) => {
                    warn!(result = "bind_failed", "로그인 수신기");
                    return Err(());
                }
            }
        }
        warn!(result = "no_usable_port", "로그인 수신기");
        Err(())
    }

    /// 로그인 종결(held는 건드리지 않는다, D19). 수신기도 닫힌다
    fn end_login(i: &mut Inner, phase: AuthPhase, reason: Option<AuthReason>) {
        i.login = None;
        i.pending_rx = None;
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

    /// 같은 세대(`seq`)의 로그인이 아직 있는가
    fn login_alive(i: &Inner, seq: u64) -> bool {
        i.login.as_ref().is_some_and(|l| l.seq == seq)
    }

    /// grant를 기다리는 동안의 벽시계 기한 확인. 끝낼 것이 있으면 그 상태를 돌려준다
    fn check_deadline(&self, seq: u64) -> Option<AuthStatus> {
        let now = self.clock.now();
        let mut i = self.lock();
        let Some(l) = i.login.as_ref().filter(|l| l.seq == seq) else {
            return Some(status_of(&i));
        };
        if now >= l.deadline {
            Self::finish_timeout(&mut i);
            return Some(self.publish(i));
        }
        None
    }

    /// 수신기 줄이 닫혔다(수신기 태스크가 끝남): 로그인이 살아 있으면 `Error{Receiver}`
    fn receiver_gone(&self, seq: u64) -> AuthStatus {
        let mut i = self.lock();
        if !Self::login_alive(&i, seq) {
            return status_of(&i);
        }
        info!(result = "receiver_lost", "로그인 끝");
        Self::end_login(&mut i, AuthPhase::Error, Some(AuthReason::Receiver));
        self.publish(i)
    }

    /// 수령을 포기한다(일시 오류가 이어졌다)
    fn give_up_redeem(&self, seq: u64, d: Delivery, cause: Cause) -> AuthStatus {
        let mut i = self.lock();
        if !Self::login_alive(&i, seq) {
            let st = status_of(&i);
            drop(i);
            d.reply(ReceiverPage::Pending);
            return st;
        }
        info!(result = cause_word(cause), "로그인 끝");
        Self::end_login(&mut i, AuthPhase::Error, Some(cause_reason(cause)));
        let st = self.publish(i);
        d.reply(ReceiverPage::Failed);
        st
    }

    /// 수령 결과가 확정된 응답을 상태에 반영한다. 로그인이 바뀌었으면 None.
    /// `retried`는 앞서 일시 실패한 수령이 있었다는 뜻이다(그 뒤의 404는 앞 시도가 서버에서 이미 끝났을 수 있다, worker.md 92 (가))
    fn apply_final(
        &self,
        seq: u64,
        fin: Final,
        retried: bool,
    ) -> Option<(AuthStatus, ReceiverPage, Option<StoredSession>)> {
        let now = self.clock.now();
        let mut i = self.lock();
        if !Self::login_alive(&i, seq) {
            return None;
        }
        let mut old = None;
        let page = match fin {
            Final::Ok(b) => {
                i.session_epoch += 1;
                // 남아 있던 저장 세션(유예 지남·Checking 중 재로그인)은 서버에서도 끝낸다(호출한 쪽, 실패 무시)
                old = i.held.take();
                self.accept_session(&mut i, StoredSession::from_bundle(b, now));
                info!(result = "ok", "로그인 끝");
                ReceiverPage::SignedIn
            }
            Final::Denied(name) => {
                info!(result = "denied", "로그인 끝");
                Self::end_login(&mut i, AuthPhase::Denied, None);
                i.denied_name = Some(name);
                ReceiverPage::Denied
            }
            Final::Cancelled => {
                info!(result = "cancelled", "로그인 끝");
                Self::end_login(&mut i, AuthPhase::Cancelled, None);
                ReceiverPage::Cancelled
            }
            Final::Failed(code) => {
                info!(result = "failed", code = code.as_str(), "로그인 끝");
                Self::end_login(&mut i, AuthPhase::Error, Some(AuthReason::Server));
                ReceiverPage::Failed
            }
            Final::Lost => {
                let result = if retried { "lost_after_retry" } else { "lost" };
                info!(result, "로그인 끝");
                Self::end_login(&mut i, AuthPhase::Error, Some(AuthReason::LoginLost));
                ReceiverPage::Lost
            }
            Final::Server => {
                info!(result = "server", "로그인 끝");
                Self::end_login(&mut i, AuthPhase::Error, Some(AuthReason::Server));
                ReceiverPage::Failed
            }
        };
        Some((self.publish(i), page, old))
    }

    /// 로그인이 끝날 때까지 grant를 기다렸다가 수령한다(앱이 spawn). 끝난 상태를 돌려준다.
    /// grant 줄은 한 번만 가져간다(두 번째 호출이나 옛 세대는 아무것도 받지 않는다)
    pub async fn run_login_wait(&self) -> AuthStatus {
        let (seq, mut rx) = {
            let mut i = self.lock();
            let Some(seq) = i.login.as_ref().map(|l| l.seq) else {
                return status_of(&i);
            };
            if !matches!(&i.pending_rx, Some((s, _)) if *s == seq) {
                return status_of(&i);
            }
            let Some((_, rx)) = i.pending_rx.take() else {
                return status_of(&i);
            };
            (seq, rx)
        };
        let d = loop {
            tokio::select! {
                d = rx.recv() => match d {
                    Some(d) => break d,
                    None => return self.receiver_gone(seq),
                },
                () = tokio::time::sleep(WALL_TICK) => {
                    if let Some(st) = self.check_deadline(seq) {
                        return st;
                    }
                }
            }
        };
        self.redeem_grant(seq, d).await
    }

    async fn redeem_grant(&self, seq: u64, d: Delivery) -> AuthStatus {
        let received = self.clock.now();
        let (secret, deadline) = {
            let i = self.lock();
            match i.login.as_ref().filter(|l| l.seq == seq) {
                Some(l) => (l.login_secret.clone(), l.deadline),
                None => {
                    let st = status_of(&i);
                    drop(i);
                    d.reply(ReceiverPage::Pending);
                    return st;
                }
            }
        };
        let window_end = (received + REDEEM_WINDOW).min(deadline);
        let mut attempts = 0usize;
        loop {
            {
                let i = self.lock();
                if !Self::login_alive(&i, seq) {
                    let st = status_of(&i);
                    drop(i);
                    d.reply(ReceiverPage::Pending);
                    return st;
                }
            }
            let res = self.api.redeem(d.grant(), &secret).await;
            attempts += 1;
            let cause = match classify_redeem(res) {
                Step::Final(fin) => {
                    let Some((st, page, old)) = self.apply_final(seq, fin, attempts > 1) else {
                        let st = self.status();
                        d.reply(ReceiverPage::Pending);
                        return st;
                    };
                    d.reply(page);
                    if let Some(o) = old {
                        // 새 세션과 무관한 옛 세션이라 결과는 상태에 반영하지 않는다(Worker logout은 회전된 토큰도 해시로 찾는다)
                        let r = self
                            .api
                            .logout(Some(&o.access_token), Some(&o.refresh_token))
                            .await;
                        info!(
                            result = if r.is_ok() { "ok" } else { "failed" },
                            "옛 세션 서버 로그아웃"
                        );
                    }
                    return st;
                }
                Step::Transient(c) => c,
            };
            {
                let mut i = self.lock();
                if let Some(l) = i.login.as_mut().filter(|l| l.seq == seq) {
                    l.last_transient = Some(cause);
                }
            }
            let wait = REDEEM_BACKOFF_SECS[(attempts - 1).min(REDEEM_BACKOFF_SECS.len() - 1)];
            let wait_td = time::Duration::seconds(wait as i64);
            if attempts >= REDEEM_MAX_ATTEMPTS || self.clock.now() + wait_td > window_end {
                return self.give_up_redeem(seq, d, cause);
            }
            let mut left = std::time::Duration::from_secs(wait);
            while !left.is_zero() {
                let piece = left.min(WALL_TICK);
                tokio::time::sleep(piece).await;
                left -= piece;
                if self.clock.now() >= window_end {
                    return self.give_up_redeem(seq, d, cause);
                }
                let gone = !Self::login_alive(&self.lock(), seq);
                if gone {
                    let st = self.status();
                    d.reply(ReceiverPage::Pending);
                    return st;
                }
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
        i.pending_rx = None;
        let (phase, reason) = match (&i.held, &i.offline) {
            (None, _) => (AuthPhase::SignedOut, None),
            (Some(_), Some(t)) if now < t.grace_until => {
                (AuthPhase::SignedIn, Some(cause_reason(t.cause)))
            }
            (Some(_), _) => (AuthPhase::Expired, Some(AuthReason::GraceExpired)),
        };
        i.phase = phase;
        i.reason = reason;
        self.publish(i)
    }

    /// 로그아웃(D12): 로컬 먼저, 서버는 그 다음(실패 무시). 파일을 지우지도 비우지도 못했으면 Err
    /// (상태는 그래도 `SignedOut`). 지우지 못해 0바이트로 비웠으면 Ok다(`SessionStore::clear`)
    pub async fn logout(&self) -> Result<AuthStatus, StoreError> {
        let (held, cleared) = {
            let mut i = self.lock();
            let held = i.held.take();
            i.login = None;
            i.pending_rx = None;
            i.login_seq += 1;
            i.offline = None;
            i.dirty = false;
            i.session_epoch += 1;
            let cleared = self.store.clear();
            i.phase = AuthPhase::SignedOut;
            i.reason = None;
            i.denied_name = None;
            self.publish(i);
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

    /// updater(A4)용 access. SignedIn 온라인이고 `now < accessExpiresAt − 60초`이거나 마지막 확인이 5분 안이면
    /// (`MIN_REFRESH_GAP`, 시계가 서버보다 빨라도 호출마다 회전하지 않게) 그대로, 아니면 refresh 뒤 온라인이면 Some
    pub async fn ensure_fresh_access(&self) -> Option<Secret<String>> {
        let now = self.clock.now();
        {
            let i = self.lock();
            if let Some(h) = &i.held {
                let just_verified = h.verified_at <= now && now < h.verified_at + MIN_REFRESH_GAP;
                if i.phase == AuthPhase::SignedIn
                    && i.offline.is_none()
                    && (now < h.access_expires_at - ACCESS_SKEW || just_verified)
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
