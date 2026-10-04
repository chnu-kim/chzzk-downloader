//! 치지직 VOD·클립 다운로드 코어.
//!
//! Tauri에 의존하지 않는다. 진행률은 콜백, 취소는 `CancellationToken`으로 셸과 연결한다.
//! 설계 기준은 `docs/design/core.md`다.

pub mod error;
pub mod model;
pub mod naming;
pub mod progress;

pub use error::{Error, ErrorKind, Unsupported};
pub use model::{ContentKind, ContentMeta};
pub use naming::Platform;
pub use progress::{Phase, Progress};
