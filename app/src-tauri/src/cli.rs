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
///
/// 필드는 선언 순서대로 놓이므로 **`app.lock`을 먼저, `cli.lock`을 나중에** 놓는 순서다(잡는 순서의 반대). 그 사이에
/// 뜬 GUI가 `app.lock`은 잡혀 있고 `cli.lock`은 비어 있는 상태를 보면 "다른 GUI"로 알고 아무것도 안 보이고 끝난다.
/// 이 순서면 `cli.lock`이 비어 보일 때는 `app.lock`이 이미 풀려 있다(`acquire_gui_lock`의 재시도가 기대는 성질).
#[derive(Debug)]
pub struct CliLocks {
    _app: crate::InstanceLock,
    _cli: std::fs::File,
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
            _app: app,
            _cli: cli_file,
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

/// GUI가 `app.lock`을 잡으려 한 결과.
#[derive(Debug)]
pub enum GuiLock {
    /// 쥐었다(`manage`해 둔다)
    Acquired(crate::InstanceLock),
    /// 명령줄이 받는 중이다(안내 대화상자를 보이고 끝낸다)
    CliBusy,
    /// 같은 순간에 뜬 다른 GUI 실행이 쥐고 있다(조용히 끝낸다)
    OtherGui,
    /// 잠금 파일을 열거나 잠그지 못했다(잠금 없이 계속한다)
    Unavailable(std::io::Error),
}

/// GUI 쪽 잠금 판단. `app.lock`을 못 쥐었을 때 `cli.lock`을 보고 명령줄인지 다른 GUI인지 가른다. `cli.lock`이 비어
/// 있으면 `app.lock`을 한 번 더 시도한다: 처음 시도 뒤 명령줄이 끝났다면 `CliLocks`가 `app.lock`을 먼저 놓았으므로
/// (필드 순서) 이 시도는 반드시 쥔다. 이것이 없으면 그 틈에 아이콘을 눌러도 아무것도 안 뜬다.
pub fn acquire_gui_lock(data_dir: &Path) -> GuiLock {
    acquire_gui_lock_with(data_dir, || {})
}

/// `acquire_gui_lock`의 시험용 틈새: `between`은 첫 시도가 막힌 뒤, `cli.lock`을 보기 전에 불린다.
fn acquire_gui_lock_with(data_dir: &Path, between: impl FnOnce()) -> GuiLock {
    match acquire_instance_lock(data_dir) {
        InstanceLockState::Acquired(l) => GuiLock::Acquired(l),
        InstanceLockState::Unavailable(e) => GuiLock::Unavailable(e),
        InstanceLockState::HeldElsewhere => {
            between();
            if cli_lock_held(data_dir) {
                return GuiLock::CliBusy;
            }
            match acquire_instance_lock(data_dir) {
                InstanceLockState::Acquired(l) => GuiLock::Acquired(l),
                InstanceLockState::HeldElsewhere => GuiLock::OtherGui,
                InstanceLockState::Unavailable(e) => GuiLock::Unavailable(e),
            }
        }
    }
}

/// 신호 하나를 받을 때마다 `presses`개의 `()`를 채널에 넣는 작업을 띄운다(신호 타입이 OS마다 달라 매크로다).
macro_rules! forward_signal {
    ($rt:expr, $tx:expr, $presses:expr, $sig:ident) => {{
        let tx = $tx;
        let mut $sig = $sig;
        $rt.spawn(async move {
            while $sig.recv().await.is_some() {
                for _ in 0..$presses {
                    if tx.send(()).is_err() {
                        return;
                    }
                }
            }
        });
    }};
}

/// 종료 신호를 채널로 바꾼다. 누를 때마다 `()` 하나가 온다. 런타임 안에서 부른다(핸들러를 지금 건다).
///
/// - Ctrl+C(SIGINT·Windows `CTRL_C`)와 `CTRL_BREAK`: 한 번이다. 첫 번째는 일시정지, 두 번째는 바로 끝내기(§9.2).
/// - 종료 요청(unix SIGTERM·SIGHUP, Windows `CTRL_CLOSE`)은 **둘을 한꺼번에** 넣는다. `timeout`·`kill`·ssh 끊김·창 닫기는
///   사람이 한 번 더 누를 수 없고 곧 프로세스를 죽이므로, 두 번 누른 것과 같이 바로 `quit`(작업 `interrupted` 저장,
///   `jobs.json` flush)한다. 다음 실행이 이어받는다. 이 신호를 받지 않으면 `running`이 남은 채 프로세스가 끝난다.
pub fn spawn_ctrl_c(rt: &tokio::runtime::Runtime) -> CtrlC {
    let (tx, rx) = unbounded_channel();
    let _g = rt.enter();
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        for (kind, presses) in [
            (SignalKind::interrupt(), 1),
            (SignalKind::terminate(), 2),
            (SignalKind::hangup(), 2),
        ] {
            if let Ok(sig) = signal(kind) {
                forward_signal!(rt, tx.clone(), presses, sig);
            }
        }
    }
    #[cfg(windows)]
    {
        use tokio::signal::windows;
        if let Ok(sig) = windows::ctrl_c() {
            forward_signal!(rt, tx.clone(), 1, sig);
        }
        if let Ok(sig) = windows::ctrl_break() {
            forward_signal!(rt, tx.clone(), 1, sig);
        }
        if let Ok(sig) = windows::ctrl_close() {
            forward_signal!(rt, tx.clone(), 2, sig);
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
    /// E2E 빌드가 E2E 환경 변수로 켜졌다(로그인 주소는 브라우저 대신 스텁 확인 페이지의 303을 따라 수신기에 건넨다)
    e2e: bool,
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
            e2e: true,
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
            e2e: false,
        });
    }
    let paths = cli_paths().ok_or_else(|| "사용자 폴더를 찾지 못했어요".to_string())?;
    Ok(Setup {
        paths,
        client: client(None),
        e2e_worker: None,
        isolated: false,
        e2e: false,
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
    let e2e = setup.e2e;
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut stdout = std::io::stdout();
    let tty = stderr.is_terminal();
    let mut env = Env {
        out: &mut stdout,
        err: &mut stderr,
        tty,
        cwd,
        version: version.to_string(),
        // 격리 실행은 브라우저를 열지 않는다. E2E는 GUI와 같이 `E2eAuthIo`가 스텁 확인 페이지의 303을 따라 수신기에 건넨다
        // (로그인 주소는 어디에도 쓰지 않는다). 그 밖의 격리(스모크)는 열지 못한 것으로 돌려준다
        open_url: Some(match (isolated, e2e) {
            (true, true) => match crate::isolated_auth_io() {
                Some(io) => Box::new(move |url: &str| io.open_url(url)),
                None => Box::new(|_: &str| false),
            },
            (true, false) => Box::new(|_: &str| false),
            (false, _) => {
                Box::new(|url: &str| tauri_plugin_opener::open_url(url, None::<&str>).is_ok())
            }
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
/// Windows의 GUI 실행 파일(`chzzk-app.exe`)은 받기를 돌리지 않는다: cmd가 GUI 서브시스템 프로세스를 기다리지 않아 프롬프트가
/// 먼저 돌아오고 `%ERRORLEVEL%`이 CLI의 종료 코드가 아니게 되므로(cli-mode.md §7.1) 같은 폴더의 `chzzk-cli.exe`를 가리키고 끝낸다.
pub fn try_cli() -> Option<ExitCode> {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    if !wants_cli(&args) {
        return None;
    }
    #[cfg(windows)]
    {
        Some(use_console_exe())
    }
    #[cfg(not(windows))]
    {
        Some(cli_main(args))
    }
}

/// Windows 콘솔 실행 파일(`chzzk-cli.exe`)의 `main`. 몸통은 macOS·Linux의 `chzzk-app`과 같은 `cli_main`이다.
/// 인자가 없거나 모르는 명령이면 GUI를 만들지 않고 사용법(`help` 출력)과 코드 2다.
pub fn console_main() -> ExitCode {
    let args: Vec<OsString> = std::env::args_os().skip(1).collect();
    if wants_cli(&args) {
        return cli_main(args);
    }
    let mut stderr = std::io::stderr();
    if let Some(first) = args.first() {
        say(
            &mut stderr,
            &copy::unknown_command(&first.to_string_lossy()),
        );
    } else {
        say(&mut stderr, copy::USAGE_NO_COMMAND);
    }
    let _ = write!(stderr, "{}", copy::help(None));
    ExitCode::from(exit::USAGE)
}

/// Windows `chzzk-app.exe`: 부모 콘솔이 있으면 안내 한 줄을 쓰고 코드 2로 끝난다(부모 콘솔이 없으면 쓰지 않고 끝난다).
/// GUI 서브시스템 프로세스는 표준 핸들이 없어서 `AttachConsole` 뒤 `CONOUT$`를 직접 연다.
#[cfg(windows)]
fn use_console_exe() -> ExitCode {
    use windows::Win32::System::Console::{ATTACH_PARENT_PROCESS, AttachConsole};
    // SAFETY: 인자가 상수이고 실패해도 오류 값만 돌려준다
    if unsafe { AttachConsole(ATTACH_PARENT_PROCESS) }.is_ok()
        && let Ok(mut out) = std::fs::OpenOptions::new().write(true).open("CONOUT$")
    {
        let _ = writeln!(out, "{}", copy::USE_CONSOLE_EXE);
    }
    ExitCode::from(exit::USAGE)
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

    /// GUI의 잠금 판단 넷: 비어 있으면 쥔다 / 명령줄이 쥐면 안내 / 다른 GUI가 쥐면 조용히 / 첫 시도 뒤 명령줄이 끝났으면 쥔다
    #[test]
    fn gui_lock_decision_table() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        let GuiLock::Acquired(free) = acquire_gui_lock(d) else {
            panic!("비어 있으면 쥔다");
        };
        // 다른 GUI가 쥐고 있고 명령줄은 없다
        assert!(matches!(acquire_gui_lock(d), GuiLock::OtherGui));
        drop(free);
        // 명령줄이 둘 다 쥐고 있다
        let CliLockState::Acquired(cli) = acquire_cli_locks(d) else {
            panic!();
        };
        assert!(matches!(acquire_gui_lock(d), GuiLock::CliBusy));
        drop(cli);
        assert!(matches!(acquire_gui_lock(d), GuiLock::Acquired(_)));
    }

    /// 첫 시도가 막힌 뒤 `cli.lock`을 보기 전에 명령줄이 끝난 틈: 바로 한 번 더 시도해 쥔다(아무것도 안 뜨는 일이 없다)
    #[test]
    fn gui_lock_retries_when_the_cli_ends_in_between() {
        let t = tempfile::tempdir().unwrap();
        let d = t.path();
        let CliLockState::Acquired(cli) = acquire_cli_locks(d) else {
            panic!();
        };
        let mut cli = Some(cli);
        let got = acquire_gui_lock_with(d, || drop(cli.take()));
        assert!(matches!(got, GuiLock::Acquired(_)), "{got:?}");
    }

    /// 놓는 순서: `app.lock`이 먼저다. `cli.lock`이 이미 비어 보일 때 `app.lock`이 잡혀 있는 순간이 없다
    /// (필드 선언 순서가 순서를 정한다. 뒤집으면 이 소스 검사가 깨진다)
    #[test]
    fn cli_locks_release_app_lock_first() {
        let src = include_str!("cli.rs");
        let body = &src[src.find("pub struct CliLocks {").unwrap()..];
        let body = &body[..body.find('}').unwrap()];
        assert!(
            body.find("_app").unwrap() < body.find("_cli").unwrap(),
            "{body}"
        );
    }

    #[test]
    fn identifier_matches_tauri_conf() {
        let conf = include_str!("../tauri.conf.json");
        let v: serde_json::Value = serde_json::from_str(conf).unwrap();
        assert_eq!(v["identifier"], IDENTIFIER);
    }
}
