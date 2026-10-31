//! 셸 통합 테스트 공용 도구.
//!
//! 테스트 crate마다 쓰는 함수가 달라 사용하지 않는 함수가 생긴다.
#![allow(dead_code)]

pub mod auth;
pub mod cli_env;
pub mod fake;
pub mod harness;

/// 코어가 쓰는 생방송 녹화 `.part`·sidecar를 만든다. `part_bytes`는 `.part` 전체(앞 `init_len`바이트가 init 조각)이고
/// 이미 커밋된 것으로 적는다. 재시작 뒤 이어받기·마무리 길을 테스트가 재현할 때 쓴다.
pub fn write_live_part(
    output: &std::path::Path,
    content: &chzzk_core::ContentRef,
    quality_id: &str,
    expected_kind: chzzk_core::PlaybackKind,
    recording_id: Option<&str>,
    init_len: u32,
    part_bytes: &[u8],
) {
    use chzzk_core::download::part::{HlsState, Sidecar, part_path, sidecar_path};
    use chzzk_core::fsutil::atomic_write;
    if let Some(dir) = output.parent() {
        std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(part_path(output), part_bytes).unwrap();
    let mut sc = Sidecar::new(content.clone(), quality_id.to_owned(), expected_kind);
    sc.recording_id = recording_id.map(str::to_owned);
    sc.committed_len = part_bytes.len() as u64;
    sc.hls = Some(HlsState {
        init_len,
        ..HlsState::default()
    });
    atomic_write(&sidecar_path(output), &serde_json::to_vec(&sc).unwrap()).unwrap();
}
