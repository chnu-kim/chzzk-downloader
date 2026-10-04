//! 단위 테스트 공용 도구.

/// 저장소 루트 기준 상대 경로의 fixture를 읽는다.
pub(crate) fn fixture(rel: &str) -> Vec<u8> {
    let path = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}
