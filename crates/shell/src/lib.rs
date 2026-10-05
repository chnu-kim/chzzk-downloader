//! 치지직 다운로더 앱 셸 로직. Tauri에 의존하지 않아 webkit 없이 `cargo test -p chzzk-shell`로 검사한다.
//!
//! 설계 기준은 `docs/design/app.md`다. 프런트로 가는 타입은 `dto`·`error`에 있고, TS 정의는
//! `bindings::export`가 `app/src/lib/bindings`에 만든다(`tests/bindings.rs`가 최신인지 검사한다).

pub mod backend;
pub mod bindings;
pub mod dto;
pub mod error;

pub use backend::Backend;
pub use dto::JobId;
pub use error::{AppError, ErrorCode, ErrorPayload, RequestKindDto, Stage};
