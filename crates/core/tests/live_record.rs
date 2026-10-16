//! 생방송 녹화 실서버 스모크. `#[ignore]`이고 **방송 중인 본인 채널**이 있어야 한다(야간 drift 점검 대상이 아니다).
//!
//! ```text
//! CHZZK_LIVE_CHANNEL=<방송 중인 본인 채널 ID> cargo test -p chzzk-core --test live_record -- --ignored --nocapture
//! ```
//!
//! 20초쯤 녹화하고 멈춘다(`live_stop`). 멈춤은 받은 만큼을 최종 파일로 마무리해 `Completed`이고, 최종 파일의
//! MP4 상자가 `ftyp`·`moov` 뒤로 `moof`가 이어지며 마지막 상자가 잘리지 않아야 한다.
//! 재생 프로그램에서 탐색이 되는지는 사용자가 직접 본다(core.md 58 알려진 한계).

#[path = "support/mp4.rs"]
mod mp4;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use chzzk_core::download::part::part_path;
use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, PlaybackKind, Progress,
};

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} 환경 변수로 대상을 주세요"))
}

/// 방송 중인 본인 채널을 잠깐 녹화하고 멈춘다. 멈춤은 받은 만큼 마무리해 `Completed`이고, 상자 구조가 이어져야 한다.
#[tokio::test]
#[ignore = "실서버 접속(방송 중인 본인 채널)"]
async fn live_record() {
    let channel_id = env("CHZZK_LIVE_CHANNEL");
    let dir = tempfile::tempdir().unwrap();
    let c = Chzzk::new(ClientConfig::default()).unwrap();
    let content = ContentRef::Live { channel_id };
    let r = c.resolve(&content).await.unwrap();
    assert_eq!(r.kind(), PlaybackKind::Live);
    let output = dir.path().join("live.mp4");
    let stop = CancellationToken::new();
    let seen = Arc::new(AtomicU64::new(0));
    let cb = {
        let (stop, seen) = (stop.clone(), seen.clone());
        move |p: Progress| {
            seen.store(p.bytes, Ordering::SeqCst);
            // 약 20초 분량(2초 세그먼트 10개)을 받으면 멈춘다.
            if p.live.is_some_and(|l| l.recorded_secs >= 20.0) {
                stop.cancel();
            }
        }
    };
    let req = DownloadRequest {
        content,
        quality_id: r
            .qualities()
            .into_iter()
            .min_by_key(|q| q.resolution.or(q.height).unwrap_or(u32::MAX))
            .expect("화질이 없다")
            .id
            .clone(),
        expected_kind: PlaybackKind::Live,
        output: output.clone(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: Some(stop),
        recording_id: None,
    };
    let res = c
        .download(req, CancellationToken::new(), &cb)
        .await
        .unwrap();
    let DownloadOutcome::Completed { path, bytes, .. } = res else {
        panic!("{res:?}")
    };
    assert_eq!(path, output);
    let file = std::fs::read(&path).unwrap();
    assert_eq!(file.len() as u64, bytes);
    let w = mp4::walk_boxes(&file).unwrap();
    let types = w.types();
    println!("라이브 {} B, 상자 {}개", file.len(), types.len());
    // 세그먼트 단위로 쓰므로 마지막 상자가 잘리지 않는다.
    assert!(!w.truncated, "{types:?}");
    assert_eq!(&types[..2], ["ftyp", "moov"]);
    assert!(types.iter().filter(|t| **t == "moof").count() >= 4);
    assert!(!part_path(&output).exists());
}
