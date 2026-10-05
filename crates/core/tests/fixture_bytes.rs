//! fixture가 체크아웃 과정에서 CRLF로 바뀌지 않았는지 확인한다.
//!
//! 파싱·crc32·바이트 비교 golden은 저장소에 커밋된 바이트(LF)를 전제로 한다.
//! `.gitattributes`의 `-text`가 빠지거나 무시되면 Windows 클론에서 이 테스트가 먼저 실패한다.

const TEXT_FIXTURES: [&str; 20] = [
    "testdata/clip/clip_multi.mpd",
    "testdata/clip/clip_multi_playinfo.json",
    "testdata/clip/clip_playinfo.json",
    "testdata/hls/live_rewind_playback.decoded.json",
    "testdata/hls/master.m3u8",
    "testdata/hls/media.m3u8",
    "testdata/hls/video_info.json",
    "testdata/vod/playback.mpd",
    "testdata/vod/video_info.json",
    "testdata/hls/README.md",
    "testdata/vod/README.md",
    "testdata/synthetic/README.md",
    "testdata/synthetic/vod_info_aes.json",
    "testdata/synthetic/media_discontinuity.m3u8",
    "testdata/synthetic/media_two_maps.m3u8",
    "testdata/synthetic/media_key_aes.m3u8",
    "testdata/synthetic/media_key_none.m3u8",
    "testdata/synthetic/media_byterange.m3u8",
    "testdata/synthetic/media_no_endlist.m3u8",
    "testdata/synthetic/media_long_extinf.m3u8",
];

#[test]
fn text_fixtures_have_no_cr() {
    for rel in TEXT_FIXTURES {
        let path = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
        let body = std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        assert!(
            !body.contains(&b'\r'),
            "{rel}에 CR이 있다(.gitattributes의 -text 확인)"
        );
    }
}
