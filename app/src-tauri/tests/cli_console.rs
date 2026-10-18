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

/// GUI(또는 다른 CLI)가 `app.lock`을 쥐고 있으면 `chzzk-cli`도 받지 않고 코드 5로 끝나고 `jobs.json`을 열지 않는다.
/// 잠금·코드 5의 프로세스 단위 검사(`cli_app.rs`의 `process`)는 `cfg(not(windows))`라 Windows는 이 테스트가 본다
#[test]
fn exit_5_when_the_app_lock_is_held_and_jobs_are_untouched() {
    use chzzk_app_lib::cli;
    use chzzk_app_lib::{InstanceLockState, acquire_instance_lock};

    let t = tempfile::tempdir().unwrap();
    let dir = t.path().join("iso");
    let data = dir.join("data");
    let InstanceLockState::Acquired(gui) = acquire_instance_lock(&data) else {
        panic!("잠금을 쥐지 못했다");
    };
    for args in [
        &["status"][..],
        &["login"],
        &["download", "https://chzzk.naver.com/video/1"],
    ] {
        let o = run(&dir, args);
        assert_eq!(
            code(&o),
            5,
            "{args:?} {}",
            String::from_utf8_lossy(&o.stderr)
        );
        assert!(String::from_utf8_lossy(&o.stderr).contains("앱이 열려 있어요"));
    }
    assert!(
        !data.join("jobs.json").exists(),
        "코드 5인데 jobs.json을 열었다"
    );
    // 코드 5로 끝난 CLI는 cli.lock을 쥐고 있지 않는다(GUI 대화상자가 거짓으로 뜨지 않는다)
    assert!(!cli::cli_lock_held(&data));
    drop(gui);
    // 놓으면 돈다
    let o = run(&dir, &["status"]);
    assert_ne!(code(&o), 5);
}
