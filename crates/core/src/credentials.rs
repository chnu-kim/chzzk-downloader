//! 네이버 쿠키 저장소(`{config_dir}/credentials.json`, 설계 §3.5·§7, 결정 15).
//!
//! 키체인은 쓰지 않는다(미서명 배포의 macOS ACL 프롬프트, Linux secret-service 의존).
//! Unix에서는 파일 권한을 0600으로 둔다. Windows는 사용자 프로필 폴더의 기본 ACL에 맡긴다.
//! 쿠키 값은 오류 메시지·로그 어디에도 넣지 않는다.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Error;
use crate::fsutil::{atomic_write, map_io_error};
use crate::http::NaverCookies;

/// 자격증명 파일 이름.
pub const CREDENTIALS_FILE: &str = "credentials.json";

/// 파일 형식. 값은 그대로 저장한다(암호화하지 않는다).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CredentialsFile {
    nid_aut: String,
    nid_ses: String,
}

/// 네이버 쿠키 저장소.
#[derive(Clone, Debug)]
pub struct CredentialStore {
    dir: PathBuf,
}

impl CredentialStore {
    /// `{dir}/credentials.json`을 쓰는 저장소. 파일은 `save` 때 만든다.
    pub fn new(dir: PathBuf) -> Self {
        CredentialStore { dir }
    }

    /// 파일 경로.
    pub fn path(&self) -> PathBuf {
        self.dir.join(CREDENTIALS_FILE)
    }

    /// 저장된 쿠키. 파일이 없거나 값 하나라도 비었으면 `None`, 형식이 깨졌으면 `Settings`.
    pub fn load(&self) -> Result<Option<NaverCookies>, Error> {
        let path = self.path();
        let bytes = match std::fs::read(&path) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(map_io_error("read", &path, e)),
        };
        // serde 오류 메시지에 값 조각이 들어갈 수 있으므로 원문 오류는 버린다.
        let f: CredentialsFile = serde_json::from_slice(&bytes)
            .map_err(|_| Error::Settings(format!("{CREDENTIALS_FILE} 형식이 올바르지 않습니다")))?;
        Ok(cookies_if_complete(&f.nid_aut, &f.nid_ses))
    }

    /// 쿠키를 저장한다(원자적 쓰기, Unix 0600). 값 앞뒤 공백은 지운다.
    pub fn save(&self, c: &NaverCookies) -> Result<(), Error> {
        std::fs::create_dir_all(&self.dir).map_err(|e| map_io_error("create dir", &self.dir, e))?;
        let f = CredentialsFile {
            nid_aut: c.nid_aut.expose().trim().to_string(),
            nid_ses: c.nid_ses.expose().trim().to_string(),
        };
        let bytes = serde_json::to_vec_pretty(&f)
            .map_err(|_| Error::Settings("자격증명 직렬화 실패".into()))?;
        let path = self.path();
        // 임시 파일은 tempfile이 0600으로 만들고 rename은 권한을 그대로 옮긴다. 아래는 이중 방어다.
        atomic_write(&path, &bytes)?;
        restrict_permissions(&path)
    }

    /// 저장된 쿠키를 지운다. 없으면 아무것도 하지 않는다.
    pub fn clear(&self) -> Result<(), Error> {
        let path = self.path();
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(map_io_error("remove", &path, e)),
        }
    }
}

/// 두 값이 모두 비어 있지 않을 때만 쿠키로 만든다(앞뒤 공백 제거).
pub(crate) fn cookies_if_complete(aut: &str, ses: &str) -> Option<NaverCookies> {
    let (aut, ses) = (aut.trim(), ses.trim());
    (!aut.is_empty() && !ses.is_empty()).then(|| NaverCookies::new(aut, ses))
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> Result<(), Error> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|e| map_io_error("chmod", path, e))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> Result<(), Error> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_only() {
        assert!(cookies_if_complete("a", "b").is_some());
        assert!(cookies_if_complete("a", " ").is_none());
        assert!(cookies_if_complete("", "b").is_none());
        assert_eq!(
            cookies_if_complete(" a ", "b\n").unwrap(),
            NaverCookies::new("a", "b")
        );
    }

    /// 원자적 쓰기가 0600을 보장하지 못하는 경우(다른 umask·파일 시스템)를 위한 이중 방어 자체.
    #[cfg(unix)]
    #[test]
    fn restrict_permissions_narrows() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("c.json");
        std::fs::write(&p, b"{}").unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o644)).unwrap();
        restrict_permissions(&p).unwrap();
        let mode = std::fs::metadata(&p).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
