//! 구간 받기의 셸 쪽(range.md §4.1, ②-2): `enqueue` 재검증·기록, 작업 목록 표시, 재개 요청, `jobs.json` 왕복.
//!
//! 셸은 영상 길이를 모른다. 시작 < 끝과 "빠른 다시보기에만"까지만 거르고, 실제 범위 밖은 코어 `rangeOutOfBounds`가 낸다.

mod common;

use std::path::Path;
use std::time::Duration;

use chzzk_core::download::part::{
    HlsRange, HlsState, SIDECAR_VERSION_RANGE, Sidecar, part_path, sidecar_path,
};
use chzzk_core::fsutil::atomic_write;
use chzzk_core::{ContentRef, Error, PlaybackKind, TimeRange};
use chzzk_shell::ErrorCode;
use chzzk_shell::dto::{EnqueueRequest, JobStatus, TimeRangeDto};
use common::fake::Script;
use common::harness::{Harness, live_request, open_with, request, until};

fn dto(start_ms: u64, end_ms: Option<u64>) -> TimeRangeDto {
    TimeRangeDto { start_ms, end_ms }
}

fn with_range(name: &str, r: TimeRangeDto) -> EnqueueRequest {
    EnqueueRequest {
        range: Some(r),
        ..request(name)
    }
}

/// 코어가 체크포인트에 쓰는 것처럼 구간 `.part`(길이 `len`)와 v2 sidecar(`committed`)를 만든다.
fn range_checkpoint(output: &Path, len: usize, committed: u64, r: TimeRange) {
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    std::fs::write(part_path(output), vec![1u8; len]).unwrap();
    let mut sc = Sidecar::new(
        ContentRef::Video { video_no: 1 },
        "720p",
        PlaybackKind::LiveRewindHls,
    );
    sc.v = SIDECAR_VERSION_RANGE;
    sc.committed_len = committed;
    sc.hls = Some(HlsState {
        next_index: 3,
        segment_count: 12,
        durations_crc: 0,
        init_len: 0,
        media_sequence: 0,
        range: Some(HlsRange {
            first: 3,
            last_excl: 12,
            start_ms: r.start_ms,
            end_ms: r.end_ms,
        }),
    });
    atomic_write(&sidecar_path(output), &serde_json::to_vec(&sc).unwrap()).unwrap();
}

/// 사용자가 넣은 값 그대로 기록한다(끝 없음은 `None`, 센티널 없음). 작업 목록에도 같은 값이 나온다.
#[tokio::test(start_paused = true)]
async fn enqueue_records_raw_range() {
    let h = Harness::new(1);
    let id = h
        .mgr
        .enqueue(with_range("a", dto(600_000, None)), &h.defaults())
        .unwrap()
        .id;
    assert_eq!(h.job(id).range, Some(dto(600_000, None)));
    let j = &h.jobs_json()["jobs"][0]["range"];
    assert_eq!(j["startMs"], 600_000);
    assert!(j["endMs"].is_null(), "끝 없음은 null: {j}");

    let id2 = h
        .mgr
        .enqueue(with_range("b", dto(1_500, Some(2_999_999))), &h.defaults())
        .unwrap()
        .id;
    // 초 미만도 정규화하지 않는다
    assert_eq!(h.job(id2).range, Some(dto(1_500, Some(2_999_999))));
    // 구간이 없는 작업은 null
    let id3 = h.enqueue("c").id;
    assert_eq!(h.job(id3).range, None);
}

#[tokio::test(start_paused = true)]
async fn enqueue_rejects_range_shell_can_judge() {
    let h = Harness::new(1);
    let bad: Vec<(&str, EnqueueRequest)> = vec![
        ("시작 = 끝", with_range("a", dto(5_000, Some(5_000)))),
        ("시작 > 끝", with_range("b", dto(9_000, Some(5_000)))),
        (
            "일반 VOD",
            EnqueueRequest {
                expected_kind: PlaybackKind::Progressive,
                ..with_range("c", dto(0, Some(1_000)))
            },
        ),
        (
            "생방송",
            EnqueueRequest {
                range: Some(dto(0, Some(1_000))),
                ..live_request("d")
            },
        ),
        (
            "클립",
            EnqueueRequest {
                content: ContentRef::Clip {
                    clip_id: "c".into(),
                },
                url: "https://chzzk.naver.com/clips/c".into(),
                expected_kind: PlaybackKind::Progressive,
                ..with_range("e", dto(0, None))
            },
        ),
    ];
    for (what, req) in bad {
        let e = h.mgr.enqueue(req, &h.defaults()).unwrap_err();
        assert_eq!(e.code, ErrorCode::InvalidInput, "{what}");
    }
    assert!(
        h.mgr.list().is_empty(),
        "거부한 요청은 작업을 만들지 않는다"
    );
    // 길이를 모르니 시작이 큰 값이어도 셸은 받는다(코어 rangeOutOfBounds가 낸다)
    h.mgr
        .enqueue(with_range("ok", dto(u32::MAX as u64, None)), &h.defaults())
        .unwrap();
}

/// `check_output`도 `enqueue`와 같은 규칙으로 구간을 거른다(셸 안의 두 진입점이 어긋나지 않게).
#[tokio::test(start_paused = true)]
async fn check_output_rejects_range_enqueue_would_reject() {
    let h = Harness::new(1);
    let content = ContentRef::Video { video_no: 1 };
    let check = |kind, r| {
        h.mgr.check_output(
            None,
            &h.downloads(),
            "a",
            &content,
            "720p",
            kind,
            Some(r),
            None,
        )
    };
    let e = check(PlaybackKind::Progressive, dto(5_000, Some(10_000))).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    let e = check(PlaybackKind::LiveRewindHls, dto(5_000, Some(5_000))).unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
    let ok = check(PlaybackKind::LiveRewindHls, dto(5_000, Some(10_000))).unwrap();
    assert_eq!(ok.file_name, "a (0.00.05~0.00.10)");
}

/// 일시정지 → 재개: 코어 요청의 `range`는 기록한 원값 그대로이고, 구간 `.part`를 이어받을 수 있는 것으로 센다.
#[tokio::test(start_paused = true)]
async fn resume_sends_recorded_range_and_counts_range_partial() {
    let h = Harness::new(2);
    let out = h.output("a");
    let r = TimeRange {
        start_ms: 7_500,
        end_ms: None,
    };
    h.fake.script_for(
        &out,
        Script::new()
            .bytes(100, Some(1000))
            .until_cancelled()
            .linger(Duration::from_millis(20))
            .fails(Error::Cancelled),
    );
    let id = h
        .mgr
        .enqueue(with_range("a", dto(7_500, None)), &h.defaults())
        .unwrap()
        .id;
    until("진행", || h.job(id).progress.is_some()).await;
    range_checkpoint(&out, 150, 128, r);
    h.mgr.pause(id).unwrap();
    until("paused", || h.status(id) == JobStatus::Paused).await;
    assert_eq!(
        h.job(id).partial_bytes,
        Some(128),
        "구간 sidecar의 주인은 구간을 아는 작업이다"
    );

    h.fake
        .script_for(&out, Script::new().bytes(1000, Some(1000)));
    h.mgr.resume(id, false).unwrap();
    until("완료", || h.status(id) == JobStatus::Completed).await;
    let reqs = h.fake.download_requests();
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[0].range, Some(r));
    assert_eq!(
        reqs[1].range,
        Some(r),
        "재개 요청은 JobRecord.range 원값 그대로"
    );
}

/// 앱을 껐다 켜도(`jobs.json` 왕복) 같은 구간으로 다시 받는다.
#[tokio::test(start_paused = true)]
async fn range_survives_jobs_json_round_trip() {
    let h = Harness::new(1);
    let out = h.output("a");
    h.fake.script_for(&out, Script::new().wait_cancel());
    let id = h
        .mgr
        .enqueue(
            with_range("a", dto(600_000, Some(1_200_000))),
            &h.defaults(),
        )
        .unwrap()
        .id;
    until("진행", || h.fake.active() == 1).await;
    h.mgr.pause(id).unwrap();
    until("paused", || h.status(id) == JobStatus::Paused).await;
    h.mgr.flush();
    let fake = h.fake.clone();
    let m2 = open_with(h.dir.path(), &fake, 1, false);
    assert_eq!(m2.list()[0].range, Some(dto(600_000, Some(1_200_000))));
    fake.script_for(&out, Script::new().bytes(10, Some(10)));
    m2.resume(id, false).unwrap();
    until("완료", || m2.list()[0].status == JobStatus::Completed).await;
    let last = fake.download_requests().pop().unwrap();
    assert_eq!(
        last.range,
        Some(TimeRange {
            start_ms: 600_000,
            end_ms: Some(1_200_000)
        })
    );
}

/// v0.7.0 이전 `jobs.json`(`range` 없음)은 구간 없는 작업이다.
#[test]
fn old_record_without_range_means_full() {
    let rec: chzzk_shell::jobs::JobRecord = serde_json::from_value(serde_json::json!({
        "id": 1, "url": "u", "content": {"kind": "video", "videoNo": 1}, "title": "t",
        "channelName": "c", "kind": "video", "qualityId": "720p", "qualityLabel": "720p",
        "expectedKind": "liveRewindHls", "output": "/x/a.mp4", "onExisting": "overwrite",
        "concurrency": 4, "status": "queued", "createdAt": 1
    }))
    .unwrap();
    assert_eq!(rec.range, None);
    assert_eq!(rec.to_request().range, None);
}
