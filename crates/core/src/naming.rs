//! 파일명 생성과 정리(설계 §6).
//!
//! - VOD: `[YYMMDD] {채널} - {제목}.mp4`, 클립: `[클립] {채널} - {제목}.mp4`
//! - OS별 규칙은 `Platform` 인자로 받는다. 그래서 한 호스트에서 세 OS 규칙을 모두 테스트한다.
//! - 이름 전체(`.mp4` 포함)는 UTF-8 200바이트 이하다. `.part.json` 접미사와 한글 여유를 남긴다.

use std::path::{Path, PathBuf};

use crate::model::{ContentKind, ContentMeta};

/// 파일명 전체의 UTF-8 바이트 상한(확장자 포함).
pub const MAX_FILENAME_BYTES: usize = 200;

/// 출력 확장자. 코어가 정한다.
const EXT: &str = ".mp4";

/// 길이를 줄여야 할 때 채널보다 먼저 자르되, 제목이 이 바이트 수보다 짧아지지는 않게 한다.
const MIN_TITLE_BYTES: usize = 60;

/// 파일명 규칙을 고를 대상 OS.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
}

impl Platform {
    /// 지금 실행 중인 OS.
    pub fn current() -> Self {
        if cfg!(windows) {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::MacOs
        } else {
            Platform::Linux
        }
    }
}

/// 메타데이터로 기본 파일명을 만든다. 결과는 `sanitize_filename`을 거친 값이고 200바이트 이하다.
pub fn default_filename(meta: &ContentMeta, p: Platform) -> String {
    // "채널이 비었는가"는 sanitize 전 값으로 판단한다(sanitize는 빈 값을 "_"로 바꾼다).
    let channel = clean_component(&meta.channel_name, p);
    let title = clean_component(&meta.title, p);

    let prefix = match meta.kind {
        ContentKind::Clip => "[클립] ".to_string(),
        ContentKind::Video => {
            let date = meta
                .live_open_date
                .as_deref()
                .and_then(parse_live_date)
                .or_else(|| meta.publish_date.as_deref().and_then(parse_live_date));
            match date {
                Some((y, m, d)) => format!("[{:02}{m:02}{d:02}] ", y % 100),
                None => String::new(),
            }
        }
    };
    let sep = if channel.is_empty() { "" } else { " - " };

    // 접두어·구분자·확장자를 뺀 나머지를 채널과 제목이 나눠 쓴다.
    let avail = MAX_FILENAME_BYTES.saturating_sub(prefix.len() + sep.len() + EXT.len());
    let (channel, title) = fit_channel_title(&channel, &title, avail, p);
    let title = if title.is_empty() {
        "_".to_string()
    } else {
        title
    };

    sanitize_filename(&format!("{prefix}{channel}{sep}{title}{EXT}"), p)
}

/// 채널·제목 길이를 `avail` 바이트에 맞춘다. 제목부터 자르고, 그래도 넘치면 채널을 자른다.
fn fit_channel_title(channel: &str, title: &str, avail: usize, p: Platform) -> (String, String) {
    if channel.len() + title.len() <= avail {
        return (channel.to_string(), title.to_string());
    }
    let title_keep = avail
        .saturating_sub(channel.len())
        .max(MIN_TITLE_BYTES.min(title.len()))
        .min(avail);
    let title = trim_piece(truncate_utf8(title, title_keep), p);
    let channel = trim_piece(truncate_utf8(channel, avail - title.len()), p);
    (channel, title)
}

/// 이름 조각(채널·제목)에 문자 규칙만 적용한다. 확장자 분리·예약어·빈 값 처리는 하지 않는다.
fn clean_component(s: &str, p: Platform) -> String {
    normalize_chars(s, p).trim().to_string()
}

/// 잘라낸 조각 끝을 다시 정리한다. 자른 자리에 공백이 남을 수 있다.
fn trim_piece(s: &str, p: Platform) -> String {
    let s = s.trim();
    match p {
        Platform::Windows => s.trim_end_matches(['.', ' ']).to_string(),
        _ => s.to_string(),
    }
}

/// UTF-8 `max` 바이트 이하가 되도록 char 경계에서 자른다.
fn truncate_utf8(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// 문자 단위 규칙: 공백 정규화, 제어문자 제거, 금지 문자 → `_`, 연속 공백 하나로.
fn normalize_chars(s: &str, p: Platform) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        let c = match c {
            '\u{3000}' | '\u{00A0}' => ' ',
            '\u{0000}'..='\u{001F}' | '\u{007F}' => continue,
            '/' => '_',
            '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' if p == Platform::Windows => '_',
            ':' if p == Platform::MacOs => '_',
            c => c,
        };
        if c == ' ' && out.ends_with(' ') {
            continue;
        }
        out.push(c);
    }
    out
}

/// Windows 예약 장치명(대소문자 무시).
fn is_windows_reserved(stem: &str) -> bool {
    const NAMES: [&str; 4] = ["CON", "PRN", "AUX", "NUL"];
    let upper = stem.to_ascii_uppercase();
    if NAMES.contains(&upper.as_str()) {
        return true;
    }
    let b = upper.as_bytes();
    b.len() == 4
        && (upper.starts_with("COM") || upper.starts_with("LPT"))
        && (b'1'..=b'9').contains(&b[3])
}

/// 파일명 전체를 OS 규칙에 맞게 정리한다. 멱등이다(두 번 적용해도 같다).
///
/// - 공통: 전각 공백·NBSP → 공백, U+0000–001F·U+007F 제거, 연속 공백 하나로, trim, `/` → `_`, 빈 결과 `_`
/// - Windows: `\ : * ? " < > |` → `_`, 끝의 `.`과 공백 제거, 예약어면 `_` 접미
/// - macOS: `:` → `_`
/// - `[ ] ( ) { }`는 모든 OS에서 유지
///
/// 확장자는 Go와 같이 "`.`을 포함하고 `.`으로 끝나지 않으면 마지막 `.` 뒤"로 나눈다.
/// trim과 빈 값 처리는 확장자 앞 base에 적용한다(`.mp4` → `_.mp4`).
/// 길이 제한은 하지 않는다(`output_path`와 `default_filename`이 한다).
pub fn sanitize_filename(name: &str, p: Platform) -> String {
    let whole = normalize_chars(name, p);
    let whole = whole.trim();

    let (base, ext) = match whole.rfind('.') {
        Some(i) if !whole.ends_with('.') => whole.split_at(i),
        _ => (whole, ""),
    };
    let mut base = base.trim();
    if p == Platform::Windows {
        base = base.trim_end_matches(['.', ' ']);
    }
    let mut base = if base.is_empty() {
        "_".to_string()
    } else {
        base.to_string()
    };

    // 예약어는 첫 `.` 앞 이름으로 판단한다(Windows는 `CON.tar.gz`도 막는다).
    if p == Platform::Windows {
        let stem_end = base.find('.').unwrap_or(base.len());
        if is_windows_reserved(&base[..stem_end]) {
            base.insert(stem_end, '_');
        }
    }
    base + ext
}

/// 저장 폴더와 파일명으로 최종 경로를 만든다.
///
/// 파일명을 정리하고, 확장자가 `.mp4`(대소문자 무시)가 아니면 `.mp4`를 붙이고, 200바이트로 자른다.
/// Go의 `__mp4` → `.mp4` 치환 규칙은 없앴다.
pub fn output_path(folder: &Path, filename: &str, p: Platform) -> PathBuf {
    let mut name = sanitize_filename(filename, p);
    if !name.to_ascii_lowercase().ends_with(EXT) {
        name.push_str(EXT);
    }
    if name.len() > MAX_FILENAME_BYTES {
        let (base, ext) = name.split_at(name.len() - EXT.len());
        let base = trim_piece(truncate_utf8(base, MAX_FILENAME_BYTES - EXT.len()), p);
        name = sanitize_filename(&format!("{base}{ext}"), p);
    }
    folder.join(name)
}

/// `"YYYY-MM-DD"`로 시작하는 날짜를 읽는다. 뒤는 끝, 공백, `T` 중 하나여야 한다.
///
/// 자릿수와 월(1–12)·일(1–31) 범위를 검사한다. 잘못된 입력에 panic하지 않고 `None`을 낸다.
pub fn parse_live_date(raw: &str) -> Option<(u16, u8, u8)> {
    let b = raw.as_bytes();
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    if b.len() > 10 && b[10] != b' ' && b[10] != b'T' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| -> Option<u16> {
        b[r].iter().try_fold(0u16, |acc, &d| {
            d.is_ascii_digit().then(|| acc * 10 + u16::from(d - b'0'))
        })
    };
    let y = num(0..4)?;
    let m = u8::try_from(num(5..7)?).ok()?;
    let d = u8::try_from(num(8..10)?).ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some((y, m, d))
}

#[cfg(test)]
mod tests {
    use super::*;

    use Platform::{Linux, MacOs, Windows};

    const ALL: [Platform; 3] = [Windows, MacOs, Linux];

    fn meta(kind: ContentKind, channel: &str, title: &str, live: Option<&str>) -> ContentMeta {
        ContentMeta {
            kind,
            title: title.to_string(),
            channel_name: channel.to_string(),
            channel_id: None,
            live_open_date: live.map(str::to_string),
            publish_date: None,
            adult: false,
            duration_secs: None,
        }
    }

    /// fixture의 VOD info(`content`)에서 파일명에 쓰는 값만 읽는다.
    /// info 파서(5단계) 없이 실물 값과 맞물리게 하려는 것이다.
    fn fixture_meta(rel: &str) -> ContentMeta {
        let path = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
        let body = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let c = &v["content"];
        let s = |v: &serde_json::Value| v.as_str().map(str::to_string);
        let is_clip = c.get("contentTitle").is_some_and(|t| !t.is_null());
        let (title, channel) = if is_clip {
            (&c["contentTitle"], &c["ownerChannel"]["channelName"])
        } else {
            (&c["videoTitle"], &c["channel"]["channelName"])
        };
        ContentMeta {
            kind: if is_clip {
                ContentKind::Clip
            } else {
                ContentKind::Video
            },
            title: s(title).unwrap().trim().to_string(),
            channel_name: s(channel).unwrap(),
            channel_id: None,
            live_open_date: s(&c["liveOpenDate"]),
            publish_date: s(&c["publishDate"]),
            adult: false,
            duration_secs: None,
        }
    }

    #[test]
    fn parse_live_date() {
        for ok in ["2024-01-02 12:34:56", "2024-01-02", "2024-01-02T12:34:56"] {
            assert_eq!(super::parse_live_date(ok), Some((2024, 1, 2)), "{ok}");
        }
        for bad in [
            "2024/01/02",
            "",
            "24-01-02 01:02:03",
            "2024-1-02",
            "2024-01-0x",
            "2024-13-01",
            "2024-01-00",
            "2024-01-02_12",
            "한글한글-01-02",
            "２０２４-01-02",
        ] {
            assert_eq!(super::parse_live_date(bad), None, "{bad:?}");
        }
        assert_eq!(
            super::parse_live_date("2026-01-02 12:00:00"),
            Some((2026, 10, 5))
        );
    }

    #[test]
    fn sanitize_windows() {
        let p = Windows;
        assert_eq!(
            sanitize_filename("[2024-01-02] 채널 제목.mp4", p),
            "[2024-01-02] 채널 제목.mp4"
        );
        assert_eq!(
            sanitize_filename(r#"x:y*z?"<>|(){}[]/\.mp4"#, p),
            "x_y_z_____(){}[]__.mp4"
        );
        assert_eq!(sanitize_filename("CON.mp4", p), "CON_.mp4");
        assert_eq!(sanitize_filename("con.MP4", p), "con_.MP4");
        assert_eq!(sanitize_filename("COM1.mp4", p), "COM1_.mp4");
        assert_eq!(sanitize_filename("lpt9", p), "lpt9_");
        assert_eq!(sanitize_filename("NUL.tar.gz", p), "NUL_.tar.gz");
        assert_eq!(sanitize_filename("COM10.mp4", p), "COM10.mp4");
        assert_eq!(sanitize_filename("CONSOLE.mp4", p), "CONSOLE.mp4");
        assert_eq!(sanitize_filename("제목.  .mp4", p), "제목.mp4");
        assert_eq!(sanitize_filename("trail.", p), "trail");
        assert_eq!(sanitize_filename("trail. . ", p), "trail");
        assert_eq!(sanitize_filename("...", p), "_");
    }

    #[test]
    fn sanitize_macos() {
        let p = MacOs;
        assert_eq!(
            sanitize_filename(r#"x:y*z?"<>|(){}[]/\.mp4"#, p),
            r#"x_y*z?"<>|(){}[]_\.mp4"#
        );
        assert_eq!(sanitize_filename("CON.mp4", p), "CON.mp4");
        assert_eq!(sanitize_filename("trail.", p), "trail.");
    }

    #[test]
    fn sanitize_linux() {
        let p = Linux;
        assert_eq!(
            sanitize_filename(r#"x:y*z?"<>|(){}[]/\.mp4"#, p),
            r#"x:y*z?"<>|(){}[]_\.mp4"#
        );
        assert_eq!(sanitize_filename("CON.mp4", p), "CON.mp4");
        assert_eq!(sanitize_filename("제목.  .mp4", p), "제목..mp4");
    }

    #[test]
    fn sanitize_common_rows() {
        // Go golden 중 공백·제어문자·빈 값 행은 모든 OS에서 그대로다.
        for p in ALL {
            assert_eq!(
                sanitize_filename("[2024-01-02] 채널 제목.mp4", p),
                "[2024-01-02] 채널 제목.mp4"
            );
            assert_eq!(sanitize_filename("[채널] 제목.mp4", p), "[채널] 제목.mp4");
            assert_eq!(sanitize_filename("a.b.c", p), "a.b.c");
            assert_eq!(sanitize_filename("noext", p), "noext");
            assert_eq!(
                sanitize_filename("  sp\u{3000}ace x  .mp4", p),
                "sp ace x.mp4"
            );
            assert_eq!(sanitize_filename("a\u{00A0}\u{00A0}b.mp4", p), "a b.mp4");
            assert_eq!(sanitize_filename("a\r\nb\tc.mp4", p), "abc.mp4");
            assert_eq!(
                sanitize_filename("a\u{0000}b\u{007F}c\u{001F}.mp4", p),
                "abc.mp4"
            );
            assert_eq!(sanitize_filename(".mp4", p), "_.mp4");
            assert_eq!(sanitize_filename("", p), "_");
            assert_eq!(sanitize_filename("   ", p), "_");
            assert_eq!(sanitize_filename("a/b", p), "a_b");
        }
    }

    #[test]
    fn sanitize_idempotent() {
        let inputs = [
            r#"x:y*z?"<>|(){}[]/\.mp4"#,
            "CON.mp4",
            "제목.  .mp4",
            "  sp\u{3000}ace x  .mp4",
            "trail. . ",
            "..mp4",
            "a .b",
            "",
            ". .",
            "a\t \tb",
        ];
        for p in ALL {
            for s in inputs {
                let once = sanitize_filename(s, p);
                assert_eq!(sanitize_filename(&once, p), once, "{p:?} {s:?}");
            }
        }
    }

    #[test]
    fn default_filename_fixtures() {
        for p in ALL {
            assert_eq!(
                default_filename(&fixture_meta("testdata/hls/video_info.json"), p),
                "[261005] 테스트채널 - 123.mp4"
            );
            assert_eq!(
                default_filename(&fixture_meta("testdata/vod/video_info.json"), p),
                "[261004] 가상채널 - 가상 일반 VOD 제목 (괄호) 테스트.mp4"
            );
            assert_eq!(
                default_filename(&fixture_meta("internal/api/testdata/clip_playinfo.json"), p),
                "[클립] 클립채널 - 테스트 클립 하나.mp4"
            );
        }
    }

    #[test]
    fn default_filename_fallbacks() {
        let p = Linux;
        // live_open_date가 없으면 publish_date
        let mut m = meta(ContentKind::Video, "채널", "제목", None);
        m.publish_date = Some("2026-03-04 05:06:07".into());
        assert_eq!(default_filename(&m, p), "[261005] 채널 - 제목.mp4");
        // live_open_date가 깨졌으면 publish_date
        m.live_open_date = Some("garbage".into());
        assert_eq!(default_filename(&m, p), "[261005] 채널 - 제목.mp4");
        // 날짜 없음
        let m = meta(ContentKind::Video, "채널", "제목", None);
        assert_eq!(default_filename(&m, p), "채널 - 제목.mp4");
        // 채널 없음
        let m = meta(ContentKind::Video, "  ", "제목", Some("2024-01-02"));
        assert_eq!(default_filename(&m, p), "[240102] 제목.mp4");
        let m = meta(ContentKind::Clip, "", "제목", None);
        assert_eq!(default_filename(&m, p), "[클립] 제목.mp4");
        // 제목 없음
        let m = meta(ContentKind::Clip, "클립채널", "", None);
        assert_eq!(default_filename(&m, p), "[클립] 클립채널 - _.mp4");
        // 채널·제목 각각 sanitize, 괄호 유지
        let m = meta(ContentKind::Video, "a/b", "x: (y)?", Some("2024-01-02"));
        assert_eq!(default_filename(&m, Windows), "[240102] a_b - x_ (y)_.mp4");
        assert_eq!(default_filename(&m, Linux), "[240102] a_b - x: (y)?.mp4");
        // 채널·날짜 없이 예약어 제목
        let m = meta(ContentKind::Video, "", "con", None);
        assert_eq!(default_filename(&m, Windows), "con_.mp4");
    }

    #[test]
    fn truncate_utf8_200() {
        let title = "가".repeat(100); // 300바이트
        let m = meta(ContentKind::Video, "채널", &title, Some("2024-01-02"));
        for p in ALL {
            let name = default_filename(&m, p);
            assert!(name.len() <= MAX_FILENAME_BYTES, "{}", name.len());
            assert!(name.starts_with("[240102] 채널 - 가"), "{name}");
            assert!(name.ends_with("가.mp4"), "{name}");
            // [240102]␠(9) + 채널(6) + ␠-␠(3) + .mp4(4) = 22 → 제목 178바이트 → 한글 59자
            assert_eq!(name.matches('가').count(), 59);
            assert_eq!(sanitize_filename(&name, p), name);
        }

        // 자른 자리에 공백·마침표가 오면 Windows는 지운다.
        let title = format!("{}. 끝", "a".repeat(177));
        let m = meta(ContentKind::Video, "채널", &title, Some("2024-01-02"));
        assert_eq!(
            default_filename(&m, Windows),
            format!("[240102] 채널 - {}.mp4", "a".repeat(177))
        );

        // 채널이 아주 길면 제목을 일정 길이 남기고 채널도 자른다.
        let m = meta(
            ContentKind::Clip,
            &"채".repeat(100),
            &"가".repeat(100),
            None,
        );
        let name = default_filename(&m, Linux);
        assert!(name.len() <= MAX_FILENAME_BYTES, "{}", name.len());
        assert!(name.starts_with("[클립] 채"), "{name}");
        assert_eq!(name.matches('가').count(), MIN_TITLE_BYTES / 3);
        assert!(name.contains(" - "));
    }

    #[test]
    fn output_path() {
        let folder = Path::new("dl");
        for p in ALL {
            assert_eq!(
                super::output_path(folder, "[x] t", p),
                folder.join("[x] t.mp4")
            );
            assert_eq!(super::output_path(folder, "t", p), folder.join("t.mp4"));
            assert_eq!(super::output_path(folder, "a/b", p), folder.join("a_b.mp4"));
            assert_eq!(super::output_path(folder, "T.MP4", p), folder.join("T.MP4"));
            assert_eq!(
                super::output_path(folder, "t__mp4", p),
                folder.join("t__mp4.mp4")
            );
            assert_eq!(
                super::output_path(folder, "a__MP4", p),
                folder.join("a__MP4.mp4")
            );
            assert_eq!(super::output_path(folder, "", p), folder.join("_.mp4"));
        }
        assert_eq!(
            super::output_path(folder, "CON", Windows),
            folder.join("CON_.mp4")
        );

        // 길이 제한: 확장자를 보존하고 char 경계에서 자른다.
        let long = "가".repeat(100);
        for p in ALL {
            let out = super::output_path(folder, &long, p);
            let name = out.file_name().unwrap().to_str().unwrap();
            assert!(name.len() <= MAX_FILENAME_BYTES);
            assert_eq!(name, format!("{}.mp4", "가".repeat(65)));
        }
    }

    #[test]
    fn platform_current_matches_target() {
        let p = Platform::current();
        if cfg!(windows) {
            assert_eq!(p, Windows);
        } else if cfg!(target_os = "macos") {
            assert_eq!(p, MacOs);
        } else {
            assert_eq!(p, Linux);
        }
    }
}
