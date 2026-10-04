//! 치지직 클라이언트: 엔드포인트·설정과 `resolve`(설계 §3.3·§4.1).
//!
//! `resolve`는 목록 조회와 다운로드 직전 재조회에 같은 함수를 쓴다(서명 URL이 만료되므로).
//! `download`는 다운로드 단계에서 붙인다.

use std::time::Duration;

use ::url::Url;
use bytes::Bytes;
use reqwest::header::HeaderValue;

use crate::download::RetryPolicy;
use crate::error::Error;
use crate::http::{self, NaverCookies, RequestKind};
use crate::info::{self, Playback};
use crate::model::{ContentRef, Resolved, Source};
use crate::mpd;

/// API 기본 주소. 테스트는 mock 서버 주소로 바꾼다.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoints {
    /// `https://api.chzzk.naver.com/`
    pub chzzk_api: Url,
    /// `https://apis.naver.com/`
    pub vodplay_api: Url,
}

impl Default for Endpoints {
    fn default() -> Self {
        Endpoints {
            chzzk_api: Url::parse("https://api.chzzk.naver.com/").expect("상수 URL"),
            vodplay_api: Url::parse("https://apis.naver.com/").expect("상수 URL"),
        }
    }
}

/// 클라이언트 설정.
#[derive(Clone, Debug)]
pub struct ClientConfig {
    pub endpoints: Endpoints,
    /// 사용자가 켰고 값이 있을 때만 `Some`(spec §9.1-11)
    pub cookies: Option<NaverCookies>,
    /// 기본 false. 성인 PD 실측 후 필요하면 true
    pub cookies_on_media: bool,
    /// 미디어 요청 재시도 정책
    pub retry: RetryPolicy,
    /// 진행률 콜백 최소 간격. 기본 200ms, 테스트 0
    pub progress_interval: Duration,
    /// 기본 10초
    pub connect_timeout: Duration,
    /// 읽기 idle timeout. 기본 30초. 전체 timeout은 두지 않는다.
    pub read_timeout: Duration,
}

impl Default for ClientConfig {
    fn default() -> Self {
        ClientConfig {
            endpoints: Endpoints::default(),
            cookies: None,
            cookies_on_media: false,
            retry: RetryPolicy::default(),
            progress_interval: Duration::from_millis(200),
            connect_timeout: Duration::from_secs(10),
            read_timeout: Duration::from_secs(30),
        }
    }
}

/// 치지직 클라이언트. HTTP 연결을 재사용하므로 앱에 하나만 둔다.
#[derive(Clone, Debug)]
pub struct Chzzk {
    http: reqwest::Client,
    cfg: ClientConfig,
    /// 미리 만든 `Cookie` 헤더 값(sensitive)
    cookie: Option<HeaderValue>,
}

impl Chzzk {
    /// 클라이언트를 만든다. 엔드포인트가 http(s) 기본 주소가 아니거나 쿠키에 헤더로 보낼 수 없는
    /// 문자가 있으면 오류다.
    pub fn new(cfg: ClientConfig) -> Result<Self, Error> {
        for u in [&cfg.endpoints.chzzk_api, &cfg.endpoints.vodplay_api] {
            if u.cannot_be_a_base() || !matches!(u.scheme(), "http" | "https") {
                return Err(Error::Parse {
                    what: "endpoint",
                    detail: format!("http(s) 기본 주소가 아닙니다: {}", http::redact_url(u)),
                });
            }
        }
        let cookie = cfg
            .cookies
            .as_ref()
            .map(NaverCookies::header_value)
            .transpose()?;
        let http = http::build_client(cfg.connect_timeout, cfg.read_timeout)?;
        Ok(Chzzk { http, cfg, cookie })
    }

    /// 설정.
    pub fn config(&self) -> &ClientConfig {
        &self.cfg
    }

    /// 컨텐츠의 메타데이터와 다운로드 소스를 조회한다.
    ///
    /// - Video: info → `classify` → DASH면 MPD → PD 화질 / 빠른 다시보기면 master 주소와 track
    /// - Clip: clip info → MPD → PD 화질
    /// - 암호화 VOD는 MPD를 받지 않고 `EncryptedVod`(AES seam, 설계 §11)
    pub async fn resolve(&self, c: &ContentRef) -> Result<Resolved, Error> {
        let (meta, source) = match c {
            ContentRef::Video { video_no } => {
                let no = video_no.to_string();
                let url = api_url(
                    &self.cfg.endpoints.chzzk_api,
                    &["service", "v2", "videos", &no],
                );
                let body = self.fetch(url, RequestKind::Api).await?;
                let (meta, v) = info::parse_video_info(&body)?;
                let source = match info::classify(&v)? {
                    Playback::Encrypted { method, .. } => {
                        return Err(Error::EncryptedVod { method });
                    }
                    Playback::Dash { video_id, in_key } => {
                        self.progressive(&video_id, &in_key).await?
                    }
                    Playback::LiveRewind { master_url, tracks } => {
                        if tracks.is_empty() {
                            return Err(Error::NoQualities);
                        }
                        Source::LiveRewindHls { master_url, tracks }
                    }
                };
                (meta, source)
            }
            ContentRef::Clip { clip_id } => {
                let url = api_url(
                    &self.cfg.endpoints.chzzk_api,
                    &["service", "v1", "play-info", "clip", clip_id],
                );
                let body = self.fetch(url, RequestKind::Api).await?;
                let (meta, playback) = info::parse_clip_info(&body)?;
                // parse_clip_info는 항상 Dash를 낸다. 패닉 대신 형식 오류로 둔다.
                let Playback::Dash { video_id, in_key } = playback else {
                    return Err(Error::Parse {
                        what: "clip info",
                        detail: "DASH 재생 정보가 아닙니다".into(),
                    });
                };
                (meta, self.progressive(&video_id, &in_key).await?)
            }
        };
        Ok(Resolved {
            content: c.clone(),
            meta,
            source,
        })
    }

    /// vodplay MPD를 받아 PD 화질 목록을 만든다.
    async fn progressive(&self, video_id: &str, in_key: &str) -> Result<Source, Error> {
        let mut url = api_url(
            &self.cfg.endpoints.vodplay_api,
            &["neonplayer", "vodplay", "v2", "playback", video_id],
        );
        url.query_pairs_mut().append_pair("key", in_key);
        let body = self.fetch(url, RequestKind::Mpd).await?;
        let xml = std::str::from_utf8(&body).map_err(|e| Error::Parse {
            what: "MPD",
            detail: e.to_string(),
        })?;
        let reps = mpd::pd_reps(&mpd::parse_mpd(xml)?)?;
        Ok(Source::Progressive { reps })
    }

    /// API·MPD GET. 401/403은 `AuthRequired`, 그 밖의 2xx 아닌 응답은 `HttpStatus`.
    async fn fetch(&self, url: Url, kind: RequestKind) -> Result<Bytes, Error> {
        tracing::debug!(url = %http::redact_url(&url), ?kind, "GET");
        let resp = self
            .http
            .get(url)
            .headers(http::headers(
                kind,
                self.cookie.as_ref(),
                self.cfg.cookies_on_media,
            ))
            .send()
            .await
            .map_err(Error::network)?;
        let status = resp.status().as_u16();
        if matches!(status, 401 | 403) {
            return Err(Error::AuthRequired { status });
        }
        if !resp.status().is_success() {
            return Err(Error::HttpStatus { status, kind });
        }
        read_capped(resp, MAX_API_BODY).await
    }
}

/// API·MPD 응답 크기 상한. 실물은 KB 단위다(fixture 100KB 미만).
pub(crate) const MAX_API_BODY: usize = 8 * 1024 * 1024;

/// 응답 본문을 `max` 바이트까지만 읽는다. 넘으면 `Error::Parse`.
///
/// `read_timeout`은 idle만 끊으므로, 계속 흘러오는 본문은 이 상한으로 막는다.
async fn read_capped(mut resp: reqwest::Response, max: usize) -> Result<Bytes, Error> {
    let too_large = || Error::Parse {
        what: "response",
        detail: format!("응답이 너무 큽니다(상한 {max}바이트)"),
    };
    if resp.content_length().is_some_and(|n| n > max as u64) {
        return Err(too_large());
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(Error::network)? {
        if buf.len() + chunk.len() > max {
            return Err(too_large());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(Bytes::from(buf))
}

/// 기본 주소 뒤에 path 세그먼트를 붙인다. 세그먼트는 인코딩되므로 `/`·`?`가 섞여도 경로가 바뀌지 않는다.
fn api_url(base: &Url, segs: &[&str]) -> Url {
    let mut u = base.clone();
    u.set_query(None);
    u.set_fragment(None);
    u.path_segments_mut()
        .expect("Chzzk::new에서 기본 주소 검사")
        .pop_if_empty()
        .extend(segs);
    u
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_appends_segments() {
        let base = Url::parse("https://api.chzzk.naver.com/").unwrap();
        assert_eq!(
            api_url(&base, &["service", "v2", "videos", "123"]).as_str(),
            "https://api.chzzk.naver.com/service/v2/videos/123"
        );
        // 기본 주소에 경로가 있어도(끝 `/` 유무와 무관) 그 뒤에 붙는다.
        for b in ["http://127.0.0.1:9/prefix", "http://127.0.0.1:9/prefix/"] {
            let base = Url::parse(b).unwrap();
            assert_eq!(
                api_url(&base, &["clip", "a/b?c"]).as_str(),
                "http://127.0.0.1:9/prefix/clip/a%2Fb%3Fc"
            );
        }
    }

    /// 리뷰 수정: 상한을 넘는 본문은 `Parse`, 상한까지는 받는다.
    #[tokio::test]
    async fn read_capped_limits_body() {
        use wiremock::matchers::method;
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![b'x'; 100]))
            .mount(&server)
            .await;
        let http = http::build_client(Duration::from_secs(5), Duration::from_secs(5)).unwrap();
        let get = || http.get(server.uri()).send();
        let ok = read_capped(get().await.unwrap(), 100).await.unwrap();
        assert_eq!(ok.len(), 100);
        assert!(matches!(
            read_capped(get().await.unwrap(), 99).await,
            Err(Error::Parse {
                what: "response",
                ..
            })
        ));
    }

    /// 리뷰 수정: `Content-Length` 없이 계속 흘러오는(chunked) 본문도 상한에서 끊는다.
    #[tokio::test]
    async fn read_capped_limits_chunked_body() {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut req = [0u8; 1024];
            let _ = s.read(&mut req);
            let chunk = format!("40\r\n{}\r\n", "x".repeat(64));
            let _ = s.write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
            let _ = s.write_all(chunk.as_bytes());
            let _ = s.write_all(chunk.as_bytes());
            let _ = s.write_all(b"0\r\n\r\n");
        });
        let http = http::build_client(Duration::from_secs(5), Duration::from_secs(5)).unwrap();
        let resp = http.get(format!("http://{addr}/")).send().await.unwrap();
        assert_eq!(resp.content_length(), None);
        assert!(matches!(
            read_capped(resp, 100).await,
            Err(Error::Parse {
                what: "response",
                ..
            })
        ));
        server.join().unwrap();
    }

    #[test]
    fn new_rejects_bad_endpoint() {
        let cfg = ClientConfig {
            endpoints: Endpoints {
                chzzk_api: Url::parse("mailto:a@b").unwrap(),
                ..Endpoints::default()
            },
            ..ClientConfig::default()
        };
        assert!(matches!(Chzzk::new(cfg), Err(Error::Parse { .. })));
    }
}
