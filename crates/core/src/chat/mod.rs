//! VOD 채팅(다시보기 채팅) 페이지 조회·파서·순회 판정·자막 렌더(기능 ④, PR 1), 이어받기 파일(`part`, PR 2),
//! 수집 `Chzzk::collect_chat`(`collect`, ④-3a).
//!
//! 실측 도구 `examples/vod_chat_check.rs`가 이 모듈만으로 페이지를 돈다. 닉네임·본문은 채팅 파일 밖(로그·오류·Debug)에
//! 나오지 않는다.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::client::Chzzk;
use crate::download::RetryPolicy;
use crate::error::Error;
use crate::http::RequestKind;

pub mod collect;
pub mod page;
pub mod part;
pub mod probe;
pub mod retry;
pub mod subtitle;
pub mod walk;

pub use collect::{ChatOutcome, ChatProgress, ChatRequest};
pub use page::{ChatCursor, ChatMessage, ChatMessageKind, ChatPage, message_hash, parse_chat_page};
pub use walk::{BoundaryRepeat, Next, Step, WalkState, next_step};

/// 요청 사이 최소 간격(ms). [잠정] 근거 없음, 실측·ADR-0009 묶음 등록(Q5).
pub const CHAT_PAGE_INTERVAL_MS: u64 = 300;
/// 재시도 횟수(첫 시도 제외). [잠정] 근거 없음, 실측·ADR-0009 묶음 등록.
pub const CHAT_RETRY_MAX: u32 = 3;
/// 자막 한 줄이 보이는 시간(ms). [잠정] 근거 없음, 실측·ADR-0009 묶음 등록(U3).
pub const CHAT_CUE_MS: u64 = 5_000;
/// 영상 길이 뒤로 자막에 넣는 여유(ms). [잠정] 근거 없음, 실측·ADR-0009 묶음 등록(Q6).
pub const CHAT_TAIL_MS: u64 = 5_000;
/// 자막을 만들 때 읽는 채팅 기록(`.chat.jsonl`)의 최대 바이트 수. 넘으면 기록을 읽지 않고 자막 실패로 끝낸다
/// (렌더러가 기록 전체를 메모리에 올리므로 할당 실패로 프로세스가 죽지 않게 하는 예산이다). [잠정] 근거 없음,
/// 실측 M-④-5 뒤 조정·ADR-0009 묶음 등록(core.md 구현 중 변경 66).
pub const CHAT_SUBTITLE_MAX_BYTES: u64 = 256 * 1024 * 1024;
/// 요청 인자: 커서 앞쪽 메시지 수. 받은 앞쪽 묶음은 버린다.
pub const CHAT_PREVIOUS_SIZE: u32 = 50;

/// 정상 끝. **400은 여기 없다**(chat.md §3.2-3): 400은 늘 `Error::HttpStatus`로 남는다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatEnd {
    NoCursor,
    CursorNotAdvancing,
    EmptyPage,
}

/// 자막 형식.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SubtitleFormat {
    #[default]
    None,
    Ass,
    Srt,
}

impl SubtitleFormat {
    /// 영상 옆 파일의 확장자(점 포함). `None`은 `None`.
    pub fn ext(self) -> Option<&'static str> {
        match self {
            Self::None => None,
            Self::Ass => Some(".ass"),
            Self::Srt => Some(".srt"),
        }
    }
}

/// 채팅 요청 재시도 정책: 재시도 `CHAT_RETRY_MAX`회(시도 `+1`회), 인내 없음(chat.md §3.2-5).
pub fn chat_retry_policy() -> RetryPolicy {
    RetryPolicy {
        max_attempts: CHAT_RETRY_MAX + 1,
        patience: Duration::ZERO,
        ..RetryPolicy::default()
    }
}

impl Chzzk {
    /// 채팅 한 페이지. `RequestKind::Api` 헤더·쿠키 규칙을 그대로 쓰는 유일한 채팅 요청 함수다.
    /// 401·403은 `AuthRequired`, 그 밖의 2xx 아님(400 포함)은 `HttpStatus { kind: Api }`.
    pub async fn fetch_chat_page(
        &self,
        video_no: u64,
        cursor: ChatCursor,
    ) -> Result<ChatPage, Error> {
        let no = video_no.to_string();
        let mut url = crate::client::api_url(
            &self.config().endpoints.chzzk_api,
            &["service", "v1", "videos", &no, "chats"],
        );
        url.query_pairs_mut()
            .append_pair("playerMessageTime", &cursor.0.to_string())
            .append_pair("previousVideoChatSize", &CHAT_PREVIOUS_SIZE.to_string());
        let body = self.fetch(url, RequestKind::Api).await?;
        parse_chat_page(&body)
    }

    /// 실측 Q3: info v2 응답에 채팅 사용 여부 필드가 있는가(`probe::info_chat_flag`).
    /// 실측 도구가 비공개 `fetch`를 부를 수 없어 둔 가장 좁은 seam이다.
    pub async fn info_chat_flag(&self, video_no: u64) -> Result<Option<bool>, Error> {
        let no = video_no.to_string();
        let url = crate::client::api_url(
            &self.config().endpoints.chzzk_api,
            &["service", "v2", "videos", &no],
        );
        let body = self.fetch(url, RequestKind::Api).await?;
        probe::info_chat_flag(&body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_policy_boundary() {
        let p = chat_retry_policy();
        assert_eq!(p.max_attempts, 4);
        assert_eq!(p.patience, Duration::ZERO);
        // 재시도 3회 = 시도 4회
        assert!(p.allows_retry(3));
        assert!(!p.allows_retry(4));
    }

    #[test]
    fn subtitle_ext() {
        assert_eq!(SubtitleFormat::None.ext(), None);
        assert_eq!(SubtitleFormat::Ass.ext(), Some(".ass"));
        assert_eq!(SubtitleFormat::Srt.ext(), Some(".srt"));
        assert_eq!(SubtitleFormat::default(), SubtitleFormat::None);
    }
}
