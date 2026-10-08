//! 다운로드 작업 관리자(docs/design/app.md §6).
//!
//! - **큐**: `enqueue`는 `queued`로 넣고 `pump()`한다. `pump()`는 스케줄러가 켜져 있고 `running + pausing`이
//!   동시 작업 수(설정 `max_parallel_downloads`, 1~3)보다 적은 동안 가장 먼저 줄 선 `queued`를 시작한다.
//!   `pausing`도 센다. 태스크가 아직 연결과 `.part` 잠금을 쥐고 있기 때문이다.
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
//! - **`remove`의 순서**: 태스크의 `JoinHandle`을 꺼내 **잠금을 놓은 뒤** 기다리고, 그다음 `discard_partial`을
//!   부른다. 끝나는 태스크가 같은 잠금을 잡으므로 잡은 채 기다리면 교착이고, 먼저 지우면 `.part` 잠금 때문에
//!   `FileLocked`다(코어가 취소 뒤 체크포인트를 쓰는 중일 수도 있다).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use chzzk_core::naming::output_path;
use chzzk_core::{
    CancellationToken, ContentRef, DownloadOutcome, DownloadRequest, Error, Phase, Platform,
    PlaybackKind, Progress, discard_partial,
};
use std::time::Duration;
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

use crate::backend::Backend;
use crate::dto::{
    ContentKindDto, EnqueueRequest, JobDto, JobEvent, JobId, JobStatus, OnExisting, OutputCheck,
    ProgressDto,
};
use crate::error::{AppError, Stage};
use crate::events::EventSink;
use crate::jobs::{
    JOBS_VERSION, JobRecord, JobStore, JobsFile, now_secs, partial_bytes, reconcile,
};
use crate::output::{OutputQuery, check_output};
use crate::writer::{Flusher, JobsWriter};

/// 작업 시작 시점의 코어 클라이언트를 준다(쿠키 토글 때 셸이 클라이언트를 바꾼다).
pub type ClientFn<B> = Arc<dyn Fn() -> Arc<B> + Send + Sync>;

/// 완료·건너뜀을 남기는 개수. 넘으면 오래된 것부터 지운다.
pub const MAX_FINISHED: usize = 100;

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
}

/// `enqueue` 때 설정에서 오는 값.
#[derive(Clone, Debug)]
pub struct JobDefaults {
    /// 요청에 폴더가 없을 때 쓰는 폴더(설정 폴더, 없으면 기본 폴더)
    pub download_folder: PathBuf,
    /// 설정 `segment_concurrency`. 이 작업에 고정된다
    pub segment_concurrency: u8,
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
    handle: Option<JoinHandle<()>>,
    last_progress: Option<ProgressDto>,
    stop: Option<StopReason>,
    /// `remove`가 진행 중이다. 다른 동작은 이 작업을 없는 것으로 본다(중복 검사에는 남는다)
    removing: bool,
    /// 줄 선 순서(FIFO). `queued`가 될 때마다 새로 받는다
    queue_seq: u64,
}

impl Job {
    fn new(rec: JobRecord, queue_seq: u64) -> Self {
        Job {
            rec,
            cancel: None,
            handle: None,
            last_progress: None,
            stop: None,
            removing: false,
            queue_seq,
        }
    }

    fn dto(&self) -> JobDto {
        self.rec.to_dto(self.last_progress.clone())
    }

    /// 중복 검사에서 이 작업이 최종 경로를 차지하는가. 활성 상태이거나, 지우는 중이다(곧 `.part`를 지운다.
    /// `failed`를 지우는 동안 새 작업이 같은 경로를 가져가면 그 작업의 `.part`를 지우게 된다).
    fn holds_output(&self) -> bool {
        self.removing || self.rec.status.is_active()
    }

    /// "완료 지우기"·오래된 기록 정리가 레코드만 지워도 되는가. `completed`와 `.part`가 없는 `skipped`.
    /// 받는 동안 같은 이름의 파일이 생겨 건너뛴 작업은 받은 `.part`가 남아 있어("덮어쓰고 받기"로 쓸 수
    /// 있다) 레코드만 지우면 파일이 버려진 채 남으므로 정리하지 않는다(`remove`로 지운다).
    fn clearable(&self) -> bool {
        match self.rec.status {
            JobStatus::Completed => true,
            JobStatus::Skipped => self.rec.partial_bytes.is_none(),
            _ => false,
        }
    }

    fn busy(&self) -> bool {
        matches!(self.rec.status, JobStatus::Running | JobStatus::Pausing)
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
        let folder = resolve_folder(req.folder.as_deref(), &defaults.download_folder)?;
        let output = output_path(&folder, &req.file_name, Platform::current());

        let mut st = self.inner.lock();
        if let Some(other) = st.active_with_output(&output, None) {
            return Err(AppError::duplicate_output(other));
        }
        let id = JobId(st.next_id);
        st.next_id += 1;
        let kind = match &req.content {
            ContentRef::Video { .. } => ContentKindDto::Video,
            ContentRef::Clip { .. } => ContentKindDto::Clip,
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
            output,
            on_existing: req.on_existing,
            concurrency: crate::jobs::concurrency(defaults.segment_concurrency).get(),
            status: JobStatus::Queued,
            created_at: now_secs(),
            finished_at: None,
            final_bytes: None,
            last_error: None,
            discard_on_start: req.restart,
            partial_bytes: None,
            missing: false,
        };
        let seq = st.seq();
        let job = Job::new(rec, seq);
        let dto = job.dto();
        st.jobs.insert(id, job);
        self.inner.save(&st);
        st.emit(JobEvent::Added { job: dto });
        self.inner.pump(&mut st);
        Ok(st.jobs[&id].dto())
    }

    /// 최종 경로와 충돌을 미리 본다(§6.4). 폴더 규칙은 `enqueue`와 같다.
    pub fn check_output(
        &self,
        folder: Option<&str>,
        default_folder: &Path,
        file_name: &str,
        content: &ContentRef,
        quality_id: &str,
        kind: PlaybackKind,
    ) -> Result<OutputCheck, AppError> {
        let folder = resolve_folder(folder, default_folder)?;
        // 파일 시스템을 보는 동안 잠금을 쥐지 않도록 활성 경로를 먼저 떠 둔다.
        let active: Vec<(String, JobId)> = {
            let st = self.inner.lock();
            st.jobs
                .values()
                .filter(|j| j.holds_output())
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
                platform: Platform::current(),
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
                job.stop = Some(StopReason::Pause);
                job.rec.status = JobStatus::Pausing;
                if let Some(c) = &job.cancel {
                    c.cancel();
                }
            }
            JobStatus::Queued => {
                job.rec.status = JobStatus::Paused;
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
        let mut st = self.inner.lock();
        let Some(job) = st.target(id)? else {
            return Ok(());
        };
        match job.rec.status {
            JobStatus::Paused | JobStatus::Failed | JobStatus::Interrupted | JobStatus::Skipped => {
            }
            JobStatus::Queued | JobStatus::Running | JobStatus::Pausing => return Ok(()),
            JobStatus::Completed => {
                return Err(AppError::invalid_input(
                    "완료된 작업은 다시 받을 수 없습니다",
                ));
            }
        }
        let output = job.rec.output.clone();
        if let Some(other) = st.active_with_output(&output, Some(id)) {
            return Err(AppError::duplicate_output(other));
        }
        let seq = st.seq();
        let job = st.visible(id)?;
        self.inner.requeue(job, seq, restart);
        let dto = job.dto();
        self.inner.save(&st);
        st.emit(JobEvent::Status { job: dto });
        self.inner.pump(&mut st);
        Ok(())
    }

    /// `interrupted`를 모두 다시 줄 세운다(id 순). 같은 경로의 활성 작업이 있으면 그 작업은 건너뛴다.
    /// 재시작 후 자동 이어받기(설정)에 쓴다. 줄 세운 수를 돌려준다.
    pub fn resume_interrupted(&self) -> usize {
        let mut st = self.inner.lock();
        let ids: Vec<JobId> = st
            .jobs
            .values()
            .filter(|j| !j.removing && j.rec.status == JobStatus::Interrupted)
            .map(|j| j.rec.id)
            .collect();
        let mut n = 0;
        for id in ids {
            let output = st.jobs[&id].rec.output.clone();
            if st.active_with_output(&output, Some(id)).is_some() {
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
        if n > 0 {
            self.inner.save(&st);
            self.inner.pump(&mut st);
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
            let output = job.rec.output.clone();
            if st.active_with_output(&output, Some(id)).is_some() {
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
        if n > 0 {
            self.inner.save(&st);
        }
        self.inner.pump(&mut st);
        n
    }

    /// 목록에서 지운다(UX의 "취소"도 이것이다).
    ///
    /// - `completed`·`skipped`: 레코드만 지운다(파일은 둔다). 단 받는 동안 같은 이름의 파일이 생겨 건너뛴
    ///   `skipped`(받은 `.part`가 남음, `partial_bytes`가 있음)는 `failed`처럼 `.part`도 지운다.
    /// - `running`·`pausing`: 취소 → 태스크 종료 대기(잠금 밖) → `discard_partial` → 지운다.
    ///   종료 중(`quit` 뒤)에는 아무것도 하지 않는다(`quit`이 핸들을 가져가 기다릴 수 없고, 곧 `interrupted`로 저장된다).
    /// - `queued`·`paused`·`interrupted`·`failed`: `discard_partial` → 지운다(다시 줄 선 작업도 `.part`가 있을 수 있다).
    ///   단 `failed`의 경로를 다른 활성 작업이 가져갔으면 `.part`는 그 작업의 것이므로 레코드만 지운다.
    ///
    /// `.part`를 지우지 못하면(다른 프로그램이 잠금 등) 오류를 돌려주고 레코드를 멈춘 상태로 남긴다.
    pub async fn remove(&self, id: JobId) -> Result<(), AppError> {
        let (handle, output) = {
            let mut st = self.inner.lock();
            let quitting = !st.scheduler_enabled;
            let Some(job) = st.target(id)? else {
                // 이미 지우는 중이다
                return Ok(());
            };
            let output = job.rec.output.clone();
            let records_only = match job.rec.status {
                JobStatus::Completed => true,
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
                st.jobs.remove(&id);
                self.inner.save(&st);
                st.emit(JobEvent::Removed { id });
                return Ok(());
            }
            let job = st.visible(id)?;
            job.removing = true;
            let handle = if job.busy() {
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
                    job.rec.status = JobStatus::Paused;
                }
                None
            };
            (handle, output)
        };
        if let Some(h) = handle {
            // 바깥 태스크는 패닉을 안쪽에서 받으므로 여기서 JoinError가 나는 것은 런타임 종료뿐이다.
            let _ = h.await;
        }
        let discarded = discard_partial(&output);

        let mut st = self.inner.lock();
        match discarded {
            Ok(()) => {
                if st.jobs.remove(&id).is_some() {
                    self.inner.save(&st);
                    st.emit(JobEvent::Removed { id });
                }
                self.inner.pump(&mut st);
                Ok(())
            }
            Err(e) => {
                tracing::warn!(error = %e, job = id.0, "지우려던 작업의 .part를 지우지 못했다");
                if let Some(job) = st.jobs.get_mut(&id) {
                    job.removing = false;
                    job.stop = None;
                    if job.busy() {
                        // 태스크 종료를 기다리지 못한 경우(런타임 종료). 멈춘 것으로 둔다
                        job.rec.status = JobStatus::Paused;
                    }
                    job.rec.partial_bytes = partial_bytes(&job.rec);
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
        let handles: Vec<JoinHandle<()>> = {
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
                    job.stop = Some(StopReason::Quit);
                    job.rec.status = JobStatus::Pausing;
                    if let Some(c) = &job.cancel {
                        c.cancel();
                    }
                    changed.push(job.dto());
                }
                if job.busy()
                    && let Some(h) = job.handle.take()
                {
                    handles.push(h);
                }
            }
            st.quit_stopped = stopped;
            if !changed.is_empty() {
                self.inner.save(&st);
            }
            for dto in changed {
                st.emit(JobEvent::Status { job: dto });
            }
            handles
        };
        let all = async {
            for h in handles {
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
                    job.rec.status = JobStatus::Interrupted;
                    job.rec.partial_bytes = partial_bytes(&job.rec);
                    late.push(job.dto());
                    late_ids.push(job.rec.id);
                }
            }
            // 시간 안에 멈추지 않은 작업은 태스크가 아직 돈다. `cancel_quit`이 되살리면 옛 태스크와 겹치므로
            // 되살릴 목록에서 뺀다(사용자가 B1 [모두 이어받기]로 다시 시작한다, A4-11)
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
        }
        r.status = JobStatus::Queued;
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
            let busy = st.jobs.values().filter(|j| j.busy()).count();
            if busy >= st.max_running {
                break;
            }
            let next = st
                .jobs
                .values()
                .filter(|j| j.rec.status == JobStatus::Queued)
                .min_by_key(|j| j.queue_seq)
                .map(|j| j.rec.id);
            let Some(id) = next else { break };
            self.start(st, id);
        }
    }

    /// `queued` → `running`, 태스크를 띄운다. 잠금을 쥔 채 부르므로 태스크의 첫 이벤트는 `Status(running)` 뒤다.
    fn start(self: &Arc<Self>, st: &mut State, id: JobId) {
        let client = (self.client)();
        let Some(job) = st.jobs.get_mut(&id) else {
            return;
        };
        let r = &mut job.rec;
        r.status = JobStatus::Running;
        r.last_error = None;
        r.finished_at = None;
        r.final_bytes = None;
        r.partial_bytes = None;
        r.missing = false;
        job.stop = None;
        let cancel = CancellationToken::new();
        job.cancel = Some(cancel.clone());
        let req = job.rec.to_request();
        let discard = job.rec.discard_on_start;

        let me = Arc::clone(self);
        let runtime = self.runtime.clone();
        let handle = self.runtime.spawn(async move {
            // 다운로드는 안쪽 태스크로 돌려 패닉해도 `finish`가 불리게 한다.
            let work = runtime.spawn(run_download(
                Arc::clone(&me),
                id,
                req,
                discard,
                cancel,
                client,
            ));
            let end = match work.await {
                Ok(end) => end,
                Err(e) => End::Failed(AppError::internal(format!(
                    "작업 태스크가 비정상 종료했습니다: {e}"
                ))),
            };
            me.finish(id, end);
        });
        job.handle = Some(handle);
        let dto = job.dto();
        self.save(st);
        st.emit(JobEvent::Status { job: dto });
    }

    /// `restart`로 지운 뒤 표시를 내린다.
    fn discarded(&self, id: JobId) {
        let mut st = self.lock();
        if let Some(j) = st.jobs.get_mut(&id) {
            j.rec.discard_on_start = false;
            self.save(&st);
        }
    }

    fn on_progress(&self, id: JobId, p: &Progress) {
        let dto = ProgressDto::from(p);
        let mut st = self.lock();
        let Some(j) = st.jobs.get_mut(&id) else {
            return;
        };
        if !j.busy() {
            return;
        }
        j.last_progress = Some(dto.clone());
        st.emit(JobEvent::Progress { id, progress: dto });
    }

    /// 태스크가 끝났다. 상태를 정하고 저장·알린 뒤 다음 작업을 시작한다.
    fn finish(self: &Arc<Self>, id: JobId, end: End) {
        let mut st = self.lock();
        if let Some(job) = st.jobs.get_mut(&id) {
            job.cancel = None;
            job.handle = None;
            let stop = job.stop.take();
            if job.removing {
                // `remove`가 이어서 `.part`를 지우고 레코드를 없앤다. 그때까지 중복 검사에는 남도록 멈춘 상태로 둔다.
                job.rec.status = JobStatus::Paused;
                self.pump(&mut st);
                return;
            }
            let r = &mut job.rec;
            match end {
                End::Done(DownloadOutcome::Completed { bytes, .. }) => {
                    r.status = JobStatus::Completed;
                    r.final_bytes = Some(bytes);
                    r.finished_at = Some(now_secs());
                    r.partial_bytes = None;
                    job.last_progress = None;
                }
                End::Done(DownloadOutcome::Skipped { .. }) => {
                    r.status = JobStatus::Skipped;
                    r.finished_at = Some(now_secs());
                    // 받는 동안 같은 이름의 파일이 생겼으면 코어가 `.part`를 남긴다("덮어쓰고 받기"로 이어받는다).
                    r.partial_bytes = partial_bytes(r);
                    job.last_progress = None;
                }
                End::Cancelled => match stop {
                    Some(StopReason::Pause) => {
                        r.status = JobStatus::Paused;
                        r.partial_bytes = partial_bytes(r);
                    }
                    Some(StopReason::Quit) => {
                        r.status = JobStatus::Interrupted;
                        r.partial_bytes = partial_bytes(r);
                    }
                    Some(StopReason::Remove) | None => {
                        r.status = JobStatus::Failed;
                        r.last_error = Some(AppError::internal("멈춘 이유 없이 취소되었습니다"));
                        r.partial_bytes = partial_bytes(r);
                    }
                },
                End::Error(e) => {
                    let stage = stage_of(job.last_progress.as_ref());
                    r.status = JobStatus::Failed;
                    r.last_error = Some(AppError::from(&e).at(stage));
                    r.partial_bytes = partial_bytes(r);
                }
                End::Failed(e) => {
                    r.status = JobStatus::Failed;
                    r.last_error = Some(e);
                    r.partial_bytes = partial_bytes(r);
                }
            }
            let dto = job.dto();
            // Status를 먼저 보낸다. 방금 끝난 작업이 정리 대상이면 Removed가 뒤에 와야 프런트에 유령이 남지 않는다.
            st.emit(JobEvent::Status { job: dto });
            self.prune_finished(&mut st);
            self.save(&st);
        }
        self.pump(&mut st);
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

/// 실패한 단계. 마지막 진행률이 없거나 (재)조회 중이었으면 `resolve`, 받는 중·마무리 중이었으면 `download`.
fn stage_of(last: Option<&ProgressDto>) -> Stage {
    match last.map(|p| p.phase) {
        None | Some(Phase::Resolving) | Some(Phase::Reresolving) => Stage::Resolve,
        Some(Phase::Downloading) | Some(Phase::Finalizing) => Stage::Download,
    }
}

/// 작업 태스크 본체.
async fn run_download<B: Backend>(
    inner: Arc<Inner<B>>,
    id: JobId,
    req: DownloadRequest,
    discard: bool,
    cancel: CancellationToken,
    client: Arc<B>,
) -> End {
    if discard {
        if cancel.is_cancelled() {
            return End::Cancelled;
        }
        if let Err(e) = discard_partial(&req.output) {
            return End::Error(e);
        }
        inner.discarded(id);
    }
    let cb = Arc::clone(&inner);
    let on_progress = move |p: Progress| cb.on_progress(id, &p);
    match client.download(req, cancel, &on_progress).await {
        Ok(o) => End::Done(o),
        Err(Error::Cancelled) => End::Cancelled,
        Err(e) => End::Error(e),
    }
}
