//! IPC 테스트(app.md §13 `app/src-tauri`, §15-11): mock 런타임에 실제 command 처리기·capabilities
//! (`generate_context!(test = true)`)를 붙여, command 인자의 camelCase, `AppError` 직렬화, 허가 목록,
//! 진행 이벤트 Channel·완료 알림 큐, 창 닫기·앱 종료 가드(mock 이벤트 루프)를 본다.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chzzk_app_lib::auth_io::{AuthIo, AuthIoState};
use chzzk_app_lib::commands::begin_quit;
use chzzk_app_lib::sink::{ChannelSink, Notice, Notifier};
use chzzk_app_lib::{
    AUTH_CHANGED, COMMANDS, Quitting, focus_main, guard_close, handler, on_run_event,
    on_window_focus, request_quit, spawn_auth_tasks,
};
use chzzk_shell::auth::{SessionStore, StoredSession};
use chzzk_shell::services::AppPaths;
use chzzk_shell::{App, AppError, AuthSetup, EventSink, WorkerBase};
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, Channel, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::{InvokeRequest, WebviewWindow, WebviewWindowBuilder};
use tauri::{AppHandle, Listener, Manager};
use tempfile::TempDir;
use tokio::sync::mpsc::UnboundedReceiver;
use wiremock::matchers::{any, method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

/// 브라우저·클립보드 호출을 적어 두는 `AuthIo`
#[derive(Default)]
struct RecordingIo {
    opened: Mutex<Vec<String>>,
    copied: Mutex<Vec<String>>,
}

impl AuthIo for RecordingIo {
    fn open_url(&self, u: &str) -> bool {
        self.opened.lock().unwrap().push(u.into());
        true
    }
    fn copy_text(&self, t: &str) -> bool {
        self.copied.lock().unwrap().push(t.into());
        true
    }
}

struct Fixture {
    app: tauri::App<MockRuntime>,
    main: WebviewWindow<MockRuntime>,
    notify_rx: UnboundedReceiver<Notice>,
    dir: TempDir,
    io: Arc<RecordingIo>,
}

fn paths(root: &Path) -> AppPaths {
    AppPaths::new(
        root.join("config"),
        root.join("data"),
        root.join("log"),
        None,
        None,
    )
}

fn fixture() -> Fixture {
    let dir = TempDir::new().unwrap();
    let state = App::open(paths(dir.path()), None, chzzk_app_lib::tokio_handle()).unwrap();
    fixture_with(dir, state)
}

/// 실제 처리기·capabilities를 붙인 mock 앱(창 없음). clipboard-manager 플러그인은 `clipboard_link`를 실제로
/// 부르는 테스트만 등록한다(AppKit 대지를 여는 범위를 줄인다).
fn mock_app(
    state: App,
    clipboard: bool,
) -> (
    tauri::App<MockRuntime>,
    UnboundedReceiver<Notice>,
    Arc<RecordingIo>,
) {
    let (notifier, notify_rx) = Notifier::new();
    let io = Arc::new(RecordingIo::default());
    let mut builder = mock_builder();
    if clipboard {
        builder = builder.plugin(tauri_plugin_clipboard_manager::init());
    }
    let app = builder
        .manage(state)
        .manage(Quitting::default())
        .manage(notifier)
        .manage(AuthIoState(io.clone()))
        .invoke_handler(handler())
        .build(tauri::generate_context!(test = true))
        .unwrap();
    (app, notify_rx, io)
}

fn fixture_with(dir: TempDir, state: App) -> Fixture {
    fixture_full(dir, state, false)
}

fn fixture_full(dir: TempDir, state: App, clipboard: bool) -> Fixture {
    let (app, notify_rx, io) = mock_app(state, clipboard);
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    Fixture {
        app,
        main,
        notify_rx,
        dir,
        io,
    }
}

fn invoke(w: &WebviewWindow<MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
    get_ipc_response(
        w,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|b| b.deserialize::<Value>().unwrap())
}

#[test]
fn capabilities_allow_exactly_the_app_commands() {
    let cap: Value = serde_json::from_str(
        &std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(cap["windows"], json!(["main"]));
    let mut got: Vec<String> = cap["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let mut want: Vec<String> = std::iter::once("core:default".to_string())
        .chain(
            COMMANDS
                .iter()
                .map(|c| format!("allow-{}", c.replace('_', "-"))),
        )
        .collect();
    got.sort();
    want.sort();
    // 플러그인 권한(dialog:·opener:·notification:·clipboard-manager:)은 JS에 주지 않는다.
    assert_eq!(got, want);
}

#[test]
fn commands_answer_with_camel_case_json() {
    let f = fixture();
    let info = invoke(&f.main, "app_info", json!({})).unwrap();
    assert_eq!(info["coreVersion"], json!(chzzk_core::VERSION));
    assert_eq!(info["features"], json!({ "auth": false }));
    assert!(
        info["defaultDownloadFolder"]
            .as_str()
            .unwrap()
            .ends_with("downloads")
    );

    let s = invoke(
        &f.main,
        "update_settings",
        json!({ "patch": { "maxParallelDownloads": 1, "autoResumeInterrupted": true } }),
    )
    .unwrap();
    assert_eq!(s["maxParallelDownloads"], json!(1));
    assert_eq!(s["autoResumeInterrupted"], json!(true));
    assert_eq!(
        invoke(&f.main, "get_settings", json!({})).unwrap()["maxParallelDownloads"],
        json!(1)
    );

    let c = invoke(
        &f.main,
        "check_output",
        json!({
            "folder": null,
            "fileName": "이름",
            "content": { "kind": "video", "videoNo": 1 },
            "qualityId": "720p",
            "expectedKind": "liveRewindHls",
        }),
    )
    .unwrap();
    assert_eq!(c["fileName"], json!("이름"));
    assert_eq!(c["exists"], json!(false));
    assert_eq!(c["duplicateJobId"], Value::Null);

    assert_eq!(invoke(&f.main, "list_jobs", json!({})).unwrap(), json!([]));
    assert_eq!(
        invoke(&f.main, "auth_status", json!({})).unwrap()["state"],
        json!("disabled")
    );
    invoke(&f.main, "clear_finished", json!({})).unwrap();
}

#[test]
fn errors_are_app_error_json() {
    let f = fixture();
    let e = invoke(
        &f.main,
        "resolve",
        json!({ "url": "https://example.com/x" }),
    )
    .unwrap_err();
    assert_eq!(e["code"], json!("invalidUrl"));
    assert!(e["resumable"].is_boolean());
    assert!(e["message"].is_string());

    let e = invoke(
        &f.main,
        "set_naver_cookies",
        json!({ "nidAut": "  ", "nidSes": "x" }),
    )
    .unwrap_err();
    assert_eq!(e["code"], json!("invalidInput"));

    let e = invoke(&f.main, "pause_job", json!({ "id": 99 })).unwrap_err();
    assert_eq!(e["code"], json!("jobNotFound"));
    assert_eq!(e["stage"], Value::Null);

    let e = invoke(
        &f.main,
        "update_settings",
        json!({ "patch": { "downloadFolder": "상대/경로" } }),
    )
    .unwrap_err();
    assert_eq!(e["code"], json!("invalidInput"));
}

#[test]
fn other_windows_are_denied() {
    let f = fixture();
    let other = WebviewWindowBuilder::new(&f.app, "other", Default::default())
        .build()
        .unwrap();
    // capabilities는 main 창에만 있다. 같은 command도 다른 창에서는 거부된다(ACL이 실제로 걸려 있다).
    let e = invoke(&other, "app_info", json!({})).unwrap_err();
    assert!(e.as_str().is_some_and(|s| s.contains("not allowed")), "{e}");
    assert!(invoke(&f.main, "app_info", json!({})).is_ok());
}

fn client_config(server: &MockServer) -> chzzk_core::ClientConfig {
    let base = url::Url::parse(&server.uri()).unwrap();
    chzzk_core::ClientConfig {
        endpoints: chzzk_core::Endpoints {
            chzzk_api: base.clone(),
            vodplay_api: base,
        },
        progress_interval: Duration::ZERO,
        ..chzzk_core::ClientConfig::default()
    }
}

/// 영상 정보 요청에 오래 답하지 않는 서버: 작업이 `running`에 머문다.
fn hanging_server() -> MockServer {
    tauri::async_runtime::block_on(async {
        let s = MockServer::start().await;
        Mock::given(any())
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
            .mount(&s)
            .await;
        s
    })
}

const VOD_NO: u64 = 9000002;
const VOD_VIDEO_ID: &str = "000000000000000000000000000000000B02";
const QUALITY: &str = "PD_720P_TEST";
const MEDIA_PATH: &str = "/m1/pd/a.mp4";

/// Range를 지원하는 작은 progressive 미디어.
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

/// 영상 정보 → MPD → 미디어를 끝까지 주는 서버(코어 fixture `testdata/vod/video_info.json`).
fn vod_server() -> MockServer {
    let info = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../testdata/vod/video_info.json"),
    )
    .unwrap();
    tauri::async_runtime::block_on(async {
        let s = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(format!("/service/v2/videos/{VOD_NO}")))
            .respond_with(ResponseTemplate::new(200).set_body_raw(info, "application/json"))
            .mount(&s)
            .await;
        let mpd = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:nvod="urn:naver:vod:2020">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="{QUALITY}" bandwidth="1000" width="1280" height="720">
        <nvod:Label kind="resolution">720</nvod:Label>
        <BaseURL>{}{MEDIA_PATH}?_lsu_sa_=sig</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"#,
            s.uri()
        );
        Mock::given(method("GET"))
            .and(path(format!(
                "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
            )))
            .respond_with(ResponseTemplate::new(200).set_body_raw(mpd, "application/dash+xml"))
            .mount(&s)
            .await;
        Mock::given(method("GET"))
            .and(path(MEDIA_PATH))
            .respond_with(RangeBody((0..50_000u32).map(|i| i as u8).collect()))
            .mount(&s)
            .await;
        s
    })
}

fn fixture_on(server: &MockServer) -> Fixture {
    let dir = TempDir::new().unwrap();
    let state = App::open_with(
        paths(dir.path()),
        client_config(server),
        None,
        chzzk_app_lib::tokio_handle(),
    )
    .unwrap();
    fixture_with(dir, state)
}

fn enqueue_body(no: u64, quality: &str, folder: Option<&Path>) -> Value {
    json!({ "req": {
        "url": format!("https://chzzk.naver.com/video/{no}"),
        "content": { "kind": "video", "videoNo": no },
        "title": "제목",
        "channelName": "채널",
        "channelId": null,
        "qualityId": quality,
        "qualityLabel": "720p",
        "expectedKind": "progressive",
        "folder": folder.map(|f| f.to_string_lossy().into_owned()),
        "fileName": "제목",
        "onExisting": "overwrite",
        "restart": false,
    } })
}

/// `running`에 머무는 작업 하나를 넣는다.
fn start_hanging_job(f: &Fixture) -> Value {
    let job = invoke(&f.main, "enqueue", enqueue_body(1, "720p", None)).unwrap();
    assert_eq!(job["status"], json!("running"));
    job
}

fn stop_all(h: &AppHandle<MockRuntime>) {
    tauri::async_runtime::block_on(h.state::<App>().manager.quit(Duration::from_secs(3)));
}

/// close-requested payload를 모은다.
fn close_requests(h: &AppHandle<MockRuntime>) -> Arc<Mutex<Vec<Value>>> {
    let got = Arc::new(Mutex::new(Vec::new()));
    let seen = got.clone();
    h.listen_any(chzzk_app_lib::CLOSE_REQUESTED, move |e| {
        seen.lock()
            .unwrap()
            .push(serde_json::from_str(e.payload()).unwrap());
    });
    got
}

#[test]
fn every_command_is_wired() {
    // command_names.rs(AppManifest·capabilities)와 `generate_handler!` 목록이 같은지: 모든 이름을 main 창에서
    // 불러, ACL 거부(`not allowed`)도 처리기 없음(`Command … not found`)도 아니어야 한다. 인자 누락 오류는 괜찮다.
    let dir = TempDir::new().unwrap();
    let state = App::open(paths(dir.path()), None, chzzk_app_lib::tokio_handle()).unwrap();
    let f = fixture_full(dir, state, true);
    // `quit`이 `app.exit`(mock에서 패닉)를 부르지 않게 종료 중으로 둔다(두 번째 `quit`은 아무것도 안 한다).
    f.app.state::<Quitting>().0.store(true, Ordering::SeqCst);
    for name in COMMANDS {
        // pick_folder는 인자 없이 부르면 실제 폴더 선택 창을 연다: 잘못된 인자로 역직렬화에서 멈춘다.
        let body = if *name == "pick_folder" {
            json!({ "initial": 1 })
        } else {
            json!({})
        };
        if let Err(e) = invoke(&f.main, name, body) {
            let text = e.to_string();
            assert!(!text.contains("not allowed"), "{name}: {text}");
            assert!(
                !text.contains(&format!("Command {name} not found")),
                "{name}: {text}"
            );
        }
    }
}

#[test]
fn open_app_folder_takes_camel_case_kind() {
    // 실제 폴더 창을 열지 않으려고 거부되는 값만 보낸다. 받는 값(`config`·`logs`·`downloads`)과 경로는
    // 셸 `App::folder_target` 테스트(crates/shell/tests/app.rs)가 본다.
    let f = fixture();
    for bad in [
        json!({}),
        json!({ "kind": "Config" }),
        json!({ "kind": "settings" }),
    ] {
        let e = invoke(&f.main, "open_app_folder", bad)
            .unwrap_err()
            .to_string();
        assert!(e.contains("kind"), "{e}");
    }
}

#[test]
fn main_window_may_listen_for_close_requested() {
    // D1은 프런트의 `listen("close-requested")`에 기댄다. capabilities의 `core:default`가 실제 ACL에서
    // `plugin:event|listen`을 허락하는지 본다(막히면 D1이 영영 뜨지 않는다).
    let f = fixture();
    invoke(
        &f.main,
        "plugin:event|listen",
        json!({ "event": "close-requested", "target": { "kind": "Any" }, "handler": 1 }),
    )
    .unwrap();
}

#[test]
fn subscribe_jobs_takes_an_on_event_channel() {
    let f = fixture();
    assert_eq!(
        invoke(
            &f.main,
            "subscribe_jobs",
            json!({ "onEvent": "__CHANNEL__:1" })
        )
        .unwrap(),
        json!([])
    );
    // 프런트는 `{ onEvent }`로 보낸다. 다른 이름은 받지 않는다.
    assert!(
        invoke(
            &f.main,
            "subscribe_jobs",
            json!({ "on_event": "__CHANNEL__:1" })
        )
        .is_err()
    );
}

#[test]
fn channel_sink_delivers_job_events_and_queues_completion_notice() {
    let server = vod_server();
    let mut f = fixture_on(&server);
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let sink_events = events.clone();
    let channel = Channel::new(move |body| {
        sink_events
            .lock()
            .unwrap()
            .push(body.deserialize::<Value>().unwrap());
        Ok(())
    });
    let notifier = f.app.state::<Notifier>().inner().clone();
    let state = f.app.state::<App>();
    assert_eq!(
        state
            .manager
            .subscribe(Box::new(ChannelSink::new(channel, notifier))),
        vec![]
    );
    let folder = f.dir.path().join("out");
    std::fs::create_dir_all(&folder).unwrap();
    let job = invoke(
        &f.main,
        "enqueue",
        enqueue_body(VOD_NO, QUALITY, Some(&folder)),
    )
    .unwrap();

    let deadline = Instant::now() + Duration::from_secs(20);
    let completed =
        |e: &Value| e["type"] == json!("status") && e["job"]["status"] == json!("completed");
    while !events.lock().unwrap().iter().any(completed) {
        assert!(
            Instant::now() < deadline,
            "완료되지 않음: {:?}",
            events.lock().unwrap()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let got = events.lock().unwrap().clone();
    assert_eq!(got[0]["type"], json!("added"));
    assert_eq!(got[0]["job"]["id"], job["id"]);
    assert!(
        got.iter()
            .any(|e| e["type"] == json!("status") && e["job"]["status"] == json!("running")),
        "{got:?}"
    );
    assert!(
        got.iter()
            .all(|e| e["type"] != json!("status") || e["job"]["id"] == job["id"])
    );
    // 완료 제목이 알림 큐에 들어간다(OS 알림은 spawn_notifier 태스크가 띄운다). 완료 하나에 한 번.
    assert_eq!(
        f.notify_rx.try_recv().ok(),
        Some(Notice::Completed("제목".into()))
    );
    assert!(f.notify_rx.try_recv().is_err());
}

#[test]
fn channel_sink_reports_a_closed_channel() {
    // 웹뷰가 사라져 Channel 전송이 실패하면 `false`(매니저가 구독자를 지운다).
    let (notifier, _rx) = Notifier::new();
    let sink = ChannelSink::new(
        Channel::new(|_| Err(tauri::Error::WindowNotFound)),
        notifier,
    );
    assert!(!sink.send(chzzk_shell::dto::JobEvent::Removed {
        id: chzzk_shell::JobId(1)
    }));
}

#[test]
fn close_is_not_guarded_without_running_jobs() {
    let f = fixture();
    let h = f.app.handle();
    let asked = close_requests(h);
    assert!(!guard_close(h));
    assert!(asked.lock().unwrap().is_empty());
}

#[test]
fn close_is_guarded_while_a_job_runs() {
    let server = hanging_server();
    let f = fixture_on(&server);
    start_hanging_job(&f);
    let h = f.app.handle();
    let asked = close_requests(h);
    assert!(guard_close(h));
    assert_eq!(*asked.lock().unwrap(), vec![json!({ "running": 1 })]);
    stop_all(h);
}

#[test]
fn quit_menu_is_guarded_while_a_job_runs() {
    // macOS 메뉴·Cmd+Q의 종료는 `request_quit`으로 온다(구현 중 변경 52). 받는 중이면 D1을 띄우고 끝내지 않는다.
    // (끝내는 쪽 `app.exit`은 mock 런타임이 패닉하므로 막히는 가지만 본다. 작업이 없으면 `close_decision`이
    // `Allow`인 것은 lib.rs 단위 테스트가 본다.)
    let server = hanging_server();
    let f = fixture_on(&server);
    start_hanging_job(&f);
    let h = f.app.handle();
    let asked = close_requests(h);
    assert!(!request_quit(h));
    assert_eq!(*asked.lock().unwrap(), vec![json!({ "running": 1 })]);
    // 종료 중에도 끝내지 않는다(D1 없이 조용히).
    h.state::<Quitting>().0.store(true, Ordering::SeqCst);
    assert!(!request_quit(h));
    assert_eq!(asked.lock().unwrap().len(), 1);
    stop_all(h);
}

#[test]
fn quit_runs_once_and_blocks_close_silently_meanwhile() {
    let server = hanging_server();
    let f = fixture_on(&server);
    let job = start_hanging_job(&f);
    let h = f.app.handle();
    let asked = close_requests(h);
    // 첫 `quit`이 3초 대기 중이라고 둔다.
    h.state::<Quitting>().0.store(true, Ordering::SeqCst);
    // 두 번째 `quit`은 아무것도 하지 않는다(작업을 `interrupted`로 앞질러 저장하지 않는다).
    let again =
        tauri::async_runtime::block_on(begin_quit(&h.state::<App>(), &h.state::<Quitting>()));
    assert!(!again);
    let list = invoke(&f.main, "list_jobs", json!({})).unwrap();
    assert_eq!(list[0]["id"], job["id"]);
    assert_eq!(list[0]["status"], json!("running"));
    // IPC `quit`도 같다(`app.exit`을 부르면 mock 런타임이 패닉한다).
    assert_eq!(invoke(&f.main, "quit", json!({})).unwrap(), Value::Null);
    // 종료 중의 창 닫기·Cmd+Q는 D1 없이 막는다(`quit`이 저장을 마치고 직접 끝낸다).
    assert!(guard_close(h));
    assert!(asked.lock().unwrap().is_empty());
    stop_all(h);
}

/// mock 이벤트 루프(`App::run_return`)를 돌리고 `drive`를 다른 스레드에서 실행한다. 루프가 끝나면 `drive`의 결과.
/// `drive`는 루프가 받은 `ExitRequested { code: None }` 수를 본다(mock은 막지 않은 닫기 바로 뒤에 보낸다).
/// main 창은 루프가 설정(`tauri.conf.json`)대로 만든다. 루프가 30초 안에 끝나지 않으면(닫기·종료가 잘못 막힘)
/// 프로세스를 끝낸다.
///
/// 한 번에 하나만 돈다: Tauri가 macOS 개발 빌드의 `Ready`에서 Dock 아이콘을 AppKit으로 그리는데, 루프 두 개가
/// 테스트 스레드에서 동시에 그리면 AppKit이 죽는다(SIGTRAP, 실측).
fn run_loop<T: Send + 'static>(
    state: App,
    drive: impl FnOnce(AppHandle<MockRuntime>, WebviewWindow<MockRuntime>, Arc<AtomicUsize>) -> T
    + Send
    + 'static,
) -> T {
    static ONE_LOOP: Mutex<()> = Mutex::new(());
    let _one = ONE_LOOP.lock().unwrap_or_else(|e| e.into_inner());
    let (app, _rx, _io) = mock_app(state, false);
    let h = app.handle().clone();
    let exits = Arc::new(AtomicUsize::new(0));
    let seen_exits = exits.clone();
    let done = Arc::new(AtomicBool::new(false));
    let watch = done.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if watch.load(Ordering::SeqCst) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        eprintln!("mock 이벤트 루프가 끝나지 않음: 창 닫기·앱 종료가 막혀 있다");
        std::process::exit(2);
    });
    let driver = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let main = loop {
            if let Some(w) = h.get_webview_window("main") {
                break w;
            }
            assert!(Instant::now() < deadline, "main 창이 생기지 않음");
            std::thread::sleep(Duration::from_millis(10));
        };
        drive(h, main, exits)
    });
    app.run_return(move |h, e| {
        if matches!(e, tauri::RunEvent::ExitRequested { code: None, .. }) {
            seen_exits.fetch_add(1, Ordering::SeqCst);
        }
        on_run_event(h, e)
    });
    done.store(true, Ordering::SeqCst);
    driver.join().unwrap()
}

#[test]
fn closing_the_main_window_exits_without_running_jobs() {
    let dir = TempDir::new().unwrap();
    let state = App::open(paths(dir.path()), None, chzzk_app_lib::tokio_handle()).unwrap();
    let exits = run_loop(state, |_, main, exits| {
        main.close().unwrap();
        exits
    });
    assert_eq!(exits.load(Ordering::SeqCst), 1);
}

#[test]
fn closing_the_main_window_is_blocked_while_downloading() {
    let server = hanging_server();
    let dir = TempDir::new().unwrap();
    let state = App::open_with(
        paths(dir.path()),
        client_config(&server),
        None,
        chzzk_app_lib::tokio_handle(),
    )
    .unwrap();
    let (exits_while_running, asked) = run_loop(state, |h, main, exits| {
        let req = serde_json::from_value(enqueue_body(1, "720p", None)["req"].clone()).unwrap();
        let job = h.state::<App>().enqueue(req).unwrap();
        assert_eq!(job.status, chzzk_shell::dto::JobStatus::Running);
        let asked = close_requests(&h);
        main.close().unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while asked.lock().unwrap().is_empty() {
            assert!(Instant::now() < deadline, "close-requested가 오지 않음");
            std::thread::sleep(Duration::from_millis(10));
        }
        // 닫기를 막았으면 mock은 창을 지우지 않고 종료 요청도 보내지 않는다.
        let exits_while_running = exits.load(Ordering::SeqCst);
        if exits_while_running != 0 {
            // mock이 창을 이미 지워 루프를 끝낼 방법이 없다: 이유를 남기고 바로 끝낸다.
            eprintln!("받는 중인데 main 창 닫기를 막지 않았다");
            std::process::exit(1);
        }
        let asked = asked.lock().unwrap().clone();
        // 작업을 멈추면 닫힌다. mock 런타임은 `Destroyed` 창 이벤트를 보내지 않아 Tauri 쪽 창 목록에 main이
        // 남으므로, "창이 없어진 뒤의 종료 요청은 막지 않는다"(`close_decision`의 `has_main`)는 여기서 재현하지
        // 못하고 lib.rs 단위 테스트가 본다.
        stop_all(&h);
        main.destroy().unwrap();
        (exits_while_running, asked)
    });
    assert_eq!(
        exits_while_running, 0,
        "받는 중인데 main 창 닫기를 막지 않았다"
    );
    assert_eq!(asked, vec![json!({ "running": 1 })]);
}

#[test]
fn channel_sink_queues_failure_notice() {
    // 영상 정보가 404면 작업이 실패한다. 실패도 알림 큐에 한 번 들어간다(47, §16 알림을 실패로 넓힘).
    let server = tauri::async_runtime::block_on(async {
        let s = MockServer::start().await;
        Mock::given(any())
            .respond_with(ResponseTemplate::new(404))
            .mount(&s)
            .await;
        s
    });
    let mut f = fixture_on(&server);
    let notifier = f.app.state::<Notifier>().inner().clone();
    let failed = Arc::new(AtomicBool::new(false));
    let seen = failed.clone();
    let channel = Channel::new(move |body| {
        let e = body.deserialize::<Value>().unwrap();
        if e["type"] == json!("status") && e["job"]["status"] == json!("failed") {
            seen.store(true, Ordering::SeqCst);
        }
        Ok(())
    });
    f.app
        .state::<App>()
        .manager
        .subscribe(Box::new(ChannelSink::new(channel, notifier)));
    invoke(&f.main, "enqueue", enqueue_body(VOD_NO, QUALITY, None)).unwrap();
    let deadline = Instant::now() + Duration::from_secs(20);
    while !failed.load(Ordering::SeqCst) {
        assert!(Instant::now() < deadline, "실패하지 않음");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(
        f.notify_rx.try_recv().ok(),
        Some(Notice::Failed("제목".into()))
    );
    assert!(f.notify_rx.try_recv().is_err());
}

#[test]
fn second_instance_does_not_reveal_the_window_of_a_failed_startup() {
    // 시작에 실패하면 상태를 manage하지 않고 main 창을 숨긴다(38(바)). 두 번째 실행이 그 빈 창을 꺼내면 안 된다.
    let app = mock_builder()
        .invoke_handler(handler())
        .build(tauri::generate_context!(test = true))
        .unwrap();
    WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    assert!(!focus_main(app.handle()));
    // 상태가 있으면 꺼낸다.
    let f = fixture();
    assert!(focus_main(f.app.handle()));
}

// ---------------------------------------------------------------------------
// 로그인(Phase 3b A2): AuthGate·auth command·auth-changed
// ---------------------------------------------------------------------------

const CH: &str = "000000000000000000000000000000a1";

/// Worker 서버. `start`가 있으면 `/auth/start`가 그 상태로 답한다(201이면 로그인 시작 본문, 그 밖에는 HTML 오류).
/// `/auth/poll`은 늘 pending이다.
fn worker_server(start: Option<u16>) -> MockServer {
    tauri::async_runtime::block_on(async {
        let s = MockServer::start().await;
        if let Some(status) = start {
            let resp = if status == 201 {
                ResponseTemplate::new(201).set_body_raw(start_body(&s.uri()), "application/json")
            } else {
                ResponseTemplate::new(status).set_body_raw("<html>", "text/html")
            };
            Mock::given(method("POST"))
                .and(path("/auth/start"))
                .respond_with(resp)
                .mount(&s)
                .await;
            Mock::given(method("POST"))
                .and(path("/auth/poll"))
                .respond_with(
                    ResponseTemplate::new(200)
                        .set_body_raw(r#"{"status":"pending"}"#, "application/json"),
                )
                .mount(&s)
                .await;
        }
        s
    })
}

fn start_body(origin: &str) -> String {
    json!({
        "loginId": "L".repeat(22),
        "loginUrl": format!("{origin}/auth/login/{}", "H".repeat(22)),
        "userCode": "K7QX-4MRA",
        "expiresAt": "2030-01-01T00:10:00.000Z",
        "pollIntervalMs": 2000,
    })
    .to_string()
}

fn fixture_auth(worker: &MockServer) -> Fixture {
    let dir = TempDir::new().unwrap();
    let state = App::open_with_auth(
        paths(dir.path()),
        chzzk_core::ClientConfig::default(),
        None,
        chzzk_app_lib::tokio_handle(),
        AuthSetup::Enabled {
            base: WorkerBase::parse(&worker.uri()).unwrap(),
            app_version: "0.1.0".into(),
        },
    )
    .unwrap();
    fixture_with(dir, state)
}

fn save_session(dir: &Path, worker: &MockServer) {
    save_session_at(dir, worker, time::Duration::hours(1));
}

/// `verified_ago` 전에 확인한 세션을 저장한다(access는 확인 24시간 뒤, refresh는 30일 뒤까지)
fn save_session_at(dir: &Path, worker: &MockServer, verified_ago: time::Duration) {
    let verified = time::OffsetDateTime::now_utc() - verified_ago;
    std::fs::create_dir_all(dir.join("config")).unwrap();
    SessionStore::new(
        dir.join("config"),
        &WorkerBase::parse(&worker.uri()).unwrap(),
    )
    .save(&StoredSession {
        channel_id: CH.into(),
        channel_name: "채널".into(),
        is_admin: false,
        access_token: chzzk_core::Secret::new(format!("cda_{}", "A".repeat(43))),
        access_expires_at: verified + time::Duration::hours(24),
        refresh_token: chzzk_core::Secret::new(format!("cdr_{}", "B".repeat(43))),
        refresh_expires_at: verified + time::Duration::days(30),
        verified_at: verified,
    })
    .unwrap();
}

/// `/auth/refresh`가 Worker 형식 JSON 오류로 답하는 서버(재시도 묶음을 타지 않는 즉시 판정, 구현 중 변경 53 (가))
fn refresh_server(status: u16, code: &str) -> MockServer {
    tauri::async_runtime::block_on(async {
        let s = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/auth/refresh"))
            .respond_with(
                ResponseTemplate::new(status)
                    .set_body_raw(json!({ "code": code }).to_string(), "application/json"),
            )
            .mount(&s)
            .await;
        s
    })
}

fn refresh_count(s: &MockServer) -> usize {
    tauri::async_runtime::block_on(s.received_requests())
        .unwrap_or_default()
        .iter()
        .filter(|r| r.url.path() == "/auth/refresh")
        .count()
}

fn open_auth_app(dir: &Path, worker: &MockServer) -> App {
    App::open_with_auth(
        paths(dir),
        chzzk_core::ClientConfig::default(),
        None,
        chzzk_app_lib::tokio_handle(),
        AuthSetup::Enabled {
            base: WorkerBase::parse(&worker.uri()).unwrap(),
            app_version: "0.1.0".into(),
        },
    )
    .unwrap()
}

fn wait_until(what: &str, secs: u64, pred: impl Fn() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while !pred() {
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn disabled_json() -> Value {
    json!({"state":"disabled","channelId":null,"channelName":null,"reason":null,
           "pending":null,"offline":null,"verifiedAt":null,"canReconnect":false})
}

#[test]
fn open_commands_are_known_commands() {
    for c in chzzk_shell::gate::OPEN_COMMANDS {
        assert!(COMMANDS.contains(c), "{c}");
    }
}

#[test]
fn gated_commands_reject_before_sign_in() {
    let worker = worker_server(None);
    let f = fixture_auth(&worker);
    let want = serde_json::to_value(AppError::not_logged_in()).unwrap();
    let mut n = 0;
    for name in COMMANDS {
        if chzzk_shell::gate::is_open(name) {
            continue;
        }
        n += 1;
        // 인자가 없어도(역직렬화 전) 같은 거부여야 한다
        let e = invoke(&f.main, name, json!({})).unwrap_err();
        assert_eq!(e, want, "{name}");
    }
    assert_eq!(n, 17);
}

/// 앱 상태가 없을 때(시작 실패, worker.md 구현 중 변경 55): 허용 목록 밖은 처리기 전에 notLoggedIn(fail closed)
#[test]
fn gate_without_app_state_fails_closed() {
    let (notifier, _rx) = Notifier::new();
    let app = mock_builder()
        .manage(Quitting::default())
        .manage(notifier)
        .manage(AuthIoState(Arc::new(RecordingIo::default())))
        .invoke_handler(handler())
        .build(tauri::generate_context!(test = true))
        .unwrap();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let want = serde_json::to_value(AppError::not_logged_in()).unwrap();
    let mut n = 0;
    for name in COMMANDS {
        if chzzk_shell::gate::is_open(name) {
            continue;
        }
        n += 1;
        assert_eq!(invoke(&main, name, json!({})).unwrap_err(), want, "{name}");
    }
    assert_eq!(n, 17);
    // 허용 목록은 게이트를 지나 처리기로 간다(상태가 없어 처리기 쪽 오류일 수는 있어도 notLoggedIn은 아니다)
    for name in ["app_info", "auth_status", "list_jobs"] {
        if let Err(e) = invoke(&main, name, json!({})) {
            assert_ne!(e, want, "{name}");
        }
    }
}

#[test]
fn open_commands_work_while_signed_out() {
    let worker = worker_server(None);
    let f = fixture_auth(&worker);
    assert_eq!(
        invoke(&f.main, "app_info", json!({})).unwrap()["features"]["auth"],
        json!(true)
    );
    assert_eq!(
        invoke(&f.main, "auth_status", json!({})).unwrap(),
        json!({"state":"signedOut","channelId":null,"channelName":null,"reason":null,
               "pending":null,"offline":null,"verifiedAt":null,"canReconnect":false})
    );
    assert_eq!(invoke(&f.main, "list_jobs", json!({})).unwrap(), json!([]));
    invoke(&f.main, "frontend_ready", json!({})).unwrap();
}

#[test]
fn signed_in_session_opens_the_gate() {
    let worker = worker_server(None);
    let dir = TempDir::new().unwrap();
    save_session(dir.path(), &worker);
    let state = App::open_with_auth(
        paths(dir.path()),
        chzzk_core::ClientConfig::default(),
        None,
        chzzk_app_lib::tokio_handle(),
        AuthSetup::Enabled {
            base: WorkerBase::parse(&worker.uri()).unwrap(),
            app_version: "0.1.0".into(),
        },
    )
    .unwrap();
    let f = fixture_with(dir, state);
    invoke(&f.main, "get_settings", json!({})).unwrap();
    assert_eq!(
        invoke(&f.main, "auth_status", json!({})).unwrap()["state"],
        json!("signedIn")
    );
}

#[test]
fn disabled_build_reports_disabled() {
    let f = fixture();
    assert_eq!(
        invoke(&f.main, "auth_status", json!({})).unwrap(),
        disabled_json()
    );
    assert_eq!(
        invoke(&f.main, "app_info", json!({})).unwrap()["features"]["auth"],
        json!(false)
    );
    assert_eq!(
        invoke(&f.main, "auth_reopen", json!({})).unwrap(),
        json!(false)
    );
    assert_eq!(
        invoke(&f.main, "auth_login", json!({})).unwrap()["state"],
        json!("disabled")
    );
    assert!(f.io.opened.lock().unwrap().is_empty());
}

#[test]
fn auth_login_opens_the_login_url_through_auth_io() {
    let worker2 = worker_server(Some(201));
    let f = fixture_auth(&worker2);
    let url = format!("{}/auth/login/{}", worker2.uri(), "H".repeat(22));
    let st = invoke(&f.main, "auth_login", json!({})).unwrap();
    assert_eq!(st["state"], json!("pending"));
    assert_eq!(st["pending"]["userCode"], json!("K7QX-4MRA"));
    assert_eq!(*f.io.opened.lock().unwrap(), vec![url.clone()]);
    assert_eq!(
        invoke(&f.main, "auth_copy_login_url", json!({})).unwrap(),
        json!(true)
    );
    assert_eq!(*f.io.copied.lock().unwrap(), vec![url]);
    assert_eq!(
        invoke(&f.main, "auth_cancel", json!({})).unwrap()["state"],
        json!("signedOut")
    );
}

#[test]
fn auth_changed_is_emitted_to_the_main_window() {
    let worker = worker_server(Some(503));
    let f = fixture_auth(&worker);
    // main 창을 겨눈 이벤트만 받는 수신기와, 다른 창의 수신기(emit_to("main")이면 아무것도 받지 않는다)
    let got: Arc<Mutex<Vec<Value>>> = Arc::default();
    let seen = got.clone();
    f.main.listen(AUTH_CHANGED, move |e| {
        seen.lock()
            .unwrap()
            .push(serde_json::from_str(e.payload()).unwrap());
    });
    let other = WebviewWindowBuilder::new(&f.app, "other", Default::default())
        .build()
        .unwrap();
    let leaked = Arc::new(AtomicUsize::new(0));
    let l = leaked.clone();
    other.listen(AUTH_CHANGED, move |_| {
        l.fetch_add(1, Ordering::SeqCst);
    });
    let auth = f.app.state::<App>().auth.clone().unwrap();
    spawn_auth_tasks(f.app.handle().clone(), auth);
    let wait = |pred: &dyn Fn(&[Value]) -> bool| {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if pred(&got.lock().unwrap()) {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "auth-changed가 오지 않음: {:?}",
                got.lock().unwrap()
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    };
    // 처음 상태가 먼저 간다(구현 중 변경 54 (가) "시작 때 한 번")
    wait(&|g| !g.is_empty());
    assert_eq!(got.lock().unwrap()[0]["state"], json!("signedOut"));
    let st = invoke(&f.main, "auth_login", json!({})).unwrap();
    assert_eq!(st["state"], json!("error"));
    assert_eq!(st["reason"], json!("network"));
    wait(&|g| g.iter().any(|p| p["state"] == json!("error")));
    assert_eq!(
        leaked.load(Ordering::SeqCst),
        0,
        "다른 창에는 보내지 않는다"
    );
}

/// main 창 포커스 → `tick(Focus)` → refresh(구현 중 변경 56 (다), 65). 갱신 예정이 지난 세션이어야 나간다.
#[test]
fn focus_on_the_main_window_ticks_auth() {
    let worker = refresh_server(401, "session_revoked");
    let dir = TempDir::new().unwrap();
    save_session_at(dir.path(), &worker, time::Duration::hours(25));
    let state = open_auth_app(dir.path(), &worker);
    let f = fixture_with(dir, state);
    // spawn_auth_tasks를 부르지 않는다(시작 refresh가 먼저 시도 시각을 채우지 않게)
    assert!(!on_window_focus(f.app.handle(), "main", false));
    assert!(!on_window_focus(f.app.handle(), "other", true));
    std::thread::sleep(Duration::from_millis(200));
    assert_eq!(refresh_count(&worker), 0);

    assert!(on_window_focus(f.app.handle(), "main", true));
    wait_until("포커스 refresh", 5, || refresh_count(&worker) == 1);
    wait_until("expired", 5, || {
        invoke(&f.main, "auth_status", json!({})).unwrap()["state"] == json!("expired")
    });
    assert_eq!(
        invoke(&f.main, "auth_status", json!({})).unwrap()["reason"],
        json!("revoked")
    );
    let want = serde_json::to_value(AppError::not_logged_in()).unwrap();
    assert_eq!(
        invoke(&f.main, "get_settings", json!({})).unwrap_err(),
        want
    );
}

#[test]
fn focus_does_not_refresh_a_fresh_session_or_a_disabled_build() {
    let worker = refresh_server(401, "session_revoked");
    let dir = TempDir::new().unwrap();
    save_session(dir.path(), &worker);
    let state = open_auth_app(dir.path(), &worker);
    let f = fixture_with(dir, state);
    // 틱은 띄우지만 갱신 예정 전이라 refresh는 나가지 않는다
    assert!(on_window_focus(f.app.handle(), "main", true));
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(refresh_count(&worker), 0);
    assert_eq!(
        invoke(&f.main, "auth_status", json!({})).unwrap()["state"],
        json!("signedIn")
    );

    // 로그인을 쓰지 않는 빌드는 틱을 띄우지 않는다
    let off = fixture();
    assert!(!on_window_focus(off.app.handle(), "main", true));
}

/// `spawn_auth_tasks`의 시작 refresh → `auth-changed`(낙관 signedIn 뒤 expired/revoked).
#[test]
fn spawn_auth_tasks_refreshes_a_saved_session_at_startup() {
    let worker = refresh_server(401, "session_revoked");
    let dir = TempDir::new().unwrap();
    save_session_at(dir.path(), &worker, time::Duration::hours(25));
    let state = open_auth_app(dir.path(), &worker);
    let f = fixture_with(dir, state);
    let got: Arc<Mutex<Vec<Value>>> = Arc::default();
    let seen = got.clone();
    f.main.listen(AUTH_CHANGED, move |e| {
        seen.lock()
            .unwrap()
            .push(serde_json::from_str(e.payload()).unwrap());
    });
    let auth = f.app.state::<App>().auth.clone().unwrap();
    spawn_auth_tasks(f.app.handle().clone(), auth);
    // 첫 값의 순서(낙관 signedIn이 먼저인지)는 단언하지 않는다: 시작 refresh와 전달 태스크가 경쟁한다
    wait_until("시작 refresh -> expired", 5, || {
        got.lock()
            .unwrap()
            .iter()
            .any(|p| p["state"] == json!("expired") && p["reason"] == json!("revoked"))
    });
    assert_eq!(refresh_count(&worker), 1);
    let p = f
        .dir
        .path()
        .join("config")
        .join(chzzk_shell::auth::SESSION_FILE);
    assert!(!p.exists() || std::fs::metadata(&p).unwrap().len() == 0);
}
