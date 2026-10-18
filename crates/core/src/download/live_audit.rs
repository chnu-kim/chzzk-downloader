//! 생방송 녹화 실측(M-⑤-A·B, decisions.md)용 사건 로그의 약속과 판정. 엔진(`live`)이 이 target으로 `tracing` 사건을 내고,
//! `examples/live_check.rs`가 그 사건을 모아 판정한다. 앱 로그에도 같은 사건이 남는다.
//!
//! 사건의 필드는 숫자와 아래 상수 문자열뿐이다. 주소·서명은 넣지 않는다.
//!
//! | `event` | 필드 | 언제 |
//! |---|---|---|
//! | `refresh` | `cause`(`CAUSE_*`) | 재조회를 시작할 때 |
//! | `after_refresh` | `next_msn`·`first`·`last` | 같은 방송으로 재조회한 뒤 처음 읽은 playlist(세그먼트가 있을 때) |
//! | `gap` | `cause`(`GAP_*`)·`count` | 구멍을 셀 때 |

/// 사건의 `tracing` target.
pub const LOG_TARGET: &str = "chzzk_core::live_audit";

/// 재조회 이유: 세그먼트가 403(서명 만료).
pub const CAUSE_SEGMENT_EXPIRED: &str = "segment_expired";
/// 재조회 이유: playlist가 403(서명 만료).
pub const CAUSE_PLAYLIST_EXPIRED: &str = "playlist_expired";
/// 재조회 이유: 한참 새 세그먼트가 없어 방송이 끝났는지 본다.
pub const CAUSE_IDLE: &str = "idle";

/// 구멍 이유: playlist 창이 받을 차례를 지나가 버렸다.
pub const GAP_WINDOW: &str = "window";
/// 구멍 이유: 세그먼트가 404·410이었다(M-⑤-B가 세는 것).
pub const GAP_SEGMENT_GONE: &str = "segment_gone";
/// 구멍 이유: 세그먼트의 일시 오류(5xx·본문 검증 실패).
pub const GAP_TRANSIENT: &str = "transient";

/// 재조회 뒤 첫 playlist가 받던 번호와 어떻게 이어지는가(M-⑤-A).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Continuity {
    /// 마지막으로 받은 조각(`next_msn - 1`)이 새 목록에도 있다.
    Overlaps,
    /// 새 목록이 받을 차례(`next_msn`)부터 시작한다(겹침 없이 이어짐).
    Adjacent,
    /// 새 목록이 받을 차례를 이만큼 건너뛰었다(구멍).
    Skipped(u64),
    /// 새 목록의 끝이 받은 것보다 이만큼 뒤에 있다(번호가 줄었다).
    Behind(u64),
}

impl Continuity {
    /// 이어 붙여도 되는가(번호가 같은 흐름을 가리킨다고 볼 수 있는가).
    pub fn continues(self) -> bool {
        matches!(self, Continuity::Overlaps | Continuity::Adjacent)
    }
}

/// 받을 차례 `next_msn`과 새 목록의 첫·끝 번호로 판정한다.
///
/// 아직 새 조각이 없는 목록(`last + 1 == next_msn`)은 마지막으로 받은 조각을 담고 있으면 `Overlaps`다.
pub fn classify(next_msn: u64, first: u64, last: u64) -> Continuity {
    if last.saturating_add(1) < next_msn {
        return Continuity::Behind(next_msn - 1 - last);
    }
    if first > next_msn {
        return Continuity::Skipped(first - next_msn);
    }
    if next_msn > 0 && first < next_msn {
        Continuity::Overlaps
    } else {
        Continuity::Adjacent
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_cases() {
        // 받을 차례 10: 9까지 받았다
        assert_eq!(classify(10, 7, 12), Continuity::Overlaps);
        assert_eq!(classify(10, 9, 9), Continuity::Overlaps);
        assert_eq!(classify(10, 10, 12), Continuity::Adjacent);
        assert_eq!(classify(10, 13, 15), Continuity::Skipped(3));
        assert_eq!(classify(10, 4, 7), Continuity::Behind(2));
        assert_eq!(classify(10, 2, 8), Continuity::Behind(1));
        assert!(classify(10, 9, 11).continues());
        assert!(!classify(10, 11, 12).continues());
        assert!(!classify(10, 1, 3).continues());
        // 처음(0)부터
        assert_eq!(classify(0, 0, 2), Continuity::Adjacent);
    }
}
