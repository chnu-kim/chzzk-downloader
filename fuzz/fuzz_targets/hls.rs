//! HLS master·media playlist 파서. 어떤 문자열에도 panic하지 않는다(상대 URI는 고정한 기준 주소로 푼다).
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(s) = std::str::from_utf8(data) else {
        return;
    };
    let base = url::Url::parse("https://media.example.invalid/a/b/playlist.m3u8").unwrap();
    let _ = chzzk_core::hls::parse_master(s, &base);
    if let Ok(p) = chzzk_core::hls::parse_media(s, &base) {
        let _ = chzzk_core::hls::durations_crc(&p);
    }
});
