//! 빠른 다시보기 HLS(fMP4) 다운로드(설계 §5.4).
//!
//! 1. master GET → `parse_master` → `track_id == quality_id` variant(없으면 `height` 폴백).
//! 2. media GET → `parse_media` → 지문(세그먼트 수, EXTINF crc32, init 길이). init GET.
//!    - 새로 시작: `.part`에 init을 쓰고 checkpoint(`next_index = 0`).
//!    - 재개: sidecar 지문과 비교해 다르면 `SourceChanged`.
//! 3. `stream::iter(next_index..n).map(fetch).buffered(c)`. `buffered`가 순서를 지키므로 writer는 단일 루프다.
//! 4. 세그먼트마다 2xx, `Content-Length` 일치, 첫 상자(`styp`/`moof`/`sidx`, init은 `ftyp`)를 검사한다.
//!    CDN의 HTML 오류 페이지를 이어 붙이지 않기 위해서다. 통과하면 쓰고 `next_index += 1`.
//!    `committed_len`은 항상 세그먼트 경계다.
//! 5. 403: stream을 drop(진행 중 fetch 취소) → `Reresolving` → 1~2단계 재실행(지문 검증) →
//!    `next_index`부터 계속. 재조회 직후 같은 세그먼트가 또 403이면 `AuthRequired`.

use std::time::{Duration, Instant};

use ::url::Url;
use bytes::Bytes;
use futures_util::StreamExt;
use futures_util::stream;

use super::part::{HlsState, PartFile, Sidecar};
use super::retry::{Failure, RetryPolicy, classify_failure};
use super::{DownloadOutcome, Job, MAX_CONCURRENCY, finish};
use crate::client::{Chzzk, MAX_API_BODY, read_capped};
use crate::error::{Error, Unsupported};
use crate::hls::{self, MediaPlaylist, Variant};
use crate::model::{PlaybackKind, Quality, Source};

/// 세그먼트 수 기준 checkpoint 주기.
const CHECKPOINT_SEGMENTS: u32 = 32;
/// 시간 기준 checkpoint 주기.
const CHECKPOINT_EVERY: Duration = Duration::from_secs(5);

/// 응답 본문의 종류. 검사 방법이 다르다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Body {
    /// master·media playlist(크기 상한만)
    Playlist,
    /// fMP4 init(`ftyp`)
    Init,
    /// fMP4 세그먼트(`styp`/`moof`/`sidx`)
    Segment,
}

/// 받은 playlist와 init.
struct Loaded {
    playlist: MediaPlaylist,
    init: Bytes,
    /// `hls::durations_crc`
    crc: u32,
}

impl Loaded {
    fn segment_count(&self) -> u32 {
        self.playlist.segments.len() as u32
    }

    /// sidecar 지문과 같은가. 다르면 그 내용을 돌려준다.
    ///
    /// 세그먼트 수·EXTINF crc·init 길이를 본다. `media_sequence`는 기록만 하고 비교하지 않는다
    /// (세그먼트는 playlist 안 위치로 고른다).
    fn mismatch(&self, st: &HlsState) -> Option<String> {
        let mut diff = Vec::new();
        if st.segment_count != self.segment_count() {
            diff.push(format!(
                "세그먼트 수 {} → {}",
                st.segment_count,
                self.segment_count()
            ));
        }
        if st.durations_crc != self.crc {
            diff.push("세그먼트 길이 목록이 다릅니다".to_string());
        }
        if st.init_len as usize != self.init.len() {
            diff.push(format!("init 크기 {} → {}", st.init_len, self.init.len()));
        }
        (!diff.is_empty()).then(|| diff.join(", "))
    }

    fn state(&self) -> HlsState {
        HlsState {
            next_index: 0,
            segment_count: self.segment_count(),
            durations_crc: self.crc,
            init_len: self.init.len() as u32,
            media_sequence: self.playlist.media_sequence,
        }
    }
}

/// HLS 다운로드를 끝까지 한다.
pub(crate) async fn run(
    job: &mut Job<'_>,
    master_url: Url,
    tracks: Vec<Quality>,
    part: &mut Option<PartFile>,
) -> Result<DownloadOutcome, Error> {
    let mut resumed_from = part.as_ref().map_or(0, PartFile::written);
    let mut loaded = acquire(job, Some((master_url, tracks))).await?;
    let concurrency = usize::from(job.req.concurrency.get().min(MAX_CONCURRENCY));

    // 재개면 지문을 확인하고, 아니면 `.part`를 만들어 init을 쓴다.
    let p = match part {
        Some(p) => {
            let st = p.staged().hls.ok_or_else(|| Error::SourceChanged {
                detail: "sidecar에 HLS 상태가 없습니다".into(),
            })?;
            if let Some(d) = loaded.mismatch(&st) {
                return Err(Error::SourceChanged { detail: d });
            }
            p
        }
        None => {
            let mut sc = Sidecar::new(
                job.req.content.clone(),
                job.req.quality_id.clone(),
                PlaybackKind::LiveRewindHls,
            );
            sc.hls = Some(loaded.state());
            part.insert(PartFile::create(&job.req.output, sc)?)
        }
    };
    // committed_len > 0이면 init은 이미 쓰였다(init 쓰기와 첫 checkpoint가 함께 일어난다).
    if p.written() == 0 {
        resumed_from = 0;
        p.write(&loaded.init)?;
        p.checkpoint(|s| {
            if let Some(h) = s.hls.as_mut() {
                h.next_index = 0;
            }
        })
        .await?;
    }

    let n = loaded.segment_count();
    let durations: Vec<u32> = loaded
        .playlist
        .segments
        .iter()
        .map(|s| s.duration_ms)
        .collect();
    let total_ms = loaded.playlist.total_duration_ms;
    let mut next = p.staged().hls.map_or(0, |h| h.next_index);
    if next > n {
        return Err(Error::SourceChanged {
            detail: format!("sidecar의 다음 세그먼트 {next}가 전체 {n}보다 큽니다"),
        });
    }
    let mut done_ms: u64 = durations[..next as usize]
        .iter()
        .map(|&d| u64::from(d))
        .sum();
    let report = |job: &mut Job<'_>, bytes: u64, k: u32, done_ms: u64| {
        job.report.update(|r| {
            r.bytes = bytes;
            r.segments = Some((k, n));
            r.media_secs = Some((done_ms as f64 / 1000.0, total_ms as f64 / 1000.0));
            r.total_bytes_estimate =
                (done_ms > 0).then(|| (bytes as f64 * total_ms as f64 / done_ms as f64) as u64);
        });
    };
    report(job, p.written(), next, done_ms);

    let policy = job.chzzk.config().retry;
    let chzzk = job.chzzk;
    let mut last_cp = Instant::now();
    let mut since_cp = 0u32;
    // 재조회한 뒤 아직 받지 못한 세그먼트 index. 그 세그먼트가 또 403이면 인증 문제다.
    let mut refreshed_at: Option<u32> = None;
    'refresh: loop {
        let uris: Vec<Url> = loaded.playlist.segments[next as usize..]
            .iter()
            .map(|s| s.uri.clone())
            .collect();
        // `buffered`는 완료 순서와 무관하게 입력 순서대로 내놓는다. 그래서 첫 `Err`는 늘 `next`의 것이다.
        let mut segs = stream::iter(uris)
            .map(|u| async move { fetch(chzzk, policy, &u, Body::Segment).await })
            .buffered(concurrency);
        while let Some(r) = job.cancellable(segs.next()).await? {
            let bytes = match r {
                Ok(b) => b,
                Err(Failure::Expired) => {
                    // 진행 중인 fetch를 모두 취소한다.
                    drop(segs);
                    if refreshed_at == Some(next) {
                        return Err(Error::AuthRequired { status: 403 });
                    }
                    let fresh = acquire(job, None).await?;
                    let st = p.staged().hls.unwrap_or_default();
                    if let Some(d) = fresh.mismatch(&st) {
                        // CDN이 잠깐 다른 playlist를 줬을 수 있다. 받은 바이트는 sidecar 지문과
                        // 맞으므로 남기고, 다음 실행이 지문을 다시 검사한다(설계 §8.2).
                        job.keep_partial = true;
                        return Err(Error::SourceChanged { detail: d });
                    }
                    loaded = fresh;
                    refreshed_at = Some(next);
                    continue 'refresh;
                }
                Err(Failure::Retry(e) | Failure::Fatal(e)) => return Err(e),
            };
            p.write(&bytes)?;
            done_ms += u64::from(durations[next as usize]);
            next += 1;
            refreshed_at = None;
            p.stage(|s| {
                if let Some(h) = s.hls.as_mut() {
                    h.next_index = next;
                }
            });
            since_cp += 1;
            report(job, p.written(), next, done_ms);
            if since_cp >= CHECKPOINT_SEGMENTS || last_cp.elapsed() >= CHECKPOINT_EVERY {
                p.checkpoint(|_| {}).await?;
                since_cp = 0;
                last_cp = Instant::now();
            }
        }
        break;
    }
    finish(job, part, resumed_from).await
}

/// playlist와 init을 받는다. `src`가 없으면 먼저 재조회한다.
///
/// 403이면 재조회해서 다시 받는다. 재조회 직후에 또 403이면 `AuthRequired`.
/// 재조회 결과가 DASH(`inKey`)로 바뀌었으면 `Job::reresolve`가 `PlaybackChanged`를 낸다.
async fn acquire(job: &mut Job<'_>, mut src: Option<(Url, Vec<Quality>)>) -> Result<Loaded, Error> {
    let mut just_refreshed = false;
    loop {
        let (master_url, tracks) = match src.take() {
            Some(x) => x,
            None => {
                let r = job.reresolve().await?;
                just_refreshed = true;
                match r.source {
                    Source::LiveRewindHls { master_url, tracks } => (master_url, tracks),
                    Source::Progressive { .. } => {
                        return Err(Error::PlaybackChanged {
                            was: PlaybackKind::LiveRewindHls,
                            now: PlaybackKind::Progressive,
                        });
                    }
                }
            }
        };
        match load(job, &master_url, &tracks).await {
            Ok(l) => return Ok(l),
            Err(Failure::Expired) if just_refreshed => {
                return Err(Error::AuthRequired { status: 403 });
            }
            Err(Failure::Expired) => {}
            Err(Failure::Retry(e) | Failure::Fatal(e)) => return Err(e),
        }
    }
}

/// master → variant → media playlist → init.
async fn load(job: &Job<'_>, master_url: &Url, tracks: &[Quality]) -> Result<Loaded, Failure> {
    let policy = job.chzzk.config().retry;
    let master = fetch_cancellable(job, policy, master_url, Body::Playlist).await?;
    let master = utf8(&master, "master playlist")?;
    let variants = hls::parse_master(master, master_url).map_err(Failure::Fatal)?;
    let variant = pick_variant(&variants, &job.req.quality_id, tracks).map_err(Failure::Fatal)?;
    let media = fetch_cancellable(job, policy, &variant.uri, Body::Playlist).await?;
    let media = utf8(&media, "media playlist")?;
    let playlist = hls::parse_media(media, &variant.uri).map_err(Failure::Fatal)?;
    let init_url = playlist
        .init
        .clone()
        .ok_or(Failure::Fatal(Error::Unsupported(Unsupported::MissingMap)))?;
    let init = fetch_cancellable(job, policy, &init_url, Body::Init).await?;
    let crc = hls::durations_crc(&playlist);
    Ok(Loaded {
        playlist,
        init,
        crc,
    })
}

fn utf8<'a>(b: &'a [u8], what: &'static str) -> Result<&'a str, Failure> {
    std::str::from_utf8(b).map_err(|e| {
        Failure::Fatal(Error::Parse {
            what,
            detail: e.to_string(),
        })
    })
}

/// `track_id == quality_id`인 variant. 없으면 `tracks`에서 그 화질의 높이를 찾아 `height`로 고른다
/// (설계 §4.1). 그래도 없으면 `QualityNotFound`.
fn pick_variant<'a>(
    variants: &'a [Variant],
    quality_id: &str,
    tracks: &[Quality],
) -> Result<&'a Variant, Error> {
    if let Some(v) = variants.iter().find(|v| v.track_id == quality_id) {
        return Ok(v);
    }
    let height = tracks
        .iter()
        .find(|t| t.id == quality_id)
        .and_then(|t| t.height);
    if let Some(h) = height
        && let Some(v) = variants.iter().find(|v| v.height == Some(h))
    {
        return Ok(v);
    }
    Err(Error::QualityNotFound {
        requested: quality_id.to_string(),
        available: tracks.iter().map(|t| t.id.clone()).collect(),
    })
}

/// 취소할 수 있는 `fetch`.
async fn fetch_cancellable(
    job: &Job<'_>,
    policy: RetryPolicy,
    url: &Url,
    body: Body,
) -> Result<Bytes, Failure> {
    job.cancellable(fetch(job.chzzk, policy, url, body))
        .await
        .map_err(Failure::Fatal)?
}

/// 재시도를 포함한 GET. `Expired`와 `Fatal`, 재시도를 다 쓴 `Retry`를 돌려준다.
async fn fetch(
    chzzk: &Chzzk,
    policy: RetryPolicy,
    url: &Url,
    body: Body,
) -> Result<Bytes, Failure> {
    let mut attempts = 0u32;
    loop {
        match fetch_once(chzzk, url, body).await {
            Ok(b) => return Ok(b),
            Err(Failure::Retry(e)) => {
                attempts += 1;
                if !policy.allows_retry(attempts) {
                    return Err(Failure::Retry(e));
                }
                tracing::debug!(attempts, error = %e, "세그먼트 재시도");
                tokio::time::sleep(policy.delay(attempts - 1)).await;
            }
            Err(f) => return Err(f),
        }
    }
}

/// GET 한 번과 본문 검사.
async fn fetch_once(chzzk: &Chzzk, url: &Url, body: Body) -> Result<Bytes, Failure> {
    let resp = match chzzk.media_get(url).send().await {
        Ok(r) => r,
        Err(e) => return Err(classify_failure(None, Some(e))),
    };
    let status = resp.status();
    if !status.is_success() {
        return Err(classify_failure(Some(status.as_u16()), None));
    }
    let expected = resp.content_length();
    let bytes = if body == Body::Playlist {
        read_capped(resp, MAX_API_BODY).await.map_err(|e| match e {
            Error::Network(_) => Failure::Retry(e),
            e => Failure::Fatal(e),
        })?
    } else {
        match resp.bytes().await {
            Ok(b) => b,
            Err(e) => return Err(classify_failure(None, Some(e))),
        }
    };
    if let Some(n) = expected
        && n != bytes.len() as u64
    {
        return Err(Failure::Retry(Error::LengthMismatch {
            expected: n,
            actual: bytes.len() as u64,
        }));
    }
    check_box(&bytes, body)?;
    Ok(bytes)
}

/// 첫 상자의 종류를 검사한다. 다르면 재시도할 `Parse`.
fn check_box(b: &[u8], body: Body) -> Result<(), Failure> {
    let allowed: &[&[u8; 4]] = match body {
        Body::Playlist => return Ok(()),
        Body::Init => &[b"ftyp"],
        Body::Segment => &[b"styp", b"moof", b"sidx"],
    };
    let ok = b.len() >= 8 && allowed.iter().any(|t| &b[4..8] == *t);
    if ok {
        return Ok(());
    }
    Err(Failure::Retry(Error::Parse {
        what: if body == Body::Init {
            "init segment"
        } else {
            "segment"
        },
        detail: "fMP4 상자로 시작하지 않습니다(오류 페이지일 수 있습니다)".into(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn box_check() {
        let seg = |t: &[u8; 4]| {
            let mut v = vec![0, 0, 0, 8];
            v.extend_from_slice(t);
            v
        };
        assert!(check_box(&seg(b"styp"), Body::Segment).is_ok());
        assert!(check_box(&seg(b"moof"), Body::Segment).is_ok());
        assert!(check_box(&seg(b"sidx"), Body::Segment).is_ok());
        assert!(check_box(&seg(b"ftyp"), Body::Init).is_ok());
        assert!(matches!(
            check_box(&seg(b"ftyp"), Body::Segment),
            Err(Failure::Retry(Error::Parse { .. }))
        ));
        assert!(check_box(b"<html><body>", Body::Segment).is_err());
        assert!(check_box(b"abc", Body::Init).is_err());
        assert!(check_box(b"", Body::Playlist).is_ok());
    }

    #[test]
    fn pick_variant_fallback() {
        let base = Url::parse("http://h/m/master.m3u8").unwrap();
        let variants = hls::parse_master(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=256x144\n144p/a.m3u8\n\
             #EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=1280x720\n../other/b.m3u8\n",
            &base,
        )
        .unwrap();
        let q = |id: &str, h: u32| Quality {
            id: id.into(),
            label: format!("{h}p"),
            resolution: Some(h),
            width: None,
            height: Some(h),
            bandwidth: None,
            frame_rate: None,
        };
        let tracks = [q("144p", 144), q("720p", 720)];
        assert_eq!(
            pick_variant(&variants, "144p", &tracks).unwrap().height,
            Some(144)
        );
        // track_id가 맞지 않으면(디렉토리 밖) height로 고른다.
        assert_eq!(
            pick_variant(&variants, "720p", &tracks).unwrap().height,
            Some(720)
        );
        assert!(matches!(
            pick_variant(&variants, "1080p", &tracks),
            Err(Error::QualityNotFound { .. })
        ));
    }
}
