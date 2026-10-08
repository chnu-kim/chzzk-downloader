//! Worker 출처 검증(D2). `HttpWorkerApi`와 `SessionStore`가 같은 값을 받아 origin 비교 기준이 하나다.

use std::fmt;

use url::{Host, Url};

/// 검증된 Worker 출처. `origin()`은 `https://host[:port]`(끝 `/` 없음, 소문자 호스트, 기본 포트 생략).
#[derive(Clone, PartialEq, Eq)]
pub struct WorkerBase {
    origin: String,
}

/// Worker 주소 검증 실패 사유
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BaseError {
    /// URL로 읽을 수 없다
    Parse,
    /// https도 http도 아니다
    Scheme,
    /// http인데 루프백이 아니다
    NotLoopbackHttp,
    /// 경로가 있다
    HasPath,
    /// 쿼리가 있다
    HasQuery,
    /// 조각이 있다
    HasFragment,
    /// 사용자 정보가 있다
    HasUserInfo,
}

impl fmt::Display for BaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Worker 주소 형식이 올바르지 않습니다({self:?})")
    }
}

impl std::error::Error for BaseError {}

impl WorkerBase {
    /// 주소를 검증해 출처를 만든다. 주소 값은 오류에 담지 않는다.
    pub fn parse(s: &str) -> Result<Self, BaseError> {
        let url = Url::parse(s).map_err(|_| BaseError::Parse)?;
        if !url.username().is_empty() || url.password().is_some() {
            return Err(BaseError::HasUserInfo);
        }
        match url.scheme() {
            "https" => {}
            "http" => {
                let loopback = match url.host() {
                    Some(Host::Domain(d)) => d == "localhost",
                    Some(Host::Ipv4(ip)) => ip.is_loopback(),
                    Some(Host::Ipv6(ip)) => ip.is_loopback(),
                    None => false,
                };
                if !loopback {
                    return Err(BaseError::NotLoopbackHttp);
                }
            }
            _ => return Err(BaseError::Scheme),
        }
        if url.path() != "/" {
            return Err(BaseError::HasPath);
        }
        if url.query().is_some() {
            return Err(BaseError::HasQuery);
        }
        if url.fragment().is_some() {
            return Err(BaseError::HasFragment);
        }
        Ok(Self {
            origin: url.origin().ascii_serialization(),
        })
    }

    /// `https://host[:port]`
    pub fn origin(&self) -> &str {
        &self.origin
    }

    /// `url`의 출처(scheme+host+port)가 이 Worker와 같은가(A4 D5). 문자열 비교라 크레이트 간 `Url` 타입을 묶지 않는다.
    /// 둘 다 기본 포트를 생략하고 호스트를 소문자로 둔다. 읽을 수 없는 주소·불투명 출처(`data:` 등)는 다르다.
    pub fn same_origin(&self, url: &str) -> bool {
        Url::parse(url).is_ok_and(|u| u.origin().ascii_serialization() == self.origin)
    }

    /// `{origin}{path}` (path는 `/`로 시작)
    pub fn url(&self, path: &str) -> String {
        format!("{}{path}", self.origin)
    }
}

impl fmt::Debug for WorkerBase {
    /// 운영 주소는 로그에 남기지 않는다(cicd.md 84).
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("WorkerBase(***)")
    }
}

/// Worker `/auth/start`의 `client`(`^[\x20-\x7E]{1,128}$`): `"app/{version} {os}"`. 범위 밖 문자는 `?`로, 128자로 자른다.
pub fn client_label(version: &str) -> String {
    let raw = format!("app/{version} {}", std::env::consts::OS);
    raw.chars()
        .map(|c| if (' '..='~').contains(&c) { c } else { '?' })
        .take(128)
        .collect()
}
