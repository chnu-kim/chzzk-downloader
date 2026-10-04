//! 다운로드 엔진(설계 §4.2·§5).
//!
//! - `part`: `.part`·sidecar와 크래시 불변식
//! - `retry`: 재시도 정책과 실패 분류

pub mod part;
pub mod retry;

pub use part::discard_partial;
pub use retry::{Failure, RetryPolicy};
