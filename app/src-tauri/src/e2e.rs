//! 네이티브 E2E 전용(cargo feature `e2e`, docs/design/cicd.md §6 "네이티브 E2E"). 릴리스 빌드에는 이 모듈이 없다:
//! `release-hygiene` gate가 릴리스 바이너리에 `CHZZK_E2E_` 글자가 없고 기본 feature 트리에 `e2e`가 없음을 증명하고,
//! `e2e-native` 작업의 `hygiene-seed`가 이 feature로 만든 바이너리에는 그 글자가 있음(검사가 실제로 잡는다)을 증명한다.
//!
//! 두 환경 변수가 모두 있을 때만 켜진다.
//! - `CHZZK_E2E_API_BASE`: 치지직 API·vodplay 기본 주소. 루프백(`127.0.0.1`·`localhost`·`[::1]`)의 http만 받는다
//!   (`scripts/ci/e2e-fixture-server.mjs`가 `testdata/`를 서빙한다). E2E 빌드가 실수로 퍼져도 외부로 요청하지 않는다.
//! - `CHZZK_E2E_DIR`: 설정·데이터·로그를 이 아래 `config`·`data`·`logs`에 두고, 기본 저장 폴더는 `data/downloads`다
//!   (OS 비디오·다운로드 폴더와 옛 설정을 보지 않는다). 사용자 데이터를 건드리지 않고 결과 파일 위치가 결정적이다.
//!
//! 하나만 있으면 오류로 시작하지 않는다(반쯤 켜진 E2E가 실서버나 사용자 폴더를 쓰지 않게).

use std::ffi::OsString;
use std::path::PathBuf;

use chzzk_core::{ClientConfig, Endpoints, RetryPolicy};
use chzzk_shell::WorkerBase;
use chzzk_shell::services::{AppPaths, PROGRESS_INTERVAL};
use url::Url;

/// API 기본 주소(환경 변수).
pub const API_BASE_ENV: &str = "CHZZK_E2E_API_BASE";
/// 격리 폴더(환경 변수).
pub const DIR_ENV: &str = "CHZZK_E2E_DIR";
/// 로그인 Worker 주소(환경 변수, 루프백 http). 없으면 E2E에서 로그인이 꺼진다(빌드 주소는 쓰지 않는다).
pub const WORKER_BASE_ENV: &str = "CHZZK_E2E_WORKER_BASE";

/// E2E 실행 설정.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct E2eConfig {
    pub api_base: Url,
    pub dir: PathBuf,
    /// 로그인 Worker(루프백 http). 없으면 로그인 꺼짐
    pub worker_base: Option<WorkerBase>,
}

impl E2eConfig {
    /// 환경 변수 값으로 만든다. 둘 다 없으면(빈 값 포함) `Ok(None)`.
    pub fn new(
        api_base: Option<OsString>,
        dir: Option<OsString>,
        worker_base: Option<OsString>,
    ) -> Result<Option<Self>, String> {
        let non_empty = |v: Option<OsString>| v.filter(|s| !s.is_empty());
        let worker_base = non_empty(worker_base);
        match (non_empty(api_base), non_empty(dir)) {
            (None, None) if worker_base.is_some() => Err(format!(
                "E2E: {WORKER_BASE_ENV}는 {API_BASE_ENV}·{DIR_ENV}와 함께 줘야 한다"
            )),
            (None, None) => Ok(None),
            (Some(_), None) | (None, Some(_)) => {
                Err(format!("E2E: {API_BASE_ENV}와 {DIR_ENV}는 함께 줘야 한다"))
            }
            (Some(base), Some(dir)) => {
                let base = base
                    .into_string()
                    .map_err(|_| format!("E2E: {API_BASE_ENV}가 UTF-8이 아니다"))?;
                let mut url =
                    Url::parse(&base).map_err(|e| format!("E2E: {API_BASE_ENV} 해석 실패: {e}"))?;
                let loopback = matches!(
                    url.host_str(),
                    Some("127.0.0.1") | Some("localhost") | Some("[::1]")
                );
                if url.scheme() != "http" || !loopback {
                    return Err(format!(
                        "E2E: {API_BASE_ENV}는 루프백 http 주소여야 한다(받음: {}://{})",
                        url.scheme(),
                        url.host_str().unwrap_or("")
                    ));
                }
                // 기본 주소로 쓰므로 경로는 `/`로 끝나야 한다(`Url::join`이 마지막 조각을 바꾸지 않게)
                if !url.path().ends_with('/') {
                    let p = format!("{}/", url.path());
                    url.set_path(&p);
                }
                let dir = PathBuf::from(dir);
                if !dir.is_absolute() {
                    return Err(format!("E2E: {DIR_ENV}는 절대 경로여야 한다"));
                }
                let worker_base = match worker_base {
                    None => None,
                    Some(w) => {
                        let w = w
                            .into_string()
                            .map_err(|_| format!("E2E: {WORKER_BASE_ENV} 해석 실패"))?;
                        let b = WorkerBase::parse(&w)
                            .map_err(|_| format!("E2E: {WORKER_BASE_ENV} 해석 실패"))?;
                        if !b.origin().starts_with("http://") {
                            return Err(format!(
                                "E2E: {WORKER_BASE_ENV}는 루프백 http 주소여야 한다"
                            ));
                        }
                        Some(b)
                    }
                };
                Ok(Some(E2eConfig {
                    api_base: url,
                    dir,
                    worker_base,
                }))
            }
        }
    }

    /// 지금 프로세스의 환경.
    pub fn from_env() -> Result<Option<Self>, String> {
        Self::new(
            std::env::var_os(API_BASE_ENV),
            std::env::var_os(DIR_ENV),
            std::env::var_os(WORKER_BASE_ENV),
        )
    }

    /// 격리 경로. 기본 저장 폴더는 `{dir}/data/downloads`(OS 폴더를 주지 않는다).
    pub fn paths(&self) -> AppPaths {
        AppPaths::new(
            self.dir.join("config"),
            self.dir.join("data"),
            self.dir.join("logs"),
            None,
            None,
            None,
        )
    }

    /// 앱과 같은 클라이언트 설정에서 엔드포인트만 바꾼다.
    pub fn client(&self) -> ClientConfig {
        ClientConfig {
            endpoints: Endpoints {
                chzzk_api: self.api_base.clone(),
                vodplay_api: self.api_base.clone(),
            },
            progress_interval: PROGRESS_INTERVAL,
            // 가짜 서버가 끊기면 30분 기다리지 않고 바로 실패시킨다(E2E가 CI 제한 시간까지 멈추지 않게)
            retry: RetryPolicy {
                patience: std::time::Duration::ZERO,
                patience_cap: std::time::Duration::ZERO,
                ..RetryPolicy::default()
            },
            ..ClientConfig::default()
        }
    }
}

/// 격리 실행의 로그인 주소 열기·복사(Phase 3b A5, cicd.md 구현 중 변경 106·111): 브라우저를 띄우지 않는다.
/// 브라우저 대신 스텁 확인 페이지의 303 하나를 따라 앱의 루프백 수신기에 GET한다(`follow_login`). Windows 러너에서 Edge가 떠
/// WebView2 세션을 흔들지 않게 한다.
#[derive(Debug, Default)]
pub struct E2eAuthIo {
    opened: std::sync::atomic::AtomicUsize,
}

impl E2eAuthIo {
    /// 열어 달라는 요청을 받은 횟수
    pub fn opened(&self) -> usize {
        self.opened.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl crate::auth_io::AuthIo for E2eAuthIo {
    fn open_url(&self, url: &str) -> bool {
        self.opened
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // 사슬은 별도 스레드에서 돈다: 수신기는 결과를 기다리는 동안 응답을 쥐고 있고, 앱은 spawn한 수령 태스크가 끝나야 응답한다.
        // 주소는 로그에 남기지 않는다(handle은 확인 페이지 자격이다)
        let u = url.to_string();
        let spawned = std::thread::Builder::new()
            .name("e2e-login".into())
            .spawn(move || match follow_login(&u) {
                Ok(status) => tracing::info!(status, "e2e: 로그인 사슬"),
                Err(e) => tracing::warn!(error = %e, "e2e: 로그인 사슬 실패"),
            });
        if spawned.is_err() {
            tracing::warn!("e2e: 로그인 사슬 스레드를 만들지 못함");
        }
        true
    }
    fn copy_text(&self, _text: &str) -> bool {
        true
    }
}

/// 사슬 응답 읽기 기한(수신기가 결과를 15초까지 기다린다)
const CHAIN_READ_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// 최소 HTTP/1.1 GET 한 번 → (상태, Location). 오류 문자열에는 주소를 넣지 않는다(낱말만).
fn http_get(
    connect_host: &str,
    port: u16,
    path_and_query: &str,
    host_header: &str,
) -> Result<(u16, Option<String>), String> {
    use std::io::{Read, Write};
    let mut conn = std::net::TcpStream::connect((connect_host, port)).map_err(|_| "연결 실패")?;
    conn.set_read_timeout(Some(CHAIN_READ_TIMEOUT))
        .map_err(|_| "기한 설정 실패")?;
    let req = format!(
        "GET {path_and_query} HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\n\r\n"
    );
    conn.write_all(req.as_bytes())
        .map_err(|_| "요청 쓰기 실패")?;
    let mut buf = Vec::new();
    conn.read_to_end(&mut buf).map_err(|_| "응답 읽기 실패")?;
    let text = String::from_utf8_lossy(&buf);
    let head = text.split("\r\n\r\n").next().unwrap_or("");
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .and_then(|l| l.split(' ').nth(1))
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or("상태줄 해석 실패")?;
    let location = lines.find_map(|l| {
        let (k, v) = l.split_once(':')?;
        k.eq_ignore_ascii_case("location")
            .then(|| v.trim().to_string())
    });
    Ok((status, location))
}

fn path_and_query(u: &Url) -> String {
    match u.query() {
        Some(q) => format!("{}?{q}", u.path()),
        None => u.path().to_string(),
    }
}

/// 루프백 로그인 사슬 한 번: 스텁 확인 페이지 주소 GET → 303 하나를 따라 수신기에 GET. 수신기 응답 상태를 돌려준다.
/// 첫 주소는 루프백 http만, 303의 Location은 `http://127.0.0.1:<port>/chzzk-downloader/login`만 따른다.
pub fn follow_login(login_url: &str) -> Result<u16, String> {
    let first = Url::parse(login_url).map_err(|_| "주소 해석 실패")?;
    if first.scheme() != "http" {
        return Err("http가 아님".into());
    }
    let (connect_host, host_header_name) = match first.host() {
        Some(url::Host::Ipv4(ip)) if ip.is_loopback() => (ip.to_string(), ip.to_string()),
        Some(url::Host::Domain("localhost")) => ("localhost".to_string(), "localhost".to_string()),
        Some(url::Host::Ipv6(ip)) if ip.is_loopback() => (ip.to_string(), format!("[{ip}]")),
        _ => return Err("루프백 주소가 아님".into()),
    };
    let port = first.port_or_known_default().ok_or("포트 없음")?;
    let (status, location) = http_get(
        &connect_host,
        port,
        &path_and_query(&first),
        &format!("{host_header_name}:{port}"),
    )?;
    if status != 303 {
        return Err("303이 아님".into());
    }
    let target = Url::parse(&location.ok_or("Location 없음")?).map_err(|_| "Location 해석 실패")?;
    let rport = target.port().ok_or("수신기 포트 없음")?;
    if target.scheme() != "http"
        || target.host_str() != Some("127.0.0.1")
        || target.path() != chzzk_shell::auth::LOOPBACK_PATH
    {
        return Err("수신기 주소가 아님".into());
    }
    let (status, _) = http_get(
        "127.0.0.1",
        rport,
        &path_and_query(&target),
        &format!("127.0.0.1:{rport}"),
    )?;
    Ok(status)
}

/// msedgedriver가 WebView2에 디버깅 포트 등을 넘기는 환경 변수(Windows).
pub const WEBVIEW2_ARGS_ENV: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
/// wry가 `additional_browser_args`가 없을 때 쓰는 기본값(wry 0.57 `webview2/mod.rs`). 직접 줄 때 잃지 않게 앞에 둔다.
pub const WRY_DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Windows 네이티브 E2E(cicd.md 구현 중 변경 48): wry는 WebView2 환경을 `AdditionalBrowserArguments`로 직접 만들고 그
/// 값이 msedgedriver가 넣은 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`(`--remote-debugging-port` 등)를 덮어써 세션이
/// `DevToolsActivePort` 시간 초과로 실패했다(실측: WebView2 명령줄에 디버깅 포트가 없었다). 환경 변수가 있으면 wry 기본값
/// 뒤에 붙인 값을 창 설정에 준다. 없거나 비었으면 `None`(설정을 바꾸지 않는다).
pub fn webview2_args(env_value: Option<&str>) -> Option<String> {
    let v = env_value?.trim();
    if v.is_empty() {
        return None;
    }
    Some(format!("{WRY_DEFAULT_ARGS} {v}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(s: &str) -> Option<OsString> {
        Some(OsString::from(s))
    }

    #[cfg(unix)]
    const DIR: &str = "/tmp/e2e";
    #[cfg(windows)]
    const DIR: &str = "C:\\e2e";

    #[test]
    fn e2e_auth_io_open_url_returns_immediately() {
        use crate::auth_io::AuthIo;
        let io = E2eAuthIo::default();
        // 닿지 않는 주소여도 바로 true를 돌려준다(사슬은 별도 스레드에서 돌고 실패는 로그뿐이다)
        assert!(io.open_url("http://127.0.0.1:1/auth/login/x"));
        assert_eq!(io.opened(), 1);
        assert!(io.copy_text("x"));
    }

    /// 요청 머리를 읽고 `response`를 쓴 뒤 요청 텍스트를 돌려주는 한 번짜리 서버
    fn serve_once(response: String) -> (u16, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = l.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut c, _) = l.accept().unwrap();
            let mut req = Vec::new();
            let mut b = [0u8; 256];
            while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = c.read(&mut b).unwrap();
                if n == 0 {
                    break;
                }
                req.extend_from_slice(&b[..n]);
            }
            c.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&req).into_owned()
        });
        (port, h)
    }

    fn redirect(location: &str) -> String {
        format!(
            "HTTP/1.1 303 See Other\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        )
    }

    #[test]
    fn follow_login_follows_one_303_to_the_receiver() {
        let (rport, receiver) = serve_once(
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
        );
        let (sport, stub) = serve_once(redirect(&format!(
            "http://127.0.0.1:{rport}/chzzk-downloader/login?grant=G&state=S"
        )));
        let got = follow_login(&format!("http://127.0.0.1:{sport}/auth/login/x"));
        assert_eq!(got, Ok(200));
        let stub_req = stub.join().unwrap();
        assert!(
            stub_req.starts_with("GET /auth/login/x HTTP/1.1\r\n"),
            "{stub_req}"
        );
        let req = receiver.join().unwrap();
        assert!(
            req.starts_with("GET /chzzk-downloader/login?grant=G&state=S HTTP/1.1\r\n"),
            "{req}"
        );
        // Host는 정확히 `127.0.0.1:<port>`다
        assert!(
            req.lines().any(|l| l == format!("Host: 127.0.0.1:{rport}")),
            "{req}"
        );
    }

    #[test]
    fn follow_login_rejects_foreign_location() {
        let ok_path = "/chzzk-downloader/login?grant=G&state=S";
        let bad = [
            redirect(&format!("http://example.invalid{ok_path}")),
            redirect(&format!("https://127.0.0.1:9{ok_path}")),
            redirect("http://127.0.0.1:9/other?grant=G&state=S"),
            redirect(&format!("http://127.0.0.1{ok_path}")),
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
            "HTTP/1.1 303 See Other\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
        ];
        for (i, resp) in bad.into_iter().enumerate() {
            let (port, h) = serve_once(resp);
            assert!(
                follow_login(&format!("http://127.0.0.1:{port}/auth/login/x")).is_err(),
                "{i}"
            );
            h.join().unwrap();
        }
        // 첫 주소도 루프백 http만 받는다
        assert!(follow_login("http://example.invalid/x").is_err());
        assert!(follow_login("https://127.0.0.1:1/x").is_err());
    }

    #[test]
    fn webview2_args_keep_wry_defaults_and_append_driver_args() {
        assert_eq!(webview2_args(None), None);
        assert_eq!(webview2_args(Some("  ")), None);
        assert_eq!(
            webview2_args(Some("--remote-debugging-port=0")).as_deref(),
            Some(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=0"
            )
        );
    }

    #[test]
    fn both_absent_or_empty_is_off() {
        assert_eq!(E2eConfig::new(None, None, None), Ok(None));
        assert_eq!(E2eConfig::new(os(""), os(""), os("")), Ok(None));
    }

    #[test]
    fn half_configured_is_an_error() {
        assert!(E2eConfig::new(os("http://127.0.0.1:1/"), None, None).is_err());
        assert!(E2eConfig::new(None, os(DIR), None).is_err());
    }

    #[test]
    fn only_loopback_http() {
        for bad in [
            "https://127.0.0.1:1/",
            "http://api.chzzk.naver.com/",
            "http://10.0.0.1/",
            "nope",
        ] {
            assert!(E2eConfig::new(os(bad), os(DIR), None).is_err(), "{bad}");
        }
        for good in [
            "http://127.0.0.1:4321/",
            "http://localhost:1/",
            "http://[::1]:2/",
        ] {
            assert!(
                E2eConfig::new(os(good), os(DIR), None).unwrap().is_some(),
                "{good}"
            );
        }
    }

    #[test]
    fn worker_base_needs_the_rest() {
        assert!(E2eConfig::new(None, None, os("http://127.0.0.1:1")).is_err());
    }

    #[test]
    fn worker_base_is_loopback_http_only() {
        let api = os("http://127.0.0.1:4321/");
        for good in [
            "http://127.0.0.1:8787",
            "http://localhost:1",
            "http://[::1]:2",
        ] {
            let c = E2eConfig::new(api.clone(), os(DIR), os(good))
                .unwrap()
                .unwrap();
            assert_eq!(c.worker_base.unwrap().origin(), good);
        }
        for bad in [
            "https://127.0.0.1:1",
            "http://10.0.0.1",
            "nope",
            "http://127.0.0.1:1/x",
        ] {
            assert!(
                E2eConfig::new(api.clone(), os(DIR), os(bad)).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn worker_base_absent_keeps_auth_off() {
        let c = E2eConfig::new(os("http://127.0.0.1:4321/"), os(DIR), None)
            .unwrap()
            .unwrap();
        assert_eq!(c.worker_base, None);
    }

    #[test]
    fn relative_dir_is_an_error() {
        assert!(E2eConfig::new(os("http://127.0.0.1:1/"), os("rel"), None).is_err());
    }

    #[test]
    fn base_gets_trailing_slash_and_paths_are_isolated() {
        let c = E2eConfig::new(os("http://127.0.0.1:9/x"), os(DIR), None)
            .unwrap()
            .unwrap();
        assert_eq!(c.api_base.as_str(), "http://127.0.0.1:9/x/");
        let p = c.paths();
        assert_eq!(p.config, PathBuf::from(DIR).join("config"));
        assert_eq!(p.data, PathBuf::from(DIR).join("data"));
        assert_eq!(p.log, PathBuf::from(DIR).join("logs"));
        assert_eq!(
            p.default_download,
            PathBuf::from(DIR).join("data").join("downloads")
        );
        let cl = c.client();
        assert_eq!(cl.endpoints.chzzk_api, c.api_base);
        assert_eq!(cl.endpoints.vodplay_api, c.api_base);
        assert_eq!(cl.progress_interval, PROGRESS_INTERVAL);
    }
}
