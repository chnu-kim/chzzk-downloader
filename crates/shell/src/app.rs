//! 앱 상태 묶음(docs/design/app.md §4 `App`)과 command가 부르는 판단.
//!
//! Tauri command는 인자를 풀어 여기를 부르는 한 줄이어야 한다(§4). 창·플러그인처럼 Tauri가 필요한 일
//! (폴더 선택 창, 파일 열기, 클립보드 읽기, 알림)만 앱 어댑터(`app/src-tauri`)에 남고, 무엇을 열지·무엇을
//! 돌려줄지는 여기서 정해 webkit 없이 검사한다.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use chzzk_core::{Chzzk, ClientConfig, ContentRef, PlaybackKind, parse_content_url};
use tokio::runtime::Handle;

use crate::JobId;
use crate::auth::{
    AuthPhase, AuthService, AuthStatus, BeginLogin, HttpWorkerApi, SessionStore, SystemClock,
    WorkerBase, client_label,
};
use crate::dto::{
    AppFolder, AppInfo, AuthStatusDto, EnqueueRequest, Features, JobDto, OutputCheck, SettingsDto,
    SettingsPatch,
};
use crate::error::AppError;
use crate::gate;
use crate::jobs::JobStore;
use crate::manager::{DownloadManager, ManagerConfig};
use crate::ownership::OwnershipGate;
use crate::services::{self, AppPaths, PROGRESS_INTERVAL, SettingsService};

/// 클립보드에서 치지직 주소를 찾을 때 보는 최대 길이(바이트). 이보다 길면 주소를 붙여 둔 것으로 보지 않는다.
pub const MAX_CLIPBOARD_SCAN: usize = 4096;

/// `HttpWorkerApi`를 만들지 못했을 때의 `AppError::internal` 문구. 앱이 시작 실패 안내를 고를 때 이 값으로 가린다
/// (worker.md 구현 중 변경 64). **이 문구가 곧 분기 키다**: 바꾸면 `app/src-tauri/src/lib.rs`의 `open_failure_kind`
/// 분류(문자열 비교)와 그 테스트도 함께 본다. 원래 오류는 여기서 버리지 않고 `tracing::error!`로 남긴다.
pub const AUTH_CLIENT_FAILED: &str = "로그인 서버 클라이언트를 만들지 못했습니다";

/// 앱이 쓰는 로그인 서비스
pub type AppAuth = AuthService<HttpWorkerApi, SystemClock>;

/// 로그인 설정. 릴리스는 늘 Enabled(build.rs), debug는 주소가 있을 때만
#[derive(Clone, Debug)]
pub enum AuthSetup {
    /// 로그인을 쓰지 않는다(게이트 통과, `features.auth=false`)
    Disabled,
    /// 이 Worker로 로그인한다. `app_version`은 `/auth/start`의 client 문자열(`client_label`)에 쓴다
    Enabled {
        base: WorkerBase,
        app_version: String,
    },
}

/// 앱이 Tauri `manage`로 들고 있는 상태.
pub struct App {
    pub settings: SettingsService,
    pub manager: DownloadManager<Chzzk>,
    pub paths: AppPaths,
    pub gate: OwnershipGate,
    /// 로그인 서비스. `None`이면 로그인을 쓰지 않는 빌드
    pub auth: Option<Arc<AppAuth>>,
    /// 로그인 뒤로 미룬 재시작 후 자동 이어받기(D15)
    auto_resume_pending: AtomicBool,
    /// 로그인 폴링 태스크를 띄울 런타임
    runtime: Handle,
}

impl std::fmt::Debug for App {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("App")
            .field("settings", &self.settings)
            .field("paths", &self.paths)
            .field("auth", &self.auth.is_some())
            .finish_non_exhaustive()
    }
}

/// `reveal_output`이 보여 줄 것.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reveal {
    /// 파일 탐색기에서 이 파일을 골라 보여 준다
    Item(PathBuf),
    /// 파일이 없어 폴더를 연다
    Folder(PathBuf),
}

impl App {
    /// 설정을 먼저 열고(동시 작업 수·자동 이어받기를 읽는다) 그 값으로 매니저를 연다(구현 중 변경 34).
    ///
    /// - `legacy_dir`: 첫 실행 가져오기 후보를 찾을 폴더(앱은 `current_exe()`의 부모)
    /// - `runtime`: 작업 태스크를 띄울 런타임(앱은 Tauri의 tokio 런타임)
    pub fn open(
        paths: AppPaths,
        legacy_dir: Option<&Path>,
        runtime: Handle,
    ) -> Result<Self, AppError> {
        Self::open_with(
            paths,
            ClientConfig {
                progress_interval: PROGRESS_INTERVAL,
                ..ClientConfig::default()
            },
            legacy_dir,
            runtime,
        )
    }

    /// 로그인 없이 연다(테스트·로그인을 쓰지 않는 debug 빌드). 앱 setup은 `open_with_auth`를 쓴다.
    pub fn open_with(
        paths: AppPaths,
        base: ClientConfig,
        legacy_dir: Option<&Path>,
        runtime: Handle,
    ) -> Result<Self, AppError> {
        Self::open_with_auth(paths, base, legacy_dir, runtime, AuthSetup::Disabled)
    }

    /// `open_with`와 같고 로그인 설정을 받는다. Enabled면 세션 파일을 읽어 첫 상태를 정하고(네트워크 없음),
    /// 재시작 후 자동 이어받기는 로그인 뒤로 미룬다(D15).
    pub fn open_with_auth(
        paths: AppPaths,
        base: ClientConfig,
        legacy_dir: Option<&Path>,
        runtime: Handle,
        auth: AuthSetup,
    ) -> Result<Self, AppError> {
        let settings = SettingsService::open(&paths, base, legacy_dir)?;
        let s = settings.settings();
        let auth = match auth {
            AuthSetup::Disabled => None,
            AuthSetup::Enabled { base, app_version } => {
                let api = HttpWorkerApi::new(base.clone()).map_err(|e| {
                    // ApiError는 주소·본문·토큰을 담지 않는다(종류만)
                    tracing::error!(error = ?e, "로그인 클라이언트를 만들지 못함");
                    AppError::internal(AUTH_CLIENT_FAILED)
                })?;
                let store = SessionStore::new(paths.config.clone(), &base);
                Some(Arc::new(AuthService::open(
                    api,
                    SystemClock,
                    store,
                    client_label(&app_version),
                )))
            }
        };
        let defer = auth.is_some() && s.auto_resume_interrupted;
        let manager = DownloadManager::open(ManagerConfig {
            client: settings.client_fn(),
            store: JobStore::new(paths.data.clone()),
            runtime: runtime.clone(),
            max_parallel: s.max_parallel_downloads,
            auto_resume: s.auto_resume_interrupted && auth.is_none(),
        })?;
        Ok(App {
            settings,
            manager,
            paths,
            gate: OwnershipGate::disabled(),
            auth,
            auto_resume_pending: AtomicBool::new(defer),
            runtime,
        })
    }

    /// `app_info`. `version`은 앱 패키지 버전(`tauri.conf.json`).
    pub fn info(&self, version: &str) -> AppInfo {
        AppInfo {
            version: version.to_string(),
            core_version: chzzk_core::VERSION.to_string(),
            config_dir: path_string(&self.paths.config),
            data_dir: path_string(&self.paths.data),
            log_dir: path_string(&self.paths.log),
            default_download_folder: path_string(&self.paths.default_download),
            features: Features {
                auth: self.auth_enabled(),
            },
            legacy_candidate: self.settings.legacy_candidate(),
        }
    }

    /// `update_settings`. 동시 작업 수를 매니저에도 반영한다.
    pub fn update_settings(&self, patch: SettingsPatch) -> Result<SettingsDto, AppError> {
        self.settings.update_and_apply(patch, &self.manager)
    }

    /// `check_output`. 폴더가 없으면 `enqueue`와 같은 폴더(설정 폴더, 없으면 기본 폴더)를 쓴다.
    pub fn check_output(
        &self,
        folder: Option<&str>,
        file_name: &str,
        content: &ContentRef,
        quality_id: &str,
        kind: PlaybackKind,
    ) -> Result<OutputCheck, AppError> {
        let defaults = self.settings.job_defaults();
        self.manager.check_output(
            folder,
            &defaults.download_folder,
            file_name,
            content,
            quality_id,
            kind,
        )
    }

    /// `enqueue`: 게이트 → 매니저 → 최근 VOD(§6.2).
    pub fn enqueue(&self, req: EnqueueRequest) -> Result<JobDto, AppError> {
        services::enqueue(&self.settings, &self.gate, &self.manager, req)
    }

    /// `open_output`이 열 파일. 최종 파일이 없으면 `fileMissing`.
    pub fn open_target(&self, id: JobId) -> Result<PathBuf, AppError> {
        let (path, _) = self.manager.output_of(id)?;
        if path.is_file() {
            Ok(path)
        } else {
            Err(AppError::file_missing(&path))
        }
    }

    /// `reveal_output`: 파일이 있으면 파일을, 없으면 폴더를 보여 준다. 폴더도 없으면 `fileMissing`(폴더 경로).
    pub fn reveal_target(&self, id: JobId) -> Result<Reveal, AppError> {
        let (path, _) = self.manager.output_of(id)?;
        if path.is_file() {
            return Ok(Reveal::Item(path));
        }
        match path.parent() {
            Some(dir) if dir.is_dir() => Ok(Reveal::Folder(dir.to_path_buf())),
            Some(dir) => Err(AppError::file_missing(dir)),
            None => Err(AppError::file_missing(&path)),
        }
    }
}

impl App {
    /// 로그인을 쓰는 빌드인가(= `features.auth`)
    pub fn auth_enabled(&self) -> bool {
        self.auth.is_some()
    }

    /// `auth_status`
    pub fn auth_status(&self) -> AuthStatusDto {
        match &self.auth {
            None => AuthStatusDto::disabled(),
            Some(a) => AuthStatusDto::from_status(&a.status()),
        }
    }

    /// command 층 게이트(D1·D3). 허용 목록이거나 로그인을 쓰지 않으면 Ok, 아니면 `require_signed_in`
    pub fn gate_command(&self, cmd: &str) -> Result<(), AppError> {
        match &self.auth {
            None => Ok(()),
            Some(_) if gate::is_open(cmd) => Ok(()),
            Some(a) => a.require_signed_in(),
        }
    }

    /// 상태가 바뀔 때마다(처음 포함) 앱이 부른다. 처음 SignedIn에서 미뤄 둔 자동 이어받기를 한 번 한다. 줄 세운 수
    pub fn on_auth_status(&self, st: &AuthStatus) -> usize {
        if st.phase != AuthPhase::SignedIn
            || !self.auto_resume_pending.swap(false, Ordering::SeqCst)
        {
            return 0;
        }
        let n = self.manager.resume_interrupted();
        tracing::info!(count = n, "로그인 뒤 멈춘 작업을 자동으로 이어받는다");
        n
    }

    /// `auth_login`(D13): Started일 때만 `open(로그인 주소)`을 부르고 폴링 태스크를 띄운다
    pub async fn auth_login(&self, open: impl FnOnce(&str) -> bool + Send) -> AuthStatusDto {
        let Some(auth) = self.auth.clone() else {
            return AuthStatusDto::disabled();
        };
        if let BeginLogin::Started(ticket) = auth.begin_login().await {
            if !open(ticket.login_url.expose()) {
                tracing::warn!(result = "open_failed", "로그인 주소를 브라우저로 열지 못함");
            }
            let a = auth.clone();
            self.runtime.spawn(async move {
                a.run_login_poll().await;
            });
        }
        AuthStatusDto::from_status(&auth.status())
    }

    /// `auth_reopen`: 대기 중이면 같은 주소를 다시 연다. 연 시도가 성공했으면 true
    pub fn auth_reopen(&self, open: impl FnOnce(&str) -> bool) -> bool {
        match self.auth.as_ref().and_then(|a| a.login_ticket()) {
            Some(t) => open(t.login_url.expose()),
            None => false,
        }
    }

    /// `auth_copy_login_url`: 대기 중이면 로그인 주소를 클립보드에. 썼으면 true
    pub fn auth_copy_login_url(&self, copy: impl FnOnce(&str) -> bool) -> bool {
        match self.auth.as_ref().and_then(|a| a.login_ticket()) {
            Some(t) => copy(t.login_url.expose()),
            None => false,
        }
    }

    /// `auth_cancel`
    pub fn auth_cancel(&self) -> AuthStatusDto {
        match &self.auth {
            None => AuthStatusDto::disabled(),
            Some(a) => AuthStatusDto::from_status(&a.cancel_login()),
        }
    }

    /// `auth_retry`([다시 연결]): 지금 갱신(온라인 `SignedIn`이고 예정 전이면 네트워크 없이 상태만, 구현 중 변경 61)
    pub async fn auth_retry(&self) -> AuthStatusDto {
        match self.auth.clone() {
            None => AuthStatusDto::disabled(),
            Some(a) => AuthStatusDto::from_status(&a.retry().await),
        }
    }

    /// `auth_logout`: 로컬 먼저 → 서버(실패 무시). 세션 파일을 지우지도 비우지도 못했으면 오류(상태는 SignedOut)
    pub async fn auth_logout(&self) -> Result<AuthStatusDto, AppError> {
        let Some(a) = self.auth.clone() else {
            return Ok(AuthStatusDto::disabled());
        };
        a.logout()
            .await
            .map(|s| AuthStatusDto::from_status(&s))
            .map_err(|e| AppError::internal(format!("로그인 정보를 지우지 못했습니다({})", e.op)))
    }
}

impl App {
    /// `open_app_folder`가 열 폴더. 없으면 만든다(저장 폴더는 첫 다운로드 때 코어가 만들므로 아직 없을 수 있다).
    pub fn folder_target(&self, which: AppFolder) -> Result<PathBuf, AppError> {
        let dir = match which {
            AppFolder::Config => self.paths.config.clone(),
            AppFolder::Logs => self.paths.log.clone(),
            AppFolder::Downloads => self.settings.effective_download_folder(),
        };
        std::fs::create_dir_all(&dir).map_err(|source| {
            AppError::from(chzzk_core::Error::Io {
                op: "create_dir",
                path: dir.clone(),
                source,
            })
        })?;
        Ok(dir)
    }
}

/// 클립보드 글에서 치지직 VOD·클립 주소 하나를 찾는다(§16 클립보드 감지).
///
/// 공백으로 나눈 토큰 중 `parse_content_url`이 받아들이는 첫 토큰을 앞뒤 공백 없이 돌려준다. 그 밖의 글은
/// 돌려주지 않으므로 클립보드의 다른 내용(비밀번호 등)은 웹뷰에 닿지 않는다. 너무 긴 글은 보지 않는다.
pub fn chzzk_link(text: &str) -> Option<String> {
    if text.len() > MAX_CLIPBOARD_SCAN {
        return None;
    }
    text.split_whitespace()
        .find(|t| parse_content_url(t).is_ok())
        .map(str::to_string)
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chzzk_link_picks_first_content_url() {
        assert_eq!(
            chzzk_link("  https://chzzk.naver.com/video/123\n"),
            Some("https://chzzk.naver.com/video/123".into())
        );
        assert_eq!(
            chzzk_link("이거 봐 chzzk.naver.com/clips/abc_D-1 재밌음"),
            Some("chzzk.naver.com/clips/abc_D-1".into())
        );
        assert_eq!(
            chzzk_link("https://example.com/video/1 https://m.chzzk.naver.com/video/9"),
            Some("https://m.chzzk.naver.com/video/9".into())
        );
    }

    #[test]
    fn chzzk_link_ignores_other_text() {
        assert_eq!(chzzk_link(""), None);
        assert_eq!(chzzk_link("hunter2"), None);
        assert_eq!(chzzk_link("https://chzzk.naver.com/live/abc"), None);
        let long = format!("{} https://chzzk.naver.com/video/1", "x".repeat(5000));
        assert_eq!(chzzk_link(&long), None);
    }
}
