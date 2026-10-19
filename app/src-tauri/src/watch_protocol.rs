//! 받기 전 미리보기의 사용자 정의 주소(`watch:`) 배선(docs/design/features/preview.md §6.1, PV-3).
//!
//! 요청을 해석·판정하는 일은 셸 `WatchService::handle`이 한다(Tauri 비의존). 여기는 Tauri 쪽 얇은 층이다:
//! 주소 base·앱 출처(ACAO 값)를 OS·dev 여부로 정하고, 요청을 tokio 태스크에서 셸로 넘겨 응답을 돌려준다.
//! 서명 주소는 이 모듈에도 오지 않는다(셸이 세션 안에서만 쓴다).

use chzzk_shell::App;
use chzzk_shell::watch::ReqCtx;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder, Url};

/// 사용자 정의 scheme 이름. 등록(`register`)과 주소 base(`watch_base_for`)가 이 상수 하나를 쓴다
pub const WATCH_SCHEME: &str = "watch";

/// `watch:` 주소의 base(PV1). Windows(WebView2)는 사용자 정의 scheme을 `http://<scheme>.localhost`로 보인다
pub fn watch_base_for(windows: bool) -> String {
    if windows {
        format!("http://{WATCH_SCHEME}.localhost")
    } else {
        format!("{WATCH_SCHEME}://localhost")
    }
}

/// `watch` scheme 처리기를 Builder에 등록한다(`run()`과 시험이 함께 쓴다)
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(WATCH_SCHEME, protocol)
}

/// 이 빌드의 `watch:` 주소 base
pub fn watch_base() -> String {
    watch_base_for(cfg!(windows))
}

/// 앱 페이지의 출처(= scheme 응답 ACAO에 쓰는 값, PV11).
///
/// 릴리스·`tauri build`는 macOS·Linux가 `tauri://localhost`, Windows가 `http://tauri.localhost`다(`useHttpsScheme`을 쓰지 않는다).
/// dev 실행은 설정 `build.devUrl`의 출처다(경로·쿼리는 버린다). dev인데 devUrl이 없으면 릴리스 값을 쓴다.
pub fn app_origin(is_dev: bool, dev_url: Option<&Url>, windows: bool) -> String {
    match dev_url {
        Some(u) if is_dev => u.origin().ascii_serialization(),
        _ if windows => "http://tauri.localhost".to_string(),
        _ => "tauri://localhost".to_string(),
    }
}

/// 셸에 주소 base와 앱 출처를 알려 준다(setup에서 `App`을 `manage`하기 전에 한 번).
pub fn configure(app: &App, dev_url: Option<&Url>) {
    app.watch.set_endpoints(
        &watch_base(),
        &app_origin(tauri::is_dev(), dev_url, cfg!(windows)),
    );
}

/// 앱 상태가 없을 때(시작 실패 등)의 응답: 어떤 요청도 받지 않는다(fail closed)
fn unavailable() -> Response<Vec<u8>> {
    Response::builder()
        .status(503)
        .header("cache-control", "no-store")
        .body(Vec::new())
        .expect("상수 응답")
}

/// 요청 한 건을 셸에 넘긴다. 창 라벨은 Tauri가 알려 준 값이다. 앱 상태가 없으면 503.
pub async fn serve<R: Runtime>(
    app: &AppHandle<R>,
    webview_label: &str,
    req: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let Some(state) = app.try_state::<App>() else {
        return unavailable();
    };
    state.watch.handle(req, ReqCtx { webview_label }).await
}

/// `register_asynchronous_uri_scheme_protocol("watch", …)`에 넣는 처리기. 웹뷰 스레드를 막지 않게 태스크에서 돈다(PV2).
pub fn protocol<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    req: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    let label = ctx.webview_label().to_string();
    tauri::async_runtime::spawn(async move {
        responder.respond(serve(&app, &label, &req).await);
    });
}
