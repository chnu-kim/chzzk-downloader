//! 생방송 녹화의 매니저 동작(core.md 구현 중 변경 58): 별도 lane, `stop_job`(마무리), 일시정지·종료의 뜻.

mod common;

use std::time::Duration;

use chzzk_core::download::part::{part_path, sidecar_path};
use chzzk_core::{DownloadOutcome, Error, LiveProgress, Phase, PlaybackKind, RequestKind};
use chzzk_shell::ErrorCode;
use chzzk_shell::dto::JobStatus;
use chzzk_shell::manager::MAX_LIVE;
use common::fake::{Script, progress};
use common::harness::{Harness, live_request, request, until};

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
            live: None,
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
    until("코어 호출", || h.fake.download_requests().len() == 2).await;
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
    // 이 작업의 `.part`다(작업 고유값은 코어에 넘어간 요청에서 꺼낸다). 영상 조각도 있다(init 10바이트)
    sc.recording_id = h
        .fake
        .download_requests()
        .into_iter()
        .find(|r| r.output == out)
        .and_then(|r| r.recording_id);
    sc.hls = Some(chzzk_core::download::part::HlsState {
        init_len: 10,
        ..Default::default()
    });
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

/// 503으로 끝난 생방송(이어받을 수 있는 오류라 `.part`가 남는다).
fn http_503() -> Error {
    Error::HttpStatus {
        status: 503,
        kind: RequestKind::Media,
    }
}

fn recorded_hex(h: &Harness, i: usize) -> String {
    h.fake.download_requests()[i]
        .recording_id
        .clone()
        .expect("생방송 요청에는 recordingId가 있다")
}

#[tokio::test(start_paused = true)]
async fn enqueue_live_gets_recording_id() {
    let h = Harness::new(2);
    h.fake.script_for(h.output("l"), Script::new());
    h.fake.script_for(h.output("v"), Script::new());
    h.enqueue_live("l");
    h.enqueue("v");
    until("둘 다 호출", || h.fake.download_requests().len() == 2).await;
    let reqs = h.fake.download_requests();
    let live = reqs.iter().find(|r| r.output == h.output("l")).unwrap();
    let vod = reqs.iter().find(|r| r.output == h.output("v")).unwrap();
    let id = live.recording_id.as_deref().unwrap();
    assert_eq!(id.len(), 32);
    assert!(id.bytes().all(|b| b.is_ascii_hexdigit()), "{id}");
    assert_eq!(vod.recording_id, None);
    // VOD 레코드에는 키가 없다(옛 파일 모양 그대로)
    let v = h.jobs_json();
    let jobs = v["jobs"].as_array().unwrap();
    let rec = |name: &str| {
        jobs.iter()
            .find(|j| j["output"].as_str().unwrap().ends_with(name))
            .unwrap()
    };
    assert!(rec("v.mp4").get("recordingId").is_none());
    assert_eq!(rec("l.mp4")["recordingId"], id);
}

/// 새 작업은 늘 새 값이다(같은 방송을 다시 붙여넣어도 이전 녹화의 주인이 아니다).
#[tokio::test(start_paused = true)]
async fn each_live_job_gets_its_own_recording_id() {
    let h = Harness::new(2);
    h.fake.script_for(h.output("a"), Script::new());
    h.fake.script_for(h.output("b"), Script::new());
    h.enqueue_live("a");
    h.enqueue_live("b");
    until("둘 다 호출", || h.fake.download_requests().len() == 2).await;
    assert_ne!(recorded_hex(&h, 0), recorded_hex(&h, 1));
}

/// 실패한 녹화는 `.part`가 남은 동안 경로를 잡는다: 같은 이름으로 새로 시작할 수 없다.
#[tokio::test(start_paused = true)]
async fn failed_recording_holds_its_path() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("a"),
        Script::new().live_part(16, 32).fails(http_503()),
    );
    let id = h.enqueue_live("a").id;
    until("실패", || h.status(id) == JobStatus::Failed).await;
    assert_eq!(h.job(id).partial_bytes, Some(48));

    // 같은 이름의 생방송도, VOD도 거부된다(`.part`는 다시 받을 수 없는 녹화다)
    let e = h.mgr.enqueue(live_request("a"), &h.defaults()).unwrap_err();
    assert_eq!(e.code, ErrorCode::DuplicateOutput);
    let e = h.mgr.enqueue(request("a"), &h.defaults()).unwrap_err();
    assert_eq!(e.code, ErrorCode::DuplicateOutput);
    // 이어받기 대상 자신은 막히지 않는다
    h.fake.script_for(h.output("a"), recording(5));
    h.mgr.resume(id, false).unwrap();
    until("다시 시작", || h.status(id) == JobStatus::Running).await;
    h.mgr.stop_job(id).unwrap();
}

/// 끝난 녹화는 `check_output`의 중복이 아니다(`partial.recording`으로 알린다).
#[tokio::test(start_paused = true)]
async fn failed_recording_is_not_a_duplicate_in_check_output() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("a"),
        Script::new().live_part(16, 32).fails(http_503()),
    );
    let id = h.enqueue_live("a").id;
    until("실패", || h.status(id) == JobStatus::Failed).await;
    let live = chzzk_core::ContentRef::Live {
        channel_id: "000000000000000000000000000000e5".into(),
    };
    let c = h
        .mgr
        .check_output(
            None,
            &h.downloads(),
            "a",
            &live,
            "720p",
            PlaybackKind::Live,
            None,
        )
        .unwrap();
    assert_eq!(c.duplicate_job_id, None);
    assert!(c.partial.is_some_and(|p| p.recording));
    assert!(c.free_file_name.is_some());
}

fn sidecar_exists(h: &Harness, name: &str) -> (bool, bool) {
    let out = h.output(name);
    (part_path(&out).exists(), sidecar_path(&out).exists())
}

/// M1: 같은 경로를 쓰던 VOD 작업을 지워도 남의 녹화 `.part`는 남는다.
#[tokio::test(start_paused = true)]
async fn remove_vod_keeps_recording_part() {
    let h = Harness::new(2);
    h.fake
        .script_for(h.output("a"), Script::new().fails(http_503()));
    let v = h.enqueue("a").id;
    until("VOD 실패", || h.status(v) == JobStatus::Failed).await;
    h.fake.script_for(
        h.output("a"),
        Script::new().live_part(16, 32).fails(http_503()),
    );
    let l = h.enqueue_live("a").id;
    until("녹화 실패", || h.status(l) == JobStatus::Failed).await;

    h.mgr.remove(v).await.unwrap();
    assert!(h.mgr.list().iter().all(|j| j.id != v));
    assert_eq!(sidecar_exists(&h, "a"), (true, true));
    assert_eq!(h.status(l), JobStatus::Failed);
}

/// 소유 판정만 따로: 작업 레코드 없는 남의 녹화도 지우지 않는다.
#[tokio::test(start_paused = true)]
async fn remove_vod_keeps_orphan_recording_part() {
    let h = Harness::new(2);
    h.fake
        .script_for(h.output("a"), Script::new().fails(http_503()));
    let v = h.enqueue("a").id;
    until("VOD 실패", || h.status(v) == JobStatus::Failed).await;
    write_foreign_recording(&h, "a", "x");

    h.mgr.remove(v).await.unwrap();
    assert!(h.mgr.list().iter().all(|j| j.id != v));
    assert_eq!(sidecar_exists(&h, "a"), (true, true));
}

/// 레코드가 없는 남의 생방송 녹화(`recording_id`가 이 앱의 어떤 작업과도 다르다)를 디스크에 만든다.
fn write_foreign_recording(h: &Harness, name: &str, id: &str) {
    use chzzk_core::download::part::{HlsState, Sidecar};
    use chzzk_core::fsutil::atomic_write;
    let out = h.output(name);
    std::fs::create_dir_all(out.parent().unwrap()).unwrap();
    std::fs::write(part_path(&out), vec![0u8; 48]).unwrap();
    let mut sc = Sidecar::new(
        chzzk_core::ContentRef::Live {
            channel_id: "000000000000000000000000000000e5".into(),
        },
        "720p",
        PlaybackKind::Live,
    );
    sc.recording_id = Some(id.into());
    sc.committed_len = 48;
    sc.hls = Some(HlsState {
        init_len: 16,
        ..Default::default()
    });
    atomic_write(&sidecar_path(&out), &serde_json::to_vec(&sc).unwrap()).unwrap();
}

/// 카드의 "처음부터" 경로(`restart`): 새 작업은 남의 녹화를 지우지 않는다.
#[tokio::test(start_paused = true)]
async fn restart_new_job_keeps_other_recording() {
    let h = Harness::new(2);
    write_foreign_recording(&h, "a", "x");
    let req = chzzk_shell::dto::EnqueueRequest {
        restart: true,
        ..live_request("a")
    };
    let id = h.mgr.enqueue(req, &h.defaults()).unwrap().id;
    until("호출", || !h.fake.download_requests().is_empty()).await;
    until("끝", || h.status(id) != JobStatus::Running).await;
    assert_eq!(sidecar_exists(&h, "a"), (true, true));
}

/// 회귀: 자기 실패 녹화를 지우면 `.part`도 지운다.
#[tokio::test(start_paused = true)]
async fn remove_own_failed_recording_discards() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("a"),
        Script::new().live_part(16, 32).fails(http_503()),
    );
    let id = h.enqueue_live("a").id;
    until("실패", || h.status(id) == JobStatus::Failed).await;
    assert_eq!(sidecar_exists(&h, "a"), (true, true));
    h.mgr.remove(id).await.unwrap();
    assert_eq!(sidecar_exists(&h, "a"), (false, false));
}

/// 앱이 꺼졌다 다시 열린 뒤 자동 이어받기가 몇 개를 줄 세우는지 본다(`out` 하나짜리 생방송).
async fn reopened_auto_resume(
    script: Script,
    after_start: impl FnOnce(&Harness),
) -> (usize, JobStatus) {
    let h = Harness::new(2);
    h.fake.script_for(h.output("a"), script.until_stopped());
    let id = h.enqueue_live("a").id;
    until("시작", || h.status(id) == JobStatus::Running).await;
    until("코어 호출", || !h.fake.download_requests().is_empty()).await;
    after_start(&h);
    // 앱이 꺼졌다 다시 열린다(`quit` 없이): running → interrupted
    let m = h.reopen(2);
    assert_eq!(m.list()[0].status, JobStatus::Interrupted);
    let n = m.resume_interrupted();
    (n, m.list()[0].status)
}

/// M3: init만 든 `.part`는 코어가 지우고 지금 방송을 새로 녹화한다. 자동으로 줄 세우지 않는다.
#[tokio::test(start_paused = true)]
async fn auto_resume_skips_init_only_live_part() {
    let (n, status) = reopened_auto_resume(Script::new().live_part(16, 0), |_| {}).await;
    assert_eq!(n, 0);
    assert_eq!(status, JobStatus::Interrupted);
}

/// 특성화: sidecar가 없는 `.part`도 줄 세우지 않는다.
#[tokio::test(start_paused = true)]
async fn auto_resume_skips_live_without_sidecar() {
    let (n, status) = reopened_auto_resume(Script::new().live_part(16, 32), |h| {
        std::fs::remove_file(sidecar_path(&h.output("a"))).unwrap();
    })
    .await;
    assert_eq!(n, 0);
    assert_eq!(status, JobStatus::Interrupted);
}

/// 회귀: 영상 조각이 있으면 받은 만큼 마무리하려고 줄 세운다.
#[tokio::test(start_paused = true)]
async fn auto_resume_requeues_live_with_media() {
    let (n, status) = reopened_auto_resume(Script::new().live_part(16, 32), |_| {}).await;
    assert_eq!(n, 1);
    assert_ne!(status, JobStatus::Interrupted);
}

/// M3와 같은 규칙: init만 든 녹화 `.part`는 받은 것이 없다. 이어받을 바이트로 보이지 않고 경로도 잡지 않는다
/// (다음 실행은 init을 버리고 지금 방송을 새로 녹화한다).
#[tokio::test(start_paused = true)]
async fn failed_init_only_recording_keeps_nothing() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("a"),
        Script::new().live_part(16, 0).fails(http_503()),
    );
    let id = h.enqueue_live("a").id;
    until("실패", || h.status(id) == JobStatus::Failed).await;
    assert_eq!(sidecar_exists(&h, "a"), (true, true));
    assert_eq!(h.job(id).partial_bytes, None);
    // 같은 이름으로 받을 수 있다(이 작업이 경로를 잡지 않는다)
    h.fake.script_for(h.output("a"), Script::new());
    h.mgr.enqueue(request("a"), &h.defaults()).unwrap();
}

/// 받다 만 녹화는 셸에서도 "처음부터"(`restart`)로 지우지 않는다(D8, 화면 밖 IPC 방어).
#[tokio::test(start_paused = true)]
async fn restart_is_rejected_for_kept_recording() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("a"),
        Script::new().live_part(16, 32).fails(http_503()),
    );
    let id = h.enqueue_live("a").id;
    until("실패", || h.status(id) == JobStatus::Failed).await;
    let e = h.mgr.resume(id, true).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert_eq!(h.status(id), JobStatus::Failed);
    assert_eq!(sidecar_exists(&h, "a"), (true, true));
    // 받은 부분 저장(이어받기)은 그대로 된다
    h.fake.script_for(h.output("a"), recording(5));
    h.mgr.resume(id, false).unwrap();
    until("다시 시작", || h.status(id) == JobStatus::Running).await;
    h.mgr.stop_job(id).unwrap();
}

/// init만 든 녹화는 받은 것이 없으니 "처음부터"를 막지 않는다.
#[tokio::test(start_paused = true)]
async fn restart_is_allowed_for_init_only_recording() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("a"),
        Script::new().live_part(16, 0).fails(http_503()),
    );
    let id = h.enqueue_live("a").id;
    until("실패", || h.status(id) == JobStatus::Failed).await;
    h.fake.script_for(h.output("a"), recording(5));
    h.mgr.resume(id, true).unwrap();
    until("다시 시작", || h.status(id) == JobStatus::Running).await;
    h.mgr.stop_job(id).unwrap();
}

/// M1(Codex r3): 남의 녹화 때문에 보호 오류(`PartialRecording`)로 끝난 VOD 작업은 그 `.part`를 자기 것으로
/// 세지 않고 경로도 잡지 않는다. 지워도 녹화는 남는다(`discard_partial`의 소유 판정).
#[tokio::test(start_paused = true)]
async fn vod_failed_on_foreign_recording_keeps_it_on_remove() {
    let h = Harness::new(2);
    write_foreign_recording(&h, "a", "x");
    h.fake.script_for(
        h.output("a"),
        Script::new().fails(Error::PartialRecording {
            path: part_path(&h.output("a")),
        }),
    );
    let v = h.enqueue("a").id;
    until("VOD 실패", || h.status(v) == JobStatus::Failed).await;
    assert_eq!(h.job(v).partial_bytes, None);
    // 이 작업 때문에 같은 이름이 duplicateOutput으로 막히지 않는다
    h.fake
        .script_for(h.output("a"), Script::new().fails(http_503()));
    let other = h.mgr.enqueue(request("a"), &h.defaults()).unwrap().id;
    until("다른 작업 끝", || h.status(other) == JobStatus::Failed).await;

    h.mgr.remove(v).await.unwrap();
    assert!(h.mgr.list().iter().all(|j| j.id != v));
    assert_eq!(sidecar_exists(&h, "a"), (true, true));
}
