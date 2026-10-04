//! 사용자 입력 주소를 `ContentRef`로 바꾼다(설계 §3.1, spec §9.1-1·2).
//!
//! Go는 부분 문자열로 판별해 쿼리·fragment가 ID에 섞이고 호스트를 검사하지 않았다.
//! 여기서는 주소를 파싱해 호스트와 path 세그먼트를 정확히 검사한다.

use ::url::Url;

use crate::error::Error;
use crate::model::ContentRef;

/// 받는 호스트.
const HOSTS: [&str; 2] = ["chzzk.naver.com", "m.chzzk.naver.com"];

/// 치지직 VOD·클립 주소를 해석한다.
///
/// - 호스트는 `chzzk.naver.com` 또는 `m.chzzk.naver.com`, 스킴은 http/https
/// - path: `video/{숫자}` → Video, `clips/{id}` 또는 `embed/clip/{id}` → Clip (`id`: `[A-Za-z0-9_-]+`)
/// - 쿼리·fragment는 무시하고, 끝의 `/` 하나는 허용한다.
/// - 스킴 없이 `chzzk.naver.com/...`로 붙여 넣은 주소는 `https://`를 붙여 읽는다.
/// - 그 밖은 `Error::InvalidUrl`
pub fn parse_content_url(s: &str) -> Result<ContentRef, Error> {
    let s = s.trim();
    let url = match Url::parse(s) {
        Ok(u) => u,
        Err(::url::ParseError::RelativeUrlWithoutBase) => {
            Url::parse(&format!("https://{s}")).map_err(|_| Error::InvalidUrl)?
        }
        Err(_) => return Err(Error::InvalidUrl),
    };
    if !matches!(url.scheme(), "http" | "https") {
        return Err(Error::InvalidUrl);
    }
    match url.host_str() {
        Some(h) if HOSTS.contains(&h) => {}
        _ => return Err(Error::InvalidUrl),
    }

    let mut segs: Vec<&str> = url.path_segments().ok_or(Error::InvalidUrl)?.collect();
    // 끝의 '/' 하나만 허용한다(빈 마지막 세그먼트 하나를 뗀다).
    if segs.last() == Some(&"") {
        segs.pop();
    }
    match segs.as_slice() {
        ["video", no] => parse_video_no(no).map(|video_no| ContentRef::Video { video_no }),
        ["clips", id] | ["embed", "clip", id] if is_clip_id(id) => Ok(ContentRef::Clip {
            clip_id: (*id).to_string(),
        }),
        _ => Err(Error::InvalidUrl),
    }
}

/// ASCII 숫자만 받는다(`u64::from_str`는 `+`를 허용하므로 먼저 검사한다).
fn parse_video_no(s: &str) -> Result<u64, Error> {
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
        return Err(Error::InvalidUrl);
    }
    s.parse().map_err(|_| Error::InvalidUrl)
}

fn is_clip_id(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(id: &str) -> ContentRef {
        ContentRef::Clip {
            clip_id: id.to_string(),
        }
    }

    fn video(no: u64) -> ContentRef {
        ContentRef::Video { video_no: no }
    }

    fn assert_invalid(s: &str) {
        assert!(
            matches!(parse_content_url(s), Err(Error::InvalidUrl)),
            "{s:?} → {:?}",
            parse_content_url(s)
        );
    }

    /// spec §8.1 TestIsClipURL
    #[test]
    fn clip_detection() {
        for s in [
            "https://chzzk.naver.com/clips/TestClip01",
            "https://chzzk.naver.com/clips/AbCdEf1234/",
            "https://chzzk.naver.com/embed/clip/AbCdEf1234",
        ] {
            assert!(
                matches!(parse_content_url(s), Ok(ContentRef::Clip { .. })),
                "{s}"
            );
        }
        assert_eq!(
            parse_content_url("https://chzzk.naver.com/video/1234567").unwrap(),
            video(1234567)
        );
        assert_invalid("https://chzzk.naver.com/");
        assert_invalid("");
    }

    /// spec §8.1 TestParseClipID
    #[test]
    fn clip_id() {
        let cases = [
            ("https://chzzk.naver.com/clips/TestClip01", "TestClip01"),
            ("https://chzzk.naver.com/clips/AbCdEf1234/", "AbCdEf1234"),
            (
                "https://chzzk.naver.com/clips/AbCdEf1234?param=1",
                "AbCdEf1234",
            ),
            (
                "https://chzzk.naver.com/embed/clip/AbCdEf1234",
                "AbCdEf1234",
            ),
            (
                "https://chzzk.naver.com/embed/clip/AbCdEf1234?autoPlay=true",
                "AbCdEf1234",
            ),
        ];
        for (s, id) in cases {
            assert_eq!(parse_content_url(s).unwrap(), clip(id), "{s}");
        }
        // Go에서는 오류였던 여섯째 행: 이제는 클립이 아니라 VOD로 읽힌다.
        assert_eq!(
            parse_content_url("https://chzzk.naver.com/video/1234567").unwrap(),
            video(1234567)
        );
    }

    /// spec §1.1 golden 4~7행(Go 버그 수정)
    #[test]
    fn clip_rejects_bad() {
        assert_invalid("https://chzzk.naver.com/clips/");
        assert_invalid("https://chzzk.naver.com/embed/clip/");
        assert_eq!(
            parse_content_url("https://chzzk.naver.com/clips/abc#frag").unwrap(),
            clip("abc")
        );
        assert_eq!(
            parse_content_url("https://chzzk.naver.com/clips/abc#a/b").unwrap(),
            clip("abc")
        );
        assert_invalid("http://evil.com/?chzzk.naver.com/clips/abc");
        assert_invalid("https://chzzk.naver.com.evil.com/clips/abc");
        assert_invalid("https://chzzk.naver.com/clips/abc/extra");
        assert_invalid("https://chzzk.naver.com/clips/abc//");
        assert_invalid("https://chzzk.naver.com/clips/a%20b");
        assert_invalid("https://chzzk.naver.com/embed/clips/abc");
        assert_invalid("ftp://chzzk.naver.com/clips/abc");
    }

    /// spec §1.2(Go 버그 수정)
    #[test]
    fn video_no() {
        for s in [
            "https://chzzk.naver.com/video/123?t=10",
            "https://chzzk.naver.com/video/123/?t=10",
            "https://chzzk.naver.com/video/123?a=b/c",
            "https://chzzk.naver.com/video/123#x",
            "https://chzzk.naver.com/video/123/",
            "http://chzzk.naver.com/video/123",
            "  https://chzzk.naver.com/video/123  ",
            "chzzk.naver.com/video/123",
            "HTTPS://CHZZK.NAVER.COM/video/123",
        ] {
            assert_eq!(parse_content_url(s).unwrap(), video(123), "{s}");
        }
        assert_eq!(
            parse_content_url("https://m.chzzk.naver.com/video/1").unwrap(),
            video(1)
        );
        assert_invalid("https://chzzk.naver.com/video/");
        assert_invalid("https://chzzk.naver.com/video/abc");
        assert_invalid("https://chzzk.naver.com/video/+123");
        assert_invalid("https://chzzk.naver.com/video/12a");
        assert_invalid("https://chzzk.naver.com/video/１２３");
        assert_invalid("https://chzzk.naver.com/video/99999999999999999999999");
        assert_invalid("https://chzzk.naver.com/video/123/456");
        assert_invalid("https://chzzk.naver.com/live/abc");
        assert_invalid("https://evil.com/video/123");
        assert_invalid("not a url");
    }

    #[test]
    fn content_ref_serde_camel_case() {
        let v = serde_json::to_value(video(123)).unwrap();
        assert_eq!(v, serde_json::json!({"kind": "video", "videoNo": 123}));
        let c = serde_json::to_value(clip("abc")).unwrap();
        assert_eq!(c, serde_json::json!({"kind": "clip", "clipId": "abc"}));
        let back: ContentRef = serde_json::from_value(v).unwrap();
        assert_eq!(back, video(123));
        let back: ContentRef = serde_json::from_value(c).unwrap();
        assert_eq!(back, clip("abc"));
    }
}
