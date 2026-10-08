//! 치지직 다운로더 Tauri 셸(docs/design/app.md §11, §15-11). 로직은 `chzzk_shell`에 두고 여기는 배선만 한다:
//! 플러그인, setup(경로·로그·상태), command, 창 닫기·앱 종료 처리, 완료 알림.

pub mod auth_io;
pub mod commands;
#[cfg(feature = "e2e")]
pub mod e2e;
mod logging;
pub mod sink;
pub mod smoke;
pub mod update_io;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use chzzk_shell::auth::{Trigger, forward_status, run_driver};
use chzzk_shell::dto::{AuthStatusDto, UpdateCheckDto, UpdateInfoDto};

use chzzk_shell::dto::CloseRequestedPayload;
use chzzk_shell::services::AppPaths;
use chzzk_shell::{AUTH_CLIENT_FAILED, App, AppAuth, AppError, AuthSetup, ErrorCode, WorkerBase};
use tauri::ipc::Invoke;
use tauri::{AppHandle, Emitter, Manager, RunEvent, Runtime, WindowEvent};

use crate::sink::{Notifier, spawn_notifier};
use crate::smoke::{SMOKE_TIMEOUT, SmokeConfig, SmokeState, spawn_watchdog};

/// 앱 command 이름(AppManifest·capabilities와 같은 목록).
pub const COMMANDS: &[&str] = include!("command_names.rs");

/// 프런트가 D1을 띄우라는 이벤트 이름(§4).
pub const CLOSE_REQUESTED: &str = "close-requested";

/// 로그인 상태가 바뀔 때마다(처음 상태 포함) 프런트로 가는 이벤트 이름(AuthStatusDto 전체, worker.md 구현 중 변경 54).
pub const AUTH_CHANGED: &str = "auth-changed";

/// 자동 확인이 새 버전을 찾았을 때 프런트로 가는 이벤트 이름(`UpdateInfoDto`, worker.md 구현 중 변경 A4-3)
pub const UPDATE_AVAILABLE: &str = "update-available";

/// 설치 중 진행 이벤트 이름(`UpdateProgressEvent`)
pub const UPDATE_PROGRESS: &str = "update-progress";

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

/// macOS 앱 메뉴의 종료 항목 id(구현 중 변경 52).
pub const QUIT_MENU_ID: &str = "quit";

/// 메뉴·Cmd+Q의 종료 요청. `guard_close`를 거쳐 막히지 않으면 `app.exit(0)`(`RunEvent::Exit`가 flush한다).
/// 막혔으면(D1을 띄웠거나 `quit` 중) `false`.
///
/// Tauri 기본 macOS 메뉴의 Quit(=Cmd+Q)은 muda가 `NSApp terminate:`로 보내고, tao 0.37은
/// `applicationShouldTerminate:`를 두지 않아 `ExitRequested` 없이 `applicationWillTerminate:` → `LoopDestroyed`
/// → `RunEvent::Exit`로 곧장 끝난다(실측: 받는 중 메뉴 Quit에 D1 없이 종료, 작업은 `running`으로 남음). 그래서
/// 기본 메뉴 대신 같은 모양의 메뉴에 보통 항목으로 Quit을 두고 여기로 보낸다.
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) -> bool {
    if guard_close(app) {
        return false;
    }
    app.exit(0);
    true
}

/// Tauri 기본 메뉴(`Menu::default`)와 같은 구성에서 Quit만 `QUIT_MENU_ID` 보통 항목으로 바꾼 macOS 메뉴.
/// Edit 메뉴의 predefined 항목은 WKWebView의 붙여넣기·전체 선택이 responder chain으로 받으므로 그대로 둔다.
#[cfg(target_os = "macos")]
fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
    let pkg = app.package_info();
    let name = pkg.name.clone();
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(pkg.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        authors: app.config().bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                &name,
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        QUIT_MENU_ID,
                        format!("Quit {name}"),
                        true,
                        Some("CmdOrCtrl+Q"),
                    )?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "File",
                true,
                &[&PredefinedMenuItem::close_window(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&PredefinedMenuItem::fullscreen(app, None)?],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, None)?,
                ],
            )?,
        ],
    )
}

/// 셸이 코어 태스크를 띄울 tokio 런타임 핸들. Tauri가 만든 런타임을 그대로 쓴다.
pub fn tokio_handle() -> tokio::runtime::Handle {
    tauri::async_runtime::handle().inner().clone()
}

/// 모든 앱 command. `run`과 테스트(mock 런타임)가 같이 쓴다. 처리기로 보내기 전에 AuthGate(셸 `App::gate_command`)를
/// 거친다: 인자 역직렬화 전이라 어떤 인자로 불러도 로그인 전이면 `notLoggedIn`이다(구현 중 변경 55).
pub fn handler<R: Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    let inner: Box<dyn Fn(Invoke<R>) -> bool + Send + Sync + 'static> =
        Box::new(tauri::generate_handler![
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
            commands::frontend_ready,
            commands::auth_login,
            commands::auth_reopen,
            commands::auth_copy_login_url,
            commands::auth_cancel,
            commands::auth_retry,
            commands::auth_logout,
            commands::update_check,
            commands::update_available,
            commands::update_install,
        ]);
    move |invoke: Invoke<R>| {
        let verdict = {
            let cmd = invoke.message.command();
            match invoke.message.webview_ref().try_state::<App>() {
                Some(app) => app.gate_command(cmd),
                None => chzzk_shell::gate::gate_without_app(cmd),
            }
        };
        if let Err(e) = verdict {
            tracing::debug!(
                command = invoke.message.command(),
                "로그인 전 command를 거부함"
            );
            invoke.resolver.reject(e);
            return true;
        }
        inner(invoke)
    }
}

/// 로그인 상태 전달(프런트 `auth-changed`·자동 이어받기)과 타이머(시작 갱신·재확인·절전 복귀)를 띄운다(구현 중 변경 56)
pub fn spawn_auth_tasks<R: Runtime>(handle: AppHandle<R>, auth: Arc<AppAuth>) {
    let h = handle.clone();
    tauri::async_runtime::spawn(forward_status(auth.subscribe(), move |st| {
        // 세션 확인이 처음 성공한 직후 한 번만 업데이트를 확인한다(D8). 상태 전달 뒤에 띄운다
        let auto = h.try_state::<App>().is_some_and(|app| {
            app.on_auth_status(&st);
            app.take_auto_update_check(&st)
        });
        if let Err(e) = h.emit_to("main", AUTH_CHANGED, AuthStatusDto::from_status(&st)) {
            tracing::warn!(error = %e, "auth-changed를 보내지 못함");
        }
        if auto {
            let h2 = h.clone();
            tauri::async_runtime::spawn(async move {
                auto_update_check(h2).await;
            });
        }
    }));
    tauri::async_runtime::spawn(run_driver(auth));
}

/// 세션 확인 성공 직후 한 번(D8): 찾으면 캐시하고 `update-available`을 main 창에 보낸다. 찾았으면 그 정보.
/// 실패는 셸이 로그만 남기고, 이 실행에서는 다시 확인하지 않는다(수동 확인은 된다)
pub async fn auto_update_check<R: Runtime>(h: AppHandle<R>) -> Option<UpdateInfoDto> {
    let app = h.try_state::<App>()?;
    match app
        .update_check(&update_io::PluginUpdateSource::new(h.clone()))
        .await
    {
        UpdateCheckDto::Available { info } => {
            if let Err(e) = h.emit_to("main", UPDATE_AVAILABLE, info.clone()) {
                tracing::warn!(error = %e, "update-available를 보내지 못함");
            }
            Some(info)
        }
        _ => None,
    }
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
        // 창 포커스: 오프라인이면 바로 다시 연결해 본다(worker.md §11.3, 갱신 간격 규칙은 AuthService)
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Focused(focused),
            ..
        } => {
            on_window_focus(app, &label, focused);
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

/// main 창이 포커스를 얻으면 로그인 재확인 틱(`Trigger::Focus`)을 띄운다(worker.md §11.3, 구현 중 변경 56 (다)).
/// 띄웠으면 `true`. 로그인을 쓰지 않는 빌드·상태 없음·다른 창·포커스 잃음은 `false`.
/// `RunEvent::WindowEvent`는 `#[non_exhaustive]`라 테스트가 만들 수 없어 처리를 함수로 뺐다(구현 중 변경 65).
pub fn on_window_focus<R: Runtime>(app: &AppHandle<R>, label: &str, focused: bool) -> bool {
    if !focused || label != "main" {
        return false;
    }
    let Some(auth) = app.try_state::<App>().and_then(|s| s.auth.clone()) else {
        return false;
    };
    tauri::async_runtime::spawn(async move {
        auth.tick(Trigger::Focus).await;
    });
    true
}

/// 시작 실패 창의 제목.
pub const STARTUP_FAILED_TITLE: &str = "치지직 다운로더를 시작하지 못했어요";

/// 시작 실패의 종류(구현 중 변경 64). 안내 문구가 다르다.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupFailure {
    /// 작업 목록·설정 파일(디스크·폴더 권한)
    Storage,
    /// 빌드에 넣은 로그인 서버 설정(다시 설치)
    AuthConfig,
}

/// `App::open_with_auth` 오류의 종류: 셸이 내보낸 로그인 클라이언트 오류만 AuthConfig다.
/// 분기 키는 `AUTH_CLIENT_FAILED` 문구 그대로다(셸에서 바꾸면 여기도 본다). 원래 오류(종류)는 셸이 이미 로그에
/// 남겼고, 호출한 쪽이 코드·문구를 다시 남긴다.
pub fn open_failure_kind(e: &AppError) -> StartupFailure {
    if e.code == ErrorCode::Internal && e.message == AUTH_CLIENT_FAILED {
        StartupFailure::AuthConfig
    } else {
        StartupFailure::Storage
    }
}

/// 시작 실패 창의 본문(§15-17, 구현 중 변경 38(바)). 무엇을 하면 되는지와 로그 폴더, 원문 오류를 적는다.
/// 오류 문구는 코어·셸 Display라 비밀이 없다.
pub fn startup_failure_message(log_dir: &Path, e: &AppError, kind: StartupFailure) -> String {
    let lead = match kind {
        StartupFailure::Storage => {
            "작업 목록이나 설정 파일을 열지 못했어요. 디스크 공간과 폴더 권한을 확인한 뒤 다시 실행해 주세요."
        }
        StartupFailure::AuthConfig => {
            "로그인 서버 설정을 읽지 못했어요. 설치 파일이 손상됐을 수 있어요. 앱을 내려받은 페이지에서 다시 받아 설치해 주세요."
        }
    };
    format!(
        "{lead}\n\n로그 폴더: {}\n오류: {}",
        log_dir.display(),
        e.message
    )
}

/// 앱 상태를 열지 못했을 때: main 창을 숨기고 오류 창을 띄운 뒤, 닫으면 `exit(1)`.
///
/// 릴리스 Windows 빌드는 콘솔이 없어 패닉(`expect`)이면 아무것도 보이지 않는다. 상태가 없으므로 command는
/// "state not managed" 오류를 돌려주고(패닉하지 않는다), 닫기 가드는 상태가 없으면 막지 않는다.
fn startup_failed<R: Runtime>(
    app: &AppHandle<R>,
    log_dir: &Path,
    e: &AppError,
    kind: StartupFailure,
) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    let handle = app.clone();
    app.dialog()
        .message(startup_failure_message(log_dir, e, kind))
        .title(STARTUP_FAILED_TITLE)
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

/// 데이터 폴더의 잠금 파일 이름.
pub const INSTANCE_LOCK_FILE: &str = "app.lock";

/// 프로세스가 끝날 때까지 쥐는 데이터 폴더 잠금(`manage`해 둔다. 프로세스가 끝나면 OS가 푼다).
#[derive(Debug)]
pub struct InstanceLock(#[allow(dead_code)] std::fs::File);

/// 데이터 폴더 잠금 결과.
#[derive(Debug)]
pub enum InstanceLockState {
    /// 이 프로세스가 쥐었다.
    Acquired(InstanceLock),
    /// 다른 프로세스가 쥐고 있다(그 프로세스가 같은 `jobs.json`·설정을 쓰는 중).
    HeldElsewhere,
    /// 잠금 파일을 열거나 잠그지 못했다(잠금 없이 계속한다. 폴더 문제는 `App::open`이 알린다).
    Unavailable(std::io::Error),
}

/// `<data>/app.lock`을 배타 잠근다(코어 `.part`와 같은 `File::try_lock`, 구현 중 변경 51(다)).
///
/// single-instance 플러그인은 macOS에서 거의 동시에 뜬 두 실행을 둘 다 첫 실행으로 보낼 수 있다(소켓 확인과
/// 생성 사이 경합). 그러면 두 매니저가 같은 `jobs.json`을 번갈아 덮어써 한쪽 작업이 사라진다. 이 잠금이
/// 매니저를 열기 전의 마지막 관문이다.
pub fn acquire_instance_lock(data_dir: &Path) -> InstanceLockState {
    use std::fs::{File, OpenOptions, TryLockError};
    let open = || -> std::io::Result<File> {
        std::fs::create_dir_all(data_dir)?;
        OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(data_dir.join(INSTANCE_LOCK_FILE))
    };
    let f = match open() {
        Ok(f) => f,
        Err(e) => return InstanceLockState::Unavailable(e),
    };
    match f.try_lock() {
        Ok(()) => InstanceLockState::Acquired(InstanceLock(f)),
        Err(TryLockError::WouldBlock) => InstanceLockState::HeldElsewhere,
        Err(TryLockError::Error(e)) => InstanceLockState::Unavailable(e),
    }
}

/// 격리 실행의 경로·클라이언트·Worker 설정(E2E 빌드에서 환경 변수가 있을 때, `e2e.rs`). 보통 빌드는 늘 `None`이고
/// 이 함수 말고는 E2E 코드가 없다(`release-hygiene`가 릴리스 바이너리로 확인한다).
type Override = Option<(AppPaths, chzzk_core::ClientConfig, Option<WorkerBase>)>;

#[cfg(feature = "e2e")]
fn e2e_override() -> Result<Override, String> {
    Ok(e2e::E2eConfig::from_env()?.map(|c| (c.paths(), c.client(), c.worker_base.clone())))
}

#[cfg(not(feature = "e2e"))]
fn e2e_override() -> Result<Override, String> {
    Ok(None)
}

/// 빌드에 넣은 Worker 출처(build.rs가 검사한 값). 없으면 None
pub fn build_worker_base() -> Option<&'static str> {
    Some(env!("CHZZK_WORKER_BASE_BUILD")).filter(|s| !s.is_empty())
}

/// auth 설정 고르기(D5). `e2e`: E2E가 켜졌으면 Some(그 Worker 주소 또는 None). 빌드 주소는 E2E에서 쓰지 않는다
pub fn auth_setup(
    e2e: Option<Option<WorkerBase>>,
    build: Option<&str>,
    app_version: &str,
) -> Result<AuthSetup, String> {
    let base = match e2e {
        Some(w) => w,
        None => match build {
            Some(v) => Some(
                WorkerBase::parse(v)
                    .map_err(|e| format!("빌드에 넣은 Worker 주소가 올바르지 않다({e})"))?,
            ),
            None => None,
        },
    };
    Ok(match base {
        Some(base) => AuthSetup::Enabled {
            base,
            app_version: app_version.to_string(),
        },
        None => AuthSetup::Disabled,
    })
}

/// 앱 상태(설정·매니저)를 열어 `manage`한다. 로그는 그 전에 시작한다.
fn setup<R: Runtime>(
    app: &tauri::App<R>,
    smoke: Option<SmokeConfig>,
    e2e: Result<Override, String>,
) -> Result<(), Box<dyn std::error::Error>> {
    let e2e = e2e?;
    let p = app.path();
    // 스모크는 임시 폴더만 쓴다(사용자 데이터·로그를 건드리지 않는다). 감시자는 로그보다 먼저 건다.
    if let Some(cfg) = &smoke {
        let (state, rx) = SmokeState::new(cfg.clone());
        spawn_watchdog(
            rx,
            cfg.out.clone(),
            app.package_info().version.to_string(),
            SMOKE_TIMEOUT,
        );
        app.manage(state);
    }
    let log_dir = match (&e2e, &smoke) {
        (Some((paths, _, _)), _) => paths.log.clone(),
        (None, Some(cfg)) => cfg.log_dir(),
        (None, None) => p.app_log_dir()?,
    };
    if let Some(guard) = logging::init(&log_dir) {
        app.manage(guard);
    }
    let (paths, client, e2e_worker) = match (e2e, &smoke) {
        (Some((paths, client, worker)), _) => (paths, Some(client), Some(worker)),
        (None, Some(cfg)) => (
            AppPaths::new(cfg.config_dir(), cfg.data_dir(), log_dir, None, None),
            None,
            None,
        ),
        (None, None) => (
            AppPaths::new(
                p.app_config_dir()?,
                p.app_data_dir()?,
                log_dir,
                p.video_dir().ok(),
                p.download_dir().ok(),
            ),
            None,
            None,
        ),
    };
    tracing::info!(
        version = %app.package_info().version,
        config = %paths.config.display(),
        data = %paths.data.display(),
        log = %paths.log.display(),
        default_download = %paths.default_download.display(),
        "앱 시작"
    );
    // 스모크·E2E는 실행 파일 옆 옛 설정을 찾지 않는다(설치 폴더 내용과 무관하게 같은 결과를 내도록).
    let legacy_dir: Option<PathBuf> = if smoke.is_some() || client.is_some() {
        None
    } else {
        std::env::current_exe()
            .ok()
            .and_then(|e| e.parent().map(PathBuf::from))
    };
    match acquire_instance_lock(&paths.data) {
        InstanceLockState::Acquired(lock) => {
            app.manage(lock);
        }
        InstanceLockState::HeldElsewhere => {
            // 같은 순간에 뜬 다른 실행이 이미 상태를 열었다. 창을 보이지 않고 조용히 끝낸다.
            tracing::warn!("다른 실행이 데이터 폴더를 쓰는 중이라 이 실행을 끝냄");
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
            }
            app.handle().exit(0);
            return Ok(());
        }
        InstanceLockState::Unavailable(e) => {
            tracing::warn!(error = %e, "데이터 폴더 잠금을 쥐지 못해 잠금 없이 계속함");
        }
    }
    let log_dir = paths.log.clone();
    // 로그인 설정(D5): E2E가 켜졌으면 E2E Worker 주소만, 아니면 빌드 주소(스모크는 빌드 주소를 따른다)
    let version = app.package_info().version.to_string();
    let auth = match auth_setup(e2e_worker, build_worker_base(), &version) {
        Ok(a) => a,
        Err(m) => {
            let e = AppError::internal(m);
            tracing::error!(error = %e.message, "로그인 설정이 올바르지 않음");
            startup_failed(app.handle(), &log_dir, &e, StartupFailure::AuthConfig);
            return Ok(());
        }
    };
    tracing::info!(
        auth = matches!(auth, AuthSetup::Enabled { .. }),
        "로그인 설정"
    );
    let client = client.unwrap_or_else(|| chzzk_core::ClientConfig {
        progress_interval: chzzk_shell::services::PROGRESS_INTERVAL,
        ..chzzk_core::ClientConfig::default()
    });
    let opened = App::open_with_auth(paths, client, legacy_dir.as_deref(), tokio_handle(), auth);
    let state = match opened {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(code = ?e.code, error = %e.message, "앱 상태를 열지 못함");
            startup_failed(app.handle(), &log_dir, &e, open_failure_kind(&e));
            return Ok(());
        }
    };
    let auth_arc = state.auth.clone();
    app.manage(state);
    app.manage(auth_io::AuthIoState(Arc::new(auth_io::PluginAuthIo(
        app.handle().clone(),
    ))));
    if let Some(auth) = auth_arc {
        spawn_auth_tasks(app.handle().clone(), auth);
    }
    app.manage(Quitting::default());
    let (notifier, rx) = Notifier::new();
    app.manage(notifier);
    spawn_notifier(app.handle().clone(), rx);
    Ok(())
}

/// 앱 context. E2E 빌드에서 E2E가 켜졌으면(Windows) msedgedriver의 WebView2 인자를 창 설정에 합친다(`e2e::webview2_args`).
fn context() -> tauri::Context<tauri::Wry> {
    #[allow(unused_mut)]
    let mut ctx = tauri::generate_context!();
    #[cfg(all(feature = "e2e", windows))]
    if matches!(e2e::E2eConfig::from_env(), Ok(Some(_))) {
        let env = std::env::var(e2e::WEBVIEW2_ARGS_ENV).ok();
        if let Some(args) = e2e::webview2_args(env.as_deref()) {
            for w in ctx.config_mut().app.windows.iter_mut() {
                w.additional_browser_args = Some(args.clone());
            }
        }
    }
    ctx
}

pub fn run() {
    let smoke = SmokeConfig::from_env();
    let e2e = e2e_override();
    // 격리 실행(스모크·E2E)은 single-instance를 쓰지 않는다
    let isolated = smoke.is_some() || !matches!(e2e, Ok(None));
    let builder = tauri::Builder::default();

    // single-instance는 반드시 첫 플러그인이어야 한다. 두 번째 실행은 기존 창에 포커스만 준다.
    // `--smoke`는 쓰지 않는다: 이미 떠 있는 앱에 포커스만 주고 끝나면 스모크가 아무것도 증명하지 못한다.
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = if !isolated {
        builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_main(app);
        }))
    } else {
        builder
    };

    // macOS: 기본 메뉴의 Quit은 `terminate:`라 닫기 가드를 지나치지 않는다(구현 중 변경 52). 같은 메뉴에 보통
    // 항목으로 두고 `request_quit`으로 보낸다. Dock의 "종료"·AppleScript `quit`은 여전히 `terminate:`다.
    #[cfg(target_os = "macos")]
    let builder = builder.menu(build_menu).on_menu_event(|app, e| {
        if e.id().0 == QUIT_MENU_ID {
            request_quit(app);
        }
    });

    // updater: 공개 키는 tauri.conf.json `plugins.updater.pubkey`(= release/updater.pub, pubkey gate). 엔드포인트·헤더는
    // 확인할 때마다 런타임에 넣는다(update_io.rs). JS 권한 없음(capabilities에 없음, docs/design/cicd.md G6).
    // `UpdaterPlugin` 표식이 있어야 확인한다(플러그인 상태가 없을 때 `updater_builder()`는 패닉한다).
    #[cfg(any(target_os = "macos", windows, target_os = "linux"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update_io::UpdaterPlugin);

    let app = builder
        // 아래 플러그인은 Rust에서만 부른다. capabilities에 플러그인 권한을 주지 않는다.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(move |app| setup(app, smoke, e2e))
        .invoke_handler(handler())
        .build(context())
        .expect("Tauri 앱 만들기 실패");

    app.run(on_run_event);
}

#[cfg(test)]
mod tests {
    use super::{
        CloseDecision, INSTANCE_LOCK_FILE, InstanceLockState, StartupFailure,
        acquire_instance_lock, auth_setup, close_decision, open_failure_kind,
        startup_failure_message,
    };
    use chzzk_shell::{AppError, AuthSetup, WorkerBase};
    use std::path::Path;

    fn base(s: &str) -> WorkerBase {
        WorkerBase::parse(s).unwrap()
    }

    #[test]
    fn auth_setup_table() {
        let v = "0.1.0";
        assert!(matches!(auth_setup(None, None, v), Ok(AuthSetup::Disabled)));
        match auth_setup(None, Some("https://w.example.invalid"), v) {
            Ok(AuthSetup::Enabled { base, app_version }) => {
                assert_eq!(base.origin(), "https://w.example.invalid");
                assert_eq!(app_version, v);
            }
            other => panic!("{other:?}"),
        }
        let e = auth_setup(None, Some("nope"), v).unwrap_err();
        assert!(!e.contains("nope"), "{e}");
        // E2E는 빌드 주소를 쓰지 않는다
        assert!(matches!(
            auth_setup(Some(None), Some("https://w.example.invalid"), v),
            Ok(AuthSetup::Disabled)
        ));
        match auth_setup(Some(Some(base("http://127.0.0.1:9"))), None, v) {
            Ok(AuthSetup::Enabled { base, .. }) => assert_eq!(base.origin(), "http://127.0.0.1:9"),
            other => panic!("{other:?}"),
        }
    }

    // 거의 동시에 뜬 두 실행이 둘 다 single-instance를 지나도 매니저는 하나만 연다(구현 중 변경 51(다)).
    #[test]
    fn instance_lock_admits_one_holder_and_frees_on_drop() {
        let tmp = tempfile::tempdir().unwrap();
        let data = tmp.path().join("data");
        let first = match acquire_instance_lock(&data) {
            InstanceLockState::Acquired(l) => l,
            other => panic!("첫 잠금 실패: {other:?}"),
        };
        assert!(data.join(INSTANCE_LOCK_FILE).is_file());
        assert!(matches!(
            acquire_instance_lock(&data),
            InstanceLockState::HeldElsewhere
        ));
        drop(first);
        assert!(matches!(
            acquire_instance_lock(&data),
            InstanceLockState::Acquired(_)
        ));
    }

    #[test]
    fn startup_failure_message_names_log_folder_and_error() {
        let e = AppError::internal("jobs.json을 읽지 못함: 권한 없음");
        let m = startup_failure_message(Path::new("/logs/app"), &e, StartupFailure::Storage);
        assert!(
            m.starts_with("작업 목록이나 설정 파일을 열지 못했어요."),
            "{m}"
        );
        assert!(m.contains("로그 폴더: /logs/app"), "{m}");
        assert!(m.ends_with("오류: jobs.json을 읽지 못함: 권한 없음"), "{m}");
    }

    #[test]
    fn auth_startup_failure_message_points_to_reinstall() {
        let e = AppError::internal("빌드에 넣은 Worker 주소가 올바르지 않다(예시)");
        let m = startup_failure_message(Path::new("/logs/app"), &e, StartupFailure::AuthConfig);
        assert!(m.starts_with("로그인 서버 설정을 읽지 못했어요."), "{m}");
        assert!(m.contains("다시 받아 설치"), "{m}");
        assert!(!m.contains("디스크"), "{m}");
        assert!(m.contains("로그 폴더: /logs/app"), "{m}");
        assert!(
            m.ends_with("오류: 빌드에 넣은 Worker 주소가 올바르지 않다(예시)"),
            "{m}"
        );
    }

    #[test]
    fn open_failure_kind_table() {
        assert_eq!(
            open_failure_kind(&AppError::internal(chzzk_shell::AUTH_CLIENT_FAILED)),
            StartupFailure::AuthConfig
        );
        assert_eq!(
            open_failure_kind(&AppError::internal("jobs.json을 읽지 못함")),
            StartupFailure::Storage
        );
        // 코드가 다르면 같은 문구여도 Storage
        assert_eq!(
            open_failure_kind(&AppError::invalid_input(chzzk_shell::AUTH_CLIENT_FAILED)),
            StartupFailure::Storage
        );
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

/// Worker 주소 규칙 표(`build_rules.rs`는 build.rs와 이 테스트가 include!로 함께 쓴다)
#[cfg(test)]
mod build_rules_tests {
    include!("../build_rules.rs");

    const ACCEPTED_BOTH: [&str; 5] = [
        "https://worker.example.invalid",
        "https://a-b.c1.example.invalid:8443",
        "https://127.0.0.1:8787",
        "https://10.0.0.1",
        "https://x.1a",
    ];
    const ACCEPTED_DEBUG_ONLY: [&str; 4] = [
        "http://127.0.0.1:8787",
        "http://localhost:8787",
        "http://[::1]:8787",
        "http://localhost",
    ];

    fn rejected() -> Vec<&'static str> {
        vec![
            "https://x.example.invalid/",
            "https://x.example.invalid/api",
            "https://x.example.invalid?q",
            "https://x.example.invalid#f",
            "https://u@x.example.invalid",
            "https://X.example.invalid",
            "https://x.example.invalid:443",
            "https://x.example.invalid:0",
            "https://x.example.invalid:65536",
            "https://x.example.invalid:",
            "https://x.example.invalid:12a",
            "https://x.example.invalid:0443",
            "ftp://x.example.invalid",
            " https://x.example.invalid",
            "https://x.example.invalid ",
            "https://-x.example.invalid",
            "https://x..invalid",
            "https://",
            "https://[2001:db8::1]",
            "https://[::1",
            "https://ex\u{e4}mple.invalid",
            // 마지막 조각이 숫자면 URL이 IPv4로 읽는다: 정규형 점 넷 10진만(구현 중 변경 58 (나))
            "https://a.1",
            "https://127.1",
            "https://0x7f.0.0.1",
            "https://01.2.3.4",
            "https://127.0.0.01",
            "https://1.2.3.4.5",
            "https://256.0.0.1",
            "https://a.0x",
            "https://a.0x1f",
            "https://2130706433",
        ]
    }

    // build.rs만 쓰는 상수가 테스트 모듈에서 dead_code가 되지 않게 하고, env! 리터럴을 이 이름에 묶는다
    #[test]
    fn rustc_env_name_matches_env_macro() {
        assert_eq!(WORKER_BASE_RUSTC_ENV, "CHZZK_WORKER_BASE_BUILD");
        assert_eq!(WORKER_BASE_ENV, "CHZZK_WORKER_BASE");
        assert_eq!(LOOPBACK_HOSTS, ["localhost", "127.0.0.1", "[::1]"]);
    }

    #[test]
    fn release_requires_a_base() {
        for v in [None, Some("")] {
            let e = worker_base_rule("release", v).unwrap_err();
            assert!(e.contains("CHZZK_WORKER_BASE"), "{e}");
        }
    }

    #[test]
    fn debug_without_base_is_off() {
        for v in [None, Some("")] {
            assert_eq!(worker_base_rule("debug", v), Ok(WorkerBaseRule::Off));
        }
    }

    #[test]
    fn accepted_origins() {
        for v in ACCEPTED_BOTH {
            for p in ["release", "debug"] {
                assert_eq!(
                    worker_base_rule(p, Some(v)),
                    Ok(WorkerBaseRule::On(v.to_string())),
                    "{p} {v}"
                );
            }
        }
        for v in ACCEPTED_DEBUG_ONLY {
            assert_eq!(
                worker_base_rule("debug", Some(v)),
                Ok(WorkerBaseRule::On(v.to_string())),
                "debug {v}"
            );
            assert!(worker_base_rule("release", Some(v)).is_err(), "release {v}");
        }
    }

    #[test]
    fn rejected_origins() {
        for v in rejected() {
            for p in ["release", "debug"] {
                assert!(worker_base_rule(p, Some(v)).is_err(), "{p} {v:?}");
            }
        }
        for v in [
            "http://10.0.0.1",
            "http://example.invalid",
            "http://127.0.0.1:80",
        ] {
            assert!(worker_base_rule("debug", Some(v)).is_err(), "debug {v}");
        }
    }

    #[test]
    fn errors_never_echo_the_value() {
        let mut all = rejected();
        all.extend([
            "http://10.0.0.1",
            "http://example.invalid",
            "http://127.0.0.1:80",
        ]);
        for v in all {
            let e = worker_base_rule("debug", Some(v)).unwrap_err();
            for needle in ["example", "invalid", "10.0.0.1"] {
                assert!(!e.contains(needle), "{needle} in {e}");
            }
        }
    }

    #[test]
    fn accepted_values_are_worker_base_origins() {
        for v in ACCEPTED_BOTH.iter().chain(ACCEPTED_DEBUG_ONLY.iter()) {
            assert_eq!(
                chzzk_shell::WorkerBase::parse(v).unwrap().origin(),
                *v,
                "{v}"
            );
        }
    }
}
