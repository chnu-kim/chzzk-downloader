//! Dock·작업 표시줄 진행 집계(system/platform.md §8.2, D29). Tauri 비의존 순수 로직이다.
//!
//! 앱 셸은 1Hz(`DOCK_PROGRESS_MIN_INTERVAL_MS`)로 작업 목록 스냅샷을 `DockMeter::tick`에 넘기고, `Some`이 돌아오면
//! 그 값을 OS에 칠한다. 매니저는 건드리지 않는다.
//!
//! - **배치 구성원**: 배치가 열린 뒤 한 번이라도 running·pausing·queued였던 작업. 배치는 그런 작업이 처음 보일 때 열린다.
//! - **배치 끝**: 구성원이 모두 completed·skipped·failed이거나 목록에서 사라졌을 때만. paused·interrupted 구성원은 배치를
//!   열어 둔다(모두 일시정지해도 배치는 계속, 다시 이어받으면 같은 배치).
//! - **진행값**: 구성원 전체의 받은 합 ÷ 전체 합 × 100 내림. 전체를 모르는 구성원은 분자·분모 모두에서 뺀다.
//!   배치 안에서 내보내는 값은 직전 값보다 작아지지 않는다(새 구성원이 더해져 분모가 커질 때의 감소만 흡수한다).
//! - **상태**: 구성원 중 running·pausing·queued가 있으면 `Normal`(일부가 실패해도). 그런 게 없고 paused·interrupted가
//!   있으면 `Paused`(failed가 함께 있어도 Paused가 이긴다: 아직 끝나지 않은 배치다). 배치 끝 + failed 하나 이상 +
//!   포커스 없음이면 `Error`(마지막 값), 포커스가 오면 확인한 것으로 보고 `None`으로 배치를 닫는다. 그 밖은 `None`.
//! - 전체를 아는 구성원이 없으면 `Normal` + 진행값 없음(Indeterminate는 쓰지 않는다).

use std::collections::HashSet;

use crate::dto::{JobDto, JobId, JobStatus};

/// OS에 칠할 진행 표시 상태.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DockStatus {
    /// 표시 없음(명시적으로 지운다)
    None,
    Normal,
    Paused,
    Error,
}

/// OS에 칠할 값 하나.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DockState {
    pub status: DockStatus,
    /// 0..=100. `None`이면 진행값 없음
    pub progress: Option<u8>,
}

impl DockState {
    const CLEARED: DockState = DockState {
        status: DockStatus::None,
        progress: None,
    };
}

/// 열려 있는 배치.
#[derive(Debug)]
struct Batch {
    members: HashSet<JobId>,
    /// 배치 안에서 내보낸 가장 큰 값(단조 보장)
    floor: Option<u8>,
}

/// 배치 상태를 쥐고 틱마다 칠할 값을 계산한다.
#[derive(Debug, Default)]
pub struct DockMeter {
    batch: Option<Batch>,
    /// 마지막으로 돌려준 값. `None`이면 아직 한 번도 돌려주지 않았다(처음 호출은 늘 `Some`)
    last: Option<DockState>,
}

fn is_active(s: JobStatus) -> bool {
    matches!(
        s,
        JobStatus::Running | JobStatus::Pausing | JobStatus::Queued
    )
}

/// 작업이 진행값에 보태는 (받은 바이트, 전체 바이트). 전체를 모르면 `None`(분자·분모에서 뺀다).
fn contribution(j: &JobDto) -> Option<(u64, u64)> {
    match j.status {
        JobStatus::Completed | JobStatus::Skipped => j.final_bytes.map(|b| (b, b)),
        _ => {
            let p = j.progress.as_ref();
            let total = p.and_then(|p| p.total_bytes.or(p.total_bytes_estimate))?;
            let received = p.map(|p| p.bytes).or(j.partial_bytes).unwrap_or(0);
            Some((received, total))
        }
    }
}

impl DockMeter {
    /// 이번 틱의 값. 바뀌었을 때만 `Some`(처음 호출은 늘 `Some`, 명시적 지우기 포함).
    pub fn tick(&mut self, jobs: &[JobDto], focused: bool) -> Option<DockState> {
        let next = self.compute(jobs, focused);
        if self.last == Some(next) {
            return None;
        }
        self.last = Some(next);
        Some(next)
    }

    fn compute(&mut self, jobs: &[JobDto], focused: bool) -> DockState {
        // 배치 구성원 갱신: 목록에서 사라진 작업은 빠지고, 활성 작업이 처음 보이면 더해진다(없으면 배치를 연다)
        let present: HashSet<JobId> = jobs.iter().map(|j| j.id).collect();
        let active_ids = jobs.iter().filter(|j| is_active(j.status)).map(|j| j.id);
        match &mut self.batch {
            Some(b) => {
                b.members.retain(|id| present.contains(id));
                b.members.extend(active_ids);
            }
            None => {
                let members: HashSet<JobId> = active_ids.collect();
                if members.is_empty() {
                    return DockState::CLEARED;
                }
                self.batch = Some(Batch {
                    members,
                    floor: None,
                });
            }
        }
        let Some(batch) = self.batch.as_mut() else {
            return DockState::CLEARED;
        };

        let members: Vec<&JobDto> = jobs
            .iter()
            .filter(|j| batch.members.contains(&j.id))
            .collect();
        let any_active = members.iter().any(|j| is_active(j.status));
        let any_open = members
            .iter()
            .any(|j| matches!(j.status, JobStatus::Paused | JobStatus::Interrupted));
        let any_failed = members.iter().any(|j| j.status == JobStatus::Failed);

        let status = if any_active {
            DockStatus::Normal
        } else if any_open {
            DockStatus::Paused
        } else if any_failed && !focused {
            // 배치 끝 + 실패: 포커스가 올 때까지 마지막 값을 붉게 둔다. 값은 새로 계산하지 않는다
            return DockState {
                status: DockStatus::Error,
                progress: batch.floor,
            };
        } else {
            // 배치 끝(실패 없음, 또는 실패를 포커스 중에 봤다): 배치를 닫는다
            self.batch = None;
            return DockState::CLEARED;
        };

        let (received, total) = members
            .iter()
            .filter_map(|j| contribution(j))
            .fold((0u128, 0u128), |(r, t), (jr, jt)| {
                (r + u128::from(jr), t + u128::from(jt))
            });
        let computed = (total > 0).then(|| (received * 100 / total).min(100) as u8);
        // 분모가 커져도 값은 줄지 않는다
        let progress = match (computed, batch.floor) {
            (Some(c), Some(f)) => Some(c.max(f)),
            (Some(c), None) => Some(c),
            (None, f) => f,
        };
        batch.floor = progress;
        DockState { status, progress }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::{ContentKindDto, ProgressDto};
    use chzzk_core::{Phase, PlaybackKind};

    fn progress(bytes: u64, total: Option<u64>, estimate: Option<u64>) -> ProgressDto {
        ProgressDto {
            phase: Phase::Downloading,
            bytes,
            total_bytes: total,
            total_bytes_estimate: estimate,
            segments_done: None,
            segments_total: None,
            media_secs_done: None,
            media_secs_total: None,
            speed_bps: None,
            eta_secs: None,
            resumed_from: 0,
            refreshes: 0,
        }
    }

    fn job(id: u64, status: JobStatus) -> JobDto {
        JobDto {
            id: JobId(id),
            url: String::new(),
            title: String::new(),
            channel_name: String::new(),
            channel_id: None,
            kind: ContentKindDto::Video,
            playback_kind: PlaybackKind::Progressive,
            quality_label: String::new(),
            output: String::new(),
            status,
            progress: None,
            error: None,
            partial_bytes: None,
            final_bytes: None,
            missing: false,
            created_at: 0,
            finished_at: None,
            stopped_at: None,
        }
    }

    fn running(id: u64, bytes: u64, total: u64) -> JobDto {
        JobDto {
            progress: Some(progress(bytes, Some(total), None)),
            ..job(id, JobStatus::Running)
        }
    }

    fn done(id: u64, bytes: u64) -> JobDto {
        JobDto {
            final_bytes: Some(bytes),
            ..job(id, JobStatus::Completed)
        }
    }

    fn state(status: DockStatus, progress: Option<u8>) -> DockState {
        DockState { status, progress }
    }

    /// 처음 호출은 늘 `Some`(지우기 포함), 같은 값이면 `None`
    #[test]
    fn first_tick_always_emits_and_unchanged_is_silent() {
        let mut m = DockMeter::default();
        assert_eq!(m.tick(&[], true), Some(DockState::CLEARED));
        assert_eq!(m.tick(&[], true), None);
        let j = [running(1, 250, 1000)];
        assert_eq!(m.tick(&j, true), Some(state(DockStatus::Normal, Some(25))));
        assert_eq!(m.tick(&j, true), None);
    }

    /// 시작 시 paused만 있으면 배치가 열리지 않아 표시가 없다
    #[test]
    fn only_paused_at_start_shows_nothing() {
        let mut m = DockMeter::default();
        let jobs = [
            JobDto {
                partial_bytes: Some(500),
                ..job(1, JobStatus::Paused)
            },
            job(2, JobStatus::Interrupted),
            job(3, JobStatus::Failed),
        ];
        assert_eq!(m.tick(&jobs, false), Some(DockState::CLEARED));
        assert_eq!(m.tick(&jobs, false), None);
    }

    /// 새 구성원이 더해져 분모가 커져도 값은 줄지 않는다
    #[test]
    fn value_is_monotone_when_denominator_grows() {
        let mut m = DockMeter::default();
        let s = m.tick(&[running(1, 800, 1000)], true).unwrap();
        assert_eq!(s.progress, Some(80));
        // 큰 작업이 대기열에서 시작 → 계산값은 (800+0)/(1000+9000) = 8
        let jobs = [running(1, 800, 1000), running(2, 0, 9000)];
        let s = m.tick(&jobs, true);
        assert_eq!(s, None, "80 아래로 내려가지 않으므로 바뀐 값이 없다");
        let jobs = [running(1, 1000, 1000), running(2, 9000, 9000)];
        assert_eq!(
            m.tick(&jobs, true),
            Some(state(DockStatus::Normal, Some(100)))
        );
    }

    /// 한 작업이 끝나는 순간 값이 튀지 않는다(완료는 받은 = 전체 = final_bytes)
    #[test]
    fn completion_does_not_jump_the_value() {
        let mut m = DockMeter::default();
        let jobs = [running(1, 990, 1000), running(2, 0, 1000)];
        assert_eq!(
            m.tick(&jobs, true),
            Some(state(DockStatus::Normal, Some(49)))
        );
        // 1번이 끝났다: (1000 + 0) / 2000 = 50
        let jobs = [done(1, 1000), running(2, 0, 1000)];
        assert_eq!(
            m.tick(&jobs, true),
            Some(state(DockStatus::Normal, Some(50)))
        );
        // 마지막 하나가 끝나면 배치가 끝나 표시가 지워진다
        let jobs = [done(1, 1000), done(2, 1000)];
        assert_eq!(m.tick(&jobs, true), Some(DockState::CLEARED));
    }

    /// 전부 일시정지해도 배치는 계속(Paused, 마지막 값), 다시 이어받으면 같은 배치(값이 이어진다)
    #[test]
    fn all_paused_keeps_batch_and_resume_continues_it() {
        let mut m = DockMeter::default();
        m.tick(&[running(1, 600, 1000)], true);
        let paused = JobDto {
            progress: Some(progress(600, Some(1000), None)),
            ..job(1, JobStatus::Paused)
        };
        assert_eq!(
            m.tick(std::slice::from_ref(&paused), true),
            Some(state(DockStatus::Paused, Some(60)))
        );
        // 다시 이어받기: queued 로 돌아와도 같은 배치라 값이 0으로 되돌아가지 않는다
        let queued = JobDto {
            progress: Some(progress(600, Some(1000), None)),
            ..job(1, JobStatus::Queued)
        };
        assert_eq!(
            m.tick(&[queued], true),
            Some(state(DockStatus::Normal, Some(60)))
        );
        assert_eq!(
            m.tick(&[running(1, 700, 1000)], true),
            Some(state(DockStatus::Normal, Some(70)))
        );
    }

    /// failed와 paused가 함께 있으면 Paused가 이긴다(아직 끝나지 않은 배치)
    #[test]
    fn paused_wins_over_failed() {
        let mut m = DockMeter::default();
        m.tick(&[running(1, 100, 1000), running(2, 100, 1000)], false);
        let jobs = [
            JobDto {
                progress: Some(progress(100, Some(1000), None)),
                ..job(1, JobStatus::Failed)
            },
            JobDto {
                progress: Some(progress(100, Some(1000), None)),
                ..job(2, JobStatus::Paused)
            },
        ];
        let s = m.tick(&jobs, false).unwrap();
        assert_eq!(s.status, DockStatus::Paused);
        assert_eq!(s.progress, Some(10));
    }

    /// 일부가 실패해도 남은 작업이 돌면 Normal
    #[test]
    fn failure_among_running_stays_normal() {
        let mut m = DockMeter::default();
        m.tick(&[running(1, 100, 1000), running(2, 100, 1000)], false);
        let jobs = [
            JobDto {
                progress: Some(progress(100, Some(1000), None)),
                ..job(1, JobStatus::Failed)
            },
            running(2, 500, 1000),
        ];
        assert_eq!(
            m.tick(&jobs, false),
            Some(state(DockStatus::Normal, Some(30)))
        );
    }

    /// 배치 끝 + 실패 + 포커스 없음 → Error(마지막 값), 포커스가 오면 None으로 배치를 닫는다
    #[test]
    fn ended_batch_with_failure_shows_error_until_focus() {
        let mut m = DockMeter::default();
        m.tick(&[running(1, 400, 1000)], false);
        let failed = JobDto {
            progress: Some(progress(400, Some(1000), None)),
            ..job(1, JobStatus::Failed)
        };
        assert_eq!(
            m.tick(std::slice::from_ref(&failed), false),
            Some(state(DockStatus::Error, Some(40)))
        );
        assert_eq!(m.tick(std::slice::from_ref(&failed), false), None);
        assert_eq!(
            m.tick(std::slice::from_ref(&failed), true),
            Some(DockState::CLEARED)
        );
        // 배치가 닫혔으므로 포커스를 잃어도 다시 붉어지지 않는다
        assert_eq!(m.tick(std::slice::from_ref(&failed), false), None);
        // 다음 배치는 처음부터(값이 이전 배치에서 이어지지 않는다)
        let next = [failed, running(2, 100, 1000)];
        assert_eq!(
            m.tick(&next, false),
            Some(state(DockStatus::Normal, Some(10)))
        );
    }

    /// 포커스 중에 끝난 실패는 곧바로 None(이미 화면에서 봤다)
    #[test]
    fn failure_while_focused_clears_immediately() {
        let mut m = DockMeter::default();
        m.tick(&[running(1, 400, 1000)], true);
        let failed = job(1, JobStatus::Failed);
        assert_eq!(m.tick(&[failed], true), Some(DockState::CLEARED));
    }

    /// 전체 크기를 모르면 Normal + 진행값 없음. total_bytes가 없으면 추정치를 쓴다
    #[test]
    fn unknown_total_has_no_value_and_estimate_is_used() {
        let mut m = DockMeter::default();
        let unknown = JobDto {
            progress: Some(progress(123, None, None)),
            ..job(1, JobStatus::Running)
        };
        assert_eq!(
            m.tick(std::slice::from_ref(&unknown), true),
            Some(state(DockStatus::Normal, None))
        );
        let estimated = JobDto {
            progress: Some(progress(250, None, Some(1000))),
            ..job(2, JobStatus::Running)
        };
        // 크기를 모르는 1번은 분자·분모에서 빠진다
        assert_eq!(
            m.tick(&[unknown, estimated], true),
            Some(state(DockStatus::Normal, Some(25)))
        );
    }

    /// 멈춘 작업은 progress가 없으면 partial_bytes를 받은 양으로 쓴다(전체를 알 때만)
    #[test]
    fn stopped_member_without_progress_has_no_size() {
        let mut m = DockMeter::default();
        m.tick(&[running(1, 500, 1000), job(2, JobStatus::Queued)], true);
        let jobs = [
            running(1, 500, 1000),
            JobDto {
                partial_bytes: Some(900),
                ..job(2, JobStatus::Paused)
            },
        ];
        // 2번은 전체를 몰라 뺀다 → 50
        assert_eq!(m.tick(&jobs, true), None);
    }

    /// 목록에서 사라진 구성원은 끝난 것으로 본다(배치가 끝난다)
    #[test]
    fn removed_members_end_the_batch() {
        let mut m = DockMeter::default();
        m.tick(&[running(1, 100, 1000)], true);
        assert_eq!(m.tick(&[], true), Some(DockState::CLEARED));
    }

    /// 반올림이 아니라 내림이고 100을 넘지 않는다
    #[test]
    fn floors_and_caps_at_100() {
        let mut m = DockMeter::default();
        assert_eq!(
            m.tick(&[running(1, 999, 1000)], true).unwrap().progress,
            Some(99)
        );
        let mut m = DockMeter::default();
        assert_eq!(
            m.tick(&[running(1, 5000, 1000)], true).unwrap().progress,
            Some(100)
        );
    }
}
