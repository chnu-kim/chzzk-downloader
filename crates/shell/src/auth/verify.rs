//! 갱신 결과 → 다음 상태(worker.md §11.3, 3일 유예·60일 상한). 순수 함수라 `tests/auth_verify.rs` 표로 검사한다.

use time::OffsetDateTime;

use super::api::ApiError;
use super::status::AuthReason;

/// 오프라인 유예
pub const GRACE: time::Duration = time::Duration::hours(72);
/// 정상 재확인 주기
pub const RECHECK: time::Duration = time::Duration::hours(24);
/// access 만료 전 미리 갱신하는 여유
pub const ACCESS_SKEW: time::Duration = time::Duration::seconds(60);
/// 로그인 로컬 기한
pub const LOGIN_TTL: time::Duration = time::Duration::minutes(10);
/// 포커스·복귀 때 갱신 시도 최소 간격
pub const FOCUS_MIN_GAP: time::Duration = time::Duration::seconds(60);
/// 오프라인 재시도 간격(분). k번째 연속 실패 뒤 `RETRY_MINUTES[min(k-1, 4)]`
pub const RETRY_MINUTES: [i64; 5] = [1, 2, 5, 10, 30];

/// 네트워크 계열 실패의 원인(로그·툴팁만, 판정은 같다)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cause {
    /// 응답 없음·Worker 형식이 아닌 응답
    Network,
    /// Worker 형식이지만 즉시 차단 대상이 아닌 오류·계약 위반
    Server,
}

/// 형식 있는 401·403(D4) + 재시도 추정(D7)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rejection {
    /// 401 `invalid_token`
    InvalidToken,
    /// 401 `session_expired`
    SessionExpired,
    /// 401 `session_revoked`(첫 시도)
    SessionRevoked,
    /// 응답 유실 재시도에서 받은 401 `session_revoked`
    ReuseSuspected,
    /// 403 `not_allowed`
    NotAllowed,
}

/// 갱신 한 번의 결과
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerifyOutcome {
    /// 200
    Ok,
    /// 즉시 차단 쌍
    Rejected(Rejection),
    /// 네트워크 계열
    Transient(Cause),
}

/// 갱신 결과로 정해지는 다음 상태
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Next {
    /// 200: SignedIn(온라인), 파일 교체, verifiedAt = now
    Online,
    /// 유예 안: SignedIn(오프라인), 파일 유지
    Offline {
        /// 유예 끝
        grace_until: OffsetDateTime,
        /// 원인
        cause: Cause,
    },
    /// Expired. `delete_file`이면 파일·held 삭제
    Expired {
        /// 사유
        reason: AuthReason,
        /// 파일을 지우는가
        delete_file: bool,
    },
    /// 403 `not_allowed`: Denied{RemovedFromAllowlist}, 파일 삭제
    Denied,
}

/// 유예 판정(§11.3 "유예 안" = `verified_at ≤ now < min(verified_at + 72h, refresh_expires_at)`)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Grace {
    /// 유예 안
    Within {
        /// 유예 끝
        until: OffsetDateTime,
    },
    /// 유예 밖(시계 역행 포함)
    Over,
    /// 60일 상한이 지났다
    CapPassed,
}

/// 유예 판정
pub fn grace(
    now: OffsetDateTime,
    verified_at: OffsetDateTime,
    refresh_expires_at: OffsetDateTime,
) -> Grace {
    if now >= refresh_expires_at {
        return Grace::CapPassed;
    }
    // 범위를 넘는 시각은 `SessionStore::load`가 거르지만 공개 함수라 넘침에도 panic하지 않게 한다
    let end = verified_at.saturating_add(GRACE);
    if verified_at <= now && now < end {
        Grace::Within {
            until: end.min(refresh_expires_at),
        }
    } else {
        Grace::Over
    }
}

/// 시작 때 판정(D8)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoadDecision {
    /// 유예 안: 네트워크 없이 로그인된 것으로 시작
    Optimistic,
    /// 유예 밖: 서버로 확인
    Checking,
    /// 60일 상한 지남: 네트워크 없이 만료
    CapPassed,
}

/// 시작 때 판정
pub fn load_decision(
    now: OffsetDateTime,
    verified_at: OffsetDateTime,
    refresh_expires_at: OffsetDateTime,
) -> LoadDecision {
    match grace(now, verified_at, refresh_expires_at) {
        Grace::Within { .. } => LoadDecision::Optimistic,
        Grace::Over => LoadDecision::Checking,
        Grace::CapPassed => LoadDecision::CapPassed,
    }
}

/// `ApiError` → 결과(D3·D4·D7). `retried`는 응답 유실 재시도의 결과인지
pub fn outcome_of_error(e: &ApiError, retried: bool) -> VerifyOutcome {
    use Rejection::*;
    match e {
        ApiError::Worker { status: 401, code } if code == "invalid_token" => {
            VerifyOutcome::Rejected(InvalidToken)
        }
        ApiError::Worker { status: 401, code } if code == "session_expired" => {
            VerifyOutcome::Rejected(SessionExpired)
        }
        ApiError::Worker { status: 401, code } if code == "session_revoked" => {
            VerifyOutcome::Rejected(if retried {
                ReuseSuspected
            } else {
                SessionRevoked
            })
        }
        ApiError::Worker { status: 403, code } if code == "not_allowed" => {
            VerifyOutcome::Rejected(NotAllowed)
        }
        ApiError::Worker { .. } | ApiError::Contract { .. } => {
            VerifyOutcome::Transient(Cause::Server)
        }
        ApiError::NotWorker { .. } | ApiError::Transport { .. } => {
            VerifyOutcome::Transient(Cause::Network)
        }
    }
}

/// 첫 시도의 결과가 응답 유실 후보인가(D9, 구현 중 변경 53): 서버가 회전을 커밋했는지 모르는 실패.
/// 응답 없음·Worker 형식이 아닌 응답·2xx 계약 위반·Worker 형식 5xx(DO 커밋 뒤 `500 internal`이 날 수 있다).
/// Worker 형식 4xx(400·429 등)는 서버가 커밋 전에 판정한 것이라 후보가 아니다
pub fn is_lost_response(e: &ApiError) -> bool {
    match e {
        ApiError::Transport { .. } | ApiError::NotWorker { .. } => true,
        ApiError::Contract { status } => (200..300).contains(status),
        ApiError::Worker { status, .. } => (500..600).contains(status),
    }
}

/// Worker 복구 창(`worker/src/store/sessions.ts` `RECOVERY_WINDOW_MS`): 첫 회전(`used_at`)부터 60초 안에 같은 토큰을 내면 복구된다
pub const RECOVERY_WINDOW: time::Duration = time::Duration::seconds(60);
/// 응답 유실 재시도를 보낼 수 있는 마지막 시각(첫 시도 시작부터). 창 60초 − 요청 상한 10초 − 여유 5초.
/// 첫 회전은 첫 시도를 보낸 뒤에 일어나므로 서버의 `now − used_at`은 이 경과 + 그 요청의 시간보다 작다
pub const LOST_RETRY_LAST_SEND: time::Duration = time::Duration::seconds(45);
/// 응답 유실 재시도 시각(첫 시도 시작부터): 즉시·10초·30초. 앞 요청이 늦게 끝났으면 기다리지 않고 바로 보낸다
pub const LOST_RETRY_AT: [time::Duration; 3] = [
    time::Duration::ZERO,
    time::Duration::seconds(10),
    time::Duration::seconds(30),
];

/// `done`번째(0부터) 응답 유실 재시도까지 기다릴 시간. `elapsed`는 첫 시도 시작부터의 경과
/// (벽시계·단조 시계 중 큰 값, 벽시계가 뒤로 갔으면 호출자가 None 처리). 재시도를 다 했거나
/// 보낼 시각이 `LOST_RETRY_LAST_SEND`를 넘으면 None(창 밖 재시도는 재사용 감지로 세션을 끊는다)
pub fn lost_retry_wait(done: usize, elapsed: time::Duration) -> Option<time::Duration> {
    let at = *LOST_RETRY_AT.get(done)?;
    let send_at = at.max(elapsed);
    (send_at <= LOST_RETRY_LAST_SEND).then(|| send_at - elapsed)
}

/// §11.3 판정
pub fn classify_verify(
    now: OffsetDateTime,
    verified_at: OffsetDateTime,
    refresh_expires_at: OffsetDateTime,
    outcome: VerifyOutcome,
) -> Next {
    let expired = |reason, delete_file| Next::Expired {
        reason,
        delete_file,
    };
    match outcome {
        VerifyOutcome::Ok => Next::Online,
        VerifyOutcome::Rejected(Rejection::InvalidToken | Rejection::SessionExpired) => {
            expired(AuthReason::SessionExpired, true)
        }
        VerifyOutcome::Rejected(Rejection::SessionRevoked) => expired(AuthReason::Revoked, true),
        VerifyOutcome::Rejected(Rejection::ReuseSuspected) => {
            expired(AuthReason::ReuseDetected, true)
        }
        VerifyOutcome::Rejected(Rejection::NotAllowed) => Next::Denied,
        VerifyOutcome::Transient(cause) => match grace(now, verified_at, refresh_expires_at) {
            Grace::Within { until } => Next::Offline {
                grace_until: until,
                cause,
            },
            Grace::CapPassed => expired(AuthReason::SessionExpired, true),
            Grace::Over => expired(AuthReason::GraceExpired, false),
        },
    }
}

/// 성공한 갱신 뒤 다음 갱신까지의 최소 간격(구현 중 변경 53). 로컬 시계가 서버보다 access 수명(24시간) 넘게 빠르거나
/// 60일 상한의 마지막 60초라 `accessExpiresAt − 60초`가 이미 지났어도 연속 회전(→ Worker 429)하지 않게 한다
pub const MIN_REFRESH_GAP: time::Duration = time::Duration::minutes(5);

/// 다음 갱신 시각(D20): `max(min(verifiedAt + 24h, accessExpiresAt − 60초), verifiedAt + 5분)`
pub fn refresh_due_at(
    verified_at: OffsetDateTime,
    access_expires_at: OffsetDateTime,
) -> OffsetDateTime {
    verified_at
        .saturating_add(RECHECK)
        .min(access_expires_at.saturating_sub(ACCESS_SKEW))
        .max(verified_at.saturating_add(MIN_REFRESH_GAP))
}

/// k번째(1부터) 연속 실패 뒤 기다릴 시간
pub fn retry_delay(failures: u32) -> time::Duration {
    let i = (failures.max(1) - 1).min(4) as usize;
    time::Duration::minutes(RETRY_MINUTES[i])
}
