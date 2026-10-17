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
use crate::model::TimeRange;

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
    parse_media_inner(text, base, false).map(|(p, _, _)| p)
}

/// 라이브 media playlist 한 번의 스냅샷.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiveSnapshot {
    /// 세그먼트가 하나도 없을 수 있다(방송 시작 직후).
    pub playlist: MediaPlaylist,
    /// `EXT-X-ENDLIST`가 있거나, 스트림이 다시 시작되었다(`EXT-X-DISCONTINUITY`·두 번째 `EXT-X-MAP`).
    /// 다시 시작된 쪽의 세그먼트는 `playlist`에 담지 않는다. 이어 붙이면 init이 맞지 않는 파일이 된다.
    pub ended: bool,
    /// `ended` 가운데 스트림이 다시 시작된 경우(`EXT-X-DISCONTINUITY`·두 번째 `EXT-X-MAP`). `ENDLIST`만이면 false
    pub restarted: bool,
}

/// 진행 중인 방송의 media playlist를 읽는다.
///
/// `parse_media`와 달리 `ENDLIST`가 없어도 되고 세그먼트가 없어도 된다. 그 밖의 거부 규칙(KEY, BYTERANGE,
/// GAP, SKIP)은 같고, DISCONTINUITY·두 번째 MAP은 오류가 아니라 `ended`·`restarted`로 알린다.
pub fn parse_live_media(text: &str, base: &Url) -> Result<LiveSnapshot, Error> {
    let (playlist, ended, restarted) = parse_media_inner(text, base, true)?;
    Ok(LiveSnapshot {
        playlist,
        ended,
        restarted,
    })
}

/// 반환: (목록, `ended`, `restarted`)
fn parse_media_inner(
    text: &str,
    base: &Url,
    live: bool,
) -> Result<(MediaPlaylist, bool, bool), Error> {
    const WHAT: &str = "media playlist";
    check_header(text, WHAT)?;
    let mut media_sequence: u64 = 0;
    let mut init: Option<Url> = None;
    let mut durations: Vec<u32> = Vec::new();
    let mut uris: Vec<Url> = Vec::new();
    let mut pending: Option<u32> = None;
    let mut ended = false;
    let mut restarted = false;

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
                    if live && init.is_some() {
                        ended = true;
                        restarted = true;
                        break;
                    }
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
            "#EXT-X-DISCONTINUITY" if live => {
                ended = true;
                restarted = true;
                break;
            }
            "#EXT-X-DISCONTINUITY" => return Err(Error::Unsupported(Unsupported::Discontinuity)),
            "#EXT-X-BYTERANGE" => return Err(Error::Unsupported(Unsupported::ByteRange)),
            // 표시된 세그먼트가 없거나(GAP) 목록에서 세그먼트가 빠진(SKIP, delta playlist) 경우라
            // 이어 붙이면 구멍 난 파일이 된다.
            "#EXT-X-GAP" => return Err(Error::Unsupported(Unsupported::Gap)),
            "#EXT-X-SKIP" => return Err(Error::Unsupported(Unsupported::Skip)),
            "#EXT-X-ENDLIST" => ended = true,
            "#EXT-X-STREAM-INF" => {
                return Err(parse_err(WHAT, "master playlist입니다"));
            }
            // LL-HLS 태그는 전체 세그먼트가 함께 있으니 조용히 무시한다(폴링마다 경고가 쌓이지 않게, core.md 61)
            "#EXT-X-PART"
            | "#EXT-X-PART-INF"
            | "#EXT-X-PRELOAD-HINT"
            | "#EXT-X-SERVER-CONTROL"
            | "#EXT-X-RENDITION-REPORT" => {}
            other => tracing::warn!(tag = other, "모르는 HLS 태그를 무시합니다"),
        }
    }
    if !ended && !live {
        return Err(Error::Unsupported(Unsupported::NotEnded));
    }
    if pending.is_some() {
        return Err(parse_err(WHAT, "URI 없는 EXTINF로 끝납니다"));
    }
    if uris.is_empty() && !live {
        return Err(parse_err(WHAT, "세그먼트가 없습니다"));
    }
    // 마지막 msn이 u64 안에 들어가는지 한 번에 확인한다(이후 덧셈은 넘치지 않는다).
    media_sequence
        .checked_add((uris.len() as u64).saturating_sub(1))
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
    Ok((
        MediaPlaylist {
            media_sequence,
            init,
            segments,
            total_duration_ms,
        },
        ended,
        restarted,
    ))
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

/// `select_range`가 고른 조각 범위. playlist 안 위치 [first, last_excl).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SegmentSpan {
    pub first: u32,
    pub last_excl: u32,
}

/// 시각 구간을 조각 범위로 고른다(기능 ②, range.md).
///
/// - 입력은 `parse_media`(VOD)가 만든 playlist뿐이다. 생방송 창(`parse_live_media`)에는 쓰지 않는다.
///   창이 계속 밀려서 위치 기반 구간이 성립하지 않는다.
/// - 전제: "playlist 첫 조각의 시작 = 치지직 플레이어 0:00:00"이다. EXTINF는 지속 시간일 뿐이다
///   (RFC 8216 §4.3.2.1). 이 전제는 사용자 실측 M-②-2로만 확인한다.
/// - 마무리 defrag는 파일 안 시각만 0부터 다시 쌓는다. 이 대응에는 관여하지 않는다.
///
/// 규칙: 조각 i의 시작 누적 `c[i] = Σ d[0..i]`일 때, `first`는 `c[i] <= start`인 가장 큰 i(시작은 내린다),
/// `last_excl`은 `c[j] >= end`인 가장 작은 j(끝은 올린다)다. 끝이 playlist보다 크면 자른다.
/// 받는 시각 `[c[first], c[last_excl])`은 요청 구간을 늘 포함한다. 길이 0 조각이 시작 경계에 있으면
/// 가장 큰 i 규칙 때문에 건너뛴다.
pub fn select_range(pl: &MediaPlaylist, r: TimeRange) -> Result<SegmentSpan, Error> {
    let start = r.start_ms;
    let total = pl.total_duration_ms;
    if let Some(e) = r.end_ms
        && start >= e
    {
        return Err(Error::RangeOutOfBounds {
            detail: format!("시작 {start}ms가 끝 {e}ms보다 늦거나 같습니다"),
        });
    }
    if start >= total {
        return Err(Error::RangeOutOfBounds {
            detail: format!("시작 {start}ms가 전체 {total}ms 뒤입니다"),
        });
    }
    let end = r.end_ms.unwrap_or(total).min(total);
    let n = pl.segments.len();
    // 앞에서부터 누적하며 c[i] > start가 되기 직전의 i를 고른다.
    let mut first = 0usize;
    let mut c = 0u64;
    for (i, s) in pl.segments.iter().enumerate() {
        if c > start {
            break;
        }
        first = i;
        c += u64::from(s.duration_ms);
    }
    // c[first]부터 다시 센다. c[j] >= end인 가장 작은 j(j > first).
    let mut acc: u64 = pl.segments[..first]
        .iter()
        .map(|s| u64::from(s.duration_ms))
        .sum();
    let mut last_excl = first;
    for j in first + 1..=n {
        acc += u64::from(pl.segments[j - 1].duration_ms);
        last_excl = j;
        if acc >= end {
            break;
        }
    }
    if last_excl <= first {
        return Err(Error::RangeOutOfBounds {
            detail: "고른 조각이 없습니다".into(),
        });
    }
    Ok(SegmentSpan {
        first: first as u32,
        last_excl: last_excl as u32,
    })
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

    fn pl(d: &[u32]) -> MediaPlaylist {
        MediaPlaylist {
            media_sequence: 0,
            init: None,
            segments: d
                .iter()
                .enumerate()
                .map(|(i, &duration_ms)| Segment {
                    msn: i as u64,
                    duration_ms,
                    uri: Url::parse(&format!("http://h/s{i}.m4v")).unwrap(),
                })
                .collect(),
            total_duration_ms: d.iter().map(|&x| u64::from(x)).sum(),
        }
    }

    fn tr(start_ms: u64, end_ms: Option<u64>) -> TimeRange {
        TimeRange { start_ms, end_ms }
    }

    fn span(p: &MediaPlaylist, r: TimeRange) -> Result<(u32, u32), Error> {
        select_range(p, r).map(|s| (s.first, s.last_excl))
    }

    #[test]
    fn select_range_table() {
        let p = pl(&[2000; 10]);
        let ok = [
            (tr(0, Some(20000)), (0, 10)),
            (tr(0, None), (0, 10)),
            (tr(4000, Some(8000)), (2, 4)),
            (tr(4001, Some(7999)), (2, 4)),
            (tr(3999, Some(8001)), (1, 5)),
            (tr(0, Some(1)), (0, 1)),
            (tr(19999, None), (9, 10)),
            (tr(5000, Some(99999)), (2, 10)),
        ];
        for (r, want) in ok {
            assert_eq!(span(&p, r).unwrap(), want, "{r:?}");
        }
        for r in [
            tr(20000, None),
            tr(25000, Some(30000)),
            tr(6000, Some(6000)),
            tr(7000, Some(6000)),
        ] {
            assert!(
                matches!(select_range(&p, r), Err(Error::RangeOutOfBounds { .. })),
                "{r:?}"
            );
        }
    }

    #[test]
    fn select_range_uneven_rounding() {
        // c = 0, 1999, 4000, 6000, 7500
        let p = pl(&[1999, 2001, 2000, 1500]);
        assert_eq!(span(&p, tr(1999, Some(4000))).unwrap(), (1, 2));
        assert_eq!(span(&p, tr(1998, Some(4001))).unwrap(), (0, 3));
        assert_eq!(span(&p, tr(6000, None)).unwrap(), (3, 4));
        assert_eq!(span(&p, tr(5999, Some(7500))).unwrap(), (2, 4));
    }

    /// 길이 0 조각이 시작 경계에 있으면 건너뛴다(문서화한 동작).
    #[test]
    fn select_range_zero_length_segment_at_start() {
        let p = pl(&[0, 2000, 2000]);
        assert_eq!(span(&p, tr(0, None)).unwrap(), (1, 3));
    }

    #[test]
    fn select_range_via_parse_media() {
        let mut t = String::from(
            "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI=\"init.mp4\"\n",
        );
        for i in 0..30 {
            t.push_str(&format!("#EXTINF:2.000,\nseg{i}.m4v\n"));
        }
        t.push_str("#EXT-X-ENDLIST\n");
        let p = parse_media(&t, &media_base()).unwrap();
        assert_eq!(span(&p, tr(10000, Some(20000))).unwrap(), (5, 10));
    }

    const MASTER_BASE: &str = "https://hls.example.invalid/live_rewind/kr/streamkey0/vod_playlist.m3u8?hdnts=st=0~exp=0~acl=*/kr/*~hmac=0000";
    const MEDIA_BASE: &str = "https://hls.example.invalid/live_rewind/kr/streamkey0/144p/hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=fakepath/vod_chunklist.m3u8";

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

    fn live_text(extra_before: &str, msns: std::ops::Range<u64>, tail: &str) -> String {
        let mut t = format!(
            "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:{}\n#EXT-X-MAP:URI=\"init.mp4?t=1\"\n",
            msns.start
        );
        t.push_str(extra_before);
        for m in msns {
            t.push_str(&format!("#EXTINF:2.000,\nseg{m}.m4v?t=1\n"));
        }
        t.push_str(tail);
        t
    }

    /// 진행 중인 방송: ENDLIST가 없어도 읽고, msn은 `EXT-X-MEDIA-SEQUENCE`부터 센다.
    #[test]
    fn live_media_without_endlist() {
        let snap = parse_live_media(&live_text("", 100..103, ""), &media_base()).unwrap();
        assert!(!snap.ended);
        let msns: Vec<u64> = snap.playlist.segments.iter().map(|s| s.msn).collect();
        assert_eq!(msns, [100, 101, 102]);
        assert!(snap.playlist.init.is_some());
        // VOD용 파서는 여전히 ENDLIST 없는 목록을 거부한다.
        assert!(matches!(
            parse_media(&live_text("", 100..103, ""), &media_base()),
            Err(Error::Unsupported(Unsupported::NotEnded))
        ));
    }

    /// 로그를 모으는 writer(스레드 지역 subscriber용).
    #[derive(Clone, Default)]
    struct LogBuf(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for LogBuf {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    /// LL-HLS 태그는 전체 세그먼트가 함께 있으니 조용히 무시한다(폴링마다 경고가 쌓이지 않게, core.md 61).
    /// 모르는 태그는 지금처럼 경고한다(양성 대조).
    #[test]
    fn live_ll_tags_do_not_warn() {
        let buf = LogBuf::default();
        let w = buf.clone();
        let subscriber = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(move || w.clone())
            .finish();
        let log = || String::from_utf8(buf.0.lock().unwrap().clone()).unwrap();
        let before = "#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.5\n#EXT-X-PART-INF:PART-TARGET=0.5\n";
        let tail = "#EXT-X-PART:DURATION=0.5,URI=\"p0.m4s\"\n#EXT-X-PART:DURATION=0.5,URI=\"p1.m4s\"\n#EXT-X-PRELOAD-HINT:TYPE=PART,URI=\"p2.m4s\"\n#EXT-X-RENDITION-REPORT:URI=\"../audio/chunklist.m3u8\",LAST-MSN=102\n";
        tracing::subscriber::with_default(subscriber, || {
            let snap = parse_live_media(&live_text(before, 100..102, tail), &media_base()).unwrap();
            assert_eq!(snap.playlist.segments.len(), 2);
            assert!(!log().contains("모르는 HLS 태그"), "{}", log());
            // 대조: 정말 모르는 태그는 경고한다
            parse_live_media(
                &live_text("#EXT-X-UNKNOWNTAG:1\n", 100..102, ""),
                &media_base(),
            )
            .unwrap();
            assert!(log().contains("모르는 HLS 태그"), "{}", log());
        });
    }

    #[test]
    fn live_media_ended_and_empty() {
        let snap =
            parse_live_media(&live_text("", 5..7, "#EXT-X-ENDLIST\n"), &media_base()).unwrap();
        assert!(snap.ended && !snap.restarted);
        assert_eq!(snap.playlist.segments.len(), 2);
        // 방송 시작 직후: 세그먼트가 아직 없다
        let snap = parse_live_media(&live_text("", 0..0, ""), &media_base()).unwrap();
        assert!(!snap.ended && !snap.restarted && snap.playlist.segments.is_empty());
    }

    /// DISCONTINUITY·새 MAP은 스트림이 다시 시작되었다는 뜻이다. 그 앞까지만 담고 끝으로 알린다.
    #[test]
    fn live_media_restart_ends() {
        let t = live_text(
            "",
            10..12,
            "#EXT-X-DISCONTINUITY\n#EXTINF:2.000,\nafter.m4v\n",
        );
        let snap = parse_live_media(&t, &media_base()).unwrap();
        assert!(snap.ended && snap.restarted);
        assert_eq!(snap.playlist.segments.len(), 2);
        let t = live_text(
            "",
            10..12,
            "#EXT-X-MAP:URI=\"init2.mp4\"\n#EXTINF:2.000,\nafter.m4v\n",
        );
        let snap = parse_live_media(&t, &media_base()).unwrap();
        assert!(snap.ended && snap.restarted);
        assert_eq!(snap.playlist.segments.len(), 2);
        // VOD용 파서는 여전히 거부한다.
        let t = live_text(
            "",
            10..12,
            "#EXT-X-DISCONTINUITY\n#EXTINF:2.000,\nafter.m4v\n#EXT-X-ENDLIST\n",
        );
        assert!(matches!(
            parse_media(&t, &media_base()),
            Err(Error::Unsupported(Unsupported::Discontinuity))
        ));
    }

    /// 라이브에서도 암호화·BYTERANGE·GAP·SKIP은 거부한다.
    #[test]
    fn live_media_still_rejects() {
        for tag in [
            "#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\n",
            "#EXT-X-GAP\n",
            "#EXT-X-SKIP:SKIPPED-SEGMENTS=3\n",
        ] {
            assert!(
                matches!(
                    parse_live_media(&live_text(tag, 1..3, ""), &media_base()),
                    Err(Error::Unsupported(_))
                ),
                "{tag}"
            );
        }
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
            "https://hls.example.invalid/live_rewind/kr/streamkey0/144p/hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=fakepath/vod_chunklist.m3u8"
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
                .ends_with("/144p/hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=fakepath/144p_0_0_0.m4s?type=hls&filetype=.m4s")
        );
        assert!(
            p.segments[0]
                .uri
                .as_str()
                .ends_with("~hmac=fakepath/144p_seg0.m4v")
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
        assert!(p.segments[0].uri.as_str().ends_with("~hmac=fakepath/a.ts"));
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

    /// `#EXTM3U`로 시작하지 않으면 master든 media든 거부한다(앞 빈 줄·CRLF·BOM은 허용).
    #[test]
    fn header_is_required() {
        let b = media_base();
        let body = "#EXTINF:2,\na.m4v\n#EXT-X-ENDLIST\n";
        assert!(matches!(parse_media(body, &b), Err(Error::Parse { .. })));
        assert!(matches!(
            parse_master("#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n", &b),
            Err(Error::Parse { .. })
        ));
        assert!(matches!(
            parse_media(&format!("#EXTM3Uxx\n{body}"), &b),
            Err(Error::Parse { .. })
        ));
        assert!(parse_media(&format!("\n#EXTM3U\r\n{body}"), &b).is_ok());
    }

    #[test]
    fn duration_ms_rounding_and_bounds() {
        assert_eq!(parse_duration_ms("0"), Some(0));
        assert_eq!(parse_duration_ms("0.0004"), Some(0));
        assert_eq!(parse_duration_ms("0.0005"), Some(1));
        assert_eq!(parse_duration_ms("2.0"), Some(2000));
        assert_eq!(parse_duration_ms("-0.001"), None);
        assert_eq!(parse_duration_ms("NaN"), None);
        assert_eq!(parse_duration_ms("inf"), None);
        assert_eq!(parse_duration_ms("4294967.295"), Some(u32::MAX));
        assert_eq!(parse_duration_ms("4294967.296"), None);
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

    /// 16시간 남짓 방송 규모(30,000개). 개수·지문이 맞고 디버그 빌드에서도 1초 안에 끝난다(느슨).
    #[test]
    fn large_playlist_30k() {
        const N: usize = 30_000;
        let mut text = String::from(
            "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI=\"i.m4s?type=hls\"\n",
        );
        let mut ms = Vec::with_capacity(N);
        for i in 0..N {
            let d = if i + 1 == N { 1500 } else { 2000 };
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
        assert_eq!(p.total_duration_ms, 2000 * (N as u64 - 1) + 1500);
        assert!(elapsed.as_secs_f64() < 1.0, "{elapsed:?}");
    }
}
