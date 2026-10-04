//! 진행률 데이터와 순수 포맷 함수.
//!
//! `format_bytes`·`format_hms`·`speed_eta`는 Go 구현(spec §6.1, §6.6)의 golden을 그대로 따른다.
//! 셸은 `Progress`의 숫자를 받아 직접 표시하고, 문자열 포맷은 CLI(`examples/dl.rs`)가 쓴다.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

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

/// 속도를 재는 창.
const SPEED_WINDOW: Duration = Duration::from_secs(5);
/// 창에 표본을 넣는 최소 간격(표본 수를 50개 안팎으로 묶는다).
const SAMPLE_EVERY: Duration = Duration::from_millis(100);

/// 진행률 스로틀과 속도·ETA 계산기.
///
/// - 콜백은 `interval`마다 한 번만 보낸다. 단계가 바뀔 때와 `force`일 때는 무조건 보낸다.
/// - 속도는 최근 5초 창의 (바이트 증가 / 경과)다. 이어받은 바이트는 들어가지 않는다(이번 실행 기준).
/// - ETA: `total_bytes`가 있으면(progressive) `(total − bytes) / 속도`.
///   없고 `media_secs`가 있으면(HLS) `(media_total − media_done) / 미디어초 처리율`.
///   세그먼트 수 비율은 쓰지 않는다(마지막 세그먼트가 짧고 크기가 제각각이다).
/// - 시각은 인자로 받는다(테스트가 시계를 직접 넘긴다).
#[derive(Debug)]
pub struct Meter {
    interval: Duration,
    last_emit: Option<Instant>,
    last_phase: Option<Phase>,
    /// (시각, 바이트, 처리한 미디어 초). 미디어 초는 HLS에서만 있다.
    samples: VecDeque<(Instant, u64, Option<f64>)>,
}

impl Meter {
    pub fn new(interval: Duration) -> Self {
        Meter {
            interval,
            last_emit: None,
            last_phase: None,
            samples: VecDeque::new(),
        }
    }

    /// `p`를 관찰해 `speed_bps`·`eta_secs`를 채우고, 지금 보내야 하면 true.
    pub fn observe(&mut self, p: &mut Progress, now: Instant, force: bool) -> bool {
        let media_done = p.media_secs.map(|(d, _)| d);
        // 이어받기·처음부터 다시(바이트 감소)면 창을 새로 시작한다.
        // 미디어 초가 처음 들어올 때도 새로 시작한다. 이어받기면 그 값에 이미 받은 분량이 들어 있어
        // 0초부터 잰 처리율이 부풀고 ETA가 터무니없이 작아진다.
        if self
            .samples
            .back()
            .is_some_and(|&(_, b, m)| p.bytes < b || (m.is_none() && media_done.is_some()))
        {
            self.samples.clear();
        }
        let push = self
            .samples
            .back()
            .is_none_or(|&(t, _, _)| now.saturating_duration_since(t) >= SAMPLE_EVERY);
        if push {
            self.samples.push_back((now, p.bytes, media_done));
        }
        // 창 밖 표본은 버리되, 창 시작을 대신할 표본 하나는 남긴다.
        while self.samples.len() > 2
            && self
                .samples
                .get(1)
                .is_some_and(|&(t, _, _)| now.saturating_duration_since(t) >= SPEED_WINDOW)
        {
            self.samples.pop_front();
        }
        self.fill_rates(p, now);

        let phase_changed = self.last_phase != Some(p.phase);
        let due = self
            .last_emit
            .is_none_or(|t| now.saturating_duration_since(t) >= self.interval);
        if force || phase_changed || due {
            self.last_emit = Some(now);
            self.last_phase = Some(p.phase);
            true
        } else {
            false
        }
    }

    fn fill_rates(&self, p: &mut Progress, now: Instant) {
        let Some(&(t0, b0, m0)) = self.samples.front() else {
            return;
        };
        let dt = now.saturating_duration_since(t0).as_secs_f64();
        if dt <= 0.0 {
            return;
        }
        let bytes_rate = p.bytes.saturating_sub(b0) as f64 / dt;
        p.speed_bps = (bytes_rate > 0.0).then_some(bytes_rate as u64);
        p.eta_secs = match (p.total_bytes, p.media_secs) {
            (Some(total), _) if bytes_rate > 0.0 && p.bytes < total => {
                Some(((total - p.bytes) as f64 / bytes_rate) as u64)
            }
            (None, Some((done, total))) => {
                let media_rate = (done - m0.unwrap_or(0.0)) / dt;
                (media_rate > 0.0 && done < total).then(|| ((total - done) / media_rate) as u64)
            }
            _ => None,
        };
    }
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
        let cases: [(u64, &str); 12] = [
            // Go `%.1f`와 같은 반올림(정확한 .x5는 짝수 쪽). Go 1.x로 직접 확인한 값이다.
            (1280, "1.2 KB"),
            (3328, "3.2 KB"),
            (1792, "1.8 KB"),
            (2662, "2.6 KB"),
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

    fn progress(phase: Phase, bytes: u64) -> Progress {
        Progress {
            phase,
            bytes,
            total_bytes: None,
            total_bytes_estimate: None,
            segments: None,
            media_secs: None,
            speed_bps: None,
            eta_secs: None,
            resumed_from: 0,
            refreshes: 0,
        }
    }

    #[test]
    fn throttle_and_final_event() {
        let t0 = Instant::now();
        let ms = |n: u64| t0 + Duration::from_millis(n);
        let mut m = Meter::new(Duration::from_secs(1));
        let mut p = progress(Phase::Resolving, 0);
        assert!(m.observe(&mut p, ms(0), false), "첫 이벤트");
        p.phase = Phase::Downloading;
        assert!(m.observe(&mut p, ms(10), false), "단계 변경");
        p.bytes = 100;
        assert!(!m.observe(&mut p, ms(500), false), "간격 안");
        p.bytes = 200;
        assert!(m.observe(&mut p, ms(1010), false), "간격 지남");
        p.bytes = 300;
        assert!(!m.observe(&mut p, ms(1100), false));
        assert!(m.observe(&mut p, ms(1100), true), "force");
        p.phase = Phase::Finalizing;
        assert!(
            m.observe(&mut p, ms(1150), false),
            "마지막(Finalizing)은 무조건"
        );

        // 간격 0이면 매번 보낸다.
        let mut m = Meter::new(Duration::ZERO);
        let mut p = progress(Phase::Downloading, 0);
        for i in 0..5 {
            p.bytes = i;
            assert!(m.observe(&mut p, t0, false));
        }
    }

    #[test]
    fn speed_and_eta_progressive() {
        let t0 = Instant::now();
        let mut m = Meter::new(Duration::ZERO);
        // 이어받은 1000바이트에서 시작: 속도에 넣지 않는다.
        let mut p = progress(Phase::Downloading, 1000);
        p.total_bytes = Some(11_000);
        m.observe(&mut p, t0, false);
        assert_eq!((p.speed_bps, p.eta_secs), (None, None));
        p.bytes = 3000;
        m.observe(&mut p, t0 + Duration::from_secs(2), false);
        // 2000B / 2s = 1000B/s, 남은 8000B → 8초
        assert_eq!(p.speed_bps, Some(1000));
        assert_eq!(p.eta_secs, Some(8));
        p.bytes = 11_000;
        m.observe(&mut p, t0 + Duration::from_secs(4), false);
        assert_eq!(p.eta_secs, None, "다 받았으면 ETA 없음");
    }

    /// HLS ETA는 세그먼트 수가 아니라 미디어 시간 처리율로 계산한다.
    #[test]
    fn eta_by_media_time() {
        let t0 = Instant::now();
        let mut m = Meter::new(Duration::ZERO);
        let mut p = progress(Phase::Downloading, 0);
        p.segments = Some((0, 50));
        p.media_secs = Some((0.0, 100.0));
        m.observe(&mut p, t0, false);
        // 2초 동안 미디어 10초(세그먼트 1개, 크기 1000B) 처리 → 5배속, 남은 90초 → 18초
        p.bytes = 1000;
        p.segments = Some((1, 50));
        p.media_secs = Some((10.0, 100.0));
        m.observe(&mut p, t0 + Duration::from_secs(2), false);
        assert_eq!(p.speed_bps, Some(500));
        assert_eq!(p.eta_secs, Some(18));
    }

    /// 이어받기: 첫 보고는 이어받은 바이트만 있고 미디어 초가 없다. 그다음 보고의 미디어 초(이미 받은 194초)를
    /// 방금 받은 것으로 세면 ETA가 터무니없이 작다.
    #[test]
    fn eta_after_resume() {
        let t0 = Instant::now();
        let s = |ms: u64| t0 + Duration::from_millis(ms);
        let mut m = Meter::new(Duration::ZERO);
        let mut p = progress(Phase::Resolving, 5_000_000);
        m.observe(&mut p, s(0), false);
        p.phase = Phase::Downloading;
        p.media_secs = Some((194.0, 3565.0));
        p.bytes = 5_100_000;
        m.observe(&mut p, s(1000), false);
        assert!(p.eta_secs.is_none_or(|e| e > 600), "{:?}", p.eta_secs);
        // 2초에 미디어 10초 → 5배속, 남은 3361초 → 672초
        p.media_secs = Some((204.0, 3565.0));
        p.bytes = 5_200_000;
        m.observe(&mut p, s(3000), false);
        assert_eq!(p.eta_secs, Some(672));
    }

    /// 5초 창: 오래된 표본은 속도에 들어가지 않는다.
    #[test]
    fn speed_uses_recent_window() {
        let t0 = Instant::now();
        let s = |n: u64| t0 + Duration::from_secs(n);
        let mut m = Meter::new(Duration::ZERO);
        let mut p = progress(Phase::Downloading, 0);
        m.observe(&mut p, s(0), false);
        // 처음 10초는 초당 100B
        for i in 1..=10 {
            p.bytes = i * 100;
            m.observe(&mut p, s(i), false);
        }
        // 다음 10초는 초당 1000B
        for i in 1..=10 {
            p.bytes = 1000 + i * 1000;
            m.observe(&mut p, s(10 + i), false);
        }
        let speed = p.speed_bps.unwrap();
        assert!((1000..=1250).contains(&speed), "{speed}");
    }

    #[test]
    fn restart_resets_window() {
        let t0 = Instant::now();
        let mut m = Meter::new(Duration::ZERO);
        let mut p = progress(Phase::Downloading, 5000);
        m.observe(&mut p, t0, false);
        // 서버가 Range를 무시해 처음부터: 바이트가 줄면 창을 새로 시작한다.
        p.bytes = 0;
        m.observe(&mut p, t0 + Duration::from_secs(1), false);
        p.bytes = 2000;
        m.observe(&mut p, t0 + Duration::from_secs(3), false);
        assert_eq!(p.speed_bps, Some(1000));
    }
}
