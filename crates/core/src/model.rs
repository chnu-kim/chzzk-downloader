//! 코어가 주고받는 데이터 모델.

use serde::{Deserialize, Serialize};

/// 사용자가 준 주소가 가리키는 컨텐츠. `url::parse_content_url`로 만든다.
///
/// 직렬화 형태: `{"kind":"video","videoNo":123}`, `{"kind":"clip","clipId":"abc"}`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ContentRef {
    Video { video_no: u64 },
    Clip { clip_id: String },
}

/// 컨텐츠 종류.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContentKind {
    Video,
    Clip,
}

/// 파일명·표시·소유 확인에 쓰는 메타데이터.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentMeta {
    pub kind: ContentKind,
    /// 앞뒤 공백을 지운 제목
    pub title: String,
    pub channel_name: String,
    /// VOD `content.channel.channelId` / 클립 `ownerChannel.channelId`, 소문자
    pub channel_id: Option<String>,
    /// `"YYYY-MM-DD HH:MM:SS"`(KST 문자열 그대로)
    pub live_open_date: Option<String>,
    /// 파일명 날짜 폴백
    pub publish_date: Option<String>,
    pub adult: bool,
    pub duration_secs: Option<f64>,
}
