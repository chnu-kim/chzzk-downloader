//! 네이티브 E2E 전용(cargo feature `e2e`, docs/design/cicd.md §6 "네이티브 E2E"). 릴리스 빌드에는 이 모듈이 없다:
//! `release-hygiene` gate가 릴리스 바이너리에 `CHZZK_E2E_` 글자가 없고 기본 feature 트리에 `e2e`가 없음을 증명하고,
//! `e2e-native` 작업의 `hygiene-seed`가 이 feature로 만든 바이너리에는 그 글자가 있음(검사가 실제로 잡는다)을 증명한다.
//!
//! 두 환경 변수가 모두 있을 때만 켜진다.
//! - `CHZZK_E2E_API_BASE`: 치지직 API·vodplay 기본 주소. 루프백(`127.0.0.1`·`localhost`·`[::1]`)의 http만 받는다
//!   (`scripts/ci/e2e-fixture-server.mjs`가 `testdata/`를 서빙한다). E2E 빌드가 실수로 퍼져도 외부로 요청하지 않는다.
//! - `CHZZK_E2E_DIR`: 설정·데이터·로그를 이 아래 `config`·`data`·`logs`에 두고, 기본 저장 폴더는 `data/downloads`다
//!   (OS 비디오·다운로드 폴더와 옛 설정을 보지 않는다). 사용자 데이터를 건드리지 않고 결과 파일 위치가 결정적이다.
//!
//! 하나만 있으면 오류로 시작하지 않는다(반쯤 켜진 E2E가 실서버나 사용자 폴더를 쓰지 않게).

use std::ffi::OsString;
use std::path::PathBuf;

use chzzk_core::{ClientConfig, Endpoints};
use chzzk_shell::services::{AppPaths, PROGRESS_INTERVAL};
use url::Url;

/// API 기본 주소(환경 변수).
pub const API_BASE_ENV: &str = "CHZZK_E2E_API_BASE";
/// 격리 폴더(환경 변수).
pub const DIR_ENV: &str = "CHZZK_E2E_DIR";

/// E2E 실행 설정.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct E2eConfig {
    pub api_base: Url,
    pub dir: PathBuf,
}

impl E2eConfig {
    /// 환경 변수 값으로 만든다. 둘 다 없으면(빈 값 포함) `Ok(None)`.
    pub fn new(api_base: Option<OsString>, dir: Option<OsString>) -> Result<Option<Self>, String> {
        let non_empty = |v: Option<OsString>| v.filter(|s| !s.is_empty());
        match (non_empty(api_base), non_empty(dir)) {
            (None, None) => Ok(None),
            (Some(_), None) | (None, Some(_)) => {
                Err(format!("E2E: {API_BASE_ENV}와 {DIR_ENV}는 함께 줘야 한다"))
            }
            (Some(base), Some(dir)) => {
                let base = base
                    .into_string()
                    .map_err(|_| format!("E2E: {API_BASE_ENV}가 UTF-8이 아니다"))?;
                let mut url =
                    Url::parse(&base).map_err(|e| format!("E2E: {API_BASE_ENV} 해석 실패: {e}"))?;
                let loopback = matches!(
                    url.host_str(),
                    Some("127.0.0.1") | Some("localhost") | Some("[::1]")
                );
                if url.scheme() != "http" || !loopback {
                    return Err(format!(
                        "E2E: {API_BASE_ENV}는 루프백 http 주소여야 한다(받음: {}://{})",
                        url.scheme(),
                        url.host_str().unwrap_or("")
                    ));
                }
                // 기본 주소로 쓰므로 경로는 `/`로 끝나야 한다(`Url::join`이 마지막 조각을 바꾸지 않게)
                if !url.path().ends_with('/') {
                    let p = format!("{}/", url.path());
                    url.set_path(&p);
                }
                let dir = PathBuf::from(dir);
                if !dir.is_absolute() {
                    return Err(format!("E2E: {DIR_ENV}는 절대 경로여야 한다"));
                }
                Ok(Some(E2eConfig { api_base: url, dir }))
            }
        }
    }

    /// 지금 프로세스의 환경.
    pub fn from_env() -> Result<Option<Self>, String> {
        Self::new(std::env::var_os(API_BASE_ENV), std::env::var_os(DIR_ENV))
    }

    /// 격리 경로. 기본 저장 폴더는 `{dir}/data/downloads`(OS 폴더를 주지 않는다).
    pub fn paths(&self) -> AppPaths {
        AppPaths::new(
            self.dir.join("config"),
            self.dir.join("data"),
            self.dir.join("logs"),
            None,
            None,
        )
    }

    /// 앱과 같은 클라이언트 설정에서 엔드포인트만 바꾼다.
    pub fn client(&self) -> ClientConfig {
        ClientConfig {
            endpoints: Endpoints {
                chzzk_api: self.api_base.clone(),
                vodplay_api: self.api_base.clone(),
            },
            progress_interval: PROGRESS_INTERVAL,
            ..ClientConfig::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(s: &str) -> Option<OsString> {
        Some(OsString::from(s))
    }

    #[cfg(unix)]
    const DIR: &str = "/tmp/e2e";
    #[cfg(windows)]
    const DIR: &str = "C:\\e2e";

    #[test]
    fn both_absent_or_empty_is_off() {
        assert_eq!(E2eConfig::new(None, None), Ok(None));
        assert_eq!(E2eConfig::new(os(""), os("")), Ok(None));
    }

    #[test]
    fn half_configured_is_an_error() {
        assert!(E2eConfig::new(os("http://127.0.0.1:1/"), None).is_err());
        assert!(E2eConfig::new(None, os(DIR)).is_err());
    }

    #[test]
    fn only_loopback_http() {
        for bad in [
            "https://127.0.0.1:1/",
            "http://api.chzzk.naver.com/",
            "http://10.0.0.1/",
            "nope",
        ] {
            assert!(E2eConfig::new(os(bad), os(DIR)).is_err(), "{bad}");
        }
        for good in [
            "http://127.0.0.1:4321/",
            "http://localhost:1/",
            "http://[::1]:2/",
        ] {
            assert!(
                E2eConfig::new(os(good), os(DIR)).unwrap().is_some(),
                "{good}"
            );
        }
    }

    #[test]
    fn relative_dir_is_an_error() {
        assert!(E2eConfig::new(os("http://127.0.0.1:1/"), os("rel")).is_err());
    }

    #[test]
    fn base_gets_trailing_slash_and_paths_are_isolated() {
        let c = E2eConfig::new(os("http://127.0.0.1:9/x"), os(DIR))
            .unwrap()
            .unwrap();
        assert_eq!(c.api_base.as_str(), "http://127.0.0.1:9/x/");
        let p = c.paths();
        assert_eq!(p.config, PathBuf::from(DIR).join("config"));
        assert_eq!(p.data, PathBuf::from(DIR).join("data"));
        assert_eq!(p.log, PathBuf::from(DIR).join("logs"));
        assert_eq!(
            p.default_download,
            PathBuf::from(DIR).join("data").join("downloads")
        );
        let cl = c.client();
        assert_eq!(cl.endpoints.chzzk_api, c.api_base);
        assert_eq!(cl.endpoints.vodplay_api, c.api_base);
        assert_eq!(cl.progress_interval, PROGRESS_INTERVAL);
    }
}
