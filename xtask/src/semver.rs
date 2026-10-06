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
    use serde_json::Value;

    // worker/src/core/semver.ts와 같은 표(docs/design/worker.md 구현 중 변경 14 (다)). 한쪽만 고치지 않는다
    const VECTORS: &str = include_str!("../testdata/semver-vectors.json");

    fn strs(v: &Value, key: &str) -> Vec<String> {
        v[key]
            .as_array()
            .unwrap_or_else(|| panic!("{key} 배열"))
            .iter()
            .map(|s| s.as_str().expect("문자열").to_string())
            .collect()
    }

    #[test]
    fn shared_vectors() {
        let v: Value = serde_json::from_str(VECTORS).expect("semver-vectors.json");
        let cmps = v["cmp"].as_array().expect("cmp 배열");
        assert!(cmps.len() >= 10, "cmp 벡터가 비었다");
        for row in cmps {
            let (a, b) = (row[0].as_str().unwrap(), row[1].as_str().unwrap());
            let want = match row[2].as_i64().unwrap() {
                -1 => Ordering::Less,
                0 => Ordering::Equal,
                1 => Ordering::Greater,
                n => panic!("비교 결과는 -1·0·1: {n}"),
            };
            let (pa, pb) = (parse(a).expect(a), parse(b).expect(b));
            assert_eq!(cmp(&pa, &pb), want, "{a} vs {b}");
            assert_eq!(cmp(&pb, &pa), want.reverse(), "{b} vs {a}");
        }
        for s in strs(&v, "valid") {
            assert!(parse(&s).is_some(), "valid: {s:?}");
        }
        let invalid = strs(&v, "invalid");
        assert!(invalid.len() >= 10, "invalid 벡터가 비었다");
        for s in invalid {
            assert!(parse(&s).is_none(), "invalid: {s:?}");
        }
    }
}
