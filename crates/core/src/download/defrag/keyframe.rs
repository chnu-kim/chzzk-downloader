//! 조각 첫 샘플이 동기 샘플(키프레임)인가 판정한다(기능 ② 실측 M-②-3, PR ②-0, core.md 구현 중 변경 70).
//!
//! 입력은 구간 없이 받은 빠른 다시보기의 조각 구조 파일이다: init(`ftyp`+`moov`(mvex)) 뒤에 HLS 조각(`styp`·`moof`·`mdat`…)이
//! 받은 그대로 이어진다. 실측 M-②-3 때(v0.10.0까지)는 전체 받기를 마무리에서 바꾸지 않아 결과가 이 모양이었다. core.md 구현 중
//! 변경 71부터는 전체 받기도 일반 mp4로 바뀌므로, 그 전 빌드로 받은 파일이나 조각 구조를 그대로 이어 붙인 파일만 검사한다.
//! `moov`·`moof` 본문만 읽고 `mdat`은 읽지 않는다(상자 훑기는 `defrag`의 것을 그대로 쓴다).
//!
//! ## 판정 규칙(ISO/IEC 14496-12)
//! sample_flags 32비트(§8.8.3.1, 높은 비트부터): reserved 4 · is_leading 2 · **sample_depends_on 2**(`>> 24 & 3`) ·
//! sample_is_depended_on 2 · sample_has_redundancy 2 · sample_padding_value 3 · **sample_is_non_sync_sample 1**
//! (`0x0001_0000`) · sample_degradation_priority 16.
//! - **동기 샘플 ⇔ `sample_is_non_sync_sample == 0`.** 이 비트가 `stss`(§8.6.2)와 같은 뜻이고, `defrag`가 구간 결과의
//!   `stss`를 이 비트로만 만든다(`NON_SYNC`). 그래서 판정도 이 비트 하나로 한다.
//! - `sample_depends_on == 2`(다른 샘플에 기대지 않는다, I 프레임)는 동기 샘플의 근거로 쓰지 않는다. open-GOP의 I 프레임
//!   (HEVC CRA 등)은 앞 샘플을 참조하는 leading 샘플이 뒤따라 non-sync로 표시될 수 있다. 이 경우는 "아님" 안에서
//!   따로 센다(`non_sync_independent`). 반대로 non-sync 비트가 0인데 depends_on이 1인 모순 표시는 비트를 따른다(동기).
//! - 샘플의 sample_flags는 `trun` `first_sample_flags`(첫 샘플만) → 샘플별 `sample_flags` → `tfhd`
//!   `default_sample_flags` → `trex` `default_sample_flags` 순이다(§8.8.8·§8.8.7·§8.8.3, `super::sample_flags` 한 곳).
//!
//! ## 판정 단위
//! HLS 조각 하나(받기·구간 자르기의 단위)다. 조각 경계는 최상위 `styp`다(HLS fMP4 조각은 `styp`로 시작할 수 있다,
//! 합성 fixture도 그렇다). 파일에 `styp`가 하나도 없으면 `moof` 하나를 조각 하나로 센다(`Boundary::Moof`).
//! 조각 안에서 처음 나오는 비디오(`hdlr` `vide`) 샘플 하나만 본다: 비어 있지 않은 첫 `trun`의 첫 샘플이다. 빈 `trun`과
//! 비디오가 아닌 트랙은 건너뛴다. 조각 안에 비디오 샘플이 없으면 "확인 못 함" 칸(`no_video`)에 센다.

use std::fs::File;
use std::io::{Seek, SeekFrom};

use super::{
    Child, Fail, FileSrc, Init, NON_SYNC, Rd, Source, TF_BASE_DATA_OFFSET, TF_DURATION, TF_FLAGS,
    TF_SDI, TF_SIZE, TR_CTS, TR_DATA_OFFSET, TR_DURATION, TR_FIRST_FLAGS, TR_FLAGS, TR_SIZE, bad,
    children, find, parse_init, read_vec, sample_flags, scan,
};
use crate::error::Error;

/// sample_flags의 sample_depends_on 자리(2비트).
const DEPENDS_ON_SHIFT: u32 = 24;
/// sample_depends_on == 2: 다른 샘플에 기대지 않는다(I 프레임).
const DEPENDS_ON_NONE: u32 = 2;

/// 샘플 하나의 종류.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SampleKind {
    /// 동기 샘플(키프레임)
    Sync,
    /// 동기 샘플이 아니다. `independent`는 sample_depends_on == 2(I 프레임 표시)인지다.
    NonSync { independent: bool },
}

/// sample_flags 하나를 판정한다(위 판정 규칙).
pub fn classify_flags(flags: u32) -> SampleKind {
    if flags & NON_SYNC == 0 {
        SampleKind::Sync
    } else {
        SampleKind::NonSync {
            independent: (flags >> DEPENDS_ON_SHIFT) & 0b11 == DEPENDS_ON_NONE,
        }
    }
}

/// 조각 경계를 무엇으로 셌는가.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Boundary {
    /// 최상위 `styp`
    #[default]
    Styp,
    /// `styp`가 없어 `moof` 하나를 조각 하나로 셌다
    Moof,
}

/// 파일 하나의 집계. 출력할 때는 판정과 이 수만 쓴다(주소·시각·길이·크기는 다루지 않는다).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct KeyframeReport {
    pub boundary: Boundary,
    /// 검사한 조각 수(아래 셋의 합 + `no_video`)
    pub fragments: u32,
    /// 첫 비디오 샘플이 동기 샘플인 조각
    pub sync: u32,
    /// 첫 비디오 샘플이 동기 샘플이 아닌 조각
    pub non_sync: u32,
    /// `non_sync` 중 sample_depends_on == 2(I 프레임 표시)인 것
    pub non_sync_independent: u32,
    /// 비디오 샘플이 없는 조각(확인 못 함)
    pub no_video: u32,
}

/// 파일 전체 판정.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    /// 검사한 모든 조각이 키프레임으로 시작한다
    Yes,
    /// 키프레임으로 시작하지 않는 조각이 하나 이상 있다
    No,
    /// 조각이 없거나, 아님은 없지만 비디오 샘플이 없는 조각이 있다
    Unknown,
}

impl KeyframeReport {
    pub fn verdict(&self) -> Verdict {
        if self.non_sync > 0 {
            Verdict::No
        } else if self.fragments == 0 || self.no_video > 0 {
            Verdict::Unknown
        } else {
            Verdict::Yes
        }
    }

    /// 조각 하나를 닫는다. `first`는 그 조각의 첫 비디오 샘플 종류(없으면 `None`).
    fn close(&mut self, first: Option<SampleKind>) {
        self.fragments += 1;
        match first {
            Some(SampleKind::Sync) => self.sync += 1,
            Some(SampleKind::NonSync { independent }) => {
                self.non_sync += 1;
                self.non_sync_independent += u32::from(independent);
            }
            None => self.no_video += 1,
        }
    }
}

/// 검사 결과.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyframeCheck {
    /// 조각 구조 파일을 검사했다
    Fragmented(KeyframeReport),
    /// 조각 구조가 아니다(`mvex` 없는 `moov` = 일반 mp4, 또는 `moof` 없음). 판정할 수 없다.
    NotFragmented,
}

/// 파일을 검사한다. 구조를 해석하지 못하면 `Err`다(detail에는 바이트 위치가 들 수 있으니 그대로 출력하지 않는다).
pub fn check_file(file: &mut File) -> Result<KeyframeCheck, Error> {
    let len = file
        .seek(SeekFrom::End(0))
        .map_err(|e| Fail::Io(e).into_error())?;
    check_src(&mut FileSrc { f: file, len }).map_err(Fail::into_error)
}

/// 테스트용: 바이트 위에서 `check_file`과 같은 일을 한다.
#[cfg(test)]
pub(crate) fn check_bytes(b: &[u8]) -> Result<KeyframeCheck, Error> {
    check_src(&mut super::SliceSrc(b)).map_err(Fail::into_error)
}

/// 열린 조각(판정 단위) 하나.
struct Open {
    /// 이 조각의 첫 비디오 샘플 종류(아직 못 찾았으면 `None`)
    first: Option<SampleKind>,
}

fn check_src(src: &mut dyn Source) -> Result<KeyframeCheck, Fail> {
    let tops = scan(src)?;
    let boundary = if tops.iter().any(|t| &t.kind == b"styp") {
        Boundary::Styp
    } else {
        Boundary::Moof
    };
    let mut init: Option<Init> = None;
    let mut report = KeyframeReport {
        boundary,
        ..KeyframeReport::default()
    };
    let mut open: Option<Open> = None;
    let mut saw_moof = false;
    for t in &tops {
        let body_off = t.off + t.hdr;
        let body_len = t.size - t.hdr;
        match &t.kind {
            b"moov" if init.is_none() => {
                let body = read_vec(src, body_off, body_len)?;
                if find(&children(&body)?, b"mvex").is_none() {
                    // mvex 없는 moov: 일반 mp4(구간 받기 결과 등)라 조각 경계가 없다.
                    return Ok(KeyframeCheck::NotFragmented);
                }
                init = Some(parse_init(&body)?);
            }
            b"styp" => {
                if let Some(o) = open.take() {
                    report.close(o.first);
                }
                open = Some(Open { first: None });
            }
            b"moof" => {
                saw_moof = true;
                let init = init
                    .as_ref()
                    .ok_or_else(|| bad("init moov보다 moof가 먼저다"))?;
                if boundary == Boundary::Moof
                    && let Some(o) = open.take()
                {
                    report.close(o.first);
                }
                // styp 경계인데 첫 styp 앞에 moof가 있으면 그 moof가 조각 하나를 연다.
                let o = open.get_or_insert(Open { first: None });
                let body = read_vec(src, body_off, body_len)?;
                // 조각의 첫 비디오 샘플이 이미 정해졌어도 moof 구조는 끝까지 확인한다(해석 실패를 놓치지 않게).
                let first = first_video_sample(&body, init)?;
                if o.first.is_none() {
                    o.first = first;
                }
            }
            _ => {}
        }
    }
    if !saw_moof {
        return Ok(KeyframeCheck::NotFragmented);
    }
    if let Some(o) = open.take() {
        report.close(o.first);
    }
    Ok(KeyframeCheck::Fragmented(report))
}

/// `moof` 본문에서 처음 나오는 비디오 샘플의 종류. 비디오 샘플이 없으면 `None`.
fn first_video_sample(moof_body: &[u8], init: &Init) -> Result<Option<SampleKind>, Fail> {
    let mut found = None;
    for traf in children(moof_body)?.iter().filter(|c| &c.kind == b"traf") {
        let k = traf_first_sample(traf, init)?;
        if found.is_none() {
            found = k;
        }
    }
    Ok(found)
}

/// `traf` 하나의 첫 샘플 종류. 비디오 트랙이 아니거나 샘플이 없으면 `None`.
fn traf_first_sample(traf: &Child<'_>, init: &Init) -> Result<Option<SampleKind>, Fail> {
    let tc = children(traf.body)?;
    let tfhd = tc
        .iter()
        .find(|c| &c.kind == b"tfhd")
        .ok_or_else(|| bad("traf에 tfhd가 없다"))?;
    let mut r = Rd::new(tfhd.body);
    let fl = r.u32()? & 0xff_ffff;
    let id = r.u32()?;
    if fl & TF_BASE_DATA_OFFSET != 0 {
        r.u64()?;
    }
    for bit in [TF_SDI, TF_DURATION, TF_SIZE] {
        if fl & bit != 0 {
            r.u32()?;
        }
    }
    let tfhd_default = if fl & TF_FLAGS != 0 {
        Some(r.u32()?)
    } else {
        None
    };
    let track = init
        .tracks
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| bad(format!("init에 없는 트랙 {id}")))?;
    let default = tfhd_default.unwrap_or(track.trex.flags);
    let video = is_video(&track.hdlr);
    let mut found = None;
    for trun in tc.iter().filter(|c| &c.kind == b"trun") {
        let mut r = Rd::new(trun.body);
        let fl = r.u32()? & 0xff_ffff;
        let n = r.u32()?;
        if fl & TR_DATA_OFFSET != 0 {
            r.u32()?;
        }
        let first = if fl & TR_FIRST_FLAGS != 0 {
            Some(r.u32()?)
        } else {
            None
        };
        // 샘플별 칸: duration·size·flags·composition_time_offset 순(§8.8.8.2)
        let per = [TR_DURATION, TR_SIZE, TR_FLAGS, TR_CTS]
            .iter()
            .filter(|b| fl & **b != 0)
            .count()
            * 4;
        if (n as usize).saturating_mul(per) > r.remaining() {
            return Err(bad("trun 샘플 수가 본문보다 많다"));
        }
        if n == 0 || found.is_some() || !video {
            continue;
        }
        for bit in [TR_DURATION, TR_SIZE] {
            if fl & bit != 0 {
                r.u32()?;
            }
        }
        let per_sample = if fl & TR_FLAGS != 0 {
            Some(r.u32()?)
        } else {
            None
        };
        found = Some(classify_flags(sample_flags(0, first, per_sample, default)));
    }
    Ok(found)
}

/// init `hdlr`(헤더 포함)의 handler_type이 `vide`인가. 자리: 헤더 8 · version/flags 4 · pre_defined 4 · handler_type 4.
fn is_video(hdlr_full: &[u8]) -> bool {
    hdlr_full.get(16..20) == Some(b"vide".as_slice())
}

#[cfg(test)]
mod tests;
