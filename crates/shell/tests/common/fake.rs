//! 대본형 가짜 Backend(app.md §15-4). 진행률 시퀀스·대기·취소·오류를 정해 둔 순서대로 흉내 낸다.
//!
//! - `download` 대본은 출력 경로별로 줄을 세운다(동시 작업의 시작 순서에 기대지 않는다).
//!   경로에 대본이 없으면 공용 줄, 그것도 없으면 즉시 `Completed { bytes: 0 }`.
//! - 대기 단계(`Sleep`·`Hold`·`WaitCancel`)는 취소 토큰을 함께 기다리고, 취소되면 `Err(Cancelled)`로 끝난다
//!   (코어가 체크포인트를 쓰고 `Cancelled`를 돌려주는 것과 같은 모양). 시작할 때와 진행률 단계 뒤에도
//!   취소를 확인하므로, 이미 취소된 토큰이면 대본에 대기 단계가 없어도 `Cancelled`다.
//!   예외로 `UntilCancelled`는 취소 뒤에도 다음 단계로 넘어가고 `Linger`는 취소를 무시한다(취소 뒤 체크포인트를
//!   쓰는 코어, 늦게 끝나는 태스크를 흉내 낸다). `Write`는 파일을 쓴다.
//! - 호출 기록(`calls`), `download`가 받은 요청 전체(`download_requests`: 이어받기 정책·화질·방식·동시 요청 수를
//!   매니저가 제대로 넘겼는지 보려고)와 동시 실행 수(`active`·`max_active`)를 남겨 매니저의 동시성 상한을 검사한다.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_core::chat::collect::RECORD_EXT;
use chzzk_core::chat::part::{ChatSidecar, SIDECAR_VERSION};
use chzzk_core::chat::{ChatEnd, ChatOutcome, ChatProgress, ChatRequest};
use chzzk_core::download::part::{HlsState, Sidecar, part_path, sidecar_path};
use chzzk_core::fsutil::atomic_write;
use chzzk_core::naming::sibling_path;
use chzzk_core::{
    CancellationToken, ContentRef, DownloadOutcome, DownloadRequest, Error, Phase, Progress,
    Resolved,
};
use chzzk_shell::Backend;
use tokio::sync::Notify;

/// 대본 한 단계.
pub enum Step {
    /// 진행률 콜백을 부른다
    Progress(Progress),
    /// 그만큼 기다린다(취소되면 `Cancelled`)
    Sleep(Duration),
    /// 테스트가 `notify_one`할 때까지 기다린다(취소되면 `Cancelled`)
    Hold(Arc<Notify>),
    /// 취소될 때까지 기다린 뒤 `Cancelled`
    WaitCancel,
    /// 취소될 때까지 기다리고 **다음 단계로 넘어간다**(취소 뒤의 체크포인트 쓰기 흉내)
    UntilCancelled,
    /// 취소를 무시하고 그만큼 머문다(늦게 끝나는 태스크)
    Linger(Duration),
    /// 파일을 쓴다(코어의 `.part`·sidecar 쓰기 흉내)
    Write(PathBuf, Vec<u8>),
    /// 생방송: `live_stop`이 취소될 때까지 기다리고 **다음 단계로 넘어간다**(받은 만큼 마무리하는 코어 흉내).
    /// `cancel`이 오면 `Cancelled`다. 요청에 `live_stop`이 없으면 취소만 기다린다.
    UntilStopped,
    /// 생방송: 코어처럼 `.part`(init `init_len` + 영상 `media_len`바이트)와 이 요청의 sidecar(`recording_id` 포함)를 쓴다
    LivePart { init_len: u32, media_len: u64 },
}

/// `download` 한 번의 대본.
pub struct Script {
    steps: Vec<Step>,
    end: Option<Result<DownloadOutcome, Error>>,
}

impl Default for Script {
    fn default() -> Self {
        Self::new()
    }
}

impl Script {
    pub fn new() -> Self {
        Script {
            steps: Vec::new(),
            end: None,
        }
    }

    pub fn progress(mut self, p: Progress) -> Self {
        self.steps.push(Step::Progress(p));
        self
    }

    /// `downloading` 단계의 바이트 진행률.
    pub fn bytes(self, bytes: u64, total: Option<u64>) -> Self {
        self.progress(progress(Phase::Downloading, bytes, total))
    }

    pub fn sleep(mut self, d: Duration) -> Self {
        self.steps.push(Step::Sleep(d));
        self
    }

    pub fn hold(mut self, n: Arc<Notify>) -> Self {
        self.steps.push(Step::Hold(n));
        self
    }

    /// 취소될 때까지 멈춰 있는다. 이 뒤의 단계와 결과는 쓰이지 않는다.
    pub fn wait_cancel(mut self) -> Self {
        self.steps.push(Step::WaitCancel);
        self
    }

    /// 취소될 때까지 기다린 뒤 이어지는 단계를 계속한다. 결과는 `ends`로 정한다(보통 `Err(Cancelled)`).
    pub fn until_cancelled(mut self) -> Self {
        self.steps.push(Step::UntilCancelled);
        self
    }

    pub fn linger(mut self, d: Duration) -> Self {
        self.steps.push(Step::Linger(d));
        self
    }

    /// 생방송 `live_stop`을 기다린 뒤 이어지는 단계와 결과로 마무리한다.
    pub fn until_stopped(mut self) -> Self {
        self.steps.push(Step::UntilStopped);
        self
    }

    /// 코어가 쓰는 생방송 녹화 `.part`·sidecar를 흉내 낸다(`recording_id`는 요청 값).
    pub fn live_part(mut self, init_len: u32, media_len: u64) -> Self {
        self.steps.push(Step::LivePart {
            init_len,
            media_len,
        });
        self
    }

    pub fn write(mut self, path: impl Into<PathBuf>, bytes: impl Into<Vec<u8>>) -> Self {
        self.steps.push(Step::Write(path.into(), bytes.into()));
        self
    }

    /// 마지막 결과. 정하지 않으면 `Completed { path: output, bytes: 마지막 진행률 바이트 }`.
    pub fn ends(mut self, r: Result<DownloadOutcome, Error>) -> Self {
        self.end = Some(r);
        self
    }

    pub fn fails(self, e: Error) -> Self {
        self.ends(Err(e))
    }
}

/// 진행률 값 하나.
pub fn progress(phase: Phase, bytes: u64, total: Option<u64>) -> Progress {
    Progress {
        phase,
        bytes,
        total_bytes: total,
        total_bytes_estimate: None,
        segments: None,
        media_secs: None,
        speed_bps: None,
        eta_secs: None,
        resumed_from: 0,
        refreshes: 0,
        live: None,
    }
}

/// 채팅 대본 한 단계.
pub enum ChatStep {
    /// 진행 콜백을 부른다(커서 ms, 메시지 수)
    Progress { cursor_ms: u64, messages: u64 },
    /// 테스트가 `notify_one`할 때까지 기다린다(취소되면 `Cancelled`)
    Hold(Arc<Notify>),
    /// 취소될 때까지 기다린 뒤 `Cancelled`
    WaitCancel,
    /// 취소를 무시하고 테스트가 `notify_one`할 때까지 기다린다(늦게 끝나는 페이지 커밋). 그 사이 취소됐으면 `Cancelled`
    Stubborn(Arc<Notify>),
    /// 코어처럼 받다 만 기록(`.chat.jsonl.part`, `lines`줄)과 이 영상의 sidecar를 쓴다
    Part { lines: u64 },
}

/// `collect_chat` 한 번의 대본. 결과를 정하지 않으면 `Completed`(받다 만 파일을 지우고 기록을 최종 이름으로 쓴다).
#[derive(Default)]
pub struct ChatScript {
    steps: Vec<ChatStep>,
    end: Option<Result<ChatOutcome, Error>>,
}

impl ChatScript {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn progress(mut self, cursor_ms: u64, messages: u64) -> Self {
        self.steps.push(ChatStep::Progress {
            cursor_ms,
            messages,
        });
        self
    }

    pub fn hold(mut self, n: Arc<Notify>) -> Self {
        self.steps.push(ChatStep::Hold(n));
        self
    }

    pub fn wait_cancel(mut self) -> Self {
        self.steps.push(ChatStep::WaitCancel);
        self
    }

    pub fn stubborn(mut self, n: Arc<Notify>) -> Self {
        self.steps.push(ChatStep::Stubborn(n));
        self
    }

    pub fn part(mut self, lines: u64) -> Self {
        self.steps.push(ChatStep::Part { lines });
        self
    }

    pub fn ends(mut self, r: Result<ChatOutcome, Error>) -> Self {
        self.end = Some(r);
        self
    }

    pub fn fails(self, e: Error) -> Self {
        self.ends(Err(e))
    }
}

/// 코어 `ChatPart`처럼 받다 만 기록과 sidecar를 쓴다(`lines`줄, 정상 끝 없음).
pub fn write_chat_part(video: &Path, video_no: u64, lines: u64) {
    let record = sibling_path(video, RECORD_EXT);
    if let Some(dir) = record.parent() {
        std::fs::create_dir_all(dir).unwrap();
    }
    let body: Vec<u8> = (0..lines).flat_map(|_| b"{}\n".to_vec()).collect();
    std::fs::write(part_path(&record), &body).unwrap();
    let sc = ChatSidecar {
        v: SIDECAR_VERSION,
        video_no,
        cursor_ms: lines * 1000,
        boundary_ms: None,
        boundary: Vec::new(),
        lines,
        last_offset_ms: None,
        committed_len: body.len() as u64,
        end: None,
        moved: Vec::new(),
        moving: Vec::new(),
    };
    atomic_write(&sidecar_path(&record), &serde_json::to_vec(&sc).unwrap()).unwrap();
}

/// 가짜가 받은 호출.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Call {
    Resolve(ContentRef),
    /// 출력 경로
    Download(PathBuf),
    /// 채팅(영상 출력 경로)
    Chat(PathBuf),
}

#[derive(Default)]
pub struct FakeBackend {
    resolves: Mutex<VecDeque<Result<Resolved, Error>>>,
    by_output: Mutex<HashMap<PathBuf, VecDeque<Script>>>,
    shared: Mutex<VecDeque<Script>>,
    calls: Mutex<Vec<Call>>,
    requests: Mutex<Vec<DownloadRequest>>,
    active: AtomicUsize,
    max_active: AtomicUsize,
    chats: Mutex<HashMap<PathBuf, VecDeque<ChatScript>>>,
    chat_requests: Mutex<Vec<ChatRequest>>,
    chat_active: AtomicUsize,
    chat_max_active: AtomicUsize,
}

impl FakeBackend {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// 다음 `resolve`의 결과.
    pub fn push_resolve(&self, r: Result<Resolved, Error>) {
        self.resolves.lock().unwrap().push_back(r);
    }

    /// `output`으로 가는 다음 `download`의 대본.
    pub fn script_for(&self, output: impl AsRef<Path>, s: Script) {
        self.by_output
            .lock()
            .unwrap()
            .entry(output.as_ref().to_path_buf())
            .or_default()
            .push_back(s);
    }

    /// 경로별 대본이 없을 때 쓰는 다음 대본.
    pub fn script(&self, s: Script) {
        self.shared.lock().unwrap().push_back(s);
    }

    pub fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }

    pub fn download_calls(&self) -> Vec<PathBuf> {
        self.calls()
            .into_iter()
            .filter_map(|c| match c {
                Call::Download(p) => Some(p),
                Call::Resolve(_) | Call::Chat(_) => None,
            })
            .collect()
    }

    /// `download`가 받은 요청 전체(호출 순서). `DownloadRequest`는 `PartialEq`가 아니라 `Call`과 따로 둔다.
    pub fn download_requests(&self) -> Vec<DownloadRequest> {
        self.requests.lock().unwrap().clone()
    }

    /// 영상 `video`(출력 경로)의 다음 `collect_chat` 대본. 없으면 바로 `Completed`.
    pub fn chat_for(&self, video: impl AsRef<Path>, s: ChatScript) {
        self.chats
            .lock()
            .unwrap()
            .entry(video.as_ref().to_path_buf())
            .or_default()
            .push_back(s);
    }

    /// `collect_chat`이 받은 요청 전체(호출 순서).
    pub fn chat_requests(&self) -> Vec<ChatRequest> {
        self.chat_requests.lock().unwrap().clone()
    }

    /// 지금까지 동시에 실행된 `collect_chat` 수의 최댓값.
    pub fn chat_max_active(&self) -> usize {
        self.chat_max_active.load(Ordering::SeqCst)
    }

    /// 지금 실행 중인 `download` 수.
    pub fn active(&self) -> usize {
        self.active.load(Ordering::SeqCst)
    }

    /// 지금까지 동시에 실행된 `download` 수의 최댓값.
    pub fn max_active(&self) -> usize {
        self.max_active.load(Ordering::SeqCst)
    }

    fn next_script(&self, output: &Path) -> Script {
        if let Some(s) = self
            .by_output
            .lock()
            .unwrap()
            .get_mut(output)
            .and_then(VecDeque::pop_front)
        {
            return s;
        }
        self.shared.lock().unwrap().pop_front().unwrap_or_default()
    }
}

/// 실행 중 카운터. drop(취소로 future가 버려진 경우 포함) 때 줄인다.
struct ActiveGuard<'a>(&'a AtomicUsize);

impl Drop for ActiveGuard<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Backend for FakeBackend {
    async fn resolve(&self, c: &ContentRef) -> Result<Resolved, Error> {
        self.calls.lock().unwrap().push(Call::Resolve(c.clone()));
        let next = self.resolves.lock().unwrap().pop_front();
        next.unwrap_or_else(|| {
            Err(Error::Parse {
                what: "fake",
                detail: "대본에 없는 resolve".into(),
            })
        })
    }

    async fn download(
        &self,
        req: DownloadRequest,
        cancel: CancellationToken,
        on_progress: &(dyn Fn(Progress) + Send + Sync),
    ) -> Result<DownloadOutcome, Error> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Download(req.output.clone()));
        self.requests.lock().unwrap().push(req.clone());
        let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.max_active.fetch_max(now, Ordering::SeqCst);
        let _guard = ActiveGuard(&self.active);

        let script = self.next_script(&req.output);
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let mut last_bytes = 0;
        for step in script.steps {
            match step {
                Step::Progress(p) => {
                    last_bytes = p.bytes;
                    on_progress(p);
                    if cancel.is_cancelled() {
                        return Err(Error::Cancelled);
                    }
                }
                Step::Sleep(d) => {
                    tokio::select! {
                        _ = tokio::time::sleep(d) => {}
                        _ = cancel.cancelled() => return Err(Error::Cancelled),
                    }
                }
                Step::Hold(n) => {
                    tokio::select! {
                        _ = n.notified() => {}
                        _ = cancel.cancelled() => return Err(Error::Cancelled),
                    }
                }
                Step::WaitCancel => {
                    cancel.cancelled().await;
                    return Err(Error::Cancelled);
                }
                Step::UntilCancelled => cancel.cancelled().await,
                Step::Linger(d) => tokio::time::sleep(d).await,
                Step::Write(p, b) => std::fs::write(&p, b).unwrap(),
                Step::LivePart {
                    init_len,
                    media_len,
                } => {
                    if let Some(dir) = req.output.parent() {
                        std::fs::create_dir_all(dir).unwrap();
                    }
                    let total = u64::from(init_len) + media_len;
                    std::fs::write(part_path(&req.output), vec![0u8; total as usize]).unwrap();
                    let mut sc = Sidecar::new(
                        req.content.clone(),
                        req.quality_id.clone(),
                        req.expected_kind,
                    );
                    sc.recording_id = req.recording_id.clone();
                    sc.committed_len = total;
                    sc.hls = Some(HlsState {
                        init_len,
                        ..HlsState::default()
                    });
                    atomic_write(
                        &sidecar_path(&req.output),
                        &serde_json::to_vec(&sc).unwrap(),
                    )
                    .unwrap();
                }
                Step::UntilStopped => {
                    let stop = req.live_stop.clone().unwrap_or_default();
                    tokio::select! {
                        _ = stop.cancelled() => {}
                        _ = cancel.cancelled() => return Err(Error::Cancelled),
                    }
                }
            }
        }
        script.end.unwrap_or(Ok(DownloadOutcome::Completed {
            path: req.output,
            bytes: last_bytes,
            resumed_from: 0,
            live: None,
        }))
    }

    async fn collect_chat(
        &self,
        req: ChatRequest,
        cancel: CancellationToken,
        on_progress: &(dyn Fn(ChatProgress) + Send + Sync),
    ) -> Result<ChatOutcome, Error> {
        self.calls
            .lock()
            .unwrap()
            .push(Call::Chat(req.output.clone()));
        self.chat_requests.lock().unwrap().push(req.clone());
        let now = self.chat_active.fetch_add(1, Ordering::SeqCst) + 1;
        self.chat_max_active.fetch_max(now, Ordering::SeqCst);
        let _guard = ActiveGuard(&self.chat_active);
        let script = self
            .chats
            .lock()
            .unwrap()
            .get_mut(&req.output)
            .and_then(VecDeque::pop_front)
            .unwrap_or_default();
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let mut messages = 0;
        for step in script.steps {
            match step {
                ChatStep::Progress {
                    cursor_ms,
                    messages: m,
                } => {
                    messages = m;
                    on_progress(ChatProgress {
                        cursor_ms,
                        duration_ms: req.duration_ms,
                        messages: m,
                    });
                }
                ChatStep::Hold(n) => {
                    tokio::select! {
                        _ = n.notified() => {}
                        _ = cancel.cancelled() => return Err(Error::Cancelled),
                    }
                }
                ChatStep::WaitCancel => {
                    cancel.cancelled().await;
                    return Err(Error::Cancelled);
                }
                ChatStep::Stubborn(n) => {
                    n.notified().await;
                    if cancel.is_cancelled() {
                        return Err(Error::Cancelled);
                    }
                }
                ChatStep::Part { lines } => write_chat_part(&req.output, req.video_no, lines),
            }
        }
        match script.end {
            Some(r) => r,
            None => {
                // 코어의 마무리: 받다 만 파일을 지우고 최종 기록을 쓴다
                let record = sibling_path(&req.output, RECORD_EXT);
                let _ = std::fs::remove_file(part_path(&record));
                let _ = std::fs::remove_file(sidecar_path(&record));
                if let Some(dir) = record.parent() {
                    std::fs::create_dir_all(dir).unwrap();
                }
                std::fs::write(&record, b"").unwrap();
                Ok(ChatOutcome::Completed {
                    messages,
                    last_offset_ms: None,
                    end: ChatEnd::NoCursor,
                    subtitle_failed: false,
                })
            }
        }
    }
}
