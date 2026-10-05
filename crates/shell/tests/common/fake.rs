//! 대본형 가짜 Backend(app.md §15-4). 진행률 시퀀스·대기·취소·오류를 정해 둔 순서대로 흉내 낸다.
//!
//! - `download` 대본은 출력 경로별로 줄을 세운다(동시 작업의 시작 순서에 기대지 않는다).
//!   경로에 대본이 없으면 공용 줄, 그것도 없으면 즉시 `Completed { bytes: 0 }`.
//! - 대기 단계(`Sleep`·`Hold`·`WaitCancel`)는 취소 토큰을 함께 기다리고, 취소되면 `Err(Cancelled)`로 끝난다
//!   (코어가 체크포인트를 쓰고 `Cancelled`를 돌려주는 것과 같은 모양). 시작할 때와 진행률 단계 뒤에도
//!   취소를 확인하므로, 이미 취소된 토큰이면 대본에 대기 단계가 없어도 `Cancelled`다.
//! - 호출 기록(`calls`)과 동시 실행 수(`active`·`max_active`)를 남겨 매니저의 동시성 상한을 검사한다.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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
    }
}

/// 가짜가 받은 호출.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Call {
    Resolve(ContentRef),
    /// 출력 경로
    Download(PathBuf),
}

#[derive(Default)]
pub struct FakeBackend {
    resolves: Mutex<VecDeque<Result<Resolved, Error>>>,
    by_output: Mutex<HashMap<PathBuf, VecDeque<Script>>>,
    shared: Mutex<VecDeque<Script>>,
    calls: Mutex<Vec<Call>>,
    active: AtomicUsize,
    max_active: AtomicUsize,
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
                Call::Resolve(_) => None,
            })
            .collect()
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
            }
        }
        script.end.unwrap_or(Ok(DownloadOutcome::Completed {
            path: req.output,
            bytes: last_bytes,
            resumed_from: 0,
        }))
    }
}
