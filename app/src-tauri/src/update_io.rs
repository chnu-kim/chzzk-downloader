//! updater seam(Phase 3b A4, worker.md §9.3·§11.6). 확인·다운로드·설치는 플러그인(Rust에서만, JS 권한 없음), 판단은 셸
//! `chzzk_shell::update`가 한다. endpoint·헤더는 확인할 때마다 런타임에 넣는다(tauri.conf.json에 endpoints 없음).
//!
//! 비밀값: `Authorization` 값은 민감 표시를 켜고, 플러그인 오류는 Display(reqwest 오류에는 Worker 주소가 든다)를
//! 로그에 내지 않고 고정 낱말(`kind`)만 남긴다.
//!
//! 전제(worker.md 구현 중 변경 81 (라)): 플러그인은 `log` 크레이트로 요청 주소(Worker 주소)·설치 인자를 `log::debug!`로 찍는다.
//! 이 앱은 `log` → tracing 다리를 두지 않아(tracing-subscriber `default-features = false`로 `tracing-log` 없음,
//! `tauri-plugin-log` 없음) 그 줄은 아무 데도 가지 않고 버려진다. 다리를 들이면 Worker 주소가 로그 파일에 남으므로
//! `deny.toml` `[bans] deny`가 두 크레이트를 막는다(gate `deny`).
//!
//! Windows 설치는 플러그인이 설치 프로그램을 띄우고 `std::process::exit(0)`로 끝나 `RunEvent::Exit`를 건너뛴다.
//! `on_before_exit`에서 플러그인 기본 정리(`cleanup_before_exit`)와 작업 목록·로그 flush를 대신 한다(`before_exit`).

use std::sync::atomic::Ordering;
use std::sync::{Mutex, MutexGuard};

use chzzk_core::Secret;
use chzzk_shell::App;
use chzzk_shell::dto::UpdateProgressEvent;
use chzzk_shell::update::{CHECK_TIMEOUT, FoundUpdate, InstallHost, SourceError, UpdateSource};
use tauri::{AppHandle, Emitter, Manager, Runtime, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::commands::begin_quit;
use crate::logging::LogGuard;
use crate::{Quitting, UPDATE_PROGRESS};

/// updater 플러그인을 등록했다는 표식. `run()`과 플러그인을 등록한 테스트만 manage한다.
/// 없으면 확인하지 않는다(`updater_builder()`는 플러그인 상태가 없으면 패닉한다)
#[derive(Debug)]
pub struct UpdaterPlugin;

/// 플러그인 오류 → 로그 낱말(Display에는 URL이 들어갈 수 있어 쓰지 않는다)
fn kind(e: &tauri_plugin_updater::Error) -> &'static str {
    use tauri_plugin_updater::Error as E;
    match e {
        E::ReleaseNotFound => "release_not_found",
        E::Reqwest(_) | E::Network(_) => "network",
        E::Minisign(_) => "signature",
        _ => "other",
    }
}

/// Windows 설치 직전(`std::process::exit(0)` 앞, 플러그인 `on_before_exit`). `RunEvent::Exit`가 하던 작업 목록 flush와
/// 로그 flush를 하고, 이 훅이 대신하는 플러그인 기본 훅(`cleanup_before_exit`)을 마지막에 부른다(그 뒤에는 tauri API를
/// 쓰지 말라는 것이 tauri 문서다). 다른 OS에서는 불리지 않는다(플러그인이 `#[cfg(windows)]`에서만 담는다)
fn before_exit<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<App>() {
        state.manager.flush();
    }
    tracing::info!("업데이트 설치로 종료");
    if let Some(g) = app.try_state::<LogGuard>() {
        g.close();
    }
    app.cleanup_before_exit();
}

/// 잠금이 오염돼도 값은 한 전이 단위로만 바뀌므로 계속 쓴다
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// 플러그인으로 확인·다운로드·설치하는 원천. check가 찾은 `Update`와 받은 바이트를 download·install까지 들고 있다
pub struct PluginUpdateSource<R: Runtime> {
    app: AppHandle<R>,
    found: Mutex<Option<Update>>,
    bytes: Mutex<Option<Vec<u8>>>,
}

impl<R: Runtime> PluginUpdateSource<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self {
            app,
            found: Mutex::new(None),
            bytes: Mutex::new(None),
        }
    }
}

impl<R: Runtime> UpdateSource for PluginUpdateSource<R> {
    fn check(
        &self,
        endpoint: &str,
        bearer: &Secret<String>,
    ) -> impl Future<Output = Result<Option<FoundUpdate>, SourceError>> + Send {
        let endpoint = endpoint.to_string();
        let bearer = bearer.expose().clone();
        async move {
            if self.app.try_state::<UpdaterPlugin>().is_none() {
                return Err(SourceError::Unavailable);
            }
            let url = Url::parse(&endpoint).map_err(|_| SourceError::Check)?;
            let mut value =
                tauri::http::HeaderValue::from_str(&bearer).map_err(|_| SourceError::Check)?;
            value.set_sensitive(true);
            let updater = self
                .app
                .updater_builder()
                .endpoints(vec![url])
                .map_err(|_| SourceError::Check)?
                .header(tauri::http::header::AUTHORIZATION, value)
                .map_err(|_| SourceError::Check)?
                .timeout(CHECK_TIMEOUT)
                .on_before_exit({
                    let app = self.app.clone();
                    move || before_exit(&app)
                })
                .build()
                .map_err(|e| {
                    tracing::warn!(kind = kind(&e), "업데이트 확인 준비 실패");
                    SourceError::Check
                })?;
            match updater.check().await {
                Ok(None) => Ok(None),
                Ok(Some(u)) => {
                    let f = FoundUpdate {
                        version: u.version.clone(),
                        current: u.current_version.clone(),
                        notes: u.body.clone(),
                        pub_date: u.date.map(|d| d.unix_timestamp()),
                        download_url: u.download_url.as_str().to_string(),
                    };
                    *lock(&self.found) = Some(u);
                    *lock(&self.bytes) = None;
                    Ok(Some(f))
                }
                Err(e) => {
                    tracing::warn!(kind = kind(&e), "업데이트 확인 실패");
                    Err(SourceError::Check)
                }
            }
        }
    }

    async fn download(
        &self,
        on_chunk: &mut (dyn FnMut(u64, Option<u64>) + Send),
    ) -> Result<(), SourceError> {
        let u = lock(&self.found).take().ok_or(SourceError::Download)?;
        let r = u
            .download(|n, total| on_chunk(n as u64, total), || {})
            .await;
        match r {
            Ok(b) => {
                *lock(&self.bytes) = Some(b);
                *lock(&self.found) = Some(u);
                Ok(())
            }
            Err(e) => {
                tracing::warn!(kind = kind(&e), "업데이트 다운로드 실패");
                Err(SourceError::Download)
            }
        }
    }

    async fn install(&self) -> Result<(), SourceError> {
        let u = lock(&self.found).take().ok_or(SourceError::Install)?;
        let b = lock(&self.bytes).take().ok_or(SourceError::Install)?;
        // install은 동기(Linux pkexec 대기·Windows 설치기)라 비동기 작업자를 막지 않게 blocking 스레드에서 돈다(worker.md 68 (바))
        match tauri::async_runtime::spawn_blocking(move || u.install(b)).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(e)) => {
                tracing::warn!(kind = kind(&e), "업데이트 설치 실패");
                Err(SourceError::Install)
            }
            // 설치 스레드가 패닉했다: 설치 실패로 보고 QuitRollback이 멈춘 작업을 되살린다
            Err(_) => {
                tracing::warn!(kind = "panic", "업데이트 설치 실패");
                Err(SourceError::Install)
            }
        }
    }
}

/// 설치를 둘러싼 앱 쪽 일(D6·D7)
pub struct AppInstallHost<R: Runtime>(pub AppHandle<R>);

impl<R: Runtime> InstallHost for AppInstallHost<R> {
    fn running(&self) -> usize {
        self.0
            .try_state::<App>()
            .map_or(0, |s| s.manager.running_count())
    }

    async fn pause_for_install(&self) -> bool {
        let (Some(app), Some(q)) = (self.0.try_state::<App>(), self.0.try_state::<Quitting>())
        else {
            return false;
        };
        begin_quit(&app, &q).await
    }

    fn resume_after_failed_install(&self) {
        if let Some(app) = self.0.try_state::<App>() {
            app.manager.cancel_quit();
        }
        if let Some(q) = self.0.try_state::<Quitting>() {
            q.0.store(false, Ordering::SeqCst);
        }
    }

    fn restart(&self) {
        self.0.request_restart();
    }

    fn progress(&self, e: UpdateProgressEvent) {
        if let Err(err) = self.0.emit_to("main", UPDATE_PROGRESS, e) {
            tracing::warn!(error = %err, "update-progress를 보내지 못함");
        }
    }
}
