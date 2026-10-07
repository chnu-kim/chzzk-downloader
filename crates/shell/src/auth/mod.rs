//! 앱 로그인(docs/design/worker.md §11, Phase 3b A1).
//!
//! - `SessionStore`: `{config_dir}/session.json`(원자적 쓰기, Unix 0600, origin 대조).
//! - `WorkerApi`: Worker `/auth/start`·`/auth/poll`·`/auth/refresh`·`/auth/logout` seam. 실제 구현은 `HttpWorkerApi`(reqwest).
//! - `classify_verify`: 갱신 결과 → 다음 상태(3일 유예·60일 상한, 표 주도 테스트 `tests/auth_verify.rs`).
//! - `AuthService`: 상태 머신. `WorkerApi`·`Clock`을 주입받아 Tauri 없이 검사한다.
//! - 토큰·pollSecret·로그인 주소는 `Secret`으로 들고 `Debug`·로그·오류 어디에도 내지 않는다(`tests/auth_secrets.rs`).

mod api;
mod base;
mod clock;
mod session;
pub mod token;

pub use api::{LoginUrl, TokenBundle};
pub use base::{BaseError, WorkerBase, client_label};
pub use clock::{Clock, SystemClock};
pub use session::{LoadOutcome, SESSION_FILE, SessionStore, StoreError, StoredSession};
