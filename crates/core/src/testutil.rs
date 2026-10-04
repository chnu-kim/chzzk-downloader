//! 단위 테스트 공용 도구.

/// 저장소 루트 기준 상대 경로의 fixture를 읽는다.
pub(crate) fn fixture(rel: &str) -> Vec<u8> {
    let path = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// `fixture`를 UTF-8 문자열로 읽는다.
pub(crate) fn fixture_str(rel: &str) -> String {
    String::from_utf8(fixture(rel)).unwrap()
}
