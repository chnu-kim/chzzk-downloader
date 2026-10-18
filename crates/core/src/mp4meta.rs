//! 받은 mp4에 제목·채널·날짜·원본 주소와 표지를 넣는다(core.md 구현 중 변경 75, 설계 `docs/design/features/mp4-metadata.md`).
//!
//! iTunes 스타일 `moov/udta/meta/ilst`(ffmpeg의 mp4 muxer와 같은 배치)를 만든다.
//!
//! - `build_udta`: 태그와 표지로 `udta` 상자 전체를 만드는 순수 함수. 빠른 다시보기·생방송은 이것을 defrag가 만드는
//!   새 `moov`에 함께 넣는다(`defrag::defragment_in`의 `udta` 인자).
//! - `retag_in`: 일반 VOD·클립(PD mp4, `[ftyp, moov, free, mdat]`)용. **`mdat`을 옮기지 않는다.** 옛 `moov` 본문에서 `udta`를
//!   바꾼 새 `moov`를 파일 끝에 붙이고 옛 `moov`의 4바이트 종류만 `free`로 바꾼다. `mdat`이 움직이지 않으니
//!   `stco`/`co64`는 바이트 그대로다. faststart(`moov`가 앞)를 잃는다.
//! - `repair_in`: 위 4단계까지 마친 뒤 죽은 파일을 메타데이터를 끈 실행이 이어받았을 때 `free`를 `moov`로 되돌린다.
//!
//! 쓰는 순서와 크래시 규칙은 defrag와 같다(붙이고 sync → 종류 패치 → sync). 파일을 바꿨는지로 `TagError`를 나눈다.
//! 벽시계·앱 버전처럼 실행마다 달라지는 값은 넣지 않아 같은 입력이 같은 바이트가 된다.

use std::io::{self, SeekFrom};
use std::path::Path;

use crate::download::defrag::{
    DefragFile, Fail, FileSrc, MAX_META_BOX, Source, Top, bad, be32, children, find,
    free_first_child, read_vec, scan,
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
/// 배치(ffmpeg 참조 파일과 대조해 확정, core.md 75):
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
// 끝에 붙이기

/// `retag_in`·`repair_in`의 결과.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TagReport {
    /// 새 `moov`를 붙이고 옛 `moov`를 `free`로 바꿨다(또는 크래시 뒤 다시 붙였다)
    Tagged,
    /// 옛 `moov`가 이미 같은 `udta`로 끝난다. 아무것도 바꾸지 않았다
    AlreadyTagged,
    /// `free`로 바뀐 옛 `moov`를 `moov`로 되돌렸다(메타데이터를 끈 실행의 복구)
    Repaired,
    /// 할 일이 없다(`repair_in`: 이미 `moov`가 있거나 `moov`로 보이는 `free`가 없다)
    NotApplicable,
}

/// 실패. 파일을 바꿨는지로 나눈다(`DefragError`와 같은 뜻).
#[derive(Debug)]
pub(crate) enum TagError {
    /// 파일은 원래 그대로다(구조를 해석하지 못했거나, 붙인 `moov`를 잘라 되돌렸다). 그대로 마무리해도 된다
    Unchanged(Error),
    /// 바꾸는 도중 실패했고 되돌리지 못했다(또는 길이·구조를 읽다 입출력 오류가 나 상태를 확인하지 못했다).
    /// 최종 파일로 옮기지 않는다
    Modified(Error),
}

fn io_err(op: &'static str, e: io::Error) -> Error {
    map_io_error(op, Path::new(WHAT), e)
}

/// 계획 단계의 실패를 `TagError`로 나눈다. 구조 판정(같은 바이트에서 결정적)은 `Unchanged`, 읽기 입출력 오류는
/// 파일 상태를 확인하지 못한 것이라 `Modified`다.
fn plan_error(f: Fail) -> TagError {
    match f {
        Fail::Io(e) if e.kind() != io::ErrorKind::UnexpectedEof => {
            TagError::Modified(io_err("read", e))
        }
        Fail::Io(_) => TagError::Unchanged(Error::Parse {
            what: WHAT,
            detail: "파일이 예상보다 짧다".into(),
        }),
        Fail::Bad(detail) => TagError::Unchanged(Error::Parse { what: WHAT, detail }),
    }
}

/// 크래시 복구 후보: 최상위 `moov`가 없을 때, 첫 자식이 `mvhd`이고 `mvex`가 없는 `free`/`skip`.
/// 앞선 실행이 4단계(종류 패치)까지 마치고 죽어 `resume`이 붙인 새 `moov`를 잘라 냈다고 본다.
struct Recovered {
    top: Top,
    body: Vec<u8>,
}

/// 최상위 상자에서 복구 후보를 모은다. 본문을 읽지 못하거나 상자로 나뉘지 않는 `free`는 후보가 아니다.
fn recovery_candidates(src: &mut dyn Source, tops: &[Top]) -> Result<Vec<Recovered>, Fail> {
    let mut out = Vec::new();
    for t in tops {
        if !matches!(&t.kind, b"free" | b"skip") {
            continue;
        }
        if free_first_child(src, t)?.as_ref() != Some(b"mvhd") {
            continue;
        }
        let body_len = t.size - t.hdr;
        if body_len > MAX_META_BOX {
            continue;
        }
        let body = read_vec(src, t.off + t.hdr, body_len)?;
        let Ok(cs) = children(&body) else { continue };
        if find(&cs, b"mvex").is_some() {
            continue;
        }
        out.push(Recovered { top: *t, body });
    }
    Ok(out)
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

/// 새 `moov` 바이트: 옛 본문의 자식에서 `udta`를 빼고 새 `udta`를 끝에 붙인다. 나머지는 바이트 그대로다.
///
/// 거부(`Fail`): 크기 칸이 0인 자식(부모 끝까지라는 뜻이라 뒤에 붙인 `udta`가 그 자식 안으로 먹힌다)이 있을 때,
/// 새 `moov`가 `MAX_META_BOX`를 넘을 때(다시 마무리할 때 `read_vec`가 못 읽는 파일이 되지 않게).
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

enum Retag {
    AlreadyTagged,
    Append {
        moov: Vec<u8>,
        /// 종류를 `free`로 바꿀 옛 `moov`의 4바이트 자리. 크래시 복구면 이미 `free`라 `None`
        patch: Option<u64>,
    },
}

fn plan_retag(src: &mut dyn Source, udta: &[u8]) -> Result<Retag, Fail> {
    let tops = scan(src)?;
    let moovs: Vec<&Top> = tops.iter().filter(|t| &t.kind == b"moov").collect();
    match moovs.as_slice() {
        [] => {
            let mut cands = recovery_candidates(src, &tops)?;
            match cands.len() {
                0 => Err(bad("moov가 없다")),
                1 => {
                    let c = cands.remove(0);
                    // 옛 moov는 이미 free라 파일에 moov가 없다. 새 moov를 만들 수 없어도(크기 0인 자식·크기 상한) 거부하지 않고
                    // 옛 본문 그대로 되살린다(태그만 없다). 거부하면 moov 없는 파일로 마무리된다.
                    let moov = match new_moov(&c.body, udta) {
                        Ok(m) => m,
                        Err(_) => moov_box(&c.body)?,
                    };
                    Ok(Retag::Append { moov, patch: None })
                }
                _ => Err(bad("moov로 보이는 free가 둘 이상이다")),
            }
        }
        [m] => {
            let body_len = m.size - m.hdr;
            if body_len > MAX_META_BOX {
                return Err(bad(format!("moov가 너무 크다({body_len} B)")));
            }
            let body = read_vec(src, m.off + m.hdr, body_len)?;
            if find(&children(&body)?, b"mvex").is_some() {
                return Err(bad("조각 구조(mvex) 파일이다"));
            }
            let moov = new_moov(&body, udta)?;
            if moov[8..] == body[..] {
                return Ok(Retag::AlreadyTagged);
            }
            Ok(Retag::Append {
                moov,
                patch: Some(m.off + 4),
            })
        }
        _ => Err(bad("moov가 둘 이상이다")),
    }
}

/// 열린 PD mp4의 `moov`를 새 `udta`로 바꿔 끝에 붙이고 옛 `moov`를 `free`로 바꾼다. 끝나면 위치는 파일 끝이다.
///
/// 1. 훑기: 최상위 상자 머리만 읽고 `moov` 본문만 읽는다. `moov`가 없거나 둘 이상이거나 `mvex`가 있거나, 상자가
///    파일 끝을 넘거나 크기가 0(파일 끝까지)이면 파일을 바꾸지 않고 `Unchanged`다. 단 `moov`가 없고 `free` 하나가
///    옛 `moov`로 보이면 크래시 복구로 그 본문을 다시 붙인다.
/// 2. 새 `moov`를 파일 끝에 붙이고 sync. 실패하면 `truncate_to(원래 길이)`로 되돌린다(되돌리면 `Unchanged`,
///    못 하면 `Modified`. 크래시 복구 중이었다면 되돌려도 `moov`가 없는 파일이라 `Modified`다).
/// 3. 옛 `moov`의 종류를 `free`로 바꾸고 sync. 실패하면 `Modified`.
pub(crate) fn retag_in<F: DefragFile>(file: &mut F, udta: &[u8]) -> Result<TagReport, TagError> {
    let len = file
        .file_len()
        .map_err(|e| TagError::Modified(io_err("stat", e)))?;
    let plan = {
        let mut src = FileSrc { f: file, len };
        plan_retag(&mut src, udta).map_err(plan_error)?
    };
    let (moov, patch) = match plan {
        Retag::AlreadyTagged => return Ok(TagReport::AlreadyTagged),
        Retag::Append { moov, patch } => (moov, patch),
    };
    let appended = (|| {
        file.seek(SeekFrom::Start(len))?;
        file.write_all(&moov)?;
        file.sync()
    })();
    if let Err(e) = appended {
        let err = io_err("write", e);
        let restored = file.truncate_to(len).and_then(|()| file.sync());
        return Err(match restored {
            Ok(()) if patch.is_some() => TagError::Unchanged(err),
            _ => TagError::Modified(err),
        });
    }
    if let Some(off) = patch {
        let patched = (|| {
            file.seek(SeekFrom::Start(off))?;
            file.write_all(b"free")?;
            file.sync()
        })();
        patched.map_err(|e| TagError::Modified(io_err("write", e)))?;
    }
    file.seek(SeekFrom::End(0))
        .map_err(|e| TagError::Modified(io_err("seek", e)))?;
    Ok(TagReport::Tagged)
}

/// 메타데이터를 쓰지 않는 실행의 PD 복구: 앞선 실행이 `retag_in`의 마지막 단계까지 마치고 죽어 옛 `moov`가
/// `free`이고 `moov`가 없으면, 그 `free`의 종류를 `moov`로 되돌린다. 옛 바이트가 그대로라 원본 PD 파일과 같아진다.
///
/// 할 일이 없으면(`moov`가 있다, `moov`로 보이는 `free`가 없다) `NotApplicable`이다. 구조를 읽지 못하거나
/// 후보가 둘 이상이면 `Unchanged`다.
pub(crate) fn repair_in<F: DefragFile>(file: &mut F) -> Result<TagReport, TagError> {
    let len = file
        .file_len()
        .map_err(|e| TagError::Modified(io_err("stat", e)))?;
    let target = {
        let mut src = FileSrc { f: file, len };
        let tops = scan(&mut src).map_err(plan_error)?;
        if tops.iter().any(|t| &t.kind == b"moov") {
            return Ok(TagReport::NotApplicable);
        }
        let cands = recovery_candidates(&mut src, &tops).map_err(plan_error)?;
        match cands.as_slice() {
            [] => return Ok(TagReport::NotApplicable),
            [c] => c.top.off + 4,
            _ => {
                return Err(TagError::Unchanged(Error::Parse {
                    what: WHAT,
                    detail: "moov로 보이는 free가 둘 이상이다".into(),
                }));
            }
        }
    };
    let patched = (|| {
        file.seek(SeekFrom::Start(target))?;
        file.write_all(b"moov")?;
        file.sync()?;
        file.seek(SeekFrom::End(0)).map(|_| ())
    })();
    patched.map_err(|e| TagError::Modified(io_err("write", e)))?;
    Ok(TagReport::Repaired)
}

#[cfg(test)]
mod tests;
