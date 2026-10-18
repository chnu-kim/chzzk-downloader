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

// ---------------------------------------------------------------------------------------------
// 파일 조작 실패(core.md 61 M4): 파일을 바꿨는지로 `Unchanged`·`Modified`를 가른다

enum Fault {
    /// 끝에 붙이는 쓰기가 실패하고 자르기는 된다
    Append,
    /// 붙이기도 자르기도 실패한다
    AppendAndTruncate,
    /// `after`번 패치를 쓴 뒤 다음 패치가 실패한다
    Patch { after: usize },
    /// 첫 읽기 한 번이 입출력 오류(EIO 같은, 파일 끝이 아닌 오류)로 실패한다. 그 뒤 읽기·쓰기·sync는 된다
    ReadOnce,
}

struct FaultyFile {
    c: io::Cursor<Vec<u8>>,
    base: u64,
    fault: Fault,
    patches: usize,
    reads: usize,
}

impl FaultyFile {
    fn new(fault: Fault) -> Self {
        FaultyFile {
            c: io::Cursor::new(FIXTURE.to_vec()),
            base: FIXTURE.len() as u64,
            fault,
            patches: 0,
            reads: 0,
        }
    }
}

impl Read for FaultyFile {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.reads += 1;
        if matches!(self.fault, Fault::ReadOnce) && self.reads == 1 {
            return Err(io::Error::other("읽기 오류 주입"));
        }
        self.c.read(buf)
    }
}
impl Seek for FaultyFile {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        self.c.seek(pos)
    }
}
impl Write for FaultyFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.c.position() >= self.base {
            if matches!(self.fault, Fault::Append | Fault::AppendAndTruncate) {
                return Err(io::Error::from(io::ErrorKind::FileTooLarge));
            }
        } else {
            if let Fault::Patch { after } = self.fault
                && self.patches >= after
            {
                return Err(io::Error::from(io::ErrorKind::FileTooLarge));
            }
            self.patches += 1;
        }
        self.c.write(buf)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl DefragFile for FaultyFile {
    fn file_len(&mut self) -> io::Result<u64> {
        Ok(self.c.get_ref().len() as u64)
    }
    fn truncate_to(&mut self, len: u64) -> io::Result<()> {
        if matches!(self.fault, Fault::AppendAndTruncate) {
            return Err(io::Error::other("자르기 실패"));
        }
        self.c.get_mut().truncate(len as usize);
        Ok(())
    }
    fn sync(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// 붙이기가 실패해도 잘라 되돌렸으면 파일은 원래 그대로다(마무리해도 된다).
#[test]
fn append_failure_restored_is_unchanged() {
    let mut f = FaultyFile::new(Fault::Append);
    let r = defragment_in(&mut f, None);
    assert!(matches!(r, Err(DefragError::Unchanged(_))), "{r:?}");
    assert_eq!(f.c.get_ref().as_slice(), FIXTURE);
}

/// 되돌리기마저 실패하면 파일이 바뀌었을 수 있다.
#[test]
fn append_failure_not_restored_is_modified() {
    let mut f = FaultyFile::new(Fault::AppendAndTruncate);
    let r = defragment_in(&mut f, None);
    assert!(matches!(r, Err(DefragError::Modified(_))), "{r:?}");
}

/// 패치 도중 실패한 파일은 최종 파일로 옮기지 않는다. 다음 실행이 원래 길이로 자르고 같은 결과로 다시 변환한다.
#[test]
fn patch_failure_is_modified_and_reconverts_after_truncate() {
    let (clean, _) = convert(FIXTURE);
    let mut f = FaultyFile::new(Fault::Patch { after: 1 });
    let r = defragment_in(&mut f, None);
    assert!(matches!(r, Err(DefragError::Modified(_))), "{r:?}");
    let mut b = f.c.into_inner();
    assert!(b.len() > FIXTURE.len(), "붙인 moov가 남았다");
    b.truncate(FIXTURE.len());
    let r = defragment_bytes(&mut b).unwrap();
    assert!(matches!(r, DefragReport::Converted { .. }), "{r:?}");
    assert_eq!(b, clean);
}

/// `bytes`에서 시작하는 실패 주입 파일.
fn faulty_on(bytes: Vec<u8>, fault: Fault) -> FaultyFile {
    let mut f = FaultyFile::new(fault);
    f.base = bytes.len() as u64;
    f.c = io::Cursor::new(bytes);
    f
}

/// 앞선 시도가 init `moov`를 `free`로 바꾼 채 `.part`로 남았고, 다음 시도의 붙이기마저 실패해 잘라 되돌렸다.
/// 파일은 이번 시도 전 상태지만 진짜 `moov`가 없어 재생할 수 없으니 `Unchanged`(마무리해도 된다)가 아니다(core.md 61 M4).
#[test]
fn append_failure_after_earlier_patch_is_not_unchanged() {
    let (clean, _) = convert(FIXTURE);
    let mut first = FaultyFile::new(Fault::Patch { after: 1 });
    let r = defragment_in(&mut first, None);
    assert!(matches!(r, Err(DefragError::Modified(_))), "{r:?}");
    let mut b = first.c.into_inner();
    b.truncate(FIXTURE.len());
    let moov = kind_pos(FIXTURE, b"moov");
    assert_eq!(
        &b[moov..moov + 4],
        b"free",
        "init moov가 free로 바뀐 상태여야 한다"
    );

    let mut second = faulty_on(b, Fault::Append);
    let r = defragment_in(&mut second, None);
    assert!(matches!(r, Err(DefragError::Modified(_))), "{r:?}");
    // 그래도 다음 시도는 같은 결과로 변환한다
    let mut b = second.c.into_inner();
    assert_eq!(b.len(), FIXTURE.len(), "붙인 것은 되돌렸다");
    let r = defragment_bytes(&mut b).unwrap();
    assert!(matches!(r, DefragReport::Converted { .. }), "{r:?}");
    assert_eq!(b, clean);
}

/// 대조: 앞선 시도가 아무 패치도 남기지 않았으면 붙이기 실패는 여전히 `Unchanged`다.
#[test]
fn append_failure_after_patchless_attempt_is_unchanged() {
    let mut first = FaultyFile::new(Fault::Patch { after: 0 });
    let r = defragment_in(&mut first, None);
    assert!(matches!(r, Err(DefragError::Modified(_))), "{r:?}");
    let mut b = first.c.into_inner();
    b.truncate(FIXTURE.len());
    assert_eq!(b, FIXTURE);
    let mut second = faulty_on(b, Fault::Append);
    let r = defragment_in(&mut second, None);
    assert!(matches!(r, Err(DefragError::Unchanged(_))), "{r:?}");
}

/// Codex PR #113 2회차 ②: 앞선 시도가 init `moov`를 `free`로 바꾼 채 `.part`로 남았고, 다음 시도의 계획 단계에서 읽기가
/// 입출력 오류로 실패했다. 파일이 원래 조각 구조인지 확인하지 못했으니 `Unchanged`(조각 구조로 마무리)가 아니다.
/// 마무리 판정도 `Err`라 `finish`는 `Completed`로 끝내지 않고 `.part`·sidecar를 남긴다(`defrag_verdict`).
#[test]
fn plan_read_error_after_earlier_patch_is_not_unchanged() {
    let (clean, _) = convert(FIXTURE);
    let mut first = FaultyFile::new(Fault::Patch { after: 1 });
    let r = defragment_in(&mut first, None);
    assert!(matches!(r, Err(DefragError::Modified(_))), "{r:?}");
    let mut b = first.c.into_inner();
    b.truncate(FIXTURE.len());
    let moov = kind_pos(FIXTURE, b"moov");
    assert_eq!(&b[moov..moov + 4], b"free");
    let before = b.clone();

    let mut second = faulty_on(b, Fault::ReadOnce);
    let r = defragment_in(&mut second, None);
    assert!(
        matches!(r, Err(DefragError::Modified(Error::Io { .. }))),
        "{r:?}"
    );
    assert_eq!(second.c.get_ref(), &before, "아무것도 쓰지 않았다");
    // 마무리하지 않고, 그 오류는 이어받을 수 있어 정리(`cleanup(keep = is_resumable)`)가 `.part`·sidecar를 남긴다
    let e = crate::download::defrag_verdict(Ok(r)).unwrap_err();
    assert!(e.is_resumable(), "{e:?}");
    // 다음 시도는 같은 결과로 변환한다
    let mut b = second.c.into_inner();
    let r = defragment_bytes(&mut b).unwrap();
    assert!(matches!(r, DefragReport::Converted { .. }), "{r:?}");
    assert_eq!(b, clean);
}

/// 계획 단계의 읽기 입출력 오류는 앞선 패치가 없어도 `Unchanged`가 아니다(무엇을 읽었는지 모른다). 구조 판정
/// (잘린 파일·가짜 바이트)은 아래 `plan_failure_is_unchanged`처럼 그대로 `Unchanged`다.
#[test]
fn plan_read_error_is_not_unchanged() {
    let mut f = FaultyFile::new(Fault::ReadOnce);
    let r = defragment_in(&mut f, None);
    assert!(
        matches!(r, Err(DefragError::Modified(Error::Io { .. }))),
        "{r:?}"
    );
    assert_eq!(f.c.get_ref().as_slice(), FIXTURE);
}

/// 구조를 읽지 못하면 아무것도 쓰기 전이라 `Unchanged`다.
#[test]
fn plan_failure_is_unchanged() {
    let mut f = FaultyFile::new(Fault::Append);
    f.c = io::Cursor::new(FIXTURE[..FIXTURE.len() - 5].to_vec());
    f.base = f.c.get_ref().len() as u64;
    let r = defragment_in(&mut f, None);
    assert!(
        matches!(r, Err(DefragError::Unchanged(Error::Parse { .. }))),
        "{r:?}"
    );
    assert_eq!(f.c.get_ref().len(), FIXTURE.len() - 5);
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

// ---------------------------------------------------------------------------------------------
// 잘못된 입력 방어 분기

/// 종류 4바이트가 처음 나오는 위치(상자 시작 + 4).
fn kind_pos(b: &[u8], kind: &[u8; 4]) -> usize {
    b.windows(4)
        .position(|w| w == kind)
        .unwrap_or_else(|| panic!("{} 없음", String::from_utf8_lossy(kind)))
}

/// 상자 하나(처음 나오는 `kind`)의 본문을 `f`로 바꾸고, 그 상자를 품은 상위 상자(`moof`·`traf`·`moov` 등)의 크기도 맞춘다.
fn edit_box(b: &mut Vec<u8>, kind: &[u8; 4], f: impl FnOnce(&mut Vec<u8>)) {
    let start = kind_pos(b, kind) - 4;
    let size = be32(&b[start..]) as usize;
    let mut body = b[start + 8..start + size].to_vec();
    f(&mut body);
    let delta = body.len() as i64 - (size as i64 - 8);
    // 수정 전 바이트로 상위 상자를 찾는다(앞쪽 위치는 바뀌지 않는다).
    let mut parents = Vec::new();
    for q in 4..b.len().saturating_sub(3) {
        let is_container = [
            b"moof", b"traf", b"moov", b"trak", b"mdia", b"minf", b"stbl", b"mvex",
        ]
        .iter()
        .any(|k| &b[q..q + 4] == *k);
        if is_container && q - 4 < start {
            let ps = q - 4;
            if start < ps + be32(&b[ps..]) as usize {
                parents.push(ps);
            }
        }
    }
    let mut new = Vec::new();
    new.extend_from_slice(&((body.len() + 8) as u32).to_be_bytes());
    new.extend_from_slice(kind);
    new.extend_from_slice(&body);
    b.splice(start..start + size, new);
    for ps in parents {
        let s = (be32(&b[ps..]) as i64 + delta) as u32;
        b[ps..ps + 4].copy_from_slice(&s.to_be_bytes());
    }
}

fn rename_kind(b: &mut [u8], from: &[u8; 4], to: &[u8; 4]) {
    let p = kind_pos(b, from);
    b[p..p + 4].copy_from_slice(to);
}

fn with_fragment(mut b: Vec<u8>) -> Vec<u8> {
    push_fragment(
        &mut b,
        &[traf(1, 0, vec![video_trun(3, true)])],
        &[VIDEO],
        false,
    );
    b
}

/// 올바른 합성 파일(비디오 트랙 하나, 샘플 셋).
fn good() -> Vec<u8> {
    with_fragment(init_bytes(1000, &[VIDEO]))
}

/// 변환이 `Error::Parse`로 거절하고 바이트를 바꾸지 않으며 설명에 `needle`이 있어야 한다.
fn assert_rejected(name: &str, b: Vec<u8>, needle: &str) {
    let before = b.clone();
    let mut work = b;
    match defragment_bytes(&mut work) {
        Err(Error::Parse { detail, .. }) => {
            assert!(
                detail.contains(needle),
                "{name}: 설명에 {needle:?}이 없다: {detail:?}"
            );
        }
        other => panic!("{name}: Parse 오류여야 한다: {other:?}"),
    }
    assert_eq!(work, before, "{name}: 거절한 입력을 바꾸면 안 된다");
    // 계획 단계(순수 함수)도 같은 이유로 거절한다.
    assert!(
        matches!(plan_bytes(&before), Err(Error::Parse { .. })),
        "{name}"
    );
}

#[test]
fn valid_synthetic_input_converts_as_control() {
    let (out, r) = convert(&good());
    assert_eq!(
        r,
        DefragReport::Converted {
            tracks: 1,
            samples: 3,
            discontinuities: 0
        }
    );
    assert!(plan_bytes(&out).unwrap().is_none());
}

#[test]
fn malformed_top_level_boxes_are_rejected() {
    let tail = |extra: &[u8]| {
        let mut b = good();
        b.extend_from_slice(extra);
        b
    };
    let mut large_small = vec![0, 0, 0, 1];
    large_small.extend_from_slice(b"free");
    large_small.extend_from_slice(&8u64.to_be_bytes());
    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        ("끝 헤더 잘림", tail(&[0, 0, 0, 0]), "끝 상자 헤더가 잘렸다"),
        (
            "largesize 헤더 잘림",
            tail(&[0, 0, 0, 1, b'f', b'r', b'e', b'e']),
            "largesize 헤더가 잘렸다",
        ),
        (
            "크기가 헤더보다 작음",
            tail(&[0, 0, 0, 4, b'f', b'r', b'e', b'e']),
            "상자 크기가 헤더보다 작다",
        ),
        (
            "largesize가 헤더보다 작음",
            tail(&large_small),
            "상자 크기가 헤더보다 작다",
        ),
        (
            "파일 끝을 넘음",
            tail(&[0, 0, 0, 99, b'f', b'r', b'e', b'e']),
            "파일 끝을 넘는다",
        ),
    ];
    for (name, b, needle) in cases {
        assert_rejected(name, b, needle);
    }
}

#[test]
fn malformed_init_is_rejected() {
    let append = |extra: &[u8]| {
        let mut init = init_bytes(1000, &[VIDEO]);
        edit_box(&mut init, b"moov", |b| b.extend_from_slice(extra));
        with_fragment(init)
    };
    let patched = |kind: &'static [u8; 4], f: fn(&mut Vec<u8>)| {
        let mut init = init_bytes(1000, &[VIDEO]);
        edit_box(&mut init, kind, f);
        with_fragment(init)
    };
    let mut no_mvhd = bx(b"ftyp", b"iso6\0\0\0\0");
    no_mvhd.extend(bx(b"moov", &bx(b"mvex", &[])));
    let no_mvhd = with_fragment(no_mvhd);
    let mut huge_large = vec![0, 0, 0, 1];
    huge_large.extend_from_slice(b"free");
    huge_large.extend_from_slice(&(1u64 << 40).to_be_bytes());
    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        ("mvhd 없음", no_mvhd, "moov에 mvhd이 없다"),
        (
            "mvhd timescale 0",
            patched(b"mvhd", |b| b[12..16].fill(0)),
            "mvhd timescale이 0이다",
        ),
        (
            "mdhd timescale 0",
            patched(b"mdhd", |b| b[12..16].fill(0)),
            "mdhd timescale이 0이다",
        ),
        (
            "트랙 없음",
            with_fragment(init_bytes(1000, &[])),
            "init에 트랙이 없다",
        ),
        (
            "트랙 ID 중복",
            with_fragment(init_bytes(1000, &[VIDEO, VIDEO])),
            "두 번 있다",
        ),
        (
            "tkhd version 1인데 ID가 다른 자리",
            patched(b"tkhd", |b| b[0] = 1),
            "trex가 없다",
        ),
        ("자식 헤더 잘림", append(&[0; 4]), "자식 상자 헤더가 잘렸다"),
        (
            "자식 largesize 헤더 잘림",
            append(&[0, 0, 0, 1, b'f', b'r', b'e', b'e']),
            "자식 largesize 헤더가 잘렸다",
        ),
        (
            "자식 크기가 본문보다 큼",
            append(&[0, 0, 0, 99, b'f', b'r', b'e', b'e']),
            "크기가 맞지 않다",
        ),
        (
            "자식 크기가 헤더보다 작음",
            append(&[0, 0, 0, 4, b'f', b'r', b'e', b'e']),
            "크기가 맞지 않다",
        ),
        (
            "자식 largesize가 본문보다 큼",
            append(&huge_large),
            "크기가 맞지 않다",
        ),
    ];
    for (name, b, needle) in cases {
        assert_rejected(name, b, needle);
    }
}

#[test]
fn child_boxes_with_size_zero_or_largesize_are_accepted() {
    // 자식 size 0(상위 끝까지)과 64비트 largesize는 올바른 입력이다.
    let mut large = vec![0, 0, 0, 1];
    large.extend_from_slice(b"free");
    large.extend_from_slice(&19u64.to_be_bytes());
    large.extend_from_slice(&[1, 2, 3]);
    let mut zero = vec![0, 0, 0, 0];
    zero.extend_from_slice(b"free");
    zero.extend_from_slice(&[1, 2, 3]);
    for extra in [large, zero] {
        let mut init = init_bytes(1000, &[VIDEO]);
        edit_box(&mut init, b"moov", |b| b.extend_from_slice(&extra));
        let (_, r) = convert(&with_fragment(init));
        assert!(matches!(r, DefragReport::Converted { samples: 3, .. }));
    }
}

#[test]
fn malformed_fragments_are_rejected() {
    let patched = |kind: &'static [u8; 4], f: fn(&mut Vec<u8>)| {
        let mut b = good();
        edit_box(&mut b, kind, f);
        b
    };
    let mut no_tfhd = good();
    rename_kind(&mut no_tfhd, b"tfhd", b"free");
    let empty = with_fragment_of(vec![video_trun(0, false)]);
    let cases: Vec<(&str, Vec<u8>, &str)> = vec![
        (
            "암호화된 조각",
            patched(b"traf", |b| b.extend(bx(b"senc", &[0; 8]))),
            "암호화된 조각이다",
        ),
        ("tfhd 없음", no_tfhd, "traf에 tfhd이 없다"),
        (
            "tfhd 본문이 짧음",
            patched(b"tfhd", |b| b.truncate(4)),
            "상자 본문이 짧다",
        ),
        (
            "tfhd base_data_offset 없음",
            patched(b"tfhd", |b| b[3] |= 0x1),
            "상자 본문이 짧다",
        ),
        (
            "tfhd 기본 필드 없음",
            patched(b"tfhd", |b| b[3] |= 0x2),
            "상자 본문이 짧다",
        ),
        (
            "tfdt version 1이 짧음",
            patched(b"tfdt", |b| *b = vec![1, 0, 0, 0, 0, 0, 0, 0]),
            "상자 본문이 짧다",
        ),
        (
            "tfdt version 0이 짧음",
            patched(b"tfdt", |b| *b = vec![0, 0, 0, 0]),
            "상자 본문이 짧다",
        ),
        (
            "trun 샘플 수 없음",
            patched(b"trun", |b| b.truncate(4)),
            "상자 본문이 짧다",
        ),
        (
            "trun data_offset 없음",
            patched(b"trun", |b| b.truncate(8)),
            "상자 본문이 짧다",
        ),
        (
            "trun first_sample_flags 없음",
            patched(b"trun", |b| b.truncate(12)),
            "상자 본문이 짧다",
        ),
        (
            "trun 샘플 수가 본문보다 많음",
            patched(b"trun", |b| b[4..8].copy_from_slice(&1000u32.to_be_bytes())),
            "trun 샘플 수가 본문보다 많다",
        ),
        ("샘플이 하나도 없음", empty, "샘플이 하나도 없다"),
    ];
    for (name, b, needle) in cases {
        assert_rejected(name, b, needle);
    }
}

/// 비디오 trun들만 담은 조각 하나가 붙은 합성 파일.
fn with_fragment_of(truns: Vec<TrunDef>) -> Vec<u8> {
    let mut b = init_bytes(1000, &[VIDEO]);
    push_fragment(&mut b, &[traf(1, 0, truns)], &[VIDEO], false);
    b
}

#[test]
fn short_duration_slots_are_rejected() {
    // mvhd 본문이 timescale까지만 있으면 duration을 쓸 자리가 없다(version 0·1 모두).
    let mut v0 = init_bytes(1000, &[VIDEO]);
    edit_box(&mut v0, b"mvhd", |b| b.truncate(16));
    let mut v1 = init_bytes(1000, &[VIDEO]);
    edit_box(&mut v1, b"mvhd", |b| {
        *b = [&[1, 0, 0, 0][..], &[0; 16], &1000u32.to_be_bytes(), &[0; 4]].concat();
    });
    for (name, init) in [("version 0", v0), ("version 1", v1)] {
        assert_rejected(name, with_fragment(init), "duration 자리가 없다");
    }
}

#[test]
fn version1_headers_get_their_durations_rewritten() {
    let mut init = init_bytes(1000, &[VIDEO]);
    let zeros = |n: usize| vec![0u8; n];
    edit_box(&mut init, b"mvhd", |b| {
        *b = [
            &[1, 0, 0, 0][..],
            &zeros(16),
            &1000u32.to_be_bytes(),
            &zeros(8),
            &zeros(80),
        ]
        .concat();
    });
    edit_box(&mut init, b"tkhd", |b| {
        *b = [
            &[1, 0, 0, 7][..],
            &zeros(16),
            &1u32.to_be_bytes(),
            &zeros(4),
            &zeros(8),
            &zeros(60),
        ]
        .concat();
    });
    edit_box(&mut init, b"mdhd", |b| {
        *b = [
            &[1, 0, 0, 0][..],
            &zeros(16),
            &6000u32.to_be_bytes(),
            &zeros(8),
            &zeros(4),
        ]
        .concat();
    });
    let (out, r) = convert(&with_fragment(init));
    assert!(matches!(r, DefragReport::Converted { samples: 3, .. }));
    // 샘플 셋 x 기본 길이 100(트랙 timescale 6000) = 300틱 = 영상 시간 50
    let tops = top_boxes(&out);
    let (_, off, hdr, size) = tops.iter().rfind(|t| t.0 == "moov").unwrap().clone();
    let moov = kids(&out[off + hdr..off + size]);
    let mvhd = get(&moov, b"mvhd");
    assert_eq!(be64(&mvhd.body[24..]), 50);
    let trak = kids(get(&moov, b"trak").body);
    assert_eq!(be64(&get(&trak, b"tkhd").body[28..]), 50);
    let mdia = kids(get(&trak, b"mdia").body);
    assert_eq!(be64(&get(&mdia, b"mdhd").body[24..]), 300);
}

#[test]
fn fragment_without_tfdt_after_a_first_one_is_accepted() {
    let mut b = init_bytes(1000, &[VIDEO]);
    push_fragment(
        &mut b,
        &[traf(1, 0, vec![video_trun(3, true)])],
        &[VIDEO],
        false,
    );
    let mut second = traf(1, 0, vec![video_trun(2, true)]);
    second.tfdt = None;
    push_fragment(&mut b, &[second], &[VIDEO], false);
    let (_, r) = convert(&b);
    assert_eq!(
        r,
        DefragReport::Converted {
            tracks: 1,
            samples: 5,
            discontinuities: 0
        }
    );
}

#[test]
fn read_failures_map_to_parse_or_io_errors() {
    // 읽다가 파일 끝: 구조 문제(Parse), 그 밖의 입출력 오류는 Io
    let e = Fail::Io(io::ErrorKind::UnexpectedEof.into()).into_error();
    assert!(
        matches!(&e, Error::Parse { detail, .. } if detail.contains("예상보다 짧다")),
        "{e:?}"
    );
    let e = Fail::Io(io::ErrorKind::PermissionDenied.into()).into_error();
    assert!(matches!(e, Error::Io { op: "read", .. }), "{e:?}");
    // 본문까지 읽는 상자의 크기 상한
    let e = read_vec(&mut SliceSrc(&[]), 0, MAX_META_BOX + 1).unwrap_err();
    assert!(
        matches!(&e, Fail::Bad(d) if d.contains("너무 크다")),
        "{e:?}"
    );
}

#[test]
fn append_failure_restores_length_and_reports_io() {
    // 읽기 전용으로 연 파일: 계획은 세워지지만 새 moov를 붙이는 쓰기가 실패한다.
    let b = good();
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    tmp.write_all(&b).unwrap();
    tmp.flush().unwrap();
    let mut ro = std::fs::File::open(tmp.path()).unwrap();
    let e = defragment(&mut ro).unwrap_err();
    assert!(matches!(e, Error::Io { op: "write", .. }), "{e:?}");
    assert_eq!(
        std::fs::read(tmp.path()).unwrap(),
        b,
        "파일이 그대로여야 한다"
    );
}

/// 읽기마다 실패하는 원본(길이만 있다).
struct FailingSrc;

impl Source for FailingSrc {
    fn len(&self) -> u64 {
        100
    }
    fn read_at(&mut self, _off: u64, _buf: &mut [u8]) -> io::Result<()> {
        Err(io::ErrorKind::PermissionDenied.into())
    }
}

#[test]
fn source_read_error_surfaces_as_io_error() {
    let e = plan(&mut FailingSrc, None)
        .map(|_| ())
        .unwrap_err()
        .into_error();
    assert!(matches!(e, Error::Io { op: "read", .. }), "{e:?}");
}

#[test]
fn file_api_reports_not_fragmented_without_changes() {
    let mut b = bx(b"ftyp", b"initinit");
    b.extend(bx(b"styp", &[0; 8]));
    let mut f = tempfile::tempfile().unwrap();
    f.write_all(&b).unwrap();
    assert_eq!(defragment(&mut f).unwrap(), DefragReport::NotFragmented);
    assert_eq!(f.metadata().unwrap().len(), b.len() as u64);
}

// ---------------------------------------------------------------------------------------------
// mp4 메타데이터: 새 `moov`의 마지막 자식으로 붙는 `udta`(mp4-metadata.md §6.1)

fn sample_udta() -> Vec<u8> {
    use crate::mp4meta::{Tags, build_udta};
    build_udta(
        &Tags {
            name: Some("제목".into()),
            artist: Some("채널".into()),
            day: Some("2026-01-02".into()),
            comment: Some("https://chzzk.naver.com/video/1".into()),
        },
        None,
    )
    .unwrap()
}

/// `udta`를 주면 새 `moov`의 마지막 자식으로 붙고, 나머지 바이트와 `free` 패치 자리는 `None`일 때와 같다.
#[test]
fn udta_is_the_last_child_of_the_new_moov() {
    let udta = sample_udta();
    let (plain_moov, plain_patches) = plan_bytes(FIXTURE).unwrap().unwrap();
    let (moov, patches) = plan_bytes_with(FIXTURE, Some(&udta)).unwrap().unwrap();
    assert_eq!(patches, plain_patches);
    assert_eq!(moov.len(), plain_moov.len() + udta.len());
    let cs = kids(&moov[8..]);
    assert_eq!(cs.last().unwrap().full, udta.as_slice());
    assert_eq!(&cs.last().unwrap().kind, b"udta");
    // 앞 자식들은 `None`일 때와 바이트까지 같다
    let plain_cs = kids(&plain_moov[8..]);
    assert_eq!(cs.len(), plain_cs.len() + 1);
    for (a, b) in cs.iter().zip(&plain_cs) {
        assert_eq!(a.full, b.full);
    }
}

/// 변환 결과 파일에서도 `moov`는 하나이고 샘플 표는 `udta` 유무와 상관없이 같다.
#[test]
fn defragment_with_udta_keeps_samples_and_adds_tags() {
    let udta = sample_udta();
    let mut with = FIXTURE.to_vec();
    let r = defragment_bytes_with(&mut with, Some(&udta)).unwrap();
    assert!(matches!(r, DefragReport::Converted { .. }));
    let (plain, _) = convert(FIXTURE);
    assert_eq!(flat_samples(&with).len(), flat_samples(&plain).len());
    for (a, b) in flat_samples(&with).iter().zip(&flat_samples(&plain)) {
        assert_eq!(a.samples, b.samples);
    }
    assert_eq!(
        top_boxes(&with).iter().filter(|t| t.0 == "moov").count(),
        top_boxes(&plain).iter().filter(|t| t.0 == "moov").count()
    );
    // 이미 일반 mp4면 `udta`가 있어도 다시 쓰지 않는다
    let mut again = with.clone();
    assert_eq!(
        defragment_bytes_with(&mut again, Some(&udta)).unwrap(),
        DefragReport::AlreadyFlat
    );
    assert_eq!(again, with);
}

/// 실제 파일 위에서도 `udta`가 들어간 채 변환된다(`defragment_in`).
#[test]
fn defragment_in_writes_udta_to_the_file() {
    let udta = sample_udta();
    // 패치가 실패하지 않는 설정(= 실패 주입 없음)
    let mut f = FaultyFile::new(Fault::Patch { after: usize::MAX });
    let r = defragment_in(&mut f, Some(&udta));
    assert!(matches!(r, Ok(DefragReport::Converted { .. })), "{r:?}");
    let out = f.c.into_inner();
    let tops = top_boxes(&out);
    let (_, off, hdr, size) = tops.iter().rfind(|t| t.0 == "moov").unwrap().clone();
    assert!(
        out[off + hdr..off + size]
            .windows(udta.len())
            .any(|w| w == udta.as_slice())
    );
}
