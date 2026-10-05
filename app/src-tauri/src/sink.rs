//! `ChannelSink`: 매니저 이벤트를 웹뷰 Channel로 보내는 sink(§6.1), 그리고 완료 알림.
//!
//! 매니저는 상태 잠금을 쥔 채 sink를 부른다. 창 API(`is_focused`·`request_user_attention`)와 OS 알림은
//! 메인 스레드를 오가므로 여기서 부르면, 메인 스레드에서 같은 잠금을 기다리는 창 닫기 처리(`running_count`)와
//! 교착할 수 있다. 그래서 sink는 완료된 작업 제목을 큐에 넣기만 하고, 알림은 별도 태스크(`spawn_notifier`)가 한다.

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

/// 완료 알림 큐의 입구. 구독이 바뀌어도(웹뷰 새로고침) 같은 큐를 쓴다.
#[derive(Clone, Debug)]
pub struct Notifier(UnboundedSender<String>);

impl Notifier {
    /// 큐와 그 출구. 출구는 `spawn_notifier`에 넘긴다(테스트는 직접 읽는다).
    pub fn new() -> (Notifier, UnboundedReceiver<String>) {
        let (tx, rx) = unbounded_channel();
        (Notifier(tx), rx)
    }

    fn completed(&self, title: String) {
        // 출구가 없으면(앱 종료 중) 버린다.
        let _ = self.0.send(title);
    }
}

/// 완료 이벤트면 작업 제목. 건너뜀·실패·완료 항목 정리는 알리지 않는다.
pub fn completed_title(e: &JobEvent) -> Option<&str> {
    match e {
        JobEvent::Status { job } if job.status == JobStatus::Completed => Some(&job.title),
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
        if let Some(t) = completed_title(&e) {
            self.notifier.completed(t.to_string());
        }
        self.channel.send(e).is_ok()
    }
}

/// 완료 알림 태스크. main 창에 포커스가 없을 때만 작업 표시줄·Dock 주의 요청과 OS 알림을 띄운다
/// (포커스가 있으면 프런트 토스트로 충분하다).
pub fn spawn_notifier<R: Runtime>(app: AppHandle<R>, mut rx: UnboundedReceiver<String>) {
    tauri::async_runtime::spawn(async move {
        while let Some(title) = rx.recv().await {
            let Some(w) = app.get_webview_window("main") else {
                continue;
            };
            if w.is_focused().unwrap_or(false) {
                continue;
            }
            if let Err(e) = w.request_user_attention(Some(UserAttentionType::Informational)) {
                tracing::debug!(error = %e, "주의 요청 실패");
            }
            if let Err(e) = app
                .notification()
                .builder()
                .title(NOTIFY_TITLE)
                .body(completed_body(&title))
                .show()
            {
                tracing::warn!(error = %e, "완료 알림을 띄우지 못함");
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
    fn only_completed_status_notifies() {
        let done = JobEvent::Status {
            job: job(JobStatus::Completed),
        };
        assert_eq!(completed_title(&done), Some("제목"));
        for s in [JobStatus::Skipped, JobStatus::Failed, JobStatus::Running] {
            assert_eq!(completed_title(&JobEvent::Status { job: job(s) }), None);
        }
        // 추가(복원된 완료 항목 포함)·정리는 알리지 않는다.
        let added = JobEvent::Added {
            job: job(JobStatus::Completed),
        };
        assert_eq!(completed_title(&added), None);
        assert_eq!(completed_title(&JobEvent::Removed { id: JobId(1) }), None);
    }

    #[test]
    fn body_follows_copy_deck() {
        assert_eq!(completed_body("제목"), "'제목' 다운로드를 마쳤어요");
    }

    #[tokio::test]
    async fn notifier_queues_titles() {
        let (n, mut rx) = Notifier::new();
        n.completed("가".into());
        n.completed("나".into());
        assert_eq!(rx.recv().await.as_deref(), Some("가"));
        assert_eq!(rx.recv().await.as_deref(), Some("나"));
        drop(rx);
        // 출구가 사라져도 패닉하지 않는다.
        n.completed("다".into());
    }
}
