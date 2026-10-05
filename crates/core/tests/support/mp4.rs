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
