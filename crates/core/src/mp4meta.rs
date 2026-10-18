//! 받은 mp4에 제목·채널·날짜·원본 주소와 표지를 넣는다(core.md 구현 중 변경 80, 설계 `docs/design/features/mp4-metadata.md`).
//!
//! iTunes 스타일 `moov/udta/meta/ilst`(ffmpeg의 mp4 muxer와 같은 배치)를 만든다.
//!
//! - `build_udta`: 태그와 표지로 `udta` 상자 전체를 만드는 순수 함수. 빠른 다시보기·생방송은 이것을 defrag가 만드는
//!   새 `moov`에 함께 넣는다(`defrag::defragment_in`의 `udta` 인자).
//! - `rewrite_to`: 일반 VOD·클립(PD mp4, `[ftyp, moov, free, mdat]`)용. **원본 `.part`는 읽기만 한다.** 같은 폴더의 임시
//!   파일에 `[ftyp, 새 moov(udta 포함), …, mdat]`을 쓰고 sync한다(faststart 유지). 새 `moov`가 커져 뒤 바이트가 움직이면
//!   모든 `trak`의 `stco`/`co64`를 그만큼 고친다. 옛 `moov` 바로 뒤 `free`가 있으면 그 자리를 먼저 쓴다. 최종 이름으로
//!   옮기는 것은 `PartFile::finalize_rewritten`이다(mp4-metadata.md §6.2, core.md 구현 중 변경 83).
//!
//! 실패하면 임시 파일을 지우고 오류를 돌려준다. 원본이 그대로라 호출한 쪽은 태그 없이 원본을 마무리한다.
//! 벽시계·앱 버전처럼 실행마다 달라지는 값은 넣지 않아 같은 입력이 같은 바이트가 된다.

use std::io::{self, Read, Seek, SeekFrom, Write};
use std::ops::Range;
use std::path::Path;

use crate::download::defrag::{
    Fail, FileSrc, MAX_META_BOX, Source, bad, be32, be64, children, find, read_vec, scan,
};
use crate::error::Error;
use crate::fsutil::map_io_error;
use crate::model::{ContentKind, ContentMeta, ContentRef, TimeRange};
use crate::naming::{parse_live_date, range_suffix, truncate_utf8};
use crate::url::public_page_url;

/// 오류 메시지의 대상 이름.
const WHAT: &str = "mp4";
/// 글자 원자 하나의 상한(바이트, UTF-8 경계에서 자른다). 메모리·상자 크기 보호용이다 **[잠정]** 근거 없음, ADR-0009 묶음.
pub(crate) const MAX_ATOM_BYTES: usize = 1024;
/// 표지 이미지 상한(바이트) **[잠정]** 근거 없음, ADR-0009 묶음.
pub(crate) const MAX_COVER_BYTES: usize = 2 << 20;

/// `data` 상자의 type 값(QuickTime well-known type).
const TYPE_UTF8: u32 = 1;
const TYPE_JPEG: u32 = 13;
const TYPE_PNG: u32 = 14;

/// 태그를 만드는 데 필요한 것. 서명 주소는 들어올 길이 없다(원본 주소는 `ContentRef`로만 만든다).
///
/// `thumbnail_url`은 쿼리가 서명일 수 있어 `Debug`가 가린다.
#[derive(Clone)]
pub(crate) struct TagInput {
    pub(crate) meta: ContentMeta,
    pub(crate) content: ContentRef,
    /// 구간 받기면 제목 뒤에 파일 이름과 같은 접미사를 붙인다
    pub(crate) range: Option<TimeRange>,
    pub(crate) thumbnail_url: Option<::url::Url>,
}

impl std::fmt::Debug for TagInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TagInput")
            .field("content", &self.content)
            .field("range", &self.range)
            .field(
                "thumbnail_url",
                &self.thumbnail_url.as_ref().map(crate::http::redact_url),
            )
            .finish_non_exhaustive()
    }
}

/// 글자 원자 네 개. 비어 있으면 그 원자를 넣지 않는다.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Tags {
    /// `©nam`
    pub(crate) name: Option<String>,
    /// `©ART`
    pub(crate) artist: Option<String>,
    /// `©day`
    pub(crate) day: Option<String>,
    /// `©cmt`
    pub(crate) comment: Option<String>,
}

/// 앞뒤 공백을 지우고 비면 `None`, 1 KiB를 넘으면 UTF-8 경계에서 자른다.
fn clean(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        return None;
    }
    Some(truncate_utf8(t, MAX_ATOM_BYTES).trim_end().to_string())
}

/// `YYYY-MM-DD`로 읽히는 날짜만 남긴다.
fn day_of(raw: Option<&str>) -> Option<String> {
    raw.and_then(parse_live_date)
        .map(|(y, m, d)| format!("{y:04}-{m:02}-{d:02}"))
}

impl TagInput {
    /// 값을 `Tags`로 옮긴다(mp4-metadata.md §4).
    pub(crate) fn tags(&self) -> Tags {
        let m = &self.meta;
        let title = m.title.trim();
        let name = if title.is_empty() {
            None
        } else if let Some(r) = &self.range {
            // 접미사가 잘리지 않게 제목 쪽을 줄인다(파일 이름과 같은 규칙)
            let suffix = range_suffix(r);
            let head = truncate_utf8(title, MAX_ATOM_BYTES.saturating_sub(suffix.len())).trim_end();
            Some(format!("{head}{suffix}"))
        } else {
            clean(title)
        };
        let day = match m.kind {
            ContentKind::Video => {
                day_of(m.live_open_date.as_deref()).or_else(|| day_of(m.publish_date.as_deref()))
            }
            ContentKind::Live => day_of(m.live_open_date.as_deref()),
            ContentKind::Clip => None,
        };
        Tags {
            name,
            artist: clean(&m.channel_name),
            day,
            comment: Some(public_page_url(&self.content)),
        }
    }
}

/// 표지 이미지 형식. 앞 바이트로만 정한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CoverKind {
    Jpeg,
    Png,
}

/// 표지 이미지.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Cover {
    pub(crate) kind: CoverKind,
    pub(crate) data: Vec<u8>,
}

impl std::fmt::Debug for Cover {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Cover")
            .field("kind", &self.kind)
            .field("bytes", &self.data.len())
            .finish()
    }
}

impl Cover {
    /// 앞 바이트로 JPEG(`FF D8 FF`)·PNG(`89 50 4E 47 0D 0A 1A 0A`)를 가린다. 그 밖이거나 비었거나 상한을 넘으면 `None`.
    /// `Content-Type`은 믿지 않고 디코드도 하지 않는다.
    pub(crate) fn sniff(data: Vec<u8>) -> Option<Cover> {
        if data.is_empty() || data.len() > MAX_COVER_BYTES {
            return None;
        }
        let kind = if data.starts_with(&[0xff, 0xd8, 0xff]) {
            CoverKind::Jpeg
        } else if data.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
            CoverKind::Png
        } else {
            return None;
        };
        Some(Cover { kind, data })
    }

    fn data_type(&self) -> u32 {
        match self.kind {
            CoverKind::Jpeg => TYPE_JPEG,
            CoverKind::Png => TYPE_PNG,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// 상자 만들기

/// 상자 하나. 크기는 32비트다(본문은 표지 상한 2 MiB 안이라 넘칠 수 없다).
fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let size = u32::try_from(8 + body.len()).expect("메타데이터 상자는 4 GiB보다 작다");
    let mut v = Vec::with_capacity(body.len() + 8);
    v.extend_from_slice(&size.to_be_bytes());
    v.extend_from_slice(kind);
    v.extend_from_slice(body);
    v
}

/// `ilst` 원자 하나: `[종류 { data { type(4) locale(4) 값 } }]`.
fn atom(kind: &[u8; 4], data_type: u32, value: &[u8]) -> Vec<u8> {
    let mut d = Vec::with_capacity(value.len() + 8);
    d.extend_from_slice(&data_type.to_be_bytes());
    d.extend_from_slice(&0u32.to_be_bytes());
    d.extend_from_slice(value);
    bx(kind, &bx(b"data", &d))
}

/// `udta` 상자 전체를 만든다. 원자가 하나도 없으면 `None`이다.
///
/// 배치(ffmpeg 참조 파일과 대조해 확정, core.md 80):
/// `udta { meta(full box) { hdlr('mdir','appl') ilst { ©nam ©ART ©day ©cmt covr } } }`.
/// 원자 순서는 고정이다. `©`는 latin1 한 바이트(0xA9)다.
pub(crate) fn build_udta(tags: &Tags, cover: Option<&Cover>) -> Option<Vec<u8>> {
    let mut ilst = Vec::new();
    for (kind, text) in [
        (b"\xa9nam", &tags.name),
        (b"\xa9ART", &tags.artist),
        (b"\xa9day", &tags.day),
        (b"\xa9cmt", &tags.comment),
    ] {
        if let Some(t) = text.as_deref().and_then(clean) {
            ilst.extend(atom(kind, TYPE_UTF8, t.as_bytes()));
        }
    }
    if let Some(c) = cover {
        ilst.extend(atom(b"covr", c.data_type(), &c.data));
    }
    if ilst.is_empty() {
        return None;
    }
    // hdlr: version/flags 0, pre_defined 0, handler_type 'mdir', reserved 'appl' 0 0, name "\0"
    let mut hdlr = vec![0u8; 8];
    hdlr.extend_from_slice(b"mdirappl");
    hdlr.extend_from_slice(&[0u8; 8]);
    hdlr.push(0);
    let mut meta = vec![0u8; 4];
    meta.extend(bx(b"hdlr", &hdlr));
    meta.extend(bx(b"ilst", &ilst));
    Some(bx(b"udta", &bx(b"meta", &meta)))
}

// ---------------------------------------------------------------------------------------------
// 임시 파일에 다시 쓰기(PD)

/// `plan_rewrite`의 결과.
#[derive(Debug)]
pub(crate) enum Plan {
    /// 옛 `moov`가 이미 같은 `udta`로 끝난다. 다시 쓸 것이 없다
    AlreadyTagged,
    Rewrite(Rewrite),
}

/// 다시 쓸 파일: 원본 `[0, before)` + `moov`(남는 자리를 채우는 `free` 포함) + 원본 `[after, src_len)`.
#[derive(Debug)]
pub(crate) struct Rewrite {
    /// 옛 `moov`의 시작 위치. 그 앞은 바이트 그대로 옮긴다
    pub(crate) before: u64,
    /// 새 `moov`(청크 위치를 `delta`만큼 고친 것)와 남은 자리를 채우는 `free`
    pub(crate) moov: Vec<u8>,
    /// 옛 `moov`(와 흡수한 `free`)의 끝. 그 뒤는 바이트 그대로 옮긴다
    pub(crate) after: u64,
    /// 원본 길이
    pub(crate) src_len: u64,
}

impl Rewrite {
    /// 다시 쓴 파일의 길이.
    pub(crate) fn out_len(&self) -> u64 {
        self.before + self.moov.len() as u64 + (self.src_len - self.after)
    }
}

/// `rewrite_to`의 결과.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Retagged {
    /// 임시 파일에 다 쓰고 sync했다. 길이는 `len`이다
    Written { len: u64 },
    /// 이미 같은 태그다. 임시 파일을 만들지 않았다
    AlreadyTagged,
}

fn fail_error(f: Fail) -> Error {
    match f {
        Fail::Io(e) if e.kind() == io::ErrorKind::UnexpectedEof => Error::Parse {
            what: WHAT,
            detail: "파일이 예상보다 짧다".into(),
        },
        Fail::Io(e) => map_io_error("read", Path::new(WHAT), e),
        Fail::Bad(detail) => Error::Parse { what: WHAT, detail },
    }
}

/// `moov` 상자 하나: 헤더(크기 4 + 종류 4)를 붙인다.
fn moov_box(body: &[u8]) -> Result<Vec<u8>, Fail> {
    let size = u32::try_from(body.len() + 8).map_err(|_| bad("moov가 4 GiB를 넘는다"))?;
    let mut v = Vec::with_capacity(body.len() + 8);
    v.extend_from_slice(&size.to_be_bytes());
    v.extend_from_slice(b"moov");
    v.extend_from_slice(body);
    Ok(v)
}

/// 새 `moov` 바이트: 옛 본문의 자식에서 `udta`를 빼고 새 `udta`를 끝에 붙인다. 나머지는 바이트 그대로다(자식 순서도
/// 그대로라 `[free, mvhd, …]`처럼 `mvhd`가 첫 자식이 아니어도 된다).
///
/// 거부(`Fail`): 크기 칸이 0인 자식(부모 끝까지라는 뜻이라 뒤에 붙인 `udta`가 그 자식 안으로 먹힌다)이 있을 때,
/// 새 `moov`가 `MAX_META_BOX`를 넘을 때.
fn new_moov(old_body: &[u8], udta: &[u8]) -> Result<Vec<u8>, Fail> {
    let mut body = Vec::with_capacity(old_body.len() + udta.len());
    for c in children(old_body)? {
        if be32(c.full) == 0 {
            return Err(bad("크기가 0인 moov 자식이 있다"));
        }
        if &c.kind != b"udta" {
            body.extend_from_slice(c.full);
        }
    }
    body.extend_from_slice(udta);
    if (body.len() as u64) + 8 > MAX_META_BOX {
        return Err(bad("새 moov가 너무 크다"));
    }
    moov_box(&body)
}

/// 자식 상자 하나: (종류, `buf` 안 본문 범위).
type Span = ([u8; 4], Range<usize>);

/// `buf[body]`의 자식 상자.
fn child_spans(buf: &[u8], body: Range<usize>) -> Result<Vec<Span>, Fail> {
    let mut at = body.start;
    let mut out = Vec::new();
    for c in children(&buf[body])? {
        let hdr = c.full.len() - c.body.len();
        out.push((c.kind, at + hdr..at + c.full.len()));
        at += c.full.len();
    }
    Ok(out)
}

fn only_child(spans: &[([u8; 4], Range<usize>)], kind: &[u8; 4]) -> Result<Range<usize>, Fail> {
    let mut it = spans.iter().filter(|(k, _)| k == kind);
    match (it.next(), it.next()) {
        (Some((_, r)), None) => Ok(r.clone()),
        (None, _) => Err(bad(format!(
            "trak에 {}이 없다",
            String::from_utf8_lossy(kind)
        ))),
        _ => Err(bad(format!(
            "trak에 {}이 둘 이상이다",
            String::from_utf8_lossy(kind)
        ))),
    }
}

/// 새 `moov`(`moov[8..]`이 본문) 안 모든 `trak`의 `stco`/`co64` 항목을 고친다. 옛 위치가 `region_end` 이상이면
/// `delta`를 더하고, `region_start` 아래면(옛 `moov` 앞) 그대로 두고, 그 사이(옛 `moov`·흡수한 `free` 안)면 거부한다.
///
/// 항목 폭이 그대로라 상자 크기가 바뀌지 않는다. `stco`가 32비트를 넘게 되면 거부한다(`co64`로 올리면 `moov`가 커져
/// `delta`가 다시 바뀐다. 그런 파일은 위치가 4 GiB 바로 아래에 있는 경우뿐이고, 그만큼 큰 파일은 muxer가 처음부터
/// `co64`를 쓴다).
fn shift_chunk_offsets(
    moov: &mut [u8],
    region_start: u64,
    region_end: u64,
    delta: i64,
) -> Result<(), Fail> {
    let mut tables = Vec::new();
    for (kind, trak) in child_spans(moov, 8..moov.len())? {
        if &kind != b"trak" {
            continue;
        }
        let mdia = only_child(&child_spans(moov, trak)?, b"mdia")?;
        let minf = only_child(&child_spans(moov, mdia)?, b"minf")?;
        let stbl = only_child(&child_spans(moov, minf)?, b"stbl")?;
        let ts: Vec<_> = child_spans(moov, stbl)?
            .into_iter()
            .filter(|(k, _)| k == b"stco" || k == b"co64")
            .collect();
        match ts.as_slice() {
            [t] => tables.push(t.clone()),
            [] => return Err(bad("trak에 청크 위치 표(stco/co64)가 없다")),
            _ => return Err(bad("trak에 청크 위치 표가 둘 이상이다")),
        }
    }
    for (kind, r) in tables {
        let wide = &kind == b"co64";
        let w = if wide { 8 } else { 4 };
        let body = &mut moov[r];
        if body.len() < 8 {
            return Err(bad("청크 위치 표가 짧다"));
        }
        let count = be32(&body[4..8]) as usize;
        if count.checked_mul(w).and_then(|n| n.checked_add(8)) != Some(body.len()) {
            return Err(bad("청크 위치 표 길이가 항목 수와 맞지 않다"));
        }
        for e in body[8..].chunks_exact_mut(w) {
            let old = if wide { be64(e) } else { u64::from(be32(e)) };
            let new = if old >= region_end {
                old.checked_add_signed(delta)
                    .ok_or_else(|| bad("청크 위치가 넘친다"))?
            } else if old >= region_start {
                return Err(bad("청크 위치가 옛 moov 안을 가리킨다"));
            } else {
                old
            };
            if wide {
                e.copy_from_slice(&new.to_be_bytes());
            } else {
                let v = u32::try_from(new).map_err(|_| bad("stco 위치가 4 GiB를 넘게 된다"))?;
                e.copy_from_slice(&v.to_be_bytes());
            }
        }
    }
    Ok(())
}

/// PD mp4를 새 `udta`로 다시 쓸 계획을 세운다. 원본은 읽기만 한다.
///
/// - 최상위 `moov`가 정확히 하나이고 `mvex`가 없어야 한다. 상자가 파일 끝을 넘거나 크기가 0(파일 끝까지)이면 거부.
/// - 새 `moov` = 옛 자식(`udta` 빼고, 순서 그대로) + 새 `udta`. 옛 것과 같으면 `AlreadyTagged`.
/// - 자리: 옛 `moov`와 바로 뒤 `free`/`skip`(있으면, `MAX_META_BOX` 이하일 때만)을 합친 칸(`avail`)에 넣는다. 8바이트 이상 남으면 남는 만큼
///   `free`로 채워 뒤 바이트가 움직이지 않는다. 아니면 그 `free`를 빼고 뒤를 `delta = 새 - avail`만큼 옮기고(꼭 맞으면
///   0, 1~7바이트 남으면 음수) `stco`/`co64`를 고친다(`shift_chunk_offsets`).
pub(crate) fn plan_rewrite(src: &mut dyn Source, udta: &[u8]) -> Result<Plan, Fail> {
    let tops = scan(src)?;
    let mut moovs = tops.iter().enumerate().filter(|(_, t)| &t.kind == b"moov");
    let (idx, m) = match (moovs.next(), moovs.next()) {
        (Some(x), None) => x,
        (None, _) => return Err(bad("moov가 없다")),
        _ => return Err(bad("moov가 둘 이상이다")),
    };
    let body_len = m.size - m.hdr;
    if body_len > MAX_META_BOX {
        return Err(bad(format!("moov가 너무 크다({body_len} B)")));
    }
    let body = read_vec(src, m.off + m.hdr, body_len)?;
    if find(&children(&body)?, b"mvex").is_some() {
        return Err(bad("조각 구조(mvex) 파일이다"));
    }
    let mut moov = new_moov(&body, udta)?;
    if moov[8..] == body[..] {
        return Ok(Plan::AlreadyTagged);
    }
    let free_after = tops
        .get(idx + 1)
        .filter(|t| matches!(&t.kind, b"free" | b"skip"))
        .map_or(0, |t| t.size);
    // 흡수한 free는 `moov`와 함께 메모리에서 `free` 상자로 채워진다. 상한을 넘는 free는 흡수하지 않고 다른
    // 뒤 바이트처럼 `delta`만큼 옮긴다(복사는 스트리밍이라 메모리를 쓰지 않는다).
    let free_after = if free_after > MAX_META_BOX {
        0
    } else {
        free_after
    };
    let avail = m.size + free_after;
    let new_len = moov.len() as u64;
    // 8바이트 이상 남으면 free로 채워 뒤를 그대로 두고, 아니면(꼭 맞음 포함) 뒤를 `delta`만큼 옮긴다
    let delta = if let Some(pad) = avail
        .checked_sub(new_len)
        .filter(|p| *p >= 8)
        .and_then(|p| u32::try_from(p).ok())
    {
        moov.extend_from_slice(&pad.to_be_bytes());
        moov.extend_from_slice(b"free");
        moov.resize(avail as usize, 0);
        0
    } else {
        i64::try_from(new_len).map_err(|_| bad("moov 크기"))?
            - i64::try_from(avail).map_err(|_| bad("moov 크기"))?
    };
    let region_end = m.off + avail;
    if delta != 0 {
        shift_chunk_offsets(&mut moov, m.off, region_end, delta)?;
    }
    Ok(Plan::Rewrite(Rewrite {
        before: m.off,
        moov,
        after: region_end,
        src_len: src.len(),
    }))
}

/// `n`바이트를 그대로 옮긴다. 원본이 모자라면 `UnexpectedEof`다.
fn copy_exact<R: Read, W: Write>(src: &mut R, out: &mut W, n: u64) -> io::Result<()> {
    let copied = io::copy(&mut src.by_ref().take(n), out)?;
    if copied != n {
        return Err(io::ErrorKind::UnexpectedEof.into());
    }
    Ok(())
}

/// 계획대로 원본을 `out`에 쓴다(sync는 하지 않는다).
pub(crate) fn write_rewrite<R: Read + Seek, W: Write>(
    src: &mut R,
    plan: &Rewrite,
    out: &mut W,
) -> io::Result<()> {
    src.seek(SeekFrom::Start(0))?;
    copy_exact(src, out, plan.before)?;
    out.write_all(&plan.moov)?;
    src.seek(SeekFrom::Start(plan.after))?;
    copy_exact(src, out, plan.src_len - plan.after)
}

/// 임시 파일 쓰기. 테스트가 쓰기·sync 실패(디스크 부족 등)를 주입하려고 둔다.
pub(crate) trait SyncWrite: Write {
    fn sync(&mut self) -> io::Result<()>;
}

impl SyncWrite for std::fs::File {
    fn sync(&mut self) -> io::Result<()> {
        self.sync_all()
    }
}

/// 임시 파일 쓰기 버퍼.
const WRITE_BUF: usize = 1 << 20;

/// PD `.part`(`src`, 길이 `src_len`)를 새 `udta`로 다시 써 `tmp`에 둔다. **원본은 바꾸지 않는다.**
///
/// 계획(`plan_rewrite`) → `tmp`를 `open`으로 만들고(남은 것은 덮는다) 쓰기 → flush → sync. 쓰기 단계에서 실패하면
/// `tmp`를 지우고 오류를 돌려준다(디스크 부족은 `DiskFull`). 계획이 거부되면 `tmp`를 열지 않는다. 호출한 쪽은 오류면
/// 태그 없이 원본을 마무리한다.
pub(crate) fn rewrite_to<R: Read + Seek, W: SyncWrite>(
    src: &mut R,
    src_len: u64,
    udta: &[u8],
    tmp: &Path,
    open: impl FnOnce(&Path) -> io::Result<W>,
) -> Result<Retagged, Error> {
    let plan = {
        let mut s = FileSrc {
            f: &mut *src,
            len: src_len,
        };
        plan_rewrite(&mut s, udta).map_err(fail_error)?
    };
    let plan = match plan {
        Plan::AlreadyTagged => return Ok(Retagged::AlreadyTagged),
        Plan::Rewrite(p) => p,
    };
    let written = (|| {
        let mut f = open(tmp)?;
        {
            let mut w = io::BufWriter::with_capacity(WRITE_BUF, &mut f);
            write_rewrite(src, &plan, &mut w)?;
            w.flush()?;
        }
        f.sync()
    })();
    match written {
        Ok(()) => Ok(Retagged::Written {
            len: plan.out_len(),
        }),
        Err(e) => {
            if let Err(re) = std::fs::remove_file(tmp)
                && re.kind() != io::ErrorKind::NotFound
            {
                tracing::warn!(error = %re, "메타데이터 임시 파일 삭제 실패");
            }
            Err(map_io_error("write", tmp, e))
        }
    }
}

#[cfg(test)]
mod tests;
