//! VOD 채팅 실측 도구(기능 ④ 실측 질문 M-④-1~9, 실서버). 사용자가 본인 영상으로 직접 돌린다.
//!
//! ```text
//! cargo run -p chzzk-core --example vod_chat_check -- <본인 VOD 주소> [옵션]
//!   --cookies            환경 변수 CHZZK_NID_AUT·CHZZK_NID_SES로 "로그인 첫 페이지"도 본다(값은 출력하지 않는다)
//!   --rewind             빠른 다시보기라고 표시한다(info 판정과 다르면 주의 한 줄)
//!   --write-ass <mp4>    받은 mp4 옆에 같은 이름 .ass를 만든다(수동 확인 M-④-8)
//!   --write-srt <mp4>    받은 mp4 옆에 같은 이름 .srt를 만든다(수동 확인 M-④-9)
//! 둘을 함께 줄 수 없다. 같은 이름 파일이 있으면 덮어쓰지 않고 멈춘다. 출력은 범주·예/아니오뿐이다.
//! ```
//!
//! ID·제목·닉네임·본문·응답 원문·쿠키 값·파일 경로·오류 문구를 출력하지 않는다(범주만).

use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use chzzk_core::chat::probe::{
    Attempt, EndSignal, HiddenVerdict, InfoFlag, Pos400, Report, attempt_class, boundary_verdict,
    has_twins, hidden_verdict, monotonic, position_400, report_lines, spread_ok, within_tail,
};
use chzzk_core::chat::retry::{ChatFailure, classify};
use chzzk_core::chat::subtitle::{SubtitleOpts, render_ass, render_srt};
use chzzk_core::chat::{
    CHAT_PAGE_INTERVAL_MS, ChatCursor, ChatMessage, ChatPage, Next, SubtitleFormat, WalkState,
    chat_retry_policy, next_step,
};
use chzzk_core::naming::sibling_path;
use chzzk_core::{
    Chzzk, ClientConfig, ContentRef, Error, NaverCookies, PlaybackKind, parse_content_url,
};

/// 도구 전용 상한(무한 루프 방지).
const MAX_PROBE_PAGES: u32 = 20_000;

struct Args {
    video_no: u64,
    cookies: bool,
    rewind: bool,
    write: Option<(SubtitleFormat, PathBuf)>,
}

fn usage(msg: &str) -> ! {
    eprintln!("{msg}");
    eprintln!("사용법은 examples/vod_chat_check.rs 머리 주석");
    std::process::exit(2);
}

fn parse_args() -> Args {
    let mut it = std::env::args().skip(1);
    let mut url: Option<String> = None;
    let mut cookies = false;
    let mut rewind = false;
    let mut write: Option<(SubtitleFormat, PathBuf)> = None;
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--cookies" => cookies = true,
            "--rewind" => rewind = true,
            "--write-ass" | "--write-srt" => {
                let fmt = if arg == "--write-ass" {
                    SubtitleFormat::Ass
                } else {
                    SubtitleFormat::Srt
                };
                let Some(p) = it.next() else {
                    usage("자막을 쓸 mp4 경로가 없습니다")
                };
                if write.is_some() {
                    usage("--write-ass와 --write-srt는 함께 줄 수 없습니다");
                }
                write = Some((fmt, PathBuf::from(p)));
            }
            s if s.starts_with("--") => usage("모르는 옵션입니다"),
            s if url.is_none() => url = Some(s.to_string()),
            _ => usage("주소는 하나만 줍니다"),
        }
    }
    let Some(url) = url else {
        usage("주소가 없습니다")
    };
    let video_no = match parse_content_url(&url) {
        Ok(ContentRef::Video { video_no }) => video_no,
        _ => usage("VOD 주소(https://chzzk.naver.com/video/<번호>)만 받습니다"),
    };
    Args {
        video_no,
        cookies,
        rewind,
        write,
    }
}

fn cookies_from_env() -> Option<NaverCookies> {
    let aut = std::env::var("CHZZK_NID_AUT").ok()?;
    let ses = std::env::var("CHZZK_NID_SES").ok()?;
    (!aut.trim().is_empty() && !ses.trim().is_empty()).then(|| NaverCookies::new(aut, ses))
}

/// 요청 사이 간격을 지키고, 재시도할 수 있는 실패는 정책대로 다시 한다.
async fn get(
    c: &Chzzk,
    no: u64,
    cursor: ChatCursor,
    last: &mut Option<Instant>,
    saw_429: &mut bool,
) -> Result<ChatPage, Error> {
    let policy = chat_retry_policy();
    let mut attempts = 0u32;
    loop {
        if let Some(t) = *last {
            let gap = Duration::from_millis(CHAT_PAGE_INTERVAL_MS);
            if let Some(wait) = gap.checked_sub(t.elapsed()) {
                tokio::time::sleep(wait).await;
            }
        }
        *last = Some(Instant::now());
        attempts += 1;
        match c.fetch_chat_page(no, cursor).await {
            Ok(p) => return Ok(p),
            Err(e) => {
                if matches!(e, Error::HttpStatus { status: 429, .. }) {
                    *saw_429 = true;
                }
                if classify(&e) == ChatFailure::Retry && policy.allows_retry(attempts) {
                    tokio::time::sleep(policy.delay(attempts - 1)).await;
                    continue;
                }
                return Err(e);
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let args = parse_args();
    let cookies = if args.cookies {
        match cookies_from_env() {
            Some(c) => Some(c),
            None => usage("--cookies에는 CHZZK_NID_AUT·CHZZK_NID_SES 환경 변수가 둘 다 필요합니다"),
        }
    } else {
        None
    };

    // 네트워크 전에 쓰기 대상을 검사한다. 경로는 출력하지 않는다.
    let target = args.write.as_ref().map(|(fmt, mp4)| {
        if !mp4.is_file() {
            eprintln!("mp4 파일이 없습니다");
            std::process::exit(1);
        }
        let t = sibling_path(mp4, fmt.ext().expect("쓰기 형식"));
        if t.exists() {
            eprintln!("같은 이름 자막 파일이 이미 있습니다. 덮어쓰지 않습니다");
            std::process::exit(1);
        }
        t
    });

    let no = args.video_no;
    let anon = Chzzk::new(ClientConfig::default()).expect("클라이언트");
    let content = ContentRef::Video { video_no: no };
    let (playback, duration_ms, info) = match anon.resolve(&content).await {
        Ok(r) => (
            Some(r.kind()),
            r.meta.duration_secs.map(|s| (s * 1000.0).round() as u64),
            Attempt::Ok,
        ),
        Err(e) => (None, None, attempt_class(Some(&e))),
    };
    if args.rewind && playback != Some(PlaybackKind::LiveRewindHls) {
        println!("주의: --rewind 표시와 info 재생 방식이 다르다");
    }
    let info_flag = match anon.info_chat_flag(no).await {
        Ok(Some(_)) => InfoFlag::Present,
        Ok(None) => InfoFlag::Absent,
        Err(_) => InfoFlag::Failed,
    };

    let mut last = None;
    let mut saw_429 = false;
    let anon_res = get(&anon, no, ChatCursor(0), &mut last, &mut saw_429).await;
    let anon_first = attempt_class(anon_res.as_ref().err());
    let cookie_client = cookies.map(|c| {
        Chzzk::new(ClientConfig {
            cookies: Some(c),
            ..ClientConfig::default()
        })
        .expect("클라이언트")
    });
    let cookie_res = match &cookie_client {
        Some(c) => Some(get(c, no, ChatCursor(0), &mut last, &mut saw_429).await),
        None => None,
    };
    let cookie_first = cookie_res.as_ref().map(|r| attempt_class(r.as_ref().err()));

    // 순회에 쓸 클라이언트와 첫 페이지 결과: 비로그인이 되면 비로그인, 아니면 쿠키.
    let (walker, first): (&Chzzk, Result<ChatPage, Error>) = match (anon_res, cookie_res) {
        (Ok(p), _) => (&anon, Ok(p)),
        (Err(_), Some(Ok(p))) => (cookie_client.as_ref().expect("쿠키 클라이언트"), Ok(p)),
        (Err(_), Some(Err(ce))) => (cookie_client.as_ref().expect("쿠키 클라이언트"), Err(ce)),
        (Err(e), None) => (&anon, Err(e)),
    };

    let end;
    let mut pos400 = Pos400::None;
    let mut state = WalkState::default();
    let mut page_index = 0u32;
    let mut pages = 0u32;
    let mut twins = false;
    let mut repeats = Vec::new();
    let mut collected: Vec<ChatMessage> = Vec::new();
    let mut cur = first;
    loop {
        match cur {
            Err(e) => {
                if matches!(e, Error::HttpStatus { status: 400, .. }) {
                    end = EndSignal::Http400;
                    pos400 = position_400(Some(page_index), state.cursor.0, duration_ms);
                } else if page_index == 0 {
                    end = EndSignal::NotStarted;
                } else {
                    end = EndSignal::OtherError;
                }
                break;
            }
            Ok(page) => {
                pages += 1;
                twins |= has_twins(&page);
                let step = next_step(&state, &page);
                if let Some(r) = step.repeats {
                    repeats.push(r);
                }
                collected.extend(step.keep.iter().map(|&i| page.messages[i].clone()));
                match step.next {
                    Next::End(e) => {
                        end = e.into();
                        break;
                    }
                    Next::Continue(s) => {
                        if pages >= MAX_PROBE_PAGES {
                            end = EndSignal::PageLimit;
                            break;
                        }
                        state = s;
                        page_index += 1;
                        eprint!("\r페이지 {pages}");
                        let _ = std::io::stderr().flush();
                        cur = get(walker, no, state.cursor, &mut last, &mut saw_429).await;
                    }
                }
            }
        }
    }
    if pages > 0 {
        eprintln!();
    }

    let hidden = collected.iter().filter(|m| m.hidden).count() as u64;
    let report = Report {
        playback,
        info,
        info_flag,
        anon_first,
        cookie_first,
        end,
        pos400,
        boundary: boundary_verdict(&repeats),
        twins,
        pages,
        saw_429,
        monotonic: monotonic(collected.iter().map(|m| m.player_offset_ms)),
        within_tail: within_tail(
            collected.iter().map(|m| m.player_offset_ms).max(),
            duration_ms,
        ),
        spread: spread_ok(&collected),
        hidden: if collected.is_empty() {
            HiddenVerdict::NoMessages
        } else {
            hidden_verdict(hidden, collected.len() as u64)
        },
    };
    for line in report_lines(&report) {
        println!("{line}");
    }

    // 자막 쓰기(수동 확인 M-④-8·9). 검사와 쓰기 사이에 생긴 파일도 덮지 않는다.
    if let (Some((fmt, _)), Some(target)) = (&args.write, &target) {
        if collected.is_empty() {
            println!("자막: 쓰지 않음(받은 채팅 없음)");
            return;
        }
        let opts = SubtitleOpts { duration_ms };
        let text = match fmt {
            SubtitleFormat::Ass => render_ass(&collected, &opts),
            _ => render_srt(&collected, &opts),
        };
        let res = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .and_then(|mut f| f.write_all(text.as_bytes()));
        match res {
            Ok(()) => println!("자막: 썼다"),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                println!("자막: 쓰지 않음(같은 이름 파일이 생겼다)");
                std::process::exit(1);
            }
            Err(_) => {
                println!("자막: 쓰지 않음(파일 오류)");
                std::process::exit(1);
            }
        }
    }
}
