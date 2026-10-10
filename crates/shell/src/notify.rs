//! OS 알림 문자열(Tauri 비의존). 문구의 원천은 `docs/design/system/content.md` §14(D38)다.
//!
//! 제목에 앱 이름을 넣지 않는다(OS가 붙인다). 본문은 정리·절단된 영상 제목뿐이고 채널 이름·경로·주소·
//! 오류 원문은 넣지 않는다. 자소 분리는 새 의존성 없이 아래 `grapheme_ranges`의 최소 구현을 쓴다
//! (`unicode-segmentation`은 Cargo.lock에 Tauri의 간접 의존으로만 있어 셸의 직접 의존이 되지 않게 했다).

use crate::consts::NOTIFY_TITLE_MAX_GRAPHEMES;

/// 완료 알림 제목
pub const NOTIFY_COMPLETED_TITLE: &str = "다운로드를 마쳤어요";
/// 실패 알림 제목
pub const NOTIFY_FAILED_TITLE: &str = "다운로드를 마치지 못했어요";
/// 받기가 멈춘 알림 제목(연결 대기 상한 초과, (f)가 쓴다)
pub const NOTIFY_STALLED_TITLE: &str = "받기가 멈췄어요";

/// 묶음 알림 본문 "{첫 제목} 외 {n}개". 첫 제목은 이미 정리·절단된 값이어야 한다.
pub fn many_body(first: &str, n: usize) -> String {
    format!("{first} 외 {n}개")
}

/// OS 전원 관리 화면의 사유 "치지직 영상 {n}개 받는 중"
pub fn power_reason(n: usize) -> String {
    format!("치지직 영상 {n}개 받는 중")
}

/// 표시용 문자열 정리(§13). BIDI 제어·ZWSP·WJ·BOM·소프트하이픈은 지우고 C0/C1 제어 문자와
/// U+2028/2029는 공백으로 바꾼다.
pub fn clean_display_text(s: &str) -> String {
    s.chars()
        .filter_map(|c| match c {
            // BIDI 제어(LRM·RLM·ALM, 임베딩·오버라이드, 격리), ZWSP, WJ·보이지 않는 연산자, BOM, 소프트하이픈
            '\u{061C}'
            | '\u{200E}'
            | '\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2066}'..='\u{2069}'
            | '\u{200B}'
            | '\u{2060}'..='\u{2064}'
            | '\u{FEFF}'
            | '\u{00AD}' => None,
            '\u{2028}' | '\u{2029}' => Some(' '),
            c if c.is_control() => Some(' '),
            c => Some(c),
        })
        .collect()
}

/// 이어붙는(앞 글자와 한 자소를 이루는) 문자인가: 결합 문자·변이 선택자·이모지 수정자·태그·ZWJ
fn is_extend(c: char) -> bool {
    matches!(c,
        '\u{0300}'..='\u{036F}' | '\u{0483}'..='\u{0489}' | '\u{0591}'..='\u{05BD}'
        | '\u{0610}'..='\u{061A}' | '\u{064B}'..='\u{065F}' | '\u{0E31}' | '\u{0E34}'..='\u{0E3A}'
        | '\u{0E47}'..='\u{0E4E}' | '\u{1AB0}'..='\u{1AFF}' | '\u{1DC0}'..='\u{1DFF}'
        | '\u{200C}' | '\u{200D}' | '\u{20D0}'..='\u{20FF}' | '\u{302A}'..='\u{302F}'
        | '\u{3099}'..='\u{309A}' | '\u{FE00}'..='\u{FE0F}' | '\u{FE20}'..='\u{FE2F}'
        | '\u{1F3FB}'..='\u{1F3FF}' | '\u{E0020}'..='\u{E007F}' | '\u{E0100}'..='\u{E01EF}')
}

/// 한글 자모 종류(조합형): 0 아님, 1 초성, 2 중성, 3 종성
fn jamo_kind(c: char) -> u8 {
    match c {
        '\u{1100}'..='\u{115F}' | '\u{A960}'..='\u{A97C}' => 1,
        '\u{1160}'..='\u{11A7}' | '\u{D7B0}'..='\u{D7C6}' => 2,
        '\u{11A8}'..='\u{11FF}' | '\u{D7CB}'..='\u{D7FB}' => 3,
        _ => 0,
    }
}

/// 완성형 한글 음절이 받침 없는 LV인가(뒤에 중성·종성이 이어질 수 있다)
fn is_lv_syllable(c: char) -> bool {
    matches!(c, '\u{AC00}'..='\u{D7A3}') && (c as u32 - 0xAC00).is_multiple_of(28)
}

fn is_regional(c: char) -> bool {
    matches!(c, '\u{1F1E6}'..='\u{1F1FF}')
}

/// 자소(확장 자소 군집) 경계의 근사. 결합 문자·ZWJ 이모지·국기 쌍·조합형 한글(macOS NFD)·CRLF를 한 자소로 묶는다.
/// 인도계 결합 같은 드문 경우는 묶지 않는다(자르는 위치가 한 글자 어긋날 뿐 깨진 문자는 만들지 않는다).
fn grapheme_ranges(s: &str) -> Vec<(usize, usize)> {
    let mut out: Vec<(usize, usize)> = Vec::new();
    let mut prev: Option<char> = None;
    let mut regional_run = 0usize;
    let mut after_zwj = false;
    for (i, c) in s.char_indices() {
        let join = match prev {
            None => false,
            Some(p) => {
                (p == '\r' && c == '\n')
                    || is_extend(c)
                    || after_zwj
                    || (is_regional(p) && is_regional(c) && regional_run % 2 == 1)
                    || matches!(
                        (jamo_kind(p), jamo_kind(c)),
                        (1, 1 | 2) | (2, 2 | 3) | (3, 3)
                    )
                    || (is_lv_syllable(p) && matches!(jamo_kind(c), 2 | 3))
            }
        };
        regional_run = if is_regional(c) { regional_run + 1 } else { 0 };
        if is_regional(c) && !join {
            regional_run = 1;
        }
        after_zwj = c == '\u{200D}';
        if join {
            if let Some(last) = out.last_mut() {
                last.1 = i + c.len_utf8();
            }
        } else {
            out.push((i, i + c.len_utf8()));
        }
        prev = Some(c);
    }
    out
}

/// 자소 수.
pub fn grapheme_count(s: &str) -> usize {
    grapheme_ranges(s).len()
}

/// 자소 경계에서 `max`개로 자른다. 넘치면 마지막에 `…` 한 글자를 붙이되 전체가 `max`개를 넘지 않는다.
pub fn clip_graphemes(s: &str, max: usize) -> String {
    let g = grapheme_ranges(s);
    if g.len() <= max {
        return s.to_string();
    }
    if max == 0 {
        return String::new();
    }
    let keep = max - 1;
    let cut = if keep == 0 { 0 } else { g[keep - 1].1 };
    format!("{}…", &s[..cut])
}

/// 알림 본문용 영상 제목: 정리한 뒤 `NOTIFY_TITLE_MAX_GRAPHEMES`로 자른다.
pub fn notify_title_text(title: &str) -> String {
    clip_graphemes(clean_display_text(title).trim(), NOTIFY_TITLE_MAX_GRAPHEMES)
}

/// Linux 알림 서버는 본문을 마크업으로 읽을 수 있어 `<>&`를 이스케이프한다.
pub fn escape_linux_markup(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_have_no_app_name_or_punctuation() {
        for t in [
            NOTIFY_COMPLETED_TITLE,
            NOTIFY_FAILED_TITLE,
            NOTIFY_STALLED_TITLE,
        ] {
            assert!(!t.contains("치지직"), "{t}");
            assert!(!t.ends_with(['.', '!', '?']), "{t}");
        }
        assert_eq!(NOTIFY_COMPLETED_TITLE, "다운로드를 마쳤어요");
        assert_eq!(NOTIFY_FAILED_TITLE, "다운로드를 마치지 못했어요");
        assert_eq!(NOTIFY_STALLED_TITLE, "받기가 멈췄어요");
    }

    #[test]
    fn many_and_power_follow_table() {
        assert_eq!(many_body("예시 영상", 3), "예시 영상 외 3개");
        assert_eq!(power_reason(2), "치지직 영상 2개 받는 중");
    }

    #[test]
    fn clean_removes_invisible_and_blanks_controls() {
        let dirty = "a\u{202E}b\u{200B}c\u{2060}d\u{FEFF}e\u{00AD}f\u{2066}g\u{200F}";
        assert_eq!(clean_display_text(dirty), "abcdefg");
        assert_eq!(
            clean_display_text("x\ty\nz\u{0085}w\u{2028}v\u{2029}u\u{0000}"),
            "x y z w v u "
        );
        assert_eq!(clean_display_text("정상 제목"), "정상 제목");
        // ZWJ 이모지 결합자는 지우지 않는다
        assert_eq!(clean_display_text("👨\u{200D}👩"), "👨\u{200D}👩");
    }

    #[test]
    fn graphemes_group_clusters() {
        assert_eq!(grapheme_count("abc"), 3);
        assert_eq!(grapheme_count("e\u{0301}"), 1);
        assert_eq!(grapheme_count("👨\u{200D}👩\u{200D}👧"), 1);
        assert_eq!(grapheme_count("👍\u{1F3FD}"), 1);
        assert_eq!(grapheme_count("\u{1F1F0}\u{1F1F7}\u{1F1FA}\u{1F1F8}"), 2);
        assert_eq!(grapheme_count("\r\n"), 1);
        // 조합형 한글(초성+중성+종성)은 한 자소
        assert_eq!(grapheme_count("\u{1112}\u{1161}\u{11AB}"), 1);
        assert_eq!(grapheme_count("한글"), 2);
    }

    #[test]
    fn clip_respects_limit_and_boundaries() {
        assert_eq!(clip_graphemes("짧은 제목", 40), "짧은 제목");
        let long = "가".repeat(60);
        let c = clip_graphemes(&long, 40);
        assert_eq!(grapheme_count(&c), 40);
        assert!(c.ends_with('…'));
        assert_eq!(c.chars().filter(|&ch| ch == '가').count(), 39);
        // 정확히 40이면 그대로
        let exact = "나".repeat(40);
        assert_eq!(clip_graphemes(&exact, 40), exact);
        // 결합 문자·이모지 한가운데를 자르지 않는다
        let s = format!("{}{}", "a".repeat(38), "👨\u{200D}👩\u{200D}👧x");
        assert_eq!(clip_graphemes(&s, 40), s);
        let s2 = format!("{}{}", "a".repeat(39), "👨\u{200D}👩\u{200D}👧x");
        let c2 = clip_graphemes(&s2, 40);
        assert_eq!(c2, format!("{}…", "a".repeat(39)));
        assert_eq!(clip_graphemes("abc", 0), "");
    }

    #[test]
    fn body_is_cleaned_and_at_most_max_graphemes() {
        let nasty = format!("\u{202E}{}\u{200B}", "제".repeat(100));
        let b = notify_title_text(&nasty);
        assert!(grapheme_count(&b) <= NOTIFY_TITLE_MAX_GRAPHEMES, "{b}");
        assert!(!b.contains('\u{202E}') && !b.contains('\u{200B}'));
        assert_eq!(notify_title_text("  앞뒤 공백  "), "앞뒤 공백");
    }

    #[test]
    fn linux_markup_is_escaped() {
        assert_eq!(escape_linux_markup("a<b>&c"), "a&lt;b&gt;&amp;c");
        assert_eq!(escape_linux_markup("평범"), "평범");
    }

    #[test]
    fn bodies_never_carry_paths_urls_or_cookies() {
        // 알림 본문은 제목 정리 결과뿐이다. 제목에 섞여 와도 구조(경로·주소)를 새로 만들지 않고,
        // 고정 문구(제목·묶음·전원)에는 금지 패턴이 없다.
        for s in [
            NOTIFY_COMPLETED_TITLE,
            NOTIFY_FAILED_TITLE,
            NOTIFY_STALLED_TITLE,
            &many_body("예시 영상", 12),
            &power_reason(4),
        ] {
            assert!(!s.contains('/') && !s.contains('\\'), "{s}");
            assert!(!s.contains("http") && !s.contains("NID_"), "{s}");
            assert!(grapheme_count(s) <= NOTIFY_TITLE_MAX_GRAPHEMES + 10, "{s}");
        }
    }
}
