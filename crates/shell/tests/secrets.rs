//! 비밀 누출 검사(app.md §7.3·§13·§15-9).
//!
//! 쿠키 `NIDSECRET…`을 저장하고 켠 뒤 **실제 코어 클라이언트**(wiremock 상대)로 조회·성공 다운로드·실패 다운로드를
//! 끝까지 돌린다. 쿠키가 실제로 API 요청에 실렸는지(양성 대조)를 먼저 확인하고, 그 값이 로그·모든 `JobEvent`
//! JSON·`SettingsDto`·`ResolvedDto`·`AppError`·`settings.json`·`jobs.json`·`Debug` 출력 어디에도 없는지 본다.
//!
//! 로그는 전역 subscriber로 모든 스레드에서 잡는다(이 바이너리에는 테스트가 하나뿐이다).

use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_core::{ClientConfig, ContentRef, Endpoints, PlaybackKind, RetryPolicy};
use chzzk_shell::dto::{EnqueueRequest, JobEvent, JobStatus, OnExisting, SettingsPatch};
use chzzk_shell::jobs::JobStore;
use chzzk_shell::services::{AppPaths, SettingsService, enqueue};
use chzzk_shell::{DownloadManager, ErrorCode, ManagerConfig, OwnershipGate};
use tracing_subscriber::filter::Targets;
use tracing_subscriber::layer::SubscriberExt;
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

const SECRET: &str = "NIDSECRET";
const AUT: &str = "NIDSECRET_aut_value";
const SES: &str = "NIDSECRET_ses_value";
const VOD_NO: u64 = 9000002;
const VOD_VIDEO_ID: &str = "000000000000000000000000000000000B02";
const FAIL_NO: u64 = 999;
const QUALITY: &str = "PD_720P_TEST";
const MEDIA_PATH: &str = "/m1/pd/a.mp4";

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

/// Range를 지원하는 미디어 응답.
struct RangeBody(Vec<u8>);

impl Respond for RangeBody {
    fn respond(&self, req: &Request) -> ResponseTemplate {
        let len = self.0.len();
        let start: usize = req
            .headers
            .get("range")
            .and_then(|v| v.to_str().ok())
            .and_then(|r| r.strip_prefix("bytes="))
            .and_then(|r| r.strip_suffix('-'))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        if start == 0 && req.headers.get("range").is_none() {
            return ResponseTemplate::new(200).set_body_bytes(self.0.clone());
        }
        ResponseTemplate::new(206)
            .insert_header("content-range", format!("bytes {start}-{}/{len}", len - 1))
            .set_body_bytes(self.0[start..].to_vec())
    }
}

async fn mock_server() -> MockServer {
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
            pd_mpd(&format!("{}{MEDIA_PATH}?_lsu_sa_=sig", server.uri())),
            "application/dash+xml",
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(RangeBody((0..50_000u32).map(|i| i as u8).collect()))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{FAIL_NO}")))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    server
}

fn base_config(server: &MockServer) -> ClientConfig {
    let base = Url::parse(&server.uri()).unwrap();
    ClientConfig {
        endpoints: Endpoints {
            chzzk_api: base.clone(),
            vodplay_api: base,
        },
        retry: RetryPolicy {
            max_attempts: 2,
            base: Duration::from_millis(1),
            cap: Duration::from_millis(2),
            // 테스트는 연결 대기(인내)를 기다리지 않는다.
            patience: Duration::ZERO,
            patience_cap: Duration::ZERO,
        },
        progress_interval: Duration::ZERO,
        connect_timeout: Duration::from_secs(5),
        read_timeout: Duration::from_secs(5),
        ..ClientConfig::default()
    }
}

/// 로그를 모으는 writer.
#[derive(Clone, Default)]
struct LogBuf(Arc<Mutex<Vec<u8>>>);

impl Write for LogBuf {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl LogBuf {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }
}

fn request(no: u64, name: &str, folder: &Path) -> EnqueueRequest {
    EnqueueRequest {
        url: format!("https://chzzk.naver.com/video/{no}"),
        content: ContentRef::Video { video_no: no },
        title: format!("제목 {name}"),
        channel_name: "채널".into(),
        channel_id: None,
        quality_id: QUALITY.into(),
        quality_label: "720p".into(),
        expected_kind: PlaybackKind::Progressive,
        folder: Some(folder.to_string_lossy().into_owned()),
        file_name: name.into(),
        on_existing: OnExisting::Overwrite,
        restart: false,
        content_date: None,
    }
}

async fn wait_status(
    mgr: &DownloadManager<chzzk_core::Chzzk>,
    id: chzzk_shell::JobId,
    want: JobStatus,
) {
    for _ in 0..1000 {
        if mgr.list().iter().any(|j| j.id == id && j.status == want) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("작업 {id:?}가 {want:?}가 되지 않음: {:?}", mgr.list());
}

fn assert_clean(what: &str, text: &str) {
    assert!(!text.contains(SECRET), "{what}에 쿠키 값이 있다:\n{text}");
}

#[tokio::test]
async fn cookies_never_leak() {
    let logs = LogBuf::default();
    let w = logs.clone();
    let subscriber = tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(move || w.clone()),
        )
        .with(
            Targets::new()
                .with_default(tracing::Level::INFO)
                .with_target("chzzk_core", tracing::Level::TRACE)
                .with_target("chzzk_shell", tracing::Level::TRACE),
        );
    // 이 테스트 바이너리에는 테스트가 하나뿐이라 전역 subscriber로 모든 스레드(쓰기 스레드·spawn_blocking)를 잡는다.
    tracing::subscriber::set_global_default(subscriber).unwrap();

    let server = mock_server().await;
    let t = tempfile::tempdir().unwrap();
    let paths = AppPaths::new(
        t.path().join("config"),
        t.path().join("data"),
        t.path().join("log"),
        None,
        None,
        None,
    );
    let out_dir = t.path().join("out");
    let svc = SettingsService::open(&paths, base_config(&server), None).unwrap();
    let mut dtos = Vec::new();
    dtos.push(serde_json::to_string(&svc.set_naver_cookies(AUT, SES).unwrap()).unwrap());
    dtos.push(
        serde_json::to_string(
            &svc.update(SettingsPatch {
                use_naver_cookies: Some(true),
                ..SettingsPatch::default()
            })
            .unwrap(),
        )
        .unwrap(),
    );

    // 조회: 성공과 실패
    let resolved = svc
        .resolve(
            &format!("https://chzzk.naver.com/video/{VOD_NO}"),
            &OwnershipGate::disabled(),
        )
        .await
        .unwrap();
    dtos.push(serde_json::to_string(&resolved).unwrap());
    let err = svc
        .resolve(
            &format!("https://chzzk.naver.com/video/{FAIL_NO}"),
            &OwnershipGate::disabled(),
        )
        .await
        .unwrap_err();
    assert_ne!(err.code, ErrorCode::Internal);
    dtos.push(serde_json::to_string(&err).unwrap());
    dtos.push(format!("{err:?}"));

    // 다운로드: 성공 하나, 실패 하나
    let events: Arc<Mutex<Vec<String>>> = Arc::default();
    let ev = Arc::clone(&events);
    let mgr = DownloadManager::open(ManagerConfig {
        client: svc.client_fn(),
        store: JobStore::new(&paths.data),
        runtime: tokio::runtime::Handle::current(),
        max_parallel: 2,
        auto_resume: false,
    })
    .unwrap();
    mgr.subscribe(Box::new(move |e: JobEvent| {
        ev.lock().unwrap().push(serde_json::to_string(&e).unwrap());
        true
    }));
    let gate = OwnershipGate::disabled();
    let ok = enqueue(&svc, &gate, &mgr, request(VOD_NO, "ok", &out_dir))
        .await
        .unwrap();
    let bad = enqueue(&svc, &gate, &mgr, request(FAIL_NO, "bad", &out_dir))
        .await
        .unwrap();
    wait_status(&mgr, ok.id, JobStatus::Completed).await;
    wait_status(&mgr, bad.id, JobStatus::Failed).await;
    assert_eq!(std::fs::read(out_dir.join("ok.mp4")).unwrap().len(), 50_000);
    dtos.push(serde_json::to_string(&mgr.list()).unwrap());
    dtos.push(serde_json::to_string(&svc.get()).unwrap());

    // 양성 대조: 쿠키가 실제로 API 요청에 실렸고 파일에도 저장됐다
    let reqs = server.received_requests().await.unwrap();
    let api_cookie = reqs
        .iter()
        .filter(|r| r.url.path().starts_with("/service/"))
        .filter_map(|r| r.headers.get("cookie"))
        .filter_map(|v| v.to_str().ok())
        .any(|v| v.contains(AUT) && v.contains(SES));
    assert!(
        api_cookie,
        "API 요청에 쿠키가 실리지 않았다(검사가 무의미해진다)"
    );
    let creds = std::fs::read_to_string(paths.config.join("credentials.json")).unwrap();
    assert!(creds.contains(AUT));

    // 음성 검사
    let events = events.lock().unwrap().clone();
    assert!(
        events.iter().any(|e| e.contains(r#""status":"failed""#)),
        "실패 이벤트가 있어야 한다: {events:?}"
    );
    for e in &events {
        assert_clean("JobEvent", e);
    }
    for d in &dtos {
        assert_clean("DTO", d);
    }
    mgr.flush();
    assert_clean(
        "jobs.json",
        &std::fs::read_to_string(paths.data.join("jobs.json")).unwrap(),
    );
    assert_clean(
        "settings.json",
        &std::fs::read_to_string(paths.config.join("settings.json")).unwrap(),
    );
    assert_clean("SettingsService Debug", &format!("{svc:?}"));
    assert_clean("Chzzk Debug", &format!("{:?}", svc.client()));
    assert_clean(
        "ClientConfig Debug",
        &format!("{:?}", svc.client().config()),
    );

    let log = logs.text();
    assert!(
        log.contains("chzzk_"),
        "로그가 잡히지 않았다(검사가 무의미해진다):\n{log}"
    );
    assert_clean("로그", &log);
}
