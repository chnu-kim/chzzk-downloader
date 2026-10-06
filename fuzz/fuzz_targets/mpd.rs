//! DASH MPD(XML) 파서와 progressive 화질 고르기. 어떤 문자열에도 panic하지 않는다.
#![no_main]
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data)
        && let Ok(reps) = chzzk_core::mpd::parse_mpd(s)
        && let Ok(pd) = chzzk_core::mpd::pd_reps(&reps)
        && let Some(first) = pd.first()
    {
        let _ = chzzk_core::mpd::select_pd(&pd, &first.quality.id);
    }
});
