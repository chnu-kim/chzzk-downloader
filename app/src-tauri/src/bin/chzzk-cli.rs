// Windows 콘솔 서브시스템 실행 파일(cli-mode.md §7.1). `windows_subsystem` 속성이 없어 기본(콘솔)이다:
// cmd·PowerShell이 끝날 때까지 기다리고 `%ERRORLEVEL%`이 종료 코드가 된다. Tauri를 만들지 않는다.
// `console-cli` feature가 켜진 빌드에서만 만들어진다(`tauri.windows.conf.json`).

fn main() -> std::process::ExitCode {
    chzzk_app_lib::cli::console_main()
}
