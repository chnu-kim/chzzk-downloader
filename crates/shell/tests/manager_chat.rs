//! 채팅 함께 받기의 셸 동작(기능 ④-4, chat.md §4·§9.3). 가짜 Backend로 생명주기 표(§4.3)의 행을 하나씩 본다.

mod common;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chzzk_core::chat::collect::RECORD_EXT;
use chzzk_core::chat::{ChatOutcome, SubtitleFormat};
use chzzk_core::download::part::{part_path, sidecar_path};
use chzzk_core::naming::sibling_path;
use chzzk_core::{
    ContentKind, ContentMeta, ContentRef, DownloadOutcome, Error, PlaybackKind, RequestKind,
    Resolved, Source, TimeRange,
};
use chzzk_shell::chat::{ChatPhase, ChatStateDto};
use chzzk_shell::dto::{JobEvent, JobStatus, OnExisting, TimeRangeDto};
use chzzk_shell::{ErrorCode, JobId};
use common::fake::{ChatScript, Script, write_chat_part};
use common::harness::{Harness, live_request, open_with, request, settle, until};
use tokio::sync::Notify;

const VIDEO_NO: u64 = 1;

impl Harness {
    /// 채팅도 함께 받는 작업을 추가한다.
    fn enqueue_chat(&self, name: &str) -> JobId {
        let mut r = request(name);
        r.save_chat = true;
        r.on_existing = OnExisting::Skip;
        self.mgr.enqueue(r, &self.defaults()).unwrap().id
    }

    fn chat(&self, id: JobId) -> Option<ChatStateDto> {
        self.job(id).chat
    }

    fn phase(&self, id: JobId) -> Option<ChatPhase> {
        self.chat(id).map(|c| c.phase)
    }

    /// 한 작업의 채팅 이벤트 단계 순서.
    fn chat_trace(&self, id: JobId) -> Vec<ChatPhase> {
        self.rec
            .events()
            .into_iter()
            .filter_map(|e| match e {
                JobEvent::Chat { id: i, chat } if i == id => Some(chat.phase),
                _ => None,
            })
            .collect()
    }

    /// 완료된 영상 파일을 만든다(채팅만 받기는 영상 파일이 있어야 한다).
    fn touch_video(&self, name: &str) -> PathBuf {
        let p = self.output(name);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"mp4").unwrap();
        p
    }
}

fn record_part(video: &Path) -> PathBuf {
    part_path(&sibling_path(video, RECORD_EXT))
}

fn record_sidecar(video: &Path) -> PathBuf {
    sidecar_path(&sibling_path(video, RECORD_EXT))
}

fn resolved_with_duration(secs: f64) -> Resolved {
    Resolved {
        content: ContentRef::Video { video_no: VIDEO_NO },
        meta: ContentMeta {
            kind: ContentKind::Video,
            title: "t".into(),
            channel_name: "c".into(),
            channel_id: Some("ch".into()),
            live_open_date: None,
            publish_date: None,
            adult: false,
            duration_secs: Some(secs),
        },
        source: Source::Progressive { reps: vec![] },
    }
}

// ---------------------------------------------------------------------------
// 실행 순서·결과(§4.2)
// ---------------------------------------------------------------------------

/// 영상 완료 → 채팅 실행 → `JobEvent::Chat` 순서. 채팅은 영상의 `Status(completed)` 뒤에만 시작한다.
#[tokio::test(start_paused = true)]
async fn chat_runs_after_video_completes() {
    let h = Harness::new(1);
    h.fake
        .chat_for(h.output("a"), ChatScript::new().progress(1_000, 5));
    let id = h.enqueue_chat("a");
    assert_eq!(h.phase(id), Some(ChatPhase::Waiting));
    until("채팅 완료", || {
        h.phase(id) == Some(ChatPhase::Completed)
    })
    .await;
    assert_eq!(h.status(id), JobStatus::Completed);
    let c = h.chat(id).unwrap();
    assert_eq!(c.messages, 5);
    assert_eq!(c.partial_bytes, None);

    let events = h.rec.events();
    let completed = events
        .iter()
        .position(|e| matches!(e, JobEvent::Status { job } if job.id == id && job.status == JobStatus::Completed))
        .unwrap();
    let running = events
        .iter()
        .position(|e| matches!(e, JobEvent::Chat { id: i, chat } if *i == id && chat.phase == ChatPhase::Running))
        .unwrap();
    assert!(completed < running, "영상 완료가 채팅 시작보다 먼저다");
    assert_eq!(
        h.chat_trace(id).last(),
        Some(&ChatPhase::Completed),
        "{:?}",
        h.chat_trace(id)
    );
    // 요청: 영상 경로·번호, 받기 시점의 자막 설정, 카드의 덮어쓰기 선택
    let reqs = h.fake.chat_requests();
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].video_no, VIDEO_NO);
    assert_eq!(reqs[0].output, h.output("a"));
    assert_eq!(reqs[0].subtitle, SubtitleFormat::Ass);
    assert_eq!(
        reqs[0].on_existing,
        chzzk_core::download::DuplicatePolicy::Skip
    );
    assert!(!reqs[0].restart);
}

/// 채팅이 실패해도 영상은 완료다. 오류는 채팅 상태에만 남는다.
#[tokio::test(start_paused = true)]
async fn chat_failure_keeps_video_completed() {
    let h = Harness::new(1);
    h.fake.chat_for(
        h.output("a"),
        ChatScript::new().part(2).fails(Error::HttpStatus {
            status: 429,
            kind: RequestKind::Api,
        }),
    );
    let id = h.enqueue_chat("a");
    until("채팅 실패", || h.phase(id) == Some(ChatPhase::Failed)).await;
    let j = h.job(id);
    assert_eq!(j.status, JobStatus::Completed);
    assert_eq!(j.error, None);
    let c = j.chat.unwrap();
    assert_eq!(c.error.unwrap().code, ErrorCode::Http);
    assert!(c.partial_bytes.is_some(), "받은 부분은 남는다");
}

/// 큐는 한 번에 하나만 돈다(영상 슬롯과 따로).
#[tokio::test(start_paused = true)]
async fn chat_queue_runs_one_at_a_time() {
    let h = Harness::new(3);
    let gates: Vec<Arc<Notify>> = (0..3).map(|_| Arc::new(Notify::new())).collect();
    let names = ["a", "b", "c"];
    for (n, g) in names.iter().zip(&gates) {
        h.fake
            .chat_for(h.output(n), ChatScript::new().hold(Arc::clone(g)));
    }
    let ids: Vec<JobId> = names.iter().map(|n| h.enqueue_chat(n)).collect();
    until("첫 채팅", || {
        ids.iter()
            .filter(|&&i| h.phase(i) == Some(ChatPhase::Running))
            .count()
            == 1
    })
    .await;
    settle().await;
    let running = ids
        .iter()
        .filter(|&&i| h.phase(i) == Some(ChatPhase::Running))
        .count();
    assert_eq!(running, 1);
    for g in &gates {
        g.notify_one();
    }
    until("모두 완료", || {
        ids.iter()
            .all(|&i| h.phase(i) == Some(ChatPhase::Completed))
    })
    .await;
    assert_eq!(h.fake.chat_max_active(), 1);
}

/// 영상 길이를 한 번 알아내 퍼센트를 내고, 퍼센트는 뒤로 가지 않는다(P-4).
#[tokio::test(start_paused = true)]
async fn percent_from_resolved_duration_never_goes_back() {
    let h = Harness::new(1);
    h.fake.push_resolve(Ok(resolved_with_duration(100.0)));
    let gate = Arc::new(Notify::new());
    h.fake.chat_for(
        h.output("a"),
        ChatScript::new()
            .progress(38_000, 3)
            .progress(10_000, 4)
            .hold(Arc::clone(&gate)),
    );
    let id = h.enqueue_chat("a");
    until("진행", || h.chat(id).is_some_and(|c| c.messages == 4)).await;
    assert_eq!(h.chat(id).unwrap().percent, Some(38));
    assert_eq!(h.fake.chat_requests()[0].duration_ms, Some(100_000));
    gate.notify_one();
    until("완료", || h.phase(id) == Some(ChatPhase::Completed)).await;
    // 길이는 저장돼 다음에 다시 묻지 않는다
    assert_eq!(
        h.jobs_json()["jobs"][0]["chat"]["durationMs"],
        serde_json::json!(100_000)
    );
}

// ---------------------------------------------------------------------------
// 생명주기 표(§4.3)
// ---------------------------------------------------------------------------

/// 영상 건너뜀: 채팅을 실행하지 않고 `Waiting` → 없음.
#[tokio::test(start_paused = true)]
async fn skipped_video_drops_waiting_chat() {
    let h = Harness::new(1);
    h.fake.script_for(
        h.output("a"),
        Script::new().ends(Ok(DownloadOutcome::Skipped {
            path: h.output("a"),
        })),
    );
    let id = h.enqueue_chat("a");
    until("건너뜀", || h.status(id) == JobStatus::Skipped).await;
    settle().await;
    assert_eq!(h.chat(id), None);
    assert!(h.fake.chat_requests().is_empty());
}

/// 영상 실패: 채팅은 `Waiting`으로 남고, 영상을 이어받아 완료하면 그때 실행한다.
#[tokio::test(start_paused = true)]
async fn failed_video_keeps_chat_waiting_until_completed() {
    let h = Harness::new(1);
    h.fake.script_for(
        h.output("a"),
        Script::new().fails(Error::HttpStatus {
            status: 404,
            kind: RequestKind::Media,
        }),
    );
    let id = h.enqueue_chat("a");
    until("실패", || h.status(id) == JobStatus::Failed).await;
    settle().await;
    assert_eq!(h.phase(id), Some(ChatPhase::Waiting));
    assert!(h.fake.chat_requests().is_empty());
    h.mgr.resume(id, false).unwrap();
    until("채팅 완료", || {
        h.phase(id) == Some(ChatPhase::Completed)
    })
    .await;
}

/// 생방송 녹화는 마무리해 `completed`가 돼도 채팅 줄에 들어가지 않는다(§4.6).
#[tokio::test(start_paused = true)]
async fn live_completion_never_queues_chat() {
    let h = Harness::new(1);
    let id = h.enqueue_live("live").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    settle().await;
    assert_eq!(h.chat(id), None);
    assert!(h.fake.chat_requests().is_empty());
}

/// 클립·생방송·구간 요청에 `saveChat: true`를 실으면 `invalidInput`이다(가드를 지우면 실패해야 한다).
#[tokio::test(start_paused = true)]
async fn enqueue_rejects_chat_for_clip_live_and_range() {
    let h = Harness::new(1);
    let mut clip = request("clip");
    clip.url = "https://chzzk.naver.com/clips/abc".into();
    clip.content = ContentRef::Clip {
        clip_id: "abc".into(),
    };
    clip.save_chat = true;
    let mut live = live_request("live");
    live.save_chat = true;
    let mut range = request("range");
    range.range = Some(TimeRangeDto {
        start_ms: 0,
        end_ms: Some(1_000),
    });
    range.save_chat = true;
    for r in [clip, live, range] {
        let e = h.mgr.enqueue(r, &h.defaults()).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput);
    }
    assert!(h.mgr.list().is_empty());
    // 채팅을 고르지 않으면 그대로 받는다
    let mut ok = request("range2");
    ok.range = Some(TimeRangeDto {
        start_ms: 0,
        end_ms: Some(1_000),
    });
    assert!(h.mgr.enqueue(ok, &h.defaults()).is_ok());
    let _ = TimeRange {
        start_ms: 0,
        end_ms: None,
    };
}

/// 채팅 일시정지: `paused`, `.part`·sidecar가 남고 자동 이어받기 대상이 아니다.
#[tokio::test(start_paused = true)]
async fn pause_chat_keeps_part_and_is_not_auto_resumed() {
    let h = Harness::new(1);
    h.fake
        .chat_for(h.output("a"), ChatScript::new().part(3).wait_cancel());
    let id = h.enqueue_chat("a");
    until("채팅 받는 중", || {
        h.phase(id) == Some(ChatPhase::Running)
    })
    .await;
    settle().await;
    h.mgr.pause_chat(id).unwrap();
    until("일시정지", || h.phase(id) == Some(ChatPhase::Paused)).await;
    assert!(record_part(&h.output("a")).exists());
    assert!(h.chat(id).unwrap().partial_bytes.is_some());

    h.mgr.flush();
    let reopened = open_with(h.dir.path(), &h.fake, 1, true);
    settle().await;
    let j = reopened.list().into_iter().find(|j| j.id == id).unwrap();
    assert_eq!(j.chat.unwrap().phase, ChatPhase::Paused);
    assert_eq!(h.fake.chat_requests().len(), 1, "다시 시작하지 않는다");
}

/// 앱 종료: 받는 중이던 채팅은 `interrupted`이고 창 닫기 확인(`running_count`)에 세지 않는다.
/// 자동 이어받기가 켜져 있으면 다시 열 때 이어받는다.
#[tokio::test(start_paused = true)]
async fn quit_interrupts_chat_and_auto_resume_picks_it_up() {
    let h = Harness::new(1);
    h.fake
        .chat_for(h.output("a"), ChatScript::new().part(2).wait_cancel());
    let id = h.enqueue_chat("a");
    until("채팅 받는 중", || {
        h.phase(id) == Some(ChatPhase::Running)
    })
    .await;
    settle().await;
    assert_eq!(
        h.mgr.running_count(),
        0,
        "채팅은 창 닫기 확인에 세지 않는다"
    );
    assert!(h.mgr.chat_running());
    h.mgr.quit(std::time::Duration::from_secs(3)).await;
    assert_eq!(h.phase(id), Some(ChatPhase::Interrupted));

    // 자동 이어받기 꺼짐: 그대로
    let off = open_with(h.dir.path(), &h.fake, 1, false);
    settle().await;
    let j = off.list().into_iter().find(|j| j.id == id).unwrap();
    assert_eq!(j.chat.unwrap().phase, ChatPhase::Interrupted);
    off.flush();
    drop(off);

    // 켜짐: 이어받는다(같은 요청, 처음부터가 아님)
    let on = open_with(h.dir.path(), &h.fake, 1, true);
    until("다시 받음", || h.fake.chat_requests().len() == 2).await;
    until("완료", || {
        on.list()
            .into_iter()
            .find(|j| j.id == id)
            .and_then(|j| j.chat)
            .is_some_and(|c| c.phase == ChatPhase::Completed)
    })
    .await;
    assert!(!h.fake.chat_requests()[1].restart);
}

/// 로그인 빌드의 자동 이어받기는 같은 채널 필터를 채팅에도 적용한다.
#[tokio::test(start_paused = true)]
async fn auto_resume_filter_applies_to_chat() {
    let h = Harness::new(1);
    h.fake
        .chat_for(h.output("a"), ChatScript::new().wait_cancel());
    let id = h.enqueue_chat("a");
    until("채팅 받는 중", || {
        h.phase(id) == Some(ChatPhase::Running)
    })
    .await;
    h.mgr.quit(std::time::Duration::from_secs(3)).await;

    let m = open_with(h.dir.path(), &h.fake, 1, false);
    assert_eq!(m.resume_interrupted_where(|_, c| c == Some("other")), 0);
    settle().await;
    assert_eq!(h.fake.chat_requests().len(), 1);
    assert_eq!(m.resume_interrupted_where(|_, c| c == Some("ch")), 1);
    until("다시 받음", || h.fake.chat_requests().len() == 2).await;
}

// ---------------------------------------------------------------------------
// 정리 규칙(§4.3)
// ---------------------------------------------------------------------------

/// 채팅 `.part`가 있는(멈춘·겹침·첫 페이지 실패) 완료 작업은 완료 지우기·자동 정리에서 빠지고 파일이 남는다.
/// 행 하나 지우기(`remove`)만 채팅 `.part`·sidecar를 지운다(영상과 완성 파일은 그대로).
#[tokio::test(start_paused = true)]
async fn chat_part_keeps_job_out_of_clear_finished() {
    let h = Harness::new(1);
    // 첫 페이지 전에 실패해도(받은 것 0) 코어는 `.part`와 sidecar를 남긴다
    h.fake.chat_for(
        h.output("a"),
        ChatScript::new()
            .part(0)
            .fails(Error::AuthRequired { status: 401 }),
    );
    let a = h.enqueue_chat("a");
    until("채팅 실패", || h.phase(a) == Some(ChatPhase::Failed)).await;
    assert_eq!(h.chat(a).unwrap().partial_bytes, Some(0));
    // 채팅 없는 완료 작업은 지워진다
    let b = h.enqueue("b").id;
    until("b 완료", || h.status(b) == JobStatus::Completed).await;
    h.mgr.clear_finished();
    let ids: Vec<JobId> = h.mgr.list().into_iter().map(|j| j.id).collect();
    assert_eq!(ids, vec![a]);
    assert!(record_part(&h.output("a")).exists());

    // 완성된 채팅 파일은 지우기에서도 그대로다
    let done = sibling_path(&h.output("a"), ".ass");
    std::fs::write(&done, b"user").unwrap();
    h.mgr.remove(a).await.unwrap();
    assert!(h.mgr.list().is_empty());
    assert!(!record_part(&h.output("a")).exists());
    assert!(!record_sidecar(&h.output("a")).exists());
    assert_eq!(std::fs::read(&done).unwrap(), b"user");
}

/// 받는 중인 채팅이 있는 완료 작업을 지우면 채팅을 멈춘 뒤 `.part`를 지운다.
#[tokio::test(start_paused = true)]
async fn remove_running_chat_stops_and_discards() {
    let h = Harness::new(1);
    h.fake
        .chat_for(h.output("a"), ChatScript::new().part(4).wait_cancel());
    let id = h.enqueue_chat("a");
    until("채팅 받는 중", || {
        h.phase(id) == Some(ChatPhase::Running)
    })
    .await;
    until(".part", || record_part(&h.output("a")).exists()).await;
    h.mgr.clear_finished();
    assert_eq!(h.mgr.list().len(), 1, "받는 중인 채팅은 정리하지 않는다");
    h.mgr.remove(id).await.unwrap();
    assert!(h.mgr.list().is_empty());
    assert!(!record_part(&h.output("a")).exists());
    assert!(!h.mgr.chat_running());
}

/// 받는 동안 같은 이름 파일이 생겨 `conflict`: 완료 지우기 뒤에도 남고, 덮어쓰기 동의로 이어받는다(같은 `.part`).
#[tokio::test(start_paused = true)]
async fn conflict_survives_clear_and_overwrite_resumes() {
    let h = Harness::new(1);
    let ass = sibling_path(&h.output("a"), ".ass");
    h.fake.chat_for(
        h.output("a"),
        ChatScript::new()
            .part(3)
            .ends(Ok(ChatOutcome::TargetExists { path: ass.clone() })),
    );
    let id = h.enqueue_chat("a");
    until("겹침", || h.phase(id) == Some(ChatPhase::Conflict)).await;
    h.mgr.clear_finished();
    assert_eq!(h.mgr.list().len(), 1);
    h.touch_video("a");
    h.mgr
        .start_chat(
            id,
            false,
            OnExisting::Overwrite,
            SubtitleFormat::Srt,
            |_| Ok(None),
        )
        .unwrap();
    until("완료", || h.phase(id) == Some(ChatPhase::Completed)).await;
    let r = &h.fake.chat_requests()[1];
    assert!(!r.restart);
    assert_eq!(
        r.on_existing,
        chzzk_core::download::DuplicatePolicy::Overwrite
    );
    assert_eq!(r.subtitle, SubtitleFormat::Ass, "이어받기는 처음 고른 형식");
}

/// 영상 "처음부터"는 받다 만 채팅도 버리고, 다음 채팅은 처음부터 받는다.
#[tokio::test(start_paused = true)]
async fn video_restart_discards_chat_part() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let id = h.enqueue_chat("a");
    until("받는 중", || h.status(id) == JobStatus::Running).await;
    h.mgr.pause(id).unwrap();
    until("일시정지", || h.status(id) == JobStatus::Paused).await;
    write_chat_part(&h.output("a"), VIDEO_NO, 2);
    h.mgr.resume(id, true).unwrap();
    until("채팅 완료", || {
        h.phase(id) == Some(ChatPhase::Completed)
    })
    .await;
    assert!(h.fake.chat_requests()[0].restart);
}

// ---------------------------------------------------------------------------
// 채팅만 받기(`start_chat`, §4.5)
// ---------------------------------------------------------------------------

/// 완료가 아니거나·클립·구간·영상 파일 없음은 `invalidInput`. 판정이 거부하면 채팅 상태는 그대로다.
#[tokio::test(start_paused = true)]
async fn start_chat_rejects_invalid_targets() {
    let h = Harness::new(3);
    h.fake
        .script_for(h.output("run"), Script::new().wait_cancel());
    let running = h.enqueue("run").id;
    until("받는 중", || h.status(running) == JobStatus::Running).await;
    let ok = |_: &ContentRef| Ok(None);
    let e = h
        .mgr
        .start_chat(running, false, OnExisting::Skip, SubtitleFormat::Ass, ok)
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);

    // 완료됐지만 영상 파일이 없다(가짜는 파일을 쓰지 않는다)
    let done = h.enqueue("done").id;
    until("완료", || h.status(done) == JobStatus::Completed).await;
    let e = h
        .mgr
        .start_chat(done, false, OnExisting::Skip, SubtitleFormat::Ass, ok)
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);

    // 생방송
    let live = h.enqueue_live("live").id;
    until("완료", || h.status(live) == JobStatus::Completed).await;
    let e = h
        .mgr
        .start_chat(live, false, OnExisting::Skip, SubtitleFormat::Ass, ok)
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(h.mgr.chat_content(live).is_err());

    // 판정 거부: 상태가 바뀌지 않는다
    h.touch_video("done");
    let e = h
        .mgr
        .start_chat(done, false, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Err(chzzk_shell::AppError::ownership_unknown())
        })
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::OwnershipUnknown);
    assert_eq!(h.chat(done), None);
    assert!(h.fake.chat_requests().is_empty());
}

/// 채팅만 받기: 지금 설정의 형식으로 받고, 판정한 채널을 기록에 쓴다. 이미 돌고 있으면 멱등이다.
#[tokio::test(start_paused = true)]
async fn start_chat_fetches_with_current_setting() {
    let h = Harness::new(1);
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    h.touch_video("a");
    let gate = Arc::new(Notify::new());
    h.fake
        .chat_for(h.output("a"), ChatScript::new().hold(Arc::clone(&gate)));
    h.mgr
        .start_chat(id, false, OnExisting::Skip, SubtitleFormat::Srt, |_| {
            Ok(Some(Some("verified".into())))
        })
        .unwrap();
    until("받는 중", || h.phase(id) == Some(ChatPhase::Running)).await;
    assert_eq!(h.job(id).channel_id.as_deref(), Some("verified"));
    // 두 번 눌러도 하나만 돈다
    h.mgr
        .start_chat(id, true, OnExisting::Overwrite, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap();
    gate.notify_one();
    until("완료", || h.phase(id) == Some(ChatPhase::Completed)).await;
    let reqs = h.fake.chat_requests();
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].subtitle, SubtitleFormat::Srt);

    // 다시 받기(완료 뒤): 지금 설정의 형식, 덮어쓰기는 프런트가 정한 값
    h.mgr
        .start_chat(id, false, OnExisting::Skip, SubtitleFormat::None, |_| {
            Ok(None)
        })
        .unwrap();
    until("다시 완료", || h.fake.chat_requests().len() == 2).await;
    assert_eq!(h.fake.chat_requests()[1].subtitle, SubtitleFormat::None);
}

/// `restart = true, on_existing = Skip`은 덮어쓰기 동의가 아니다(`restart` ≠ 동의).
#[tokio::test(start_paused = true)]
async fn restart_is_not_overwrite_consent() {
    let h = Harness::new(1);
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    h.touch_video("a");
    write_chat_part(&h.output("a"), VIDEO_NO, 2);
    h.mgr
        .start_chat(id, true, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap();
    until("완료", || h.phase(id) == Some(ChatPhase::Completed)).await;
    let r = &h.fake.chat_requests()[0];
    assert!(r.restart);
    assert_eq!(r.on_existing, chzzk_core::download::DuplicatePolicy::Skip);
}

/// 채팅이 대기 중일 때 일시정지하면 줄에서 빠진다(영상 완료 뒤에도 시작하지 않는다).
#[tokio::test(start_paused = true)]
async fn pause_waiting_chat_removes_from_queue() {
    let h = Harness::new(1);
    let gate = Arc::new(Notify::new());
    h.fake
        .chat_for(h.output("a"), ChatScript::new().hold(Arc::clone(&gate)));
    let a = h.enqueue_chat("a");
    let b = h.enqueue_chat("b");
    until("a 받는 중", || h.phase(a) == Some(ChatPhase::Running)).await;
    until("b 완료", || h.status(b) == JobStatus::Completed).await;
    assert_eq!(h.phase(b), Some(ChatPhase::Waiting));
    h.mgr.pause_chat(b).unwrap();
    assert_eq!(h.phase(b), Some(ChatPhase::Paused));
    gate.notify_one();
    until("a 완료", || h.phase(a) == Some(ChatPhase::Completed)).await;
    settle().await;
    assert_eq!(h.fake.chat_requests().len(), 1);
    // 채팅이 없는 작업은 invalidInput
    let c = h.enqueue("c").id;
    assert_eq!(
        h.mgr.pause_chat(c).unwrap_err().code,
        ErrorCode::InvalidInput
    );
}

// ---------------------------------------------------------------------------
// 이름 충돌(§4.4)
// ---------------------------------------------------------------------------

/// `check_output`: 채팅을 함께 받으면 같은 stem의 자막·기록도 충돌이고(자막 → 기록 → 영상 순),
/// 번호 이름은 세 이름이 모두 비는 번호다.
#[tokio::test(start_paused = true)]
async fn check_output_counts_chat_files() {
    let h = Harness::new(1);
    let content = ContentRef::Video { video_no: VIDEO_NO };
    std::fs::create_dir_all(h.downloads()).unwrap();
    let check = |chat: Option<SubtitleFormat>| {
        h.mgr
            .check_output(
                None,
                &h.downloads(),
                "a",
                &content,
                "720p",
                PlaybackKind::LiveRewindHls,
                None,
                chat,
            )
            .unwrap()
    };
    std::fs::write(sibling_path(&h.output("a"), ".ass"), b"x").unwrap();
    let c = check(None);
    assert!(!c.exists, "채팅을 받지 않으면 자막은 상관없다");
    assert!(c.conflict_names.is_empty());
    let c = check(Some(SubtitleFormat::Srt));
    assert!(!c.exists, "다른 형식의 자막은 덮어쓰지 않는다");
    let c = check(Some(SubtitleFormat::Ass));
    assert!(c.exists);
    assert_eq!(c.conflict_names, vec!["a.ass".to_string()]);

    h.touch_video("a");
    std::fs::write(sibling_path(&h.output("a"), RECORD_EXT), b"x").unwrap();
    let c = check(Some(SubtitleFormat::Ass));
    assert_eq!(
        c.conflict_names,
        vec![
            "a.ass".to_string(),
            "a.chat.jsonl".to_string(),
            "a.mp4".to_string()
        ]
    );
    assert_eq!(check(None).conflict_names, vec!["a.mp4".to_string()]);

    // (2)는 자막이, (3)은 받다 만 기록이 있다 → (4)
    std::fs::write(sibling_path(&h.output("a (2)"), ".ass"), b"x").unwrap();
    std::fs::write(record_part(&h.output("a (3)")), b"x").unwrap();
    assert_eq!(
        check(Some(SubtitleFormat::Ass)).free_file_name.as_deref(),
        Some("a (4)")
    );
    assert_eq!(check(None).free_file_name.as_deref(), Some("a (2)"));
}

/// `check_chat_output`: 완료 작업의 채팅 파일 충돌(자막 → 기록). 완료가 아니면 `invalidInput`.
#[tokio::test(start_paused = true)]
async fn check_chat_output_lists_existing_chat_files() {
    let h = Harness::new(1);
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    h.touch_video("a");
    assert!(
        h.mgr
            .check_chat_output(id, SubtitleFormat::Ass)
            .unwrap()
            .conflict_names
            .is_empty()
    );
    std::fs::write(sibling_path(&h.output("a"), RECORD_EXT), b"x").unwrap();
    std::fs::write(sibling_path(&h.output("a"), ".ass"), b"x").unwrap();
    assert_eq!(
        h.mgr
            .check_chat_output(id, SubtitleFormat::Ass)
            .unwrap()
            .conflict_names,
        vec!["a.ass".to_string(), "a.chat.jsonl".to_string()]
    );
    assert_eq!(
        h.mgr
            .check_chat_output(id, SubtitleFormat::None)
            .unwrap()
            .conflict_names,
        vec!["a.chat.jsonl".to_string()]
    );
}

/// "처음부터"는 코어 수집이 시작되기 전(길이 조회 중)에 멈추면 남아, 다음 시작도 처음부터다.
#[tokio::test(start_paused = true)]
async fn restart_survives_pause_before_collect() {
    let h = Harness::new(1);
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    h.touch_video("a");
    write_chat_part(&h.output("a"), VIDEO_NO, 2);
    // 길이 조회 전에 멈춘다: 태스크를 띄운 같은 잠금 구간 뒤 곧바로 일시정지
    h.mgr
        .start_chat(id, true, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap();
    h.mgr.pause_chat(id).unwrap();
    until("일시정지", || h.phase(id) == Some(ChatPhase::Paused)).await;
    assert!(h.fake.chat_requests().is_empty(), "코어 수집 전에 멈췄다");
    // 이어받기(restart 아님)로 다시 시작해도 남은 "처음부터"가 쓰인다
    h.mgr
        .start_chat(id, false, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap();
    until("완료", || h.phase(id) == Some(ChatPhase::Completed)).await;
    assert!(h.fake.chat_requests()[0].restart);
}

// ---------------------------------------------------------------------------
// 출력 예약·"처음부터"·공유 `.part`(Codex PR #141)
// ---------------------------------------------------------------------------

/// 영상은 완료됐지만 채팅을 받는 중이면 그 출력은 아직 쓰이고 있다. 같은 출력에 다른 영상을 덮어쓰며 받는 작업은
/// `duplicateOutput`으로 거부한다(받아들이면 바뀐 영상 옆에 원래 영상의 채팅·자막이 놓인다). 채팅이 끝나면 풀린다.
#[tokio::test(start_paused = true)]
async fn running_chat_reserves_output_against_other_video() {
    let h = Harness::new(2);
    let gate = Arc::new(Notify::new());
    h.fake
        .chat_for(h.output("a"), ChatScript::new().hold(Arc::clone(&gate)));
    let a = h.enqueue_chat("a");
    until("채팅 받는 중", || {
        h.phase(a) == Some(ChatPhase::Running)
    })
    .await;
    assert_eq!(h.status(a), JobStatus::Completed);
    let mut other = request("a");
    other.content = ContentRef::Video { video_no: 2 };
    other.url = "https://chzzk.naver.com/video/2".into();
    other.on_existing = OnExisting::Overwrite;
    let err = h.mgr.enqueue(other.clone(), &h.defaults()).unwrap_err();
    assert_eq!(err.code, ErrorCode::DuplicateOutput);
    // 이름 미리 보기도 같은 판정이다(카드가 "비었다"고 하고 추가가 거부되지 않게)
    let check = h
        .mgr
        .check_output(
            None,
            &h.downloads(),
            "a",
            &other.content,
            "720p",
            PlaybackKind::LiveRewindHls,
            None,
            None,
        )
        .unwrap();
    assert_eq!(check.duplicate_job_id, Some(a));
    gate.notify_one();
    until("채팅 완료", || h.phase(a) == Some(ChatPhase::Completed)).await;
    h.mgr.enqueue(other, &h.defaults()).unwrap();
}

/// 같은 출력을 쓰는 다른 기록의 채팅이 받는 중이면 채팅만 받기(`start_chat`)도 `duplicateOutput`이고 상태는 그대로다.
#[tokio::test(start_paused = true)]
async fn start_chat_rejects_output_held_by_other_chat() {
    let h = Harness::new(1);
    let b = h.enqueue("a").id;
    until("b 완료", || h.status(b) == JobStatus::Completed).await;
    let gate = Arc::new(Notify::new());
    h.fake
        .chat_for(h.output("a"), ChatScript::new().hold(Arc::clone(&gate)));
    let a = h.enqueue_chat("a");
    until("a 채팅 받는 중", || {
        h.phase(a) == Some(ChatPhase::Running)
    })
    .await;
    h.touch_video("a");
    let err = h
        .mgr
        .start_chat(b, false, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::DuplicateOutput);
    assert_eq!(h.chat(b), None);
    gate.notify_one();
    until("a 완료", || h.phase(a) == Some(ChatPhase::Completed)).await;
    settle().await;
    assert_eq!(h.fake.chat_requests().len(), 1);
}

/// "처음부터"가 코어의 `.part` 열기 전에 실패하면(같은 출력을 다른 작업이 잠가 `FileLocked`) 의도가 남아,
/// 이어받기로 다시 시작해도 처음부터다(옛 커서로 잇지 않는다).
#[tokio::test(start_paused = true)]
async fn restart_survives_file_locked_before_open() {
    let h = Harness::new(1);
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    h.touch_video("a");
    write_chat_part(&h.output("a"), VIDEO_NO, 2);
    h.fake.chat_for(
        h.output("a"),
        ChatScript::new().fails(Error::FileLocked {
            path: record_part(&h.output("a")),
        }),
    );
    h.mgr
        .start_chat(id, true, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap();
    until("실패", || h.phase(id) == Some(ChatPhase::Failed)).await;
    h.mgr
        .start_chat(id, false, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap();
    until("완료", || h.phase(id) == Some(ChatPhase::Completed)).await;
    let reqs = h.fake.chat_requests();
    assert!(reqs[0].restart);
    assert!(reqs[1].restart, "열기 전 실패는 \"처음부터\"를 쓰지 않았다");
}

/// 코어가 `.part`를 열었다는 첫 진행 뒤에 멈추면 "처음부터"는 쓰였다: 다음 이어받기는 이어서 받는다.
#[tokio::test(start_paused = true)]
async fn restart_is_consumed_after_first_progress() {
    let h = Harness::new(1);
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    h.touch_video("a");
    write_chat_part(&h.output("a"), VIDEO_NO, 2);
    h.fake.chat_for(
        h.output("a"),
        ChatScript::new().progress(0, 0).part(1).wait_cancel(),
    );
    h.mgr
        .start_chat(id, true, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap();
    until(".part", || h.fake.chat_requests().len() == 1).await;
    until("받는 중", || h.phase(id) == Some(ChatPhase::Running)).await;
    settle().await;
    h.mgr.pause_chat(id).unwrap();
    until("일시정지", || h.phase(id) == Some(ChatPhase::Paused)).await;
    h.mgr
        .start_chat(id, false, OnExisting::Skip, SubtitleFormat::Ass, |_| {
            Ok(None)
        })
        .unwrap();
    until("완료", || h.phase(id) == Some(ChatPhase::Completed)).await;
    assert!(!h.fake.chat_requests()[1].restart);
}

/// 같은 영상·출력의 두 기록이 받다 만 채팅 `.part` 하나를 함께 가리키면(멈춘 채팅은 출력을 예약하지 않는다)
/// 하나를 지워도 파일은 남는다. 마지막 기록을 지울 때 지운다.
#[tokio::test(start_paused = true)]
async fn remove_keeps_chat_part_shared_with_other_record() {
    let h = Harness::new(1);
    h.fake
        .chat_for(h.output("a"), ChatScript::new().part(3).wait_cancel());
    let a = h.enqueue_chat("a");
    until("a 채팅 받는 중", || {
        h.phase(a) == Some(ChatPhase::Running)
    })
    .await;
    until(".part", || record_part(&h.output("a")).exists()).await;
    h.mgr.pause_chat(a).unwrap();
    until("a 일시정지", || h.phase(a) == Some(ChatPhase::Paused)).await;

    h.fake
        .chat_for(h.output("a"), ChatScript::new().part(5).wait_cancel());
    let b = h.enqueue_chat("a");
    until("b 채팅 받는 중", || {
        h.phase(b) == Some(ChatPhase::Running)
    })
    .await;
    h.mgr.pause_chat(b).unwrap();
    until("b 일시정지", || h.phase(b) == Some(ChatPhase::Paused)).await;
    assert!(h.chat(a).unwrap().partial_bytes.is_some());

    h.mgr.remove(a).await.unwrap();
    assert!(record_part(&h.output("a")).exists(), "b가 아직 쓰는 파일");
    assert!(record_sidecar(&h.output("a")).exists());
    assert!(h.chat(b).unwrap().partial_bytes.is_some());

    h.mgr.remove(b).await.unwrap();
    assert!(!record_part(&h.output("a")).exists());
    assert!(!record_sidecar(&h.output("a")).exists());
}

/// 영상 "처음부터"도 다른 기록이 함께 쥔 받다 만 채팅 파일은 지우지 않는다(채팅은 코어가 처음부터 다시 비운다).
#[tokio::test(start_paused = true)]
async fn video_restart_keeps_chat_part_shared_with_other_record() {
    let h = Harness::new(1);
    h.fake
        .chat_for(h.output("a"), ChatScript::new().part(3).wait_cancel());
    let a = h.enqueue_chat("a");
    until("a 채팅 받는 중", || {
        h.phase(a) == Some(ChatPhase::Running)
    })
    .await;
    until(".part", || record_part(&h.output("a")).exists()).await;
    h.mgr.pause_chat(a).unwrap();
    until("a 일시정지", || h.phase(a) == Some(ChatPhase::Paused)).await;

    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let b = h.enqueue_chat("a");
    until("b 받는 중", || h.status(b) == JobStatus::Running).await;
    h.mgr.pause(b).unwrap();
    until("b 일시정지", || h.status(b) == JobStatus::Paused).await;
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    h.mgr.resume(b, true).unwrap();
    until("b 다시 받는 중", || h.status(b) == JobStatus::Running).await;
    settle().await;
    assert!(record_part(&h.output("a")).exists(), "a가 쥔 파일");
    assert!(record_sidecar(&h.output("a")).exists());
}
