//! IPC 테스트(app.md §13 `app/src-tauri`, §15-11): mock 런타임에 실제 command 처리기·capabilities
//! (`generate_context!(test = true)`)를 붙여, command 인자의 camelCase, `AppError` 직렬화, 허가 목록,
//! 진행 이벤트 Channel·완료 알림 큐, 창 닫기·앱 종료 가드(mock 이벤트 루프)를 본다.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chzzk_app_lib::commands::begin_quit;
use chzzk_app_lib::sink::{ChannelSink, Notifier};
use chzzk_app_lib::{COMMANDS, Quitting, guard_close, handler, on_run_event};
use chzzk_shell::services::AppPaths;
use chzzk_shell::{App, EventSink};
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, Channel, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::{InvokeRequest, WebviewWindow, WebviewWindowBuilder};
use tauri::{AppHandle, Listener, Manager};
use tempfile::TempDir;
use tokio::sync::mpsc::UnboundedReceiver;
use wiremock::matchers::{any, method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

struct Fixture {
    app: tauri::App<MockRuntime>,
    main: WebviewWindow<MockRuntime>,
    notify_rx: UnboundedReceiver<String>,
    dir: TempDir,
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

/// 실제 처리기·capabilities·창 이벤트 처리를 붙인 mock 앱(창 없음).
fn mock_app(state: App) -> (tauri::App<MockRuntime>, UnboundedReceiver<String>) {
    let (notifier, notify_rx) = Notifier::new();
    let app = mock_builder()
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(state)
        .manage(Quitting::default())
        .manage(notifier)
        .invoke_handler(handler())
        .build(tauri::generate_context!(test = true))
        .unwrap();
    (app, notify_rx)
}

fn fixture_with(dir: TempDir, state: App) -> Fixture {
    let (app, notify_rx) = mock_app(state);
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    Fixture {
        app,
        main,
        notify_rx,
        dir,
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
const VOD_VIDEO_ID: &str = "0000000000000000000000000000000000B02";
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
    let f = fixture();
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
    assert_eq!(f.notify_rx.try_recv().ok().as_deref(), Some("제목"));
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
/// main 창은 루프가 설정(`tauri.conf.json`)대로 만든다. 루프가 30초 안에 끝나지 않으면(닫기·종료가 잘못 막힘)
/// 프로세스를 끝낸다.
///
/// 한 번에 하나만 돈다: Tauri가 macOS 개발 빌드의 `Ready`에서 Dock 아이콘을 AppKit으로 그리는데, 루프 두 개가
/// 테스트 스레드에서 동시에 그리면 AppKit이 죽는다(SIGTRAP, 실측).
fn run_loop<T: Send + 'static>(
    state: App,
    drive: impl FnOnce(AppHandle<MockRuntime>, WebviewWindow<MockRuntime>) -> T + Send + 'static,
) -> T {
    static ONE_LOOP: Mutex<()> = Mutex::new(());
    let _one = ONE_LOOP.lock().unwrap_or_else(|e| e.into_inner());
    let (app, _rx) = mock_app(state);
    let h = app.handle().clone();
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
        drive(h, main)
    });
    app.run_return(on_run_event);
    done.store(true, Ordering::SeqCst);
    driver.join().unwrap()
}

#[test]
fn closing_the_main_window_exits_without_running_jobs() {
    let dir = TempDir::new().unwrap();
    let state = App::open(paths(dir.path()), None, chzzk_app_lib::tokio_handle()).unwrap();
    run_loop(state, |_, main| main.close().unwrap());
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
    let (alive, asked) = run_loop(state, |h, main| {
        let req = serde_json::from_value(enqueue_body(1, "720p", None)["req"].clone()).unwrap();
        let job = h.state::<App>().enqueue(req).unwrap();
        assert_eq!(job.status, chzzk_shell::dto::JobStatus::Running);
        let asked = close_requests(&h);
        main.close().unwrap();
        // mock 루프는 한 바퀴에 1초 쉰다.
        std::thread::sleep(Duration::from_millis(2500));
        let alive = h.get_webview_window("main").is_some();
        let asked = asked.lock().unwrap().clone();
        // 작업을 멈추면 닫힌다. mock 런타임은 `Destroyed` 창 이벤트를 보내지 않아 Tauri 쪽 창 목록에 main이
        // 남으므로, "창이 없어진 뒤의 종료 요청은 막지 않는다"(`close_decision`의 `has_main`)는 여기서 재현하지
        // 못하고 lib.rs 단위 테스트가 본다.
        stop_all(&h);
        main.destroy().unwrap();
        (alive, asked)
    });
    assert!(alive, "받는 중인데 main 창이 닫혔다");
    assert_eq!(asked, vec![json!({ "running": 1 })]);
}
