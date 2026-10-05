//! 실서버 스모크(설계 §10-15). 모두 `#[ignore]`이고 환경 변수로 대상을 준다.
//!
//! ```text
//! CHZZK_LIVE_HLS=<빠른 다시보기 videoNo> CHZZK_LIVE_DASH=<일반 VOD videoNo> CHZZK_LIVE_CLIP=<clipId> \
//!   cargo test -p chzzk-core --test live -- --ignored --nocapture
//! ```
//!
//! VOD는 가장 작은 화질로 몇 MB만 받고 취소한 뒤 `.part`의 MP4 상자를 검사한다. 클립은 끝까지 받는다.
//! 대상은 `https://api.chzzk.naver.com/service/v1/videos?sortType=LATEST`에서 고른다(성인·AES 제외).

#[path = "support/mp4.rs"]
mod mp4;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use chzzk_core::download::part::part_path;
use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, Error, PlaybackKind, Progress, Resolved,
};

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} 환경 변수로 대상을 주세요"))
}

/// 가장 작은 화질의 id.
fn lowest(r: &Resolved) -> String {
    r.qualities()
        .into_iter()
        .min_by_key(|q| q.resolution.or(q.height).unwrap_or(u32::MAX))
        .expect("화질이 없다")
        .id
        .clone()
}

/// `limit` 바이트를 받으면 취소한다. `None`이면 끝까지. (결과, 마지막 진행률 바이트)
async fn download(
    content: ContentRef,
    expect: PlaybackKind,
    limit: Option<u64>,
    dir: &std::path::Path,
) -> (Result<DownloadOutcome, Error>, std::path::PathBuf, u64) {
    let c = Chzzk::new(ClientConfig::default()).unwrap();
    let r = c.resolve(&content).await.unwrap();
    assert_eq!(r.kind(), expect, "대상의 재생 방식이 다르다");
    let output = dir.join("out.mp4");
    let cancel = CancellationToken::new();
    let seen = Arc::new(AtomicU64::new(0));
    let cb = {
        let cancel = cancel.clone();
        let seen = seen.clone();
        move |p: Progress| {
            seen.store(p.bytes, Ordering::SeqCst);
            if limit.is_some_and(|l| p.bytes >= l) {
                cancel.cancel();
            }
        }
    };
    let req = DownloadRequest {
        content,
        quality_id: lowest(&r),
        expected_kind: expect,
        output: output.clone(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
    };
    let res = c.download(req, cancel, &cb).await;
    (res, output, seen.load(Ordering::SeqCst))
}

#[tokio::test]
#[ignore = "실서버 접속"]
async fn live_hls_partial() {
    let no: u64 = env("CHZZK_LIVE_HLS").parse().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let limit = 4 * 1024 * 1024;
    let (res, out, seen) = download(
        ContentRef::Video { video_no: no },
        PlaybackKind::LiveRewindHls,
        Some(limit),
        dir.path(),
    )
    .await;
    assert!(matches!(res, Err(Error::Cancelled)), "{res:?}");
    assert!(seen >= limit);
    let part = std::fs::read(part_path(&out)).unwrap();
    assert!(part.len() as u64 >= limit, "{}", part.len());
    let w = mp4::walk_boxes(&part).unwrap();
    let types = w.types();
    println!("HLS .part {} B, 상자 {}개", part.len(), types.len());
    // checkpoint는 세그먼트 단위라 `.part`는 늘 상자 경계에서 끝난다.
    assert!(!w.truncated, "{types:?}");
    assert_eq!(&types[..2], ["ftyp", "moov"]);
    assert!(types.iter().filter(|t| **t == "moof").count() >= 2);
    assert!(types.contains(&"mdat"));
}

#[tokio::test]
#[ignore = "실서버 접속"]
async fn live_dash_partial() {
    let no: u64 = env("CHZZK_LIVE_DASH").parse().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let limit = 3 * 1024 * 1024;
    let (res, out, _) = download(
        ContentRef::Video { video_no: no },
        PlaybackKind::Progressive,
        Some(limit),
        dir.path(),
    )
    .await;
    // 최저 화질이 상한보다 작은 짧은 VOD는 끝까지 받는다. 그때는 완성 파일을 검사한다.
    let (bytes, truncated_expected) = match &res {
        Err(Error::Cancelled) => {
            let part = std::fs::read(part_path(&out)).unwrap();
            assert!(part.len() as u64 >= limit, "{}", part.len());
            (part, true)
        }
        Ok(DownloadOutcome::Completed { path, bytes, .. }) => {
            assert_eq!(path, &out);
            let file = std::fs::read(path).unwrap();
            assert_eq!(file.len() as u64, *bytes);
            assert!((*bytes) < limit, "{bytes}");
            (file, false)
        }
        other => panic!("{other:?}"),
    };
    let w = mp4::walk_boxes(&bytes).unwrap();
    let types = w.types();
    println!(
        "DASH {} B, 상자 {types:?}, 잘림 {}",
        bytes.len(),
        w.truncated
    );
    // progressive는 바이트 단위로 멈추므로 취소했으면 마지막 상자(mdat)가 잘려 있다.
    assert_eq!(w.truncated, truncated_expected, "{types:?}");
    assert_eq!(&types[..2], ["ftyp", "moov"]);
    assert!(types.contains(&"mdat"), "{types:?}");
}

#[tokio::test]
#[ignore = "실서버 접속"]
async fn live_clip_full() {
    let id = env("CHZZK_LIVE_CLIP");
    let dir = tempfile::tempdir().unwrap();
    let (res, out, _) = download(
        ContentRef::Clip { clip_id: id },
        PlaybackKind::Progressive,
        None,
        dir.path(),
    )
    .await;
    let Ok(DownloadOutcome::Completed { path, bytes, .. }) = res else {
        panic!("{res:?}");
    };
    assert_eq!(path, out);
    let file = std::fs::read(&path).unwrap();
    assert_eq!(file.len() as u64, bytes);
    assert!(!part_path(&out).exists());
    let w = mp4::walk_boxes(&file).unwrap();
    println!("클립 {} B, 상자 {:?}", file.len(), w.types());
    assert!(!w.truncated);
    assert_eq!(w.types().first(), Some(&"ftyp"));
    assert!(w.types().contains(&"moov") && w.types().contains(&"mdat"));
}

/// 상자 검사기 자체는 오프라인 fixture로 검사한다(무시하지 않는다).
#[test]
fn walk_boxes_on_fixture() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/hls/");
    let mut b = std::fs::read(format!("{root}init.mp4")).unwrap();
    b.extend(std::fs::read(format!("{root}seg0.m4v")).unwrap());
    let w = mp4::walk_boxes(&b).unwrap();
    assert!(!w.truncated);
    assert_eq!(&w.types()[..2], ["ftyp", "moov"]);
    assert_eq!(w.boxes.iter().map(|(_, s)| s).sum::<u64>(), b.len() as u64);

    // 마지막 상자가 잘리면 truncated, 앞은 그대로.
    let cut = mp4::walk_boxes(&b[..b.len() - 1]).unwrap();
    assert!(cut.truncated);
    assert_eq!(cut.types(), w.types());
    // 상자 종류가 깨지면 오류.
    let mut bad = b.clone();
    bad[4] = 0;
    assert!(mp4::walk_boxes(&bad).is_err());
    // 64비트 largesize와 크기 0(끝까지).
    let mut big = vec![0, 0, 0, 1];
    big.extend_from_slice(b"mdat");
    big.extend_from_slice(&20u64.to_be_bytes());
    big.extend_from_slice(&[7; 4]);
    big.extend_from_slice(&[0, 0, 0, 0]);
    big.extend_from_slice(b"free");
    let w = mp4::walk_boxes(&big).unwrap();
    assert_eq!(w.types(), ["mdat", "free"]);
    assert!(!w.truncated);
    // 두 번째 상자의 largesize가 u64::MAX여도 넘치지 않고 잘린 것으로 본다.
    let mut huge = vec![0, 0, 0, 8];
    huge.extend_from_slice(b"free");
    huge.extend_from_slice(&[0, 0, 0, 1]);
    huge.extend_from_slice(b"mdat");
    huge.extend_from_slice(&u64::MAX.to_be_bytes());
    let w = mp4::walk_boxes(&huge).unwrap();
    assert_eq!(w.types(), ["free", "mdat"]);
    assert!(w.truncated);
}
