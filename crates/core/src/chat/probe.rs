//! 실측 도구(`examples/vod_chat_check.rs`)의 범주 판정. 출력은 범주·예/아니오뿐이고 ID·본문·개수 원값은 없다.

use serde_json::Value;

use super::page::{ChatMessage, ChatPage, message_hash};
use super::walk::BoundaryRepeat;
use super::{CHAT_TAIL_MS, ChatEnd};
use crate::error::Error;
use crate::model::PlaybackKind;

/// 작성 시각 − 재생 위치가 이 안에서 흩어지면 "맞다"로 본다(ms). [잠정] 근거 없음, 실측·ADR-0009 묶음 등록.
pub const SPREAD_MS: i64 = 2_000;

/// 요청 하나의 결과 범주.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Attempt {
    Ok,
    Http400,
    Auth,
    Other4xx,
    Server5xx,
    ApiCode,
    Network,
    Parse,
    Other,
}

impl Attempt {
    pub fn label(self) -> &'static str {
        match self {
            Self::Ok => "된다",
            Self::Http400 => "안 된다(400)",
            Self::Auth => "안 된다(401·403)",
            Self::Other4xx => "안 된다(그 밖 4xx)",
            Self::Server5xx => "안 된다(5xx)",
            Self::ApiCode => "안 된다(API 코드)",
            Self::Network => "안 된다(연결)",
            Self::Parse => "안 된다(형식)",
            Self::Other => "안 된다(그 밖)",
        }
    }
}

/// `None`이면 성공.
pub fn attempt_class(e: Option<&Error>) -> Attempt {
    match e {
        None => Attempt::Ok,
        Some(Error::HttpStatus { status: 400, .. }) => Attempt::Http400,
        Some(Error::AuthRequired { .. }) => Attempt::Auth,
        Some(Error::HttpStatus { status, .. }) if (401..=499).contains(status) => Attempt::Other4xx,
        Some(Error::HttpStatus { status, .. }) if (500..=599).contains(status) => {
            Attempt::Server5xx
        }
        Some(Error::Api { .. }) => Attempt::ApiCode,
        Some(Error::Network(_)) => Attempt::Network,
        Some(Error::Parse { .. }) => Attempt::Parse,
        Some(_) => Attempt::Other,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InfoFlag {
    Present,
    Absent,
    Failed,
}

impl InfoFlag {
    pub fn label(self) -> &'static str {
        match self {
            Self::Present => "있다",
            Self::Absent => "없다",
            Self::Failed => "확인 실패",
        }
    }
}

/// 실측 Q3: info v2 응답의 `videoChatEnabled`(boolean일 때만 `Some`).
pub fn info_chat_flag(body: &[u8]) -> Result<Option<bool>, Error> {
    let content = crate::info::open_envelope(body, "video info")?;
    Ok(content.get("videoChatEnabled").and_then(Value::as_bool))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EndSignal {
    NoCursor,
    NotAdvancing,
    EmptyPage,
    Http400,
    OtherError,
    PageLimit,
    NotStarted,
}

impl EndSignal {
    pub fn label(self) -> &'static str {
        match self {
            Self::NoCursor => "커서 없음",
            Self::NotAdvancing => "커서 멈춤",
            Self::EmptyPage => "빈 페이지",
            Self::Http400 => "400",
            Self::OtherError => "다른 오류",
            Self::PageLimit => "페이지 상한",
            Self::NotStarted => "첫 페이지 실패",
        }
    }
}

impl From<ChatEnd> for EndSignal {
    fn from(e: ChatEnd) -> Self {
        match e {
            ChatEnd::NoCursor => Self::NoCursor,
            ChatEnd::CursorNotAdvancing => Self::NotAdvancing,
            ChatEnd::EmptyPage => Self::EmptyPage,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pos400 {
    None,
    FirstPage,
    BeforeEnd,
    AtOrAfterEnd,
    UnknownDuration,
}

impl Pos400 {
    pub fn label(self) -> &'static str {
        match self {
            Self::None => "없음",
            Self::FirstPage => "첫 페이지",
            Self::BeforeEnd => "마지막 커서 < 길이",
            Self::AtOrAfterEnd => "마지막 커서 ≥ 길이",
            Self::UnknownDuration => "길이 모름",
        }
    }
}

/// `page_index` = 400을 받은 요청의 0-기준 번호(None = 400 없음).
pub fn position_400(page_index: Option<u32>, cursor_ms: u64, duration_ms: Option<u64>) -> Pos400 {
    match (page_index, duration_ms) {
        (None, _) => Pos400::None,
        (Some(0), _) => Pos400::FirstPage,
        (Some(_), None) => Pos400::UnknownDuration,
        (Some(_), Some(d)) if cursor_ms < d => Pos400::BeforeEnd,
        (Some(_), Some(_)) => Pos400::AtOrAfterEnd,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryVerdict {
    NoBoundary,
    NoneRepeated,
    All,
    Some,
}

impl BoundaryVerdict {
    pub fn label(self) -> &'static str {
        match self {
            Self::NoBoundary => "판정 불가(경계 없음)",
            Self::NoneRepeated => "없음",
            Self::All => "전부",
            Self::Some => "일부",
        }
    }
}

/// `expected > 0`인 경계만 본다.
pub fn boundary_verdict(r: &[BoundaryRepeat]) -> BoundaryVerdict {
    let seen: Vec<_> = r.iter().filter(|b| b.expected > 0).collect();
    if seen.is_empty() {
        BoundaryVerdict::NoBoundary
    } else if seen.iter().all(|b| b.matched == 0) {
        BoundaryVerdict::NoneRepeated
    } else if seen.iter().all(|b| b.matched == b.expected) {
        BoundaryVerdict::All
    } else {
        BoundaryVerdict::Some
    }
}

/// 한 페이지 안에서 `(재생 위치, 해시)` 쌍이 두 번 이상 나오는가.
pub fn has_twins(page: &ChatPage) -> bool {
    let mut seen = std::collections::HashSet::new();
    page.messages
        .iter()
        .any(|m| !seen.insert((m.player_offset_ms, message_hash(m))))
}

/// 페이지 수는 범주로만 낸다(영상 길이를 특정하는 준식별자).
pub fn page_bucket(pages: u32) -> &'static str {
    match pages {
        0..=9 => "<10",
        10..=99 => "10~100",
        100..=999 => "100~1000",
        _ => ">1000",
    }
}

/// 비어 있으면 None, 아니면 비감소 여부.
pub fn monotonic(offsets: impl IntoIterator<Item = u64>) -> Option<bool> {
    let mut it = offsets.into_iter();
    let mut prev = it.next()?;
    for o in it {
        if o < prev {
            return Some(false);
        }
        prev = o;
    }
    Some(true)
}

pub fn within_tail(max_offset: Option<u64>, duration_ms: Option<u64>) -> Option<bool> {
    Some(max_offset? <= duration_ms?.saturating_add(CHAT_TAIL_MS))
}

/// 작성 시각 − 재생 위치의 흩어짐이 `SPREAD_MS` 이하인가. 작성 시각이 있는 메시지가 없으면 None.
pub fn spread_ok(msgs: &[ChatMessage]) -> Option<bool> {
    let mut range: Option<(i128, i128)> = None;
    for m in msgs {
        let Some(t) = m.written_at_ms else { continue };
        let d = i128::from(t) - i128::from(m.player_offset_ms);
        range = Some(match range {
            None => (d, d),
            Some((lo, hi)) => (lo.min(d), hi.max(d)),
        });
    }
    let (lo, hi) = range?;
    Some(hi - lo <= i128::from(SPREAD_MS))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HiddenVerdict {
    NoMessages,
    Zero,
    Some,
    Half,
}

impl HiddenVerdict {
    pub fn label(self) -> &'static str {
        match self {
            Self::NoMessages => "판정 불가(메시지 없음)",
            Self::Zero => "0건",
            Self::Some => "일부",
            Self::Half => "절반 이상",
        }
    }
}

pub fn hidden_verdict(hidden: u64, total: u64) -> HiddenVerdict {
    if total == 0 {
        HiddenVerdict::NoMessages
    } else if hidden == 0 {
        HiddenVerdict::Zero
    } else if hidden.saturating_mul(2) >= total {
        HiddenVerdict::Half
    } else {
        HiddenVerdict::Some
    }
}

pub fn yes_no(b: Option<bool>) -> &'static str {
    match b {
        Some(true) => "예",
        Some(false) => "아니오",
        None => "판정 불가",
    }
}

/// 실측 결과 한 벌.
pub struct Report {
    /// resolve 결과. None = info 실패
    pub playback: Option<PlaybackKind>,
    pub info: Attempt,
    pub info_flag: InfoFlag,
    pub anon_first: Attempt,
    /// None = 건너뜀
    pub cookie_first: Option<Attempt>,
    pub end: EndSignal,
    pub pos400: Pos400,
    pub boundary: BoundaryVerdict,
    pub twins: bool,
    pub pages: u32,
    pub saw_429: bool,
    pub monotonic: Option<bool>,
    pub within_tail: Option<bool>,
    pub spread: Option<bool>,
    pub hidden: HiddenVerdict,
}

pub fn report_lines(r: &Report) -> Vec<String> {
    let playback = match r.playback {
        Some(PlaybackKind::LiveRewindHls) => "빠른 다시보기",
        Some(PlaybackKind::Progressive) => "일반 VOD",
        Some(PlaybackKind::Live) | None => "모름",
    };
    let yn = |b: bool| yes_no(Some(b));
    vec![
        format!("재생 방식(info): {playback}"),
        format!("info 조회: {}", r.info.label()),
        format!("비로그인 첫 페이지: {}", r.anon_first.label()),
        format!(
            "로그인 첫 페이지: {}",
            r.cookie_first.map_or("건너뜀", Attempt::label)
        ),
        format!("info에 채팅 사용 여부 필드: {}", r.info_flag.label()),
        format!("끝 신호: {}", r.end.label()),
        format!("400이 난 위치: {}", r.pos400.label()),
        format!("경계 ms 되풀이: {}", r.boundary.label()),
        format!("같은 ms·같은 묶음 해시 둘 이상: {}", yn(r.twins)),
        format!("페이지 수: {}", page_bucket(r.pages)),
        format!("429 만남: {}", yn(r.saw_429)),
        format!("재생 위치 단조 증가: {}", yes_no(r.monotonic)),
        format!(
            "마지막 재생 위치 ≤ 길이+CHAT_TAIL_MS: {}",
            yes_no(r.within_tail)
        ),
        format!("작성 시각 − 재생 위치 흩어짐 ≤ 2초: {}", yes_no(r.spread)),
        format!("가려진 메시지: {}", r.hidden.label()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::parse_chat_page;
    use crate::http::RequestKind;
    use crate::testutil::fixture;

    fn http(status: u16) -> Error {
        Error::HttpStatus {
            status,
            kind: RequestKind::Api,
        }
    }

    fn msgs(pairs: &[(u64, Option<i64>)]) -> Vec<ChatMessage> {
        pairs
            .iter()
            .map(|(o, w)| {
                let w = w.map_or("null".to_string(), |w| w.to_string());
                let body = format!(
                    r#"{{"code":200,"content":{{"videoChats":[{{"playerMessageTime":{o},"messageTime":{w}}}]}}}}"#
                );
                parse_chat_page(body.as_bytes()).unwrap().messages.remove(0)
            })
            .collect()
    }

    #[test]
    fn attempt_class_table() {
        let parse = Error::Parse {
            what: "chat",
            detail: String::new(),
        };
        let api = Error::Api {
            code: 500,
            message: None,
        };
        let cases: [(Option<&Error>, Attempt); 3] = [
            (None, Attempt::Ok),
            (Some(&parse), Attempt::Parse),
            (Some(&api), Attempt::ApiCode),
        ];
        for (e, want) in cases {
            assert_eq!(attempt_class(e), want);
        }
        let by_status = [
            (400, Attempt::Http400),
            (404, Attempt::Other4xx),
            (429, Attempt::Other4xx),
            (503, Attempt::Server5xx),
        ];
        for (s, want) in by_status {
            assert_eq!(attempt_class(Some(&http(s))), want, "{s}");
        }
        for s in [401, 403] {
            assert_eq!(
                attempt_class(Some(&Error::AuthRequired { status: s })),
                Attempt::Auth
            );
        }
        assert_eq!(attempt_class(Some(&Error::Cancelled)), Attempt::Other);
    }

    #[test]
    fn position_400_table() {
        assert_eq!(position_400(None, 0, Some(10)), Pos400::None);
        assert_eq!(position_400(Some(0), 0, Some(10)), Pos400::FirstPage);
        assert_eq!(position_400(Some(3), 5, None), Pos400::UnknownDuration);
        assert_eq!(position_400(Some(3), 9, Some(10)), Pos400::BeforeEnd);
        assert_eq!(position_400(Some(3), 10, Some(10)), Pos400::AtOrAfterEnd);
        assert_eq!(position_400(Some(3), 11, Some(10)), Pos400::AtOrAfterEnd);
    }

    #[test]
    fn end_400_is_not_a_normal_end() {
        // ChatEnd에는 400 변종이 없다. 400은 EndSignal에서만 나온다.
        assert_eq!(EndSignal::Http400.label(), "400");
        assert_eq!(EndSignal::from(ChatEnd::NoCursor), EndSignal::NoCursor);
        assert_eq!(
            EndSignal::from(ChatEnd::CursorNotAdvancing),
            EndSignal::NotAdvancing
        );
        assert_eq!(EndSignal::from(ChatEnd::EmptyPage), EndSignal::EmptyPage);
    }

    #[test]
    fn boundary_verdict_table() {
        let b = |expected, matched| BoundaryRepeat { expected, matched };
        assert_eq!(boundary_verdict(&[]), BoundaryVerdict::NoBoundary);
        assert_eq!(boundary_verdict(&[b(0, 0)]), BoundaryVerdict::NoBoundary);
        assert_eq!(
            boundary_verdict(&[b(1, 0), b(2, 0)]),
            BoundaryVerdict::NoneRepeated
        );
        assert_eq!(boundary_verdict(&[b(1, 1), b(2, 2)]), BoundaryVerdict::All);
        assert_eq!(boundary_verdict(&[b(2, 1)]), BoundaryVerdict::Some);
        assert_eq!(boundary_verdict(&[b(1, 1), b(1, 0)]), BoundaryVerdict::Some);
    }

    #[test]
    fn page_bucket_edges() {
        let want = [
            (0, "<10"),
            (9, "<10"),
            (10, "10~100"),
            (99, "10~100"),
            (100, "100~1000"),
            (999, "100~1000"),
            (1000, ">1000"),
        ];
        for (n, s) in want {
            assert_eq!(page_bucket(n), s);
        }
    }

    #[test]
    fn monotonic_and_tail() {
        assert_eq!(monotonic([]), None);
        assert_eq!(monotonic([1, 1, 2]), Some(true));
        assert_eq!(monotonic([2, 1]), Some(false));
        assert_eq!(within_tail(Some(105_000), Some(100_000)), Some(true));
        assert_eq!(within_tail(Some(105_001), Some(100_000)), Some(false));
        assert_eq!(within_tail(None, Some(1)), None);
        assert_eq!(within_tail(Some(1), None), None);
    }

    #[test]
    fn spread_table() {
        assert_eq!(spread_ok(&msgs(&[(1000, None)])), None);
        assert_eq!(
            spread_ok(&msgs(&[(1000, Some(5000)), (2000, Some(7000))])),
            Some(true)
        );
        assert_eq!(
            spread_ok(&msgs(&[(1000, Some(5000)), (2000, Some(8000))])),
            Some(true)
        );
        // 차이 4000과 6001 → 흩어짐 2001
        assert_eq!(
            spread_ok(&msgs(&[(1000, Some(5000)), (2000, Some(8001))])),
            Some(false)
        );
        // 음수 차이 포함: -1000 ~ 1000 = 2000
        assert_eq!(
            spread_ok(&msgs(&[(5000, Some(4000)), (5000, Some(6000))])),
            Some(true)
        );
        assert_eq!(
            spread_ok(&msgs(&[(5000, Some(4000)), (5000, Some(6001))])),
            Some(false)
        );
    }

    #[test]
    fn hidden_verdict_table() {
        assert_eq!(hidden_verdict(0, 0), HiddenVerdict::NoMessages);
        assert_eq!(hidden_verdict(0, 5), HiddenVerdict::Zero);
        assert_eq!(hidden_verdict(1, 5), HiddenVerdict::Some);
        assert_eq!(hidden_verdict(3, 5), HiddenVerdict::Half);
        assert_eq!(hidden_verdict(5, 5), HiddenVerdict::Half);
    }

    #[test]
    fn twins() {
        let twins = parse_chat_page(&fixture("testdata/chat/page_boundary_twins.json")).unwrap();
        let first = parse_chat_page(&fixture("testdata/chat/page_first.json")).unwrap();
        assert!(has_twins(&twins));
        assert!(!has_twins(&first));
    }

    #[test]
    fn info_chat_flag_table() {
        assert_eq!(
            info_chat_flag(&fixture("testdata/vod/video_info.json")).unwrap(),
            None
        );
        let f = |v: &str| {
            info_chat_flag(
                format!(r#"{{"code":200,"content":{{"videoChatEnabled":{v}}}}}"#).as_bytes(),
            )
        };
        assert_eq!(f("false").unwrap(), Some(false));
        assert_eq!(f("true").unwrap(), Some(true));
        assert_eq!(f("\"true\"").unwrap(), None);
        let e = info_chat_flag(br#"{"code":500,"content":null}"#).unwrap_err();
        assert!(matches!(e, Error::Api { code: 500, .. }));
    }

    fn full_report() -> Report {
        Report {
            playback: Some(PlaybackKind::LiveRewindHls),
            info: Attempt::Ok,
            info_flag: InfoFlag::Absent,
            anon_first: Attempt::Ok,
            cookie_first: None,
            end: EndSignal::NoCursor,
            pos400: Pos400::None,
            boundary: BoundaryVerdict::All,
            twins: false,
            pages: 1234,
            saw_429: false,
            monotonic: Some(true),
            within_tail: None,
            spread: Some(false),
            hidden: HiddenVerdict::Zero,
        }
    }

    #[test]
    fn report_lines_fixed() {
        let want = [
            "재생 방식(info): 빠른 다시보기",
            "info 조회: 된다",
            "비로그인 첫 페이지: 된다",
            "로그인 첫 페이지: 건너뜀",
            "info에 채팅 사용 여부 필드: 없다",
            "끝 신호: 커서 없음",
            "400이 난 위치: 없음",
            "경계 ms 되풀이: 전부",
            "같은 ms·같은 묶음 해시 둘 이상: 아니오",
            "페이지 수: >1000",
            "429 만남: 아니오",
            "재생 위치 단조 증가: 예",
            "마지막 재생 위치 ≤ 길이+CHAT_TAIL_MS: 판정 불가",
            "작성 시각 − 재생 위치 흩어짐 ≤ 2초: 아니오",
            "가려진 메시지: 0건",
        ];
        assert_eq!(report_lines(&full_report()), want);
        assert!(!report_lines(&full_report()).join("\n").contains("1234"));
    }

    #[test]
    fn first_page_400_lines() {
        let r = Report {
            anon_first: Attempt::Http400,
            end: EndSignal::Http400,
            pos400: position_400(Some(0), 0, Some(60_000)),
            ..full_report()
        };
        let lines = report_lines(&r);
        assert!(lines.contains(&"끝 신호: 400".to_string()));
        assert!(lines.contains(&"400이 난 위치: 첫 페이지".to_string()));
        assert!(lines.contains(&"비로그인 첫 페이지: 안 된다(400)".to_string()));
    }
}
