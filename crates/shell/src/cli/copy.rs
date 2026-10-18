//! 명령줄 문구(cli-mode.md §11).
//!
//! 웹뷰 밖 Rust라 copy deck(`ko.ts`)을 읽을 수 없다. OS 알림(`notify.rs`)처럼 상수로 두고, 같은 글자의 사본을
//! `ko.ts`의 `cli.*`(또 GUI와 같은 말은 기존 `auth.*`·`job.*` 키)에 둔다. 두 곳이 같은지는 앱 crate의
//! `cli_copy.rs` 테스트가 `ko.ts`를 읽어 비교한다(`notify_copy.rs`와 같은 방식). 그래서 `design-copy`의
//! 금지어·용어집 검사가 이 문구에도 걸린다.
//!
//! 비밀값(로그인 주소·토큰·쿠키)은 어떤 문구에도 끼우지 않는다.

// ---------------------------------------------------------------------------
// deck에 사본이 있는 문구(`cli.*`): 템플릿의 `{이름}` 자리는 `fill`로 채운다
// ---------------------------------------------------------------------------

/// `cli.loginNeeded.body`
pub const LOGIN_NEEDED: &str = "로그인이 필요해요. `login`으로 로그인한 뒤 다시 실행해 주세요.";
/// `cli.login.waiting`
pub const LOGIN_WAITING: &str = "브라우저에서 로그인해 주세요. 끝나면 여기로 돌아와요. 그만두려면 이 키를 눌러 주세요: {interrupt}";
/// `{interrupt}` 자리에 들어가는 키 이름(deck의 `platform.*` 단축키 표기와 같은 방식으로 코드 상수다, DC9)
pub const INTERRUPT_KEY: &str = "Ctrl+C";
/// `cli.login.done`
pub const LOGIN_DONE: &str = "로그인했어요: {name}";
/// `cli.login.already`
pub const LOGIN_ALREADY: &str = "이미 로그인되어 있어요: {name}";
/// `cli.login.cancelled`
pub const LOGIN_CANCELLED: &str = "로그인을 그만뒀어요.";
/// `cli.login.timeout`
pub const LOGIN_TIMEOUT: &str = "로그인 시간이 지났어요. 다시 실행해 주세요.";
/// `cli.login.openFailed`
pub const LOGIN_OPEN_FAILED: &str =
    "브라우저를 열지 못했어요. 기본 브라우저를 확인한 뒤 다시 실행해 주세요.";
/// `cli.login.deniedNext`
pub const LOGIN_DENIED_NEXT: &str = "허가를 받은 뒤 다시 `login`을 실행해 주세요.";
/// `cli.login.dailyLimitNext`
pub const LOGIN_DAILY_LIMIT_NEXT: &str = "다음 날 다시 `login`을 실행해 주세요.";
/// `cli.login.disabled`
pub const LOGIN_DISABLED: &str = "이 빌드는 로그인을 쓰지 않아요.";
/// `cli.appOpen.body`
pub const APP_OPEN: &str = "앱이 열려 있어요. 앱을 닫은 뒤 다시 실행해 주세요.";
/// `cli.useConsoleExe`(Windows `chzzk-app.exe`에 명령줄 하위 명령을 줬을 때)
pub const USE_CONSOLE_EXE: &str = "명령줄에서는 같은 폴더의 chzzk-cli.exe를 써 주세요.";
/// `cli.busy.body`(GUI가 명령줄이 쥔 데이터 폴더 때문에 열리지 못할 때의 대화상자)
pub const BUSY: &str = "명령줄에서 받는 중이에요. 끝난 뒤 다시 열어 주세요.";
/// `cli.paused.body`
pub const PAUSED: &str = "멈췄어요. 같은 명령을 다시 실행하면 이어받아요.";
/// `cli.exists.label`
pub const EXISTS: &str = "이미 있어요: {path}";
/// `cli.liveUnsupported.body`
pub const LIVE_UNSUPPORTED: &str = "생방송은 앱에서 녹화해 주세요.";

// ---------------------------------------------------------------------------
// GUI와 같은 말(기존 deck 키의 값을 그대로 쓴다)
// ---------------------------------------------------------------------------

/// `auth.denied.title`
pub const AUTH_DENIED: &str = "사용 허가가 없는 채널이에요";
/// `auth.dailyLimit.title`
pub const AUTH_DAILY_LIMIT: &str = "오늘은 새로 시작할 수 없어요";
/// `auth.network.title`
pub const AUTH_NETWORK: &str = "로그인 서버에 연결하지 못했어요";
/// `auth.server.title`
pub const AUTH_SERVER: &str = "로그인 요청을 처리하지 못했어요";
/// `auth.lost.title`
pub const AUTH_LOST: &str = "로그인을 마무리하지 못했어요";
/// `auth.receiver.title`
pub const AUTH_RECEIVER: &str = "로그인을 준비하지 못했어요";
/// `auth.unknown.title`
pub const AUTH_UNKNOWN: &str = "로그인 상태를 확인하지 못했어요";
/// `auth.sessionExpired.title`
pub const AUTH_SESSION_EXPIRED: &str = "로그인이 만료됐어요";
/// `job.status.resolving`
pub const PHASE_RESOLVING: &str = "준비 중";
/// `job.phase.downloading`
pub const PHASE_DOWNLOADING: &str = "받는 중";
/// `job.phase.reresolving`
pub const PHASE_RERESOLVING: &str = "주소를 새로 받는 중";
/// `job.phase.waitingNetwork`
pub const PHASE_WAITING_NETWORK: &str = "연결 대기 중";
/// `job.status.finalizing`
pub const PHASE_FINALIZING: &str = "마무리 중";
/// `job.status.completed`
pub const STATUS_COMPLETED: &str = "완료";
/// `quality.audioOnly`(오디오만 받기 행의 라벨, 요청의 `qualityLabel`)
pub const AUDIO_ONLY_LABEL: &str = "오디오만";
/// `errors.ts` `notOwnContent`의 L0 제목(맡은 채널이 없을 때)
pub const NOT_OWN_TITLE: &str = "내 채널의 영상만 받을 수 있어요";
/// `errors.ts` `notOwnContent`의 L0 제목(맡은 채널이 있을 때)
pub const NOT_OWN_TITLE_DELEGATED: &str = "내 채널이나 맡은 채널의 영상만 받을 수 있어요";
/// `errors.ts` `notOwnContent`의 L0 본문(작업 행)
pub const NOT_OWN_BODY: &str = "이 영상은 다른 채널의 영상이에요.";

/// `{이름}` 자리를 채운다. 값에 `{`가 있어도 다시 해석하지 않는다.
pub fn fill(template: &str, name: &str, value: &str) -> String {
    template.replace(&format!("{{{name}}}"), value)
}

// ---------------------------------------------------------------------------
// 명령줄에만 있는 문구(사용법·도움말·상태 줄): deck에 두지 않는다
// ---------------------------------------------------------------------------

pub const STATUS_VERSION: &str = "버전: ";
pub const STATUS_SIGNED_IN: &str = "로그인: 로그인됨 · {name}";
pub const STATUS_SIGNED_OUT: &str = "로그인: 로그인 필요";
pub const KIND_VIDEO: &str = "영상";
pub const KIND_CLIP: &str = "클립";
pub const KIND_LIVE: &str = "생방송";
pub const INFO_TITLE: &str = "제목: ";
pub const INFO_CHANNEL: &str = "채널: ";
pub const INFO_KIND: &str = "종류: ";
pub const INFO_QUALITIES: &str = "화질: ";
pub const INFO_DEFAULT_MARK: &str = " (기본)";
pub const INFO_ALLOWED: &str = "받을 수 있어요";
pub const INFO_NOT_ALLOWED: &str = "받을 수 없어요: 내 채널이나 맡은 채널의 영상만 받을 수 있어요";

pub const USAGE_NOT_UTF8: &str = "인자에 읽을 수 없는 글자가 있어요.";
pub const USAGE_NO_COMMAND: &str = "명령이 없어요. 쓸 수 있는 명령은 `help`로 볼 수 있어요.";
pub const USAGE_HINT: &str = "사용법은 `help`로 볼 수 있어요.";

pub fn unknown_command(c: &str) -> String {
    format!("모르는 명령이에요: {c}")
}

pub fn unknown_flag(cmd: &str, flag: &str) -> String {
    format!("`{cmd}`에 없는 깃발이에요: {flag}")
}

pub fn unexpected_argument(cmd: &str, arg: &str) -> String {
    format!("`{cmd}`에 필요 없는 인자예요: {arg}")
}

pub fn duplicate_flag(flag: &str) -> String {
    format!("깃발을 두 번 쓸 수 없어요: {flag}")
}

pub fn flag_takes_no_value(flag: &str) -> String {
    format!("값을 받지 않는 깃발이에요: {flag}")
}

pub fn missing_value(flag: &str) -> String {
    format!("값이 필요해요: {flag}")
}

pub fn missing_url(cmd: &str) -> String {
    format!("`{cmd}`에는 주소가 필요해요.")
}

pub fn invalid_url(url: &str) -> String {
    format!("받을 수 있는 주소가 아니에요: {url}")
}

pub fn invalid_range(s: &str) -> String {
    format!("구간을 읽지 못했어요: {s} (예: 1:00-2:30, 끝을 비우면 끝까지)")
}

pub fn invalid_rate(s: &str) -> String {
    format!("속도를 읽지 못했어요: {s} (예: 5m, 800k, 2000000)")
}

/// `labels`는 화질 라벨(오디오만 행은 `--audio`로 고르므로 뺀다).
pub fn quality_not_found(label: &str, labels: &[String]) -> String {
    format!(
        "그 화질이 없어요: {label}. 고를 수 있는 화질: {}",
        labels.join(", ")
    )
}

/// 같은 파일의 작업이 이미 목록에 있고 이번 요청과 달라 이어받을 수 없다.
pub const DUPLICATE_OTHER: &str =
    "같은 파일의 다른 작업이 목록에 있어요. 앱에서 그 작업을 지운 뒤 다시 실행해 주세요.";

/// 다른 화질의 받다 만 파일이 있다(코어가 지우고 새로 받는다).
pub const PARTIAL_OTHER: &str = "다른 화질의 받다 만 파일이 있어 지우고 새로 받아요.";

pub const AUDIO_WITH_QUALITY: &str = "`--audio`와 `--quality`는 함께 쓸 수 없어요.";
pub const AUDIO_UNAVAILABLE: &str = "이 영상은 오디오만 받을 수 없어요. 일반 영상에만 있어요.";
pub const NAME_UNAVAILABLE: &str = "새 파일 이름을 정하지 못했어요. 저장 폴더를 확인해 주세요.";
pub const JOB_LOST: &str = "작업 상태를 읽지 못했어요.";
pub const JOB_FAILED: &str = "받지 못했어요.";
pub const NO_DATA_LOCK: &str = "데이터 폴더를 쓸 수 없어요. 폴더 권한을 확인해 주세요.";

pub fn resuming(size: &str) -> String {
    format!("받다 만 파일을 이어받아요: {size}")
}

pub fn done_line(size: &str) -> String {
    format!("{STATUS_COMPLETED} · {size}")
}

/// 명령별 사용법(`help [<명령>]`). 줄마다 `\n`으로 끝난다.
pub fn help(topic: Option<&str>) -> String {
    let mut s = String::new();
    let all = topic.is_none();
    if all {
        s.push_str("VOD 클립 다운로더 명령줄\n\n");
    }
    let section = |name: &str| all || topic == Some(name);
    if section("download") {
        s.push_str(
            "download <주소> [<주소> …] [--quality <라벨>] [--out <폴더>] [--range <시작>-<끝>] [--rate <속도>] [--overwrite] [--audio]\n\
             \x20 주소를 차례로 받아요. 받은 파일의 경로를 한 줄씩 출력해요(진행은 stderr).\n\
             \x20 --quality   화질 라벨(예: 1080p). 없으면 앱과 같은 기본 화질\n\
             \x20 --out       저장 폴더. 없으면 앱 설정의 저장 폴더\n\
             \x20 --range     빠른 다시보기의 구간(예: 1:00-2:30). 끝을 비우면 끝까지\n\
             \x20 --rate      이 실행의 작업당 속도 상한(예: 5m, 800k). 설정은 바뀌지 않아요\n\
             \x20 --overwrite 같은 이름의 파일이 있으면 덮어써요(기본은 건너뛰기)\n\
             \x20 --audio     영상 없이 오디오만 받아요(.m4a, 일반 영상만). --quality와 함께 쓸 수 없어요\n\
             \x20 받다 만 파일이 있으면 이어받아요. 마지막 화질과 최근 영상은 앱과 같이 설정에 남아요.\n",
        );
    }
    if section("info") {
        s.push_str("info <주소>\n  제목·채널·종류·화질 목록과 받을 수 있는지를 보여 줘요. 받지는 않아요.\n");
    }
    if section("status") {
        s.push_str("status\n  로그인 상태와 앱 버전을 보여 줘요.\n");
    }
    if section("login") {
        s.push_str(
            "login\n  브라우저를 열어 로그인해요. 브라우저가 이 컴퓨터에 있어야 해요. 앱과 같은 로그인이 쓰여요.\n",
        );
    }
    if section("help") {
        s.push_str("help [<명령>]\n  이 도움말을 보여 줘요.\n");
    }
    if all {
        s.push_str(
            "\n종료 코드: 0 성공 · 1 실패 · 2 사용법 · 3 로그인 필요 · 4 받을 수 없는 영상 · 5 앱이 열려 있음 · 130 Ctrl+C로 멈춤\n\
             앱이 열려 있으면 실행되지 않아요.\n",
        );
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_replaces_only_named_slot() {
        assert_eq!(
            fill(LOGIN_DONE, "name", "채널{name}"),
            "로그인했어요: 채널{name}"
        );
        assert_eq!(fill(EXISTS, "path", "/a/b.mp4"), "이미 있어요: /a/b.mp4");
    }

    #[test]
    fn help_sections() {
        let all = help(None);
        for c in super::super::args::SUBCOMMANDS {
            assert!(all.contains(c), "{c}");
        }
        assert!(all.contains("130"));
        let one = help(Some("status"));
        assert!(one.starts_with("status"));
        assert!(!one.contains("download"));
    }
}
