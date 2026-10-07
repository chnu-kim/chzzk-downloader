//! 앱 로그인(`auth`) 테스트 공용 도구.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex};

use chzzk_core::Secret;
use chzzk_shell::auth::{
    ApiError, AuthService, Clock, PollResponse, SessionStore, StartRequest, StartResponse,
    StoredSession, TokenBundle, WorkerApi, WorkerBase, parse_start,
};
use time::OffsetDateTime;
use tokio::sync::Notify;

pub const ORIGIN: &str = "https://worker.example.invalid";
pub const CH: &str = "000000000000000000000000000000a1";

/// 기준 시각 2030-01-01T00:00:00Z
pub fn t0() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_893_456_000).unwrap()
}

/// 접두 + seed를 'A'로 43자까지 채운 토큰
pub fn tok(prefix: &str, seed: &str) -> String {
    assert!(seed.len() <= 43);
    format!("{prefix}{seed:A<43}")
}

pub fn base() -> WorkerBase {
    WorkerBase::parse(ORIGIN).unwrap()
}

pub fn store(dir: &Path) -> SessionStore {
    SessionStore::new(dir.to_path_buf(), &base())
}

/// n번째 묶음: access 만료 now+24h, refresh 만료 now+30d
pub fn bundle(n: u32, now: OffsetDateTime) -> TokenBundle {
    bundle_with(
        n,
        now + time::Duration::hours(24),
        now + time::Duration::days(30),
    )
}

/// 같은 값, 만료 직접 지정
pub fn bundle_with(n: u32, access_exp: OffsetDateTime, refresh_exp: OffsetDateTime) -> TokenBundle {
    TokenBundle {
        access_token: Secret::new(tok("cda_", &format!("acc{n}"))),
        access_expires_at: access_exp,
        refresh_token: Secret::new(tok("cdr_", &format!("ref{n}"))),
        refresh_expires_at: refresh_exp,
        channel_id: CH.to_string(),
        channel_name: "채널".to_string(),
        is_admin: false,
    }
}

/// 저장 세션: `bundle(n, verified_at)`과 같은 토큰, refresh 만료 지정
pub fn stored(
    n: u32,
    verified_at: OffsetDateTime,
    refresh_expires_at: OffsetDateTime,
) -> StoredSession {
    let b = bundle_with(
        n,
        verified_at + time::Duration::hours(24),
        refresh_expires_at,
    );
    StoredSession::from_bundle(b, verified_at)
}

/// 디렉토리를 파일로 바꿔 save를 실패시킨다
pub fn break_dir(dir: &Path) {
    std::fs::remove_dir_all(dir).unwrap();
    std::fs::write(dir, b"x").unwrap();
}

/// `break_dir`를 되돌린다
pub fn fix_dir(dir: &Path) {
    std::fs::remove_file(dir).unwrap();
    std::fs::create_dir_all(dir).unwrap();
}

/// session.json을 JSON으로 읽는다(검사용)
pub fn read_session(dir: &Path) -> Option<serde_json::Value> {
    let b = std::fs::read(dir.join("session.json")).ok()?;
    serde_json::from_slice(&b).ok()
}

/// 시작 응답: loginId `L`×22, 주소 `{ORIGIN}/auth/login/` + `H`×22, 확인 코드 `K7QX-4MRA`, 간격 2초
pub fn start_ok(base: &WorkerBase) -> StartResponse {
    start_ok_with(base, 2000)
}

/// 폴링 간격(밀리초)을 지정한 시작 응답
pub fn start_ok_with(base: &WorkerBase, interval_ms: u64) -> StartResponse {
    let body = serde_json::json!({
        "loginId": "L".repeat(22),
        "loginUrl": format!("{}/auth/login/{}", base.origin(), "H".repeat(22)),
        "userCode": "K7QX-4MRA",
        "expiresAt": "2030-01-01T00:10:00.000Z",
        "pollIntervalMs": interval_ms,
    });
    parse_start(body.to_string().as_bytes(), base).expect("start_ok 본문은 계약을 만족한다")
}

/// `ApiError::Worker`
pub fn worker(status: u16, code: &str) -> ApiError {
    ApiError::Worker {
        status,
        code: code.to_string(),
    }
}

/// 연결 실패
pub fn transport() -> ApiError {
    ApiError::Transport { timed_out: false }
}

// ---- FakeClock: tokio Instant에 묶인 벽시계 + 수동 이동 ----

struct ClockState {
    base: OffsetDateTime,
    start: tokio::time::Instant,
    offset: time::Duration,
}

/// 벽시계 = 시작 시각 + tokio 경과 + 수동 이동(절전·시계 조정 흉내)
#[derive(Clone)]
pub struct FakeClock(Arc<Mutex<ClockState>>);

impl FakeClock {
    pub fn at(t: OffsetDateTime) -> Self {
        Self(Arc::new(Mutex::new(ClockState {
            base: t,
            start: tokio::time::Instant::now(),
            offset: time::Duration::ZERO,
        })))
    }

    /// 벽시계만 뛴다
    pub fn advance(&self, d: time::Duration) {
        self.0.lock().unwrap().offset += d;
    }

    /// `now()`가 t가 되게 한다
    pub fn set(&self, t: OffsetDateTime) {
        let cur = self.now();
        self.advance(t - cur);
    }
}

impl Clock for FakeClock {
    fn now(&self) -> OffsetDateTime {
        let s = self.0.lock().unwrap();
        let elapsed: time::Duration = (tokio::time::Instant::now() - s.start).try_into().unwrap();
        s.base + elapsed + s.offset
    }
}

// ---- FakeWorkerApi ----

/// 줄에 세우는 응답. `Hold`는 알림을 받을 때까지 기다린 뒤 돌려준다.
pub enum Reply<T> {
    Now(Result<T, ApiError>),
    Hold(Arc<Notify>, Result<T, ApiError>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Call {
    Start {
        verifier: String,
        client: String,
    },
    Poll {
        login_id: String,
        secret: String,
    },
    Refresh {
        token: String,
    },
    Logout {
        access: Option<String>,
        refresh: Option<String>,
    },
}

#[derive(Default)]
struct FakeState {
    start: VecDeque<Reply<StartResponse>>,
    poll: VecDeque<Reply<PollResponse>>,
    refresh: VecDeque<Reply<TokenBundle>>,
    logout: VecDeque<Reply<()>>,
    calls: Vec<Call>,
}

/// 줄이 비면 `transport()`를 돌려준다. 호출은 기다리기 전에 기록한다(Hold 중에도 `calls`에 보인다).
#[derive(Clone, Default)]
pub struct FakeWorkerApi(Arc<Mutex<FakeState>>);

impl FakeWorkerApi {
    pub fn push_start(&self, r: Reply<StartResponse>) {
        self.0.lock().unwrap().start.push_back(r);
    }
    pub fn push_poll(&self, r: Reply<PollResponse>) {
        self.0.lock().unwrap().poll.push_back(r);
    }
    pub fn push_refresh(&self, r: Reply<TokenBundle>) {
        self.0.lock().unwrap().refresh.push_back(r);
    }
    pub fn push_logout(&self, r: Reply<()>) {
        self.0.lock().unwrap().logout.push_back(r);
    }
    pub fn calls(&self) -> Vec<Call> {
        self.0.lock().unwrap().calls.clone()
    }
    /// Refresh 토큰 값만 순서대로
    pub fn refresh_calls(&self) -> Vec<String> {
        self.calls()
            .into_iter()
            .filter_map(|c| match c {
                Call::Refresh { token } => Some(token),
                _ => None,
            })
            .collect()
    }
    pub fn count(&self, f: impl Fn(&Call) -> bool) -> usize {
        self.calls().iter().filter(|c| f(c)).count()
    }

    fn take<T>(
        &self,
        call: Call,
        pick: impl FnOnce(&mut FakeState) -> Option<Reply<T>>,
    ) -> Option<Reply<T>> {
        let mut s = self.0.lock().unwrap();
        s.calls.push(call);
        pick(&mut s)
    }
}

async fn resolve<T>(r: Option<Reply<T>>) -> Result<T, ApiError> {
    match r {
        None => Err(transport()),
        Some(Reply::Now(x)) => x,
        Some(Reply::Hold(n, x)) => {
            n.notified().await;
            x
        }
    }
}

impl WorkerApi for FakeWorkerApi {
    fn start(
        &self,
        req: &StartRequest,
    ) -> impl Future<Output = Result<StartResponse, ApiError>> + Send {
        let r = self.take(
            Call::Start {
                verifier: req.poll_verifier.clone(),
                client: req.client.clone(),
            },
            |s| s.start.pop_front(),
        );
        resolve(r)
    }

    fn poll(
        &self,
        login_id: &Secret<String>,
        poll_secret: &Secret<String>,
    ) -> impl Future<Output = Result<PollResponse, ApiError>> + Send {
        let r = self.take(
            Call::Poll {
                login_id: login_id.expose().clone(),
                secret: poll_secret.expose().clone(),
            },
            |s| s.poll.pop_front(),
        );
        resolve(r)
    }

    fn refresh(
        &self,
        refresh_token: &Secret<String>,
    ) -> impl Future<Output = Result<TokenBundle, ApiError>> + Send {
        let r = self.take(
            Call::Refresh {
                token: refresh_token.expose().clone(),
            },
            |s| s.refresh.pop_front(),
        );
        resolve(r)
    }

    fn logout(
        &self,
        access: Option<&Secret<String>>,
        refresh: Option<&Secret<String>>,
    ) -> impl Future<Output = Result<(), ApiError>> + Send {
        let r = self.take(
            Call::Logout {
                access: access.map(|a| a.expose().clone()),
                refresh: refresh.map(|a| a.expose().clone()),
            },
            |s| s.logout.pop_front(),
        );
        resolve(r)
    }
}

/// 가짜 Worker·시계로 만든 서비스
pub fn service(
    dir: &Path,
    api: &FakeWorkerApi,
    clock: &FakeClock,
) -> AuthService<FakeWorkerApi, FakeClock> {
    AuthService::open(
        api.clone(),
        clock.clone(),
        SessionStore::new(dir.to_path_buf(), &base()),
        "app/0.1.0 test".into(),
    )
}
