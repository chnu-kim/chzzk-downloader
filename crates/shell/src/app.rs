//! 앱 상태 묶음(docs/design/app.md §4 `App`)과 command가 부르는 판단.
//!
//! Tauri command는 인자를 풀어 여기를 부르는 한 줄이어야 한다(§4). 창·플러그인처럼 Tauri가 필요한 일
//! (폴더 선택 창, 파일 열기, 클립보드 읽기, 알림)만 앱 어댑터(`app/src-tauri`)에 남고, 무엇을 열지·무엇을
//! 돌려줄지는 여기서 정해 webkit 없이 검사한다.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use chzzk_core::chat::SubtitleFormat;
use chzzk_core::{
    Chzzk, ClientConfig, ContentRef, PlaybackKind, is_own_channel, parse_content_url,
};
use tokio::runtime::Handle;

use crate::JobId;
use crate::auth::{
    AuthPhase, AuthService, AuthStatus, BeginLogin, DelegatedChannel, DelegationCheck,
    EditorsError, HttpWorkerApi, SessionStore, SystemClock, Trigger, WorkerBase, client_label,
    token,
};
use crate::dto::{
    AppFolder, AppInfo, AuthStatusDto, EditorsDto, EnqueueRequest, Features,
    FileNameTemplatePreview, HelpId, InviteDto, JobDto, OnExisting, OutputCheck, ResolvedDto,
    SettingsDto, SettingsPatch, TimeRangeDto, UpdateCheckDto, UpdateInfoDto, UpdateInstallDto,
    WebPage,
};
use crate::error::{AppError, ErrorCode};
use crate::gate;
use crate::jobs::JobStore;
use crate::manager::{DownloadManager, ManagerConfig};
use crate::ownership::{OwnershipGate, SignedInChannel};
use crate::services::{self, AppPaths, PROGRESS_INTERVAL, SettingsService};
use crate::update::{InstallHost, UpdateSource, Updates, auto_check_due};

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

/// `App`을 여는 방법의 선택. 기본값은 GUI가 쓰는 것이다.
#[derive(Clone, Copy, Debug)]
pub struct OpenOptions {
    /// 설정이 켜져 있으면 재시작 후 멈춘 작업을 자동으로 이어받는다(GUI). 명령줄(CLI)은 끈다:
    /// 사용자가 멈춘 작업을 명령 한 번에 되살리면 안 되고, 다음 GUI가 자기 첫 로그인 확인에서 한다(cli-mode.md §5.2).
    pub auto_resume: bool,
}

impl Default for OpenOptions {
    fn default() -> Self {
        OpenOptions { auto_resume: true }
    }
}

/// `auth_login_wait`의 결과.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoginWait {
    /// 로그인을 쓰지 않는 빌드
    Disabled,
    /// 로그인 주소를 브라우저로 열지 못해 로그인을 그만두었다
    OpenFailed,
    /// 로그인이 끝난 상태(성공·거부·시간 초과·오류, 시작 실패 포함, 이미 로그인된 경우)
    Done(AuthStatusDto),
}

/// 앱이 Tauri `manage`로 들고 있는 상태.
pub struct App {
    pub settings: SettingsService,
    pub manager: DownloadManager<Chzzk>,
    pub paths: AppPaths,
    pub gate: OwnershipGate,
    /// 로그인 서비스. `None`이면 로그인을 쓰지 않는 빌드
    pub auth: Option<Arc<AppAuth>>,
    /// 로그인에 쓰는 Worker 출처(`auth`와 함께 `Some`). 업데이트 주소·출처 대조에 쓴다(A4)
    pub worker_base: Option<WorkerBase>,
    /// 마지막으로 찾은 업데이트와 설치 가드(A4)
    pub updates: Updates,
    /// 로그인 뒤로 미룬 재시작 후 자동 이어받기(D15)
    auto_resume_pending: AtomicBool,
    /// 맡은 채널 작업의 자동 이어받기: 이번 실행에서 서버가 맡은 채널을 확인한 뒤의 첫 SignedIn에서만(delegation.md §9.3)
    auto_resume_delegated_pending: AtomicBool,
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

/// `check_output`의 채팅 인자(chat.md §4.4). 둘 다 없으면 채팅 없이 판정한다(옛 호출과 같다).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ChatCheck {
    pub save_chat: bool,
    /// 없으면 지금 설정 `chatSubtitle`
    pub subtitle: Option<SubtitleFormat>,
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
        Self::open_with_options(
            paths,
            base,
            legacy_dir,
            runtime,
            auth,
            OpenOptions::default(),
        )
    }

    /// `open_with_auth`와 같고 여는 방법을 고른다(명령줄은 자동 이어받기를 끈다).
    pub fn open_with_options(
        paths: AppPaths,
        base: ClientConfig,
        legacy_dir: Option<&Path>,
        runtime: Handle,
        auth: AuthSetup,
        options: OpenOptions,
    ) -> Result<Self, AppError> {
        let settings = SettingsService::open(&paths, base, legacy_dir)?;
        let s = settings.settings();
        let mut worker_base = None;
        let auth = match auth {
            AuthSetup::Disabled => None,
            AuthSetup::Enabled { base, app_version } => {
                worker_base = Some(base.clone());
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
        let resume = options.auto_resume && s.auto_resume_interrupted;
        let defer = auth.is_some() && resume;
        let manager = DownloadManager::open(ManagerConfig {
            client: settings.client_fn(),
            store: JobStore::new(paths.data.clone()),
            runtime: runtime.clone(),
            max_parallel: s.max_parallel_downloads,
            auto_resume: resume && auth.is_none(),
            total_rate_limit: s.total_rate_limit,
            job_rate_limit: s.job_rate_limit,
        })?;
        let gate = match &auth {
            Some(a) => {
                let a: Arc<dyn SignedInChannel> = a.clone();
                OwnershipGate::enabled(a)
            }
            None => OwnershipGate::disabled(),
        };
        Ok(App {
            settings,
            manager,
            paths,
            gate,
            auth,
            worker_base,
            updates: Updates::default(),
            auto_resume_pending: AtomicBool::new(defer),
            auto_resume_delegated_pending: AtomicBool::new(defer),
            runtime,
        })
    }

    /// `app_info`. `version`은 앱 패키지 버전(`tauri.conf.json`).
    pub fn info(&self, version: &str) -> AppInfo {
        let (text_scale, theme) = self.settings.appearance();
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
            platform: chzzk_core::Platform::current().into(),
            text_scale,
            theme,
        }
    }

    /// `open_web_page`가 열 주소: 로그인 서버(Worker) 출처 아래 고정 경로(system/patterns.md §13·§14.4).
    /// 로그인을 쓰지 않는 빌드는 열 곳이 없다(화면이 링크를 그리지 않는다).
    /// `anchor`는 도움말에만 붙는다(`/help#<id>`, 오류 L2 링크, app.md 구현 중 변경 84). 다른 페이지에 붙이면 `invalidInput`.
    pub fn web_page_url(&self, page: WebPage, anchor: Option<HelpId>) -> Result<String, AppError> {
        let base = self
            .worker_base
            .as_ref()
            .ok_or_else(|| AppError::invalid_input("로그인 서버가 없는 빌드입니다"))?;
        let path = match page {
            WebPage::Privacy => "/privacy",
            WebPage::Licenses => "/licenses",
            WebPage::Help => "/help",
        };
        match (page, anchor) {
            (_, None) => Ok(base.url(path)),
            (WebPage::Help, Some(id)) => Ok(base.url(&format!("{path}#{}", id.as_str()))),
            (_, Some(_)) => Err(AppError::invalid_input(
                "도움말이 아닌 페이지에는 앵커를 붙일 수 없습니다",
            )),
        }
    }

    /// `update_settings`. 동시 작업 수를 매니저에도 반영한다.
    pub fn update_settings(&self, patch: SettingsPatch) -> Result<SettingsDto, AppError> {
        self.settings.update_and_apply(patch, &self.manager)
    }

    /// `preview_file_name_template`.
    pub fn preview_file_name_template(&self, template: &str) -> FileNameTemplatePreview {
        self.settings.preview_file_name_template(template)
    }

    /// `check_output`. 폴더가 없으면 `enqueue`와 같은 폴더(설정 폴더, 없으면 기본 폴더)를 쓴다.
    #[allow(clippy::too_many_arguments)] // command 인자를 그대로 펼쳐 받는다(`commands::check_output`)
    pub fn check_output(
        &self,
        folder: Option<&str>,
        file_name: &str,
        content: &ContentRef,
        quality_id: &str,
        kind: PlaybackKind,
        range: Option<TimeRangeDto>,
        chat: ChatCheck,
    ) -> Result<OutputCheck, AppError> {
        let defaults = self.settings.job_defaults();
        // 채팅을 함께 받으면 그 자막 형식(주지 않으면 지금 설정)의 채팅 파일도 충돌 판정에 넣는다(chat.md §4.4)
        let chat = chat
            .save_chat
            .then(|| chat.subtitle.unwrap_or(defaults.chat_subtitle));
        self.manager.check_output(
            folder,
            &defaults.download_folder,
            file_name,
            content,
            quality_id,
            kind,
            range,
            chat,
        )
    }

    /// `fetch_chat`(완료 행 [⋯] › 채팅 받기·다시 받기·이어받기·덮어쓰고 받기, chat.md §4.5).
    ///
    /// `resume_job`과 같은 순서다(worker.md 구현 중 변경 86 (가)): 로그인을 쓰지 않는 빌드는 판정 없이, 쓰면 매니저 잠금 밖에서
    /// enqueue와 같은 `OwnershipGate::admit`으로 **작업 컨텐츠**를 판정하고(기록의 `channelId`는 믿지 않는다), 잠금 안에서 같은
    /// 컨텐츠인지만 다시 본 뒤 통과한 채널 ID를 기록에 고쳐 쓴다. 거부되면 채팅 상태·`.part`는 그대로다.
    pub async fn fetch_chat(
        &self,
        id: JobId,
        restart: bool,
        on_existing: OnExisting,
    ) -> Result<(), AppError> {
        let setting = self.settings.job_defaults().chat_subtitle;
        if !self.gate.is_enabled() {
            return self
                .manager
                .start_chat(id, restart, on_existing, setting, |_| Ok(None));
        }
        let Some(content) = self.manager.chat_content(id)? else {
            // 지우는 중: 아무것도 하지 않는다
            return Ok(());
        };
        let owner = self.admit_job(id, &content).await?;
        self.manager.start_chat(
            id,
            restart,
            on_existing,
            setting,
            same_content(content, owner),
        )
    }

    /// 작업 `id`의 컨텐츠를 잠금 밖에서 판정한다(`resume_job`·`fetch_chat`·맡은 채널 자동 이어받기가 같이 쓴다). 허용이면 검증한
    /// 채널 ID. 남의 영상이면 기록을 실제 채널로 고친다: 화면이 막힌 작업으로 보이고 B1이 다시 세지 않는다
    async fn admit_job(&self, id: JobId, content: &ContentRef) -> Result<Option<String>, AppError> {
        match self
            .gate
            .admit_checked(
                content,
                || self.settings.content_channel(content),
                || self.recheck(),
            )
            .await
        {
            Ok(o) => Ok(o),
            Err(e) => {
                if e.code == ErrorCode::NotOwnContent
                    && let Some(real) = self.gate.known_channel(content)
                {
                    self.manager.note_channel(id, content, real);
                }
                Err(e)
            }
        }
    }

    /// `enqueue`: 게이트 → 매니저 → 최근 VOD(§6.2).
    pub async fn enqueue(&self, req: EnqueueRequest) -> Result<JobDto, AppError> {
        services::enqueue_checked(&self.settings, &self.gate, &self.manager, req, || {
            self.recheck()
        })
        .await
    }

    /// `resolve`: 주소를 풀고 본인 영상 판정을 붙인다(A5).
    pub async fn resolve(&self, url: &str) -> Result<ResolvedDto, AppError> {
        self.settings
            .resolve_checked(url, &self.gate, || self.recheck())
            .await
    }

    /// 판정 직전 맡은 채널 자동 확인(간격 5분·오프라인이면 건너뛴다). 결과는 로그인 상태와 디스크 목록에 반영되고
    /// 호출자는 판정을 다시 한다. 서버에 닿지 못해도 판정은 디스크 목록으로 계속한다
    ///
    /// 디스크 세션은 관리자인데 이번 실행에서 서버가 확인하지 않았으면(`Signer::admin_pending`) 먼저 refresh로 관리자 여부를
    /// 확인한다(/api/me는 관리자 여부를 주지 않는다). GUI는 시작 때 refresh하므로 보통 이미 확인돼 있고, 명령줄은
    /// 갱신 예정 전이면 refresh하지 않으므로 여기서 처음 묻는다(cli-mode.md §5.2). 관리자로 확인되면 맡은 채널은 묻지 않는다
    async fn recheck(&self) {
        if let Some(a) = &self.auth {
            a.confirm_admin().await;
            if a.signer().is_some_and(|s| s.is_admin) {
                return;
            }
            let _ = a.check_delegations(false).await;
        }
    }

    /// `resume_job`(이어받기·다시 시도·처음부터·덮어쓰고 받기): 로그인한 채널의 영상만(A5).
    ///
    /// 기록의 `channel_id`는 믿지 않는다(`jobs.json` 변조, worker.md 86). 다시 줄 세울 작업이면 enqueue와 같은
    /// `OwnershipGate::admit`으로 작업 컨텐츠를 판정하고(최근 resolve 캐시, 없으면 다시 resolve), 통과한 채널 ID를
    /// 기록에 고쳐 쓴다. 판정(네트워크)은 매니저 잠금 밖에서 하고, 잠금 안에서는 같은 컨텐츠인지만 다시 본다.
    pub async fn resume_job(&self, id: JobId, restart: bool) -> Result<(), AppError> {
        if !self.gate.is_enabled() {
            return self.manager.resume(id, restart);
        }
        let Some(content) = self.manager.requeue_content(id)? else {
            // 대기·받는 중·지우는 중은 아무것도 하지 않고, 완료는 invalidInput(매니저 규칙). 판정이 필요 없다
            return self.manager.resume_checked(id, restart, |_| {
                // 위에서 본 뒤 상태가 바뀌어 다시 줄 세울 상태가 됐다: 판정 없이 줄 세우지 않는다
                Err(AppError::ownership_unknown())
            });
        };
        let owner = self.admit_job(id, &content).await?;
        self.manager
            .resume_checked(id, restart, same_content(content, owner))
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

    /// 상태가 바뀔 때마다(처음 포함) 앱이 부른다. 채널 ID가 있는 처음 SignedIn에서 미뤄 둔 자동 이어받기를 한 번 하고,
    /// 그 채널의 interrupted만 줄 세운다(83). 관리자는 모두 줄 세운다(102). 줄 세운 수.
    /// 맡은 채널 작업(둘째 깃발)은 여기서 하지 않는다: `take_delegated_resume` → `resume_delegated_interrupted`(79 (아))
    pub fn on_auth_status(&self, st: &AuthStatus) -> usize {
        if st.phase != AuthPhase::SignedIn {
            return 0;
        }
        // 채널을 모르면 깃발을 쓰지 않는다(다음 채널 있는 SignedIn에서 한다)
        let Some(me) = st.channel_id.as_deref() else {
            return 0;
        };
        if !self.auto_resume_pending.swap(false, Ordering::SeqCst) {
            return 0;
        }
        // 관리자는 채널과 상관없이 받으므로 멈춘 작업을 모두 이어받는다(worker.md 구현 중 변경 102)
        let admin = st.is_admin;
        let n = self
            .manager
            .resume_interrupted_where(|_, c| admin || is_own_channel(c, me) == Some(true));
        tracing::info!(
            count = n,
            admin,
            "로그인 뒤 같은 채널의 멈춘 작업을 자동으로 이어받는다"
        );
        n
    }

    /// 맡은 채널 자동 이어받기 깃발(둘째)을 쓸 때인가: 채널 있는 SignedIn이고 이번 실행에서 서버가 맡은 채널을 확인했다.
    /// true면 한 번뿐이고, 호출자가 `resume_delegated_interrupted`를 띄운다
    pub fn take_delegated_resume(&self, st: &AuthStatus) -> bool {
        st.phase == AuthPhase::SignedIn
            && st.channel_id.is_some()
            && st.delegations_verified
            && self
                .auto_resume_delegated_pending
                .swap(false, Ordering::SeqCst)
    }

    /// 맡은 채널의 멈춘 작업을 자동으로 이어받는다(둘째 깃발, PR 리뷰 P2). 기록의 `channelId`는 후보를 고르는 데만 쓰고,
    /// 작업마다 `resume_job`과 같은 `OwnershipGate::admit_checked`로 **컨텐츠**를 다시 판정한 뒤에만 줄 세운다
    /// (최근 resolve 캐시, 없으면 info 한 번. 판정 직전 확인은 간격 규칙이라 묶음 전체에서 /api/me 한 번 이하).
    /// 판정 실패·조회 실패는 줄 세우지 않는다(fail closed). 남의 영상이면 기록을 실제 채널로 고친다. 영상이 완료되고
    /// 채팅만 끊긴 작업도 같은 판정(`fetch_chat`)으로 채팅을 줄 세운다. 줄 세운 수(영상 + 채팅)
    ///
    /// 후보 목록은 판정(네트워크) 전에 찍은 것이다. 그 사이 사용자가 후보를 이어받고 일시정지했거나 채팅 의도를 바꿨을 수 있어,
    /// 줄 세우기는 일반 자동 이어받기처럼 매니저 잠금 하나 안에서 "아직 같은 의도의 `interrupted` 후보인가"를 다시 보고 한다
    /// (`resume_interrupted_checked`·`start_interrupted_chat`, app.md 구현 중 변경 87). 아니면 건너뛰고 세지 않는다.
    pub async fn resume_delegated_interrupted(&self, delegated: &[DelegatedChannel]) -> usize {
        let ids = self
            .manager
            .interrupted_where(|content, c| delegated_resume_target(content, c, delegated));
        let mut n = 0;
        for id in ids {
            match self.resume_delegated_job(id).await {
                Ok(true) => n += 1,
                Ok(false) => tracing::info!(
                    id = id.0,
                    "맡은 채널 작업이 판정 중에 바뀌어 자동으로 이어받지 않음"
                ),
                Err(e) => tracing::info!(
                    id = id.0,
                    code = ?e.code,
                    "맡은 채널 작업을 자동으로 이어받지 않음(컨텐츠 재판정)"
                ),
            }
        }
        // 영상은 완료, 채팅만 끊긴 작업: `fetch_chat`과 같은 판정(컨텐츠 재판정 → 잠금 안 재확인) 뒤에만 줄 세운다.
        // 그 채팅의 덮어쓰기 선택과 "처음부터" 의도를 그대로 넘긴다(app.md 구현 중 변경 86-4)
        let chats = self
            .manager
            .interrupted_chats_where(|content, c| delegated_resume_target(content, c, delegated));
        for (id, on_existing, restart) in chats {
            match self.resume_delegated_chat(id, restart, on_existing).await {
                Ok(true) => n += 1,
                Ok(false) => tracing::info!(
                    id = id.0,
                    "맡은 채널 작업의 채팅이 판정 중에 바뀌어 자동으로 이어받지 않음"
                ),
                Err(e) => tracing::info!(
                    id = id.0,
                    code = ?e.code,
                    "맡은 채널 작업의 채팅을 자동으로 이어받지 않음(컨텐츠 재판정)"
                ),
            }
        }
        tracing::info!(
            count = n,
            "로그인 뒤 맡은 채널의 멈춘 작업을 자동으로 이어받는다"
        );
        n
    }

    /// 맡은 채널 영상 하나: `resume_job`과 같은 판정 뒤, 잠금 안에서 아직 `interrupted` 후보일 때만 줄 세운다
    async fn resume_delegated_job(&self, id: JobId) -> Result<bool, AppError> {
        let Some(content) = self.manager.requeue_content(id)? else {
            return Ok(false);
        };
        let owner = self.admit_job(id, &content).await?;
        self.manager
            .resume_interrupted_checked(id, same_content(content, owner))
    }

    /// 맡은 채널 채팅 하나: `fetch_chat`과 같은 판정 뒤, 잠금 안에서 아직 같은 의도의 `interrupted` 채팅일 때만 줄 세운다
    async fn resume_delegated_chat(
        &self,
        id: JobId,
        restart: bool,
        on_existing: OnExisting,
    ) -> Result<bool, AppError> {
        let setting = self.settings.job_defaults().chat_subtitle;
        let Some(content) = self.manager.chat_content(id)? else {
            return Ok(false);
        };
        let owner = self.admit_job(id, &content).await?;
        self.manager.start_interrupted_chat(
            id,
            restart,
            on_existing,
            setting,
            same_content(content, owner),
        )
    }

    /// `auth_login`(D13): Started일 때만 수령 대기 태스크를 먼저 띄운 뒤 `open(로그인 주소)`을 부른다
    pub async fn auth_login(&self, open: impl FnOnce(&str) -> bool + Send) -> AuthStatusDto {
        let Some(auth) = self.auth.clone() else {
            return AuthStatusDto::disabled();
        };
        if let BeginLogin::Started(ticket) = auth.begin_login().await {
            let a = auth.clone();
            self.runtime.spawn(async move {
                a.run_login_wait().await;
            });
            if !open(ticket.login_url.expose()) {
                tracing::warn!(result = "open_failed", "로그인 주소를 브라우저로 열지 못함");
            }
        }
        AuthStatusDto::from_status(&auth.status())
    }

    /// 명령줄 `login`(cli-mode.md §5.3): `auth_login`과 같은 시작·수신기를 쓰되 끝날 때까지 기다려 끝 상태를 돌려준다.
    ///
    /// 순서는 `auth_login`과 같다: Started면 수령 대기를 **먼저** 띄운 뒤 `open(로그인 주소)`을 부른다(브라우저가 곧바로
    /// 돌아와도 놓치지 않게). 주소는 `open`에만 넘기고 어디에도 기록하지 않는다. 열지 못하면 로그인을 그만두고
    /// `OpenFailed`다. 이 함수는 GUI 쪽 부작용(자동 이어받기·업데이트 확인)을 일으키지 않는다(그것들은 앱 crate의
    /// `spawn_auth_tasks`에 있다). 호출자가 이 future를 버리면(Ctrl+C) `auth_cancel`로 수신기를 닫는다.
    pub async fn auth_login_wait(&self, open: impl FnOnce(&str) -> bool + Send) -> LoginWait {
        let Some(auth) = self.auth.clone() else {
            return LoginWait::Disabled;
        };
        let ticket = match auth.begin_login().await {
            BeginLogin::Started(t) | BeginLogin::AlreadyPending(t) => t,
            BeginLogin::AlreadySignedIn | BeginLogin::Failed | BeginLogin::Discarded => {
                return LoginWait::Done(AuthStatusDto::from_status(&auth.status()));
            }
        };
        let waiter = {
            let a = auth.clone();
            self.runtime.spawn(async move { a.run_login_wait().await })
        };
        if !open(ticket.login_url.expose()) {
            tracing::warn!(result = "open_failed", "로그인 주소를 브라우저로 열지 못함");
            auth.cancel_login();
            waiter.abort();
            return LoginWait::OpenFailed;
        }
        match waiter.await {
            Ok(st) => LoginWait::Done(AuthStatusDto::from_status(&st)),
            // 대기 태스크가 패닉했다: 현재 상태를 돌려준다(취소로 닫힌 경우도 같다)
            Err(_) => LoginWait::Done(AuthStatusDto::from_status(&auth.status())),
        }
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

    /// 명령줄이 주소마다 부르는 세션 확인: GUI driver의 타이머와 같은 판정(`AuthService::tick(Timer)`)이다. 온라인이면 갱신
    /// 예정이 지났을 때만, 오프라인이면 재시도 시각이나 유예(72시간) 끝이 지났을 때만 refresh한다. 긴 배치가 유예를 넘기면
    /// 여기서 만료로 바뀌어 다음 주소의 게이트가 막는다(cli-mode.md §5.2)
    pub async fn auth_tick(&self) -> AuthStatusDto {
        match self.auth.clone() {
            None => AuthStatusDto::disabled(),
            Some(a) => AuthStatusDto::from_status(&a.tick(Trigger::Timer).await),
        }
    }

    /// refresh(토큰 회전)가 진행 중인가(명령줄 Ctrl+C가 결과 저장을 기다린다)
    pub fn auth_refreshing(&self) -> bool {
        self.auth.as_ref().is_some_and(|a| a.refreshing())
    }

    /// 진행 중인 refresh가 결과를 저장할 때까지 기다린다(없으면 바로)
    pub async fn auth_refresh_settled(&self) {
        if let Some(a) = &self.auth {
            a.refresh_settled().await;
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
    /// 편집자 API를 쓸 수 있는 서비스. 로그인을 쓰지 않는 빌드는 invalidInput
    fn editors_auth(&self) -> Result<&Arc<AppAuth>, AppError> {
        self.auth
            .as_ref()
            .ok_or_else(|| AppError::invalid_input("로그인 서버가 없는 빌드입니다"))
    }

    fn editors_app_error(e: EditorsError) -> AppError {
        match e {
            EditorsError::NotSignedIn | EditorsError::Blocked => AppError::not_logged_in(),
            EditorsError::Discarded => AppError::internal("로그인 계정이 바뀌어 결과를 버렸습니다"),
            EditorsError::Unreachable => AppError::worker_unreachable(),
            EditorsError::NotEnabled => AppError::delegation_not_enabled(),
            EditorsError::Limit => AppError::invalid_input("편집자는 더 맡길 수 없습니다"),
            EditorsError::Rejected => AppError::internal("로그인 서버가 요청을 받지 않았습니다"),
        }
    }

    /// 간격 없는 `/api/me` 확인. 계속 진행해도 되는 결과면 `Some(Fresh일 때의 응답)`, 그 밖은 오류
    async fn forced_check(
        &self,
        auth: &AppAuth,
    ) -> Result<Option<Arc<crate::auth::MeResponse>>, AppError> {
        match auth.check_delegations(true).await {
            DelegationCheck::Fresh(m) => Ok(Some(m)),
            // 지금 주체로 다시 판정하면 된다
            DelegationCheck::Discarded | DelegationCheck::Skipped => Ok(None),
            DelegationCheck::NotSignedIn | DelegationCheck::Blocked => {
                Err(AppError::not_logged_in())
            }
            DelegationCheck::Unreachable => Err(AppError::worker_unreachable()),
        }
    }

    /// `editors_list`: 설정 › 계정 그룹이 열릴 때(간격 없는 /api/me)
    pub async fn editors_list(&self) -> Result<EditorsDto, AppError> {
        let auth = self.editors_auth()?;
        match auth.check_delegations(true).await {
            DelegationCheck::Fresh(m) => Ok(EditorsDto::from(&*m)),
            DelegationCheck::NotSignedIn | DelegationCheck::Blocked => {
                Err(AppError::not_logged_in())
            }
            DelegationCheck::Unreachable => Err(AppError::worker_unreachable()),
            DelegationCheck::Discarded => {
                Err(AppError::internal("로그인 계정이 바뀌어 결과를 버렸습니다"))
            }
            DelegationCheck::Skipped => Err(AppError::internal("있어서는 안 되는 상태")),
        }
    }

    /// `editors_invite`: [초대 주소 만들기]
    pub async fn editors_invite(&self) -> Result<InviteDto, AppError> {
        let auth = self.editors_auth()?;
        auth.create_invite()
            .await
            .map(|r| InviteDto::from(&r))
            .map_err(Self::editors_app_error)
    }

    /// `editors_remove`: [편집자 빼기] 토스트가 닫힌 뒤(편집자의 로그인 채널 ID)
    pub async fn editors_remove(&self, channel_id: &str) -> Result<(), AppError> {
        let auth = self.editors_auth()?;
        if !token::is_channel_id(channel_id) {
            return Err(AppError::invalid_input("채널 ID 형식이 아닙니다"));
        }
        auth.remove_editor(channel_id)
            .await
            .map_err(Self::editors_app_error)
    }

    /// `delegations_leave`: [편집자 그만두기](주인의 판정용 채널 ID)
    pub async fn delegations_leave(&self, channel_id: &str) -> Result<(), AppError> {
        let auth = self.editors_auth()?;
        if !token::is_channel_id(channel_id) {
            return Err(AppError::invalid_input("채널 ID 형식이 아닙니다"));
        }
        auth.leave_delegation(channel_id)
            .await
            .map_err(Self::editors_app_error)
    }

    /// `ownership_recheck`: 막힌 카드의 [다시 불러오기](간격 없는 /api/me 뒤 같은 주소를 다시 resolve).
    /// 서버에 닿지 못하면 resolve하지 않는다
    pub async fn ownership_recheck(&self, url: &str) -> Result<ResolvedDto, AppError> {
        if let Some(auth) = &self.auth {
            self.forced_check(auth).await?;
        }
        // 이 안의 자동 확인은 방금 찍힌 last_me_try_at 때문에 간격 규칙으로 건너뛴다
        self.resolve(url).await
    }
}

/// 자동 이어받기 둘째 깃발(맡은 채널)의 대상인가. 생방송은 v1에서 맡은 채널로 받지 않는다(L-D1 (A))
pub fn delegated_resume_target(
    content: &ContentRef,
    channel: Option<&str>,
    delegated: &[DelegatedChannel],
) -> bool {
    !matches!(content, ContentRef::Live { .. })
        && channel.is_some_and(|c| {
            delegated
                .iter()
                .any(|d| d.channel_id.eq_ignore_ascii_case(c))
        })
}

impl App {
    /// `update_check`. 로그인을 쓰지 않는 빌드(auth·주소 없음)는 Failed(플러그인에 닿지 않는다)
    pub async fn update_check<S: UpdateSource>(&self, src: &S) -> UpdateCheckDto {
        let (Some(auth), Some(base)) = (&self.auth, &self.worker_base) else {
            return UpdateCheckDto::Failed;
        };
        self.updates.check(&**auth, base, src).await
    }

    /// `update_install`. 로그인을 쓰지 않는 빌드는 Failed
    pub async fn update_install<S: UpdateSource, H: InstallHost>(
        &self,
        src: &S,
        host: &H,
        confirm_pause: bool,
    ) -> UpdateInstallDto {
        let (Some(auth), Some(base)) = (&self.auth, &self.worker_base) else {
            return UpdateInstallDto::Failed;
        };
        self.updates
            .install(&**auth, base, src, host, confirm_pause)
            .await
    }

    /// `update_available`: 자동 확인이 찾아 둔 값(네트워크 없음)
    pub fn update_available(&self) -> Option<UpdateInfoDto> {
        self.updates.available()
    }

    /// 자동 확인을 할 차례인가(D8): 온라인 SignedIn이고 `take_first_online()`. 앞이 아니면 take를 부르지 않는다
    pub fn take_auto_update_check(&self, st: &AuthStatus) -> bool {
        auto_check_due(st) && self.auth.as_ref().is_some_and(|a| a.take_first_online())
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

/// 잠금 안 재확인: 판정한 컨텐츠와 같을 때만 검증한 채널 ID로 고쳐 쓰게 한다(`resume_checked`·`start_chat`의 `check`)
fn same_content(
    content: ContentRef,
    owner: Option<String>,
) -> impl FnOnce(&ContentRef) -> Result<Option<Option<String>>, AppError> {
    move |c| {
        if *c == content {
            Ok(Some(owner))
        } else {
            Err(AppError::ownership_unknown())
        }
    }
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
