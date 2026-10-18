//! `mp4meta` 단위 테스트. 합성 fixture(`testdata/vod/pd_*.mp4`, `testdata/synthetic/thumb.*`)와 손으로 만든 상자만 쓴다.
//! 상자 검사는 통합 테스트와 같은 검사기(`tests/support/mp4.rs`)를 쓴다.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};

use super::*;
use crate::download::defrag::SliceSrc;

#[path = "../../tests/support/mp4.rs"]
#[allow(dead_code)]
mod mp4;

const PD: &[u8] = include_bytes!("../../../../testdata/vod/pd_faststart.mp4");
const PD_UDTA: &[u8] = include_bytes!("../../../../testdata/vod/pd_udta.mp4");
const PD_CO64: &[u8] = include_bytes!("../../../../testdata/vod/pd_co64.mp4");
const JPG: &[u8] = include_bytes!("../../../../testdata/synthetic/thumb.jpg");
const PNG: &[u8] = include_bytes!("../../../../testdata/synthetic/thumb.png");
const WEBP: &[u8] = include_bytes!("../../../../testdata/synthetic/thumb.webp");

/// ffmpeg(`-c copy -fflags +bitexact -f mp4 -metadata title=T artist=A date=2026-01-02 comment=https://x`)가 만든
/// 표지 없는 `udta`. 우리 배치가 참조 구현과 바이트까지 같은지 본다(core.md 80).
const FFMPEG_UDTA: &str = "000000b275647461000000aa6d657461000000000000002168646c7200000000000000006d6469726170706c0000000000000000000000007d696c737400000019a96e616d000000116461746100000001000000005400000019a9415254000000116461746100000001000000004100000022a96461790000001a646174610000000100000000323032362d30312d303200000021a9636d740000001964617461000000010000000068747470733a2f2f78";

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn tags() -> Tags {
    Tags {
        name: Some("T".into()),
        artist: Some("A".into()),
        day: Some("2026-01-02".into()),
        comment: Some("https://x".into()),
    }
}

fn cover() -> Cover {
    Cover::sniff(JPG.to_vec()).unwrap()
}

fn udta() -> Vec<u8> {
    build_udta(&tags(), Some(&cover())).unwrap()
}

// ---------------------------------------------------------------------------------------------
// build_udta

#[test]
fn udta_matches_ffmpeg_reference_bytes() {
    assert_eq!(build_udta(&tags(), None).unwrap(), unhex(FFMPEG_UDTA));
}

#[test]
fn udta_has_five_atoms_in_fixed_order() {
    let u = udta();
    let ilst = mp4::find_path(&u_in_moov(&u), &["moov", "udta", "meta", "ilst"])
        .unwrap()
        .to_vec();
    let items = mp4::ilst_items(&ilst).unwrap();
    let kinds: Vec<&str> = items.iter().map(|(k, _, _)| k.as_str()).collect();
    assert_eq!(kinds, ["©nam", "©ART", "©day", "©cmt", "covr"]);
    assert_eq!(items[0].1, 1);
    assert_eq!(items[0].2, b"T");
    assert_eq!(items[4].1, 13, "JPEG는 type 13");
    assert_eq!(items[4].2, JPG);
    // `©`는 UTF-8 두 바이트가 아니라 latin1 한 바이트(0xA9)다
    assert!(u.windows(4).any(|w| w == b"\xa9nam"));
    assert!(!u.windows(2).any(|w| w == "©".as_bytes()));
}

/// `udta`를 `moov` 하나에 감싸 검사기가 경로로 찾게 한다.
fn u_in_moov(udta: &[u8]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(&u32::try_from(8 + udta.len()).unwrap().to_be_bytes());
    v.extend_from_slice(b"moov");
    v.extend_from_slice(udta);
    v
}

#[test]
fn udta_png_cover_is_type_14() {
    let c = Cover::sniff(PNG.to_vec()).unwrap();
    let u = u_in_moov(&build_udta(&tags(), Some(&c)).unwrap());
    let items =
        mp4::ilst_items(mp4::find_path(&u, &["moov", "udta", "meta", "ilst"]).unwrap()).unwrap();
    let covr = items.iter().find(|(k, _, _)| k == "covr").unwrap();
    assert_eq!(covr.1, 14);
    assert_eq!(covr.2, PNG);
}

#[test]
fn udta_skips_empty_and_blank_values() {
    let t = Tags {
        name: Some("  제목  ".into()),
        artist: Some("   ".into()),
        day: None,
        comment: Some(String::new()),
    };
    let u = u_in_moov(&build_udta(&t, None).unwrap());
    let items =
        mp4::ilst_items(mp4::find_path(&u, &["moov", "udta", "meta", "ilst"]).unwrap()).unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].0, "©nam");
    assert_eq!(items[0].2, "제목".as_bytes(), "앞뒤 공백은 지운다");
}

#[test]
fn udta_none_when_everything_is_empty() {
    assert_eq!(build_udta(&Tags::default(), None), None);
    let blank = Tags {
        name: Some(" ".into()),
        ..Tags::default()
    };
    assert_eq!(build_udta(&blank, None), None);
    // 표지만 있어도 태그는 쓴다
    assert!(build_udta(&Tags::default(), Some(&cover())).is_some());
}

#[test]
fn atom_text_is_cut_at_1kib_on_a_char_boundary() {
    // "가"는 3바이트라 1024바이트 안에 341자(1023바이트)가 들어간다
    let t = Tags {
        name: Some("가".repeat(500)),
        ..Tags::default()
    };
    let u = u_in_moov(&build_udta(&t, None).unwrap());
    let items =
        mp4::ilst_items(mp4::find_path(&u, &["moov", "udta", "meta", "ilst"]).unwrap()).unwrap();
    assert_eq!(items[0].2.len(), 1023);
    assert!(std::str::from_utf8(&items[0].2).is_ok());
    // 정확히 1024바이트면 그대로다
    let exact = Tags {
        name: Some("a".repeat(1024)),
        ..Tags::default()
    };
    let u = u_in_moov(&build_udta(&exact, None).unwrap());
    let items =
        mp4::ilst_items(mp4::find_path(&u, &["moov", "udta", "meta", "ilst"]).unwrap()).unwrap();
    assert_eq!(items[0].2.len(), 1024);
}

// ---------------------------------------------------------------------------------------------
// TagInput -> Tags

fn input(kind: ContentKind, f: impl FnOnce(&mut ContentMeta)) -> TagInput {
    let mut meta = ContentMeta {
        kind,
        title: " 제목 ".into(),
        channel_name: "채널".into(),
        channel_id: None,
        live_open_date: None,
        publish_date: None,
        adult: false,
        duration_secs: None,
    };
    f(&mut meta);
    TagInput {
        meta,
        content: ContentRef::Video { video_no: 9000002 },
        range: None,
        thumbnail_url: None,
    }
}

#[test]
fn tags_day_prefers_live_open_date_then_publish_date() {
    let t = input(ContentKind::Video, |m| {
        m.live_open_date = Some("2026-01-02 12:00:00".into());
        m.publish_date = Some("2026-02-03 00:00:00".into());
    })
    .tags();
    assert_eq!(t.day.as_deref(), Some("2026-01-02"));
    let t = input(ContentKind::Video, |m| {
        m.publish_date = Some("2026-02-03 00:00:00".into());
    })
    .tags();
    assert_eq!(t.day.as_deref(), Some("2026-02-03"));
    // 잘못된 날짜는 건너뛰고 다음 것을 본다(파일 이름의 날짜 규칙과 같다)
    let t = input(ContentKind::Video, |m| {
        m.live_open_date = Some("2026-13-40 00:00:00".into());
        m.publish_date = Some("2026-02-03".into());
    })
    .tags();
    assert_eq!(t.day.as_deref(), Some("2026-02-03"));
    let t = input(ContentKind::Video, |m| {
        m.live_open_date = Some("가짜".into());
    })
    .tags();
    assert_eq!(t.day, None);
}

#[test]
fn tags_day_by_kind() {
    // 클립은 날짜가 없다
    let t = input(ContentKind::Clip, |m| {
        m.live_open_date = Some("2026-01-02 12:00:00".into());
        m.publish_date = Some("2026-01-02".into());
    })
    .tags();
    assert_eq!(t.day, None);
    // 생방송은 live_open_date만 쓴다
    let t = input(ContentKind::Live, |m| {
        m.live_open_date = Some("2026-01-02 12:00:00".into());
        m.publish_date = Some("2026-05-05".into());
    })
    .tags();
    assert_eq!(t.day.as_deref(), Some("2026-01-02"));
    let t = input(ContentKind::Live, |m| {
        m.publish_date = Some("2026-05-05".into())
    })
    .tags();
    assert_eq!(t.day, None);
}

#[test]
fn tags_name_gets_range_suffix_and_comment_is_the_public_page() {
    let mut i = input(ContentKind::Video, |_| {});
    i.range = Some(TimeRange {
        start_ms: 600_000,
        end_ms: Some(1_200_000),
    });
    let t = i.tags();
    assert_eq!(t.name.as_deref(), Some("제목 (0.10.00~0.20.00)"));
    assert_eq!(t.artist.as_deref(), Some("채널"));
    assert_eq!(
        t.comment.as_deref(),
        Some("https://chzzk.naver.com/video/9000002")
    );
    // 긴 제목은 제목 쪽을 줄여 접미사를 남긴다
    let mut i = input(ContentKind::Video, |m| m.title = "a".repeat(2000));
    i.range = Some(TimeRange {
        start_ms: 0,
        end_ms: None,
    });
    let name = i.tags().name.unwrap();
    assert!(
        name.len() <= MAX_ATOM_BYTES && name.ends_with(" (0.00.00~)"),
        "{name}"
    );
}

#[test]
fn tags_blank_title_and_channel_are_omitted() {
    let t = input(ContentKind::Video, |m| {
        m.title = "  ".into();
        m.channel_name = String::new();
    })
    .tags();
    assert_eq!(t.name, None);
    assert_eq!(t.artist, None);
    // 원본 주소는 늘 있다
    assert!(t.comment.is_some());
}

#[test]
fn tag_input_debug_hides_the_thumbnail_query() {
    let mut i = input(ContentKind::Video, |_| {});
    i.thumbnail_url = Some(
        "https://img.example.invalid/t.jpg?hdnts=SECRET"
            .parse()
            .unwrap(),
    );
    let s = format!("{i:?}");
    assert!(
        !s.contains("SECRET") && s.contains("https://img.example.invalid/t.jpg"),
        "{s}"
    );
    // 서명이 든 쿼리는 어떤 태그에도 들어가지 않는다
    let t = i.tags();
    for v in [t.name, t.artist, t.day, t.comment].into_iter().flatten() {
        assert!(!v.contains("SECRET"), "{v}");
    }
}

// ---------------------------------------------------------------------------------------------
// Cover::sniff

#[test]
fn cover_sniff_by_magic_only() {
    assert_eq!(Cover::sniff(JPG.to_vec()).unwrap().kind, CoverKind::Jpeg);
    assert_eq!(Cover::sniff(PNG.to_vec()).unwrap().kind, CoverKind::Png);
    assert_eq!(Cover::sniff(WEBP.to_vec()), None, "WebP는 받지 않는다");
    assert_eq!(Cover::sniff(Vec::new()), None);
    assert_eq!(Cover::sniff(b"GIF89a....".to_vec()), None);
    // PNG 머리가 중간에서 잘려도 거부
    assert_eq!(Cover::sniff(PNG[..7].to_vec()), None);
    let mut big = vec![0xff, 0xd8, 0xff];
    big.resize(MAX_COVER_BYTES, 0);
    assert!(Cover::sniff(big.clone()).is_some(), "정확히 2 MiB는 받는다");
    big.push(0);
    assert_eq!(Cover::sniff(big), None, "2 MiB + 1바이트는 버린다");
}

// ---------------------------------------------------------------------------------------------
// plan_rewrite·write_rewrite: 정상

/// 바이트 위에서 계획하고 메모리에 다시 쓴다. `None`은 이미 같은 태그다.
fn rewrite(b: &[u8], udta: &[u8]) -> Result<Option<Vec<u8>>, Fail> {
    match plan_rewrite(&mut SliceSrc(b), udta)? {
        Plan::AlreadyTagged => Ok(None),
        Plan::Rewrite(p) => {
            let mut out = Vec::new();
            write_rewrite(&mut Cursor::new(b), &p, &mut out).unwrap();
            assert_eq!(out.len() as u64, p.out_len());
            Ok(Some(out))
        }
    }
}

fn tagged() -> Vec<u8> {
    rewrite(PD, &udta()).unwrap().unwrap()
}

fn types(b: &[u8]) -> Vec<String> {
    mp4::top_boxes(b).into_iter().map(|(k, _)| k).collect()
}

/// 최상위 상자의 시작 위치(헤더 포함).
fn top_off(b: &[u8], kind: &str) -> usize {
    let (_, r) = mp4::top_boxes(b)
        .into_iter()
        .find(|(k, _)| k == kind)
        .unwrap();
    let hdr = if u32::from_be_bytes(b[r.start - 8..r.start - 4].try_into().unwrap()) == 1 {
        16
    } else {
        8
    };
    r.start - hdr
}

/// 다시 쓴 파일의 모든 청크 위치가 원본에서 같은 바이트를 가리키는지 본다(`n`바이트씩).
fn assert_chunks_follow(orig: &[u8], out: &[u8], n: usize) {
    let old = mp4::chunk_offsets(mp4::find_path(orig, &["moov"]).unwrap()).unwrap();
    let new = mp4::chunk_offsets(mp4::find_path(out, &["moov"]).unwrap()).unwrap();
    assert_eq!(old.len(), new.len());
    assert!(!old.is_empty());
    for (o, w) in old.iter().zip(&new) {
        let (o, w) = (*o as usize, *w as usize);
        assert_eq!(orig[o..o + n], out[w..w + n], "청크 {o} → {w}");
    }
}

/// `moov` 본문의 자식 중 `udta`·`trak`이 아닌 것의 바이트(`trak`은 청크 위치가 바뀐다).
fn moov_children_without(moov_body: &[u8], skip: &[&str]) -> Vec<Vec<u8>> {
    mp4::child_boxes(moov_body)
        .unwrap()
        .into_iter()
        .filter(|(k, _)| !skip.contains(&k.as_str()))
        .map(|(_, r)| moov_body[r].to_vec())
        .collect()
}

#[test]
fn rewrite_keeps_faststart_and_moves_chunk_offsets() {
    assert_eq!(types(PD), ["ftyp", "moov", "free", "mdat"]);
    let out = tagged();
    // moov는 앞에 남고(faststart) 들어가지 않는 free(8)는 뺀다
    assert_eq!(types(&out), ["ftyp", "moov", "mdat"]);
    assert_eq!(mp4::top_moov_count(&out), 1);
    assert_eq!(out[..top_off(PD, "moov")], PD[..top_off(PD, "moov")]);
    assert_eq!(mp4::mdat_payloads(&out), mp4::mdat_payloads(PD));
    // 뒤 바이트가 움직인 만큼 청크 위치가 움직였고, 같은 바이트를 가리킨다
    let delta = out.len() as i64 - PD.len() as i64;
    assert!(delta > 0);
    assert_eq!(
        top_off(&out, "mdat") as i64 - top_off(PD, "mdat") as i64,
        delta
    );
    let old = mp4::chunk_offsets(mp4::find_path(PD, &["moov"]).unwrap()).unwrap();
    let new = mp4::chunk_offsets(mp4::find_path(&out, &["moov"]).unwrap()).unwrap();
    assert_eq!(new[0] as i64 - old[0] as i64, delta);
    assert_chunks_follow(PD, &out, 64);
    // trak·udta 밖의 자식은 바이트까지 같다
    let old_moov = mp4::find_path(PD, &["moov"]).unwrap();
    let new_moov = mp4::find_path(&out, &["moov"]).unwrap();
    assert_eq!(
        moov_children_without(old_moov, &["udta", "trak"]),
        moov_children_without(new_moov, &["udta", "trak"])
    );
    let ilst = mp4::find_path(&out, &["moov", "udta", "meta", "ilst"]).unwrap();
    assert_eq!(mp4::ilst_items(ilst).unwrap().len(), 5);
}

#[test]
fn rewrite_moves_co64_offsets_and_keeps_co64() {
    let out = rewrite(PD_CO64, &udta()).unwrap().unwrap();
    assert_chunks_follow(PD_CO64, &out, 64);
    let stbl = mp4::find_path(&out, &["moov", "trak", "mdia", "minf", "stbl"]).unwrap();
    let kinds: Vec<String> = mp4::child_boxes(stbl)
        .unwrap()
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    assert!(kinds.contains(&"co64".to_string()), "{kinds:?}");
    assert!(!kinds.contains(&"stco".to_string()), "{kinds:?}");
}

#[test]
fn rewrite_replaces_an_existing_udta() {
    let before = mp4::find_path(PD_UDTA, &["moov", "udta", "meta", "ilst"]).unwrap();
    assert_eq!(mp4::ilst_items(before).unwrap()[0].0, "©too");
    let out = rewrite(PD_UDTA, &udta()).unwrap().unwrap();
    let new = mp4::find_path(&out, &["moov"]).unwrap();
    let udtas = mp4::child_boxes(new)
        .unwrap()
        .into_iter()
        .filter(|(k, _)| k == "udta")
        .count();
    assert_eq!(udtas, 1, "옛 udta는 빼고 새 것 하나만 둔다");
    let ilst = mp4::find_path(&out, &["moov", "udta", "meta", "ilst"]).unwrap();
    let kinds: Vec<String> = mp4::ilst_items(ilst)
        .unwrap()
        .into_iter()
        .map(|i| i.0)
        .collect();
    assert!(!kinds.contains(&"©too".to_string()), "{kinds:?}");
    assert_chunks_follow(PD_UDTA, &out, 64);
}

#[test]
fn rewrite_is_idempotent() {
    let once = tagged();
    assert!(rewrite(&once, &udta()).unwrap().is_none(), "이미 같은 태그");
    // 다른 태그로 다시 쓰면 다시 쓰고 여전히 올바르다
    let other = build_udta(
        &Tags {
            name: Some("다른 제목".into()),
            ..Tags::default()
        },
        None,
    )
    .unwrap();
    let twice = rewrite(&once, &other).unwrap().unwrap();
    assert_eq!(mp4::top_moov_count(&twice), 1);
    let ilst = mp4::find_path(&twice, &["moov", "udta", "meta", "ilst"]).unwrap();
    assert_eq!(mp4::ilst_items(ilst).unwrap().len(), 1);
    assert_chunks_follow(PD, &twice, 64);
}

/// `moov` 자식 순서가 `[free, mvhd, …]`여도 다시 쓰기는 순서를 그대로 두고 태그를 넣는다(Codex 리뷰 high 2: 옛 끝에
/// 붙이기의 복구는 첫 자식 `mvhd`만 알아봤다. 다시 쓰기에는 복구 판정이 없다).
#[test]
fn rewrite_accepts_a_moov_whose_first_child_is_not_mvhd() {
    let old = mp4::find_path(PD, &["moov"]).unwrap();
    let mut body = put(b"free", &[0; 4]);
    body.extend_from_slice(old);
    let (b, _) = pd_with_moov_body(&body);
    let out = rewrite(&b, &udta()).unwrap().unwrap();
    let kids: Vec<String> = mp4::child_boxes(mp4::find_path(&out, &["moov"]).unwrap())
        .unwrap()
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    assert_eq!(kids, ["free", "mvhd", "trak", "udta"]);
    assert_chunks_follow(&b, &out, 64);
}

// ---------------------------------------------------------------------------------------------
// 옛 moov 뒤 free 흡수

/// `PD`의 `moov` 뒤 `free`를 본문 `n`바이트짜리로 바꾼 파일. `stco`는 새 `mdat` 위치를 가리키게 고친다.
fn pd_with_free(n: usize) -> Vec<u8> {
    let moov_end = mp4::top_boxes(PD)[1].1.end;
    let free_end = mp4::top_boxes(PD)[2].1.end;
    let mut b = PD[..moov_end].to_vec();
    b.extend(put(b"free", &vec![0; n]));
    b.extend_from_slice(&PD[free_end..]);
    // stco 항목 하나를 늘어난 만큼 옮긴다(fixture는 trak 하나·청크 하나)
    let grow = (n + 8 - (free_end - moov_end)) as u32;
    let old = mp4::chunk_offsets(mp4::find_path(PD, &["moov"]).unwrap()).unwrap()[0] as u32;
    let at = b[..moov_end].windows(4).position(|w| w == b"stco").unwrap() + 12;
    b[at..at + 4].copy_from_slice(&(old + grow).to_be_bytes());
    assert_chunks_follow(PD, &b, 64);
    b
}

/// 새 `moov`가 옛 `moov` + 뒤 `free`에 들어가고 8바이트 이상 남으면 `free`를 줄여 채운다. 뒤 바이트·청크 위치가 그대로다.
#[test]
fn rewrite_absorbs_the_following_free() {
    let b = pd_with_free(4096);
    let out = rewrite(&b, &build_udta(&tags(), None).unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(out.len(), b.len());
    assert_eq!(types(&out), ["ftyp", "moov", "free", "mdat"]);
    assert_eq!(top_off(&out, "mdat"), top_off(&b, "mdat"));
    assert_eq!(
        mp4::chunk_offsets(mp4::find_path(&out, &["moov"]).unwrap()).unwrap(),
        mp4::chunk_offsets(mp4::find_path(&b, &["moov"]).unwrap()).unwrap()
    );
    assert_eq!(out[top_off(&out, "mdat")..], b[top_off(&b, "mdat")..]);
}

/// 꼭 맞으면 `free` 없이 붙는다. 1~7바이트가 남으면 `free`를 만들 수 없어 빼고 뒤를 당긴다(`delta` < 0).
#[test]
fn rewrite_exact_fit_and_small_gap() {
    let u = build_udta(&tags(), None).unwrap();
    let growth = u.len(); // PD에는 udta가 없다
    // 꼭 맞음: free 전체(헤더 포함) = 늘어난 만큼
    let b = pd_with_free(growth - 8);
    let out = rewrite(&b, &u).unwrap().unwrap();
    assert_eq!(types(&out), ["ftyp", "moov", "mdat"]);
    assert_eq!(out.len(), b.len());
    assert_eq!(top_off(&out, "mdat"), top_off(&b, "mdat"));
    // 4바이트 남음: free를 빼고 4바이트 당긴다
    let b = pd_with_free(growth - 8 + 4);
    let out = rewrite(&b, &u).unwrap().unwrap();
    assert_eq!(types(&out), ["ftyp", "moov", "mdat"]);
    assert_eq!(out.len() + 4, b.len());
    assert_eq!(top_off(&out, "mdat") + 4, top_off(&b, "mdat"));
    assert_chunks_follow(&b, &out, 64);
}

// ---------------------------------------------------------------------------------------------
// 손으로 만든 moov

fn stco(v: &[u32]) -> Vec<u8> {
    let mut b = vec![0u8; 4];
    b.extend_from_slice(&(v.len() as u32).to_be_bytes());
    for x in v {
        b.extend_from_slice(&x.to_be_bytes());
    }
    put(b"stco", &b)
}

fn co64(v: &[u64]) -> Vec<u8> {
    let mut b = vec![0u8; 4];
    b.extend_from_slice(&(v.len() as u32).to_be_bytes());
    for x in v {
        b.extend_from_slice(&x.to_be_bytes());
    }
    put(b"co64", &b)
}

/// `moov{ mvhd, trak{ mdia{ minf{ stbl{ tables } } } }… }`. trak마다 `stbl` 자식 바이트를 받는다.
fn synth_moov(traks: &[Vec<u8>]) -> Vec<u8> {
    let mut body = put(b"mvhd", &[0; 100]);
    for t in traks {
        body.extend(put(b"trak", &put(b"mdia", &put(b"minf", &put(b"stbl", t)))));
    }
    put(b"moov", &body)
}

fn ftyp() -> Vec<u8> {
    put(b"ftyp", b"isom\0\0\x02\0isom")
}

/// `[ftyp, moov(stbl), mdat(32)]`. `mdat` 본문 위치를 돌려준다.
fn faststart(stbl: impl Fn(u64) -> Vec<Vec<u8>>) -> Vec<u8> {
    // moov 크기는 항목 값과 무관하니 0으로 한 번 재고 다시 만든다
    let probe = synth_moov(&stbl(0));
    let body_at = (ftyp().len() + probe.len() + 8) as u64;
    let mut b = ftyp();
    b.extend(synth_moov(&stbl(body_at)));
    b.extend(put(b"mdat", &(0u8..32).collect::<Vec<_>>()));
    b
}

/// trak 둘(`stco` 하나·`co64` 하나), 청크 여러 개.
#[test]
fn rewrite_moves_every_track_and_chunk() {
    let b = faststart(|at| vec![stco(&[at as u32, at as u32 + 8]), co64(&[at + 16, at + 24])]);
    let out = rewrite(&b, &udta()).unwrap().unwrap();
    assert_chunks_follow(&b, &out, 8);
}

/// `moov`가 끝에 있는 파일(`[ftyp, mdat, moov]`): 옛 `moov` 앞을 가리키는 위치는 그대로다.
#[test]
fn rewrite_keeps_offsets_before_the_moov() {
    let mdat = put(b"mdat", &(0u8..32).collect::<Vec<_>>());
    let at = (ftyp().len() + 8) as u32;
    let mut b = ftyp();
    b.extend_from_slice(&mdat);
    b.extend(synth_moov(&[stco(&[at, at + 16])]));
    let out = rewrite(&b, &udta()).unwrap().unwrap();
    assert_eq!(types(&out), ["ftyp", "mdat", "moov"]);
    assert_chunks_follow(&b, &out, 16);
    assert_eq!(
        mp4::chunk_offsets(mp4::find_path(&out, &["moov"]).unwrap()).unwrap(),
        [u64::from(at), u64::from(at) + 16]
    );
}

/// 옮긴 `stco` 값이 32비트를 넘으면 `co64`로 올리지 않고 거부한다(태그 없이 원본, core.md 83). 같은 값의 `co64`는 된다.
#[test]
fn stco_overflow_is_rejected_but_co64_is_fine() {
    let near = u32::MAX - 3;
    let mut b = ftyp();
    b.extend(synth_moov(&[stco(&[near])]));
    b.extend(put(b"mdat", &[0; 8]));
    let e = rewrite(&b, &udta()).unwrap_err();
    assert!(format!("{e:?}").contains("4 GiB"), "{e:?}");
    let mut b = ftyp();
    b.extend(synth_moov(&[co64(&[u64::from(near)])]));
    b.extend(put(b"mdat", &[0; 8]));
    let out = rewrite(&b, &udta()).unwrap().unwrap();
    let new = mp4::chunk_offsets(mp4::find_path(&out, &["moov"]).unwrap()).unwrap();
    assert_eq!(new[0], u64::from(near) + (out.len() - b.len()) as u64);
}

#[test]
fn malformed_chunk_tables_are_rejected() {
    let moov_at = ftyp().len() as u32;
    for (name, traks) in [
        ("표 없음", vec![put(b"stsz", &[0; 12])]),
        ("표 둘", vec![[stco(&[0]), co64(&[0])].concat()]),
        ("옛 moov 안", vec![stco(&[moov_at + 8])]),
        ("항목 수 불일치", {
            let mut t = stco(&[0]);
            t[12..16].copy_from_slice(&5u32.to_be_bytes());
            vec![t]
        }),
    ] {
        let mut b = ftyp();
        b.extend(synth_moov(&traks));
        b.extend(put(b"mdat", &[0; 8]));
        assert!(rewrite(&b, &udta()).is_err(), "{name}");
    }
}

// ---------------------------------------------------------------------------------------------
// 거부

fn rejected(b: &[u8]) {
    let r = rewrite(b, &udta());
    assert!(r.is_err(), "{:?}", r.map(|o| o.map(|v| v.len())));
}

fn put(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    bx(kind, body)
}

#[test]
fn rewrite_rejects_unknown_structures() {
    // moov가 없다
    rejected(&PD[..mp4::top_boxes(PD)[1].1.start - 8]);
    // moov가 둘
    let mut two = PD.to_vec();
    let moov = PD[mp4::top_boxes(PD)[1].1.start - 8..mp4::top_boxes(PD)[1].1.end].to_vec();
    two.extend_from_slice(&moov);
    rejected(&two);
    // 크기 0(파일 끝까지)인 끝 상자
    let mut zero = PD.to_vec();
    zero.extend_from_slice(&0u32.to_be_bytes());
    zero.extend_from_slice(b"mdat");
    zero.extend_from_slice(&[1, 2, 3]);
    rejected(&zero);
    // 상자가 파일 끝을 넘는다(잘린 파일)
    rejected(&PD[..PD.len() - 5]);
    // 가짜 바이트
    rejected(b"not an mp4 at all, just text.");
    rejected(b"");
    // mvex가 있는 조각 구조
    let mvhd = mp4::child_boxes(mp4::find_path(PD, &["moov"]).unwrap()).unwrap()[0].clone();
    let old_body = mp4::find_path(PD, &["moov"]).unwrap();
    let mut body = old_body[mvhd.1.start - 8..mvhd.1.end].to_vec();
    body.extend(put(b"mvex", &put(b"trex", &[0; 24])));
    let mut frag = PD[..mp4::top_boxes(PD)[0].1.end].to_vec();
    frag.extend(put(b"moov", &body));
    rejected(&frag);
}

/// `PD`의 `moov` 본문만 `body`로 바꾼 파일과, 그 `moov`의 종류 4바이트 자리. 청크 위치는 늘어난 만큼 옮긴다.
fn pd_with_moov_body(body: &[u8]) -> (Vec<u8>, usize) {
    let moov = mp4::top_boxes(PD)[1].1.clone();
    let mut b = PD[..moov.start - 8].to_vec();
    b.extend(put(b"moov", body));
    let grow = (body.len() - moov.len()) as u32;
    b.extend_from_slice(&PD[moov.end..]);
    if let Some(at) = b[moov.start..moov.start + body.len()]
        .windows(4)
        .position(|w| w == b"stco")
    {
        let at = moov.start + at + 12;
        let v = u32::from_be_bytes(b[at..at + 4].try_into().unwrap());
        b[at..at + 4].copy_from_slice(&(v + grow).to_be_bytes());
    }
    (b, moov.start - 4)
}

/// 크기 0인 자식이 있으면 뒤에 붙인 `udta`가 그 자식 안으로 먹혀 태그가 보이지 않는다. 계획 단계에서 거부한다.
#[test]
fn rewrite_rejects_a_moov_with_a_zero_sized_child() {
    let mut body = mp4::find_path(PD, &["moov"]).unwrap().to_vec();
    body.extend_from_slice(&0u32.to_be_bytes());
    body.extend_from_slice(b"skip");
    body.extend_from_slice(&[1, 2, 3]);
    let (b, _) = pd_with_moov_body(&body);
    rejected(&b);
}

/// 새 `moov`가 `MAX_META_BOX`를 넘으면 태그를 쓰지 않는다(mp4-metadata.md §6.2).
#[test]
fn rewrite_does_not_write_a_moov_over_the_size_limit() {
    let huge = vec![0u8; MAX_META_BOX as usize];
    assert!(rewrite(PD, &huge).is_err());
}

// ---------------------------------------------------------------------------------------------
// rewrite_to: 임시 파일

/// `n`바이트까지 쓰고 그다음은 디스크 부족으로 실패하는 임시 파일(부분 기록).
struct FullDisk {
    f: std::fs::File,
    left: usize,
}
impl Write for FullDisk {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        if self.left == 0 {
            return Err(std::io::ErrorKind::StorageFull.into());
        }
        let n = b.len().min(self.left);
        self.left -= n;
        self.f.write(&b[..n])
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl SyncWrite for FullDisk {
    fn sync(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn rewrite_to_writes_the_same_bytes_and_replaces_a_leftover() {
    let dir = tempfile::tempdir().unwrap();
    let tmp = dir.path().join("a.mp4.part.tmp");
    std::fs::write(&tmp, vec![7u8; PD.len() * 3]).unwrap();
    let mut src = Cursor::new(PD.to_vec());
    let r = rewrite_to(&mut src, PD.len() as u64, &udta(), &tmp, |t| {
        std::fs::File::create(t)
    })
    .unwrap();
    let want = tagged();
    assert_eq!(
        r,
        Retagged::Written {
            len: want.len() as u64
        }
    );
    assert_eq!(std::fs::read(&tmp).unwrap(), want);
    assert_eq!(src.into_inner(), PD, "원본은 읽기만 한다");
}

/// 쓰다가 디스크가 차면(일부만 기록) 임시 파일을 지우고 `DiskFull`이다. 원본은 그대로다.
#[test]
fn rewrite_to_disk_full_removes_the_partial_temp() {
    for left in [0, 1, 37, PD.len()] {
        let dir = tempfile::tempdir().unwrap();
        let tmp = dir.path().join("a.mp4.part.tmp");
        let mut src = Cursor::new(PD.to_vec());
        let r = rewrite_to(&mut src, PD.len() as u64, &udta(), &tmp, |t| {
            Ok(FullDisk {
                f: std::fs::File::create(t)?,
                left,
            })
        });
        assert!(matches!(r, Err(Error::DiskFull { .. })), "{left}: {r:?}");
        assert!(!tmp.exists(), "{left}: 임시 파일이 남았다");
        assert_eq!(src.into_inner(), PD);
    }
}

/// 구조를 모르면 임시 파일을 열지도 않는다.
#[test]
fn rewrite_to_unknown_structure_opens_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let tmp = dir.path().join("a.mp4.part.tmp");
    let body = b"not an mp4".to_vec();
    let r = rewrite_to(
        &mut Cursor::new(body.clone()),
        body.len() as u64,
        &udta(),
        &tmp,
        |t| -> std::io::Result<std::fs::File> { panic!("열면 안 된다: {}", t.display()) },
    );
    assert!(matches!(r, Err(Error::Parse { .. })), "{r:?}");
}

// ---------------------------------------------------------------------------------------------
// 큰 파일(co64·largesize)

/// 쓴 구간만 들고 길이는 `len`으로 보이는 희소 파일(읽기 전용). 실제 디스크에 큰 파일을 만들지 않는다
/// (Windows NTFS `set_len`은 희소 파일을 보장하지 않는다). 다시 쓰기는 계획만 본다(뒤는 바이트 그대로 옮기기다).
struct SparseFile {
    len: u64,
    pos: u64,
    bytes: BTreeMap<u64, u8>,
}

impl SparseFile {
    fn new(head: &[u8], len: u64) -> Self {
        let mut s = SparseFile {
            len,
            pos: 0,
            bytes: BTreeMap::new(),
        };
        s.put(0, head);
        s
    }
    fn put(&mut self, off: u64, b: &[u8]) {
        for (i, v) in b.iter().enumerate() {
            self.bytes.insert(off + i as u64, *v);
        }
    }
}

impl Read for SparseFile {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = buf
            .len()
            .min(usize::try_from(self.len.saturating_sub(self.pos)).unwrap_or(usize::MAX));
        for (i, slot) in buf[..n].iter_mut().enumerate() {
            *slot = self.bytes.get(&(self.pos + i as u64)).copied().unwrap_or(0);
        }
        self.pos += n as u64;
        Ok(n)
    }
}
impl Seek for SparseFile {
    fn seek(&mut self, p: SeekFrom) -> std::io::Result<u64> {
        self.pos = match p {
            SeekFrom::Start(o) => o,
            SeekFrom::End(d) => self.len.checked_add_signed(d).unwrap(),
            SeekFrom::Current(d) => self.pos.checked_add_signed(d).unwrap(),
        };
        Ok(self.pos)
    }
}

fn plan_sparse(f: &mut SparseFile, udta: &[u8]) -> Result<Plan, Fail> {
    let len = f.len;
    plan_rewrite(&mut FileSrc { f, len }, udta)
}

/// `[ftyp, moov(co64 값이 4 GiB 넘음), free, mdat(largesize, 4 GiB 넘음)]`인 5 GiB 파일. `co64` 값이 늘어난 만큼
/// 옮겨지고, `free` 뒤(largesize `mdat` 머리부터)는 바이트 그대로 옮긴다.
#[test]
fn big_file_with_co64_and_largesize_mdat() {
    const TOTAL: u64 = 5 << 30;
    const CHUNK_OFFSET: u64 = (4 << 30) + 123;
    let ftyp = ftyp();
    let moov = synth_moov(&[co64(&[CHUNK_OFFSET])]);
    let free = put(b"free", &[]);
    let head_len = (ftyp.len() + moov.len() + free.len()) as u64;
    let mdat_size = TOTAL - head_len;
    let mut mdat_hdr = 1u32.to_be_bytes().to_vec();
    mdat_hdr.extend_from_slice(b"mdat");
    mdat_hdr.extend_from_slice(&mdat_size.to_be_bytes());
    let head = [ftyp.clone(), moov.clone(), free, mdat_hdr].concat();
    let mut f = SparseFile::new(&head, TOTAL);

    let Plan::Rewrite(p) = plan_sparse(&mut f, &udta()).unwrap() else {
        panic!("다시 써야 한다");
    };
    assert_eq!(p.before, ftyp.len() as u64);
    assert_eq!(
        p.after, head_len,
        "free(8)를 빼고 largesize mdat 머리부터 옮긴다"
    );
    assert_eq!(p.src_len, TOTAL);
    let delta = p.out_len() as i64 - TOTAL as i64;
    assert_eq!(delta, (p.moov.len() - moov.len() - 8) as i64);
    let new = mp4::chunk_offsets(&p.moov[8..]).unwrap();
    assert_eq!(new, [CHUNK_OFFSET + delta as u64]);
    // 새 moov = 옛 자식(co64 값만 옮김) + 새 udta
    let shifted = synth_moov(&[co64(&[CHUNK_OFFSET + delta as u64])]);
    assert_eq!(p.moov, put(b"moov", &[&shifted[8..], &udta()[..]].concat()));
}

#[test]
fn huge_moov_is_rejected_before_reading_its_body() {
    // 65 MiB라고 적힌 moov(본문은 읽지도 않는다)
    const LEN: u64 = 70 << 20;
    let ftyp = ftyp();
    let mut moov_hdr = u32::try_from(65u64 << 20).unwrap().to_be_bytes().to_vec();
    moov_hdr.extend_from_slice(b"moov");
    let mut f = SparseFile::new(&[ftyp.clone(), moov_hdr].concat(), LEN);
    // 나머지는 free 하나로 채워 상자가 파일 끝에 딱 맞게 한다
    let used = ftyp.len() as u64 + (65 << 20);
    let mut free = u32::try_from(LEN - used).unwrap().to_be_bytes().to_vec();
    free.extend_from_slice(b"free");
    f.put(used, &free);
    let e = plan_sparse(&mut f, &udta()).unwrap_err();
    assert!(format!("{e:?}").contains("너무 크다"), "{e:?}");
}

/// `moov` 뒤 `free`가 `MAX_META_BOX`를 넘으면 흡수하지 않는다: 새 `moov`가 `free` 크기만큼 메모리를 쓰지 않고, 뒤를
/// `delta`만큼 옮긴다(Codex medium). 흡수하면 `moov`가 1 GiB가 된다.
#[test]
fn huge_free_after_moov_is_not_absorbed() {
    const TOTAL: u64 = 1 << 30;
    const CHUNK_OFFSET: u32 = 200;
    let ftyp = ftyp();
    let moov = synth_moov(&[stco(&[CHUNK_OFFSET])]);
    let head_len = (ftyp.len() + moov.len()) as u64;
    let free_len = TOTAL - head_len - 8;
    let mut free_hdr = u32::try_from(free_len).unwrap().to_be_bytes().to_vec();
    free_hdr.extend_from_slice(b"free");
    let mut mdat = 8u32.to_be_bytes().to_vec();
    mdat.extend_from_slice(b"mdat");
    let mut f = SparseFile::new(&[ftyp.clone(), moov.clone(), free_hdr].concat(), TOTAL);
    f.put(TOTAL - 8, &mdat);

    let Plan::Rewrite(p) = plan_sparse(&mut f, &udta()).unwrap() else {
        panic!("다시 써야 한다");
    };
    assert!(
        p.moov.len() < 1 << 20,
        "free를 메모리에 만들면 안 된다: {}",
        p.moov.len()
    );
    assert_eq!(p.after, head_len, "free는 흡수하지 않고 뒤로 옮긴다");
    let delta = p.moov.len() as i64 - moov.len() as i64;
    assert_eq!(p.out_len() as i64 - TOTAL as i64, delta);
    assert_eq!(
        mp4::chunk_offsets(&p.moov[8..]).unwrap(),
        [(i64::from(CHUNK_OFFSET) + delta) as u64]
    );
}
