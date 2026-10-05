//! 시작 때 reconcile(app.md §7.1 표, §15-6). sidecar는 코어 `Sidecar::new` + `atomic_write`로 만든다.

use std::path::{Path, PathBuf};

use chzzk_core::download::part::{Sidecar, part_path, sidecar_path};
use chzzk_core::fsutil::atomic_write;
use chzzk_core::{ContentRef, PlaybackKind};
use chzzk_shell::JobId;
use chzzk_shell::dto::{ContentKindDto, JobStatus, OnExisting};
use chzzk_shell::jobs::{JobRecord, JobsFile, partial_bytes, reconcile};

fn record(id: u64, status: JobStatus, output: PathBuf) -> JobRecord {
    JobRecord {
        id: JobId(id),
        url: "u".into(),
        content: ContentRef::Video { video_no: 1 },
        title: "t".into(),
        channel_name: "c".into(),
        channel_id: None,
        kind: ContentKindDto::Video,
        quality_id: "720p".into(),
        quality_label: "720p".into(),
        expected_kind: PlaybackKind::LiveRewindHls,
        output,
        on_existing: OnExisting::Overwrite,
        concurrency: 4,
        status,
        created_at: 1,
        finished_at: None,
        final_bytes: None,
        last_error: None,
        discard_on_start: false,
        partial_bytes: Some(999), // reconcile이 다시 채우는지 보려고 엉뚱한 값
        missing: false,
    }
}

/// `.part`(길이 `part_len`)와 sidecar(`committed_len`)를 만든다.
fn write_partial(output: &Path, sc: Option<Sidecar>, part_len: usize) {
    std::fs::write(part_path(output), vec![0u8; part_len]).unwrap();
    if let Some(sc) = sc {
        atomic_write(&sidecar_path(output), &serde_json::to_vec(&sc).unwrap()).unwrap();
    }
}

fn same_sidecar(committed: u64) -> Sidecar {
    let mut sc = Sidecar::new(
        ContentRef::Video { video_no: 1 },
        "720p",
        PlaybackKind::LiveRewindHls,
    );
    sc.committed_len = committed;
    sc
}

fn run(jobs: Vec<JobRecord>) -> Vec<JobRecord> {
    let mut f = JobsFile {
        v: 1,
        next_id: 100,
        jobs,
    };
    reconcile(&mut f);
    assert_eq!(f.next_id, 100);
    f.jobs
}

/// 1행: 앱이 꺼질 때 돌던·멈추던·기다리던 작업은 `interrupted`. 자동 재개하지 않는다.
#[test]
fn live_states_become_interrupted() {
    let dir = tempfile::tempdir().unwrap();
    let out = |n: &str| dir.path().join(n);
    write_partial(&out("a.mp4"), Some(same_sidecar(4096)), 5000);
    let got = run(vec![
        record(1, JobStatus::Running, out("a.mp4")),
        record(2, JobStatus::Pausing, out("b.mp4")),
        record(3, JobStatus::Queued, out("c.mp4")),
    ]);
    assert!(got.iter().all(|j| j.status == JobStatus::Interrupted));
    // 크래시 불변식: committed_len까지만 이어받는다(.part가 더 길어도)
    assert_eq!(got[0].partial_bytes, Some(4096));
    assert_eq!(got[1].partial_bytes, None);
    assert_eq!(got[2].partial_bytes, None);
}

/// 2행: 같은 작업의 `.part`·sidecar → 상태 유지, `committed_len`.
#[test]
fn stopped_with_same_job_partial_keeps_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let mut jobs = Vec::new();
    for (i, st) in [JobStatus::Paused, JobStatus::Interrupted, JobStatus::Failed]
        .into_iter()
        .enumerate()
    {
        let o = dir.path().join(format!("{i}.mp4"));
        write_partial(&o, Some(same_sidecar(1234 + i as u64)), 2000);
        jobs.push(record(i as u64, st, o));
    }
    let got = run(jobs);
    assert_eq!(
        got.iter().map(|j| j.status).collect::<Vec<_>>(),
        [JobStatus::Paused, JobStatus::Interrupted, JobStatus::Failed]
    );
    assert_eq!(
        got.iter().map(|j| j.partial_bytes).collect::<Vec<_>>(),
        [Some(1234), Some(1235), Some(1236)]
    );
}

/// 3행: `.part`는 있는데 sidecar가 없거나·깨졌거나·다른 작업이면 `None`.
#[test]
fn partial_without_matching_sidecar_is_none() {
    let dir = tempfile::tempdir().unwrap();
    let o1 = dir.path().join("nosc.mp4");
    write_partial(&o1, None, 100);

    let o2 = dir.path().join("other.mp4");
    let mut other = same_sidecar(50);
    other.quality_id = "1080p".into();
    write_partial(&o2, Some(other), 100);

    let o3 = dir.path().join("kind.mp4");
    let mut kind = same_sidecar(50);
    kind.kind = PlaybackKind::Progressive;
    write_partial(&o3, Some(kind), 100);

    let o4 = dir.path().join("broken.mp4");
    write_partial(&o4, None, 100);
    std::fs::write(sidecar_path(&o4), b"{broken").unwrap();

    let got = run(vec![
        record(1, JobStatus::Paused, o1),
        record(2, JobStatus::Failed, o2),
        record(3, JobStatus::Interrupted, o3),
        record(4, JobStatus::Paused, o4),
    ]);
    assert!(got.iter().all(|j| j.partial_bytes.is_none()), "{got:?}");
}

/// 4행: `.part`가 없으면 `None`(sidecar만 남아 있어도).
#[test]
fn no_partial_is_none() {
    let dir = tempfile::tempdir().unwrap();
    let o = dir.path().join("a.mp4");
    atomic_write(
        &sidecar_path(&o),
        &serde_json::to_vec(&same_sidecar(10)).unwrap(),
    )
    .unwrap();
    let got = run(vec![
        record(1, JobStatus::Failed, o),
        record(2, JobStatus::Paused, dir.path().join("b.mp4")),
    ]);
    assert!(got.iter().all(|j| j.partial_bytes.is_none()));
}

/// 5행: 완료인데 최종 파일이 없으면 `missing`. 있으면 아니다.
#[test]
fn completed_missing_file() {
    let dir = tempfile::tempdir().unwrap();
    let present = dir.path().join("p.mp4");
    std::fs::write(&present, b"x").unwrap();
    let mut gone = record(2, JobStatus::Completed, dir.path().join("gone.mp4"));
    gone.final_bytes = Some(10);
    let got = run(vec![record(1, JobStatus::Completed, present), gone]);
    assert!(!got[0].missing);
    assert!(got[1].missing);
    assert_eq!(got[1].status, JobStatus::Completed);
    assert_eq!(got[1].final_bytes, Some(10));
    // 완료·건너뜀은 partial을 보지 않는다
    assert!(got.iter().all(|j| j.partial_bytes.is_none()));
}

#[test]
fn skipped_is_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let got = run(vec![record(
        1,
        JobStatus::Skipped,
        dir.path().join("s.mp4"),
    )]);
    assert_eq!(got[0].status, JobStatus::Skipped);
    assert!(!got[0].missing);
    assert_eq!(got[0].partial_bytes, None);
}

/// "처음부터"로 표시된 작업은 옛 `.part`가 있어도 이어받을 것이 없다(다음 시작 때 지운다).
#[test]
fn discard_on_start_hides_partial() {
    let dir = tempfile::tempdir().unwrap();
    let o = dir.path().join("a.mp4");
    write_partial(&o, Some(same_sidecar(64)), 64);
    let mut r = record(1, JobStatus::Queued, o);
    r.discard_on_start = true;
    let got = run(vec![r]);
    assert_eq!(got[0].status, JobStatus::Interrupted);
    assert_eq!(got[0].partial_bytes, None);
    assert!(got[0].discard_on_start);
}

#[test]
fn partial_bytes_helper_matches_table() {
    let dir = tempfile::tempdir().unwrap();
    let o = dir.path().join("a.mp4");
    let r = record(1, JobStatus::Paused, o.clone());
    assert_eq!(partial_bytes(&r), None);
    write_partial(&o, Some(same_sidecar(7)), 7);
    assert_eq!(partial_bytes(&r), Some(7));
}
