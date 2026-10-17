//! `JobStore`(jobs.json): 왕복, nextId, 깨진 파일(app.md §7.1, §15-5).

use std::path::PathBuf;

use chzzk_core::{ContentRef, DuplicatePolicy, PlaybackKind};
use chzzk_shell::dto::{ContentKindDto, JobStatus, LiveEndDto, LiveEndReason, OnExisting};
use chzzk_shell::jobs::{JOBS_FILE, JobRecord, JobStore, JobsFile, concurrency};
use chzzk_shell::{AppError, JobId};

fn record(id: u64, status: JobStatus) -> JobRecord {
    JobRecord {
        id: JobId(id),
        url: format!("https://chzzk.naver.com/video/{id}"),
        content: ContentRef::Video { video_no: id },
        title: "제목".into(),
        channel_name: "채널".into(),
        channel_id: Some("75cb".into()),
        kind: ContentKindDto::Video,
        quality_id: "PD_720P".into(),
        quality_label: "720p".into(),
        expected_kind: PlaybackKind::Progressive,
        recording_id: None,
        output: PathBuf::from(format!("/v/{id}.mp4")),
        on_existing: OnExisting::Overwrite,
        concurrency: 4,
        status,
        created_at: 1_759_650_000,
        finished_at: None,
        stopped_at: None,
        range: None,
        final_bytes: None,
        live_end: None,
        last_error: None,
        discard_on_start: false,
        partial_bytes: None,
        missing: false,
    }
}

#[test]
fn missing_file_is_empty_list() {
    let dir = tempfile::tempdir().unwrap();
    let loaded = JobStore::new(dir.path()).load().unwrap();
    assert_eq!(loaded.file, JobsFile::default());
    assert_eq!(loaded.file.next_id, 1);
    assert!(loaded.backup.is_none());
}

#[test]
fn round_trip_keeps_records_and_drops_runtime_fields() {
    let dir = tempfile::tempdir().unwrap();
    let store = JobStore::new(dir.path().join("nested"));
    let mut file = JobsFile::default();
    let mut a = record(file.alloc_id().0, JobStatus::Paused);
    a.partial_bytes = Some(10);
    a.discard_on_start = true;
    let mut b = record(file.alloc_id().0, JobStatus::Failed);
    b.last_error = Some(AppError::internal("x"));
    b.missing = true;
    file.jobs = vec![a.clone(), b.clone()];
    store.save(&file).unwrap();

    let got = store.load().unwrap().file;
    assert_eq!(got.next_id, 3);
    a.partial_bytes = None; // 저장하지 않는다
    b.missing = false;
    assert_eq!(got.jobs, vec![a, b]);
}

/// §7.1의 예시 모양(camelCase, 코어 직렬화 그대로의 `content`·`expectedKind`).
#[test]
fn json_shape() {
    let dir = tempfile::tempdir().unwrap();
    let store = JobStore::new(dir.path());
    let file = JobsFile {
        v: 1,
        next_id: 42,
        jobs: vec![record(41, JobStatus::Paused)],
    };
    store.save(&file).unwrap();
    let v: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join(JOBS_FILE)).unwrap()).unwrap();
    assert_eq!(v["v"], 1);
    assert_eq!(v["nextId"], 42);
    let j = &v["jobs"][0];
    assert_eq!(j["id"], 41);
    assert_eq!(
        j["content"],
        serde_json::json!({"kind": "video", "videoNo": 41})
    );
    assert_eq!(j["kind"], "video");
    assert_eq!(j["expectedKind"], "progressive");
    assert_eq!(j["onExisting"], "overwrite");
    assert_eq!(j["status"], "paused");
    assert_eq!(j["channelId"], "75cb");
    assert_eq!(j["lastError"], serde_json::Value::Null);
    assert_eq!(j["discardOnStart"], false);
    assert!(j.get("partialBytes").is_none());
    assert!(j.get("missing").is_none());
}

fn record_json(live_end: Option<&str>) -> String {
    let extra = live_end
        .map(|l| format!(r#","liveEnd":{l}"#))
        .unwrap_or_default();
    format!(
        r#"{{"v":1,"nextId":2,"jobs":[{{"id":1,"url":"u","content":{{"kind":"clip","clipId":"abc"}},
            "title":"t","channelName":"c","kind":"clip","qualityId":"q","qualityLabel":"720p",
            "expectedKind":"progressive","output":"/v/a.mp4","onExisting":"overwrite",
            "concurrency":4,"status":"completed","createdAt":1{extra}}}]}}"#
    )
}

/// 끝난 이유가 없는 옛 레코드는 `None`으로 읽고, 다시 쓰면 `liveEnd` 키가 없다.
#[test]
fn record_without_live_end_reads_none() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(JOBS_FILE), record_json(None)).unwrap();
    let store = JobStore::new(dir.path());
    let file = store.load().unwrap().file;
    assert_eq!(file.jobs[0].live_end, None);
    store.save(&file).unwrap();
    let v: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join(JOBS_FILE)).unwrap()).unwrap();
    assert!(v["jobs"][0].get("liveEnd").is_none());
}

#[test]
fn live_end_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let store = JobStore::new(dir.path());
    let mut r = record(1, JobStatus::Completed);
    r.live_end = Some(LiveEndDto {
        reason: LiveEndReason::Ended,
        gaps: None,
    });
    let file = JobsFile {
        v: 1,
        next_id: 2,
        jobs: vec![r.clone()],
    };
    store.save(&file).unwrap();
    let v: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.path().join(JOBS_FILE)).unwrap()).unwrap();
    assert_eq!(
        v["jobs"][0]["liveEnd"],
        serde_json::json!({"reason": "ended", "gaps": null})
    );
    assert_eq!(store.load().unwrap().file.jobs, vec![r]);
}

/// 뒤 버전이 더한 이유는 버리고 `None`으로 읽는다: jobs.json 전체를 못 읽게 되면 안 된다.
#[test]
fn unknown_live_end_reason_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(JOBS_FILE),
        record_json(Some(r#"{"reason":"zzz","gaps":1}"#)),
    )
    .unwrap();
    let loaded = JobStore::new(dir.path()).load().unwrap();
    assert!(loaded.backup.is_none());
    let j = &loaded.file.jobs[0];
    assert_eq!(j.live_end, None);
    assert_eq!(j.id, JobId(1));
    assert_eq!(j.status, JobStatus::Completed);
}

/// 선택 필드가 없는 레코드도 읽는다.
#[test]
fn optional_fields_default() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join(JOBS_FILE),
        r#"{"v":1,"nextId":2,"jobs":[{"id":1,"url":"u","content":{"kind":"clip","clipId":"abc"},
            "title":"t","channelName":"c","kind":"clip","qualityId":"q","qualityLabel":"720p",
            "expectedKind":"progressive","output":"/v/a.mp4","onExisting":"overwrite",
            "concurrency":4,"status":"queued","createdAt":1}]}"#,
    )
    .unwrap();
    let f = JobStore::new(dir.path()).load().unwrap().file;
    let j = &f.jobs[0];
    assert_eq!(j.channel_id, None);
    assert_eq!(j.last_error, None);
    assert!(!j.discard_on_start);
    assert_eq!(
        j.content,
        ContentRef::Clip {
            clip_id: "abc".into()
        }
    );
}

/// `nextId`가 저장된 id보다 작으면(손으로 고친 파일) 가장 큰 id 다음으로 맞춘다.
#[test]
fn next_id_is_repaired_and_monotonic() {
    let dir = tempfile::tempdir().unwrap();
    let store = JobStore::new(dir.path());
    let file = JobsFile {
        v: 1,
        next_id: 2,
        jobs: vec![record(7, JobStatus::Completed)],
    };
    store.save(&file).unwrap();
    let mut f = store.load().unwrap().file;
    assert_eq!(f.next_id, 8);
    assert_eq!(f.alloc_id(), JobId(8));
    assert_eq!(f.alloc_id(), JobId(9));
    // 지운 뒤에도 id를 다시 쓰지 않는다
    f.jobs.clear();
    store.save(&f).unwrap();
    assert_eq!(store.load().unwrap().file.alloc_id(), JobId(10));
}

#[test]
fn corrupt_file_is_moved_aside() {
    for bad in [
        &b"{not json"[..],
        b"[]",
        br#"{"v":2,"nextId":1,"jobs":[]}"#,
        br#"{"v":1,"nextId":1,"jobs":[{"id":"x"}]}"#,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(JOBS_FILE);
        std::fs::write(&path, bad).unwrap();
        let loaded = JobStore::new(dir.path()).load().unwrap();
        assert_eq!(loaded.file, JobsFile::default());
        let backup = loaded.backup.expect("백업 경로");
        assert!(
            backup
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("jobs.json.bad-")
        );
        assert_eq!(std::fs::read(&backup).unwrap(), bad);
        assert!(!path.exists());
        // 같은 초에 또 깨져도 덮어쓰지 않는다
        std::fs::write(&path, bad).unwrap();
        let second = JobStore::new(dir.path()).load().unwrap().backup.unwrap();
        assert_ne!(second, backup);
        assert!(backup.exists() && second.exists());
    }
}

#[test]
fn to_request_mirrors_record() {
    let mut r = record(1, JobStatus::Queued);
    r.on_existing = OnExisting::Skip;
    r.concurrency = 0; // 손으로 고친 값
    let req = r.to_request();
    assert_eq!(req.on_existing, DuplicatePolicy::Skip);
    assert_eq!(req.concurrency.get(), 1);
    assert_eq!(req.output, r.output);
    assert_eq!(req.quality_id, "PD_720P");
    assert_eq!(concurrency(200).get(), 8);
}

#[test]
fn to_dto_carries_runtime_fields() {
    let mut r = record(3, JobStatus::Completed);
    r.missing = true;
    r.final_bytes = Some(5);
    let d = r.to_dto(None);
    assert_eq!(d.id, JobId(3));
    assert!(d.missing);
    assert_eq!(d.final_bytes, Some(5));
    assert_eq!(d.output, r.output.to_string_lossy());
    assert_eq!(d.playback_kind, PlaybackKind::Progressive);
}
