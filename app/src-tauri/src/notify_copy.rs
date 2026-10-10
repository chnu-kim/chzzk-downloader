//! ko.ts의 `notify.*`·`power.reason` 값이 셸의 Rust 상수와 같은 글자인지 확인하는 대조 테스트(content.md §14).
//! 알림은 웹뷰 밖(Rust)에서 만들어져 deck을 쓸 수 없으므로 두 곳이 같은 글자를 따로 들고 있다. ko.ts가 없거나
//! 키가 없으면 실패한다.

#[cfg(test)]
mod tests {
    use chzzk_shell::notify::{
        NOTIFY_COMPLETED_TITLE, NOTIFY_FAILED_TITLE, NOTIFY_STALLED_TITLE, many_body, power_reason,
    };

    /// ko.ts 한 줄 `'<키>': '<값>',`에서 값을 읽는다(값에 작은따옴표가 없는 키만 대상이다)
    fn deck_value(deck: &str, key: &str) -> String {
        let needle = format!("'{key}':");
        let line = deck
            .lines()
            .find(|l| l.trim_start().starts_with(&needle))
            .unwrap_or_else(|| panic!("ko.ts에 키가 없다: {key}"));
        let rest = line.trim_start()[needle.len()..].trim();
        let value = rest
            .strip_prefix('\'')
            .and_then(|r| r.strip_suffix("',"))
            .unwrap_or_else(|| panic!("ko.ts 값 모양이 다르다: {key}"));
        value.to_string()
    }

    fn deck() -> String {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/copy/ko.ts");
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("ko.ts를 읽지 못했다({path}): {e}"))
    }

    #[test]
    fn titles_match_deck() {
        let d = deck();
        assert_eq!(deck_value(&d, "notify.completed"), NOTIFY_COMPLETED_TITLE);
        assert_eq!(deck_value(&d, "notify.failed"), NOTIFY_FAILED_TITLE);
        assert_eq!(deck_value(&d, "notify.stalled"), NOTIFY_STALLED_TITLE);
    }

    #[test]
    fn bodies_match_deck() {
        let d = deck();
        // 묶음 본문은 {title}·{n} 자리에 값을 넣은 Rust 출력과 같아야 한다
        let many = |key: &str| {
            deck_value(&d, key)
                .replace("{title}", "제목")
                .replace("{n}", "3")
        };
        assert_eq!(many("notify.many"), many_body("제목", 3));
        let reason = deck_value(&d, "power.reason").replace("{n}", "5");
        assert_eq!(reason, power_reason(5));
    }
}
