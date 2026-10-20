//! 미리보기와 `App` 배선(preview.md PV-2): 실제 코어 클라이언트(wiremock 상대)로 열고 `handle`로 읽는다.
//! 로그인 상태가 풀리면(`on_auth_status`) 열린 세션이 닫히는지도 본다.

use std::path::Path;
use std::time::Duration;

use chzzk_core::{ClientConfig, ContentRef, Endpoints, RetryPolicy};
use chzzk_shell::App;
use chzzk_shell::auth::{AuthPhase, AuthStatus};
use chzzk_shell::services::AppPaths;
use chzzk_shell::watch::ReqCtx;
use tempfile::TempDir;
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const VOD_NO: u64 = 9000002;
const VOD_VIDEO_ID: &str = "000000000000000000000000000000000B02";
const QUALITY: &str = "PD_720P_TEST";
const MEDIA_PATH: &str = "/m1/pd/a.mp4";
const BODY_LEN: usize = 5_000;

fn fixture(rel: &str) -> Vec<u8> {
    let p = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

fn pd_mpd(url: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:nvod="urn:naver:vod:2020">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="{QUALITY}" bandwidth="1000" width="1280" height="720">
        <nvod:Label kind="resolution">720</nvod:Label>
        <BaseURL>{url}</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"#
    )
}

/// 닫힌 구간(`bytes=a-b`)을 지원하는 미디어 응답. 바이트 값은 위치의 낮은 8비트다.
struct ClosedRange;

impl Respond for ClosedRange {
    fn respond(&self, req: &Request) -> ResponseTemplate {
        let Some((a, b)) = req
            .headers
            .get("range")
            .and_then(|v| v.to_str().ok())
            .and_then(|r| r.strip_prefix("bytes="))
            .and_then(|r| r.split_once('-'))
            .and_then(|(a, b)| Some((a.parse::<usize>().ok()?, b.parse::<usize>().ok()?)))
        else {
            return ResponseTemplate::new(200).set_body_bytes(vec![0u8; BODY_LEN]);
        };
        let b = b.min(BODY_LEN - 1);
        ResponseTemplate::new(206)
            .insert_header("content-range", format!("bytes {a}-{b}/{BODY_LEN}"))
            .set_body_bytes((a..=b).map(|i| i as u8).collect::<Vec<u8>>())
    }
}

async fn mock_api() -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("testdata/vod/video_info.json"), "application/json"),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
        )))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            pd_mpd(&format!("{}{MEDIA_PATH}?hdnts=sig", server.uri())),
            "application/dash+xml",
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ClosedRange)
        .mount(&server)
        .await;
    server
}

fn open_app(root: &Path, api: &MockServer) -> App {
    let base = Url::parse(&api.uri()).unwrap();
    let paths = AppPaths::new(
        root.join("config"),
        root.join("data"),
        root.join("log"),
        None,
        None,
        None,
    );
    App::open_with(
        paths,
        ClientConfig {
            endpoints: Endpoints {
                chzzk_api: base.clone(),
                vodplay_api: base,
            },
            retry: RetryPolicy {
                max_attempts: 1,
                base: Duration::from_millis(1),
                cap: Duration::from_millis(1),
                patience: Duration::ZERO,
                patience_cap: Duration::ZERO,
            },
            ..ClientConfig::default()
        },
        None,
        tokio::runtime::Handle::current(),
    )
    .unwrap()
}

fn status(phase: AuthPhase) -> AuthStatus {
    AuthStatus {
        phase,
        reason: None,
        channel_id: None,
        channel_name: None,
        is_admin: false,
        pending: None,
        offline: None,
        verified_at: None,
        has_session: false,
        delegated_channels: vec![],
        delegations_verified: false,
        delegations_checked_at: None,
    }
}

#[tokio::test]
async fn app_opens_and_serves_a_real_range() {
    let api = mock_api().await;
    let dir = TempDir::new().unwrap();
    let app = open_app(dir.path(), &api);
    let url = format!("https://chzzk.naver.com/video/{VOD_NO}");
    let dto = app
        .watch
        .open(&url, &ContentRef::Video { video_no: VOD_NO })
        .await
        .unwrap();

    let req = http::Request::builder()
        .uri(&dto.src)
        .header("range", "bytes=10-19")
        .body(Vec::new())
        .unwrap();
    let r = app
        .watch
        .handle(
            &req,
            ReqCtx {
                webview_label: "main",
            },
        )
        .await;
    assert_eq!(r.status().as_u16(), 206);
    assert_eq!(
        r.headers().get("content-range").unwrap(),
        &format!("bytes 10-19/{BODY_LEN}")
    );
    assert_eq!(r.body(), &(10..=19).map(|i| i as u8).collect::<Vec<u8>>());
}

#[tokio::test]
async fn auth_status_not_signed_in_closes_session() {
    let api = mock_api().await;
    let dir = TempDir::new().unwrap();
    let app = open_app(dir.path(), &api);
    let url = format!("https://chzzk.naver.com/video/{VOD_NO}");
    app.watch
        .open(&url, &ContentRef::Video { video_no: VOD_NO })
        .await
        .unwrap();
    assert!(app.watch.has_session());

    app.on_auth_status(&status(AuthPhase::SignedOut));
    assert!(!app.watch.has_session());
}
