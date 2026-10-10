//! 앱 경로와 설정 서비스(docs/design/app.md §3 "쿠키 토글은 클라이언트 교체", §7.2).
//!
//! - **`AppPaths`**: Tauri가 준 폴더로 만든다. 기본 저장 폴더는 `비디오/치지직` → `다운로드/치지직` →
//!   `홈/치지직` → `{data}/downloads` 순서다(§16, platform §16.1). Tauri에 의존하지 않도록 OS 폴더는 인자로 받는다.
//! - **`SettingsService`**: `SettingsStore`(settings.json)·`CredentialStore`(credentials.json)·코어 클라이언트를
//!   한곳에서 관리한다. 코어 `Chzzk`는 만들 때 쿠키를 굳히므로, 쿠키 사용 여부·쿠키 값이 바뀌면 **새 클라이언트를
//!   먼저 만들고 → 저장하고 → 바꿔 끼운다**. 만들기에 실패하면(헤더로 보낼 수 없는 쿠키) 아무것도 저장하지 않고,
//!   저장에 실패하면 바꿔 끼우지 않는다. 실행 중인 작업은 시작할 때 받은 `Arc`를 끝까지 쓴다.
//!   쿠키에 닿는 변경은 `ops` 잠금 하나로 줄 세워 파일과 클라이언트가 어긋나지 않게 한다.
//! - **첫 실행 가져오기**: `settings.json`이 없던 첫 실행에만 옛(Go) 설정 폴더를 찾아 **적용하지 않고**
//!   후보로 둔다(D3). 후보를 찾으면 바로 `settings.json`을 만들어 다음 실행에는 다시 묻지 않는다.
//! - 쿠키 값은 `SettingsDto`·오류 메시지·로그 어디에도 넣지 않는다(`tests/secrets.rs`).

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock};
use std::time::Duration;

use chzzk_core::download::MAX_CONCURRENCY;
use chzzk_core::settings::{MAX_RECENT_VODS, SETTINGS_FILE};
use chzzk_core::{
    Chzzk, ClientConfig, ContentRef, CredentialStore, NaverCookies, PlaybackKind, RecentKind,
    SettingsStore, TextScale, Theme, UserSettings, add_recent_vod_with, parse_content_url,
};

use crate::backend::Backend;
use crate::dto::{
    EnqueueRequest, JobDto, LegacyCandidate, LegacyImportDto, Nullable, RecentVodDto, ResolvedDto,
    SettingsDto, SettingsPatch,
};
use crate::error::AppError;
use crate::manager::{ClientFn, DownloadManager, JobDefaults, MAX_PARALLEL, MIN_PARALLEL};
use crate::ownership::OwnershipGate;
use crate::volume;

/// 기본 저장 폴더 이름(비디오·다운로드 폴더 아래).
pub const DEFAULT_FOLDER_NAME: &str = "치지직";

/// 앱의 진행률 콜백 간격(§3).
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// 앱 폴더.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppPaths {
    /// 설정(`settings.json`·`credentials.json`)
    pub config: PathBuf,
    /// 데이터(`jobs.json`)
    pub data: PathBuf,
    /// 로그
    pub log: PathBuf,
    /// 설정에 폴더가 없을 때 쓰는 저장 폴더
    pub default_download: PathBuf,
}

impl AppPaths {
    /// `video`·`downloads`·`home`은 OS 비디오·다운로드·홈 폴더(Tauri `video_dir()`·`download_dir()`·`home_dir()`,
    /// 없으면 `None`).
    pub fn new(
        config: PathBuf,
        data: PathBuf,
        log: PathBuf,
        video: Option<PathBuf>,
        downloads: Option<PathBuf>,
        home: Option<PathBuf>,
    ) -> Self {
        let default_download = default_download_folder(
            video.as_deref(),
            downloads.as_deref(),
            home.as_deref(),
            &data,
        );
        AppPaths {
            config,
            data,
            log,
            default_download,
        }
    }
}

/// 기본 저장 폴더: `video/치지직` → `downloads/치지직` → `home/치지직` → `{data}/downloads`.
///
/// 마지막 `{data}/downloads`는 홈 폴더조차 없을 때만 닿는 자리다(실제로는 거의 닿지 않는다). 사용자가 자기 파일을
/// 찾을 수 없는 앱 데이터 폴더 안이라 홈을 앞에 둔다(platform §16.1, X8).
///
/// OS 폴더는 절대 경로이고, UTF-8이며, 실제로 있는 폴더일 때만 쓴다. UTF-8이 아닌 폴더는 작업 목록에 저장할
/// 수 없어 매니저가 거부하므로(구현 중 변경 33) 처음부터 고르지 않는다. `치지직` 폴더는 첫 다운로드 때 코어가 만든다.
pub fn default_download_folder(
    video: Option<&Path>,
    downloads: Option<&Path>,
    home: Option<&Path>,
    data: &Path,
) -> PathBuf {
    [video, downloads, home]
        .into_iter()
        .flatten()
        .find(|d| d.is_absolute() && d.to_str().is_some() && d.is_dir())
        .map(|d| d.join(DEFAULT_FOLDER_NAME))
        .unwrap_or_else(|| data.join("downloads"))
}

/// 첫 실행에 찾은 옛 설정 폴더.
#[derive(Clone, Debug)]
struct Candidate {
    dir: PathBuf,
    dto: LegacyCandidate,
}

/// 설정·자격증명·코어 클라이언트.
pub struct SettingsService {
    store: SettingsStore,
    creds: CredentialStore,
    /// 쿠키를 뺀 클라이언트 설정. 클라이언트를 새로 만들 때 쿠키만 바꿔 쓴다.
    base: ClientConfig,
    client: Arc<RwLock<Arc<Chzzk>>>,
    default_download: PathBuf,
    legacy: Mutex<Option<Candidate>>,
    /// 쿠키에 닿는 변경(사용 여부·저장·삭제·가져오기)을 줄 세운다
    ops: Mutex<()>,
}

impl fmt::Debug for SettingsService {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SettingsService")
            .field("config_dir", &self.store.dir())
            .field("default_download", &self.default_download)
            .finish_non_exhaustive()
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

impl SettingsService {
    /// 설정 폴더를 열고 클라이언트를 만든다.
    ///
    /// - `base`: 쿠키를 뺀 클라이언트 설정(앱은 `ClientConfig { progress_interval: PROGRESS_INTERVAL, .. }`,
    ///   테스트는 mock 서버 주소). `base.cookies`는 무시한다.
    /// - `legacy_dir`: 첫 실행 가져오기 후보를 찾을 폴더(앱은 `current_exe()`의 부모).
    /// - `credentials.json`이 깨졌거나 저장된 쿠키를 헤더로 보낼 수 없으면 쿠키 없이 시작한다(로그만).
    /// - 매니저는 이것을 연 뒤에 연다(동시 작업 수·자동 이어받기를 여기서 읽는다).
    pub fn open(
        paths: &AppPaths,
        base: ClientConfig,
        legacy_dir: Option<&Path>,
    ) -> Result<Self, AppError> {
        // 읽을 수 없으면 있는 것으로 본다(첫 실행이 아닐 수 있는데 옛 쿠키를 묻지 않게).
        let existed = paths
            .config
            .join(SETTINGS_FILE)
            .try_exists()
            .unwrap_or(true);
        let store = SettingsStore::open(paths.config.clone())?;
        let creds = CredentialStore::new(paths.config.clone());
        let base = ClientConfig {
            cookies: None,
            ..base
        };
        let settings = store.get();
        let cookies = if settings.use_naver_cookies {
            load_cookies(&creds)
        } else {
            None
        };
        let client = build_or_without_cookies(&base, cookies)?;

        let candidate = if !existed && settings.imported_from.is_none() {
            legacy_dir.and_then(find_candidate)
        } else {
            None
        };
        if candidate.is_some() {
            // 후보를 보여 준 뒤에는 다시 묻지 않는다. 사용자가 D3를 닫고 아무것도 바꾸지 않아도
            // 다음 실행이 첫 실행으로 보이지 않도록 지금 파일을 만든다.
            if let Err(e) = store.update(|_| {}) {
                tracing::warn!(error = %e, "첫 실행 설정 파일을 만들지 못함");
            }
        }

        Ok(SettingsService {
            store,
            creds,
            base,
            client: Arc::new(RwLock::new(Arc::new(client))),
            default_download: paths.default_download.clone(),
            legacy: Mutex::new(candidate),
            ops: Mutex::new(()),
        })
    }

    /// 지금 설정(코어 값).
    pub fn settings(&self) -> UserSettings {
        self.store.get()
    }

    /// `get_settings`.
    pub fn get(&self) -> SettingsDto {
        self.dto(&self.store.get())
    }

    /// 지금 클라이언트. 작업은 시작할 때 한 번 받아 끝까지 쓴다.
    pub fn client(&self) -> Arc<Chzzk> {
        Arc::clone(&self.client.read().unwrap_or_else(PoisonError::into_inner))
    }

    /// 매니저에 넘길 클라이언트 함수. 부를 때마다 그 시점의 클라이언트를 준다.
    pub fn client_fn(&self) -> ClientFn<Chzzk> {
        let c = Arc::clone(&self.client);
        Arc::new(move || Arc::clone(&c.read().unwrap_or_else(PoisonError::into_inner)))
    }

    /// 기본 저장 폴더(설정과 무관한 OS 기본값).
    pub fn default_download_folder(&self) -> &Path {
        &self.default_download
    }

    /// 실제로 쓰는 저장 폴더: 설정 폴더, 없으면 기본 폴더.
    pub fn effective_download_folder(&self) -> PathBuf {
        effective_folder(&self.store.get(), &self.default_download)
    }

    /// 작업을 추가할 때 설정에서 오는 값.
    pub fn job_defaults(&self) -> JobDefaults {
        let s = self.store.get();
        JobDefaults {
            download_folder: effective_folder(&s, &self.default_download),
            segment_concurrency: s.segment_concurrency,
        }
    }

    /// 첫 실행에 찾은 옛 설정(적용 전). 가져오기를 적용하면 사라진다.
    pub fn legacy_candidate(&self) -> Option<LegacyCandidate> {
        lock(&self.legacy).as_ref().map(|c| c.dto.clone())
    }

    /// `update_settings`. 없는 키는 그대로 둔다.
    ///
    /// - `downloadFolder`: `null`은 기본 폴더로, 문자열은 앞뒤 공백을 지운 절대 경로여야 한다(아니면 `invalidInput`).
    /// - `useNaverCookies: true`는 저장된 쿠키가 있어야 한다(아니면 `invalidInput`). 바뀌면 클라이언트를 바꾼다.
    /// - `segmentConcurrency`는 1~8, `maxParallelDownloads`는 1~3으로 자른다.
    ///
    /// 동시 작업 수를 매니저에 반영하려면 `update_and_apply`를 쓴다.
    pub fn update(&self, patch: SettingsPatch) -> Result<SettingsDto, AppError> {
        let ops = lock(&self.ops);
        self.update_locked(&ops, patch)
    }

    /// `ops` 잠금을 쥔 채 부른다.
    fn update_locked(
        &self,
        _ops: &MutexGuard<'_, ()>,
        patch: SettingsPatch,
    ) -> Result<SettingsDto, AppError> {
        let folder = match patch.download_folder {
            Nullable::Keep => None,
            Nullable::Clear => Some(None),
            Nullable::Set(s) => Some(Some(absolute_dir(&s, "저장 폴더")?)),
        };
        let current = self.store.get();
        // 실제로 쿠키를 보내는지와 비교한다. 설정은 켜짐인데 저장 쿠키를 못 읽어 쿠키 없이 시작했으면
        // `true` 패치가 쿠키를 다시 읽어 바꿔 끼운다(조용한 무시가 되지 않게).
        let sending = current.use_naver_cookies && self.sending_cookies();
        let new_client = match patch.use_naver_cookies {
            Some(on) if on != sending => {
                let cookies = if on {
                    match self.creds.load()? {
                        Some(c) => Some(c),
                        None => {
                            return Err(AppError::invalid_input(
                                "저장된 네이버 로그인 정보가 없어 켤 수 없습니다",
                            ));
                        }
                    }
                } else {
                    None
                };
                Some(self.build(cookies)?)
            }
            _ => None,
        };
        let s = self.store.update(|s| {
            if let Some(f) = folder {
                s.download_folder = f;
            }
            if let Some(on) = patch.use_naver_cookies {
                s.use_naver_cookies = on;
            }
            if let Some(n) = patch.segment_concurrency {
                s.segment_concurrency = n.clamp(1, MAX_CONCURRENCY);
            }
            if let Some(n) = patch.max_parallel_downloads {
                s.max_parallel_downloads = n.clamp(MIN_PARALLEL, MAX_PARALLEL);
            }
            if let Some(on) = patch.auto_resume_interrupted {
                s.auto_resume_interrupted = on;
            }
            if let Some(t) = patch.text_scale {
                s.text_scale = t;
            }
            if let Some(t) = patch.theme {
                s.theme = t;
            }
            if let Some(on) = patch.keep_awake {
                s.keep_awake = on;
            }
        })?;
        if let Some(c) = new_client {
            self.swap(c);
        }
        Ok(self.dto(&s))
    }

    /// `update`한 뒤 동시 작업 수를 매니저에 반영한다(늘리면 바로 대기 작업이 시작된다).
    ///
    /// 저장과 반영을 `ops` 잠금 하나 안에서 해, 동시에 온 패치가 저장 순서와 다른 순서로 매니저에
    /// 반영되지 않게 한다(매니저 값 = 마지막으로 저장된 값).
    pub fn update_and_apply<B: Backend>(
        &self,
        patch: SettingsPatch,
        manager: &DownloadManager<B>,
    ) -> Result<SettingsDto, AppError> {
        let ops = lock(&self.ops);
        let dto = self.update_locked(&ops, patch)?;
        manager.set_max_parallel(dto.max_parallel_downloads);
        Ok(dto)
    }

    /// `set_naver_cookies`. 앞뒤 공백을 지우고 둘 다 있어야 한다. 사용 여부는 바꾸지 않으며,
    /// 켜져 있으면 새 쿠키로 클라이언트를 바꾼다.
    pub fn set_naver_cookies(&self, nid_aut: &str, nid_ses: &str) -> Result<SettingsDto, AppError> {
        let (aut, ses) = (nid_aut.trim(), nid_ses.trim());
        if aut.is_empty() || ses.is_empty() {
            return Err(AppError::invalid_input(
                "NID_AUT와 NID_SES를 모두 입력해 주세요",
            ));
        }
        let cookies = NaverCookies::new(aut, ses);
        let _ops = lock(&self.ops);
        // 저장하기 전에 헤더로 보낼 수 있는지 본다. 값은 메시지에 넣지 않는다.
        let with_cookies = match self.try_build(Some(cookies.clone()))? {
            Ok(c) => c,
            Err(()) => {
                return Err(AppError::invalid_input(
                    "쿠키 값에 쓸 수 없는 문자가 있습니다. 다시 복사해 주세요",
                ));
            }
        };
        self.creds.save(&cookies)?;
        let s = self.store.get();
        if s.use_naver_cookies {
            self.swap(with_cookies);
        }
        Ok(self.dto(&s))
    }

    /// `clear_naver_cookies`. 쿠키 파일을 지우고 사용을 끈 뒤 쿠키 없는 클라이언트로 바꾼다.
    pub fn clear_naver_cookies(&self) -> Result<SettingsDto, AppError> {
        let _ops = lock(&self.ops);
        let plain = self.build(None)?;
        self.creds.clear()?;
        // 쿠키 파일이 사라졌으므로 설정 저장이 실패해도 쿠키 없는 클라이언트가 맞다.
        self.swap(plain);
        let s = self.store.update(|s| s.use_naver_cookies = false)?;
        Ok(self.dto(&s))
    }

    /// `import_legacy`. `dir`이 `None`이면 첫 실행 후보 폴더(없으면 `Ok(None)`).
    ///
    /// 옛 값이 있는 항목(폴더·마지막 화질·마지막 주소)만 덮고, 최근 VOD는 지금 목록 뒤에 옛 목록을 붙여
    /// 5개로 자른다. 동시 작업 수 같은 새 설정은 그대로 둔다. 옛 쿠키는 **저장된 쿠키가 없을 때만** 저장하고
    /// 그때만 옛 "성인 컨텐츠" 값으로 사용 여부를 정한다(이미 있으면 지금 쿠키·사용 여부를 지키고 경고).
    /// 헤더로 보낼 수 없는 옛 쿠키는 건너뛰고 경고를 남긴다. 설정 저장이 실패하면 방금 저장한 옛 쿠키를 지운다.
    pub fn import_legacy(&self, dir: Option<&str>) -> Result<Option<LegacyImportDto>, AppError> {
        let _ops = lock(&self.ops);
        let dir = match dir {
            Some(d) => absolute_dir(d, "가져올 폴더")?,
            None => match lock(&self.legacy).as_ref() {
                Some(c) => c.dir.clone(),
                None => return Ok(None),
            },
        };
        let Some(li) = chzzk_core::import_legacy(&dir)? else {
            return Ok(None);
        };
        let mut warnings = li.warnings.clone();
        let cookies = match li.cookies {
            // 깨진 credentials.json은 쓸 수 없으므로 없는 것으로 본다.
            Some(_) if matches!(self.creds.load(), Ok(Some(_))) => {
                warnings.push(
                    "이미 저장된 네이버 로그인 정보가 있어 옛 쿠키는 가져오지 않았습니다"
                        .to_string(),
                );
                None
            }
            Some(c) => match self.try_build(Some(c.clone()))? {
                Ok(_) => Some(c),
                Err(()) => {
                    warnings.push("옛 쿠키 값에 쓸 수 없는 문자가 있어 건너뛰었습니다".to_string());
                    None
                }
            },
            None => None,
        };
        if let Some(c) = &cookies {
            self.creds.save(c)?;
        }
        let old = &li.settings;
        let has_cookies = cookies.is_some();
        let saved = self.store.update(|s| {
            if old.download_folder.is_some() {
                s.download_folder.clone_from(&old.download_folder);
            }
            if has_cookies {
                s.use_naver_cookies = old.use_naver_cookies;
            }
            if old.last_quality_label.is_some() {
                s.last_quality_label.clone_from(&old.last_quality_label);
            }
            if old.last_url.is_some() {
                s.last_url.clone_from(&old.last_url);
            }
            for v in &old.recent_vods {
                if !s.recent_vods.iter().any(|r| r.url == v.url) {
                    s.recent_vods.push(v.clone());
                }
            }
            s.recent_vods.truncate(MAX_RECENT_VODS);
            s.imported_from.clone_from(&old.imported_from);
        });
        let s = match saved {
            Ok(s) => s,
            Err(e) => {
                // 가져오기가 실패했으므로 방금 저장한 옛 쿠키를 되돌린다(전에는 저장된 쿠키가 없었다).
                if has_cookies && let Err(ce) = self.creds.clear() {
                    tracing::warn!(error = %ce, "가져오기 실패 뒤 옛 쿠키를 지우지 못함");
                }
                return Err(e.into());
            }
        };
        let saved = if s.use_naver_cookies {
            load_cookies(&self.creds)
        } else {
            None
        };
        self.swap(build_or_without_cookies(&self.base, saved)?);
        *lock(&self.legacy) = None;
        Ok(Some(LegacyImportDto {
            recent_count: u32::try_from(old.recent_vods.len()).unwrap_or(u32::MAX),
            has_cookies,
            warnings,
        }))
    }

    /// 작업을 추가한 뒤 마지막 화질·최근 VOD(`last_url` 포함)를 한 번에 저장한다(§6.2 6단계).
    pub fn record_enqueued(
        &self,
        url: &str,
        title: &str,
        quality_label: &str,
        kind: RecentKind,
        date: Option<&str>,
    ) -> Result<(), AppError> {
        self.store.update(|s| {
            if !quality_label.trim().is_empty() {
                s.last_quality_label = Some(quality_label.to_string());
            }
            add_recent_vod_with(s, url, title, Some(kind), date);
        })?;
        Ok(())
    }

    /// 저장된 글자 크기·모양(`app_info`가 로그인 전에도 싣는다)
    pub fn appearance(&self) -> (TextScale, Theme) {
        let s = self.store.get();
        (s.text_scale, s.theme)
    }

    /// `resolve`: 주소를 풀고 지금 클라이언트로 조회한다. 서명 URL은 DTO에 없다.
    pub async fn resolve(&self, url: &str, gate: &OwnershipGate) -> Result<ResolvedDto, AppError> {
        let url = url.trim();
        let content = parse_content_url(url)?;
        let client = self.client();
        let r = client.resolve(&content).await?;
        let last = self.store.get().last_quality_label;
        Ok(ResolvedDto::new(
            url.to_string(),
            &r,
            last.as_deref(),
            // 이름 규칙은 저장 폴더가 놓인 볼륨 기준이다(FAT·exFAT·NTFS·원격은 Windows 규칙, core.md 57).
            volume::platform_for_dir(&self.effective_download_folder()),
            gate.on_resolved(&r.content, &r.meta),
        ))
    }

    /// 컨텐츠의 채널 ID를 다시 resolve해 얻는다(`OwnershipGate::admit`의 캐시 미스).
    pub async fn content_channel(&self, content: &ContentRef) -> Result<Option<String>, AppError> {
        Ok(self.client().resolve(content).await?.meta.channel_id)
    }

    fn dto(&self, s: &UserSettings) -> SettingsDto {
        SettingsDto {
            download_folder: s.download_folder.as_deref().map(path_string),
            effective_download_folder: path_string(&effective_folder(s, &self.default_download)),
            // 실제로 쿠키를 보낼 때만 켜짐이다(저장 쿠키를 못 읽어 쿠키 없이 시작했으면 꺼짐으로 보인다).
            use_naver_cookies: s.use_naver_cookies && self.sending_cookies(),
            naver_cookies_saved: matches!(self.creds.load(), Ok(Some(_))),
            last_quality_label: s.last_quality_label.clone(),
            last_url: s.last_url.clone(),
            recent_vods: s.recent_vods.iter().map(RecentVodDto::from).collect(),
            segment_concurrency: s.segment_concurrency,
            max_parallel_downloads: s.max_parallel_downloads,
            auto_resume_interrupted: s.auto_resume_interrupted,
            imported_from: s.imported_from.as_deref().map(path_string),
            text_scale: s.text_scale,
            theme: s.theme,
            keep_awake: s.keep_awake,
        }
    }

    fn build(&self, cookies: Option<NaverCookies>) -> Result<Chzzk, AppError> {
        Ok(Chzzk::new(ClientConfig {
            cookies,
            ..self.base.clone()
        })?)
    }

    /// 쿠키로 클라이언트를 만든다. 쿠키를 헤더로 보낼 수 없으면 `Ok(Err(()))`, 다른 실패(HTTP 클라이언트
    /// 초기화·엔드포인트)는 그대로 `Err`. 코어는 `Chzzk::new`에서 `Error::Settings`를 쿠키 헤더 검사에서만 낸다.
    fn try_build(&self, cookies: Option<NaverCookies>) -> Result<Result<Chzzk, ()>, AppError> {
        match Chzzk::new(ClientConfig {
            cookies,
            ..self.base.clone()
        }) {
            Ok(c) => Ok(Ok(c)),
            Err(chzzk_core::Error::Settings(_)) => Ok(Err(())),
            Err(e) => Err(e.into()),
        }
    }

    /// 지금 클라이언트가 쿠키를 보내는지.
    fn sending_cookies(&self) -> bool {
        self.client().config().cookies.is_some()
    }

    fn swap(&self, c: Chzzk) {
        *self.client.write().unwrap_or_else(PoisonError::into_inner) = Arc::new(c);
    }
}

/// 작업 추가(§6.2): 주소·컨텐츠 일치 → 본인 영상 게이트(A5) → 매니저 → 설정의 마지막 화질·최근 VOD.
///
/// 설정 저장이 실패해도 작업은 이미 목록에 있으므로 로그만 남긴다.
pub async fn enqueue<B: Backend>(
    settings: &SettingsService,
    gate: &OwnershipGate,
    manager: &DownloadManager<B>,
    mut req: EnqueueRequest,
) -> Result<JobDto, AppError> {
    // 판정·다운로드는 content로, 최근 VOD는 url로 한다. 둘이 다른 영상이면 받지 않는다(네트워크 전, A5 리뷰)
    if !parse_content_url(&req.url).is_ok_and(|c| c == req.content) {
        return Err(AppError::invalid_input("요청 주소와 영상이 맞지 않습니다"));
    }
    // 웹뷰가 보낸 channel_id는 믿지 않는다: 검증한 컨텐츠 채널 ID로 덮어쓴다(82)
    let content = req.content.clone();
    if let Some(owner) = gate
        .admit(&content, || settings.content_channel(&content))
        .await?
    {
        req.channel_id = Some(owner);
    }
    let (url, title, label) = (
        req.url.clone(),
        req.title.clone(),
        req.quality_label.clone(),
    );
    let kind = recent_kind(&req.content, req.expected_kind);
    let date = req.content_date.clone();
    let job = manager.enqueue(req, &settings.job_defaults())?;
    if let Err(e) = settings.record_enqueued(&url, &title, &label, kind, date.as_deref()) {
        tracing::warn!(code = ?e.code, error = %e.message, "최근 VOD를 저장하지 못함");
    }
    Ok(job)
}

/// 최근 영상 배지 종류: 클립 / 빠른 다시보기(HLS) / 일반 VOD(프런트 `kindTone`과 같은 규칙)
pub fn recent_kind(content: &ContentRef, playback: PlaybackKind) -> RecentKind {
    match (content, playback) {
        (ContentRef::Clip { .. }, _) => RecentKind::Clip,
        (_, PlaybackKind::LiveRewindHls) => RecentKind::Rewind,
        (_, PlaybackKind::Progressive) => RecentKind::Vod,
    }
}

fn effective_folder(s: &UserSettings, default: &Path) -> PathBuf {
    s.download_folder
        .clone()
        .unwrap_or_else(|| default.to_path_buf())
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// 앞뒤 공백을 지운 절대 경로. 비었거나 상대 경로면 `invalidInput`.
fn absolute_dir(s: &str, what: &str) -> Result<PathBuf, AppError> {
    let t = s.trim();
    if t.is_empty() {
        return Err(AppError::invalid_input(format!("{what}가 비어 있습니다")));
    }
    let p = PathBuf::from(t);
    if !p.is_absolute() {
        return Err(AppError::invalid_input(format!(
            "{what}는 전체 경로여야 합니다: {t}"
        )));
    }
    crate::manager::check_folder_segments(t, what)?;
    Ok(p)
}

/// 저장된 쿠키. 파일이 깨졌으면 로그만 남기고 `None`.
fn load_cookies(creds: &CredentialStore) -> Option<NaverCookies> {
    match creds.load() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "저장된 네이버 로그인 정보를 읽지 못해 쿠키 없이 시작");
            None
        }
    }
}

/// 쿠키로 클라이언트를 만들고, 쿠키 때문에 실패하면 쿠키 없이 만든다.
fn build_or_without_cookies(
    base: &ClientConfig,
    cookies: Option<NaverCookies>,
) -> Result<Chzzk, AppError> {
    let had = cookies.is_some();
    match Chzzk::new(ClientConfig {
        cookies,
        ..base.clone()
    }) {
        Ok(c) => Ok(c),
        Err(e) if had => {
            tracing::warn!(error = %e, "저장된 쿠키로 클라이언트를 만들지 못해 쿠키 없이 시작");
            Ok(Chzzk::new(base.clone())?)
        }
        Err(e) => Err(e.into()),
    }
}

/// 첫 실행 가져오기 후보. 옛 파일이 없거나 읽지 못하면 `None`(로그만).
fn find_candidate(dir: &Path) -> Option<Candidate> {
    match chzzk_core::import_legacy(dir) {
        Ok(Some(li)) => Some(Candidate {
            dir: dir.to_path_buf(),
            dto: LegacyCandidate {
                dir: path_string(dir),
                recent_count: u32::try_from(li.settings.recent_vods.len()).unwrap_or(u32::MAX),
                has_cookies: li.cookies.is_some(),
            },
        }),
        Ok(None) => None,
        Err(e) => {
            tracing::warn!(error = %e, dir = %dir.display(), "옛 설정을 읽지 못해 가져오기 후보를 건너뜀");
            None
        }
    }
}
