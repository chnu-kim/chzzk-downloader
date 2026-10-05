//! 버전 비교(semver 2.0 우선순위, 빌드 메타데이터 없음). 릴리스 버전은 scripts/ci/version-check.mjs의 SEMVER와 같은 모양이다.

use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    pub nums: [u64; 3],
    pub pre: Vec<String>,
}

fn num(s: &str) -> Option<u64> {
    if s.is_empty() || (s.len() > 1 && s.starts_with('0')) || !s.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    s.parse().ok()
}

pub fn parse(s: &str) -> Option<Version> {
    let (core, pre) = match s.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (s, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let nums = [num(parts[0])?, num(parts[1])?, num(parts[2])?];
    let pre = match pre {
        None => vec![],
        Some(p) => {
            let ids: Vec<String> = p.split('.').map(str::to_string).collect();
            if ids
                .iter()
                .any(|i| i.is_empty() || !i.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
            {
                return None;
            }
            ids
        }
    };
    Some(Version { nums, pre })
}

pub fn cmp(a: &Version, b: &Version) -> Ordering {
    match a.nums.cmp(&b.nums) {
        Ordering::Equal => {}
        o => return o,
    }
    match (a.pre.is_empty(), b.pre.is_empty()) {
        (true, true) => return Ordering::Equal,
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        _ => {}
    }
    for (x, y) in a.pre.iter().zip(&b.pre) {
        let o = match (
            x.parse::<u64>()
                .ok()
                .filter(|_| x.bytes().all(|c| c.is_ascii_digit())),
            y.parse::<u64>()
                .ok()
                .filter(|_| y.bytes().all(|c| c.is_ascii_digit())),
        ) {
            (Some(m), Some(n)) => m.cmp(&n),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => x.cmp(y),
        };
        if o != Ordering::Equal {
            return o;
        }
    }
    a.pre.len().cmp(&b.pre.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(a: &str, b: &str) -> Ordering {
        cmp(&parse(a).unwrap(), &parse(b).unwrap())
    }

    #[test]
    fn precedence() {
        assert_eq!(c("1.0.0", "0.9.9"), Ordering::Greater);
        assert_eq!(c("0.10.0", "0.9.0"), Ordering::Greater);
        assert_eq!(c("1.0.0-alpha", "1.0.0"), Ordering::Less);
        assert_eq!(c("1.0.0-alpha.1", "1.0.0-alpha"), Ordering::Greater);
        assert_eq!(c("1.0.0-alpha.beta", "1.0.0-alpha.1"), Ordering::Greater);
        assert_eq!(c("1.0.0-rc.1", "1.0.0-beta.11"), Ordering::Greater);
        assert_eq!(c("1.0.0-beta.11", "1.0.0-beta.2"), Ordering::Greater);
        assert_eq!(c("2.1.3", "2.1.3"), Ordering::Equal);
    }

    #[test]
    fn rejects_non_semver() {
        for s in [
            "1.0",
            "v1.0.0",
            "01.0.0",
            "1.0.0-",
            "1.0.0-a..b",
            "1.0.0+b",
            "1.0.x",
            "",
        ] {
            assert!(parse(s).is_none(), "{s}");
        }
    }
}
