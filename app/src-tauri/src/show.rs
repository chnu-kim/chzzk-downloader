//! 첫 프레임: 숨겨 시작한 main 창을 언제 보일지(system/platform.md §2.2, D30).
//!
//! 창은 `tauri.conf.json`의 `visible:false`로 만들어지고, 프런트가 처음 그린 뒤 `frontend_ready`가 `show_main`을
//! 부른다. 신호가 오지 않아도 `SHOW_DEADLINE_MS` 뒤에는 안전장치가 같은 `show_main`을 불러 창이 영원히 숨지
//! 않게 한다. `App` 상태가 없으면(시작 실패·`HeldElsewhere`) 아무것도 보이지 않는다: 그 창은 command마다
//! "state not managed"라 빈 화면이다(`focus_main`과 같은 조건).

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use chzzk_core::Theme;
use chzzk_shell::App;
use chzzk_shell::consts::SHOW_DEADLINE_MS;
use chzzk_shell::dto::OsDto;
use tauri::window::Color;
use tauri::{AppHandle, Manager, Runtime};

/// 창 배경: 라이트(= foundations `--bg` 라이트). 값은 tokens.css와 같아야 하고 테스트가 대조한다.
pub const BG_LIGHT: &str = "#F3F3F3";
/// 창 배경: 다크(= foundations `--bg` 다크)
pub const BG_DARK: &str = "#1F1F1F";

static START: OnceLock<Instant> = OnceLock::new();

/// 프로세스 시작 시각을 잡는다. `run()` 첫 줄에서 부른다. 두 번째부터는 아무것도 하지 않는다.
pub fn mark_start() -> Instant {
    *START.get_or_init(Instant::now)
}

/// 프로세스 시작부터 지금까지(ms). `mark_start`를 부르지 않았으면 지금을 시작으로 본다(0에 가깝다).
pub fn elapsed_ms() -> u64 {
    u64::try_from(mark_start().elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// 아직 안 보였다는 표시(`t_show_ms`는 늘 `u64::MAX` 미만이다)
const NOT_SHOWN: u64 = u64::MAX;

/// 창을 한 번만 보이게 하는 관리 상태.
#[derive(Debug)]
pub struct ShowGate {
    shown: AtomicBool,
    t_show_ms: AtomicU64,
}

impl Default for ShowGate {
    fn default() -> Self {
        ShowGate {
            shown: AtomicBool::new(false),
            t_show_ms: AtomicU64::new(NOT_SHOWN),
        }
    }
}

impl ShowGate {
    /// 첫 호출에만 `true`(그 순간의 시각을 기록한다)
    fn claim(&self) -> bool {
        if self.shown.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.t_show_ms.store(elapsed_ms(), Ordering::SeqCst);
        true
    }

    /// 창이 보인 시각(프로세스 시작부터 ms). 아직이면 `None`
    pub fn t_show_ms(&self) -> Option<u64> {
        match self.t_show_ms.load(Ordering::SeqCst) {
            NOT_SHOWN => None,
            ms => Some(ms),
        }
    }

    /// 이미 보였는가
    pub fn is_shown(&self) -> bool {
        self.shown.load(Ordering::SeqCst)
    }
}

/// 안전장치가 창을 꺼내야 하는가: 아직 안 보였고 `App` 상태가 있을 때만.
pub fn deadline_should_show(shown: bool, has_app: bool) -> bool {
    !shown && has_app
}

/// 창 배경색(hex). Linux는 앱 안 테마 설정이 `light`·`dark`면 그 값을 따르고(GTK 다크 감지가 틀릴 수 있다,
/// platform §2.1), 그 밖에는 창이 보고하는 테마를 따른다. 창 테마를 모르면 라이트다.
pub fn background_for(
    os: OsDto,
    theme_setting: Theme,
    window_theme: Option<tauri::Theme>,
) -> &'static str {
    let dark = match (os, theme_setting) {
        (OsDto::Linux, Theme::Light) => false,
        (OsDto::Linux, Theme::Dark) => true,
        _ => matches!(window_theme, Some(tauri::Theme::Dark)),
    };
    if dark { BG_DARK } else { BG_LIGHT }
}

/// `#RRGGBB`를 불투명 색으로. 모양이 다르면 라이트 배경으로 되돌린다(상수만 넘기므로 닿지 않는다).
pub fn parse_hex(hex: &str) -> Color {
    let digits = hex.strip_prefix('#').unwrap_or(hex);
    let byte = |i: usize| {
        digits
            .get(i..i + 2)
            .and_then(|s| u8::from_str_radix(s, 16).ok())
    };
    match (digits.len(), byte(0), byte(2), byte(4)) {
        (6, Some(r), Some(g), Some(b)) => Color(r, g, b, 255),
        _ => Color(0xF3, 0xF3, 0xF3, 255),
    }
}

/// main 창을 한 번만 보이고 포커스를 준다. `App` 상태가 없으면 아무것도 하지 않는다. 이번 호출이 보였으면 `true`.
pub fn show_main<R: Runtime>(app: &AppHandle<R>) -> bool {
    if app.try_state::<App>().is_none() {
        return false;
    }
    let Some(gate) = app.try_state::<ShowGate>() else {
        return false;
    };
    let Some(w) = app.get_webview_window("main") else {
        return false;
    };
    if !gate.claim() {
        return false;
    }
    if let Err(e) = w.show() {
        tracing::warn!(error = %e, "main 창을 보이지 못함");
    }
    let _ = w.set_focus();
    tracing::info!(t_show_ms = ?gate.t_show_ms(), "main 창을 보임");
    true
}

/// 설정의 테마와 창 테마로 main 창 배경을 맞춘다(보이기 전에 부른다).
pub fn apply_background<R: Runtime>(app: &AppHandle<R>) {
    let (Some(state), Some(w)) = (app.try_state::<App>(), app.get_webview_window("main")) else {
        return;
    };
    let os = OsDto::from(chzzk_core::Platform::current());
    let hex = background_for(os, state.settings.get().theme, w.theme().ok());
    if let Err(e) = w.set_background_color(Some(parse_hex(hex))) {
        tracing::warn!(error = %e, "창 배경색을 정하지 못함");
    }
}

/// 안전장치: `SHOW_DEADLINE_MS` 뒤에도 안 보였으면 보인다.
pub fn spawn_deadline<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(SHOW_DEADLINE_MS)).await;
        let shown = app.try_state::<ShowGate>().is_some_and(|g| g.is_shown());
        if deadline_should_show(shown, app.try_state::<App>().is_some()) {
            tracing::warn!("프런트 신호가 늦어 안전장치로 창을 보임");
            show_main(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deadline_shows_only_when_unshown_and_app_exists() {
        assert!(deadline_should_show(false, true));
        assert!(!deadline_should_show(true, true));
        // App이 없으면(시작 실패·다른 실행이 데이터 폴더를 쥠) 숨긴 창을 꺼내지 않는다
        assert!(!deadline_should_show(false, false));
        assert!(!deadline_should_show(true, false));
    }

    #[test]
    fn background_follows_window_theme_except_linux_setting() {
        use tauri::Theme::{Dark, Light};
        for os in [OsDto::Macos, OsDto::Windows, OsDto::Linux] {
            // 설정이 system이면 모든 OS에서 창 테마를 따른다
            assert_eq!(background_for(os, Theme::System, Some(Dark)), BG_DARK);
            assert_eq!(background_for(os, Theme::System, Some(Light)), BG_LIGHT);
            // 창 테마를 모르면 라이트
            assert_eq!(background_for(os, Theme::System, None), BG_LIGHT);
        }
        // 앱 안 테마 설정은 Linux에서만 쓴다(다른 OS에서는 설정 화면에 없다)
        assert_eq!(
            background_for(OsDto::Linux, Theme::Light, Some(Dark)),
            BG_LIGHT
        );
        assert_eq!(
            background_for(OsDto::Linux, Theme::Dark, Some(Light)),
            BG_DARK
        );
        assert_eq!(background_for(OsDto::Linux, Theme::Dark, None), BG_DARK);
        for os in [OsDto::Macos, OsDto::Windows] {
            assert_eq!(background_for(os, Theme::Dark, Some(Light)), BG_LIGHT);
            assert_eq!(background_for(os, Theme::Light, Some(Dark)), BG_DARK);
        }
    }

    /// tokens.css에서 `--bg` 라이트·다크 hex를 읽는다
    fn token_hex(css: &str, name: &str) -> String {
        let key = format!("{name}:");
        let line = css
            .lines()
            .find(|l| l.trim_start().starts_with(&key))
            .unwrap_or_else(|| panic!("tokens.css에 {name}이 없다"));
        let rest = line.trim_start()[key.len()..].trim();
        rest.trim_end_matches(';').trim().to_ascii_uppercase()
    }

    #[test]
    fn background_hex_matches_tokens_css_bg() {
        let css = include_str!("../../src/styles/tokens.css");
        // 라이트 --bg는 ref-gray-965, 다크 --bg는 ref-gray-240이 가리키는 hex다
        let ref_of = |css: &str, nth: usize| -> String {
            css.lines()
                .filter(|l| l.trim_start().starts_with("--bg:"))
                .nth(nth)
                .and_then(|l| l.split("var(").nth(1))
                .and_then(|r| r.split(')').next())
                .unwrap_or_else(|| panic!("--bg {nth}번째가 없다"))
                .to_string()
        };
        let light = token_hex(css, &ref_of(css, 0));
        let dark = token_hex(css, &ref_of(css, 1));
        assert_eq!(BG_LIGHT.to_ascii_uppercase(), light);
        assert_eq!(BG_DARK.to_ascii_uppercase(), dark);
    }

    #[test]
    fn parse_hex_reads_rrggbb() {
        assert_eq!(parse_hex(BG_LIGHT).0, 0xF3);
        let d = parse_hex(BG_DARK);
        assert_eq!((d.0, d.1, d.2, d.3), (0x1F, 0x1F, 0x1F, 255));
        // 모양이 틀리면 라이트
        assert_eq!(parse_hex("zz").0, 0xF3);
    }

    #[test]
    fn gate_claims_once_and_records_time() {
        let g = ShowGate::default();
        assert_eq!(g.t_show_ms(), None);
        assert!(!g.is_shown());
        assert!(g.claim());
        assert!(!g.claim());
        assert!(g.t_show_ms().is_some());
        assert!(g.is_shown());
    }

    #[test]
    fn elapsed_is_monotonic_from_start() {
        mark_start();
        let a = elapsed_ms();
        let b = elapsed_ms();
        assert!(b >= a);
    }
}
