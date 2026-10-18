//! 명령줄 모드의 몸통(docs/design/features/cli-mode.md). Tauri 비의존이라 webkit 없이 3 OS에서 테스트한다.
//!
//! 앱 crate(`app/src-tauri`)는 argv 갈림·경로·데이터 폴더 잠금·런타임·Ctrl+C 신호만 맡고, 여기 `run`에 `App`을 넘긴다.
//!
//! **게이트를 우회하는 길을 만들지 않는다**(§4):
//! - 하위 명령이 부르는 셸 함수마다 GUI command 이름으로 `App::gate_command`를 먼저 부른다(`GATED` 표).
//! - 작업은 `App::enqueue`로만 만든다. 이 모듈은 `manager.enqueue`나 코어 `download`를 부르지 않는다
//!   (`tests/cli_gate.rs`가 소스를 훑어 확인한다). 소유 판정은 `App::enqueue` 안에 있다.
//! - `classify`를 직접 부르지 않는다. 채널 조회·판정 직전 확인·fail closed 경로가 `App`에 한 벌만 있어야 한다.
//!
//! 출력: 결과(완성 파일의 절대 경로 한 줄, `info`·`status`의 내용)는 stdout, 진행률·안내·오류는 stderr.
//! 비밀값(로그인 주소·토큰·쿠키·서명 주소)은 어디에도 쓰지 않는다. 오류는 `AppError.message`(이미 가려진 문구)만 쓴다.

pub mod args;
pub mod copy;
mod download;
mod login;
pub mod progress;

use std::io::Write;
use std::path::PathBuf;

use tokio::sync::mpsc::UnboundedReceiver;

use crate::app::App;
use crate::dto::{AuthReasonDto, AuthState, AuthStatusDto, ContentKindDto, Ownership};
use crate::error::{AppError, ErrorCode};
use crate::power::SleepGuard;

pub use args::{Command, DownloadArgs, UsageError, parse, wants_cli};

/// 종료 코드(cli-mode.md §9.3). 0~255 밖은 쓰지 않는다. `--smoke`의 2·3과 숫자가 겹치지만 두 모드는 한 실행에서 함께
/// 일어나지 않는다(argv 갈림이 가른다, 앱 crate `smoke.rs`에도 같은 주석이 있다).
pub mod exit {
    /// 모두 받았다(이미 있어서 건너뛴 것 포함). `info`·`status`·`help` 성공. `login`으로 로그인했거나 이미 로그인됨
    pub const OK: u8 = 0;
    /// 받기 실패, 잠금 파일을 열지 못함, `login`의 시작 실패·브라우저 열기 실패·일시 오류
    pub const FAILED: u8 = 1;
    /// 사용법 오류
    pub const USAGE: u8 = 2;
    /// 로그인이 필요하다. `login`이 거부(`Denied`)나 시간 초과로 끝났다
    pub const LOGIN: u8 = 3;
    /// 이 계정으로 받을 수 없는 영상
    pub const REJECTED: u8 = 4;
    /// 앱(또는 다른 CLI)이 열려 있다
    pub const BUSY: u8 = 5;
    /// Ctrl+C로 멈췄다(`.part`는 남는다). `login` 기다림을 그만뒀다
    pub const INTERRUPTED: u8 = 130;

    /// 주소가 여럿일 때 가장 나쁜 코드: 130 > 5 > 3 > 4 > 1 > 2 > 0 (사람이 먼저 손대야 하는 것부터)
    pub fn worst(a: u8, b: u8) -> u8 {
        fn rank(c: u8) -> u8 {
            match c {
                INTERRUPTED => 6,
                BUSY => 5,
                LOGIN => 4,
                REJECTED => 3,
                FAILED => 2,
                USAGE => 1,
                _ => 0,
            }
        }
        if rank(b) > rank(a) { b } else { a }
    }
}

/// 하위 명령이 부르는 셸 함수의 GUI command 이름. 실행 전에 `App::gate_command`로 모두 거친다(§4.1).
/// 허용 목록(`gate::OPEN_COMMANDS`)에 있는 이름은 늘 통과하고, 그 밖은 로그인이 아니면 `notLoggedIn`이다.
/// 앱 crate의 테스트가 이 이름들이 실제 command 목록에 있는지 본다.
pub const GATED: &[(&str, &[&str])] = &[
    (
        "download",
        &["resolve", "check_output", "enqueue", "resume_job"],
    ),
    ("info", &["resolve"]),
    ("status", &["auth_status"]),
    ("login", &["auth_retry", "auth_login", "auth_cancel"]),
];

/// Ctrl+C 신호. 한 번 누를 때마다 `()` 하나가 온다(첫 번째는 일시정지, 두 번째는 바로 끝낸다).
pub type CtrlC = UnboundedReceiver<()>;

/// 브라우저로 주소를 여는 함수. 열었으면 true.
pub type OpenUrl = Box<dyn FnOnce(&str) -> bool + Send>;

/// 실행 환경: 출력, 터미널 여부, 현재 폴더, 브라우저 열기, 잠자기 방지.
pub struct Env<'a> {
    /// 결과 출력(stdout)
    pub out: &'a mut dyn Write,
    /// 진행률·안내·오류(stderr)
    pub err: &'a mut dyn Write,
    /// stderr가 터미널인가(진행 줄을 `\r`로 고쳐 쓴다)
    pub tty: bool,
    /// 상대 `--out`의 기준
    pub cwd: PathBuf,
    /// 앱 버전(`status`)
    pub version: String,
    /// 브라우저로 주소를 여는 함수(`login`만 쓴다). 주소는 여기에만 넘기고 어디에도 기록하지 않는다
    pub open_url: Option<OpenUrl>,
    /// 잠자기 방지. `None`이면 `NoopGuard`(격리 실행 — 스모크·E2E — 와 테스트)
    pub power: Option<Box<dyn SleepGuard>>,
}

impl SleepGuard for Box<dyn SleepGuard> {
    fn acquire(&mut self, reason: &str) -> Result<(), String> {
        (**self).acquire(reason)
    }

    fn release(&mut self) {
        (**self).release();
    }
}

pub(crate) fn line(w: &mut dyn Write, s: &str) {
    let _ = writeln!(w, "{s}");
}

/// `interruptible`의 결과
pub(crate) enum Waited<T> {
    /// Ctrl+C 없이 끝났다
    Done(T),
    /// Ctrl+C가 왔고 `fut`은 버렸다
    Stopped,
    /// Ctrl+C가 왔지만 진행 중인 refresh를 끝내는 사이 `fut`도 끝났다. 호출자는 결과를 버리지 말고(작업이 이미 만들어졌을
    /// 수 있다) 첫 Ctrl+C로 다룬다
    DoneAfterPress(T),
}

impl<T> Waited<T> {
    /// 결과가 남을 것이 없는 기다림(갱신·조회): 눌렀으면 끝난 결과도 버린다
    pub(crate) fn unless_pressed(self) -> Option<T> {
        match self {
            Waited::Done(v) => Some(v),
            Waited::Stopped | Waited::DoneAfterPress(_) => None,
        }
    }
}

/// `fut`을 기다리되 Ctrl+C가 먼저 오면 버린다(작업을 시작하기 전의 기다림 전부: 갱신·조회·판정).
/// 신호 채널이 닫혔으면(`recv`가 `None`) 취소가 아니라 신호를 더 기다리지 않는 것이다. 받기가 시작된 뒤의 Ctrl+C 두 단계는
/// `download::follow`가 따로 다룬다.
///
/// **refresh(토큰 회전) 도중에는 버리지 않는다**(cli-mode.md §5.2): `fut` 안의 어디서든(시작 갱신·관리자 확인·주소마다의
/// `tick`·/api/me의 invalid_token 뒤 갱신) 회전 요청이 나가 있으면, 서버가 회전을 커밋했는데 응답 처리·새 토큰 저장·응답 유실
/// 재시도가 취소된다. 그러면 디스크에 옛 토큰이 남고 60초 복구 창 뒤 그것을 보내 재사용 감지로 GUI와 함께 쓰는 세션이
/// 끊긴다. 그래서 Ctrl+C가 왔을 때 refresh가 진행 중이면 `fut`을 계속 poll하며 refresh가 결과를 저장할 때까지 기다린 뒤 버린다
/// (요청 시간 상한·응답 유실 재시도 창 안에서 끝난다). 더 누른 Ctrl+C도 이 기다림을 끊지 않는다.
///
/// refresh가 아닌 곳에서 버려도 안전하다: `App::enqueue`·`resume_job`은 `.await`(판정)가 모두 매니저를 부르기 전에 있고,
/// 그 뒤는 동기라 작업이 아예 없거나 이미 완전히 만들어진 둘 중 하나다(뒤의 경우가 `DoneAfterPress`).
pub(crate) async fn interruptible<F: std::future::Future>(
    app: &App,
    env: &mut Env<'_>,
    ctrl_c: &mut CtrlC,
    fut: F,
) -> Waited<F::Output> {
    tokio::pin!(fut);
    let mut closed = false;
    loop {
        tokio::select! {
            out = &mut fut => return Waited::Done(out),
            sig = ctrl_c.recv(), if !closed => {
                if sig.is_some() {
                    break;
                }
                closed = true;
            }
        }
    }
    if !app.auth_refreshing() {
        return Waited::Stopped;
    }
    line(env.err, copy::FINISHING_REFRESH);
    let settled = app.auth_refresh_settled();
    tokio::pin!(settled);
    tokio::select! {
        biased;
        out = &mut fut => Waited::DoneAfterPress(out),
        () = &mut settled => Waited::Stopped,
    }
}

/// Ctrl+C로 작업을 시작하기 전에 그만뒀다.
pub(crate) fn stopped(env: &mut Env<'_>) -> u8 {
    line(env.err, copy::INTERRUPTED);
    exit::INTERRUPTED
}

/// 명령 하나를 실행하고 종료 코드를 돌려준다. 모든 끝에서 `jobs.json` 쓰기를 마친 뒤에 돌아온다(§3.1):
/// 쓰기 스레드는 가장 최근 제출만 나중에 쓰므로 flush 없이 끝내면 `completed`가 디스크에 없을 수 있다.
pub async fn run(app: &App, cmd: Command, env: &mut Env<'_>, ctrl_c: &mut CtrlC) -> u8 {
    let code = match cmd {
        Command::Help { topic } => {
            let _ = write!(env.out, "{}", copy::help(topic.as_deref()));
            exit::OK
        }
        other => run_with_app(app, other, env, ctrl_c).await,
    };
    let m = app.manager.clone();
    let _ = tokio::task::spawn_blocking(move || m.flush()).await;
    code
}

async fn run_with_app(app: &App, cmd: Command, env: &mut Env<'_>, ctrl_c: &mut CtrlC) -> u8 {
    // 저장 세션을 한 번 갱신한다. `startup`이 아니라 `retry`다: 갱신 예정 전이면 네트워크 없이 지금 상태를 돌려줘서
    // 스크립트가 짧게 여러 번 불러도 refresh 회전 상한에 닿지 않는다(§5.2)
    if let Err(e) = app.gate_command("auth_retry") {
        return report_error(env, app, &e);
    }
    let Some(st) = interruptible(app, env, ctrl_c, app.auth_retry())
        .await
        .unless_pressed()
    else {
        return stopped(env);
    };
    match cmd {
        Command::Help { .. } => exit::OK,
        Command::Status => status(app, env, &st),
        Command::Login => login::run(app, env, ctrl_c, &st).await,
        Command::Info { url } => info(app, env, ctrl_c, &url).await,
        Command::Download(a) => download::run(app, env, ctrl_c, &a).await,
    }
}

/// `status`: 로그인 상태와 앱 버전. 로그인이 필요한 상태면 코드 3.
fn status(app: &App, env: &mut Env<'_>, st: &AuthStatusDto) -> u8 {
    if let Err(e) = app.gate_command("auth_status") {
        return report_error(env, app, &e);
    }
    let _ = writeln!(env.out, "{}{}", copy::STATUS_VERSION, env.version);
    match st.state {
        AuthState::Disabled => {
            let _ = writeln!(env.out, "{}", copy::LOGIN_DISABLED);
            exit::OK
        }
        AuthState::SignedIn => {
            let name = st.channel_name.as_deref().unwrap_or_default();
            let _ = writeln!(
                env.out,
                "{}",
                copy::fill(copy::STATUS_SIGNED_IN, "name", name)
            );
            exit::OK
        }
        _ => {
            let _ = writeln!(env.out, "{}", copy::STATUS_SIGNED_OUT);
            exit::LOGIN
        }
    }
}

/// `info`: 받지 않고 제목·채널·종류·화질·판정을 보여 준다. 채널 ID는 출력하지 않는다(§12).
async fn info(app: &App, env: &mut Env<'_>, ctrl_c: &mut CtrlC, url: &str) -> u8 {
    if let Err(e) = app.gate_command("resolve") {
        return report_error(env, app, &e);
    }
    let r = match interruptible(app, env, ctrl_c, app.resolve(url))
        .await
        .unless_pressed()
    {
        None => return stopped(env),
        Some(Ok(r)) => r,
        Some(Err(e)) => return report_error(env, app, &e),
    };
    let kind = match r.meta.kind {
        ContentKindDto::Video => copy::KIND_VIDEO,
        ContentKindDto::Clip => copy::KIND_CLIP,
        ContentKindDto::Live => copy::KIND_LIVE,
    };
    let labels: Vec<String> = r
        .qualities
        .iter()
        .enumerate()
        .map(|(i, q)| {
            if q.audio_only {
                // 코어 라벨("audio")이 아니라 GUI와 같은 말이다
                copy::AUDIO_ONLY_LABEL.to_string()
            } else if i as u32 == r.default_quality_index {
                format!("{}{}", q.label, copy::INFO_DEFAULT_MARK)
            } else {
                q.label.clone()
            }
        })
        .collect();
    let _ = writeln!(env.out, "{}{}", copy::INFO_TITLE, r.meta.title);
    let _ = writeln!(env.out, "{}{}", copy::INFO_CHANNEL, r.meta.channel_name);
    let _ = writeln!(env.out, "{}{kind}", copy::INFO_KIND);
    let _ = writeln!(env.out, "{}{}", copy::INFO_QUALITIES, labels.join(", "));
    match r.ownership {
        Ownership::Unchecked | Ownership::Own | Ownership::Delegated | Ownership::AdminOverride => {
            let _ = writeln!(env.out, "{}", copy::INFO_ALLOWED);
            exit::OK
        }
        Ownership::NotOwn | Ownership::Unknown => {
            let _ = writeln!(env.out, "{}", copy::INFO_NOT_ALLOWED);
            exit::REJECTED
        }
    }
}

/// 오류 하나를 stderr에 쓰고 종료 코드를 돌려준다.
pub(crate) fn report_error(env: &mut Env<'_>, app: &App, e: &AppError) -> u8 {
    match e.code {
        ErrorCode::NotLoggedIn => {
            login_needed(env, &app.auth_status());
            exit::LOGIN
        }
        ErrorCode::NotOwnContent => {
            let delegated = !app.auth_status().delegated_channels.is_empty();
            let title = if delegated {
                copy::NOT_OWN_TITLE_DELEGATED
            } else {
                copy::NOT_OWN_TITLE
            };
            line(env.err, title);
            line(env.err, copy::NOT_OWN_BODY);
            exit::REJECTED
        }
        ErrorCode::OwnershipUnknown => {
            line(env.err, &e.message);
            exit::REJECTED
        }
        ErrorCode::Cancelled => exit::INTERRUPTED,
        ErrorCode::InvalidUrl
        | ErrorCode::InvalidInput
        | ErrorCode::QualityNotFound
        | ErrorCode::RangeOutOfBounds => {
            line(env.err, &e.message);
            exit::USAGE
        }
        _ => {
            line(env.err, &e.message);
            exit::FAILED
        }
    }
}

/// 로그인이 필요하다는 안내. `Denied`·`Expired`면 이유 한 줄을 붙인다(§5.3).
pub(crate) fn login_needed(env: &mut Env<'_>, st: &AuthStatusDto) {
    line(env.err, copy::LOGIN_NEEDED);
    match (st.state, st.reason) {
        (AuthState::Denied, Some(AuthReasonDto::DailyLimit)) => {
            line(env.err, copy::AUTH_DAILY_LIMIT)
        }
        (AuthState::Denied, _) => line(env.err, copy::AUTH_DENIED),
        (AuthState::Expired, _) => line(env.err, copy::AUTH_SESSION_EXPIRED),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn worst_code_order() {
        use exit::*;
        // 130 > 5 > 3 > 4 > 1 > 2 > 0
        let order = [INTERRUPTED, BUSY, LOGIN, REJECTED, FAILED, USAGE, OK];
        for (i, a) in order.iter().enumerate() {
            for b in &order[i..] {
                assert_eq!(worst(*a, *b), *a, "{a} {b}");
                assert_eq!(worst(*b, *a), *a, "{b} {a}");
            }
        }
    }

    #[test]
    fn gated_names_are_well_formed() {
        // 하위 명령 이름은 파서 표의 이름이다. 중복 없음
        for (sub, names) in GATED {
            assert!(args::SUBCOMMANDS.contains(sub), "{sub}");
            assert!(!names.is_empty());
        }
        // 로그인이 필요한 command는 허용 목록 밖이다. `login`·`status`가 부르는 것은 모두 허용 목록 안이다
        for (sub, names) in GATED {
            let all_open = names.iter().all(|n| crate::gate::is_open(n));
            assert_eq!(all_open, matches!(*sub, "status" | "login"), "{sub}");
        }
    }
}
