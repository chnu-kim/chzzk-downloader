//! `check_output` 판정(docs/design/app.md §6.4).
//!
//! 서로 독립인 네 가지를 알려 준다: 최종 경로와 이름이 바뀌었는지, 완성 파일이 있는지(있으면 비어 있는 번호 이름),
//! `.part`가 있는지(있으면 같은 작업인지), 같은 경로의 활성 작업이 있는지.
//!
//! - `partial.bytes`는 sidecar `committed_len`이고, sidecar가 없거나 깨졌으면 `.part` 길이다. 작업의
//!   `partial_bytes`(같은 작업의 sidecar가 있을 때만)와 규칙이 다르다. 여기서는 "무언가 남아 있다"를 보여 주는 것이 목적이다.
//! - 녹화 `.part`(sidecar `kind = live`)가 있으면 완성 파일이 없어도 번호 이름을 준다. 녹화는 다시 받을 수 없어 이 이름으로
//!   받지 않는다(`partial.recording`, core.md 61).
//! - sidecar는 잠그지 않고 읽기만 한다.

use std::path::{Path, PathBuf};

use chzzk_core::download::part::part_path;
use chzzk_core::naming::{MAX_FILENAME_BYTES, output_path, range_stem, range_suffix};
use chzzk_core::{ContentRef, Platform, PlaybackKind, TimeRange};

use crate::dto::{JobId, OutputCheck, PartialInfo};
use crate::jobs::read_sidecar;

/// 확장자(`output_path`가 붙이는 것).
const EXT: &str = ".mp4";

/// 번호 이름을 찾는 상한. 넘으면 `free_file_name = None`.
pub const MAX_NUMBERED: u32 = 9999;

/// 판정에 필요한 입력.
pub struct OutputQuery<'a> {
    pub folder: &'a Path,
    pub file_name: &'a str,
    pub content: &'a ContentRef,
    pub quality_id: &'a str,
    pub kind: PlaybackKind,
    pub platform: Platform,
    /// 구간 받기의 요청 구간. 있으면 이름 끝에 접미사를 붙이고 `.part`의 구간도 비교한다
    pub range: Option<TimeRange>,
}

/// `check_output`. `active`는 경로를 쓰는 활성 작업을 찾는다(매니저가 준다).
pub fn check_output(q: &OutputQuery<'_>, active: &dyn Fn(&Path) -> Option<JobId>) -> OutputCheck {
    // 구간 접미사는 이 함수 한 곳에서만 붙인다. `enqueue`는 돌려준 이름을 그대로 쓴다(range.md §4.2).
    // 접미사가 붙은 이름은 이미 200바이트 안이라 `output_path`가 더 자르지 않는다(제목 쪽이 줄어든다)
    let named = match &q.range {
        Some(r) => range_stem(q.file_name, r, q.platform),
        None => q.file_name.to_string(),
    };
    let path = output_path(q.folder, &named, q.platform);
    let file_name = stem(&path);
    let truncated = file_name != q.file_name;
    let exists = path.exists();
    let partial = partial_info(&path, q.content, q.quality_id, q.kind, q.range);
    let free_file_name = if exists || partial.is_some_and(|p| p.recording) {
        free_name(q.folder, &file_name, q.range.as_ref(), q.platform, active)
    } else {
        None
    };
    OutputCheck {
        file_name,
        path: path.to_string_lossy().into_owned(),
        truncated,
        exists,
        free_file_name,
        partial,
        duplicate_job_id: active(&path),
    }
}

/// 최종 경로의 이름에서 `.mp4`(대소문자 무시)를 뗀 것.
fn stem(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    if name.len() >= EXT.len() && name[name.len() - EXT.len()..].eq_ignore_ascii_case(EXT) {
        name[..name.len() - EXT.len()].to_string()
    } else {
        name
    }
}

/// `"{name} (2)"`, `(3)` … 중 완성 파일·`.part`·활성 작업 어디에도 없는 첫 이름.
/// 번호가 잘리지 않도록 이름을 먼저 줄여 `.mp4`까지 200바이트 안에 둔다.
/// 구간 이름이면 `{제목을 줄인 것}{구간 접미사} ({n})`이다: 줄이는 쪽은 제목이고 접미사는 번호 앞에 그대로 남는다.
fn free_name(
    folder: &Path,
    name: &str,
    range: Option<&TimeRange>,
    p: Platform,
    active: &dyn Fn(&Path) -> Option<JobId>,
) -> Option<String> {
    let range_tail = range.map(range_suffix).unwrap_or_default();
    let title = name.strip_suffix(range_tail.as_str()).unwrap_or(name);
    for n in 2..=MAX_NUMBERED {
        let number = format!(" ({n})");
        let room = MAX_FILENAME_BYTES - EXT.len() - number.len() - range_tail.len();
        let base = truncate_utf8(title, room);
        let base = if range.is_some() {
            base.trim_end()
        } else {
            base
        };
        let candidate: PathBuf = output_path(folder, &format!("{base}{range_tail}{number}"), p);
        if !candidate.exists() && !part_path(&candidate).exists() && active(&candidate).is_none() {
            return Some(stem(&candidate));
        }
    }
    None
}

/// 글자 경계에서 `max`바이트 이하로 자른다.
fn truncate_utf8(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

fn partial_info(
    path: &Path,
    content: &ContentRef,
    quality_id: &str,
    kind: PlaybackKind,
    range: Option<TimeRange>,
) -> Option<PartialInfo> {
    let part = part_path(path);
    let meta = std::fs::metadata(&part).ok().filter(|m| m.is_file())?;
    Some(match read_sidecar(path) {
        Some(sc) if sc.kind == PlaybackKind::Live => PartialInfo {
            bytes: sc.committed_len,
            same_job: false,
            recording: true,
        },
        Some(sc) => PartialInfo {
            bytes: sc.committed_len,
            same_job: sc.same_job(content, quality_id, kind, range),
            recording: false,
        },
        None => PartialInfo {
            bytes: meta.len(),
            same_job: false,
            recording: false,
        },
    })
}
