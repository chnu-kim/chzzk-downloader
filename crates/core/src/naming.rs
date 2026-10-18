//! 파일명 생성과 정리(설계 §6).
//!
//! - VOD: `[YYMMDD] {채널} - {제목}.mp4`, 클립: `[클립] {채널} - {제목}.mp4`
//! - OS별 규칙은 `Platform` 인자로 받는다. 그래서 한 호스트에서 세 OS 규칙을 모두 테스트한다.
//! - 이름 전체(`.mp4` 포함)는 UTF-8 200바이트 이하다. `.part.json` 접미사와 한글 여유를 남긴다.

use std::path::{Path, PathBuf};

use crate::model::{ContentKind, ContentMeta, ContentRef, TimeRange};

/// 파일명 전체의 UTF-8 바이트 상한(확장자 포함).
pub const MAX_FILENAME_BYTES: usize = 200;

/// 영상 출력 확장자(기본). 구간·채팅 이름 규칙은 mp4 전용이다.
const EXT: &str = ".mp4";

/// 출력 확장자. 코어가 정한다(`.m4a`는 이 한 곳에서만, audio-only.md A5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaExt {
    /// 영상(`.mp4`)
    Mp4,
    /// 오디오만 받기(`.m4a`)
    M4a,
}

impl MediaExt {
    /// 점을 포함한 확장자.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mp4 => ".mp4",
            Self::M4a => ".m4a",
        }
    }

    /// 화질 키로 정한다. `AUDIO_QUALITY_ID`면 `.m4a`, 그 밖은 `.mp4`.
    pub fn for_quality(quality_id: &str) -> Self {
        if quality_id == crate::mpd::AUDIO_QUALITY_ID {
            Self::M4a
        } else {
            Self::Mp4
        }
    }
}

/// 경로의 파일 이름이 `.m4a`(대소문자 무시)로 끝나는가. 코어가 화질과 확장자가 맞는지 보는 데 쓴다.
pub fn is_audio_output(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.to_ascii_lowercase().ends_with(MediaExt::M4a.as_str()))
}

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

/// 메타데이터로 기본 파일명을 만든다. 결과는 정리를 마친 값이고(`settle_filename`: 카드에 보인 이름 = 저장 이름) 200바이트 이하다.
pub fn default_filename(meta: &ContentMeta, p: Platform) -> String {
    // "채널이 비었는가"는 문자 규칙을 적용하고 trim한 뒤의 값으로 판단한다.
    let channel = clean_component(&meta.channel_name, p);
    // 제목은 `.mp4` 바로 앞에 오므로, Windows에서는 끝 `.`·공백을 미리 지운다.
    // 그래야 빈 제목 `_` 대체가 조립 전에 정해지고 길이 예산에 들어간다.
    let mut title = trim_piece(&clean_component(&meta.title, p), p);
    if title.is_empty() {
        title.push('_');
    }

    let prefix = head_prefix(meta);
    let sep = if channel.is_empty() { "" } else { " - " };

    // 접두어·구분자·확장자를 뺀 나머지를 채널과 제목이 나눠 쓴다.
    let avail = MAX_FILENAME_BYTES.saturating_sub(prefix.len() + sep.len() + EXT.len());
    let (mut channel, mut title) = fit_channel_title(&channel, &title, avail, p);
    // 자른 제목이 `. . .`처럼 trim으로 다 지워지면 `_`로 채우고 그 1바이트를 채널에서 뺀다.
    if title.is_empty() {
        title.push('_');
        channel = trim_piece(truncate_utf8(&channel, avail.saturating_sub(1)), p);
    }
    // 자른 뒤 채널이 비었으면(Windows 끝 `.`/공백 제거) 구분자도 뺀다. 길이는 줄기만 한다.
    let sep = if channel.is_empty() { "" } else { sep };

    settle_default_filename(&format!("{prefix}{channel}{sep}{title}{EXT}"), p)
}

/// 종류별 이름 머리(끝 공백 포함): `[YYMMDD] `·`[클립] `·`[생방송 YYMMDD-HHMM] `. 날짜 없는 영상은 빈 문자열이다.
fn head_prefix(meta: &ContentMeta) -> String {
    match meta.kind {
        ContentKind::Clip => "[클립] ".to_string(),
        ContentKind::Live => {
            // 같은 방송을 다시 받아도 이름이 겹치지 않도록 시작 시각(KST)까지 적는다.
            let raw = meta.live_open_date.as_deref();
            match raw.and_then(parse_live_date) {
                Some((y, m, d)) => match raw.and_then(parse_live_time) {
                    Some((hh, mm)) => {
                        format!("[생방송 {:02}{m:02}{d:02}-{hh:02}{mm:02}] ", y % 100)
                    }
                    None => format!("[생방송 {:02}{m:02}{d:02}] ", y % 100),
                },
                None => "[생방송] ".to_string(),
            }
        }
        ContentKind::Video => match meta_date(meta) {
            Some((y, m, d)) => format!("[{:02}{m:02}{d:02}] ", y % 100),
            None => String::new(),
        },
    }
}

/// 영상 날짜: 방송 시작일, 없거나 읽을 수 없으면 공개일.
fn meta_date(meta: &ContentMeta) -> Option<(u16, u8, u8)> {
    meta.live_open_date
        .as_deref()
        .and_then(parse_live_date)
        .or_else(|| meta.publish_date.as_deref().and_then(parse_live_date))
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
pub(crate) fn truncate_utf8(s: &str, max: usize) -> &str {
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

/// Windows 예약 장치명(대소문자 무시). `stem`은 끝 공백을 지운 값이다.
///
/// `CON PRN AUX NUL CONIN$ CONOUT$`, `COM`/`LPT` + `1`–`9` 또는 위첨자 `¹ ² ³`.
fn is_windows_reserved(stem: &str) -> bool {
    const NAMES: [&str; 6] = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"];
    let upper = stem.to_ascii_uppercase();
    if NAMES.contains(&upper.as_str()) {
        return true;
    }
    let chars: Vec<char> = upper.chars().collect();
    chars.len() == 4
        && (upper.starts_with("COM") || upper.starts_with("LPT"))
        && matches!(chars[3], '1'..='9' | '\u{00B9}' | '\u{00B2}' | '\u{00B3}')
}

/// 파일명 전체를 OS 규칙에 맞게 정리한다. 멱등이다(두 번 적용해도 같다).
///
/// - 공통: 전각 공백·NBSP → 공백, U+0000–001F·U+007F 제거, 연속 공백 하나로, trim, `/` → `_`, 빈 결과 `_`
/// - Windows: `\ : * ? " < > |` → `_`, 끝의 `.`과 공백 제거, 예약어면 `_` 접미
/// - macOS: `:` → `_`
/// - `[ ] ( ) { }`는 모든 OS에서 유지
///
/// Windows는 이름 전체의 끝 `.`·공백을 먼저 지운 뒤 확장자를 나눈다. 그래야 두 번째 적용에서
/// 앞쪽 `.`이 새 확장자 구분자가 되지 않는다(`.x.` → `_.x`).
/// 확장자는 Go와 같이 "`.`을 포함하고 `.`으로 끝나지 않으면 마지막 `.` 뒤"로 나눈다.
/// 그다음 trim·끝 `.`/공백 제거(Windows)·빈 값 처리를 확장자 앞 base에 적용한다(`.mp4` → `_.mp4`).
/// 길이 제한은 하지 않는다(`output_path`와 `default_filename`이 한다).
pub fn sanitize_filename(name: &str, p: Platform) -> String {
    let whole = normalize_chars(name, p);
    let mut whole = whole.trim();
    if p == Platform::Windows {
        whole = whole.trim_end_matches(['.', ' ']);
    }

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
    // 끝 공백은 지우고 비교한다(`CON .x` → `CON_ .x`).
    if p == Platform::Windows {
        let stem_end = base.find('.').unwrap_or(base.len());
        let stem = base[..stem_end].trim_end_matches(' ');
        if is_windows_reserved(stem) {
            base.insert(stem.len(), '_');
        }
    }
    base + ext
}

/// 저장 폴더와 파일명으로 최종 경로를 만든다.
///
/// 파일명을 정리하고, 확장자가 `.mp4`(대소문자 무시)가 아니면 `.mp4`를 붙이고, 200바이트로 자른다.
/// Go의 `__mp4` → `.mp4` 치환 규칙은 없앴다.
pub fn output_path(folder: &Path, filename: &str, p: Platform) -> PathBuf {
    output_path_ext(folder, filename, MediaExt::Mp4, p)
}

/// `output_path`의 확장자 지정판. 확장자는 `ext`(대소문자 무시)로 끝나지 않으면 붙인다. 규칙은 `output_path`와 같다.
/// `"x.mp4"`를 `M4a`로 만들면 `x.mp4.m4a`다(UI는 확장자 없는 이름만 보낸다).
pub fn output_path_ext(folder: &Path, filename: &str, ext: MediaExt, p: Platform) -> PathBuf {
    let ext = ext.as_str();
    let mut name = sanitize_filename(filename, p);
    if !name.to_ascii_lowercase().ends_with(ext) {
        name.push_str(ext);
    }
    if name.len() > MAX_FILENAME_BYTES {
        let (base, tail) = name.split_at(name.len() - ext.len());
        let base = trim_piece(truncate_utf8(base, MAX_FILENAME_BYTES - ext.len()), p);
        name = sanitize_filename(&format!("{base}{tail}"), p);
    }
    folder.join(name)
}

/// 카드 제안 이름: 만든 이름에서 `.mp4`를 뗀 것. 셸이 이 값을 입력칸에 넣고, 받을 때 `output_path`가 다시 정리해
/// `.mp4`를 붙인다. 그래서 `default_filename`·`render_filename`은 이 왕복(`settle_filename`)을 거친 이름만 돌려준다.
pub fn suggested_stem(name: &str) -> &str {
    name.strip_suffix(EXT).unwrap_or(name)
}

/// 화면에 보이는 이름과 실제 저장 이름을 같게 만든다.
///
/// `sanitize_filename`은 마지막 `.`을 확장자 경계로 보고 그 앞의 공백(Windows는 `.`도)을 지운다. 그래서
/// `sanitize(이름) + ".mp4"`와 `sanitize(이름 + ".mp4")`가 다르다(`Ep . 3` → `Ep. 3`). 받을 때는 뒤쪽 모양이므로
/// `suggested_stem` → `output_path` 왕복을 이름이 변하지 않을 때까지 되풀이한다. 제목이 `.mp4`로 끝나면
/// `output_path`가 확장자를 더 붙이지 않는 것(`x.mp4` → `x.mp4`)도 같은 왕복이 따라 정한다.
/// 길이도 `output_path`가 자른 결과를 쓴다. 멱등이다.
fn settle_filename(name: &str, p: Platform) -> String {
    let mut cur = name.to_string();
    // 두세 번이면 고정점에 닿는다(한 번 정리한 이름은 다시 정리해도 같다). 상한은 안전망이다.
    for _ in 0..8 {
        let next = stored_name(&cur, p);
        if next == cur {
            break;
        }
        cur = next;
    }
    cur
}

/// 카드에 `shown`이 보일 때 받으면 실제로 저장되는 파일 이름: 셸이 하는 `suggested_stem` → `output_path` 그대로다.
fn stored_name(shown: &str, p: Platform) -> String {
    let saved = output_path(Path::new(""), suggested_stem(shown), p);
    saved
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(shown)
        .to_string()
}

/// `default_filename`의 마무리. 기본 규칙은 저장 이름이 전과 바이트까지 같아야 한다(T1). 전에는 `sanitize_filename`한
/// 이름을 카드에 보였고 받을 때 한 번 정리했다. `settle_filename`은 그 저장 이름과 같은데, 제목이 `.mp4.mp4`로
/// 끝나는 입력만 왕복이 `.mp4`를 하나 더 벗겨 저장 이름이 달라진다. 그때는 전의 이름을 그대로 두어 저장 이름을 지킨다
/// (보인 이름과 저장 이름이 다른 것은 전과 같은 채로 남는다).
fn settle_default_filename(raw: &str, p: Platform) -> String {
    let settled = settle_filename(raw, p);
    let legacy = sanitize_filename(raw, p);
    if stored_name(&settled, p) == stored_name(&legacy, p) {
        settled
    } else {
        legacy
    }
}

/// 파일 이름에 쓸 수 있는 `H.MM.SS`(`:`는 Windows·macOS가 `_`로 바꾼다). 초 미만은 버린다.
fn clock_dots(ms: u64) -> String {
    let s = ms / 1000;
    format!("{}.{:02}.{:02}", s / 3600, s / 60 % 60, s % 60)
}

/// 구간 받기 파일 이름 끝에 붙이는 접미사 ` (H.MM.SS~H.MM.SS)`. 끝을 모르면(`end_ms = None`) ` (H.MM.SS~)`다.
///
/// 끝 시각을 지어내 찍지 않는다. `~`·`.`·괄호는 어느 OS에서도 금지 문자가 아니고, 번호 이름의 ` (2)`와
/// 모양이 겹치지 않는다(`제목 (0.10.00~0.20.00) (2)`).
pub fn range_suffix(r: &TimeRange) -> String {
    format!(
        " ({}~{})",
        clock_dots(r.start_ms),
        r.end_ms.map(clock_dots).unwrap_or_default()
    )
}

/// 구간 받기 파일 이름(확장자 제외): `{제목}{접미사}`.
///
/// 제목은 `sanitize_filename`을 거치고, `.mp4`까지 `MAX_FILENAME_BYTES`를 넘지 않도록 **제목 쪽을 줄인다**.
/// `output_path`는 이름 끝부터 자르므로 접미사가 붙은 채로 넘기면 접미사가 잘려, 다른 구간이 같은 경로가 된다.
/// 이 함수의 결과를 `output_path`에 넘기면 더 자르지 않는다.
pub fn range_stem(title: &str, r: &TimeRange, p: Platform) -> String {
    let suffix = range_suffix(r);
    let title = match title.len().checked_sub(EXT.len()) {
        Some(i) if title.is_char_boundary(i) && title[i..].eq_ignore_ascii_case(EXT) => &title[..i],
        _ => title,
    };
    let base = sanitize_filename(title, p);
    let room = MAX_FILENAME_BYTES.saturating_sub(EXT.len() + suffix.len());
    let mut head = trim_piece(truncate_utf8(&base, room), p);
    if head.is_empty() {
        head.push('_');
    }
    head + &suffix
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

/// `"YYYY-MM-DD HH:MM[:SS]"`(또는 `T` 구분)에서 시·분을 읽는다. 시간이 없거나 범위를 벗어나면 `None`.
pub fn parse_live_time(raw: &str) -> Option<(u8, u8)> {
    parse_live_date(raw)?;
    let rest = raw.get(11..)?;
    let (hh, mm) = (rest.get(..2)?, rest.get(3..5)?);
    if rest.as_bytes().get(2) != Some(&b':')
        || !hh.bytes().chain(mm.bytes()).all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let (hh, mm): (u8, u8) = (hh.parse().ok()?, mm.parse().ok()?);
    (hh < 24 && mm < 60).then_some((hh, mm))
}

/// 영상 최종 경로 옆 파일 경로. 파일 이름 끝의 `.mp4`(대소문자 무시)만 `ext`로 바꾼다. `.mp4`로 끝나지 않으면
/// 이름 뒤에 `ext`를 붙인다. `ext`는 점을 포함한다(`".ass"`, `".chat.jsonl"`). 메타데이터로 이름을 다시 만들지 않고
/// 길이도 자르지 않는다(최대 `.chat.jsonl.part.json`으로 217바이트).
pub fn sibling_path(video: &Path, ext: &str) -> PathBuf {
    debug_assert!(ext.starts_with('.'));
    let Some(name) = video.file_name() else {
        let mut p = video.as_os_str().to_owned();
        p.push(ext);
        return PathBuf::from(p);
    };
    match name.to_str() {
        Some(n) => {
            let stem = match n.len().checked_sub(EXT.len()) {
                Some(cut)
                    if cut > 0 && n.is_char_boundary(cut) && n[cut..].eq_ignore_ascii_case(EXT) =>
                {
                    &n[..cut]
                }
                _ => n,
            };
            video.with_file_name(format!("{stem}{ext}"))
        }
        None => {
            let mut n = name.to_owned();
            n.push(ext);
            video.with_file_name(n)
        }
    }
}

// ---------------------------------------------------------------------------
// 파일명 템플릿(docs/design/features/filename-template.md, core.md 78)
// ---------------------------------------------------------------------------

/// 템플릿 문자열 길이 상한(바이트). **[잠정]** 근거 없는 수치다(ADR-0009 묶음). 가장 긴 고정 토큰(`{prefix}`
/// 생방송 23바이트)을 더해도 제목 몫 `MIN_TITLE_BYTES`를 남기는 여유로 잡았다.
pub const MAX_TEMPLATE_BYTES: usize = 100;

/// 기본 템플릿. 설정에 템플릿이 없으면 `default_filename`을 그대로 쓰고, 이 문자열은 입력칸에 보이는 값이다.
/// 이 템플릿을 엔진으로 만든 결과가 `default_filename`과 같다는 것은 테스트(`default_equivalence_*`)가 지킨다.
pub const DEFAULT_TEMPLATE: &str = "{prefix} {channel} - {title}";

/// 템플릿에 쓸 수 있는 토큰.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Token {
    /// 제목(필수, 한 번)
    Title,
    /// 채널 이름
    Channel,
    /// `YYMMDD`
    Date,
    /// 영상 번호·클립 ID
    No,
    /// 종류별 머리: `[YYMMDD]`·`[클립]`·`[생방송 YYMMDD-HHMM]`
    Prefix,
}

impl Token {
    /// 템플릿에 쓰는 이름(중괄호 없이).
    pub fn name(self) -> &'static str {
        match self {
            Token::Title => "title",
            Token::Channel => "channel",
            Token::Date => "date",
            Token::No => "no",
            Token::Prefix => "prefix",
        }
    }

    fn from_name(s: &str) -> Option<Token> {
        Some(match s {
            "title" => Token::Title,
            "channel" => Token::Channel,
            "date" => Token::Date,
            "no" => Token::No,
            "prefix" => Token::Prefix,
            _ => return None,
        })
    }
}

/// `parse_template`이 거부하는 이유. 하나만 돌려주며 순서는 짝 → 모르는 토큰 → 중복 → 경로 구분자 → 제목 → 길이다.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TemplateError {
    /// `{` `}` 짝이 맞지 않거나 `{}`처럼 이름이 비었다
    UnbalancedBrace,
    /// 모르는 토큰 이름(대소문자를 구분한다)
    UnknownToken(String),
    /// 같은 토큰을 두 번 썼다
    DuplicateToken(Token),
    /// 리터럴에 `/`나 `\`가 있다(하위 폴더를 만들지 않는다)
    PathSeparator,
    /// `{title}`이 없다
    MissingTitle,
    /// `MAX_TEMPLATE_BYTES`를 넘는다
    TooLong,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Piece {
    Literal(String),
    Token(Token),
}

/// 파싱된 파일명 템플릿. `parse_template`으로만 만든다.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileNameTemplate {
    pieces: Vec<Piece>,
}

/// 템플릿 문자열을 읽는다. 토큰은 `{title}` `{channel}` `{date}` `{no}` `{prefix}`다.
pub fn parse_template(s: &str) -> Result<FileNameTemplate, TemplateError> {
    use TemplateError::*;

    // 1. 구조(짝). 이름이 있는 `{...}`와 리터럴로 나눈다.
    enum Raw {
        Lit(String),
        Name(String),
    }
    let mut raw = Vec::new();
    let mut lit = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        match c {
            '{' => {
                let mut name = String::new();
                loop {
                    match chars.next() {
                        Some('}') => break,
                        Some('{') | None => return Err(UnbalancedBrace),
                        Some(c) => name.push(c),
                    }
                }
                if name.is_empty() {
                    return Err(UnbalancedBrace);
                }
                if !lit.is_empty() {
                    raw.push(Raw::Lit(std::mem::take(&mut lit)));
                }
                raw.push(Raw::Name(name));
            }
            '}' => return Err(UnbalancedBrace),
            c => lit.push(c),
        }
    }
    if !lit.is_empty() {
        raw.push(Raw::Lit(lit));
    }

    // 2. 모르는 토큰
    let mut pieces = Vec::with_capacity(raw.len());
    for r in raw {
        pieces.push(match r {
            Raw::Lit(l) => Piece::Literal(l),
            Raw::Name(n) => match Token::from_name(&n) {
                Some(t) => Piece::Token(t),
                None => return Err(UnknownToken(n)),
            },
        });
    }

    // 3. 중복
    let mut seen: Vec<Token> = Vec::new();
    for p in &pieces {
        if let Piece::Token(t) = p {
            if seen.contains(t) {
                return Err(DuplicateToken(*t));
            }
            seen.push(*t);
        }
    }

    // 4. 경로 구분자
    if pieces
        .iter()
        .any(|p| matches!(p, Piece::Literal(l) if l.contains(['/', '\\'])))
    {
        return Err(PathSeparator);
    }

    // 5. 제목
    if !seen.contains(&Token::Title) {
        return Err(MissingTitle);
    }

    // 6. 길이
    if s.len() > MAX_TEMPLATE_BYTES {
        return Err(TooLong);
    }
    Ok(FileNameTemplate { pieces })
}

/// 빈 토큰 옆에서 함께 지우는 구분 문자(공백 `-` `_` `.` `~` `,` `·`)뿐인 리터럴인가.
fn is_separators(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| matches!(c, ' ' | '-' | '_' | '.' | '~' | ',' | '·'))
}

/// 조립 결과의 한 조각. 제목·채널은 길이를 맞춘 뒤에 채운다.
enum Out {
    Text(String),
    Title,
    Channel,
}

/// 토큰 값(정리 전 아님: 문자 규칙은 적용했다). 빈 문자열은 "값 없음"이다.
struct Values {
    date: String,
    no: String,
    prefix: String,
}

impl Values {
    fn new(meta: &ContentMeta, content: &ContentRef, p: Platform) -> Self {
        let date = match meta.kind {
            ContentKind::Video => meta_date(meta),
            ContentKind::Live => meta.live_open_date.as_deref().and_then(parse_live_date),
            ContentKind::Clip => None,
        }
        .map(|(y, m, d)| format!("{:02}{m:02}{d:02}", y % 100))
        .unwrap_or_default();
        let no = match content {
            ContentRef::Video { video_no } => video_no.to_string(),
            ContentRef::Clip { clip_id } => clean_component(clip_id, p),
            ContentRef::Live { .. } => String::new(),
        };
        Values {
            date,
            no,
            prefix: head_prefix(meta).trim_end().to_string(),
        }
    }
}

impl FileNameTemplate {
    fn has(&self, t: Token) -> bool {
        self.pieces.contains(&Piece::Token(t))
    }

    /// 조각을 순서대로 펼친다. 값이 빈 토큰은 빼고, 그 바로 뒤 리터럴이 구분 문자뿐이면 함께 뺀다.
    /// 뒤에 값이 있는 토큰이 하나도 없으면(끝에 몰린 빈 토큰) 바로 앞 구분 문자 리터럴도 뺀다.
    fn layout(&self, v: &Values, channel_empty: bool, p: Platform) -> Vec<Out> {
        let is_empty = |t: Token| match t {
            Token::Title => false,
            Token::Channel => channel_empty,
            Token::Date => v.date.is_empty(),
            Token::No => v.no.is_empty(),
            Token::Prefix => v.prefix.is_empty(),
        };
        let mut out: Vec<Out> = Vec::new();
        let mut skip_next = false;
        for (i, piece) in self.pieces.iter().enumerate() {
            let skip = std::mem::take(&mut skip_next);
            match piece {
                Piece::Literal(l) => {
                    if skip {
                        continue;
                    }
                    let l = normalize_chars(l, p);
                    if !l.is_empty() {
                        out.push(Out::Text(l));
                    }
                }
                Piece::Token(t) if is_empty(*t) => {
                    if let Some(Piece::Literal(next)) = self.pieces.get(i + 1)
                        && is_separators(&normalize_chars(next, p))
                    {
                        skip_next = true;
                    }
                    let tail = !self.pieces[i + 1..]
                        .iter()
                        .any(|q| matches!(q, Piece::Token(t) if !is_empty(*t)));
                    if tail
                        && let Some(Out::Text(last)) = out.last()
                        && is_separators(last)
                    {
                        out.pop();
                    }
                }
                Piece::Token(t) => {
                    let text = match t {
                        Token::Title => {
                            out.push(Out::Title);
                            continue;
                        }
                        Token::Channel => {
                            out.push(Out::Channel);
                            continue;
                        }
                        Token::Date => &v.date,
                        Token::No => &v.no,
                        Token::Prefix => &v.prefix,
                    };
                    out.push(Out::Text(text.clone()));
                }
            }
        }
        out
    }
}

/// 템플릿으로 파일명을 만든다. 결과는 정리를 마친 `….mp4`이고(`settle_filename`) 200바이트 이하다
/// (`default_filename`과 같은 계약). 기본 템플릿의 결과는 `default_filename`과 같다.
///
/// 순서: 토큰 값 → 빈 토큰 옆 구분 문자 제거 → 리터럴 문자 규칙 → 제목·채널 길이 맞추기(제목 먼저,
/// `MIN_TITLE_BYTES` 바닥) → 채널이 비면 구분 문자 다시 제거 → `settle_filename`(정리·길이).
pub fn render_filename(
    t: &FileNameTemplate,
    meta: &ContentMeta,
    content: &ContentRef,
    p: Platform,
) -> String {
    let v = Values::new(meta, content, p);
    let mut title = trim_piece(&clean_component(&meta.title, p), p);
    if title.is_empty() {
        title.push('_');
    }
    // 템플릿에 없는 채널은 길이 몫에서도 뺀다.
    let channel = if t.has(Token::Channel) {
        clean_component(&meta.channel_name, p)
    } else {
        String::new()
    };

    let rest: usize = t
        .layout(&v, channel.is_empty(), p)
        .iter()
        .map(|o| match o {
            Out::Text(s) => s.len(),
            _ => 0,
        })
        .sum();
    let avail = MAX_FILENAME_BYTES.saturating_sub(rest + EXT.len());
    let (mut channel, mut title) = fit_channel_title(&channel, &title, avail, p);
    // 자른 제목이 다 지워지면 `_`로 채우고 그 1바이트를 채널에서 뺀다(`default_filename`과 같다).
    if title.is_empty() {
        title.push('_');
        channel = trim_piece(truncate_utf8(&channel, avail.saturating_sub(1)), p);
    }

    let mut name = String::new();
    for o in t.layout(&v, channel.is_empty(), p) {
        match o {
            Out::Text(s) => name.push_str(&s),
            Out::Title => name.push_str(&title),
            Out::Channel => name.push_str(&channel),
        }
    }
    name.push_str(EXT);
    // 정리와 길이(`{no}`(클립 ID)처럼 줄일 수 없는 값이 길면 끝을 자른다)는 저장 때와 같은 `output_path` 왕복이 한다.
    settle_filename(&name, p)
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

    /// fixture를 실제 info 파서로 읽는다(클립은 원 채널 `ownerChannel`을 파서가 고른다).
    fn fixture_meta(rel: &str) -> ContentMeta {
        let body = crate::testutil::fixture(rel);
        if rel.starts_with("testdata/clip/") {
            crate::info::parse_clip_info(&body).unwrap().0
        } else {
            crate::info::parse_video_info(&body).unwrap().0
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
            // 구분자 둘 중 하나만 틀려도 거부한다
            "2024x01-02",
            "2024-01x02",
        ] {
            assert_eq!(super::parse_live_date(bad), None, "{bad:?}");
        }
        assert_eq!(
            super::parse_live_date("2026-01-02 12:00:00"),
            Some((2026, 1, 2))
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
            // 리뷰 fuzz가 찾은 Windows 비멱등 입력(앞·안쪽 `.` + 끝 `.`)
            ".x.",
            "a .b.",
            "a ..b.",
            "\u{3000}.|.",
            ".1O\t.\t",
            "1Oxx\u{3000}..N?.",
            "\u{a0}a:L\u{3000}.NN.",
            "aP\u{3000}.?\u{a0} :\"P.",
            "CON .x.mp4",
            "COM\u{00B9} .mp4",
        ];
        for p in ALL {
            for s in inputs {
                let once = sanitize_filename(s, p);
                assert_eq!(sanitize_filename(&once, p), once, "{p:?} {s:?}");
            }
        }
        assert_eq!(sanitize_filename(".x.", Windows), "_.x");
        assert_eq!(sanitize_filename("a .b.", Windows), "a.b");
    }

    /// 작은 알파벳의 길이 1–6 문자열 전부에 대해 멱등을 확인한다.
    #[test]
    fn sanitize_idempotent_exhaustive() {
        const ALPHABET: [char; 6] = ['.', ' ', 'a', '?', ':', '\u{3000}'];
        let mut buf = Vec::new();
        for len in 1..=6u32 {
            for mut n in 0..ALPHABET.len().pow(len) {
                buf.clear();
                for _ in 0..len {
                    buf.push(ALPHABET[n % ALPHABET.len()]);
                    n /= ALPHABET.len();
                }
                let s: String = buf.iter().collect();
                for p in ALL {
                    let once = sanitize_filename(&s, p);
                    assert_eq!(sanitize_filename(&once, p), once, "{p:?} {s:?}");
                }
            }
        }
    }

    #[test]
    fn windows_reserved_extended() {
        let p = Windows;
        assert_eq!(sanitize_filename("COM\u{00B9}.mp4", p), "COM\u{00B9}_.mp4");
        assert_eq!(sanitize_filename("lpt\u{00B3}", p), "lpt\u{00B3}_");
        assert_eq!(sanitize_filename("LPT\u{00B2}.mp4", p), "LPT\u{00B2}_.mp4");
        assert_eq!(sanitize_filename("CONIN$.mp4", p), "CONIN$_.mp4");
        assert_eq!(sanitize_filename("conout$.mp4", p), "conout$_.mp4");
        assert_eq!(sanitize_filename("CON .x.mp4", p), "CON_ .x.mp4");
        assert_eq!(sanitize_filename("COM\u{2074}.mp4", p), "COM\u{2074}.mp4");
        assert_eq!(sanitize_filename("CONIN.mp4", p), "CONIN.mp4");
        let folder = Path::new("dl");
        assert_eq!(
            super::output_path(folder, "COM\u{00B9}", p),
            folder.join("COM\u{00B9}_.mp4")
        );
        for other in [MacOs, Linux] {
            assert_eq!(sanitize_filename("CONIN$.mp4", other), "CONIN$.mp4");
        }
    }

    #[test]
    fn default_filename_fixtures() {
        for p in ALL {
            assert_eq!(
                default_filename(&fixture_meta("testdata/hls/video_info.json"), p),
                "[260102] 테스트채널 - 테스트 다시보기.mp4"
            );
            assert_eq!(
                default_filename(&fixture_meta("testdata/vod/video_info.json"), p),
                "[260101] 가상채널 - 가상 일반 VOD 제목 (괄호) 테스트.mp4"
            );
            assert_eq!(
                default_filename(&fixture_meta("testdata/clip/clip_playinfo.json"), p),
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
        assert_eq!(default_filename(&m, p), "[260304] 채널 - 제목.mp4");
        // live_open_date가 깨졌으면 publish_date
        m.live_open_date = Some("garbage".into());
        assert_eq!(default_filename(&m, p), "[260304] 채널 - 제목.mp4");
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
    fn live_filename_has_start_time() {
        let p = Linux;
        let m = meta(
            ContentKind::Live,
            "채널",
            "제목",
            Some("2026-01-02 12:34:56"),
        );
        assert_eq!(
            default_filename(&m, p),
            "[생방송 260102-1234] 채널 - 제목.mp4"
        );
        let m = meta(ContentKind::Live, "채널", "제목", Some("2026-01-02"));
        assert_eq!(default_filename(&m, p), "[생방송 260102] 채널 - 제목.mp4");
        let m = meta(ContentKind::Live, "채널", "제목", None);
        assert_eq!(default_filename(&m, p), "[생방송] 채널 - 제목.mp4");
        assert_eq!(parse_live_time("2026-01-02T05:06:07"), Some((5, 6)));
        assert_eq!(parse_live_time("2026-01-02 24:00:00"), None);
        assert_eq!(parse_live_time("2026-01-02 5:06"), None);
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
    fn default_filename_budget_edges() {
        // 긴 채널 + 빈 제목: `_` 1바이트도 예산에 들어간다.
        let long_ch = "a".repeat(300);
        let cases = [
            (long_ch.clone(), String::new()),
            (long_ch.clone(), "..".to_string()),
            (long_ch.clone(), "  ".to_string()),
            (".".repeat(300), "제목".to_string()),
            ("ch".to_string(), ". ".repeat(150)),
            ("채".repeat(100), ". ".repeat(150)),
            (long_ch.clone(), format!("{}x", ". ".repeat(150))),
        ];
        for p in ALL {
            for kind in [ContentKind::Clip, ContentKind::Video] {
                for (ch, title) in &cases {
                    let m = meta(kind, ch, title, Some("2024-01-02"));
                    let name = default_filename(&m, p);
                    assert!(
                        name.len() <= MAX_FILENAME_BYTES,
                        "{p:?} {ch:?} {title:?} -> {} bytes",
                        name.len()
                    );
                    assert!(name.ends_with(".mp4"), "{name}");
                    assert_eq!(sanitize_filename(&name, p), name);
                }
            }
        }
        let m = meta(ContentKind::Clip, &long_ch, "", None);
        assert_eq!(
            default_filename(&m, Linux),
            format!("[클립] {} - _.mp4", "a".repeat(183))
        );
    }

    #[test]
    fn default_filename_windows_trailing_dots() {
        // 잘라서 비게 된 채널에는 구분자를 붙이지 않는다.
        let m = meta(ContentKind::Clip, &".".repeat(300), "제목", None);
        assert_eq!(default_filename(&m, Windows), "[클립] 제목.mp4");
        // 마침표뿐인 제목은 Windows에서 비므로 `_`가 된다.
        let m = meta(ContentKind::Video, "ch", "..", None);
        assert_eq!(default_filename(&m, Windows), "ch - _.mp4");
        assert_eq!(default_filename(&m, Linux), "ch - ...mp4");
        let m = meta(ContentKind::Video, "ch", "제목. .", None);
        assert_eq!(default_filename(&m, Windows), "ch - 제목.mp4");
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
    fn media_ext_for_quality_and_is_audio_output() {
        assert_eq!(MediaExt::for_quality("audio"), MediaExt::M4a);
        assert_eq!(
            MediaExt::for_quality("PD_720P_1280_4000_192"),
            MediaExt::Mp4
        );
        assert_eq!(MediaExt::for_quality("720p"), MediaExt::Mp4);
        assert_eq!(MediaExt::for_quality(""), MediaExt::Mp4);
        assert_eq!(MediaExt::M4a.as_str(), ".m4a");
        assert_eq!(MediaExt::Mp4.as_str(), ".mp4");

        assert!(is_audio_output(Path::new("dl/제목.m4a")));
        assert!(is_audio_output(Path::new("dl/T.M4A")));
        assert!(!is_audio_output(Path::new("dl/제목.mp4")));
        assert!(!is_audio_output(Path::new("dl/제목.m4a.part")));
        assert!(!is_audio_output(Path::new("dl/m4a")));
        assert!(!is_audio_output(Path::new("")));
    }

    #[test]
    fn output_path_m4a() {
        use MediaExt::{M4a, Mp4};
        let folder = Path::new("dl");
        for p in ALL {
            assert_eq!(
                super::output_path_ext(folder, "[x] t", M4a, p),
                folder.join("[x] t.m4a")
            );
            assert_eq!(
                super::output_path_ext(folder, "", M4a, p),
                folder.join("_.m4a")
            );
            // 이미 `.m4a`면(대소문자 무시) 그대로
            assert_eq!(
                super::output_path_ext(folder, "T.M4A", M4a, p),
                folder.join("T.M4A")
            );
            // `.mp4` 입력은 mp4로 보지 않는다: 현재 규칙의 연장
            assert_eq!(
                super::output_path_ext(folder, "x.mp4", M4a, p),
                folder.join("x.mp4.m4a")
            );
            // Mp4 지정은 기존 `output_path`와 같다
            assert_eq!(
                super::output_path_ext(folder, "t", Mp4, p),
                super::output_path(folder, "t", p)
            );
        }
        assert_eq!(
            super::output_path_ext(folder, "CON", M4a, Windows),
            folder.join("CON_.m4a")
        );
        // 길이 제한: 확장자를 보존하고 char 경계에서 자른다(세 OS)
        let long = "가".repeat(100);
        for p in ALL {
            let out = super::output_path_ext(folder, &long, M4a, p);
            let name = out.file_name().unwrap().to_str().unwrap();
            assert!(name.len() <= MAX_FILENAME_BYTES);
            assert_eq!(name, format!("{}.m4a", "가".repeat(65)));
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

    #[test]
    fn sibling_path_replaces_mp4() {
        let v = Path::new("/out/[260102] 테스트채널 - 테스트 다시보기.mp4");
        assert_eq!(
            sibling_path(v, ".ass"),
            Path::new("/out/[260102] 테스트채널 - 테스트 다시보기.ass")
        );
    }

    #[test]
    fn sibling_path_upper_ext() {
        assert_eq!(sibling_path(Path::new("a.MP4"), ".srt"), Path::new("a.srt"));
    }

    #[test]
    fn sibling_path_numbered() {
        assert_eq!(
            sibling_path(Path::new("a (1).mp4"), ".chat.jsonl"),
            Path::new("a (1).chat.jsonl")
        );
    }

    #[test]
    fn sibling_path_no_mp4() {
        assert_eq!(
            sibling_path(Path::new("a.mkv"), ".ass"),
            Path::new("a.mkv.ass")
        );
        assert_eq!(sibling_path(Path::new("a"), ".ass"), Path::new("a.ass"));
        // 이름이 ".mp4" 하나뿐이면 앞부분이 없으므로 바꾸지 않고 뒤에 붙인다
        assert_eq!(
            sibling_path(Path::new(".mp4"), ".ass"),
            Path::new(".mp4.ass")
        );
    }

    #[test]
    fn sibling_path_three_os() {
        for p in ALL {
            let out = super::output_path(Path::new("out"), "CON. 제목 .mp4", p);
            let sib = sibling_path(&out, ".ass");
            let out_name = out.file_name().unwrap().to_str().unwrap();
            let sib_name = sib.file_name().unwrap().to_str().unwrap();
            // 정리 결과를 다시 만들지 않는다: 끝 4바이트만 바뀐다
            assert_eq!(
                sib_name,
                format!("{}.ass", &out_name[..out_name.len() - 4]),
                "{p:?}"
            );
            assert_eq!(sib.parent(), out.parent());
        }
    }

    #[test]
    fn sibling_path_full_length() {
        let name = format!("{}a.mp4", "가".repeat(65));
        assert_eq!(name.len(), 200);
        let sib = sibling_path(Path::new(&name), ".chat.jsonl.part.json");
        let sib_name = sib.file_name().unwrap().to_str().unwrap();
        assert_eq!(sib_name.len(), 217);
        assert!(sib_name.starts_with(&name[..196]));
    }

    fn tr(start_ms: u64, end_ms: Option<u64>) -> TimeRange {
        TimeRange { start_ms, end_ms }
    }

    #[test]
    fn range_suffix_shape() {
        assert_eq!(
            range_suffix(&tr(600_000, Some(1_200_000))),
            " (0.10.00~0.20.00)"
        );
        assert_eq!(
            range_suffix(&tr(3_723_999, Some(7_200_000))),
            " (1.02.03~2.00.00)"
        );
        // 끝을 모르면 끝 시각을 지어내지 않는다
        assert_eq!(range_suffix(&tr(600_000, None)), " (0.10.00~)");
        assert!(!range_suffix(&tr(1, None)).contains(':'));
    }

    #[test]
    fn range_stem_short_names_keep_title() {
        let r = tr(0, Some(10_000));
        for p in ALL {
            assert_eq!(range_stem("짧은", &r, p), "짧은 (0.00.00~0.00.10)");
            // 끝의 `.mp4`는 한 번만 뗀다
            assert_eq!(range_stem("짧은.MP4", &r, p), "짧은 (0.00.00~0.00.10)");
        }
    }

    /// 금지 문자는 제목 쪽에서 정리되고 접미사의 `~`·`.`은 세 OS 모두 그대로다.
    #[test]
    fn range_stem_sanitizes_title_only() {
        let r = tr(600_000, None);
        assert_eq!(range_stem("a:b", &r, Windows), "a_b (0.10.00~)");
        assert_eq!(range_stem("a:b", &r, MacOs), "a_b (0.10.00~)");
        assert_eq!(range_stem("a:b", &r, Linux), "a:b (0.10.00~)");
        assert_eq!(range_stem("a?*b", &r, Windows), "a__b (0.10.00~)");
        // Windows 예약어 제목은 `_`를 붙인다
        assert_eq!(range_stem("CON", &r, Windows), "CON_ (0.10.00~)");
        // 제목이 비면 `_`
        assert_eq!(range_stem("", &r, Linux), "_ (0.10.00~)");
    }

    /// 긴 제목은 제목 쪽을 자르고 접미사는 남는다. 최종 경로도 200바이트 안이고, 구간이 다르면 경로도 다르다.
    #[test]
    fn range_stem_cuts_title_not_suffix() {
        let a = tr(0, Some(10_000));
        let b = tr(10_000, Some(20_000));
        let dir = Path::new("out");
        for p in ALL {
            for long in [
                "가".repeat(100),
                "a".repeat(300),
                "가 ".repeat(100),
                format!("{}. 끝", "a".repeat(177)),
                format!("{}....", "a".repeat(190)),
            ] {
                let pa = super::output_path(dir, &range_stem(&long, &a, p), p);
                let pb = super::output_path(dir, &range_stem(&long, &b, p), p);
                let na = pa.file_name().unwrap().to_str().unwrap();
                let nb = pb.file_name().unwrap().to_str().unwrap();
                assert!(na.ends_with(" (0.00.00~0.00.10).mp4"), "{p:?} {na}");
                assert!(nb.ends_with(" (0.00.10~0.00.20).mp4"), "{p:?} {nb}");
                assert!(na.len() <= MAX_FILENAME_BYTES, "{p:?} {}", na.len());
                assert_ne!(pa, pb);
                // 이름이 이미 자른 결과라 `output_path`가 한 번 더 다듬어도 같다(멱등)
                let stem = range_stem(&long, &a, p);
                assert_eq!(sanitize_filename(&stem, p), stem, "{p:?}");
            }
        }
    }

    /// 자른 자리에 공백·마침표가 오면 Windows는 지운다(접미사 앞 공백 하나만 남는다).
    #[test]
    fn range_stem_windows_trims_cut_edge() {
        let r = tr(0, None);
        let title = format!("{}. 끝", "a".repeat(180));
        let room = MAX_FILENAME_BYTES - EXT.len() - range_suffix(&r).len();
        let stem = range_stem(&title, &r, Windows);
        let head = stem.strip_suffix(&range_suffix(&r)).unwrap();
        assert!(head.len() <= room);
        assert!(!head.ends_with(['.', ' ']), "{head:?}");
    }

    // ---------------------------------------------------------------------
    // 파일명 템플릿(docs/design/features/filename-template.md)
    // ---------------------------------------------------------------------

    fn content_for(kind: ContentKind) -> ContentRef {
        match kind {
            ContentKind::Video => ContentRef::Video { video_no: 12345 },
            ContentKind::Clip => ContentRef::Clip {
                clip_id: "abcDEF123".into(),
            },
            ContentKind::Live => ContentRef::Live {
                channel_id: "0".repeat(32),
            },
        }
    }

    fn render_default(m: &ContentMeta, p: Platform) -> String {
        let t = parse_template(DEFAULT_TEMPLATE).unwrap();
        render_filename(&t, m, &content_for(m.kind), p)
    }

    fn render_with(tpl: &str, m: &ContentMeta, p: Platform) -> String {
        let t = parse_template(tpl).unwrap_or_else(|e| panic!("{tpl:?}: {e:?}"));
        render_filename(&t, m, &content_for(m.kind), p)
    }

    /// 기본 템플릿 결과 = `default_filename`(T1). 세 OS 모두.
    fn assert_default_equivalent(m: &ContentMeta) {
        for p in ALL {
            assert_eq!(render_default(m, p), default_filename(m, p), "{p:?} {m:?}");
        }
    }

    #[test]
    fn default_equivalence_existing_inputs() {
        for rel in [
            "testdata/hls/video_info.json",
            "testdata/vod/video_info.json",
            "testdata/clip/clip_playinfo.json",
        ] {
            assert_default_equivalent(&fixture_meta(rel));
        }

        // fallbacks
        let mut m = meta(ContentKind::Video, "채널", "제목", None);
        m.publish_date = Some("2026-03-04 05:06:07".into());
        assert_default_equivalent(&m);
        m.live_open_date = Some("garbage".into());
        assert_default_equivalent(&m);
        for m in [
            meta(ContentKind::Video, "채널", "제목", None),
            meta(ContentKind::Video, "  ", "제목", Some("2024-01-02")),
            meta(ContentKind::Clip, "", "제목", None),
            meta(ContentKind::Clip, "클립채널", "", None),
            meta(ContentKind::Video, "a/b", "x: (y)?", Some("2024-01-02")),
            meta(ContentKind::Video, "", "con", None),
            // 생방송
            meta(
                ContentKind::Live,
                "채널",
                "제목",
                Some("2026-01-02 12:34:56"),
            ),
            meta(ContentKind::Live, "채널", "제목", Some("2026-01-02")),
            meta(ContentKind::Live, "채널", "제목", None),
            // 길이
            meta(
                ContentKind::Video,
                "채널",
                &"가".repeat(100),
                Some("2024-01-02"),
            ),
            meta(
                ContentKind::Video,
                "채널",
                &format!("{}. 끝", "a".repeat(177)),
                Some("2024-01-02"),
            ),
            meta(
                ContentKind::Clip,
                &"채".repeat(100),
                &"가".repeat(100),
                None,
            ),
            // Windows 끝 `.`
            meta(ContentKind::Clip, &".".repeat(300), "제목", None),
            meta(ContentKind::Video, "ch", "..", None),
            meta(ContentKind::Video, "ch", "제목. .", None),
        ] {
            assert_default_equivalent(&m);
        }

        // 예산 경계
        let long_ch = "a".repeat(300);
        let cases = [
            (long_ch.clone(), String::new()),
            (long_ch.clone(), "..".to_string()),
            (long_ch.clone(), "  ".to_string()),
            (".".repeat(300), "제목".to_string()),
            ("ch".to_string(), ". ".repeat(150)),
            ("채".repeat(100), ". ".repeat(150)),
            (long_ch.clone(), format!("{}x", ". ".repeat(150))),
        ];
        for kind in [ContentKind::Clip, ContentKind::Video] {
            for (ch, title) in &cases {
                assert_default_equivalent(&meta(kind, ch, title, Some("2024-01-02")));
            }
        }
    }

    /// 작은 값 전수: 채널·제목·날짜 조합, 세 종류, 세 OS.
    #[test]
    fn default_equivalence_exhaustive() {
        let long = "a".repeat(300);
        let long_ko = "가".repeat(100);
        let vals: [&str; 9] = ["", " ", ".", "..", "a.", "con", "a b", &long, &long_ko];
        for kind in [ContentKind::Video, ContentKind::Clip, ContentKind::Live] {
            for ch in vals {
                for title in vals {
                    for live in [None, Some("2024-01-02"), Some("2024-01-02 12:34:56")] {
                        assert_default_equivalent(&meta(kind, ch, title, live));
                    }
                }
            }
        }
    }

    #[test]
    fn parse_template_errors() {
        use TemplateError::*;
        let cases: [(&str, TemplateError); 19] = [
            ("{title", UnbalancedBrace),
            ("title}", UnbalancedBrace),
            ("{}", UnbalancedBrace),
            ("{{title}}", UnbalancedBrace),
            ("{title}}", UnbalancedBrace),
            ("{ti{tle}", UnbalancedBrace),
            ("{foo}{title", UnbalancedBrace), // 짝 오류가 모르는 토큰보다 먼저다
            ("{foo} {title}", UnknownToken("foo".into())),
            ("{Title}", UnknownToken("Title".into())),
            ("{ title }", UnknownToken(" title ".into())),
            ("{title}{title}", DuplicateToken(Token::Title)),
            ("{date} {title} {date}", DuplicateToken(Token::Date)),
            ("{date}/{title}", PathSeparator),
            ("a\\{title}", PathSeparator),
            ("{date}", MissingTitle),
            ("", MissingTitle),
            ("제목", MissingTitle),
            ("{title}{title}/", DuplicateToken(Token::Title)), // 중복이 경로 구분자보다 먼저다
            (
                "{date}/{foo}",
                UnknownToken("foo".into()), // 모르는 토큰이 경로 구분자보다 먼저다
            ),
        ];
        for (s, want) in cases {
            assert_eq!(parse_template(s).unwrap_err(), want, "{s:?}");
        }
        // 길이: 100바이트까지는 된다
        let ok = format!("{{title}}{}", "a".repeat(100 - "{title}".len()));
        assert_eq!(ok.len(), 100);
        assert!(parse_template(&ok).is_ok());
        let long = format!("{ok}a");
        assert_eq!(parse_template(&long).unwrap_err(), TooLong);
        // 길이는 바이트 기준이다
        let ko = format!("{{title}}{}", "가".repeat(31)); // 7 + 93 = 100
        assert!(parse_template(&ko).is_ok());
        let ko = format!("{{title}}{}", "가".repeat(32)); // 103
        assert_eq!(parse_template(&ko).unwrap_err(), TooLong);
        // 길이 오류는 마지막 순서다(제목 없음이 먼저)
        assert_eq!(parse_template(&"a".repeat(101)).unwrap_err(), MissingTitle);
    }

    #[test]
    fn parse_template_accepts_all_tokens() {
        let t = parse_template("{prefix} {channel} {date} {no} {title}").unwrap();
        let m = meta(ContentKind::Video, "채널", "제목", Some("2024-01-02"));
        assert_eq!(
            render_filename(&t, &m, &ContentRef::Video { video_no: 7 }, Linux),
            "[240102] 채널 240102 7 제목.mp4"
        );
        // 리터럴 중괄호는 쓸 수 없다(짝 오류). 다른 괄호는 된다.
        assert!(parse_template("[{title}] ({channel})").is_ok());
    }

    #[test]
    fn template_token_values() {
        let p = Linux;
        let v = meta(ContentKind::Video, "채널", "제목", Some("2024-01-02"));
        let c = meta(ContentKind::Clip, "채널", "제목", None);
        let l = meta(
            ContentKind::Live,
            "채널",
            "제목",
            Some("2026-01-02 12:34:56"),
        );
        assert_eq!(render_with("{date}_{title}", &v, p), "240102_제목.mp4");
        assert_eq!(render_with("{no}_{title}", &v, p), "12345_제목.mp4");
        assert_eq!(render_with("{no}_{title}", &c, p), "abcDEF123_제목.mp4");
        assert_eq!(render_with("{prefix} {title}", &c, p), "[클립] 제목.mp4");
        assert_eq!(
            render_with("{prefix} {title}", &l, p),
            "[생방송 260102-1234] 제목.mp4"
        );
        // 날짜: 영상은 방송 시작, 없으면 공개일. 생방송은 방송 시작. 클립은 없음
        let mut v2 = meta(ContentKind::Video, "채널", "제목", None);
        v2.publish_date = Some("2026-03-04 05:06:07".into());
        assert_eq!(render_with("{date}_{title}", &v2, p), "260304_제목.mp4");
        assert_eq!(render_with("{date}_{title}", &l, p), "260102_제목.mp4");
        assert_eq!(render_with("{date}_{title}", &c, p), "제목.mp4");
        // 생방송에는 번호가 없다
        assert_eq!(render_with("{no}_{title}", &l, p), "제목.mp4");
        // 이름 안의 `/`는 토큰 값에서 `_`가 된다
        let m = meta(ContentKind::Video, "a/b", "c/d", None);
        assert_eq!(render_with("{channel}-{title}", &m, p), "a_b-c_d.mp4");
    }

    /// T3: 값이 빈 토큰 옆의 구분 문자를 함께 지운다.
    #[test]
    fn template_empty_token_drops_separator() {
        let p = Linux;
        let clip = meta(ContentKind::Clip, "채널", "제목", None);
        assert_eq!(render_with("{date} {title}", &clip, p), "제목.mp4");
        assert_eq!(
            render_with("{date}_{channel}_{title}", &clip, p),
            "채널_제목.mp4"
        );
        let no_ch = meta(ContentKind::Video, "", "제목", Some("2024-01-02"));
        assert_eq!(render_with("{channel} - {title}", &no_ch, p), "제목.mp4");
        assert_eq!(render_with("{title} - {channel}", &no_ch, p), "제목.mp4");
        assert_eq!(
            render_with("{date}_{channel}_{title}", &no_ch, p),
            "240102_제목.mp4"
        );
        // 끝의 빈 토큰이 둘이어도 앞 구분 문자가 남지 않는다
        let live = meta(ContentKind::Live, "", "제목", None);
        assert_eq!(render_with("{title}-{channel}-{no}", &live, p), "제목.mp4");
        // 구분 문자가 아닌 리터럴은 남는다
        assert_eq!(render_with("{title} ({channel})", &no_ch, p), "제목 ().mp4");
        // 빈 토큰이 없으면 그대로
        let v = meta(ContentKind::Video, "채널", "제목", Some("2024-01-02"));
        assert_eq!(
            render_with("{date}_{channel}_{title}", &v, p),
            "240102_채널_제목.mp4"
        );
    }

    /// T5: 날짜·번호가 뒤에 있어도 제목을 줄여 남긴다.
    #[test]
    fn template_length_keeps_trailing_tokens() {
        let m = meta(
            ContentKind::Video,
            "채널",
            &"a".repeat(300),
            Some("2024-01-02"),
        );
        for p in ALL {
            let name = render_with("{title} [{date}] {no}", &m, p);
            assert!(name.len() <= MAX_FILENAME_BYTES, "{p:?} {}", name.len());
            assert!(name.ends_with("[240102] 12345.mp4"), "{name}");
            assert!(name.starts_with("aaaa"), "{name}");
            assert_eq!(name.len(), MAX_FILENAME_BYTES);
        }
        // 채널과 제목이 함께 길면 제목을 먼저 줄이되 60바이트 밑으로는 줄이지 않는다
        let m = meta(
            ContentKind::Video,
            &"채".repeat(100),
            &"가".repeat(100),
            Some("2024-01-02"),
        );
        let name = render_with("{title} {channel} {date}", &m, Linux);
        assert!(name.len() <= MAX_FILENAME_BYTES);
        assert_eq!(name.matches('가').count(), MIN_TITLE_BYTES / 3);
        assert!(name.ends_with(" 240102.mp4"), "{name}");
        // 채널이 템플릿에 없으면 제목만 줄인다
        let name = render_with("{title}", &m, Linux);
        assert_eq!(
            name.len(),
            MAX_FILENAME_BYTES - (MAX_FILENAME_BYTES - 4) % 3
        );
        assert!(!name.contains('채'));
    }

    /// 아주 긴 `{no}`(클립 ID)가 있어도 200바이트를 넘지 않는다.
    #[test]
    fn template_length_hard_cap() {
        let m = meta(ContentKind::Clip, "채널", "제목", None);
        let t = parse_template("{title} {no}").unwrap();
        let huge = ContentRef::Clip {
            clip_id: "x".repeat(400),
        };
        for p in ALL {
            let name = render_filename(&t, &m, &huge, p);
            assert!(name.len() <= MAX_FILENAME_BYTES, "{p:?} {}", name.len());
            assert!(name.ends_with(".mp4"), "{name}");
            assert_eq!(sanitize_filename(&name, p), name);
        }
    }

    /// 템플릿 리터럴도 토큰 값 뒤에 같은 OS 정리를 거친다.
    #[test]
    fn template_literals_sanitized_per_os() {
        let m = meta(ContentKind::Video, "채널", "제목", Some("2024-01-02"));
        let t = "{date}: {channel}? {title}*";
        assert_eq!(render_with(t, &m, Linux), "240102: 채널? 제목*.mp4");
        assert_eq!(render_with(t, &m, MacOs), "240102_ 채널? 제목*.mp4");
        assert_eq!(render_with(t, &m, Windows), "240102_ 채널_ 제목_.mp4");
        // Windows 예약어
        let m = meta(ContentKind::Video, "", "", None);
        assert_eq!(render_with("{title}", &m, Windows), "_.mp4");
        let m = meta(ContentKind::Video, "", "con", None);
        assert_eq!(render_with("{title}", &m, Windows), "con_.mp4");
        assert_eq!(render_with("{title}", &m, Linux), "con.mp4");
        // 끝 `.`과 공백 (Windows만)
        let m = meta(ContentKind::Video, "채널", "제목", None);
        assert_eq!(render_with("{title}. ", &m, Windows), "제목.mp4");
        assert_eq!(render_with("{title}..", &m, Linux), "제목...mp4");
        // 제어 문자와 연속 공백
        assert_eq!(
            render_with("{title}\u{7}   {channel}", &m, Linux),
            "제목 채널.mp4"
        );
    }

    /// 어떤 템플릿·메타·OS든 결과는 멱등이고 200바이트 이하이며 `.mp4`로 끝난다.
    #[test]
    fn template_render_invariants() {
        let long = "a".repeat(300);
        let vals: [&str; 6] = ["", ".", "con", "a:b/c", "가 나", &long];
        let tpls = [
            "{title}",
            "{prefix} {channel} - {title}",
            "{date}_{channel}_{title}",
            "{title}.{no}.",
            "CON {title}",
            "{channel}:{title}:{date}",
        ];
        for tpl in tpls {
            let t = parse_template(tpl).unwrap();
            for kind in [ContentKind::Video, ContentKind::Clip, ContentKind::Live] {
                for ch in vals {
                    for title in vals {
                        let m = meta(kind, ch, title, Some("2024-01-02 03:04:05"));
                        for p in ALL {
                            let name = render_filename(&t, &m, &content_for(kind), p);
                            assert!(name.len() <= MAX_FILENAME_BYTES, "{tpl:?} {p:?}");
                            assert!(name.ends_with(".mp4"), "{name}");
                            assert_eq!(sanitize_filename(&name, p), name, "{tpl:?} {p:?}");
                        }
                    }
                }
            }
        }
    }

    /// 셸이 하는 일을 그대로 따라 한 저장 이름: 제안 이름(`.mp4`를 뗀 것)을 `output_path`에 넘긴다.
    fn saved_name(shown: &str, p: Platform) -> String {
        let path = super::output_path(Path::new(""), suggested_stem(shown), p);
        path.file_name().unwrap().to_str().unwrap().to_string()
    }

    /// 화면에 보인 이름(미리보기·카드 제안 이름)과 실제 저장 이름이 같다. 리뷰 지적: `sanitize`는 마지막 `.`을
    /// 확장자 경계로 보아서 `sanitize(이름) + ".mp4"`와 `sanitize(이름 + ".mp4")`가 다르다.
    #[test]
    fn shown_name_equals_saved_name() {
        // 지적의 재현 둘
        let m = meta(ContentKind::Video, "채널", "테스트", None);
        let shown = render_with("{title} .{no}", &m, Linux);
        assert_eq!(shown, "테스트.12345.mp4");
        let m = meta(ContentKind::Video, "a.", "제목", None);
        assert_eq!(render_with("{channel}.{title}", &m, Windows), "a.제목.mp4");
        // 기본 규칙에 남아 있던 같은 문제
        let m = meta(ContentKind::Video, "채널", "Ep . 3", None);
        assert_eq!(default_filename(&m, Linux), "채널 - Ep. 3.mp4");
        let m = meta(ContentKind::Video, "채널", "아 ... 진짜", None);
        assert_eq!(default_filename(&m, Windows), "채널 - 아. 진짜.mp4");

        let long = "a".repeat(300);
        let vals: [&str; 11] = [
            "", " ", ".", "..", "a.", " .b", "a .b", "x.mp4", "X.MP4", "con", &long,
        ];
        let tpls = [
            DEFAULT_TEMPLATE,
            "{title}",
            "{title} .{no}",
            "{channel}.{title}",
            "{date} . {title}",
            "{title}.mp4",
            "{channel} .{title} .{no}",
            "{title} {no}.",
        ];
        for tpl in tpls {
            let t = parse_template(tpl).unwrap();
            for kind in [ContentKind::Video, ContentKind::Clip, ContentKind::Live] {
                for ch in vals {
                    for title in vals {
                        let m = meta(kind, ch, title, Some("2024-01-02 03:04:05"));
                        for p in ALL {
                            let shown = render_filename(&t, &m, &content_for(kind), p);
                            assert_eq!(
                                saved_name(&shown, p),
                                shown,
                                "{tpl:?} {p:?} {ch:?} {title:?}"
                            );
                            // 기본 규칙: 카드에는 `.mp4`를 뗀 이름 N이 보이고, 받은 파일은 N(+`.mp4`)이다. 제목이 `.mp4`로 끝나
                            // 안쪽에 `.`도 있으면 전의 저장 이름을 지키려고(T1) 만든 이름이 아니라 N이 기준이다.
                            let d = default_filename(&m, p);
                            let n = suggested_stem(&d);
                            let want = if n.to_ascii_lowercase().ends_with(EXT) {
                                n.to_string()
                            } else {
                                format!("{n}{EXT}")
                            };
                            assert_eq!(saved_name(&d, p), want, "default {p:?} {ch:?} {title:?}");
                        }
                    }
                }
            }
        }
    }

    /// T1 보증: 기본 규칙의 **저장되는 파일 이름은 전과 바이트까지 같다**. 전에는 만든 이름 R = `sanitize(raw)`를 `.mp4`만
    /// 떼서 카드에 보였고, 받을 때 `output_path`가 한 번 정리했다. 그 옛 저장 이름(`stored_name(R)`)과 새 이름의 저장
    /// 이름을 작은 알파벳 전수로 비교한다. 아래 두 번째 묶음은 `.mp4`로 끝나는 제목처럼 확장자 경계가 겹치는 입력이다.
    #[test]
    fn default_rule_saved_name_is_unchanged() {
        let alphabet = [' ', '.', 'a', 'c', 'n', 'm', 'p', '4', ':'];
        let mut raws: Vec<String> = vec![String::new()];
        let mut frontier: Vec<String> = vec![String::new()];
        for _ in 0..5 {
            let mut next = Vec::new();
            for f in &frontier {
                for c in alphabet {
                    next.push(format!("{f}{c}"));
                }
            }
            raws.extend(next.iter().cloned());
            frontier = next;
        }
        for sp in [
            "x.mp4",
            "X.MP4",
            " .mp4",
            "a .mp4",
            "a. .mp4",
            "con",
            "CON .x",
            "con.mp4",
            "Ep . 3",
            "아 ... 진짜",
            "a..mp4",
            ".mp4.mp4",
            "x.mp4.mp4",
            "x .mp4.mp4",
            "x.MP4.mp4",
        ] {
            raws.push(sp.to_string());
        }
        for p in ALL {
            for raw in &raws {
                let raw = format!("{raw}.mp4");
                let old_saved = stored_name(&sanitize_filename(&raw, p), p);
                let new_shown = settle_default_filename(&raw, p);
                assert_eq!(stored_name(&new_shown, p), old_saved, "{p:?} {raw:?}");
            }
        }
        // 보인 이름 = 저장 이름이 되는 입력이 대부분이다(예외는 `.mp4.mp4`로 끝나는 제목뿐이고 전과 같이 남는다)
        let exotic = "x.mp4.mp4.mp4";
        assert_eq!(settle_default_filename(exotic, Linux), exotic);
        assert_eq!(settle_filename(exotic, Linux), "x.mp4");
    }

    /// 구간 접미사는 템플릿 결과 뒤에 붙는다(T8).
    #[test]
    fn template_result_takes_range_suffix() {
        let m = meta(ContentKind::Video, "채널", "제목", Some("2024-01-02"));
        let name = render_with("{date}_{title}", &m, Linux);
        let stem = name.strip_suffix(".mp4").unwrap();
        assert_eq!(
            range_stem(stem, &tr(0, Some(10_000)), Linux),
            "240102_제목 (0.00.00~0.00.10)"
        );
    }
}
