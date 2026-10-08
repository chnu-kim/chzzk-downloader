//! 본인 채널 컨텐츠 확인.
//!
//! 판정 함수만 둔다. 로그인 채널 ID는 셸 `OwnershipGate`가 쓴다(Phase 3b A5).

use crate::model::ContentMeta;

/// 컨텐츠 채널 ID가 `my_channel_id`와 같은가.
///
/// 컨텐츠 채널 ID가 없으면 `None`(판단 불가). 비교는 소문자 정확 일치이고 `my_channel_id`의 앞뒤 공백은 지운다.
/// 빈 `my_channel_id`는 `Some(false)`다.
pub fn is_own_channel(content_channel_id: Option<&str>, my_channel_id: &str) -> Option<bool> {
    let mine = my_channel_id.trim();
    content_channel_id.map(|id| !mine.is_empty() && id.to_lowercase() == mine.to_lowercase())
}

/// 컨텐츠가 `my_channel_id` 채널의 것인가(`is_own_channel`의 메타 버전).
pub fn is_own_content(meta: &ContentMeta, my_channel_id: &str) -> Option<bool> {
    is_own_channel(meta.channel_id.as_deref(), my_channel_id)
}

#[cfg(test)]
mod tests {
    use crate::info::{parse_clip_info, parse_video_info};
    use crate::testutil::fixture;

    #[test]
    fn is_own_channel_rules() {
        let a1 = "000000000000000000000000000000a1";
        assert_eq!(
            super::is_own_channel(Some(a1), "000000000000000000000000000000A1 "),
            Some(true)
        );
        assert_eq!(
            super::is_own_channel(Some(a1), "000000000000000000000000000000c3"),
            Some(false)
        );
        assert_eq!(super::is_own_channel(Some(a1), ""), Some(false));
        assert_eq!(super::is_own_channel(None, a1), None);
    }

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
        // 클립을 만든 사람(makerChannel `…d4`)은 소유자가 아니다.
        assert_eq!(
            super::is_own_content(&clip, "000000000000000000000000000000d4"),
            Some(false)
        );

        let mut none = vod.clone();
        none.channel_id = None;
        assert_eq!(
            super::is_own_content(&none, "000000000000000000000000000000a1"),
            None
        );
    }
}
