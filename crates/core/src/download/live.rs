//! 진행 중인 생방송 HLS(fMP4) 녹화(core.md 구현 중 변경 "생방송").
//!
//! 빠른 다시보기(`segmented`)와 달리 playlist가 계속 자란다(약 40초 창이 밀린다). 그래서:
//!
//! 1. master → variant → media playlist를 읽고 init을 받아 `.part`에 쓴다.
//! 2. `next_msn`(다음에 받을 `EXT-X-MEDIA-SEQUENCE` 번호)부터 새 세그먼트를 순서대로 이어 쓴다.
//!    창이 `next_msn`을 지나가 버렸으면(느린 네트워크) 놓친 수를 `gaps`로 세고 계속한다.
//! 3. `live_poll_interval`마다 playlist를 다시 읽는다.
//! 4. 끝나는 조건(받은 것을 최종 파일로 마무리, `Completed`):
//!    - `EXT-X-ENDLIST`, 스트림 재시작(`EXT-X-DISCONTINUITY`·새 MAP·msn이 거꾸로 감·init 경로가 바뀜)
//!    - 재조회 결과가 방송 종료(`NotLive`)이거나 `liveId`가 바뀜(다른 방송을 이어 붙이지 않는다)
//!    - 사용자의 멈춤(`DownloadRequest::live_stop`)
//!
//!    끝난 이유는 `DownloadOutcome::Completed.live`(`LiveEnd`)에 싣는다(core.md 65).
//!
//!    `cancel`은 이것과 다르다: `.part`를 남기고 `Cancelled`로 끝난다.
//! 5. 403/404로 playlist를 못 읽으면 재조회한다. 새 세그먼트를 받으면 재조회 횟수를 다시 센다
//!    (몇 시간 녹화에서 일시적 403이 쌓여 `RefreshExhausted`가 되지 않도록).
//! 6. 새 세그먼트가 `live_idle_check` 동안 없으면 방송이 끝났는지 재조회한다.
//!
//! 이어받기는 없다. 끊긴 `.part`는 다음 실행에서 받은 만큼 마무리한다(`download::run`).
//! 아무것도 받지 못하고 끝나면 init만 든 파일을 남기지 않는다(멈춤이면 `NothingRecorded`, 방송 종료면 `NotLive`).

use std::time::{Duration, Instant};

use ::url::Url;
use bytes::Bytes;
use futures_util::StreamExt;
use futures_util::stream;
use tokio::time::Instant as TokioInstant;
use tokio_util::sync::CancellationToken;

use super::part::{HlsState, PartFile, Sidecar};
use super::retry::{Failure, Patience, is_connection_failure};
use super::segmented::{Body, fetch, fetch_cancellable, pick_variant, utf8};
use super::{DownloadOutcome, Job, LiveEnd, LiveEndReason, MAX_CONCURRENCY, finish};
use crate::error::{Error, Unsupported};
use crate::hls::{self, LiveSnapshot};
use crate::model::{PlaybackKind, Quality, Source};
use crate::progress::LiveProgress;

/// 세그먼트 수 기준 checkpoint 주기.
const CHECKPOINT_SEGMENTS: u32 = 16;
/// 시간 기준 checkpoint 주기.
const CHECKPOINT_EVERY: Duration = Duration::from_secs(5);

/// 지금 받고 있는 방송의 주소.
struct Feed {
    media_url: Url,
    live_id: u64,
}

/// 녹화 누적값.
struct Recording {
    next_msn: Option<u64>,
    recorded_ms: u64,
    gaps: u32,
    segments: u32,
}

/// 재조회 결과.
enum Refreshed {
    /// 같은 방송이다. `feed`가 새 주소로 바뀌었다.
    Same,
    /// 방송이 끝났다(`NotLive`).
    Ended,
    /// 다른 방송이다(방송 ID가 바뀜). 채널은 지금 방송 중이다.
    NewLive,
}

impl Refreshed {
    /// 녹화를 끝내야 하면 그 이유. 같은 방송이면 `None`.
    fn end(self) -> Option<LiveEndReason> {
        match self {
            Refreshed::Same => None,
            Refreshed::Ended => Some(LiveEndReason::Ended),
            Refreshed::NewLive => Some(LiveEndReason::Restarted),
        }
    }
}

/// 멈춤이 먼저 오면 `None`, 아니면 `Some(결과)`. 기다리는 구간(연결 대기·playlist 읽기·재조회)에서 멈춤이 먹게 한다.
macro_rules! until_stop {
    ($stop:expr, $fut:expr) => {
        tokio::select! {
            biased;
            _ = $stop.cancelled() => None,
            r = $fut => Some(r),
        }
    };
}

/// 연달아 이만큼 일시 오류(5xx·본문 검증 실패)가 나면 녹화를 오류로 끝낸다. 하나하나는 구멍으로 세고 계속한다.
const MAX_FLAKY: u32 = 10;
/// msn이 거꾸로 간 playlist를 연달아 이만큼 봐야 스트림 재시작으로 본다(CDN 엣지가 낡은 playlist를 한 번 줄 수 있다).
const BACK_CONFIRM: u32 = 3;
/// 멈춤이 오면 이미 요청해 둔 세그먼트를 이만큼 더 기다려 마저 쓴다.
const DRAIN: Duration = Duration::from_secs(3);

/// playlist 읽기·init 받기 실패를 다룬 결과.
enum Handled {
    /// 기다렸다. 다시 시도한다.
    Again,
    /// 서명이 만료되었다. 호출한 쪽이 재조회한다.
    Refresh,
    /// 기다리는 동안 멈춤이 왔다.
    Stopped,
}

/// init 주소의 파일 이름. 서명이 경로에 들어가는 주소가 바뀌어도 같은 init이면 같다.
fn init_name(u: &Url) -> String {
    u.path_segments()
        .and_then(|mut s| s.next_back())
        .unwrap_or("")
        .to_string()
}

/// 녹화를 끝까지 한다.
pub(crate) async fn run(
    job: &mut Job<'_>,
    master_url: Url,
    tracks: Vec<Quality>,
    live_id: u64,
    part: &mut Option<PartFile>,
) -> Result<DownloadOutcome, Error> {
    let stop = job.req.live_stop.clone().unwrap_or_default();
    let concurrency = usize::from(job.req.concurrency.get().min(MAX_CONCURRENCY));
    let cfg = job.chzzk.config();
    let (poll, idle_check, policy) = (cfg.live_poll_interval, cfg.live_idle_check, cfg.retry);

    let Some(media_url) = until_stop!(stop, variant_url(job, &master_url, &tracks)) else {
        return Err(Error::NothingRecorded);
    };
    let mut feed = Feed {
        media_url: media_url?,
        live_id,
    };
    let mut patience = Patience::default();
    let mut since_progress = TokioInstant::now();
    // playlist·init 읽기의 연속 일시 오류 수와, 세그먼트의 연속 일시 오류 수. 서로 성공해도 상대를 되돌리지 않는다
    // (모든 새 세그먼트가 5xx인 서버가 playlist만 성공한다고 한도에 영영 닿지 않으면 녹화가 끝나지 않는다)
    let mut flaky = 0u32;
    let mut seg_flaky = 0u32;
    let mut quiet = TokioInstant::now();

    // 첫 playlist와 init. 방송 시작 직후라 playlist가 아직 없거나 세그먼트가 0개일 수 있다.
    let (mut snap, init) = loop {
        let attempt = until_stop!(stop, async {
            let s = read_playlist(job, &feed.media_url).await?;
            let init_url = s
                .playlist
                .init
                .clone()
                .ok_or(Failure::Fatal(Error::Unsupported(Unsupported::MissingMap)))?;
            let init = fetch_cancellable(job, policy, &init_url, Body::Init).await?;
            Ok::<_, Failure>((s, init))
        });
        let Some(attempt) = attempt else {
            return Err(Error::NothingRecorded);
        };
        match attempt {
            Ok(x) => break x,
            Err(f) => {
                match handle_failure(
                    job,
                    &mut patience,
                    &mut since_progress,
                    &mut flaky,
                    &stop,
                    poll,
                    f,
                )
                .await?
                {
                    Handled::Stopped => return Err(Error::NothingRecorded),
                    Handled::Again => {
                        // 한참 아무것도 없다. 방송이 끝났는지 본다(403 재조회 예산은 쓰지 않는다).
                        if quiet.elapsed() >= idle_check {
                            quiet = TokioInstant::now();
                            match until_stop!(stop, refresh_free(job, &mut feed, &tracks)) {
                                None => return Err(Error::NothingRecorded),
                                Some(r) => {
                                    if r?.end().is_some() {
                                        return Err(Error::NotLive);
                                    }
                                }
                            }
                        }
                    }
                    Handled::Refresh => {
                        match until_stop!(stop, refresh(job, &mut feed, &tracks)) {
                            None => return Err(Error::NothingRecorded),
                            Some(r) => {
                                if r?.end().is_some() {
                                    return Err(Error::NotLive);
                                }
                            }
                        }
                        if !wait_or_stop(job, &stop, poll).await? {
                            return Err(Error::NothingRecorded);
                        }
                    }
                }
            }
        }
    };
    flaky = 0;
    job.resume_downloading();

    let init_file = snap
        .playlist
        .init
        .as_ref()
        .map(init_name)
        .unwrap_or_default();
    let mut sc = Sidecar::new(
        job.req.content.clone(),
        job.req.quality_id.clone(),
        PlaybackKind::Live,
    );
    sc.recording_id = job.req.recording_id.clone();
    sc.hls = Some(HlsState {
        init_len: init.len() as u32,
        ..HlsState::default()
    });
    let p = part.insert(PartFile::create(&job.req.output, sc)?);
    // 이 뒤의 어떤 오류로 끝나도 받은 것은 지우지 않는다(다음 실행이 받은 만큼 마무리한다)
    job.keep_partial = true;
    p.write(&init)?;
    p.checkpoint(|_| {}).await?;

    let mut st = Recording {
        next_msn: None,
        recorded_ms: 0,
        gaps: 0,
        segments: 0,
    };
    let mut last_cp = Instant::now();
    let mut since_cp = 0u32;
    let mut idle_since = TokioInstant::now();
    let mut back_streak = 0u32;

    let end = 'poll: loop {
        let first = snap.playlist.segments.first().map(|s| s.msn);
        let last = snap.playlist.segments.last().map(|s| s.msn);
        // 스트림이 다시 시작되었다: msn이 연달아 거꾸로 갔거나 init 파일이 바뀌었다.
        let went_back = matches!((st.next_msn, last), (Some(next), Some(last)) if last + 1 < next);
        back_streak = if went_back { back_streak + 1 } else { 0 };
        let new_init = snap
            .playlist
            .init
            .as_ref()
            .is_some_and(|u| init_name(u) != init_file);
        if back_streak >= BACK_CONFIRM || new_init {
            break 'poll LiveEndReason::Restarted;
        }
        // 창이 우리를 지나갔다: 놓친 만큼 구멍으로 센다.
        match (st.next_msn, first) {
            (Some(next), Some(first)) if first > next => {
                st.gaps += u32::try_from(first - next).unwrap_or(u32::MAX);
                st.next_msn = Some(first);
            }
            (None, first) => st.next_msn = first,
            _ => {}
        }
        let todo: Vec<(u64, u32, Url)> = snap
            .playlist
            .segments
            .iter()
            .filter(|s| st.next_msn.is_some_and(|n| s.msn >= n))
            .map(|s| (s.msn, s.duration_ms, s.uri.clone()))
            .collect();

        let mut got_any = false;
        let mut expired = false;
        let mut stopped = false;
        if !todo.is_empty() {
            let chzzk = job.chzzk;
            // `buffered`는 입력 순서대로 내놓으므로 writer는 단일 루프다.
            let mut segs = stream::iter(todo)
                .map(|(msn, dur, u)| async move {
                    (msn, dur, fetch(chzzk, policy, &u, Body::Segment).await)
                })
                .buffered(concurrency);
            // 멈춤이 오면 이미 요청해 둔 세그먼트를 이 시각까지 마저 받아 쓴다.
            let mut deadline: Option<TokioInstant> = None;
            loop {
                let item = tokio::select! {
                    biased;
                    _ = job.cancel.cancelled() => return Err(Error::Cancelled),
                    _ = stop.cancelled(), if deadline.is_none() => {
                        stopped = true;
                        deadline = Some(TokioInstant::now() + DRAIN);
                        continue;
                    }
                    _ = async {
                        match deadline {
                            Some(d) => tokio::time::sleep_until(d).await,
                            None => std::future::pending::<()>().await,
                        }
                    } => break,
                    it = segs.next() => it,
                };
                let Some((msn, dur, r)) = item else { break };
                match r {
                    Ok(bytes) => {
                        p.write(&bytes)?;
                        st.next_msn = Some(msn + 1);
                        st.recorded_ms += u64::from(dur);
                        st.segments += 1;
                        got_any = true;
                        seg_flaky = 0;
                        patience.reset();
                        since_progress = TokioInstant::now();
                        job.refreshes = 0;
                        job.resume_downloading();
                        since_cp += 1;
                        report(job, p.written(), &st);
                        if since_cp >= CHECKPOINT_SEGMENTS || last_cp.elapsed() >= CHECKPOINT_EVERY
                        {
                            p.checkpoint(|_| {}).await?;
                            since_cp = 0;
                            last_cp = Instant::now();
                        }
                    }
                    // 멈춘 뒤 마저 받는 중의 실패는 그 조각만 포기한다.
                    Err(_) if stopped => break,
                    // 창에서 이미 밀려난 세그먼트: 구멍으로 세고 넘어간다.
                    Err(Failure::Fatal(Error::HttpStatus {
                        status: 404 | 410, ..
                    })) => {
                        st.gaps += 1;
                        st.next_msn = Some(msn + 1);
                        report(job, p.written(), &st);
                    }
                    Err(Failure::Expired) => {
                        expired = true;
                        break;
                    }
                    Err(Failure::Retry(e)) if is_connection_failure(&e) => {
                        drop(segs);
                        match until_stop!(
                            stop,
                            job.wait_for_network(&mut patience, e, since_progress.elapsed())
                        ) {
                            None => break 'poll LiveEndReason::Stopped,
                            Some(r) => r?,
                        }
                        since_progress = TokioInstant::now();
                        // 같은 playlist로 `next_msn`부터 다시 시작한다.
                        continue 'poll;
                    }
                    // 일시 오류(5xx를 다 쓴 재시도·본문 검증 실패 등): 구멍으로 세고 계속한다.
                    // 연달아 한도를 넘으면 서버가 아무것도 못 주는 것이라 오류로 끝낸다(`.part`는 남는다).
                    Err(Failure::Retry(e) | Failure::Fatal(e)) if is_transient(&e) => {
                        seg_flaky += 1;
                        if seg_flaky > MAX_FLAKY {
                            return Err(e);
                        }
                        st.gaps += 1;
                        st.next_msn = Some(msn + 1);
                        report(job, p.written(), &st);
                    }
                    Err(Failure::Retry(e) | Failure::Fatal(e)) => return Err(e),
                }
            }
        }
        if stopped {
            break 'poll LiveEndReason::Stopped;
        }
        if got_any {
            idle_since = TokioInstant::now();
        }

        if expired {
            // 서명 만료 뒤 재조회. 기다리는 동안 멈춤이 오면 받은 만큼 마무리한다(core.md 61)
            match until_stop!(stop, refresh(job, &mut feed, &tracks)) {
                None => break 'poll LiveEndReason::Stopped,
                Some(r) => {
                    if let Some(end) = r?.end() {
                        break 'poll end;
                    }
                }
            }
        } else if snap.ended {
            break 'poll if snap.restarted {
                LiveEndReason::Restarted
            } else {
                LiveEndReason::Ended
            };
        } else if !got_any && idle_since.elapsed() >= idle_check {
            // 한참 새 세그먼트가 없다. 방송이 끝났는지 본다(403 재조회 예산은 쓰지 않는다).
            match until_stop!(stop, refresh_free(job, &mut feed, &tracks)) {
                None => break 'poll LiveEndReason::Stopped,
                Some(r) => match r?.end() {
                    None => idle_since = TokioInstant::now(),
                    Some(end) => break 'poll end,
                },
            }
        } else if !wait_or_stop(job, &stop, poll).await? {
            break 'poll LiveEndReason::Stopped;
        }

        // 다음 playlist. 읽는 동안에도 멈춤이 먹는다(공통 fetch 도우미는 cancel만 본다).
        // 읽지 못하면 처리 방식에 따라 같은 자리로 돌아오거나 끝낸다.
        let Some(read) = until_stop!(stop, read_playlist(job, &feed.media_url)) else {
            break 'poll LiveEndReason::Stopped;
        };
        snap = match read {
            Ok(s) => {
                flaky = 0;
                s
            }
            Err(f) => {
                match handle_failure(
                    job,
                    &mut patience,
                    &mut since_progress,
                    &mut flaky,
                    &stop,
                    poll,
                    f,
                )
                .await?
                {
                    Handled::Stopped => break 'poll LiveEndReason::Stopped,
                    Handled::Again => continue 'poll,
                    Handled::Refresh => match until_stop!(stop, refresh(job, &mut feed, &tracks)) {
                        None => break 'poll LiveEndReason::Stopped,
                        Some(r) => match r?.end() {
                            None => continue 'poll,
                            Some(end) => break 'poll end,
                        },
                    },
                }
            }
        };
    };

    if st.segments == 0 {
        // 아무것도 받지 못했다. init만 든 파일은 남기지 않는다.
        if let Some(p) = part.take() {
            p.discard()?;
        }
        return Err(if stop.is_cancelled() {
            Error::NothingRecorded
        } else {
            Error::NotLive
        });
    }
    let gaps = st.gaps;
    finish(job, part, 0).await.map(|o| {
        o.with_live(LiveEnd {
            reason: end,
            gaps: Some(gaps),
        })
    })
}

/// 연달아 세어 한도까지 구멍으로 넘길 수 있는 일시 오류.
fn is_transient(e: &Error) -> bool {
    matches!(
        e,
        Error::HttpStatus { .. } | Error::Parse { .. } | Error::Network(_)
    )
}

fn report(job: &mut Job<'_>, bytes: u64, st: &Recording) {
    job.report.update(|r| {
        r.bytes = bytes;
        r.live = Some(LiveProgress {
            recorded_secs: st.recorded_ms as f64 / 1000.0,
            gaps: st.gaps,
        });
    });
}

/// 서명 주소가 만료되었거나 한참 조용해서 다시 조회한다.
async fn refresh(
    job: &mut Job<'_>,
    feed: &mut Feed,
    tracks: &[Quality],
) -> Result<Refreshed, Error> {
    let r = match job.reresolve().await {
        Ok(r) => r,
        Err(Error::NotLive) => return Ok(Refreshed::Ended),
        Err(e) => return Err(e),
    };
    let now = r.kind();
    let Source::Live {
        master_url,
        tracks: fresh,
        live_id,
    } = r.source
    else {
        return Err(Error::PlaybackChanged {
            was: PlaybackKind::Live,
            now,
        });
    };
    // 다른 방송을 이어 붙이지 않는다.
    if live_id != feed.live_id {
        return Ok(Refreshed::NewLive);
    }
    let tracks = if fresh.is_empty() { tracks } else { &fresh };
    feed.media_url = variant_url(job, &master_url, tracks).await?;
    Ok(Refreshed::Same)
}

/// master를 읽어 고른 화질의 media playlist 주소를 낸다.
async fn variant_url(
    job: &mut Job<'_>,
    master_url: &Url,
    tracks: &[Quality],
) -> Result<Url, Error> {
    let policy = job.chzzk.config().retry;
    let mut patience = Patience::default();
    loop {
        let started = TokioInstant::now();
        let master = match fetch_cancellable(job, policy, master_url, Body::Playlist).await {
            Ok(m) => m,
            Err(Failure::Retry(e)) if is_connection_failure(&e) => {
                job.wait_for_network(&mut patience, e, started.elapsed())
                    .await?;
                continue;
            }
            Err(f) => return Err(into_error(f)),
        };
        let text = utf8(&master, "master playlist").map_err(into_error)?;
        let variants = hls::parse_master(text, master_url)?;
        return Ok(pick_variant(&variants, &job.req.quality_id, tracks)?
            .uri
            .clone());
    }
}

/// media playlist 한 번을 읽는다.
async fn read_playlist(job: &Job<'_>, url: &Url) -> Result<LiveSnapshot, Failure> {
    let policy = job.chzzk.config().retry;
    let body: Bytes = fetch_cancellable(job, policy, url, Body::Playlist).await?;
    let text = utf8(&body, "media playlist")?;
    hls::parse_live_media(text, url).map_err(Failure::Fatal)
}

/// playlist 읽기·init 받기 실패를 다룬다.
///
/// - 서명 만료(403): 호출한 쪽이 재조회한다(`Handled::Refresh`).
/// - 404·410: 아직 없거나 방송이 끝났다. 기다리고 다시 시도한다(조용한 시간이 길면 호출한 쪽이 방송 종료를 본다).
/// - 연결 계열 실패: 인내 모드로 기다린다. 기다리는 동안에도 멈춤이 먹는다.
/// - 그 밖의 일시 오류(5xx·본문 검증 실패): 기다리고 다시 시도하되 연달아 `MAX_FLAKY`번을 넘으면 오류.
/// - 지원하지 않는 형식(암호화 등): 오류.
async fn handle_failure(
    job: &mut Job<'_>,
    patience: &mut Patience,
    since_progress: &mut TokioInstant,
    flaky: &mut u32,
    stop: &CancellationToken,
    poll: Duration,
    f: Failure,
) -> Result<Handled, Error> {
    match f {
        Failure::Expired => Ok(Handled::Refresh),
        Failure::Fatal(Error::HttpStatus {
            status: 404 | 410, ..
        }) => Ok(if wait_or_stop(job, stop, poll).await? {
            Handled::Again
        } else {
            Handled::Stopped
        }),
        Failure::Retry(e) if is_connection_failure(&e) => {
            let Some(r) = until_stop!(
                stop,
                job.wait_for_network(patience, e, since_progress.elapsed())
            ) else {
                return Ok(Handled::Stopped);
            };
            r?;
            *since_progress = TokioInstant::now();
            Ok(Handled::Again)
        }
        Failure::Retry(e) | Failure::Fatal(e) if is_transient(&e) => {
            *flaky += 1;
            if *flaky > MAX_FLAKY {
                return Err(e);
            }
            Ok(if wait_or_stop(job, stop, poll).await? {
                Handled::Again
            } else {
                Handled::Stopped
            })
        }
        Failure::Retry(e) | Failure::Fatal(e) => Err(e),
    }
}

/// 403 재조회 예산(`job.refreshes`)을 쓰지 않는 재조회. 조용한 시간이 길어 방송이 끝났는지 볼 때 쓴다.
async fn refresh_free(
    job: &mut Job<'_>,
    feed: &mut Feed,
    tracks: &[Quality],
) -> Result<Refreshed, Error> {
    let before = job.refreshes;
    let r = refresh(job, feed, tracks).await;
    job.refreshes = before;
    r
}

fn into_error(f: Failure) -> Error {
    match f {
        Failure::Expired => Error::AuthRequired { status: 403 },
        Failure::Retry(e) | Failure::Fatal(e) => e,
    }
}

/// `d`만큼 기다린다. 멈춤이 오면 `false`, 취소되면 `Cancelled`.
async fn wait_or_stop(job: &Job<'_>, stop: &CancellationToken, d: Duration) -> Result<bool, Error> {
    tokio::select! {
        biased;
        _ = job.cancel.cancelled() => Err(Error::Cancelled),
        _ = stop.cancelled() => Ok(false),
        _ = tokio::time::sleep(d) => Ok(true),
    }
}
