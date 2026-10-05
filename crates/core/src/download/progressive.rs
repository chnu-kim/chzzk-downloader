//! PD mp4 단일 GET + Range 이어받기(설계 §5.3).
//!
//! 응답 분기:
//! - `206`: `Content-Range: bytes {start}-*/{total}`. `start != offset`이거나 total이 sidecar와 다르면
//!   `SourceChanged`.
//! - `200`, `offset == 0`: 정상. total = `Content-Length`(없으면 모름).
//! - `200`, `offset > 0`: 서버가 Range를 무시했다. truncate(0) 후 처음부터(`resumed_from = 0`).
//! - `416`: `offset == total`이면 이미 다 받았다. 아니면 `SourceChanged`.
//! - `403`: 서명 만료. 재조회 후 같은 `quality_id`의 새 주소로 같은 offset부터.
//!   재조회 직후 같은 요청이 다시 403이면 `AuthRequired`.
//! - 그 밖: `retry::classify_failure`.
//!
//! 스트림이 끝났는데 받은 길이가 total보다 짧으면 재시도로 보고 Range로 이어 받는다.

use std::time::{Duration, Instant};

use ::url::Url;
use reqwest::StatusCode;
use reqwest::header::{CONTENT_RANGE, RANGE};

use super::part::{PartFile, ProgressiveState, Sidecar};
use super::retry::{Failure, classify_failure};
use super::{DownloadOutcome, Job, finish};
use crate::error::Error;
use crate::model::{PdRep, PlaybackKind, Source};
use crate::mpd::select_pd;

/// 바이트 기준 checkpoint 주기.
const CHECKPOINT_BYTES: u64 = 64 << 20;
/// 시간 기준 checkpoint 주기.
const CHECKPOINT_EVERY: Duration = Duration::from_secs(5);

/// progressive 다운로드를 끝까지 한다.
pub(crate) async fn run(
    job: &mut Job<'_>,
    reps: Vec<PdRep>,
    part: &mut Option<PartFile>,
) -> Result<DownloadOutcome, Error> {
    let mut url = select_pd(&reps, &job.req.quality_id)?.url.clone();
    let mut resumed_from = part.as_ref().map_or(0, PartFile::written);
    let policy = job.chzzk.config().retry;
    // 진전 없이 연달아 실패한 요청 수
    let mut attempts = 0u32;
    // 재조회한 뒤 아직 2xx를 받지 못했는가
    let mut just_refreshed = false;
    loop {
        let before = part.as_ref().map_or(0, PartFile::written);
        match attempt(job, &url, part, &mut resumed_from, &mut just_refreshed).await {
            Ok(()) => break,
            Err(Failure::Fatal(e)) => return Err(e),
            Err(Failure::Expired) => {
                if just_refreshed {
                    return Err(Error::AuthRequired { status: 403 });
                }
                let r = job.reresolve().await?;
                let Source::Progressive { reps } = r.source else {
                    return Err(Error::PlaybackChanged {
                        was: PlaybackKind::Progressive,
                        now: PlaybackKind::LiveRewindHls,
                    });
                };
                url = select_pd(&reps, &job.req.quality_id)?.url.clone();
                just_refreshed = true;
                attempts = 0;
            }
            Err(Failure::Retry(e)) => {
                if part.as_ref().map_or(0, PartFile::written) > before {
                    attempts = 0;
                }
                attempts += 1;
                if !policy.allows_retry(attempts) {
                    return Err(e);
                }
                tracing::debug!(attempts, error = %e, "재시도");
                job.sleep(policy.delay(attempts - 1)).await?;
            }
        }
    }
    finish(job, part, resumed_from).await
}

/// 요청 한 번. 끝까지 받았으면 `Ok`.
async fn attempt(
    job: &mut Job<'_>,
    url: &Url,
    part: &mut Option<PartFile>,
    resumed_from: &mut u64,
    just_refreshed: &mut bool,
) -> Result<(), Failure> {
    let offset = part.as_ref().map_or(0, PartFile::written);
    let mut rb = job.chzzk.media_get(url);
    if offset > 0 {
        rb = rb.header(RANGE, format!("bytes={offset}-"));
    }
    let resp = match job.cancellable(rb.send()).await.map_err(Failure::Fatal)? {
        Ok(r) => r,
        Err(e) => return Err(classify_failure(None, Some(e))),
    };
    let status = resp.status();
    let known_total = part
        .as_ref()
        .and_then(|p| p.staged().progressive)
        .and_then(|s| s.total_len);
    let total = match status {
        StatusCode::PARTIAL_CONTENT => {
            let (start, total) = content_range(&resp).ok_or_else(|| {
                source_changed("206 응답에 Content-Range가 없거나 형식이 다릅니다".into())
            })?;
            if start != offset {
                return Err(source_changed(format!(
                    "요청 위치 {offset}, 응답 위치 {start}"
                )));
            }
            if let (Some(a), Some(b)) = (known_total, total)
                && a != b
            {
                return Err(source_changed(format!("전체 크기 {a} → {b}")));
            }
            total.or(known_total)
        }
        StatusCode::OK => {
            let total = resp.content_length();
            if offset > 0 {
                tracing::info!(offset, "서버가 Range를 무시했다. 처음부터 받는다");
                *resumed_from = 0;
                job.report.p.resumed_from = 0;
                if let Some(p) = part.as_mut() {
                    p.restart(|s| s.progressive = Some(ProgressiveState { total_len: total }))
                        .await
                        .map_err(Failure::Fatal)?;
                }
            }
            total
        }
        StatusCode::RANGE_NOT_SATISFIABLE => {
            let total = content_range(&resp).and_then(|(_, t)| t).or(known_total);
            if offset > 0 && total == Some(offset) && known_total.is_none_or(|k| k == offset) {
                *just_refreshed = false;
                return Ok(());
            }
            return Err(source_changed(format!(
                "416: 받은 크기 {offset}, 전체 {total:?}"
            )));
        }
        s if s.is_success() => {
            return Err(Failure::Fatal(Error::Parse {
                what: "media",
                detail: format!("예상하지 못한 상태 코드 {s}"),
            }));
        }
        s => return Err(classify_failure(Some(s.as_u16()), None)),
    };
    *just_refreshed = false;

    // 상태 코드를 확인한 뒤에만 `.part`를 만든다.
    let p = match part {
        Some(p) => {
            if total.is_some() && known_total.is_none() {
                p.stage(|s| s.progressive = Some(ProgressiveState { total_len: total }));
            }
            p
        }
        None => {
            let mut sc = Sidecar::new(
                job.req.content.clone(),
                job.req.quality_id.clone(),
                PlaybackKind::Progressive,
            );
            sc.progressive = Some(ProgressiveState { total_len: total });
            part.insert(PartFile::create(&job.req.output, sc).map_err(Failure::Fatal)?)
        }
    };
    job.report.update(|r| {
        r.bytes = p.written();
        r.total_bytes = total;
    });

    let mut resp = resp;
    let mut last_cp = Instant::now();
    let mut since_cp = 0u64;
    loop {
        let chunk = match job
            .cancellable(resp.chunk())
            .await
            .map_err(Failure::Fatal)?
        {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(classify_failure(None, Some(e))),
        };
        p.write(&chunk).map_err(Failure::Fatal)?;
        since_cp += chunk.len() as u64;
        let written = p.written();
        if let Some(t) = total
            && written > t
        {
            return Err(Failure::Fatal(Error::LengthMismatch {
                expected: t,
                actual: written,
            }));
        }
        job.report.update(|r| r.bytes = written);
        if since_cp >= CHECKPOINT_BYTES || last_cp.elapsed() >= CHECKPOINT_EVERY {
            p.checkpoint(|_| {}).await.map_err(Failure::Fatal)?;
            since_cp = 0;
            last_cp = Instant::now();
        }
    }
    let written = p.written();
    match total {
        // 조기 EOF: 재시도해서 Range로 이어 받는다. 쓴 바이트는 모두 Content-Range로 위치를 확인한
        // 것이라 틀린 바이트가 아니다. 그래서 재시도를 다 써도 `.part`를 지우는 `LengthMismatch`가
        // 아니라 이어받을 수 있는 `Parse`로 끝낸다(구현 중 변경 36). 초과 수신만 `LengthMismatch`다.
        Some(t) if written < t => Err(Failure::Retry(Error::Parse {
            what: "media",
            detail: format!("본문이 일찍 끝났습니다: 전체 {t}바이트 중 {written}바이트"),
        })),
        _ => Ok(()),
    }
}

fn source_changed(detail: String) -> Failure {
    Failure::Fatal(Error::SourceChanged { detail })
}

/// `Content-Range: bytes {start}-{end}/{total}` 또는 `bytes */{total}`를 읽는다.
/// 돌려주는 값은 `(start, total)`이다. `*/total`이면 start는 0, total이 `*`이면 `None`.
fn content_range(resp: &reqwest::Response) -> Option<(u64, Option<u64>)> {
    let v = resp.headers().get(CONTENT_RANGE)?.to_str().ok()?;
    parse_content_range(v)
}

fn parse_content_range(v: &str) -> Option<(u64, Option<u64>)> {
    let rest = v.trim().strip_prefix("bytes")?.trim_start();
    let (range, total) = rest.split_once('/')?;
    let total = match total.trim() {
        "*" => None,
        t => Some(t.parse().ok()?),
    };
    let start = match range.trim() {
        "*" => 0,
        r => r.split_once('-')?.0.trim().parse().ok()?,
    };
    Some((start, total))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_range_forms() {
        assert_eq!(
            parse_content_range("bytes 500-999/1000"),
            Some((500, Some(1000)))
        );
        assert_eq!(parse_content_range("bytes 0-9/*"), Some((0, None)));
        assert_eq!(parse_content_range("bytes */1000"), Some((0, Some(1000))));
        assert_eq!(parse_content_range("bytes x-9/10"), None);
        assert_eq!(parse_content_range("items 0-9/10"), None);
        assert_eq!(parse_content_range("bytes 0-9"), None);
    }
}
