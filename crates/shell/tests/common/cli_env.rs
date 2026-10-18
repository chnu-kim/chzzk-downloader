//! 명령줄(`cli`) 테스트 공용 도구: 가짜 치지직 API·Worker(wiremock), 거짓 느린 미디어 서버(raw TCP), `cli::run` 실행기.
//!
//! `App`은 제네릭이 아니라(실제 `Chzzk` 클라이언트) 가짜 Backend를 끼울 수 없다. 그래서 `app_auth.rs`·`app_ownership.rs`와 같이
//! 127.0.0.1 mock 서버를 상대로 돌린다.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chzzk_core::{ClientConfig, Endpoints, RetryPolicy, Secret};
use chzzk_shell::auth::{DelegatedChannel, SessionStore, StoredSession, WorkerBase};
use chzzk_shell::cli::{self, CtrlC, Env, OpenUrl};
use chzzk_shell::power::SleepGuard;
use chzzk_shell::services::AppPaths;
use chzzk_shell::{App, AuthSetup, OpenOptions};
use time::OffsetDateTime;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc::{UnboundedSender, unbounded_channel};
use url::Url;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// fixture 영상의 채널
pub const OWN: &str = "000000000000000000000000000000b2";
/// 로그인한 다른 채널
pub const OTHER: &str = "000000000000000000000000000000a1";
/// 맡은 채널이 있는 편집자
pub const EDITOR: &str = "000000000000000000000000000000c3";
pub const VOD_NO: u64 = 9000002;
pub const VOD_VIDEO_ID: &str = "000000000000000000000000000000000B02";
pub const QUALITY: &str = "PD_720P_TEST";
pub const QUALITY_LOW: &str = "PD_480P_TEST";
pub const MEDIA_PATH: &str = "/m1/pd/a.mp4";
/// 오디오 트랙 경로(`audio: true`일 때만 MPD에 있다)
pub const AUDIO_PATH: &str = "/m1/audio/0.m4a";
/// 가짜 미디어 본문 길이
pub const MEDIA_LEN: usize = 50_000;
/// 가짜 오디오 본문 길이
pub const AUDIO_LEN: usize = 20_000;

pub fn url() -> String {
    format!("https://chzzk.naver.com/video/{VOD_NO}")
}

fn fixture(rel: &str) -> Vec<u8> {
    let p = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&p).unwrap_or_else(|e| panic!("{p}: {e}"))
}

fn pd_mpd(url: &str, audio_url: Option<&str>, second_quality: bool) -> String {
    // 화질이 둘이면 480p도 같은 미디어 파일을 가리킨다(화질 라벨만 다른 요청을 만들 때 쓴다)
    let low = if second_quality {
        format!(
            r#"
      <Representation id="{QUALITY_LOW}" bandwidth="500" width="854" height="480">
        <nvod:Label kind="resolution">480</nvod:Label>
        <BaseURL>{url}</BaseURL>
      </Representation>"#
        )
    } else {
        String::new()
    };
    let audio = audio_url.map_or_else(String::new, |u| {
        format!(
            r#"
    <AdaptationSet mimeType="audio/mp4">
      <Representation id="00000000-0000-0000-0000-0000000000b3" bandwidth="128000" mimeType="audio/mp4" codecs="mp4a.40.2" audioSamplingRate="48000">
        <nvod:Label kind="qualityId">AUDIO_128</nvod:Label>
        <BaseURL>{u}</BaseURL>
      </Representation>
    </AdaptationSet>"#
        )
    });
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:nvod="urn:naver:vod:2020">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="{QUALITY}" bandwidth="1000" width="1280" height="720">
        <nvod:Label kind="resolution">720</nvod:Label>
        <BaseURL>{url}</BaseURL>
      </Representation>{low}
    </AdaptationSet>{audio}
  </Period>
</MPD>"#
    )
}

/// 가짜 치지직 API. `media_base`가 없으면 같은 서버가 `MEDIA_LEN`바이트를 준다(느린 미디어는 `RawMedia`를 넘긴다).
/// `channelless`면 info에 컨텐츠 채널 ID가 없다.
pub async fn mock_api(media_base: Option<&str>, channelless: bool) -> MockServer {
    mock_api_with(media_base, channelless, false).await
}

/// `audio`가 true면 일반 VOD처럼 MPD에 서버 오디오 트랙(m4a 한 파일)도 있다.
pub async fn mock_api_with(media_base: Option<&str>, channelless: bool, audio: bool) -> MockServer {
    mock_api_full(media_base, channelless, audio, false).await
}

/// `second_quality`가 true면 720p 말고 480p도 있다(같은 미디어 파일).
pub async fn mock_api_full(
    media_base: Option<&str>,
    channelless: bool,
    audio: bool,
    second_quality: bool,
) -> MockServer {
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
    let base = media_base.map_or_else(|| server.uri(), str::to_string);
    Mock::given(method("GET"))
        .and(path(format!(
            "/neonplayer/vodplay/v2/playback/{VOD_VIDEO_ID}"
        )))
        .respond_with(
            ResponseTemplate::new(200).set_body_raw(
                pd_mpd(
                    &format!("{base}{MEDIA_PATH}?_lsu_sa_=sig"),
                    audio
                        .then(|| format!("{base}{AUDIO_PATH}?_lsu_sa_=sig"))
                        .as_deref(),
                    second_quality,
                ),
                "application/dash+xml",
            ),
        )
        .mount(&server)
        .await;
    if audio {
        Mock::given(method("GET"))
            .and(path(AUDIO_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![2u8; AUDIO_LEN]))
            .mount(&server)
            .await;
    }
    Mock::given(method("GET"))
        .and(path(MEDIA_PATH))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![1u8; MEDIA_LEN]))
        .mount(&server)
        .await;
    server
}

/// 첫 연결은 `first_partial`바이트만 보내고 멈추는 미디어 서버. 다음 연결은 Range를 지켜 끝까지 준다.
pub struct RawMedia {
    pub addr: SocketAddr,
    /// 받은 요청의 `Range` 시작 위치(없으면 None), 연결 순서대로
    pub ranges: Arc<Mutex<Vec<Option<u64>>>>,
    pub accepted: Arc<AtomicUsize>,
}

impl RawMedia {
    pub async fn start(first_partial: usize) -> Self {
        let l = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let addr = l.local_addr().unwrap();
        let ranges: Arc<Mutex<Vec<Option<u64>>>> = Arc::default();
        let accepted = Arc::new(AtomicUsize::new(0));
        let (r2, a2) = (ranges.clone(), accepted.clone());
        tokio::spawn(async move {
            loop {
                let Ok((mut s, _)) = l.accept().await else {
                    return;
                };
                let nth = a2.fetch_add(1, Ordering::SeqCst);
                let r3 = r2.clone();
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut buf = [0u8; 1024];
                    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                        match s.read(&mut buf).await {
                            Ok(0) | Err(_) => return,
                            Ok(n) => head.extend_from_slice(&buf[..n]),
                        }
                    }
                    let text = String::from_utf8_lossy(&head).to_ascii_lowercase();
                    let start = text
                        .lines()
                        .find_map(|l| l.strip_prefix("range: bytes="))
                        .and_then(|v| v.split('-').next())
                        .and_then(|v| v.trim().parse::<u64>().ok());
                    r3.lock().unwrap().push(start);
                    let from = start.unwrap_or(0) as usize;
                    let rest = MEDIA_LEN - from;
                    let resp = if start.is_some() {
                        format!(
                            "HTTP/1.1 206 Partial Content\r\nContent-Length: {rest}\r\nContent-Range: bytes {from}-{}/{MEDIA_LEN}\r\nAccept-Ranges: bytes\r\n\r\n",
                            MEDIA_LEN - 1
                        )
                    } else {
                        format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {MEDIA_LEN}\r\nAccept-Ranges: bytes\r\n\r\n"
                        )
                    };
                    let _ = s.write_all(resp.as_bytes()).await;
                    if nth == 0 {
                        // 처음 연결: 일부만 보내고 멈춘다(받는 중에 Ctrl+C를 누르는 상황)
                        let _ = s.write_all(&vec![1u8; first_partial]).await;
                        let _ = s.flush().await;
                        tokio::time::sleep(Duration::from_secs(120)).await;
                    } else {
                        let _ = s.write_all(&vec![1u8; rest]).await;
                        let _ = s.flush().await;
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                });
            }
        });
        RawMedia {
            addr,
            ranges,
            accepted,
        }
    }

    pub fn base(&self) -> String {
        format!("http://{}", self.addr)
    }
}

pub fn paths(root: &Path) -> AppPaths {
    AppPaths::new(
        root.join("config"),
        root.join("data"),
        root.join("log"),
        None,
        None,
        None,
    )
}

pub fn config(server: &MockServer) -> ClientConfig {
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

pub fn worker_setup(worker: &MockServer) -> AuthSetup {
    AuthSetup::Enabled {
        base: WorkerBase::parse(&worker.uri()).unwrap(),
        app_version: "0.1.0".into(),
    }
}

/// 명령줄이 여는 방식(자동 이어받기 끔)으로 연다. `worker`가 없으면 로그인을 쓰지 않는다.
pub fn open_cli(root: &Path, api: &MockServer, worker: Option<&MockServer>) -> App {
    let auth = worker.map_or(AuthSetup::Disabled, worker_setup);
    App::open_with_options(
        paths(root),
        config(api),
        None,
        tokio::runtime::Handle::current(),
        auth,
        OpenOptions { auto_resume: false },
    )
    .unwrap()
}

/// GUI가 여는 방식으로 연다(세션 공유 확인용).
pub fn open_gui(root: &Path, api: &MockServer, worker: &MockServer) -> App {
    App::open_with_auth(
        paths(root),
        config(api),
        None,
        tokio::runtime::Handle::current(),
        worker_setup(worker),
    )
    .unwrap()
}

/// 디스크 세션. `verified_ago`가 72시간을 넘으면 열 때 서버로 확인(`Checking`)한다.
pub fn save_session_at(
    root: &Path,
    worker: &MockServer,
    channel: &str,
    is_admin: bool,
    delegated: &[&str],
    verified_ago: time::Duration,
) {
    std::fs::create_dir_all(root.join("config")).unwrap();
    let verified = OffsetDateTime::now_utc() - verified_ago;
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
        refresh_expires_at: OffsetDateTime::now_utc() + time::Duration::days(20),
        verified_at: verified,
        delegated_channels: delegated
            .iter()
            .map(|id| DelegatedChannel {
                channel_id: id.to_string(),
                channel_name: "맡은채널".into(),
            })
            .collect(),
    })
    .unwrap();
}

/// 방금 확인한 세션
pub fn save_session(root: &Path, worker: &MockServer, channel: &str) {
    save_session_at(root, worker, channel, false, &[], time::Duration::hours(1));
}

/// `GET /api/me`를 목으로 건다(맡은 채널 확인).
pub async fn mock_me(worker: &MockServer, channel: &str, delegated: &[&str]) {
    Mock::given(method("GET"))
        .and(path("/api/me"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
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
            .to_string(),
            "application/json",
        ))
        .mount(worker)
        .await;
}

/// `/auth/refresh` 200(이 실행에서 받은 묶음)
pub async fn mock_refresh(worker: &MockServer, channel: &str, is_admin: bool) {
    use time::format_description::well_known::Rfc3339;
    let now = OffsetDateTime::now_utc();
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
}

pub async fn count(server: &MockServer, p: &str) -> usize {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path() == p)
        .count()
}

pub async fn total(server: &MockServer) -> usize {
    server.received_requests().await.unwrap().len()
}

/// 신호 보내는 쪽과 `cli::run`이 받는 쪽
pub fn ctrl() -> (UnboundedSender<()>, CtrlC) {
    unbounded_channel()
}

/// 실행 결과
#[derive(Debug)]
pub struct Ran {
    pub code: u8,
    pub out: String,
    pub err: String,
}

/// 브라우저 열기 기록. `ok`가 false면 열기에 실패한 것처럼 돌려준다.
pub fn recording_open(log: Arc<Mutex<Vec<String>>>, ok: bool) -> OpenUrl {
    Box::new(move |u: &str| {
        log.lock().unwrap().push(u.to_string());
        ok
    })
}

/// 잠자기 방지 가드 호출 기록
#[derive(Clone, Default)]
pub struct GuardLog(pub Arc<Mutex<Vec<String>>>);

impl SleepGuard for GuardLog {
    fn acquire(&mut self, _reason: &str) -> Result<(), String> {
        self.0.lock().unwrap().push("acquire".into());
        Ok(())
    }

    fn release(&mut self) {
        self.0.lock().unwrap().push("release".into());
    }
}

/// 인자를 해석해 `cli::run`을 돌린다(해석 실패는 사용법 오류 2로 같은 출력).
pub async fn run_with(
    app: &App,
    args: &[&str],
    cwd: &Path,
    ctrl: &mut CtrlC,
    open: Option<OpenUrl>,
    power: Option<Box<dyn SleepGuard>>,
) -> Ran {
    let mut out = Vec::new();
    let mut err = Vec::new();
    let code = match cli::parse(args.iter().map(std::ffi::OsString::from)) {
        Ok(cmd) => {
            let mut env = Env {
                out: &mut out,
                err: &mut err,
                tty: false,
                cwd: cwd.to_path_buf(),
                version: "0.0.0-test".into(),
                open_url: open,
                power,
            };
            cli::run(app, cmd, &mut env, ctrl).await
        }
        Err(e) => {
            use std::io::Write;
            let _ = writeln!(err, "{e}");
            cli::exit::USAGE
        }
    };
    Ran {
        code,
        out: String::from_utf8(out).unwrap(),
        err: String::from_utf8(err).unwrap(),
    }
}

/// 신호 없이 돌린다.
pub async fn run(app: &App, args: &[&str], cwd: &Path) -> Ran {
    let (_tx, mut rx) = ctrl();
    run_with(app, args, cwd, &mut rx, None, None).await
}

/// `jobs.json`(디스크). `cli::run`이 돌아온 직후 읽는다 — flush를 해야 최신이다.
pub fn jobs_json(root: &Path) -> serde_json::Value {
    let p: PathBuf = root.join("data/jobs.json");
    match std::fs::read(&p) {
        Ok(b) => serde_json::from_slice(&b).unwrap(),
        Err(_) => serde_json::json!({"jobs": []}),
    }
}

pub fn job_statuses(root: &Path) -> Vec<String> {
    jobs_json(root)["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|j| j["status"].as_str().unwrap().to_string())
        .collect()
}
