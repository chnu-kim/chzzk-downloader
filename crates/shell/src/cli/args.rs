//! 명령줄 인자 해석(cli-mode.md §3.3, 결정 O5 (a): 손으로 짠 파서, 새 의존성 없음).
//!
//! 하위 명령 다섯(`download`·`info`·`status`·`login`·`help`)과 깃발 여섯이라 표 하나로 충분하다.
//! - `--깃발 값`과 `--깃발=값`을 둘 다 받는다. 같은 깃발이 두 번이면 사용법 오류다.
//! - `--` 뒤는 모두 주소로 본다.
//! - 인자는 `OsString`으로 받고 UTF-8이 아니면 사용법 오류다.
//! - 주소는 여기서 한 번 읽어 본다. 잘못된 주소와 생방송 주소(v1 제외, O8)는 데이터 폴더를 열기 전에 끝난다.

use std::ffi::{OsStr, OsString};

use chzzk_core::{ContentRef, parse_content_url};

use super::copy;
use crate::dto::TimeRangeDto;
use crate::format::parse_clock;

/// 하위 명령 이름. 앞으로 **더하기만** 한다(GUI가 받는 인자와 겹치면 안 된다, cli-mode.md §3.1).
pub const SUBCOMMANDS: [&str; 5] = ["download", "info", "status", "login", "help"];

/// 첫 인자가 하위 명령이면 CLI로 갈린다(정확히 일치할 때만). `--smoke`·`-psn_…`·인자 없음은 GUI다.
pub fn wants_cli(first: Option<&OsStr>) -> bool {
    first
        .and_then(OsStr::to_str)
        .is_some_and(|s| SUBCOMMANDS.contains(&s))
}

/// 사용법 오류(종료 코드 2). 문구는 사용자에게 그대로 보인다.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsageError(pub String);

impl std::fmt::Display for UsageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for UsageError {}

fn usage(msg: impl Into<String>) -> UsageError {
    UsageError(msg.into())
}

/// 해석한 명령.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Command {
    Download(DownloadArgs),
    Info {
        url: String,
    },
    Status,
    Login,
    /// `help [<명령>]`. 명령 이름이 있으면 그 명령의 사용법만
    Help {
        topic: Option<String>,
    },
}

/// `download`의 인자.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DownloadArgs {
    /// 한 개 이상. 입력 순서대로 받는다
    pub urls: Vec<String>,
    /// 화질 라벨(정확 일치, 대소문자 무시는 실행 때 한다)
    pub quality: Option<String>,
    /// 저장 폴더(상대 경로는 실행 때 현재 폴더 기준으로 바꾼다)
    pub out: Option<String>,
    /// 구간(ms). 끝을 비우면 끝까지
    pub range: Option<TimeRangeDto>,
    /// 이 실행의 작업당 속도 상한(바이트/초). `Some(0)`은 이 실행에서 끔
    pub rate: Option<u64>,
    /// 이미 있는 파일을 덮어쓴다
    pub overwrite: bool,
}

/// `args`는 프로그램 이름을 뺀 인자다.
pub fn parse<I>(args: I) -> Result<Command, UsageError>
where
    I: IntoIterator<Item = OsString>,
{
    let mut it = args
        .into_iter()
        .map(|a| a.into_string().map_err(|_| usage(copy::USAGE_NOT_UTF8)));
    let Some(first) = it.next() else {
        return Err(usage(copy::USAGE_NO_COMMAND));
    };
    let first = first?;
    let rest = it.collect::<Result<Vec<_>, _>>()?;
    match first.as_str() {
        "download" => parse_download(&rest).map(Command::Download),
        "info" => parse_info(&rest),
        "status" => no_args("status", &rest).map(|()| Command::Status),
        "login" => no_args("login", &rest).map(|()| Command::Login),
        "help" => parse_help(&rest),
        other => Err(usage(copy::unknown_command(other))),
    }
}

fn no_args(name: &str, rest: &[String]) -> Result<(), UsageError> {
    match rest.first() {
        None => Ok(()),
        Some(a) => Err(usage(copy::unexpected_argument(name, a))),
    }
}

fn parse_help(rest: &[String]) -> Result<Command, UsageError> {
    match rest {
        [] => Ok(Command::Help { topic: None }),
        [t] if SUBCOMMANDS.contains(&t.as_str()) => Ok(Command::Help {
            topic: Some(t.clone()),
        }),
        [t] => Err(usage(copy::unknown_command(t))),
        [_, extra, ..] => Err(usage(copy::unexpected_argument("help", extra))),
    }
}

fn parse_info(rest: &[String]) -> Result<Command, UsageError> {
    let mut urls = Vec::new();
    let mut after_dashes = false;
    for a in rest {
        if !after_dashes && a == "--" {
            after_dashes = true;
        } else if !after_dashes && a.starts_with("--") {
            return Err(usage(copy::unknown_flag("info", a)));
        } else {
            urls.push(a.clone());
        }
    }
    match urls.as_slice() {
        [] => Err(usage(copy::missing_url("info"))),
        [u] => Ok(Command::Info { url: check_url(u)? }),
        [_, extra, ..] => Err(usage(copy::unexpected_argument("info", extra))),
    }
}

/// 주소 하나를 읽어 본다. 잘못된 주소·생방송 주소는 사용법 오류다.
fn check_url(url: &str) -> Result<String, UsageError> {
    match parse_content_url(url) {
        Ok(ContentRef::Live { .. }) => Err(usage(copy::LIVE_UNSUPPORTED)),
        Ok(_) => Ok(url.trim().to_string()),
        Err(_) => Err(usage(copy::invalid_url(url))),
    }
}

fn parse_download(rest: &[String]) -> Result<DownloadArgs, UsageError> {
    let mut out = DownloadArgs::default();
    let mut seen: Vec<&'static str> = Vec::new();
    let mut after_dashes = false;
    let mut i = 0;
    while i < rest.len() {
        let a = &rest[i];
        i += 1;
        if after_dashes || !a.starts_with("--") {
            out.urls.push(check_url(a)?);
            continue;
        }
        if a == "--" {
            after_dashes = true;
            continue;
        }
        let (name, inline) = match a.split_once('=') {
            Some((n, v)) => (n, Some(v.to_string())),
            None => (a.as_str(), None),
        };
        let flag: &'static str = match name {
            "--quality" => "--quality",
            "--out" => "--out",
            "--range" => "--range",
            "--rate" => "--rate",
            "--overwrite" => "--overwrite",
            _ => return Err(usage(copy::unknown_flag("download", name))),
        };
        if seen.contains(&flag) {
            return Err(usage(copy::duplicate_flag(flag)));
        }
        seen.push(flag);
        if flag == "--overwrite" {
            if inline.is_some() {
                return Err(usage(copy::flag_takes_no_value(flag)));
            }
            out.overwrite = true;
            continue;
        }
        let value = match inline {
            Some(v) => v,
            None => {
                let v = rest
                    .get(i)
                    .ok_or_else(|| usage(copy::missing_value(flag)))?;
                i += 1;
                v.clone()
            }
        };
        match flag {
            "--quality" => out.quality = Some(value),
            "--out" => {
                if value.is_empty() {
                    return Err(usage(copy::missing_value(flag)));
                }
                out.out = Some(value);
            }
            "--range" => out.range = Some(parse_range(&value)?),
            "--rate" => out.rate = Some(parse_rate(&value)?),
            _ => unreachable!("깃발 표와 이 match는 함께 바뀐다"),
        }
    }
    if out.urls.is_empty() {
        return Err(usage(copy::missing_url("download")));
    }
    Ok(out)
}

/// `<시작>-<끝>`: 각각 `H:MM:SS`·`M:SS`(`parse_clock`과 같다). 끝을 비우면 끝까지다.
pub fn parse_range(s: &str) -> Result<TimeRangeDto, UsageError> {
    let bad = || usage(copy::invalid_range(s));
    let (a, b) = s.split_once('-').ok_or_else(bad)?;
    let start_ms = parse_clock(a).ok_or_else(bad)?;
    let end_ms = if b.trim().is_empty() {
        None
    } else {
        Some(parse_clock(b).ok_or_else(bad)?)
    };
    if end_ms.is_some_and(|e| e <= start_ms) {
        return Err(bad());
    }
    Ok(TimeRangeDto { start_ms, end_ms })
}

/// 속도: 바이트/초 정수에 `k`·`m` 접미사(1000 진법, 대소문자 무시). 최소값 규칙은 설정과 같다
/// (`normalize_rate_limit`: 0은 끔, 최소보다 작은 양의 값은 최소로 올린다).
pub fn parse_rate(s: &str) -> Result<u64, UsageError> {
    let bad = || usage(copy::invalid_rate(s));
    let t = s.trim();
    let (digits, mult) = match t.chars().last() {
        Some('k' | 'K') => (&t[..t.len() - 1], 1_000u64),
        Some('m' | 'M') => (&t[..t.len() - 1], 1_000_000u64),
        _ => (t, 1u64),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(bad());
    }
    let n: u64 = digits.parse().map_err(|_| bad())?;
    let bps = n.checked_mul(mult).ok_or_else(bad)?;
    Ok(chzzk_core::settings::normalize_rate_limit(bps).unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(args: &[&str]) -> Result<Command, UsageError> {
        parse(args.iter().map(OsString::from))
    }

    const V: &str = "https://chzzk.naver.com/video/123";
    const V2: &str = "https://chzzk.naver.com/video/456";

    #[test]
    fn wants_cli_only_for_exact_subcommands() {
        for c in SUBCOMMANDS {
            assert!(wants_cli(Some(OsStr::new(c))), "{c}");
        }
        for c in ["--smoke", "-psn_0_1", "Download", "downloads", "", "help2"] {
            assert!(!wants_cli(Some(OsStr::new(c))), "{c}");
        }
        assert!(!wants_cli(None));
    }

    #[test]
    fn subcommand_table() {
        assert_eq!(p(&["status"]).unwrap(), Command::Status);
        assert_eq!(p(&["login"]).unwrap(), Command::Login);
        assert_eq!(p(&["help"]).unwrap(), Command::Help { topic: None });
        assert_eq!(
            p(&["help", "download"]).unwrap(),
            Command::Help {
                topic: Some("download".into())
            }
        );
        assert_eq!(p(&["info", V]).unwrap(), Command::Info { url: V.into() });
    }

    #[test]
    fn usage_errors_table() {
        for args in [
            &[][..],
            &["nope"],
            &["status", "x"],
            &["login", "--x"],
            &["help", "nope"],
            &["help", "download", "extra"],
            &["info"],
            &["info", V, V2],
            &["info", "--quality", V],
            &["download"],
            &["download", "--quality"],
            &["download", "--bogus", V],
            &["download", "not-a-url"],
            &["download", "--overwrite=1", V],
            &["download", "--out", "", V],
        ] {
            assert!(p(args).is_err(), "{args:?}");
        }
    }

    #[test]
    fn download_flags_and_forms() {
        let c = p(&[
            "download",
            V,
            "--quality",
            "1080p",
            "--out=/tmp/x",
            V2,
            "--overwrite",
            "--rate=2m",
            "--range",
            "1:00-2:30",
        ])
        .unwrap();
        assert_eq!(
            c,
            Command::Download(DownloadArgs {
                urls: vec![V.into(), V2.into()],
                quality: Some("1080p".into()),
                out: Some("/tmp/x".into()),
                range: Some(TimeRangeDto {
                    start_ms: 60_000,
                    end_ms: Some(150_000)
                }),
                rate: Some(2_000_000),
                overwrite: true,
            })
        );
    }

    #[test]
    fn duplicate_flag_is_usage_error_in_either_form() {
        assert!(p(&["download", V, "--quality", "a", "--quality", "b"]).is_err());
        assert!(p(&["download", V, "--quality=a", "--quality", "b"]).is_err());
        assert!(p(&["download", V, "--overwrite", "--overwrite"]).is_err());
    }

    #[test]
    fn dashes_end_flags() {
        let c = p(&["download", "--", V, "--quality"]);
        // `--` 뒤는 모두 주소: 두 번째는 주소가 아니라 사용법 오류
        assert!(c.is_err());
        let c = p(&["download", "--quality", "720p", "--", V]).unwrap();
        let Command::Download(d) = c else { panic!() };
        assert_eq!(d.urls, vec![V.to_string()]);
    }

    #[test]
    fn live_and_invalid_urls_are_rejected_before_anything_runs() {
        let live = "https://chzzk.naver.com/live/000000000000000000000000000000a1";
        let e = p(&["download", live]).unwrap_err();
        assert_eq!(e.0, copy::LIVE_UNSUPPORTED);
        let e = p(&["info", live]).unwrap_err();
        assert_eq!(e.0, copy::LIVE_UNSUPPORTED);
        assert!(p(&["download", "https://example.com/video/1"]).is_err());
    }

    #[test]
    fn non_utf8_is_usage_error() {
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            let bad = OsString::from_vec(vec![0x66, 0x80, 0xff]);
            let e = parse([OsString::from("download"), bad]).unwrap_err();
            assert_eq!(e.0, copy::USAGE_NOT_UTF8);
        }
    }

    #[test]
    fn range_table() {
        let ok = |s: &str| parse_range(s).unwrap();
        assert_eq!(
            ok("0:10-0:20"),
            TimeRangeDto {
                start_ms: 10_000,
                end_ms: Some(20_000)
            }
        );
        assert_eq!(
            ok("1:00:00-"),
            TimeRangeDto {
                start_ms: 3_600_000,
                end_ms: None
            }
        );
        // 전각 콜론·공백은 `parse_clock`이 받는다
        assert_eq!(ok("0：10 - 0：20").end_ms, Some(20_000));
        for bad in [
            "",
            "10",
            "0:10",
            "0:20-0:10",
            "0:10-0:10",
            "a-b",
            "0:10-x",
            "-0:10",
        ] {
            assert!(parse_range(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn rate_table() {
        assert_eq!(parse_rate("2000000").unwrap(), 2_000_000);
        assert_eq!(parse_rate("5m").unwrap(), 5_000_000);
        assert_eq!(parse_rate("1500K").unwrap(), 1_500_000);
        // 최소로 올린다 / 0은 끔
        assert_eq!(parse_rate("1k").unwrap(), 1_000_000);
        assert_eq!(parse_rate("0").unwrap(), 0);
        for bad in ["", "m", "-1", "1.5m", "1g", "abc", "99999999999999999999"] {
            assert!(parse_rate(bad).is_err(), "{bad}");
        }
        assert!(parse_rate(&format!("{}m", u64::MAX)).is_err());
    }
}
