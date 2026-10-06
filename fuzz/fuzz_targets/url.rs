//! 붙여 넣은 주소 파서. 어떤 문자열에도 panic하지 않는다.
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = chzzk_core::parse_content_url(s);
    }
});
