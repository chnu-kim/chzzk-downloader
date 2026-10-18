//! 파일 이름 규칙이 카드의 제안 이름에 반영되고(app.md 91), 이미 만든 작업의 경로는 바뀌지 않는다(§4.4).

use std::path::Path;
use std::time::Duration;

use chzzk_core::{ClientConfig, Endpoints, RetryPolicy};
use chzzk_shell::App;
use chzzk_shell::dto::{
    ContentKindDto, EnqueueRequest, JobStatus, Nullable, OnExisting, SettingsPatch,
};
use chzzk_shell::services::AppPaths;
use tempfile::TempDir;
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

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

/// 미디어 응답을 길게 늦춰 작업이 받는 중으로 남게 한다.
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
            pd_mpd(&format!("{}{MEDIA_PATH}?_lsu_sa_=sig", server.uri())),
            "application/dash+xml",
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
        .mount(&server)
        .await;
    server
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
            patience: Duration::ZERO,
            patience_cap: Duration::ZERO,
        },
        ..ClientConfig::default()
    }
}

fn open(root: &Path, api: &MockServer) -> App {
    App::open_with(
        AppPaths::new(
            root.join("config"),
            root.join("data"),
            root.join("log"),
            None,
            None,
            None,
        ),
        config(api),
        None,
        tokio::runtime::Handle::current(),
    )
    .unwrap()
}

fn url() -> String {
    format!("https://chzzk.naver.com/video/{VOD_NO}")
}

fn set(tpl: &str) -> SettingsPatch {
    SettingsPatch {
        file_name_template: Nullable::Set(tpl.into()),
        ..SettingsPatch::default()
    }
}

#[tokio::test]
async fn resolve_suggests_name_from_template() {
    let api = mock_api().await;
    let t = TempDir::new().unwrap();
    let app = open(t.path(), &api);

    // 규칙이 없으면 지금 이름
    let base = app.resolve(&url()).await.unwrap().suggested_file_name;
    assert_eq!(base, "[260101] 가상채널 - 가상 일반 VOD 제목 (괄호) 테스트");

    // 규칙이 있으면 그 이름
    app.update_settings(set("{date}_{title}")).unwrap();
    let r = app.resolve(&url()).await.unwrap();
    assert_eq!(
        r.suggested_file_name,
        "260101_가상 일반 VOD 제목 (괄호) 테스트"
    );
    assert_eq!(r.meta.kind, ContentKindDto::Video);

    // 기본 규칙 문자열을 저장하면 `None`이라 지금 이름과 바이트까지 같다
    app.update_settings(set("{prefix} {channel} - {title}"))
        .unwrap();
    assert_eq!(app.settings.get().file_name_template, None);
    assert_eq!(app.resolve(&url()).await.unwrap().suggested_file_name, base);

    // 기본으로(null)
    app.update_settings(set("{title}")).unwrap();
    app.update_settings(SettingsPatch {
        file_name_template: Nullable::Clear,
        ..SettingsPatch::default()
    })
    .unwrap();
    assert_eq!(app.resolve(&url()).await.unwrap().suggested_file_name, base);
}

/// 작업의 `output`은 만들 때 고정된다: 규칙을 바꿔도, 앱을 다시 열어도 같다(`.part`가 고아가 되지 않는다).
#[tokio::test]
async fn existing_job_output_survives_template_change() {
    let api = mock_api().await;
    let t = TempDir::new().unwrap();
    let app = open(t.path(), &api);
    app.update_settings(set("{date}_{title}")).unwrap();
    let r = app.resolve(&url()).await.unwrap();
    let folder = t.path().join("out");
    std::fs::create_dir_all(&folder).unwrap();
    let job = app
        .enqueue(EnqueueRequest {
            url: url(),
            content: r.content.clone(),
            title: r.meta.title.clone(),
            channel_name: r.meta.channel_name.clone(),
            channel_id: r.meta.channel_id.clone(),
            quality_id: QUALITY.into(),
            quality_label: "720p".into(),
            expected_kind: r.playback_kind,
            folder: Some(folder.to_string_lossy().into_owned()),
            file_name: r.suggested_file_name.clone(),
            on_existing: OnExisting::Overwrite,
            restart: false,
            content_date: None,
            range: None,
            save_chat: false,
        })
        .await
        .unwrap();
    assert!(
        job.output
            .ends_with("260101_가상 일반 VOD 제목 (괄호) 테스트.mp4"),
        "{}",
        job.output
    );
    let before = job.output.clone();

    app.update_settings(set("{channel}_{no}_{title}")).unwrap();
    app.update_settings(SettingsPatch {
        file_name_template: Nullable::Clear,
        ..SettingsPatch::default()
    })
    .unwrap();
    let jobs = app.manager.list();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].output, before);
    assert!(
        !matches!(jobs[0].status, JobStatus::Completed | JobStatus::Failed),
        "{:?}",
        jobs[0].status
    );
    drop(app);

    // 다시 열어도 같다(jobs.json의 output)
    let app = open(t.path(), &api);
    let jobs = app.manager.list();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].output, before);
}
