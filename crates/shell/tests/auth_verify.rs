//! 응답 분류 표와 `classify_verify` 표(worker.md §11.3, 구현 중 변경 42 (라)).

mod common;

use chzzk_shell::auth::*;
use common::auth::t0;
use time::Duration;

const JSON: Option<&str> = Some("application/json");
const HTML: &str = "<!DOCTYPE html><title>Error 1027</title><body>blocked</body>";

fn outcome(
    status: u16,
    ct: Option<&str>,
    body: &str,
    truncated: bool,
    retried: bool,
) -> VerifyOutcome {
    let e = parse_error_response(status, ct, body.as_bytes(), truncated);
    outcome_of_error(&e, retried)
}

#[test]
fn response_outcome_table() {
    use Cause::{Network, Server};
    use Rejection::*;
    use VerifyOutcome::{Rejected, Transient};
    #[allow(clippy::type_complexity)]
    let rows: Vec<(&str, u16, Option<&str>, &str, bool, bool, VerifyOutcome)> = vec![
        (
            "invalid_token",
            401,
            JSON,
            r#"{"code":"invalid_token"}"#,
            false,
            false,
            Rejected(InvalidToken),
        ),
        (
            "session_expired",
            401,
            JSON,
            r#"{"code":"session_expired"}"#,
            false,
            false,
            Rejected(SessionExpired),
        ),
        (
            "session_revoked",
            401,
            JSON,
            r#"{"code":"session_revoked"}"#,
            false,
            false,
            Rejected(SessionRevoked),
        ),
        (
            "revoked_on_retry",
            401,
            JSON,
            r#"{"code":"session_revoked"}"#,
            false,
            true,
            Rejected(ReuseSuspected),
        ),
        (
            "not_allowed",
            403,
            Some("application/json; charset=utf-8"),
            r#"{"code":"not_allowed"}"#,
            false,
            false,
            Rejected(NotAllowed),
        ),
        (
            "json_type_upper",
            401,
            Some("Application/JSON"),
            r#"{"code":"invalid_token"}"#,
            false,
            false,
            Rejected(InvalidToken),
        ),
        (
            "mismatch_401_not_allowed",
            401,
            JSON,
            r#"{"code":"not_allowed"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "mismatch_403_invalid_token",
            403,
            JSON,
            r#"{"code":"invalid_token"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "forbidden_403",
            403,
            JSON,
            r#"{"code":"forbidden"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "other_401_code",
            401,
            JSON,
            r#"{"code":"bad_thing"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "bad_request_400",
            400,
            JSON,
            r#"{"code":"bad_request"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "rate_limited_429",
            429,
            JSON,
            r#"{"code":"rate_limited"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "busy_503",
            503,
            JSON,
            r#"{"code":"busy"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "config_error_503",
            503,
            JSON,
            r#"{"code":"config_error"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "internal_500",
            500,
            JSON,
            r#"{"code":"internal"}"#,
            false,
            false,
            Transient(Server),
        ),
        (
            "cloudflare_html_403",
            403,
            Some("text/html; charset=UTF-8"),
            HTML,
            false,
            false,
            Transient(Network),
        ),
        (
            "cloudflare_html_429",
            429,
            Some("text/html"),
            "<html>Error 1015</html>",
            false,
            false,
            Transient(Network),
        ),
        (
            "cloudflare_html_502",
            502,
            Some("text/html"),
            "<html>Bad gateway</html>",
            false,
            false,
            Transient(Network),
        ),
        (
            "text_plain_with_code",
            401,
            Some("text/plain"),
            r#"{"code":"invalid_token"}"#,
            false,
            false,
            Transient(Network),
        ),
        (
            "no_content_type",
            401,
            None,
            r#"{"code":"invalid_token"}"#,
            false,
            false,
            Transient(Network),
        ),
        (
            "json_not_object",
            401,
            JSON,
            r#"["invalid_token"]"#,
            false,
            false,
            Transient(Network),
        ),
        (
            "json_code_not_string",
            401,
            JSON,
            r#"{"code":401}"#,
            false,
            false,
            Transient(Network),
        ),
        (
            "json_code_bad_chars",
            401,
            JSON,
            r#"{"code":"Invalid-Token"}"#,
            false,
            false,
            Transient(Network),
        ),
        (
            "json_broken",
            401,
            JSON,
            r#"{"code":"#,
            false,
            false,
            Transient(Network),
        ),
        (
            "truncated_body",
            401,
            JSON,
            r#"{"code":"invalid_token"}"#,
            true,
            false,
            Transient(Network),
        ),
        (
            "portal_302",
            302,
            Some("text/html"),
            "",
            false,
            false,
            Transient(Network),
        ),
        (
            // 리디렉션은 본문과 무관하게 Worker 형식이 아니다(47 (다))
            "redirect_302_json_code",
            302,
            JSON,
            r#"{"code":"moved"}"#,
            false,
            false,
            Transient(Network),
        ),
        (
            "portal_200_html",
            200,
            Some("text/html"),
            "<html>login</html>",
            false,
            false,
            Transient(Network),
        ),
    ];
    for (name, status, ct, body, truncated, retried, want) in rows {
        assert_eq!(
            outcome(status, ct, body, truncated, retried),
            want,
            "{name}"
        );
    }
}

#[test]
fn transport_and_contract() {
    for timed_out in [true, false] {
        assert_eq!(
            outcome_of_error(&ApiError::Transport { timed_out }, false),
            VerifyOutcome::Transient(Cause::Network)
        );
    }
    assert_eq!(
        outcome_of_error(&ApiError::Contract { status: 200 }, false),
        VerifyOutcome::Transient(Cause::Server)
    );
}

#[test]
fn oversized_body_is_not_worker() {
    let body = format!(
        r#"{{"code":"invalid_token","pad":"{}"}}"#,
        "x".repeat(MAX_BODY)
    );
    assert_eq!(
        parse_error_response(401, JSON, body.as_bytes(), false),
        ApiError::NotWorker { status: 401 }
    );
}

#[test]
fn lost_response_table() {
    let yes = [
        ApiError::Transport { timed_out: true },
        ApiError::Transport { timed_out: false },
        ApiError::NotWorker { status: 403 },
        ApiError::NotWorker { status: 200 },
        ApiError::Contract { status: 200 },
    ];
    let no = [
        ApiError::Contract { status: 400 },
        ApiError::Worker {
            status: 401,
            code: "session_revoked".into(),
        },
        ApiError::Worker {
            status: 503,
            code: "busy".into(),
        },
        ApiError::Worker {
            status: 429,
            code: "rate_limited".into(),
        },
    ];
    for e in yes {
        assert!(is_lost_response(&e), "{e:?}");
    }
    for e in no {
        assert!(!is_lost_response(&e), "{e:?}");
    }
}

fn h(n: i64) -> Duration {
    Duration::hours(n)
}

#[test]
fn classify_verify_table() {
    use Cause::{Network, Server};
    use Rejection::*;
    use VerifyOutcome::{Ok as Ok_, Rejected, Transient};
    let v = t0();
    let ms = Duration::milliseconds(1);
    let exp = |reason, delete_file| Next::Expired {
        reason,
        delete_file,
    };
    let off = |until: Duration, cause| Next::Offline {
        grace_until: v + until,
        cause,
    };
    let rows: Vec<(&str, Duration, Duration, VerifyOutcome, Next)> = vec![
        ("ok", h(80), Duration::days(30), Ok_, Next::Online),
        (
            "ok_even_after_cap",
            Duration::days(31),
            Duration::days(30),
            Ok_,
            Next::Online,
        ),
        (
            "invalid_token",
            h(1),
            Duration::days(30),
            Rejected(InvalidToken),
            exp(AuthReason::SessionExpired, true),
        ),
        (
            "session_expired",
            h(1),
            Duration::days(30),
            Rejected(SessionExpired),
            exp(AuthReason::SessionExpired, true),
        ),
        (
            "revoked",
            h(1),
            Duration::days(30),
            Rejected(SessionRevoked),
            exp(AuthReason::Revoked, true),
        ),
        (
            "reuse",
            h(1),
            Duration::days(30),
            Rejected(ReuseSuspected),
            exp(AuthReason::ReuseDetected, true),
        ),
        (
            "not_allowed",
            h(1),
            Duration::days(30),
            Rejected(NotAllowed),
            Next::Denied,
        ),
        (
            "net_within",
            h(1),
            Duration::days(30),
            Transient(Network),
            off(h(72), Network),
        ),
        (
            "server_within",
            h(1),
            Duration::days(30),
            Transient(Server),
            off(h(72), Server),
        ),
        (
            "net_at_verified",
            Duration::ZERO,
            Duration::days(30),
            Transient(Network),
            off(h(72), Network),
        ),
        (
            "net_72h_minus_1ms",
            h(72) - ms,
            Duration::days(30),
            Transient(Network),
            off(h(72), Network),
        ),
        (
            "net_72h_exact",
            h(72),
            Duration::days(30),
            Transient(Network),
            exp(AuthReason::GraceExpired, false),
        ),
        (
            "net_72h_plus_1ms",
            h(72) + ms,
            Duration::days(30),
            Transient(Network),
            exp(AuthReason::GraceExpired, false),
        ),
        (
            "net_clock_rollback",
            -ms,
            Duration::days(30),
            Transient(Network),
            exp(AuthReason::GraceExpired, false),
        ),
        (
            "cap_cuts_grace",
            h(9),
            h(10),
            Transient(Network),
            off(h(10), Network),
        ),
        (
            "cap_minus_1ms",
            h(10) - ms,
            h(10),
            Transient(Network),
            off(h(10), Network),
        ),
        (
            "cap_exact",
            h(10),
            h(10),
            Transient(Network),
            exp(AuthReason::SessionExpired, true),
        ),
        (
            "cap_after",
            h(11),
            h(10),
            Transient(Server),
            exp(AuthReason::SessionExpired, true),
        ),
        (
            "cap_beats_grace_over",
            h(80),
            h(75),
            Transient(Network),
            exp(AuthReason::SessionExpired, true),
        ),
        (
            "cap_before_verified",
            h(1),
            -h(1),
            Transient(Network),
            exp(AuthReason::SessionExpired, true),
        ),
        (
            "rejected_ignores_grace",
            h(80),
            Duration::days(30),
            Rejected(SessionRevoked),
            exp(AuthReason::Revoked, true),
        ),
    ];
    for (name, now, r, outcome, want) in rows {
        assert_eq!(classify_verify(v + now, v, v + r, outcome), want, "{name}");
    }
}

#[test]
fn load_decision_table() {
    let v = t0();
    let ms = Duration::milliseconds(1);
    let rows = [
        (h(1), Duration::days(30), LoadDecision::Optimistic),
        (h(72) - ms, Duration::days(30), LoadDecision::Optimistic),
        (h(72), Duration::days(30), LoadDecision::Checking),
        (
            -Duration::seconds(1),
            Duration::days(30),
            LoadDecision::Checking,
        ),
        (h(1), h(1), LoadDecision::CapPassed),
        (h(80), h(75), LoadDecision::CapPassed),
    ];
    for (now, r, want) in rows {
        assert_eq!(load_decision(v + now, v, v + r), want, "now={now} r={r}");
    }
}

#[test]
fn schedule_functions() {
    let v = t0();
    let s60 = Duration::seconds(60);
    assert_eq!(refresh_due_at(v, v + h(24)), v + h(24) - s60);
    assert_eq!(refresh_due_at(v, v + h(2)), v + h(2) - s60);
    assert_eq!(refresh_due_at(v, v + h(48)), v + h(24));
    let mins = [
        (0, 1),
        (1, 1),
        (2, 2),
        (3, 5),
        (4, 10),
        (5, 30),
        (6, 30),
        (100, 30),
    ];
    for (k, m) in mins {
        assert_eq!(retry_delay(k), Duration::minutes(m), "k={k}");
    }
}

#[test]
fn api_error_display_has_no_values() {
    let rows = [
        (
            ApiError::Transport { timed_out: true },
            "Worker 연결 실패(시간 초과)",
        ),
        (ApiError::Transport { timed_out: false }, "Worker 연결 실패"),
        (
            ApiError::NotWorker { status: 403 },
            "Worker가 아닌 응답(HTTP 403)",
        ),
        (
            ApiError::Worker {
                status: 401,
                code: "invalid_token".into(),
            },
            "Worker 오류(HTTP 401 invalid_token)",
        ),
        (
            ApiError::Contract { status: 200 },
            "Worker 응답 형식 오류(HTTP 200)",
        ),
    ];
    for (e, want) in rows {
        assert_eq!(e.to_string(), want);
    }
}
