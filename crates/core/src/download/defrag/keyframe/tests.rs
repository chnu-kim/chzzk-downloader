//! `keyframe` 단위 테스트. 합성 fixture(`testdata/hls/`, `testdata/live/synthetic_frag.mp4`)와 손으로 만든 상자 바이트만 쓴다.

use super::*;

const INIT: &[u8] = include_bytes!("../../../../../../testdata/hls/init.mp4");
const SEG0: &[u8] = include_bytes!("../../../../../../testdata/hls/seg0.m4v");
const SEG1: &[u8] = include_bytes!("../../../../../../testdata/hls/seg1.m4v");
const SEG_NONSYNC: &[u8] = include_bytes!("../../../../../../testdata/hls/seg_nonsync.m4v");
const FFMPEG_FRAG: &[u8] = include_bytes!("../../../../../../testdata/live/synthetic_frag.mp4");

/// sample_depends_on = 1 + non-sync(P 프레임)
const P: u32 = 0x0101_0000;
/// sample_depends_on = 2 + non-sync(open-GOP I 프레임 같은 표시)
const I_NON_SYNC: u32 = 0x0201_0000;
/// sample_depends_on = 2, 동기
const IDR: u32 = 0x0200_0000;

// ---------------------------------------------------------------------------------------------
// 상자 만들기

fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut o = ((body.len() + 8) as u32).to_be_bytes().to_vec();
    o.extend_from_slice(kind);
    o.extend_from_slice(body);
    o
}

fn full(kind: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut b = vec![version];
    b.extend_from_slice(&flags.to_be_bytes()[1..]);
    b.extend_from_slice(body);
    bx(kind, &b)
}

fn cat(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

fn u32s(vs: &[u32]) -> Vec<u8> {
    vs.iter().flat_map(|v| v.to_be_bytes()).collect()
}

fn trak(id: u32, handler: &[u8; 4]) -> Vec<u8> {
    let tkhd = full(b"tkhd", 0, 7, &u32s(&[0, 0, id, 0, 0]));
    let mdhd = full(b"mdhd", 0, 0, &u32s(&[0, 0, 90000, 0, 0]));
    let mut h = u32s(&[0]);
    h.extend_from_slice(handler);
    h.extend_from_slice(&[0; 13]);
    let hdlr = full(b"hdlr", 0, 0, &h);
    let stbl = bx(b"stbl", &full(b"stsd", 0, 0, &u32s(&[0])));
    let minf = bx(b"minf", &stbl);
    let mdia = bx(b"mdia", &cat(&[&mdhd, &hdlr, &minf]));
    bx(b"trak", &cat(&[&tkhd, &mdia]))
}

/// init: 트랙 (id, handler, trex default_sample_flags).
fn make_init(tracks: &[(u32, &[u8; 4], u32)]) -> Vec<u8> {
    let ftyp = bx(b"ftyp", b"iso6\0\0\0\0iso6");
    let mvhd = full(b"mvhd", 0, 0, &u32s(&[0, 0, 1000, 0]));
    let mut moov = mvhd;
    let mut mvex = Vec::new();
    for &(id, h, flags) in tracks {
        moov.extend(trak(id, h));
        mvex.extend(full(b"trex", 0, 0, &u32s(&[id, 1, 0, 0, flags])));
    }
    moov.extend(bx(b"mvex", &mvex));
    cat(&[&ftyp, &bx(b"moov", &moov)])
}

/// 기본 init: 비디오 1(trex 0) + 오디오 2(trex 0).
fn init_av() -> Vec<u8> {
    make_init(&[(1, b"vide", 0), (2, b"soun", 0)])
}

/// trun 하나.
#[derive(Clone, Default)]
struct Trun {
    first: Option<u32>,
    /// 샘플별 sample_flags. `None`이면 샘플별 flags 칸이 없다.
    per_sample: Option<Vec<u32>>,
    /// 샘플별 flags가 없을 때의 샘플 수
    count: u32,
}

fn trun(t: &Trun) -> Vec<u8> {
    // data_offset·duration·size 칸은 늘 싣는다(필드 순서를 확인하려고)
    let mut fl = TR_DATA_OFFSET | TR_DURATION | TR_SIZE;
    if t.first.is_some() {
        fl |= TR_FIRST_FLAGS;
    }
    if t.per_sample.is_some() {
        fl |= TR_FLAGS;
    }
    let n = t.per_sample.as_ref().map_or(t.count, |v| v.len() as u32);
    let mut b = u32s(&[n, 0]);
    if let Some(f) = t.first {
        b.extend(u32s(&[f]));
    }
    for i in 0..n as usize {
        b.extend(u32s(&[1000, 16]));
        if let Some(v) = &t.per_sample {
            b.extend(u32s(&[v[i]]));
        }
    }
    full(b"trun", 0, fl, &b)
}

/// traf 하나: 트랙, tfhd default_sample_flags, trun들. tfhd에는 base_data_offset·sdi·duration·size 칸도 싣는다.
fn traf(track: u32, tfhd_default: Option<u32>, truns: &[Trun]) -> Vec<u8> {
    let mut fl = TF_BASE_DATA_OFFSET | TF_SDI | TF_DURATION | TF_SIZE;
    let mut b = u32s(&[track, 0, 0, 1, 1000, 16]);
    if let Some(f) = tfhd_default {
        fl |= TF_FLAGS;
        b.extend(u32s(&[f]));
    }
    let mut o = full(b"tfhd", 0, fl, &b);
    o.extend(full(b"tfdt", 1, 0, &[0; 8]));
    for t in truns {
        o.extend(trun(t));
    }
    bx(b"traf", &o)
}

fn moof(trafs: &[Vec<u8>]) -> Vec<u8> {
    let mut o = full(b"mfhd", 0, 0, &u32s(&[1]));
    for t in trafs {
        o.extend_from_slice(t);
    }
    cat(&[&bx(b"moof", &o), &bx(b"mdat", &[0; 32])])
}

fn styp() -> Vec<u8> {
    bx(b"styp", b"iso6\0\0\0\0iso6")
}

fn one(n: u32) -> Trun {
    Trun {
        count: n,
        ..Trun::default()
    }
}

fn report(b: &[u8]) -> KeyframeReport {
    match check_bytes(b).unwrap() {
        KeyframeCheck::Fragmented(r) => r,
        KeyframeCheck::NotFragmented => panic!("조각 구조로 읽혀야 한다"),
    }
}

/// 비디오 첫 조각 하나(styp 경계)만 있는 파일의 집계.
fn single(init: &[u8], trafs: &[Vec<u8>]) -> KeyframeReport {
    report(&cat(&[init, &styp(), &moof(trafs)]))
}

fn sync1() -> KeyframeReport {
    KeyframeReport {
        boundary: Boundary::Styp,
        fragments: 1,
        sync: 1,
        ..KeyframeReport::default()
    }
}

fn nonsync1(independent: bool) -> KeyframeReport {
    KeyframeReport {
        boundary: Boundary::Styp,
        fragments: 1,
        non_sync: 1,
        non_sync_independent: u32::from(independent),
        ..KeyframeReport::default()
    }
}

// ---------------------------------------------------------------------------------------------
// 판정 규칙

#[test]
fn classify_uses_non_sync_bit_only() {
    assert_eq!(classify_flags(0), SampleKind::Sync);
    assert_eq!(classify_flags(IDR), SampleKind::Sync);
    // degradation_priority·padding·redundancy·is_leading 비트는 판정에 쓰지 않는다
    assert_eq!(classify_flags(0x0C0E_FFFF), SampleKind::Sync);
    // depends_on == 1(기댄다)인데 non-sync 비트가 0인 모순 표시는 비트를 따른다
    assert_eq!(classify_flags(0x0100_0000), SampleKind::Sync);
    assert_eq!(
        classify_flags(P),
        SampleKind::NonSync { independent: false }
    );
    // depends_on == 2(I 프레임 표시)여도 non-sync 비트가 1이면 동기 샘플이 아니다(open-GOP)
    assert_eq!(
        classify_flags(I_NON_SYNC),
        SampleKind::NonSync { independent: true }
    );
    assert_eq!(
        classify_flags(NON_SYNC),
        SampleKind::NonSync { independent: false }
    );
}

#[test]
fn sample_flags_precedence() {
    // first_sample_flags는 첫 샘플에만, 샘플별 flags보다 먼저
    assert_eq!(super::super::sample_flags(0, Some(1), Some(2), 3), 1);
    assert_eq!(super::super::sample_flags(1, Some(1), Some(2), 3), 2);
    assert_eq!(super::super::sample_flags(1, Some(1), None, 3), 3);
    assert_eq!(super::super::sample_flags(0, None, Some(2), 3), 2);
    assert_eq!(super::super::sample_flags(0, None, None, 3), 3);
}

#[test]
fn verdict_table() {
    let r = |sync, non_sync, no_video| KeyframeReport {
        boundary: Boundary::Styp,
        fragments: sync + non_sync + no_video,
        sync,
        non_sync,
        non_sync_independent: 0,
        no_video,
    };
    assert_eq!(r(3, 0, 0).verdict(), Verdict::Yes);
    assert_eq!(r(3, 1, 0).verdict(), Verdict::No);
    // 아님이 하나라도 있으면 확인 못 한 조각이 있어도 안 된다
    assert_eq!(r(0, 1, 2).verdict(), Verdict::No);
    assert_eq!(r(3, 0, 1).verdict(), Verdict::Unknown);
    assert_eq!(r(0, 0, 0).verdict(), Verdict::Unknown);
    assert_eq!(KeyframeReport::default().verdict(), Verdict::Unknown);
}

// ---------------------------------------------------------------------------------------------
// fixture

#[test]
fn fixture_positive_trex_default_only() {
    // 합성 HLS: trun에 flags 칸이 없고 tfhd default도 없다 → trex 기본값(0, 동기)
    let r = report(&cat(&[INIT, SEG0, SEG1]));
    assert_eq!(
        r,
        KeyframeReport {
            boundary: Boundary::Styp,
            fragments: 2,
            sync: 2,
            ..KeyframeReport::default()
        }
    );
    assert_eq!(r.verdict(), Verdict::Yes);
}

#[test]
fn fixture_negative_first_sample_non_sync() {
    let r = report(&cat(&[INIT, SEG0, SEG_NONSYNC, SEG1]));
    assert_eq!(
        r,
        KeyframeReport {
            boundary: Boundary::Styp,
            fragments: 3,
            sync: 2,
            non_sync: 1,
            ..KeyframeReport::default()
        }
    );
    assert_eq!(r.verdict(), Verdict::No);
}

#[test]
fn fixture_ffmpeg_moof_boundary() {
    // 실제 인코더 모양(ffmpeg frag_keyframe, styp 없음 → moof 하나가 조각 하나). tfhd default는 non-sync(P)이고
    // 키프레임 조각만 trun first_sample_flags로 동기를 싣는다. 이 파일은 GOP 30 사이(15프레임)에서도 조각을 나눠
    // 비디오 moof 여섯 중 셋이 키프레임 없이 시작하고, 마지막 moof는 오디오만이다.
    let r = report(FFMPEG_FRAG);
    assert_eq!(
        r,
        KeyframeReport {
            boundary: Boundary::Moof,
            fragments: 7,
            sync: 3,
            non_sync: 3,
            non_sync_independent: 0,
            no_video: 1,
        }
    );
    assert_eq!(r.verdict(), Verdict::No);
}

// ---------------------------------------------------------------------------------------------
// 엣지

#[test]
fn first_sample_flags_only() {
    let init = init_av();
    let t = |f| Trun {
        first: Some(f),
        count: 3,
        ..Trun::default()
    };
    assert_eq!(single(&init, &[traf(1, None, &[t(P)])]), nonsync1(false));
    assert_eq!(single(&init, &[traf(1, None, &[t(0)])]), sync1());
}

#[test]
fn first_sample_flags_override_tfhd_default() {
    let init = init_av();
    // ffmpeg 모양: tfhd 기본은 non-sync, 첫 샘플만 동기
    let ffmpeg = Trun {
        first: Some(IDR),
        count: 3,
        ..Trun::default()
    };
    assert_eq!(single(&init, &[traf(1, Some(P), &[ffmpeg])]), sync1());
    let bad = Trun {
        first: Some(P),
        count: 3,
        ..Trun::default()
    };
    assert_eq!(single(&init, &[traf(1, Some(0), &[bad])]), nonsync1(false));
}

#[test]
fn tfhd_default_only() {
    let init = init_av();
    assert_eq!(
        single(&init, &[traf(1, Some(P), &[one(2)])]),
        nonsync1(false)
    );
    // tfhd default가 trex 기본값보다 먼저다
    let init_ns = make_init(&[(1, b"vide", P), (2, b"soun", 0)]);
    assert_eq!(single(&init_ns, &[traf(1, Some(0), &[one(2)])]), sync1());
}

#[test]
fn trex_default_only() {
    let init_ns = make_init(&[(1, b"vide", P), (2, b"soun", 0)]);
    assert_eq!(
        single(&init_ns, &[traf(1, None, &[one(2)])]),
        nonsync1(false)
    );
    assert_eq!(single(&init_av(), &[traf(1, None, &[one(2)])]), sync1());
}

#[test]
fn per_sample_flags() {
    let init = init_av();
    let t = |v: Vec<u32>| Trun {
        per_sample: Some(v),
        ..Trun::default()
    };
    // 첫 샘플만 본다: 뒤 샘플의 non-sync는 상관없다
    assert_eq!(
        single(&init, &[traf(1, Some(P), &[t(vec![0, P, P])])]),
        sync1()
    );
    assert_eq!(
        single(&init, &[traf(1, None, &[t(vec![I_NON_SYNC, 0])])]),
        nonsync1(true)
    );
    // first_sample_flags가 샘플별 flags보다 먼저다
    let both = Trun {
        first: Some(P),
        per_sample: Some(vec![0, 0]),
        ..Trun::default()
    };
    assert_eq!(single(&init, &[traf(1, None, &[both])]), nonsync1(false));
}

#[test]
fn non_video_tracks_are_ignored() {
    let init = init_av();
    let audio_bad = traf(2, Some(P), &[one(4)]);
    let video_ok = traf(1, None, &[one(2)]);
    // 오디오 traf가 먼저 와도 판정은 비디오가 정한다
    assert_eq!(single(&init, &[audio_bad.clone(), video_ok]), sync1());
    // 비디오 샘플이 없는 조각은 확인 못 함
    let r = single(&init, &[audio_bad]);
    assert_eq!(
        r,
        KeyframeReport {
            boundary: Boundary::Styp,
            fragments: 1,
            no_video: 1,
            ..KeyframeReport::default()
        }
    );
    assert_eq!(r.verdict(), Verdict::Unknown);
    // 비디오 트랙이 없는 init
    let audio_only = make_init(&[(2, b"soun", 0)]);
    let r = single(&audio_only, &[traf(2, None, &[one(2)])]);
    assert_eq!(r.no_video, 1);
    assert_eq!(r.verdict(), Verdict::Unknown);
}

#[test]
fn empty_trun_is_skipped() {
    let init = init_av();
    // 빈 trun 뒤의 trun 첫 샘플을 본다
    let t = [
        one(0),
        Trun {
            first: Some(P),
            count: 2,
            ..Trun::default()
        },
    ];
    assert_eq!(single(&init, &[traf(1, None, &t)]), nonsync1(false));
    // 빈 trun만 있는 비디오 traf → 같은 조각의 다음 moof가 정한다
    let f = cat(&[
        &init,
        &styp(),
        &moof(&[traf(1, Some(P), &[one(0)])]),
        &moof(&[traf(1, None, &[one(2)])]),
    ]);
    assert_eq!(report(&f), sync1());
    // 빈 trun만 있고 다른 비디오 샘플이 없으면 확인 못 함
    let r = single(&init, &[traf(1, Some(P), &[one(0)])]);
    assert_eq!(r.no_video, 1);
}

#[test]
fn only_first_video_sample_of_fragment_counts() {
    let init = init_av();
    // 한 조각(styp 하나) 안의 두 번째 비디오 moof가 non-sync로 시작해도 조각 판정은 첫 샘플이다
    let f = cat(&[
        &init,
        &styp(),
        &moof(&[traf(1, None, &[one(2)])]),
        &moof(&[traf(1, Some(P), &[one(2)])]),
        &styp(),
        &moof(&[traf(1, Some(P), &[one(2)])]),
    ]);
    let r = report(&f);
    assert_eq!(
        r,
        KeyframeReport {
            boundary: Boundary::Styp,
            fragments: 2,
            sync: 1,
            non_sync: 1,
            ..KeyframeReport::default()
        }
    );
}

#[test]
fn moof_before_first_styp_opens_a_fragment() {
    let init = init_av();
    let f = cat(&[
        &init,
        &moof(&[traf(1, Some(P), &[one(2)])]),
        &styp(),
        &moof(&[traf(1, None, &[one(2)])]),
    ]);
    let r = report(&f);
    assert_eq!((r.fragments, r.sync, r.non_sync), (2, 1, 1));
}

#[test]
fn moof_boundary_without_styp() {
    let init = init_av();
    let f = cat(&[
        &init,
        &moof(&[traf(1, None, &[one(2)])]),
        &moof(&[traf(1, Some(P), &[one(2)])]),
        &moof(&[traf(2, None, &[one(2)])]),
    ]);
    assert_eq!(
        report(&f),
        KeyframeReport {
            boundary: Boundary::Moof,
            fragments: 3,
            sync: 1,
            non_sync: 1,
            non_sync_independent: 0,
            no_video: 1,
        }
    );
}

#[test]
fn not_fragmented() {
    // mvex 없는 moov(일반 mp4)
    let flat = cat(&[
        &bx(b"ftyp", b"isom\0\0\0\0isom"),
        &bx(b"moov", &full(b"mvhd", 0, 0, &u32s(&[0, 0, 1000, 0]))),
        &bx(b"mdat", &[0; 8]),
    ]);
    assert_eq!(check_bytes(&flat).unwrap(), KeyframeCheck::NotFragmented);
    // init만 있고 moof가 없다
    assert_eq!(
        check_bytes(&init_av()).unwrap(),
        KeyframeCheck::NotFragmented
    );
}

#[test]
fn malformed_is_error() {
    let init = init_av();
    // init에 없는 트랙
    let f = cat(&[&init, &styp(), &moof(&[traf(9, None, &[one(2)])])]);
    assert!(check_bytes(&f).is_err());
    // 잘린 파일
    let whole = cat(&[INIT, SEG0]);
    assert!(check_bytes(&whole[..whole.len() - 3]).is_err());
    // init 없이 조각만
    assert!(check_bytes(SEG0).is_err());
    // trun 샘플 수가 본문보다 많다(샘플별 flags 칸)
    let mut t = trun(&Trun {
        per_sample: Some(vec![0]),
        ..Trun::default()
    });
    t[12..16].copy_from_slice(&5u32.to_be_bytes());
    let mut tr = full(b"tfhd", 0, 0, &u32s(&[1]));
    tr.extend(t);
    let f = cat(&[&init, &styp(), &moof(&[bx(b"traf", &tr)])]);
    assert!(check_bytes(&f).is_err());
}

#[test]
fn check_file_reads_from_disk() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("a.mp4");
    std::fs::write(&p, cat(&[INIT, SEG0, SEG_NONSYNC])).unwrap();
    let mut f = File::open(&p).unwrap();
    match check_file(&mut f).unwrap() {
        KeyframeCheck::Fragmented(r) => {
            assert_eq!((r.fragments, r.sync, r.non_sync), (2, 1, 1));
            assert_eq!(r.verdict(), Verdict::No);
        }
        KeyframeCheck::NotFragmented => panic!("조각 구조여야 한다"),
    }
}
