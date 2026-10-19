//! 치지직 클라이언트: 엔드포인트·설정과 `resolve`(설계 §3.3·§4.1).
//!
//! `resolve`는 목록 조회와 다운로드 직전 재조회에 같은 함수를 쓴다(서명 URL이 만료되므로).
//! `download`는 `download/mod.rs`에 있다.

use std::time::Duration;

use ::url::Url;
use bytes::Bytes;
use reqwest::header::HeaderValue;

use crate::download::{RetryPolicy, Throttles};
use crate::error::Error;
use crate::http::{self, NaverCookies, RequestKind};
use crate::info::{self, Playback};
use crate::model::{ContentRef, Resolved, Source};
use crate::mp4meta::{Cover, MAX_COVER_BYTES};
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
    /// 생방송 media playlist를 다시 읽는 간격. 기본 1초(세그먼트가 2초 길이다)
    pub live_poll_interval: Duration,
    /// 생방송에서 새 세그먼트가 이 시간 동안 없으면 방송이 끝났는지 다시 조회한다. 기본 30초
    pub live_idle_check: Duration,
    /// 채팅 페이지 요청 사이 최소 간격. 기본 `chat::CHAT_PAGE_INTERVAL_MS`(재시도 요청에도 지킨다)
    pub chat_page_interval: Duration,
    /// 채팅 요청 재시도 정책. 기본 `chat::chat_retry_policy()`(미디어용 `retry`와 따로다, chat.md §3.2-5)
    pub chat_retry: RetryPolicy,
    /// 자막을 만들 채팅 기록의 최대 바이트 수. 기본 `chat::CHAT_SUBTITLE_MAX_BYTES`(넘으면 자막 실패, 기록은 완성)
    pub chat_subtitle_max_bytes: u64,
    /// 표지 썸네일(mp4 메타데이터)을 받는 전체 시간 상한. 기본 15초 **[잠정]** 근거 없음, ADR-0009 묶음
    /// (`build_client`에는 전체 timeout이 없다). 재시도는 하지 않는다.
    pub image_timeout: Duration,
    /// 테스트·E2E만: 표지 주소로 `http://127.0.0.1`·`[::1]`을 허용한다. 기본 false(https만 받는다)
    pub allow_loopback_http_images: bool,
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
            live_poll_interval: Duration::from_secs(1),
            live_idle_check: Duration::from_secs(30),
            chat_page_interval: Duration::from_millis(crate::chat::CHAT_PAGE_INTERVAL_MS),
            chat_retry: crate::chat::chat_retry_policy(),
            chat_subtitle_max_bytes: crate::chat::CHAT_SUBTITLE_MAX_BYTES,
            image_timeout: Duration::from_secs(15),
            allow_loopback_http_images: false,
        }
    }
}

/// 치지직 클라이언트. HTTP 연결을 재사용하므로 앱에 하나만 둔다.
#[derive(Clone, Debug)]
pub struct Chzzk {
    http: reqwest::Client,
    /// 표지 썸네일 전용(이동을 요청 전에 거른다, `http::build_image_client`)
    image_http: reqwest::Client,
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
        let image_http = http::build_image_client(
            cfg.connect_timeout,
            cfg.read_timeout,
            cfg.allow_loopback_http_images,
        )?;
        Ok(Chzzk {
            http,
            image_http,
            cfg,
            cookie,
        })
    }

    /// 설정.
    pub fn config(&self) -> &ClientConfig {
        &self.cfg
    }

    /// 컨텐츠의 메타데이터와 다운로드 소스를 조회한다.
    ///
    /// - Video: info → `classify` → DASH면 MPD → PD 화질 / 빠른 다시보기면 master 주소와 track
    /// - Clip: clip info → MPD → PD 화질
    /// - Live: live-detail → master 주소와 화질(방송 중이 아니면 `NotLive`)
    /// - 암호화 VOD는 MPD를 받지 않고 `EncryptedVod`(AES seam, 설계 §11)
    pub async fn resolve(&self, c: &ContentRef) -> Result<Resolved, Error> {
        let mut thumbnail_url = None;
        let (meta, source) = match c {
            ContentRef::Video { video_no } => {
                let no = video_no.to_string();
                let url = api_url(
                    &self.cfg.endpoints.chzzk_api,
                    &["service", "v2", "videos", &no],
                );
                let body = self.fetch(url, RequestKind::Api).await?;
                let (meta, v) = info::parse_video_info(&body)?;
                // 표지는 일반 VOD·빠른 다시보기만 쓴다(클립·생방송은 1차 밖, mp4-metadata.md §1.2)
                thumbnail_url = v.thumbnail_url();
                let source = match info::classify(&v)? {
                    Playback::Encrypted { method, .. } => {
                        return Err(Error::EncryptedVod { method });
                    }
                    // 일반 VOD만 오디오만 받기를 보인다(audio-only.md A3)
                    Playback::Dash { video_id, in_key } => {
                        self.progressive(&video_id, &in_key, true).await?
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
            ContentRef::Live { channel_id } => {
                let url = api_url(
                    &self.cfg.endpoints.chzzk_api,
                    &["service", "v3", "channels", channel_id, "live-detail"],
                );
                let body = self.fetch(url, RequestKind::Api).await?;
                let (meta, d) = info::parse_live_detail(&body)?;
                if d.tracks.is_empty() {
                    return Err(Error::NoQualities);
                }
                (
                    meta,
                    Source::Live {
                        master_url: d.master_url,
                        tracks: d.tracks,
                        live_id: d.live_id,
                    },
                )
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
                // 클립은 MPD에 오디오 set이 있어도 오디오 행을 만들지 않는다(실물 클립에는 오디오 set이 없었다, audio-only.md A3)
                (meta, self.progressive(&video_id, &in_key, false).await?)
            }
        };
        Ok(Resolved {
            content: c.clone(),
            meta,
            source,
            thumbnail_url,
        })
    }

    /// 클립 info 응답에 썸네일로 보이는 키(이름에 `thumb`)가 있는지만 알려 준다(값은 읽지 않는다).
    /// 사용자가 본인 클립으로 확인하는 실측 M-meta-3(`examples/dl.rs --list`)용이다. 있으면 클립 표지를 뒤 PR로 연다.
    pub async fn clip_has_thumbnail_field(&self, clip_id: &str) -> Result<bool, Error> {
        let url = api_url(
            &self.cfg.endpoints.chzzk_api,
            &["service", "v1", "play-info", "clip", clip_id],
        );
        let body = self.fetch(url, RequestKind::Api).await?;
        let content = info::open_envelope(&body, "clip info")?;
        Ok(info::has_thumb_key(&content))
    }

    /// vodplay MPD를 받아 PD 화질 목록을 만든다. `with_audio`이면 서버의 오디오 전용 rep을 맨 끝에 붙인다
    /// (`mpd::audio_rep`, 비디오 PD가 없으면 `NoQualities`이고 오디오만 있는 목록은 만들지 않는다).
    async fn progressive(
        &self,
        video_id: &str,
        in_key: &str,
        with_audio: bool,
    ) -> Result<Source, Error> {
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
        let parsed = mpd::parse_mpd(xml)?;
        let mut reps = mpd::pd_reps(&parsed)?;
        if with_audio {
            // 덤인 오디오 행의 BaseURL이 깨졌다고 비디오 받기까지 막지 않는다. 오류에는 원문 URL이 없다(`audio_rep`).
            match mpd::audio_rep(&parsed) {
                Ok(Some(a)) => reps.push(a),
                Ok(None) => {}
                Err(e) => tracing::warn!(error = %e, "오디오 rep을 건너뛴다"),
            }
        }
        Ok(Source::Progressive { reps })
    }

    /// API·MPD GET. 401/403은 `AuthRequired`, 그 밖의 2xx 아닌 응답은 `HttpStatus`.
    pub(crate) async fn fetch(&self, url: Url, kind: RequestKind) -> Result<Bytes, Error> {
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

    /// 표지 썸네일을 받는다(mp4 메타데이터, mp4-metadata.md §7). **최선 노력**이라 실패는 `None`과 경고 로그이고
    /// 받기 성공에 영향을 주지 않는다. 호출한 쪽이 취소할 수 있게 `async`로 둔다.
    ///
    /// - 쿠키는 `cookies_on_media`와 상관없이 늘 보내지 않는다(`RequestKind::Image`).
    /// - https만 받는다(테스트·E2E는 `allow_loopback_http_images`로 루프백 http). userinfo나 `{`·`}`(틀 자리표시자)가
    ///   남은 주소는 요청하지 않는다. 이동(redirect)은 표지 전용 클라이언트가 **요청 전에** 같은 조건으로 거른다(어기면
    ///   따라가지 않고 3xx 응답을 받아 표지 없음이다).
    /// - 본문은 `MAX_COVER_BYTES`까지만 읽고, 전체 시간은 `image_timeout`이다. 재시도는 하지 않는다.
    /// - 형식은 앞 바이트(JPEG·PNG)로만 정한다. 2xx가 아니면(401/403 포함) 표지 없음이다.
    /// - 로그에는 `redact_url`을 거친 주소만 남긴다.
    pub(crate) async fn fetch_cover(&self, url: &Url) -> Option<Cover> {
        let allow = self.cfg.allow_loopback_http_images;
        let shown = http::redact_url(url);
        if !image_url_allowed(url, allow) {
            tracing::warn!(url = %shown, "표지 주소를 받지 않는다(https가 아니거나 자리표시자가 남았다)");
            return None;
        }
        let get = async {
            let resp = self
                .image_http
                .get(url.clone())
                .headers(http::headers(RequestKind::Image, None, false))
                .send()
                .await
                .map_err(Error::network)?;
            let status = resp.status();
            if !status.is_success() {
                return Err(Error::HttpStatus {
                    status: status.as_u16(),
                    kind: RequestKind::Image,
                });
            }
            read_capped(resp, MAX_COVER_BYTES).await
        };
        match tokio::time::timeout(self.cfg.image_timeout, get).await {
            Err(_) => {
                tracing::warn!(url = %shown, "표지 받기 시간 초과");
                None
            }
            Ok(Err(e)) => {
                tracing::warn!(url = %shown, error = %e, "표지를 받지 못했다");
                None
            }
            Ok(Ok(bytes)) => {
                let cover = Cover::sniff(bytes.to_vec());
                if cover.is_none() {
                    tracing::warn!(url = %shown, bytes = bytes.len(), "표지가 JPEG·PNG가 아니다");
                }
                cover
            }
        }
    }

    /// 미리보기 중계(`watch.rs`)용 HTTP 클라이언트. 쿠키 헤더는 호출하는 쪽이 만들지 않는다(PV12).
    pub(crate) fn http_client(&self) -> &reqwest::Client {
        &self.http
    }

    /// 미디어 GET 요청(`RequestKind::Media` 헤더). 상태 코드 해석은 다운로드 엔진이 한다.
    pub(crate) fn media_get(&self, url: &Url) -> reqwest::RequestBuilder {
        tracing::debug!(url = %http::redact_url(url), "GET media");
        self.http.get(url.clone()).headers(http::headers(
            RequestKind::Media,
            self.cookie.as_ref(),
            self.cfg.cookies_on_media,
        ))
    }
}

/// 표지 주소를 받아도 되는가. `https`만이고, 사용자 정보와 `{`·`}`(`{type}` 같은 틀 자리표시자)가 없어야 한다.
/// `allow_loopback_http`(테스트·E2E)이면 `http://127.0.0.1`·`http://[::1]`도 받는다. 호스트는 제한하지 않는다.
pub(crate) fn image_url_allowed(u: &Url, allow_loopback_http: bool) -> bool {
    use ::url::Host;
    let scheme_ok = match u.scheme() {
        "https" => true,
        "http" => {
            allow_loopback_http
                && match u.host() {
                    Some(Host::Ipv4(a)) => a.is_loopback(),
                    Some(Host::Ipv6(a)) => a.is_loopback(),
                    _ => false,
                }
        }
        _ => false,
    };
    // `Url`은 경로의 `{`·`}`를 `%7B`·`%7D`로 바꿔 직렬화한다
    let s = u.as_str().to_ascii_lowercase();
    scheme_ok
        && u.username().is_empty()
        && u.password().is_none()
        && !s.contains(['{', '}'])
        && !s.contains("%7b")
        && !s.contains("%7d")
}

/// API·MPD 응답 크기 상한. 실물은 KB 단위다(fixture 100KB 미만).
pub(crate) const MAX_API_BODY: usize = 8 * 1024 * 1024;

/// 응답 본문을 `max` 바이트까지만 읽는다. 넘으면 `Error::Parse`.
///
/// `read_timeout`은 idle만 끊으므로, 계속 흘러오는 본문은 이 상한으로 막는다.
pub(crate) async fn read_capped(resp: reqwest::Response, max: usize) -> Result<Bytes, Error> {
    read_capped_throttled(resp, max, None).await
}

/// `read_capped`에 속도 제한을 더한 것(rate-limit.md §3.4). 조각을 받을 때마다 치르고 다음 읽기를 늦춘다.
///
/// 세그먼트 본문은 메모리로 다 읽힌 뒤에야 쓰기 루프로 넘어간다. 그래서 쓰기 루프가 아니라 여기서 늦춰야
/// 네트워크가 늦춰진다. API·playlist·init은 `None`(제한 없음)이다.
pub(crate) async fn read_capped_throttled(
    mut resp: reqwest::Response,
    max: usize,
    throttle: Option<&Throttles>,
) -> Result<Bytes, Error> {
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
        if let Some(t) = throttle {
            t.consume(chunk.len() as u64).await;
        }
    }
    Ok(Bytes::from(buf))
}

/// 기본 주소 뒤에 path 세그먼트를 붙인다. 세그먼트는 인코딩되므로 `/`·`?`가 섞여도 경로가 바뀌지 않는다.
pub(crate) fn api_url(base: &Url, segs: &[&str]) -> Url {
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

    /// 표지 주소 규칙: https만, 사용자 정보·틀 자리표시자 없음. 루프백 http는 허용 스위치가 있을 때만.
    #[test]
    fn image_url_rules() {
        let ok = |s: &str, lo: bool| image_url_allowed(&Url::parse(s).unwrap(), lo);
        assert!(ok("https://img.example.invalid/thumb/1.jpg", false));
        assert!(ok("https://img.example.invalid/thumb/1.jpg?type=f", false));
        // 틀 자리표시자(`{type}`)는 직렬화에서 `%7B`로 바뀐다
        assert!(!ok("https://img.example.invalid/live/{type}.jpg", false));
        assert!(!ok(
            "https://img.example.invalid/live/%7btype%7D.jpg",
            false
        ));
        assert!(!ok("https://img.example.invalid/a.jpg?w={w}", false));
        assert!(!ok("https://user:pw@img.example.invalid/a.jpg", false));
        assert!(!ok("https://user@img.example.invalid/a.jpg", false));
        // http는 막고, 루프백만 스위치로 푼다
        assert!(!ok("http://img.example.invalid/a.jpg", false));
        assert!(!ok("http://img.example.invalid/a.jpg", true));
        assert!(!ok("http://127.0.0.1:9/a.jpg", false));
        assert!(ok("http://127.0.0.1:9/a.jpg", true));
        assert!(ok("http://[::1]:9/a.jpg", true));
        assert!(
            !ok("http://10.0.0.1/a.jpg", true),
            "루프백이 아닌 사설 주소는 막는다"
        );
        assert!(!ok("ftp://127.0.0.1/a.jpg", true));
        assert!(!ok("file:///etc/passwd", true));
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
