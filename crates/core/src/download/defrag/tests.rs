//! `defrag` 단위 테스트. 합성 fixture(`testdata/live/synthetic_frag.mp4`, ffmpeg lavfi)와 손으로 만든 상자 바이트만 쓴다.
//!
//! 기대값은 원본 `moof`/`trun`을 이 파일의 별도 해석기(`frag_samples`)로 읽은 샘플 목록이고, 결과는 새 `moov`의
//! 표를 펼친 샘플 목록(`flat_samples`)이다. 둘이 샘플 단위로 같아야 한다.

use std::io::{Read, Seek, SeekFrom, Write};

use super::*;

const FIXTURE: &[u8] = include_bytes!("../../../../../testdata/live/synthetic_frag.mp4");

// ---------------------------------------------------------------------------------------------
// 검사용 해석기

#[derive(Clone, Debug, PartialEq, Eq)]
struct Sample {
    off: u64,
    size: u32,
    dur: u32,
    cts: i64,
    sync: bool,
}

#[derive(Debug)]
struct FlatTrack {
    id: u32,
    samples: Vec<Sample>,
    /// (segment_duration, media_time)
    elst: Vec<(u64, i64)>,
    tkhd_dur: u64,
    mdhd_dur: u64,
}

fn top_boxes(b: &[u8]) -> Vec<(String, usize, usize, usize)> {
    // (종류, 시작, 헤더 길이, 크기)
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let s = be32(&b[i..]) as usize;
        let (size, hdr) = match s {
            1 => (be64(&b[i + 8..]) as usize, 16),
            0 => (b.len() - i, 8),
            s => (s, 8),
        };
        out.push((
            String::from_utf8_lossy(&b[i + 4..i + 8]).into_owned(),
            i,
            hdr,
            size,
        ));
        i += size;
    }
    out
}

fn kids(b: &[u8]) -> Vec<Child<'_>> {
    children(b).unwrap()
}

fn get<'a>(cs: &[Child<'a>], k: &[u8; 4]) -> Child<'a> {
    find(cs, k).unwrap_or_else(|| panic!("{} 없음", String::from_utf8_lossy(k)))
}

fn u32s(b: &[u8]) -> Vec<u32> {
    b.chunks(4).map(be32).collect()
}

/// 일반 mp4의 끝 `moov`를 펼친다.
fn flat_samples(b: &[u8]) -> Vec<FlatTrack> {
    let tops = top_boxes(b);
    let (_, off, hdr, size) = tops.iter().rfind(|t| t.0 == "moov").unwrap().clone();
    let moov = &b[off + hdr..off + size];
    let mut out = Vec::new();
    for trak in kids(moov).iter().filter(|c| &c.kind == b"trak") {
        let tc = kids(trak.body);
        let tkhd = get(&tc, b"tkhd").body;
        let (id, tkhd_dur) = if tkhd[0] == 1 {
            (be32(&tkhd[20..]), be64(&tkhd[28..]))
        } else {
            (be32(&tkhd[12..]), u64::from(be32(&tkhd[20..])))
        };
        let elst_b = get(&kids(get(&tc, b"edts").body), b"elst").body;
        let n = be32(&elst_b[4..]) as usize;
        let elst = (0..n)
            .map(|i| {
                if elst_b[0] == 1 {
                    let e = &elst_b[8 + i * 20..];
                    (be64(e), be64(&e[8..]) as i64)
                } else {
                    let e = &elst_b[8 + i * 12..];
                    (u64::from(be32(e)), i64::from(be32(&e[4..]) as i32))
                }
            })
            .collect();
        let mdia = kids(get(&tc, b"mdia").body);
        let mdhd = get(&mdia, b"mdhd").body;
        let mdhd_dur = if mdhd[0] == 1 {
            be64(&mdhd[24..])
        } else {
            u64::from(be32(&mdhd[16..]))
        };
        let stbl = kids(get(&kids(get(&mdia, b"minf").body), b"stbl").body);
        let table = |k: &[u8; 4]| find(&stbl, k).map(|c| u32s(&c.body[4..]));
        let stts = table(b"stts").unwrap();
        let mut durs = Vec::new();
        for e in stts[1..].chunks(2) {
            durs.extend(std::iter::repeat_n(e[1], e[0] as usize));
        }
        let count = durs.len();
        let mut ctts = vec![0i64; count];
        if let Some(c) = table(b"ctts") {
            let mut i = 0;
            for e in c[1..].chunks(2) {
                for _ in 0..e[0] {
                    ctts[i] = i64::from(e[1]);
                    i += 1;
                }
            }
        }
        let sync: Vec<bool> = match table(b"stss") {
            Some(s) => {
                let mut v = vec![false; count];
                for x in &s[1..] {
                    v[*x as usize - 1] = true;
                }
                v
            }
            None => vec![true; count],
        };
        let stsz = table(b"stsz").unwrap();
        let sizes: Vec<u32> = if stsz[0] != 0 {
            vec![stsz[0]; stsz[1] as usize]
        } else {
            stsz[2..].to_vec()
        };
        assert_eq!(sizes.len(), count, "stsz 수");
        let chunks: Vec<u64> = match table(b"stco") {
            Some(c) => c[1..].iter().map(|x| u64::from(*x)).collect(),
            None => {
                let c = get(&stbl, b"co64").body;
                c[8..].chunks(8).map(be64).collect()
            }
        };
        let stsc = table(b"stsc").unwrap();
        let entries: Vec<&[u32]> = stsc[1..].chunks(3).collect();
        let mut samples = Vec::new();
        let mut si = 0;
        for (ci, off) in chunks.iter().enumerate() {
            let k = ci as u32 + 1;
            let spc = entries.iter().rfind(|e| e[0] <= k).unwrap()[1];
            let mut o = *off;
            for _ in 0..spc {
                samples.push(Sample {
                    off: o,
                    size: sizes[si],
                    dur: durs[si],
                    cts: ctts[si],
                    sync: sync[si],
                });
                o += u64::from(sizes[si]);
                si += 1;
            }
        }
        assert_eq!(si, count, "stsc·stco가 모든 샘플을 덮어야 한다");
        out.push(FlatTrack {
            id,
            samples,
            elst,
            tkhd_dur,
            mdhd_dur,
        });
    }
    out
}

/// 원본 조각 구조를 따로 읽는다: (track_id, 샘플, 첫 tfdt).
fn frag_samples(b: &[u8]) -> Vec<(u32, Vec<Sample>, u64)> {
    let tops = top_boxes(b);
    let (_, off, hdr, size) = tops.iter().find(|t| t.0 == "moov").unwrap().clone();
    let moov = kids(&b[off + hdr..off + size]);
    let mut trex = std::collections::HashMap::new();
    for t in kids(get(&moov, b"mvex").body)
        .iter()
        .filter(|c| &c.kind == b"trex")
    {
        let v = u32s(&t.body[4..]);
        trex.insert(v[0], (v[1], v[2], v[3], v[4]));
    }
    let mut out: Vec<(u32, Vec<Sample>, u64)> = Vec::new();
    for (_, moof_off, hdr, size) in tops.iter().filter(|t| t.0 == "moof") {
        let moof = &b[moof_off + hdr..moof_off + size];
        let mut prev_end = *moof_off as u64;
        for traf in kids(moof).iter().filter(|c| &c.kind == b"traf") {
            let tc = kids(traf.body);
            let tfhd = get(&tc, b"tfhd").body;
            let fl = be32(tfhd) & 0xff_ffff;
            let id = be32(&tfhd[4..]);
            let (_, tdur, tsize, tflags) = trex[&id];
            let mut i = 8;
            let mut field = |bit: u32, w: usize| {
                if fl & bit != 0 {
                    let v = if w == 8 {
                        be64(&tfhd[i..])
                    } else {
                        u64::from(be32(&tfhd[i..]))
                    };
                    i += w;
                    Some(v)
                } else {
                    None
                }
            };
            let bdo = field(1, 8);
            let _sdi = field(2, 4);
            let ddur = field(8, 4).map_or(tdur, |v| v as u32);
            let dsize = field(0x10, 4).map_or(tsize, |v| v as u32);
            let dflags = field(0x20, 4).map_or(tflags, |v| v as u32);
            let base = bdo.unwrap_or(if fl & 0x2_0000 != 0 {
                *moof_off as u64
            } else {
                prev_end
            });
            let tfdt = find(&tc, b"tfdt").map(|t| {
                if t.body[0] == 1 {
                    be64(&t.body[4..])
                } else {
                    u64::from(be32(&t.body[4..]))
                }
            });
            let idx = match out.iter().position(|t| t.0 == id) {
                Some(i) => i,
                None => {
                    out.push((id, Vec::new(), tfdt.unwrap_or(0)));
                    out.len() - 1
                }
            };
            let mut cursor = base;
            for trun in tc.iter().filter(|c| &c.kind == b"trun") {
                let r = trun.body;
                let (v, fl) = (r[0], be32(r) & 0xff_ffff);
                let n = be32(&r[4..]);
                let mut i = 8;
                let mut next = || {
                    let x = be32(&r[i..]);
                    i += 4;
                    x
                };
                let start = if fl & 1 != 0 {
                    (base as i64 + i64::from(next() as i32)) as u64
                } else {
                    cursor
                };
                let first = if fl & 4 != 0 { Some(next()) } else { None };
                let mut o = start;
                for k in 0..n {
                    let dur = if fl & 0x100 != 0 { next() } else { ddur };
                    let size = if fl & 0x200 != 0 { next() } else { dsize };
                    let f = if fl & 0x400 != 0 { next() } else { dflags };
                    let f = if k == 0 { first.unwrap_or(f) } else { f };
                    let cts = if fl & 0x800 != 0 {
                        let c = next();
                        if v == 0 {
                            i64::from(c)
                        } else {
                            i64::from(c as i32)
                        }
                    } else {
                        0
                    };
                    out[idx].1.push(Sample {
                        off: o,
                        size,
                        dur,
                        cts,
                        sync: f & 0x1_0000 == 0,
                    });
                    o += u64::from(size);
                }
                cursor = o;
            }
            prev_end = cursor;
        }
    }
    out
}

/// 원본과 변환 결과가 샘플 단위로 같은지 본다. cts는 상수 이동만 허용한다.
fn assert_equivalent(orig: &[u8], out: &[u8]) {
    // (a) 최상위: moof 없음, 끝은 moov, mdat은 그대로 있다
    let tops = top_boxes(out);
    let kinds: Vec<&str> = tops.iter().map(|t| t.0.as_str()).collect();
    assert!(!kinds.contains(&"moof"), "{kinds:?}");
    assert_eq!(kinds.last(), Some(&"moov"));
    assert_eq!(
        kinds.iter().filter(|k| **k == "moov").count(),
        1,
        "{kinds:?}"
    );
    assert!(kinds.contains(&"mdat"));
    for k in &kinds {
        assert!(
            ["ftyp", "free", "mdat", "moov"].contains(k),
            "남은 상자 {k}"
        );
    }
    // 원본 부분의 바이트는 종류 4바이트만 바뀌었다
    let diff: Vec<usize> = (0..orig.len()).filter(|i| orig[*i] != out[*i]).collect();
    assert!(diff.len() <= 4 * tops.len());

    let want = frag_samples(orig);
    let got = flat_samples(out);
    let total = |t: &[Sample]| t.iter().map(|s| u64::from(s.dur)).sum::<u64>();
    for (id, w, _) in &want {
        let g = got.iter().find(|t| t.id == *id).unwrap();
        // (b) 샘플 수·총 길이
        assert_eq!(g.samples.len(), w.len(), "트랙 {id} 샘플 수");
        assert_eq!(total(&g.samples), total(w), "트랙 {id} 길이");
        assert_eq!(g.mdhd_dur, total(w));
        // (c) 바이트 범위가 원본 mdat 안의 같은 자리
        for (a, b) in g.samples.iter().zip(w) {
            assert_eq!((a.off, a.size, a.dur), (b.off, b.size, b.dur), "트랙 {id}");
            assert_eq!(
                &out[a.off as usize..(a.off + u64::from(a.size)) as usize],
                &orig[b.off as usize..(b.off + u64::from(b.size)) as usize]
            );
        }
        // (d) 동기 샘플 위치
        let gs: Vec<usize> = (0..w.len()).filter(|i| g.samples[*i].sync).collect();
        let ws: Vec<usize> = (0..w.len()).filter(|i| w[*i].sync).collect();
        assert_eq!(gs, ws, "트랙 {id} stss");
        // cts: 상수 이동만
        let shift = g.samples[0].cts - w[0].cts;
        assert!(g.samples.iter().zip(w).all(|(a, b)| a.cts - b.cts == shift));
        assert!(g.samples.iter().all(|s| s.cts >= 0));
        // elst의 media_time은 가장 이른 표시 시각
        let mut dts = 0i64;
        let mut min_pts = i64::MAX;
        for s in &g.samples {
            min_pts = min_pts.min(dts + s.cts);
            dts += i64::from(s.dur);
        }
        assert_eq!(g.elst.last().unwrap().1, min_pts, "트랙 {id} media_time");
    }
    assert_eq!(got.len(), want.len());
}

fn convert(b: &[u8]) -> (Vec<u8>, DefragReport) {
    let mut v = b.to_vec();
    let r = defragment_bytes(&mut v).unwrap();
    (v, r)
}

// ---------------------------------------------------------------------------------------------
// 합성 상자 만들기

fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut o = Vec::new();
    put_box(&mut o, kind, |o| {
        o.extend_from_slice(body);
        Ok(())
    })
    .unwrap();
    o
}

fn full_body(v: u8, flags: u32, rest: &[u8]) -> Vec<u8> {
    let mut o = Vec::new();
    put_full(&mut o, v, flags);
    o.extend_from_slice(rest);
    o
}

fn words(ws: &[u32]) -> Vec<u8> {
    ws.iter().flat_map(|w| w.to_be_bytes()).collect()
}

/// 합성 트랙 정의.
#[derive(Clone, Copy)]
struct TrackDef {
    id: u32,
    timescale: u32,
    video: bool,
    /// trex 기본값 (duration, size, flags)
    trex: (u32, u32, u32),
}

fn init_bytes(movie_ts: u32, tracks: &[TrackDef]) -> Vec<u8> {
    let mut out = bx(b"ftyp", b"iso6\0\0\0\0iso6");
    let mut moov = Vec::new();
    // mvhd v0: c m ts dur rate volume reserved matrix pre_defined next_track_ID
    let mut mvhd = words(&[0, 0, movie_ts, 0, 0x0001_0000]);
    mvhd.extend_from_slice(&[1, 0, 0, 0]);
    mvhd.extend_from_slice(&[0; 8]);
    mvhd.extend_from_slice(&words(&[
        0x0001_0000,
        0,
        0,
        0,
        0x0001_0000,
        0,
        0,
        0,
        0x4000_0000,
    ]));
    mvhd.extend_from_slice(&[0; 24]);
    mvhd.extend_from_slice(&words(&[99]));
    moov.extend(bx(b"mvhd", &full_body(0, 0, &mvhd)));
    let mut mvex = Vec::new();
    for t in tracks {
        let mut tkhd = words(&[0, 0, t.id, 0, 0]);
        tkhd.extend_from_slice(&[0; 8]);
        tkhd.extend_from_slice(&[0; 8]);
        tkhd.extend_from_slice(&words(&[
            0x0001_0000,
            0,
            0,
            0,
            0x0001_0000,
            0,
            0,
            0,
            0x4000_0000,
        ]));
        tkhd.extend_from_slice(&words(&[64 << 16, 64 << 16]));
        let tkhd = bx(b"tkhd", &full_body(0, 7, &tkhd));
        let mdhd = bx(
            b"mdhd",
            &full_body(0, 0, &words(&[0, 0, t.timescale, 0, 0x55c4_0000])),
        );
        let handler: &[u8; 4] = if t.video { b"vide" } else { b"soun" };
        let mut hb = words(&[0]);
        hb.extend_from_slice(handler);
        hb.extend_from_slice(&[0; 13]);
        let hdlr = bx(b"hdlr", &full_body(0, 0, &hb));
        let mh = if t.video {
            bx(b"vmhd", &full_body(0, 1, &[0; 8]))
        } else {
            bx(b"smhd", &full_body(0, 0, &[0; 4]))
        };
        let dref = bx(
            b"dref",
            &full_body(
                0,
                0,
                &[&words(&[1])[..], &bx(b"url ", &full_body(0, 1, &[]))].concat(),
            ),
        );
        let dinf = bx(b"dinf", &dref);
        let stsd = bx(b"stsd", &full_body(0, 0, &words(&[0])));
        let empty = |k: &[u8; 4]| bx(k, &full_body(0, 0, &words(&[0])));
        let stbl = bx(
            b"stbl",
            &[
                stsd,
                empty(b"stts"),
                empty(b"stsc"),
                bx(b"stsz", &full_body(0, 0, &words(&[0, 0]))),
                empty(b"stco"),
            ]
            .concat(),
        );
        let minf = bx(b"minf", &[mh, dinf, stbl].concat());
        let mdia = bx(b"mdia", &[mdhd, hdlr, minf].concat());
        moov.extend(bx(b"trak", &[tkhd, mdia].concat()));
        mvex.extend(bx(
            b"trex",
            &full_body(0, 0, &words(&[t.id, 1, t.trex.0, t.trex.1, t.trex.2])),
        ));
    }
    moov.extend(bx(b"mvex", &mvex));
    out.extend(bx(b"moov", &moov));
    out
}

/// 합성 trun.
#[derive(Clone)]
struct TrunDef {
    version: u8,
    /// 0x1(data_offset)은 `with_offset`로 정한다
    flags: u32,
    with_offset: bool,
    first_flags: Option<u32>,
    /// (dur, size, flags, cts): 플래그에 없는 필드는 무시된다
    samples: Vec<(u32, u32, u32, i32)>,
}

/// tfhd의 데이터 기준.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Base {
    /// default-base-is-moof
    Moof,
    /// base_data_offset(절대)
    Absolute,
    /// 둘 다 없음: 첫 traf는 moof 시작, 다음 traf는 앞 traf 데이터 끝
    Implicit,
}

#[derive(Clone)]
struct TrafDef {
    track: u32,
    /// tfhd 기본값 (sdi, dur, size, flags)
    defaults: (Option<u32>, Option<u32>, Option<u32>, Option<u32>),
    base: Base,
    tfdt: Option<u64>,
    truns: Vec<TrunDef>,
}

/// trun 샘플 크기들(플래그에 크기가 없으면 기본값).
fn trun_sizes(tr: &TrunDef, traf: &TrafDef, trex: &[TrackDef]) -> Vec<u32> {
    let def = traf
        .defaults
        .2
        .unwrap_or_else(|| trex.iter().find(|t| t.id == traf.track).unwrap().trex.1);
    tr.samples
        .iter()
        .map(|s| if tr.flags & TR_SIZE != 0 { s.1 } else { def })
        .collect()
}

/// moof + mdat 하나. `data_start`는 mdat 본문 시작(절대), 반환은 moof 바이트.
fn moof_bytes(moof_off: u64, data_start: u64, trafs: &[TrafDef], tracks: &[TrackDef]) -> Vec<u8> {
    let mut body = bx(b"mfhd", &full_body(0, 0, &words(&[1])));
    let mut cursor = data_start;
    for (ti, tf) in trafs.iter().enumerate() {
        let mut fl = 0u32;
        let mut tb = words(&[tf.track]);
        match tf.base {
            Base::Absolute => {
                fl |= TF_BASE_DATA_OFFSET;
                tb.extend_from_slice(&data_start.to_be_bytes());
            }
            Base::Moof => fl |= TF_DEFAULT_BASE_IS_MOOF,
            Base::Implicit => {}
        }
        for (bit, v) in [
            (TF_SDI, tf.defaults.0),
            (TF_DURATION, tf.defaults.1),
            (TF_SIZE, tf.defaults.2),
            (TF_FLAGS, tf.defaults.3),
        ] {
            if let Some(v) = v {
                fl |= bit;
                tb.extend_from_slice(&v.to_be_bytes());
            }
        }
        let mut traf = bx(b"tfhd", &full_body(0, fl, &tb));
        if let Some(t) = tf.tfdt {
            traf.extend(bx(b"tfdt", &full_body(1, 0, &t.to_be_bytes())));
        }
        let base = match tf.base {
            Base::Absolute => data_start,
            Base::Moof => moof_off,
            Base::Implicit if ti == 0 => moof_off,
            Base::Implicit => cursor,
        };
        for tr in &tf.truns {
            let mut fl = tr.flags;
            let mut rb = words(&[tr.samples.len() as u32]);
            if tr.with_offset {
                fl |= TR_DATA_OFFSET;
                rb.extend_from_slice(&(cursor.wrapping_sub(base) as i32).to_be_bytes());
            }
            if let Some(f) = tr.first_flags {
                fl |= TR_FIRST_FLAGS;
                rb.extend_from_slice(&f.to_be_bytes());
            }
            for s in &tr.samples {
                if fl & TR_DURATION != 0 {
                    rb.extend_from_slice(&s.0.to_be_bytes());
                }
                if fl & TR_SIZE != 0 {
                    rb.extend_from_slice(&s.1.to_be_bytes());
                }
                if fl & TR_FLAGS != 0 {
                    rb.extend_from_slice(&s.2.to_be_bytes());
                }
                if fl & TR_CTS != 0 {
                    rb.extend_from_slice(&s.3.to_be_bytes());
                }
            }
            traf.extend(bx(b"trun", &full_body(tr.version, fl, &rb)));
            cursor += trun_sizes(tr, tf, tracks)
                .iter()
                .map(|x| u64::from(*x))
                .sum::<u64>();
        }
        body.extend(bx(b"traf", &traf));
    }
    bx(b"moof", &body)
}

/// 조각 하나를 `out` 끝에 붙인다. `large`면 mdat을 64비트 largesize로 쓴다.
fn push_fragment(out: &mut Vec<u8>, trafs: &[TrafDef], tracks: &[TrackDef], large: bool) {
    let moof_off = out.len() as u64;
    let probe = moof_bytes(moof_off, 0, trafs, tracks);
    let mdat_hdr = if large { 16 } else { 8 };
    let data_start = moof_off + probe.len() as u64 + mdat_hdr;
    let moof = moof_bytes(moof_off, data_start, trafs, tracks);
    assert_eq!(moof.len(), probe.len());
    let total: u32 = trafs
        .iter()
        .flat_map(|tf| {
            tf.truns
                .iter()
                .flat_map(move |tr| trun_sizes(tr, tf, tracks))
        })
        .sum();
    out.extend(moof);
    let payload: Vec<u8> = (0..total).map(|i| (i % 251) as u8).collect();
    if large {
        out.extend(words(&[1]));
        out.extend_from_slice(b"mdat");
        out.extend((16 + u64::from(total)).to_be_bytes());
    } else {
        out.extend(words(&[8 + total]));
        out.extend_from_slice(b"mdat");
    }
    out.extend(payload);
}

const VIDEO: TrackDef = TrackDef {
    id: 1,
    timescale: 6000,
    video: true,
    trex: (100, 0, 0x0101_0000),
};
const AUDIO: TrackDef = TrackDef {
    id: 2,
    timescale: 48000,
    video: false,
    trex: (1024, 300, 0x0200_0000),
};

fn video_trun(n: u32, key_first: bool) -> TrunDef {
    TrunDef {
        version: 0,
        flags: TR_SIZE | TR_CTS,
        with_offset: true,
        first_flags: key_first.then_some(0x0200_0000),
        samples: (0..n)
            .map(|i| (0, 1000 + i, 0, 200 - (i as i32 % 3) * 100))
            .collect(),
    }
}

fn audio_trun(n: u32) -> TrunDef {
    TrunDef {
        version: 0,
        flags: 0,
        with_offset: true,
        first_flags: None,
        samples: vec![(0, 0, 0, 0); n as usize],
    }
}

fn traf(track: u32, tfdt: u64, truns: Vec<TrunDef>) -> TrafDef {
    TrafDef {
        track,
        defaults: (None, None, None, None),
        base: Base::Moof,
        tfdt: Some(tfdt),
        truns,
    }
}

// ---------------------------------------------------------------------------------------------
// fixture

#[test]
fn fixture_converts_to_equivalent_flat_mp4() {
    let (out, r) = convert(FIXTURE);
    let DefragReport::Converted {
        tracks,
        samples,
        discontinuities,
    } = r
    else {
        panic!("{r:?}")
    };
    assert_eq!(tracks, 2);
    assert_eq!(discontinuities, 0);
    let want = frag_samples(FIXTURE);
    assert_eq!(samples, want.iter().map(|t| t.1.len() as u64).sum::<u64>());
    // 3초 30fps 영상
    assert_eq!(want.iter().find(|t| t.0 == 1).unwrap().1.len(), 90);
    assert_equivalent(FIXTURE, &out);
    // fixture는 B 프레임(ctts)과 키프레임이 아닌 조각 시작(stss 일부)을 담는다
    let got = flat_samples(&out);
    let v = got.iter().find(|t| t.id == 1).unwrap();
    assert!(v.samples.iter().any(|s| s.cts != v.samples[0].cts));
    assert!(v.samples.iter().any(|s| !s.sync));
    // mfra(모르는 최상위 상자)도 free가 되었다
    assert!(top_boxes(FIXTURE).iter().any(|t| t.0 == "mfra"));
}

#[test]
fn second_run_is_already_flat_and_changes_nothing() {
    let (once, _) = convert(FIXTURE);
    let mut twice = once.clone();
    assert_eq!(
        defragment_bytes(&mut twice).unwrap(),
        DefragReport::AlreadyFlat
    );
    assert_eq!(once, twice);
}

#[test]
fn file_api_matches_byte_api_and_leaves_position_at_end() {
    let (want, _) = convert(FIXTURE);
    let mut f = tempfile::tempfile().unwrap();
    f.write_all(FIXTURE).unwrap();
    let r = defragment(&mut f).unwrap();
    assert!(matches!(r, DefragReport::Converted { .. }), "{r:?}");
    assert_eq!(f.stream_position().unwrap(), want.len() as u64);
    let mut got = Vec::new();
    f.seek(SeekFrom::Start(0)).unwrap();
    f.read_to_end(&mut got).unwrap();
    assert_eq!(got, want);
    assert_eq!(defragment(&mut f).unwrap(), DefragReport::AlreadyFlat);
}

#[test]
fn plan_bytes_reports_moov_and_patches() {
    let (moov, patches) = plan_bytes(FIXTURE).unwrap().unwrap();
    assert_eq!(&moov[4..8], b"moov");
    assert!(patches.windows(2).all(|w| w[0] < w[1]), "오름차순");
    for p in &patches {
        let t = &FIXTURE[*p as usize..*p as usize + 4];
        assert!([&b"moov"[..], b"moof", b"mfra"].contains(&t), "{t:?}");
    }
    let (out, _) = convert(FIXTURE);
    assert!(plan_bytes(&out).unwrap().is_none());
}

#[test]
fn truncated_file_is_left_untouched() {
    for cut in [1usize, 100, 2000] {
        let b = &FIXTURE[..FIXTURE.len() - cut];
        let mut f = tempfile::tempfile().unwrap();
        f.write_all(b).unwrap();
        let e = defragment(&mut f).unwrap_err();
        assert!(matches!(e, Error::Parse { .. }), "{e:?}");
        let mut got = Vec::new();
        f.seek(SeekFrom::Start(0)).unwrap();
        f.read_to_end(&mut got).unwrap();
        assert_eq!(got, b, "잘린 파일을 바꾸면 안 된다");
    }
}

#[test]
fn fake_segments_are_not_fragmented() {
    // tests/recording.rs의 가짜 바이트 모양: ftyp 하나 + styp 여러 개
    let mut b = bx(b"ftyp", b"initinit");
    for i in 0u64..3 {
        b.extend(bx(b"styp", &i.to_be_bytes()));
    }
    let before = b.clone();
    assert_eq!(
        defragment_bytes(&mut b).unwrap(),
        DefragReport::NotFragmented
    );
    assert_eq!(b, before);
    // 상자 구조가 아닌 바이트는 Parse
    let mut junk = b"not an mp4 at all".to_vec();
    assert!(matches!(
        defragment_bytes(&mut junk),
        Err(Error::Parse { .. })
    ));
}

#[test]
fn moof_without_init_or_with_unknown_track_is_rejected() {
    let tracks = [VIDEO];
    let mut b = bx(b"ftyp", b"iso6\0\0\0\0");
    push_fragment(
        &mut b,
        &[traf(1, 0, vec![video_trun(3, true)])],
        &tracks,
        false,
    );
    let before = b.clone();
    assert!(defragment_bytes(&mut b).is_err());
    assert_eq!(b, before);

    let mut b = init_bytes(1000, &tracks);
    push_fragment(
        &mut b,
        &[traf(7, 0, vec![video_trun(3, true)])],
        &[TrackDef { id: 7, ..VIDEO }],
        false,
    );
    let before = b.clone();
    assert!(defragment_bytes(&mut b).is_err());
    assert_eq!(b, before);
}

#[test]
fn sample_outside_mdat_is_rejected() {
    let tracks = [VIDEO];
    let mut b = init_bytes(1000, &tracks);
    push_fragment(
        &mut b,
        &[traf(1, 0, vec![video_trun(3, true)])],
        &tracks,
        false,
    );
    // 마지막 mdat 크기를 줄이고 꼬리를 자른다: 상자는 맞지만 샘플이 mdat 밖을 가리킨다
    let tops = top_boxes(&b);
    let (_, off, _, size) = tops.last().unwrap().clone();
    b.truncate(off + size - 10);
    b[off..off + 4].copy_from_slice(&((size - 10) as u32).to_be_bytes());
    let before = b.clone();
    let e = defragment_bytes(&mut b).unwrap_err();
    assert!(matches!(e, Error::Parse { .. }), "{e:?}");
    assert_eq!(b, before);
}

// ---------------------------------------------------------------------------------------------
// 합성 엣지

#[test]
fn unknown_boxes_multi_traf_multi_trun_and_largesize() {
    let tracks = [VIDEO, AUDIO];
    let mut b = init_bytes(1000, &tracks);
    b.extend(bx(b"styp", b"iso6\0\0\0\0"));
    // 한 moof에 traf 둘, 비디오 traf에 trun 둘(둘째는 data_offset 없이 앞 trun 뒤에 이어진다)
    let mut second = video_trun(4, false);
    second.with_offset = false;
    push_fragment(
        &mut b,
        &[
            traf(1, 0, vec![video_trun(5, true), second]),
            traf(2, 0, vec![audio_trun(6)]),
        ],
        &tracks,
        false,
    );
    b.extend(bx(b"emsg", &[0; 12]));
    b.extend(bx(b"zzzz", b"unknown"));
    // largesize mdat
    push_fragment(
        &mut b,
        &[
            traf(1, 900, vec![video_trun(3, true)]),
            traf(2, 6 * 1024, vec![audio_trun(4)]),
        ],
        &tracks,
        true,
    );
    let (out, r) = convert(&b);
    assert_eq!(
        r,
        DefragReport::Converted {
            tracks: 2,
            samples: 22,
            discontinuities: 0
        }
    );
    assert_equivalent(&b, &out);
    let got = flat_samples(&out);
    // 오디오는 크기가 모두 같아 stsz가 상수다(펼친 결과는 같다)
    assert!(got[1].samples.iter().all(|s| s.size == 300));
}

#[test]
fn defaults_split_between_tfhd_and_trex_and_absolute_base() {
    let tracks = [VIDEO, AUDIO];
    let mut b = init_bytes(1000, &tracks);
    // duration은 tfhd, size·flags는 trex(audio), base_data_offset 절대 주소
    let mut a = traf(2, 0, vec![audio_trun(5)]);
    a.defaults = (None, Some(960), None, None);
    a.base = Base::Absolute;
    // 비디오: tfhd에 flags·size 기본값, trun에는 duration만
    let mut v = traf(
        1,
        0,
        vec![TrunDef {
            version: 0,
            flags: TR_DURATION,
            with_offset: true,
            first_flags: Some(0x0200_0000),
            samples: vec![(100, 0, 0, 0), (100, 0, 0, 0), (200, 0, 0, 0)],
        }],
    );
    v.defaults = (Some(1), None, Some(777), Some(0x0101_0000));
    push_fragment(&mut b, &[v, a], &tracks, false);
    let (out, _) = convert(&b);
    assert_equivalent(&b, &out);
    let got = flat_samples(&out);
    let v = got.iter().find(|t| t.id == 1).unwrap();
    assert_eq!(
        v.samples
            .iter()
            .map(|s| (s.dur, s.size, s.sync))
            .collect::<Vec<_>>(),
        [(100, 777, true), (100, 777, false), (200, 777, false)]
    );
    let a = got.iter().find(|t| t.id == 2).unwrap();
    assert!(
        a.samples
            .iter()
            .all(|s| s.dur == 960 && s.size == 300 && s.sync)
    );
}

#[test]
fn version1_trun_negative_cts_is_shifted_and_edit_list_points_at_first_frame() {
    let tracks = [VIDEO];
    let mut b = init_bytes(1000, &tracks);
    let tr = TrunDef {
        version: 1,
        flags: TR_SIZE | TR_CTS,
        with_offset: true,
        first_flags: Some(0x0200_0000),
        // 표시 순서: 0(-100+100=0) 2(100-100... ) 처럼 음수 오프셋
        samples: vec![
            (0, 10, 0, -100),
            (0, 11, 0, 100),
            (0, 12, 0, -100),
            (0, 13, 0, -100),
        ],
    };
    push_fragment(&mut b, &[traf(1, 0, vec![tr])], &tracks, false);
    let (out, _) = convert(&b);
    assert_equivalent(&b, &out);
    let got = flat_samples(&out);
    // 가장 작은 cts(-100)가 0이 되도록 100을 더했고, 첫 표시(dts 0 + cts -100 = -100)는 media_time 0이다
    assert_eq!(
        got[0].samples.iter().map(|s| s.cts).collect::<Vec<_>>(),
        [0, 200, 0, 0]
    );
    assert_eq!(got[0].elst, [(400 * 1000 / 6000, 0)]);
}

#[test]
fn later_track_gets_empty_edit_for_start_difference() {
    let tracks = [VIDEO, AUDIO];
    let mut b = init_bytes(1000, &tracks);
    // 방송 기준의 큰 tfdt. 비디오는 오디오보다 22ms 늦게 시작한다(cts 0)
    let audio_start = 1_127_000_000u64; // 48000 기준
    let video_start = audio_start / 8 + 132; // 6000 기준(+22ms)
    let mut v = video_trun(6, true);
    v.samples.iter_mut().for_each(|s| s.3 = 0);
    push_fragment(
        &mut b,
        &[
            traf(1, video_start, vec![v]),
            traf(2, audio_start, vec![audio_trun(10)]),
        ],
        &tracks,
        false,
    );
    let (out, _) = convert(&b);
    assert_equivalent(&b, &out);
    let got = flat_samples(&out);
    let v = got.iter().find(|t| t.id == 1).unwrap();
    let a = got.iter().find(|t| t.id == 2).unwrap();
    assert_eq!(v.elst, [(22, -1), (100, 0)]);
    assert_eq!(a.elst, [(213, 0)]); // 10 × 1024 / 48000 = 213.3ms
    assert_eq!(v.tkhd_dur, 122);
    // mvhd duration은 가장 긴 트랙(지연 포함)
    let moov_at = top_boxes(&out).last().unwrap().1;
    let mvhd = &out[moov_at + 8..];
    assert_eq!(&mvhd[4..8], b"mvhd");
    assert_eq!(be32(&mvhd[8 + 4 + 12..]), 213);
}

#[test]
fn tfdt_gap_is_counted_and_timeline_is_pulled_together() {
    let tracks = [VIDEO];
    let mut b = init_bytes(1000, &tracks);
    push_fragment(
        &mut b,
        &[traf(1, 0, vec![video_trun(3, true)])],
        &tracks,
        false,
    );
    // 2초(12000틱)를 놓쳤다
    push_fragment(
        &mut b,
        &[traf(1, 300 + 12000, vec![video_trun(3, true)])],
        &tracks,
        false,
    );
    // ±1틱 흔들림은 구멍이 아니다
    push_fragment(
        &mut b,
        &[traf(1, 600 + 12000 + 1, vec![video_trun(3, true)])],
        &tracks,
        false,
    );
    let (out, r) = convert(&b);
    assert_eq!(
        r,
        DefragReport::Converted {
            tracks: 1,
            samples: 9,
            discontinuities: 1
        }
    );
    let got = flat_samples(&out);
    assert_eq!(got[0].mdhd_dur, 900, "구멍은 당겨 붙인다");
}

#[test]
fn crash_during_patches_then_resume_truncation_reconverts_identically() {
    let (clean, _) = convert(FIXTURE);
    let (moov, patches) = plan_bytes(FIXTURE).unwrap().unwrap();
    for done in 0..=patches.len() {
        // 2단계(끝에 moov)와 3단계 일부가 디스크에 남은 뒤 죽었다
        let mut b = FIXTURE.to_vec();
        b.extend_from_slice(&moov);
        for p in &patches[..done] {
            b[*p as usize..*p as usize + 4].copy_from_slice(b"free");
        }
        // 다음 실행의 PartFile::resume은 committed_len(원래 길이)으로 꼬리를 자른다
        b.truncate(FIXTURE.len());
        let r = defragment_bytes(&mut b).unwrap();
        assert!(matches!(r, DefragReport::Converted { .. }), "{done}: {r:?}");
        assert_eq!(b, clean, "패치 {done}개 뒤 크래시");
    }
}

#[test]
fn version0_duration_overflow_upgrades_to_version1() {
    let body = full_body(0, 0, &words(&[1, 2, 48000, 5, 0x55c4_0000]));
    let mdhd = bx(b"mdhd", &body);
    let out = with_duration(&mdhd, 1 << 33).unwrap();
    let c = children(&out).unwrap()[0];
    assert_eq!(c.body[0], 1);
    assert_eq!(be64(&c.body[4..]), 1);
    assert_eq!(be64(&c.body[12..]), 2);
    assert_eq!(be32(&c.body[20..]), 48000);
    assert_eq!(be64(&c.body[24..]), 1 << 33);
    assert_eq!(be32(&c.body[32..]), 0x55c4_0000);
    // 맞으면 version 0 그대로
    let out = with_duration(&mdhd, 77).unwrap();
    assert_eq!(out.len(), mdhd.len());
    assert_eq!(be32(&out[8 + 16..]), 77);
}

#[test]
fn implicit_base_uses_previous_traf_end() {
    let tracks = [VIDEO, AUDIO];
    let mut b = init_bytes(1000, &tracks);
    let mut v = traf(1, 0, vec![video_trun(4, true)]);
    v.base = Base::Implicit;
    let mut a = traf(2, 0, vec![audio_trun(3)]);
    a.base = Base::Implicit;
    push_fragment(&mut b, &[v, a], &tracks, false);
    let (out, _) = convert(&b);
    assert_equivalent(&b, &out);
    let got = flat_samples(&out);
    let v_end = got[0]
        .samples
        .last()
        .map(|s| s.off + u64::from(s.size))
        .unwrap();
    assert_eq!(
        got[1].samples[0].off, v_end,
        "둘째 traf는 앞 traf 데이터 뒤에서 시작"
    );
}

// ---------------------------------------------------------------------------------------------
// 독립 검증 지적 회귀

#[test]
fn trailing_size0_box_is_rejected_not_swallowing_moov() {
    // 끝 상자의 size가 0(파일 끝까지)이면 붙인 moov를 삼키므로 변환하지 않는다.
    let tracks = [VIDEO, AUDIO];
    let mut b = init_bytes(1000, &tracks);
    push_fragment(
        &mut b,
        &[traf(1, 0, vec![video_trun(3, true)])],
        &tracks,
        false,
    );
    let mut tail = vec![0, 0, 0, 0];
    tail.extend_from_slice(b"emsg");
    tail.extend_from_slice(&[0; 12]);
    b.extend(tail);
    let before = b.clone();
    assert!(defragment_bytes(&mut b).is_err());
    assert_eq!(b, before);

    // 마지막 mdat의 size를 0으로 바꾼 경우도 같다
    let mut b = init_bytes(1000, &tracks);
    push_fragment(
        &mut b,
        &[traf(1, 0, vec![video_trun(3, true)])],
        &tracks,
        false,
    );
    let (_, off, _, _) = top_boxes(&b).last().unwrap().clone();
    b[off..off + 4].copy_from_slice(&[0; 4]);
    let before = b.clone();
    assert!(defragment_bytes(&mut b).is_err());
    assert_eq!(b, before);
}

#[test]
fn huge_sample_count_without_per_sample_fields_is_bounded() {
    let tracks = [VIDEO];
    let mut b = init_bytes(1000, &tracks);
    let tf = TrafDef {
        track: 1,
        defaults: (None, Some(1), Some(0), Some(0)),
        base: Base::Moof,
        tfdt: Some(0),
        truns: vec![TrunDef {
            version: 0,
            flags: 0,
            with_offset: true,
            first_flags: None,
            samples: vec![(0, 0, 0, 0)],
        }],
    };
    push_fragment(&mut b, &[tf], &tracks, false);
    let p = b.windows(4).position(|w| w == b"trun").unwrap();
    // trun 종류 4바이트 + version/flags 4바이트 뒤가 sample_count
    b[p + 8..p + 12].copy_from_slice(&20_000_000u32.to_be_bytes());
    let before = b.clone();
    let e = defragment_bytes(&mut b).unwrap_err();
    assert!(matches!(e, Error::Parse { .. }), "{e:?}");
    assert_eq!(b, before);
}
