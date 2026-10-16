//! 페이지 순회 판정(순수). 경계 ms의 되풀이 메시지는 개수표(multiset)로 걸러낸다.

use std::collections::BTreeMap;

use super::ChatEnd;
use super::page::{ChatCursor, ChatPage, message_hash};

/// 순회 상태. 처음은 `WalkState::default()`(커서 0, 경계 없음).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WalkState {
    pub cursor: ChatCursor,
    /// 직전 페이지의 마지막 재생 위치(ms)
    pub boundary_ms: Option<u64>,
    /// 그 ms에 있던 메시지 해시 → 개수(multiset)
    pub boundary: BTreeMap<u64, u32>,
}

/// 경계 되풀이 관찰. `expected` = 직전 경계 multiset 크기, `matched` = 이번 페이지에서 버린 수.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BoundaryRepeat {
    pub expected: u32,
    pub matched: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Next {
    Continue(WalkState),
    End(ChatEnd),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    /// 남길 메시지의 `page.messages` 안 위치(오름차순)
    pub keep: Vec<usize>,
    /// 경계가 있었으면 Some
    pub repeats: Option<BoundaryRepeat>,
    pub next: Next,
}

pub fn next_step(state: &WalkState, page: &ChatPage) -> Step {
    // 1. 빈 페이지는 다음 커서가 있어도 끝이다.
    if page.messages.is_empty() {
        return Step {
            keep: vec![],
            repeats: None,
            next: Next::End(ChatEnd::EmptyPage),
        };
    }
    // 2. 경계 ms의 되풀이는 직전 개수표만큼만 버린다(같은 ms의 새 쌍둥이는 남는다).
    let mut remaining = state.boundary.clone();
    let mut matched = 0u32;
    let mut keep = Vec::new();
    for (i, m) in page.messages.iter().enumerate() {
        if state.boundary_ms == Some(m.player_offset_ms)
            && let Some(n) = remaining.get_mut(&message_hash(m))
            && *n > 0
        {
            *n -= 1;
            matched += 1;
        } else {
            keep.push(i);
        }
    }
    let repeats = state.boundary_ms.map(|_| BoundaryRepeat {
        expected: state.boundary.values().sum(),
        matched,
    });
    // 3. 새 경계는 버린 것까지 페이지의 모든 메시지를 센다.
    let last = page
        .messages
        .iter()
        .map(|m| m.player_offset_ms)
        .max()
        .unwrap_or(0);
    let mut boundary = BTreeMap::new();
    for m in page.messages.iter().filter(|m| m.player_offset_ms == last) {
        *boundary.entry(message_hash(m)).or_insert(0u32) += 1;
    }
    // 4. 다음 커서.
    let next = match page.next {
        None => Next::End(ChatEnd::NoCursor),
        Some(c) if c <= state.cursor => Next::End(ChatEnd::CursorNotAdvancing),
        Some(c) => Next::Continue(WalkState {
            cursor: c,
            boundary_ms: Some(last),
            boundary,
        }),
    };
    Step {
        keep,
        repeats,
        next,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::parse_chat_page;
    use crate::testutil::fixture;

    fn page(rel: &str) -> ChatPage {
        parse_chat_page(&fixture(&format!("testdata/chat/{rel}"))).unwrap()
    }

    fn at(cursor: u64) -> WalkState {
        WalkState {
            cursor: ChatCursor(cursor),
            ..WalkState::default()
        }
    }

    /// 첫 페이지를 지난 뒤의 상태.
    fn after_first() -> WalkState {
        let Next::Continue(s) = next_step(&WalkState::default(), &page("page_first.json")).next
        else {
            panic!()
        };
        s
    }

    fn inline_page(offsets: &[u64], next: Option<u64>) -> ChatPage {
        let chats: Vec<String> = offsets
            .iter()
            .enumerate()
            .map(|(i, o)| {
                format!(
                    r#"{{"playerMessageTime":{o},"userIdHash":"u{i}","content":"m{i}","messageTime":{o}}}"#
                )
            })
            .collect();
        let next = next.map_or("null".to_string(), |n| n.to_string());
        let body = format!(
            r#"{{"code":200,"content":{{"nextPlayerMessageTime":{next},"videoChats":[{}]}}}}"#,
            chats.join(",")
        );
        parse_chat_page(body.as_bytes()).unwrap()
    }

    #[test]
    fn empty_page_ends() {
        let s = next_step(&at(15000), &page("page_empty.json"));
        assert!(s.keep.is_empty());
        assert_eq!(s.repeats, None);
        assert_eq!(s.next, Next::End(ChatEnd::EmptyPage));
    }

    #[test]
    fn no_cursor_ends_but_keeps() {
        let s = next_step(&at(15000), &page("page_last_null.json"));
        assert_eq!(s.keep, [0]);
        assert_eq!(s.next, Next::End(ChatEnd::NoCursor));
    }

    #[test]
    fn not_advancing_equal() {
        let s = next_step(&at(20000), &page("page_not_advancing.json"));
        assert_eq!(s.keep, [0]);
        assert_eq!(s.next, Next::End(ChatEnd::CursorNotAdvancing));
    }

    #[test]
    fn not_advancing_less() {
        let s = next_step(&at(25000), &page("page_not_advancing.json"));
        assert_eq!(s.next, Next::End(ChatEnd::CursorNotAdvancing));
    }

    #[test]
    fn first_page_continue() {
        let s = next_step(&WalkState::default(), &page("page_first.json"));
        assert_eq!(s.keep, [0, 1, 2, 3, 4]);
        assert_eq!(s.repeats, None);
        let Next::Continue(st) = s.next else { panic!() };
        assert_eq!(st.cursor, ChatCursor(15000));
        assert_eq!(st.boundary_ms, Some(15000));
        assert_eq!(st.boundary.values().sum::<u32>(), 1);
    }

    #[test]
    fn boundary_drops_repeat_only() {
        let s = next_step(&after_first(), &page("page_boundary.json"));
        assert_eq!(s.keep, [1, 2]);
        assert_eq!(
            s.repeats,
            Some(BoundaryRepeat {
                expected: 1,
                matched: 1
            })
        );
        let Next::Continue(st) = s.next else { panic!() };
        assert_eq!(st.cursor, ChatCursor(17000));
        assert_eq!(st.boundary_ms, Some(17000));
    }

    #[test]
    fn boundary_keeps_new_twin() {
        let s = next_step(&after_first(), &page("page_boundary_twins.json"));
        assert_eq!(s.keep, [1, 2], "쌍둥이 하나는 남는다");
        assert_eq!(
            s.repeats,
            Some(BoundaryRepeat {
                expected: 1,
                matched: 1
            })
        );
    }

    #[test]
    fn boundary_none_repeated() {
        let p = inline_page(&[16000, 16500, 17000], Some(17000));
        let s = next_step(&after_first(), &p);
        assert_eq!(
            s.repeats,
            Some(BoundaryRepeat {
                expected: 1,
                matched: 0
            })
        );
        assert_eq!(s.keep, [0, 1, 2]);
    }

    #[test]
    fn boundary_counts_all_page_messages() {
        // 경계 ms(15000) 메시지: 앞 페이지 되풀이 1개 + 새 1개. 새 경계는 둘 다 센다.
        let s = next_step(&after_first(), &page("page_boundary.json"));
        let Next::Continue(_) = s.next else { panic!() };
        let p = page("page_boundary.json");
        // 이 페이지의 마지막 ms는 17000 하나뿐이므로, 15000이 끝인 페이지를 따로 만든다
        let two = {
            let body = String::from_utf8(fixture("testdata/chat/page_boundary.json")).unwrap();
            // 마지막 메시지(17000)를 15000으로 바꿔 경계 ms 메시지를 셋(되풀이 1 + 새 2)으로 만든다
            let body = body.replace(
                "\"playerMessageTime\": 17000",
                "\"playerMessageTime\": 15000",
            );
            parse_chat_page(body.as_bytes()).unwrap()
        };
        assert_eq!(p.messages.len(), 3);
        let s = next_step(&after_first(), &two);
        assert_eq!(
            s.repeats,
            Some(BoundaryRepeat {
                expected: 1,
                matched: 1
            })
        );
        let Next::Continue(st) = s.next else { panic!() };
        assert_eq!(st.boundary_ms, Some(15000));
        assert_eq!(st.boundary.values().sum::<u32>(), 3, "버린 것까지 센다");
    }
}
