// 릴리스 빌드에서 Windows 콘솔 창을 띄우지 않는다.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    // 명령줄 하위 명령(`download`·`info`·`status`·`login`·`help`)이면 Tauri를 만들지 않고 여기서 끝낸다
    if let Some(code) = chzzk_app_lib::cli::try_cli() {
        return code;
    }
    chzzk_app_lib::run();
    std::process::ExitCode::SUCCESS
}
