//! 구간 받기 실서버 실측용(사용자가 수동으로 돌린다. 설계 `core.md` 구현 중 변경 64의 M-②-2·M-②-6).
//!
//! `live.rs`와 따로 둔 이유: nightly `drift`는 `live.rs`의 `#[ignore]` 테스트 이름 목록만 돌린다
//! (`scripts/ci/drift.mjs`). 이 파일의 테스트는 정기 drift 대상이 아니다.
//!
//! ```text
//! CHZZK_LIVE_HLS=<빠른 다시보기 videoNo> \
//!   cargo test -p chzzk-core --test live_range -- --ignored --nocapture
//! ```
//!
//! 본인 빠른 다시보기의 10~20초 구간만 받아 일반(비조각) mp4로 마무리되는지 본다.
//! 값(크기·시각)은 출력하지 않고 "된다"만 찍는다.

#[path = "support/mp4.rs"]
#[allow(dead_code)]
mod mp4;

use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, PlaybackKind, TimeRange,
};

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} 환경 변수로 대상을 주세요"))
}

#[tokio::test]
#[ignore = "실서버 접속"]
async fn live_hls_range() {
    let no: u64 = env("CHZZK_LIVE_HLS").parse().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let content = ContentRef::Video { video_no: no };
    let c = Chzzk::new(ClientConfig::default()).unwrap();
    let r = c.resolve(&content).await.unwrap();
    assert_eq!(
        r.kind(),
        PlaybackKind::LiveRewindHls,
        "대상의 재생 방식이 다르다"
    );
    // 가장 작은 화질.
    let quality_id = r
        .qualities()
        .into_iter()
        .min_by_key(|q| q.resolution.or(q.height).unwrap_or(u32::MAX))
        .expect("화질이 없다")
        .id
        .clone();
    let output = dir.path().join("out.mp4");
    let req = DownloadRequest {
        embed_metadata: false,
        content,
        quality_id,
        expected_kind: PlaybackKind::LiveRewindHls,
        output: output.clone(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: None,
        recording_id: None,
        range: Some(TimeRange {
            start_ms: 10_000,
            end_ms: Some(20_000),
        }),
    };
    let res = c.download(req, CancellationToken::new(), &|_| {}).await;
    assert!(
        matches!(res, Ok(DownloadOutcome::Completed { .. })),
        "{res:?}"
    );
    mp4::assert_flat_mp4(&std::fs::read(&output).unwrap());
    println!("구간 받기: 된다");
}
