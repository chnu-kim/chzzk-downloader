//! 채팅 수집 `Chzzk::collect_chat`(기능 ④-3a, chat.md §3.2). 실측에 기대는 Q3·Q8은 ④-3b다.
//!
//! - 페이지를 `walk::next_step`으로 돌고, 페이지마다 `ChatPart::commit_page`로 커밋한다(④-1 실측 도구와 같은 판정).
//! - **400은 어느 페이지에서든 오류다**(chat.md §3.2-3). 정상 끝은 `ChatEnd` 셋뿐이다.
//! - 실패·취소에도 `.part`·sidecar를 지우지 않는다. 채팅은 늘 같은 요청으로 이어받는다(core.md 구현 중 변경 66).
//! - 취소는 요청·대기 중에만 본다. `commit_page`는 취소 지점으로 쓰지 않는다(`chat::part` 실패 계약).
//! - 닉네임·본문은 로그에 내지 않는다.

use std::path::{Path, PathBuf};

use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use super::part::{ChatFinalized, ChatPart, Companion};
use super::retry::{ChatFailure, classify};
use super::subtitle::{SubtitleOpts, render_ass, render_srt};
use super::walk::{Next, WalkState, next_step};
use super::{ChatEnd, ChatMessage, ChatPage, SubtitleFormat};
use crate::client::Chzzk;
use crate::download::DuplicatePolicy;
use crate::download::part::{part_path, remove_if_exists};
use crate::error::Error;
use crate::fsutil::map_io_error;
use crate::naming::sibling_path;

/// 기록 파일의 확장자(영상 `.mp4` 자리에 붙는다, chat.md §3.3).
pub const RECORD_EXT: &str = ".chat.jsonl";

/// 채팅 받기 요청.
#[derive(Clone, Debug)]
pub struct ChatRequest {
    /// 영상 번호. 클립은 타입으로 받지 않는다(chat.md §3.6)
    pub video_no: u64,
    /// 영상 최종 경로. 채팅 파일 이름은 여기서 확장자만 바꾼다(`naming::sibling_path`)
    pub output: PathBuf,
    pub subtitle: SubtitleFormat,
    /// 영상 길이(ms). 자막의 꼬리 컷과 진행률에 쓴다. 모르면 `None`
    pub duration_ms: Option<u64>,
    /// 받다 만 채팅 `.part`를 버리고 처음부터. 덮어쓰기 동의가 아니다
    pub restart: bool,
    /// 최종 이름이 이미 있을 때. 기본 `Skip`, `Overwrite`는 사용자 동의 뒤에만
    pub on_existing: DuplicatePolicy,
}

/// 채팅 받기 결과.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChatOutcome {
    /// 기록(과 자막)을 최종 이름으로 옮겼다.
    Completed {
        /// 기록한 메시지 수(이어받은 것 포함)
        messages: u64,
        last_offset_ms: Option<u64>,
        end: ChatEnd,
        /// 자막을 요청했는데 만들지 못했다(기록은 완성이다)
        subtitle_failed: bool,
    },
    /// `Skip`인데 받는 동안 같은 이름 파일이 생겼다. 막힌 파일의 `.part`와 기록 sidecar는 남는다.
    TargetExists { path: PathBuf },
}

/// 채팅 진행. 퍼센트는 셸이 `cursor_ms / duration_ms`로 계산한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ChatProgress {
    pub cursor_ms: u64,
    pub duration_ms: Option<u64>,
    pub messages: u64,
}

impl Chzzk {
    /// 영상 `req.output` 옆에 채팅 기록(`{stem}.chat.jsonl`)과 자막(`{stem}.ass`·`.srt`)을 받는다.
    ///
    /// - sidecar에 정상 끝이 적혀 있으면 요청 없이 마무리만 한다(받는 동안 같은 이름이 생겨 멈췄던 작업).
    /// - 실패·취소하면 `.part`·sidecar를 남긴다. 같은 요청으로 다시 부르면 sidecar의 커서부터 이어받는다.
    /// - 같은 출력을 다른 작업이 받는 중이면 `FileLocked`이고 아무것도 바꾸지 않는다.
    /// - 자막을 만들지 못해도 기록은 완성으로 옮기고 `subtitle_failed`로 알린다.
    pub async fn collect_chat(
        &self,
        req: ChatRequest,
        cancel: CancellationToken,
        on_progress: &(dyn Fn(ChatProgress) + Send + Sync),
    ) -> Result<ChatOutcome, Error> {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let record = sibling_path(&req.output, RECORD_EXT);
        let subtitle = req.subtitle.ext().map(|e| sibling_path(&req.output, e));
        if let Some(dir) = record.parent().filter(|d| !d.as_os_str().is_empty()) {
            std::fs::create_dir_all(dir).map_err(|e| map_io_error("create dir", dir, e))?;
        }
        let mut part = ChatPart::open(&record, req.video_no, req.restart)?;
        let report = |part: &ChatPart, cursor_ms: u64| {
            on_progress(ChatProgress {
                cursor_ms,
                duration_ms: req.duration_ms,
                messages: part.lines(),
            })
        };
        report(&part, part.resume_state().cursor.0);
        let end = match part.end() {
            Some(end) => end,
            None => self.walk_pages(&mut part, &req, &cancel, &report).await?,
        };

        // 자막(이미 최종 이름으로 옮겼으면 다시 만들지 않는다). rename 뒤 `moved` 기록 전에 멈췄던
        // 이동도 옮긴 것이다: 임시 파일을 다시 만들면 마무리가 자기 자막에 막힌다. 그 판정은 sidecar의
        // 이동 의도로 하므로 원래 있던 무관한 자막은 여기 걸리지 않는다.
        let mut companions = Vec::new();
        let mut subtitle_failed = false;
        if let Some(to) = subtitle
            && !part.is_moved(&to)
            && !part.is_move_interrupted(&part_path(&to), &to)
        {
            let tmp = part_path(&to);
            let opts = SubtitleOpts {
                duration_ms: req.duration_ms,
            };
            match write_subtitle(&mut part, req.subtitle, &opts, &tmp) {
                Ok(()) => companions.push(Companion { from: tmp, to }),
                Err(e) => {
                    tracing::warn!(error = %e, "채팅 자막을 만들지 못함(기록만 남긴다)");
                    subtitle_failed = true;
                    if let Err(re) = remove_if_exists(&tmp) {
                        tracing::warn!(error = %re, "자막 임시 파일 삭제 실패");
                    }
                }
            }
        }

        let messages = part.lines();
        let last_offset_ms = part.last_offset_ms();
        match part.finalize(&companions, req.on_existing).await? {
            ChatFinalized::Moved => Ok(ChatOutcome::Completed {
                messages,
                last_offset_ms,
                end,
                subtitle_failed,
            }),
            ChatFinalized::TargetExists { path } => Ok(ChatOutcome::TargetExists { path }),
        }
    }

    /// 정상 끝까지 페이지를 돌며 커밋한다. 끝 이유를 sidecar에 적고 돌려준다.
    async fn walk_pages(
        &self,
        part: &mut ChatPart,
        req: &ChatRequest,
        cancel: &CancellationToken,
        report: &(dyn Fn(&ChatPart, u64) + Send + Sync),
    ) -> Result<ChatEnd, Error> {
        let mut state = part.resume_state();
        let mut last_request = None;
        loop {
            let page = self
                .fetch_page_retrying(req.video_no, &state, cancel, &mut last_request)
                .await?;
            let step = next_step(&state, &page);
            let kept: Vec<&ChatMessage> = step.keep.iter().map(|&i| &page.messages[i]).collect();
            match step.next {
                Next::Continue(next) => {
                    part.commit_page(&kept, &next, None).await?;
                    state = next;
                    report(part, state.cursor.0);
                }
                Next::End(end) => {
                    // 끝 페이지의 새 메시지도 기록한다(커서 멈춤 페이지에는 메시지가 있다)
                    part.commit_page(&kept, &state, Some(end)).await?;
                    report(part, state.cursor.0);
                    tracing::info!(?end, lines = part.lines(), "채팅 기록을 끝까지 받음");
                    return Ok(end);
                }
            }
        }
    }

    /// 한 페이지를 받는다. 앞 응답과 다음 요청 사이(재시도 포함)는 `chat_page_interval` 이상 띄우고, 실패는 `chat::retry::classify`로
    /// 나눠 `chat_retry` 정책만큼 다시 한다. 요청과 대기는 취소되면 곧바로 `Cancelled`다.
    async fn fetch_page_retrying(
        &self,
        video_no: u64,
        state: &WalkState,
        cancel: &CancellationToken,
        last_request: &mut Option<Instant>,
    ) -> Result<ChatPage, Error> {
        let cfg = self.config();
        let policy = cfg.chat_retry;
        let mut attempts = 0u32;
        loop {
            if let Some(t) = *last_request {
                cancellable(cancel, tokio::time::sleep_until(t + cfg.chat_page_interval)).await?;
            }
            attempts += 1;
            let r = cancellable(cancel, self.fetch_chat_page(video_no, state.cursor)).await?;
            // 간격은 앞 응답을 받은 뒤부터 잰다(서버가 보는 요청 사이도 간격 이상이 된다)
            *last_request = Some(Instant::now());
            match r {
                Ok(page) => return Ok(page),
                Err(e) if classify(&e) == ChatFailure::Retry && policy.allows_retry(attempts) => {
                    tracing::debug!(attempts, error = %e, "채팅 페이지 재시도");
                    cancellable(cancel, tokio::time::sleep(policy.delay(attempts - 1))).await?;
                }
                Err(e) => return Err(e),
            }
        }
    }
}

/// `f`를 기다리되 취소되면 `Cancelled`.
async fn cancellable<F: Future>(cancel: &CancellationToken, f: F) -> Result<F::Output, Error> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(Error::Cancelled),
        v = f => Ok(v),
    }
}

/// 커밋한 기록으로 자막을 만들어 `tmp`에 쓴다.
fn write_subtitle(
    part: &mut ChatPart,
    format: SubtitleFormat,
    opts: &SubtitleOpts,
    tmp: &Path,
) -> Result<(), Error> {
    let msgs = part.read_messages()?;
    let text = match format {
        SubtitleFormat::Ass => render_ass(&msgs, opts),
        SubtitleFormat::Srt => render_srt(&msgs, opts),
        SubtitleFormat::None => return Ok(()),
    };
    std::fs::write(tmp, text).map_err(|e| map_io_error("write", tmp, e))
}
