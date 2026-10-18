//! ko.ts의 `cli.*`와 GUI와 같은 말(`auth.*`·`job.*`)이 명령줄(셸 `cli::copy`)의 Rust 상수와 같은 글자인지 확인하는
//! 대조 테스트(content.md §14, `notify_copy.rs`와 같은 방식). 명령줄은 웹뷰 밖이라 deck을 읽을 수 없어 두 곳이 같은 글자를
//! 따로 들고 있다. ko.ts가 없거나 키가 없으면 실패한다. DC11은 이 `.rs` 파일의 `"키"` 인용을 참조로 센다.

#[cfg(test)]
mod tests {
    use chzzk_shell::cli::copy::*;

    /// ko.ts 한 줄 `'<키>': '<값>',`에서 값을 읽는다(값에 작은따옴표가 없는 키만 대상이다)
    fn deck_value(deck: &str, key: &str) -> String {
        let needle = format!("'{key}':");
        let line = deck
            .lines()
            .find(|l| l.trim_start().starts_with(&needle))
            .unwrap_or_else(|| panic!("ko.ts에 키가 없다: {key}"));
        let rest = line.trim_start()[needle.len()..].trim();
        let value = rest
            .strip_prefix('\'')
            .and_then(|r| r.strip_suffix("',"))
            .unwrap_or_else(|| panic!("ko.ts 값 모양이 다르다: {key}"));
        value.to_string()
    }

    fn deck() -> String {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/copy/ko.ts");
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("ko.ts를 읽지 못했다({path}): {e}"))
    }

    /// `errors.ts`의 `notOwnContent` L0 문장은 따옴표 안 리터럴이다
    fn errors() -> String {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/copy/errors.ts");
        std::fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("errors.ts를 읽지 못했다({path}): {e}"))
    }

    #[test]
    fn cli_keys_match_the_deck() {
        let d = deck();
        for (key, rust) in [
            ("cli.loginNeeded.body", LOGIN_NEEDED),
            ("cli.login.waiting", LOGIN_WAITING),
            ("cli.login.done", LOGIN_DONE),
            ("cli.login.already", LOGIN_ALREADY),
            ("cli.login.cancelled", LOGIN_CANCELLED),
            ("cli.login.timeout", LOGIN_TIMEOUT),
            ("cli.login.openFailed", LOGIN_OPEN_FAILED),
            ("cli.login.deniedNext", LOGIN_DENIED_NEXT),
            ("cli.login.dailyLimitNext", LOGIN_DAILY_LIMIT_NEXT),
            ("cli.login.disabled", LOGIN_DISABLED),
            ("cli.appOpen.body", APP_OPEN),
            ("cli.useConsoleExe", USE_CONSOLE_EXE),
            ("cli.busy.body", BUSY),
            ("cli.paused.body", PAUSED),
            ("cli.exists.label", EXISTS),
            ("cli.liveUnsupported.body", LIVE_UNSUPPORTED),
        ] {
            assert_eq!(deck_value(&d, key), rust, "{key}");
        }
    }

    #[test]
    fn reused_gui_keys_match_the_deck() {
        let d = deck();
        for (key, rust) in [
            ("app.title", APP_TITLE),
            ("auth.denied.title", AUTH_DENIED),
            ("auth.dailyLimit.title", AUTH_DAILY_LIMIT),
            ("auth.network.title", AUTH_NETWORK),
            ("auth.server.title", AUTH_SERVER),
            ("auth.lost.title", AUTH_LOST),
            ("auth.receiver.title", AUTH_RECEIVER),
            ("auth.unknown.title", AUTH_UNKNOWN),
            ("auth.sessionExpired.title", AUTH_SESSION_EXPIRED),
            ("job.status.resolving", PHASE_RESOLVING),
            ("job.phase.downloading", PHASE_DOWNLOADING),
            ("job.phase.reresolving", PHASE_RERESOLVING),
            ("job.phase.waitingNetwork", PHASE_WAITING_NETWORK),
            ("job.status.finalizing", PHASE_FINALIZING),
            ("job.status.completed", STATUS_COMPLETED),
            ("quality.audioOnly", AUDIO_ONLY_LABEL),
        ] {
            assert_eq!(deck_value(&d, key), rust, "{key}");
        }
    }

    #[test]
    fn not_own_content_text_is_in_errors_ts() {
        let e = errors();
        for s in [NOT_OWN_TITLE, NOT_OWN_TITLE_DELEGATED, NOT_OWN_BODY] {
            assert!(e.contains(s), "errors.ts에 없다: {s}");
        }
    }
}
