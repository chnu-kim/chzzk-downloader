//! `check_output`(app.md §6.4, §15-8): 최종 경로·이름 변경, 완성 파일과 번호 이름, `.part`, 목록 중복.

mod common;

use std::path::Path;

use chzzk_core::download::part::{Sidecar, part_path, sidecar_path};
use chzzk_core::fsutil::atomic_write;
use chzzk_core::naming::MAX_FILENAME_BYTES;
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
            same_job: true
        })
    );

    let other = d.join("other.mp4");
    std::fs::write(part_path(&other), vec![0u8; 900]).unwrap();
    atomic_write(&sidecar_path(&other), &sidecar("1080p", 700)).unwrap();
    assert_eq!(
        check(d, "other", &none).partial,
        Some(PartialInfo {
            bytes: 700,
            same_job: false
        })
    );

    let bare = d.join("bare.mp4");
    std::fs::write(part_path(&bare), vec![0u8; 321]).unwrap();
    assert_eq!(
        check(d, "bare", &none).partial,
        Some(PartialInfo {
            bytes: 321,
            same_job: false
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
        )
        .unwrap_err();
    assert_eq!(e.code, ErrorCode::InvalidInput);
}
