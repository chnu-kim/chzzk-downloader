//! 다운로드 작업 관리자(docs/design/app.md §6).
//!
//! - **큐**: `enqueue`는 `queued`로 넣고 `pump()`한다. `pump()`는 스케줄러가 켜져 있고 `running + pausing`이
//!   동시 작업 수(설정 `max_parallel_downloads`, 1~3)보다 적은 동안 가장 먼저 줄 선 `queued`를 시작한다.
//!   `pausing`도 센다. 태스크가 아직 연결과 `.part` 잠금을 쥐고 있기 때문이다.
//!   **생방송 녹화는 따로 센다**(`MAX_LIVE`개까지 별도 lane): 몇 시간씩 도는 녹화가 VOD·클립 슬롯을 막지 않게 하고,
//!   VOD가 슬롯을 다 써도 방송이 시작될 때 바로 녹화가 시작되게 한다.
//! - **이벤트 순서**: 상태를 바꾸고 저장할 목록을 넘기고 이벤트를 보내는 일을 모두 상태 잠금 안에서 한다. 그래서
//!   `Added` → `Status(running)` → `Progress`… → `Status(끝)` 순서가 실제 전이 순서와 같고, `subscribe`의
//!   스냅샷과 그 뒤 이벤트 사이에 빠지거나 겹치는 것이 없다. 잠금 순서는 상태 → sink 하나뿐이다.
//! - **저장**: `jobs.json`은 상태가 바뀔 때만 쓴다(진행률 틱마다 쓰지 않는다). 잠금 안에서는 목록을 바이트로
//!   만들어 쓰기 스레드(`writer`)에 넘기기만 하고, `fsync`와 Windows rename 재시도(최대 약 3초 sleep)는 잠금
//!   밖에서 한다. 디스크가 느려도 진행률 콜백과 command가 상태 잠금에서 기다리지 않는다. 쓰기 스레드는 가장
//!   최근 목록만 쓴다. 쓰기 실패는 로그만 남기고 작업을 멈추지 않는다(메모리 상태가 기준이고, 다음 전이 때
//!   다시 쓴다). `quit`은 마지막에 `flush`해 종료 전에 디스크에 닿게 한다.
//! - **중복 방지**: 같은 최종 경로의 활성 작업(`queued·running·pausing·paused·interrupted`)이나 지우는 중인
//!   작업이 있으면 `duplicateOutput`. 경로 비교는 Windows·macOS에서 대소문자를 무시한다(NTFS·APFS 기본이 그렇다).
//!   두 작업이 같은 파일을 마무리(rename)하는 경합을 여기서 막는다. `enqueue`와 `resume`이 모두 검사한다.
//! - **멈춤**: `pause`·`remove`·`quit`은 `stop`을 먼저 적고 토큰을 취소한다. 코어는 셋 다 `Error::Cancelled`로
//!   끝나므로 `stop`으로 구분한다: `Pause` → `paused`, `Quit` → `interrupted`(다음 시작 때 이어받을 대상),
//!   `Remove` → 지운다. 이유 없이 `Cancelled`가 오면 `failed{internal}`이다.
//!   **생방송의 "중지"는 취소가 아니다**(`stop_job`, `StopReason::Finish`): 코어의 `live_stop`을 취소해 받은 만큼
//!   최종 파일로 마무리하고 `completed`가 된다(아무것도 받지 못했으면 `failed{nothingRecorded}`). `pause`는 생방송에서
//!   같은 뜻이고(`.part`를 남기는 일시정지는 이어 붙일 수 없어 없다), `quit`도 생방송은 마무리한다.
//! - **`remove`의 순서**: 태스크의 `JoinHandle`을 꺼내 **잠금을 놓은 뒤** 기다리고, 그다음 `discard_partial`을
//!   부른다. 끝나는 태스크가 같은 잠금을 잡으므로 잡은 채 기다리면 교착이고, 먼저 지우면 `.part` 잠금 때문에
//!   `FileLocked`다(코어가 취소 뒤 체크포인트를 쓰는 중일 수도 있다).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use chzzk_core::chat::{
    ChatOutcome, ChatProgress, ChatRequest, SubtitleFormat, chat_partial_bytes,
    discard_chat_partial,
};
use chzzk_core::naming::output_path;
use chzzk_core::{
    CancellationToken, ContentRef, Discarded, DownloadOutcome, DownloadRequest, Error, Phase,
    PlaybackKind, Progress, discard_partial,
};
use std::time::Duration;
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

use crate::backend::Backend;
use crate::chat::{
    ChatOutputCheck, ChatPhase, ChatQueue, ChatRun, ChatState, ChatStop, percent_of,
};
use crate::dto::{
    ContentKindDto, EnqueueRequest, JobDto, JobEvent, JobId, JobStatus, LiveEndDto, OnExisting,
    OutputCheck, ProgressDto, TimeRangeDto,
};
use crate::error::{AppError, Stage};
use crate::events::EventSink;
use crate::jobs::{
    JOBS_VERSION, JobRecord, JobStore, JobsFile, now_secs, partial_bytes, reconcile,
};
use crate::output::{OutputQuery, check_output};
use crate::volume;
use crate::writer::{Flusher, JobsWriter};

/// 작업 시작 시점의 코어 클라이언트를 준다(쿠키 토글 때 셸이 클라이언트를 바꾼다).
pub type ClientFn<B> = Arc<dyn Fn() -> Arc<B> + Send + Sync>;

/// 완료·건너뜀을 남기는 개수. 넘으면 오래된 것부터 지운다.
pub const MAX_FINISHED: usize = 100;

/// 동시에 녹화할 수 있는 생방송 수(VOD 슬롯과 별개 lane).
pub const MAX_LIVE: usize = 3;

/// 동시 작업 수 범위(코어 `settings::MAX_PARALLEL_DOWNLOADS`와 같다).
pub const MIN_PARALLEL: u8 = 1;
pub const MAX_PARALLEL: u8 = chzzk_core::settings::MAX_PARALLEL_DOWNLOADS;

/// 매니저를 만드는 값.
pub struct ManagerConfig<B> {
    pub client: ClientFn<B>,
    pub store: JobStore,
    /// 작업 태스크를 띄울 런타임. 앱은 `tauri::async_runtime::handle().inner().clone()`
    pub runtime: Handle,
    /// 설정 `max_parallel_downloads`. 1~3으로 자른다
    pub max_parallel: u8,
    /// 설정 `auto_resume_interrupted`. 켜져 있으면 열자마자 `interrupted`를 모두 다시 줄 세운다
    pub auto_resume: bool,
}

/// 앱 종료(`quit`) 때 멈추기를 기다리는 시간.
pub const QUIT_TIMEOUT: Duration = Duration::from_secs(3);

/// 태스크가 멈춘 이유. 코어는 일시정지·제거·종료 모두 `Error::Cancelled`로 끝나므로 이것으로 구분한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StopReason {
    Pause,
    Remove,
    Quit,
    /// 생방송 중지: 취소가 아니라 받은 만큼 마무리한다
    Finish,
}

/// `enqueue` 때 설정에서 오는 값.
#[derive(Clone, Debug)]
pub struct JobDefaults {
    /// 요청에 폴더가 없을 때 쓰는 폴더(설정 폴더, 없으면 기본 폴더)
    pub download_folder: PathBuf,
    /// 설정 `segment_concurrency`. 이 작업에 고정된다
    pub segment_concurrency: u8,
    /// 설정 `chat_subtitle`. 채팅을 함께 받는 작업에 고정된다(chat.md §4.1)
    pub chat_subtitle: SubtitleFormat,
}

/// 태스크의 끝.
enum End {
    Done(DownloadOutcome),
    Cancelled,
    Error(Error),
    /// 셸 쪽 실패(태스크 패닉 등)
    Failed(AppError),
}

struct Job {
    rec: JobRecord,
    cancel: Option<CancellationToken>,
    /// 생방송만: 취소하면 코어가 받은 만큼 마무리한다(`DownloadRequest::live_stop`)
    live_stop: Option<CancellationToken>,
    handle: Option<JoinHandle<()>>,
    last_progress: Option<ProgressDto>,
    stop: Option<StopReason>,
    /// `remove`가 진행 중이다. 다른 동작은 이 작업을 없는 것으로 본다(중복 검사에는 남는다)
    removing: bool,
    /// 줄 선 순서(FIFO). `queued`가 될 때마다 새로 받는다
    queue_seq: u64,
    /// 태스크 세대. `start`마다 새로 받고 태스크가 `finish`·진행률에 들고 온다. 자기 세대가 아닌 태스크의 보고는 버린다
    run: u64,
    /// 이 기록이 `jobs.json`에 저장된 것을 확인했는가. 파일에서 읽은 기록은 `true`, 새로 추가한 생방송 녹화는 `false`이고
    /// 첫 시작이 저장을 확인한다(주인 기록 없이 녹화를 남기지 않는다, core.md 61)
    saved: bool,
    /// `quit` 기한 안에 멈추지 않아 태스크가 아직 도는 세대(worker.md 구현 중 변경 76·80). 그 태스크가 `finish`할 때까지
    /// 슬롯(`max_running`)과 출력 경로를 차지하고 같은 작업을 새로 시작하지 않는다(옛 태스크가 아직 `.part`를 쓴다)
    detached: Option<u64>,
}

impl Job {
    fn new(rec: JobRecord, queue_seq: u64) -> Self {
        Job {
            rec,
            cancel: None,
            live_stop: None,
            handle: None,
            last_progress: None,
            stop: None,
            removing: false,
            queue_seq,
            run: 0,
            saved: true,
            detached: None,
        }
    }

    fn dto(&self) -> JobDto {
        self.rec.to_dto(self.last_progress.clone())
    }

    /// 지금 경로를 쓰거나(활성·quit 기한을 넘긴 옛 태스크·완료 뒤 채팅 대기·받는 중) 곧 `.part`를 지운다(지우는 중).
    /// `failed`를 지우는 동안 새 작업이 같은 경로를 가져가면 그 작업의 `.part`를 지우게 된다.
    fn uses_output(&self) -> bool {
        self.removing
            || self.rec.status.is_active()
            || self.detached.is_some()
            || self.collects_chat()
    }

    /// 영상은 완료됐고 채팅이 줄에 있거나 받는 중이다. 그동안 같은 출력에 다른 영상이 들어오면 바뀐 영상 옆에
    /// 원래 영상의 채팅·자막이 놓이므로 출력을 예약한다(Codex PR #141 ①, app.md 83). 완료가 아닌 작업의 대기 채팅은
    /// 영상 상태가 예약을 정한다. 멈춘·실패한 채팅은 예약하지 않는다(다른 영상이면 코어가 sidecar를 보고 처음부터 받는다).
    fn collects_chat(&self) -> bool {
        self.rec.status == JobStatus::Completed
            && self
                .rec
                .chat
                .as_ref()
                .is_some_and(|c| matches!(c.phase, ChatPhase::Waiting | ChatPhase::Running))
    }

    /// 끝났지만(failed·skipped) 이 작업의 녹화 `.part`가 남은 생방송. 다시 받을 수 없으니 경로를 내주지 않는다(core.md 61).
    fn keeps_recording(&self) -> bool {
        self.is_live()
            && matches!(self.rec.status, JobStatus::Failed | JobStatus::Skipped)
            && self.rec.partial_bytes.is_some()
    }

    /// 같은 경로 충돌 검사에서 이 작업이 최종 경로를 차지하는가: `uses_output`이거나 `keeps_recording`.
    fn holds_output(&self) -> bool {
        self.uses_output() || self.keeps_recording()
    }

    /// "완료 지우기"·오래된 기록 정리가 레코드만 지워도 되는가. `completed`와 `.part`가 없는 `skipped`.
    /// 받는 동안 같은 이름의 파일이 생겨 건너뛴 작업은 받은 `.part`가 남아 있어("덮어쓰고 받기"로 쓸 수
    /// 있다) 레코드만 지우면 파일이 버려진 채 남으므로 정리하지 않는다(`remove`로 지운다).
    /// 채팅이 돌고 있거나(대기·받는 중) 받다 만 채팅 파일이 남은 완료 작업도 같은 이유로 정리하지 않는다(chat.md §4.3).
    fn clearable(&self) -> bool {
        match self.rec.status {
            JobStatus::Completed => !self.rec.chat.as_ref().is_some_and(ChatState::holds_files),
            JobStatus::Skipped => self.rec.partial_bytes.is_none(),
            _ => false,
        }
    }

    /// 생방송 작업인가(별도 lane, 중지는 마무리).
    fn is_live(&self) -> bool {
        matches!(self.rec.content, ContentRef::Live { .. })
    }

    /// 멈춤 요청을 보낸다. 생방송은 마무리(`live_stop`), 나머지는 취소.
    fn signal_stop(&self) {
        let token = if self.is_live() {
            self.live_stop.as_ref()
        } else {
            self.cancel.as_ref()
        };
        if let Some(t) = token {
            t.cancel();
        }
    }

    fn busy(&self) -> bool {
        matches!(self.rec.status, JobStatus::Running | JobStatus::Pausing)
    }

    /// 슬롯을 차지하는가: 받는 중이거나, quit 기한을 넘긴 옛 태스크가 아직 돈다
    fn occupies_slot(&self) -> bool {
        self.busy() || self.detached.is_some()
    }
}

struct State {
    jobs: BTreeMap<JobId, Job>,
    next_id: u64,
    next_seq: u64,
    sink: Option<Box<dyn EventSink>>,
    max_running: usize,
    scheduler_enabled: bool,
    /// 마지막 `quit`이 멈춘(그때 `running`이던) 작업. `cancel_quit`이 이것만 되살린다(A4, D7)
    quit_stopped: Vec<JobId>,
    /// 채팅 수집 줄(한 번에 하나, chat.md §4.2)
    chat: ChatQueue,
    /// 마지막 `quit`이 멈춘 채팅 작업. `cancel_quit`이 되살린다
    quit_stopped_chat: Option<JobId>,
}

impl State {
    fn emit(&mut self, e: JobEvent) {
        if let Some(s) = &self.sink
            && !s.send(e)
        {
            tracing::debug!("이벤트 구독자가 사라져 비운다");
            self.sink = None;
        }
    }

    fn file(&self) -> JobsFile {
        JobsFile {
            v: JOBS_VERSION,
            next_id: self.next_id,
            jobs: self.jobs.values().map(|j| j.rec.clone()).collect(),
        }
    }

    fn seq(&mut self) -> u64 {
        self.next_seq += 1;
        self.next_seq
    }

    fn snapshot(&self) -> Vec<JobDto> {
        self.jobs.values().map(Job::dto).collect()
    }

    /// 사용자에게 보이는 작업(지우는 중이 아닌 것).
    fn visible(&mut self, id: JobId) -> Result<&mut Job, AppError> {
        self.jobs
            .get_mut(&id)
            .filter(|j| !j.removing)
            .ok_or_else(|| AppError::job_not_found(id))
    }

    /// 제어 동작의 대상. 없으면 `jobNotFound`, 지우는 중이면 `None`(두 번 누른 "취소" 등은 조용히 넘긴다).
    fn target(&mut self, id: JobId) -> Result<Option<&mut Job>, AppError> {
        match self.jobs.get_mut(&id) {
            None => Err(AppError::job_not_found(id)),
            Some(j) if j.removing => Ok(None),
            Some(j) => Ok(Some(j)),
        }
    }

    /// `output`과 같은 파일을 쓰는 활성 작업(`except` 제외).
    fn active_with_output(&self, output: &Path, except: Option<JobId>) -> Option<JobId> {
        let key = output_key(output);
        self.jobs
            .values()
            .find(|j| {
                Some(j.rec.id) != except && j.holds_output() && output_key(&j.rec.output) == key
            })
            .map(|j| j.rec.id)
    }

    /// 같은 출력의 다른 기록(`except` 제외, 지우는 중 제외)이 받다 만 채팅 파일을 쥐고 있는가(`ChatState::holds_files`).
    /// 같은 영상이면 채팅 `.part`·sidecar 하나를 함께 가리키므로(멈춘 채팅은 출력을 예약하지 않는다) 지우지 않는다
    /// (Codex PR #141 ③).
    fn chat_part_shared(&self, output: &Path, except: JobId) -> bool {
        let key = output_key(output);
        self.jobs.values().any(|j| {
            j.rec.id != except
                && !j.removing
                && output_key(&j.rec.output) == key
                && j.rec.chat.as_ref().is_some_and(ChatState::holds_files)
        })
    }

    /// 작업 `id`를 다시 줄 세울 때 같은 경로를 막는 다른 작업. `active_with_output`과 같고, 멈춰 있으면서 같은 녹화
    /// `.part`의 주인인 기록(`keeps_recording`이고 `PartOwner`가 같다)은 막지 않는다. v0.7.0은 실패한 작업의 경로를
    /// 새 작업에 내줬고 옛 기록·sidecar는 모두 `recordingId`가 없어(None = None) 한 녹화를 여럿이 함께 가리킬 수 있다.
    /// 그중 하나로 이어받으면 그 녹화를 저장한다(Codex PR #113 ④). 새 녹화(`enqueue`)와 `remove`는 이 예외를 쓰지 않는다.
    fn blocks_requeue(&self, id: JobId) -> Option<JobId> {
        let me = &self.jobs.get(&id)?.rec;
        let key = output_key(&me.output);
        self.jobs
            .values()
            .find(|j| {
                j.rec.id != id
                    && j.holds_output()
                    && output_key(&j.rec.output) == key
                    && !(!j.uses_output() && j.keeps_recording() && same_owner(&j.rec, me))
            })
            .map(|j| j.rec.id)
    }
}

/// 녹화 작업 `rec`가 끝났다. 같은 녹화 `.part`를 함께 가리키던 멈춘 옛 기록(v0.7.0, `blocks_requeue`의 예외)의 받은 부분을
/// 다시 센다. `rec`가 그 녹화를 저장했으면 `.part`가 없어져 `None`이 된다(남겨 두면 화면이 [이어받기]를 앞세우고, 누르면
/// 지금 방송을 옛 이름으로 새로 녹화한다).
///
/// 저장했으면 그 옛 기록의 덮어쓰기(`overwrite`)를 건너뛰기(`skip`)로 내린다. 받은 부분이 없어진 옛 기록을 다시 시도하면
/// 지금 방송을 같은 출력에 새로 녹화하는데, 덮어쓰기면 방금 저장한 녹화를 덮어쓴다(Codex PR #113 확인). 건너뛰기면 코어가
/// 녹화를 시작하지 않고 `skipped`로 끝나고, 덮어쓰려면 사용자가 [덮어쓰고 받기]를 따로 누른다(`requeue`).
///
/// 대상은 받은 부분 표시(`keeps_recording`)와 관계없이 같은 출력·같은 주인인 끝난(failed·skipped) 생방송 기록 모두다.
/// 앞서 받은 부분이 내려간 기록도 덮어쓰기가 남아 있으면 다시 시도로 저장된 녹화를 덮어쓴다(Codex PR #113 2회차 ④).
fn refresh_siblings(st: &mut State, rec: &JobRecord) {
    let key = output_key(&rec.output);
    let saved = rec.status == JobStatus::Completed;
    let mut changed = Vec::new();
    for j in st.jobs.values_mut() {
        if j.rec.id == rec.id
            || j.uses_output()
            || !j.is_live()
            || !matches!(j.rec.status, JobStatus::Failed | JobStatus::Skipped)
            || output_key(&j.rec.output) != key
            || !same_owner(&j.rec, rec)
        {
            continue;
        }
        let now = partial_bytes(&j.rec);
        let mut touched = now != j.rec.partial_bytes;
        j.rec.partial_bytes = now;
        if saved && now.is_none() && j.rec.on_existing == OnExisting::Overwrite {
            j.rec.on_existing = OnExisting::Skip;
            touched = true;
        }
        if touched {
            changed.push(j.dto());
        }
    }
    for job in changed {
        st.emit(JobEvent::Status { job });
    }
}

/// 두 기록이 같은 `.part`의 주인인가(`PartOwner`의 다섯 값이 같다).
fn same_owner(a: &JobRecord, b: &JobRecord) -> bool {
    let (x, y) = (a.owner(), b.owner());
    x.content == y.content
        && x.quality_id == y.quality_id
        && x.kind == y.kind
        && x.recording_id == y.recording_id
        && x.range == y.range
}

/// 같은 파일인지 비교할 열쇠.
///
/// - 경로 구성 요소로 다시 조립해 겹친 구분자·끝 구분자를 없앤다. Windows는 `/`와 `\`가 하나가 된다
///   (옛 Go 설정의 `D:/Videos`와 폴더 선택기의 `D:\Videos`가 같은 파일을 가리킨다).
/// - `.`·`..`는 여기서 풀지 않는다. 열쇠에 들어오는 경로는 모두 `resolve_folder`를 지난 폴더로 만들어지고
///   (`check_output`·`enqueue`, `resume`은 그렇게 저장된 `rec.output`), 거기서 `.`·`..` 구성 요소를 거부한다
///   (`check_folder_segments`). `..`를 글자로 풀면 심볼릭 링크를 지날 때 틀린 열쇠가 된다.
///   심볼릭 링크 별칭(macOS `/tmp` 대 `/private/tmp` 등)은 같은 파일로 보지 않는다.
/// - Windows·macOS 기본 파일 시스템은 대소문자를 구분하지 않으므로 소문자로 비교한다.
///   (macOS의 유니코드 정규화 차이는 보지 않는다. 이름은 모두 같은 코드 경로로 만들어진다.)
pub fn output_key(p: &Path) -> String {
    let normalized: PathBuf = p.components().collect();
    let s = normalized.to_string_lossy();
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s.into_owned()
    }
}

struct Inner<B> {
    client: ClientFn<B>,
    runtime: Handle,
    state: Mutex<State>,
    writer: JobsWriter,
}

/// 다운로드 작업 관리자. 복제하면 같은 매니저를 가리킨다.
pub struct DownloadManager<B: Backend> {
    inner: Arc<Inner<B>>,
}

impl<B: Backend> Clone for DownloadManager<B> {
    fn clone(&self) -> Self {
        DownloadManager {
            inner: Arc::clone(&self.inner),
        }
    }
}

fn clamp_parallel(n: u8) -> usize {
    usize::from(n.clamp(MIN_PARALLEL, MAX_PARALLEL))
}

impl<B: Backend> DownloadManager<B> {
    /// `jobs.json`을 읽고 reconcile한 뒤 저장한다. 작업은 시작하지 않는다(`interrupted`로 복원).
    pub fn open(cfg: ManagerConfig<B>) -> Result<Self, AppError> {
        let mut file = cfg.store.load().map_err(AppError::from)?.file;
        reconcile(&mut file);
        let mut st = State {
            jobs: BTreeMap::new(),
            next_id: file.next_id,
            next_seq: 0,
            sink: None,
            max_running: clamp_parallel(cfg.max_parallel),
            scheduler_enabled: true,
            quit_stopped: Vec::new(),
            chat: ChatQueue::default(),
            quit_stopped_chat: None,
        };
        for rec in file.jobs {
            let seq = st.seq();
            st.jobs.insert(rec.id, Job::new(rec, seq));
        }
        let inner = Arc::new(Inner {
            client: cfg.client,
            runtime: cfg.runtime,
            state: Mutex::new(st),
            writer: JobsWriter::spawn(cfg.store),
        });
        let mgr = DownloadManager { inner };
        {
            let st = mgr.inner.lock();
            mgr.inner.save(&st);
        }
        if cfg.auto_resume {
            let n = mgr.resume_interrupted();
            tracing::info!(count = n, "멈춘 작업을 자동으로 이어받는다");
        }
        Ok(mgr)
    }

    /// 지금까지 바뀐 상태의 `jobs.json` 쓰기 시도가 끝날 때까지 막는다(실패해도 돌아온다).
    /// async 문맥에서는 워커를 막지 않도록 `spawn_blocking`으로 부른다. `quit`은 스스로 부른다.
    pub fn flush(&self) {
        self.inner.writer.flusher().flush();
    }

    /// 지금 목록(재동기화용 스냅샷, id 순).
    pub fn list(&self) -> Vec<JobDto> {
        self.inner.lock().snapshot()
    }

    /// 구독자를 바꾸고 스냅샷을 돌려준다. 스냅샷 뒤의 변화는 모두 새 sink로 간다.
    pub fn subscribe(&self, sink: Box<dyn EventSink>) -> Vec<JobDto> {
        let mut st = self.inner.lock();
        st.sink = Some(sink);
        st.snapshot()
    }

    /// 동시 작업 수를 바꾼다(1~3으로 자른다). 늘리면 바로 대기 작업을 시작하고, 줄여도 도는 작업은 멈추지 않는다.
    pub fn set_max_parallel(&self, n: u8) {
        let mut st = self.inner.lock();
        st.max_running = clamp_parallel(n);
        self.inner.pump(&mut st);
    }

    /// 받는 중(`running`·`pausing`)인 작업 수. 창 닫기 확인(D1)에 쓴다.
    pub fn running_count(&self) -> usize {
        self.inner.lock().jobs.values().filter(|j| j.busy()).count()
    }

    /// 작업을 추가한다(§6.2). 최종 경로를 계산해 저장하고, 같은 경로의 활성 작업이 있으면 `duplicateOutput`.
    ///
    /// 소유 검사(`OwnershipGate`)와 설정의 최근 VOD·마지막 화질 갱신은 부르는 쪽(command)이 한다.
    pub fn enqueue(&self, req: EnqueueRequest, defaults: &JobDefaults) -> Result<JobDto, AppError> {
        let range = crate::jobs::validated_range(req.expected_kind, req.range)?;
        // 채팅은 영상(VOD 번호) 전체 받기에만 붙는다. 카드가 클립·생방송·구간에서 행을 숨기므로 정상 경로에서는
        // 오지 않고, 숨김이 깨졌을 때 조용히 무시하지 않으려는 가드다(chat.md §4.4)
        if req.save_chat && (!matches!(req.content, ContentRef::Video { .. }) || range.is_some()) {
            return Err(AppError::invalid_input(
                "채팅은 영상 전체를 받을 때만 함께 받을 수 있습니다",
            ));
        }
        let folder = resolve_folder(req.folder.as_deref(), &defaults.download_folder)?;
        // 이름은 `check_output`이 접미사까지 붙여 돌려준 최종 이름이다. 여기서는 다시 붙이지 않는다(range.md §4.2)
        let output = output_path(&folder, &req.file_name, volume::platform_for_dir(&folder));

        let mut st = self.inner.lock();
        if let Some(other) = st.active_with_output(&output, None) {
            return Err(AppError::duplicate_output(other));
        }
        let id = JobId(st.next_id);
        st.next_id += 1;
        let kind = match &req.content {
            ContentRef::Video { .. } => ContentKindDto::Video,
            ContentRef::Clip { .. } => ContentKindDto::Clip,
            ContentRef::Live { .. } => ContentKindDto::Live,
        };
        let rec = JobRecord {
            id,
            url: req.url,
            content: req.content,
            title: req.title,
            channel_name: req.channel_name,
            channel_id: req.channel_id,
            kind,
            quality_id: req.quality_id,
            quality_label: req.quality_label,
            expected_kind: req.expected_kind,
            range,
            recording_id: matches!(kind, ContentKindDto::Live).then(crate::jobs::new_recording_id),
            output,
            on_existing: req.on_existing,
            concurrency: crate::jobs::concurrency(defaults.segment_concurrency).get(),
            status: JobStatus::Queued,
            created_at: now_secs(),
            finished_at: None,
            stopped_at: None,
            final_bytes: None,
            live_end: None,
            last_error: None,
            chat: req
                .save_chat
                .then(|| ChatState::waiting(defaults.chat_subtitle, req.on_existing)),
            discard_on_start: req.restart,
            partial_bytes: None,
            missing: false,
        };
        let seq = st.seq();
        let mut job = Job::new(rec, seq);
        // 새 녹화는 주인 기록(`recordingId`)이 저장된 뒤에만 시작한다(`run_download`). VOD는 다시 받을 수 있어 기다리지 않는다
        job.saved = !job.is_live();
        let dto = job.dto();
        st.jobs.insert(id, job);
        self.inner.save(&st);
        st.emit(JobEvent::Added { job: dto });
        self.inner.pump(&mut st);
        Ok(st.jobs[&id].dto())
    }

    /// 최종 경로와 충돌을 미리 본다(§6.4). 폴더 규칙은 `enqueue`와 같다.
    /// 구간(`range`)이 있으면 이름 끝에 접미사를 붙이고 `.part`의 구간도 비교한다(range.md §4.2).
    #[allow(clippy::too_many_arguments)] // command 인자를 그대로 펼쳐 받는다(`commands::check_output`)
    pub fn check_output(
        &self,
        folder: Option<&str>,
        default_folder: &Path,
        file_name: &str,
        content: &ContentRef,
        quality_id: &str,
        kind: PlaybackKind,
        range: Option<TimeRangeDto>,
        chat: Option<SubtitleFormat>,
    ) -> Result<OutputCheck, AppError> {
        let folder = resolve_folder(folder, default_folder)?;
        // `enqueue`가 거부할 구간에는 이름·충돌 판정도 내지 않는다(같은 규칙 한 곳)
        let validated = crate::jobs::validated_range(kind, range)?;
        // 파일 시스템을 보는 동안 잠금을 쥐지 않도록 활성 경로를 먼저 떠 둔다.
        let active: Vec<(String, JobId)> = {
            let st = self.inner.lock();
            st.jobs
                .values()
                // 끝난 녹화는 중복으로 보이지 않는다. 카드가 `partial.recording`을 보고 번호 이름으로 피한다(core.md 61)
                .filter(|j| j.uses_output())
                .map(|j| (output_key(&j.rec.output), j.rec.id))
                .collect()
        };
        let find = |p: &Path| {
            let k = output_key(p);
            active.iter().find(|(a, _)| *a == k).map(|(_, id)| *id)
        };
        Ok(check_output(
            &OutputQuery {
                folder: &folder,
                file_name,
                content,
                quality_id,
                kind,
                platform: volume::platform_for_dir(&folder),
                range: validated,
                chat,
            },
            &find,
        ))
    }

    /// 일시정지. `running` → `pausing` → (태스크가 끝나면) `paused`, `queued` → `paused`. `.part`는 남는다.
    /// 이미 멈춘 작업에는 아무것도 하지 않는다.
    pub fn pause(&self, id: JobId) -> Result<(), AppError> {
        let mut st = self.inner.lock();
        let Some(job) = st.target(id)? else {
            return Ok(());
        };
        match job.rec.status {
            JobStatus::Running => {
                // 생방송은 `.part`를 남기는 일시정지가 없다: 받은 만큼 마무리한다
                job.stop = Some(if job.is_live() {
                    StopReason::Finish
                } else {
                    StopReason::Pause
                });
                job.rec.status = JobStatus::Pausing;
                job.signal_stop();
            }
            JobStatus::Queued => {
                job.rec.set_status(JobStatus::Paused, now_secs());
                job.rec.partial_bytes = partial_bytes(&job.rec);
            }
            _ => return Ok(()),
        }
        let dto = job.dto();
        self.inner.save(&st);
        st.emit(JobEvent::Status { job: dto });
        Ok(())
    }

    /// 생방송 녹화를 멈추고 받은 만큼 최종 파일로 마무리한다. `running` → `pausing` → `completed`.
    /// 줄 서 있던(`queued`) 작업은 `paused`가 된다. 이미 멈추는 중이거나 끝난 작업에는 아무것도 하지 않는다.
    /// 생방송이 아닌 작업은 `invalidInput`(그쪽은 `pause`·`remove`다).
    pub fn stop_job(&self, id: JobId) -> Result<(), AppError> {
        let mut st = self.inner.lock();
        let Some(job) = st.target(id)? else {
            return Ok(());
        };
        if !job.is_live() {
            return Err(AppError::invalid_input(
                "생방송 녹화가 아닌 작업은 중지할 수 없습니다",
            ));
        }
        match job.rec.status {
            JobStatus::Running => {
                job.stop = Some(StopReason::Finish);
                job.rec.status = JobStatus::Pausing;
                job.signal_stop();
            }
            JobStatus::Queued => {
                job.rec.set_status(JobStatus::Paused, now_secs());
                job.rec.partial_bytes = partial_bytes(&job.rec);
            }
            _ => return Ok(()),
        }
        let dto = job.dto();
        self.inner.save(&st);
        st.emit(JobEvent::Status { job: dto });
        Ok(())
    }

    /// 다시 줄 세운다. `paused`·`failed`·`interrupted`·`skipped` → `queued`.
    ///
    /// - `restart`면 시작 직후 `download()` 전에 `.part`를 지운다(`discard_on_start`).
    /// - `skipped`는 `on_existing = overwrite`로 바꾼다("덮어쓰고 받기").
    /// - 같은 최종 경로의 다른 활성 작업이 있으면 `duplicateOutput`(끝난 작업의 경로는 새 작업이 가져갈 수 있다).
    /// - `queued`·`running`·`pausing`에는 아무것도 하지 않는다. `completed`는 `invalidInput`.
    pub fn resume(&self, id: JobId, restart: bool) -> Result<(), AppError> {
        self.resume_checked(id, restart, |_| Ok(None))
    }

    /// 다시 줄 세울 상태(paused·failed·interrupted·skipped)인 작업의 컨텐츠. 없으면 `jobNotFound`, 지우는 중이거나
    /// 다른 상태면 `None`. `resume_job`이 잠금 밖에서 본인 영상 판정(네트워크)을 하기 위해 먼저 본다(A5 리뷰).
    pub fn requeue_content(&self, id: JobId) -> Result<Option<ContentRef>, AppError> {
        let mut st = self.inner.lock();
        Ok(st.target(id)?.and_then(|j| {
            matches!(
                j.rec.status,
                JobStatus::Paused | JobStatus::Failed | JobStatus::Interrupted | JobStatus::Skipped
            )
            .then(|| j.rec.content.clone())
        }))
    }

    /// `resume`과 같고, 다시 줄 세울 상태(paused·failed·interrupted·skipped)일 때만 잠금 안에서 `check`(작업의
    /// 컨텐츠)를 부른다. 거부하면 상태와 `.part`는 그대로다. 허용하며 `Some(채널)`을 주면 기록의 `channel_id`를 그 값(`Some(None)`은 채널 모름)으로
    /// 고쳐 쓴다(검증한 채널, A5 리뷰). queued·running 등은 `check`를 부르지 않는다.
    pub fn resume_checked(
        &self,
        id: JobId,
        restart: bool,
        check: impl FnOnce(&ContentRef) -> Result<Option<Option<String>>, AppError>,
    ) -> Result<(), AppError> {
        let mut st = self.inner.lock();
        let Some(job) = st.target(id)? else {
            return Ok(());
        };
        let verified = match job.rec.status {
            JobStatus::Paused | JobStatus::Failed | JobStatus::Interrupted | JobStatus::Skipped => {
                // 받다 만 녹화(영상 조각이 있는 이 작업의 `.part`)는 다시 받을 수 없다: "처음부터"로 확인 없이 지우지 않는다.
                // 화면은 이 버튼을 보이지 않는다(D8). 화면 밖 호출·늦게 그려진 버튼을 여기서 막는다(core.md 61)
                if restart && job.is_live() && job.rec.partial_bytes.is_some() {
                    return Err(AppError::invalid_input(
                        "받다 만 녹화는 처음부터 다시 받을 수 없습니다",
                    ));
                }
                check(&job.rec.content)?
            }
            JobStatus::Queued | JobStatus::Running | JobStatus::Pausing => return Ok(()),
            JobStatus::Completed => {
                return Err(AppError::invalid_input(
                    "완료된 작업은 다시 받을 수 없습니다",
                ));
            }
        };
        if let Some(other) = st.blocks_requeue(id) {
            return Err(AppError::duplicate_output(other));
        }
        let seq = st.seq();
        let job = st.visible(id)?;
        // `Some(x)`면 검증한 채널로 고쳐 쓴다(채널을 모르는 컨텐츠는 `Some(None)`: 기록도 None). `None`이면 건드리지 않는다
        if let Some(ch) = verified {
            job.rec.channel_id = ch;
        }
        self.inner.requeue(job, seq, restart);
        let dto = job.dto();
        self.inner.save(&st);
        st.emit(JobEvent::Status { job: dto });
        self.inner.pump(&mut st);
        Ok(())
    }

    /// 판정으로 알게 된 작업의 실제 채널 ID를 기록한다(상태·`.part`는 그대로). 거부된 이어받기 뒤 기록이 틀렸으면
    /// 고쳐 써서 화면이 막힌 작업(`otherChannel`)으로 보이고 B1이 세지 않게 한다(A5 리뷰). 컨텐츠가 다르면 하지 않는다.
    pub fn note_channel(&self, id: JobId, content: &ContentRef, channel: String) {
        let mut st = self.inner.lock();
        let Ok(Some(job)) = st.target(id) else {
            return;
        };
        if job.rec.content != *content || job.rec.channel_id.as_deref() == Some(channel.as_str()) {
            return;
        }
        job.rec.channel_id = Some(channel);
        let dto = job.dto();
        self.inner.save(&st);
        st.emit(JobEvent::Status { job: dto });
    }

    /// 채팅만 받을 수 있는 작업의 컨텐츠(chat.md §4.5-1): 완료된 영상(Video) 전체 받기. 지우는 중이면 `None`.
    /// 그 밖(완료가 아님·클립·생방송·구간)은 `invalidInput`. `fetch_chat`이 잠금 밖에서 소유 판정을 하기 위해 먼저 본다.
    pub fn chat_content(&self, id: JobId) -> Result<Option<ContentRef>, AppError> {
        let mut st = self.inner.lock();
        let Some(job) = st.target(id)? else {
            return Ok(None);
        };
        chat_target(&job.rec)?;
        Ok(Some(job.rec.content.clone()))
    }

    /// 완료 작업의 채팅을 받거나 이어받는다(`fetch_chat`, chat.md §4.5-2). `check`(작업의 컨텐츠)는 잠금 안에서 부르고,
    /// 거부하면 상태·`.part`는 그대로다. `Some(채널)`이면 기록의 `channel_id`를 그 값으로 고쳐 쓴다(`resume_checked`와 같다).
    ///
    /// - 완료가 아니거나 영상(Video) 전체 받기가 아니거나 영상 파일이 없으면 `invalidInput`.
    /// - 채팅이 이미 대기·받는 중이면 아무것도 하지 않는다(멱등).
    /// - `restart`는 받다 만 채팅 `.part`를 버린다는 뜻일 뿐 덮어쓰기 동의가 아니다. 최종 파일 처리는 `on_existing`만 정한다.
    /// - 자막 형식: 받다 만 채팅을 이어받으면(`restart` 아님, `.part` 있음) 처음 고른 형식, 그 밖(처음 받기·다시 받기·처음부터)은
    ///   지금 설정 `setting`이다(형식을 바꾸려면 "채팅 다시 받기", chat.md §1.2).
    pub fn start_chat(
        &self,
        id: JobId,
        restart: bool,
        on_existing: OnExisting,
        setting: SubtitleFormat,
        check: impl FnOnce(&ContentRef) -> Result<Option<Option<String>>, AppError>,
    ) -> Result<(), AppError> {
        let mut st = self.inner.lock();
        let Some(job) = st.target(id)? else {
            return Ok(());
        };
        let video_no = chat_target(&job.rec)?;
        if !job.rec.output.is_file() {
            return Err(AppError::invalid_input(
                "영상 파일이 없어 채팅을 받을 수 없습니다",
            ));
        }
        // 같은 출력을 다른 작업이 쓰고 있다(영상을 받는 중·채팅 대기·받는 중). 이 채팅이 그 파일 옆에 놓이면 짝이 어긋난다
        let output = job.rec.output.clone();
        if let Some(other) = st.active_with_output(&output, Some(id)) {
            return Err(AppError::duplicate_output(other));
        }
        let Some(job) = st.target(id)? else {
            return Ok(());
        };
        let verified = check(&job.rec.content)?;
        if let Some(ch) = verified {
            job.rec.channel_id = ch;
        }
        let prev = job.rec.chat.take();
        if let Some(c) = prev
            .as_ref()
            .filter(|c| matches!(c.phase, ChatPhase::Waiting | ChatPhase::Running))
        {
            job.rec.chat = Some(c.clone());
            return Ok(());
        }
        let partial = chat_partial_bytes(&job.rec.output, video_no);
        let resume = !restart && partial.is_some();
        let next = match prev {
            Some(c) if resume => ChatState {
                phase: ChatPhase::Waiting,
                on_existing,
                error: None,
                partial_bytes: partial,
                ..c
            },
            prev => ChatState {
                restart,
                // 지금 남은 파일은 시작 때 코어가 비운다. 그때까지는 받은 부분이 있는 것으로 둔다(정리에서 빠진다)
                partial_bytes: partial,
                duration_ms: prev.and_then(|c| c.duration_ms),
                ..ChatState::waiting(setting, on_existing)
            },
        };
        let chat = next.to_dto();
        job.rec.chat = Some(next);
        st.chat.push(id);
        self.inner.save(&st);
        st.emit(JobEvent::Chat { id, chat });
        self.inner.chat_pump(&mut st);
        Ok(())
    }

    /// 채팅을 멈춘다(`pause_chat`). 받는 중이면 태스크를 멈춰 `paused`(`.part`·sidecar는 남는다), 대기 중이면 줄에서 빼
    /// `paused`. 그 밖의 상태에는 아무것도 하지 않는다. 채팅이 없는 작업은 `invalidInput`.
    pub fn pause_chat(&self, id: JobId) -> Result<(), AppError> {
        let mut st = self.inner.lock();
        let running = st.chat.running_id() == Some(id);
        let Some(job) = st.target(id)? else {
            return Ok(());
        };
        let output = job.rec.output.clone();
        let video_no = video_no_of(&job.rec.content);
        let Some(c) = job.rec.chat.as_mut() else {
            return Err(AppError::invalid_input("채팅을 받는 작업이 아닙니다"));
        };
        match c.phase {
            ChatPhase::Running if running => {
                if let Some(r) = st.chat.running_mut() {
                    r.stop = Some(ChatStop::Pause);
                    r.cancel.cancel();
                }
            }
            ChatPhase::Waiting => {
                c.phase = ChatPhase::Paused;
                c.partial_bytes = video_no.and_then(|no| chat_partial_bytes(&output, no));
                let chat = c.to_dto();
                st.chat.remove(id);
                self.inner.save(&st);
                st.emit(JobEvent::Chat { id, chat });
            }
            _ => {}
        }
        Ok(())
    }

    /// 완료 작업의 채팅 파일 이름 충돌(`check_chat_output`, chat.md §4.4): 이미 있는 자막(형식이 `none`이 아니면) → 기록 이름.
    /// 채팅만 받을 때는 번호 붙이기를 고를 수 없으므로(짝이 맞지 않는다) 이름만 알려 준다.
    pub fn check_chat_output(
        &self,
        id: JobId,
        subtitle: SubtitleFormat,
    ) -> Result<ChatOutputCheck, AppError> {
        let output = {
            let mut st = self.inner.lock();
            let job = st.visible(id)?;
            chat_target(&job.rec)?;
            job.rec.output.clone()
        };
        let conflict_names = crate::output::chat_paths(&output, subtitle)
            .into_iter()
            .filter(|p| p.exists())
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .collect();
        Ok(ChatOutputCheck { conflict_names })
    }

    /// 채팅 태스크가 돌고 있는가(잠자기 방지 집계용, chat.md §4.2. 창 닫기 확인에는 세지 않는다).
    pub fn chat_running(&self) -> bool {
        self.inner.lock().chat.running_id().is_some()
    }

    /// `interrupted`를 모두 다시 줄 세운다(id 순). 같은 경로의 활성 작업이 있으면 그 작업은 건너뛴다.
    /// 영상이 완료된 작업의 `interrupted` 채팅도 채팅 줄에 세운다(chat.md §4.2).
    /// 재시작 후 자동 이어받기(설정)에 쓴다. 줄 세운 수를 돌려준다.
    pub fn resume_interrupted(&self) -> usize {
        self.resume_interrupted_where(|_, _| true)
    }

    /// 자동 이어받기 후보(`resume_interrupted_where`와 같은 거르기)를 줄 세우지 않고 돌려준다. 호출자가 작업마다
    /// 컨텐츠를 다시 판정한 뒤 `resume_job` 경로로 줄 세운다(맡은 채널, app.md 구현 중 변경 79 (아))
    pub fn interrupted_where(
        &self,
        keep: impl Fn(&ContentRef, Option<&str>) -> bool,
    ) -> Vec<JobId> {
        let st = self.inner.lock();
        Self::auto_resume_ids(&st, keep)
    }

    fn auto_resume_ids(st: &State, keep: impl Fn(&ContentRef, Option<&str>) -> bool) -> Vec<JobId> {
        st.jobs
            .values()
            .filter(|j| {
                !j.removing
                    && j.rec.status == JobStatus::Interrupted
                    // `.part`가 없는 생방송은 자동으로 다시 시작하지 않는다: 지금 방송 중인 다른 방송을 옛 제목·시각의
                    // 파일로 녹화하게 된다. 받은 영상 조각이 있으면 그것을 마무리하는 것이라 줄 세운다.
                    // init만 든 `.part`는 코어가 지우고 지금 방송을 새로 녹화하므로(download/mod.rs) 줄 세우지 않는다(core.md 61 M3)
                    && (!j.is_live() || crate::jobs::live_media_ready(&j.rec))
                    && keep(&j.rec.content, j.rec.channel_id.as_deref())
            })
            .map(|j| j.rec.id)
            .collect()
    }

    /// `resume_interrupted`와 같고, 작업의 컨텐츠와 소유 채널 ID가 `keep`을 통과한 것만 줄 세운다
    /// (A5, 맡은 채널은 생방송을 뺀다 L-D1).
    pub fn resume_interrupted_where(
        &self,
        keep: impl Fn(&ContentRef, Option<&str>) -> bool,
    ) -> usize {
        let mut st = self.inner.lock();
        let ids = Self::auto_resume_ids(&st, &keep);
        let mut n = 0;
        for id in ids {
            if st.blocks_requeue(id).is_some() {
                continue;
            }
            let seq = st.seq();
            let Some(job) = st.jobs.get_mut(&id) else {
                continue;
            };
            self.inner.requeue(job, seq, false);
            let dto = job.dto();
            st.emit(JobEvent::Status { job: dto });
            n += 1;
        }
        // 채팅: 영상이 완료된 작업의 `interrupted` 채팅을 같은 거르기로 줄 세운다(chat.md §4.2)
        let chats: Vec<JobId> = st
            .jobs
            .values()
            .filter(|j| {
                !j.removing
                    && j.rec.status == JobStatus::Completed
                    && j.rec
                        .chat
                        .as_ref()
                        .is_some_and(|c| c.phase == ChatPhase::Interrupted)
                    && keep(&j.rec.content, j.rec.channel_id.as_deref())
            })
            .map(|j| j.rec.id)
            .collect();
        for id in chats {
            let Some(c) = st.jobs.get_mut(&id).and_then(|j| j.rec.chat.as_mut()) else {
                continue;
            };
            c.phase = ChatPhase::Waiting;
            let chat = c.to_dto();
            st.chat.push(id);
            st.emit(JobEvent::Chat { id, chat });
            n += 1;
        }
        if n > 0 {
            self.inner.save(&st);
            self.inner.pump(&mut st);
            self.inner.chat_pump(&mut st);
        }
        n
    }

    /// 업데이트 설치가 `quit` 뒤에 실패했을 때(A4, D7): quit이 시간 안에 멈춘 작업(`quit_stopped` 중 지금 `interrupted`이고
    /// 지우는 중이 아닌 것)을 다시 줄 세우고 스케줄러를 켠다. 사용자가 일시정지한 작업(`paused`)은 그대로다.
    /// 줄 세운 수를 돌려준다. `quit`이 끝나기 전에는 부르지 않는다.
    pub fn cancel_quit(&self) -> usize {
        let mut st = self.inner.lock();
        st.scheduler_enabled = true;
        let ids = std::mem::take(&mut st.quit_stopped);
        let mut n = 0;
        for id in ids {
            let Some(job) = st.jobs.get(&id) else {
                continue;
            };
            if job.removing || job.rec.status != JobStatus::Interrupted {
                continue;
            }
            if st.blocks_requeue(id).is_some() {
                continue;
            }
            let seq = st.seq();
            let Some(job) = st.jobs.get_mut(&id) else {
                continue;
            };
            self.inner.requeue(job, seq, false);
            let dto = job.dto();
            st.emit(JobEvent::Status { job: dto });
            n += 1;
        }
        // quit이 멈춘 채팅도 되살린다(멈춘 뒤 끝났으면 `interrupted`다)
        if let Some(cid) = st.quit_stopped_chat.take()
            && let Some(job) = st.jobs.get_mut(&cid).filter(|j| !j.removing)
            && let Some(c) = job.rec.chat.as_mut()
            && c.phase == ChatPhase::Interrupted
        {
            c.phase = ChatPhase::Waiting;
            let chat = c.to_dto();
            st.chat.push(cid);
            st.emit(JobEvent::Chat { id: cid, chat });
            n += 1;
        }
        if n > 0 {
            self.inner.save(&st);
        }
        self.inner.pump(&mut st);
        self.inner.chat_pump(&mut st);
        n
    }

    /// 목록에서 지운다(UX의 "취소"도 이것이다).
    ///
    /// - `completed`·`skipped`: 레코드만 지운다(파일은 둔다). 단 받는 동안 같은 이름의 파일이 생겨 건너뛴
    ///   `skipped`(받은 `.part`가 남음, `partial_bytes`가 있음)는 `failed`처럼 `.part`도 지운다.
    /// - `running`·`pausing`: 취소 → 태스크 종료 대기(잠금 밖) → `discard_partial` → 지운다.
    ///   종료 중(`quit` 뒤)에는 아무것도 하지 않는다(`quit`이 핸들을 가져가 기다릴 수 없고, 곧 `interrupted`로 저장된다).
    /// - `queued`·`paused`·`interrupted`·`failed`: `discard_partial` → 지운다(다시 줄 선 작업도 `.part`가 있을 수 있다).
    ///   quit 기한을 넘긴 옛 태스크가 아직 돌면(`detached`) 받는 중처럼 그 끝을 기다린 뒤 지운다.
    ///   단 `failed`의 경로를 다른 활성 작업이 가져갔으면 `.part`는 그 작업의 것이므로 레코드만 지운다.
    /// - `.part`의 sidecar가 이 작업의 것이 아니면(`Discarded::NotOwned`) 지우지 않고 레코드만 지운다(core.md 61).
    ///
    /// `.part`를 지우지 못하면(다른 프로그램이 잠금 등) 오류를 돌려주고 레코드를 멈춘 상태로 남긴다.
    pub async fn remove(&self, id: JobId) -> Result<(), AppError> {
        let (handle, chat_handle, output, rec) = {
            let mut st = self.inner.lock();
            let quitting = !st.scheduler_enabled;
            let chat_running = st.chat.running_id() == Some(id);
            let Some(job) = st.target(id)? else {
                // 이미 지우는 중이다
                return Ok(());
            };
            let output = job.rec.output.clone();
            // `.part`의 주인을 가릴 열쇠. 잠금 밖에서 지울 때 쓴다
            let rec = job.rec.clone();
            let records_only = match job.rec.status {
                // 채팅이 돌고 있거나 받다 만 채팅 파일이 있으면 그것을 멈추고 지운 뒤 레코드를 지운다(D2 변형, chat.md §4.3).
                // 영상과 완성된 채팅 파일은 어느 쪽이든 그대로다
                JobStatus::Completed => {
                    !chat_running
                        && !job
                            .rec
                            .chat
                            .as_ref()
                            .is_some_and(|c| c.partial_bytes.is_some())
                }
                // 건너뛴 작업은 받다 남긴 `.part`가 있을 때만 지운다(받는 동안 같은 이름의 파일이 생긴 경우)
                JobStatus::Skipped if job.rec.partial_bytes.is_none() => true,
                // 경로를 다른 활성 작업이 가져갔다. `.part`는 그 작업의 것이다
                JobStatus::Failed | JobStatus::Skipped => {
                    st.active_with_output(&output, Some(id)).is_some()
                }
                // 종료 중: `quit`이 이미 태스크를 멈추고 핸들을 가져갔다. 기다릴 수 없으니 `.part`를 건드리지 않고
                // `quit`이 `interrupted`로 저장하게 둔다(앱이 곧 꺼진다).
                JobStatus::Running | JobStatus::Pausing if quitting => return Ok(()),
                _ => false,
            };
            if records_only {
                st.chat.remove(id);
                st.jobs.remove(&id);
                self.inner.save(&st);
                st.emit(JobEvent::Removed { id });
                return Ok(());
            }
            let job = st.visible(id)?;
            job.removing = true;
            // quit 기한을 넘긴 옛 태스크(`detached`)도 아직 `.part`를 쓰므로 받는 중처럼 끝을 기다린다(80)
            let handle = if job.busy() || job.detached.is_some() {
                job.stop = Some(StopReason::Remove);
                job.rec.status = JobStatus::Pausing;
                if let Some(c) = &job.cancel {
                    c.cancel();
                }
                let handle = job.handle.take();
                let dto = job.dto();
                self.inner.save(&st);
                st.emit(JobEvent::Status { job: dto });
                handle
            } else {
                if job.rec.status == JobStatus::Queued {
                    // 지우는 동안 pump가 시작하지 않게(이벤트는 보내지 않는다. 곧 Removed다)
                    job.rec.set_status(JobStatus::Paused, now_secs());
                }
                None
            };
            // 채팅: 줄에서 빼고, 돌고 있으면 멈춘 뒤(잠금 밖에서 기다린다) 받다 만 채팅 파일을 지운다
            st.chat.remove(id);
            let chat_handle = match st.chat.running_mut() {
                Some(r) if r.id == id => {
                    r.stop = Some(ChatStop::Remove);
                    r.cancel.cancel();
                    r.handle.take()
                }
                _ => None,
            };
            (handle, chat_handle, output, rec)
        };
        if let Some(h) = handle {
            // 바깥 태스크는 패닉을 안쪽에서 받으므로 여기서 JoinError가 나는 것은 런타임 종료뿐이다.
            let _ = h.await;
        }
        if let Some(h) = chat_handle {
            let _ = h.await;
        }
        // 같은 받다 만 채팅 파일을 다른 기록도 쥐고 있으면 채팅 파일은 남긴다(그 기록의 것이기도 하다)
        let chat_shared = self.inner.lock().chat_part_shared(&output, id);
        // 완료된 영상에는 `.part`가 없다(남은 것은 채팅뿐이다)
        let discarded = if rec.status == JobStatus::Completed {
            Ok(Discarded::Removed)
        } else {
            discard_partial(&output, &rec.owner())
        }
        .and_then(|d| match (&rec.content, &rec.chat) {
            (ContentRef::Video { video_no }, Some(_)) if !chat_shared => {
                discard_chat_partial(&output, *video_no).map(|_| d)
            }
            _ => Ok(d),
        });

        let mut st = self.inner.lock();
        match discarded {
            Ok(d) => {
                if d == Discarded::NotOwned {
                    tracing::info!(job = id.0, "다른 작업의 .part라 레코드만 지웠다");
                }
                st.chat.remove(id);
                if st.jobs.remove(&id).is_some() {
                    self.inner.save(&st);
                    st.emit(JobEvent::Removed { id });
                }
                self.inner.pump(&mut st);
                self.inner.chat_pump(&mut st);
                Ok(())
            }
            Err(e) => {
                tracing::warn!(error = %e, job = id.0, "지우려던 작업의 .part를 지우지 못했다");
                if let Some(job) = st.jobs.get_mut(&id) {
                    job.removing = false;
                    job.stop = None;
                    if job.busy() {
                        // 태스크 종료를 기다리지 못한 경우(런타임 종료). 멈춘 것으로 둔다
                        job.rec.set_status(JobStatus::Paused, now_secs());
                    }
                    job.rec.partial_bytes = partial_bytes(&job.rec);
                    // 멈춘 채팅은 일시정지로 남기고 받은 부분을 다시 센다(지우기를 다시 누를 수 있다)
                    let video_no = video_no_of(&job.rec.content);
                    if let (Some(c), Some(no)) = (&mut job.rec.chat, video_no) {
                        if c.phase == ChatPhase::Running {
                            c.phase = ChatPhase::Paused;
                        }
                        c.partial_bytes = chat_partial_bytes(&job.rec.output, no);
                    }
                    let dto = job.dto();
                    self.inner.save(&st);
                    st.emit(JobEvent::Status { job: dto });
                }
                Err(AppError::from(&e))
            }
        }
    }

    /// `completed`·`skipped`를 모두 지운다(파일은 둔다). 받은 `.part`가 남은 `skipped`는 남긴다(`Job::clearable`).
    pub fn clear_finished(&self) {
        let mut st = self.inner.lock();
        let ids: Vec<JobId> = st
            .jobs
            .values()
            .filter(|j| j.clearable())
            .map(|j| j.rec.id)
            .collect();
        if ids.is_empty() {
            return;
        }
        for id in ids {
            st.jobs.remove(&id);
            st.emit(JobEvent::Removed { id });
        }
        self.inner.save(&st);
    }

    /// 작업의 최종 경로와 상태(`open_output`·`reveal_output`용).
    pub fn output_of(&self, id: JobId) -> Result<(PathBuf, JobStatus), AppError> {
        let mut st = self.inner.lock();
        let j = st.visible(id)?;
        Ok((j.rec.output.clone(), j.rec.status))
    }

    /// 앱 종료 준비. 새 작업을 시작하지 않고, 받는 중인 작업을 모두 멈춰 최대 `timeout`까지 기다린다.
    ///
    /// 멈춘 작업은 `interrupted`로 저장한다(사용자가 일시정지한 `pausing`은 `paused`). 시간 안에 끝나지 않은
    /// 작업도 `interrupted`로 저장한다. 코어의 크래시 불변식(`committed_len`) 덕분에 다음 시작 때 이어받을 수 있다.
    /// 대기 중(`queued`)인 작업은 그대로 저장되고 다음 시작 때 reconcile이 `interrupted`로 바꾼다.
    /// 프로세스 종료(`app.exit`)는 부르는 쪽이 한다.
    pub async fn quit(&self, timeout: Duration) {
        let mut handles: Vec<(JobId, JoinHandle<()>)> = {
            let mut st = self.inner.lock();
            st.scheduler_enabled = false;
            // 되살린 뒤 다시 quit해도 옛 id가 남지 않게 비우고 이번에 멈추는 작업으로 채운다
            st.quit_stopped.clear();
            let mut stopped = Vec::new();
            let mut handles = Vec::new();
            let mut changed = Vec::new();
            for job in st.jobs.values_mut() {
                if job.rec.status == JobStatus::Running {
                    stopped.push(job.rec.id);
                    // 생방송은 취소가 아니라 마무리한다(받은 만큼이 바로 재생 가능한 파일이 된다)
                    job.stop = Some(if job.is_live() {
                        StopReason::Finish
                    } else {
                        StopReason::Quit
                    });
                    job.rec.status = JobStatus::Pausing;
                    job.signal_stop();
                    changed.push(job.dto());
                }
                if job.busy()
                    && let Some(h) = job.handle.take()
                {
                    handles.push((job.rec.id, h));
                }
            }
            st.quit_stopped = stopped;
            // 채팅: 멈춰 `interrupted`로 남긴다(커서부터 이어받으므로 잃는 것이 없다, chat.md §4.2). 같은 기한 안에서 기다린다
            st.quit_stopped_chat = None;
            if let Some(r) = st.chat.running_mut() {
                r.stop = Some(ChatStop::Quit);
                r.cancel.cancel();
                let id = r.id;
                if let Some(h) = r.handle.take() {
                    handles.push((id, h));
                }
                st.quit_stopped_chat = Some(id);
            }
            if !changed.is_empty() {
                self.inner.save(&st);
            }
            for dto in changed {
                st.emit(JobEvent::Status { job: dto });
            }
            handles
        };
        let all = async {
            for (_, h) in handles.iter_mut() {
                let _ = h.await;
            }
        };
        if tokio::time::timeout(timeout, all).await.is_err() {
            tracing::warn!("종료 대기 시간 안에 멈추지 않은 작업이 있다");
        }
        {
            let mut st = self.inner.lock();
            let mut late = Vec::new();
            let mut late_ids = Vec::new();
            for job in st.jobs.values_mut() {
                if job.busy() && !job.removing {
                    job.rec.set_status(JobStatus::Interrupted, now_secs());
                    job.rec.partial_bytes = partial_bytes(&job.rec);
                    // 태스크가 아직 돈다: 그 `finish`가 올 때까지 슬롯·경로를 차지하고 새로 시작하지 않는다(80).
                    // 핸들을 돌려줘 `remove`가 옛 태스크의 끝을 기다린 뒤 `.part`를 지우게 한다
                    job.detached = Some(job.run);
                    let id = job.rec.id;
                    if let Some(i) = handles
                        .iter()
                        .position(|(h_id, h)| *h_id == id && !h.is_finished())
                    {
                        job.handle = Some(handles.swap_remove(i).1);
                    }
                    late.push(job.dto());
                    late_ids.push(job.rec.id);
                }
            }
            // 기한 안에 끝나지 않은 채팅도 `interrupted`로 저장한다(태스크의 끝은 같은 세대라 나중에 와도 `interrupted`다)
            if let Some(cid) = st.chat.running_id()
                && let Some(c) = st.jobs.get_mut(&cid).and_then(|j| j.rec.chat.as_mut())
                && c.phase == ChatPhase::Running
            {
                c.phase = ChatPhase::Interrupted;
                let chat = c.to_dto();
                st.emit(JobEvent::Chat { id: cid, chat });
            }
            // 시간 안에 멈추지 않은 작업은 태스크가 아직 돈다. `cancel_quit`이 되살리면 옛 태스크와 겹치므로
            // 되살릴 목록에서 뺀다(사용자가 B1 [모두 이어받기]로 다시 줄 세운다. 옛 태스크가 끝난 뒤에 시작한다, 76·80)
            st.quit_stopped.retain(|id| !late_ids.contains(id));
            self.inner.save(&st);
            for dto in late {
                st.emit(JobEvent::Status { job: dto });
            }
        }
        // 프로세스가 끝나기 전에 마지막 목록이 디스크에 닿게 한다.
        let flusher: Flusher = self.inner.writer.flusher();
        if tokio::task::spawn_blocking(move || flusher.flush())
            .await
            .is_err()
        {
            tracing::warn!("작업 목록 저장을 기다리지 못했다");
        }
    }
}

/// 채팅만 받을 수 있는 작업인가: 완료된 영상(Video) 전체 받기. 그 영상 번호.
fn chat_target(rec: &JobRecord) -> Result<u64, AppError> {
    if rec.status != JobStatus::Completed {
        return Err(AppError::invalid_input(
            "완료된 작업에서만 채팅을 받을 수 있습니다",
        ));
    }
    match (&rec.content, rec.range) {
        (ContentRef::Video { video_no }, None) => Ok(*video_no),
        _ => Err(AppError::invalid_input(
            "채팅은 영상 전체를 받은 작업에서만 받을 수 있습니다",
        )),
    }
}

/// 영상(Video)이면 그 번호.
fn video_no_of(c: &ContentRef) -> Option<u64> {
    match c {
        ContentRef::Video { video_no } => Some(*video_no),
        _ => None,
    }
}

/// 요청 폴더(공백뿐이면 무시) → 기본 폴더. 절대 경로가 아니거나, UTF-8이 아니거나, `.`·`..` 구성 요소가 있으면
/// `invalidInput`. 기본 폴더(설정 폴더)도 같이 검사한다(옛 설정이나 손으로 고친 `settings.json`).
///
/// UTF-8 검사는 기본 폴더 때문이다(요청 폴더는 이미 `&str`). Linux의 XDG 동영상 폴더처럼 OS가 준 경로는 아무
/// 바이트나 담을 수 있는데, serde는 `PathBuf`를 UTF-8로만 쓰므로 그런 작업 하나가 `jobs.json` 저장 전체를 막는다.
fn resolve_folder(folder: Option<&str>, default: &Path) -> Result<PathBuf, AppError> {
    let folder = match folder.map(str::trim) {
        Some(f) if !f.is_empty() => PathBuf::from(f),
        _ => default.to_path_buf(),
    };
    if folder.to_str().is_none() {
        return Err(AppError::invalid_input(format!(
            "저장 폴더 경로에 쓸 수 없는 글자가 있습니다: {}",
            folder.display()
        )));
    }
    if !folder.is_absolute() {
        return Err(AppError::invalid_input(format!(
            "저장 폴더가 절대 경로가 아닙니다: {}",
            folder.display()
        )));
    }
    if let Some(f) = folder.to_str() {
        check_folder_segments(f, "저장 폴더")?;
    }
    Ok(folder)
}

/// 폴더 경로에 `.`·`..` 구성 요소가 있으면 `invalidInput`.
///
/// 같은 파일을 다른 글자로 가리키는 길을 막아 중복 경로 검사(`output_key`)를 지키려는 것이다.
/// `/tmp/videos/../videos`는 `/tmp/videos`와 같은 파일인데 열쇠는 다르다. `..`를 글자로 풀지 않고 거부하는
/// 것은 심볼릭 링크를 지나면 글자로 푼 결과가 실제 위치와 다르기 때문이다. `Path::components()`는 중간의
/// `.`를 말없이 버리므로 원래 글자를 구분자로 나눠 본다(Windows는 `/`와 `\` 둘 다).
pub fn check_folder_segments(folder: &str, what: &str) -> Result<(), AppError> {
    let is_sep = |c: char| c == '/' || (cfg!(windows) && c == '\\');
    if folder.split(is_sep).any(|seg| seg == "." || seg == "..") {
        return Err(AppError::invalid_input(format!(
            "{what}에 `.`이나 `..`를 쓸 수 없습니다. 폴더를 다시 골라 주세요: {folder}"
        )));
    }
    Ok(())
}

impl<B: Backend> Inner<B> {
    /// 멈춘 작업을 다시 줄 세운다.
    fn requeue(&self, job: &mut Job, seq: u64, restart: bool) {
        let r = &mut job.rec;
        if r.status == JobStatus::Skipped {
            r.on_existing = OnExisting::Overwrite;
        }
        if restart {
            r.discard_on_start = true;
            r.partial_bytes = None;
            job.last_progress = None;
            // 처음부터: 받다 만 채팅도 버린다(시작 때 `run_download`가 지운다). 완성된 채팅 파일은 건드리지 않는다(§4.3)
            if let Some(c) = &mut r.chat {
                // 지우지 못해도 다음 채팅은 처음부터 받는다(`restart`)
                *c = ChatState {
                    restart: true,
                    ..ChatState::waiting(c.subtitle, c.on_existing)
                };
            }
        }
        r.set_status(JobStatus::Queued, 0);
        r.last_error = None;
        r.finished_at = None;
        job.stop = None;
        job.queue_seq = seq;
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        // 잠금 안에서 패닉해도 상태는 한 전이 단위로만 바뀐다. 계속 쓴다.
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 목록을 바이트로 만들어 쓰기 스레드에 넘긴다(잠금 안에서 불러 제출 순서 = 전이 순서). 막지 않는다.
    fn save(&self, st: &State) {
        match JobStore::encode(&st.file()) {
            Ok(bytes) => self.writer.submit(bytes),
            Err(e) => tracing::warn!(error = %e, "작업 목록을 직렬화하지 못했다"),
        }
    }

    /// 슬롯이 있는 동안 가장 먼저 줄 선 `queued`를 시작한다.
    fn pump(self: &Arc<Self>, st: &mut State) {
        while st.scheduler_enabled {
            let busy = |live: bool| {
                st.jobs
                    .values()
                    .filter(|j| j.occupies_slot() && j.is_live() == live)
                    .count()
            };
            // lane마다 자리가 있는지 본다(생방송 lane은 `MAX_LIVE`, 나머지는 설정의 동시 작업 수)
            let (vod_free, live_free) = (busy(false) < st.max_running, busy(true) < MAX_LIVE);
            let next = st
                .jobs
                .values()
                .filter(|j| {
                    j.rec.status == JobStatus::Queued
                        && j.detached.is_none()
                        && if j.is_live() { live_free } else { vod_free }
                })
                .min_by_key(|j| j.queue_seq)
                .map(|j| j.rec.id);
            let Some(id) = next else { break };
            self.start(st, id);
        }
    }

    /// `queued` → `running`, 태스크를 띄운다. 잠금을 쥔 채 부르므로 태스크의 첫 이벤트는 `Status(running)` 뒤다.
    fn start(self: &Arc<Self>, st: &mut State, id: JobId) {
        let client = (self.client)();
        let run = st.seq();
        // 영상 "처음부터"도 다른 기록과 함께 쥔 받다 만 채팅 파일은 지우지 않는다(`remove`와 같다)
        let chat_shared = st
            .jobs
            .get(&id)
            .is_some_and(|j| st.chat_part_shared(&j.rec.output, id));
        let Some(job) = st.jobs.get_mut(&id) else {
            return;
        };
        if job.detached.is_some() {
            // 옛 태스크가 아직 돈다(pump가 거르지만 한 번 더 지킨다)
            return;
        }
        job.run = run;
        let r = &mut job.rec;
        r.set_status(JobStatus::Running, 0);
        r.last_error = None;
        r.finished_at = None;
        r.final_bytes = None;
        r.live_end = None; // 다시 줄 선 작업이 옛 끝 정보를 들고 다니지 않게(방어, 완료 작업은 resume이 거부한다)
        r.partial_bytes = None;
        r.missing = false;
        job.stop = None;
        let cancel = CancellationToken::new();
        job.cancel = Some(cancel.clone());
        job.live_stop = job.is_live().then(CancellationToken::new);
        let mut req = job.rec.to_request();
        req.live_stop = job.live_stop.clone();
        let discard = job.rec.discard_on_start;
        let chat_video = match (&job.rec.content, &job.rec.chat) {
            (ContentRef::Video { video_no }, Some(_)) if discard && !chat_shared => Some(*video_no),
            _ => None,
        };
        // 아직 저장을 확인하지 못한 새 녹화: 태스크가 쓰기 스레드를 기다린다(상태 잠금 밖)
        let confirm = (!job.saved).then(|| self.writer.flusher());

        let me = Arc::clone(self);
        let runtime = self.runtime.clone();
        let handle = self.runtime.spawn(async move {
            // 다운로드는 안쪽 태스크로 돌려 패닉해도 `finish`가 불리게 한다.
            let work = runtime.spawn(run_download(
                Arc::clone(&me),
                id,
                run,
                req,
                Before {
                    discard,
                    confirm,
                    chat_video,
                },
                cancel,
                client,
            ));
            let end = match work.await {
                Ok(end) => end,
                Err(e) => End::Failed(AppError::internal(format!(
                    "작업 태스크가 비정상 종료했습니다: {e}"
                ))),
            };
            me.finish(id, run, end);
        });
        job.handle = Some(handle);
        let dto = job.dto();
        self.save(st);
        st.emit(JobEvent::Status { job: dto });
    }

    /// 새 녹화의 주인 기록이 저장된 것을 확인했다. 다음 시작은 기다리지 않는다.
    fn confirm_saved(&self, id: JobId, run: u64) {
        let mut st = self.lock();
        if let Some(j) = st.jobs.get_mut(&id)
            && j.run == run
        {
            j.saved = true;
        }
    }

    /// `restart`로 지운 뒤 표시를 내린다.
    fn discarded(&self, id: JobId, run: u64) {
        let mut st = self.lock();
        if let Some(j) = st.jobs.get_mut(&id)
            && j.run == run
        {
            j.rec.discard_on_start = false;
            self.save(&st);
        }
    }

    fn on_progress(&self, id: JobId, run: u64, p: &Progress) {
        let dto = ProgressDto::from(p);
        let mut st = self.lock();
        let Some(j) = st.jobs.get_mut(&id) else {
            return;
        };
        if !j.busy() || j.run != run {
            return;
        }
        j.last_progress = Some(dto.clone());
        st.emit(JobEvent::Progress { id, progress: dto });
    }

    /// 태스크가 끝났다. 상태를 정하고 저장·알린 뒤 다음 작업을 시작한다.
    ///
    /// `run`이 지금 세대가 아니면 옛 태스크다: 레코드·취소 토큰·핸들은 새 세대의 것이므로 건드리지 않는다.
    /// quit 기한을 넘긴 세대(`detached`)가 끝나면 슬롯·경로를 풀고, 그동안 사용자가 다시 줄 세웠거나(`queued`)
    /// 멈췄으면(`paused`) 그 상태를 그대로 둔다(80).
    fn finish(self: &Arc<Self>, id: JobId, run: u64, end: End) {
        let mut st = self.lock();
        if let Some(job) = st.jobs.get_mut(&id) {
            if job.run != run {
                tracing::debug!(job = id.0, "옛 세대 태스크의 끝은 버린다");
                self.pump(&mut st);
                return;
            }
            let was_detached = job.detached.take().is_some();
            job.cancel = None;
            job.live_stop = None;
            job.handle = None;
            if was_detached && !job.removing && job.rec.status != JobStatus::Interrupted {
                // quit 뒤 다시 줄 세웠거나 멈춘 작업: 옛 태스크가 끝났으니 슬롯만 푼다
                self.pump(&mut st);
                return;
            }
            let stop = job.stop.take();
            if job.removing {
                // `remove`가 이어서 `.part`를 지우고 레코드를 없앤다. 그때까지 중복 검사에는 남도록 멈춘 상태로 둔다.
                job.rec.set_status(JobStatus::Paused, now_secs());
                self.pump(&mut st);
                return;
            }
            let r = &mut job.rec;
            let now = now_secs();
            let mut queue_chat = false;
            match end {
                End::Done(DownloadOutcome::Completed { bytes, live, .. }) => {
                    r.set_status(JobStatus::Completed, now);
                    r.final_bytes = Some(bytes);
                    r.live_end = live.map(LiveEndDto::from);
                    r.finished_at = Some(now_secs());
                    r.partial_bytes = None;
                    job.last_progress = None;
                    // 영상이 끝났다: 기다리던 채팅을 줄 세운다(U1, chat.md §4.2). 생방송·클립은 `chat`이 늘 없다
                    queue_chat = r
                        .chat
                        .as_ref()
                        .is_some_and(|c| c.phase == ChatPhase::Waiting);
                }
                End::Done(DownloadOutcome::Skipped { .. }) => {
                    r.set_status(JobStatus::Skipped, now);
                    r.finished_at = Some(now_secs());
                    // 건너뛴 영상(받은 것 없음)에는 채팅을 붙이지 않는다. [⋯] › "채팅 받기"로 받을 수 있다(§4.3)
                    if r.chat
                        .as_ref()
                        .is_some_and(|c| c.phase == ChatPhase::Waiting)
                    {
                        r.chat = None;
                    }
                    // 받는 동안 같은 이름의 파일이 생겼으면 코어가 `.part`를 남긴다("덮어쓰고 받기"로 이어받는다).
                    r.partial_bytes = partial_bytes(r);
                    job.last_progress = None;
                }
                End::Cancelled => match stop {
                    Some(StopReason::Pause | StopReason::Finish) => {
                        r.set_status(JobStatus::Paused, now);
                        r.partial_bytes = partial_bytes(r);
                    }
                    Some(StopReason::Quit) => {
                        r.set_status(JobStatus::Interrupted, now);
                        r.partial_bytes = partial_bytes(r);
                    }
                    Some(StopReason::Remove) | None => {
                        r.set_status(JobStatus::Failed, now);
                        r.last_error = Some(AppError::internal("멈춘 이유 없이 취소되었습니다"));
                        r.partial_bytes = partial_bytes(r);
                    }
                },
                End::Error(e) => {
                    let stage = stage_of(job.last_progress.as_ref());
                    r.set_status(JobStatus::Failed, now);
                    r.last_error = Some(AppError::from(&e).at(stage));
                    r.partial_bytes = partial_bytes(r);
                }
                End::Failed(e) => {
                    r.set_status(JobStatus::Failed, now);
                    r.last_error = Some(e);
                    r.partial_bytes = partial_bytes(r);
                }
            }
            let dto = job.dto();
            let live = job.is_live().then(|| job.rec.clone());
            // Status를 먼저 보낸다. 방금 끝난 작업이 정리 대상이면 Removed가 뒤에 와야 프런트에 유령이 남지 않는다.
            st.emit(JobEvent::Status { job: dto });
            if let Some(rec) = live {
                refresh_siblings(&mut st, &rec);
            }
            if queue_chat {
                st.chat.push(id);
            }
            self.prune_finished(&mut st);
            self.save(&st);
        }
        self.pump(&mut st);
        self.chat_pump(&mut st);
    }

    /// 채팅 줄에서 다음 차례를 시작한다(한 번에 하나, chat.md §4.2). 종료 중에는 시작하지 않는다.
    /// 차례가 왔는데 더는 대기가 아닌 작업(지워짐·지우는 중·영상이 완료가 아님·멈춤)은 건너뛴다.
    fn chat_pump(self: &Arc<Self>, st: &mut State) {
        while st.scheduler_enabled {
            let Some(id) = st.chat.take_next() else { break };
            let ready = st.jobs.get(&id).is_some_and(|j| {
                !j.removing
                    && j.rec.status == JobStatus::Completed
                    && j.rec
                        .chat
                        .as_ref()
                        .is_some_and(|c| c.phase == ChatPhase::Waiting)
            });
            if ready {
                self.start_chat_task(st, id);
            }
        }
    }

    /// 채팅 `waiting` → `running`, 태스크를 띄운다. 잠금을 쥔 채 부르므로 태스크의 첫 보고는 `Chat(running)` 뒤다.
    fn start_chat_task(self: &Arc<Self>, st: &mut State, id: JobId) {
        let client = (self.client)();
        let run = st.seq();
        let Some(job) = st.jobs.get_mut(&id) else {
            return;
        };
        let Some(video_no) = video_no_of(&job.rec.content) else {
            return;
        };
        let content = job.rec.content.clone();
        let output = job.rec.output.clone();
        let Some(c) = job.rec.chat.as_mut() else {
            return;
        };
        c.phase = ChatPhase::Running;
        c.error = None;
        c.subtitle_failed = false;
        let req = ChatRequest {
            video_no,
            output,
            subtitle: c.subtitle,
            duration_ms: c.duration_ms,
            restart: c.restart,
            on_existing: c.on_existing.into(),
        };
        let chat = c.to_dto();
        let cancel = CancellationToken::new();
        let me = Arc::clone(self);
        let runtime = self.runtime.clone();
        let task_cancel = cancel.clone();
        let handle = self.runtime.spawn(async move {
            // 수집은 안쪽 태스크로 돌려 패닉해도 `finish_chat`이 불리게 한다.
            let work = runtime.spawn(run_chat(
                Arc::clone(&me),
                id,
                run,
                content,
                req,
                task_cancel,
                client,
            ));
            let end = match work.await {
                Ok(r) => r.map_err(ChatEnd::Core),
                Err(e) => Err(ChatEnd::Shell(AppError::internal(format!(
                    "채팅 태스크가 비정상 종료했습니다: {e}"
                )))),
            };
            me.finish_chat(id, run, end);
        });
        st.chat.set_running(ChatRun {
            id,
            run,
            cancel,
            handle: Some(handle),
            stop: None,
        });
        self.save(st);
        st.emit(JobEvent::Chat { id, chat });
    }

    /// 처음 알아낸 영상 길이를 채팅 상태에 적는다(다음 이어받기는 다시 묻지 않는다). 저장은 다음 전이 때 한다.
    fn note_chat_duration(&self, id: JobId, run: u64, duration_ms: u64) {
        let mut st = self.lock();
        if st.chat.running_id() != Some(id) || !st.chat.running_mut().is_some_and(|r| r.run == run)
        {
            return;
        }
        if let Some(c) = st.jobs.get_mut(&id).and_then(|j| j.rec.chat.as_mut()) {
            c.duration_ms = Some(duration_ms);
        }
    }

    /// 채팅 진행. 퍼센트는 뒤로 가지 않고(P-4), 퍼센트·메시지 수가 바뀔 때만 알린다. `jobs.json`은 "처음부터"를 내릴 때만 쓴다.
    fn on_chat_progress(&self, id: JobId, run: u64, p: ChatProgress) {
        let mut st = self.lock();
        if !st
            .chat
            .running_mut()
            .is_some_and(|r| r.id == id && r.run == run)
        {
            return;
        }
        // 코어는 `.part`를 열고(`restart`면 비우고) 난 뒤에 첫 진행을 낸다(core.md 66.10·67.4). 그 전의 실패
        // (`FileLocked`·취소·폴더 만들기)에는 "처음부터"가 남아 다음 시작도 처음부터다(Codex PR #141 ②)
        if let Some(c) = st
            .jobs
            .get_mut(&id)
            .and_then(|j| j.rec.chat.as_mut())
            .filter(|c| c.restart)
        {
            c.restart = false;
            self.save(&st);
        }
        let Some(c) = st.jobs.get_mut(&id).and_then(|j| j.rec.chat.as_mut()) else {
            return;
        };
        if c.phase != ChatPhase::Running {
            return;
        }
        let percent = match (c.percent, percent_of(p.cursor_ms, p.duration_ms)) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => b.or(a),
        };
        if percent == c.percent && p.messages == c.messages {
            return;
        }
        c.percent = percent;
        c.messages = p.messages;
        let chat = c.to_dto();
        st.emit(JobEvent::Chat { id, chat });
    }

    /// 채팅 태스크가 끝났다. 하위 상태를 정하고 저장·알린 뒤 다음 채팅을 시작한다. 영상 상태는 건드리지 않는다
    /// (채팅이 실패해도 영상은 완료다).
    fn finish_chat(self: &Arc<Self>, id: JobId, run: u64, end: Result<ChatOutcome, ChatEnd>) {
        let mut st = self.lock();
        let Some(r) = st.chat.finish(id, run) else {
            tracing::debug!(job = id.0, "옛 세대 채팅 태스크의 끝은 버린다");
            self.chat_pump(&mut st);
            return;
        };
        let Some(job) = st.jobs.get_mut(&id) else {
            self.chat_pump(&mut st);
            return;
        };
        if job.removing {
            // `remove`가 이어서 채팅 파일을 지우고 레코드를 없앤다
            self.chat_pump(&mut st);
            return;
        }
        let output = job.rec.output.clone();
        let video_no = video_no_of(&job.rec.content);
        let Some(c) = job.rec.chat.as_mut() else {
            self.chat_pump(&mut st);
            return;
        };
        let partial = || video_no.and_then(|no| chat_partial_bytes(&output, no));
        match end {
            Ok(ChatOutcome::Completed {
                messages,
                subtitle_failed,
                ..
            }) => {
                tracing::info!(job = id.0, messages, subtitle_failed, "채팅을 받았다");
                c.phase = ChatPhase::Completed;
                // 코어가 끝까지 갔으면 `.part`를 열었다(진행을 흉내 내지 않는 Backend도 같게)
                c.restart = false;
                c.messages = messages;
                c.percent = None;
                c.error = None;
                c.subtitle_failed = subtitle_failed;
                c.partial_bytes = None;
            }
            Ok(ChatOutcome::TargetExists { .. }) => {
                tracing::info!(
                    job = id.0,
                    "받는 동안 같은 이름의 채팅 파일이 생겨 덮어쓰지 않았다"
                );
                c.phase = ChatPhase::Conflict;
                c.restart = false;
                c.partial_bytes = partial();
            }
            Err(ChatEnd::Core(chzzk_core::Error::Cancelled)) => {
                c.phase = match r.stop {
                    Some(ChatStop::Pause | ChatStop::Remove) => ChatPhase::Paused,
                    Some(ChatStop::Quit) => ChatPhase::Interrupted,
                    None => {
                        c.error = Some(AppError::internal("멈춘 이유 없이 취소되었습니다"));
                        ChatPhase::Failed
                    }
                };
                c.partial_bytes = partial();
            }
            Err(ChatEnd::Core(e)) => {
                // 오류 문구에는 닉네임·본문이 없다(코어 오류는 종류·경로·상태만 담는다)
                tracing::warn!(job = id.0, kind = ?e.kind(), "채팅을 받지 못했다");
                c.phase = ChatPhase::Failed;
                c.error = Some(AppError::from(&e));
                c.partial_bytes = partial();
            }
            Err(ChatEnd::Shell(e)) => {
                c.phase = ChatPhase::Failed;
                c.error = Some(e);
                c.partial_bytes = partial();
            }
        }
        let chat = c.to_dto();
        self.save(&st);
        st.emit(JobEvent::Chat { id, chat });
        self.chat_pump(&mut st);
    }

    /// 완료·건너뜀이 `MAX_FINISHED`를 넘으면 오래된 것부터 지운다.
    fn prune_finished(&self, st: &mut State) {
        let mut finished: Vec<(u64, JobId)> = st
            .jobs
            .values()
            .filter(|j| j.clearable())
            .map(|j| (j.rec.finished_at.unwrap_or(0), j.rec.id))
            .collect();
        if finished.len() <= MAX_FINISHED {
            return;
        }
        finished.sort_unstable();
        let extra = finished.len() - MAX_FINISHED;
        for (_, id) in finished.into_iter().take(extra) {
            st.jobs.remove(&id);
            st.emit(JobEvent::Removed { id });
        }
    }
}

/// 채팅 태스크의 실패.
enum ChatEnd {
    Core(Error),
    /// 셸 쪽 실패(태스크 패닉)
    Shell(AppError),
}

/// 채팅 태스크 본체. 영상 길이를 아직 모르면 한 번 알아낸다(퍼센트·자막 꼬리 컷, 실패하면 길이 없이 받는다).
async fn run_chat<B: Backend>(
    inner: Arc<Inner<B>>,
    id: JobId,
    run: u64,
    content: ContentRef,
    mut req: ChatRequest,
    cancel: CancellationToken,
    client: Arc<B>,
) -> Result<ChatOutcome, Error> {
    if req.duration_ms.is_none() {
        let looked = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(Error::Cancelled),
            r = client.resolve(&content) => r,
        };
        match looked {
            Ok(r) => {
                req.duration_ms = r
                    .meta
                    .duration_secs
                    .filter(|s| s.is_finite() && *s > 0.0)
                    .map(|s| (s * 1000.0) as u64);
                if let Some(ms) = req.duration_ms {
                    inner.note_chat_duration(id, run, ms);
                }
            }
            Err(e) => {
                tracing::info!(job = id.0, kind = ?e.kind(), "영상 길이를 몰라 메시지 수만 보인다")
            }
        }
    }
    if cancel.is_cancelled() {
        return Err(Error::Cancelled);
    }
    let cb = Arc::clone(&inner);
    let on_progress = move |p: ChatProgress| cb.on_chat_progress(id, run, p);
    client.collect_chat(req, cancel, &on_progress).await
}

/// 실패한 단계. 마지막 진행률이 없거나 (재)조회 중이었으면 `resolve`, 받는 중·마무리 중이었으면 `download`.
fn stage_of(last: Option<&ProgressDto>) -> Stage {
    match last.map(|p| p.phase) {
        None | Some(Phase::Resolving) | Some(Phase::Reresolving) => Stage::Resolve,
        // 연결 대기는 받는 중(또는 작업 안 재조회) 도중의 인내라 download 단계로 센다(core.md 56).
        Some(Phase::Downloading) | Some(Phase::WaitingNetwork) | Some(Phase::Finalizing) => {
            Stage::Download
        }
    }
}

/// 코어를 부르기 전에 할 일.
struct Before {
    /// "처음부터": `.part`를 지운다
    discard: bool,
    /// 새 녹화: 주인 기록의 저장을 확인한다
    confirm: Option<Flusher>,
    /// "처음부터"인 채팅 작업의 영상 번호: 받다 만 채팅 파일도 지운다
    chat_video: Option<u64>,
}

/// 작업 태스크 본체.
async fn run_download<B: Backend>(
    inner: Arc<Inner<B>>,
    id: JobId,
    run: u64,
    req: DownloadRequest,
    Before {
        discard,
        confirm,
        chat_video,
    }: Before,
    cancel: CancellationToken,
    client: Arc<B>,
) -> End {
    if let Some(flusher) = confirm {
        // 주인 기록이 디스크에 닿기 전에 녹화하면, 저장이 실패한 채 앱이 꺼졌을 때 남의 것도 내 것도 아닌 `.part`가
        // 남는다(저장·삭제 모두 막힌다). 저장을 확인한 뒤에만 녹화를 시작한다(Codex PR #113 ③)
        let wait = tokio::task::spawn_blocking(move || flusher.flush_checked());
        let saved = tokio::select! {
            biased;
            _ = cancel.cancelled() => return End::Cancelled,
            r = wait => r,
        };
        match saved {
            Ok(Ok(())) => inner.confirm_saved(id, run),
            Ok(Err(e)) => return End::Failed(e),
            Err(e) => {
                return End::Failed(AppError::internal(format!(
                    "작업 목록 저장을 확인하지 못했습니다: {e}"
                )));
            }
        }
    }
    if discard {
        if cancel.is_cancelled() {
            return End::Cancelled;
        }
        if let Err(e) = discard_partial(&req.output, &req.owner()) {
            return End::Error(e);
        }
        // 채팅 파일을 지우지 못해도 영상은 받는다(채팅은 처음부터 받을 때 코어가 `.part`를 다시 비운다)
        if let Some(no) = chat_video
            && let Err(e) = discard_chat_partial(&req.output, no)
        {
            tracing::warn!(error = %e, job = id.0, "받다 만 채팅 파일을 지우지 못했다");
        }
        inner.discarded(id, run);
    }
    let cb = Arc::clone(&inner);
    let on_progress = move |p: Progress| cb.on_progress(id, run, &p);
    match client.download(req, cancel, &on_progress).await {
        Ok(o) => End::Done(o),
        Err(Error::Cancelled) => End::Cancelled,
        Err(e) => End::Error(e),
    }
}
