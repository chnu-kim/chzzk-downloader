//! Windows 콘솔 실행 파일 `chzzk-cli`(cli-mode.md §7.1·§14.2): `console-cli` feature가 켜진 빌드에서만 만들어진다.
//! 몸통은 macOS·Linux의 `chzzk-app` 갈림과 같은 함수라 어느 OS에서든 돌고, Windows에서는 `tauri` gate가
//! `--features console-cli`로 이 테스트를 돌린다. GUI exe(`chzzk-app.exe`)가 명령줄 하위 명령을 받으면 안내와 코드 2다.
#![cfg(feature = "console-cli")]

use std::path::Path;
use std::process::{Command, Output};

fn cli() -> Command {
    let mut c = Command::new(env!("CARGO_BIN_EXE_chzzk-cli"));
    c.env_remove("DISPLAY").env_remove("WAYLAND_DISPLAY");
    c
}

fn run(dir: &Path, args: &[&str]) -> Output {
    cli()
        .env("CHZZK_SMOKE_DIR", dir)
        .args(args)
        .output()
        .unwrap()
}

fn code(o: &Output) -> i32 {
    o.status.code().unwrap()
}

#[test]
fn no_arguments_or_unknown_command_print_usage_and_exit_2() {
    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("iso");
    for args in [&[][..], &["nope"], &["--smoke"], &["-psn_0_1"]] {
        let o = run(&dir, args);
        assert_eq!(code(&o), 2, "{args:?}");
        let err = String::from_utf8_lossy(&o.stderr);
        // GUI를 띄우지 않고 도움말을 보여 준다
        assert!(
            err.contains("download") && err.contains("종료 코드"),
            "{args:?} {err}"
        );
    }
    assert!(!dir.exists(), "사용법 오류가 데이터 폴더를 열었다");
}

#[test]
fn help_and_status_work_without_a_display() {
    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("iso");
    let o = run(&dir, &["help"]);
    assert_eq!(code(&o), 0);
    assert!(String::from_utf8_lossy(&o.stdout).contains("download"));
    let o = run(&dir, &["status"]);
    let out = String::from_utf8_lossy(&o.stdout);
    assert!(out.contains("버전: "), "{out}");
    assert!(matches!(code(&o), 0 | 3), "{out}");
}

#[test]
fn download_with_a_bad_address_is_a_usage_error() {
    let t = tempfile::tempdir().unwrap();
    let o = run(&t.path().join("iso"), &["download", "not-a-url"]);
    assert_eq!(code(&o), 2);
}

/// Windows의 GUI exe는 받기를 돌리지 않고 안내 뒤 코드 2로 끝난다(창이 뜨지 않는다 — 뜨면 이 테스트는 끝나지 않는다)
#[cfg(windows)]
#[test]
fn gui_exe_refuses_cli_subcommands_with_exit_2() {
    let t = tempfile::tempdir().unwrap();
    let o = Command::new(env!("CARGO_BIN_EXE_chzzk-app"))
        .env("CHZZK_SMOKE_DIR", t.path().join("iso"))
        .args(["download", "https://chzzk.naver.com/video/1"])
        .output()
        .unwrap();
    assert_eq!(code(&o), 2);
    assert!(
        !t.path().join("iso").exists(),
        "GUI exe가 데이터 폴더를 열었다"
    );
}

/// macOS·Linux의 `chzzk-app`은 같은 하위 명령을 받기까지 돌린다(콘솔 실행 파일이 따로 없다)
#[cfg(not(windows))]
#[test]
fn app_binary_runs_the_same_subcommands_off_windows() {
    let t = tempfile::tempdir().unwrap();
    let o = Command::new(env!("CARGO_BIN_EXE_chzzk-app"))
        .env("CHZZK_SMOKE_DIR", t.path().join("iso"))
        .args(["download", "not-a-url"])
        .output()
        .unwrap();
    assert_eq!(code(&o), 2);
}
