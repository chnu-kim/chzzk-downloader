//! 받기 전 미리보기용 PD 중계(preview.md §4.1, PV-1).
//!
//! 셸이 웹뷰 `<video>`의 Range 요청을 업스트림(서명 URL)에 닫힌 구간으로 다시 보내는 데 쓴다.
//! 파일을 쓰지 않고 쿠키를 보내지 않는다(PV12). 받기 엔진(`progressive.rs`)은 건드리지 않는다.
//!
//! 오류에는 `reqwest::Error`를 직접 담지 않는다. 전송 오류는 `retry::classify_failure`(`Error::network`)를 거쳐
//! URL(서명 쿼리)이 지워진 `Error`로만 담는다(preview.md §4.1, 검토 반영 S7).

use std::fmt;
use std::time::Duration;

use ::url::Url;
use reqwest::header::{CONTENT_RANGE, CONTENT_TYPE, RANGE};

use crate::client::Chzzk;
use crate::download::retry::{Failure, classify_failure};
use crate::error::Error;
use crate::http::RequestKind;

/// 일시 실패(5xx·전송 오류)를 같은 함수 안에서 한 번 더 시도하기 전 대기 **[잠정]**.
/// 웹뷰가 다시 요청하므로 길게 버티지 않는다.
const RETRY_DELAY: Duration = Duration::from_millis(100);

/// 업스트림이 실제로 준 한 조각. `body.len() == end_incl - start + 1`이 늘 성립한다.
pub struct RangeChunk {
    pub start: u64,
    pub end_incl: u64,
    /// 업스트림 `Content-Range`의 전체 길이
    pub total: u64,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

impl fmt::Debug for RangeChunk {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RangeChunk")
            .field("start", &self.start)
            .field("end_incl", &self.end_incl)
            .field("total", &self.total)
            .field("content_type", &self.content_type)
            .field("body_len", &self.body.len())
            .finish()
    }
}

/// 미리보기 중계 실패. 서명 주소를 담지 않는다(`Error`는 URL 없이 만든다).
#[derive(Debug, thiserror::Error)]
pub enum WatchFail {
    /// 전송 문제(연결 실패·조기 EOF). 세션을 버릴 이유가 없고 웹뷰가 다시 요청하면 된다.
    #[error("미리보기 전송이 끊겼습니다: {0}")]
    Retry(Error),
    /// 다시 해도 안 된다.
    #[error("미리보기를 받을 수 없습니다: {0}")]
    Fatal(Error),
    /// 서명 주소 만료(403). 셸이 재조회한다.
    #[error("서명 주소가 만료됐습니다")]
    Expired,
    /// 업스트림 영상이 바뀌었거나 응답이 요청과 어긋난다.
    #[error("영상이 바뀌었거나 응답이 어긋납니다")]
    SourceChanged,
    /// 업스트림이 Range를 무시하고 200을 줬다(PV4).
    #[error("서버가 구간 요청을 지원하지 않습니다")]
    RangeIgnored,
    /// 범위를 벗어났다(416). 업스트림이 알려 준 전체 길이를 담는다.
    #[error("요청 범위가 영상 길이({total}바이트)를 벗어났습니다")]
    Unsatisfiable { total: u64 },
    /// 응답이 상한을 넘었다.
    #[error("응답이 상한을 넘었습니다")]
    TooLarge,
}

impl From<Failure> for WatchFail {
    fn from(f: Failure) -> Self {
        match f {
            Failure::Retry(e) => WatchFail::Retry(e),
            Failure::Fatal(e) => WatchFail::Fatal(e),
            Failure::Expired => WatchFail::Expired,
        }
    }
}

/// `Content-Range: bytes {start}-{end}/{total}`을 `(start, end, total)`로 읽는다.
/// `bytes */N`·`bytes a-b/*`(전체 길이를 모름), `end < start`, `end >= total`, 숫자가 아닌 값은 `None`이다.
/// 받기 쪽 `progressive::parse_content_range`는 끝값을 버리므로 쓰지 않는다.
pub(crate) fn parse_content_range_full(v: &str) -> Option<(u64, u64, u64)> {
    let rest = v.trim().strip_prefix("bytes")?.trim_start();
    let (range, total) = rest.split_once('/')?;
    let (start, end) = range.trim().split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end: u64 = end.trim().parse().ok()?;
    let total: u64 = total.trim().parse().ok()?;
    (start <= end && end < total).then_some((start, end, total))
}

/// `Content-Range: bytes */N`(416)의 전체 길이.
fn parse_unsatisfied_total(v: &str) -> Option<u64> {
    let rest = v.trim().strip_prefix("bytes")?.trim_start();
    rest.strip_prefix("*/")?.trim().parse().ok()
}

/// 본문을 `limit` 바이트까지만 모은다. 넘으면 `Over`, 도중 끊기면 분류된 `WatchFail`이다.
enum Collect {
    Over,
    Fail(WatchFail),
}

async fn collect(mut resp: reqwest::Response, limit: usize) -> Result<Vec<u8>, Collect> {
    let mut buf = Vec::with_capacity(limit.min(1 << 20));
    loop {
        match resp.chunk().await {
            Ok(Some(b)) => {
                if buf.len() + b.len() > limit {
                    return Err(Collect::Over);
                }
                buf.extend_from_slice(&b);
            }
            Ok(None) => return Ok(buf),
            // 본문 도중 끊김도 `Error::network`를 거친다(URL 제거)
            Err(e) => return Err(Collect::Fail(classify_failure(None, Some(e)).into())),
        }
    }
}

impl Chzzk {
    /// 쿠키 없는 미디어 GET(PV12). `cookies_on_media` 스위치를 보지 않는다.
    fn watch_get(&self, url: &Url) -> reqwest::RequestBuilder {
        tracing::debug!(url = %crate::http::redact_url(url), "GET watch");
        self.http_client()
            .get(url.clone())
            .headers(crate::http::headers(RequestKind::Media, None, false))
    }

    /// 요청을 보내고 상태를 거른다. 2xx와 416은 그대로 돌려주고, 403은 `Expired`, 나머지는 `classify_failure`다.
    /// 5xx·전송 오류는 짧게 한 번만 다시 한다. 다시 해도 5xx면 `Fatal`, 전송 오류면 `Retry`로 끝낸다.
    async fn watch_send(
        &self,
        url: &Url,
        range: Option<(u64, u64)>,
    ) -> Result<reqwest::Response, WatchFail> {
        let mut last = None;
        for attempt in 0..2 {
            if attempt > 0 {
                tokio::time::sleep(RETRY_DELAY).await;
            }
            let mut req = self.watch_get(url);
            if let Some((a, b)) = range {
                req = req.header(RANGE, format!("bytes={a}-{b}"));
            }
            let failure = match req.send().await {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() || status.as_u16() == 416 {
                        return Ok(resp);
                    }
                    classify_failure(Some(status.as_u16()), None)
                }
                Err(e) => classify_failure(None, Some(e)),
            };
            match failure {
                Failure::Retry(e) => last = Some(e),
                other => return Err(other.into()),
            }
        }
        // 다시 해도 안 됐다. 상태 오류는 끝난 것으로, 전송 오류는 웹뷰가 다시 요청할 만한 것으로 본다.
        Err(match last.expect("재시도 루프는 실패로만 끝난다") {
            e @ Error::HttpStatus { .. } => WatchFail::Fatal(e),
            e => WatchFail::Retry(e),
        })
    }

    /// 업스트림에 닫힌 `Range: bytes={start}-{end_incl}`를 보내 한 조각을 받는다.
    ///
    /// `expect_total`이 있으면 업스트림 전체 길이가 같아야 한다(다르면 `SourceChanged`).
    /// 업스트림이 짧게 준 206은 정상이고 결과는 업스트림 끝값을 쓴다. total 탐색(`open`)은
    /// `bytes=0-0`, `expect_total: None`으로 부른다.
    pub async fn watch_range(
        &self,
        url: &Url,
        start: u64,
        end_incl: u64,
        expect_total: Option<u64>,
    ) -> Result<RangeChunk, WatchFail> {
        if end_incl < start {
            return Err(WatchFail::Fatal(Error::Parse {
                what: "watch range",
                detail: format!("끝({end_incl})이 시작({start})보다 앞입니다"),
            }));
        }
        let resp = self.watch_send(url, Some((start, end_incl))).await?;
        match resp.status().as_u16() {
            // Range를 무시했다. 본문을 읽지 않고 버린다(연결도 닫힌다)
            200 => Err(WatchFail::RangeIgnored),
            416 => {
                let total = resp
                    .headers()
                    .get(CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .and_then(parse_unsatisfied_total);
                Err(match total {
                    Some(total) => WatchFail::Unsatisfiable { total },
                    None => WatchFail::Fatal(Error::HttpStatus {
                        status: 416,
                        kind: RequestKind::Media,
                    }),
                })
            }
            206 => {
                let parsed = resp
                    .headers()
                    .get(CONTENT_RANGE)
                    .and_then(|v| v.to_str().ok())
                    .and_then(parse_content_range_full);
                let Some((a, b, total)) = parsed else {
                    return Err(WatchFail::SourceChanged);
                };
                if a != start || b > end_incl || expect_total.is_some_and(|t| t != total) {
                    return Err(WatchFail::SourceChanged);
                }
                let want = b - a + 1;
                if resp.content_length().is_some_and(|n| n != want) {
                    return Err(WatchFail::SourceChanged);
                }
                let content_type = resp
                    .headers()
                    .get(CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_owned);
                let body = match collect(resp, want as usize).await {
                    Ok(b) => b,
                    Err(Collect::Over) => return Err(WatchFail::SourceChanged),
                    Err(Collect::Fail(f)) => return Err(f),
                };
                // 조기 EOF는 전송 문제라 세션을 버리지 않는다
                if (body.len() as u64) < want {
                    return Err(WatchFail::Retry(Error::LengthMismatch {
                        expected: want,
                        actual: body.len() as u64,
                    }));
                }
                Ok(RangeChunk {
                    start: a,
                    end_incl: b,
                    total,
                    content_type,
                    body,
                })
            }
            // 204 같은 그 밖의 2xx
            status => Err(WatchFail::Fatal(Error::HttpStatus {
                status,
                kind: RequestKind::Media,
            })),
        }
    }

    /// playlist·init·세그먼트용 통짜 GET(쿠키 없음). `cap`을 넘으면 `TooLarge`다.
    pub async fn watch_bytes(&self, url: &Url, cap: usize) -> Result<Vec<u8>, WatchFail> {
        let resp = self.watch_send(url, None).await?;
        let status = resp.status().as_u16();
        if status != 200 {
            return Err(WatchFail::Fatal(Error::HttpStatus {
                status,
                kind: RequestKind::Media,
            }));
        }
        if resp.content_length().is_some_and(|n| n > cap as u64) {
            return Err(WatchFail::TooLarge);
        }
        match collect(resp, cap).await {
            Ok(b) => Ok(b),
            Err(Collect::Over) => Err(WatchFail::TooLarge),
            Err(Collect::Fail(f)) => Err(f),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_content_range_full_forms() {
        assert_eq!(parse_content_range_full("bytes 0-9/100"), Some((0, 9, 100)));
        assert_eq!(
            parse_content_range_full("  bytes 99-99/100 "),
            Some((99, 99, 100))
        );
        for bad in [
            "bytes */100",
            "bytes 0-9/*",
            "bytes 5-3/100",
            "bytes 0-100/100",
            "bytes x-9/10",
            "bytes 0-9",
            "0-9/100",
            "bytes 0-9/100/1",
            "",
        ] {
            assert_eq!(parse_content_range_full(bad), None, "{bad:?}");
        }
    }
}
