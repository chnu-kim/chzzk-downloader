//! OwnershipGate 활성(Phase 3b A5): resolve 판정, enqueue의 웹뷰 channelId 불신, `resume_job`의 컨텐츠 재판정·자동 이어받기의 같은 채널 규칙.

use std::path::{Path, PathBuf};
use std::time::Duration;

use chzzk_core::{ClientConfig, ContentRef, Endpoints, PlaybackKind, RetryPolicy, Secret};
use chzzk_shell::auth::{AuthPhase, AuthStatus, SessionStore, StoredSession, WorkerBase};
use chzzk_shell::dto::{
    ContentKindDto, EnqueueRequest, JobStatus, OnExisting, Ownership, SettingsPatch,
};
use chzzk_shell::jobs::{JobRecord, JobStore, JobsFile};
use chzzk_shell::services::AppPaths;
use chzzk_shell::{App, AuthSetup, ErrorCode, JobId};
use tempfile::TempDir;
use time::OffsetDateTime;
use url::Url;
use wiremock::matchers::{any, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const OWN: &str = "000000000000000000000000000000b2";
const OTHER: &str = "000000000000000000000000000000a1";
const VOD_NO: u64 = 9000002;
const VOD_VIDEO_ID: &str = "000000000000000000000000000000000B02";
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

/// info + MPD + 미디어 mock. `media_delay`가 있으면 미디어 응답을 그만큼 늦춘다.
async fn mock_api(media_delay: Option<Duration>) -> MockServer {
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
    let mut media = ResponseTemplate::new(200).set_body_bytes(vec![1u8; 50_000]);
    if let Some(d) = media_delay {
        media = media.set_delay(d);
    }
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(media)
        .mount(&server)
        .await;
    server
}

async fn hanging_server() -> MockServer {
    let s = MockServer::start().await;
    Mock::given(any())
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
        .mount(&s)
        .await;
    s
}

fn paths(root: &Path) -> AppPaths {
    AppPaths::new(
        root.join("config"),
        root.join("data"),
        root.join("log"),
        None,
        None,
        None,
    )
}

fn config(server: &MockServer) -> ClientConfig {
    let base = Url::parse(&server.uri()).unwrap();
    ClientConfig {
        endpoints: Endpoints {
            chzzk_api: base.clone(),
            vodplay_api: base,
        },
        retry: RetryPolicy {
            max_attempts: 1,
            base: Duration::from_millis(1),
            cap: Duration::from_millis(1),
            // 테스트는 연결 대기(인내)를 기다리지 않는다.
            patience: Duration::ZERO,
            patience_cap: Duration::ZERO,
        },
        ..ClientConfig::default()
    }
}

fn open_auth(root: &Path, api: &MockServer, worker: &MockServer) -> App {
    App::open_with_auth(
        paths(root),
        config(api),
        None,
        tokio::runtime::Handle::current(),
        AuthSetup::Enabled {
            base: WorkerBase::parse(&worker.uri()).unwrap(),
            app_version: "0.1.0".into(),
        },
    )
    .unwrap()
}

fn open_plain(root: &Path, api: &MockServer) -> App {
    App::open_with(
        paths(root),
        config(api),
        None,
        tokio::runtime::Handle::current(),
    )
    .unwrap()
}

fn save_session(root: &Path, worker: &MockServer, channel: &str) {
    std::fs::create_dir_all(root.join("config")).unwrap();
    let verified = OffsetDateTime::now_utc() - time::Duration::hours(1);
    SessionStore::new(
        root.join("config"),
        &WorkerBase::parse(&worker.uri()).unwrap(),
    )
    .save(&StoredSession {
        channel_id: channel.into(),
        channel_name: "채널".into(),
        is_admin: false,
        access_token: Secret::new(format!("cda_{}", "A".repeat(43))),
        access_expires_at: verified + time::Duration::hours(24),
        refresh_token: Secret::new(format!("cdr_{}", "B".repeat(43))),
        refresh_expires_at: verified + time::Duration::days(30),
        verified_at: verified,
    })
    .unwrap();
}

fn status(phase: AuthPhase, channel: Option<&str>) -> AuthStatus {
    AuthStatus {
        phase,
        reason: None,
        channel_id: channel.map(str::to_string),
        channel_name: None,
        is_admin: false,
        pending: None,
        offline: None,
        verified_at: None,
        has_session: false,
    }
}

fn url() -> String {
    format!("https://chzzk.naver.com/video/{VOD_NO}")
}

fn request(folder: &Path, name: &str, channel_id: Option<&str>) -> EnqueueRequest {
    EnqueueRequest {
        url: url(),
        content: ContentRef::Video { video_no: VOD_NO },
        title: format!("제목 {name}"),
        channel_name: "채널".into(),
        channel_id: channel_id.map(str::to_string),
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

fn record(id: u64, channel: Option<&str>, out: &Path) -> JobRecord {
    JobRecord {
        id: JobId(id),
        url: format!("https://chzzk.naver.com/video/{id}"),
        content: ContentRef::Video { video_no: id },
        title: "제목".into(),
        channel_name: "채널".into(),
        channel_id: channel.map(str::to_string),
        kind: ContentKindDto::Video,
        quality_id: QUALITY.into(),
        quality_label: "720p".into(),
        expected_kind: PlaybackKind::Progressive,
        output: out.join(format!("{id}.mp4")),
        on_existing: OnExisting::Overwrite,
        concurrency: 4,
        status: JobStatus::Interrupted,
        created_at: 1_759_650_000,
        finished_at: None,
        stopped_at: None,
        final_bytes: None,
        last_error: None,
        discard_on_start: false,
        partial_bytes: None,
        missing: false,
    }
}

fn write_jobs(root: &Path, jobs: Vec<JobRecord>) {
    let next_id = jobs.iter().map(|j| j.id.0).max().unwrap_or(0) + 1;
    JobStore::new(root.join("data"))
        .save(&JobsFile {
            v: chzzk_shell::jobs::JOBS_VERSION,
            next_id,
            jobs,
        })
        .unwrap();
}

fn status_of(app: &App, id: u64) -> JobStatus {
    app.manager
        .list()
        .into_iter()
        .find(|j| j.id == JobId(id))
        .unwrap()
        .status
}

async fn wait_for(app: &App, id: u64, want: JobStatus) {
    for _ in 0..500 {
        if status_of(app, id) == want {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("작업 {id}가 {want:?}가 되지 않음");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resolve_marks_ownership() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;

    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(app.resolve(&url()).await.unwrap().ownership, Ownership::Own);

    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OTHER);
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::NotOwn
    );

    let t = TempDir::new().unwrap();
    let app = open_plain(t.path(), &api);
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::Unchecked
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enqueue_ignores_channel_id_from_webview() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OTHER);
    let app = open_auth(t.path(), &api, &worker);
    app.resolve(&url()).await.unwrap();
    // 웹뷰가 로그인 채널로 속여 보내도 셸이 검증한 채널(b2)로 판정한다
    let e = app
        .enqueue(request(t.path(), "x", Some(OTHER)))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotOwnContent);
    assert!(app.manager.list().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enqueue_records_verified_channel() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);
    app.resolve(&url()).await.unwrap();
    let job = app
        .enqueue(request(t.path(), "x", Some("x")))
        .await
        .unwrap();
    assert_eq!(job.channel_id.as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enqueue_cache_miss_resolves_again() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);
    let job = app.enqueue(request(t.path(), "x", None)).await.unwrap();
    // 캐시도 요청 채널도 없는데 OWN이 기록됐으므로 채널은 다시 resolve에서 왔다.
    // info 요청 수는 다운로드 자신의 resolve도 세므로 증거로 쓰지 않는다
    assert_eq!(job.channel_id.as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enqueue_signed_out_is_not_logged_in_without_network() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let app = open_auth(t.path(), &api, &worker);
    let e = app
        .enqueue(request(t.path(), "x", Some(OWN)))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotLoggedIn);
    assert!(api.received_requests().await.unwrap().is_empty());
    assert!(worker.received_requests().await.unwrap().is_empty());
}

/// 픽스처 VOD(채널 b2 = OWN)를 받는 멈춘 작업. 기록의 채널 ID는 아무 값이나 넣을 수 있다(`jobs.json` 변조 흉내)
fn vod_record(id: u64, channel: Option<&str>, out: &Path) -> JobRecord {
    JobRecord {
        url: url(),
        content: ContentRef::Video { video_no: VOD_NO },
        ..record(id, channel, out)
    }
}

fn channel_of(app: &App, id: u64) -> Option<String> {
    app.manager
        .list()
        .into_iter()
        .find(|j| j.id == JobId(id))
        .unwrap()
        .channel_id
}

/// `resume_job`은 기록의 채널 ID를 믿지 않고 작업 컨텐츠를 다시 판정한다(A5 리뷰, worker.md 86)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_job_rejects_other_channel_content_whatever_the_record_says() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out: PathBuf = t.path().join("out");
    // 1: 남의 영상인데 기록을 로그인 채널로 고쳐 둠(변조), 2: 남의 영상이고 기록도 그 채널
    write_jobs(
        t.path(),
        vec![
            vod_record(1, Some(OTHER), &out),
            vod_record(2, Some(OWN), &out),
        ],
    );
    save_session(t.path(), &worker, OTHER);
    let app = open_auth(t.path(), &api, &worker);
    for id in [1, 2] {
        assert_eq!(
            app.resume_job(JobId(id), false).await.unwrap_err().code,
            ErrorCode::NotOwnContent
        );
        assert_eq!(status_of(&app, id), JobStatus::Interrupted);
    }
    // 거부한 뒤 기록은 판정한 실제 채널(b2)로 고쳐진다: 화면이 막힌 작업으로 보이고 B1이 다시 세지 않는다
    assert_eq!(channel_of(&app, 1).as_deref(), Some(OWN));
    assert_eq!(channel_of(&app, 2).as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 채널 ID가 없거나 틀린 기록이라도 본인 영상이면 이어받고, 검증한 채널 ID로 기록을 고친다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_job_admits_own_content_and_rewrites_channel() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out: PathBuf = t.path().join("out");
    write_jobs(
        t.path(),
        vec![vod_record(1, None, &out), vod_record(2, Some(OTHER), &out)],
    );
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);
    for id in [1, 2] {
        app.resume_job(JobId(id), false).await.unwrap();
        assert_ne!(status_of(&app, id), JobStatus::Interrupted);
        assert_eq!(channel_of(&app, id).as_deref(), Some(OWN));
    }
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 로그인하지 않았으면 판정 조회 없이 `notLoggedIn`, 다시 줄 세울 상태가 아니면 조회하지 않는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_job_signed_out_or_not_requeueable_makes_no_request() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out: PathBuf = t.path().join("out");
    let mut done = vod_record(2, Some(OWN), &out);
    done.status = JobStatus::Completed;
    write_jobs(t.path(), vec![vod_record(1, Some(OWN), &out), done]);
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(
        app.resume_job(JobId(1), false).await.unwrap_err().code,
        ErrorCode::NotLoggedIn
    );
    assert_eq!(
        app.resume_job(JobId(2), false).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert!(api.received_requests().await.unwrap().is_empty());
    assert_eq!(status_of(&app, 1), JobStatus::Interrupted);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_job_passes_when_auth_disabled() {
    let api = hanging_server().await;
    let t = TempDir::new().unwrap();
    write_jobs(
        t.path(),
        vec![record(1, Some(OTHER), &t.path().join("out"))],
    );
    let app = open_plain(t.path(), &api);
    app.resume_job(JobId(1), false).await.unwrap();
    assert_ne!(status_of(&app, 1), JobStatus::Interrupted);
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 요청 주소와 컨텐츠가 다른 영상이면 판정·조회 전에 `invalidInput`(A5 리뷰)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn enqueue_rejects_url_content_mismatch() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);
    let mut req = request(t.path(), "x", None);
    req.url = "https://chzzk.naver.com/video/1".into();
    assert_eq!(
        app.enqueue(req).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    let mut req = request(t.path(), "x", None);
    req.url = "not a url".into();
    assert_eq!(
        app.enqueue(req).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert!(app.manager.list().is_empty());
    assert!(api.received_requests().await.unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auto_resume_only_same_channel() {
    let api = hanging_server().await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    write_jobs(
        t.path(),
        vec![record(1, Some(OTHER), &out), record(2, Some(OWN), &out)],
    );
    {
        // 열 때는 자동 이어받기가 아직 꺼져 있어 작업이 시작하지 않는다
        let app = open_plain(t.path(), &api);
        app.update_settings(SettingsPatch {
            auto_resume_interrupted: Some(true),
            ..SettingsPatch::default()
        })
        .unwrap();
        app.manager.flush();
    }
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);
    let st = app.auth.as_ref().unwrap().status();
    assert_eq!(app.on_auth_status(&st), 1);
    assert_ne!(status_of(&app, 2), JobStatus::Interrupted);
    assert_eq!(status_of(&app, 1), JobStatus::Interrupted);
    assert_eq!(app.on_auth_status(&st), 0);
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn auto_resume_waits_for_channel() {
    let api = hanging_server().await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    write_jobs(t.path(), vec![record(1, Some(OWN), &t.path().join("out"))]);
    {
        let app = open_plain(t.path(), &api);
        app.update_settings(SettingsPatch {
            auto_resume_interrupted: Some(true),
            ..SettingsPatch::default()
        })
        .unwrap();
        app.manager.flush();
    }
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(app.on_auth_status(&status(AuthPhase::SignedIn, None)), 0);
    assert_eq!(status_of(&app, 1), JobStatus::Interrupted);
    assert_eq!(
        app.on_auth_status(&status(AuthPhase::SignedIn, Some(OWN))),
        1
    );
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn logout_keeps_running_job() {
    let api = mock_api(Some(Duration::from_secs(60))).await;
    let worker = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/auth/logout"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&worker)
        .await;
    let t = TempDir::new().unwrap();
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);
    app.resolve(&url()).await.unwrap();
    let job = app.enqueue(request(t.path(), "x", None)).await.unwrap();
    wait_for(&app, job.id.0, JobStatus::Running).await;

    app.auth_logout().await.unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(status_of(&app, job.id.0), JobStatus::Running);
    assert_eq!(
        app.gate_command("resume_job").unwrap_err().code,
        ErrorCode::NotLoggedIn
    );
    app.manager.quit(Duration::from_secs(3)).await;
}
