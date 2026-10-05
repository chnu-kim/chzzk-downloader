//! HTTP 공통: 클라이언트 생성, 요청 종류별 헤더, 비밀값 마스킹(설계 §3.3, 결정 7·8·9).
//!
//! - 헤더는 호스트가 아니라 요청 종류(`RequestKind`)로 정한다. 그래야 127.0.0.1 mock으로 검증된다.
//! - 쿠키는 API·MPD 요청에만, 사용자가 켠 경우(`Some`)에만 보낸다. 미디어에는 `cookies_on_media`일 때만.
//! - 압축 해제를 끈다. 자동 해제는 `Content-Length`와 Range offset을 깨뜨린다.
//! - 쿠키 값·서명 토큰은 `Debug`·`Display`·오류 어디에도 나오지 않는다.

use std::fmt;
use std::time::Duration;

use ::url::Url;
use reqwest::header::{ACCEPT, COOKIE, HeaderMap, HeaderValue, ORIGIN, REFERER, USER_AGENT};

use crate::error::Error;

/// 요청 종류. 헤더와 상태 코드 해석이 이것으로 정해진다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestKind {
    /// 치지직 API(JSON)
    Api,
    /// vodplay API(DASH MPD)
    Mpd,
    /// 미디어 CDN(PD mp4, HLS playlist·세그먼트)
    Media,
}

/// `Debug`·`Display`에서 값을 `***`로 가리는 래퍼.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret<T>(T);

impl<T> Secret<T> {
    pub fn new(v: T) -> Self {
        Secret(v)
    }

    /// 실제 값. 헤더를 만들 때와 저장할 때만 쓴다.
    pub fn expose(&self) -> &T {
        &self.0
    }
}

impl<T> fmt::Debug for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

impl<T> fmt::Display for Secret<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

/// `Debug`에서 서명 주소를 `redact_url`로 보여 주는 래퍼(쿼리·`hdntl` 토큰 제거).
pub(crate) struct DebugUrl<'a>(pub &'a Url);

impl fmt::Debug for DebugUrl<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&redact_url(self.0), f)
    }
}

/// 비밀 문자열 `Option`을 `Debug`용으로 바꾼다. 있으면 `Some(***)`, 없으면 `None`.
pub(crate) fn masked<T>(o: &Option<T>) -> Option<Secret<()>> {
    o.as_ref().map(|_| Secret::new(()))
}

/// 네이버 로그인 쿠키(성인 인증용).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaverCookies {
    pub nid_aut: Secret<String>,
    pub nid_ses: Secret<String>,
}

impl NaverCookies {
    pub fn new(nid_aut: impl Into<String>, nid_ses: impl Into<String>) -> Self {
        NaverCookies {
            nid_aut: Secret::new(nid_aut.into()),
            nid_ses: Secret::new(nid_ses.into()),
        }
    }

    /// `Cookie` 헤더 값. 순서는 `NID_AUT`, `NID_SES`로 고정이다(spec §9.1-13).
    /// 헤더로 보낼 수 없는 문자가 있으면 `Error::Settings`.
    pub(crate) fn header_value(&self) -> Result<HeaderValue, Error> {
        let s = format!(
            "NID_AUT={}; NID_SES={}",
            self.nid_aut.expose().trim(),
            self.nid_ses.expose().trim()
        );
        let mut v = HeaderValue::from_str(&s).map_err(|_| {
            Error::Settings("쿠키 값에 HTTP 헤더로 보낼 수 없는 문자가 있습니다".into())
        })?;
        v.set_sensitive(true);
        Ok(v)
    }
}

/// Chrome 메이저 버전. UA 세 개가 이 값 하나를 쓴다.
macro_rules! chrome_major {
    () => {
        "141"
    };
}

const UA_WINDOWS: &str = concat!(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/",
    chrome_major!(),
    ".0.0.0 Safari/537.36"
);
const UA_MACOS: &str = concat!(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/",
    chrome_major!(),
    ".0.0.0 Safari/537.36"
);
const UA_LINUX: &str = concat!(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/",
    chrome_major!(),
    ".0.0.0 Safari/537.36"
);

/// 실행 중인 OS에 맞는 User-Agent(spec §9.1-14: macOS에 Linux UA를 쓰던 문제 수정).
pub fn user_agent() -> &'static str {
    if cfg!(windows) {
        UA_WINDOWS
    } else if cfg!(target_os = "macos") {
        UA_MACOS
    } else {
        UA_LINUX
    }
}

const REFERER_VALUE: &str = "https://chzzk.naver.com/";
const ORIGIN_VALUE: &str = "https://chzzk.naver.com";
const ACCEPT_JSON: &str = "application/json, */*";
const ACCEPT_MPD: &str = "application/dash+xml, application/xml, */*";

/// 요청 종류별 헤더.
///
/// | 종류 | 헤더 |
/// |---|---|
/// | Api | UA, Referer, Origin, `Accept: application/json, */*`, Cookie(있을 때) |
/// | Mpd | Api와 같고 `Accept: application/dash+xml, application/xml, */*` |
/// | Media | UA, Referer, Cookie(`cookies_on_media`일 때만) |
pub(crate) fn headers(
    kind: RequestKind,
    cookie: Option<&HeaderValue>,
    cookies_on_media: bool,
) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(USER_AGENT, HeaderValue::from_static(user_agent()));
    h.insert(REFERER, HeaderValue::from_static(REFERER_VALUE));
    let send_cookie = match kind {
        RequestKind::Api | RequestKind::Mpd => {
            h.insert(ORIGIN, HeaderValue::from_static(ORIGIN_VALUE));
            let accept = if kind == RequestKind::Api {
                ACCEPT_JSON
            } else {
                ACCEPT_MPD
            };
            h.insert(ACCEPT, HeaderValue::from_static(accept));
            true
        }
        RequestKind::Media => cookies_on_media,
    };
    if send_cookie && let Some(c) = cookie {
        h.insert(COOKIE, c.clone());
    }
    h
}

/// 코어가 쓰는 HTTP 클라이언트 하나를 만든다.
///
/// 전체 timeout은 두지 않는다(긴 다운로드). 연결 timeout과 읽기 idle timeout만 둔다.
pub(crate) fn build_client(
    connect_timeout: Duration,
    read_timeout: Duration,
) -> Result<reqwest::Client, Error> {
    reqwest::Client::builder()
        .connect_timeout(connect_timeout)
        .read_timeout(read_timeout)
        // 다른 crate가 feature를 켜도(feature 통합) 압축 해제가 일어나지 않게 한다.
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .build()
        .map_err(Error::network)
}

/// 로그·오류용 주소. 쿼리·fragment·사용자 정보를 지우고, 경로의 `hdntl=...` 토큰을 가린다.
pub fn redact_url(u: &Url) -> String {
    let mut u = u.clone();
    u.set_query(None);
    u.set_fragment(None);
    let _ = u.set_username("");
    let _ = u.set_password(None);
    // 토큰 안의 `acl=*/kr/*`에 `/`가 있어 토큰이 여러 세그먼트에 걸친다.
    // `hdntl=`로 시작하는 세그먼트부터 `hmac=`이 든 세그먼트까지를 하나로 가린다.
    // `hmac=`이 없으면(토큰 형식 변경) 마지막 세그먼트(파일명) 앞까지 가린다.
    let segs: Vec<&str> = u.path().split('/').collect();
    let mut path: Vec<&str> = Vec::with_capacity(segs.len());
    let mut i = 0;
    while i < segs.len() {
        if segs[i].starts_with("hdntl=") {
            let end = segs[i..]
                .iter()
                .position(|s| s.contains("hmac="))
                .map_or_else(|| i.max(segs.len().saturating_sub(2)), |k| i + k);
            path.push("hdntl=***");
            i = end + 1;
        } else {
            path.push(segs[i]);
            i += 1;
        }
    }
    let path = path.join("/");
    u.set_path(&path);
    u.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ClientConfig;
    use crate::error::Unsupported;
    use crate::model::PlaybackKind;
    use std::path::PathBuf;

    const SECRETS: [&str; 4] = ["secretAUT", "secretSES", "hmac=", "hdntl=exp"];

    fn assert_clean(s: &str) {
        for secret in SECRETS {
            assert!(!s.contains(secret), "{secret:?}가 노출됐다: {s}");
        }
    }

    /// spec §8.4 TestRedactedCmdString_HidesCookie의 의도 이식.
    #[tokio::test]
    async fn secrets_never_in_debug_or_error() {
        let cookies = NaverCookies::new("secretAUT", "secretSES");
        assert_clean(&format!("{cookies:?}"));
        assert_clean(&format!("{}", cookies.nid_aut));
        let cfg = ClientConfig {
            cookies: Some(cookies.clone()),
            ..ClientConfig::default()
        };
        assert_clean(&format!("{cfg:?}"));
        // 헤더 값은 sensitive로 표시되어 Debug에 나오지 않는다.
        let cookie = cookies.header_value().unwrap();
        assert!(cookie.is_sensitive());
        assert_clean(&format!(
            "{:?}",
            headers(RequestKind::Api, Some(&cookie), false)
        ));

        // 서명 주소
        let signed = Url::parse(
            "https://cdn.example/kr/144p/hdntl=exp=1~acl=*/kr/*~data=hdntl~hmac=abc/seg.m4v?hdnts=st=1~exp=2~hmac=def#frag",
        )
        .unwrap();
        let red = redact_url(&signed);
        assert_clean(&red);
        assert_eq!(red, "https://cdn.example/kr/144p/hdntl=***/seg.m4v");

        // 네트워크 오류: reqwest 오류의 URL(서명 쿼리 포함)을 지운다.
        let client = build_client(Duration::from_secs(1), Duration::from_secs(1)).unwrap();
        let err = client
            .get("http://127.0.0.1:1/x?hdnts=hmac=secretAUT")
            .send()
            .await
            .unwrap_err();
        let err = Error::network(err);
        assert_clean(&err.to_string());
        assert_clean(&format!("{err:?}"));

        // 그 밖의 모든 Error Display
        let errors = [
            Error::InvalidUrl,
            Error::Api {
                code: 403,
                message: Some("x".into()),
            },
            Error::HttpStatus {
                status: 403,
                kind: RequestKind::Media,
            },
            Error::AuthRequired { status: 403 },
            Error::NoPlayback { adult: true },
            Error::EncryptedVod {
                method: "AES".into(),
            },
            Error::NoQualities,
            Error::QualityNotFound {
                requested: "a".into(),
                available: vec!["b".into()],
            },
            Error::PlaybackChanged {
                was: PlaybackKind::LiveRewindHls,
                now: PlaybackKind::Progressive,
            },
            Error::SourceChanged { detail: "x".into() },
            Error::RefreshExhausted,
            Error::Unsupported(Unsupported::Encrypted("AES-128".into())),
            Error::Parse {
                what: "x",
                detail: "y".into(),
            },
            Error::LengthMismatch {
                expected: 1,
                actual: 0,
            },
            Error::DiskFull {
                path: PathBuf::from("a"),
            },
            Error::Settings("x".into()),
            Error::Cancelled,
        ];
        for e in &errors {
            assert_clean(&e.to_string());
            assert_clean(&format!("{e:?}"));
        }
    }

    /// 리뷰 수정: 서명 주소·inKey를 품은 공개 타입의 `Debug`에 토큰이 나오지 않는다(fixture).
    #[test]
    fn signed_types_debug_redacted() {
        use crate::hls::{parse_master, parse_media};
        use crate::info::{Playback, classify, parse_video_info};
        use crate::model::{ContentRef, Resolved, Source};
        use crate::mpd::{parse_mpd, pd_reps};
        use crate::testutil::{fixture, fixture_str};

        // fixture의 inKey 값도 나오면 안 된다.
        let raw: serde_json::Value =
            serde_json::from_slice(&fixture("testdata/vod/video_info.json")).unwrap();
        let in_key = raw["content"]["inKey"].as_str().unwrap().to_string();
        let check = |s: &str| {
            for secret in ["hmac", "hdnts", "hdntl=exp", "_lsu_sa_", &in_key] {
                assert!(!s.contains(secret), "{secret:?}가 노출됐다: {s}");
            }
        };

        // 빠른 다시보기: VideoContent(playback JSON), Playback::LiveRewind(master hdnts)
        let (meta, v) = parse_video_info(&fixture("testdata/hls/video_info.json")).unwrap();
        check(&format!("{v:?}"));
        let pb = classify(&v).unwrap();
        assert!(matches!(pb, Playback::LiveRewind { .. }));
        check(&format!("{pb:?}"));
        let Playback::LiveRewind { master_url, tracks } = pb else {
            unreachable!()
        };
        let resolved = Resolved {
            content: ContentRef::Video { video_no: 1 },
            meta,
            source: Source::LiveRewindHls {
                master_url: master_url.clone(),
                tracks,
            },
        };
        check(&format!("{resolved:?}"));

        // HLS variant(hdntl 경로 토큰)·media playlist·segment
        let variants = parse_master(&fixture_str("testdata/hls/master.m3u8"), &master_url).unwrap();
        check(&format!("{variants:?}"));
        let media = parse_media(&fixture_str("testdata/hls/media.m3u8"), &variants[3].uri).unwrap();
        check(&format!("{media:?}"));
        check(&format!("{:?}", media.segments[0]));

        // DASH: VideoContent·Playback::Dash(inKey), Representation·PdRep(_lsu_sa_ 쿼리)
        let (meta, v) = parse_video_info(&fixture("testdata/vod/video_info.json")).unwrap();
        check(&format!("{v:?}"));
        let pb = classify(&v).unwrap();
        assert!(matches!(pb, Playback::Dash { .. }));
        check(&format!("{pb:?}"));
        let enc = Playback::Encrypted {
            method: "AES".into(),
            video_id: "x".into(),
            in_key: Some(in_key.clone()),
        };
        check(&format!("{enc:?}"));
        let reps = parse_mpd(&fixture_str("testdata/vod/playback.mpd")).unwrap();
        check(&format!("{reps:?}"));
        let pd = pd_reps(&reps).unwrap();
        assert!(!pd.is_empty());
        let resolved = Resolved {
            content: ContentRef::Video { video_no: 1 },
            meta,
            source: Source::Progressive { reps: pd },
        };
        check(&format!("{resolved:?}"));
    }

    #[test]
    fn redact_url_rules() {
        let u =
            Url::parse("https://user:pw@h.example/a/hdntl=exp=1~hmac=x/b.m3u8?hdnts=1#f").unwrap();
        assert_eq!(redact_url(&u), "https://h.example/a/hdntl=***/b.m3u8");
        // 리뷰 수정: `hmac=`이 없는 토큰도 파일명 앞까지 가린다.
        let sig =
            Url::parse("https://c/kr/144p/hdntl=exp=1~acl=*/kr/*~data=hdntl~sig=SECRETSIG/seg.m4v")
                .unwrap();
        assert_eq!(redact_url(&sig), "https://c/kr/144p/hdntl=***/seg.m4v");
        // 토큰이 마지막 세그먼트면 그것만 가린다.
        let last = Url::parse("https://c/a/hdntl=exp=1~sig=S").unwrap();
        assert_eq!(redact_url(&last), "https://c/a/hdntl=***");
        let plain = Url::parse("https://h.example/a/b.mp4").unwrap();
        assert_eq!(redact_url(&plain), "https://h.example/a/b.mp4");
    }

    #[test]
    fn headers_by_kind() {
        let cookie = NaverCookies::new("a", "b").header_value().unwrap();
        assert_eq!(cookie.to_str().unwrap(), "NID_AUT=a; NID_SES=b");

        let api = headers(RequestKind::Api, Some(&cookie), false);
        assert_eq!(api[USER_AGENT], user_agent());
        assert_eq!(api[REFERER], "https://chzzk.naver.com/");
        assert_eq!(api[ORIGIN], "https://chzzk.naver.com");
        assert_eq!(api[ACCEPT], "application/json, */*");
        assert_eq!(api[COOKIE], "NID_AUT=a; NID_SES=b");

        let mpd = headers(RequestKind::Mpd, Some(&cookie), false);
        assert_eq!(mpd[ACCEPT], "application/dash+xml, application/xml, */*");
        assert_eq!(mpd[ORIGIN], "https://chzzk.naver.com");
        assert!(mpd.contains_key(COOKIE));

        let media = headers(RequestKind::Media, Some(&cookie), false);
        assert_eq!(media.len(), 2);
        assert!(media.contains_key(USER_AGENT) && media.contains_key(REFERER));
        let media_on = headers(RequestKind::Media, Some(&cookie), true);
        assert_eq!(media_on[COOKIE], "NID_AUT=a; NID_SES=b");

        assert!(!headers(RequestKind::Api, None, true).contains_key(COOKIE));
    }

    #[test]
    fn cookie_rejects_header_breaking_chars() {
        assert!(matches!(
            NaverCookies::new("a\r\nX: y", "b").header_value(),
            Err(Error::Settings(_))
        ));
    }

    #[test]
    fn user_agent_per_os() {
        let ua = user_agent();
        assert!(ua.contains("Chrome/141.0.0.0"));
        if cfg!(target_os = "macos") {
            assert!(ua.contains("Macintosh"));
        } else if cfg!(windows) {
            assert!(ua.contains("Windows NT 10.0"));
        } else {
            assert!(ua.contains("X11; Linux"));
        }
    }
}
