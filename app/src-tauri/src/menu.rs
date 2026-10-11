//! macOS 메뉴 막대(system/platform.md §7.1). Windows·Linux에는 메뉴 막대를 두지 않는다.
//!
//! 항목 표 `MENU`는 `cfg` 없는 순수 데이터라 세 OS에서 같은 테스트로 검사한다(영어 단어 0개, "새로고침" 없음,
//! `settings`·`about`·`quit`·`help` id 존재). `build_menu`(macOS 전용)가 이 표로 실제 메뉴를 만든다. 이름은 Apple 한국어
//! 시스템 문자열이다. muda 기본 문구가 영어라 모든 `PredefinedMenuItem`에 글자를 넘긴다.
//!
//! 종료는 보통 `MenuItem`(id `quit`)이다: Tauri 기본 Quit은 `terminate:`라 닫기 가드를 지나친다(app.md 구현 중 변경 52).

use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::QUIT_MENU_ID;

/// "설정…"을 눌렀을 때 main 창으로 가는 이벤트(페이로드 `null`). 프런트는 설정 화면으로 간다.
pub const MENU_SETTINGS: &str = "menu-settings";
/// "VOD 클립 다운로더에 관하여"를 눌렀을 때 main 창으로 가는 이벤트(페이로드 `null`). 프런트는 설정 › 정보로 간다.
pub const MENU_ABOUT: &str = "menu-about";

/// 메뉴 항목 id.
pub const MENU_ID_ABOUT: &str = "about";
pub const MENU_ID_SETTINGS: &str = "settings";
pub const MENU_ID_HELP: &str = "help";

/// 시스템이 동작을 주는 항목 종류(muda `PredefinedMenuItem`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Predef {
    Services,
    Hide,
    HideOthers,
    ShowAll,
    CloseWindow,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Fullscreen,
    Minimize,
    Maximize,
    BringAllToFront,
}

/// 메뉴 항목 하나.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Item {
    /// 시스템 항목과 한국어 글자
    Predefined(Predef, &'static str),
    /// 앱이 처리하는 항목: id, 글자, 가속키
    Custom(&'static str, &'static str, Option<&'static str>),
    Separator,
}

/// 메뉴 하나(제목, 항목들). 제목이 `None`이면 앱 이름(첫 메뉴)이다.
pub type Menu = (Option<&'static str>, &'static [Item]);

/// 메뉴 막대 전체 표.
pub const MENU: &[Menu] = &[
    (
        None,
        &[
            Item::Custom(MENU_ID_ABOUT, "VOD 클립 다운로더에 관하여", None),
            Item::Separator,
            Item::Custom(MENU_ID_SETTINGS, "설정…", Some("CmdOrCtrl+,")),
            Item::Separator,
            Item::Predefined(Predef::Services, "서비스"),
            Item::Separator,
            Item::Predefined(Predef::Hide, "VOD 클립 다운로더 가리기"),
            Item::Predefined(Predef::HideOthers, "기타 가리기"),
            Item::Predefined(Predef::ShowAll, "모두 보기"),
            Item::Separator,
            Item::Custom(QUIT_MENU_ID, "VOD 클립 다운로더 종료", Some("CmdOrCtrl+Q")),
        ],
    ),
    (
        Some("파일"),
        &[Item::Predefined(Predef::CloseWindow, "윈도우 닫기")],
    ),
    (
        Some("편집"),
        &[
            Item::Predefined(Predef::Undo, "실행 취소"),
            Item::Predefined(Predef::Redo, "실행 복귀"),
            Item::Separator,
            Item::Predefined(Predef::Cut, "오려두기"),
            Item::Predefined(Predef::Copy, "복사하기"),
            Item::Predefined(Predef::Paste, "붙여넣기"),
            Item::Predefined(Predef::SelectAll, "전체 선택"),
        ],
    ),
    (
        Some("보기"),
        &[Item::Predefined(Predef::Fullscreen, "전체 화면 시작")],
    ),
    (
        Some("윈도우"),
        &[
            Item::Predefined(Predef::Minimize, "최소화"),
            Item::Predefined(Predef::Maximize, "확대/축소"),
            Item::Separator,
            Item::Predefined(Predef::BringAllToFront, "모두 앞으로 가져오기"),
        ],
    ),
    (
        Some("도움말"),
        &[Item::Custom(MENU_ID_HELP, "VOD 클립 다운로더 도움말", None)],
    ),
];

/// 메뉴 항목을 눌렀을 때 앱이 하는 일.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MenuAction {
    Quit,
    Settings,
    About,
    Help,
}

/// 항목 id → 동작. 모르는 id(시스템 항목)는 `None`.
pub fn action_of(id: &str) -> Option<MenuAction> {
    match id {
        QUIT_MENU_ID => Some(MenuAction::Quit),
        MENU_ID_SETTINGS => Some(MenuAction::Settings),
        MENU_ID_ABOUT => Some(MenuAction::About),
        MENU_ID_HELP => Some(MenuAction::Help),
        _ => None,
    }
}

/// 도움말 항목을 켤 수 있는가: 도움말 페이지는 Worker 주소 아래에 있어 그 주소가 없는 빌드면 비활성이다.
/// 항목은 숨기지 않고 비활성으로 둔다(HIG).
pub fn help_enabled(worker_base_present: bool) -> bool {
    worker_base_present
}

/// 메뉴 항목을 눌렀을 때. `quit`은 닫기 가드(`request_quit`), 설정·정보는 main 창을 앞으로 가져와 이벤트를 보내고,
/// 도움말은 Worker `/help`를 기본 브라우저로 연다.
pub fn on_menu_item<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let Some(action) = action_of(id) else {
        return;
    };
    match action {
        MenuAction::Quit => {
            crate::request_quit(app);
        }
        MenuAction::Settings => emit_to_main(app, MENU_SETTINGS),
        MenuAction::About => emit_to_main(app, MENU_ABOUT),
        MenuAction::Help => open_help(app),
    }
}

/// main 창을 앞으로 가져온 뒤 이벤트(페이로드 `null`)를 보낸다. 상태가 없으면(시작 실패) 아무것도 하지 않는다.
fn emit_to_main<R: Runtime>(app: &AppHandle<R>, event: &str) {
    if !crate::focus_main(app) {
        return;
    }
    if let Err(e) = app.emit_to("main", event, ()) {
        tracing::warn!(event, error = %e, "메뉴 이벤트를 보내지 못함");
    }
}

/// 도움말 페이지를 기본 브라우저로 연다.
fn open_help<R: Runtime>(app: &AppHandle<R>) {
    let (Some(state), Some(io)) = (
        app.try_state::<chzzk_shell::App>(),
        app.try_state::<crate::auth_io::AuthIoState>(),
    ) else {
        return;
    };
    match state.web_page_url(chzzk_shell::dto::WebPage::Help) {
        Ok(url) => {
            if !io.0.open_url(&url) {
                tracing::warn!("도움말 페이지를 열지 못함");
            }
        }
        Err(e) => tracing::warn!(error = %e.message, "도움말 주소를 만들지 못함"),
    }
}

/// `MENU` 표로 만든 macOS 메뉴. 편집 메뉴의 시스템 항목은 WKWebView의 붙여넣기·전체 선택이 responder chain으로 받으므로
/// 그대로 둔다. 빌드가 끝나기 전이라 `App` 상태가 없으므로 도움말 활성은 빌드에 넣은 Worker 주소로 정한다.
#[cfg(target_os = "macos")]
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{IsMenuItem, Menu as TauriMenu, MenuItem, PredefinedMenuItem, Submenu};
    let name = app.package_info().name.clone();
    let help_on = help_enabled(crate::build_worker_base().is_some());
    let mut submenus = Vec::new();
    for (title, items) in MENU {
        let mut built: Vec<Box<dyn IsMenuItem<R>>> = Vec::new();
        for item in *items {
            built.push(match *item {
                Item::Separator => Box::new(PredefinedMenuItem::separator(app)?),
                Item::Predefined(kind, text) => {
                    let t = Some(text);
                    Box::new(match kind {
                        Predef::Services => PredefinedMenuItem::services(app, t)?,
                        Predef::Hide => PredefinedMenuItem::hide(app, t)?,
                        Predef::HideOthers => PredefinedMenuItem::hide_others(app, t)?,
                        Predef::ShowAll => PredefinedMenuItem::show_all(app, t)?,
                        Predef::CloseWindow => PredefinedMenuItem::close_window(app, t)?,
                        Predef::Undo => PredefinedMenuItem::undo(app, t)?,
                        Predef::Redo => PredefinedMenuItem::redo(app, t)?,
                        Predef::Cut => PredefinedMenuItem::cut(app, t)?,
                        Predef::Copy => PredefinedMenuItem::copy(app, t)?,
                        Predef::Paste => PredefinedMenuItem::paste(app, t)?,
                        Predef::SelectAll => PredefinedMenuItem::select_all(app, t)?,
                        Predef::Fullscreen => PredefinedMenuItem::fullscreen(app, t)?,
                        Predef::Minimize => PredefinedMenuItem::minimize(app, t)?,
                        Predef::Maximize => PredefinedMenuItem::maximize(app, t)?,
                        Predef::BringAllToFront => PredefinedMenuItem::bring_all_to_front(app, t)?,
                    })
                }
                Item::Custom(id, text, accel) => {
                    let enabled = id != MENU_ID_HELP || help_on;
                    Box::new(MenuItem::with_id(app, id, text, enabled, accel)?)
                }
            });
        }
        let refs: Vec<&dyn IsMenuItem<R>> = built.iter().map(|b| b.as_ref()).collect();
        submenus.push(Submenu::with_items(
            app,
            title.unwrap_or(name.as_str()),
            true,
            &refs,
        )?);
    }
    let refs: Vec<&dyn IsMenuItem<R>> = submenus.iter().map(|s| s as &dyn IsMenuItem<R>).collect();
    TauriMenu::with_items(app, &refs)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_items() -> Vec<&'static Item> {
        MENU.iter().flat_map(|(_, items)| items.iter()).collect()
    }

    fn label_of(item: &Item) -> Option<&'static str> {
        match item {
            Item::Predefined(_, t) | Item::Custom(_, t, _) => Some(t),
            Item::Separator => None,
        }
    }

    // 메뉴 텍스트에 영어 단어가 남지 않는다("Quit"·"File"·"Toggle Full Screen" 0개).
    // 제품명 "VOD 클립 다운로더"의 "VOD"는 이름의 일부라서 지우고 본다.
    #[test]
    fn menu_text_has_no_latin_letters() {
        let no_latin = |t: &str| {
            !t.replace("VOD 클립 다운로더", "")
                .chars()
                .any(|c| c.is_ascii_alphabetic())
        };
        for (title, items) in MENU {
            if let Some(t) = title {
                assert!(no_latin(t), "{t}");
            }
            for item in *items {
                if let Some(t) = label_of(item) {
                    assert!(no_latin(t), "{t}");
                }
            }
        }
    }

    #[test]
    fn menu_has_no_reload() {
        for item in all_items() {
            let t = label_of(item).unwrap_or("");
            assert!(
                !t.contains("새로고침") && !t.to_lowercase().contains("reload"),
                "{t}"
            );
        }
    }

    #[test]
    fn custom_ids_exist_and_are_unique() {
        let ids: Vec<&str> = all_items()
            .into_iter()
            .filter_map(|i| match i {
                Item::Custom(id, _, _) => Some(*id),
                _ => None,
            })
            .collect();
        for want in ["about", "settings", "quit", "help"] {
            assert!(ids.contains(&want), "{want}");
        }
        assert_eq!(ids.len(), 4);
        let mut s = ids.clone();
        s.sort();
        s.dedup();
        assert_eq!(s.len(), ids.len());
        assert_eq!(QUIT_MENU_ID, "quit");
    }

    #[test]
    fn settings_has_command_comma_and_an_ellipsis_character() {
        let found = all_items().into_iter().find_map(|i| match i {
            Item::Custom("settings", t, a) => Some((*t, *a)),
            _ => None,
        });
        let (text, accel) = found.expect("settings 항목");
        assert_eq!(accel, Some("CmdOrCtrl+,"));
        assert!(text.ends_with('\u{2026}'), "{text}");
        assert!(!text.ends_with("..."));
        // 종료는 ⌘Q
        let quit = all_items().into_iter().find_map(|i| match i {
            Item::Custom("quit", _, a) => Some(*a),
            _ => None,
        });
        assert_eq!(quit, Some(Some("CmdOrCtrl+Q")));
    }

    // About은 첫 항목이고 구분선으로 홀로 선다(HIG), 버전 번호가 없다
    #[test]
    fn about_is_first_and_alone() {
        let (_, app_menu) = MENU[0];
        assert_eq!(
            app_menu[0],
            Item::Custom("about", "VOD 클립 다운로더에 관하여", None)
        );
        assert_eq!(app_menu[1], Item::Separator);
        assert!(
            !label_of(&app_menu[0])
                .unwrap()
                .chars()
                .any(|c| c.is_ascii_digit())
        );
    }

    // 파일 메뉴에 닫기가 있고(HIG) 윈도우 메뉴에는 중복 닫기가 없다
    #[test]
    fn close_window_lives_in_file_menu_only() {
        let count = all_items()
            .into_iter()
            .filter(|i| matches!(i, Item::Predefined(Predef::CloseWindow, _)))
            .count();
        assert_eq!(count, 1);
        assert_eq!(MENU[1].0, Some("파일"));
    }

    // 편집 메뉴는 지우지 않는다(입력칸 밖 paste 이벤트가 메뉴 가속키에 의존, G-IME-R11)
    #[test]
    fn edit_menu_keeps_clipboard_items() {
        let (_, edit) = MENU.iter().find(|(t, _)| *t == Some("편집")).unwrap();
        for kind in [Predef::Cut, Predef::Copy, Predef::Paste, Predef::SelectAll] {
            assert!(
                edit.iter()
                    .any(|i| matches!(i, Item::Predefined(k, _) if *k == kind))
            );
        }
    }

    #[test]
    fn action_table() {
        assert_eq!(action_of("quit"), Some(MenuAction::Quit));
        assert_eq!(action_of("settings"), Some(MenuAction::Settings));
        assert_eq!(action_of("about"), Some(MenuAction::About));
        assert_eq!(action_of("help"), Some(MenuAction::Help));
        assert_eq!(action_of("copy"), None);
        assert_eq!(action_of(""), None);
    }

    #[test]
    fn help_follows_worker_base() {
        assert!(help_enabled(true));
        assert!(!help_enabled(false));
    }
}
