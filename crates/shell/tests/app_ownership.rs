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

mod common;

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
    mock_api_with(media_delay, false).await
}

/// 컨텐츠 채널 ID가 없는 info 응답(`channelless`)까지 고르는 mock
async fn mock_api_with(media_delay: Option<Duration>, channelless: bool) -> MockServer {
    let server = MockServer::start().await;
    let info = if channelless {
        let mut v: serde_json::Value =
            serde_json::from_slice(&fixture("testdata/vod/video_info.json")).unwrap();
        v["content"]["channel"]
            .as_object_mut()
            .unwrap()
            .remove("channelId");
        serde_json::to_vec(&v).unwrap()
    } else {
        fixture("testdata/vod/video_info.json")
    };
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(ResponseTemplate::new(200).set_body_raw(info, "application/json"))
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
    // 방송이 끝난 live-detail(내 채널). 생방송 마무리 길이 이 조회를 하는지 요청 수로 본다
    Mock::given(method("GET"))
        .and(path(format!("/service/v3/channels/{OWN}/live-detail")))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            fixture("testdata/live/live_detail_closed.json"),
            "application/json",
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
    save_session_as(root, worker, channel, false);
}

fn save_session_as(root: &Path, worker: &MockServer, channel: &str, is_admin: bool) {
    save_session_full(root, worker, channel, is_admin, &[]);
}

/// 디스크 세션에 맡은 채널 목록(이름 "맡은채널")까지 적는다
fn save_session_full(
    root: &Path,
    worker: &MockServer,
    channel: &str,
    is_admin: bool,
    delegated: &[&str],
) {
    std::fs::create_dir_all(root.join("config")).unwrap();
    let verified = OffsetDateTime::now_utc() - time::Duration::hours(1);
    SessionStore::new(
        root.join("config"),
        &WorkerBase::parse(&worker.uri()).unwrap(),
    )
    .save(&StoredSession {
        channel_id: channel.into(),
        channel_name: "채널".into(),
        is_admin,
        access_token: Secret::new(format!("cda_{}", "A".repeat(43))),
        access_expires_at: verified + time::Duration::hours(24),
        refresh_token: Secret::new(format!("cdr_{}", "B".repeat(43))),
        refresh_expires_at: verified + time::Duration::days(30),
        verified_at: verified,
        delegated_channels: delegated
            .iter()
            .map(|id| chzzk_shell::auth::DelegatedChannel {
                channel_id: id.to_string(),
                channel_name: "맡은채널".into(),
            })
            .collect(),
    })
    .unwrap();
}

/// Worker의 refresh 응답(묶음)을 이 실행에서 받은 것으로 만든다. 디스크의 isAdmin은 이게 있어야 권한이 된다
async fn refresh_as(app: &App, worker: &MockServer, channel: &str, is_admin: bool) {
    use time::format_description::well_known::Rfc3339;
    let now = OffsetDateTime::now_utc();
    worker.reset().await;
    Mock::given(method("POST"))
        .and(path("/auth/refresh"))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(
                serde_json::json!({
                    "status": "ok",
                    "accessToken": format!("cda_{}", "C".repeat(43)),
                    "accessExpiresAt": (now + time::Duration::hours(24)).format(&Rfc3339).unwrap(),
                    "refreshToken": format!("cdr_{}", "D".repeat(43)),
                    "refreshExpiresAt": (now + time::Duration::days(30)).format(&Rfc3339).unwrap(),
                    "channelId": channel,
                    "channelName": "채널",
                    "isAdmin": is_admin,
                    "serverTime": now.format(&Rfc3339).unwrap(),
                })
                .to_string(),
                "application/json",
            ),
        )
        .mount(worker)
        .await;
    let st = app.auth.as_ref().unwrap().refresh().await;
    assert_eq!((st.phase, st.is_admin), (AuthPhase::SignedIn, is_admin));
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
        delegated_channels: vec![],
        delegations_verified: false,
        delegations_checked_at: None,
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
        range: None,
        save_chat: false,
    }
}

fn record(id: u64, channel: Option<&str>, out: &Path) -> JobRecord {
    JobRecord {
        embed_metadata: true,
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
        recording_id: None,
        output: out.join(format!("{id}.mp4")),
        on_existing: OnExisting::Overwrite,
        concurrency: 4,
        status: JobStatus::Interrupted,
        created_at: 1_759_650_000,
        finished_at: None,
        stopped_at: None,
        range: None,
        final_bytes: None,
        last_error: None,
        discard_on_start: false,
        output_replaced: false,
        partial_bytes: None,
        missing: false,
        live_end: None,
        chat: None,
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
        embed_metadata: true,
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

/// 관리자는 남의 영상도 받는다(worker.md 구현 중 변경 102): resolve는 adminOverride, enqueue·resume_job은 허용하고
/// 기록에는 실제 컨텐츠 채널(b2)이 남는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admin_receives_other_channel_content() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out: PathBuf = t.path().join("out");
    write_jobs(t.path(), vec![vod_record(1, Some(OWN), &out)]);
    save_session_as(t.path(), &worker, OTHER, true);
    let app = open_auth(t.path(), &api, &worker);
    refresh_as(&app, &worker, OTHER, true).await;
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::AdminOverride
    );
    let job = app
        .enqueue(request(t.path(), "x", Some(OTHER)))
        .await
        .unwrap();
    assert_eq!(job.channel_id.as_deref(), Some(OWN));
    app.resume_job(JobId(1), false).await.unwrap();
    assert_ne!(status_of(&app, 1), JobStatus::Interrupted);
    assert_eq!(channel_of(&app, 1).as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 관리자의 자동 이어받기는 채널과 상관없이 멈춘 작업을 모두 줄 세운다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admin_auto_resume_takes_every_channel() {
    let api = hanging_server().await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    write_jobs(
        t.path(),
        vec![
            record(1, Some(OTHER), &out),
            record(2, Some(OWN), &out),
            record(3, None, &out),
        ],
    );
    {
        let app = open_plain(t.path(), &api);
        app.update_settings(SettingsPatch {
            auto_resume_interrupted: Some(true),
            ..SettingsPatch::default()
        })
        .unwrap();
        app.manager.flush();
    }
    save_session_as(t.path(), &worker, OTHER, true);
    let app = open_auth(t.path(), &api, &worker);
    refresh_as(&app, &worker, OTHER, true).await;
    let st = app.auth.as_ref().unwrap().status();
    assert!(st.is_admin);
    assert_eq!(app.on_auth_status(&st), 3);
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 관리자 깃발만으로는 이어받지 않는다: SignedIn이 아니거나 채널을 모르면 0이고, 이어받은 뒤 두 번째 호출도 0이다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admin_auto_resume_needs_signed_in_channel_and_runs_once() {
    let api = hanging_server().await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    write_jobs(
        t.path(),
        vec![record(1, Some(OTHER), &t.path().join("out"))],
    );
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
    let admin = |phase, channel| {
        let mut st = status(phase, channel);
        st.is_admin = true;
        st
    };
    for phase in [
        AuthPhase::Checking,
        AuthPhase::Expired,
        AuthPhase::Denied,
        AuthPhase::SignedOut,
    ] {
        assert_eq!(app.on_auth_status(&admin(phase, Some(OWN))), 0);
    }
    assert_eq!(app.on_auth_status(&admin(AuthPhase::SignedIn, None)), 0);
    assert_eq!(status_of(&app, 1), JobStatus::Interrupted);
    assert_eq!(
        app.on_auth_status(&admin(AuthPhase::SignedIn, Some(OWN))),
        1
    );
    assert_eq!(
        app.on_auth_status(&admin(AuthPhase::SignedIn, Some(OWN))),
        0
    );
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 관리자라도 다시 줄 세울 수 없는 상태(완료)의 resume_job은 기존 규칙대로 InvalidInput이고 조회하지 않는다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admin_resume_job_keeps_requeueable_rule() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out: PathBuf = t.path().join("out");
    let mut done = vod_record(1, Some(OTHER), &out);
    done.status = JobStatus::Completed;
    write_jobs(t.path(), vec![done]);
    save_session_as(t.path(), &worker, OWN, true);
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(
        app.resume_job(JobId(1), false).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert!(api.received_requests().await.unwrap().is_empty());
    assert_eq!(status_of(&app, 1), JobStatus::Completed);
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

/// 관리자 + 채널 ID가 없는 컨텐츠: 웹뷰가 보낸 channel_id가 기록에 남으면 안 된다(Codex 리뷰). enqueue·resume_job 모두
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admin_channelless_content_never_keeps_webview_channel() {
    let api = mock_api_with(None, true).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out: PathBuf = t.path().join("out");
    // 기록에는 남의 채널이 적혀 있다(변조 흉내)
    write_jobs(t.path(), vec![vod_record(1, Some(OTHER), &out)]);
    save_session_as(t.path(), &worker, OTHER, true);
    let app = open_auth(t.path(), &api, &worker);
    refresh_as(&app, &worker, OTHER, true).await;
    let r = app.resolve(&url()).await.unwrap();
    assert_eq!(r.ownership, Ownership::AdminOverride);
    let job = app
        .enqueue(request(
            t.path(),
            "x",
            Some("000000000000000000000000000000c3"),
        ))
        .await
        .unwrap();
    assert_eq!(job.channel_id, None);
    assert_eq!(channel_of(&app, job.id.0), None);
    app.resume_job(JobId(1), false).await.unwrap();
    assert_eq!(channel_of(&app, 1), None);
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 디스크의 관리자 세션은 이번 실행에서 서버가 확인하기 전에는 일반 사용자와 같다: 남의 영상은 거부한다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn disk_admin_session_is_a_normal_user_until_refresh_confirms() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out: PathBuf = t.path().join("out");
    write_jobs(t.path(), vec![vod_record(1, Some(OTHER), &out)]);
    // 로그인 채널은 a1, 영상은 b2: 남의 영상
    save_session_as(t.path(), &worker, OTHER, true);
    let app = open_auth(t.path(), &api, &worker);
    assert!(!app.auth.as_ref().unwrap().status().is_admin);
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::NotOwn
    );
    let e = app
        .enqueue(request(t.path(), "x", Some(OWN)))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotOwnContent);
    let e = app.resume_job(JobId(1), false).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::NotOwnContent);

    // 서버가 관리자로 확인하면 허용된다
    refresh_as(&app, &worker, OTHER, true).await;
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::AdminOverride
    );
    app.enqueue(request(t.path(), "x", Some(OWN)))
        .await
        .unwrap();

    // 강등된 묶음이 오면 다음 판정부터 거부한다
    refresh_as(&app, &worker, OTHER, false).await;
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::NotOwn
    );
    let e = app
        .enqueue(request(t.path(), "y", Some(OWN)))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotOwnContent);
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 서버 확인 전의 관리자 세션이 첫 SignedIn에서 깃발을 쓰면 본인 채널의 멈춘 작업만 이어받는다(남은 것은 손으로)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unverified_admin_first_signed_in_auto_resumes_own_channel_only() {
    let api = hanging_server().await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    write_jobs(
        t.path(),
        vec![record(1, Some(OWN), &out), record(2, Some(OTHER), &out)],
    );
    {
        let app = open_plain(t.path(), &api);
        app.update_settings(SettingsPatch {
            auto_resume_interrupted: Some(true),
            ..SettingsPatch::default()
        })
        .unwrap();
        app.manager.flush();
    }
    save_session_as(t.path(), &worker, OWN, true);
    let app = open_auth(t.path(), &api, &worker);
    let st = app.auth.as_ref().unwrap().status();
    assert!(!st.is_admin);
    assert_eq!(app.on_auth_status(&st), 1);
    assert_eq!(status_of(&app, 2), JobStatus::Interrupted);
    app.manager.quit(Duration::from_secs(3)).await;
}

// ---------------------------------------------------------------------------
// 맡은 채널(편집자 위임 ①-4, app.md 구현 중 변경 79)
// ---------------------------------------------------------------------------

/// 나(편집자). 영상 채널은 fixture의 `OWN`(b2)이고 이 채널을 맡은 채널로 쓴다
const EDITOR: &str = "000000000000000000000000000000c3";

/// `GET /api/me`를 목으로 건다. 200이 아니면 `{code}` 본문
async fn mock_me(worker: &MockServer, channel: &str, delegated: &[&str], status: u16) {
    worker.reset().await;
    let body = if status == 200 {
        serde_json::json!({
            "channelId": channel,
            "channelName": "채널",
            "accessExpiresAt": "2030-01-02T00:00:00.000Z",
            "serverTime": "2030-01-01T00:00:00.000Z",
            "delegatedChannels": delegated
                .iter()
                .map(|id| serde_json::json!({
                    "channelId": id, "channelName": "맡은채널", "since": "2030-01-01T00:00:00.000Z"
                }))
                .collect::<Vec<_>>(),
            "editors": [],
            "pendingInviteUntil": null,
            "limits": {"editors": 10, "delegations": 20},
        })
    } else {
        let code = match status {
            401 => "invalid_token",
            403 => "not_allowed",
            _ => "internal",
        };
        serde_json::json!({ "code": code })
    };
    Mock::given(method("GET"))
        .and(path("/api/me"))
        .respond_with(
            ResponseTemplate::new(status).set_body_raw(body.to_string(), "application/json"),
        )
        .mount(worker)
        .await;
}

async fn me_requests(worker: &MockServer) -> usize {
    worker
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path() == "/api/me")
        .count()
}

fn file_delegated(root: &Path) -> serde_json::Value {
    let b = std::fs::read(root.join("config/session.json")).unwrap();
    serde_json::from_slice::<serde_json::Value>(&b).unwrap()["delegatedChannels"].clone()
}

/// 재시작 후 자동 이어받기를 켜 두고 앱을 닫는다(다음 `open_auth`가 깃발을 들고 시작한다)
fn enable_auto_resume(root: &Path, api: &MockServer) {
    let app = open_plain(root, api);
    app.update_settings(SettingsPatch {
        auto_resume_interrupted: Some(true),
        ..SettingsPatch::default()
    })
    .unwrap();
    app.manager.flush();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a1_resolve_delegated_video() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::Delegated
    );
    assert_eq!(me_requests(&worker).await, 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a2_resolve_reflects_revocation_at_first_judgement() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    // 앱을 켠 뒤 첫 판정은 간격과 무관하게 확인한다: 디스크에만 남은 회수를 잡는다
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::NotOwn
    );
    assert_eq!(file_delegated(t.path()), serde_json::json!([]));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a3_enqueue_delegated_records_owner() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    app.resolve(&url()).await.unwrap();
    let job = app
        .enqueue(request(t.path(), "x", Some(EDITOR)))
        .await
        .unwrap();
    assert_eq!(job.channel_id.as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 받는 중 /api/me가 403 not_allowed를 주면 새 작업은 모두 막히지만 받는 중인 작업은 끝까지 간다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a4_me_not_allowed_blocks_new_jobs_keeps_running() {
    let api = mock_api(Some(Duration::from_millis(1500))).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    let job = app
        .enqueue(request(t.path(), "slow", Some(EDITOR)))
        .await
        .unwrap();
    assert_eq!(job.channel_id.as_deref(), Some(OWN));
    mock_me(&worker, EDITOR, &[OWN], 403).await;
    let e = app.ownership_recheck(&url()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::NotLoggedIn);
    assert_eq!(app.auth.as_ref().unwrap().status().phase, AuthPhase::Denied);
    let e = app
        .enqueue(request(t.path(), "second", Some(EDITOR)))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotLoggedIn);
    wait_for(&app, job.id.0, JobStatus::Completed).await;
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 거부 뒤에는 본인 채널 영상의 새 작업도 notLoggedIn이다(delegation.md §14 N1 ①). 로그인 채널 = 영상 채널(OWN)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a4b_denial_blocks_own_channel_too() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, OWN, false, &[]);
    mock_me(&worker, OWN, &[], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(app.resolve(&url()).await.unwrap().ownership, Ownership::Own);
    mock_me(&worker, OWN, &[], 403).await;
    let e = app.ownership_recheck(&url()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::NotLoggedIn);
    assert_eq!(app.auth.as_ref().unwrap().status().phase, AuthPhase::Denied);
    let e = app
        .enqueue(request(t.path(), "own", Some(OWN)))
        .await
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::NotLoggedIn);
    app.manager.quit(Duration::from_secs(3)).await;
}

/// resolve의 판정 직전 확인이 명시적 거부(403 not_allowed)를 받으면 받기 가능 카드(`unchecked`) 대신 notLoggedIn이다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a4c_resolve_denied_during_recheck_is_not_logged_in() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 403).await;
    let app = open_auth(t.path(), &api, &worker);
    let e = app.resolve(&url()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::NotLoggedIn);
    assert_eq!(app.auth.as_ref().unwrap().status().phase, AuthPhase::Denied);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a5_ownership_recheck_ignores_gap() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(
        app.ownership_recheck(&url()).await.unwrap().ownership,
        Ownership::Delegated
    );
    assert_eq!(
        app.ownership_recheck(&url()).await.unwrap().ownership,
        Ownership::Delegated
    );
    // 안의 resolve는 방금 찍힌 간격 규칙으로 건너뛰므로 수동 확인 둘만 센다
    assert_eq!(me_requests(&worker).await, 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a6_ownership_recheck_unreachable_does_not_resolve() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 503).await;
    let app = open_auth(t.path(), &api, &worker);
    let e = app.ownership_recheck(&url()).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Network);
    assert!(api.received_requests().await.unwrap().is_empty());
    assert_eq!(
        app.auth.as_ref().unwrap().status().phase,
        AuthPhase::SignedIn
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a7_resume_delegated_interrupted_job() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out: PathBuf = t.path().join("out");
    write_jobs(t.path(), vec![vod_record(1, Some(OWN), &out)]);
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    app.resume_job(JobId(1), false).await.unwrap();
    assert_ne!(status_of(&app, 1), JobStatus::Interrupted);
    assert_eq!(channel_of(&app, 1).as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

fn delegated_status(verified: bool, delegated: &[&str]) -> AuthStatus {
    let mut st = status(AuthPhase::SignedIn, Some(EDITOR));
    st.delegations_verified = verified;
    st.delegated_channels = delegated
        .iter()
        .map(|id| chzzk_shell::auth::DelegatedChannel {
            channel_id: id.to_string(),
            channel_name: "맡은채널".into(),
        })
        .collect();
    st
}

/// 본인(c3) 작업 1과 맡은 채널(b2) 작업 2(실제 컨텐츠도 b2)가 멈춰 있고 자동 이어받기가 켜진 앱.
/// 디스크 세션은 편집자(c3)이고 맡은 채널은 b2, /api/me도 같은 목록을 준다
async fn delegated_flag_app(t: &TempDir, api: &MockServer, worker: &MockServer) -> App {
    let out = t.path().join("out");
    write_jobs(
        t.path(),
        vec![
            record(1, Some(EDITOR), &out),
            vod_record(2, Some(OWN), &out),
        ],
    );
    enable_auto_resume(t.path(), api);
    save_session_full(t.path(), worker, EDITOR, false, &[OWN]);
    mock_me(worker, EDITOR, &[OWN], 200).await;
    open_auth(t.path(), api, worker)
}

/// 둘째 깃발: 서버 확인 전에는 본인 작업만(동기), 확인 뒤 한 번 맡은 채널 작업을 컨텐츠 재판정을 거쳐 줄 세운다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a8_delegated_flag_waits_for_server() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let app = delegated_flag_app(&t, &api, &worker).await;
    // 서버 확인 전: 본인 작업만 줄 세우고 둘째 깃발은 쓰지 않는다
    let st = delegated_status(false, &[OWN]);
    assert_eq!(app.on_auth_status(&st), 1);
    assert!(!app.take_delegated_resume(&st));
    assert_ne!(status_of(&app, 1), JobStatus::Interrupted);
    assert_eq!(status_of(&app, 2), JobStatus::Interrupted);
    // 서버가 확인한 뒤 맡은 채널 작업을 줄 세운다
    let st = delegated_status(true, &[OWN]);
    assert_eq!(app.on_auth_status(&st), 0);
    assert!(app.take_delegated_resume(&st));
    assert_eq!(
        app.resume_delegated_interrupted(&st.delegated_channels)
            .await,
        1
    );
    assert_ne!(status_of(&app, 2), JobStatus::Interrupted);
    // 한 번뿐
    assert!(!app.take_delegated_resume(&st));
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a9_delegated_flag_skips_when_list_dropped() {
    let api = hanging_server().await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let app = delegated_flag_app(&t, &api, &worker).await;
    let st = delegated_status(true, &[]);
    assert_eq!(app.on_auth_status(&st), 1);
    assert!(app.take_delegated_resume(&st));
    assert_eq!(
        app.resume_delegated_interrupted(&st.delegated_channels)
            .await,
        0
    );
    assert_eq!(status_of(&app, 2), JobStatus::Interrupted);
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a10_delegated_flag_never_without_verification() {
    let api = hanging_server().await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let app = delegated_flag_app(&t, &api, &worker).await;
    // 첫 호출은 본인 작업 하나, 그 뒤로는 서버 확인이 없으면 늘 0이고 둘째 깃발도 쓰지 않는다
    let st = delegated_status(false, &[OWN]);
    assert_eq!(app.on_auth_status(&st), 1);
    for _ in 0..3 {
        assert_eq!(app.on_auth_status(&st), 0);
        assert!(!app.take_delegated_resume(&st));
    }
    assert_eq!(status_of(&app, 2), JobStatus::Interrupted);
    app.manager.quit(Duration::from_secs(3)).await;
}

/// Codex 재현(PR 리뷰 P2 4): 기록의 channelId만 맡은 채널(a1)로 바꾼 남의(b2) 영상은 자동 이어받기가 줄 세우지 않는다.
/// 컨텐츠를 다시 판정해 NotOwn이면 그대로 두고 기록을 실제 채널로 고친다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a17_delegated_auto_resume_rejudges_content() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    write_jobs(t.path(), vec![vod_record(2, Some(OTHER), &out)]);
    enable_auto_resume(t.path(), &api);
    save_session_full(t.path(), &worker, EDITOR, false, &[OTHER]);
    mock_me(&worker, EDITOR, &[OTHER], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    let st = delegated_status(true, &[OTHER]);
    assert_eq!(app.on_auth_status(&st), 0);
    assert!(app.take_delegated_resume(&st));
    assert_eq!(
        app.resume_delegated_interrupted(&st.delegated_channels)
            .await,
        0
    );
    assert_eq!(status_of(&app, 2), JobStatus::Interrupted);
    assert_eq!(channel_of(&app, 2).as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 컨텐츠 채널을 확인하지 못하면(채널 ID 없는 info) 줄 세우지 않는다(fail closed)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a18_delegated_auto_resume_fails_closed() {
    let api = mock_api_with(None, true).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    write_jobs(t.path(), vec![vod_record(2, Some(OWN), &out)]);
    enable_auto_resume(t.path(), &api);
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    let st = delegated_status(true, &[OWN]);
    assert!(app.take_delegated_resume(&st));
    assert_eq!(
        app.resume_delegated_interrupted(&st.delegated_channels)
            .await,
        0
    );
    assert_eq!(status_of(&app, 2), JobStatus::Interrupted);
    app.manager.quit(Duration::from_secs(3)).await;
}

#[test]
fn a11_delegated_resume_target_table() {
    use chzzk_shell::app::delegated_resume_target;
    use chzzk_shell::auth::DelegatedChannel;
    let list = vec![DelegatedChannel {
        channel_id: OWN.into(),
        channel_name: "맡은채널".into(),
    }];
    let video = ContentRef::Video { video_no: 1 };
    let clip = ContentRef::Clip {
        clip_id: "c".into(),
    };
    let live = ContentRef::Live {
        channel_id: OWN.into(),
    };
    assert!(delegated_resume_target(&video, Some(OWN), &list));
    assert!(delegated_resume_target(&clip, Some(OWN), &list));
    assert!(!delegated_resume_target(&live, Some(OWN), &list));
    assert!(!delegated_resume_target(&video, Some(OTHER), &list));
    assert!(!delegated_resume_target(&video, None, &list));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a12_editors_commands_without_auth() {
    let api = mock_api(None).await;
    let t = TempDir::new().unwrap();
    let app = open_plain(t.path(), &api);
    assert_eq!(
        app.editors_list().await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        app.editors_invite().await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        app.editors_remove(OWN).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        app.delegations_leave(OWN).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        app.ownership_recheck(&url()).await.unwrap().ownership,
        Ownership::Unchecked
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a13_editors_remove_rejects_bad_id() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    let app = open_auth(t.path(), &api, &worker);
    for bad in ["ABC", &OWN.to_uppercase(), ""] {
        assert_eq!(
            app.editors_remove(bad).await.unwrap_err().code,
            ErrorCode::InvalidInput
        );
        assert_eq!(
            app.delegations_leave(bad).await.unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }
    assert!(worker.received_requests().await.unwrap().is_empty());
}

/// 로그인 서버가 아직 이 기능을 열지 않았으면(404 not_enabled) 닿지 않은 것도 차단도 아닌 `unsupported`다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a14_not_enabled_is_unsupported_not_a_block() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    Mock::given(method("POST"))
        .and(path("/api/editors/invite"))
        .respond_with(
            ResponseTemplate::new(404)
                .set_body_raw(r#"{"code":"not_enabled"}"#, "application/json"),
        )
        .mount(&worker)
        .await;
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(
        app.editors_invite().await.unwrap_err().code,
        ErrorCode::Unsupported
    );
    assert_eq!(
        app.auth.as_ref().unwrap().status().phase,
        AuthPhase::SignedIn
    );
}

/// 편집자 목록: DTO로 옮겨진다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a15_editors_list_maps_me() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    let dto = app.editors_list().await.unwrap();
    assert_eq!(dto.delegated_channels.len(), 1);
    assert_eq!(dto.delegated_channels[0].channel_id, OWN);
    assert!(dto.delegated_channels[0].since.is_some());
    assert_eq!((dto.editors_max, dto.delegations_max), (10, 20));
    // 상태 DTO에도 반영된다
    let st = app.auth_status();
    assert_eq!(st.delegated_channels.len(), 1);
    assert!(st.delegations_checked_at.is_some());
}

/// 그만두기 성공(204·확인된 멱등 404 not_found) 직후 그 채널 영상은 resolve·enqueue 모두 NotOwn이다(PR 리뷰 P2).
/// 204에서는 /api/me가 아직 그 채널을 주지만 간격 안이라 다시 묻지 않는다: 막은 것은 로컬 회수다.
/// 404는 같은 세션의 /api/me 한 번으로 그 채널이 없음을 확인한 뒤에만 성공이다(79 (하))
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a16_leave_success_revokes_locally_at_once() {
    for (status, body) in [(204, ""), (404, r#"{"code":"not_found"}"#)] {
        let api = mock_api(None).await;
        let worker = MockServer::start().await;
        let t = TempDir::new().unwrap();
        save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
        mock_me(&worker, EDITOR, &[OWN], 200).await;
        let app = open_auth(t.path(), &api, &worker);
        assert_eq!(
            app.resolve(&url()).await.unwrap().ownership,
            Ownership::Delegated
        );
        assert_eq!(me_requests(&worker).await, 1);
        if status == 404 {
            // 서버에서는 이미 없다(다른 기기에서 그만뒀다). mock_me는 받은 요청도 비운다
            mock_me(&worker, EDITOR, &[], 200).await;
        }
        Mock::given(method("POST"))
            .and(path("/api/delegations/leave"))
            .respond_with(ResponseTemplate::new(status).set_body_raw(body, "application/json"))
            .mount(&worker)
            .await;
        app.delegations_leave(OWN).await.unwrap();
        assert_eq!(
            app.resolve(&url()).await.unwrap().ownership,
            Ownership::NotOwn,
            "{status}"
        );
        let e = app
            .enqueue(request(t.path(), "x", Some(OWN)))
            .await
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::NotOwnContent, "{status}");
        assert_eq!(me_requests(&worker).await, 1, "{status}");
        assert_eq!(file_delegated(t.path()), serde_json::json!([]));
        assert!(app.auth_status().delegated_channels.is_empty());
    }
}

/// 그만두기 경로가 없는 Worker(①-2만): 경로 표 밖 404 `not_found`를 받고 /api/me가 그 채널을 아직 주면
/// 거짓 성공이 아니라 `unsupported`이고, 맡은 채널은 그대로 Delegated다(Codex 확인 2)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a16b_leave_on_worker_without_route_is_unsupported() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    Mock::given(method("POST"))
        .and(path("/api/delegations/leave"))
        .respond_with(
            ResponseTemplate::new(404).set_body_raw(r#"{"code":"not_found"}"#, "application/json"),
        )
        .mount(&worker)
        .await;
    let app = open_auth(t.path(), &api, &worker);
    let e = app.delegations_leave(OWN).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::Unsupported);
    assert_eq!(
        app.resolve(&url()).await.unwrap().ownership,
        Ownership::Delegated
    );
    assert_eq!(file_delegated(t.path()).as_array().unwrap().len(), 1);
}

// ---------------------------------------------------------------------------
// 채팅만 받기(`fetch_chat`, chat.md §4.5): `resume_job`과 같은 판정 순서
// ---------------------------------------------------------------------------

/// 완료된 VOD 작업(영상 파일 있음).
fn done_vod(root: &Path, id: u64, channel: Option<&str>) -> JobRecord {
    let out = root.join("out");
    let mut r = vod_record(id, channel, &out);
    r.status = JobStatus::Completed;
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(&r.output, b"mp4").unwrap();
    r
}

fn chat_of(app: &App, id: u64) -> Option<chzzk_shell::chat::ChatStateDto> {
    app.manager
        .list()
        .into_iter()
        .find(|j| j.id == JobId(id))
        .unwrap()
        .chat
}

/// 기록의 채널을 무엇으로 바꿔 두어도 판정은 작업 컨텐츠로 한다. 거부되면 채팅 상태는 그대로이고 기록 채널만 실제 채널로 고친다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetch_chat_judges_content_not_record() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    write_jobs(t.path(), vec![done_vod(t.path(), 1, Some(OTHER))]);
    save_session(t.path(), &worker, OTHER);
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(
        app.fetch_chat(JobId(1), false, OnExisting::Skip)
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotOwnContent
    );
    assert_eq!(chat_of(&app, 1), None);
    assert_eq!(channel_of(&app, 1).as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 본인 영상이면 채팅을 줄 세우고 검증한 채널로 기록을 고친다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetch_chat_admits_own_content() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    write_jobs(t.path(), vec![done_vod(t.path(), 1, None)]);
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);
    app.fetch_chat(JobId(1), false, OnExisting::Skip)
        .await
        .unwrap();
    assert!(chat_of(&app, 1).is_some());
    assert_eq!(channel_of(&app, 1).as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 로그인하지 않았으면 조회 없이 `notLoggedIn`, 완료가 아니면 판정 전에 `invalidInput`(조회 없음).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetch_chat_signed_out_or_not_completed_makes_no_request() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    write_jobs(
        t.path(),
        vec![
            done_vod(t.path(), 1, Some(OWN)),
            vod_record(2, Some(OWN), &out),
        ],
    );
    let app = open_auth(t.path(), &api, &worker);
    assert_eq!(
        app.fetch_chat(JobId(1), false, OnExisting::Skip)
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotLoggedIn
    );
    assert_eq!(
        app.fetch_chat(JobId(2), false, OnExisting::Skip)
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    assert!(api.received_requests().await.unwrap().is_empty());
    assert_eq!(chat_of(&app, 1), None);
}

/// 로그인을 쓰지 않는 빌드는 판정 없이 받는다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetch_chat_passes_when_auth_disabled() {
    let api = hanging_server().await;
    let t = TempDir::new().unwrap();
    let mut r = done_vod(t.path(), 1, Some(OTHER));
    r.content = ContentRef::Video { video_no: 1 };
    write_jobs(t.path(), vec![r]);
    let app = open_plain(t.path(), &api);
    app.fetch_chat(JobId(1), false, OnExisting::Skip)
        .await
        .unwrap();
    assert!(chat_of(&app, 1).is_some());
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 영상은 완료, 채팅은 끊긴(`interrupted`) 맡은 채널(b2) 작업 2. 기록의 채널은 `channel`이다.
fn delegated_chat_record(root: &Path, channel: &str) -> JobRecord {
    let mut r = done_vod(root, 2, Some(channel));
    r.chat = Some(chzzk_shell::chat::ChatState {
        phase: chzzk_shell::chat::ChatPhase::Interrupted,
        ..chzzk_shell::chat::ChatState::waiting(
            chzzk_core::chat::SubtitleFormat::Ass,
            OnExisting::Skip,
        )
    });
    r
}

/// 맡은 채널 작업의 끊긴 채팅도 둘째 깃발이 컨텐츠를 다시 판정한 뒤 자동으로 이어받는다(Codex 4차 medium,
/// app.md 구현 중 변경 86-4). 앞서는 영상만 보아 채팅이 [⋯]로만 받을 수 있게 남았다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delegated_auto_resume_picks_up_interrupted_chat() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    write_jobs(t.path(), vec![delegated_chat_record(t.path(), OWN)]);
    enable_auto_resume(t.path(), &api);
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    let st = delegated_status(true, &[OWN]);
    assert_eq!(app.on_auth_status(&st), 0, "본인 채널 작업이 아니다");
    assert!(app.take_delegated_resume(&st));
    assert_eq!(
        app.resume_delegated_interrupted(&st.delegated_channels)
            .await,
        1
    );
    assert_eq!(status_of(&app, 2), JobStatus::Completed);
    // 진짜 코어라 채팅 주소가 mock에 없어 곧 실패한다. 끊긴 채로 남지 않은 것만 본다
    assert_ne!(
        chat_of(&app, 2).unwrap().phase,
        chzzk_shell::chat::ChatPhase::Interrupted
    );
    assert_eq!(channel_of(&app, 2).as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 기록의 채널만 맡은 채널로 바꾼 남의 영상이면 채팅도 줄 세우지 않는다(fail closed). 기록은 실제 채널로 고친다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delegated_auto_resume_rejudges_chat_content() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    write_jobs(t.path(), vec![delegated_chat_record(t.path(), OTHER)]);
    enable_auto_resume(t.path(), &api);
    save_session_full(t.path(), &worker, EDITOR, false, &[OTHER]);
    mock_me(&worker, EDITOR, &[OTHER], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    let st = delegated_status(true, &[OTHER]);
    assert!(app.take_delegated_resume(&st));
    assert_eq!(
        app.resume_delegated_interrupted(&st.delegated_channels)
            .await,
        0
    );
    assert_eq!(
        chat_of(&app, 2).unwrap().phase,
        chzzk_shell::chat::ChatPhase::Interrupted
    );
    assert_eq!(channel_of(&app, 2).as_deref(), Some(OWN));
    app.manager.quit(Duration::from_secs(3)).await;
}

// ---------------------------------------------------------------------------
// 맡은 채널 자동 이어받기 경합(Codex 5차 medium, app.md 구현 중 변경 87): 소유 확인을 기다리는 동안 사용자가
// 후보를 이어받고 일시정지하면 자동 경로는 그 작업을 건너뛴다(일시정지를 되살리지 않는다)
// ---------------------------------------------------------------------------

/// 소유 확인(info)을 `delay`만큼 늦추고, 채팅 요청은 오래 붙잡는 mock. 사용자가 시작한 채팅이 받는 중에 머문다
async fn slow_judging_api(delay: Duration) -> MockServer {
    let api = mock_api(Some(Duration::from_secs(60))).await;
    Mock::given(method("GET"))
        .and(path(format!("/service/v2/videos/{VOD_NO}")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(fixture("testdata/vod/video_info.json"), "application/json")
                .set_delay(delay),
        )
        .with_priority(1)
        .mount(&api)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("/service/v1/videos/{VOD_NO}/chats")))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
        .with_priority(1)
        .mount(&api)
        .await;
    api
}

/// info 요청이 도착할 때까지 기다린다(자동 경로가 소유 확인 await에 들어갔다)
async fn until_info_requested(api: &MockServer) {
    let info = format!("/service/v2/videos/{VOD_NO}");
    for _ in 0..200 {
        let n = api
            .received_requests()
            .await
            .unwrap()
            .iter()
            .filter(|r| r.url.path() == info)
            .count();
        if n > 0 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("소유 확인 요청이 오지 않았다");
}

async fn until_app(what: &str, mut f: impl FnMut() -> bool) {
    for _ in 0..300 {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("기다리다 지침: {what}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delegated_auto_resume_skips_chat_paused_by_user_during_judging() {
    use chzzk_shell::chat::ChatPhase;
    let api = slow_judging_api(Duration::from_secs(3)).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    write_jobs(t.path(), vec![delegated_chat_record(t.path(), OWN)]);
    enable_auto_resume(t.path(), &api);
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    let st = delegated_status(true, &[OWN]);
    assert!(app.take_delegated_resume(&st));
    let user = async {
        until_info_requested(&api).await;
        // 사용자: 이어받기 → 일시정지(판정은 화면 경로가 따로 한다. 여기서는 그 결과만 흉내 낸다)
        app.manager
            .start_chat(
                JobId(2),
                false,
                OnExisting::Skip,
                chzzk_core::chat::SubtitleFormat::Ass,
                |_| Ok(None),
            )
            .unwrap();
        app.manager.pause_chat(JobId(2)).unwrap();
        until_app("사용자 일시정지", || {
            chat_of(&app, 2).unwrap().phase == ChatPhase::Paused
        })
        .await;
    };
    let (n, ()) = tokio::join!(
        app.resume_delegated_interrupted(&st.delegated_channels),
        user
    );
    assert_eq!(n, 0, "사용자가 손댄 후보는 건너뛴다");
    assert_eq!(chat_of(&app, 2).unwrap().phase, ChatPhase::Paused);
    app.manager.quit(Duration::from_secs(3)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delegated_auto_resume_skips_video_paused_by_user_during_judging() {
    let api = slow_judging_api(Duration::from_secs(3)).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    write_jobs(t.path(), vec![vod_record(2, Some(OWN), &out)]);
    enable_auto_resume(t.path(), &api);
    save_session_full(t.path(), &worker, EDITOR, false, &[OWN]);
    mock_me(&worker, EDITOR, &[OWN], 200).await;
    let app = open_auth(t.path(), &api, &worker);
    let st = delegated_status(true, &[OWN]);
    assert!(app.take_delegated_resume(&st));
    let user = async {
        until_info_requested(&api).await;
        app.manager.resume(JobId(2), false).unwrap();
        app.manager.pause(JobId(2)).unwrap();
        until_app("사용자 일시정지", || {
            status_of(&app, 2) == JobStatus::Paused
        })
        .await;
    };
    let (n, ()) = tokio::join!(
        app.resume_delegated_interrupted(&st.delegated_channels),
        user
    );
    assert_eq!(n, 0, "사용자가 손댄 후보는 건너뛴다");
    assert_eq!(status_of(&app, 2), JobStatus::Paused);
    app.manager.quit(Duration::from_secs(3)).await;
}

const LIVE_RECORDING_ID: &str = "000000000000000000000000000000c3";

/// 생방송 기록(`jobs.json`). 출력은 `out/live.mp4`
fn live_record(id: u64, channel: &str, status: JobStatus, out: &Path) -> JobRecord {
    let mut r = record(id, None, out);
    r.url = format!("https://chzzk.naver.com/live/{channel}");
    r.content = ContentRef::Live {
        channel_id: channel.into(),
    };
    r.kind = ContentKindDto::Live;
    r.quality_id = "720p".into();
    r.expected_kind = PlaybackKind::Live;
    r.recording_id = Some(LIVE_RECORDING_ID.into());
    r.output = out.join("live.mp4");
    r.status = status;
    r
}

/// 재시작 뒤 상태를 재현한다: 영상 조각까지 받은 `.part`+sidecar(`synthetic_frag.mp4`의 ftyp+moov가 init)
fn write_recorded_part(rec: &JobRecord) {
    let bytes = fixture("testdata/live/synthetic_frag.mp4");
    common::write_live_part(
        &rec.output,
        &rec.content,
        &rec.quality_id,
        rec.expected_kind,
        rec.recording_id.as_deref(),
        28 + 1190,
        &bytes,
    );
}

fn live_detail_requests(reqs: &[wiremock::Request]) -> usize {
    reqs.iter()
        .filter(|r| r.url.path().ends_with("/live-detail"))
        .count()
}

/// 방송이 끝난 뒤 앱을 다시 열어도 멈춘 생방송 녹화는 live-detail 조회 없이 받은 만큼 저장된다(막다른 길 회귀).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_job_finishes_live_recording_after_broadcast_ended() {
    for status in [JobStatus::Paused, JobStatus::Interrupted, JobStatus::Failed] {
        let api = mock_api(None).await;
        let worker = MockServer::start().await;
        let t = TempDir::new().unwrap();
        let out = t.path().join("out");
        let mut rec = live_record(1, OWN, status, &out);
        if status == JobStatus::Failed {
            rec.last_error = Some(chzzk_shell::AppError::from(chzzk_core::Error::NotLive));
        }
        write_recorded_part(&rec);
        write_jobs(t.path(), vec![rec]);
        save_session(t.path(), &worker, OWN);
        let app = open_auth(t.path(), &api, &worker);

        app.resume_job(JobId(1), false).await.unwrap();
        wait_for(&app, 1, JobStatus::Completed).await;
        assert_eq!(
            live_detail_requests(&api.received_requests().await.unwrap()),
            0,
            "{status:?}: 끝난 방송을 조회하지 않는다"
        );
        assert_eq!(channel_of(&app, 1).as_deref(), Some(OWN));
        app.manager.quit(Duration::from_secs(3)).await;
    }
}

/// 받은 영상이 없으면(`.part` 없음) 코어가 조회하고 방송이 꺼져 있으니 카드에서 `NotLive`로 실패한다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_job_live_without_media_fails_on_card() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    write_jobs(
        t.path(),
        vec![live_record(1, OWN, JobStatus::Interrupted, &out)],
    );
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);

    app.resume_job(JobId(1), false).await.unwrap();
    wait_for(&app, 1, JobStatus::Failed).await;
    let job = app
        .manager
        .list()
        .into_iter()
        .find(|j| j.id == JobId(1))
        .unwrap();
    assert_eq!(job.error.unwrap().code, ErrorCode::NotLive);
    assert!(live_detail_requests(&api.received_requests().await.unwrap()) >= 1);
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 남의 채널 생방송 기록은 조회 없이 거부하고 기록 채널을 남긴다
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_job_rejects_other_channel_live_without_request() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    let rec = live_record(1, OTHER, JobStatus::Interrupted, &out);
    write_recorded_part(&rec);
    write_jobs(t.path(), vec![rec]);
    save_session(t.path(), &worker, OWN);
    let app = open_auth(t.path(), &api, &worker);

    let e = app.resume_job(JobId(1), false).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::NotOwnContent);
    assert!(api.received_requests().await.unwrap().is_empty());
    assert_eq!(status_of(&app, 1), JobStatus::Interrupted);
    assert_eq!(channel_of(&app, 1).as_deref(), Some(OTHER));
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 로그아웃 상태에서는 생방송도 조회 없이 `NotLoggedIn`
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn resume_job_live_signed_out_is_not_logged_in() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    let rec = live_record(1, OWN, JobStatus::Interrupted, &out);
    write_recorded_part(&rec);
    write_jobs(t.path(), vec![rec]);
    let app = open_auth(t.path(), &api, &worker);

    let e = app.resume_job(JobId(1), false).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::NotLoggedIn);
    assert!(api.received_requests().await.unwrap().is_empty());
    app.manager.quit(Duration::from_secs(3)).await;
}

/// 관리자는 남의 채널 생방송도 조회 없이 마무리할 수 있다(방송이 끝났어도)
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn admin_resume_job_finishes_live_after_end() {
    let api = mock_api(None).await;
    let worker = MockServer::start().await;
    let t = TempDir::new().unwrap();
    let out = t.path().join("out");
    let rec = live_record(1, OTHER, JobStatus::Interrupted, &out);
    write_recorded_part(&rec);
    write_jobs(t.path(), vec![rec]);
    save_session_as(t.path(), &worker, OWN, true);
    let app = open_auth(t.path(), &api, &worker);
    refresh_as(&app, &worker, OWN, true).await;

    app.resume_job(JobId(1), false).await.unwrap();
    wait_for(&app, 1, JobStatus::Completed).await;
    assert_eq!(
        live_detail_requests(&api.received_requests().await.unwrap()),
        0
    );
    app.manager.quit(Duration::from_secs(3)).await;
}
