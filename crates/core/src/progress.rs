//! 진행률 데이터와 순수 포맷 함수.
//!
//! `format_bytes`·`format_hms`·`speed_eta`는 Go 구현(spec §6.1, §6.6)의 golden을 그대로 따른다.
//! 셸은 `Progress`의 숫자를 받아 직접 표시하고, 문자열 포맷은 CLI(`examples/dl.rs`)가 쓴다.

use std::time::Duration;

use serde::Serialize;

/// 다운로드 단계.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Resolving,
    Downloading,
    Reresolving,
    Finalizing,
}

/// 진행률 콜백에 넘기는 값.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: Phase,
    /// `.part` 누적 바이트(이어받은 분 포함)
    pub bytes: u64,
    /// progressive만
    pub total_bytes: Option<u64>,
    /// HLS: bytes / media_done * media_total
    pub total_bytes_estimate: Option<u64>,
    /// (완료, 전체) HLS만
    pub segments: Option<(u32, u32)>,
    /// (완료, 전체) 미디어 초. HLS만
    pub media_secs: Option<(f64, f64)>,
    pub speed_bps: Option<u64>,
    pub eta_secs: Option<u64>,
    pub resumed_from: u64,
    pub refreshes: u32,
}

/// 이번 실행에서 쓴 바이트와 경과 시간으로 (초당 바이트, 남은 초)를 구한다.
///
/// - 경과 시간이 0이거나 쓴 바이트가 0이면 `(None, None)`
/// - 속도는 초당 바이트를 내림한 정수다.
/// - ETA는 전체 크기를 알고(`> 0`), 아직 남았을 때만. 실수 속도로 나눈 뒤 내림한다.
pub fn speed_eta(
    written: u64,
    total: Option<u64>,
    elapsed: Duration,
) -> (Option<u64>, Option<u64>) {
    let secs = elapsed.as_secs_f64();
    if secs <= 0.0 || written == 0 {
        return (None, None);
    }
    let bytes_per_sec = written as f64 / secs;
    let speed = bytes_per_sec as u64;
    let eta = match total {
        Some(total) if total > 0 && bytes_per_sec > 0.0 && written < total => {
            Some(((total - written) as f64 / bytes_per_sec) as u64)
        }
        _ => None,
    };
    (Some(speed), eta)
}

/// 1024진법 크기 표기. `1023 B`, `1.5 KB`, `1024.0 KB`(1048575), `1.0 MB` …
pub fn format_bytes(n: u64) -> String {
    const UNIT: u64 = 1024;
    if n < UNIT {
        return format!("{n} B");
    }
    // Go와 같은 나눗셈 루프: 몫이 1024 미만이 될 때까지 단위를 올린다.
    let mut div = UNIT;
    let mut exp = 0usize;
    let mut q = n / UNIT;
    while q >= UNIT {
        div *= UNIT;
        exp += 1;
        q /= UNIT;
    }
    let unit = b"KMGTPE"[exp] as char;
    format!("{:.1} {unit}B", n as f64 / div as f64)
}

/// 초를 `HH:MM:SS`로. 시는 두 자리 이상(`100:00:00`).
pub fn format_hms(secs: u64) -> String {
    format!(
        "{:02}:{:02}:{:02}",
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_bytes_golden() {
        let cases: [(u64, &str); 8] = [
            (0, "0 B"),
            (1023, "1023 B"),
            (1024, "1.0 KB"),
            (1536, "1.5 KB"),
            (1048575, "1024.0 KB"),
            (1048576, "1.0 MB"),
            (1073741824, "1.0 GB"),
            (5497558138880, "5.0 TB"),
        ];
        for (n, want) in cases {
            assert_eq!(format_bytes(n), want, "n={n}");
        }
    }

    #[test]
    fn format_bytes_max_does_not_panic() {
        assert_eq!(format_bytes(u64::MAX), "16.0 EB");
    }

    #[test]
    fn format_hms() {
        let cases: [(u64, &str); 5] = [
            (0, "00:00:00"),
            (59, "00:00:59"),
            (3661, "01:01:01"),
            (86399, "23:59:59"),
            (360000, "100:00:00"),
        ];
        for (s, want) in cases {
            assert_eq!(super::format_hms(s), want, "secs={s}");
        }
    }

    #[test]
    fn speed_eta_golden() {
        let sec = Duration::from_secs(1);
        // (1MiB, 2MiB, 1s) → 1.0 MB/s, 00:00:01
        assert_eq!(
            speed_eta(1 << 20, Some(2 << 20), sec),
            (Some(1_048_576), Some(1))
        );
        // 경과 0 → 둘 다 없음
        assert_eq!(speed_eta(1024, Some(2048), Duration::ZERO), (None, None));
        // 전체 크기 모름 → ETA 없음
        assert_eq!(speed_eta(1024, None, sec), (Some(1024), None));
        assert_eq!(speed_eta(1024, Some(0), sec), (Some(1024), None));
        // 다 받음 → ETA 없음
        assert_eq!(speed_eta(2048, Some(2048), sec), (Some(2048), None));
        // 아직 0바이트 → 둘 다 없음
        assert_eq!(speed_eta(0, Some(2048), sec), (None, None));
        // 문자열 golden과 맞물리는지
        let (speed, eta) = speed_eta(1 << 20, Some(2 << 20), sec);
        assert_eq!(format_bytes(speed.unwrap()) + "/s", "1.0 MB/s");
        assert_eq!(super::format_hms(eta.unwrap()), "00:00:01");
    }

    #[test]
    fn eta_uses_fractional_speed() {
        // 3B / 2s = 1.5B/s, 남은 3B. 실수 속도면 2초, 내림한 정수 속도(1)로 나누면 3초가 된다.
        assert_eq!(
            speed_eta(3, Some(6), Duration::from_secs(2)),
            (Some(1), Some(2))
        );
    }
}
