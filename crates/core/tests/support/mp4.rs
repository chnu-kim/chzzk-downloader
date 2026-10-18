//! MP4 상위 상자 검사. 실서버 스모크(`tests/live.rs`)와 `examples/dl.rs`가 `#[path]`로 함께 쓴다.
//!
//! 받은 파일(또는 받다 멈춘 `.part`)이 상자 단위로 올바르게 이어지는지만 본다. 디코드는 하지 않는다.

/// 상자 목록과 마지막 상자가 잘렸는지.
#[derive(Debug)]
pub struct BoxWalk {
    /// 상위 상자 (종류, 크기)
    pub boxes: Vec<(String, u64)>,
    /// 마지막 상자가 파일 끝을 넘는다(받다 멈춘 파일)
    pub truncated: bool,
}

impl BoxWalk {
    /// 상자 종류만.
    pub fn types(&self) -> Vec<&str> {
        self.boxes.iter().map(|(t, _)| t.as_str()).collect()
    }
}

/// 상위 상자를 처음부터 끝까지 따라간다.
///
/// - 크기 1은 64비트 largesize, 0은 "파일 끝까지"다.
/// - 종류는 출력 가능한 ASCII 4글자여야 한다.
/// - 마지막 상자가 파일 끝을 넘으면 `truncated`이고, 그 앞은 모두 정확히 맞아야 한다.
pub fn walk_boxes(b: &[u8]) -> Result<BoxWalk, String> {
    let mut boxes = Vec::new();
    let mut off: u64 = 0;
    let len = b.len() as u64;
    while off < len {
        let rest = &b[off as usize..];
        if rest.len() < 8 {
            return Ok(BoxWalk {
                boxes,
                truncated: true,
            });
        }
        let size32 = u32::from_be_bytes(rest[..4].try_into().unwrap()) as u64;
        let ty = &rest[4..8];
        if !ty.iter().all(|c| c.is_ascii_graphic() || *c == b' ') {
            return Err(format!("offset {off}: 상자 종류가 ASCII가 아님 {ty:02x?}"));
        }
        let ty = String::from_utf8_lossy(ty).into_owned();
        let (size, header) = match size32 {
            0 => (len - off, 8),
            1 => {
                if rest.len() < 16 {
                    boxes.push((ty, 0));
                    return Ok(BoxWalk {
                        boxes,
                        truncated: true,
                    });
                }
                (u64::from_be_bytes(rest[8..16].try_into().unwrap()), 16)
            }
            n => (n, 8),
        };
        if size < header {
            return Err(format!("offset {off}: {ty} 크기 {size}가 헤더보다 작음"));
        }
        boxes.push((ty, size));
        // largesize가 u64 끝 가까이면 덧셈이 넘친다. 넘치면 파일 끝을 넘는 것과 같다.
        if off.checked_add(size).is_none_or(|end| end > len) {
            return Ok(BoxWalk {
                boxes,
                truncated: true,
            });
        }
        off += size;
    }
    Ok(BoxWalk {
        boxes,
        truncated: false,
    })
}

/// 조각난 mp4를 init(`ftyp`+`moov`)과 조각(`moof`+`mdat`)으로 나눈다. 끝의 `mfra` 등은 버린다.
#[allow(dead_code)]
pub fn split_fragments(b: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
    let w = walk_boxes(b).unwrap();
    let mut off = 0usize;
    let mut init = Vec::new();
    let mut segs: Vec<Vec<u8>> = Vec::new();
    for (ty, size) in &w.boxes {
        let bx = &b[off..off + *size as usize];
        match ty.as_str() {
            "ftyp" | "moov" => init.extend_from_slice(bx),
            "moof" => segs.push(bx.to_vec()),
            "mdat" => segs.last_mut().unwrap().extend_from_slice(bx),
            _ => {}
        }
        off += *size as usize;
    }
    (init, segs)
}

/// 최상위 상자가 일반 mp4 모양인지 본다: `moof` 없음, 끝은 `moov` 하나, `mdat` 있음.
#[allow(dead_code)]
pub fn assert_flat_mp4(b: &[u8]) {
    let w = walk_boxes(b).unwrap();
    assert!(!w.truncated);
    let types = w.types();
    assert!(!types.contains(&"moof"), "{types:?}");
    assert_eq!(types.last(), Some(&"moov"), "{types:?}");
    assert_eq!(
        types.iter().filter(|t| **t == "moov").count(),
        1,
        "{types:?}"
    );
    assert!(types.contains(&"mdat"), "{types:?}");
    assert_eq!(types[0], "ftyp");
}

/// 최상위 `mdat`의 본문(헤더 제외)을 순서대로 모은다.
#[allow(dead_code)]
pub fn mdat_payloads(b: &[u8]) -> Vec<Vec<u8>> {
    let w = walk_boxes(b).unwrap();
    let mut off = 0usize;
    let mut out = Vec::new();
    for (ty, size) in &w.boxes {
        let size = *size as usize;
        if ty == "mdat" {
            let header = if u32::from_be_bytes(b[off..off + 4].try_into().unwrap()) == 1 {
                16
            } else {
                8
            };
            out.push(b[off + header..off + size].to_vec());
        }
        off += size;
    }
    out
}

// ---- 자식 상자와 메타데이터(`ilst`) 검사(mp4 메타데이터, mp4-metadata.md §13.2) ----

/// 상자 종류 4바이트를 latin1로 읽는다. 메타데이터 원자의 `©`(0xA9)가 `'©'`로 나온다.
#[allow(dead_code)]
fn kind_latin1(b: &[u8]) -> String {
    b.iter().map(|&c| char::from(c)).collect()
}

/// `body`를 상자 목록으로 나눈다: (종류, 본문 범위). 크기 1(largesize)을 따라가고, 크기가 맞지 않으면 `Err`다.
/// 종류는 latin1이라 `walk_boxes`처럼 ASCII만 받지 않는다.
#[allow(dead_code)]
pub fn child_boxes(body: &[u8]) -> Result<Vec<(String, std::ops::Range<usize>)>, String> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < body.len() {
        let rest = &body[i..];
        if rest.len() < 8 {
            return Err(format!("{i}: 자식 상자 헤더가 잘렸다"));
        }
        let size32 = u32::from_be_bytes(rest[..4].try_into().unwrap()) as usize;
        let kind = kind_latin1(&rest[4..8]);
        let (size, hdr) = match size32 {
            0 => (rest.len(), 8),
            1 => {
                if rest.len() < 16 {
                    return Err(format!("{i}: largesize 헤더가 잘렸다"));
                }
                (
                    usize::try_from(u64::from_be_bytes(rest[8..16].try_into().unwrap()))
                        .map_err(|_| "largesize가 너무 크다".to_string())?,
                    16,
                )
            }
            n => (n, 8),
        };
        if size < hdr || size > rest.len() {
            return Err(format!("{i}: {kind} 크기 {size}가 맞지 않다"));
        }
        out.push((kind, i + hdr..i + size));
        i += size;
    }
    Ok(out)
}

/// 최상위 상자의 (종류, 파일 안 본문 범위). `walk_boxes`와 같은 규칙이다.
#[allow(dead_code)]
pub fn top_boxes(b: &[u8]) -> Vec<(String, std::ops::Range<usize>)> {
    let w = walk_boxes(b).unwrap();
    let mut off = 0usize;
    let mut out = Vec::new();
    for (ty, size) in &w.boxes {
        let size = *size as usize;
        let header = if u32::from_be_bytes(b[off..off + 4].try_into().unwrap()) == 1 {
            16
        } else {
            8
        };
        out.push((ty.clone(), off + header..off + size));
        off += size;
    }
    out
}

/// 상자 경로(`["moov", "udta", "meta", "ilst"]`)를 따라 마지막 상자의 본문을 돌려준다. 같은 종류가 여럿이면 첫 것이다.
/// 첫 이름은 최상위 상자이고(여럿이면 **마지막** `moov`처럼 쓰려면 `last_top`을 쓴다), `meta`는 full box라 본문 앞
/// 4바이트(version·flags)를 건너뛴다.
#[allow(dead_code)]
pub fn find_path<'a>(b: &'a [u8], path: &[&str]) -> Option<&'a [u8]> {
    let (first, rest) = path.split_first()?;
    let (_, r) = top_boxes(b).into_iter().find(|(k, _)| k == first)?;
    descend(&b[r], rest, first == &"meta")
}

/// `find_path`인데 첫 이름의 **마지막** 최상위 상자에서 시작한다(끝에 붙은 새 `moov`).
#[allow(dead_code)]
pub fn find_path_last<'a>(b: &'a [u8], path: &[&str]) -> Option<&'a [u8]> {
    let (first, rest) = path.split_first()?;
    let (_, r) = top_boxes(b).into_iter().rfind(|(k, _)| k == first)?;
    descend(&b[r], rest, false)
}

#[allow(dead_code)]
fn descend<'a>(body: &'a [u8], path: &[&str], is_meta: bool) -> Option<&'a [u8]> {
    let body = if is_meta { body.get(4..)? } else { body };
    let Some((next, rest)) = path.split_first() else {
        return Some(body);
    };
    let (_, r) = child_boxes(body)
        .ok()?
        .into_iter()
        .find(|(k, _)| k == next)?;
    descend(&body[r], rest, next == &"meta")
}

/// `ilst` 본문의 원자 목록: (원자 종류, `data` type, `data` 본문). locale은 0이어야 하고 아니면 `Err`다.
#[allow(dead_code)]
pub fn ilst_items(ilst: &[u8]) -> Result<Vec<(String, u32, Vec<u8>)>, String> {
    let mut out = Vec::new();
    for (kind, r) in child_boxes(ilst)? {
        let atom = &ilst[r];
        let data_boxes = child_boxes(atom)?;
        if data_boxes.len() != 1 || data_boxes[0].0 != "data" {
            return Err(format!("{kind}: data 상자가 하나가 아니다"));
        }
        let d = &atom[data_boxes[0].1.clone()];
        if d.len() < 8 {
            return Err(format!("{kind}: data 본문이 짧다"));
        }
        let ty = u32::from_be_bytes(d[..4].try_into().unwrap());
        let locale = u32::from_be_bytes(d[4..8].try_into().unwrap());
        if locale != 0 {
            return Err(format!("{kind}: locale {locale}"));
        }
        out.push((kind, ty, d[8..].to_vec()));
    }
    Ok(out)
}

/// 최상위 `moov`의 수.
#[allow(dead_code)]
pub fn top_moov_count(b: &[u8]) -> usize {
    top_boxes(b).iter().filter(|(k, _)| k == "moov").count()
}

/// 최상위 `free`/`skip` 중 옛 `moov`가 바뀐 것(본문 첫 자식이 `mvhd`)의 파일 안 시작 위치.
#[allow(dead_code)]
pub fn freed_moovs(b: &[u8]) -> Vec<usize> {
    top_boxes(b)
        .into_iter()
        .filter(|(k, r)| {
            (k == "free" || k == "skip") && r.len() >= 8 && &b[r.start + 4..r.start + 8] == b"mvhd"
        })
        .map(|(_, r)| r.start - 8)
        .collect()
}
