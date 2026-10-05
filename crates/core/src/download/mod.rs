//! 다운로드 엔진(설계 §4.2·§5).
//!
//! - `part`: `.part`·sidecar와 크래시 불변식
//! - `retry`: 재시도 정책과 실패 분류
//! - `progressive`: PD mp4 단일 GET + Range 이어받기
//! - `segmented`: 빠른 다시보기 HLS fMP4, 순서 보장 동시 fetch
//!
//! 공통 골격(`Chzzk::download`):
//! 1. 최종 파일이 있으면 `Skip` → `Skipped`(네트워크 0회), `Overwrite` → 계속.
//! 2. 같은 작업의 `.part`가 있으면 잠그고 이어받는다. 다르면 지우고 새로 시작한다.
//! 3. `Resolving`: `resolve`. 방식이 바뀌었으면 `PlaybackChanged`.
//! 4. 엔진 실행. 403이면 `Reresolving` → 재조회(상한 8회).
//! 5. `Finalizing`: checkpoint → `.part` → 최종 파일. `Skip`이면 덮어쓰지 않는 rename을 쓰고, 받는 동안
//!    최종 파일이 생겼으면 `.part`를 남긴 채 `Skipped`다.
//!
//! 실패·취소 시 `.part`와 sidecar를 남긴다(checkpoint 후). `is_resumable() == false`인 오류만 지운다.
//! 단 `resolve` 실패와 작업 도중 재조회의 지문 불일치는 남긴다(`Job::keep_partial`).

pub mod part;
pub(crate) mod progressive;
pub mod retry;
pub(crate) mod segmented;

use std::future::Future;
use std::num::NonZeroU8;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

use crate::client::Chzzk;
use crate::error::Error;
use crate::fsutil::map_io_error;
use crate::model::{ContentRef, PlaybackKind, Resolved, Source};
use crate::progress::{Meter, Phase, Progress};

pub use part::{Finalized, PartFile, Sidecar, discard_partial};
pub use retry::{Failure, RetryPolicy};

/// 작업당 재조회 상한.
pub const MAX_REFRESHES: u32 = 8;

/// HLS 동시 요청 수 기본값.
pub const DEFAULT_CONCURRENCY: NonZeroU8 = NonZeroU8::new(4).unwrap();

/// HLS 동시 요청 수 상한. 더 큰 값은 이 값으로 줄인다.
pub const MAX_CONCURRENCY: u8 = 8;

/// 최종 파일이 이미 있을 때(spec §6.3). `.part`는 자동으로 처리한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DuplicatePolicy {
    Overwrite,
    Skip,
}

/// 다운로드 요청.
#[derive(Clone, Debug)]
pub struct DownloadRequest {
    pub content: ContentRef,
    /// `Quality.id` 정확 일치
    pub quality_id: String,
    /// 목록을 보여 줄 때의 방식. 재조회 결과가 다르면 `PlaybackChanged`
    pub expected_kind: PlaybackKind,
    /// 최종 경로(`naming::output_path`). 부모 디렉토리는 코어가 만든다.
    pub output: PathBuf,
    pub on_existing: DuplicatePolicy,
    /// HLS 동시 요청 수. 기본 4, 상한 8
    pub concurrency: NonZeroU8,
}

/// 다운로드 결과.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DownloadOutcome {
    Completed {
        path: PathBuf,
        /// 최종 파일 크기
        bytes: u64,
        /// 이어받기 시작 위치(새로 받았으면 0)
        resumed_from: u64,
    },
    /// `Skip`인데 최종 파일이 있었다. 시작 전에 있었으면 네트워크 0회, 받는 동안 생겼으면 받은 `.part`와
    /// sidecar가 남는다(같은 요청을 `Overwrite`로 다시 부르면 이어받아 곧바로 마무리된다).
    Skipped { path: PathBuf },
}

/// 진행률 콜백 연결. 엔진은 상태를 바꾸고 `update`/`phase`를 부른다.
/// `Meter`가 `progress_interval`로 스로틀하고 속도·ETA를 채운다.
pub(crate) struct Reporter<'a> {
    cb: &'a (dyn Fn(Progress) + Send + Sync),
    meter: Meter,
    pub(crate) p: Progress,
}

impl<'a> Reporter<'a> {
    fn new(cb: &'a (dyn Fn(Progress) + Send + Sync), interval: Duration) -> Self {
        Reporter {
            cb,
            meter: Meter::new(interval),
            p: Progress {
                phase: Phase::Resolving,
                bytes: 0,
                total_bytes: None,
                total_bytes_estimate: None,
                segments: None,
                media_secs: None,
                speed_bps: None,
                eta_secs: None,
                resumed_from: 0,
                refreshes: 0,
            },
        }
    }

    /// 단계를 바꾸고 알린다(스로틀하지 않는다).
    pub(crate) fn phase(&mut self, phase: Phase) {
        self.p.phase = phase;
        self.emit(true);
    }

    /// 값을 바꾸고, 간격이 지났으면 알린다.
    pub(crate) fn update(&mut self, f: impl FnOnce(&mut Progress)) {
        f(&mut self.p);
        self.emit(false);
    }

    fn emit(&mut self, force: bool) {
        if self.meter.observe(&mut self.p, Instant::now(), force) {
            (self.cb)(self.p.clone());
        }
    }
}

/// 다운로드 한 건의 공통 상태.
pub(crate) struct Job<'a> {
    pub(crate) chzzk: &'a Chzzk,
    pub(crate) req: &'a DownloadRequest,
    cancel: &'a CancellationToken,
    pub(crate) report: Reporter<'a>,
    pub(crate) refreshes: u32,
    /// `is_resumable() == false`여도 `.part`를 남길 오류인가.
    ///
    /// `resolve` 자체의 실패(예: 로그인 만료로 API 403 → `AuthRequired`)와 작업 도중 재조회한
    /// playlist의 지문 불일치는 이미 받은 바이트가 틀렸다는 증거가 아니다. 다음 실행의
    /// sidecar 동일성·지문 검사가 정말 낡은 `.part`를 거른다.
    pub(crate) keep_partial: bool,
}

impl Job<'_> {
    /// `f`를 기다리되 취소되면 `Cancelled`.
    pub(crate) async fn cancellable<F: Future>(&self, f: F) -> Result<F::Output, Error> {
        tokio::select! {
            biased;
            _ = self.cancel.cancelled() => Err(Error::Cancelled),
            out = f => Ok(out),
        }
    }

    /// 취소 가능한 대기.
    pub(crate) async fn sleep(&self, d: Duration) -> Result<(), Error> {
        self.cancellable(tokio::time::sleep(d)).await
    }

    /// `resolve` 후 방식이 요청과 같은지 확인한다.
    async fn resolve(&mut self) -> Result<Resolved, Error> {
        let r = match self
            .cancellable(self.chzzk.resolve(&self.req.content))
            .await?
        {
            Ok(r) => r,
            Err(e) => {
                self.keep_partial = true;
                return Err(e);
            }
        };
        let now = r.kind();
        if now != self.req.expected_kind {
            return Err(Error::PlaybackChanged {
                was: self.req.expected_kind,
                now,
            });
        }
        Ok(r)
    }

    /// 서명 주소가 만료되어(403) 다시 조회한다. 작업당 `MAX_REFRESHES`회를 넘기면 `RefreshExhausted`.
    pub(crate) async fn reresolve(&mut self) -> Result<Resolved, Error> {
        if self.refreshes >= MAX_REFRESHES {
            return Err(Error::RefreshExhausted);
        }
        self.refreshes += 1;
        let n = self.refreshes;
        self.report.p.refreshes = n;
        self.report.phase(Phase::Reresolving);
        let r = self.resolve().await?;
        self.report.phase(Phase::Downloading);
        Ok(r)
    }
}

impl Chzzk {
    /// 컨텐츠를 `req.output`에 받는다.
    ///
    /// 진행률은 `on_progress`로, 취소는 `cancel`로 받는다. 실패·취소 시 `.part`와 sidecar가 남아
    /// 같은 요청으로 이어받을 수 있다(`Error::is_resumable`).
    pub async fn download(
        &self,
        req: DownloadRequest,
        cancel: CancellationToken,
        on_progress: &(dyn Fn(Progress) + Send + Sync),
    ) -> Result<DownloadOutcome, Error> {
        if req.output.exists() && req.on_existing == DuplicatePolicy::Skip {
            return Ok(DownloadOutcome::Skipped { path: req.output });
        }
        if let Some(dir) = req.output.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(|e| map_io_error("create dir", dir, e))?;
        }
        let mut part = PartFile::resume(
            &req.output,
            &req.content,
            &req.quality_id,
            req.expected_kind,
        )?;
        let mut job = Job {
            chzzk: self,
            req: &req,
            cancel: &cancel,
            report: Reporter::new(on_progress, self.config().progress_interval),
            refreshes: 0,
            keep_partial: false,
        };
        let resumed_from = part.as_ref().map_or(0, PartFile::written);
        job.report.p.resumed_from = resumed_from;
        job.report.p.bytes = resumed_from;
        let result = run(&mut job, &mut part).await;
        match result {
            Ok(o) => Ok(o),
            Err(e) => {
                let keep = e.is_resumable() || job.keep_partial;
                cleanup(part, keep, &e).await;
                Err(e)
            }
        }
    }
}

/// 엔진을 고른다.
async fn run(job: &mut Job<'_>, part: &mut Option<PartFile>) -> Result<DownloadOutcome, Error> {
    job.report.phase(Phase::Resolving);
    let resolved = job.resolve().await?;
    job.report.phase(Phase::Downloading);
    match resolved.source {
        Source::Progressive { reps } => progressive::run(job, reps, part).await,
        Source::LiveRewindHls { master_url, tracks } => {
            segmented::run(job, master_url, tracks, part).await
        }
    }
}

/// 실패 뒤 정리: `keep`이면 checkpoint해서 남기고, 아니면 지운다.
async fn cleanup(part: Option<PartFile>, keep: bool, e: &Error) {
    let Some(mut p) = part else { return };
    tracing::debug!(error = %e, keep, "다운로드 실패 정리");
    if keep {
        if let Err(ce) = p.checkpoint(|_| {}).await {
            tracing::warn!(error = %ce, "실패 후 checkpoint 실패");
        }
    } else if let Err(de) = p.discard() {
        tracing::warn!(error = %de, "이어받을 수 없는 .part 삭제 실패");
    }
}

/// 마지막 checkpoint 후 `.part`를 최종 파일로 옮긴다.
pub(crate) async fn finish(
    job: &mut Job<'_>,
    part: &mut Option<PartFile>,
    resumed_from: u64,
) -> Result<DownloadOutcome, Error> {
    job.report.phase(Phase::Finalizing);
    let mut p = part.take().ok_or_else(|| Error::Parse {
        what: "download",
        detail: "받은 내용이 없습니다".into(),
    })?;
    if let Err(e) = p.checkpoint(|_| {}).await {
        *part = Some(p);
        return Err(e);
    }
    let bytes = p.written();
    match p.finalize(job.req.on_existing).await? {
        Finalized::Moved(path) => Ok(DownloadOutcome::Completed {
            path,
            bytes,
            resumed_from,
        }),
        Finalized::TargetExists => Ok(DownloadOutcome::Skipped {
            path: job.req.output.clone(),
        }),
    }
}
