//! 치지직 VOD·클립 다운로드 코어.
//!
//! Tauri에 의존하지 않는다. 진행률은 콜백, 취소는 `CancellationToken`으로 셸과 연결한다.
//! 설계 기준은 `docs/design/core.md`다.

pub mod client;
pub mod error;
pub mod hls;
pub mod http;
pub mod info;
pub mod model;
pub mod mpd;
pub mod naming;
pub mod ownership;
pub mod progress;
pub mod url;

#[cfg(test)]
mod testutil;

pub use client::{Chzzk, ClientConfig, Endpoints};
pub use error::{Error, ErrorKind, Unsupported};
pub use http::{NaverCookies, RequestKind, Secret};
pub use info::Playback;
pub use model::{
    ContentKind, ContentMeta, ContentRef, PdRep, PlaybackKind, Quality, Resolved, Source,
};
pub use naming::Platform;
pub use ownership::is_own_content;
pub use progress::{Phase, Progress};
pub use url::parse_content_url;
