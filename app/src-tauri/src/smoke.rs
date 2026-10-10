//! 기동 스모크 `--smoke`(docs/design/cicd.md §6). CI가 실제 바이너리·webview를 띄워 프런트가 dist를 읽고
//! CSP를 지나 IPC로 `frontend_ready`를 부르는지 본다.
//!
//! - 데이터·설정·로그는 임시 폴더(`CHZZK_SMOKE_DIR`, 없으면 `<temp>/chzzk-smoke-<pid>`)에 둔다. 사용자 데이터를
//!   건드리지 않고, 이미 떠 있는 앱과 부딪히지 않도록 single-instance를 쓰지 않으며, 이전 버전 가져오기를 끈다.
//! - 프런트가 `frontend_ready`를 부르면 `CHZZK_SMOKE_OUT`에 마커를 쓰고 exit 0. 마커는 한 줄 JSON이고 키 집합이
//!   고정이다(사전순): `auth`, `probe`(엔진 기능 프로브 다섯 키), `ready`, `t_ready_ms`, `t_show_ms`, `version`.
//!   `t_*`는 프로세스 시작부터의 ms(출력만 하고 판정하지 않는다, 관찰).
//! - `SMOKE_TIMEOUT` 안에 오지 않으면 `ready:false` 마커(`probe`·`t_*`는 `null`)를 쓰고 exit `EXIT_TIMEOUT`(2).
//!
//! 네트워크를 쓰지 않는다. 판정은 종료 코드와 마커 JSON뿐이다(`scripts/ci/smoke.mjs`).

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::time::Duration;

use chzzk_shell::dto::EngineProbe;

/// 스모크를 켜는 명령행 인자.
pub const SMOKE_FLAG: &str = "--smoke";
/// 마커 JSON을 쓸 파일 경로(환경 변수). 없으면 마커를 쓰지 않고 종료 코드만 남긴다.
pub const SMOKE_OUT_ENV: &str = "CHZZK_SMOKE_OUT";
/// 임시 데이터 폴더(환경 변수). 없으면 `<temp>/chzzk-smoke-<pid>`.
pub const SMOKE_DIR_ENV: &str = "CHZZK_SMOKE_DIR";
/// 프런트 `frontend_ready`를 기다리는 시간.
pub const SMOKE_TIMEOUT: Duration = Duration::from_secs(60);
/// 시간 초과 종료 코드.
pub const EXIT_TIMEOUT: i32 = 2;
/// 마커를 쓰지 못했을 때의 종료 코드.
pub const EXIT_MARKER: i32 = 3;

/// 명령행(프로그램 이름 제외)에 `--smoke`가 있는지.
pub fn wants_smoke<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    args.into_iter().any(|a| a.into() == SMOKE_FLAG)
}

/// 스모크 설정. `run`이 명령행·환경에서 만든다.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SmokeConfig {
    /// 마커 파일.
    pub out: Option<PathBuf>,
    /// 임시 데이터 폴더(config·data·log를 이 아래에 둔다).
    pub dir: PathBuf,
}

impl SmokeConfig {
    /// 환경 변수 값으로 만든다. 빈 값은 없는 것으로 본다.
    pub fn new(out: Option<OsString>, dir: Option<OsString>, temp: &Path, pid: u32) -> Self {
        let non_empty = |v: Option<OsString>| v.filter(|s| !s.is_empty()).map(PathBuf::from);
        SmokeConfig {
            out: non_empty(out),
            dir: non_empty(dir).unwrap_or_else(|| temp.join(format!("chzzk-smoke-{pid}"))),
        }
    }

    /// 지금 프로세스의 명령행·환경. `--smoke`가 없으면 `None`.
    pub fn from_env() -> Option<Self> {
        if !wants_smoke(std::env::args_os().skip(1)) {
            return None;
        }
        Some(SmokeConfig::new(
            std::env::var_os(SMOKE_OUT_ENV),
            std::env::var_os(SMOKE_DIR_ENV),
            &std::env::temp_dir(),
            std::process::id(),
        ))
    }

    pub fn config_dir(&self) -> PathBuf {
        self.dir.join("config")
    }
    pub fn data_dir(&self) -> PathBuf {
        self.dir.join("data")
    }
    pub fn log_dir(&self) -> PathBuf {
        self.dir.join("logs")
    }
}

/// 마커 JSON(한 줄). 키는 사전순 여섯 개 고정(`auth`, `probe`, `ready`, `t_ready_ms`, `t_show_ms`, `version`).
/// 성공 마커는 `probe`(다섯 키)와 `t_*`를 싣고, 시간 초과 마커(`ready:false`)는 셋 다 `null`이다.
/// 버전은 semver 글자라 따옴표·역슬래시가 없지만 그래도 JSON 문자열로 이스케이프한다.
pub fn marker_json(
    version: &str,
    ready: bool,
    auth: bool,
    probe: Option<&EngineProbe>,
    t_show_ms: Option<u64>,
    t_ready_ms: Option<u64>,
) -> String {
    let escaped: String = version
        .chars()
        .flat_map(|c| match c {
            '"' => vec!['\\', '"'],
            '\\' => vec!['\\', '\\'],
            c if c.is_control() => format!("\\u{:04x}", c as u32).chars().collect(),
            c => vec![c],
        })
        .collect();
    let probe = probe
        .and_then(|p| serde_json::to_string(p).ok())
        .unwrap_or_else(|| "null".to_string());
    let ms = |v: Option<u64>| v.map_or_else(|| "null".to_string(), |n| n.to_string());
    format!(
        "{{\"auth\":{auth},\"probe\":{probe},\"ready\":{ready},\"t_ready_ms\":{},\"t_show_ms\":{},\"version\":\"{escaped}\"}}\n",
        ms(t_ready_ms),
        ms(t_show_ms),
    )
}

/// 마커를 쓴다. 경로가 없으면 아무것도 하지 않는다.
pub fn write_marker(
    out: Option<&Path>,
    version: &str,
    ready: bool,
    auth: bool,
    probe: Option<&EngineProbe>,
    t_show_ms: Option<u64>,
    t_ready_ms: Option<u64>,
) -> std::io::Result<()> {
    match out {
        Some(p) => std::fs::write(
            p,
            marker_json(version, ready, auth, probe, t_show_ms, t_ready_ms),
        ),
        None => Ok(()),
    }
}

/// 감시 결과.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Watch {
    /// 시간 안에 `frontend_ready`가 왔다.
    Ready,
    /// 시간 초과.
    TimedOut,
    /// 보내는 쪽이 사라졌다(앱이 다른 이유로 끝나는 중). 감시자는 아무것도 하지 않는다.
    Closed,
}

/// `frontend_ready` 신호를 `timeout`까지 기다린다.
pub fn wait_ready(rx: &Receiver<()>, timeout: Duration) -> Watch {
    match rx.recv_timeout(timeout) {
        Ok(()) => Watch::Ready,
        Err(RecvTimeoutError::Timeout) => Watch::TimedOut,
        Err(RecvTimeoutError::Disconnected) => Watch::Closed,
    }
}

/// 앱 상태로 `manage`하는 스모크 상태. `frontend_ready` command가 읽는다.
#[derive(Debug)]
pub struct SmokeState {
    pub config: SmokeConfig,
    fired: AtomicBool,
    tx: Mutex<Option<Sender<()>>>,
}

impl SmokeState {
    /// 상태와 감시자가 기다릴 수신단.
    pub fn new(config: SmokeConfig) -> (Self, Receiver<()>) {
        let (tx, rx) = channel();
        (
            SmokeState {
                config,
                fired: AtomicBool::new(false),
                tx: Mutex::new(Some(tx)),
            },
            rx,
        )
    }

    /// 첫 호출에만 `true`(프런트가 두 번 불러도 마커는 한 번). 감시자에게 신호를 보낸다.
    pub fn fire(&self) -> bool {
        if self.fired.swap(true, Ordering::SeqCst) {
            return false;
        }
        if let Some(tx) = self.tx.lock().ok().and_then(|mut g| g.take()) {
            let _ = tx.send(());
        }
        true
    }
}

/// 감시 스레드: 시간 안에 신호가 없으면 마커(`ready:false`)를 쓰고 프로세스를 `EXIT_TIMEOUT`으로 끝낸다.
pub fn spawn_watchdog(rx: Receiver<()>, out: Option<PathBuf>, version: String, timeout: Duration) {
    std::thread::spawn(move || {
        if wait_ready(&rx, timeout) == Watch::TimedOut {
            let _ = write_marker(out.as_deref(), &version, false, false, None, None, None);
            eprintln!(
                "smoke: {}초 안에 frontend_ready가 오지 않음",
                timeout.as_secs()
            );
            std::process::exit(EXIT_TIMEOUT);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smoke_flag_is_exact_argument() {
        assert!(wants_smoke(["--smoke"]));
        assert!(wants_smoke(["x", "--smoke"]));
        assert!(!wants_smoke(Vec::<String>::new()));
        assert!(!wants_smoke(["--smoke=1", "-smoke", "smoke"]));
    }

    #[test]
    fn config_uses_env_or_temp_pid_folder() {
        let temp = Path::new("/tmp/t");
        let c = SmokeConfig::new(None, None, temp, 42);
        assert_eq!(c.out, None);
        assert_eq!(c.dir, temp.join("chzzk-smoke-42"));
        assert_eq!(c.data_dir(), temp.join("chzzk-smoke-42").join("data"));
        let c = SmokeConfig::new(Some("m.json".into()), Some("/d".into()), temp, 1);
        assert_eq!(c.out.as_deref(), Some(Path::new("m.json")));
        assert_eq!(c.dir, PathBuf::from("/d"));
        // 빈 값은 없는 것
        let c = SmokeConfig::new(Some("".into()), Some("".into()), temp, 7);
        assert_eq!(c.out, None);
        assert_eq!(c.dir, temp.join("chzzk-smoke-7"));
    }

    const PROBE: EngineProbe = EngineProbe {
        color_mix: true,
        has: true,
        oklch: true,
        container_query: true,
        inert: true,
    };

    #[test]
    fn marker_is_one_line_json_with_six_sorted_keys() {
        let m = marker_json("0.1.0", true, true, Some(&PROBE), Some(180), Some(250));
        assert!(m.ends_with("}\n") && m.matches('\n').count() == 1);
        let v: serde_json::Value = serde_json::from_str(&m).unwrap();
        let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        let mut sorted = keys.clone();
        sorted.sort_unstable();
        assert_eq!(
            sorted,
            [
                "auth",
                "probe",
                "ready",
                "t_ready_ms",
                "t_show_ms",
                "version"
            ]
        );
        assert_eq!(v["version"], "0.1.0");
        assert_eq!(v["ready"], true);
        assert_eq!(v["auth"], true);
        assert_eq!(v["t_show_ms"], 180);
        assert_eq!(v["t_ready_ms"], 250);
        let probe = v["probe"].as_object().unwrap();
        let mut pk: Vec<&str> = probe.keys().map(String::as_str).collect();
        pk.sort_unstable();
        assert_eq!(pk, ["colorMix", "containerQuery", "has", "inert", "oklch"]);
        assert!(probe.values().all(|b| b == true));
        // 앞에서부터 사전순으로 쓴다
        let order: Vec<usize> = [
            "auth",
            "probe",
            "ready",
            "t_ready_ms",
            "t_show_ms",
            "version",
        ]
        .iter()
        .map(|k| m.find(&format!("\"{k}\":")).unwrap())
        .collect();
        assert!(order.windows(2).all(|w| w[0] < w[1]), "{m}");
    }

    #[test]
    fn marker_escapes_the_version() {
        let m = marker_json("a\"b\\", false, false, None, None, None);
        let v: serde_json::Value = serde_json::from_str(&m).unwrap();
        assert_eq!(v["version"], "a\"b\\");
    }

    // 시간 초과 마커: ready=false, probe·t_*는 null
    #[test]
    fn timeout_marker_has_null_probe_and_times() {
        let m = marker_json("0.1.0", false, false, None, None, None);
        let v: serde_json::Value = serde_json::from_str(&m).unwrap();
        assert_eq!(v["ready"], false);
        assert!(v["probe"].is_null());
        assert!(v["t_show_ms"].is_null());
        assert!(v["t_ready_ms"].is_null());
        assert_eq!(v.as_object().unwrap().len(), 6);
    }

    #[test]
    fn a_false_probe_key_is_kept_in_the_marker() {
        let p = EngineProbe {
            oklch: false,
            ..PROBE
        };
        let m = marker_json("0.1.0", true, true, Some(&p), Some(1), Some(2));
        let v: serde_json::Value = serde_json::from_str(&m).unwrap();
        assert_eq!(v["probe"]["oklch"], false);
        assert_eq!(v["probe"]["has"], true);
    }

    #[test]
    fn write_marker_writes_file_or_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("m.json");
        write_marker(
            Some(&p),
            "1.2.3",
            true,
            true,
            Some(&PROBE),
            Some(5),
            Some(9),
        )
        .unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["version"], "1.2.3");
        assert_eq!(v["ready"], true);
        assert_eq!(v["auth"], true);
        assert_eq!(v["t_ready_ms"], 9);
        write_marker(
            Some(&p),
            "1.2.3",
            true,
            false,
            Some(&PROBE),
            Some(5),
            Some(9),
        )
        .unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["auth"], false);
        write_marker(None, "1.2.3", true, true, None, None, None).unwrap();
    }

    #[test]
    fn wait_ready_times_out_without_signal() {
        let (state, rx) = SmokeState::new(SmokeConfig::new(None, None, Path::new("/t"), 1));
        assert_eq!(wait_ready(&rx, Duration::from_millis(30)), Watch::TimedOut);
        drop(state);
        assert_eq!(wait_ready(&rx, Duration::from_millis(30)), Watch::Closed);
    }

    #[test]
    fn fire_signals_once() {
        let (state, rx) = SmokeState::new(SmokeConfig::new(None, None, Path::new("/t"), 1));
        assert!(state.fire());
        assert!(!state.fire());
        assert_eq!(wait_ready(&rx, Duration::from_secs(5)), Watch::Ready);
        // 두 번째 fire는 신호를 다시 보내지 않는다(송신단은 첫 fire가 가져갔다)
        assert_eq!(wait_ready(&rx, Duration::from_millis(30)), Watch::Closed);
    }

    #[test]
    fn signal_after_wait_started_is_ready() {
        let (state, rx) = SmokeState::new(SmokeConfig::new(None, None, Path::new("/t"), 1));
        let h = std::thread::spawn(move || wait_ready(&rx, Duration::from_secs(5)));
        std::thread::sleep(Duration::from_millis(20));
        assert!(state.fire());
        assert_eq!(h.join().unwrap(), Watch::Ready);
    }
}
