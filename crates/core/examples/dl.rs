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
//! ```
//!
//! 성인 컨텐츠는 환경 변수 `CHZZK_NID_AUT`, `CHZZK_NID_SES`로 쿠키를 준다(값은 출력하지 않는다).
//! `CHZZK_COOKIES_ON_MEDIA=1`이면 미디어 요청에도 쿠키를 보낸다(성인 PD 실측용).

use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use chzzk_core::download::part::part_path;
use chzzk_core::naming::{default_filename, output_path};
use chzzk_core::progress::{format_bytes, format_hms};
use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, DownloadOutcome, DownloadRequest, DuplicatePolicy,
    Error, NaverCookies, Platform, Progress, discard_partial, parse_content_url,
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
    };
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--list" => a.list = true,
            "--lowest" => a.lowest = true,
            "--keep" => a.keep = true,
            "--quality" => a.quality = Some(it.next().ok_or("--quality 값이 없습니다")?),
            "--out" => a.out = it.next().ok_or("--out 값이 없습니다")?.into(),
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
    let output = output_path(&args.out, &default_filename(&r.meta, p), p);
    println!("화질 {} → {}", quality.label, output.display());

    let cancel = CancellationToken::new();
    let hit_limit = Arc::new(AtomicBool::new(false));
    let on_progress = {
        let cancel = cancel.clone();
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
    };
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
                discard_partial(&output).map_err(|e| e.to_string())?;
            }
            checked
        }
        Err(e) => Err(format!("{e} ({:?})", e.kind())),
    }
}
