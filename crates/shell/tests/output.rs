//! `check_output`(app.md §6.4, §15-8): 최종 경로·이름 변경, 완성 파일과 번호 이름, `.part`, 목록 중복.

mod common;

use std::path::Path;

use chzzk_core::TimeRange;
use chzzk_core::download::part::{
    HlsRange, HlsState, SIDECAR_VERSION_RANGE, Sidecar, part_path, sidecar_path,
};
use chzzk_core::fsutil::atomic_write;
use chzzk_core::naming::{MAX_FILENAME_BYTES, output_path};
use chzzk_core::{ContentRef, Platform, PlaybackKind};
use chzzk_shell::dto::{OutputCheck, PartialInfo};
use chzzk_shell::output::{OutputQuery, check_output};
use chzzk_shell::{ErrorCode, JobId};
use common::fake::Script;
use common::harness::{Harness, settle};

const CONTENT: ContentRef = ContentRef::Video { video_no: 1 };

fn check(folder: &Path, name: &str, active: &dyn Fn(&Path) -> Option<JobId>) -> OutputCheck {
    check_output(
        &OutputQuery {
            folder,
            file_name: name,
            content: &CONTENT,
            quality_id: "720p",
            kind: PlaybackKind::LiveRewindHls,
            platform: Platform::current(),
            range: None,
            chat: None,
        },
        active,
    )
}

fn none(_: &Path) -> Option<JobId> {
    None
}

fn touch(p: &Path) {
    std::fs::write(p, b"x").unwrap();
}

#[test]
fn clean_name_has_no_conflicts() {
    let dir = tempfile::tempdir().unwrap();
    let c = check(dir.path(), "[251003] 채널 - 제목", &none);
    assert_eq!(c.file_name, "[251003] 채널 - 제목");
    assert_eq!(
        Path::new(&c.path),
        dir.path().join("[251003] 채널 - 제목.mp4")
    );
    assert!(!c.truncated && !c.exists);
    assert_eq!(c.free_file_name, None);
    assert_eq!(c.partial, None);
    assert_eq!(c.duplicate_job_id, None);
}

#[test]
fn changed_or_long_name_is_truncated() {
    let dir = tempfile::tempdir().unwrap();
    let long = "가".repeat(100); // 300바이트
    let c = check(dir.path(), &long, &none);
    assert!(c.truncated);
    assert!(c.file_name.len() + ".mp4".len() <= MAX_FILENAME_BYTES);
    assert!(long.starts_with(&c.file_name));

    // 앞뒤 공백은 지워진다
    assert!(check(dir.path(), " a ", &none).truncated);
    // 사용자가 .mp4를 붙여 넣어도 확장자는 하나다
    let c = check(dir.path(), "a.mp4", &none);
    assert_eq!(c.file_name, "a");
    assert!(c.truncated);
    if Platform::current() != Platform::Linux {
        let c = check(dir.path(), "a:b", &none);
        assert_eq!(c.file_name, "a_b");
        assert!(c.truncated);
    }
}

/// 완성 파일이 있으면 완성 파일·`.part`·활성 작업 어디에도 없는 첫 번호 이름.
#[test]
fn free_name_skips_files_partials_and_jobs() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    touch(&d.join("a.mp4"));
    let c = check(d, "a", &none);
    assert!(c.exists);
    assert_eq!(c.free_file_name.as_deref(), Some("a (2)"));

    touch(&d.join("a (2).mp4"));
    touch(&part_path(&d.join("a (3).mp4")));
    let busy = d.join("a (4).mp4");
    let active = move |p: &Path| (p == busy).then_some(JobId(9));
    let c = check(d, "a", &active);
    assert_eq!(c.free_file_name.as_deref(), Some("a (5)"));
    assert_eq!(c.duplicate_job_id, None, "원래 이름은 목록에 없다");
}

/// 200바이트 이름도 번호가 잘리지 않게 이름 쪽을 줄인다.
#[test]
fn free_name_keeps_suffix_within_limit() {
    let dir = tempfile::tempdir().unwrap();
    let long = "나".repeat(100);
    let first = check(dir.path(), &long, &none);
    touch(Path::new(&first.path));
    let c = check(dir.path(), &long, &none);
    let free = c.free_file_name.unwrap();
    assert!(free.ends_with(" (2)"), "{free}");
    assert!(free.len() + ".mp4".len() <= MAX_FILENAME_BYTES);
    // 그 이름을 다시 넣으면 그대로 쓰인다(더 잘리지 않는다)
    let again = check(dir.path(), &free, &none);
    assert!(!again.truncated);
    assert!(!again.exists);
}

fn sidecar(quality: &str, committed: u64) -> Vec<u8> {
    let mut sc = Sidecar::new(CONTENT, quality, PlaybackKind::LiveRewindHls);
    sc.committed_len = committed;
    serde_json::to_vec(&sc).unwrap()
}

#[test]
fn partial_same_job_other_job_and_no_sidecar() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();

    let same = d.join("same.mp4");
    std::fs::write(part_path(&same), vec![0u8; 900]).unwrap();
    atomic_write(&sidecar_path(&same), &sidecar("720p", 800)).unwrap();
    assert_eq!(
        check(d, "same", &none).partial,
        Some(PartialInfo {
            bytes: 800,
            same_job: true,
            recording: false
        })
    );

    let other = d.join("other.mp4");
    std::fs::write(part_path(&other), vec![0u8; 900]).unwrap();
    atomic_write(&sidecar_path(&other), &sidecar("1080p", 700)).unwrap();
    assert_eq!(
        check(d, "other", &none).partial,
        Some(PartialInfo {
            bytes: 700,
            same_job: false,
            recording: false
        })
    );

    let bare = d.join("bare.mp4");
    std::fs::write(part_path(&bare), vec![0u8; 321]).unwrap();
    assert_eq!(
        check(d, "bare", &none).partial,
        Some(PartialInfo {
            bytes: 321,
            same_job: false,
            recording: false
        })
    );
    // .part만 있으면 완성 파일이 아니다(중복이 아니라 이어받기 후보)
    let c = check(d, "bare", &none);
    assert!(!c.exists);
    assert_eq!(c.free_file_name, None);

    // sidecar만 남은 것은 .part가 아니다
    let ghost = d.join("ghost.mp4");
    atomic_write(&sidecar_path(&ghost), &sidecar("720p", 5)).unwrap();
    assert_eq!(check(d, "ghost", &none).partial, None);
}

/// 매니저 경유: 같은 경로의 활성 작업이 `duplicateJobId`로 나오고, 폴더 규칙은 `enqueue`와 같다.
#[tokio::test(start_paused = true)]
async fn manager_check_output_reports_duplicate() {
    let h = Harness::new(1);
    h.fake
        .script_for(h.output("a"), Script::new().wait_cancel());
    let a = h.enqueue("a").id;
    settle().await;
    let c = h
        .mgr
        .check_output(
            None,
            &h.downloads(),
            "a",
            &CONTENT,
            "720p",
            PlaybackKind::LiveRewindHls,
            None,
            None,
        )
        .unwrap();
    assert_eq!(c.duplicate_job_id, Some(a));
    assert_eq!(Path::new(&c.path), h.output("a"));

    let other = h.dir.path().join("other");
    let c = h
        .mgr
        .check_output(
            Some(&other.to_string_lossy()),
            &h.downloads(),
            "a",
            &CONTENT,
            "720p",
            PlaybackKind::LiveRewindHls,
            None,
            None,
        )
        .unwrap();
    assert_eq!(c.duplicate_job_id, None);
    assert_eq!(Path::new(&c.path), other.join("a.mp4"));

    let e = h
        .mgr
        .check_output(
            Some("rel"),
            &h.downloads(),
            "a",
            &CONTENT,
            "720p",
            PlaybackKind::LiveRewindHls,
            None,
            None,
        )
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
}

/// 다시 받을 수 없는 생방송 녹화의 `.part`: 완성 파일이 없어도 번호 이름을 주고, 어떤 질의도 주인으로 보지 않는다.
#[test]
fn partial_recording_gets_free_name() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    let live = ContentRef::Live {
        channel_id: "000000000000000000000000000000e5".into(),
    };
    let rec = d.join("rec.mp4");
    std::fs::write(part_path(&rec), vec![0u8; 900]).unwrap();
    let mut sc = Sidecar::new(live.clone(), "144p", PlaybackKind::Live);
    sc.committed_len = 800;
    sc.recording_id = Some("a".repeat(32));
    atomic_write(&sidecar_path(&rec), &serde_json::to_vec(&sc).unwrap()).unwrap();

    let q = |content: &ContentRef, kind| {
        check_output(
            &OutputQuery {
                folder: d,
                file_name: "rec",
                content,
                quality_id: "144p",
                kind,
                platform: Platform::current(),
                range: None,
                chat: None,
            },
            &none,
        )
    };
    // 같은 방송을 다시 붙여넣어도
    let c = q(&live, PlaybackKind::Live);
    assert!(!c.exists);
    assert_eq!(
        c.partial,
        Some(PartialInfo {
            bytes: 800,
            same_job: false,
            recording: true
        })
    );
    assert_eq!(c.free_file_name.as_deref(), Some("rec (2)"));
    // 같은 이름의 VOD도
    let v = q(&CONTENT, PlaybackKind::Progressive);
    assert!(v.partial.is_some_and(|p| p.recording && !p.same_job));
    assert_eq!(v.free_file_name.as_deref(), Some("rec (2)"));
    // 번호 이름이 이미 `.part`로 쓰이면 그것도 피한다
    std::fs::write(part_path(&d.join("rec (2).mp4")), b"x").unwrap();
    assert_eq!(
        q(&live, PlaybackKind::Live).free_file_name.as_deref(),
        Some("rec (3)")
    );
}

// ---------------------------------------------------------------------------
// 구간 받기(range.md §4.1·§4.2, ②-2)
// ---------------------------------------------------------------------------

const ALL: [Platform; 3] = [Platform::Windows, Platform::MacOs, Platform::Linux];

fn tr(start_ms: u64, end_ms: Option<u64>) -> TimeRange {
    TimeRange { start_ms, end_ms }
}

fn check_range(
    folder: &Path,
    name: &str,
    range: Option<TimeRange>,
    platform: Platform,
) -> OutputCheck {
    check_output(
        &OutputQuery {
            folder,
            file_name: name,
            content: &CONTENT,
            quality_id: "720p",
            kind: PlaybackKind::LiveRewindHls,
            platform,
            range,
            chat: None,
        },
        &none,
    )
}

#[test]
fn range_suffix_is_appended_once_by_check_output() {
    let dir = tempfile::tempdir().unwrap();
    let c = check_range(
        dir.path(),
        "제목",
        Some(tr(600_000, Some(1_200_000))),
        Platform::current(),
    );
    assert_eq!(c.file_name, "제목 (0.10.00~0.20.00)");
    assert!(c.truncated, "최종 이름이 입력과 다르다(구간 접미사)");
    assert_eq!(
        Path::new(&c.path),
        dir.path().join("제목 (0.10.00~0.20.00).mp4")
    );
    // 끝을 모르면 끝 시각을 지어내지 않는다
    let open = check_range(
        dir.path(),
        "제목",
        Some(tr(600_000, None)),
        Platform::current(),
    );
    assert_eq!(open.file_name, "제목 (0.10.00~)");
    // 구간이 없으면 그대로(전체 받기)
    let full = check_range(dir.path(), "제목", None, Platform::current());
    assert_eq!(full.file_name, "제목");
    assert!(!full.truncated);
}

/// `enqueue`는 `check.fileName`으로 `output_path`를 다시 만든다. 그 경로가 `check.path`와 같아야 접미사가 두 번 붙지 않는다.
#[test]
fn range_name_round_trips_through_output_path_on_three_platforms() {
    let dir = tempfile::tempdir().unwrap();
    let r = tr(3_723_000, Some(7_200_000));
    for p in ALL {
        for title in [
            "제목".to_string(),
            "a:b?c".to_string(),
            "가".repeat(100),
            "x".repeat(250),
            "CON".to_string(),
        ] {
            let c = check_range(dir.path(), &title, Some(r), p);
            assert!(
                c.file_name.ends_with(" (1.02.03~2.00.00)"),
                "{p:?} {}",
                c.file_name
            );
            // 호스트와 다른 OS의 이름(예: `a:b`)은 `check_output` 안의 호스트 경로 해석부터 의미가 달라진다
            // (Windows 호스트는 `a:`를 드라이브 접두사로 뗀다). 제품은 늘 호스트 Platform만 쓰므로
            // 경로 왕복은 호스트와 같은 Platform에서만 보고, 나머지는 위의 접미사 단언과 이름 길이만 본다.
            if p != Platform::current() {
                assert_eq!(c.file_name.matches("(1.02.03").count(), 1, "{p:?}");
                continue;
            }
            let again = output_path(dir.path(), &c.file_name, p);
            assert_eq!(again, Path::new(&c.path), "{p:?} {title:?}");
            let name = Path::new(&c.path)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .to_string();
            assert!(name.len() <= MAX_FILENAME_BYTES, "{p:?} {}", name.len());
            assert!(name.ends_with(" (1.02.03~2.00.00).mp4"), "{p:?} {name}");
            assert_eq!(name.matches("(1.02.03").count(), 1);
        }
    }
}

/// 긴 제목이어도 다른 구간은 다른 경로다(접미사가 잘리지 않는다).
#[test]
fn long_title_keeps_range_distinct_on_three_platforms() {
    let dir = tempfile::tempdir().unwrap();
    let long = "나".repeat(100);
    for p in ALL {
        let a = check_range(dir.path(), &long, Some(tr(0, Some(10_000))), p);
        let b = check_range(dir.path(), &long, Some(tr(10_000, Some(20_000))), p);
        assert_ne!(a.path, b.path, "{p:?}");
        assert!(a.truncated && b.truncated);
    }
}

#[test]
fn numbered_name_keeps_range_suffix_before_number() {
    let dir = tempfile::tempdir().unwrap();
    let r = tr(600_000, Some(1_200_000));
    for p in ALL {
        let first = check_range(dir.path(), "제목", Some(r), p);
        touch(Path::new(&first.path));
        let c = check_range(dir.path(), "제목", Some(r), p);
        assert!(c.exists);
        assert_eq!(
            c.free_file_name.as_deref(),
            Some("제목 (0.10.00~0.20.00) (2)"),
            "{p:?}"
        );
        std::fs::remove_file(&first.path).unwrap();
    }
}

/// 긴 제목의 번호 이름도 구간 접미사를 지키고 제목 쪽만 줄어든다.
#[test]
fn numbered_long_name_cuts_title_not_range_suffix() {
    let dir = tempfile::tempdir().unwrap();
    let r = tr(600_000, Some(1_200_000));
    let long = "다".repeat(100);
    for p in ALL {
        let first = check_range(dir.path(), &long, Some(r), p);
        touch(Path::new(&first.path));
        let c = check_range(dir.path(), &long, Some(r), p);
        let free = c.free_file_name.unwrap();
        assert!(free.ends_with(" (0.10.00~0.20.00) (2)"), "{p:?} {free}");
        assert!(free.len() + ".mp4".len() <= MAX_FILENAME_BYTES, "{p:?}");
        // 번호 이름을 다시 넣어도 더 잘리거나 접미사가 늘지 않는다(enqueue는 그대로 쓴다)
        assert_eq!(
            output_path(dir.path(), &free, p)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap(),
            format!("{free}.mp4")
        );
        std::fs::remove_file(&first.path).unwrap();
    }
}

fn range_sidecar(r: TimeRange) -> Vec<u8> {
    let mut sc = Sidecar::new(CONTENT, "720p", PlaybackKind::LiveRewindHls);
    sc.v = SIDECAR_VERSION_RANGE;
    sc.committed_len = 800;
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
    serde_json::to_vec(&sc).unwrap()
}

/// 같은 이름·다른 구간의 `.part`는 `partial.sameJob = false`(카드는 `conflict.partialOther`)다.
#[test]
fn same_name_other_range_is_partial_other() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    let a = tr(7_000, Some(23_000));
    // 접미사는 같지만(초 단위) 요청 시각이 다른 구간: 같은 경로를 쓴다
    let sub_second = tr(7_500, Some(23_000));
    let out = check_range(d, "제목", Some(a), Platform::current());
    let path = Path::new(&out.path).to_path_buf();
    std::fs::write(part_path(&path), vec![0u8; 900]).unwrap();
    atomic_write(&sidecar_path(&path), &range_sidecar(a)).unwrap();

    let same = |range| {
        check_range(d, "제목", range, Platform::current())
            .partial
            .map(|p| (p.same_job, p.bytes))
    };
    assert_eq!(same(Some(a)), Some((true, 800)));
    assert_eq!(same(Some(sub_second)), Some((false, 800)));
    // 끝이 없으면 접미사가 달라져 다른 경로라 이 `.part`는 보이지 않는다
    assert_eq!(same(Some(tr(7_000, None))), None);
    // 구간 없는 요청(전체 받기)이 같은 경로를 보면 다른 작업이다
    let full = check_range(d, "제목 (0.00.07~0.00.23)", None, Platform::current());
    assert_eq!(full.partial.map(|p| p.same_job), Some(false));
}

/// 끝 없음 `.part`는 끝 없음 요청과만 같은 작업이다(`same_job`의 '끝 없음' 행).
#[test]
fn open_ended_range_partial_matches_only_open_ended() {
    let dir = tempfile::tempdir().unwrap();
    let d = dir.path();
    let open = tr(600_000, None);
    let c = check_range(d, "제목", Some(open), Platform::current());
    let path = Path::new(&c.path).to_path_buf();
    std::fs::write(part_path(&path), vec![0u8; 900]).unwrap();
    atomic_write(&sidecar_path(&path), &range_sidecar(open)).unwrap();
    let q = |r| {
        check_range(d, "제목", r, Platform::current())
            .partial
            .map(|p| p.same_job)
    };
    assert_eq!(q(Some(open)), Some(true));
    // 접미사는 같지만(초 단위) 시작 시각이 다른 끝 없음 구간
    assert_eq!(q(Some(tr(600_500, None))), Some(false));
    // 끝이 있는 구간은 접미사가 달라 이 `.part`가 보이지 않는다
    assert_eq!(q(Some(tr(600_000, Some(1_200_000)))), None);
    // 구간 없는 요청이 접미사까지 직접 친 같은 이름을 보면 다른 작업이다
    let full = check_range(d, "제목 (0.10.00~)", None, Platform::current());
    assert_eq!(full.partial.map(|p| p.same_job), Some(false));
}
