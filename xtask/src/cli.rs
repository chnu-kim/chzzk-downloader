//! 인자 해석과 오류 형식. 의존성을 줄이려고 clap 없이 `--키 값`과 `--플래그`만 받는다.

use std::collections::BTreeMap;
use std::fmt;

/// 실패: code 1 = 검사 실패(판정: 내용·해시·서명이 틀림, 객체 없음), 2 = 사용법·입력·환경·기반 시설 오류(네트워크, HTTP 5xx 등).
#[derive(Debug)]
pub struct Fail {
    pub code: i32,
    pub msg: String,
}

impl fmt::Display for Fail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.msg)
    }
}

pub type Res<T> = Result<T, Fail>;

/// 검사 실패(exit 1)
pub fn fail<T>(msg: impl Into<String>) -> Res<T> {
    Err(Fail {
        code: 1,
        msg: msg.into(),
    })
}

/// 사용법·입력·환경 오류(exit 2)
pub fn usage<T>(msg: impl Into<String>) -> Res<T> {
    Err(Fail {
        code: 2,
        msg: msg.into(),
    })
}

pub fn input(msg: impl Into<String>) -> Fail {
    Fail {
        code: 2,
        msg: msg.into(),
    }
}

/// 기반 시설 오류(exit 2): 네트워크·HTTP 5xx·429·인증 등. 검증의 판정(내용이 틀림)이 아니므로 되돌리지 않는다
pub fn infra(msg: impl Into<String>) -> Fail {
    input(msg)
}

pub fn check(msg: impl Into<String>) -> Fail {
    Fail {
        code: 1,
        msg: msg.into(),
    }
}

pub struct Args {
    vals: BTreeMap<String, String>,
    flags: Vec<String>,
}

const FLAGS: &[&str] = &["objects-only"];

impl Args {
    pub fn parse(raw: &[String]) -> Res<Args> {
        let mut vals = BTreeMap::new();
        let mut flags = Vec::new();
        let mut i = 0;
        while i < raw.len() {
            let Some(k) = raw[i].strip_prefix("--") else {
                return usage(format!("인자 형식: {}(--키 값)", raw[i]));
            };
            if FLAGS.contains(&k) {
                flags.push(k.to_string());
                i += 1;
                continue;
            }
            let Some(v) = raw.get(i + 1) else {
                return usage(format!("--{k}에 값이 없다"));
            };
            if vals.insert(k.to_string(), v.clone()).is_some() {
                return usage(format!("--{k}가 두 번 있다"));
            }
            i += 2;
        }
        Ok(Args { vals, flags })
    }

    pub fn req(&self, k: &str) -> Res<String> {
        self.vals
            .get(k)
            .cloned()
            .ok_or_else(|| input(format!("--{k}가 필요하다")))
    }

    pub fn opt(&self, k: &str) -> Option<String> {
        self.vals.get(k).cloned()
    }

    pub fn flag(&self, k: &str) -> bool {
        self.flags.iter().any(|f| f == k)
    }

    /// 모르는 키가 있으면 오류(오타가 조용히 무시되지 않게)
    pub fn only(&self, keys: &[&str]) -> Res<()> {
        for k in self.vals.keys().chain(self.flags.iter()) {
            if !keys.contains(&k.as_str()) {
                return usage(format!("모르는 옵션 --{k}(받는 것: {})", keys.join(", ")));
            }
        }
        Ok(())
    }
}

/// 환경 변수(비었으면 None)
pub fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

pub fn run(args: &[String]) -> i32 {
    match args.first().map(String::as_str) {
        Some("release") => {}
        _ => {
            eprintln!("사용법: cargo xtask release <명령> [--옵션 값]… (xtask/src/main.rs)");
            return 2;
        }
    }
    let Some(cmd) = args.get(1) else {
        eprintln!("사용법: cargo xtask release <명령> …");
        return 2;
    };
    let r = Args::parse(&args[2..]).and_then(|a| crate::release::dispatch(cmd, &a));
    match r {
        Ok(()) => 0,
        Err(f) => {
            // GitHub Actions 주석으로 찍는다(로컬에서도 읽힌다)
            eprintln!("::error::xtask release {cmd}: {}", f.msg);
            f.code
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn parses_values_and_flags() {
        let a = Args::parse(&s(&["--version", "1.2.3", "--objects-only", "--dir", "x"])).unwrap();
        assert_eq!(a.req("version").unwrap(), "1.2.3");
        assert!(a.flag("objects-only"));
        assert!(a.only(&["version", "dir", "objects-only"]).is_ok());
        assert_eq!(a.only(&["version"]).unwrap_err().code, 2);
    }

    #[test]
    fn rejects_bad_shapes() {
        assert!(Args::parse(&s(&["version"])).is_err());
        assert!(Args::parse(&s(&["--version"])).is_err());
        assert!(Args::parse(&s(&["--a", "1", "--a", "2"])).is_err());
        assert_eq!(run(&s(&["nope"])), 2);
        assert_eq!(run(&s(&["release", "nope"])), 2);
    }
}
