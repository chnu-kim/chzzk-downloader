//! 진행률 출력(cli-mode.md §9.1).
//!
//! 진행률·안내는 stderr, 결과 경로는 stdout이다. 터미널(TTY)이면 한 줄을 `\r`로 고쳐 쓰고, 아니면(로그 파일·파이프)
//! 10%마다 또는 30초마다 한 줄씩 낸다. 숫자는 GUI와 같은 셸 `format` 함수가 만든다(진법은 OS 기준).

use std::io::Write;
use std::time::Duration;

use chzzk_core::Phase;

use super::copy;
use crate::consts::{CLI_PROGRESS_STEP_PERCENT, CLI_PROGRESS_STEP_SECS};
use crate::dto::ProgressDto;
use crate::format::{SizeBase, format_percent, format_progress_size, format_speed};

/// 진행률 줄 하나를 쓰는 쪽. 시각은 호출자가 넘긴다(시작 뒤 경과 시간, 테스트가 주입한다).
#[derive(Debug)]
pub struct Reporter {
    tty: bool,
    base: SizeBase,
    last_phase: Option<Phase>,
    /// 비TTY: 마지막으로 낸 10% 구간
    last_bucket: Option<u64>,
    /// 비TTY: 마지막으로 줄을 낸 시각
    last_at: Option<Duration>,
    /// TTY: 고쳐 쓰는 줄이 열려 있는가(다른 줄을 쓰기 전에 줄바꿈이 필요하다)
    line_open: bool,
    /// TTY: 마지막으로 쓴 줄의 글자 수(짧아졌을 때 남은 글자를 지운다)
    last_len: usize,
}

impl Reporter {
    pub fn new(tty: bool, base: SizeBase) -> Self {
        Reporter {
            tty,
            base,
            last_phase: None,
            last_bucket: None,
            last_at: None,
            line_open: false,
            last_len: 0,
        }
    }

    /// 진행률 한 번. `elapsed`는 이 받기를 시작한 뒤 경과 시간.
    pub fn progress(&mut self, err: &mut dyn Write, p: &ProgressDto, elapsed: Duration) {
        let phase_changed = self.last_phase != Some(p.phase);
        self.last_phase = Some(p.phase);
        if p.phase != Phase::Downloading {
            // 준비·재조회·연결 대기·마무리는 전환할 때 한 번만 알린다
            if phase_changed {
                self.note(err, phase_label(p.phase));
            }
            return;
        }
        let line = self.line(p);
        if self.tty {
            let pad = self.last_len.saturating_sub(line.chars().count());
            let _ = write!(err, "\r{line}{}", " ".repeat(pad));
            let _ = err.flush();
            self.line_open = true;
            self.last_len = line.chars().count();
            return;
        }
        let bucket = percent_of(p).map(|v| v / CLI_PROGRESS_STEP_PERCENT);
        let due_time = self.last_at.is_none_or(|t| {
            elapsed.saturating_sub(t) >= Duration::from_secs(CLI_PROGRESS_STEP_SECS)
        });
        let due_bucket = bucket.is_some() && bucket != self.last_bucket;
        if phase_changed || due_bucket || due_time {
            let _ = writeln!(err, "{line}");
            self.last_at = Some(elapsed);
            if bucket.is_some() {
                self.last_bucket = bucket;
            }
        }
    }

    /// 안내 한 줄(고쳐 쓰던 줄이 있으면 먼저 줄을 바꾼다).
    pub fn note(&mut self, err: &mut dyn Write, msg: &str) {
        self.end_line(err);
        let _ = writeln!(err, "{msg}");
    }

    /// 고쳐 쓰던 줄을 끝낸다.
    pub fn end_line(&mut self, err: &mut dyn Write) {
        if self.line_open {
            let _ = writeln!(err);
            self.line_open = false;
            self.last_len = 0;
        }
    }

    fn line(&self, p: &ProgressDto) -> String {
        let mut parts = vec![copy::PHASE_DOWNLOADING.to_string()];
        if let Some(v) = percent_of(p) {
            parts.push(percent_text(p, v));
        }
        let total = p.total_bytes.or(p.total_bytes_estimate);
        let (got, all) = format_progress_size(p.bytes, total, self.base);
        parts.push(match all {
            Some(all) => format!("{got} / {all}"),
            None => got,
        });
        if let Some(bps) = p.speed_bps {
            parts.push(format_speed(bps, self.base));
        }
        parts.join(" · ")
    }
}

/// 진행 퍼센트(정수 내림, 0~99). 전체 크기를 모르면 조각 수로, 그것도 없으면 없다.
fn percent_of(p: &ProgressDto) -> Option<u64> {
    let ratio =
        |done: u64, total: u64| (total > 0).then(|| (done.saturating_mul(100) / total).min(99));
    match p.total_bytes.or(p.total_bytes_estimate) {
        Some(t) => ratio(p.bytes, t),
        None => match (p.segments_done, p.segments_total) {
            (Some(d), Some(t)) => ratio(u64::from(d), u64::from(t)),
            _ => None,
        },
    }
}

/// GUI와 같은 퍼센트 글자(`format_percent`)
fn percent_text(p: &ProgressDto, v: u64) -> String {
    match p.total_bytes.or(p.total_bytes_estimate) {
        Some(t) => format_percent(p.bytes, t, false),
        None => format!("{v}%"),
    }
}

fn phase_label(phase: Phase) -> &'static str {
    match phase {
        Phase::Resolving => copy::PHASE_RESOLVING,
        Phase::Downloading => copy::PHASE_DOWNLOADING,
        Phase::Reresolving => copy::PHASE_RERESOLVING,
        Phase::WaitingNetwork => copy::PHASE_WAITING_NETWORK,
        Phase::Finalizing => copy::PHASE_FINALIZING,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dl(bytes: u64, total: Option<u64>) -> ProgressDto {
        ProgressDto {
            phase: Phase::Downloading,
            bytes,
            total_bytes: total,
            total_bytes_estimate: None,
            segments_done: None,
            segments_total: None,
            media_secs_done: None,
            media_secs_total: None,
            speed_bps: Some(12_300_000),
            eta_secs: None,
            resumed_from: 0,
            refreshes: 0,
            live_recorded_secs: None,
            live_gaps: None,
        }
    }

    fn text(f: impl FnOnce(&mut Vec<u8>)) -> String {
        let mut buf = Vec::new();
        f(&mut buf);
        String::from_utf8(buf).unwrap()
    }

    #[test]
    fn tty_rewrites_one_line_with_carriage_return() {
        let mut r = Reporter::new(true, SizeBase::Decimal);
        let out = text(|b| {
            r.progress(b, &dl(420_000_000, Some(1_000_000_000)), Duration::ZERO);
            r.progress(
                b,
                &dl(430_000_000, Some(1_000_000_000)),
                Duration::from_secs(1),
            );
            r.end_line(b);
        });
        assert_eq!(out.matches('\r').count(), 2, "{out:?}");
        assert!(
            out.contains("받는 중 · 42% · 0.4GB / 1.0GB · 12.3MB/s"),
            "{out:?}"
        );
        assert!(out.ends_with('\n'));
        assert_eq!(out.matches('\n').count(), 1);
    }

    #[test]
    fn non_tty_prints_every_ten_percent_or_thirty_seconds() {
        let mut r = Reporter::new(false, SizeBase::Decimal);
        let total = Some(1_000);
        let out = text(|b| {
            // 처음 한 줄, 같은 10% 구간은 건너뜀, 다음 구간에서 한 줄
            r.progress(b, &dl(5, total), Duration::ZERO);
            r.progress(b, &dl(50, total), Duration::from_secs(1));
            r.progress(b, &dl(95, total), Duration::from_secs(2));
            r.progress(b, &dl(109, total), Duration::from_secs(3));
            r.progress(b, &dl(115, total), Duration::from_secs(4));
            // 같은 구간이어도 30초가 지나면 한 줄
            r.progress(b, &dl(118, total), Duration::from_secs(34));
        });
        let lines: Vec<&str> = out.lines().collect();
        assert_eq!(lines.len(), 3, "{out}");
        assert!(!out.contains('\r'));
        assert!(lines[0].contains(" 0% "), "{out}");
        assert!(lines[1].contains("10%"), "{out}");
        assert!(lines[2].contains("11%"), "{out}");
    }

    #[test]
    fn unknown_total_uses_segments_then_nothing() {
        let mut p = dl(1_000_000, None);
        assert_eq!(percent_of(&p), None);
        p.segments_done = Some(3);
        p.segments_total = Some(10);
        assert_eq!(percent_of(&p), Some(30));
        let r = Reporter::new(false, SizeBase::Decimal);
        assert!(r.line(&dl(1_000_000, None)).starts_with("받는 중 · 1.0MB"));
    }

    #[test]
    fn phase_transitions_print_once() {
        let mut r = Reporter::new(false, SizeBase::Decimal);
        let mut p = dl(0, None);
        p.phase = Phase::WaitingNetwork;
        let out = text(|b| {
            r.progress(b, &p, Duration::ZERO);
            r.progress(b, &p, Duration::from_secs(1));
            p.phase = Phase::Finalizing;
            r.progress(b, &p, Duration::from_secs(2));
        });
        assert_eq!(out, "연결 대기 중\n마무리 중\n");
    }

    #[test]
    fn note_closes_an_open_tty_line_first() {
        let mut r = Reporter::new(true, SizeBase::Decimal);
        let out = text(|b| {
            r.progress(b, &dl(10, Some(100)), Duration::ZERO);
            r.note(b, "안내");
        });
        assert!(out.ends_with("\n안내\n"), "{out:?}");
    }
}
