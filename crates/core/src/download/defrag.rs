//! 생방송 녹화 결과(조각난 fMP4)를 일반 mp4로 제자리 변환한다(core.md 구현 중 변경 60).
//!
//! 생방송 HLS는 `init(ftyp+moov, mvex 포함)` 뒤에 `styp`·(`moof`·`mdat`·`emsg`)가 이어진다. 이것을 그대로 이어 붙인
//! 파일은 일부 플레이어(macOS QuickTime·AVFoundation)가 첫 조각 길이만 보고 1초쯤에서 멈추며 탐색이 안 된다.
//! 그래서 샘플 표(`stbl`)를 담은 새 `moov`를 만들어 일반(progressive) mp4로 바꾼다.
//!
//! **복사 없이 제자리에서** 한다:
//! 1. 파일을 읽어(최상위 상자는 헤더만, `moov`·`moof`만 본문까지) 전부 검증하고 새 `moov`를 메모리에서 완성한다.
//!    `mdat` 본문은 읽지 않는다.
//! 2. 새 `moov`를 파일 끝에 붙이고 sync한다. 실패하면 붙인 것을 `set_len`으로 되돌린다(되돌리기도 실패하면 `Modified`).
//! 3. 마지막에 원래 `moov`(init)·`moof`·`styp`·`emsg`와 모르는 상자의 4바이트 종류를 `free`로 바꾼다(오프셋
//!    오름차순으로 한 번에, 그리고 sync). 데이터는 움직이지 않는다. `ftyp`·`mdat`·`free`·`skip`은 그대로다.
//!
//! 변환은 최선 노력이다. 구조를 읽지 못하거나(가짜 바이트·잘린 파일·모르는 구조) 검증에 실패하면 파일을 바꾸지
//! 않고 `Err`를 돌려준다. 호출한 쪽은 경고만 남기고 조각 구조 그대로 마무리한다. 바꾸는 도중의 실패는
//! `DefragError::Modified`이고 호출한 쪽은 마무리하지 않는다(덧붙인 `moov`를 잘라 되돌렸으면 `Unchanged`).
//!
//! **멱등.** 최상위에 `mvex` 없는 진짜 `moov`가 있으면 이미 일반 mp4다(`AlreadyFlat`). 3단계 도중 끊겨 일부 상자만
//! `free`로 바뀐 채 끝의 `moov`가 잘려 나간 파일(크래시 후 `PartFile::resume`이 `committed_len`으로 자른다)은,
//! `free`의 첫 자식이 `mfhd`면 `moof`, `mvhd`면 init `moov`로 보고 다시 변환한다.
//!
//! 한계:
//! - tfdt가 끊긴 구간(놓친 조각)은 타임라인을 당겨 붙인다(`stts`는 샘플 길이만 담는다). 구멍 수는
//!   `DefragReport::Converted::discontinuities`로 센다.
//! - `moov`가 파일 끝에 있다(로컬 재생용. 네트워크 스트리밍의 빠른 시작은 고려하지 않는다).
//! - 샘플이 하나도 없는 트랙은 새 `moov`에서 뺀다.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

use crate::error::Error;
use crate::fsutil::map_io_error;

/// 오류 메시지의 대상 이름.
const WHAT: &str = "fragmented mp4";
/// 본문까지 읽는 상자(`moov`·`moof`)의 크기 상한. 이보다 크면 모르는 구조로 본다.
const MAX_META_BOX: u64 = 64 << 20;
/// `trun`·`tfhd` 플래그.
/// 샘플별 필드가 없는 trun에서 기본 크기가 0일 때 받는 샘플 수 상한
const MAX_EMPTY_SAMPLES: u32 = 1 << 16;
const TF_BASE_DATA_OFFSET: u32 = 0x1;
const TF_SDI: u32 = 0x2;
const TF_DURATION: u32 = 0x8;
const TF_SIZE: u32 = 0x10;
const TF_FLAGS: u32 = 0x20;
const TF_DEFAULT_BASE_IS_MOOF: u32 = 0x2_0000;
const TR_DATA_OFFSET: u32 = 0x1;
const TR_FIRST_FLAGS: u32 = 0x4;
const TR_DURATION: u32 = 0x100;
const TR_SIZE: u32 = 0x200;
const TR_FLAGS: u32 = 0x400;
const TR_CTS: u32 = 0x800;
/// sample_flags의 sample_is_non_sync_sample 비트.
const NON_SYNC: u32 = 0x1_0000;

/// 변환 결과.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DefragReport {
    /// 새 `moov`를 붙이고 조각 상자를 `free`로 바꿨다.
    Converted {
        /// 새 `moov`의 트랙 수
        tracks: usize,
        /// 모든 트랙의 샘플 수 합
        samples: u64,
        /// 앞 조각 끝과 이어지지 않는 `tfdt`(놓친 조각 등)의 수. 타임라인은 당겨 붙였다.
        discontinuities: u32,
    },
    /// 이미 일반 mp4다(`mvex` 없는 `moov`가 있다). 아무것도 바꾸지 않았다.
    AlreadyFlat,
    /// `moof`가 없다. 아무것도 바꾸지 않았다.
    NotFragmented,
}

/// 2·3단계가 쓰는 파일 조작. 테스트가 쓰기 실패를 주입하려고 둔다(core.md 61).
pub(crate) trait DefragFile: Read + Write + Seek {
    fn file_len(&mut self) -> io::Result<u64>;
    fn truncate_to(&mut self, len: u64) -> io::Result<()>;
    fn sync(&mut self) -> io::Result<()>;
}

impl DefragFile for File {
    fn file_len(&mut self) -> io::Result<u64> {
        self.metadata().map(|m| m.len())
    }
    fn truncate_to(&mut self, len: u64) -> io::Result<()> {
        self.set_len(len)
    }
    fn sync(&mut self) -> io::Result<()> {
        self.sync_data()
    }
}

/// `defragment_in`의 실패. 파일을 바꿨는지로 나눈다(호출한 쪽이 마무리할지 정한다).
#[derive(Debug)]
pub(crate) enum DefragError {
    /// 파일은 원래 그대로다(구조 검증·읽기 실패, 또는 덧붙인 `moov`를 잘라 되돌렸다). 조각 구조로 마무리해도 된다
    Unchanged(Error),
    /// 바꾸는 도중 실패했고 되돌리지 못했다. 최종 파일로 옮기지 않는다(다음 실행이 committed_len으로 잘라 다시 변환한다)
    Modified(Error),
}

impl DefragError {
    pub(crate) fn into_error(self) -> Error {
        match self {
            Self::Unchanged(e) | Self::Modified(e) => e,
        }
    }
}

/// 열린 파일(읽기·쓰기 가능)을 제자리에서 일반 mp4로 바꾼다. 끝나면 위치는 파일 끝이다.
///
/// 구조를 읽지 못하면 파일을 바꾸지 않고 `Error::Parse`다. 쓰는 도중의 입출력 오류는 `Error::Io`(디스크 부족은
/// `DiskFull`, 파일 크기 한도는 `FileTooLarge`)이고, 2단계 실패는 붙인 부분을 잘라 원래 길이로 되돌린다.
/// 파일을 바꿨는지 구분이 필요하면 `defragment_in`을 쓴다.
pub fn defragment(file: &mut File) -> Result<DefragReport, Error> {
    defragment_in(file).map_err(DefragError::into_error)
}

/// `defragment`의 본체. 실패를 `DefragError`(파일이 원래 그대로인가)로 나눈다.
pub(crate) fn defragment_in<F: DefragFile>(file: &mut F) -> Result<DefragReport, DefragError> {
    let io_err = |op: &'static str| move |e: io::Error| map_io_error(op, Path::new(WHAT), e);
    let len = file
        .file_len()
        .map_err(|e| DefragError::Unchanged(io_err("stat")(e)))?;
    let outcome = {
        let mut src = FileSrc { f: file, len };
        plan(&mut src).map_err(|f| DefragError::Unchanged(f.into_error()))?
    };
    let p = match outcome {
        Outcome::Flat => return Ok(DefragReport::AlreadyFlat),
        Outcome::NotFragmented => return Ok(DefragReport::NotFragmented),
        Outcome::Plan(p) => p,
    };
    // 2단계: 끝에 새 moov. 실패하면 원래 길이로 되돌린다(조각 구조 파일로 남는다).
    let appended = (|| {
        file.seek(SeekFrom::Start(len))?;
        file.write_all(&p.moov)?;
        file.sync()
    })();
    if let Err(e) = appended {
        let err = io_err("write")(e);
        // 붙인 것을 잘라 되돌린다. 자르기와 그 sync가 모두 성공해야 원래 파일이다
        let restored = file.truncate_to(len).and_then(|()| file.sync());
        return Err(match restored {
            Ok(()) => DefragError::Unchanged(err),
            Err(_) => DefragError::Modified(err),
        });
    }
    // 3단계: 종류 패치를 오름차순으로 몰아서 쓴다.
    let patched = (|| {
        for off in &p.patches {
            file.seek(SeekFrom::Start(*off))?;
            file.write_all(b"free")?;
        }
        file.sync()?;
        file.seek(SeekFrom::End(0)).map(|_| ())
    })();
    patched.map_err(|e| DefragError::Modified(io_err("write")(e)))?;
    Ok(DefragReport::Converted {
        tracks: p.tracks,
        samples: p.samples,
        discontinuities: p.discontinuities,
    })
}

/// 테스트용: 바이트 위에서 1~3단계를 그대로 한다(`defragment`와 같은 결과).
#[cfg(test)]
pub(crate) fn defragment_bytes(b: &mut Vec<u8>) -> Result<DefragReport, Error> {
    let outcome = plan(&mut SliceSrc(b)).map_err(Fail::into_error)?;
    let p = match outcome {
        Outcome::Flat => return Ok(DefragReport::AlreadyFlat),
        Outcome::NotFragmented => return Ok(DefragReport::NotFragmented),
        Outcome::Plan(p) => p,
    };
    b.extend_from_slice(&p.moov);
    for off in &p.patches {
        let o = *off as usize;
        b[o..o + 4].copy_from_slice(b"free");
    }
    Ok(DefragReport::Converted {
        tracks: p.tracks,
        samples: p.samples,
        discontinuities: p.discontinuities,
    })
}

/// 새 `moov` 바이트와 `free`로 바꿀 종류 오프셋 목록.
#[cfg(test)]
pub(crate) type MoovAndPatches = (Vec<u8>, Vec<u64>);

/// 테스트용 순수 함수: 바이트 → (새 `moov` 바이트, `free`로 바꿀 종류 오프셋 목록). 바꿀 것이 없으면 `None`.
#[cfg(test)]
pub(crate) fn plan_bytes(b: &[u8]) -> Result<Option<MoovAndPatches>, Error> {
    match plan(&mut SliceSrc(b)).map_err(Fail::into_error)? {
        Outcome::Plan(p) => Ok(Some((p.moov, p.patches))),
        _ => Ok(None),
    }
}

// ---------------------------------------------------------------------------------------------
// 읽기

/// 변환 계획 단계의 실패.
#[derive(Debug)]
enum Fail {
    Io(io::Error),
    Bad(String),
}

impl From<io::Error> for Fail {
    fn from(e: io::Error) -> Self {
        Fail::Io(e)
    }
}

impl Fail {
    fn into_error(self) -> Error {
        match self {
            // 읽다가 파일 끝을 만났다: 구조 문제로 본다.
            Fail::Io(e) if e.kind() == io::ErrorKind::UnexpectedEof => Error::Parse {
                what: WHAT,
                detail: "파일이 예상보다 짧다".into(),
            },
            Fail::Io(e) => map_io_error("read", Path::new(WHAT), e),
            Fail::Bad(detail) => Error::Parse { what: WHAT, detail },
        }
    }
}

fn bad(s: impl Into<String>) -> Fail {
    Fail::Bad(s.into())
}

/// 위치를 주고 읽는 원본(파일 또는 바이트).
trait Source {
    fn len(&self) -> u64;
    fn read_at(&mut self, off: u64, buf: &mut [u8]) -> io::Result<()>;
}

struct FileSrc<'a, F> {
    f: &'a mut F,
    len: u64,
}

impl<F: Read + Seek> Source for FileSrc<'_, F> {
    fn len(&self) -> u64 {
        self.len
    }
    fn read_at(&mut self, off: u64, buf: &mut [u8]) -> io::Result<()> {
        self.f.seek(SeekFrom::Start(off))?;
        self.f.read_exact(buf)
    }
}

#[cfg(test)]
struct SliceSrc<'a>(&'a [u8]);

#[cfg(test)]
impl Source for SliceSrc<'_> {
    fn len(&self) -> u64 {
        self.0.len() as u64
    }
    fn read_at(&mut self, off: u64, buf: &mut [u8]) -> io::Result<()> {
        let s = usize::try_from(off)
            .ok()
            .and_then(|o| self.0.get(o..o.checked_add(buf.len())?))
            .ok_or(io::ErrorKind::UnexpectedEof)?;
        buf.copy_from_slice(s);
        Ok(())
    }
}

fn read_vec(src: &mut dyn Source, off: u64, len: u64) -> Result<Vec<u8>, Fail> {
    if len > MAX_META_BOX {
        return Err(bad(format!("메타 상자가 너무 크다({len} B)")));
    }
    let mut v = vec![0u8; len as usize];
    src.read_at(off, &mut v)?;
    Ok(v)
}

fn be32(b: &[u8]) -> u32 {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]])
}
fn be64(b: &[u8]) -> u64 {
    u64::from_be_bytes(b[..8].try_into().unwrap_or([0; 8]))
}

/// 최상위 상자 하나(헤더만).
#[derive(Clone, Copy, Debug)]
struct Top {
    off: u64,
    hdr: u64,
    size: u64,
    kind: [u8; 4],
}

/// 최상위 상자를 헤더만 읽어 훑는다. 마지막 상자가 파일 끝을 넘으면(잘린 파일) 실패다.
fn scan(src: &mut dyn Source) -> Result<Vec<Top>, Fail> {
    let len = src.len();
    let mut out = Vec::new();
    let mut off = 0u64;
    while off < len {
        if len - off < 8 {
            return Err(bad("끝 상자 헤더가 잘렸다"));
        }
        let mut h = [0u8; 16];
        let n = (len - off).min(16) as usize;
        src.read_at(off, &mut h[..n])?;
        let mut kind = [0u8; 4];
        kind.copy_from_slice(&h[4..8]);
        let (size, hdr) = match be32(&h[..4]) {
            // size 0(파일 끝까지)은 뒤에 붙일 moov까지 삼키므로 받지 않는다(변환하지 않고 원본을 둔다).
            0 => {
                return Err(bad(format!(
                    "{off}: size 0(파일 끝까지) 상자는 변환하지 않는다"
                )));
            }
            1 => {
                if n < 16 {
                    return Err(bad("largesize 헤더가 잘렸다"));
                }
                (be64(&h[8..16]), 16)
            }
            s => (u64::from(s), 8),
        };
        if size < hdr {
            return Err(bad(format!("{off}: 상자 크기가 헤더보다 작다")));
        }
        let end = off
            .checked_add(size)
            .filter(|e| *e <= len)
            .ok_or_else(|| bad(format!("{off}: 상자가 파일 끝을 넘는다(잘린 파일)")))?;
        out.push(Top {
            off,
            hdr,
            size,
            kind,
        });
        off = end;
    }
    Ok(out)
}

/// 메모리 안의 자식 상자.
#[derive(Clone, Copy)]
struct Child<'a> {
    kind: [u8; 4],
    /// 헤더 포함
    full: &'a [u8],
    body: &'a [u8],
}

/// `b`를 상자 목록으로 나눈다. 크기가 맞지 않으면 실패다.
fn children(b: &[u8]) -> Result<Vec<Child<'_>>, Fail> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < b.len() {
        let rest = &b[i..];
        if rest.len() < 8 {
            return Err(bad("자식 상자 헤더가 잘렸다"));
        }
        let mut kind = [0u8; 4];
        kind.copy_from_slice(&rest[4..8]);
        let (size, hdr) = match be32(rest) {
            0 => (rest.len(), 8),
            1 => {
                if rest.len() < 16 {
                    return Err(bad("자식 largesize 헤더가 잘렸다"));
                }
                (
                    usize::try_from(be64(&rest[8..16])).unwrap_or(usize::MAX),
                    16,
                )
            }
            s => (s as usize, 8),
        };
        if size < hdr || size > rest.len() {
            return Err(bad(format!(
                "자식 상자 {} 크기가 맞지 않다",
                String::from_utf8_lossy(&kind)
            )));
        }
        out.push(Child {
            kind,
            full: &rest[..size],
            body: &rest[hdr..size],
        });
        i += size;
    }
    Ok(out)
}

fn find<'a>(cs: &[Child<'a>], kind: &[u8; 4]) -> Option<Child<'a>> {
    cs.iter().find(|c| &c.kind == kind).copied()
}

fn need<'a>(cs: &[Child<'a>], kind: &[u8; 4], within: &str) -> Result<Child<'a>, Fail> {
    find(cs, kind).ok_or_else(|| {
        bad(format!(
            "{within}에 {}이 없다",
            String::from_utf8_lossy(kind)
        ))
    })
}

/// 바이트 커서. 모자라면 실패다.
struct Rd<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Rd<'a> {
    fn new(b: &'a [u8]) -> Self {
        Rd { b, i: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], Fail> {
        let s = self
            .b
            .get(self.i..self.i + n)
            .ok_or_else(|| bad("상자 본문이 짧다"))?;
        self.i += n;
        Ok(s)
    }
    fn u32(&mut self) -> Result<u32, Fail> {
        self.take(4).map(be32)
    }
    fn u64(&mut self) -> Result<u64, Fail> {
        self.take(8).map(be64)
    }
    fn remaining(&self) -> usize {
        self.b.len() - self.i
    }
}

// ---------------------------------------------------------------------------------------------
// init

/// `trex` 기본값.
#[derive(Clone, Copy, Debug, Default)]
struct Trex {
    sdi: u32,
    duration: u32,
    size: u32,
    flags: u32,
}

/// init `moov`의 트랙 하나에서 새 `moov`로 옮길 것.
struct InitTrack {
    id: u32,
    timescale: u32,
    tkhd: Vec<u8>,
    mdhd: Vec<u8>,
    hdlr: Vec<u8>,
    /// `minf`의 `stbl` 밖 자식들(`vmhd`|`smhd`, `dinf` 등), 헤더 포함 이어 붙인 것
    minf_rest: Vec<u8>,
    stsd: Vec<u8>,
    trex: Trex,
}

struct Init {
    mvhd: Vec<u8>,
    movie_ts: u32,
    tracks: Vec<InitTrack>,
}

/// `mvhd`·`mdhd`의 timescale(같은 자리).
fn timescale_of(body: &[u8]) -> Result<u32, Fail> {
    let at = if body.first() == Some(&1) { 20 } else { 12 };
    body.get(at..at + 4)
        .map(be32)
        .ok_or_else(|| bad("timescale 자리가 없다"))
}

fn parse_init(moov_body: &[u8]) -> Result<Init, Fail> {
    let cs = children(moov_body)?;
    let mvhd = need(&cs, b"mvhd", "moov")?;
    let movie_ts = timescale_of(mvhd.body)?;
    if movie_ts == 0 {
        return Err(bad("mvhd timescale이 0이다"));
    }
    let mvex = need(&cs, b"mvex", "moov")?;
    let mut trexes = Vec::new();
    for c in children(mvex.body)?.iter().filter(|c| &c.kind == b"trex") {
        let mut r = Rd::new(c.body);
        r.u32()?;
        let id = r.u32()?;
        trexes.push((
            id,
            Trex {
                sdi: r.u32()?,
                duration: r.u32()?,
                size: r.u32()?,
                flags: r.u32()?,
            },
        ));
    }
    let mut tracks = Vec::new();
    for trak in cs.iter().filter(|c| &c.kind == b"trak") {
        let tc = children(trak.body)?;
        let tkhd = need(&tc, b"tkhd", "trak")?;
        let at = if tkhd.body.first() == Some(&1) {
            20
        } else {
            12
        };
        let id = tkhd
            .body
            .get(at..at + 4)
            .map(be32)
            .ok_or_else(|| bad("tkhd track_ID 자리가 없다"))?;
        let mdia = children(need(&tc, b"mdia", "trak")?.body)?;
        let mdhd = need(&mdia, b"mdhd", "mdia")?;
        let timescale = timescale_of(mdhd.body)?;
        if timescale == 0 {
            return Err(bad("mdhd timescale이 0이다"));
        }
        let hdlr = need(&mdia, b"hdlr", "mdia")?;
        let minf = children(need(&mdia, b"minf", "mdia")?.body)?;
        let stbl = children(need(&minf, b"stbl", "minf")?.body)?;
        let stsd = need(&stbl, b"stsd", "stbl")?;
        let minf_rest = minf
            .iter()
            .filter(|c| &c.kind != b"stbl")
            .flat_map(|c| c.full.iter().copied())
            .collect();
        let trex = trexes
            .iter()
            .find(|(t, _)| *t == id)
            .map(|(_, x)| *x)
            .ok_or_else(|| bad(format!("트랙 {id}의 trex가 없다")))?;
        if tracks.iter().any(|t: &InitTrack| t.id == id) {
            return Err(bad(format!("트랙 {id}가 두 번 있다")));
        }
        tracks.push(InitTrack {
            id,
            timescale,
            tkhd: tkhd.full.to_vec(),
            mdhd: mdhd.full.to_vec(),
            hdlr: hdlr.full.to_vec(),
            minf_rest,
            stsd: stsd.full.to_vec(),
            trex,
        });
    }
    if tracks.is_empty() {
        return Err(bad("init에 트랙이 없다"));
    }
    Ok(Init {
        mvhd: mvhd.full.to_vec(),
        movie_ts,
        tracks,
    })
}

// ---------------------------------------------------------------------------------------------
// 샘플 표

/// 트랙 하나의 샘플 표(run-length로 모은다).
#[derive(Default)]
struct Tables {
    stts: Vec<(u32, u32)>,
    ctts: Vec<(u32, i64)>,
    sizes: Vec<u32>,
    /// 동기 샘플 번호(1부터)
    sync: Vec<u32>,
    chunks: Vec<u64>,
    /// (first_chunk, samples_per_chunk, sample_description_index)
    stsc: Vec<(u32, u32, u32)>,
    count: u32,
    /// 지금까지 duration 합(트랙 timescale)
    dts: u64,
    first_tfdt: Option<u64>,
    /// 가장 이른 표시 시각(dts + cts)의 최솟값
    min_pts: Option<i128>,
    min_cts: i64,
    /// 다음 조각에 기대하는 `tfdt`(앞 조각의 `tfdt` + 그 뒤 샘플 길이)
    next_tfdt: i128,
    discontinuities: u32,
}

impl Tables {
    /// 조각의 `tfdt`를 본다. 첫 값은 시작 시각이고, 그 뒤는 앞 조각 끝과 이어지는지만 센다(타임라인은 샘플 길이
    /// 합으로 이어 붙인다). 실물은 오디오 `tfdt`가 반올림으로 ±1틱씩 흔들리므로 0.1초(`timescale / 10`)를 넘을 때만 센다.
    fn on_tfdt(&mut self, tfdt: Option<u64>, timescale: u32) {
        match (self.first_tfdt, tfdt) {
            (None, t) => {
                self.first_tfdt = Some(t.unwrap_or(0));
                self.next_tfdt = i128::from(t.unwrap_or(0));
            }
            (Some(_), Some(t)) => {
                if (i128::from(t) - self.next_tfdt).abs() > i128::from(timescale / 10) {
                    self.discontinuities += 1;
                }
                self.next_tfdt = i128::from(t);
            }
            (Some(_), None) => {}
        }
    }

    fn push_sample(&mut self, dur: u32, size: u32, flags: u32, cts: i64) -> Result<(), Fail> {
        self.count = self
            .count
            .checked_add(1)
            .ok_or_else(|| bad("샘플이 너무 많다"))?;
        match self.stts.last_mut() {
            Some((n, d)) if *d == dur => *n += 1,
            _ => self.stts.push((1, dur)),
        }
        match self.ctts.last_mut() {
            Some((n, c)) if *c == cts => *n += 1,
            _ => self.ctts.push((1, cts)),
        }
        self.sizes.push(size);
        if flags & NON_SYNC == 0 {
            self.sync.push(self.count);
        }
        let pts = i128::from(self.dts) + i128::from(cts);
        self.min_pts = Some(self.min_pts.map_or(pts, |m| m.min(pts)));
        self.min_cts = self.min_cts.min(cts);
        self.next_tfdt += i128::from(dur);
        self.dts = self
            .dts
            .checked_add(u64::from(dur))
            .ok_or_else(|| bad("길이가 너무 길다"))?;
        Ok(())
    }

    fn push_chunk(&mut self, off: u64, n: u32, sdi: u32) {
        self.chunks.push(off);
        let idx = self.chunks.len() as u32;
        match self.stsc.last() {
            Some(&(_, spc, s)) if spc == n && s == sdi => {}
            _ => self.stsc.push((idx, n, sdi)),
        }
    }
}

/// 바이트 범위가 어느 `mdat` 본문 안에 있는지 본다.
fn check_in_mdat(mdats: &[(u64, u64)], off: u64, len: u64) -> Result<(), Fail> {
    let end = off
        .checked_add(len)
        .ok_or_else(|| bad("샘플 범위가 넘친다"))?;
    let i = mdats.partition_point(|(s, _)| *s <= off);
    match i.checked_sub(1).map(|i| mdats[i]) {
        Some((_, e)) if end <= e => Ok(()),
        _ => Err(bad(format!("샘플 범위 {off}+{len}이 mdat 밖이다"))),
    }
}

/// `moof` 하나를 읽어 트랙 표에 더한다.
fn parse_moof(
    moof_off: u64,
    body: &[u8],
    init: &Init,
    tables: &mut [Tables],
    mdats: &[(u64, u64)],
) -> Result<(), Fail> {
    let cs = children(body)?;
    let mut prev_end: Option<u64> = None;
    for traf in cs.iter().filter(|c| &c.kind == b"traf") {
        let tc = children(traf.body)?;
        if find(&tc, b"senc").is_some() {
            return Err(bad("암호화된 조각이다"));
        }
        let tfhd = need(&tc, b"tfhd", "traf")?;
        let mut r = Rd::new(tfhd.body);
        let fl = r.u32()? & 0xff_ffff;
        let id = r.u32()?;
        let base_off = if fl & TF_BASE_DATA_OFFSET != 0 {
            Some(r.u64()?)
        } else {
            None
        };
        let opt = |r: &mut Rd<'_>, bit: u32| -> Result<Option<u32>, Fail> {
            if fl & bit != 0 {
                r.u32().map(Some)
            } else {
                Ok(None)
            }
        };
        let sdi = opt(&mut r, TF_SDI)?;
        let def_dur = opt(&mut r, TF_DURATION)?;
        let def_size = opt(&mut r, TF_SIZE)?;
        let def_flags = opt(&mut r, TF_FLAGS)?;
        let ti = init
            .tracks
            .iter()
            .position(|t| t.id == id)
            .ok_or_else(|| bad(format!("init에 없는 트랙 {id}")))?;
        let trex = init.tracks[ti].trex;
        let sdi = sdi.unwrap_or(trex.sdi);
        let def_dur = def_dur.unwrap_or(trex.duration);
        let def_size = def_size.unwrap_or(trex.size);
        let def_flags = def_flags.unwrap_or(trex.flags);
        // 데이터 기준: base_data_offset → default-base-is-moof면 moof 시작 → 아니면 첫 traf는 moof 시작,
        // 다음 traf는 앞 traf 데이터 끝(ISO 14496-12 8.8.7).
        let base = match base_off {
            Some(b) => b,
            None if fl & TF_DEFAULT_BASE_IS_MOOF != 0 => moof_off,
            None => prev_end.unwrap_or(moof_off),
        };
        let tfdt = match find(&tc, b"tfdt") {
            Some(t) => {
                let mut r = Rd::new(t.body);
                let v = r.u32()? >> 24;
                Some(if v == 1 {
                    r.u64()?
                } else {
                    u64::from(r.u32()?)
                })
            }
            None => None,
        };
        let tab = &mut tables[ti];
        tab.on_tfdt(tfdt, init.tracks[ti].timescale);
        let mut cursor = base;
        for trun in tc.iter().filter(|c| &c.kind == b"trun") {
            let mut r = Rd::new(trun.body);
            let vf = r.u32()?;
            let (v, fl) = (vf >> 24, vf & 0xff_ffff);
            let n = r.u32()?;
            let start = if fl & TR_DATA_OFFSET != 0 {
                let d = r.u32()? as i32;
                base.checked_add_signed(i64::from(d))
                    .ok_or_else(|| bad("data_offset이 넘친다"))?
            } else {
                cursor
            };
            let first_flags = if fl & TR_FIRST_FLAGS != 0 {
                Some(r.u32()?)
            } else {
                None
            };
            let per = [TR_DURATION, TR_SIZE, TR_FLAGS, TR_CTS]
                .iter()
                .filter(|b| fl & **b != 0)
                .count()
                * 4;
            if (n as usize).saturating_mul(per) > r.remaining() {
                return Err(bad("trun 샘플 수가 본문보다 많다"));
            }
            if per == 0 {
                // 샘플별 필드가 없으면 본문 길이가 n을 막아 주지 못한다: 기본 크기로 mdat 범위를 먼저 대조하고,
                // 크기 0 샘플이 무한정 늘지 않게 상한을 둔다(메모리 보호).
                if def_size == 0 && n > MAX_EMPTY_SAMPLES {
                    return Err(bad("크기 정보 없는 trun 샘플 수가 너무 많다"));
                }
                if n > 0 {
                    check_in_mdat(mdats, start, u64::from(n) * u64::from(def_size))?;
                }
            }
            let mut total = 0u64;
            for i in 0..n {
                let dur = if fl & TR_DURATION != 0 {
                    r.u32()?
                } else {
                    def_dur
                };
                let size = if fl & TR_SIZE != 0 {
                    r.u32()?
                } else {
                    def_size
                };
                let sf = if fl & TR_FLAGS != 0 {
                    Some(r.u32()?)
                } else {
                    None
                };
                let flags = match (i, first_flags) {
                    (0, Some(f)) => f,
                    _ => sf.unwrap_or(def_flags),
                };
                let cts = if fl & TR_CTS != 0 {
                    let c = r.u32()?;
                    if v == 0 {
                        i64::from(c)
                    } else {
                        i64::from(c as i32)
                    }
                } else {
                    0
                };
                tab.push_sample(dur, size, flags, cts)?;
                total += u64::from(size);
            }
            if n > 0 {
                check_in_mdat(mdats, start, total)?;
                tab.push_chunk(start, n, sdi);
            }
            cursor = start + total;
        }
        prev_end = Some(cursor);
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// 계획

struct Plan {
    moov: Vec<u8>,
    /// `free`로 바꿀 4바이트 종류 자리(오름차순)
    patches: Vec<u64>,
    tracks: usize,
    samples: u64,
    discontinuities: u32,
}

enum Outcome {
    Flat,
    NotFragmented,
    Plan(Plan),
}

fn plan(src: &mut dyn Source) -> Result<Outcome, Fail> {
    let tops = scan(src)?;
    let mut init_body: Option<Vec<u8>> = None;
    let mut patches = Vec::new();
    let mut moofs = Vec::new();
    let mut mdats = Vec::new();
    for t in &tops {
        let body_off = t.off + t.hdr;
        let body_len = t.size - t.hdr;
        match &t.kind {
            b"ftyp" => {}
            b"mdat" => mdats.push((body_off, t.off + t.size)),
            b"moov" => {
                let body = read_vec(src, body_off, body_len)?;
                if find(&children(&body)?, b"mvex").is_none() {
                    // mvex 없는 moov: 이미 일반 mp4다.
                    return Ok(Outcome::Flat);
                }
                if init_body.is_none() {
                    init_body = Some(body);
                }
                patches.push(t.off + 4);
            }
            b"moof" => {
                moofs.push(*t);
                patches.push(t.off + 4);
            }
            b"free" | b"skip" => {
                // 앞선 변환이 3단계 도중 끊겨 이미 free로 바뀐 moof·init moov인지 첫 자식으로 알아본다.
                if body_len >= 8 {
                    let mut h = [0u8; 8];
                    src.read_at(body_off, &mut h)?;
                    match &h[4..8] {
                        b"mfhd" => moofs.push(*t),
                        b"mvhd" if init_body.is_none() => {
                            let body = read_vec(src, body_off, body_len)?;
                            if find(&children(&body)?, b"mvex").is_some() {
                                init_body = Some(body);
                            }
                        }
                        _ => {}
                    }
                }
            }
            // styp·emsg·sidx·mfra와 모르는 상자: 무시되게 free로 바꾼다.
            _ => patches.push(t.off + 4),
        }
    }
    if moofs.is_empty() {
        return Ok(Outcome::NotFragmented);
    }
    let init = parse_init(&init_body.ok_or_else(|| bad("init moov가 없다"))?)?;
    let mut tables: Vec<Tables> = init.tracks.iter().map(|_| Tables::default()).collect();
    for m in &moofs {
        let body = read_vec(src, m.off + m.hdr, m.size - m.hdr)?;
        parse_moof(m.off, &body, &init, &mut tables, &mdats)?;
    }
    let moov = build_moov(&init, &tables)?;
    patches.sort_unstable();
    patches.dedup();
    Ok(Outcome::Plan(Plan {
        moov,
        patches,
        tracks: tables.iter().filter(|t| t.count > 0).count(),
        samples: tables.iter().map(|t| u64::from(t.count)).sum(),
        discontinuities: tables.iter().map(|t| t.discontinuities).sum(),
    }))
}

// ---------------------------------------------------------------------------------------------
// 쓰기

fn put_box(
    out: &mut Vec<u8>,
    kind: &[u8; 4],
    f: impl FnOnce(&mut Vec<u8>) -> Result<(), Fail>,
) -> Result<(), Fail> {
    let start = out.len();
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(kind);
    f(out)?;
    let size = u32::try_from(out.len() - start).map_err(|_| bad("상자가 4 GiB를 넘는다"))?;
    out[start..start + 4].copy_from_slice(&size.to_be_bytes());
    Ok(())
}

fn put_full(out: &mut Vec<u8>, version: u8, flags: u32) {
    out.push(version);
    out.extend_from_slice(&flags.to_be_bytes()[1..]);
}

fn put32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_be_bytes());
}

/// `mvhd`·`tkhd`·`mdhd`의 duration을 바꾼다. version 0인데 32비트를 넘으면 version 1로 바꿔 쓴다.
fn with_duration(full: &[u8], dur: u64) -> Result<Vec<u8>, Fail> {
    let cs = children(full)?;
    let c = cs.first().ok_or_else(|| bad("빈 상자"))?;
    let body = c.body;
    let v1 = body.first() == Some(&1);
    let at = match (&c.kind, v1) {
        (b"tkhd", false) => 20,
        (b"tkhd", true) => 28,
        (_, false) => 16,
        (_, true) => 24,
    };
    let width = if v1 { 8 } else { 4 };
    if body.len() < at + width {
        return Err(bad("duration 자리가 없다"));
    }
    let mut nb = Vec::with_capacity(body.len() + 12);
    if v1 {
        nb.extend_from_slice(&body[..at]);
        nb.extend_from_slice(&dur.to_be_bytes());
    } else if let Ok(d) = u32::try_from(dur) {
        nb.extend_from_slice(&body[..at]);
        nb.extend_from_slice(&d.to_be_bytes());
    } else {
        // version 1로: creation·modification을 64비트로 늘린다.
        nb.push(1);
        nb.extend_from_slice(&body[1..4]);
        nb.extend_from_slice(&u64::from(be32(&body[4..8])).to_be_bytes());
        nb.extend_from_slice(&u64::from(be32(&body[8..12])).to_be_bytes());
        nb.extend_from_slice(&body[12..at]);
        nb.extend_from_slice(&dur.to_be_bytes());
    }
    nb.extend_from_slice(&body[at + width..]);
    let mut out = Vec::new();
    put_box(&mut out, &c.kind, |o| {
        o.extend_from_slice(&nb);
        Ok(())
    })?;
    Ok(out)
}

/// `a * mul / div`(내림, i128).
fn rescale(a: i128, mul: u32, div: u32) -> i128 {
    (a * i128::from(mul)).div_euclid(i128::from(div))
}

fn to_u64(v: i128) -> Result<u64, Fail> {
    u64::try_from(v).map_err(|_| bad("시간 값이 범위를 넘는다"))
}

fn build_moov(init: &Init, tables: &[Tables]) -> Result<Vec<u8>, Fail> {
    let used: Vec<(&InitTrack, &Tables)> = init
        .tracks
        .iter()
        .zip(tables)
        .filter(|(_, t)| t.count > 0)
        .collect();
    if used.is_empty() {
        return Err(bad("샘플이 하나도 없다"));
    }
    let mts = init.movie_ts;
    // 트랙마다 첫 표시 시각(방송 기준, movie timescale). 가장 이른 트랙을 0으로 본다.
    let starts: Vec<i128> = used
        .iter()
        .map(|(it, t)| {
            let abs = i128::from(t.first_tfdt.unwrap_or(0)) + t.min_pts.unwrap_or(0);
            rescale(abs, mts, it.timescale)
        })
        .collect();
    let earliest = starts.iter().copied().min().unwrap_or(0);
    struct Timing {
        delay: u64,
        seg: u64,
        media_time: u64,
        shift: i64,
    }
    let mut timings = Vec::new();
    let mut movie_dur = 0u64;
    for ((it, t), s) in used.iter().zip(&starts) {
        let shift = (-t.min_cts).max(0);
        let media_time = to_u64(t.min_pts.unwrap_or(0) + i128::from(shift))?;
        let delay = to_u64(s - earliest)?;
        // 표시 길이는 샘플 길이 합이다(ffmpeg와 같다).
        let seg = to_u64(rescale(i128::from(t.dts), mts, it.timescale))?;
        movie_dur = movie_dur.max(delay + seg);
        timings.push(Timing {
            delay,
            seg,
            media_time,
            shift,
        });
    }

    let mut moov = Vec::new();
    put_box(&mut moov, b"moov", |o| {
        let mut mvhd = with_duration(&init.mvhd, movie_dur)?;
        let next_id = used
            .iter()
            .map(|(it, _)| it.id)
            .max()
            .unwrap_or(0)
            .saturating_add(1);
        let n = mvhd.len();
        if n < 4 + 8 {
            return Err(bad("mvhd가 짧다"));
        }
        mvhd[n - 4..].copy_from_slice(&next_id.to_be_bytes());
        o.extend_from_slice(&mvhd);
        for ((it, t), tm) in used.iter().zip(&timings) {
            put_box(o, b"trak", |o| {
                o.extend_from_slice(&with_duration(&it.tkhd, tm.delay + tm.seg)?);
                put_edts(o, tm.delay, tm.seg, tm.media_time)?;
                put_box(o, b"mdia", |o| {
                    o.extend_from_slice(&with_duration(&it.mdhd, t.dts)?);
                    o.extend_from_slice(&it.hdlr);
                    put_box(o, b"minf", |o| {
                        o.extend_from_slice(&it.minf_rest);
                        put_stbl(o, &it.stsd, t, tm.shift)
                    })
                })
            })?;
        }
        Ok(())
    })?;
    Ok(moov)
}

/// 시작 지연(빈 편집)과 첫 표시 샘플 위치(media_time)를 `elst`로 남긴다.
fn put_edts(o: &mut Vec<u8>, delay: u64, seg: u64, media_time: u64) -> Result<(), Fail> {
    let mut entries: Vec<(u64, i64)> = Vec::new();
    if delay > 0 {
        entries.push((delay, -1));
    }
    let mt = i64::try_from(media_time).map_err(|_| bad("media_time이 너무 크다"))?;
    entries.push((seg, mt));
    let v1 = entries
        .iter()
        .any(|(d, m)| u32::try_from(*d).is_err() || i32::try_from(*m).is_err());
    put_box(o, b"edts", |o| {
        put_box(o, b"elst", |o| {
            put_full(o, u8::from(v1), 0);
            put32(o, entries.len() as u32);
            for (d, m) in &entries {
                if v1 {
                    o.extend_from_slice(&d.to_be_bytes());
                    o.extend_from_slice(&m.to_be_bytes());
                } else {
                    put32(o, *d as u32);
                    o.extend_from_slice(&(*m as i32).to_be_bytes());
                }
                // media_rate 1.0
                put32(o, 0x0001_0000);
            }
            Ok(())
        })
    })
}

fn put_stbl(o: &mut Vec<u8>, stsd: &[u8], t: &Tables, shift: i64) -> Result<(), Fail> {
    put_box(o, b"stbl", |o| {
        o.extend_from_slice(stsd);
        put_box(o, b"stts", |o| {
            put_full(o, 0, 0);
            put32(o, t.stts.len() as u32);
            for (n, d) in &t.stts {
                put32(o, *n);
                put32(o, *d);
            }
            Ok(())
        })?;
        // 오프셋을 0 이상으로 옮긴다(첫 표시 위치는 elst media_time이 맞춘다). 모두 0이면 뺀다.
        if t.ctts.iter().any(|(_, c)| c + shift != 0) {
            put_box(o, b"ctts", |o| {
                put_full(o, 0, 0);
                put32(o, t.ctts.len() as u32);
                for (n, c) in &t.ctts {
                    put32(o, *n);
                    let c = u32::try_from(c + shift).map_err(|_| bad("ctts 값이 범위를 넘는다"))?;
                    put32(o, c);
                }
                Ok(())
            })?;
        }
        if t.sync.len() != t.sizes.len() {
            put_box(o, b"stss", |o| {
                put_full(o, 0, 0);
                put32(o, t.sync.len() as u32);
                for s in &t.sync {
                    put32(o, *s);
                }
                Ok(())
            })?;
        }
        put_box(o, b"stsc", |o| {
            put_full(o, 0, 0);
            put32(o, t.stsc.len() as u32);
            for (f, n, s) in &t.stsc {
                put32(o, *f);
                put32(o, *n);
                put32(o, *s);
            }
            Ok(())
        })?;
        put_box(o, b"stsz", |o| {
            put_full(o, 0, 0);
            let first = t.sizes[0];
            if t.sizes.iter().all(|s| *s == first) {
                put32(o, first);
                put32(o, t.count);
            } else {
                put32(o, 0);
                put32(o, t.count);
                for s in &t.sizes {
                    put32(o, *s);
                }
            }
            Ok(())
        })?;
        let wide = t.chunks.iter().any(|c| u32::try_from(*c).is_err());
        put_box(o, if wide { b"co64" } else { b"stco" }, |o| {
            put_full(o, 0, 0);
            put32(o, t.chunks.len() as u32);
            for c in &t.chunks {
                if wide {
                    o.extend_from_slice(&c.to_be_bytes());
                } else {
                    put32(o, *c as u32);
                }
            }
            Ok(())
        })
    })
}

#[cfg(test)]
mod tests;
