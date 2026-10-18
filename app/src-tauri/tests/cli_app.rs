//! 명령줄 모드의 앱 쪽(cli-mode.md §7.4·§14.2): 경로가 Tauri와 한 글자도 다르지 않다, 게이트 이름이 실제 command다,
//! 실행 파일을 직접 띄워 종료 코드와 잠금을 본다.

use chzzk_app_lib::COMMANDS;
use chzzk_app_lib::cli::{self, cli_paths};
use chzzk_shell::services::AppPaths;
use tauri::Manager;
use tauri::test::mock_builder;

/// 경로 대조: CLI가 만든 폴더 여섯이 Tauri `app.path()` 값(`setup`이 쓰는 같은 호출)과 같다. 다르면 CLI가 다른
/// `session.json`·`jobs.json`을 보게 되므로 이 테스트가 이 기능의 기둥 하나다(3 OS).
#[test]
fn cli_paths_equal_tauri_paths() {
    let app = mock_builder()
        .build(tauri::generate_context!(test = true))
        .unwrap();
    let p = app.path();
    let tauri_paths = AppPaths::new(
        p.app_config_dir().unwrap(),
        p.app_data_dir().unwrap(),
        p.app_log_dir().unwrap(),
        p.video_dir().ok(),
        p.download_dir().ok(),
        p.home_dir().ok(),
    );
    let mine = cli_paths().expect("홈 폴더가 있는 환경");
    assert_eq!(mine, tauri_paths);
    assert!(mine.data.ends_with(cli::IDENTIFIER), "{:?}", mine.data);
}

/// 게이트 이름 표(`cli::GATED`)의 이름은 모두 실제 GUI command다
#[test]
fn gated_names_are_real_commands() {
    for (sub, names) in chzzk_shell::cli::GATED {
        for n in *names {
            assert!(COMMANDS.contains(n), "{sub}: {n}는 command가 아니다");
        }
    }
}

#[cfg(not(windows))]
mod process {
    use std::path::Path;
    use std::process::{Command, Output};

    use chzzk_app_lib::cli;
    use chzzk_app_lib::{InstanceLockState, acquire_instance_lock};

    fn bin() -> Command {
        let mut c = Command::new(env!("CARGO_BIN_EXE_chzzk-app"));
        // 화면이 없어도 돈다: Tauri를 만들지 않는다
        c.env_remove("DISPLAY").env_remove("WAYLAND_DISPLAY");
        c
    }

    fn run(dir: &Path, args: &[&str]) -> Output {
        bin()
            .env("CHZZK_SMOKE_DIR", dir)
            .args(args)
            .output()
            .unwrap()
    }

    fn code(o: &Output) -> i32 {
        o.status.code().unwrap()
    }

    #[test]
    fn help_and_usage_errors_do_not_open_the_data_folder() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("iso");
        let o = run(&dir, &["help"]);
        assert_eq!(code(&o), 0);
        assert!(String::from_utf8_lossy(&o.stdout).contains("download"));
        for args in [
            &["download"][..],
            &["download", "not-a-url"],
            &["help", "nope"],
        ] {
            let o = run(&dir, args);
            assert_eq!(code(&o), 2, "{args:?}");
        }
        // 폴더를 만들지 않았다
        assert!(!dir.exists(), "help·사용법 오류가 데이터 폴더를 열었다");
    }

    /// 로그인을 쓰지 않는 빌드면 0, 쓰는 빌드(`CHZZK_WORKER_BASE`)면 로그인 없음 3이다
    #[test]
    fn status_in_a_fresh_isolated_folder() {
        let t = tempfile::tempdir().unwrap();
        let o = run(&t.path().join("iso"), &["status"]);
        let out = String::from_utf8_lossy(&o.stdout).into_owned();
        assert!(out.contains("버전: "), "{out}");
        if chzzk_app_lib::build_worker_base().is_some() {
            assert_eq!(code(&o), 3, "{out}");
            assert!(out.contains("로그인 필요"), "{out}");
        } else {
            assert_eq!(code(&o), 0, "{out}");
            assert!(out.contains("로그인을 쓰지 않아요"), "{out}");
        }
        // stdout에는 로그가 섞이지 않는다(개발 빌드에서도)
        assert_eq!(out.lines().count(), 2, "{out}");
    }

    /// GUI(또는 다른 CLI)가 `app.lock`을 쥐고 있으면 받지 않고 코드 5로 끝나고 `jobs.json`을 열지 않는다
    #[test]
    fn exit_5_when_the_app_lock_is_held_and_jobs_are_untouched() {
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

    /// 다른 CLI가 쥐고 있어도 코드 5(둘이 받지 않는다)
    #[test]
    fn exit_5_when_another_cli_holds_the_locks() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("iso");
        let data = dir.join("data");
        let cli::CliLockState::Acquired(held) = cli::acquire_cli_locks(&data) else {
            panic!();
        };
        assert!(cli::cli_lock_held(&data));
        let o = run(&dir, &["status"]);
        assert_eq!(code(&o), 5);
        drop(held);
    }
}
