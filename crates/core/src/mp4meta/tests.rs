//! `mp4meta` 단위 테스트. 합성 fixture(`testdata/vod/pd_*.mp4`, `testdata/synthetic/thumb.*`)와 손으로 만든 상자만 쓴다.
//! 상자 검사는 통합 테스트와 같은 검사기(`tests/support/mp4.rs`)를 쓴다.

use std::collections::BTreeMap;
use std::io::{Cursor, Read, Seek, SeekFrom, Write};

use super::*;

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
/// 표지 없는 `udta`. 우리 배치가 참조 구현과 바이트까지 같은지 본다(core.md 75).
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
// retag_in: 정상

/// 메모리 파일. 쓰기·자르기·읽기 실패를 주입한다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fault {
    None,
    /// 원래 길이 이후(붙이기)의 쓰기 실패, 자르기는 성공
    Append,
    /// 붙이기 실패 + 자르기 실패
    AppendAndTruncate,
    /// 원래 길이 안쪽(종류 패치)의 쓰기 실패
    Patch,
    /// 첫 읽기 실패
    Read,
}

struct MemFile {
    c: Cursor<Vec<u8>>,
    base: u64,
    fault: Fault,
    reads: u32,
}

impl MemFile {
    fn new(b: &[u8], fault: Fault) -> Self {
        MemFile {
            c: Cursor::new(b.to_vec()),
            base: b.len() as u64,
            fault,
            reads: 0,
        }
    }
    fn data(&self) -> &[u8] {
        self.c.get_ref()
    }
}

impl Read for MemFile {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.reads += 1;
        if self.fault == Fault::Read && self.reads == 1 {
            return Err(std::io::Error::other("읽기 오류 주입"));
        }
        self.c.read(buf)
    }
}
impl Seek for MemFile {
    fn seek(&mut self, p: SeekFrom) -> std::io::Result<u64> {
        self.c.seek(p)
    }
}
impl Write for MemFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let appending = self.c.position() >= self.base;
        match (self.fault, appending) {
            (Fault::Append | Fault::AppendAndTruncate, true) | (Fault::Patch, false) => {
                Err(std::io::Error::from(std::io::ErrorKind::FileTooLarge))
            }
            _ => self.c.write(buf),
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl DefragFile for MemFile {
    fn file_len(&mut self) -> std::io::Result<u64> {
        Ok(self.c.get_ref().len() as u64)
    }
    fn truncate_to(&mut self, len: u64) -> std::io::Result<()> {
        if self.fault == Fault::AppendAndTruncate {
            return Err(std::io::Error::other("자르기 실패"));
        }
        self.c.get_mut().truncate(len as usize);
        Ok(())
    }
    fn sync(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn retag(b: &[u8], udta: &[u8]) -> (Result<TagReport, TagError>, Vec<u8>) {
    let mut f = MemFile::new(b, Fault::None);
    let r = retag_in(&mut f, udta);
    (r, f.c.into_inner())
}

fn tagged() -> Vec<u8> {
    let (r, out) = retag(PD, &udta());
    assert_eq!(r.unwrap(), TagReport::Tagged);
    out
}

fn types(b: &[u8]) -> Vec<String> {
    mp4::top_boxes(b).into_iter().map(|(k, _)| k).collect()
}

/// `moov` 본문의 자식 중 `udta`가 아닌 것의 바이트.
fn moov_children_without_udta(moov_body: &[u8]) -> Vec<Vec<u8>> {
    mp4::child_boxes(moov_body)
        .unwrap()
        .into_iter()
        .filter(|(k, _)| k != "udta")
        .map(|(_, r)| moov_body[r].to_vec())
        .collect()
}

#[test]
fn retag_appends_new_moov_and_frees_the_old_one() {
    assert_eq!(types(PD), ["ftyp", "moov", "free", "mdat"]);
    let out = tagged();
    assert_eq!(types(&out), ["ftyp", "free", "free", "mdat", "moov"]);
    assert_eq!(mp4::top_moov_count(&out), 1);
    assert_eq!(mp4::freed_moovs(&out).len(), 1);
    // mdat 본문과 그 위치가 그대로다(stco가 가리키는 곳이 움직이지 않는다)
    assert_eq!(mp4::mdat_payloads(&out), mp4::mdat_payloads(PD));
    let (_, mdat_before) = mp4::top_boxes(PD)
        .into_iter()
        .find(|(k, _)| k == "mdat")
        .unwrap();
    let (_, mdat_after) = mp4::top_boxes(&out)
        .into_iter()
        .find(|(k, _)| k == "mdat")
        .unwrap();
    assert_eq!(mdat_before, mdat_after);
    // 새 moov는 udta 외 자식이 옛 moov와 바이트까지 같다
    let old = mp4::find_path(PD, &["moov"]).unwrap();
    let new = mp4::find_path_last(&out, &["moov"]).unwrap();
    assert_eq!(
        moov_children_without_udta(old),
        moov_children_without_udta(new)
    );
    // 옛 moov는 종류만 바뀌었다
    let freed = mp4::freed_moovs(&out)[0];
    let (_, old_range) = mp4::top_boxes(PD)
        .into_iter()
        .find(|(k, _)| k == "moov")
        .unwrap();
    assert_eq!(freed, old_range.start - 8);
    assert_eq!(&out[freed + 12..freed + 16], b"mvhd");
    // 새 moov에 ilst가 있다
    let ilst = mp4::find_path_last(&out, &["moov", "udta", "meta", "ilst"]).unwrap();
    assert_eq!(mp4::ilst_items(ilst).unwrap().len(), 5);
}

#[test]
fn retag_replaces_an_existing_udta() {
    let before = mp4::find_path(PD_UDTA, &["moov", "udta", "meta", "ilst"]).unwrap();
    assert_eq!(mp4::ilst_items(before).unwrap()[0].0, "©too");
    let (r, out) = retag(PD_UDTA, &udta());
    assert_eq!(r.unwrap(), TagReport::Tagged);
    let new = mp4::find_path_last(&out, &["moov"]).unwrap();
    let udtas = mp4::child_boxes(new)
        .unwrap()
        .into_iter()
        .filter(|(k, _)| k == "udta")
        .count();
    assert_eq!(udtas, 1, "옛 udta는 빼고 새 것 하나만 둔다");
    let ilst = mp4::find_path_last(&out, &["moov", "udta", "meta", "ilst"]).unwrap();
    let kinds: Vec<String> = mp4::ilst_items(ilst)
        .unwrap()
        .into_iter()
        .map(|i| i.0)
        .collect();
    assert!(!kinds.contains(&"©too".to_string()), "{kinds:?}");
    // trak 안의 바이트는 손대지 않는다
    let old = mp4::find_path(PD_UDTA, &["moov"]).unwrap();
    assert_eq!(
        moov_children_without_udta(old),
        moov_children_without_udta(new)
    );
}

#[test]
fn retag_keeps_stco_and_co64_bytes() {
    for pd in [PD, PD_CO64] {
        let out = retag(pd, &udta()).1;
        let table = |b: &[u8], moov: &[u8]| -> Vec<u8> {
            let _ = b;
            let stbl = mp4::find_path(
                &u_in_moov_raw(moov),
                &["moov", "trak", "mdia", "minf", "stbl"],
            )
            .unwrap()
            .to_vec();
            let cs = mp4::child_boxes(&stbl).unwrap();
            let (_, r) = cs
                .into_iter()
                .find(|(k, _)| k == "stco" || k == "co64")
                .unwrap();
            stbl[r].to_vec()
        };
        let old = table(pd, mp4::find_path(pd, &["moov"]).unwrap());
        let new = table(&out, mp4::find_path_last(&out, &["moov"]).unwrap());
        assert_eq!(old, new);
    }
    // co64 fixture는 정말 co64를 쓴다
    let stbl = mp4::find_path(PD_CO64, &["moov", "trak", "mdia", "minf", "stbl"]).unwrap();
    assert!(
        mp4::child_boxes(stbl)
            .unwrap()
            .iter()
            .any(|(k, _)| k == "co64")
    );
}

/// 본문만 있는 `moov`를 다시 상자로 감싼다.
fn u_in_moov_raw(body: &[u8]) -> Vec<u8> {
    u_in_moov(body)
}

#[test]
fn retag_is_idempotent() {
    let once = tagged();
    let (r, twice) = retag(&once, &udta());
    assert_eq!(r.unwrap(), TagReport::AlreadyTagged);
    assert_eq!(once, twice, "바이트가 그대로다");
}

#[test]
fn retag_with_other_tags_appends_again_and_stays_valid() {
    let once = tagged();
    let other = build_udta(
        &Tags {
            name: Some("다른 제목".into()),
            ..Tags::default()
        },
        None,
    )
    .unwrap();
    let (r, out) = retag(&once, &other);
    assert_eq!(r.unwrap(), TagReport::Tagged);
    assert_eq!(mp4::top_moov_count(&out), 1);
    let ilst = mp4::find_path_last(&out, &["moov", "udta", "meta", "ilst"]).unwrap();
    assert_eq!(mp4::ilst_items(ilst).unwrap().len(), 1);
}

// ---------------------------------------------------------------------------------------------
// retag_in: 거부(파일이 그대로)

fn unchanged(b: &[u8]) {
    let (r, out) = retag(b, &udta());
    assert!(matches!(r, Err(TagError::Unchanged(_))), "{r:?}");
    assert_eq!(out, b, "파일은 그대로여야 한다");
}

fn put(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    bx(kind, body)
}

#[test]
fn retag_rejects_unknown_structures_without_touching_the_file() {
    // moov가 없다
    unchanged(&PD[..mp4::top_boxes(PD)[1].1.start - 8]);
    // moov가 둘
    let mut two = PD.to_vec();
    let moov = PD[mp4::top_boxes(PD)[1].1.start - 8..mp4::top_boxes(PD)[1].1.end].to_vec();
    two.extend_from_slice(&moov);
    unchanged(&two);
    // 크기 0(파일 끝까지)인 끝 상자: 붙인 moov를 삼킨다
    let mut zero = PD.to_vec();
    zero.extend_from_slice(&0u32.to_be_bytes());
    zero.extend_from_slice(b"mdat");
    zero.extend_from_slice(&[1, 2, 3]);
    unchanged(&zero);
    // 상자가 파일 끝을 넘는다(잘린 파일)
    unchanged(&PD[..PD.len() - 5]);
    // 가짜 바이트
    unchanged(b"not an mp4 at all, just text.");
    unchanged(b"");
    // mvex가 있는 조각 구조
    let mvhd = mp4::child_boxes(mp4::find_path(PD, &["moov"]).unwrap()).unwrap()[0].clone();
    let old_body = mp4::find_path(PD, &["moov"]).unwrap();
    let mut body = old_body[mvhd.1.start - 8..mvhd.1.end].to_vec();
    body.extend(put(b"mvex", &put(b"trex", &[0; 24])));
    let mut frag = PD[..mp4::top_boxes(PD)[0].1.end].to_vec();
    frag.extend(put(b"moov", &body));
    unchanged(&frag);
}

// ---------------------------------------------------------------------------------------------
// retag_in: 쓰기 실패

#[test]
fn retag_append_failure_is_restored_as_unchanged() {
    let mut f = MemFile::new(PD, Fault::Append);
    let r = retag_in(&mut f, &udta());
    assert!(matches!(r, Err(TagError::Unchanged(_))), "{r:?}");
    assert_eq!(f.data(), PD);
}

#[test]
fn retag_append_failure_not_restored_is_modified() {
    let mut f = MemFile::new(PD, Fault::AppendAndTruncate);
    let r = retag_in(&mut f, &udta());
    assert!(matches!(r, Err(TagError::Modified(_))), "{r:?}");
}

#[test]
fn retag_patch_failure_is_modified_and_recovers_after_truncate() {
    let mut f = MemFile::new(PD, Fault::Patch);
    let r = retag_in(&mut f, &udta());
    assert!(matches!(r, Err(TagError::Modified(_))), "{r:?}");
    assert!(f.data().len() > PD.len(), "붙인 moov가 남았다");
    // 다음 실행의 resume이 원래 길이로 자르면 같은 결과로 다시 붙는다
    let mut cut = f.c.into_inner();
    cut.truncate(PD.len());
    assert_eq!(retag(&cut, &udta()).1, tagged());
}

#[test]
fn retag_read_error_is_modified() {
    let mut f = MemFile::new(PD, Fault::Read);
    let r = retag_in(&mut f, &udta());
    assert!(matches!(r, Err(TagError::Modified(_))), "{r:?}");
    assert_eq!(f.data(), PD);
}

// ---------------------------------------------------------------------------------------------
// 크래시 복구

/// 4단계(종류 패치)까지 마치고 죽은 뒤 `resume`이 붙인 moov를 잘라 낸 모양.
fn crashed_after_patch() -> Vec<u8> {
    let mut b = tagged();
    b.truncate(PD.len());
    b
}

#[test]
fn crashed_file_is_retagged_to_the_same_bytes() {
    let crashed = crashed_after_patch();
    assert_eq!(types(&crashed), ["ftyp", "free", "free", "mdat"]);
    let (r, out) = retag(&crashed, &udta());
    assert_eq!(r.unwrap(), TagReport::Tagged);
    assert_eq!(out, tagged());
}

#[test]
fn crashed_file_with_other_tags_uses_the_new_ones() {
    let crashed = crashed_after_patch();
    let other = build_udta(&tags(), None).unwrap();
    let (r, out) = retag(&crashed, &other);
    assert_eq!(r.unwrap(), TagReport::Tagged);
    let ilst = mp4::find_path_last(&out, &["moov", "udta", "meta", "ilst"]).unwrap();
    assert_eq!(mp4::ilst_items(ilst).unwrap().len(), 4, "표지 없는 태그");
}

#[test]
fn two_recovery_candidates_are_left_alone() {
    let mut b = crashed_after_patch();
    let freed = mp4::freed_moovs(&b)[0];
    let (_, r) = mp4::top_boxes(&b)
        .into_iter()
        .find(|(_, r)| r.start - 8 == freed)
        .unwrap();
    let copy = b[freed..r.end].to_vec();
    b.extend_from_slice(&copy);
    assert_eq!(mp4::freed_moovs(&b).len(), 2);
    unchanged(&b);
    let mut f = MemFile::new(&b, Fault::None);
    assert!(matches!(repair_in(&mut f), Err(TagError::Unchanged(_))));
    assert_eq!(f.data(), b.as_slice());
}

#[test]
fn recovery_append_failure_is_modified_even_when_restored() {
    // 복구 중에는 되돌려도 moov가 없는 파일이라 마무리하면 안 된다
    let crashed = crashed_after_patch();
    let mut f = MemFile::new(&crashed, Fault::Append);
    let r = retag_in(&mut f, &udta());
    assert!(matches!(r, Err(TagError::Modified(_))), "{r:?}");
}

#[test]
fn a_free_that_only_looks_like_a_moov_is_not_a_candidate() {
    // 첫 자식이 mvhd지만 mvex가 있는 free(조각 구조의 init)는 후보가 아니다
    let mut body = put(b"mvhd", &[0; 100]);
    body.extend(put(b"mvex", &[]));
    let mut b = PD[..mp4::top_boxes(PD)[0].1.end].to_vec();
    b.extend(put(b"free", &body));
    b.extend(put(b"mdat", &[0; 8]));
    unchanged(&b);
    let mut f = MemFile::new(&b, Fault::None);
    assert_eq!(repair_in(&mut f).unwrap(), TagReport::NotApplicable);
    assert_eq!(f.data(), b.as_slice());
}

#[test]
fn repair_restores_the_original_pd_file_byte_for_byte() {
    let mut f = MemFile::new(&crashed_after_patch(), Fault::None);
    assert_eq!(repair_in(&mut f).unwrap(), TagReport::Repaired);
    assert_eq!(f.data(), PD);
}

#[test]
fn repair_does_nothing_when_a_moov_exists() {
    for b in [PD.to_vec(), tagged()] {
        let mut f = MemFile::new(&b, Fault::None);
        assert_eq!(repair_in(&mut f).unwrap(), TagReport::NotApplicable);
        assert_eq!(f.data(), b.as_slice());
    }
}

#[test]
fn repair_on_garbage_is_unchanged_and_write_failure_is_modified() {
    let mut f = MemFile::new(b"definitely not an mp4 file", Fault::None);
    assert!(matches!(repair_in(&mut f), Err(TagError::Unchanged(_))));
    let mut f = MemFile::new(&crashed_after_patch(), Fault::Patch);
    assert!(matches!(repair_in(&mut f), Err(TagError::Modified(_))));
}

// ---------------------------------------------------------------------------------------------
// 큰 파일(co64·largesize)

/// 쓴 구간만 들고 길이는 `len`으로 보이는 희소 파일. 실제 디스크에 큰 파일을 만들지 않는다
/// (Windows NTFS `set_len`은 희소 파일을 보장하지 않는다).
struct SparseFile {
    len: u64,
    pos: u64,
    bytes: BTreeMap<u64, u8>,
}

impl SparseFile {
    fn new(head: &[u8], at: &[(u64, Vec<u8>)], len: u64) -> Self {
        let mut s = SparseFile {
            len,
            pos: 0,
            bytes: BTreeMap::new(),
        };
        s.put(0, head);
        for (off, b) in at {
            s.put(*off, b);
        }
        s
    }
    fn put(&mut self, off: u64, b: &[u8]) {
        for (i, v) in b.iter().enumerate() {
            self.bytes.insert(off + i as u64, *v);
        }
    }
    fn get(&self, off: u64, n: usize) -> Vec<u8> {
        (0..n as u64)
            .map(|i| self.bytes.get(&(off + i)).copied().unwrap_or(0))
            .collect()
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
impl Write for SparseFile {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.put(self.pos, buf);
        self.pos += buf.len() as u64;
        self.len = self.len.max(self.pos);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
impl DefragFile for SparseFile {
    fn file_len(&mut self) -> std::io::Result<u64> {
        Ok(self.len)
    }
    fn truncate_to(&mut self, len: u64) -> std::io::Result<()> {
        self.len = len;
        self.bytes.retain(|k, _| *k < len);
        Ok(())
    }
    fn sync(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// `[ftyp, moov(co64 값이 4 GiB 넘음), free, mdat(largesize, 4 GiB 넘음)]`인 5 GiB 파일.
#[test]
fn big_file_with_co64_and_largesize_mdat() {
    const TOTAL: u64 = 5 << 30;
    const CHUNK_OFFSET: u64 = (4 << 30) + 123;
    let ftyp = put(b"ftyp", b"isom\0\0\x02\0isom");
    let mut co64_body = vec![0u8; 4];
    co64_body.extend_from_slice(&1u32.to_be_bytes());
    co64_body.extend_from_slice(&CHUNK_OFFSET.to_be_bytes());
    let co64 = put(b"co64", &co64_body);
    let stbl = put(b"stbl", &co64);
    let mvhd = put(b"mvhd", &[0; 100]);
    let moov = put(
        b"moov",
        &[
            mvhd.clone(),
            put(b"trak", &put(b"mdia", &put(b"minf", &stbl))),
        ]
        .concat(),
    );
    let free = put(b"free", &[]);
    let head_len = (ftyp.len() + moov.len() + free.len()) as u64;
    let mdat_size = TOTAL - head_len;
    let mut mdat_hdr = 1u32.to_be_bytes().to_vec();
    mdat_hdr.extend_from_slice(b"mdat");
    mdat_hdr.extend_from_slice(&mdat_size.to_be_bytes());
    let head = [ftyp.clone(), moov.clone(), free, mdat_hdr].concat();
    let mut f = SparseFile::new(&head, &[], TOTAL);

    let r = retag_in(&mut f, &udta());
    assert_eq!(r.unwrap(), TagReport::Tagged);

    // 새 moov는 5 GiB 위치에 붙었다
    let new_off = TOTAL;
    assert_eq!(f.get(new_off + 4, 4), b"moov");
    let new_len = u32::from_be_bytes(f.get(new_off, 4).try_into().unwrap()) as u64;
    assert_eq!(f.len, TOTAL + new_len);
    let new_moov = f.get(new_off, new_len as usize);
    // co64 항목이 바이트 그대로다(표 다시 쓰기가 없다)
    assert!(new_moov.windows(8).any(|w| w == CHUNK_OFFSET.to_be_bytes()));
    let new_stbl = mp4::find_path(&new_moov, &["moov", "trak", "mdia", "minf", "stbl"]).unwrap();
    assert_eq!(new_stbl, &stbl[8..]);
    // 옛 moov는 free가 됐고 mdat 머리는 그대로다
    let old_off = ftyp.len() as u64;
    assert_eq!(f.get(old_off + 4, 4), b"free");
    assert_eq!(f.get(old_off + 8 + 4, 4), b"mvhd");
    let mdat_off = head_len;
    assert_eq!(f.get(mdat_off, 4), 1u32.to_be_bytes());
    assert_eq!(f.get(mdat_off + 8, 8), mdat_size.to_be_bytes());
    // 검사기가 largesize를 따라간다: 머리(앞 3개 + mdat 머리)만 메모리에 올려 확인한다
    let mut hdr = f.get(0, head_len as usize + 16);
    let sizes = mp4::walk_boxes(&hdr).unwrap();
    assert_eq!(sizes.types(), ["ftyp", "free", "free", "mdat"]);
    assert!(
        sizes.truncated,
        "mdat이 잘려 보이는 것은 머리만 올렸기 때문이다"
    );
    hdr.clear();
    // 다시 부르면 이미 태그됐다
    assert_eq!(retag_in(&mut f, &udta()).unwrap(), TagReport::AlreadyTagged);
}

#[test]
fn huge_moov_is_rejected_before_reading_its_body() {
    // 65 MiB라고 적힌 moov(본문은 읽지도 않는다)
    const LEN: u64 = 70 << 20;
    let ftyp = put(b"ftyp", b"isom\0\0\x02\0isom");
    let mut moov_hdr = u32::try_from(65u64 << 20).unwrap().to_be_bytes().to_vec();
    moov_hdr.extend_from_slice(b"moov");
    let mut tail = 0u32.to_be_bytes().to_vec();
    tail.clear();
    let mut f = SparseFile::new(&[ftyp.clone(), moov_hdr].concat(), &[], LEN);
    // 나머지는 free 하나로 채워 상자가 파일 끝에 딱 맞게 한다
    let used = ftyp.len() as u64 + (65 << 20);
    let mut free = u32::try_from(LEN - used).unwrap().to_be_bytes().to_vec();
    free.extend_from_slice(b"free");
    f.put(used, &free);
    let r = retag_in(&mut f, &udta());
    assert!(matches!(r, Err(TagError::Unchanged(_))), "{r:?}");
    assert_eq!(f.len, LEN);
}
