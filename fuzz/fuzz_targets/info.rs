//! VOD·클립 info JSON 파서와 재생 방식 분류. 어떤 바이트에도 panic하지 않는다.
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok((_, v)) = chzzk_core::info::parse_video_info(data) {
        let _ = chzzk_core::info::classify(&v);
    }
    let _ = chzzk_core::info::parse_clip_info(data);
});
