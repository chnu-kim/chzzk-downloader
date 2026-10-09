//! 앱 로그인(docs/design/worker.md §11, Phase 3b A1).
//!
//! - `SessionStore`: `{config_dir}/session.json`(원자적 쓰기, Unix 0600, origin 대조).
//! - `WorkerApi`: Worker `/auth/start`·`/auth/redeem`·`/auth/refresh`·`/auth/logout` seam. 실제 구현은 `HttpWorkerApi`(reqwest).
//! - `classify_verify`: 갱신 결과 → 다음 상태(3일 유예·60일 상한, 표 주도 테스트 `tests/auth_verify.rs`).
//! - `AuthService`: 상태 머신. `WorkerApi`·`Clock`을 주입받아 Tauri 없이 검사한다.
//! - `loopback`: 루프백 수신기(RFC 8252). 브라우저가 grant를 들고 돌아오는 127.0.0.1 1회용 서버(worker.md 구현 중 변경 88·91).
//! - `driver`: 타이머·절전 복귀·상태 전달(A2).
//! - 토큰·loginSecret·grant·로그인 주소는 `Secret`으로 들고 `Debug`·로그·오류 어디에도 내지 않는다(`tests/auth_secrets.rs`).

mod api;
mod base;
mod clock;
mod driver;
mod http;
mod loopback;
mod service;
mod session;
mod status;
pub mod token;
mod verify;

pub use api::{
    ApiError, LoginUrl, MAX_BODY, RedeemResponse, StartRequest, StartResponse, TokenBundle,
    WorkerApi, parse_bundle, parse_error_response, parse_redeem, parse_start,
};
pub use base::{BaseError, WorkerBase, client_label};
pub use clock::{Clock, SystemClock};
pub use driver::{
    HEARTBEAT, MIN_SLEEP, RESUME_SLACK, forward_status, run_driver, sleep_for, wake_trigger,
};
pub use http::{HttpWorkerApi, REQUEST_TIMEOUT};
pub use loopback::{
    BIND_ATTEMPTS, BindError, Bound, CSP, CloseHandle, CloseSignal, Delivery, FETCH_BAD_PORTS,
    GrantRx, GrantSource, GrantTx, LOOPBACK_PATH, LoopbackGrantSource, MAX_CONNECTIONS,
    PAGE_REJECTED, REJECT_LOG_LIMIT, ReceiverPage, Reject, Request, close_pair, grant_channel,
    is_usable_port, parse_request,
};
pub use service::{
    AuthService, AuthStatus, BeginLogin, LoginTicket, OfflineInfo, PendingInfo, Trigger,
};
pub use session::{LoadOutcome, SESSION_FILE, SessionStore, StoreError, StoredSession};
pub use status::{AuthPhase, AuthReason};
pub use token::Grant;
pub use verify::{
    ACCESS_SKEW, Cause, FOCUS_MIN_GAP, GRACE, Grace, LOGIN_TTL, LOST_RETRY_AT,
    LOST_RETRY_LAST_SEND, LoadDecision, MIN_REFRESH_GAP, Next, RECHECK, RECOVERY_WINDOW,
    RETRY_MINUTES, Rejection, VerifyOutcome, classify_verify, grace, is_lost_response,
    load_decision, lost_retry_wait, outcome_of_error, refresh_due_at, retry_delay,
};
