//! 앱 상태 묶음(app.md §4 `App`, §15-11): 설정 → 매니저 순서로 열기, 앱 정보, `check_output`의 폴더 기본값,
//! 파일 열기·폴더 열기 대상.

mod common;

use std::path::Path;
use std::time::Duration;

use chzzk_core::{
    ClientConfig, ContentRef, Endpoints, PlaybackKind, RetryPolicy, TextScale, Theme,
};
use chzzk_shell::app::Reveal;
use chzzk_shell::dto::WebPage;
use chzzk_shell::dto::{AppFolder, JobStatus, Nullable, SettingsPatch};
use chzzk_shell::services::AppPaths;
use chzzk_shell::{App, AuthSetup, ErrorCode, ErrorPayload, JobId, WorkerBase};
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
            // 테스트는 연결 대기(인내)를 기다리지 않는다.
            patience: Duration::ZERO,
            patience_cap: Duration::ZERO,
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

/// `app_info`는 로그인 전에도 OS와 저장된 글자 크기·모양을 싣는다.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn info_carries_platform_and_appearance() {
    let t = TempDir::new().unwrap();
    let server = MockServer::start().await;
    let app = open(t.path(), &server);
    let info = app.info("1.0.0");
    assert_eq!(info.platform, chzzk_core::Platform::current().into());
    assert_eq!(info.text_scale, TextScale::Default);
    assert_eq!(info.theme, Theme::System);

    app.update_settings(SettingsPatch {
        text_scale: Some(TextScale::XLarge),
        theme: Some(Theme::Dark),
        ..SettingsPatch::default()
    })
    .unwrap();
    let info = app.info("1.0.0");
    assert_eq!(
        (info.text_scale, info.theme),
        (TextScale::XLarge, Theme::Dark)
    );
    drop(app);

    // 다시 열어도 로그인 전 화면이 쓸 값이 남아 있다
    let info = open(t.path(), &server).info("1.0.0");
    assert_eq!(
        (info.text_scale, info.theme),
        (TextScale::XLarge, Theme::Dark)
    );
}

/// `open_web_page`가 열 주소: 로그인 서버가 없으면 `invalidInput`, 있으면 출처 아래 고정 경로.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn web_page_url_needs_a_worker_base() {
    let t = TempDir::new().unwrap();
    let server = MockServer::start().await;
    let off = open(t.path(), &server);
    for page in [WebPage::Privacy, WebPage::Licenses] {
        assert_eq!(
            off.web_page_url(page).unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }

    let t2 = TempDir::new().unwrap();
    let base = WorkerBase::parse("https://worker.example.invalid").unwrap();
    let on = App::open_with_auth(
        paths(t2.path()),
        config(&server),
        None,
        tokio::runtime::Handle::current(),
        AuthSetup::Enabled {
            base,
            app_version: "0.1.0".into(),
        },
    )
    .unwrap();
    assert_eq!(
        on.web_page_url(WebPage::Privacy).unwrap(),
        "https://worker.example.invalid/privacy"
    );
    assert_eq!(
        on.web_page_url(WebPage::Licenses).unwrap(),
        "https://worker.example.invalid/licenses"
    );
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
    let job = app.enqueue(req).await.unwrap();
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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn folder_targets_follow_paths_and_settings() {
    let t = TempDir::new().unwrap();
    let server = MockServer::start().await;
    let app = open(t.path(), &server);
    assert_eq!(
        app.folder_target(AppFolder::Config).unwrap(),
        t.path().join("config")
    );
    // 로그 폴더가 아직 없어도 만들고 연다.
    let log = app.folder_target(AppFolder::Logs).unwrap();
    assert_eq!(log, t.path().join("log"));
    assert!(log.is_dir());
    // 저장 폴더: 설정이 없으면 기본 폴더({data}/downloads), 아직 없으면 만든다.
    let def = app.folder_target(AppFolder::Downloads).unwrap();
    assert_eq!(def, t.path().join("data").join("downloads"));
    assert!(def.is_dir());
    // 설정 폴더를 바꾸면 그 폴더.
    let mine = t.path().join("내 영상");
    app.update_settings(SettingsPatch {
        download_folder: Nullable::Set(mine.to_string_lossy().into_owned()),
        ..SettingsPatch::default()
    })
    .unwrap();
    assert_eq!(app.folder_target(AppFolder::Downloads).unwrap(), mine);
    assert!(mine.is_dir());
    // 만들 수 없으면(같은 이름의 파일) io 오류와 경로.
    let blocked = t.path().join("막힘");
    std::fs::write(&blocked, b"x").unwrap();
    app.update_settings(SettingsPatch {
        download_folder: Nullable::Set(blocked.to_string_lossy().into_owned()),
        ..SettingsPatch::default()
    })
    .unwrap();
    let e = app.folder_target(AppFolder::Downloads).unwrap_err();
    assert_eq!(e.code, ErrorCode::Io);
    assert_eq!(
        e.payload,
        Some(ErrorPayload::Path {
            path: blocked.to_string_lossy().into_owned()
        })
    );
}

/// 볼륨 기준 이름 규칙(core.md 57): FAT·exFAT·원격 볼륨은 어느 host에서든 Windows 규칙의 이름을 낸다.
/// 유닉스 파일 시스템은 host 규칙 그대로다. 순수 함수라 한 host에서 세 OS를 본다.
#[test]
fn volume_platform_picks_windows_names_on_fat() {
    use chzzk_core::Platform;
    use chzzk_core::naming::output_path;
    use chzzk_shell::volume::{VolumeFs, naming_platform};

    let folder = Path::new("/vol/VOD Clip Downloader");
    let name = "[261004] 채널 - 질문: 뭐? 1.mp4";
    let windows = output_path(folder, name, Platform::Windows);
    for host in [Platform::MacOs, Platform::Linux, Platform::Windows] {
        for fs in [
            VolumeFs::Fat,
            VolumeFs::ExFat,
            VolumeFs::Smb,
            VolumeFs::Unknown,
        ] {
            let p = naming_platform(host, fs);
            assert_eq!(p, Platform::Windows, "{host:?} {fs:?}");
            assert_eq!(output_path(folder, name, p), windows);
        }
    }
    // 유닉스 파일 시스템은 host 규칙이다(Windows host는 늘 Windows).
    assert_eq!(
        naming_platform(Platform::MacOs, VolumeFs::Unix),
        Platform::MacOs
    );
    assert_eq!(
        naming_platform(Platform::Linux, VolumeFs::Unix),
        Platform::Linux
    );
    assert_eq!(
        naming_platform(Platform::Windows, VolumeFs::Unix),
        Platform::Windows
    );
    // Windows 규칙은 `:`·`?`를 바꾸지만 macOS 규칙은 `:`만 바꾼다: 같은 이름이 달라야 의미가 있다.
    assert_ne!(
        output_path(folder, name, Platform::Windows),
        output_path(folder, name, Platform::Linux)
    );
}
