//! 생방송 녹화의 매니저 동작(core.md 구현 중 변경 58): 별도 lane, `stop_job`(마무리), 일시정지·종료의 뜻.

mod common;

use std::time::Duration;

use chzzk_core::{DownloadOutcome, Error, LiveProgress, Phase};
use chzzk_shell::ErrorCode;
use chzzk_shell::dto::JobStatus;
use chzzk_shell::manager::MAX_LIVE;
use common::fake::{Script, progress};
use common::harness::{Harness, until};

/// 녹화 중 진행률(`live` 값 포함).
fn live_progress(bytes: u64, secs: f64, gaps: u32) -> chzzk_core::Progress {
    let mut p = progress(Phase::Downloading, bytes, None);
    p.live = Some(LiveProgress {
        recorded_secs: secs,
        gaps,
    });
    p
}

/// 멈춤 신호를 기다렸다가 마무리하는 녹화 대본.
fn recording(bytes: u64) -> Script {
    Script::new()
        .progress(live_progress(bytes, 20.0, 1))
        .until_stopped()
}

#[tokio::test(start_paused = true)]
async fn live_runs_in_its_own_lane() {
    // 동시 작업 1: VOD 하나가 슬롯을 다 써도 생방송은 바로 시작한다.
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("v"), Script::new().wait_cancel());
    h.fake.script_for(h.output("l"), recording(10));
    let v = h.enqueue("v").id;
    let l = h.enqueue_live("l").id;
    until("둘 다 시작", || {
        h.status(v) == JobStatus::Running && h.status(l) == JobStatus::Running
    })
    .await;
    until("둘 다 받는 중", || h.fake.active() == 2).await;

    // 반대로 생방송이 슬롯을 차지하지도 않는다: 두 번째 VOD는 줄을 선다.
    let v2 = h.enqueue("v2").id;
    until("대기", || h.status(v2) == JobStatus::Queued).await;
    h.mgr.stop_job(l).unwrap();
    until("마무리", || h.status(l) == JobStatus::Completed).await;
    assert_eq!(h.status(v2), JobStatus::Queued, "VOD 슬롯은 아직 v가 쓴다");
}

#[tokio::test(start_paused = true)]
async fn vod_is_not_blocked_by_running_live() {
    let h = Harness::new(1);
    h.fake.script_for(h.output("l"), recording(10));
    let l = h.enqueue_live("l").id;
    until("녹화 시작", || h.status(l) == JobStatus::Running).await;
    let v = h.enqueue("v").id;
    until("VOD 완료", || h.status(v) == JobStatus::Completed).await;
    assert_eq!(h.status(l), JobStatus::Running);
    h.mgr.stop_job(l).unwrap();
    until("마무리", || h.status(l) == JobStatus::Completed).await;
}

#[tokio::test(start_paused = true)]
async fn live_lane_is_capped() {
    let h = Harness::new(3);
    for i in 0..=MAX_LIVE {
        h.fake.script_for(h.output(&format!("l{i}")), recording(1));
    }
    let ids: Vec<_> = (0..=MAX_LIVE)
        .map(|i| h.enqueue_live(&format!("l{i}")).id)
        .collect();
    until("상한까지 시작", || {
        ids[..MAX_LIVE]
            .iter()
            .all(|id| h.status(*id) == JobStatus::Running)
    })
    .await;
    assert_eq!(h.status(ids[MAX_LIVE]), JobStatus::Queued);
    // 하나가 끝나면 다음이 시작한다.
    h.mgr.stop_job(ids[0]).unwrap();
    until("다음 시작", || {
        h.status(ids[MAX_LIVE]) == JobStatus::Running
    })
    .await;
}

/// `stop_job`은 취소가 아니라 마무리: `live_stop`이 취소되고 결과는 `completed`다.
#[tokio::test(start_paused = true)]
async fn stop_job_finalizes_recording() {
    let h = Harness::new(2);
    let out = h.output("l");
    h.fake.script_for(
        &out,
        recording(4096).ends(Ok(DownloadOutcome::Completed {
            path: out.clone(),
            bytes: 4096,
            resumed_from: 0,
        })),
    );
    let id = h.enqueue_live("l").id;
    until("진행", || h.job(id).progress.is_some()).await;
    // 생방송 진행률이 DTO에 실린다
    let p = h.job(id).progress.unwrap();
    assert_eq!(p.live_recorded_secs, Some(20.0));
    assert_eq!(p.live_gaps, Some(1));

    h.mgr.stop_job(id).unwrap();
    assert_eq!(h.status(id), JobStatus::Pausing);
    until("완료", || h.status(id) == JobStatus::Completed).await;
    let j = h.job(id);
    assert_eq!(j.final_bytes, Some(4096));
    assert_eq!(j.error, None);
    // 두 번 눌러도 그대로
    h.mgr.stop_job(id).unwrap();
    assert_eq!(
        h.rec.trace(id),
        [
            "added:queued",
            "status:running",
            "progress",
            "status:pausing",
            "status:completed"
        ]
    );
    // 요청에는 멈춤 토큰이 실린다
    let reqs = h.fake.download_requests();
    assert!(reqs[0].live_stop.as_ref().is_some_and(|t| t.is_cancelled()));
}

/// 일반 작업의 요청에는 멈춤 토큰이 없고, `stop_job`은 거부한다.
#[tokio::test(start_paused = true)]
async fn stop_job_rejects_non_live() {
    let h = Harness::new(2);
    h.fake
        .script_for(h.output("v"), Script::new().wait_cancel());
    let v = h.enqueue("v").id;
    until("진행", || h.status(v) == JobStatus::Running).await;
    let e = h.mgr.stop_job(v).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert_eq!(h.status(v), JobStatus::Running);
    until("download 호출", || !h.fake.download_requests().is_empty()).await;
    assert!(h.fake.download_requests()[0].live_stop.is_none());
    h.mgr.pause(v).unwrap();
}

/// 줄 서 있던 생방송을 멈추면 `paused`(받은 것이 없다).
#[tokio::test(start_paused = true)]
async fn stop_queued_live_pauses() {
    let h = Harness::new(1);
    for i in 0..=MAX_LIVE {
        h.fake.script_for(h.output(&format!("l{i}")), recording(1));
    }
    let ids: Vec<_> = (0..=MAX_LIVE)
        .map(|i| h.enqueue_live(&format!("l{i}")).id)
        .collect();
    until("상한까지 시작", || {
        h.status(ids[MAX_LIVE - 1]) == JobStatus::Running
    })
    .await;
    assert_eq!(h.status(ids[MAX_LIVE]), JobStatus::Queued);
    h.mgr.stop_job(ids[MAX_LIVE]).unwrap();
    assert_eq!(h.status(ids[MAX_LIVE]), JobStatus::Paused);
}

/// 일시정지는 생방송에서 "마무리"와 같다(`.part`를 남기는 일시정지는 이어 붙일 수 없어 없다).
#[tokio::test(start_paused = true)]
async fn pause_on_live_finalizes() {
    let h = Harness::new(2);
    h.fake.script_for(h.output("l"), recording(77));
    let id = h.enqueue_live("l").id;
    until("진행", || h.job(id).progress.is_some()).await;
    h.mgr.pause(id).unwrap();
    until("완료", || h.status(id) == JobStatus::Completed).await;
}

/// 아무것도 받지 못하고 멈추면 코어가 `NothingRecorded`를 낸다 → 실패 + 코드.
#[tokio::test(start_paused = true)]
async fn nothing_recorded_fails_with_code() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("l"),
        Script::new().until_stopped().fails(Error::NothingRecorded),
    );
    let id = h.enqueue_live("l").id;
    until("시작", || h.status(id) == JobStatus::Running).await;
    h.mgr.stop_job(id).unwrap();
    until("실패", || h.status(id) == JobStatus::Failed).await;
    assert_eq!(h.job(id).error.unwrap().code, ErrorCode::NothingRecorded);
}

/// 방송 중이 아니면 `NotLive`로 실패한다(다시 시도할 수 있다).
#[tokio::test(start_paused = true)]
async fn not_live_fails_and_can_retry() {
    let h = Harness::new(2);
    h.fake
        .script_for(h.output("l"), Script::new().fails(Error::NotLive));
    let id = h.enqueue_live("l").id;
    until("실패", || h.status(id) == JobStatus::Failed).await;
    assert_eq!(h.job(id).error.unwrap().code, ErrorCode::NotLive);
    h.fake.script_for(h.output("l"), recording(5));
    h.mgr.resume(id, false).unwrap();
    until("다시 녹화", || h.status(id) == JobStatus::Running).await;
    h.mgr.stop_job(id).unwrap();
    until("마무리", || h.status(id) == JobStatus::Completed).await;
}

/// 앱 종료(`quit`)는 VOD는 멈춰 `interrupted`로, 생방송은 마무리해 `completed`로 둔다.
#[tokio::test(start_paused = true)]
async fn quit_finalizes_live_and_interrupts_vod() {
    let h = Harness::new(2);
    h.fake
        .script_for(h.output("v"), Script::new().wait_cancel());
    h.fake.script_for(h.output("l"), recording(9));
    let v = h.enqueue("v").id;
    let l = h.enqueue_live("l").id;
    until("둘 다 시작", || {
        h.status(v) == JobStatus::Running && h.status(l) == JobStatus::Running
    })
    .await;
    h.mgr.quit(Duration::from_secs(3)).await;
    assert_eq!(h.status(v), JobStatus::Interrupted);
    assert_eq!(h.status(l), JobStatus::Completed);
}

/// 녹화 중인 작업을 지우면(취소) 받은 것도 버린다. 중지(마무리)와 다른 길이다.
#[tokio::test(start_paused = true)]
async fn remove_running_live_discards() {
    let h = Harness::new(2);
    h.fake
        .script_for(h.output("l"), recording(9).until_cancelled());
    let id = h.enqueue_live("l").id;
    until("진행", || h.job(id).progress.is_some()).await;
    // 이 대본은 stop을 기다리므로 취소 경로를 보려면 취소가 먼저 와야 한다.
    h.mgr.remove(id).await.unwrap();
    assert!(h.mgr.list().iter().all(|j| j.id != id));
}

/// 앱이 비정상 종료되어 `interrupted`로 복원된 생방송: `.part`가 없으면 자동 이어받기가 새 녹화를 시작하지 않는다
/// (며칠 전 입력한 채널이 지금 방송 중이라고 옛 제목·시각의 파일로 다른 방송을 녹화하면 안 된다).
/// `.part`가 있으면 받은 만큼을 마무리하는 것이라 자동으로 줄 세운다.
#[tokio::test(start_paused = true)]
async fn auto_resume_skips_live_without_partial() {
    use chzzk_core::download::part::{Sidecar, part_path, sidecar_path};
    use chzzk_core::fsutil::atomic_write;
    use chzzk_core::{ContentRef, PlaybackKind};

    let h = Harness::new(2);
    h.fake.script_for(h.output("none"), recording(1));
    h.fake.script_for(h.output("kept"), recording(1));
    let none = h.enqueue_live("none").id;
    let kept = h.enqueue_live("kept").id;
    until("둘 다 시작", || {
        h.status(none) == JobStatus::Running && h.status(kept) == JobStatus::Running
    })
    .await;
    // 하나는 `.part`와 sidecar가 있다(크래시 때 체크포인트까지 받았다)
    let out = h.output("kept");
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    std::fs::write(part_path(&out), vec![1u8; 100]).unwrap();
    let mut sc = Sidecar::new(
        ContentRef::Live {
            channel_id: "000000000000000000000000000000e5".into(),
        },
        "720p",
        PlaybackKind::Live,
    );
    sc.committed_len = 100;
    atomic_write(&sidecar_path(&out), &serde_json::to_vec(&sc).unwrap()).unwrap();

    // 앱이 꺼졌다 다시 열린다(`quit` 없이): running → interrupted로 복원된다
    let m = h.reopen(2);
    let list = m.list();
    assert!(list.iter().all(|j| j.status == JobStatus::Interrupted));
    assert_eq!(
        m.resume_interrupted(),
        1,
        "`.part`가 있는 하나만 자동으로 줄 선다"
    );
    let after = m.list();
    let status = |id| after.iter().find(|j| j.id == id).unwrap().status;
    assert_eq!(status(none), JobStatus::Interrupted);
    assert_ne!(status(kept), JobStatus::Interrupted);
}
