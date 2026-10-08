//! 앱 업데이트 판단(worker.md §9.3·§11.6, Phase 3b A4). Tauri 비의존: 플러그인 호출은 `UpdateSource`,
//! 종료·재시작·이벤트는 `InstallHost`로 받는다(앱 `update_io.rs`). 토큰은 Bearer 값으로만 넘기고 로그에 내지 않는다.

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use chzzk_core::Secret;

use crate::auth::{AuthPhase, AuthService, AuthStatus, Clock, WorkerApi, WorkerBase};
use crate::dto::{UpdateCheckDto, UpdateInfoDto, UpdateInstallDto, UpdateProgressEvent};

/// 확인 요청 시간 제한(D10). 다운로드 전체에는 걸지 않는다(크기에 따라 길다)
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(10);
/// 다운로드 정체 한도: 시작이나 마지막 청크부터 이만큼 아무것도 오지 않으면 실패로 끝낸다(74).
/// 플러그인 2.13.1은 check가 만든 `Update`에 시간 제한을 넣지 않아, 멈춘 전송이 끝나지 않는다
pub const DOWNLOAD_STALL: Duration = Duration::from_secs(60);
/// 크기를 모를 때 진행 이벤트 간격(바이트)
pub const PROGRESS_STEP_UNKNOWN: u64 = 1024 * 1024;

/// `{base}/update/{{current_version}}`(자리표시는 플러그인이 채운다. 리터럴 중괄호 둘)
pub fn update_endpoint(base: &WorkerBase) -> String {
    format!("{}/update/{{{{current_version}}}}", base.origin())
}

/// `Authorization` 값("Bearer cda_…"). 비밀이다
pub fn bearer_value(access: &Secret<String>) -> Secret<String> {
    Secret::new(format!("Bearer {}", access.expose()))
}

/// 플러그인이 찾은 업데이트(비밀 없음. download_url은 Worker 출처라 Debug에서 뺀다)
#[derive(Clone, PartialEq, Eq)]
pub struct FoundUpdate {
    pub version: String,
    pub current: String,
    pub notes: Option<String>,
    /// 유닉스 초
    pub pub_date: Option<i64>,
    pub download_url: String,
}

impl fmt::Debug for FoundUpdate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FoundUpdate")
            .field("version", &self.version)
            .field("current", &self.current)
            .finish_non_exhaustive()
    }
}

/// 업데이트 원천 실패. 원문(URL이 든 reqwest 오류)은 담지 않는다
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SourceError {
    /// updater 플러그인이 없다(테스트 mock 등)
    Unavailable,
    /// 확인 실패(네트워크·2xx 아님·매니페스트)
    Check,
    /// 다운로드·서명 확인 실패
    Download,
    /// 설치 실패
    Install,
}

impl fmt::Display for SourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            SourceError::Unavailable => "업데이트 기능을 쓸 수 없음",
            SourceError::Check => "업데이트 확인 실패",
            SourceError::Download => "업데이트 다운로드 실패",
            SourceError::Install => "업데이트 설치 실패",
        })
    }
}

impl std::error::Error for SourceError {}

/// 플러그인 seam. 구현은 check에서 찾은 업데이트와 받은 바이트를 들고 있다가 download·install에 쓴다
pub trait UpdateSource: Send + Sync {
    fn check(
        &self,
        endpoint: &str,
        bearer: &Secret<String>,
    ) -> impl Future<Output = Result<Option<FoundUpdate>, SourceError>> + Send;
    /// 마지막 check가 찾은 것을 받고 서명을 확인한다. `on_chunk(len, total)`의 len은 이번 청크 길이
    fn download(
        &self,
        on_chunk: &mut (dyn FnMut(u64, Option<u64>) + Send),
    ) -> impl Future<Output = Result<(), SourceError>> + Send;
    /// 받은 것을 설치한다(Windows는 성공하면 돌아오지 않는다)
    fn install(&self) -> Result<(), SourceError>;
}

/// 설치를 둘러싼 앱 쪽 일
pub trait InstallHost: Send + Sync {
    /// 받는 중(running·pausing) 작업 수
    fn running(&self) -> usize;
    /// quit 경로(일시정지 → interrupted → flush). 이미 종료 중이면 false
    fn pause_for_install(&self) -> impl Future<Output = bool> + Send;
    /// 설치 실패: quit이 멈춘 작업을 되살리고 종료 가드를 푼다(D7)
    fn resume_after_failed_install(&self);
    /// 설치 성공(macOS·Linux): 다시 시작을 요청한다
    fn restart(&self);
    /// `update-progress`
    fn progress(&self, e: UpdateProgressEvent);
}

/// 진행 이벤트 솎기(D9)
#[derive(Debug, Default)]
pub struct ProgressThrottle {
    received: u64,
    started: bool,
    last_pct: Option<u64>,
    last_sent: u64,
}

impl ProgressThrottle {
    pub fn new() -> Self {
        Self::default()
    }

    /// 첫 호출은 `[Started{total}, Chunk{..}]`. 그 뒤 total이 있으면 floor(received*100/total)가 오를 때만,
    /// 없으면 received - last_sent >= `PROGRESS_STEP_UNKNOWN`일 때만 Chunk. total이 0이면 모름으로 본다
    pub fn on_chunk(&mut self, len: u64, total: Option<u64>) -> Vec<UpdateProgressEvent> {
        let total = total.filter(|t| *t > 0);
        self.received = self.received.saturating_add(len);
        let mut out = Vec::new();
        let first = !self.started;
        if first {
            self.started = true;
            out.push(UpdateProgressEvent::Started { total });
        }
        let send = match total {
            Some(t) => {
                let pct = (u128::from(self.received) * 100 / u128::from(t)).min(100) as u64;
                let up = first || Some(pct) > self.last_pct;
                if up {
                    self.last_pct = Some(pct);
                }
                up
            }
            None => {
                let up = first || self.received - self.last_sent >= PROGRESS_STEP_UNKNOWN;
                if up {
                    self.last_sent = self.received;
                }
                up
            }
        };
        if send {
            out.push(UpdateProgressEvent::Chunk {
                received: self.received,
                total,
            });
        }
        out
    }
}

/// FoundUpdate → DTO(download_url은 넘기지 않는다)
pub fn info_of(f: &FoundUpdate) -> UpdateInfoDto {
    UpdateInfoDto {
        version: f.version.clone(),
        current: f.current.clone(),
        notes: f.notes.clone(),
        pub_date: f.pub_date,
    }
}

/// 자동 확인을 할 차례인가의 앞 절반(D8): 온라인 `SignedIn`. 뒤 절반(`take_first_online`)은 `App`이 붙인다
pub fn auto_check_due(st: &AuthStatus) -> bool {
    st.phase == AuthPhase::SignedIn && st.offline.is_none()
}

/// 앱 상태에 하나. 마지막으로 찾은 업데이트와 설치 동시 실행 가드
#[derive(Debug, Default)]
pub struct Updates {
    available: Mutex<Option<UpdateInfoDto>>,
    installing: AtomicBool,
}

/// 설치 가드: 어떤 끝에서도 `installing`을 푼다
struct InstallingGuard<'a>(&'a AtomicBool);

impl Drop for InstallingGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// `find`의 결과
enum Found {
    Offline,
    Failed,
    UpToDate,
    Untrusted,
    Update(FoundUpdate),
}

impl Updates {
    fn cache(&self) -> MutexGuard<'_, Option<UpdateInfoDto>> {
        self.available.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 캐시(update_available)
    pub fn available(&self) -> Option<UpdateInfoDto> {
        self.cache().clone()
    }

    /// 세션 판정 → 플러그인 check → 출처 대조(D4·D5). 캐시를 바꾸지 않는다
    async fn find<A: WorkerApi, C: Clock, S: UpdateSource>(
        &self,
        auth: &AuthService<A, C>,
        base: &WorkerBase,
        src: &S,
    ) -> Found {
        let Some(access) = auth.ensure_fresh_access().await else {
            return Found::Offline;
        };
        let bearer = bearer_value(&access);
        match src.check(&update_endpoint(base), &bearer).await {
            Err(_) => Found::Failed,
            Ok(None) => Found::UpToDate,
            Ok(Some(f)) if !base.same_origin(&f.download_url) => Found::Untrusted,
            Ok(Some(f)) => Found::Update(f),
        }
    }

    /// 확인(D4·D5). 순서: ensure_fresh_access(None → Offline, src 미호출) → src.check(update_endpoint, bearer).
    /// Err → Failed(캐시 유지) / Ok(None) → 캐시 비움, UpToDate / 출처 다름 → 캐시 비움, Untrusted /
    /// 그 밖 → 캐시 = info, Available
    pub async fn check<A: WorkerApi, C: Clock, S: UpdateSource>(
        &self,
        auth: &AuthService<A, C>,
        base: &WorkerBase,
        src: &S,
    ) -> UpdateCheckDto {
        let (dto, result) = match self.find(auth, base, src).await {
            Found::Offline => (UpdateCheckDto::Offline, "offline"),
            Found::Failed => (UpdateCheckDto::Failed, "failed"),
            Found::UpToDate => {
                *self.cache() = None;
                (UpdateCheckDto::UpToDate, "up_to_date")
            }
            Found::Untrusted => {
                *self.cache() = None;
                (UpdateCheckDto::Untrusted, "untrusted")
            }
            Found::Update(f) => {
                let info = info_of(&f);
                *self.cache() = Some(info.clone());
                (UpdateCheckDto::Available { info }, "available")
            }
        };
        match &dto {
            UpdateCheckDto::Available { info } => {
                tracing::info!(result, version = %info.version, "업데이트 확인")
            }
            _ => tracing::info!(result, "업데이트 확인"),
        }
        dto
    }

    /// 설치(D6·D7). 순서: 동시 실행 가드 → 받는 중 작업 확인 → 세션·check·출처 → download(진행 이벤트, 정체 감시) →
    /// (확인 없이 왔으면) 받는 중 작업 다시 확인 → quit 경로 → install → 다시 시작.
    /// 다운로드·서명 확인이 quit보다 먼저라 그 실패에서는 작업이 멈추지 않는다
    pub async fn install<A: WorkerApi, C: Clock, S: UpdateSource, H: InstallHost>(
        &self,
        auth: &AuthService<A, C>,
        base: &WorkerBase,
        src: &S,
        host: &H,
        confirm_pause: bool,
    ) -> UpdateInstallDto {
        if self.installing.swap(true, Ordering::SeqCst) {
            return UpdateInstallDto::Busy;
        }
        let _guard = InstallingGuard(&self.installing);

        let running = host.running();
        if running > 0 && !confirm_pause {
            return UpdateInstallDto::NeedsConfirm {
                running: u32::try_from(running).unwrap_or(u32::MAX),
            };
        }
        match self.find(auth, base, src).await {
            Found::Offline => return UpdateInstallDto::Offline,
            Found::Failed => return UpdateInstallDto::Failed,
            Found::UpToDate => {
                *self.cache() = None;
                return UpdateInstallDto::UpToDate;
            }
            Found::Untrusted => {
                *self.cache() = None;
                return UpdateInstallDto::Untrusted;
            }
            // 배너가 보인 것과 다른 버전일 수 있다: 캐시만 맞춘다(이벤트는 보내지 않는다)
            Found::Update(f) => *self.cache() = Some(info_of(&f)),
        }

        match download_watched(src, host).await {
            Ok(()) => {}
            Err(stalled) => {
                let result = if stalled {
                    "download_stalled"
                } else {
                    "download_failed"
                };
                tracing::info!(result, "업데이트 설치");
                return UpdateInstallDto::Failed;
            }
        }
        host.progress(UpdateProgressEvent::Downloaded);

        // 확인 뒤 받는 동안 새로 시작한 받기가 있으면 묻지 않고 멈추지 않는다(받은 바이트는 버려진다, 75)
        if !confirm_pause {
            let running = host.running();
            if running > 0 {
                return UpdateInstallDto::NeedsConfirm {
                    running: u32::try_from(running).unwrap_or(u32::MAX),
                };
            }
        }

        if !host.pause_for_install().await {
            return UpdateInstallDto::Busy;
        }
        // quit 뒤 구간: 설치가 성공하지 않고 이 future를 떠나면(실패·패닉·버려짐) 멈춘 작업과 종료 가드를 되살린다(81)
        let mut rollback = QuitRollback(Some(host));
        host.progress(UpdateProgressEvent::Installing);
        match src.install() {
            Err(_) => {
                drop(rollback);
                tracing::info!(result = "install_failed", "업데이트 설치");
                UpdateInstallDto::Failed
            }
            Ok(()) => {
                rollback.0 = None;
                host.restart();
                UpdateInstallDto::Restarting
            }
        }
    }
}

/// `pause_for_install` 뒤 설치가 성공하지 않으면 drop 때 `resume_after_failed_install`을 부른다(패닉으로 풀릴 때도)
struct QuitRollback<'a, H: InstallHost>(Option<&'a H>);

impl<H: InstallHost> Drop for QuitRollback<'_, H> {
    fn drop(&mut self) {
        if let Some(h) = self.0.take() {
            h.resume_after_failed_install();
        }
    }
}

/// 정체 감시를 붙인 다운로드. 실패면 `Err(정체였나)`. 정체로 끝내면 다운로드 future를 버려 전송도 끊긴다
async fn download_watched<S: UpdateSource, H: InstallHost>(src: &S, host: &H) -> Result<(), bool> {
    let last = Mutex::new(tokio::time::Instant::now());
    let mut throttle = ProgressThrottle::new();
    let mut on_chunk = |len: u64, total: Option<u64>| {
        *last.lock().unwrap_or_else(|e| e.into_inner()) = tokio::time::Instant::now();
        for e in throttle.on_chunk(len, total) {
            host.progress(e);
        }
    };
    let mut dl = std::pin::pin!(src.download(&mut on_chunk));
    loop {
        let since = last.lock().unwrap_or_else(|e| e.into_inner()).elapsed();
        let Some(left) = DOWNLOAD_STALL.checked_sub(since).filter(|d| !d.is_zero()) else {
            return Err(true);
        };
        if let Ok(r) = tokio::time::timeout(left, dl.as_mut()).await {
            return r.map_err(|_| false);
        }
    }
}
