//! 앱 상태 묶음(app.md §4 `App`, §15-11): 설정 → 매니저 순서로 열기, 앱 정보, `check_output`의 폴더 기본값,
//! 파일 열기·폴더 열기 대상.

mod common;

use std::path::Path;
use std::time::Duration;

use chzzk_core::{ClientConfig, ContentRef, Endpoints, PlaybackKind, RetryPolicy};
use chzzk_shell::app::Reveal;
use chzzk_shell::dto::{JobStatus, Nullable, SettingsPatch};
use chzzk_shell::services::AppPaths;
use chzzk_shell::{App, ErrorCode, ErrorPayload, JobId};
use common::harness::request;
use tempfile::TempDir;
use url::Url;
use wiremock::MockServer;

fn paths(root: &Path) -> AppPaths {
    AppPaths::new(
        root.join("config"),
        root.join("data"),
        root.join("log"),
        None,
        None,
    )
}

/// 아무 응답도 등록하지 않은 mock 서버(모든 요청이 404)에 붙인 클라이언트. 작업은 곧 실패한다.
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
        },
        ..ClientConfig::default()
    }
}

fn open(root: &Path, server: &MockServer) -> App {
    App::open_with(
        paths(root),
        config(server),
        None,
        tokio::runtime::Handle::current(),
    )
    .unwrap()
}

async fn wait_status(app: &App, id: JobId, want: JobStatus) {
    for _ in 0..500 {
        if app
            .manager
            .list()
            .iter()
            .any(|j| j.id == id && j.status == want)
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("{id:?}가 {want:?}가 되지 않음: {:?}", app.manager.list());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn info_reports_paths_and_phase2_features() {
    let t = TempDir::new().unwrap();
    let server = MockServer::start().await;
    let app = open(t.path(), &server);
    let info = app.info("1.2.3");
    assert_eq!(info.version, "1.2.3");
    assert_eq!(info.core_version, chzzk_core::VERSION);
    assert!(!info.features.auth);
    assert_eq!(Path::new(&info.config_dir), t.path().join("config"));
    assert_eq!(Path::new(&info.data_dir), t.path().join("data"));
    assert_eq!(Path::new(&info.log_dir), t.path().join("log"));
    assert_eq!(
        Path::new(&info.default_download_folder),
        t.path().join("data/downloads")
    );
    assert_eq!(info.legacy_candidate, None);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn manager_opens_with_saved_parallel_setting() {
    let t = TempDir::new().unwrap();
    let server = MockServer::start().await;
    {
        let app = open(t.path(), &server);
        let dto = app
            .update_settings(SettingsPatch {
                max_parallel_downloads: Some(9),
                ..SettingsPatch::default()
            })
            .unwrap();
        assert_eq!(dto.max_parallel_downloads, 3);
    }
    let app = open(t.path(), &server);
    assert_eq!(app.settings.get().max_parallel_downloads, 3);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn check_output_defaults_to_settings_folder() {
    let t = TempDir::new().unwrap();
    let server = MockServer::start().await;
    let app = open(t.path(), &server);
    let custom = t.path().join("custom");
    app.update_settings(SettingsPatch {
        download_folder: Nullable::Set(custom.to_string_lossy().into_owned()),
        ..SettingsPatch::default()
    })
    .unwrap();
    let c = app
        .check_output(
            None,
            "이름",
            &ContentRef::Video { video_no: 1 },
            "720p",
            PlaybackKind::LiveRewindHls,
        )
        .unwrap();
    assert_eq!(Path::new(&c.path), custom.join("이름.mp4"));
    // 폴더를 넘기면 그 폴더다.
    let other = t.path().join("other");
    let c = app
        .check_output(
            Some(other.to_str().unwrap()),
            "이름",
            &ContentRef::Video { video_no: 1 },
            "720p",
            PlaybackKind::LiveRewindHls,
        )
        .unwrap();
    assert_eq!(Path::new(&c.path), other.join("이름.mp4"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_and_reveal_targets() {
    let t = TempDir::new().unwrap();
    let server = MockServer::start().await;
    let app = open(t.path(), &server);
    let folder = t.path().join("out");
    let mut req = request("영상");
    req.folder = Some(folder.to_string_lossy().into_owned());
    let job = app.enqueue(req).unwrap();
    wait_status(&app, job.id, JobStatus::Failed).await;
    // 최근 VOD에 남았다(§6.2 6단계).
    assert_eq!(app.settings.get().recent_vods.len(), 1);

    let file = folder.join("영상.mp4");
    // 파일도 폴더도 없다(코어가 만든 빈 폴더를 지운다).
    if folder.exists() {
        std::fs::remove_dir_all(&folder).unwrap();
    }
    let e = app.open_target(job.id).unwrap_err();
    assert_eq!(e.code, ErrorCode::FileMissing);
    let e = app.reveal_target(job.id).unwrap_err();
    assert_eq!(e.code, ErrorCode::FileMissing);
    assert_eq!(
        e.payload,
        Some(ErrorPayload::Path {
            path: folder.to_string_lossy().into_owned()
        })
    );

    // 폴더만 있다: 폴더를 연다.
    std::fs::create_dir_all(&folder).unwrap();
    assert!(app.open_target(job.id).is_err());
    assert_eq!(
        app.reveal_target(job.id).unwrap(),
        Reveal::Folder(folder.clone())
    );

    // 파일이 있다.
    std::fs::write(&file, b"x").unwrap();
    assert_eq!(app.open_target(job.id).unwrap(), file);
    assert_eq!(app.reveal_target(job.id).unwrap(), Reveal::Item(file));

    let e = app.open_target(JobId(999)).unwrap_err();
    assert_eq!(e.code, ErrorCode::JobNotFound);
}
