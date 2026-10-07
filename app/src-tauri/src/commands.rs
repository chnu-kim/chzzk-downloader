//! Tauri command(docs/design/app.md §4). 인자를 풀어 `chzzk_shell`을 부르는 얇은 층이다.
//!
//! 모두 `async`다. 동기 command는 메인 스레드에서 돌아 설정 저장(`fsync`) 같은 I/O가 창을 멈추게 한다.
//! 창·플러그인이 필요한 것(폴더 선택, 파일 열기, 클립보드, 종료)만 여기서 Tauri API를 부른다.
//! `AppHandle`을 받는 command는 테스트의 mock 런타임에서도 등록되도록 `R: Runtime`으로 둔다.

use std::sync::atomic::Ordering;

use chzzk_core::{ContentRef, PlaybackKind};
use chzzk_shell::app::{Reveal, chzzk_link};
use chzzk_shell::dto::{
    AppFolder, AppInfo, AuthStatusDto, EnqueueRequest, JobDto, JobEvent, LegacyImportDto,
    OutputCheck, ResolvedDto, SettingsDto, SettingsPatch,
};
use chzzk_shell::manager::QUIT_TIMEOUT;
use chzzk_shell::{App, AppError, JobId};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::Quitting;
use crate::auth_io::AuthIoState;
use crate::sink::{ChannelSink, Notifier};
use crate::smoke::{EXIT_MARKER, SmokeState, write_marker};

type Res<T> = Result<T, AppError>;

fn internal(what: &str, e: impl std::fmt::Display) -> AppError {
    AppError::internal(format!("{what}: {e}"))
}

#[tauri::command]
pub async fn app_info<R: Runtime>(app: AppHandle<R>, state: State<'_, App>) -> Res<AppInfo> {
    Ok(state.info(&app.package_info().version.to_string()))
}

#[tauri::command]
pub async fn get_settings(state: State<'_, App>) -> Res<SettingsDto> {
    Ok(state.settings.get())
}

#[tauri::command]
pub async fn update_settings(state: State<'_, App>, patch: SettingsPatch) -> Res<SettingsDto> {
    state.update_settings(patch)
}

#[tauri::command]
pub async fn set_naver_cookies(
    state: State<'_, App>,
    nid_aut: String,
    nid_ses: String,
) -> Res<SettingsDto> {
    state.settings.set_naver_cookies(&nid_aut, &nid_ses)
}

#[tauri::command]
pub async fn clear_naver_cookies(state: State<'_, App>) -> Res<SettingsDto> {
    state.settings.clear_naver_cookies()
}

#[tauri::command]
pub async fn import_legacy(
    state: State<'_, App>,
    dir: Option<String>,
) -> Res<Option<LegacyImportDto>> {
    state.settings.import_legacy(dir.as_deref())
}

/// 폴더 선택 창. JS에 dialog 권한을 주지 않으려고 Rust에서 연다(§11).
#[tauri::command]
pub async fn pick_folder<R: Runtime>(
    app: AppHandle<R>,
    initial: Option<String>,
) -> Res<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = app.dialog().file();
        if let Some(dir) = initial.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
            d = d.set_directory(dir);
        }
        d.blocking_pick_folder()
    })
    .await
    .map_err(|e| internal("폴더 선택 창", e))?;
    let Some(fp) = picked else {
        return Ok(None);
    };
    let path = fp.into_path().map_err(|e| internal("폴더 경로", e))?;
    match path.to_str() {
        Some(s) => Ok(Some(s.to_string())),
        None => Err(AppError::invalid_input(format!(
            "폴더 경로에 쓸 수 없는 글자가 있습니다: {}",
            path.to_string_lossy()
        ))),
    }
}

#[tauri::command]
pub async fn resolve(state: State<'_, App>, url: String) -> Res<ResolvedDto> {
    state.settings.resolve(&url).await
}

#[tauri::command]
pub async fn check_output(
    state: State<'_, App>,
    folder: Option<String>,
    file_name: String,
    content: ContentRef,
    quality_id: String,
    expected_kind: PlaybackKind,
) -> Res<OutputCheck> {
    state.check_output(
        folder.as_deref(),
        &file_name,
        &content,
        &quality_id,
        expected_kind,
    )
}

#[tauri::command]
pub async fn enqueue(state: State<'_, App>, req: EnqueueRequest) -> Res<JobDto> {
    state.enqueue(req)
}

#[tauri::command]
pub async fn list_jobs(state: State<'_, App>) -> Res<Vec<JobDto>> {
    Ok(state.manager.list())
}

/// 구독자를 이 Channel로 바꾸고 스냅샷을 돌려준다(앱 시작·웹뷰 새로고침).
#[tauri::command]
pub async fn subscribe_jobs(
    state: State<'_, App>,
    notifier: State<'_, Notifier>,
    on_event: Channel<JobEvent>,
) -> Res<Vec<JobDto>> {
    Ok(state.manager.subscribe(Box::new(ChannelSink::new(
        on_event,
        notifier.inner().clone(),
    ))))
}

#[tauri::command]
pub async fn pause_job(state: State<'_, App>, id: JobId) -> Res<()> {
    state.manager.pause(id)
}

#[tauri::command]
pub async fn resume_job(state: State<'_, App>, id: JobId, restart: bool) -> Res<()> {
    state.manager.resume(id, restart)
}

#[tauri::command]
pub async fn remove_job(state: State<'_, App>, id: JobId) -> Res<()> {
    state.manager.remove(id).await
}

#[tauri::command]
pub async fn clear_finished(state: State<'_, App>) -> Res<()> {
    state.manager.clear_finished();
    Ok(())
}

#[tauri::command]
pub async fn open_output<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, App>,
    id: JobId,
) -> Res<()> {
    let path = state.open_target(id)?;
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| internal("파일 열기", e))
}

#[tauri::command]
pub async fn reveal_output<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, App>,
    id: JobId,
) -> Res<()> {
    let r = match state.reveal_target(id)? {
        Reveal::Item(p) => app.opener().reveal_item_in_dir(p),
        Reveal::Folder(p) => app.opener().open_path(p.to_string_lossy(), None::<&str>),
    };
    r.map_err(|e| internal("폴더 열기", e))
}

/// 종료 준비: 받는 중인 작업을 멈춰(최대 3초) 저장한다. 이 호출이 종료를 맡았으면 `true`.
///
/// 한 번만 돈다. 두 번째 호출(D1 `[닫기]` 두 번 누르기 등)이 첫 호출의 대기 중에 다시 돌면, 이미 멈추는 중인
/// 작업(사용자 일시정지로 `pausing`인 것 포함)을 곧바로 `interrupted`로 저장하고 먼저 끝내 버린다.
pub async fn begin_quit(state: &App, quitting: &Quitting) -> bool {
    if quitting.0.swap(true, Ordering::SeqCst) {
        return false;
    }
    state.manager.quit(QUIT_TIMEOUT).await;
    true
}

/// D1에서 `[닫기]`: 받는 중인 작업을 멈춰 저장한 뒤 종료한다. 이미 종료 중이면 아무것도 하지 않는다.
#[tauri::command]
pub async fn quit<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, App>,
    quitting: State<'_, Quitting>,
) -> Res<()> {
    // `Quitting`이 서 있는 동안 창 닫기·앱 종료 요청은 D1 없이 막힌다(`guard_close`).
    if begin_quit(&state, &quitting).await {
        app.exit(0);
    }
    Ok(())
}

/// 설정 화면의 "설정 폴더 열기 / 로그 폴더 열기"와 저장 폴더 "폴더 열기"(S2). JS에 opener 권한이 없어 Rust가 연다.
#[tauri::command]
pub async fn open_app_folder<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, App>,
    kind: AppFolder,
) -> Res<()> {
    let dir = state.folder_target(kind)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| internal("폴더 열기", e))
}

#[tauri::command]
pub async fn auth_status(state: State<'_, App>) -> Res<AuthStatusDto> {
    Ok(state.auth_status())
}

/// 로그인 시작(worker.md §11.4): 확인 페이지를 브라우저로 열고 폴링한다. 결과는 auth-changed로도 온다
#[tauri::command]
pub async fn auth_login(state: State<'_, App>, io: State<'_, AuthIoState>) -> Res<AuthStatusDto> {
    let io = io.0.clone();
    Ok(state.auth_login(move |u| io.open_url(u)).await)
}

#[tauri::command]
pub async fn auth_reopen(state: State<'_, App>, io: State<'_, AuthIoState>) -> Res<bool> {
    Ok(state.auth_reopen(|u| io.0.open_url(u)))
}

#[tauri::command]
pub async fn auth_copy_login_url(state: State<'_, App>, io: State<'_, AuthIoState>) -> Res<bool> {
    Ok(state.auth_copy_login_url(|t| io.0.copy_text(t)))
}

#[tauri::command]
pub async fn auth_cancel(state: State<'_, App>) -> Res<AuthStatusDto> {
    Ok(state.auth_cancel())
}

/// [다시 연결]
#[tauri::command]
pub async fn auth_retry(state: State<'_, App>) -> Res<AuthStatusDto> {
    Ok(state.auth_retry().await)
}

/// 로그아웃. 받던 다운로드는 계속된다
#[tauri::command]
pub async fn auth_logout(state: State<'_, App>) -> Res<AuthStatusDto> {
    state.auth_logout().await
}

/// 클립보드에 치지직 주소가 있으면 그 주소만 돌려준다(§16 클립보드 감지, 창 포커스 때 프런트가 부른다).
/// 클립보드의 다른 글은 웹뷰로 보내지 않는다. 글이 없거나 읽지 못하면 `null`이다.
#[tauri::command]
pub async fn clipboard_link<R: Runtime>(app: AppHandle<R>) -> Res<Option<String>> {
    Ok(app
        .clipboard()
        .read_text()
        .ok()
        .and_then(|t| chzzk_link(&t)))
}

/// 프런트가 처음 그려진 뒤 한 번 부른다(`app/src/lib/ready.ts`). 보통 실행에서는 아무것도 하지 않는다.
/// `--smoke`면 마커(`{version, ready:true, auth}`)를 쓰고 앱을 끝낸다(docs/design/cicd.md §6). dist가 실리고 CSP를
/// 지나 IPC가 닿았다는 증거다.
#[tauri::command]
pub async fn frontend_ready<R: Runtime>(app: AppHandle<R>) -> Res<()> {
    let Some(smoke) = app.try_state::<SmokeState>() else {
        return Ok(());
    };
    if !smoke.fire() {
        return Ok(());
    }
    let version = app.package_info().version.to_string();
    let auth = app.try_state::<App>().is_some_and(|s| s.auth_enabled());
    match write_marker(smoke.config.out.as_deref(), &version, true, auth) {
        Ok(()) => {
            tracing::info!(%version, "smoke: frontend_ready");
            app.exit(0);
        }
        Err(e) => {
            tracing::error!(error = %e, "smoke: 마커를 쓰지 못함");
            app.exit(EXIT_MARKER);
        }
    }
    Ok(())
}
