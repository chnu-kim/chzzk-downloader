//! 치지직 다운로더 Tauri 셸(docs/design/app.md §11, §15-11). 로직은 `chzzk_shell`에 두고 여기는 배선만 한다:
//! 플러그인, setup(경로·로그·상태), command, 창 닫기·앱 종료 처리, 완료 알림.

pub mod commands;
mod logging;
pub mod sink;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use chzzk_shell::dto::CloseRequestedPayload;
use chzzk_shell::services::AppPaths;
use chzzk_shell::{App, AppError};
use tauri::ipc::Invoke;
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};

use crate::sink::{Notifier, spawn_notifier};

/// 앱 command 이름(AppManifest·capabilities와 같은 목록).
pub const COMMANDS: &[&str] = include!("command_names.rs");

/// 프런트가 D1을 띄우라는 이벤트 이름(§4).
pub const CLOSE_REQUESTED: &str = "close-requested";

/// `quit` 진행 중. 이때 온 창 닫기·앱 종료 요청은 D1 없이 조용히 막는다(`quit`이 저장을 마치고 직접 끝낸다).
#[derive(Debug, Default)]
pub struct Quitting(pub AtomicBool);

/// 창 닫기·앱 종료(code 없음) 요청을 어떻게 할지.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseDecision {
    /// 그대로 닫는다.
    Allow,
    /// 막기만 한다. `quit`이 받는 중인 작업을 멈추고 저장하는 중이다(최대 3초 뒤 `quit`이 `exit(0)`).
    PreventSilently,
    /// 막고 D1을 띄운다(받는 중인 작업 수).
    Ask(u32),
}

/// 닫기 판단. main 창이 이미 없으면 D1을 띄울 곳이 없으므로 막지 않는다
/// (막으면 창 없는 프로세스만 남는다. 남은 `running`은 다음 실행의 reconcile이 `interrupted`로 바꾼다).
pub fn close_decision(quitting: bool, running: usize, has_main: bool) -> CloseDecision {
    if quitting {
        CloseDecision::PreventSilently
    } else if running == 0 || !has_main {
        CloseDecision::Allow
    } else {
        CloseDecision::Ask(u32::try_from(running).unwrap_or(u32::MAX))
    }
}

/// 셸이 코어 태스크를 띄울 tokio 런타임 핸들. Tauri가 만든 런타임을 그대로 쓴다.
pub fn tokio_handle() -> tokio::runtime::Handle {
    tauri::async_runtime::handle().inner().clone()
}

/// 모든 앱 command. `run`과 테스트(mock 런타임)가 같이 쓴다.
pub fn handler<R: Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        commands::app_info,
        commands::get_settings,
        commands::update_settings,
        commands::set_naver_cookies,
        commands::clear_naver_cookies,
        commands::import_legacy,
        commands::pick_folder,
        commands::resolve,
        commands::check_output,
        commands::enqueue,
        commands::list_jobs,
        commands::subscribe_jobs,
        commands::pause_job,
        commands::resume_job,
        commands::remove_job,
        commands::clear_finished,
        commands::open_output,
        commands::reveal_output,
        commands::quit,
        commands::auth_status,
        commands::clipboard_link,
        commands::open_app_folder,
    ]
}

/// 두 번째 실행: 기존 main 창을 앞으로 가져온다. 시작에 실패해 상태가 없으면(38(바)) 숨겨 둔 창을 꺼내지 않는다.
/// 그 창은 command마다 "state not managed"라 빈 화면이고, 시작 실패 안내 창이 이미 떠 있다. 창을 꺼냈으면 `true`.
pub fn focus_main<R: Runtime>(app: &AppHandle<R>) -> bool {
    if app.try_state::<App>().is_none() {
        return false;
    }
    let Some(w) = app.get_webview_window("main") else {
        return false;
    };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    true
}

/// 닫기·종료를 막아야 하면 `true`. D1이 필요하면 main 창을 앞으로 가져와 `close-requested`를 보낸다.
///
/// 상태가 아직 없으면(setup 실패) 막지 않는다.
pub fn guard_close<R: Runtime>(app: &AppHandle<R>) -> bool {
    let quitting = app
        .try_state::<Quitting>()
        .is_some_and(|q| q.0.load(Ordering::SeqCst));
    let running = if quitting {
        0
    } else {
        app.try_state::<App>()
            .map_or(0, |s| s.manager.running_count())
    };
    let has_main = app.get_webview_window("main").is_some();
    match close_decision(quitting, running, has_main) {
        CloseDecision::Allow => false,
        CloseDecision::PreventSilently => true,
        CloseDecision::Ask(running) => {
            focus_main(app);
            if let Err(e) = app.emit_to("main", CLOSE_REQUESTED, CloseRequestedPayload { running })
            {
                tracing::warn!(error = %e, "close-requested를 보내지 못함");
            }
            true
        }
    }
}

/// `App::run`의 이벤트 처리: main 창 닫기와 앱 종료(code 없음)를 `guard_close`로 거르고, 끝날 때 `jobs.json`을 flush한다.
///
/// 창 닫기를 `Builder::on_window_event`가 아니라 여기(`RunEvent::WindowEvent`)서 막는다. wry는 둘 다 같은
/// `CloseRequested` 신호를 보고 막을 수 있고, mock 런타임은 이쪽만 부르므로 IPC 테스트가 실제 처리를 돌릴 수 있다.
pub fn on_run_event<R: Runtime>(app: &AppHandle<R>, e: RunEvent) {
    match e {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } => {
            if label == "main" && guard_close(app) {
                api.prevent_close();
            }
        }
        // macOS Cmd+Q·Dock 종료는 창 닫기 없이 여기로 온다(code None). `quit`의 `app.exit(0)`은 Some(0).
        RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            if guard_close(app) {
                api.prevent_exit();
            }
        }
        RunEvent::Exit => {
            // 쓰기 스레드에 밀린 jobs.json을 디스크에 닿게 한다(완료 직후 창을 닫은 경우 등).
            if let Some(state) = app.try_state::<App>() {
                state.manager.flush();
            }
            tracing::info!("앱 종료");
        }
        _ => {}
    }
}

/// 시작 실패 창의 제목.
pub const STARTUP_FAILED_TITLE: &str = "치지직 다운로더를 시작하지 못했어요";

/// 시작 실패 창의 본문(§15-17, 구현 중 변경 38(바)). 무엇을 하면 되는지와 로그 폴더, 원문 오류를 적는다.
/// 오류 문구는 코어·셸 Display라 비밀이 없다.
pub fn startup_failure_message(log_dir: &Path, e: &AppError) -> String {
    format!(
        "작업 목록이나 설정 파일을 열지 못했어요. 디스크 공간과 폴더 권한을 확인한 뒤 다시 실행해 주세요.\n\n로그 폴더: {}\n오류: {}",
        log_dir.display(),
        e.message
    )
}

/// 앱 상태를 열지 못했을 때: main 창을 숨기고 오류 창을 띄운 뒤, 닫으면 `exit(1)`.
///
/// 릴리스 Windows 빌드는 콘솔이 없어 패닉(`expect`)이면 아무것도 보이지 않는다. 상태가 없으므로 command는
/// "state not managed" 오류를 돌려주고(패닉하지 않는다), 닫기 가드는 상태가 없으면 막지 않는다.
fn startup_failed<R: Runtime>(app: &AppHandle<R>, log_dir: &Path, e: &AppError) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    let handle = app.clone();
    app.dialog()
        .message(startup_failure_message(log_dir, e))
        .title(STARTUP_FAILED_TITLE)
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

/// 앱 상태(설정·매니저)를 열어 `manage`한다. 로그는 그 전에 시작한다.
fn setup<R: Runtime>(app: &tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    let p = app.path();
    let log_dir = p.app_log_dir()?;
    if let Some(guard) = logging::init(&log_dir) {
        app.manage(guard);
    }
    let paths = AppPaths::new(
        p.app_config_dir()?,
        p.app_data_dir()?,
        log_dir,
        p.video_dir().ok(),
        p.download_dir().ok(),
    );
    tracing::info!(
        version = %app.package_info().version,
        config = %paths.config.display(),
        data = %paths.data.display(),
        log = %paths.log.display(),
        default_download = %paths.default_download.display(),
        "앱 시작"
    );
    let legacy_dir: Option<PathBuf> = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(PathBuf::from));
    let log_dir = paths.log.clone();
    let state = match App::open(paths, legacy_dir.as_deref(), tokio_handle()) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(code = ?e.code, error = %e.message, "앱 상태를 열지 못함");
            startup_failed(app.handle(), &log_dir, &e);
            return Ok(());
        }
    };
    app.manage(state);
    app.manage(Quitting::default());
    let (notifier, rx) = Notifier::new();
    app.manage(notifier);
    spawn_notifier(app.handle().clone(), rx);
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default();

    // single-instance는 반드시 첫 플러그인이어야 한다. 두 번째 실행은 기존 창에 포커스만 준다.
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        focus_main(app);
    }));

    let app = builder
        // 아래 플러그인은 Rust에서만 부른다. capabilities에 플러그인 권한을 주지 않는다.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| setup(app))
        .invoke_handler(handler())
        .build(tauri::generate_context!())
        .expect("Tauri 앱 만들기 실패");

    app.run(on_run_event);
}

#[cfg(test)]
mod tests {
    use super::{CloseDecision, close_decision, startup_failure_message};
    use chzzk_shell::AppError;
    use std::path::Path;

    #[test]
    fn startup_failure_message_names_log_folder_and_error() {
        let e = AppError::internal("jobs.json을 읽지 못함: 권한 없음");
        let m = startup_failure_message(Path::new("/logs/app"), &e);
        assert!(
            m.starts_with("작업 목록이나 설정 파일을 열지 못했어요."),
            "{m}"
        );
        assert!(m.contains("로그 폴더: /logs/app"), "{m}");
        assert!(m.ends_with("오류: jobs.json을 읽지 못함: 권한 없음"), "{m}");
    }

    #[test]
    fn close_decision_table() {
        // 받는 중인 작업이 없으면 그대로 닫는다.
        assert_eq!(close_decision(false, 0, true), CloseDecision::Allow);
        // 받는 중이면 D1.
        assert_eq!(close_decision(false, 2, true), CloseDecision::Ask(2));
        // main 창이 이미 없으면 D1을 띄울 곳이 없다: 막지 않는다(창 없는 프로세스가 남지 않게).
        assert_eq!(close_decision(false, 1, false), CloseDecision::Allow);
        // quit 중에는 작업 수·창과 무관하게 조용히 막는다(quit이 저장을 마치고 직접 끝낸다).
        assert_eq!(
            close_decision(true, 0, true),
            CloseDecision::PreventSilently
        );
        assert_eq!(
            close_decision(true, 3, false),
            CloseDecision::PreventSilently
        );
    }
}
