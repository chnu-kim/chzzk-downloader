//! 매니저 제어(app.md §6.1·§6.3, §15-8): pause/resume/remove/quit/restart, `partial_bytes`, 자동 이어받기.

mod common;

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chzzk_core::download::part::{Sidecar, part_path, sidecar_path};
use chzzk_core::fsutil::atomic_write;
use chzzk_core::{ContentRef, DownloadOutcome, DuplicatePolicy, Error, PlaybackKind};
use chzzk_shell::dto::JobStatus;
use chzzk_shell::manager::QUIT_TIMEOUT;
use chzzk_shell::{ErrorCode, ErrorPayload, JobId};
use common::fake::Script;
use common::harness::{Harness, open_with, request, settle, until};
use tokio::sync::Notify;

/// 코어가 체크포인트에 쓰는 것처럼 `.part`(길이 `len`)와 같은 작업의 sidecar(`committed`)를 만든다.
fn checkpoint(output: &Path, len: usize, committed: u64) {
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(part_path(output), vec![1u8; len]).unwrap();
    let mut sc = Sidecar::new(
        ContentRef::Video { video_no: 1 },
        "720p",
        PlaybackKind::LiveRewindHls,
    );
    sc.committed_len = committed;
    atomic_write(&sidecar_path(output), &serde_json::to_vec(&sc).unwrap()).unwrap();
}

fn has_partial(output: &Path) -> bool {
    part_path(output).exists() || sidecar_path(output).exists()
}

#[tokio::test(start_paused = true)]
async fn pause_running_then_resume() {
    let h = Harness::new(2);
    let out = h.output("a");
    // 취소되면 체크포인트를 쓰고 Cancelled로 끝난다(코어 모양)
    h.fake.script_for(
        &out,
        Script::new()
            .bytes(100, Some(1000))
            .until_cancelled()
            .linger(Duration::from_millis(20))
            .fails(Error::Cancelled),
    );
    let id = h.enqueue("a").id;
    until("진행", || h.job(id).progress.is_some()).await;
    checkpoint(&out, 150, 128);

    h.mgr.pause(id).unwrap();
    assert_eq!(h.status(id), JobStatus::Pausing);
    assert_eq!(h.mgr.running_count(), 1, "멈추는 중도 슬롯을 차지한다");
    until("paused", || h.status(id) == JobStatus::Paused).await;
    let j = h.job(id);
    assert_eq!(j.partial_bytes, Some(128), "sidecar committed_len");
    assert_eq!(j.progress.unwrap().bytes, 100, "마지막 진행률을 남긴다");
    assert_eq!(j.error, None);
    assert_eq!(h.jobs_json()["jobs"][0]["status"], "paused");
    // 두 번 눌러도 그대로
    h.mgr.pause(id).unwrap();

    // 이어받기: 같은 요청으로 다시 download
    h.fake
        .script_for(&out, Script::new().bytes(1000, Some(1000)));
    h.mgr.resume(id, false).unwrap();
    until("완료", || h.status(id) == JobStatus::Completed).await;
    assert_eq!(
        h.rec.trace(id),
        [
            "added:queued",
            "status:running",
            "progress",
            "status:pausing",
            "status:paused",
            "status:queued",
            "status:running",
            "progress",
            "status:completed"
        ]
    );
    assert!(
        part_path(&out).exists(),
        "이어받기는 .part를 지우지 않는다(가짜는 지우지 않음)"
    );
    let reqs = h.fake.download_requests();
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[1].output, out);
}

#[tokio::test(start_paused = true)]
async fn pause_queued_goes_straight_to_paused() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    h.enqueue("a");
    let b = h.enqueue("b").id;
    h.mgr.pause(b).unwrap();
    settle().await;
    assert_eq!(h.status(b), JobStatus::Paused);
    assert!(!h.fake.download_calls().contains(&h.output("b")));
}

/// `stop` 없이 `Cancelled`가 오면 `failed{internal}`. `Cancelled` 코드는 프런트로 가지 않는다.
#[tokio::test(start_paused = true)]
async fn unexpected_cancel_is_internal_failure() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().fails(Error::Cancelled));
    let id = h.enqueue("a").id;
    until("끝", || h.status(id) == JobStatus::Failed).await;
    assert_eq!(h.job(id).error.unwrap().code, ErrorCode::Internal);
}

/// 일시정지 중에 진짜 오류로 끝나면 오류가 이긴다.
#[tokio::test(start_paused = true)]
async fn error_during_pausing_is_failed() {
    let h = Harness::new(1);
    h.fake.script_for(
        h.output("a"),
        Script::new()
            .bytes(1, None)
            .until_cancelled()
            .fails(Error::DiskFull {
                path: h.output("a"),
            }),
    );
    let id = h.enqueue("a").id;
    until("진행", || h.job(id).progress.is_some()).await;
    h.mgr.pause(id).unwrap();
    until("끝", || h.status(id) == JobStatus::Failed).await;
    let e = h.job(id).error.unwrap();
    assert_eq!(e.code, ErrorCode::DiskFull);
    assert!(matches!(e.payload, Some(ErrorPayload::Path { .. })));
}

/// resolve 실패도 `.part`를 남기므로(코어 구현 중 변경 35) `partial_bytes`가 실제 파일로 채워진다.
#[tokio::test(start_paused = true)]
async fn failed_job_reports_real_partial() {
    let h = Harness::new(1);
    let out = h.output("a");
    checkpoint(&out, 4096, 4000);
    h.fake.script_for(
        &out,
        Script::new().fails(Error::AuthRequired { status: 403 }),
    );
    let id = h.enqueue("a").id;
    until("끝", || h.status(id) == JobStatus::Failed).await;
    let j = h.job(id);
    assert_eq!(j.partial_bytes, Some(4000));
    assert!(
        !j.error.unwrap().resumable,
        "resumable과 .part 유무는 다르다"
    );
}

/// 처음부터: `download()` 전에 `.part`를 지우고, 지운 뒤 `discardOnStart`를 내린다.
#[tokio::test(start_paused = true)]
async fn restart_discards_before_download() {
    let h = Harness::new(1);
    let out = h.output("a");
    checkpoint(&out, 10, 10);
    let gate = Arc::new(Notify::new());
    h.fake.script_for(&out, Script::new().hold(gate.clone()));
    let mut r = request("a");
    r.restart = true;
    let id = h.mgr.enqueue(r, &h.defaults()).unwrap().id;
    until("시작", || h.fake.active() == 1).await;
    assert!(!has_partial(&out), "download 전에 지웠다");
    assert_eq!(h.jobs_json()["jobs"][0]["discardOnStart"], false);
    gate.notify_one();
    until("완료", || h.status(id) == JobStatus::Completed).await;
}

/// 처음부터로 줄 선 작업이 시작 전에 앱이 꺼져도 "처음부터"를 잊지 않는다.
#[tokio::test(start_paused = true)]
async fn restart_flag_survives_restart_of_app() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    h.enqueue("a");
    let mut r = request("b");
    r.restart = true;
    let b = h.mgr.enqueue(r, &h.defaults()).unwrap().id;
    assert_eq!(h.jobs_json()["jobs"][1]["discardOnStart"], true);

    let out = h.output("b");
    checkpoint(&out, 10, 10);
    let m2 = h.reopen(1);
    m2.resume(b, false).unwrap();
    until("b 끝", || {
        m2.list()
            .iter()
            .any(|j| j.id == b && j.status == JobStatus::Completed)
    })
    .await;
    assert!(!has_partial(&out));
}

#[tokio::test(start_paused = true)]
async fn resume_with_restart_discards() {
    let h = Harness::new(1);
    let out = h.output("a");
    h.fake.script_for(
        &out,
        Script::new().fails(Error::Network(
            reqwest::Client::builder()
                .user_agent("\n")
                .build()
                .unwrap_err(),
        )),
    );
    let id = h.enqueue("a").id;
    until("실패", || h.status(id) == JobStatus::Failed).await;
    checkpoint(&out, 10, 10);
    assert_eq!(
        h.job(id).partial_bytes,
        None,
        "실패 시점에는 .part가 없었다"
    );
    h.mgr.resume(id, true).unwrap();
    until("완료", || h.status(id) == JobStatus::Completed).await;
    assert!(!has_partial(&out));
    assert_eq!(h.job(id).error, None);
}

/// 건너뛴 작업을 이어받으면 `overwrite`로 다시 받는다.
#[tokio::test(start_paused = true)]
async fn resume_skipped_overwrites() {
    let h = Harness::new(1);
    let out = h.output("a");
    let mut r = request("a");
    r.on_existing = chzzk_shell::dto::OnExisting::Skip;
    h.fake.script_for(
        &out,
        Script::new().ends(Ok(DownloadOutcome::Skipped { path: out.clone() })),
    );
    let id = h.mgr.enqueue(r, &h.defaults()).unwrap().id;
    until("건너뜀", || h.status(id) == JobStatus::Skipped).await;
    h.mgr.resume(id, false).unwrap();
    until("완료", || h.status(id) == JobStatus::Completed).await;
    let reqs = h.fake.download_requests();
    assert_eq!(reqs[0].on_existing, DuplicatePolicy::Skip);
    assert_eq!(reqs[1].on_existing, DuplicatePolicy::Overwrite);
    assert_eq!(h.jobs_json()["jobs"][0]["onExisting"], "overwrite");
}

/// 끝난 작업의 경로를 새 작업이 가져간 뒤 옛 작업을 다시 시작하면 `duplicateOutput`.
#[tokio::test(start_paused = true)]
async fn resume_checks_duplicate_output() {
    let h = Harness::new(1);
    h.fake.script_for(
        h.output("a"),
        Script::new().fails(Error::AuthRequired { status: 401 }),
    );
    let old = h.enqueue("a").id;
    until("실패", || h.status(old) == JobStatus::Failed).await;
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let new = h.enqueue("a").id;
    let e = h.mgr.resume(old, false).unwrap_err();
    assert_eq!(
        e.payload,
        Some(ErrorPayload::DuplicateOutput { job_id: new })
    );
    assert_eq!(h.status(old), JobStatus::Failed);
}

#[tokio::test(start_paused = true)]
async fn resume_edge_states() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("r"), Script::new().wait_cancel());
    let done = h.enqueue("d").id;
    until("완료", || h.status(done) == JobStatus::Completed).await;
    let run = h.enqueue("r").id;
    let q = h.enqueue("q").id;
    settle().await;
    assert_eq!(
        h.mgr.resume(done, false).unwrap_err().code,
        ErrorCode::InvalidInput
    );
    h.mgr.resume(run, true).unwrap();
    h.mgr.resume(q, false).unwrap();
    assert_eq!(h.status(run), JobStatus::Running);
    assert_eq!(h.status(q), JobStatus::Queued);
    let missing = JobId(999);
    for e in [
        h.mgr.resume(missing, false).unwrap_err(),
        h.mgr.pause(missing).unwrap_err(),
        h.mgr.remove(missing).await.unwrap_err(),
    ] {
        assert_eq!(e.code, ErrorCode::JobNotFound);
    }
}

/// 다시 시작한 작업은 줄 맨 뒤에 선다(FIFO는 id가 아니라 줄 선 순서).
#[tokio::test(start_paused = true)]
async fn resumed_job_goes_to_back_of_queue() {
    let h = Harness::new(1);
    let gate = Arc::new(Notify::new());
    h.fake
        .script_for(h.output("x"), Script::new().hold(gate.clone()));
    h.enqueue("x");
    let a = h.enqueue("a").id;
    let b = h.enqueue("b").id;
    h.mgr.pause(a).unwrap();
    h.mgr.resume(a, false).unwrap();
    gate.notify_one();
    until("모두 완료", || {
        [a, b].iter().all(|&i| h.status(i) == JobStatus::Completed)
    })
    .await;
    assert_eq!(
        h.fake.download_calls(),
        [h.output("x"), h.output("b"), h.output("a")]
    );
}

/// 받는 중인 작업을 지우면: 취소 → 태스크 종료 대기 → `.part` 삭제 → `Removed`.
/// 가짜는 취소 뒤 잠시 머물다 `.part`를 쓴다(코어의 체크포인트). 기다리지 않고 지웠다면 `.part`가 남는다.
#[tokio::test(start_paused = true)]
async fn remove_running_waits_then_discards() {
    let h = Harness::new(1);
    let out = h.output("a");
    std::fs::create_dir_all(h.downloads()).unwrap();
    h.fake.script_for(
        &out,
        Script::new()
            .bytes(5, None)
            .until_cancelled()
            .linger(Duration::from_millis(50))
            .write(part_path(&out), b"late checkpoint".to_vec())
            .write(sidecar_path(&out), b"{}".to_vec())
            .fails(Error::Cancelled),
    );
    let id = h.enqueue("a").id;
    let b = h.enqueue("b").id;
    until("진행", || h.job(id).progress.is_some()).await;
    h.mgr.remove(id).await.unwrap();
    assert_eq!(h.fake.active(), 0, "태스크가 끝난 뒤에 돌아온다");
    assert!(!has_partial(&out), "태스크가 쓴 체크포인트까지 지웠다");
    assert!(h.mgr.list().iter().all(|j| j.id != id));
    assert_eq!(
        h.rec.trace(id),
        [
            "added:queued",
            "status:running",
            "progress",
            "status:pausing",
            "removed"
        ]
    );
    until("다음 작업 완료", || {
        h.status(b) == JobStatus::Completed
    })
    .await;
    assert!(
        h.jobs_json()["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .all(|j| j["id"] != id.0)
    );
}

/// 지우는 중에 다시 누른 취소·일시정지·이어받기는 조용히 넘긴다(`jobNotFound` 토스트를 띄우지 않는다).
#[tokio::test(start_paused = true)]
async fn controls_during_remove_are_no_ops() {
    let h = Harness::new(1);
    h.fake.script_for(
        h.output("a"),
        Script::new()
            .until_cancelled()
            .linger(Duration::from_millis(50))
            .fails(Error::Cancelled),
    );
    let id = h.enqueue("a").id;
    settle().await;
    let mgr = h.mgr.clone();
    let first = tokio::spawn(async move { mgr.remove(id).await });
    until("지우는 중", || h.status(id) == JobStatus::Pausing).await;
    h.mgr.remove(id).await.unwrap();
    h.mgr.pause(id).unwrap();
    h.mgr.resume(id, false).unwrap();
    first.await.unwrap().unwrap();
    assert!(h.mgr.list().is_empty());
    assert_eq!(
        h.rec.trace(id).iter().filter(|t| *t == "removed").count(),
        1
    );
}

#[tokio::test(start_paused = true)]
async fn remove_stopped_discards_partial() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("run"), Script::new().wait_cancel());
    h.enqueue("run");
    // queued(다시 줄 선 작업은 .part가 있을 수 있다), paused, failed, interrupted
    let names = ["q", "p", "f"];
    let ids: Vec<_> = names.iter().map(|n| h.enqueue(n).id).collect();
    h.mgr.pause(ids[1]).unwrap();
    for n in names {
        checkpoint(&h.output(n), 10, 10);
    }
    for (n, id) in names.iter().zip(&ids) {
        h.mgr.remove(*id).await.unwrap();
        assert!(!has_partial(&h.output(n)), "{n}");
        assert_eq!(h.rec.trace(*id).last().unwrap(), "removed");
    }
    settle().await;
    assert_eq!(
        h.fake.download_calls(),
        [h.output("run")],
        "지운 대기 작업은 시작하지 않는다"
    );
}

#[tokio::test(start_paused = true)]
async fn remove_interrupted_after_reopen() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let id = h.enqueue("a").id;
    settle().await;
    checkpoint(&h.output("a"), 10, 10);
    let m2 = h.reopen(1);
    assert_eq!(m2.list()[0].status, JobStatus::Interrupted);
    assert_eq!(m2.list()[0].partial_bytes, Some(10));
    m2.remove(id).await.unwrap();
    assert!(m2.list().is_empty());
    assert!(!has_partial(&h.output("a")));
}

/// 완료 항목은 레코드만 지우고 파일은 둔다. `clear_finished`도 같다.
#[tokio::test(start_paused = true)]
async fn remove_and_clear_finished_keep_files() {
    let h = Harness::new(2);
    std::fs::create_dir_all(h.downloads()).unwrap();
    let a = h.enqueue("a").id;
    let b = h.enqueue("b").id;
    h.fake
        .script_for(h.output("c"), Script::new().wait_cancel());
    let c = h.enqueue("c").id;
    until("완료", || {
        [a, b].iter().all(|&i| h.status(i) == JobStatus::Completed)
    })
    .await;
    std::fs::write(h.output("a"), b"done").unwrap();
    h.mgr.remove(a).await.unwrap();
    assert!(h.output("a").exists());
    h.mgr.clear_finished();
    let left: Vec<_> = h.mgr.list().iter().map(|j| j.id).collect();
    assert_eq!(left, [c]);
    assert_eq!(h.rec.trace(b).last().unwrap(), "removed");
}

/// `.part`를 지우지 못하면 오류를 돌려주고 레코드를 멈춘 상태로 남긴다. 다시 지우면 된다.
#[tokio::test(start_paused = true)]
async fn remove_reports_locked_partial_and_keeps_record() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("p"), Script::new().wait_cancel());
    let id = h.enqueue("p").id;
    settle().await;
    h.mgr.pause(id).unwrap();
    until("paused", || h.status(id) == JobStatus::Paused).await;
    checkpoint(&h.output("p"), 10, 10);

    let locker = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(part_path(&h.output("p")))
        .unwrap();
    locker.lock().unwrap();
    let e = h.mgr.remove(id).await.unwrap_err();
    assert_eq!(e.code, ErrorCode::FileLocked);
    let j = h.job(id);
    assert_eq!(j.status, JobStatus::Paused);
    assert_eq!(j.partial_bytes, Some(10));
    // 다시 시작할 수도 있다(지우는 중 표시가 풀렸다)
    drop(locker);
    h.mgr.remove(id).await.unwrap();
    assert!(!has_partial(&h.output("p")));
}

/// 실패한 작업의 경로를 새 작업이 가져갔으면, 옛 작업을 지워도 새 작업의 `.part`·sidecar는 남는다.
#[tokio::test(start_paused = true)]
async fn remove_failed_keeps_partial_of_new_owner() {
    let h = Harness::new(1);
    h.fake.script_for(
        h.output("a"),
        Script::new().fails(Error::AuthRequired { status: 401 }),
    );
    let old = h.enqueue("a").id;
    until("실패", || h.status(old) == JobStatus::Failed).await;
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let new = h.enqueue("a").id;
    settle().await;
    checkpoint(&h.output("a"), 10, 10);
    h.mgr.pause(new).unwrap();
    until("새 작업 멈춤", || h.status(new) == JobStatus::Paused).await;
    assert_eq!(h.job(new).partial_bytes, Some(10));

    h.mgr.remove(old).await.unwrap();
    assert_eq!(h.rec.trace(old).last().unwrap(), "removed");
    assert!(part_path(&h.output("a")).exists());
    assert!(sidecar_path(&h.output("a")).exists());
    assert_eq!(h.job(new).partial_bytes, Some(10));
    let ids: Vec<_> = h.mgr.list().iter().map(|j| j.id).collect();
    assert_eq!(ids, [new]);
}

/// 종료 대기 중에 온 `remove`는 아무것도 하지 않는다(`quit`이 태스크 핸들을 가져가 기다릴 수 없다).
/// 작업은 `quit`대로 `interrupted`가 되고 `.part`는 남는다.
#[tokio::test(start_paused = true)]
async fn remove_during_quit_is_ignored() {
    let h = Harness::new(1);
    h.fake.script_for(
        h.output("a"),
        Script::new()
            .until_cancelled()
            .linger(Duration::from_secs(1))
            .fails(Error::Cancelled),
    );
    let id = h.enqueue("a").id;
    settle().await;
    checkpoint(&h.output("a"), 10, 10);
    let m = h.mgr.clone();
    let quit = tokio::spawn(async move { m.quit(QUIT_TIMEOUT).await });
    settle().await;
    assert_eq!(h.status(id), JobStatus::Pausing);

    h.mgr.remove(id).await.unwrap();
    quit.await.unwrap();
    let j = h.job(id);
    assert_eq!(j.status, JobStatus::Interrupted);
    assert_eq!(j.error, None);
    assert_eq!(j.partial_bytes, Some(10));
    assert!(has_partial(&h.output("a")));
    assert!(!h.rec.trace(id).contains(&"removed".to_owned()));
}

/// 종료: 받는 중 → `interrupted`, 사용자가 멈춘 것 → `paused`, 대기 중은 그대로(다음 시작 때 reconcile).
/// 새 작업은 시작하지 않는다.
#[tokio::test(start_paused = true)]
async fn quit_stops_running_jobs() {
    let h = Harness::new(2);
    for n in ["a", "b"] {
        h.fake.script_for(
            h.output(n),
            Script::new()
                .bytes(1, None)
                .until_cancelled()
                .linger(Duration::from_millis(100))
                .fails(Error::Cancelled),
        );
    }
    let a = h.enqueue("a").id;
    let b = h.enqueue("b").id;
    let q = h.enqueue("q").id;
    until("둘 진행", || {
        [a, b].iter().all(|&i| h.job(i).progress.is_some())
    })
    .await;
    h.mgr.pause(b).unwrap();
    let t0 = tokio::time::Instant::now();
    h.mgr.quit(QUIT_TIMEOUT).await;
    assert!(t0.elapsed() < QUIT_TIMEOUT, "다 멈추면 바로 돌아온다");
    assert_eq!(h.status(a), JobStatus::Interrupted);
    assert_eq!(h.status(b), JobStatus::Paused);
    assert_eq!(h.status(q), JobStatus::Queued);
    settle().await;
    assert_eq!(
        h.status(q),
        JobStatus::Queued,
        "종료 뒤에는 시작하지 않는다"
    );
    assert_eq!(h.fake.active(), 0);
    let v = h.jobs_json();
    let st: Vec<_> = v["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|j| j["status"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(st, ["interrupted", "paused", "queued"]);
    assert_eq!(
        h.rec.trace(a)[3..],
        [
            "status:pausing".to_string(),
            "status:interrupted".to_string()
        ]
    );
}

/// 시간 안에 멈추지 않는 작업이 있어도 `timeout` 뒤에 돌아오고 `interrupted`로 저장한다.
#[tokio::test(start_paused = true)]
async fn quit_gives_up_after_timeout() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("slow"),
        Script::new()
            .until_cancelled()
            .linger(Duration::from_secs(60))
            .fails(Error::Cancelled),
    );
    h.fake
        .script_for(h.output("fast"), Script::new().wait_cancel());
    let slow = h.enqueue("slow").id;
    let fast = h.enqueue("fast").id;
    settle().await;
    let t0 = tokio::time::Instant::now();
    h.mgr.quit(QUIT_TIMEOUT).await;
    let took = t0.elapsed();
    assert!(
        took >= QUIT_TIMEOUT && took < QUIT_TIMEOUT + Duration::from_millis(100),
        "{took:?}"
    );
    assert_eq!(h.status(slow), JobStatus::Interrupted);
    assert_eq!(h.status(fast), JobStatus::Interrupted);
    assert_eq!(h.jobs_json()["jobs"][0]["status"], "interrupted");
}

/// 자동 이어받기 설정: 켜져 있으면 열자마자 `interrupted`를 줄 세운다(사용자가 멈춘 `paused`는 아니다).
#[tokio::test(start_paused = true)]
async fn auto_resume_on_open() {
    let h = Harness::new(3);
    for n in ["a", "b"] {
        h.fake.script_for(h.output(n), Script::new().wait_cancel());
    }
    let a = h.enqueue("a").id;
    let b = h.enqueue("b").id;
    let q = {
        h.fake
            .script_for(h.output("c"), Script::new().wait_cancel());
        h.enqueue("c").id
    };
    settle().await;
    h.mgr.pause(b).unwrap();
    until("b 멈춤", || h.status(b) == JobStatus::Paused).await;
    h.mgr.set_max_parallel(1);
    h.mgr.quit(QUIT_TIMEOUT).await; // a, c → interrupted

    // 꺼져 있으면 그대로
    let off = h.reopen(1);
    assert_eq!(off.running_count(), 0);

    let calls = h.fake.download_calls().len();
    for n in ["a", "c"] {
        h.fake.script_for(h.output(n), Script::new().wait_cancel());
    }
    let on = open_with(h.dir.path(), &h.fake, 1, true);
    settle().await;
    let st: Vec<_> = on.list().iter().map(|j| (j.id, j.status)).collect();
    assert_eq!(
        st,
        [
            (a, JobStatus::Running),
            (b, JobStatus::Paused),
            (q, JobStatus::Queued)
        ]
    );
    assert_eq!(h.fake.download_calls().len(), calls + 1);
}

#[tokio::test(start_paused = true)]
async fn resume_interrupted_counts() {
    let h = Harness::new(1);
    for n in ["a", "b"] {
        h.fake.script_for(h.output(n), Script::new().wait_cancel());
        h.enqueue(n);
    }
    settle().await;
    let m2 = h.reopen(1);
    assert_eq!(m2.resume_interrupted(), 2);
    assert_eq!(m2.resume_interrupted(), 0);
    assert_eq!(m2.running_count(), 1);
}

#[tokio::test(start_paused = true)]
async fn output_of_returns_path_and_status() {
    let h = Harness::new(1);
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    let (p, st) = h.mgr.output_of(id).unwrap();
    assert_eq!(p, h.output("a"));
    assert_eq!(st, JobStatus::Completed);
    assert_eq!(
        h.mgr.output_of(JobId(42)).unwrap_err().code,
        ErrorCode::JobNotFound
    );
}
