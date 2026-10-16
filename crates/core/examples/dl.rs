//! 수동 스모크 CLI(실서버). 코어 API만으로 조회 → 화질 선택 → 다운로드 → MP4 상자 검사를 한다.
//!
//! ```text
//! cargo run -p chzzk-core --example dl -- <VOD·클립 주소> [옵션]
//!   --list            화질만 보여 주고 끝낸다
//!   --quality <q>     화질 id 또는 라벨(예: 720p). 없으면 기본 선택(가장 큰 화질)
//!   --lowest          가장 작은 화질
//!   --out <dir>       저장 폴더(기본: 현재 폴더)
//!   --limit-mb <n>    n MiB를 받으면 취소하고 `.part`를 검사한 뒤 지운다
//!   --keep            --limit-mb로 멈춘 `.part`를 지우지 않는다(다시 실행하면 이어받는다)
//!   --range <A~B>     빠른 다시보기의 시각 구간만 받는다(A·B는 H:MM:SS, M:SS, 초). B를 비우면(A~) 끝까지.
//!                     결과는 코어 경로 그대로(마무리 때 일반 mp4로 변환). 이름 끝에 " (H.MM.SS~H.MM.SS)"를 붙인다.
//!                     이름이 길면 제목 쪽을 줄여 접미사를 지킨다.
//!                     보조로 "EXTINF 누적 = 영상 길이(±1조각)"를 같다/다르다/모름(실패면 확인 못 함)으로만 찍는다(원점 검사가 아니다).
//! ```
//!
//! 성인 컨텐츠는 환경 변수 `CHZZK_NID_AUT`, `CHZZK_NID_SES`로 쿠키를 준다(값은 출력하지 않는다).
//! `CHZZK_COOKIES_ON_MEDIA=1`이면 미디어 요청에도 쿠키를 보낸다(성인 PD 실측용).

use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use chzzk_core::download::part::part_path;
use chzzk_core::naming::{default_filename, output_path, range_stem};
use chzzk_core::progress::{format_bytes, format_hms};
use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, DownloadOutcome, DownloadRequest, DuplicatePolicy,
    Error, NaverCookies, Platform, Progress, Quality, Resolved, Source, TimeRange, discard_partial,
    parse_content_url,
};

#[path = "../tests/support/mp4.rs"]
mod mp4;

struct Args {
    url: String,
    list: bool,
    quality: Option<String>,
    lowest: bool,
    out: PathBuf,
    limit_bytes: Option<u64>,
    keep: bool,
    range: Option<TimeRange>,
}

fn parse_args() -> Result<Args, String> {
    let mut it = std::env::args().skip(1);
    let mut a = Args {
        url: String::new(),
        list: false,
        quality: None,
        lowest: false,
        out: PathBuf::from("."),
        limit_bytes: None,
        keep: false,
        range: None,
    };
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--list" => a.list = true,
            "--lowest" => a.lowest = true,
            "--keep" => a.keep = true,
            "--quality" => a.quality = Some(it.next().ok_or("--quality 값이 없습니다")?),
            "--out" => a.out = it.next().ok_or("--out 값이 없습니다")?.into(),
            "--range" => {
                a.range = Some(parse_range(&it.next().ok_or("--range 값이 없습니다")?)?);
            }
            "--limit-mb" => {
                let n: u64 = it
                    .next()
                    .ok_or("--limit-mb 값이 없습니다")?
                    .parse()
                    .map_err(|_| "--limit-mb는 정수입니다")?;
                a.limit_bytes = Some(
                    n.checked_mul(1 << 20)
                        .ok_or("--limit-mb 값이 너무 큽니다")?,
                );
            }
            s if s.starts_with("--") => return Err(format!("모르는 옵션: {s}")),
            s => a.url = s.to_string(),
        }
    }
    if a.url.is_empty() {
        return Err("주소가 없습니다. 사용법은 examples/dl.rs 머리 주석".into());
    }
    Ok(a)
}

/// `H:MM:SS`·`M:SS`·`S`를 ms로. `:`로 나눈 1~3개의 0 이상 정수이고, 2·3개일 때 분·초는 0~59다.
fn parse_clock(s: &str) -> Result<u64, String> {
    let bad = || format!("시각 '{s}'을 읽지 못했습니다(H:MM:SS, M:SS, 초)");
    let parts: Vec<&str> = s.trim().split(':').collect();
    if parts.len() > 3
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(bad());
    }
    let nums = parts
        .iter()
        .map(|p| p.parse::<u64>().map_err(|_| bad()))
        .collect::<Result<Vec<_>, _>>()?;
    let (h, m, sec) = match nums[..] {
        [s] => (0, 0, s),
        [m, s] => (0, m, s),
        [h, m, s] => (h, m, s),
        _ => return Err(bad()),
    };
    // 2·3개일 때 분·초는 0~59다(시 자리만 제한이 없다).
    if nums.len() >= 2 && (m > 59 || sec > 59) {
        return Err(bad());
    }
    h.checked_mul(3600)
        .and_then(|x| x.checked_add(m * 60 + sec))
        .and_then(|x| x.checked_mul(1000))
        .ok_or_else(bad)
}

/// `A~B`(B를 비우면 끝까지). `~`는 정확히 한 번이다. 시작이 끝보다 늦은 것은 코어가 거른다.
fn parse_range(s: &str) -> Result<TimeRange, String> {
    let mut it = s.split('~');
    let (Some(a), Some(b), None) = (it.next(), it.next(), it.next()) else {
        return Err(format!("--range는 A~B 모양이어야 합니다: '{s}'"));
    };
    let end_ms = if b.trim().is_empty() {
        None
    } else {
        Some(parse_clock(b)?)
    };
    Ok(TimeRange {
        start_ms: parse_clock(a)?,
        end_ms,
    })
}

/// 구간 파일 이름(확장자 포함). 접미사·제목 줄이기는 코어 `naming::range_stem`이 한다(앱 셸과 같은 규칙).
fn range_name(name: &str, r: TimeRange) -> String {
    format!("{}.mp4", range_stem(name, &r, Platform::current()))
}

/// 보조 대조: playlist의 EXTINF 누적이 영상 길이(±1조각)와 같은가. 원점이 맞는지는 증명하지 않는다.
/// 주소(서명 토큰 포함)는 어디에도 찍지 않는다.
async fn extinf_check(r: &Resolved, quality: &Quality) -> String {
    let Source::LiveRewindHls { master_url, .. } = &r.source else {
        return "해당 없음".into();
    };
    match extinf_total(master_url, quality).await {
        Ok((total, max_seg)) => match r.meta.duration_secs {
            Some(d) => {
                let want = (d * 1000.0).round() as i64;
                if (total as i64 - want).unsigned_abs() <= max_seg {
                    "같다".into()
                } else {
                    "다르다".into()
                }
            }
            None => "모름".into(),
        },
        // 단계 이름은 내지 않는다(설계 §8은 판정만 찍는다)
        Err(_) => "확인 못 함".into(),
    }
}

/// (EXTINF 누적 ms, 가장 긴 조각 ms). 실패하면 단계 이름만 돌려준다(오류 문자열에 주소가 들어가지 않게).
async fn extinf_total(
    master_url: &::url::Url,
    quality: &Quality,
) -> Result<(u64, u64), &'static str> {
    use reqwest::header::{REFERER, USER_AGENT};
    let http = reqwest::Client::new();
    let get = |u: &::url::Url| {
        http.get(u.clone())
            .header(USER_AGENT, chzzk_core::http::user_agent())
            .header(REFERER, "https://chzzk.naver.com/")
            .send()
    };
    let master = get(master_url)
        .await
        .map_err(|_| "master 요청")?
        .error_for_status()
        .map_err(|_| "master 응답")?
        .text()
        .await
        .map_err(|_| "master 본문")?;
    let variants = chzzk_core::hls::parse_master(&master, master_url).map_err(|_| "master 해석")?;
    let v = variants
        .iter()
        .find(|v| v.track_id == quality.id)
        .or_else(|| {
            variants
                .iter()
                .find(|v| v.height.is_some() && v.height == quality.height)
        })
        .ok_or("화질 없음")?;
    let media = get(&v.uri)
        .await
        .map_err(|_| "media 요청")?
        .error_for_status()
        .map_err(|_| "media 응답")?
        .text()
        .await
        .map_err(|_| "media 본문")?;
    let pl = chzzk_core::hls::parse_media(&media, &v.uri).map_err(|_| "media 해석")?;
    let max_seg = pl
        .segments
        .iter()
        .map(|s| u64::from(s.duration_ms))
        .max()
        .unwrap_or(0);
    Ok((pl.total_duration_ms, max_seg))
}

fn cookies_from_env() -> Option<NaverCookies> {
    let aut = std::env::var("CHZZK_NID_AUT").ok()?;
    let ses = std::env::var("CHZZK_NID_SES").ok()?;
    (!aut.trim().is_empty() && !ses.trim().is_empty()).then(|| NaverCookies::new(aut, ses))
}

fn print_progress(p: &Progress) {
    let total = p
        .total_bytes
        .or(p.total_bytes_estimate)
        .map(|t| format!(" / {}", format_bytes(t)))
        .unwrap_or_default();
    let seg = p
        .segments
        .map(|(d, t)| format!(" seg {d}/{t}"))
        .unwrap_or_default();
    let speed = p
        .speed_bps
        .map(|s| format!(" {}/s", format_bytes(s)))
        .unwrap_or_default();
    let eta = p
        .eta_secs
        .map(|s| format!(" ETA {}", format_hms(s)))
        .unwrap_or_default();
    eprint!(
        "\r{:?} {}{total}{seg}{speed}{eta}          ",
        p.phase,
        format_bytes(p.bytes)
    );
    let _ = std::io::stderr().flush();
}

/// 파일의 상위 상자를 검사해 출력한다. 첫 상자는 `ftyp`여야 한다.
fn check_mp4(path: &std::path::Path) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let w = mp4::walk_boxes(&bytes)?;
    let types = w.types();
    let shown: Vec<_> = types.iter().take(12).collect();
    println!(
        "상자 {}개{}: {shown:?}{}",
        types.len(),
        if w.truncated {
            "(마지막 잘림)"
        } else {
            ""
        },
        if types.len() > 12 { " …" } else { "" }
    );
    if types.first() != Some(&"ftyp") {
        return Err(format!("첫 상자가 ftyp가 아닙니다: {types:?}"));
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    if let Err(e) = run(args).await {
        eprintln!("\n실패: {e}");
        std::process::exit(1);
    }
}

async fn run(args: Args) -> Result<(), String> {
    let content = parse_content_url(&args.url).map_err(|e| e.to_string())?;
    let cookies = cookies_from_env();
    let cfg = ClientConfig {
        cookies_on_media: cookies.is_some()
            && std::env::var("CHZZK_COOKIES_ON_MEDIA").as_deref() == Ok("1"),
        cookies,
        ..ClientConfig::default()
    };
    let chzzk = Chzzk::new(cfg).map_err(|e| e.to_string())?;
    let r = chzzk.resolve(&content).await.map_err(|e| e.to_string())?;
    println!(
        "{:?} {:?} [{}] {} (성인 {}, 길이 {})",
        r.meta.kind,
        r.kind(),
        r.meta.channel_name,
        r.meta.title,
        r.meta.adult,
        r.meta
            .duration_secs
            .map(|d| format_hms(d as u64))
            .unwrap_or_else(|| "?".into())
    );
    let qs = r.qualities();
    for (i, q) in qs.iter().enumerate() {
        println!(
            "  [{i}] {} id={} {}x{} {}bps {}fps",
            q.label,
            q.id,
            q.width.map(|v| v.to_string()).unwrap_or_default(),
            q.height.map(|v| v.to_string()).unwrap_or_default(),
            q.bandwidth.map(|v| v.to_string()).unwrap_or_default(),
            q.frame_rate.as_deref().unwrap_or("")
        );
    }
    if args.list {
        return Ok(());
    }
    let idx = match (&args.quality, args.lowest) {
        (Some(q), _) => qs
            .iter()
            .position(|x| x.id == *q || x.label == *q)
            .ok_or_else(|| format!("화질 {q}이 없습니다"))?,
        (None, true) => qs
            .iter()
            .enumerate()
            .min_by_key(|(_, q)| q.resolution.or(q.height).unwrap_or(u32::MAX))
            .map(|(i, _)| i)
            .unwrap_or(0),
        (None, false) => r.default_quality(None),
    };
    let quality = qs[idx];
    let p = Platform::current();
    let mut name = default_filename(&r.meta, p);
    if let Some(range) = args.range {
        name = range_name(&name, range);
    }
    let output = output_path(&args.out, &name, p);
    println!("화질 {} → {}", quality.label, output.display());
    if args.range.is_some() && matches!(r.source, Source::LiveRewindHls { .. }) {
        println!(
            "EXTINF 누적과 영상 길이(±1조각): {}",
            extinf_check(&r, quality).await
        );
    }

    let cancel = CancellationToken::new();
    // 생방송은 한도에서 취소가 아니라 "멈춤"(받은 만큼 마무리)으로 끝낸다.
    let live = r.kind() == chzzk_core::PlaybackKind::Live;
    let stop = CancellationToken::new();
    let hit_limit = Arc::new(AtomicBool::new(false));
    let on_progress = {
        let cancel = if live { stop.clone() } else { cancel.clone() };
        let hit_limit = hit_limit.clone();
        let limit = args.limit_bytes;
        move |p: Progress| {
            print_progress(&p);
            if limit.is_some_and(|l| p.bytes >= l) && !hit_limit.swap(true, Ordering::SeqCst) {
                cancel.cancel();
            }
        }
    };
    let req = DownloadRequest {
        content: r.content.clone(),
        quality_id: quality.id.clone(),
        expected_kind: r.kind(),
        output: output.clone(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: live.then(|| stop.clone()),
        recording_id: None,
        range: args.range,
    };
    let kept = req.clone();
    let result = chzzk.download(req, cancel, &on_progress).await;
    eprintln!();
    match result {
        Ok(DownloadOutcome::Completed {
            path,
            bytes,
            resumed_from,
        }) => {
            println!(
                "완료 {} ({}, 이어받기 {})",
                path.display(),
                format_bytes(bytes),
                format_bytes(resumed_from)
            );
            check_mp4(&path)
        }
        Ok(DownloadOutcome::Skipped { path }) => {
            println!("건너뜀 {}", path.display());
            Ok(())
        }
        Err(Error::Cancelled) if hit_limit.load(Ordering::SeqCst) => {
            let part = part_path(&output);
            let len = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
            println!("한도에서 멈춤: .part {}", format_bytes(len));
            let checked = check_mp4(&part);
            if !args.keep {
                discard_partial(&output, &kept.owner()).map_err(|e| e.to_string())?;
            }
            checked
        }
        Err(e) => Err(format!("{e} ({:?})", e.kind())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chzzk_core::naming::MAX_FILENAME_BYTES;

    #[test]
    fn clock_table() {
        for (s, ms) in [
            ("90", 90_000),
            ("0", 0),
            ("1:30", 90_000),
            ("0:00:07", 7_000),
            ("1:02:03", 3_723_000),
            ("10:00:00", 36_000_000),
        ] {
            assert_eq!(parse_clock(s), Ok(ms), "{s}");
        }
        for s in [
            "",
            ":",
            "1:",
            ":1",
            "a",
            "-1",
            "1:60",
            "60:00",
            "1:2:3:4",
            "1:60:00",
            "1.5",
            "99999999999999999999",
        ] {
            assert!(parse_clock(s).is_err(), "{s}");
        }
        // 시간 자리의 곱셈 넘침
        assert!(parse_clock("18446744073709551615:00:00").is_err());
    }

    #[test]
    fn range_table() {
        assert_eq!(
            parse_range("0:10~0:20"),
            Ok(TimeRange {
                start_ms: 10_000,
                end_ms: Some(20_000)
            })
        );
        assert_eq!(
            parse_range("1:00:00~"),
            Ok(TimeRange {
                start_ms: 3_600_000,
                end_ms: None
            })
        );
        for s in ["", "10", "1~2~3", "~5", "a~b", "1~x"] {
            assert!(parse_range(s).is_err(), "{s}");
        }
        // 시작이 끝보다 늦어도 dl은 거르지 않는다(코어가 `RangeOutOfBounds`를 낸다)
        assert!(parse_range("20~10").is_ok());
    }

    #[test]
    fn suffix_and_name() {
        let r = TimeRange {
            start_ms: 3_723_999,
            end_ms: Some(7_200_000),
        };
        assert_eq!(range_name("a", r), "a (1.02.03~2.00.00).mp4");
        let open = TimeRange {
            start_ms: 5_000,
            end_ms: None,
        };
        assert_eq!(range_name("a.MP4", open), "a (0.00.05~).mp4");
    }

    /// 긴 제목이어도 접미사는 남고 제목 쪽이 줄어든다(구간이 다르면 경로도 다르다).
    #[test]
    fn long_name_keeps_suffix() {
        let a = TimeRange {
            start_ms: 0,
            end_ms: Some(10_000),
        };
        let b = TimeRange {
            start_ms: 10_000,
            end_ms: Some(20_000),
        };
        let dir = std::path::Path::new("out");
        for p in [Platform::Windows, Platform::MacOs, Platform::Linux] {
            for long in [
                format!("{}.mp4", "가".repeat(66)),
                format!("{}.mp4", "a".repeat(196)),
                format!("{} .mp4", "가 ".repeat(60)),
            ] {
                let pa = output_path(dir, &range_name(&long, a), p);
                let pb = output_path(dir, &range_name(&long, b), p);
                let na = pa.file_name().unwrap().to_str().unwrap();
                let nb = pb.file_name().unwrap().to_str().unwrap();
                assert!(na.ends_with(" (0.00.00~0.00.10).mp4"), "{p:?} {na}");
                assert!(nb.ends_with(" (0.00.10~0.00.20).mp4"), "{p:?} {nb}");
                assert!(na.len() <= MAX_FILENAME_BYTES, "{}", na.len());
                assert_ne!(pa, pb);
            }
            // 짧은 이름은 그대로 붙인다
            assert_eq!(range_name("짧은.mp4", a), "짧은 (0.00.00~0.00.10).mp4");
        }
    }
}
