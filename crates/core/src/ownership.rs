//! 본인 채널 컨텐츠 확인(Phase 3 seam).
//!
//! 지금은 판정 함수만 둔다. 로그인 사용자의 채널 ID를 얻는 경로(OAuth 등)는 Phase 3에서 붙인다.

use crate::model::ContentMeta;

/// 컨텐츠가 `my_channel_id` 채널의 것인가.
///
/// 컨텐츠에 채널 ID가 없으면 `None`(판단 불가). 비교는 소문자 정확 일치다.
pub fn is_own_content(meta: &ContentMeta, my_channel_id: &str) -> Option<bool> {
    let mine = my_channel_id.trim();
    meta.channel_id
        .as_deref()
        .map(|id| !mine.is_empty() && id.to_lowercase() == mine.to_lowercase())
}

#[cfg(test)]
mod tests {
    use crate::info::{parse_clip_info, parse_video_info};
    use crate::testutil::fixture;

    #[test]
    fn is_own_content() {
        let (vod, _) = parse_video_info(&fixture("testdata/hls/video_info.json")).unwrap();
        assert_eq!(
            super::is_own_content(&vod, "000000000000000000000000000000a1"),
            Some(true)
        );
        // 대소문자 무시
        assert_eq!(
            super::is_own_content(&vod, "000000000000000000000000000000A1"),
            Some(true)
        );
        assert_eq!(
            super::is_own_content(&vod, "000000000000000000000000000000c3"),
            Some(false)
        );
        assert_eq!(super::is_own_content(&vod, ""), Some(false));

        let (clip, _) = parse_clip_info(&fixture("testdata/clip/clip_playinfo.json")).unwrap();
        assert_eq!(
            super::is_own_content(&clip, "000000000000000000000000000000c3"),
            Some(true)
        );

        let mut none = vod.clone();
        none.channel_id = None;
        assert_eq!(
            super::is_own_content(&none, "000000000000000000000000000000a1"),
            None
        );
    }
}
