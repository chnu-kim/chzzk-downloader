//! Dock·작업 표시줄 진행 표시와 잠자기 방지를 1Hz로 맞추는 태스크(system/platform.md §8·§15).
//!
//! 매니저를 고치지 않고 `list()` 스냅샷을 1초마다 읽는다(잠금은 `list` 안에서만 쥔다). OS API(`set_progress_bar`,
//! 전원 가드)는 잠금 밖에서 이 태스크가 부른다. 집계는 셸의 `DockMeter`, 전원 전이는 `PowerKeeper`가 맡고 이 파일은 배선만 한다.
//! Dock 배지 API는 부르지 않는다(배지는 v1에서 끈다, platform §8.2).

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chzzk_shell::App;
use chzzk_shell::consts::DOCK_PROGRESS_MIN_INTERVAL_MS;
use chzzk_shell::dock::{DockMeter, DockState, DockStatus};
use chzzk_shell::dto::{JobDto, JobStatus, KeepAwakePayload};
use chzzk_shell::power::{PowerKeeper, SleepGuard};
use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// 잠자기 방지를 실제로 얻었을 때만 `active:true`로 main 창에 가는 이벤트(`KeepAwakePayload`)
pub const KEEP_AWAKE: &str = "keep-awake";

/// 실제 가드와 테스트의 가짜 가드를 한 타입으로 다루는 상자(`PowerKeeper<G>`는 제네릭이라 관리 상태에 넣을 수 없다).
pub struct BoxedGuard(Box<dyn SleepGuard>);

impl BoxedGuard {
    pub fn new(guard: impl SleepGuard + 'static) -> Self {
        BoxedGuard(Box::new(guard))
    }
}

impl SleepGuard for BoxedGuard {
    fn acquire(&mut self, reason: &str) -> Result<(), String> {
        self.0.acquire(reason)
    }
    fn release(&mut self) {
        self.0.release();
    }
}

/// 관리 상태: 집계기와 전원 보호기. `frontend_ready`가 현재 표시값을 다시 보낼 수 있게 보호기를 둔다.
pub struct StatusState {
    /// 진행 표시를 한 번이라도 칠했는가(아직 아무것도 안 칠했다면 시작 때의 "지우기"는 OS에 보내지 않는다)
    painted: AtomicBool,
    meter: Mutex<DockMeter>,
    keeper: Mutex<PowerKeeper<BoxedGuard>>,
}

impl StatusState {
    pub fn new(guard: BoxedGuard) -> Self {
        StatusState {
            painted: AtomicBool::new(false),
            meter: Mutex::new(DockMeter::default()),
            keeper: Mutex::new(PowerKeeper::new(guard)),
        }
    }

    /// 잠자기 방지를 지금 실제로 쥐고 있는가
    pub fn keep_awake_active(&self) -> bool {
        self.keeper.lock().map(|k| k.active()).unwrap_or(false)
    }

    /// 이 Dock 상태를 OS에 보낼까. 칠한 적이 없는데 "지우기"뿐이면 보내지 않는다(Windows의 `ITaskbarList3` 호출은
    /// 호출마다 COM 객체를 만든다: 아무것도 보여 준 적 없는 시작 틱에서 부를 이유가 없다). 칠했으면 지우기도 보낸다.
    fn should_paint(&self, d: DockState) -> bool {
        if d.status == DockStatus::None {
            self.painted.swap(false, Ordering::SeqCst)
        } else {
            self.painted.store(true, Ordering::SeqCst);
            true
        }
    }

    /// 앱이 끝날 때 보호를 놓는다(프로세스가 끝나도 OS가 놓지만 명시적으로 닫는다)
    pub fn shutdown(&self) {
        if let Ok(mut k) = self.keeper.lock() {
            k.update(false, 0);
        }
    }

    /// 한 틱: 스냅샷으로 Dock 상태와 전원 전이를 계산한다. 바뀐 것만 돌려준다.
    pub fn step(&self, jobs: &[JobDto], focused: bool, keep_awake: bool) -> Step {
        let dock = self
            .meter
            .lock()
            .ok()
            .and_then(|mut m| m.tick(jobs, focused));
        let keep = self
            .keeper
            .lock()
            .ok()
            .and_then(|mut k| k.update(keep_awake, busy_count(jobs)));
        Step {
            dock,
            keep_awake: keep,
        }
    }
}

/// 한 틱의 결과(바뀐 것만 `Some`)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Step {
    pub dock: Option<DockState>,
    pub keep_awake: Option<bool>,
}

/// 잠자기 방지 대상 작업 수 = running + pausing. 연결 대기 중(phase만 다른 running)도 센다.
pub fn busy_count(jobs: &[JobDto]) -> usize {
    jobs.iter()
        .filter(|j| matches!(j.status, JobStatus::Running | JobStatus::Pausing))
        .count()
}

/// `DockStatus` → Tauri 진행 막대 상태.
pub fn bar_status(s: DockStatus) -> ProgressBarStatus {
    match s {
        DockStatus::None => ProgressBarStatus::None,
        DockStatus::Normal => ProgressBarStatus::Normal,
        DockStatus::Paused => ProgressBarStatus::Paused,
        DockStatus::Error => ProgressBarStatus::Error,
    }
}

/// `DockState` → `set_progress_bar` 인자. 상태 `None`은 진행값도 비워 명시적으로 지운다(Windows는 값만 보내면 지워지지 않는다).
pub fn bar_state(d: DockState) -> ProgressBarState {
    let clear = d.status == DockStatus::None;
    ProgressBarState {
        status: Some(bar_status(d.status)),
        progress: if clear {
            None
        } else {
            d.progress.map(u64::from)
        },
    }
}

/// 한 틱을 돌려 Dock·이벤트에 반영한다. 반영한 결과를 돌려준다(테스트용).
pub fn tick_once<R: Runtime>(app: &AppHandle<R>) -> Option<Step> {
    let state = app.try_state::<StatusState>()?;
    let shell = app.try_state::<App>()?;
    let jobs = shell.manager.list();
    let keep_awake = shell.settings.get().keep_awake;
    let window = app.get_webview_window("main");
    let focused = window
        .as_ref()
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    let step = state.step(&jobs, focused, keep_awake);
    if let (Some(d), Some(w)) = (step.dock, window.as_ref())
        && state.should_paint(d)
        && let Err(e) = w.set_progress_bar(bar_state(d))
    {
        tracing::debug!(error = %e, "진행 표시를 바꾸지 못함");
    }
    if let Some(active) = step.keep_awake {
        emit_keep_awake(app, active);
    }
    Some(step)
}

/// `keep-awake` 이벤트를 main 창에 보낸다.
pub fn emit_keep_awake<R: Runtime>(app: &AppHandle<R>, active: bool) {
    if let Err(e) = app.emit_to("main", KEEP_AWAKE, KeepAwakePayload { active }) {
        tracing::warn!(error = %e, "keep-awake를 보내지 못함");
    }
}

/// 1초마다 `tick_once`를 돌리는 태스크. `App`이 관리된 뒤에 띄운다.
pub fn spawn_status<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut iv = tokio::time::interval(Duration::from_millis(DOCK_PROGRESS_MIN_INTERVAL_MS));
        iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            iv.tick().await;
            tick_once(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chzzk_core::PlaybackKind;
    use chzzk_shell::JobId;
    use chzzk_shell::dto::ContentKindDto;
    use chzzk_shell::power::NoopGuard;

    fn job(id: u64, status: JobStatus) -> JobDto {
        JobDto {
            id: JobId(id),
            url: "https://chzzk.naver.com/video/1".into(),
            title: "제목".into(),
            channel_name: "채널".into(),
            channel_id: None,
            kind: ContentKindDto::Video,
            playback_kind: PlaybackKind::Progressive,
            quality_label: "720p".into(),
            output: "/v/제목.mp4".into(),
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

    #[test]
    fn dock_status_maps_one_to_one() {
        assert!(matches!(
            bar_status(DockStatus::None),
            ProgressBarStatus::None
        ));
        assert!(matches!(
            bar_status(DockStatus::Normal),
            ProgressBarStatus::Normal
        ));
        assert!(matches!(
            bar_status(DockStatus::Paused),
            ProgressBarStatus::Paused
        ));
        assert!(matches!(
            bar_status(DockStatus::Error),
            ProgressBarStatus::Error
        ));
    }

    #[test]
    fn clearing_sends_no_progress() {
        let s = bar_state(DockState {
            status: DockStatus::None,
            progress: Some(40),
        });
        assert!(matches!(s.status, Some(ProgressBarStatus::None)));
        assert_eq!(s.progress, None);
        let s = bar_state(DockState {
            status: DockStatus::Normal,
            progress: Some(40),
        });
        assert!(matches!(s.status, Some(ProgressBarStatus::Normal)));
        assert_eq!(s.progress, Some(40));
        let s = bar_state(DockState {
            status: DockStatus::Normal,
            progress: None,
        });
        assert_eq!(s.progress, None);
    }

    #[test]
    fn the_startup_clear_is_not_sent_but_a_clear_after_painting_is() {
        let st = StatusState::new(BoxedGuard::new(NoopGuard));
        let clear = DockState {
            status: DockStatus::None,
            progress: None,
        };
        let busy = DockState {
            status: DockStatus::Normal,
            progress: Some(10),
        };
        assert!(
            !st.should_paint(clear),
            "아무것도 안 칠했으면 지우기를 보내지 않는다"
        );
        assert!(st.should_paint(busy));
        assert!(st.should_paint(clear), "칠한 뒤의 지우기는 보낸다");
        assert!(!st.should_paint(clear), "지운 뒤에는 다시 보내지 않는다");
    }

    #[test]
    fn busy_counts_running_and_pausing_only() {
        let jobs = [
            job(1, JobStatus::Running),
            job(2, JobStatus::Pausing),
            job(3, JobStatus::Queued),
            job(4, JobStatus::Paused),
            job(5, JobStatus::Completed),
        ];
        assert_eq!(busy_count(&jobs), 2);
        assert_eq!(busy_count(&[]), 0);
    }

    // 호출은 바뀔 때만이다: 같은 스냅샷을 되풀이해도 두 번째부터는 아무것도 보내지 않는다(처음은 늘 Some)
    #[test]
    fn step_reports_only_changes() {
        let st = StatusState::new(BoxedGuard::new(NoopGuard));
        let jobs = [job(1, JobStatus::Running)];
        let first = st.step(&jobs, true, true);
        assert!(first.dock.is_some());
        assert_eq!(first.keep_awake, Some(true));
        let again = st.step(&jobs, true, true);
        assert_eq!(
            again,
            Step {
                dock: None,
                keep_awake: None
            }
        );
        assert!(st.keep_awake_active());
        // 작업이 끝나면 보호를 놓고 표시를 지운다
        let done = st.step(&[job(1, JobStatus::Completed)], true, true);
        assert_eq!(done.keep_awake, Some(false));
        assert!(!st.keep_awake_active());
    }

    #[test]
    fn keep_awake_setting_off_never_holds() {
        let st = StatusState::new(BoxedGuard::new(NoopGuard));
        let s = st.step(&[job(1, JobStatus::Running)], true, false);
        assert_eq!(s.keep_awake, None);
        assert!(!st.keep_awake_active());
        // 설정을 켜면 바로 잡는다
        let s = st.step(&[job(1, JobStatus::Running)], true, true);
        assert_eq!(s.keep_awake, Some(true));
        // 다시 끄면 놓는다
        let s = st.step(&[job(1, JobStatus::Running)], true, false);
        assert_eq!(s.keep_awake, Some(false));
    }

    #[test]
    fn shutdown_releases() {
        let st = StatusState::new(BoxedGuard::new(NoopGuard));
        st.step(&[job(1, JobStatus::Running)], true, true);
        assert!(st.keep_awake_active());
        st.shutdown();
        assert!(!st.keep_awake_active());
    }

    // 배지는 v1에서 끈다: 이 파일이 Dock 배지 API를 부르지 않는다
    #[test]
    fn source_never_sets_a_badge() {
        let src = include_str!("status.rs");
        let call = ["set_badge", "_"].concat();
        let count = src.matches(call.as_str()).count();
        assert_eq!(count, 0);
    }
}
