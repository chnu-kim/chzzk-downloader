//! 다운로드 작업 관리자(docs/design/app.md §6).
//!
//! - **큐**: `enqueue`는 `queued`로 넣고 `pump()`한다. `pump()`는 스케줄러가 켜져 있고 `running + pausing`이
//!   동시 작업 수(설정 `max_parallel_downloads`, 1~3)보다 적은 동안 가장 먼저 줄 선 `queued`를 시작한다.
//!   `pausing`도 센다. 태스크가 아직 연결과 `.part` 잠금을 쥐고 있기 때문이다.
//! - **이벤트 순서**: 상태를 바꾸고 저장하고 이벤트를 보내는 일을 모두 상태 잠금 안에서 한다. 그래서
//!   `Added` → `Status(running)` → `Progress`… → `Status(끝)` 순서가 실제 전이 순서와 같고, `subscribe`의
//!   스냅샷과 그 뒤 이벤트 사이에 빠지거나 겹치는 것이 없다. 잠금 순서는 상태 → sink 하나뿐이다.
//! - **저장**: `jobs.json`은 상태가 바뀔 때만 쓴다(진행률 틱마다 쓰지 않는다). 쓰기 실패는 로그만 남기고
//!   작업을 멈추지 않는다(메모리 상태가 기준이고, 다음 전이 때 다시 쓴다).
//! - **중복 방지**: 같은 최종 경로의 활성 작업(`queued·running·pausing·paused·interrupted`)이 있으면
//!   `duplicateOutput`. 경로 비교는 Windows·macOS에서 대소문자를 무시한다(NTFS·APFS 기본이 그렇다).
//!   두 작업이 같은 파일을 마무리(rename)하는 경합을 여기서 막는다.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use chzzk_core::naming::output_path;
use chzzk_core::{
    CancellationToken, ContentRef, DownloadOutcome, DownloadRequest, Error, Phase, Platform,
    Progress, discard_partial,
};
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

use crate::backend::Backend;
use crate::dto::{ContentKindDto, EnqueueRequest, JobDto, JobEvent, JobId, JobStatus, ProgressDto};
use crate::error::{AppError, Stage};
use crate::events::EventSink;
use crate::jobs::{
    JOBS_VERSION, JobRecord, JobStore, JobsFile, now_secs, partial_bytes, reconcile,
};

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
            queue_seq,
        }
    }

    fn dto(&self) -> JobDto {
        self.rec.to_dto(self.last_progress.clone())
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

    /// `output`과 같은 파일을 쓰는 활성 작업(`except` 제외).
    fn active_with_output(&self, output: &Path, except: Option<JobId>) -> Option<JobId> {
        let key = output_key(output);
        self.jobs
            .values()
            .find(|j| {
                Some(j.rec.id) != except
                    && j.rec.status.is_active()
                    && output_key(&j.rec.output) == key
            })
            .map(|j| j.rec.id)
    }
}

/// 같은 파일인지 비교할 열쇠. Windows·macOS 기본 파일 시스템은 대소문자를 구분하지 않는다.
/// (macOS의 유니코드 정규화 차이는 보지 않는다. 이름은 모두 같은 코드 경로로 만들어진다.)
pub fn output_key(p: &Path) -> String {
    let s = p.to_string_lossy();
    if cfg!(any(windows, target_os = "macos")) {
        s.to_lowercase()
    } else {
        s.into_owned()
    }
}

struct Inner<B> {
    client: ClientFn<B>,
    store: JobStore,
    runtime: Handle,
    state: Mutex<State>,
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
        };
        for rec in file.jobs {
            let seq = st.seq();
            st.jobs.insert(rec.id, Job::new(rec, seq));
        }
        let inner = Arc::new(Inner {
            client: cfg.client,
            store: cfg.store,
            runtime: cfg.runtime,
            state: Mutex::new(st),
        });
        {
            let st = inner.lock();
            inner.save(&st);
        }
        Ok(DownloadManager { inner })
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
        let folder = match req.folder.as_deref().map(str::trim) {
            Some(f) if !f.is_empty() => PathBuf::from(f),
            _ => defaults.download_folder.clone(),
        };
        if !folder.is_absolute() {
            return Err(AppError::invalid_input(format!(
                "저장 폴더가 절대 경로가 아닙니다: {}",
                folder.display()
            )));
        }
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
}

impl<B: Backend> Inner<B> {
    fn lock(&self) -> MutexGuard<'_, State> {
        // 잠금 안에서 패닉해도 상태는 한 전이 단위로만 바뀐다. 계속 쓴다.
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn save(&self, st: &State) {
        if let Err(e) = self.store.save(&st.file()) {
            tracing::warn!(error = %e, path = %self.store.path().display(), "작업 목록을 저장하지 못했다");
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
                    r.partial_bytes = None;
                    job.last_progress = None;
                }
                End::Cancelled => {
                    r.status = JobStatus::Failed;
                    r.last_error = Some(AppError::internal("멈춘 이유 없이 취소되었습니다"));
                    r.partial_bytes = partial_bytes(r);
                }
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
            self.prune_finished(&mut st);
            self.save(&st);
            st.emit(JobEvent::Status { job: dto });
        }
        self.pump(&mut st);
    }

    /// 완료·건너뜀이 `MAX_FINISHED`를 넘으면 오래된 것부터 지운다.
    fn prune_finished(&self, st: &mut State) {
        let mut finished: Vec<(u64, JobId)> = st
            .jobs
            .values()
            .filter(|j| matches!(j.rec.status, JobStatus::Completed | JobStatus::Skipped))
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
