//! 채팅 수집 `Chzzk::collect_chat`(기능 ④-3a, chat.md §3.2). 실측에 기대는 Q3·Q8은 ④-3b다.
//!
//! - 페이지를 `walk::next_step`으로 돌고, 페이지마다 `ChatPart::commit_page`로 커밋한다(④-1 실측 도구와 같은 판정).
//! - **400은 어느 페이지에서든 오류다**(chat.md §3.2-3). 정상 끝은 `ChatEnd` 셋뿐이다.
//! - 실패·취소에도 `.part`·sidecar를 지우지 않는다. 채팅은 늘 같은 요청으로 이어받는다(core.md 구현 중 변경 66).
//! - 취소는 요청·대기 중에만 본다. `commit_page`는 취소 지점으로 쓰지 않는다(`chat::part` 실패 계약).
//! - 닉네임·본문은 로그에 내지 않는다.

use std::fs::File;
use std::io::Write;
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

        // 자막(기록 읽기·렌더·쓰기·sync)은 블로킹 스레드에서 한다(실행기를 막지 않는다). 잠근 `part`는 그 작업이
        // 끝날 때까지 작업 안에서 쥐고 있다가 돌려받는다.
        let mut companions = Vec::new();
        let mut subtitle_failed = false;
        if let Some(to) = subtitle {
            let job = SubtitleJob {
                format: req.subtitle,
                opts: SubtitleOpts {
                    duration_ms: req.duration_ms,
                },
                to,
                record: record.clone(),
                max_bytes: self.config().chat_subtitle_max_bytes,
            };
            let (back, made) = subtitle_stage(part, job, File::sync_all).await?;
            part = back;
            match made {
                SubtitleMade::Ready(c) => companions.push(c),
                SubtitleMade::Kept => {}
                SubtitleMade::Failed => subtitle_failed = true,
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

/// 자막 단계의 입력.
struct SubtitleJob {
    format: SubtitleFormat,
    opts: SubtitleOpts,
    /// 최종 자막 경로
    to: PathBuf,
    /// 기록 최종 경로(예산 초과 오류에 싣는다)
    record: PathBuf,
    max_bytes: u64,
}

/// 자막 단계의 결과.
#[derive(Debug)]
enum SubtitleMade {
    /// 임시 파일을 다 썼다. 마무리가 옮긴다
    Ready(Companion),
    /// 이미 옮긴 자기 자막이 있어 다시 만들지 않았다
    Kept,
    /// 만들지 못했다(기록만 남긴다, `subtitle_failed`)
    Failed,
}

/// 자막 단계: 다시 만들지 판정 → 기록 읽기 → 렌더 → 쓰기 → `sync`. 파일 입출력이라 블로킹 스레드에서 돌리고,
/// 잠근 `part`는 그 작업이 끝날 때까지 작업이 쥐었다가 돌려준다(바깥 future가 버려져도 작업이 끝나야 잠금이
/// 풀린다). 작업이 패닉하면 `part`는 잃으므로 `Err`다(`.part`·sidecar는 남아 다음 호출이 이어받는다).
/// `sync`는 테스트 seam이다(제품은 `File::sync_all`).
async fn subtitle_stage(
    mut part: ChatPart,
    job: SubtitleJob,
    sync: impl FnOnce(&File) -> std::io::Result<()> + Send + 'static,
) -> Result<(ChatPart, SubtitleMade), Error> {
    let record = job.record.clone();
    let run = move || {
        let made = make_subtitle(&mut part, &job, sync);
        (part, made)
    };
    run_blocking(run).await.map_err(|e| Error::Io {
        op: "subtitle",
        path: record,
        source: std::io::Error::other(e.to_string()),
    })
}

/// 블로킹 작업을 돌린다.
async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, tokio::task::JoinError> {
    tokio::task::spawn_blocking(f).await
}

/// `subtitle_stage`의 몸통(블로킹).
///
/// 이미 최종 이름으로 옮겼고 그 파일이 있으면 다시 만들지 않는다. rename 뒤 `moved` 기록 전에 멈췄던 이동도 옮긴 것이다:
/// 임시 파일을 다시 만들면 마무리가 자기 자막에 막힌다. 그 판정은 sidecar의 이동 의도로 하므로 원래 있던
/// 무관한 자막은 여기 걸리지 않는다.
fn make_subtitle(
    part: &mut ChatPart,
    job: &SubtitleJob,
    sync: impl FnOnce(&File) -> std::io::Result<()>,
) -> SubtitleMade {
    let tmp = part_path(&job.to);
    // `moved`인데 최종 자막이 없으면 낡은 표시다(옮긴 뒤 기록 이름에 막혀 멈춘 사이 사용자가 지웠다).
    // 표시를 지우고 커밋된 기록에서 다시 만든다. 있으면 사용자가 고쳤어도 그대로 둔다.
    if part.is_moved(&job.to) {
        if job.to.exists() {
            return SubtitleMade::Kept;
        }
        tracing::info!("옮긴 자막이 없어 기록에서 다시 만든다");
        part.forget_moved(&job.to);
    }
    if part.is_move_interrupted(&tmp, &job.to) {
        return SubtitleMade::Kept;
    }
    match write_subtitle(part, job, &tmp, sync) {
        Ok(()) => SubtitleMade::Ready(Companion {
            from: tmp,
            to: job.to.clone(),
        }),
        Err(e) => {
            tracing::warn!(error = %e, "채팅 자막을 만들지 못함(기록만 남긴다)");
            if let Err(re) = remove_if_exists(&tmp) {
                tracing::warn!(error = %re, "자막 임시 파일 삭제 실패");
            }
            SubtitleMade::Failed
        }
    }
}

/// 커밋한 기록으로 자막을 만들어 `tmp`에 쓴다(내용을 sync한 뒤에만 `Ok`).
///
/// 렌더러가 기록 전체를 메모리에 올리므로, 기록이 `max_bytes`를 넘으면 읽지 않고 `FileTooLarge`다
/// (할당 실패로 프로세스가 죽는 대신 자막 실패로 끝낸다, core.md 구현 중 변경 66).
fn write_subtitle(
    part: &mut ChatPart,
    job: &SubtitleJob,
    tmp: &Path,
    sync: impl FnOnce(&File) -> std::io::Result<()>,
) -> Result<(), Error> {
    if part.committed() > job.max_bytes {
        return Err(Error::FileTooLarge {
            path: job.record.clone(),
        });
    }
    let msgs = part.read_messages()?;
    let text = match job.format {
        SubtitleFormat::Ass => render_ass(&msgs, &job.opts),
        SubtitleFormat::Srt => render_srt(&msgs, &job.opts),
        SubtitleFormat::None => return Ok(()),
    };
    write_synced(tmp, &text, sync)
}

/// `tmp`에 `text`를 쓰고 `sync`가 성공해야 `Ok`다. 크래시 뒤 덜 쓴 자막이 마무리(rename)로 넘어가
/// 완성으로 취급되지 않게 한다. `sync`는 테스트가 실패를 주입하는 자리다(제품은 `File::sync_all`).
fn write_synced(
    tmp: &Path,
    text: &str,
    sync: impl FnOnce(&File) -> std::io::Result<()>,
) -> Result<(), Error> {
    let mut f = File::create(tmp).map_err(|e| map_io_error("write", tmp, e))?;
    f.write_all(text.as_bytes())
        .map_err(|e| map_io_error("write", tmp, e))?;
    sync(&f).map_err(|e| map_io_error("sync", tmp, e))
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::io;

    use super::*;

    /// sync는 내용을 다 쓴 뒤에 부르고, 그 성공 뒤에만 `Ok`다.
    #[test]
    fn write_synced_syncs_after_full_write() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = dir.path().join("a.ass.part");
        let called = Cell::new(false);
        write_synced(&tmp, "자막 내용", |f| {
            called.set(true);
            assert_eq!(f.metadata()?.len(), "자막 내용".len() as u64);
            Ok(())
        })
        .unwrap();
        assert!(called.get(), "sync를 부르지 않았다");
        assert_eq!(std::fs::read_to_string(&tmp).unwrap(), "자막 내용");
    }

    fn stage_job(dir: &Path) -> SubtitleJob {
        let video = dir.join("영상.mp4");
        SubtitleJob {
            format: SubtitleFormat::Ass,
            opts: SubtitleOpts::default(),
            to: sibling_path(&video, ".ass"),
            record: sibling_path(&video, RECORD_EXT),
            max_bytes: u64::MAX,
        }
    }

    /// 자막 단계는 실행기 스레드가 아닌 블로킹 스레드에서 쓰고 sync한다(Codex 3차 P2, core.md 구현 중 변경 68-1).
    /// 잠근 `part`는 끝난 뒤 돌려받아 그대로 잠겨 있다.
    #[tokio::test]
    async fn subtitle_stage_runs_off_the_runtime_thread_and_keeps_the_lock() {
        let dir = tempfile::tempdir().unwrap();
        let job = stage_job(dir.path());
        let (to, record) = (job.to.clone(), job.record.clone());
        let part = ChatPart::open(&record, 1, false).unwrap();
        let here = std::thread::current().id();
        let (tx, rx) = std::sync::mpsc::channel();
        let (part, made) = subtitle_stage(part, job, move |_| {
            tx.send(std::thread::current().id()).unwrap();
            Ok(())
        })
        .await
        .unwrap();
        assert_ne!(rx.recv().unwrap(), here, "실행기 스레드에서 자막을 썼다");
        assert!(
            matches!(&made, SubtitleMade::Ready(c) if c.to == to && c.from.is_file()),
            "{made:?}"
        );
        assert!(matches!(
            ChatPart::open(&record, 1, false),
            Err(Error::FileLocked { .. })
        ));
        drop(part);
    }

    /// 블로킹 작업이 패닉하면 `part`를 잃으므로 오류다(잠금은 풀려 다음 호출이 이어받는다).
    #[tokio::test]
    async fn subtitle_stage_panic_is_error_and_releases_lock() {
        let dir = tempfile::tempdir().unwrap();
        let job = stage_job(dir.path());
        let record = job.record.clone();
        let part = ChatPart::open(&record, 1, false).unwrap();
        let err = subtitle_stage(part, job, |_| panic!("자막 sync 주입 패닉"))
            .await
            .unwrap_err();
        assert!(matches!(&err, Error::Io { op: "subtitle", .. }), "{err:?}");
        ChatPart::open(&record, 1, false).unwrap();
    }

    /// sync가 실패하면 `Err`다(호출자는 자막 실패로 처리하고 임시 파일을 지운다).
    #[test]
    fn write_synced_propagates_sync_failure() {
        let dir = tempfile::tempdir().unwrap();
        let tmp = dir.path().join("a.srt.part");
        let err = write_synced(&tmp, "x", |_| Err(io::Error::other("sync 주입 실패"))).unwrap_err();
        assert!(
            matches!(&err, Error::Io { op: "sync", path, .. } if path == &tmp),
            "{err:?}"
        );
    }
}
