//! 오디오만 받기의 셸 쪽(audio-only.md §5): 확장자(`.m4a`), `enqueue` 가드, `JobDto.audioOnly`, 마지막 화질 제외,
//! `jobs.json` 호환(필드를 더하지 않는다).

mod common;

use std::path::Path;

use chzzk_core::chat::SubtitleFormat;
use chzzk_core::download::part::{PartFile, ProgressiveState, Sidecar};
use chzzk_core::mpd::AUDIO_QUALITY_ID;
use chzzk_core::{ClientConfig, ContentRef, Platform, PlaybackKind, RecentKind};
use chzzk_shell::dto::{EnqueueRequest, JobStatus, OnExisting, TimeRangeDto};
use chzzk_shell::output::{OutputQuery, check_output};
use chzzk_shell::services::{AppPaths, SettingsService, enqueue};
use chzzk_shell::{ErrorCode, JobId, OwnershipGate};
use common::harness::{Harness, request, until};
use tempfile::TempDir;

const CONTENT: ContentRef = ContentRef::Video { video_no: 1 };

/// 일반 VOD의 오디오만 받기 요청(화질 키는 고정값 `audio`).
fn audio_request(name: &str) -> EnqueueRequest {
    EnqueueRequest {
        quality_id: AUDIO_QUALITY_ID.into(),
        quality_label: "오디오만".into(),
        expected_kind: PlaybackKind::Progressive,
        ..request(name)
    }
}

fn none(_: &Path) -> Option<JobId> {
    None
}

fn check(folder: &Path, name: &str, quality_id: &str) -> chzzk_shell::dto::OutputCheck {
    check_output(
        &OutputQuery {
            folder,
            file_name: name,
            content: &CONTENT,
            quality_id,
            kind: PlaybackKind::Progressive,
            platform: Platform::current(),
            range: None,
            chat: None,
        },
        &none,
    )
}

fn touch(p: &Path) {
    std::fs::write(p, b"x").unwrap();
}

// ---------------------------------------------------------------------------
// check_output
// ---------------------------------------------------------------------------

/// 화질 키가 `audio`면 `.m4a` 경로와 이름이 나온다. 이름 칸(`fileName`)에는 확장자가 없다.
#[test]
fn check_output_uses_m4a_for_audio() {
    let dir = tempfile::tempdir().unwrap();
    let c = check(dir.path(), "[251003] 채널 - 제목", AUDIO_QUALITY_ID);
    assert_eq!(c.file_name, "[251003] 채널 - 제목");
    assert_eq!(
        Path::new(&c.path),
        dir.path().join("[251003] 채널 - 제목.m4a")
    );
    // 이름이 바뀌지 않았으니 줄었다고 표시하지 않는다(`.m4a`를 떼지 못하면 `truncated`가 된다)
    assert!(!c.truncated && !c.exists);
    // 비디오 화질은 그대로 `.mp4`
    let c = check(dir.path(), "[251003] 채널 - 제목", "PD_720P");
    assert_eq!(
        Path::new(&c.path),
        dir.path().join("[251003] 채널 - 제목.mp4")
    );
}

/// 충돌과 번호 이름은 `.m4a` 기준이다. 같은 이름의 `.mp4`는 충돌이 아니다.
#[test]
fn check_output_conflicts_are_per_extension() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    touch(&d.join("a.mp4"));
    let c = check(d, "a", AUDIO_QUALITY_ID);
    assert!(!c.exists, "같은 이름의 mp4는 오디오와 충돌하지 않는다");
    assert_eq!(c.free_file_name, None);

    touch(&d.join("a.m4a"));
    let c = check(d, "a", AUDIO_QUALITY_ID);
    assert!(c.exists);
    assert_eq!(c.conflict_names, ["a.m4a"]);
    assert_eq!(c.free_file_name.as_deref(), Some("a (2)"));

    // 번호 이름도 `.m4a` 기준: (2)의 mp4가 있어도 (2)는 비어 있다
    touch(&d.join("a (2).mp4"));
    let c = check(d, "a", AUDIO_QUALITY_ID);
    assert_eq!(c.free_file_name.as_deref(), Some("a (2)"));
    touch(&d.join("a (2).m4a"));
    touch(chzzk_core::download::part::part_path(&d.join("a (3).m4a")).as_path());
    let c = check(d, "a", AUDIO_QUALITY_ID);
    assert_eq!(c.free_file_name.as_deref(), Some("a (4)"));

    // 반대로 mp4 쪽은 m4a를 충돌로 보지 않는다
    let dir2 = tempfile::tempdir().unwrap();
    touch(&dir2.path().join("b.m4a"));
    assert!(!check(dir2.path(), "b", "PD_720P").exists);
}

/// 200바이트 상한은 `.m4a`로 센다(확장자 길이는 같아 이름이 잘리는 길이도 같다).
#[test]
fn check_output_truncates_long_audio_name() {
    let dir = tempfile::tempdir().unwrap();
    let long = "가".repeat(100);
    let c = check(dir.path(), &long, AUDIO_QUALITY_ID);
    assert!(c.truncated);
    assert!(c.file_name.len() + ".m4a".len() <= chzzk_core::naming::MAX_FILENAME_BYTES);
    assert!(Path::new(&c.path).to_string_lossy().ends_with(".m4a"));
    // 번호 이름도 상한 안이다
    touch(Path::new(&c.path));
    let c2 = check(dir.path(), &long, AUDIO_QUALITY_ID);
    let free = c2.free_file_name.unwrap();
    assert!(free.ends_with(" (2)"));
    assert!(free.len() + ".m4a".len() <= chzzk_core::naming::MAX_FILENAME_BYTES);
}

/// 사용자가 `.m4a`를 붙여 넣어도 확장자는 하나다.
#[test]
fn check_output_strips_pasted_m4a() {
    let dir = tempfile::tempdir().unwrap();
    let c = check(dir.path(), "a.m4a", AUDIO_QUALITY_ID);
    assert_eq!(c.file_name, "a");
    assert!(c.truncated);
    assert_eq!(Path::new(&c.path), dir.path().join("a.m4a"));
}

/// `.m4a.part`가 같은 작업(화질 `audio`)의 것인지 판정한다.
#[tokio::test]
async fn check_output_reads_audio_partial() {
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path().join("a.m4a");
    let mut sc = Sidecar::new(CONTENT, AUDIO_QUALITY_ID, PlaybackKind::Progressive);
    sc.progressive = Some(ProgressiveState {
        total_len: Some(1000),
    });
    let mut p = PartFile::create(&out, sc).unwrap();
    p.write(&[1u8; 300]).unwrap();
    p.checkpoint(|_| {}).await.unwrap();
    drop(p);
    let c = check(dir.path(), "a", AUDIO_QUALITY_ID);
    let partial = c.partial.expect(".part가 보여야 한다");
    assert_eq!(partial.bytes, 300);
    assert!(partial.same_job);
    // 같은 이름이어도 비디오 화질로 보면 다른 작업(경로가 달라 보이지 않는다)
    assert!(check(dir.path(), "a", "PD_720P").partial.is_none());
}

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

/// 오디오 작업은 `.m4a` 경로와 `audioOnly`로 표현된다. `jobs.json`에는 새 필드가 없고 화질 키·경로만 남는다(A10).
#[tokio::test(start_paused = true)]
async fn enqueue_audio_job_has_m4a_output_and_audio_flag() {
    let h = Harness::new(1);
    let job = h.mgr.enqueue(audio_request("a"), &h.defaults()).unwrap();
    assert!(job.audio_only);
    assert!(job.output.ends_with("a.m4a"), "{}", job.output);
    assert_eq!(job.quality_label, "오디오만");
    until("완료", || h.status(job.id) == JobStatus::Completed).await;
    assert!(h.job(job.id).audio_only);

    let rec = &h.jobs_json()["jobs"][0];
    assert_eq!(rec["qualityId"], "audio");
    assert!(rec["output"].as_str().unwrap().ends_with("a.m4a"));
    assert!(rec.get("audioOnly").is_none(), "저장하지 않는다: {rec}");

    // 코어에는 화질 `audio`와 `.m4a` 출력이 간다
    let reqs = h.fake.download_requests();
    assert_eq!(reqs[0].quality_id, AUDIO_QUALITY_ID);
    assert!(reqs[0].output.to_string_lossy().ends_with("a.m4a"));

    // 비디오 작업은 audioOnly가 아니다
    let v = h.enqueue("b");
    assert!(!v.audio_only);
    assert!(v.output.ends_with("b.mp4"));
}

/// 같은 이름의 영상과 오디오는 경로가 달라 동시에 있을 수 있다. 오디오끼리는 `duplicateOutput`이다.
#[tokio::test(start_paused = true)]
async fn audio_and_video_with_same_name_do_not_collide() {
    let h = Harness::new(1);
    let v = h.enqueue("same");
    let a = h.mgr.enqueue(audio_request("same"), &h.defaults()).unwrap();
    assert_ne!(v.output, a.output);
    let e = h
        .mgr
        .enqueue(audio_request("same"), &h.defaults())
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::DuplicateOutput);
}

/// 오디오는 채팅·구간·클립·빠른 다시보기와 함께 쓰지 못한다(가드를 지우면 실패해야 한다).
#[tokio::test(start_paused = true)]
async fn enqueue_rejects_audio_with_chat_range_clip_and_non_progressive() {
    let h = Harness::new(1);
    let mut chat = audio_request("chat");
    chat.save_chat = true;
    let mut range = audio_request("range");
    range.range = Some(TimeRangeDto {
        start_ms: 0,
        end_ms: Some(1_000),
    });
    let mut clip = audio_request("clip");
    clip.url = "https://chzzk.naver.com/clips/abc".into();
    clip.content = ContentRef::Clip {
        clip_id: "abc".into(),
    };
    let rewind = EnqueueRequest {
        expected_kind: PlaybackKind::LiveRewindHls,
        ..audio_request("rewind")
    };
    let live = EnqueueRequest {
        expected_kind: PlaybackKind::Live,
        content: ContentRef::Live {
            channel_id: "000000000000000000000000000000e5".into(),
        },
        ..audio_request("live")
    };
    for r in [chat, range, clip, rewind, live] {
        let e = h.mgr.enqueue(r, &h.defaults()).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput);
    }
    assert!(h.mgr.list().is_empty());
    // 채팅을 고르지 않은 오디오는 받는다
    assert!(h.mgr.enqueue(audio_request("ok"), &h.defaults()).is_ok());
}

/// 비디오 화질인데 출력이 `.m4a`가 되는 경로는 없다: 웹뷰가 보낸 이름 끝의 `.m4a`는 `.mp4`가 덧붙는다.
#[tokio::test(start_paused = true)]
async fn video_job_never_gets_m4a_output() {
    let h = Harness::new(1);
    let mut r = request("x.m4a");
    r.expected_kind = PlaybackKind::Progressive;
    r.quality_id = "PD_720P".into();
    let job = h.mgr.enqueue(r, &h.defaults()).unwrap();
    assert!(job.output.ends_with("x.m4a.mp4"), "{}", job.output);
    assert!(!job.audio_only);
}

/// 완료된 오디오 작업에는 채팅만 받기도 막힌다(A9): 옆 파일이 `x.m4a.ass`가 되기 때문이다. 영상 작업은 같은 길로 통과한다.
#[tokio::test(start_paused = true)]
async fn chat_only_is_rejected_for_completed_audio_job() {
    let h = Harness::new(2);
    let a = h.mgr.enqueue(audio_request("a"), &h.defaults()).unwrap();
    let v = h.enqueue("v");
    until("완료", || {
        h.status(a.id) == JobStatus::Completed && h.status(v.id) == JobStatus::Completed
    })
    .await;
    // 가짜 백엔드는 파일을 쓰지 않으므로 영상 파일 유무 검사까지 가도록 두 출력을 만든다
    std::fs::create_dir_all(h.downloads()).unwrap();
    touch(Path::new(&a.output));
    touch(Path::new(&v.output));

    let ok = |_: &ContentRef| Ok(None);
    let e = h
        .mgr
        .start_chat(a.id, false, OnExisting::Skip, SubtitleFormat::Ass, ok)
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    assert!(e.message.contains("오디오만 받기"), "{}", e.message);
    assert_eq!(
        h.mgr.chat_content(a.id).unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert_eq!(
        h.mgr
            .check_chat_output(a.id, SubtitleFormat::Ass)
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    // 거부는 상태를 바꾸지 않는다
    assert_eq!(h.status(a.id), JobStatus::Completed);

    // 같은 조건의 영상 작업은 가드에 걸리지 않는다(가드가 영상까지 막지 않는지 확인)
    assert!(h.mgr.chat_content(v.id).is_ok());
    assert!(h.mgr.check_chat_output(v.id, SubtitleFormat::Ass).is_ok());
}

// ---------------------------------------------------------------------------
// jobs.json 호환
// ---------------------------------------------------------------------------

/// 오디오 레코드를 다시 열어도 `audioOnly`가 화질 키에서 계산된다. 옛 레코드(오디오를 모르던 때의 비디오 작업)도 읽힌다.
#[tokio::test(start_paused = true)]
async fn audio_flag_is_computed_from_stored_quality_id() {
    let h = Harness::new(1);
    let a = h.mgr.enqueue(audio_request("a"), &h.defaults()).unwrap();
    let v = h.enqueue("v");
    until("완료", || {
        h.status(a.id) == JobStatus::Completed && h.status(v.id) == JobStatus::Completed
    })
    .await;
    let mgr = h.reopen(1);
    let list = mgr.list();
    let a2 = list.iter().find(|j| j.id == a.id).unwrap();
    let v2 = list.iter().find(|j| j.id == v.id).unwrap();
    assert!(a2.audio_only);
    assert!(!v2.audio_only);
    assert!(a2.output.ends_with("a.m4a"));
}

// ---------------------------------------------------------------------------
// 마지막 화질
// ---------------------------------------------------------------------------

/// 오디오 작업을 추가해도 마지막 화질은 바뀌지 않는다(A8). 최근 영상 기록은 남는다.
#[tokio::test(start_paused = true)]
async fn audio_enqueue_does_not_change_last_quality_label() {
    let h = Harness::new(2);
    let t = TempDir::new().unwrap();
    let svc = SettingsService::open(
        &AppPaths::new(
            t.path().join("config"),
            t.path().join("data"),
            t.path().join("log"),
            None,
            None,
            None,
        ),
        ClientConfig::default(),
        None,
    )
    .unwrap();
    let gate = OwnershipGate::disabled();

    // 오디오가 먼저여도 마지막 화질은 비어 있다. 최근 영상에는 올라간다
    let first = audio_request("a0");
    let title = first.title.clone();
    enqueue(&svc, &gate, &h.mgr, first).await.unwrap();
    let d = svc.get();
    assert_eq!(d.last_quality_label, None);
    assert_eq!(d.recent_vods[0].title, title);
    assert_eq!(d.recent_vods[0].kind, Some(RecentKind::Vod));

    // 비디오 뒤의 오디오도 그 라벨을 지우거나 덮지 않는다
    let mut vod = request("v");
    vod.expected_kind = PlaybackKind::Progressive;
    vod.quality_id = "PD_1080P".into();
    vod.quality_label = "1080p".into();
    enqueue(&svc, &gate, &h.mgr, vod).await.unwrap();
    assert_eq!(svc.get().last_quality_label.as_deref(), Some("1080p"));
    let second = audio_request("a1");
    let title = second.title.clone();
    enqueue(&svc, &gate, &h.mgr, second).await.unwrap();
    let d = svc.get();
    assert_eq!(d.last_quality_label.as_deref(), Some("1080p"));
    assert_eq!(d.recent_vods[0].title, title);
}
