//! 매니저 큐(app.md §6.1·§6.2, §15-7): 동시 작업 수, FIFO, 이벤트 순서, sink, 구독 스냅샷, 중복 경로, 저장.

mod common;

use std::sync::Arc;
use std::time::Duration;

use chzzk_core::{DownloadOutcome, Error, Phase};
use chzzk_shell::dto::{JobEvent, JobStatus};
use chzzk_shell::manager::MAX_FINISHED;
use chzzk_shell::{ErrorCode, ErrorPayload, JobDefaults, Stage};
use common::fake::{Script, progress};
use common::harness::{Harness, Recorder, request, settle, until};
use tokio::sync::Notify;

#[tokio::test(start_paused = true)]
async fn parallel_limit_and_fifo() {
    let h = Harness::new(2);
    let gates: Vec<Arc<Notify>> = (0..4).map(|_| Arc::new(Notify::new())).collect();
    let names = ["a", "b", "c", "d"];
    for (n, g) in names.iter().zip(&gates) {
        h.fake
            .script_for(h.output(n), Script::new().bytes(1, None).hold(g.clone()));
    }
    let ids: Vec<_> = names.iter().map(|n| h.enqueue(n).id).collect();
    until("두 작업 시작", || h.fake.active() == 2).await;
    settle().await;
    let st: Vec<_> = ids.iter().map(|&i| h.status(i)).collect();
    assert_eq!(
        st,
        [
            JobStatus::Running,
            JobStatus::Running,
            JobStatus::Queued,
            JobStatus::Queued
        ]
    );
    // 두 번째가 끝나면 가장 먼저 줄 선 c가 시작한다
    gates[1].notify_one();
    until("b 완료", || h.status(ids[1]) == JobStatus::Completed).await;
    until("c 시작", || h.status(ids[2]) == JobStatus::Running).await;
    assert_eq!(h.status(ids[3]), JobStatus::Queued);
    for g in &gates {
        g.notify_one();
    }
    until("모두 완료", || {
        ids.iter().all(|&i| h.status(i) == JobStatus::Completed)
    })
    .await;
    assert_eq!(h.fake.max_active(), 2);
    assert_eq!(
        h.fake.download_calls(),
        names.iter().map(|n| h.output(n)).collect::<Vec<_>>()
    );
}

#[tokio::test(start_paused = true)]
async fn single_slot_is_strict_fifo() {
    let h = Harness::new(1);
    for n in ["x", "y", "z"] {
        h.fake.script_for(
            h.output(n),
            Script::new()
                .sleep(Duration::from_millis(10))
                .bytes(5, Some(5)),
        );
    }
    let ids: Vec<_> = ["x", "y", "z"].iter().map(|n| h.enqueue(n).id).collect();
    until("모두 완료", || {
        ids.iter().all(|&i| h.status(i) == JobStatus::Completed)
    })
    .await;
    assert_eq!(h.fake.max_active(), 1);
    assert_eq!(
        h.fake.download_calls(),
        vec![h.output("x"), h.output("y"), h.output("z")]
    );
}

/// 범위 밖 동시 작업 수는 1~3으로 자른다.
#[tokio::test(start_paused = true)]
async fn parallel_is_clamped() {
    for (given, want) in [(0u8, 1usize), (9, 3)] {
        let h = Harness::new(given);
        for n in ["a", "b", "c", "d"] {
            h.fake.script_for(h.output(n), Script::new().wait_cancel());
            h.enqueue(n);
        }
        settle().await;
        assert_eq!(h.fake.active(), want, "{given}");
        assert_eq!(h.mgr.running_count(), want);
    }
}

/// 늘리면 바로 대기 작업을 시작하고, 줄이면 도는 작업은 그대로 두고 새로 시작하지 않는다.
#[tokio::test(start_paused = true)]
async fn set_max_parallel_up_and_down() {
    let h = Harness::new(1);
    let gates: Vec<Arc<Notify>> = (0..4).map(|_| Arc::new(Notify::new())).collect();
    let names = ["a", "b", "c", "d"];
    for (n, g) in names.iter().zip(&gates) {
        h.fake
            .script_for(h.output(n), Script::new().hold(g.clone()));
    }
    let ids: Vec<_> = names.iter().map(|n| h.enqueue(n).id).collect();
    settle().await;
    assert_eq!(h.fake.active(), 1);

    h.mgr.set_max_parallel(3);
    settle().await;
    assert_eq!(h.fake.active(), 3);
    assert_eq!(h.status(ids[3]), JobStatus::Queued);

    h.mgr.set_max_parallel(1);
    settle().await;
    assert_eq!(h.fake.active(), 3, "줄여도 도는 작업은 멈추지 않는다");
    gates[0].notify_one();
    until("a 완료", || h.status(ids[0]) == JobStatus::Completed).await;
    settle().await;
    assert_eq!(
        h.status(ids[3]),
        JobStatus::Queued,
        "2개가 돌고 있어 상한 1을 넘는다"
    );
    gates[1].notify_one();
    gates[2].notify_one();
    until("d 시작", || h.status(ids[3]) == JobStatus::Running).await;
    assert_eq!(h.fake.active(), 1);
    gates[3].notify_one();
}

/// `Added` → `Status(running)` → `Progress`… → `Status(completed)`. 마지막 `Progress`가 `Status`보다 먼저다.
#[tokio::test(start_paused = true)]
async fn event_order_for_one_job() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("a"),
        Script::new()
            .progress(progress(Phase::Resolving, 0, None))
            .bytes(10, Some(30))
            .sleep(Duration::from_millis(5))
            .bytes(30, Some(30))
            .progress(progress(Phase::Finalizing, 30, Some(30))),
    );
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    assert_eq!(
        h.rec.trace(id),
        [
            "added:queued",
            "status:running",
            "progress",
            "progress",
            "progress",
            "progress",
            "status:completed"
        ]
    );
    let done = h.job(id);
    assert_eq!(done.final_bytes, Some(30));
    assert!(done.finished_at.is_some());
    assert_eq!(done.progress, None);
    // 진행률 값이 그대로 평평하게 간다
    let p = h
        .rec
        .events()
        .into_iter()
        .find_map(|e| match e {
            JobEvent::Progress { progress, .. } if progress.bytes == 10 => Some(progress),
            _ => None,
        })
        .unwrap();
    assert_eq!(p.total_bytes, Some(30));
}

/// 모든 작업의 이벤트가 전이 순서대로 온다(동시 작업 사이에 섞여도 각자의 순서는 지킨다).
#[tokio::test(start_paused = true)]
async fn concurrent_jobs_keep_their_own_order() {
    let h = Harness::new(2);
    for n in ["a", "b", "c"] {
        h.fake.script_for(
            h.output(n),
            Script::new()
                .bytes(1, Some(2))
                .sleep(Duration::from_millis(3))
                .bytes(2, Some(2)),
        );
    }
    let ids: Vec<_> = ["a", "b", "c"].iter().map(|n| h.enqueue(n).id).collect();
    until("모두 완료", || {
        ids.iter().all(|&i| h.status(i) == JobStatus::Completed)
    })
    .await;
    for id in ids {
        assert_eq!(
            h.rec.trace(id),
            [
                "added:queued",
                "status:running",
                "progress",
                "progress",
                "status:completed"
            ]
        );
    }
}

/// sink가 실패하면 구독자를 비우고, 작업은 그대로 끝난다.
#[tokio::test(start_paused = true)]
async fn sink_failure_is_ignored() {
    let h = Harness::new(2);
    *h.rec.alive.lock().unwrap() = false;
    h.fake
        .script_for(h.output("a"), Script::new().bytes(1, None).bytes(2, None));
    let id = h.enqueue("a").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    assert_eq!(
        *h.rec.calls.lock().unwrap(),
        1,
        "첫 실패 뒤 더 부르지 않는다"
    );
}

/// 구독자를 바꾸면 스냅샷을 돌려주고, 이후 이벤트는 새 sink로만 간다.
#[tokio::test(start_paused = true)]
async fn resubscribe_returns_snapshot() {
    let h = Harness::new(1);
    let gate = Arc::new(Notify::new());
    h.fake.script_for(
        h.output("a"),
        Script::new().bytes(5, None).hold(gate.clone()),
    );
    let a = h.enqueue("a").id;
    let b = h.enqueue("b").id;
    until("a 진행", || h.job(a).progress.is_some()).await;

    let fresh = Recorder::new();
    let snap = h.mgr.subscribe(fresh.sink());
    assert_eq!(
        snap.iter().map(|j| (j.id, j.status)).collect::<Vec<_>>(),
        [(a, JobStatus::Running), (b, JobStatus::Queued)]
    );
    assert_eq!(snap[0].progress.as_ref().unwrap().bytes, 5);
    let old = h.rec.events().len();
    gate.notify_one();
    until("모두 완료", || h.status(b) == JobStatus::Completed).await;
    assert_eq!(h.rec.events().len(), old, "옛 sink에는 더 가지 않는다");
    assert_eq!(fresh.trace(a), ["status:completed"]);
    assert_eq!(fresh.trace(b), ["status:running", "status:completed"]);
}

/// 같은 최종 경로의 활성 작업이 있으면 `duplicateOutput{jobId}`. 끝난 작업은 막지 않는다.
#[tokio::test(start_paused = true)]
async fn duplicate_output_is_rejected() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let a = h.enqueue("a").id;
    let b = h.enqueue("b").id; // queued

    for name in ["a", "b", "a.mp4"] {
        let e = h.mgr.enqueue(request(name), &h.defaults()).unwrap_err();
        assert_eq!(e.code, ErrorCode::DuplicateOutput, "{name}");
        let want = if name == "b" { b } else { a };
        assert_eq!(
            e.payload,
            Some(ErrorPayload::DuplicateOutput { job_id: want })
        );
    }
    // 폴더를 명시해도 최종 경로가 같으면 막는다
    let mut r = request("b");
    r.folder = Some(h.downloads().to_string_lossy().into_owned());
    assert_eq!(
        h.mgr.enqueue(r, &h.defaults()).unwrap_err().code,
        ErrorCode::DuplicateOutput
    );
    // 실패한 시도는 이벤트·목록에 흔적을 남기지 않는다
    assert_eq!(h.mgr.list().len(), 2);
}

/// Windows·macOS는 대소문자만 다른 이름도 같은 파일이다.
#[cfg(any(windows, target_os = "macos"))]
#[tokio::test(start_paused = true)]
async fn duplicate_output_ignores_case_on_case_insensitive_os() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("Abc"), Script::new().wait_cancel());
    let a = h.enqueue("Abc").id;
    let e = h.mgr.enqueue(request("aBC"), &h.defaults()).unwrap_err();
    assert_eq!(e.payload, Some(ErrorPayload::DuplicateOutput { job_id: a }));
}

#[cfg(target_os = "linux")]
#[tokio::test(start_paused = true)]
async fn duplicate_output_is_case_sensitive_on_linux() {
    let h = Harness::new(1);
    h.enqueue("Abc");
    h.enqueue("abc");
}

#[tokio::test(start_paused = true)]
async fn finished_job_does_not_block_same_output() {
    let h = Harness::new(1);
    let a = h.enqueue("a").id;
    until("완료", || h.status(a) == JobStatus::Completed).await;
    let again = h.enqueue("a");
    assert_ne!(again.id, a);
}

/// 요청 폴더 > 설정 폴더, 파일 이름은 정리·`.mp4`, `segmentConcurrency`는 추가 당시 값으로 고정된다.
#[tokio::test(start_paused = true)]
async fn enqueue_computes_output_and_freezes_concurrency() {
    let h = Harness::new(1);
    let custom = h.dir.path().join("custom");
    let mut r = request("a:b");
    r.folder = Some(custom.to_string_lossy().into_owned());
    let defaults = JobDefaults {
        download_folder: h.downloads(),
        segment_concurrency: 7,
    };
    let dto = h.mgr.enqueue(r, &defaults).unwrap();
    let name = if cfg!(target_os = "linux") {
        "a:b.mp4"
    } else {
        "a_b.mp4"
    };
    assert_eq!(dto.output, custom.join(name).to_string_lossy());
    until("완료", || h.status(dto.id) == JobStatus::Completed).await;
    let req = &h.fake.download_requests()[0];
    assert_eq!(req.concurrency.get(), 7);
    assert_eq!(req.output, custom.join(name));

    // 빈 폴더 문자열은 설정 폴더
    let mut r = request("c");
    r.folder = Some("  ".into());
    assert_eq!(
        h.mgr.enqueue(r, &h.defaults()).unwrap().output,
        h.output("c").to_string_lossy()
    );
    // 상대 경로 폴더는 거부
    let mut r = request("d");
    r.folder = Some("relative/dir".into());
    assert_eq!(
        h.mgr.enqueue(r, &h.defaults()).unwrap_err().code,
        ErrorCode::InvalidInput
    );
}

#[tokio::test(start_paused = true)]
async fn skipped_and_failed_outcomes() {
    let h = Harness::new(3);
    h.fake.script_for(
        h.output("s"),
        Script::new().ends(Ok(DownloadOutcome::Skipped {
            path: h.output("s"),
        })),
    );
    h.fake.script_for(
        h.output("r"),
        Script::new()
            .progress(progress(Phase::Resolving, 0, None))
            .fails(Error::AuthRequired { status: 403 }),
    );
    h.fake.script_for(
        h.output("d"),
        Script::new()
            .bytes(5, Some(10))
            .fails(Error::AuthRequired { status: 403 }),
    );
    let s = h.enqueue("s").id;
    let r = h.enqueue("r").id;
    let d = h.enqueue("d").id;
    until("모두 끝", || {
        [s, r, d]
            .iter()
            .all(|&i| !matches!(h.status(i), JobStatus::Queued | JobStatus::Running))
    })
    .await;
    assert_eq!(h.status(s), JobStatus::Skipped);
    assert!(h.job(s).finished_at.is_some());

    let rj = h.job(r);
    assert_eq!(rj.status, JobStatus::Failed);
    let re = rj.error.unwrap();
    assert_eq!(re.code, ErrorCode::AuthRequired);
    assert_eq!(re.stage, Some(Stage::Resolve));
    assert_eq!(rj.partial_bytes, None);

    let de = h.job(d).error.unwrap();
    assert_eq!(de.stage, Some(Stage::Download));
    // 실패한 항목은 마지막 진행률을 남긴다(막대를 그대로 보여 준다)
    assert_eq!(h.job(d).progress.unwrap().bytes, 5);
}

/// 상태가 바뀔 때마다 jobs.json에 쓰고, 다시 열면 reconcile된다(돌던 작업 → interrupted).
#[tokio::test(start_paused = true)]
async fn persisted_and_reconciled_on_reopen() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let a = h.enqueue("a").id;
    let b = h.enqueue("b").id;
    settle().await;
    let v = h.jobs_json();
    assert_eq!(v["nextId"], 3);
    assert_eq!(v["jobs"][0]["status"], "running");
    assert_eq!(v["jobs"][1]["status"], "queued");

    let m2 = h.reopen(2);
    let st: Vec<_> = m2.list().iter().map(|j| (j.id, j.status)).collect();
    assert_eq!(
        st,
        [(a, JobStatus::Interrupted), (b, JobStatus::Interrupted)]
    );
    assert_eq!(m2.running_count(), 0, "자동 재개하지 않는다");
    assert_eq!(h.jobs_json()["jobs"][0]["status"], "interrupted");
}

/// 완료·건너뜀은 최근 `MAX_FINISHED`개만 남기고 오래된 것부터 `Removed`.
#[tokio::test(start_paused = true)]
async fn finished_jobs_are_capped() {
    let h = Harness::new(3);
    let mut ids = Vec::new();
    for i in 0..=MAX_FINISHED {
        let id = h.enqueue(&format!("f{i}")).id;
        until("완료", || h.status(id) == JobStatus::Completed).await;
        ids.push(id);
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    let list = h.mgr.list();
    assert_eq!(list.len(), MAX_FINISHED);
    assert!(list.iter().all(|j| j.id != ids[0]));
    assert!(h.rec.trace(ids[0]).ends_with(&["removed".to_string()]));
    // 방금 끝난 작업의 Status가 정리(Removed)보다 먼저다
    let ev = h.rec.events();
    assert!(matches!(ev.last(), Some(JobEvent::Removed { id }) if *id == ids[0]));
    assert!(
        matches!(&ev[ev.len() - 2], JobEvent::Status { job } if job.id == *ids.last().unwrap())
    );
}

/// 같은 파일을 가리키는 다른 표기(겹친 구분자·끝 구분자)도 같은 경로로 본다. `.`·`..`는 아래에서 거부한다.
#[tokio::test(start_paused = true)]
async fn duplicate_output_normalizes_path_spelling() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let a = h.enqueue("a").id;
    let base = h.downloads().to_string_lossy().into_owned();
    let sep = std::path::MAIN_SEPARATOR;
    for folder in [format!("{base}{sep}{sep}"), format!("{base}{sep}")] {
        let mut r = request("a");
        r.folder = Some(folder.clone());
        let e = h.mgr.enqueue(r, &h.defaults()).unwrap_err();
        assert_eq!(
            e.payload,
            Some(ErrorPayload::DuplicateOutput { job_id: a }),
            "{folder}"
        );
    }
}

/// `.`·`..` 구성 요소가 있는 폴더는 `enqueue`·`check_output` 모두 `invalidInput`이다. 받아 주면
/// `/tmp/videos/a`와 `/tmp/videos/../videos/a`처럼 같은 파일의 열쇠가 달라 중복 경로 검사를 지나친다.
#[tokio::test(start_paused = true)]
async fn dot_segments_in_folder_are_rejected() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    h.enqueue("a");
    let base = h.downloads().to_string_lossy().into_owned();
    let name = h
        .downloads()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let sep = std::path::MAIN_SEPARATOR;
    let content = chzzk_core::ContentRef::Video { video_no: 1 };
    for folder in [
        format!("{base}{sep}..{sep}{name}"),
        format!("{base}{sep}..{sep}{name}{sep}"),
        format!("{base}{sep}.{sep}"),
        format!("{base}{sep}."),
        format!("{base}{sep}.."),
    ] {
        let mut r = request("a");
        r.folder = Some(folder.clone());
        let e = h.mgr.enqueue(r, &h.defaults()).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput, "{folder}");
        let e = h
            .mgr
            .check_output(
                Some(&folder),
                &h.downloads(),
                "a",
                &content,
                "720p",
                chzzk_core::PlaybackKind::LiveRewindHls,
            )
            .unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput, "{folder}");
    }
    // 설정에서 온 기본 폴더도 같다(옛 설정·손으로 고친 settings.json).
    let defaults = JobDefaults {
        download_folder: h.downloads().join("..").join(&name),
        segment_concurrency: 4,
    };
    let e = h.mgr.enqueue(request("a"), &defaults).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    // `..`가 이름의 일부일 뿐이면 괜찮다.
    let mut r = request("b");
    r.folder = Some(format!("{base}{sep}..videos"));
    h.mgr.enqueue(r, &h.defaults()).unwrap();
    assert_eq!(h.mgr.list().len(), 2);
}

/// Windows: 드라이브 글자·경로의 대소문자와 구분자가 달라도 같은 열쇠이고, `\`로 쓴 `..`도 거부한다.
#[cfg(windows)]
#[tokio::test(start_paused = true)]
async fn windows_path_variants_are_keyed_consistently() {
    use chzzk_shell::manager::output_key;
    use std::path::Path;

    assert_eq!(
        output_key(Path::new(r"C:\Videos\a.mp4")),
        output_key(Path::new("c:/videos/A.MP4"))
    );
    assert_eq!(
        output_key(Path::new(r"C:\Videos\\a.mp4")),
        output_key(Path::new(r"c:\VIDEOS\a.mp4"))
    );

    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let a = h.enqueue("a").id;
    let base = h.downloads().to_string_lossy().into_owned();
    let name = h
        .downloads()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    // 대소문자만 다른 폴더 → 같은 작업
    let mut r = request("a");
    r.folder = Some(base.to_uppercase());
    let e = h.mgr.enqueue(r, &h.defaults()).unwrap_err();
    assert_eq!(e.payload, Some(ErrorPayload::DuplicateOutput { job_id: a }));
    // `\..\`·`/../` 섞어 쓴 별칭 → 거부
    for folder in [
        format!(r"{base}\..\{name}"),
        format!("{}/../{name}", base.replace('\\', "/")),
        format!(r"{base}\.\"),
    ] {
        let mut r = request("a");
        r.folder = Some(folder.clone());
        let e = h.mgr.enqueue(r, &h.defaults()).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput, "{folder}");
    }
}

/// Windows는 `/`와 `\`가 같은 구분자다(옛 Go 설정의 `D:/Videos` 대 폴더 선택기의 `D:\Videos`).
#[cfg(windows)]
#[tokio::test(start_paused = true)]
async fn duplicate_output_unifies_separators_on_windows() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let a = h.enqueue("a").id;
    let mut r = request("a");
    r.folder = Some(h.downloads().to_string_lossy().replace('\\', "/"));
    let e = h.mgr.enqueue(r, &h.defaults()).unwrap_err();
    assert_eq!(e.payload, Some(ErrorPayload::DuplicateOutput { job_id: a }));
}

/// 다중 스레드 런타임(앱과 같은 모양)에서도 작업마다 `Added` → `Status(running)` → `Progress`… → `Status(끝)`이다.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn event_order_on_multi_thread_runtime() {
    let h = Harness::new(3);
    let names: Vec<String> = (0..12).map(|i| format!("m{i}")).collect();
    for n in &names {
        h.fake.script_for(
            h.output(n),
            Script::new()
                .bytes(1, Some(3))
                .bytes(2, Some(3))
                .bytes(3, Some(3)),
        );
    }
    let ids: Vec<_> = names.iter().map(|n| h.enqueue(n).id).collect();
    until("모두 완료", || {
        ids.iter().all(|&i| h.status(i) == JobStatus::Completed)
    })
    .await;
    assert!(h.fake.max_active() <= 3);
    for id in ids {
        assert_eq!(
            h.rec.trace(id),
            [
                "added:queued",
                "status:running",
                "progress",
                "progress",
                "progress",
                "status:completed"
            ]
        );
    }
}

/// UTF-8이 아닌 기본 폴더(Linux XDG 동영상 폴더 등)는 `invalidInput`으로 막는다. 받아들이면 serde가 그 경로를
/// 쓰지 못해 그 뒤 모든 `jobs.json` 저장이 실패한다. `check_output`도 같다.
#[cfg(unix)]
#[tokio::test(start_paused = true)]
async fn non_utf8_default_folder_is_rejected() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;

    let h = Harness::new(1);
    let bad = h.dir.path().join(OsStr::from_bytes(b"vid\xffeos"));
    let defaults = JobDefaults {
        download_folder: bad.clone(),
        segment_concurrency: 4,
    };
    let e = h.mgr.enqueue(request("a"), &defaults).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    let e = h
        .mgr
        .check_output(
            None,
            &bad,
            "a",
            &chzzk_core::ContentRef::Video { video_no: 1 },
            "720p",
            chzzk_core::PlaybackKind::LiveRewindHls,
        )
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(h.rec.events().is_empty());
    assert!(h.mgr.list().is_empty());

    // 저장은 계속된다
    let id = h.enqueue("b").id;
    until("완료", || h.status(id) == JobStatus::Completed).await;
    assert_eq!(h.jobs_json()["jobs"][0]["status"], "completed");
}
