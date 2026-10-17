//! 채팅 함께 받기의 셸 쪽 상태(기능 ④-4, 설계 `docs/design/features/chat.md` §4).
//!
//! - 채팅은 영상 작업의 **하위 상태**다(`JobRecord.chat`). `JobStatus`는 건드리지 않는다(§4.1). 채팅이 실패해도 영상은 완료다.
//! - `ChatQueue`는 채팅 수집을 **한 번에 하나**만 돌린다(§4.2). 영상 슬롯·생방송 lane을 쓰지 않는 세 번째 줄이다.
//!   줄과 실행 중인 태스크는 매니저 상태 잠금 안에 있고, 태스크를 띄우고 끝내는 일은 매니저(`manager.rs`)가 한다.
//! - `jobs.json`의 형식 버전(`JOBS_VERSION`)은 올리지 않는다. 새 필드는 모두 `serde(default)`이고 모르는 모양은 버린다.
//! - 닉네임·본문은 이 모듈 어디에도 오지 않는다(메시지 수·퍼센트만).

use std::collections::VecDeque;

use chzzk_core::CancellationToken;
use chzzk_core::chat::SubtitleFormat;
use serde::{Deserialize, Serialize};
use tokio::task::JoinHandle;
use ts_rs::TS;

use crate::dto::{JobId, OnExisting};
use crate::error::AppError;

/// 채팅의 단계(§4.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ChatPhase {
    /// 영상이 끝나기를(또는 채팅 차례를) 기다린다
    Waiting,
    Running,
    /// 사용자가 멈췄다(자동 이어받기 대상이 아니다)
    Paused,
    /// 앱 종료로 멈췄다(자동 이어받기 대상)
    Interrupted,
    Completed,
    /// 받는 동안 같은 이름 파일이 생겨 덮어쓰지 않았다(`ChatOutcome::TargetExists`). 받은 `.part`는 남는다
    Conflict,
    Failed,
}

/// `chzzk_core::chat::SubtitleFormat`의 TS 모양.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "SubtitleFormat")]
pub enum SubtitleFormatTs {
    None,
    Ass,
    Srt,
}

impl From<SubtitleFormat> for SubtitleFormatTs {
    /// 빠짐없는 match. 코어에 형식이 늘면 여기서 컴파일이 깨진다.
    fn from(s: SubtitleFormat) -> Self {
        match s {
            SubtitleFormat::None => Self::None,
            SubtitleFormat::Ass => Self::Ass,
            SubtitleFormat::Srt => Self::Srt,
        }
    }
}

/// 작업 레코드의 채팅 상태(`jobs.json`에 저장된다). 없으면(옛 레코드) 채팅을 고르지 않은 작업이다.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatState {
    pub phase: ChatPhase,
    /// 받기 시점의 선택을 고정한다(이어받기·덮어쓰고 받기는 이 값, 처음부터·다시 받기는 그때의 설정)
    pub subtitle: SubtitleFormat,
    /// 최종 이름이 이미 있을 때. 기본 `skip`, `overwrite`는 D7 동의 뒤에만(§4.5)
    pub on_existing: OnExisting,
    /// 기록한 메시지 수(이어받은 것 포함)
    #[serde(default)]
    pub messages: u64,
    /// 0~99. running·paused·interrupted·failed에서 유지하고 뒤로 가지 않는다(P-4). 길이를 모르면 없다
    #[serde(default)]
    pub percent: Option<u8>,
    #[serde(default)]
    pub error: Option<AppError>,
    /// 영상 길이(ms). 퍼센트와 자막의 꼬리 컷에 쓴다. 처음 받을 때 한 번 알아내 저장한다(모르면 없다)
    #[serde(default)]
    pub duration_ms: Option<u64>,
    /// 자막을 요청했는데 만들지 못했다(기록은 완성이다). completed에서만 참일 수 있다
    #[serde(default)]
    pub subtitle_failed: bool,
    /// 다음 시작 때 받다 만 채팅 `.part`를 버리고 처음부터 받는다(`fetch_chat(restart)`). 시작 전에 앱이 꺼져도 남는다
    #[serde(default)]
    pub restart: bool,
    /// 채팅 `.part`를 실제로 확인한 길이(sidecar `committed_len`, 없으면 `.part` 길이). 저장하지 않고 reconcile·매니저가 채운다
    #[serde(skip)]
    pub partial_bytes: Option<u64>,
}

impl ChatState {
    /// 받기(채팅 켬)로 생긴 새 상태.
    pub fn waiting(subtitle: SubtitleFormat, on_existing: OnExisting) -> Self {
        ChatState {
            phase: ChatPhase::Waiting,
            subtitle,
            on_existing,
            messages: 0,
            percent: None,
            error: None,
            duration_ms: None,
            subtitle_failed: false,
            restart: false,
            partial_bytes: None,
        }
    }

    /// 프런트로 보낼 모양.
    pub fn to_dto(&self) -> ChatStateDto {
        ChatStateDto {
            phase: self.phase,
            subtitle: self.subtitle.into(),
            on_existing: self.on_existing,
            messages: self.messages,
            percent: self.percent,
            error: self.error.clone(),
            subtitle_failed: self.subtitle_failed,
            partial_bytes: self.partial_bytes,
        }
    }

    /// 목록 정리(완료 지우기·자동 정리)가 레코드만 지우면 안 되는 상태: 돌고 있거나 받다 만 채팅 파일이 남았다(§4.3).
    pub fn holds_files(&self) -> bool {
        matches!(self.phase, ChatPhase::Waiting | ChatPhase::Running)
            || self.partial_bytes.is_some()
    }
}

/// `JobDto.chat`(§4.4). `partialBytes`가 있으면 받다 만 채팅 파일이 있다(지우기 경로가 D2를 거친다).
#[derive(Clone, Debug, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatStateDto {
    pub phase: ChatPhase,
    pub subtitle: SubtitleFormatTs,
    pub on_existing: OnExisting,
    pub messages: u64,
    pub percent: Option<u8>,
    /// failed
    pub error: Option<AppError>,
    pub subtitle_failed: bool,
    pub partial_bytes: Option<u64>,
}

/// `check_chat_output` 결과: 실제로 덮어쓸 채팅 파일 이름(자막 → 기록 순). 비면 충돌 없음.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ChatOutputCheck {
    pub conflict_names: Vec<String>,
}

/// 채팅 태스크가 멈춘 이유. 코어는 셋 다 `Error::Cancelled`로 끝나므로 이것으로 구분한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatStop {
    Pause,
    Quit,
    Remove,
}

/// 돌고 있는 채팅 태스크.
#[derive(Debug)]
pub struct ChatRun {
    pub id: JobId,
    /// 태스크 세대. 자기 세대가 아닌 태스크의 보고는 버린다
    pub run: u64,
    pub cancel: CancellationToken,
    pub handle: Option<JoinHandle<()>>,
    pub stop: Option<ChatStop>,
    /// 이 실행이 끝나기 전에 같은 작업을 다시 줄 세우려 했다(종료 기한을 넘긴 실행 뒤 `cancel_quit`·이어받기).
    /// 끝이 `Cancelled`면 `interrupted`로 두지 않고 새 실행을 줄 세운다(Codex PR #141 2차 ③, app.md 83-14)
    pub requeue: bool,
}

/// 채팅 수집 줄. 한 번에 하나만 돈다(§4.2).
#[derive(Debug, Default)]
pub struct ChatQueue {
    waiting: VecDeque<JobId>,
    running: Option<ChatRun>,
}

impl ChatQueue {
    /// 줄 끝에 세운다(이미 있으면 그대로). 그 작업이 아직 돌고 있으면(멈춘 옛 실행이 늦게 끝나는 중) 줄에 넣지 않고
    /// 재개 의도(`ChatRun::requeue`)로 남긴다. 옛 실행이 끝난 뒤 `finish_chat`이 줄 세운다.
    pub fn push(&mut self, id: JobId) {
        if let Some(r) = self.running.as_mut().filter(|r| r.id == id) {
            r.requeue = true;
        } else if !self.waiting.contains(&id) {
            self.waiting.push_back(id);
        }
    }

    /// 줄에서 뺀다. 돌고 있는 것은 멈추지 않고 재개 의도만 지운다. 줄에 있었으면 true.
    pub fn remove(&mut self, id: JobId) -> bool {
        if let Some(r) = self.running.as_mut().filter(|r| r.id == id) {
            r.requeue = false;
        }
        let before = self.waiting.len();
        self.waiting.retain(|&w| w != id);
        before != self.waiting.len()
    }

    /// 돌고 있는 것이 없으면 다음 차례를 꺼낸다.
    pub fn take_next(&mut self) -> Option<JobId> {
        if self.running.is_some() {
            return None;
        }
        self.waiting.pop_front()
    }

    pub fn running_id(&self) -> Option<JobId> {
        self.running.as_ref().map(|r| r.id)
    }

    pub fn running_mut(&mut self) -> Option<&mut ChatRun> {
        self.running.as_mut()
    }

    pub fn set_running(&mut self, r: ChatRun) {
        self.running = Some(r);
    }

    /// 세대 `run`의 태스크가 끝났다. 지금 도는 것이 그 세대면 꺼내 돌려준다.
    pub fn finish(&mut self, id: JobId, run: u64) -> Option<ChatRun> {
        if self
            .running
            .as_ref()
            .is_some_and(|r| r.id == id && r.run == run)
        {
            self.running.take()
        } else {
            None
        }
    }

    pub fn is_waiting(&self, id: JobId) -> bool {
        self.waiting.contains(&id)
    }
}

/// 진행 퍼센트: `cursor / duration`(정수 내림, 99에서 멈춤, §3.2-9). 길이를 모르면 없다.
pub fn percent_of(cursor_ms: u64, duration_ms: Option<u64>) -> Option<u8> {
    let d = duration_ms.filter(|&d| d > 0)?;
    let p = (u128::from(cursor_ms) * 100 / u128::from(d)).min(99);
    Some(p as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_floors_and_stops_at_99() {
        assert_eq!(percent_of(0, Some(1000)), Some(0));
        assert_eq!(percent_of(389, Some(1000)), Some(38));
        assert_eq!(percent_of(1000, Some(1000)), Some(99));
        assert_eq!(percent_of(5000, Some(1000)), Some(99));
        assert_eq!(percent_of(10, None), None);
        assert_eq!(percent_of(10, Some(0)), None);
    }

    #[test]
    fn queue_runs_one_at_a_time_in_order() {
        let mut q = ChatQueue::default();
        q.push(JobId(2));
        q.push(JobId(1));
        q.push(JobId(2));
        assert_eq!(q.take_next(), Some(JobId(2)));
        q.set_running(ChatRun {
            id: JobId(2),
            run: 7,
            cancel: CancellationToken::new(),
            handle: None,
            stop: None,
            requeue: false,
        });
        assert_eq!(q.take_next(), None, "하나가 도는 동안 다음을 꺼내지 않는다");
        q.push(JobId(2));
        assert!(
            !q.is_waiting(JobId(2)),
            "돌고 있는 것은 다시 줄 세우지 않는다"
        );
        assert!(q.running_mut().unwrap().requeue, "재개 의도로 남긴다");
        q.remove(JobId(2));
        assert!(!q.running_mut().unwrap().requeue, "빼면 의도도 지운다");
        q.push(JobId(2));
        assert!(q.finish(JobId(2), 6).is_none(), "옛 세대는 버린다");
        assert!(q.finish(JobId(2), 7).is_some_and(|r| r.requeue));
        assert_eq!(q.take_next(), Some(JobId(1)));
        assert!(!q.remove(JobId(1)));
    }

    #[test]
    fn holds_files_rule() {
        let mut s = ChatState::waiting(SubtitleFormat::Ass, OnExisting::Skip);
        assert!(s.holds_files());
        for (phase, partial, want) in [
            (ChatPhase::Running, None, true),
            (ChatPhase::Completed, None, false),
            (ChatPhase::Failed, None, false),
            (ChatPhase::Failed, Some(0), true),
            (ChatPhase::Paused, Some(10), true),
            (ChatPhase::Conflict, Some(10), true),
        ] {
            s.phase = phase;
            s.partial_bytes = partial;
            assert_eq!(s.holds_files(), want, "{phase:?} {partial:?}");
        }
    }
}
