//! 작업 이벤트를 프런트로 보내는 출구(docs/design/app.md §6.1 "sink").
//!
//! 앱은 `tauri::ipc::Channel<JobEvent>`를 감싼 `ChannelSink`를, 테스트는 기록용 sink를 꽂는다.
//! 구독자는 하나다. `subscribe_jobs`가 새 sink로 바꾸고 스냅샷을 돌려준다(웹뷰 새로고침 뒤 재동기화).

use crate::dto::JobEvent;

/// 이벤트 출구. `false`를 돌려주면(웹뷰가 사라졌다 등) 매니저가 구독자를 비운다.
/// 전송 실패는 작업을 실패시키지 않는다.
///
/// 매니저는 상태 잠금을 쥔 채 부른다(이벤트 순서가 상태 전이 순서와 같도록). 그래서 오래 막히거나
/// 매니저를 다시 부르면 안 된다.
pub trait EventSink: Send + Sync {
    fn send(&self, e: JobEvent) -> bool;
}

impl<F> EventSink for F
where
    F: Fn(JobEvent) -> bool + Send + Sync,
{
    fn send(&self, e: JobEvent) -> bool {
        self(e)
    }
}
