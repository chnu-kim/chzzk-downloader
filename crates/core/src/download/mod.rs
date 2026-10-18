//! 다운로드 엔진(설계 §4.2·§5).
//!
//! - `part`: `.part`·sidecar와 크래시 불변식
//! - `retry`: 재시도 정책과 실패 분류
//! - `progressive`: PD mp4 단일 GET + Range 이어받기
//! - `segmented`: 빠른 다시보기 HLS fMP4, 순서 보장 동시 fetch
//! - `live`: 진행 중인 생방송 HLS fMP4, playlist를 계속 읽어 새 세그먼트를 이어 받는다
//! - `defrag`: 생방송·빠른 다시보기 결과(조각난 fMP4, 전체·구간 모두)를 마무리 직전에 일반 mp4로 제자리 변환한다
//!
//! 공통 골격(`Chzzk::download`):
//! 1. 최종 파일이 있으면 `Skip` → `Skipped`(네트워크 0회), `Overwrite` → 계속.
//! 2. 같은 작업의 `.part`가 있으면 잠그고 이어받는다. 다르면 지우고 새로 시작한다(다른 작업의 생방송 녹화면
//!    지우지 않고 `PartialRecording`).
//! 3. `Resolving`: `resolve`. 방식이 바뀌었으면 `PlaybackChanged`.
//! 4. 엔진 실행. 403이면 `Reresolving` → 재조회(상한 8회).
//! 5. `Finalizing`: checkpoint → `.part` → 최종 파일. `Skip`이면 덮어쓰지 않는 rename을 쓰고, 받는 동안
//!    최종 파일이 생겼으면 `.part`를 남긴 채 `Skipped`다.
//!
//! 실패·취소 시 `.part`와 sidecar를 남긴다(checkpoint 후). `is_resumable() == false`인 오류만 지운다.
//! 단 `resolve` 실패와 작업 도중 재조회의 지문 불일치는 남긴다(`Job::keep_partial`).

pub mod defrag;
pub(crate) mod live;
pub mod part;
pub(crate) mod progressive;
pub mod retry;
pub(crate) mod segmented;

use std::future::Future;
use std::num::NonZeroU8;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use tokio::time::Instant as TokioInstant;
use tokio_util::sync::CancellationToken;

use crate::client::Chzzk;
use crate::error::{Error, Unsupported};
use crate::fsutil::map_io_error;
use crate::model::{ContentRef, PlaybackKind, Resolved, Source, TimeRange};
use crate::progress::{Meter, Phase, Progress};

pub use part::{Discarded, Finalized, PartFile, PartOwner, Sidecar, discard_partial};
pub use retry::{Failure, NETWORK_PATIENCE_MS, RETRY_BACKOFF_MAX_MS, RetryPolicy};
use retry::{Patience, is_connection_failure};

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
    /// 생방송만: 이 토큰이 취소되면 지금까지 받은 것을 최종 파일로 마무리하고 `Completed`로 끝낸다
    /// (`cancel`은 `.part`를 남기고 `Cancelled`로 끝나는 다른 뜻이다). 생방송이 아니면 쓰지 않는다.
    pub live_stop: Option<CancellationToken>,
    /// 생방송만: 이 녹화 작업의 고유값(셸이 작업을 만들 때 정한다). sidecar에 적고, 같은 값의 요청만 그 `.part`를
    /// 마무리하거나 지운다. 새 녹화는 새 값이라 남의 `.part`를 마무리하지 않는다. `None`은 v0.7.0 작업(core.md 61)
    pub recording_id: Option<String>,
    /// 빠른 다시보기만: 이 시각 구간만 받는다(기능 ②). `None`은 전체다.
    /// `Some`이면 `expected_kind`가 `LiveRewindHls`여야 하고, 아니면 `Unsupported(RangeNotHls)`다.
    /// 결과는 마무리 때 일반 mp4로 바꾼다(`finish`).
    pub range: Option<TimeRange>,
}

impl DownloadRequest {
    /// 이 요청이 `.part`의 주인인지 가리는 열쇠.
    pub fn owner(&self) -> PartOwner<'_> {
        PartOwner {
            content: &self.content,
            quality_id: &self.quality_id,
            kind: self.expected_kind,
            recording_id: self.recording_id.as_deref(),
            range: self.range,
        }
    }
}

/// 생방송 녹화가 끝난 이유(core.md 구현 중 변경 65).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LiveEndReason {
    /// 방송이 끝났다: `EXT-X-ENDLIST`, 재조회가 방송 종료(`NotLive`)
    Ended,
    /// 사용자가 [녹화 마치기]를 눌렀다(`DownloadRequest::live_stop`)
    Stopped,
    /// 스트림이 다시 시작되었다: msn이 `BACK_CONFIRM`번 연달아 거꾸로 감, init 파일 이름 바뀜,
    /// `EXT-X-DISCONTINUITY`·두 번째 `EXT-X-MAP`, 재조회 결과의 방송 ID가 바뀜. 채널은 지금도 방송 중일 수 있다
    Restarted,
    /// 그 밖: 앞선 실행에서 끊긴 `.part`를 이번 실행이 받은 만큼 마무리했다
    Other,
}

/// 생방송 녹화의 끝 정보.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LiveEnd {
    pub reason: LiveEndReason,
    /// 놓친 세그먼트 수. 앞선 실행의 `.part`를 마무리한 경우(`Other`)는 모른다(`None`)
    pub gaps: Option<u32>,
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
        /// 생방송 녹화만: 끝난 이유와 놓친 세그먼트 수. 생방송이 아니면 `None`
        live: Option<LiveEnd>,
    },
    /// `Skip`인데 최종 파일이 있었다. 시작 전에 있었으면 네트워크 0회, 받는 동안 생겼으면 받은 `.part`와
    /// sidecar가 남는다(같은 요청을 `Overwrite`로 다시 부르면 이어받아 곧바로 마무리된다).
    Skipped { path: PathBuf },
}

impl DownloadOutcome {
    /// 생방송 결과에 끝 정보를 붙인다. `Skipped`는 그대로 둔다.
    pub(crate) fn with_live(self, end: LiveEnd) -> Self {
        match self {
            DownloadOutcome::Completed {
                path,
                bytes,
                resumed_from,
                ..
            } => DownloadOutcome::Completed {
                path,
                bytes,
                resumed_from,
                live: Some(end),
            },
            s @ DownloadOutcome::Skipped { .. } => s,
        }
    }
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
                live: None,
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

    /// 연결 계열 실패(`e`)를 인내 모드로 기다려 준다(core.md 구현 중 변경 56).
    ///
    /// 연결 계열이 아니거나 예산을 다 썼으면 `e`를 그대로 돌려준다. 기다리는 동안 phase를 `WaitingNetwork`로
    /// 알린다(이미 그 phase면 다시 알리지 않는다). 대기는 취소되면 곧바로 `Cancelled`로 끝난다.
    pub(crate) async fn wait_for_network(
        &mut self,
        patience: &mut Patience,
        e: Error,
        took: Duration,
    ) -> Result<(), Error> {
        if !is_connection_failure(&e) {
            return Err(e);
        }
        let policy = self.chzzk.config().retry;
        let Some(wait) = patience.on_failure(&policy, took) else {
            return Err(e);
        };
        if self.report.p.phase != Phase::WaitingNetwork {
            self.report.phase(Phase::WaitingNetwork);
        }
        tracing::debug!(wait_ms = wait.as_millis() as u64, error = %e, "연결 대기");
        self.sleep(wait).await
    }

    /// 연결 대기 중이었으면 `Downloading`으로 되돌린다(진전이 있었거나 다시 연결되었을 때).
    pub(crate) fn resume_downloading(&mut self) {
        if self.report.p.phase == Phase::WaitingNetwork {
            self.report.phase(Phase::Downloading);
        }
    }

    /// `resolve` 후 방식이 요청과 같은지 확인한다.
    ///
    /// 연결 계열 실패는 빠른 재시도(조용히) 뒤 인내 모드로 기다린다. 홈 카드의 대화형 `Chzzk::resolve`는
    /// 이 경로를 타지 않는다(사용자가 30분을 기다리면 안 된다).
    async fn resolve(&mut self) -> Result<Resolved, Error> {
        let policy = self.chzzk.config().retry;
        let mut quick = 0u32;
        let mut patience = Patience::default();
        let r = loop {
            let started = TokioInstant::now();
            let res = self
                .cancellable(self.chzzk.resolve(&self.req.content))
                .await?;
            let e = match res {
                Ok(r) => break r,
                Err(e) => e,
            };
            if !is_connection_failure(&e) {
                self.keep_partial = true;
                return Err(e);
            }
            quick += 1;
            if policy.allows_retry(quick) {
                self.sleep(policy.delay(quick - 1)).await?;
                continue;
            }
            if let Err(e) = self
                .wait_for_network(&mut patience, e, started.elapsed())
                .await
            {
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
        // 구간 요청의 검증은 맨 앞이다. `resume`보다 뒤면 같은 경로의 다른 작업 `.part`가 소유 불일치로
        // 지워지고, Skip보다 뒤면 잘못된 요청이 `Skipped`로 조용히 성공한다(core.md 64).
        if let Some(r) = req.range {
            if req.expected_kind != PlaybackKind::LiveRewindHls {
                return Err(Error::Unsupported(Unsupported::RangeNotHls));
            }
            if let Some(e) = r.end_ms
                && r.start_ms >= e
            {
                return Err(Error::RangeOutOfBounds {
                    detail: format!("시작 {}ms가 끝 {e}ms보다 늦거나 같습니다", r.start_ms),
                });
            }
        }
        if req.output.exists() && req.on_existing == DuplicatePolicy::Skip {
            return Ok(DownloadOutcome::Skipped { path: req.output });
        }
        if let Some(dir) = req.output.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(|e| map_io_error("create dir", dir, e))?;
        }
        let mut part = PartFile::resume(&req.output, &req.owner())?;
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
    // 앞선 생방송 녹화가 중간에 끊겨 `.part`가 남았다면 이어 받지 않고(방송 흐름이 끊겼다) 받은 만큼을 마무리한다.
    // init뿐인 `.part`(세그먼트를 하나도 받기 전에 끊겼다)는 재생할 수 없는 파일이 되므로 지우고 새로 녹화한다.
    if job.req.expected_kind == PlaybackKind::Live
        && let Some(p) = part.as_ref()
    {
        // `resume` 직후라 `sidecar().committed_len == written()`이다
        if p.sidecar().has_live_media() {
            let resumed_from = p.written();
            // 앞선 실행에서 끊긴 녹화를 받은 만큼 마무리한다. 구멍 수는 sidecar에 없어 모른다
            return finish(job, part, resumed_from).await.map(|o| {
                o.with_live(LiveEnd {
                    reason: LiveEndReason::Other,
                    gaps: None,
                })
            });
        }
        if let Some(p) = part.take() {
            p.discard()?;
        }
    }
    job.report.phase(Phase::Resolving);
    // 생방송은 첫 조회를 기다리는 동안에도(연결 대기 최대 30분) [녹화 마치기]가 먹는다. 아직 받은 조각이 없으니
    // `NothingRecorded`다(core.md 61). 토큰을 먼저 복제해 `job`을 빌린 채 기다리지 않는다.
    let resolved = if job.req.expected_kind == PlaybackKind::Live
        && let Some(stop) = job.req.live_stop.clone()
    {
        tokio::select! {
            biased;
            _ = stop.cancelled() => return Err(Error::NothingRecorded),
            r = job.resolve() => r?,
        }
    } else {
        job.resolve().await?
    };
    job.report.phase(Phase::Downloading);
    match resolved.source {
        Source::Progressive { reps } => progressive::run(job, reps, part).await,
        Source::LiveRewindHls { master_url, tracks } => {
            segmented::run(job, master_url, tracks, part).await
        }
        Source::Live {
            master_url,
            tracks,
            live_id,
        } => live::run(job, master_url, tracks, live_id, part).await,
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

/// 조각 구조 변환 결과로 마무리를 이어 갈지 정한다(core.md 61 M4). `Ok(true)`: 바꿨으니 checkpoint 뒤 마무리,
/// `Ok(false)`: 그대로 마무리(이미 일반 mp4·조각 아님·바꾸기 전 구조 판정 실패), `Err`: 마무리하지 않는다(바꾸는 도중
/// 실패·읽기 입출력 오류로 파일 상태를 확인하지 못함, `DefragError::Modified`).
fn defrag_verdict(
    r: Result<Result<defrag::DefragReport, defrag::DefragError>, Error>,
) -> Result<bool, Error> {
    match r {
        Ok(Ok(rep)) => {
            tracing::info!(report = ?rep, "조각 구조 파일을 일반 mp4로 변환");
            Ok(matches!(rep, defrag::DefragReport::Converted { .. }))
        }
        Ok(Err(defrag::DefragError::Unchanged(e))) => {
            tracing::warn!(error = %e, "일반 mp4로 바꾸지 못해 조각 구조로 둔다");
            Ok(false)
        }
        Ok(Err(defrag::DefragError::Modified(e))) => {
            tracing::warn!(error = %e, "변환이 도중에 실패했거나 파일을 읽지 못해 .part로 둔다");
            Err(e)
        }
        // 핸들 복제·flush·태스크 실패: 파일 상태를 모르니 마무리하지 않는다
        Err(e) => Err(e),
    }
}

/// 이 방식의 결과가 조각난 fMP4라 마무리에서 일반 mp4로 바꾸는가(core.md 구현 중 변경 60·64·71).
///
/// `expected_kind`로 정해도 되는 것은 `Job::resolve`가 재조회 방식이 다르면 `PlaybackChanged`로 멈추기 때문이다(엔진은
/// 늘 `expected_kind`와 같은 `Source`로 돈다). 새 방식이 생기면 컴파일 오류로 여기서 정하게 `match`로 쓴다.
fn converts_on_finish(kind: PlaybackKind) -> bool {
    match kind {
        // HLS fMP4 조각을 받은 그대로 이어 붙인다(`segmented`·`live`). 전체·구간 받기 모두다
        PlaybackKind::LiveRewindHls | PlaybackKind::Live => true,
        // MPD의 PD rep 하나를 통째로 받은 일반 mp4다(`progressive`). DASH 조각 경로는 없다(`mpd::pd_reps`)
        PlaybackKind::Progressive => false,
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
    // 생방송과 빠른 다시보기(전체·구간) 결과는 조각 구조를 일반 mp4로 바꾼다(core.md 구현 중 변경 60·64·71). 바로 위
    // checkpoint로 받은 바이트가 모두 durable하므로, 변환 도중 죽어도 다음 실행의 `resume`이 붙인 moov만 잘라 내고 다시 변환한다.
    // 바꾸기 전 실패는 경고만 남기고 조각 구조로 마무리하고, 바꾸는 도중 실패는 `.part`로 남긴다(core.md 61).
    if converts_on_finish(job.req.expected_kind) {
        // 파일 전체 훑기·fsync는 오래 걸릴 수 있어 blocking 스레드에서 한다.
        let r = p
            .with_file_blocking(|f| Ok(defrag::defragment_in(f, None)))
            .await;
        // 빠른 다시보기 조각의 시각이 이어지지 않으면 경고만 남긴다(판정이나 오류로 쓰지 않는다). 생방송은 놓친 조각을
        // 따로 센다(`LiveEnd::gaps`).
        if job.req.expected_kind == PlaybackKind::LiveRewindHls
            && let Ok(Ok(defrag::DefragReport::Converted {
                discontinuities, ..
            })) = &r
            && *discontinuities > 0
        {
            tracing::warn!(
                discontinuities = *discontinuities,
                "빠른 다시보기 조각의 시각이 이어지지 않는다"
            );
        }
        match defrag_verdict(r) {
            Ok(true) => {
                // 변환이 붙인 moov까지 committed_len에 넣는다(마무리가 Skipped로 끝나 `.part`가 남아도 잘리지 않게).
                // 변환에 실패했으면 checkpoint하지 않는다(디스크 부족에서 sidecar 쓰기가 또 실패해 녹화가 실패로 끝나면 안 된다).
                if let Err(e) = p.checkpoint(|_| {}).await {
                    *part = Some(p);
                    return Err(e);
                }
            }
            Ok(false) => {}
            Err(e) => {
                // 변환 도중 실패: 반쯤 바뀐 파일을 최종 파일로 옮기지 않는다. 변환 전 길이까지만 남기고
                // (다음 resume이 꼬리를 자른다) .part로 둔다
                p.drop_uncommitted_tail();
                *part = Some(p);
                return Err(e);
            }
        }
    }
    let bytes = p.written();
    match p.finalize(job.req.on_existing).await? {
        Finalized::Moved(path) => Ok(DownloadOutcome::Completed {
            path,
            bytes,
            resumed_from,
            live: None,
        }),
        Finalized::TargetExists => Ok(DownloadOutcome::Skipped {
            path: job.req.output.clone(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use defrag::{DefragError, DefragReport};

    /// 끝 정보는 `Completed`에만 붙고 `Skipped`는 그대로 둔다.
    #[test]
    fn with_live_keeps_skipped() {
        let e = LiveEnd {
            reason: LiveEndReason::Stopped,
            gaps: Some(2),
        };
        let s = DownloadOutcome::Skipped {
            path: PathBuf::from("a.mp4"),
        };
        assert!(matches!(s.with_live(e), DownloadOutcome::Skipped { .. }));
        let c = DownloadOutcome::Completed {
            path: PathBuf::from("a.mp4"),
            bytes: 7,
            resumed_from: 3,
            live: None,
        };
        match c.with_live(e) {
            DownloadOutcome::Completed {
                path,
                bytes,
                resumed_from,
                live,
            } => {
                assert_eq!(path, PathBuf::from("a.mp4"));
                assert_eq!((bytes, resumed_from), (7, 3));
                assert_eq!(live, Some(e));
            }
            o => panic!("{o:?}"),
        }
    }

    fn parse_err() -> Error {
        Error::Parse {
            what: "fragmented mp4",
            detail: "x".into(),
        }
    }

    /// 마무리 변환은 조각난 fMP4를 내놓는 방식만 한다(core.md 71). PD mp4는 건드리지 않는다.
    #[test]
    fn converts_on_finish_only_fragmented_kinds() {
        assert!(converts_on_finish(PlaybackKind::LiveRewindHls));
        assert!(converts_on_finish(PlaybackKind::Live));
        assert!(!converts_on_finish(PlaybackKind::Progressive));
    }

    /// 변환 결과로 마무리를 이어 갈지 정하는 표(core.md 61 M4).
    #[test]
    fn defrag_verdict_table() {
        let converted = DefragReport::Converted {
            tracks: 1,
            samples: 1,
            discontinuities: 0,
        };
        assert!(matches!(defrag_verdict(Ok(Ok(converted))), Ok(true)));
        assert!(matches!(
            defrag_verdict(Ok(Ok(DefragReport::AlreadyFlat))),
            Ok(false)
        ));
        assert!(matches!(
            defrag_verdict(Ok(Ok(DefragReport::NotFragmented))),
            Ok(false)
        ));
        // 바꾸기 전 실패(또는 되돌렸다): 조각 구조로 마무리한다
        assert!(matches!(
            defrag_verdict(Ok(Err(DefragError::Unchanged(parse_err())))),
            Ok(false)
        ));
        // 바꾸는 도중 실패: 마무리하지 않는다
        assert!(matches!(
            defrag_verdict(Ok(Err(DefragError::Modified(parse_err())))),
            Err(Error::Parse { .. })
        ));
        // 태스크·핸들 실패: 파일 상태를 모르니 마무리하지 않는다
        assert!(matches!(
            defrag_verdict(Err(Error::Cancelled)),
            Err(Error::Cancelled)
        ));
    }
}
