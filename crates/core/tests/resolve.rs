//! `Chzzk::resolve` 통합 테스트(설계 §8.2 resolve, §8.1 SendsHeaders). 네트워크는 wiremock뿐이다.

mod common;

use chzzk_core::http::user_agent;
use chzzk_core::{
    Chzzk, ClientConfig, ContentRef, Error, ErrorKind, NaverCookies, PlaybackKind, RequestKind,
    Source,
};
use common::{config, fixture, rewrite_hosts};
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

// 합성 fixture(`testdata/`)의 가짜 식별자.
const VOD_NO: u64 = 9000002;
const VOD_VIDEO_ID: &str = "000000000000000000000000000000000B02";
const VOD_IN_KEY: &str =
    "V100000000000000000000000000000000000000000000000000000000000000000000000000000000b2";
const HLS_NO: u64 = 9000001;
const CLIP_ID: &str = "TestClip01";
const CLIP_VIDEO_ID: &str = "000000000000000000000000000000000C03";

fn video(no: u64) -> ContentRef {
    ContentRef::Video { video_no: no }
}

fn clip_ref(id: &str) -> ContentRef {
    ContentRef::Clip {
        clip_id: id.to_string(),
    }
}

fn json(body: Vec<u8>) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_raw(body, "application/json")
}

fn xml(body: Vec<u8>) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_raw(body, "application/dash+xml")
}

async fn mount_info(server: &MockServer, p: &str, body: Vec<u8>) {
    Mock::given(method("GET"))
        .and(path(p))
        .respond_with(json(body))
        .mount(server)
        .await;
}

async fn mount_mpd(server: &MockServer, video_id: &str, rel: &str) {
    Mock::given(method("GET"))
        .and(path(format!("/neonplayer/vodplay/v2/playback/{video_id}")))
        .respond_with(xml(fixture(rel)))
        .mount(server)
        .await;
}

fn chzzk(server: &MockServer) -> Chzzk {
    Chzzk::new(config(server)).unwrap()
}

async fn requests_to(server: &MockServer, prefix: &str) -> Vec<Request> {
    server
        .received_requests()
        .await
        .unwrap()
        .into_iter()
        .filter(|r| r.url.path().starts_with(prefix))
        .collect()
}

fn header<'a>(r: &'a Request, name: &str) -> Option<&'a str> {
    r.headers.get(name).map(|v| v.to_str().unwrap())
}

#[tokio::test]
async fn live_rewind() {
    let server = MockServer::start().await;
    let body = rewrite_hosts(&fixture("testdata/hls/video_info.json"), &server.uri());
    mount_info(&server, &format!("/service/v2/videos/{HLS_NO}"), body).await;

    let r = chzzk(&server).resolve(&video(HLS_NO)).await.unwrap();
    assert_eq!(r.content, video(HLS_NO));
    assert_eq!(r.kind(), PlaybackKind::LiveRewindHls);
    assert_eq!(r.meta.title, "테스트 다시보기");
    assert_eq!(r.meta.channel_name, "테스트채널");
    let Source::LiveRewindHls { master_url, tracks } = &r.source else {
        panic!("LiveRewindHls가 아니다");
    };
    // 호스트 재작성이 이중 인코딩 JSON 안에서도 됐다.
    assert!(master_url.as_str().starts_with(&server.uri()));
    assert!(master_url.path().ends_with("/vod_playlist.m3u8"));
    let ids: Vec<_> = tracks.iter().map(|q| q.id.as_str()).collect();
    assert_eq!(ids, ["720p", "480p", "360p", "144p", "1080p"]);
    assert_eq!(r.default_quality(None), 4);
    // master는 다운로드 때 받는다. 요청은 info 하나뿐이다.
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn dash() {
    let server = MockServer::start().await;
    mount_info(
        &server,
        &format!("/service/v2/videos/{VOD_NO}"),
        fixture("testdata/vod/video_info.json"),
    )
    .await;
    Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
        )))
        .and(query_param("key", VOD_IN_KEY))
        .respond_with(xml(fixture("testdata/vod/playback.mpd")))
        .expect(1)
        .mount(&server)
        .await;

    let r = chzzk(&server).resolve(&video(VOD_NO)).await.unwrap();
    assert_eq!(r.kind(), PlaybackKind::Progressive);
    assert_eq!(r.meta.channel_name, "가상채널");
    let ids: Vec<_> = r.qualities().iter().map(|q| q.id.as_str()).collect();
    assert_eq!(ids, ["PD_144P_256_128_64", "PD_720P_1280_4000_192"]);
    let Source::Progressive { reps } = &r.source else {
        panic!()
    };
    assert_eq!(reps[1].url.host_str(), Some("vod.example.invalid"));
    assert_eq!(r.default_quality(None), 1);
}

#[tokio::test]
async fn clip() {
    let server = MockServer::start().await;
    mount_info(
        &server,
        &format!("/service/v1/play-info/clip/{CLIP_ID}"),
        fixture("testdata/clip/clip_playinfo.json"),
    )
    .await;
    mount_mpd(&server, CLIP_VIDEO_ID, "testdata/clip/clip_multi.mpd").await;

    let r = chzzk(&server).resolve(&clip_ref(CLIP_ID)).await.unwrap();
    assert_eq!(r.content, clip_ref(CLIP_ID));
    assert_eq!(r.kind(), PlaybackKind::Progressive);
    assert_eq!(r.meta.title, "테스트 클립 하나");
    let labels: Vec<_> = r.qualities().iter().map(|q| q.label.as_str()).collect();
    assert_eq!(labels, ["720p", "480p"]);

    let mpd = requests_to(&server, "/neonplayer/").await;
    assert_eq!(mpd.len(), 1);
    let key = mpd[0]
        .url
        .query_pairs()
        .find(|(k, _)| k == "key")
        .unwrap()
        .1;
    // 클립 fixture의 inKey 그대로(VOD `…b2`·클립 둘 `…c4`와 다르다).
    assert_eq!(key, format!("V1{}c3", "0".repeat(80)));
}

/// AES VOD는 MPD를 받지 않고 `EncryptedVod`로 끝난다(설계 §11).
#[tokio::test]
async fn aes_rejected_without_mpd() {
    let server = MockServer::start().await;
    mount_info(
        &server,
        &format!("/service/v2/videos/{VOD_NO}"),
        fixture("testdata/synthetic/vod_info_aes.json"),
    )
    .await;
    Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
        )))
        .respond_with(xml(fixture("testdata/vod/playback.mpd")))
        .expect(0)
        .mount(&server)
        .await;

    let err = chzzk(&server).resolve(&video(VOD_NO)).await.unwrap_err();
    assert!(matches!(&err, Error::EncryptedVod { method } if method == "AES"));
    assert_eq!(err.kind(), ErrorKind::Encrypted);
    assert_eq!(err.to_string(), "암호화된 VOD(AES)는 지원하지 않습니다");
    assert!(requests_to(&server, "/neonplayer/").await.is_empty());
}

#[tokio::test]
async fn api_401_403_auth_required() {
    for status in [401u16, 403] {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(format!("/service/v2/videos/{VOD_NO}")))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;
        let err = chzzk(&server).resolve(&video(VOD_NO)).await.unwrap_err();
        assert!(
            matches!(err, Error::AuthRequired { status: s } if s == status),
            "{status}: {err:?}"
        );
    }

    // MPD 요청의 403도 같다.
    let server = MockServer::start().await;
    mount_info(
        &server,
        &format!("/service/v1/play-info/clip/{CLIP_ID}"),
        fixture("testdata/clip/clip_playinfo.json"),
    )
    .await;
    Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{CLIP_VIDEO_ID}"
        )))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let err = chzzk(&server)
        .resolve(&clip_ref(CLIP_ID))
        .await
        .unwrap_err();
    assert!(matches!(err, Error::AuthRequired { status: 403 }));
}

/// 리뷰 수정: 8 MiB를 넘는 API 응답은 메모리에 다 읽지 않고 `Parse`로 끊는다.
#[tokio::test]
async fn api_body_too_large() {
    let server = MockServer::start().await;
    mount_info(
        &server,
        &format!("/service/v2/videos/{VOD_NO}"),
        vec![b' '; 8 * 1024 * 1024 + 1],
    )
    .await;
    let err = chzzk(&server).resolve(&video(VOD_NO)).await.unwrap_err();
    assert!(
        matches!(
            err,
            Error::Parse {
                what: "response",
                ..
            }
        ),
        "{err:?}"
    );
}

#[tokio::test]
async fn api_http_status() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let err = chzzk(&server).resolve(&video(VOD_NO)).await.unwrap_err();
    assert!(matches!(
        err,
        Error::HttpStatus {
            status: 500,
            kind: RequestKind::Api
        }
    ));
    assert_eq!(err.kind(), ErrorKind::Http);
    assert!(err.is_resumable());

    // MPD 404
    let server = MockServer::start().await;
    mount_info(
        &server,
        &format!("/service/v2/videos/{VOD_NO}"),
        fixture("testdata/vod/video_info.json"),
    )
    .await;
    let err = chzzk(&server).resolve(&video(VOD_NO)).await.unwrap_err();
    assert!(matches!(
        err,
        Error::HttpStatus {
            status: 404,
            kind: RequestKind::Mpd
        }
    ));
    assert!(!err.is_resumable());
}

#[tokio::test]
async fn api_code_not_200() {
    let server = MockServer::start().await;
    mount_info(
        &server,
        &format!("/service/v2/videos/{VOD_NO}"),
        r#"{"code":400,"message":"잘못된 요청","content":null}"#
            .as_bytes()
            .to_vec(),
    )
    .await;
    let err = chzzk(&server).resolve(&video(VOD_NO)).await.unwrap_err();
    assert!(matches!(&err, Error::Api { code: 400, message: Some(m) } if m == "잘못된 요청"));
    assert_eq!(err.kind(), ErrorKind::Api);
}

#[tokio::test]
async fn no_playback_and_empty_tracks() {
    let server = MockServer::start().await;
    let mut v: serde_json::Value =
        serde_json::from_slice(&fixture("testdata/hls/video_info.json")).unwrap();
    v["content"]["liveRewindPlaybackJson"] = serde_json::Value::Null;
    mount_info(
        &server,
        "/service/v2/videos/1",
        serde_json::to_vec(&v).unwrap(),
    )
    .await;
    v["content"]["liveRewindPlaybackJson"] =
        r#"{"media":[{"protocol":"HLS","path":"https://x/m.m3u8","encodingTrack":[]}]}"#.into();
    mount_info(
        &server,
        "/service/v2/videos/2",
        serde_json::to_vec(&v).unwrap(),
    )
    .await;

    let c = chzzk(&server);
    assert!(matches!(
        c.resolve(&video(1)).await,
        Err(Error::NoPlayback { adult: false })
    ));
    assert!(matches!(
        c.resolve(&video(2)).await,
        Err(Error::NoQualities)
    ));
}

/// spec §8.2 SendsHeaders(설계 §4.2로 변경): 쿠키는 켰을 때 API·MPD에만.
#[tokio::test]
async fn api_headers_cookie_opt_in() {
    for with_cookies in [true, false] {
        let server = MockServer::start().await;
        mount_info(
            &server,
            &format!("/service/v1/play-info/clip/{CLIP_ID}"),
            fixture("testdata/clip/clip_playinfo.json"),
        )
        .await;
        mount_mpd(&server, CLIP_VIDEO_ID, "testdata/clip/clip_multi.mpd").await;
        let cfg = ClientConfig {
            cookies: with_cookies.then(|| NaverCookies::new("a", "b")),
            ..config(&server)
        };
        Chzzk::new(cfg)
            .unwrap()
            .resolve(&clip_ref(CLIP_ID))
            .await
            .unwrap();

        let api = &requests_to(&server, "/service/").await[0];
        let mpd = &requests_to(&server, "/neonplayer/").await[0];
        for r in [api, mpd] {
            assert_eq!(header(r, "user-agent"), Some(user_agent()));
            assert_eq!(header(r, "referer"), Some("https://chzzk.naver.com/"));
            assert_eq!(header(r, "origin"), Some("https://chzzk.naver.com"));
            let cookie = header(r, "cookie");
            if with_cookies {
                assert_eq!(cookie, Some("NID_AUT=a; NID_SES=b"));
            } else {
                assert_eq!(cookie, None);
            }
            // 압축을 요청하지 않는다(Content-Length·Range offset 보존).
            assert!(
                header(r, "accept-encoding").is_none_or(|v| v == "identity"),
                "{:?}",
                header(r, "accept-encoding")
            );
        }
        assert_eq!(header(api, "accept"), Some("application/json, */*"));
        assert_eq!(
            header(mpd, "accept"),
            Some("application/dash+xml, application/xml, */*")
        );
    }
}

/// 연결 실패는 `Network`이고 메시지에 요청 주소가 없다.
#[tokio::test]
async fn network_error_has_no_url() {
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let base = url::Url::parse(&format!("http://127.0.0.1:{port}/")).unwrap();
    let cfg = ClientConfig {
        endpoints: chzzk_core::Endpoints {
            chzzk_api: base.clone(),
            vodplay_api: base,
        },
        ..ClientConfig::default()
    };
    let err = Chzzk::new(cfg)
        .unwrap()
        .resolve(&video(VOD_NO))
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Network(_)), "{err:?}");
    assert_eq!(err.kind(), ErrorKind::Network);
    assert!(err.is_resumable());
    assert!(!err.to_string().contains("127.0.0.1"), "{err}");
    assert!(!format!("{err:?}").contains(&VOD_NO.to_string()), "{err:?}");
}

/// 실서버 스모크. `CHZZK_LIVE_VIDEO=<videoNo>`로 직접 실행한다.
#[tokio::test]
#[ignore = "실서버 접속"]
async fn live_smoke() {
    let Ok(no) = std::env::var("CHZZK_LIVE_VIDEO") else {
        return;
    };
    let c = Chzzk::new(ClientConfig::default()).unwrap();
    let r = c.resolve(&video(no.parse().unwrap())).await.unwrap();
    assert!(!r.qualities().is_empty());
}
