//! 치지직 다운로더 Tauri 셸. 로직은 `chzzk_shell`에 두고 여기는 command 배선만 한다(§15-11).

use serde::Serialize;
use tauri::Manager;

/// §15-1 골격용 앱 정보. §15-3에서 `chzzk_shell::dto::AppInfo`로 바뀐다.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
}

#[tauri::command]
async fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
    })
}

/// 셸이 코어 태스크를 띄울 tokio 런타임 핸들. Tauri가 만든 런타임을 그대로 쓴다.
pub fn tokio_handle() -> tokio::runtime::Handle {
    tauri::async_runtime::handle().inner().clone()
}

fn focus_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

pub fn run() {
    let builder = tauri::Builder::default();

    // single-instance는 반드시 첫 플러그인이어야 한다. 두 번째 실행은 기존 창에 포커스만 준다.
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        focus_main(app);
    }));

    builder
        // 아래 플러그인은 Rust에서만 부른다. capabilities에 플러그인 권한을 주지 않는다.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let _ = tokio_handle();
            if cfg!(debug_assertions) {
                let log_dir = app.path().app_log_dir()?;
                eprintln!("app_log_dir = {}", log_dir.display());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_info])
        .run(tauri::generate_context!())
        .expect("Tauri 앱 실행 실패");
}
