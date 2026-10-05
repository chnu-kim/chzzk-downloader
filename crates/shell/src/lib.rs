//! 치지직 다운로더 앱 셸 로직. Tauri에 의존하지 않아 webkit 없이 `cargo test -p chzzk-shell`로 검사한다.
//!
//! 설계 기준은 `docs/design/app.md`다. 프런트로 가는 타입은 `dto`·`error`에 있고, TS 정의는
//! `bindings::export`가 `app/src/lib/bindings`에 만든다(`tests/bindings.rs`가 최신인지 검사한다).

pub mod app;
pub mod backend;
pub mod bindings;
pub mod dto;
pub mod error;
pub mod events;
pub mod jobs;
pub mod manager;
pub mod output;
pub mod ownership;
pub mod services;
mod writer;

pub use app::App;
pub use backend::Backend;
pub use dto::JobId;
pub use error::{AppError, ErrorCode, ErrorPayload, RequestKindDto, Stage};
pub use events::EventSink;
pub use jobs::{JobRecord, JobStore, JobsFile, reconcile};
pub use manager::{DownloadManager, JobDefaults, ManagerConfig};
pub use ownership::OwnershipGate;
pub use services::{AppPaths, SettingsService};
