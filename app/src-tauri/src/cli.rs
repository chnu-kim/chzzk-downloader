//! 명령줄 모드의 앱 쪽(docs/design/features/cli-mode.md §3.1·§5.1·§6.2·§7.4): argv 갈림, Tauri 없이 같은 폴더를 찾는 경로,
//! 데이터 폴더 잠금(`cli.lock` → `app.lock`), 런타임, Ctrl+C 신호, 로그, 종료 코드.
//!
//! 몸통(명령 해석·게이트·진행률·`login`)은 Tauri 비의존 `chzzk_shell::cli`에 있다. 여기는 `tauri::Builder`를 만들기
//! **전에** 갈라져 창·webview·single-instance 플러그인이 만들어지지 않는다(그래서 Linux에서 `DISPLAY` 없이도 돈다).

use std::ffi::OsString;
use std::io::{IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

use chzzk_shell::App;
use chzzk_shell::OpenOptions;
use chzzk_shell::cli::{self, Command, CtrlC, Env, copy, exit};
use chzzk_shell::services::AppPaths;
use tokio::sync::mpsc::unbounded_channel;

use crate::smoke::{SMOKE_DIR_ENV, SmokeConfig};
use crate::{InstanceLockState, acquire_instance_lock};

/// 앱 identifier(`tauri.conf.json`). Tauri는 `app_*_dir()`를 이 이름 아래에 만든다. `tests/cli_paths.rs`가 mock 런타임의
/// 값과 같은지, 그리고 설정 파일의 identifier와 같은지 본다.
pub const IDENTIFIER: &str = "io.github.chnu-kim.chzzk-downloader";

/// CLI가 `app.lock`보다 먼저 쥐는 잠금 파일 이름(§6.2). GUI는 `app.lock`을 못 쥐었을 때만 이 파일을 `try_lock`해서
/// CLI가 받는 중인지 가른다.
pub const CLI_LOCK_FILE: &str = "cli.lock";

/// 첫 인자가 하위 명령이면 CLI다(정확히 일치할 때만, `--smoke`·`-psn_…`·인자 없음은 GUI).
pub fn wants_cli(args: &[OsString]) -> bool {
    cli::wants_cli(args.first().map(OsString::as_os_str))
}

/// Tauri가 `app_config_dir()`·`app_data_dir()`·`app_log_dir()`·`video_dir()`·`download_dir()`·`home_dir()`로 주는 폴더를
/// Tauri 없이 만든다(`tauri` 2.12 `path/desktop.rs`와 같은 규칙: `dirs` 7.0 + identifier). 홈 폴더가 없으면 `None`.
pub fn cli_paths() -> Option<AppPaths> {
    let config = dirs::config_dir()?.join(IDENTIFIER);
    let data = dirs::data_dir()?.join(IDENTIFIER);
    #[cfg(target_os = "macos")]
    let log = dirs::home_dir()?.join("Library/Logs").join(IDENTIFIER);
    #[cfg(not(target_os = "macos"))]
    let log = dirs::data_local_dir()?.join(IDENTIFIER).join("logs");
    Some(AppPaths::new(
        config,
        data,
        log,
        dirs::video_dir(),
        dirs::download_dir(),
        dirs::home_dir(),
    ))
}

/// CLI가 쥔 잠금 둘(프로세스가 끝날 때까지 쥔다).
#[derive(Debug)]
pub struct CliLocks {
    _cli: std::fs::File,
    _app: crate::InstanceLock,
}

/// 잠금 결과.
#[derive(Debug)]
pub enum CliLockState {
    Acquired(CliLocks),
    /// GUI(또는 다른 CLI)가 쓰는 중이다(코드 5)
    Busy,
    /// 잠금 파일을 열거나 잠그지 못했다(GUI와 달리 CLI는 잠금 없이 계속하지 않는다, 코드 1)
    Unavailable(std::io::Error),
}

/// `cli.lock`을 먼저, 그다음 `app.lock`을 배타로 쥔다. 순서가 반대면 CLI가 `app.lock`만 쥔 틈에 뜬 GUI가 `cli.lock`이
/// 비어 있다고 보고 조용히 끝난다. `app.lock`을 못 쥐면 `cli.lock`을 바로 놓는다(drop).
pub fn acquire_cli_locks(data_dir: &Path) -> CliLockState {
    use std::fs::{OpenOptions, TryLockError};
    let open = || -> std::io::Result<std::fs::File> {
        std::fs::create_dir_all(data_dir)?;
        OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(data_dir.join(CLI_LOCK_FILE))
    };
    let cli_file = match open() {
        Ok(f) => f,
        Err(e) => return CliLockState::Unavailable(e),
    };
    match cli_file.try_lock() {
        Ok(()) => {}
        Err(TryLockError::WouldBlock) => return CliLockState::Busy,
        Err(TryLockError::Error(e)) => return CliLockState::Unavailable(e),
    }
    match acquire_instance_lock(data_dir) {
        InstanceLockState::Acquired(app) => CliLockState::Acquired(CliLocks {
            _cli: cli_file,
            _app: app,
        }),
        InstanceLockState::HeldElsewhere => CliLockState::Busy,
        InstanceLockState::Unavailable(e) => CliLockState::Unavailable(e),
    }
}

/// GUI 쪽: `app.lock`을 못 쥐었을 때 CLI가 받는 중인가(`cli.lock`이 잠겨 있는가). 우연히 쥐게 되면 바로 놓는다.
/// 파일을 열 수 없으면 CLI가 아닌 것으로 본다(지금처럼 조용히 끝낸다).
pub fn cli_lock_held(data_dir: &Path) -> bool {
    use std::fs::{OpenOptions, TryLockError};
    let Ok(f) = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(data_dir.join(CLI_LOCK_FILE))
    else {
        return false;
    };
    match f.try_lock() {
        Ok(()) => {
            let _ = f.unlock();
            false
        }
        Err(TryLockError::WouldBlock) => true,
        Err(TryLockError::Error(_)) => false,
    }
}

/// Ctrl+C 신호를 채널로 바꾼다. 누를 때마다 `()` 하나가 온다. 런타임 안에서 부른다(핸들러를 지금 건다).
fn spawn_ctrl_c(rt: &tokio::runtime::Runtime) -> CtrlC {
    let (tx, rx) = unbounded_channel();
    let _g = rt.enter();
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut sig) = signal(SignalKind::interrupt()) {
            rt.spawn(async move {
                while sig.recv().await.is_some() {
                    if tx.send(()).is_err() {
                        break;
                    }
                }
            });
        }
    }
    #[cfg(windows)]
    {
        if let Ok(mut sig) = tokio::signal::windows::ctrl_c() {
            rt.spawn(async move {
                while sig.recv().await.is_some() {
                    if tx.send(()).is_err() {
                        break;
                    }
                }
            });
        }
    }
    rx
}

/// 어디의 폴더·서버를 쓰는가.
struct Setup {
    paths: AppPaths,
    client: chzzk_core::ClientConfig,
    /// E2E가 정한 Worker 주소(`Some(None)`은 로그인 끔). 보통은 `None`
    e2e_worker: Option<Option<chzzk_shell::WorkerBase>>,
    /// 격리 실행(스모크·E2E): 전원·브라우저를 실제로 쓰지 않는다
    isolated: bool,
}

fn setup() -> Result<Setup, String> {
    let client = |c: Option<chzzk_core::ClientConfig>| {
        c.unwrap_or_else(|| chzzk_core::ClientConfig {
            progress_interval: chzzk_shell::services::PROGRESS_INTERVAL,
            ..chzzk_core::ClientConfig::default()
        })
    };
    if let Some((paths, c, worker)) = crate::e2e_override()? {
        return Ok(Setup {
            paths,
            client: client(Some(c)),
            e2e_worker: Some(worker),
            isolated: true,
        });
    }
    // 기동 스모크와 같은 격리 폴더(`CHZZK_SMOKE_DIR`): 사용자 데이터를 건드리지 않는다
    if let Some(dir) = std::env::var_os(SMOKE_DIR_ENV).filter(|s| !s.is_empty()) {
        let cfg = SmokeConfig::new(None, Some(dir), &std::env::temp_dir(), std::process::id());
        return Ok(Setup {
            paths: AppPaths::new(
                cfg.config_dir(),
                cfg.data_dir(),
                cfg.log_dir(),
                None,
                None,
                None,
            ),
            client: client(None),
            e2e_worker: None,
            isolated: true,
        });
    }
    let paths = cli_paths().ok_or_else(|| "사용자 폴더를 찾지 못했어요".to_string())?;
    Ok(Setup {
        paths,
        client: client(None),
        e2e_worker: None,
        isolated: false,
    })
}

fn say(w: &mut impl Write, s: &str) {
    let _ = writeln!(w, "{s}");
}

/// 명령줄 한 번을 돌리고 종료 코드를 돌려준다. 종료 순서: 모든 끝에서 `jobs.json`을 flush한 뒤(`cli::run`), `App`·로그
/// guard·런타임을 drop하고 코드를 낸다(`std::process::exit`는 `Drop`을 건너뛴다).
pub fn cli_main(args: Vec<OsString>) -> ExitCode {
    let mut stderr = std::io::stderr();
    let cmd = match cli::parse(args) {
        Ok(c) => c,
        Err(e) => {
            say(&mut stderr, &e.to_string());
            say(&mut stderr, copy::USAGE_HINT);
            return ExitCode::from(exit::USAGE);
        }
    };
    if let Command::Help { topic } = &cmd {
        let _ = write!(std::io::stdout(), "{}", copy::help(topic.as_deref()));
        return ExitCode::from(exit::OK);
    }
    let setup = match setup() {
        Ok(s) => s,
        Err(m) => {
            say(&mut stderr, &m);
            return ExitCode::from(exit::FAILED);
        }
    };
    // 잠금: 쥔 뒤에 로그를 시작한다. 코드 5로 끝나는 CLI가 떠 있는 GUI의 로그 파일에 덧붙이지 않게 한다
    let _locks = match acquire_cli_locks(&setup.paths.data) {
        CliLockState::Acquired(l) => l,
        CliLockState::Busy => {
            say(&mut stderr, copy::APP_OPEN);
            return ExitCode::from(exit::BUSY);
        }
        CliLockState::Unavailable(_) => {
            say(&mut stderr, copy::NO_DATA_LOCK);
            return ExitCode::from(exit::FAILED);
        }
    };
    // 로그는 파일에만 쓴다: stdout은 결과의 채널이다(개발 빌드의 stdout 로그도 끈다)
    let log_guard = crate::logging::init_with(&setup.paths.log, false);
    let version = env!("CARGO_PKG_VERSION");
    tracing::info!(
        version,
        mode = "cli",
        config = %setup.paths.config.display(),
        data = %setup.paths.data.display(),
        "명령줄 시작"
    );
    let auth = match crate::auth_setup(setup.e2e_worker, crate::build_worker_base(), version) {
        Ok(a) => a,
        Err(m) => {
            tracing::error!(error = %m, "로그인 설정이 올바르지 않음");
            say(&mut stderr, &m);
            return ExitCode::from(exit::FAILED);
        }
    };
    let rt = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            tracing::error!(error = %e, "런타임을 만들지 못함");
            say(&mut stderr, &format!("{e}"));
            return ExitCode::from(exit::FAILED);
        }
    };
    let mut ctrl_c = spawn_ctrl_c(&rt);
    let app = match App::open_with_options(
        setup.paths,
        setup.client,
        None,
        rt.handle().clone(),
        auth,
        OpenOptions { auto_resume: false },
    ) {
        Ok(a) => a,
        Err(e) => {
            tracing::error!(code = ?e.code, error = %e.message, "앱 상태를 열지 못함");
            say(&mut stderr, &e.message);
            return ExitCode::from(exit::FAILED);
        }
    };
    let isolated = setup.isolated;
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut stdout = std::io::stdout();
    let tty = stderr.is_terminal();
    let mut env = Env {
        out: &mut stdout,
        err: &mut stderr,
        tty,
        cwd,
        version: version.to_string(),
        // 격리 실행은 브라우저를 열지 않는다(로그인 주소는 어디에도 쓰지 않는다)
        open_url: Some(if isolated {
            Box::new(|_: &str| false)
        } else {
            Box::new(|url: &str| tauri_plugin_opener::open_url(url, None::<&str>).is_ok())
        }),
        power: (!isolated).then(|| {
            Box::new(chzzk_shell::power::SystemGuard::spawn())
                as Box<dyn chzzk_shell::power::SleepGuard>
        }),
    };
    let code = rt.block_on(cli::run(&app, cmd, &mut env, &mut ctrl_c));
    drop(env);
    drop(app);
    drop(log_guard);
    rt.shutdown_timeout(Duration::from_secs(2));
    ExitCode::from(code)
}

/// `main`이 맨 처음 부른다: CLI 하위 명령이면 Tauri를 만들지 않고 끝낸 종료 코드를 돌려준다.
/// Windows의 GUI 실행 파일은 CLI-5까지 인자를 무시하고 GUI를 띄운다(없는 `chzzk-cli.exe`를 가리키지 않게).
pub fn try_cli() -> Option<ExitCode> {
    #[cfg(not(windows))]
    {
        let args: Vec<OsString> = std::env::args_os().skip(1).collect();
        if wants_cli(&args) {
            return Some(cli_main(args));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(args: &[&str]) -> Vec<OsString> {
        args.iter().map(OsString::from).collect()
    }

    #[test]
    fn wants_cli_table() {
        for yes in [
            &["download", "x"][..],
            &["login"],
            &["info", "x"],
            &["status"],
            &["help"],
            &["download", "--smoke"],
        ] {
            assert!(wants_cli(&os(yes)), "{yes:?}");
        }
        for no in [
            &["--smoke"][..],
            &[],
            &["-psn_0_1"],
            &["--smoke", "download"],
            &["Download"],
        ] {
            assert!(!wants_cli(&os(no)), "{no:?}");
        }
    }

    #[test]
    fn locks_are_exclusive_and_order_is_cli_then_app() {
        let t = tempfile::tempdir().unwrap();
        let first = acquire_cli_locks(t.path());
        let CliLockState::Acquired(held) = first else {
            panic!("{first:?}");
        };
        // 다른 CLI도, GUI의 app.lock도 못 쥔다. GUI는 cli.lock이 잠겨 있음을 본다
        assert!(matches!(acquire_cli_locks(t.path()), CliLockState::Busy));
        assert!(matches!(
            acquire_instance_lock(t.path()),
            InstanceLockState::HeldElsewhere
        ));
        assert!(cli_lock_held(t.path()));
        drop(held);
        // 놓으면 다시 쥘 수 있고 GUI 쪽 판정도 풀린다
        assert!(!cli_lock_held(t.path()));
        assert!(matches!(
            acquire_cli_locks(t.path()),
            CliLockState::Acquired(_)
        ));
    }

    /// GUI가 `app.lock`을 쥔 채면 CLI는 `cli.lock`을 쥐고 있지 않는다(바로 놓는다) → 코드 5
    #[test]
    fn cli_releases_cli_lock_when_gui_holds_app_lock() {
        let t = tempfile::tempdir().unwrap();
        let InstanceLockState::Acquired(gui) = acquire_instance_lock(t.path()) else {
            panic!();
        };
        assert!(matches!(acquire_cli_locks(t.path()), CliLockState::Busy));
        // CLI가 돌지 않으니 GUI 둘의 경합으로 본다(대화상자 없이 조용히 끝낸다)
        assert!(!cli_lock_held(t.path()));
        drop(gui);
    }

    #[test]
    fn identifier_matches_tauri_conf() {
        let conf = include_str!("../tauri.conf.json");
        let v: serde_json::Value = serde_json::from_str(conf).unwrap();
        assert_eq!(v["identifier"], IDENTIFIER);
    }
}
