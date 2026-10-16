//! 채팅 페이지 응답 파서와 메시지 모델.

use serde::Deserialize;
use serde_json::Value;
use serde_json::value::RawValue;

use crate::error::Error;

/// 재생 위치 커서(ms).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ChatCursor(pub u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatMessageKind {
    Normal,
    Donation,
    Subscription,
    System,
    Other,
}

/// 기록 한 줄. `raw`는 받은 메시지 객체 그대로. `Debug`는 손으로 구현해 재생 위치·종류·가려짐만 보인다.
#[derive(Clone)]
pub struct ChatMessage {
    pub player_offset_ms: u64,
    pub written_at_ms: Option<i64>,
    pub kind: ChatMessageKind,
    pub hidden: bool,
    /// 프로필에서 연 닉네임(없거나 못 열면 None)
    pub nickname: Option<String>,
    /// 본문(없으면 빈 문자열)
    pub text: String,
    /// 작성자 해시(경계 중복 제거에만 쓴다)
    pub author: Option<String>,
    pub raw: Box<RawValue>,
}

impl ChatMessage {
    /// 기록 한 줄(원본 메시지 객체)에서 다시 만든다(`.chat.jsonl`을 읽을 때 쓴다).
    pub fn from_raw(raw: Box<RawValue>) -> Result<Self, Error> {
        parse_message(raw, "message")
    }
}

impl std::fmt::Debug for ChatMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatMessage")
            .field("player_offset_ms", &self.player_offset_ms)
            .field("kind", &self.kind)
            .field("hidden", &self.hidden)
            .field("raw", &format_args!("***"))
            .finish()
    }
}

/// `Debug`는 메시지 수와 다음 커서만.
#[derive(Clone)]
pub struct ChatPage {
    pub messages: Vec<ChatMessage>,
    pub next: Option<ChatCursor>,
}

impl std::fmt::Debug for ChatPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatPage")
            .field("messages", &self.messages.len())
            .field("next", &self.next)
            .finish()
    }
}

/// serde 오류 문구에는 값이 들어갈 수 있어(`invalid type: string "…"`) 위치만 낸다.
fn json_detail(e: &serde_json::Error) -> String {
    format!("JSON 형식 오류(줄 {}, 열 {})", e.line(), e.column())
}

fn parse_err(detail: impl Into<String>) -> Error {
    Error::Parse {
        what: "chat",
        detail: detail.into(),
    }
}

#[derive(Deserialize)]
struct Envelope<'a> {
    code: Option<i64>,
    message: Option<String>,
    #[serde(borrow)]
    content: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct Content {
    #[serde(rename = "nextPlayerMessageTime", default)]
    next: Option<u64>,
    #[serde(rename = "videoChats", default)]
    chats: Option<Vec<Box<RawValue>>>,
}

pub fn parse_chat_page(body: &[u8]) -> Result<ChatPage, Error> {
    let env: Envelope = serde_json::from_slice(body).map_err(|e| parse_err(json_detail(&e)))?;
    match env.code {
        None => return Err(parse_err("code 필드가 없습니다")),
        Some(200) => {}
        Some(code) => {
            return Err(Error::Api {
                code,
                message: env.message,
            });
        }
    }
    let content = match env.content {
        Some(c) if c.get() != "null" => c,
        _ => return Err(parse_err("content가 없습니다")),
    };
    // `previousVideoChats`는 읽지 않는다: 커서 앞쪽 묶음은 버린다.
    let content: Content =
        serde_json::from_str(content.get()).map_err(|e| parse_err(json_detail(&e)))?;
    let mut messages = Vec::new();
    for (i, raw) in content.chats.unwrap_or_default().into_iter().enumerate() {
        messages.push(parse_message(raw, &format!("videoChats[{i}]"))?);
    }
    Ok(ChatPage {
        messages,
        next: content.next.map(ChatCursor),
    })
}

fn parse_message(raw: Box<RawValue>, at: &str) -> Result<ChatMessage, Error> {
    let v: Value = serde_json::from_str(raw.get()).map_err(|e| parse_err(json_detail(&e)))?;
    if !v.is_object() {
        return Err(parse_err(format!("{at}: object가 아닙니다")));
    }
    let player_offset_ms = v
        .get("playerMessageTime")
        .and_then(Value::as_u64)
        .ok_or_else(|| parse_err(format!("{at}.playerMessageTime: 0 이상 정수가 아닙니다")))?;
    let kind = match v.get("messageTypeCode").and_then(Value::as_i64) {
        Some(1) => ChatMessageKind::Normal,
        Some(10) => ChatMessageKind::Donation,
        Some(11) => ChatMessageKind::Subscription,
        Some(30) => ChatMessageKind::System,
        _ => ChatMessageKind::Other,
    };
    // 가려짐 규칙은 [가정]: NORMAL이 아닌 문자열이면 가려진 것으로 본다(실측 `가려진 메시지` 줄이 확인).
    let hidden = v
        .get("messageStatusType")
        .and_then(Value::as_str)
        .is_some_and(|s| s != "NORMAL");
    let text = match v.get("content") {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(_) => return Err(parse_err(format!("{at}.content: 문자열이 아닙니다"))),
    };
    // 프로필은 JSON이 든 문자열이다. 열지 못해도 페이지는 실패하지 않는다.
    let nickname = v
        .get("profile")
        .and_then(Value::as_str)
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|p| {
            let n = p.get("nickname")?.as_str()?.trim();
            (!n.is_empty()).then(|| n.to_string())
        });
    Ok(ChatMessage {
        player_offset_ms,
        written_at_ms: v.get("messageTime").and_then(Value::as_i64),
        kind,
        hidden,
        nickname,
        text,
        author: v
            .get("userIdHash")
            .and_then(Value::as_str)
            .map(str::to_string),
        raw,
    })
}

/// 경계 대조용 64비트 해시(FNV-1a, 버전·플랫폼과 무관하게 같다: sidecar에 저장된다).
/// 재생 위치·작성 시각·작성자·본문을 넣는다. 닉네임은 넣지 않는다.
pub fn message_hash(m: &ChatMessage) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for b in bytes {
            h ^= u64::from(*b);
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    feed(&m.player_offset_ms.to_le_bytes());
    match m.written_at_ms {
        None => feed(&[0]),
        Some(t) => {
            feed(&[1]);
            feed(&t.to_le_bytes());
        }
    }
    match &m.author {
        None => feed(&[0]),
        Some(a) => {
            feed(&[1]);
            feed(&(a.len() as u64).to_le_bytes());
            feed(a.as_bytes());
        }
    }
    feed(&(m.text.len() as u64).to_le_bytes());
    feed(m.text.as_bytes());
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::fixture;

    fn page(rel: &str) -> ChatPage {
        parse_chat_page(&fixture(&format!("testdata/chat/{rel}"))).unwrap()
    }

    fn msg(
        offset: u64,
        written: Option<i64>,
        author: Option<&str>,
        text: &str,
        nick: Option<&str>,
    ) -> ChatMessage {
        ChatMessage {
            player_offset_ms: offset,
            written_at_ms: written,
            kind: ChatMessageKind::Normal,
            hidden: false,
            nickname: nick.map(str::to_string),
            text: text.to_string(),
            author: author.map(str::to_string),
            raw: RawValue::from_string("{}".to_string()).unwrap(),
        }
    }

    #[test]
    fn first_page_keeps_after_cursor_only() {
        let p = page("page_first.json");
        let offs: Vec<u64> = p.messages.iter().map(|m| m.player_offset_ms).collect();
        assert_eq!(offs, [10000, 11000, 12000, 13000, 15000]);
        assert_eq!(p.next, Some(ChatCursor(15000)));
    }

    #[test]
    fn fields() {
        let p = page("page_first.json");
        let m = &p.messages[0];
        assert_eq!(m.nickname.as_deref(), Some("가상시청자1"));
        assert_eq!(m.text, "테스트 메시지");
        assert_eq!(m.author.as_deref(), Some("user-hash-01"));
        assert_eq!(m.written_at_ms, Some(1767322810000));
        assert_eq!(m.kind, ChatMessageKind::Normal);
        assert!(!m.hidden);
        assert!(m.raw.get().starts_with('{'));
        assert!(m.raw.get().contains("\"chatChannelId\""));
    }

    #[test]
    fn kinds() {
        use ChatMessageKind::*;
        let p = page("page_kinds.json");
        let kinds: Vec<_> = p.messages.iter().map(|m| m.kind).collect();
        assert_eq!(
            kinds,
            [
                Normal,
                Donation,
                Subscription,
                System,
                Other,
                Normal,
                Normal,
                Normal
            ]
        );
        let hidden: Vec<_> = p.messages.iter().map(|m| m.hidden).collect();
        assert_eq!(
            hidden,
            [false, false, false, false, false, true, false, false]
        );
        for i in [3, 6, 7] {
            assert_eq!(p.messages[i].nickname, None, "{i}");
        }
    }

    #[test]
    fn last_null_next_none() {
        assert_eq!(page("page_last_null.json").next, None);
    }

    #[test]
    fn missing_chats_is_empty() {
        for body in [
            r#"{"code":200,"content":{"nextPlayerMessageTime":5}}"#,
            r#"{"code":200,"content":{"videoChats":null}}"#,
        ] {
            assert!(
                parse_chat_page(body.as_bytes())
                    .unwrap()
                    .messages
                    .is_empty()
            );
        }
    }

    #[test]
    fn api_code() {
        let e = parse_chat_page(br#"{"code":500,"message":"x","content":null}"#).unwrap_err();
        assert!(matches!(e, Error::Api { code: 500, .. }), "{e:?}");
    }

    #[test]
    fn no_code() {
        let e = parse_chat_page(br#"{"content":{}}"#).unwrap_err();
        assert!(matches!(e, Error::Parse { what: "chat", .. }), "{e:?}");
    }

    #[test]
    fn bad_shape_detail_has_no_source() {
        let e = parse_chat_page(&fixture("testdata/chat/page_bad_shape.json")).unwrap_err();
        let Error::Parse { detail, .. } = e else {
            panic!("{e:?}")
        };
        assert!(detail.contains("playerMessageTime"), "{detail}");
        for bad in ["형식 오류 본문", "가상시청자", "\"1000\""] {
            assert!(!detail.contains(bad), "{detail}");
        }
    }

    #[test]
    fn serde_error_detail_has_no_value() {
        let e = parse_chat_page(
            r#"{"code":200,"content":{"nextPlayerMessageTime":"비밀값","videoChats":[]}}"#
                .as_bytes(),
        )
        .unwrap_err();
        let Error::Parse { detail, .. } = e else {
            panic!("{e:?}")
        };
        assert!(!detail.contains("비밀값"), "{detail}");
    }

    #[test]
    fn content_wrong_type() {
        let body = r#"{"code":200,"content":{"videoChats":[{"playerMessageTime":1,"content":5}]}}"#;
        let e = parse_chat_page(body.as_bytes()).unwrap_err();
        let Error::Parse { detail, .. } = e else {
            panic!("{e:?}")
        };
        assert!(detail.contains("content"), "{detail}");
    }

    #[test]
    fn from_raw_roundtrip() {
        let p = page("page_first.json");
        let m = &p.messages[1];
        let again = ChatMessage::from_raw(m.raw.clone()).unwrap();
        assert_eq!(again.player_offset_ms, m.player_offset_ms);
        assert_eq!(again.text, m.text);
        assert_eq!(again.nickname, m.nickname);
    }

    #[test]
    fn debug_hides_text() {
        let p = page("page_first.json");
        let dbg = format!("{p:?} {:?}", p.messages[0]);
        for bad in ["테스트 메시지", "가상시청자", "user-hash"] {
            assert!(!dbg.contains(bad), "{dbg}");
        }
        assert!(format!("{p:?}").contains("messages: 5"));
    }

    #[test]
    fn hash_stable() {
        let a = msg(1, Some(2), Some("u"), "t", Some("n1"));
        let b = msg(1, Some(2), Some("u"), "t", Some("n2"));
        let c = msg(1, Some(2), Some("v"), "t", Some("n1"));
        assert_eq!(message_hash(&a), message_hash(&b), "닉네임은 넣지 않는다");
        assert_ne!(message_hash(&a), message_hash(&c));
        // 버전·플랫폼과 무관한 고정 값(sidecar에 저장된다)
        let z = msg(0, None, None, "", None);
        assert_eq!(message_hash(&z), 8_640_285_291_530_593_069);
    }
}
