//! 채팅 자막(ASS·SRT) 렌더러.

use super::page::{ChatMessage, ChatMessageKind};
use super::{CHAT_CUE_MS, CHAT_TAIL_MS};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SubtitleOpts {
    /// 영상 길이(ms). 알면 길이 + `CHAT_TAIL_MS` 뒤 메시지를 뺀다
    pub duration_ms: Option<u64>,
}

/// ASS 머리(줄끝 `\n`). Alignment 1 = 왼쪽 아래. 글꼴 크기 40·여백 40은 [잠정] 근거 없음, 실측·ADR-0009 묶음 등록.
pub const ASS_HEADER: &str = "\
[Script Info]\n\
ScriptType: v4.00+\n\
PlayResX: 1920\n\
PlayResY: 1080\n\
WrapStyle: 0\n\
ScaledBorderAndShadow: yes\n\
\n\
[V4+ Styles]\n\
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
Style: Chat,sans-serif,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,1,40,40,40,1\n\
\n\
[Events]\n\
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";

/// 한 메시지의 자막 줄들. `None`이면 자막에 넣지 않는다.
fn cue_lines(m: &ChatMessage, opts: &SubtitleOpts) -> Option<Vec<String>> {
    if m.hidden || m.kind == ChatMessageKind::System {
        return None;
    }
    if let Some(d) = opts.duration_ms
        && m.player_offset_ms > d.saturating_add(CHAT_TAIL_MS)
    {
        return None;
    }
    // 이모티콘 치환이 이스케이프보다 먼저다(`{`가 전각으로 바뀌기 전에 본다).
    let text = replace_emoji(&m.text)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let cleaned: String = text
        .chars()
        .filter_map(|c| match c {
            '\t' => Some(' '),
            '\n' => Some('\n'),
            c if c.is_control() => None,
            c => Some(c),
        })
        .collect();
    let mut lines: Vec<String> = cleaned
        .split('\n')
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() {
        return None;
    }
    let nick = m
        .nickname
        .as_deref()
        .map(|n| {
            n.chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .collect::<String>()
        })
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty());
    let donation = m.kind == ChatMessageKind::Donation;
    let prefix = match (nick, donation) {
        (Some(n), true) => format!("{n} [후원]: "),
        (Some(n), false) => format!("{n}: "),
        (None, true) => "[후원] ".to_string(),
        (None, false) => String::new(),
    };
    lines[0] = format!("{prefix}{}", lines[0]);
    // ASS·SRT 공통: 덮어쓰기 블록·`\N` 해석을 피하도록 전각으로 바꾼다.
    Some(
        lines
            .into_iter()
            .map(|l| {
                l.chars()
                    .map(|c| match c {
                        '\\' => '＼',
                        '{' => '｛',
                        '}' => '｝',
                        c => c,
                    })
                    .collect()
            })
            .collect(),
    )
}

/// `{:이름:}` → `:이름:`. 이름이 비었거나 `:`·`{`·`}`·공백이 들어 있으면 그대로 둔다.
fn replace_emoji(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('{') {
        out.push_str(&rest[..i]);
        let after = &rest[i..];
        if let Some(body) = after.strip_prefix("{:")
            && let Some(end) = body.find(":}")
        {
            let name = &body[..end];
            if !name.is_empty()
                && !name
                    .chars()
                    .any(|c| matches!(c, ':' | '{' | '}') || c.is_whitespace())
            {
                out.push(':');
                out.push_str(name);
                out.push(':');
                rest = &body[end + 2..];
                continue;
            }
        }
        out.push('{');
        rest = &after[1..];
    }
    out.push_str(rest);
    out
}

/// 포함할 큐를 재생 위치 순(안정 정렬)으로 모은다.
fn cues<'a>(
    msgs: impl IntoIterator<Item = &'a ChatMessage>,
    opts: &SubtitleOpts,
) -> Vec<(u64, Vec<String>)> {
    let mut v: Vec<_> = msgs
        .into_iter()
        .filter_map(|m| cue_lines(m, opts).map(|l| (m.player_offset_ms, l)))
        .collect();
    v.sort_by_key(|(o, _)| *o);
    v
}

pub fn render_ass<'a>(
    msgs: impl IntoIterator<Item = &'a ChatMessage>,
    opts: &SubtitleOpts,
) -> String {
    let mut out = String::from(ASS_HEADER);
    for (start, lines) in cues(msgs, opts) {
        out.push_str(&format!(
            "Dialogue: 0,{},{},Chat,,0,0,0,,{}\n",
            ass_ts(start),
            ass_ts(start + CHAT_CUE_MS),
            lines.join("\\N")
        ));
    }
    out
}

pub fn render_srt<'a>(
    msgs: impl IntoIterator<Item = &'a ChatMessage>,
    opts: &SubtitleOpts,
) -> String {
    let mut out = String::new();
    for (n, (start, mut lines)) in cues(msgs, opts).into_iter().enumerate() {
        // 숫자만 있는 줄은 편집 프로그램이 큐 번호로 읽을 수 있어 앞에 공백을 둔다.
        for l in &mut lines {
            if l.bytes().all(|b| b.is_ascii_digit()) {
                l.insert(0, ' ');
            }
        }
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            n + 1,
            srt_ts(start),
            srt_ts(start + CHAT_CUE_MS),
            lines.join("\n")
        ));
    }
    out
}

fn ass_ts(ms: u64) -> String {
    format!(
        "{}:{:02}:{:02}.{:02}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000 / 10
    )
}

fn srt_ts(ms: u64) -> String {
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::parse_chat_page;
    use crate::testutil::{fixture, fixture_str};

    fn page(rel: &str) -> crate::chat::ChatPage {
        parse_chat_page(&fixture(&format!("testdata/chat/{rel}"))).unwrap()
    }

    fn golden(rel: &str) -> String {
        fixture_str(&format!("testdata/chat/expected/{rel}"))
    }

    #[test]
    fn golden_kinds_ass() {
        let p = page("page_kinds.json");
        assert_eq!(
            render_ass(&p.messages, &SubtitleOpts::default()),
            golden("kinds.ass")
        );
    }

    #[test]
    fn golden_kinds_srt() {
        let p = page("page_kinds.json");
        assert_eq!(
            render_srt(&p.messages, &SubtitleOpts::default()),
            golden("kinds.srt")
        );
    }

    #[test]
    fn golden_escape_ass() {
        let p = page("page_escape.json");
        assert_eq!(
            render_ass(&p.messages, &SubtitleOpts::default()),
            golden("escape.ass")
        );
    }

    #[test]
    fn golden_escape_srt() {
        let p = page("page_escape.json");
        assert_eq!(
            render_srt(&p.messages, &SubtitleOpts::default()),
            golden("escape.srt")
        );
    }

    #[test]
    fn empty_input() {
        let none: [&ChatMessage; 0] = [];
        assert_eq!(render_ass(none, &SubtitleOpts::default()), ASS_HEADER);
        assert!(ASS_HEADER.ends_with("Text\n"));
        assert_eq!(render_srt(none, &SubtitleOpts::default()), "");
    }

    #[test]
    fn tail_cut() {
        let p = page("page_kinds.json");
        let out = render_srt(
            &p.messages,
            &SubtitleOpts {
                duration_ms: Some(0),
            },
        );
        // 5000은 0 + CHAT_TAIL_MS 경계라 남는다(`>`로 뺀다). 7000·8000은 빠진다.
        let starts: Vec<&str> = out
            .lines()
            .filter(|l| l.contains(" --> "))
            .map(|l| &l[..12])
            .collect();
        assert_eq!(
            starts,
            [
                "00:00:01,000",
                "00:00:02,000",
                "00:00:03,000",
                "00:00:05,000"
            ]
        );
    }

    #[test]
    fn sorted_by_offset() {
        let body = r#"{"code":200,"content":{"videoChats":[
          {"playerMessageTime":3000,"content":"b"},
          {"playerMessageTime":1000,"content":"a"}]}}"#;
        let p = parse_chat_page(body.as_bytes()).unwrap();
        let out = render_srt(&p.messages, &SubtitleOpts::default());
        let a = out.find("a\n").unwrap();
        let b = out.find("b\n").unwrap();
        assert!(a < b, "{out}");
        assert!(out.starts_with("1\n00:00:01,000"));
    }

    #[test]
    fn ass_timestamp() {
        let want = [
            (0, "0:00:00.00"),
            (999, "0:00:00.99"),
            (61234, "0:01:01.23"),
            (3600010, "1:00:00.01"),
            (36_000_000, "10:00:00.00"),
        ];
        for (ms, s) in want {
            assert_eq!(ass_ts(ms), s);
        }
    }

    #[test]
    fn srt_timestamp() {
        let want = [
            (0, "00:00:00,000"),
            (999, "00:00:00,999"),
            (61234, "00:01:01,234"),
            (3600010, "01:00:00,010"),
            (36_000_000, "10:00:00,000"),
        ];
        for (ms, s) in want {
            assert_eq!(srt_ts(ms), s);
        }
    }

    #[test]
    fn emoji_edge() {
        let one = |text: &str| {
            let body = serde_json::json!({"code":200,"content":{"videoChats":[
                {"playerMessageTime":1000,"content":text}]}});
            let p = parse_chat_page(body.to_string().as_bytes()).unwrap();
            let out = render_srt(&p.messages, &SubtitleOpts::default());
            out.lines().nth(2).unwrap().to_string()
        };
        // 바뀌지 않는다(그 뒤 치환으로 `｛…`만)
        assert_eq!(one("{:a:b:}"), "｛:a:b:｝");
        assert_eq!(one("{::}"), "｛::｝");
        assert_eq!(one("{:smile:"), "｛:smile:");
        assert_eq!(one("{:가 나:}"), "｛:가 나:｝");
        assert_eq!(one("{:ok:}"), ":ok:");
        assert_eq!(CHAT_CUE_MS, 5_000);
        assert_eq!(CHAT_TAIL_MS, 5_000);
        assert_eq!(ChatMessageKind::Normal, ChatMessageKind::Normal);
    }
}
