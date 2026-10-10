//! (f) 셸 상태·DTO(system/platform.md): `stoppedAt` 기록 규칙, 잠자기 방지 설정, 엔진 프로브·이벤트 DTO,
//! `WebPage::Help` JSON, 옛 레코드 호환.

mod common;

use std::time::Duration;

use chzzk_core::{ClientConfig, ContentRef, Error, PlaybackKind};
use chzzk_shell::dto::{
    ContentKindDto, EngineProbe, JobStatus, KeepAwakePayload, OnExisting, PhaseTs, SettingsPatch,
    WebPage,
};
use chzzk_shell::jobs::{JobRecord, JobsFile, reconcile};
use chzzk_shell::manager::QUIT_TIMEOUT;
use chzzk_shell::services::{AppPaths, SettingsService};
use chzzk_shell::{JobId, JobStore};
use common::fake::Script;
use common::harness::{Harness, settle, until};
use serde_json::json;
use tempfile::TempDir;

/// 2025-10 즈음의 유닉스 초(시계가 이보다 아래일 리 없다)
const AFTER_2025: u64 = 1_759_000_000;

fn long_script() -> Script {
    Script::new()
        .bytes(1, None)
        .until_cancelled()
        .linger(Duration::from_millis(20))
        .fails(Error::Cancelled)
}

// ---------------------------------------------------------------------------
// stoppedAt 기록 규칙
// ---------------------------------------------------------------------------

/// 일시정지(받는 중·대기 중 모두)는 stoppedAt을 적고, 다시 줄 세우면 지운다. finishedAt은 건드리지 않는다.
#[tokio::test(start_paused = true)]
async fn pause_sets_stopped_at_and_resume_clears_it() {
    let h = Harness::new(1);
    h.fake.script_for(h.output("a"), long_script());
    h.fake
        .script_for(h.output("b"), Script::new().wait_cancel());
    let a = h.enqueue("a").id;
    let b = h.enqueue("b").id;
    until("진행", || h.job(a).progress.is_some()).await;
    assert_eq!(h.job(a).stopped_at, None, "받는 중에는 없다");

    // 대기 중 일시정지
    h.mgr.pause(b).unwrap();
    settle().await;
    assert_eq!(h.status(b), JobStatus::Paused);
    assert!(h.job(b).stopped_at.unwrap() > AFTER_2025);

    // 받는 중 일시정지: pausing은 아직 아니고, paused가 되면 적힌다
    h.mgr.pause(a).unwrap();
    assert_eq!(h.status(a), JobStatus::Pausing);
    assert_eq!(h.job(a).stopped_at, None);
    until("paused", || h.status(a) == JobStatus::Paused).await;
    let j = h.job(a);
    assert!(j.stopped_at.unwrap() > AFTER_2025);
    assert_eq!(j.finished_at, None, "finishedAt은 완료·건너뜀 전용");
    assert_eq!(
        h.jobs_json()["jobs"][0]["stoppedAt"].as_u64(),
        j.stopped_at,
        "jobs.json에 저장된다"
    );

    h.mgr.resume(a, false).unwrap();
    assert_eq!(h.job(a).stopped_at, None, "queued로 돌아가면 지운다");
}

/// 실패는 stoppedAt을 적고, 완료는 finishedAt만 적는다.
#[tokio::test(start_paused = true)]
async fn failed_sets_stopped_at_and_completed_sets_finished_at_only() {
    let h = Harness::new(2);
    h.fake.script_for(
        h.output("bad"),
        Script::new()
            .bytes(1, None)
            .fails(Error::NoPlayback { adult: false }),
    );
    h.fake
        .script_for(h.output("ok"), Script::new().bytes(10, Some(10)));
    let bad = h.enqueue("bad").id;
    let ok = h.enqueue("ok").id;
    until("끝", || {
        h.status(bad) == JobStatus::Failed && h.status(ok) == JobStatus::Completed
    })
    .await;
    let f = h.job(bad);
    assert!(f.stopped_at.unwrap() > AFTER_2025);
    assert_eq!(f.finished_at, None);
    let c = h.job(ok);
    assert_eq!(c.stopped_at, None);
    assert!(c.finished_at.is_some());

    // 실패한 작업을 다시 시도하면 지운다
    h.fake
        .script_for(h.output("bad"), Script::new().bytes(10, Some(10)));
    h.mgr.resume(bad, false).unwrap();
    until("완료", || h.status(bad) == JobStatus::Completed).await;
    assert_eq!(h.job(bad).stopped_at, None);
}

/// 종료(quit)로 멈춘 작업은 interrupted + stoppedAt
#[tokio::test(start_paused = true)]
async fn quit_interrupts_with_stopped_at() {
    let h = Harness::new(1);
    h.fake.script_for(h.output("a"), long_script());
    let a = h.enqueue("a").id;
    until("진행", || h.job(a).progress.is_some()).await;
    h.mgr.quit(QUIT_TIMEOUT).await;
    let j = h.job(a);
    assert_eq!(j.status, JobStatus::Interrupted);
    assert!(j.stopped_at.unwrap() > AFTER_2025);
}

fn record(id: u64, status: JobStatus, stopped_at: Option<u64>) -> JobRecord {
    JobRecord {
        id: JobId(id),
        url: "u".into(),
        content: ContentRef::Video { video_no: id },
        title: "t".into(),
        channel_name: "c".into(),
        channel_id: None,
        kind: ContentKindDto::Video,
        quality_id: "720p".into(),
        quality_label: "720p".into(),
        expected_kind: PlaybackKind::Progressive,
        output: format!("/nonexistent/{id}.mp4").into(),
        on_existing: OnExisting::Overwrite,
        concurrency: 4,
        status,
        created_at: 1,
        finished_at: None,
        stopped_at,
        final_bytes: None,
        last_error: None,
        discard_on_start: false,
        partial_bytes: None,
        missing: false,
    }
}

/// reconcile: running·pausing·queued → interrupted는 stoppedAt이 없을 때만 지금, 있으면 그대로.
/// 이미 멈춘 옛 레코드(stoppedAt 없음)는 없는 채로 둔다.
#[test]
fn reconcile_sets_stopped_at_only_when_missing() {
    let mut f = JobsFile {
        v: 1,
        next_id: 100,
        jobs: vec![
            record(1, JobStatus::Running, None),
            record(2, JobStatus::Pausing, Some(5)),
            record(3, JobStatus::Queued, None),
            record(4, JobStatus::Failed, None),
            record(5, JobStatus::Paused, Some(7)),
            record(6, JobStatus::Completed, None),
        ],
    };
    reconcile(&mut f);
    let by = |id: u64| f.jobs.iter().find(|j| j.id == JobId(id)).unwrap();
    assert_eq!(by(1).status, JobStatus::Interrupted);
    assert!(by(1).stopped_at.unwrap() > AFTER_2025);
    assert_eq!(by(2).stopped_at, Some(5), "처음 멈춘 시각을 지킨다");
    assert!(by(3).stopped_at.unwrap() > AFTER_2025);
    assert_eq!(by(4).stopped_at, None, "옛 레코드는 줄을 만들지 않는다");
    assert_eq!(by(5).stopped_at, Some(7));
    assert_eq!(by(6).stopped_at, None);
}

/// stoppedAt이 없는 옛 jobs.json 레코드도 읽힌다
#[test]
fn old_records_without_stopped_at_load() {
    let t = TempDir::new().unwrap();
    let store = JobStore::new(t.path().join("data"));
    let mut f = JobsFile {
        v: 1,
        next_id: 3,
        jobs: vec![record(1, JobStatus::Failed, Some(9))],
    };
    let mut v = serde_json::to_value(&f).unwrap();
    v["jobs"][0].as_object_mut().unwrap().remove("stoppedAt");
    std::fs::create_dir_all(t.path().join("data")).unwrap();
    std::fs::write(
        t.path().join("data/jobs.json"),
        serde_json::to_vec(&v).unwrap(),
    )
    .unwrap();
    let loaded = store.load().unwrap();
    assert_eq!(loaded.file.jobs[0].stopped_at, None);
    f.jobs[0].stopped_at = Some(9);
    store.save(&f).unwrap();
    assert_eq!(store.load().unwrap().file.jobs[0].stopped_at, Some(9));
}

// ---------------------------------------------------------------------------
// 설정·DTO
// ---------------------------------------------------------------------------

fn open_settings(root: &std::path::Path) -> SettingsService {
    let paths = AppPaths::new(
        root.join("config"),
        root.join("data"),
        root.join("log"),
        None,
        None,
        None,
    );
    SettingsService::open(&paths, ClientConfig::default(), None).unwrap()
}

/// keepAwake: 기본 켜짐, 패치로 끄고 켜며, 다른 키 패치는 건드리지 않는다
#[test]
fn keep_awake_setting_defaults_on_and_patches() {
    let t = TempDir::new().unwrap();
    let svc = open_settings(t.path());
    assert!(svc.get().keep_awake);

    let off = svc
        .update(SettingsPatch {
            keep_awake: Some(false),
            ..SettingsPatch::default()
        })
        .unwrap();
    assert!(!off.keep_awake);
    let other = svc
        .update(SettingsPatch {
            max_parallel_downloads: Some(3),
            ..SettingsPatch::default()
        })
        .unwrap();
    assert!(!other.keep_awake, "다른 키 패치는 그대로 둔다");
    drop(svc);

    // 다시 열어도 유지
    let svc = open_settings(t.path());
    assert!(!svc.get().keep_awake);
    let on = svc
        .update(SettingsPatch {
            keep_awake: Some(true),
            ..SettingsPatch::default()
        })
        .unwrap();
    assert!(on.keep_awake);

    let p: SettingsPatch = serde_json::from_value(json!({"keepAwake": false})).unwrap();
    assert_eq!(p.keep_awake, Some(false));
    let json = serde_json::to_value(svc.get()).unwrap();
    assert_eq!(json["keepAwake"], json!(true));
}

#[test]
fn engine_probe_json_and_all_ok() {
    let p: EngineProbe = serde_json::from_value(json!({
        "colorMix": true, "has": true, "oklch": true, "containerQuery": true, "inert": true
    }))
    .unwrap();
    assert!(p.all_ok());
    for key in ["colorMix", "has", "oklch", "containerQuery", "inert"] {
        let mut v = json!({
            "colorMix": true, "has": true, "oklch": true, "containerQuery": true, "inert": true
        });
        v[key] = json!(false);
        let p: EngineProbe = serde_json::from_value(v).unwrap();
        assert!(!p.all_ok(), "{key}가 false면 통과하지 못한다");
    }
    // 다섯 키가 정확히 직렬화된다(스모크 마커가 같은 모양을 쓴다)
    let back = serde_json::to_value(p).unwrap();
    let mut keys: Vec<_> = back.as_object().unwrap().keys().cloned().collect();
    keys.sort();
    assert_eq!(
        keys,
        ["colorMix", "containerQuery", "has", "inert", "oklch"]
    );
    // 모자란 키는 거부한다
    assert!(serde_json::from_value::<EngineProbe>(json!({"colorMix": true})).is_err());
}

#[test]
fn event_payloads_and_help_page_json() {
    assert_eq!(
        serde_json::to_value(KeepAwakePayload { active: true }).unwrap(),
        json!({"active": true})
    );
    assert_eq!(
        serde_json::from_value::<WebPage>(json!("help")).unwrap(),
        WebPage::Help
    );
    assert_eq!(
        serde_json::to_value(PhaseTs::Downloading).unwrap(),
        json!("downloading")
    );
}
