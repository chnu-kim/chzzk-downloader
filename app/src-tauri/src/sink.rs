//! `ChannelSink`: 매니저 이벤트를 웹뷰 Channel로 보내는 sink(§6.1), 그리고 완료·실패 알림.
//!
//! 매니저는 상태 잠금을 쥔 채 sink를 부른다. 창 API(`is_focused`·`request_user_attention`)와 OS 알림은
//! 메인 스레드를 오가므로 여기서 부르면, 메인 스레드에서 같은 잠금을 기다리는 창 닫기 처리(`running_count`)와
//! 교착할 수 있다. 그래서 sink는 알릴 일을 큐에 넣기만 하고, 알림은 별도 태스크(`spawn_notifier`)가 한다.

use chzzk_shell::EventSink;
use chzzk_shell::dto::{JobEvent, JobStatus};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, Runtime, UserAttentionType};
use tauri_plugin_notification::NotificationExt;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

/// 알림 제목(copy deck `app.title`).
pub const NOTIFY_TITLE: &str = "치지직 다운로더";

/// 알림 본문(copy deck `toast.completed`).
pub fn completed_body(title: &str) -> String {
    format!("'{title}' 다운로드를 마쳤어요")
}

/// 실패 알림 본문(copy deck `job.failed`).
pub fn failed_body(title: &str) -> String {
    format!("'{title}' 다운로드에 실패했어요")
}

/// 알릴 일 하나(작업 제목).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Notice {
    Completed(String),
    Failed(String),
}

impl Notice {
    /// OS 알림 본문.
    pub fn body(&self) -> String {
        match self {
            Notice::Completed(t) => completed_body(t),
            Notice::Failed(t) => failed_body(t),
        }
    }
}

/// 알림 큐의 입구. 구독이 바뀌어도(웹뷰 새로고침) 같은 큐를 쓴다.
#[derive(Clone, Debug)]
pub struct Notifier(UnboundedSender<Notice>);

impl Notifier {
    /// 큐와 그 출구. 출구는 `spawn_notifier`에 넘긴다(테스트는 직접 읽는다).
    pub fn new() -> (Notifier, UnboundedReceiver<Notice>) {
        let (tx, rx) = unbounded_channel();
        (Notifier(tx), rx)
    }

    fn push(&self, n: Notice) {
        // 출구가 없으면(앱 종료 중) 버린다.
        let _ = self.0.send(n);
    }
}

/// 상태가 완료·실패로 바뀐 `Status` 이벤트면 알릴 일. 건너뜀·완료 항목 정리·`Added`(복원된 항목)는 알리지 않는다.
/// 매니저는 전이할 때만 `Status`를 보내므로 같은 작업을 두 번 알리지 않는다.
pub fn notice_of(e: &JobEvent) -> Option<Notice> {
    match e {
        JobEvent::Status { job } if job.status == JobStatus::Completed => {
            Some(Notice::Completed(job.title.clone()))
        }
        JobEvent::Status { job } if job.status == JobStatus::Failed => {
            Some(Notice::Failed(job.title.clone()))
        }
        _ => None,
    }
}

/// 웹뷰 Channel sink.
pub struct ChannelSink {
    channel: Channel<JobEvent>,
    notifier: Notifier,
}

impl ChannelSink {
    pub fn new(channel: Channel<JobEvent>, notifier: Notifier) -> Self {
        ChannelSink { channel, notifier }
    }
}

impl EventSink for ChannelSink {
    fn send(&self, e: JobEvent) -> bool {
        if let Some(n) = notice_of(&e) {
            self.notifier.push(n);
        }
        self.channel.send(e).is_ok()
    }
}

/// 알릴 일 하나를 OS로 내보낼까. main 창이 있고 포커스가 없을 때만이다(포커스가 있으면 완료는 프런트 토스트,
/// 실패는 목록의 오류 줄로 충분하다). 포커스를 묻지 못하면(`None`) 포커스가 없는 것으로 본다.
/// 내보낼 때는 주의 요청(작업 표시줄·Dock)과 OS 알림을 함께 한다.
pub fn should_notify(has_main: bool, focused: Option<bool>) -> bool {
    has_main && !focused.unwrap_or(false)
}

/// 알림 태스크. `should_notify`가 참일 때만 작업 표시줄·Dock 주의 요청과 OS 알림을 띄운다.
pub fn spawn_notifier<R: Runtime>(app: AppHandle<R>, mut rx: UnboundedReceiver<Notice>) {
    tauri::async_runtime::spawn(async move {
        while let Some(notice) = rx.recv().await {
            let w = app.get_webview_window("main");
            let focused = w.as_ref().and_then(|w| w.is_focused().ok());
            let (true, Some(w)) = (should_notify(w.is_some(), focused), w) else {
                continue;
            };
            if let Err(e) = w.request_user_attention(Some(UserAttentionType::Informational)) {
                tracing::debug!(error = %e, "주의 요청 실패");
            }
            if let Err(e) = app
                .notification()
                .builder()
                .title(NOTIFY_TITLE)
                .body(notice.body())
                .show()
            {
                tracing::warn!(error = %e, "알림을 띄우지 못함");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chzzk_core::PlaybackKind;
    use chzzk_shell::JobId;
    use chzzk_shell::dto::{ContentKindDto, JobDto};

    fn job(status: JobStatus) -> JobDto {
        JobDto {
            id: JobId(1),
            url: "https://chzzk.naver.com/video/1".into(),
            title: "제목".into(),
            channel_name: "채널".into(),
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
        }
    }

    #[test]
    fn only_completed_and_failed_status_notify() {
        let st = |s| JobEvent::Status { job: job(s) };
        assert_eq!(
            notice_of(&st(JobStatus::Completed)),
            Some(Notice::Completed("제목".into()))
        );
        assert_eq!(
            notice_of(&st(JobStatus::Failed)),
            Some(Notice::Failed("제목".into()))
        );
        for s in [
            JobStatus::Skipped,
            JobStatus::Running,
            JobStatus::Queued,
            JobStatus::Pausing,
            JobStatus::Paused,
            JobStatus::Interrupted,
        ] {
            assert_eq!(notice_of(&st(s)), None, "{s:?}");
        }
        // 추가(복원된 완료·실패 항목 포함)·정리는 알리지 않는다.
        for s in [JobStatus::Completed, JobStatus::Failed] {
            assert_eq!(notice_of(&JobEvent::Added { job: job(s) }), None);
        }
        assert_eq!(notice_of(&JobEvent::Removed { id: JobId(1) }), None);
    }

    #[test]
    fn body_follows_copy_deck() {
        assert_eq!(
            Notice::Completed("제목".into()).body(),
            "'제목' 다운로드를 마쳤어요"
        );
        assert_eq!(
            Notice::Failed("제목".into()).body(),
            "'제목' 다운로드에 실패했어요"
        );
    }

    #[test]
    fn notify_only_without_focus() {
        // 포커스가 있으면 알리지 않는다(토스트·오류 줄로 충분하다).
        assert!(!should_notify(true, Some(true)));
        // 포커스가 없거나 묻지 못하면 주의 요청과 OS 알림.
        assert!(should_notify(true, Some(false)));
        assert!(should_notify(true, None));
        // main 창이 없으면(닫는 중) 알리지 않는다.
        assert!(!should_notify(false, None));
        assert!(!should_notify(false, Some(false)));
    }

    #[tokio::test]
    async fn notifier_queues_notices() {
        let (n, mut rx) = Notifier::new();
        n.push(Notice::Completed("가".into()));
        n.push(Notice::Failed("나".into()));
        assert_eq!(rx.recv().await, Some(Notice::Completed("가".into())));
        assert_eq!(rx.recv().await, Some(Notice::Failed("나".into())));
        drop(rx);
        // 출구가 사라져도 패닉하지 않는다.
        n.push(Notice::Completed("다".into()));
    }
}
