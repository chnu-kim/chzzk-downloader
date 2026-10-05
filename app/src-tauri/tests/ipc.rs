//! IPC 테스트(app.md §13 `app/src-tauri`, §15-11): mock 런타임에 실제 command 처리기·capabilities
//! (`generate_context!(test = true)`)를 붙여, command 인자의 camelCase, `AppError` 직렬화, 허가 목록을 본다.

use std::path::Path;
use std::sync::atomic::Ordering;

use chzzk_app_lib::sink::Notifier;
use chzzk_app_lib::{COMMANDS, Quitting, guard_close, handler};
use chzzk_shell::App;
use chzzk_shell::services::AppPaths;
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder};
use tauri::webview::{InvokeRequest, WebviewWindow, WebviewWindowBuilder};
use tauri::{Listener, Manager};
use tempfile::TempDir;

struct Fixture {
    app: tauri::App<MockRuntime>,
    main: WebviewWindow<MockRuntime>,
    _dir: TempDir,
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

fn fixture_with(dir: TempDir, state: App) -> Fixture {
    let (notifier, _rx) = Notifier::new();
    let app = mock_builder()
        .manage(state)
        .manage(Quitting::default())
        .manage(notifier)
        .invoke_handler(handler())
        .build(tauri::generate_context!(test = true))
        .unwrap();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    Fixture {
        app,
        main,
        _dir: dir,
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

#[test]
fn close_is_not_guarded_without_running_jobs() {
    let f = fixture();
    let h = f.app.handle();
    let fired = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let seen = fired.clone();
    h.listen_any(chzzk_app_lib::CLOSE_REQUESTED, move |_| {
        seen.store(true, Ordering::SeqCst)
    });
    assert!(!guard_close(h));
    assert!(!fired.load(Ordering::SeqCst));
    // quit 중에는 상태와 무관하게 막지 않는다.
    h.state::<Quitting>().0.store(true, Ordering::SeqCst);
    assert!(!guard_close(h));
}

#[test]
fn close_is_guarded_while_a_job_runs() {
    use std::time::Duration;
    use wiremock::{Mock, MockServer, ResponseTemplate, matchers::any};

    // 영상 정보 요청에 오래 답하지 않는 서버: 작업이 `running`에 머문다.
    let server = tauri::async_runtime::block_on(async {
        let s = MockServer::start().await;
        Mock::given(any())
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
            .mount(&s)
            .await;
        s
    });
    let base = url::Url::parse(&server.uri()).unwrap();
    let dir = TempDir::new().unwrap();
    let state = App::open_with(
        paths(dir.path()),
        chzzk_core::ClientConfig {
            endpoints: chzzk_core::Endpoints {
                chzzk_api: base.clone(),
                vodplay_api: base,
            },
            ..chzzk_core::ClientConfig::default()
        },
        None,
        chzzk_app_lib::tokio_handle(),
    )
    .unwrap();
    let f = fixture_with(dir, state);
    let job = invoke(
        &f.main,
        "enqueue",
        json!({ "req": {
            "url": "https://chzzk.naver.com/video/1",
            "content": { "kind": "video", "videoNo": 1 },
            "title": "제목",
            "channelName": "채널",
            "channelId": null,
            "qualityId": "720p",
            "qualityLabel": "720p",
            "expectedKind": "progressive",
            "folder": null,
            "fileName": "제목",
            "onExisting": "overwrite",
            "restart": false,
        } }),
    )
    .unwrap();
    assert_eq!(job["status"], json!("running"));

    let h = f.app.handle();
    let payload = std::sync::Arc::new(std::sync::Mutex::new(None::<String>));
    let seen = payload.clone();
    h.listen_any(chzzk_app_lib::CLOSE_REQUESTED, move |e| {
        *seen.lock().unwrap() = Some(e.payload().to_string());
    });
    assert!(guard_close(h));
    assert_eq!(
        payload
            .lock()
            .unwrap()
            .as_deref()
            .map(|p| serde_json::from_str::<Value>(p).unwrap()),
        Some(json!({ "running": 1 }))
    );

    // quit 중에는 막지 않는다.
    h.state::<Quitting>().0.store(true, Ordering::SeqCst);
    assert!(!guard_close(h));
    tauri::async_runtime::block_on(h.state::<App>().manager.quit(Duration::from_secs(3)));
}
