//! 치지직 다운로더 Tauri 셸(docs/design/app.md §11, §15-11). 로직은 `chzzk_shell`에 두고 여기는 배선만 한다:
//! 플러그인, setup(경로·로그·상태), command, 창 닫기·앱 종료 처리, 완료 알림.

pub mod commands;
mod logging;
pub mod sink;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use chzzk_shell::App;
use chzzk_shell::dto::CloseRequestedPayload;
use chzzk_shell::services::AppPaths;
use tauri::ipc::Invoke;
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};

use crate::sink::{Notifier, spawn_notifier};

/// 앱 command 이름(AppManifest·capabilities와 같은 목록).
pub const COMMANDS: &[&str] = include!("command_names.rs");

/// 프런트가 D1을 띄우라는 이벤트 이름(§4).
pub const CLOSE_REQUESTED: &str = "close-requested";

/// `quit` 진행 중. 이때는 창 닫기·앱 종료를 다시 막지 않는다.
#[derive(Debug, Default)]
pub struct Quitting(pub AtomicBool);

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
    ]
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// 받는 중인 작업이 있어 닫기·종료를 막아야 하면 그 수. 막았으면 main 창에 `close-requested`를 보낸다.
///
/// `quit` 중이거나 상태가 아직 없으면(setup 실패) 막지 않는다.
pub fn guard_close<R: Runtime>(app: &AppHandle<R>) -> bool {
    if app
        .try_state::<Quitting>()
        .is_some_and(|q| q.0.load(Ordering::SeqCst))
    {
        return false;
    }
    let Some(state) = app.try_state::<App>() else {
        return false;
    };
    let running = state.manager.running_count();
    if running == 0 {
        return false;
    }
    let payload = CloseRequestedPayload {
        running: u32::try_from(running).unwrap_or(u32::MAX),
    };
    focus_main(app);
    if let Err(e) = app.emit_to("main", CLOSE_REQUESTED, payload) {
        tracing::warn!(error = %e, "close-requested를 보내지 못함");
    }
    true
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
    let state = App::open(paths, legacy_dir.as_deref(), tokio_handle()).inspect_err(|e| {
        tracing::error!(code = ?e.code, error = %e.message, "앱 상태를 열지 못함");
    })?;
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
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e
                && w.label() == "main"
                && guard_close(w.app_handle())
            {
                api.prevent_close();
            }
        })
        .invoke_handler(handler())
        .build(tauri::generate_context!())
        .expect("Tauri 앱 만들기 실패");

    app.run(|app, e| match e {
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
    });
}
