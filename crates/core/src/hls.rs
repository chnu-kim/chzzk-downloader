//! HLS master·media playlist 손 파서(설계 §3.2·§1-17).
//!
//! - 필요한 태그만 해석하고, 조용히 이어 붙이면 깨진 파일이 나오는 태그는 `Error::Unsupported`로 거부한다.
//! - 태그 이름은 `:` 앞까지를 **정확히** 비교한다(`#EXT-X-DISCONTINUITY-SEQUENCE`는 허용,
//!   `#EXT-X-DISCONTINUITY`는 거부).
//! - URI는 RFC 3986 상대 해석(`Url::join`)만 한다. master의 `hdnts` 쿼리는 하위 요청에 붙지 않고,
//!   MAP URI의 자체 쿼리(`?type=hls&filetype=.m4s`)는 그대로 남는다.
//! - 오류 메시지에 서명 토큰이 든 주소를 넣지 않는다.

use std::fmt;

use ::url::Url;

use crate::error::{Error, Unsupported};
use crate::http::DebugUrl;

/// master playlist의 variant 하나. `Debug`는 주소를 `http::redact_url`로 가린다.
#[derive(Clone, PartialEq, Eq)]
pub struct Variant {
    pub uri: Url,
    /// master 디렉토리 기준 첫 path 세그먼트. encodingTrackId(`"720p"`)와 같다.
    /// 디렉토리 밖의 URI면 해석한 URL의 첫 path 세그먼트다.
    pub track_id: String,
    /// `RESOLUTION=WxH`의 H
    pub height: Option<u32>,
}

/// media playlist. `Debug`는 주소를 `http::redact_url`로 가린다.
#[derive(Clone, PartialEq, Eq)]
pub struct MediaPlaylist {
    pub media_sequence: u64,
    /// `EXT-X-MAP`(fMP4 init). TS playlist면 `None`.
    pub init: Option<Url>,
    pub segments: Vec<Segment>,
    pub total_duration_ms: u64,
}

/// 세그먼트 하나. `Debug`는 주소를 `http::redact_url`로 가린다.
#[derive(Clone, PartialEq, Eq)]
pub struct Segment {
    /// media sequence number(`EXT-X-MEDIA-SEQUENCE` + index)
    pub msn: u64,
    /// EXTINF를 ms로 반올림한 값
    pub duration_ms: u32,
    pub uri: Url,
}

impl fmt::Debug for Variant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Variant")
            .field("uri", &DebugUrl(&self.uri))
            .field("track_id", &self.track_id)
            .field("height", &self.height)
            .finish()
    }
}

impl fmt::Debug for MediaPlaylist {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("MediaPlaylist")
            .field("media_sequence", &self.media_sequence)
            .field("init", &self.init.as_ref().map(DebugUrl))
            .field("segments", &self.segments)
            .field("total_duration_ms", &self.total_duration_ms)
            .finish()
    }
}

impl fmt::Debug for Segment {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Segment")
            .field("msn", &self.msn)
            .field("duration_ms", &self.duration_ms)
            .field("uri", &DebugUrl(&self.uri))
            .finish()
    }
}

fn parse_err(what: &'static str, detail: impl Into<String>) -> Error {
    Error::Parse {
        what,
        detail: detail.into(),
    }
}

/// 줄 단위로 나눈다. 앞의 BOM과 끝의 `\r`·공백을 지운다.
fn lines(text: &str) -> impl Iterator<Item = &str> {
    text.strip_prefix('\u{feff}')
        .unwrap_or(text)
        .lines()
        .map(str::trim_end)
}

/// 첫 비어 있지 않은 줄이 `#EXTM3U`인지 확인한다.
fn check_header(text: &str, what: &'static str) -> Result<(), Error> {
    match lines(text).find(|l| !l.is_empty()) {
        Some("#EXTM3U") => Ok(()),
        _ => Err(parse_err(what, "#EXTM3U로 시작하지 않습니다")),
    }
}

/// 태그 줄을 `(이름, 값)`으로 나눈다. `"#EXT-X-KEY:METHOD=NONE"` → `("#EXT-X-KEY", "METHOD=NONE")`.
fn split_tag(line: &str) -> (&str, &str) {
    line.split_once(':').unwrap_or((line, ""))
}

/// 속성 목록(`KEY=VALUE,KEY="VALUE"`)을 읽는다. 따옴표 안의 `,`는 구분자가 아니다.
/// 값의 따옴표는 벗긴다.
fn parse_attrs(s: &str) -> Vec<(&str, &str)> {
    let mut out = Vec::new();
    let mut rest = s;
    while !rest.is_empty() {
        let Some(eq) = rest.find('=') else { break };
        let key = rest[..eq].trim();
        let after = &rest[eq + 1..];
        let (value, next) = if let Some(q) = after.strip_prefix('"') {
            match q.find('"') {
                Some(end) => {
                    let tail = &q[end + 1..];
                    (&q[..end], tail.find(',').map_or("", |c| &tail[c + 1..]))
                }
                None => (q, ""),
            }
        } else {
            match after.find(',') {
                Some(c) => (after[..c].trim(), &after[c + 1..]),
                None => (after.trim(), ""),
            }
        };
        out.push((key, value));
        rest = next;
    }
    out
}

fn attr<'a>(attrs: &[(&str, &'a str)], key: &str) -> Option<&'a str> {
    attrs.iter().find(|(k, _)| *k == key).map(|(_, v)| *v)
}

fn join(base: &Url, uri: &str, what: &'static str) -> Result<Url, Error> {
    // base에는 서명 토큰이 있으므로 오류에는 url crate의 사유만 남긴다.
    base.join(uri)
        .map_err(|e| parse_err(what, format!("URI를 해석할 수 없습니다: {e}")))
}

/// master playlist를 읽는다. variant가 없으면 `Error::Parse`.
pub fn parse_master(text: &str, base: &Url) -> Result<Vec<Variant>, Error> {
    const WHAT: &str = "master playlist";
    check_header(text, WHAT)?;
    // master 디렉토리(쿼리 없음). variant의 track_id를 이 기준으로 뽑는다.
    let dir = join(base, "./", WHAT)?;
    let mut out = Vec::new();
    let mut pending: Option<Option<u32>> = None;
    for line in lines(text) {
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') {
            let (name, value) = split_tag(line);
            if name == "#EXT-X-STREAM-INF" {
                let attrs = parse_attrs(value);
                let height = attr(&attrs, "RESOLUTION")
                    .and_then(|r| r.split_once('x'))
                    .and_then(|(_, h)| h.parse().ok());
                pending = Some(height);
            }
            continue;
        }
        // STREAM-INF 바로 다음 URI 줄만 variant다.
        let Some(height) = pending.take() else {
            continue;
        };
        let uri = join(base, line, WHAT)?;
        let track_id = match uri.as_str().strip_prefix(dir.as_str()) {
            Some(rel) => rel.split(['/', '?']).next().unwrap_or(""),
            // 디렉토리 밖이면 해석한 URL의 첫 비어 있지 않은 path 세그먼트를 쓴다
            // (원문을 자르면 절대 URI에서 스킴 `https:`가 나온다).
            None => uri
                .path_segments()
                .and_then(|mut s| s.find(|p| !p.is_empty()))
                .unwrap_or(""),
        }
        .to_string();
        out.push(Variant {
            uri,
            track_id,
            height,
        });
    }
    if out.is_empty() {
        return Err(parse_err(WHAT, "variant가 없습니다"));
    }
    Ok(out)
}

/// media playlist를 읽는다.
///
/// - 허용: 빈 줄, 주석, PDT, DATERANGE, `KEY:METHOD=NONE`, EXTINF > TARGETDURATION, 모르는 `#EXT` 태그(경고)
/// - 거부(`Error::Unsupported`): DISCONTINUITY, 두 번째 MAP(또는 세그먼트 뒤의 MAP),
///   KEY(METHOD≠NONE), BYTERANGE(태그·MAP 속성), GAP, SKIP, ENDLIST 없음
/// - 세그먼트가 없거나 EXTINF 없는 URI, URI 없는 EXTINF, 숫자가 아닌 값,
///   u64를 넘는 msn은 `Error::Parse`
pub fn parse_media(text: &str, base: &Url) -> Result<MediaPlaylist, Error> {
    const WHAT: &str = "media playlist";
    check_header(text, WHAT)?;
    let mut media_sequence: u64 = 0;
    let mut init: Option<Url> = None;
    let mut durations: Vec<u32> = Vec::new();
    let mut uris: Vec<Url> = Vec::new();
    let mut pending: Option<u32> = None;
    let mut ended = false;

    for line in lines(text) {
        if line.is_empty() {
            continue;
        }
        if !line.starts_with('#') {
            let duration = pending
                .take()
                .ok_or_else(|| parse_err(WHAT, "EXTINF 없는 세그먼트 URI가 있습니다"))?;
            durations.push(duration);
            uris.push(join(base, line, WHAT)?);
            continue;
        }
        if !line.starts_with("#EXT") {
            continue; // 주석
        }
        let (name, value) = split_tag(line);
        match name {
            "#EXTM3U"
            | "#EXT-X-VERSION"
            | "#EXT-X-INDEPENDENT-SEGMENTS"
            | "#EXT-X-TARGETDURATION"
            | "#EXT-X-DISCONTINUITY-SEQUENCE"
            | "#EXT-X-PROGRAM-DATE-TIME"
            | "#EXT-X-DATERANGE"
            | "#EXT-X-PLAYLIST-TYPE" => {}
            "#EXT-X-MEDIA-SEQUENCE" => {
                media_sequence = value
                    .trim()
                    .parse()
                    .map_err(|_| parse_err(WHAT, "EXT-X-MEDIA-SEQUENCE가 숫자가 아닙니다"))?;
            }
            "#EXTINF" => {
                if pending.is_some() {
                    return Err(parse_err(WHAT, "URI 없이 EXTINF가 두 번 나왔습니다"));
                }
                let secs = value.split(',').next().unwrap_or("").trim();
                pending = Some(parse_duration_ms(secs).ok_or_else(|| {
                    parse_err(WHAT, format!("EXTINF 값이 올바르지 않습니다: {secs}"))
                })?);
            }
            "#EXT-X-MAP" => {
                if init.is_some() || !uris.is_empty() {
                    return Err(Error::Unsupported(Unsupported::SecondMap));
                }
                let attrs = parse_attrs(value);
                if attr(&attrs, "BYTERANGE").is_some() {
                    return Err(Error::Unsupported(Unsupported::ByteRange));
                }
                let uri = attr(&attrs, "URI")
                    .ok_or_else(|| parse_err(WHAT, "EXT-X-MAP에 URI가 없습니다"))?;
                init = Some(join(base, uri, WHAT)?);
            }
            "#EXT-X-KEY" => {
                let attrs = parse_attrs(value);
                let method = attr(&attrs, "METHOD")
                    .ok_or_else(|| parse_err(WHAT, "EXT-X-KEY에 METHOD가 없습니다"))?;
                if method != "NONE" {
                    return Err(Error::Unsupported(Unsupported::Encrypted(
                        method.to_string(),
                    )));
                }
            }
            "#EXT-X-DISCONTINUITY" => return Err(Error::Unsupported(Unsupported::Discontinuity)),
            "#EXT-X-BYTERANGE" => return Err(Error::Unsupported(Unsupported::ByteRange)),
            // 표시된 세그먼트가 없거나(GAP) 목록에서 세그먼트가 빠진(SKIP, delta playlist) 경우라
            // 이어 붙이면 구멍 난 파일이 된다. PART·PRELOAD-HINT는 전체 세그먼트가 함께 있으므로 무시한다.
            "#EXT-X-GAP" => return Err(Error::Unsupported(Unsupported::Gap)),
            "#EXT-X-SKIP" => return Err(Error::Unsupported(Unsupported::Skip)),
            "#EXT-X-ENDLIST" => ended = true,
            "#EXT-X-STREAM-INF" => {
                return Err(parse_err(WHAT, "master playlist입니다"));
            }
            other => tracing::warn!(tag = other, "모르는 HLS 태그를 무시합니다"),
        }
    }
    if !ended {
        return Err(Error::Unsupported(Unsupported::NotEnded));
    }
    if pending.is_some() {
        return Err(parse_err(WHAT, "URI 없는 EXTINF로 끝납니다"));
    }
    if uris.is_empty() {
        return Err(parse_err(WHAT, "세그먼트가 없습니다"));
    }
    // 마지막 msn이 u64 안에 들어가는지 한 번에 확인한다(이후 덧셈은 넘치지 않는다).
    media_sequence
        .checked_add(uris.len() as u64 - 1)
        .ok_or_else(|| parse_err(WHAT, "EXT-X-MEDIA-SEQUENCE가 너무 큽니다"))?;
    let total_duration_ms = durations.iter().map(|&d| u64::from(d)).sum();
    let segments = uris
        .into_iter()
        .zip(durations)
        .enumerate()
        .map(|(i, (uri, duration_ms))| Segment {
            msn: media_sequence + i as u64,
            duration_ms,
            uri,
        })
        .collect();
    Ok(MediaPlaylist {
        media_sequence,
        init,
        segments,
        total_duration_ms,
    })
}

/// EXTINF 초 값을 ms로 반올림한다(가장 가까운 정수, .5는 0에서 먼 쪽). 음수·NaN·너무 큰 값은 `None`.
fn parse_duration_ms(secs: &str) -> Option<u32> {
    let v: f64 = secs.parse().ok()?;
    if !v.is_finite() || v < 0.0 {
        return None;
    }
    let ms = (v * 1000.0).round();
    (ms <= f64::from(u32::MAX)).then_some(ms as u32)
}

/// EXTINF(ms) 시퀀스의 crc32. sidecar 지문으로 재조회 전후 playlist가 같은지 본다.
///
/// 각 값을 u32 little-endian 4바이트로 이어 붙인 바이트열의 crc32다.
pub fn durations_crc(p: &MediaPlaylist) -> u32 {
    let mut h = crc32fast::Hasher::new();
    for s in &p.segments {
        h.update(&s.duration_ms.to_le_bytes());
    }
    h.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::fixture_str;

    const MASTER_BASE: &str = "https://hls.example.invalid/live_rewind/kr/streamkey0/vod_playlist.m3u8?hdnts=st=0~exp=0~acl=*/kr/*~hmac=0000";
    const MEDIA_BASE: &str = "https://hls.example.invalid/live_rewind/kr/streamkey0/144p/hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=0000/vod_chunklist.m3u8";

    fn media_base() -> Url {
        Url::parse(MEDIA_BASE).unwrap()
    }

    fn synthetic(name: &str) -> Result<MediaPlaylist, Error> {
        parse_media(
            &fixture_str(&format!("testdata/synthetic/{name}")),
            &media_base(),
        )
    }

    /// 독립 계산: u32 LE 바이트열의 crc32
    fn crc_of(ms: &[u32]) -> u32 {
        let bytes: Vec<u8> = ms.iter().flat_map(|d| d.to_le_bytes()).collect();
        crc32fast::hash(&bytes)
    }

    #[test]
    fn master_join() {
        let base = Url::parse(MASTER_BASE).unwrap();
        let vs = parse_master(&fixture_str("testdata/hls/master.m3u8"), &base).unwrap();
        let ids: Vec<_> = vs.iter().map(|v| v.track_id.as_str()).collect();
        assert_eq!(ids, ["720p", "480p", "360p", "144p", "1080p"]);
        let heights: Vec<_> = vs.iter().map(|v| v.height).collect();
        assert_eq!(
            heights,
            [Some(720), Some(480), Some(360), Some(144), Some(1080)]
        );
        let v144 = &vs[3];
        assert_eq!(
            v144.uri.as_str(),
            "https://hls.example.invalid/live_rewind/kr/streamkey0/144p/hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=0000/vod_chunklist.m3u8"
        );
        // master의 hdnts 쿼리는 전파하지 않는다.
        for v in &vs {
            assert_eq!(v.uri.query(), None);
            assert!(!v.uri.as_str().contains("hdnts"));
        }
    }

    #[test]
    fn master_absolute_uri_track_id() {
        let base = Url::parse("https://h/a/master.m3u8?x=1").unwrap();
        let text = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS=\"avc1,mp4a\",RESOLUTION=640x360\r\nhttps://h/a/360p/x/chunk.m3u8\n";
        let vs = parse_master(text, &base).unwrap();
        assert_eq!(vs[0].track_id, "360p");
        assert_eq!(vs[0].height, Some(360));
    }

    /// 리뷰 수정: 디렉토리 밖 URI의 track_id가 스킴(`https:`)이 되지 않는다.
    #[test]
    fn master_outside_dir_track_id() {
        let base = Url::parse("https://h/a/master.m3u8?hdnts=x").unwrap();
        let text = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\nhttps://cdn2.example/b/720p/x/chunk.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/zz/360p/x.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://cdn2.example//c/x.m3u8\n";
        let vs = parse_master(text, &base).unwrap();
        let ids: Vec<_> = vs.iter().map(|v| v.track_id.as_str()).collect();
        assert_eq!(ids, ["b", "zz", "c"]);
        assert_eq!(vs[0].height, Some(720));
    }

    #[test]
    fn master_rejects() {
        let base = Url::parse("https://h/a/m.m3u8").unwrap();
        assert!(matches!(
            parse_master("<html>", &base),
            Err(Error::Parse { .. })
        ));
        assert!(matches!(
            parse_master("#EXTM3U\n#EXT-X-VERSION:7\n", &base),
            Err(Error::Parse { .. })
        ));
    }

    #[test]
    fn media_parse() {
        let p = parse_media(&fixture_str("testdata/hls/media.m3u8"), &media_base()).unwrap();
        assert_eq!(p.media_sequence, 0);
        assert_eq!(p.segments.len(), 30);
        let msns: Vec<_> = p.segments.iter().map(|s| s.msn).collect();
        assert_eq!(msns, (0..30).collect::<Vec<_>>());
        assert!(p.segments.iter().all(|s| s.duration_ms == 2000));
        assert_eq!(p.total_duration_ms, 60_000);

        let init = p.init.as_ref().unwrap();
        assert_eq!(init.query(), Some("type=hls&filetype=.m4s"));
        assert!(
            init.as_str()
                .ends_with("/144p/hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=0000/144p_0_0_0.m4s?type=hls&filetype=.m4s")
        );
        assert!(
            p.segments[0]
                .uri
                .as_str()
                .ends_with("~hmac=0000/144p_seg0.m4v")
        );
        assert!(p.segments[29].uri.as_str().ends_with("/144p_seg29.m4v"));

        // 지문: 2000ms × 30의 crc32. 고정값은 Python `zlib.crc32(struct.pack("<30I", *[2000]*30))`로 따로 계산했다.
        assert_eq!(durations_crc(&p), crc_of(&[2000; 30]));
        assert_eq!(durations_crc(&p), 0x8494_4746);
    }

    #[test]
    fn media_sequence_offsets_msn() {
        let text = fixture_str("testdata/hls/media.m3u8")
            .replace("#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-MEDIA-SEQUENCE:100");
        let p = parse_media(&text, &media_base()).unwrap();
        assert_eq!(p.media_sequence, 100);
        assert_eq!(p.segments[0].msn, 100);
        assert_eq!(p.segments[29].msn, 129);
    }

    #[test]
    fn rejects_disc() {
        assert!(matches!(
            synthetic("media_discontinuity.m3u8"),
            Err(Error::Unsupported(Unsupported::Discontinuity))
        ));
    }

    #[test]
    fn rejects_map2() {
        assert!(matches!(
            synthetic("media_two_maps.m3u8"),
            Err(Error::Unsupported(Unsupported::SecondMap))
        ));
    }

    #[test]
    fn rejects_key_aes() {
        let Err(Error::Unsupported(Unsupported::Encrypted(method))) =
            synthetic("media_key_aes.m3u8")
        else {
            panic!("Encrypted가 아니다");
        };
        assert_eq!(method, "AES-128");
    }

    #[test]
    fn rejects_byterange() {
        assert!(matches!(
            synthetic("media_byterange.m3u8"),
            Err(Error::Unsupported(Unsupported::ByteRange))
        ));
        // MAP의 BYTERANGE 속성도 거부한다.
        let text = fixture_str("testdata/synthetic/media_key_none.m3u8").replace(
            r#"#EXT-X-MAP:URI="144p_0_0_0.m4s?type=hls&filetype=.m4s""#,
            r#"#EXT-X-MAP:URI="init.m4s",BYTERANGE="720@0""#,
        );
        assert!(matches!(
            parse_media(&text, &media_base()),
            Err(Error::Unsupported(Unsupported::ByteRange))
        ));
    }

    #[test]
    fn rejects_no_endlist() {
        assert!(matches!(
            synthetic("media_no_endlist.m3u8"),
            Err(Error::Unsupported(Unsupported::NotEnded))
        ));
    }

    /// 리뷰 수정: msn이 정확히 u64::MAX에서 끝나면 받는다.
    #[test]
    fn media_sequence_at_u64_max() {
        let text = "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:18446744073709551614\n#EXTINF:1,\na.ts\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST\n";
        let p = parse_media(text, &media_base()).unwrap();
        assert_eq!(p.segments[1].msn, u64::MAX);
    }

    /// 리뷰 수정: URI 없는 EXTINF가 남아도 ENDLIST가 없으면 NotEnded가 먼저다.
    #[test]
    fn dangling_extinf_without_endlist_is_not_ended() {
        let text = "#EXTM3U\n#EXTINF:1,\na.ts\n#EXTINF:1,\n";
        assert!(matches!(
            parse_media(text, &media_base()),
            Err(Error::Unsupported(Unsupported::NotEnded))
        ));
    }

    /// 리뷰 수정: GAP·SKIP은 거부하고 LL-HLS PART·PRELOAD-HINT는 무시한다.
    #[test]
    fn rejects_gap_and_skip_ignores_parts() {
        let b = media_base();
        let gap = "#EXTM3U\n#EXT-X-GAP\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST\n";
        assert!(matches!(
            parse_media(gap, &b),
            Err(Error::Unsupported(Unsupported::Gap))
        ));
        let skip = "#EXTM3U\n#EXT-X-SKIP:SKIPPED-SEGMENTS=3\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST\n";
        assert!(matches!(
            parse_media(skip, &b),
            Err(Error::Unsupported(Unsupported::Skip))
        ));
        let parts = "#EXTM3U\n#EXT-X-PART:DURATION=1,URI=\"p.mp4\"\n#EXTINF:1,\na.ts\n#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"q.mp4\"\n#EXT-X-ENDLIST\n";
        assert_eq!(parse_media(parts, &b).unwrap().segments.len(), 1);
    }

    #[test]
    fn allows_key_none() {
        let p = synthetic("media_key_none.m3u8").unwrap();
        assert_eq!(p.segments.len(), 3);
        assert!(p.init.is_some());
    }

    #[test]
    fn allows_long_extinf() {
        let p = synthetic("media_long_extinf.m3u8").unwrap();
        let ms: Vec<_> = p.segments.iter().map(|s| s.duration_ms).collect();
        assert_eq!(ms, [2000, 2500, 2000]);
        assert_eq!(p.total_duration_ms, 6500);
        assert_eq!(durations_crc(&p), crc_of(&[2000, 2500, 2000]));
    }

    /// TS playlist(MAP 없음)도 파싱은 된다(AES seam §11-3). 주석·CRLF·BOM·모르는 태그 허용.
    #[test]
    fn media_without_map_and_quirks() {
        let text = "\u{feff}#EXTM3U\r\n# 주석\r\n#EXT-X-TARGETDURATION:4\r\n#EXT-X-FOO:1\r\n#EXT-X-KEY:METHOD=NONE\r\n#EXTINF:1.666667,\r\na.ts\r\n#EXT-X-ENDLIST\r\n";
        let p = parse_media(text, &media_base()).unwrap();
        assert_eq!(p.init, None);
        assert_eq!(p.segments[0].duration_ms, 1667);
        assert!(p.segments[0].uri.as_str().ends_with("~hmac=0000/a.ts"));
    }

    /// `#EXT-X-DISCONTINUITY-SEQUENCE`는 이름이 겹쳐도 거부하지 않는다(접두어 비교 금지).
    #[test]
    fn exact_tag_names() {
        let p = parse_media(&fixture_str("testdata/hls/media.m3u8"), &media_base()).unwrap();
        assert_eq!(p.segments.len(), 30);
        // 따옴표 안의 쉼표가 있는 KEY URI
        let text = "#EXTM3U\n#EXT-X-KEY:URI=\"https://k/a,b\",METHOD=SAMPLE-AES\n#EXTINF:2,\na.m4v\n#EXT-X-ENDLIST\n";
        let Err(Error::Unsupported(Unsupported::Encrypted(m))) = parse_media(text, &media_base())
        else {
            panic!()
        };
        assert_eq!(m, "SAMPLE-AES");
    }

    #[test]
    fn media_rejects_malformed() {
        let b = media_base();
        let bad = [
            "<html></html>",
            "#EXTM3U\na.m4v\n#EXT-X-ENDLIST\n",
            "#EXTM3U\n#EXTINF:abc,\na.m4v\n#EXT-X-ENDLIST\n",
            "#EXTM3U\n#EXTINF:-1,\na.m4v\n#EXT-X-ENDLIST\n",
            "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:x\n#EXTINF:2,\na.m4v\n#EXT-X-ENDLIST\n",
            "#EXTM3U\n#EXT-X-ENDLIST\n",
            "#EXTM3U\n#EXT-X-MAP:BYTERANGE_X=1\n#EXTINF:2,\na.m4v\n#EXT-X-ENDLIST\n",
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv/x.m3u8\n",
            // 리뷰 수정: URI 없는 EXTINF(연속 두 개, 끝에 남음)
            "#EXTM3U\n#EXTINF:2,\n#EXTINF:5,\na.m4v\n#EXT-X-ENDLIST\n",
            "#EXTM3U\n#EXTINF:5,\na.m4v\n#EXTINF:9,\n#EXT-X-ENDLIST\n",
            // 리뷰 수정: msn이 u64를 넘음(패닉이 아니라 Parse)
            "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:18446744073709551615\n#EXTINF:1,\na.ts\n#EXTINF:1,\nb.ts\n#EXT-X-ENDLIST\n",
        ];
        for t in bad {
            assert!(
                matches!(parse_media(t, &b), Err(Error::Parse { .. })),
                "{t:?} → {:?}",
                parse_media(t, &b)
            );
        }
    }

    #[test]
    fn parse_attrs_quoted() {
        assert_eq!(
            parse_attrs(r#"BANDWIDTH=1,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1920x1080"#),
            [
                ("BANDWIDTH", "1"),
                ("CODECS", "avc1.64002A,mp4a.40.2"),
                ("RESOLUTION", "1920x1080")
            ]
        );
    }

    /// 16시간 방송 규모(30,000개). 개수·지문이 맞고 디버그 빌드에서도 1초 안에 끝난다(느슨).
    #[test]
    fn large_playlist_30k() {
        const N: usize = 30_000;
        let mut text = String::from(
            "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI=\"i.m4s?type=hls\"\n",
        );
        let mut ms = Vec::with_capacity(N);
        for i in 0..N {
            let d = if i + 1 == N { 1667 } else { 2000 };
            ms.push(d);
            text.push_str(&format!(
                "#EXT-X-PROGRAM-DATE-TIME:2026-01-01T00:00:00.000Z\n#EXTINF:{}.{:03},\n1080p_{i}_0_{i}.m4v\n",
                d / 1000,
                d % 1000
            ));
        }
        text.push_str("#EXT-X-ENDLIST\n");
        let start = std::time::Instant::now();
        let p = parse_media(&text, &media_base()).unwrap();
        let elapsed = start.elapsed();
        assert_eq!(p.segments.len(), N);
        assert_eq!(p.segments[N - 1].msn, (N - 1) as u64);
        assert_eq!(durations_crc(&p), crc_of(&ms));
        assert_eq!(p.total_duration_ms, 2000 * (N as u64 - 1) + 1667);
        assert!(elapsed.as_secs_f64() < 1.0, "{elapsed:?}");
    }
}
