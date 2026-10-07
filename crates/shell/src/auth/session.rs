//! `{config_dir}/session.json`(worker.md §11.2): 원자적 쓰기, Unix 0600, origin 대조.

use std::fmt;
use std::path::{Path, PathBuf};

use chzzk_core::Secret;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

use super::api::TokenBundle;
use super::base::WorkerBase;
use super::token;

/// 파일 이름
pub const SESSION_FILE: &str = "session.json";
/// 파일 형식 버전
pub const SESSION_VERSION: u32 = 1;

/// 저장된 앱 세션(§11.2). 토큰은 `Secret`.
#[derive(Clone, PartialEq, Eq)]
pub struct StoredSession {
    /// 채널 ID
    pub channel_id: String,
    /// 채널 이름
    pub channel_name: String,
    /// 관리자 여부
    pub is_admin: bool,
    /// access 토큰
    pub access_token: Secret<String>,
    /// access 만료
    pub access_expires_at: OffsetDateTime,
    /// refresh 토큰
    pub refresh_token: Secret<String>,
    /// refresh 만료(60일 상한)
    pub refresh_expires_at: OffsetDateTime,
    /// 마지막으로 서버가 확인해 준 시각(로컬 시계)
    pub verified_at: OffsetDateTime,
}

impl StoredSession {
    /// 성공한 토큰 묶음(poll ok·refresh) + 확인 시각
    pub fn from_bundle(b: TokenBundle, verified_at: OffsetDateTime) -> Self {
        Self {
            channel_id: b.channel_id,
            channel_name: b.channel_name,
            is_admin: b.is_admin,
            access_token: b.access_token,
            access_expires_at: b.access_expires_at,
            refresh_token: b.refresh_token,
            refresh_expires_at: b.refresh_expires_at,
            verified_at,
        }
    }
}

impl fmt::Debug for StoredSession {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StoredSession")
            .field("channel_id", &self.channel_id)
            .field("channel_name", &self.channel_name)
            .field("is_admin", &self.is_admin)
            .field("access_token", &"***")
            .field("access_expires_at", &self.access_expires_at)
            .field("refresh_token", &"***")
            .field("refresh_expires_at", &self.refresh_expires_at)
            .field("verified_at", &self.verified_at)
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    v: u32,
    origin: String,
    channel_id: String,
    channel_name: String,
    is_admin: bool,
    access_token: String,
    access_expires_at: String,
    refresh_token: String,
    refresh_expires_at: String,
    verified_at: String,
}

/// 읽은 결과(D21). `Loaded` 말고는 모두 로그인 안 함으로 시작하고 파일은 지우지 않는다.
#[derive(Debug)]
pub enum LoadOutcome {
    /// 파일 없음
    Missing,
    /// 정상
    Loaded(StoredSession),
    /// 다른 Worker 출처(다른 빌드의 세션)
    OtherOrigin,
    /// 깨짐·버전 불일치·검증 실패
    Corrupt,
    /// 읽기 오류
    Unreadable,
}

/// 저장 실패. 경로·값은 담지 않는다.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StoreError {
    /// 실패한 단계
    pub op: &'static str,
    /// IO 오류 종류
    pub kind: std::io::ErrorKind,
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "session.json {} 실패({:?})", self.op, self.kind)
    }
}

impl std::error::Error for StoreError {}

/// `session.json` 읽기·쓰기·지우기
#[derive(Clone)]
pub struct SessionStore {
    dir: PathBuf,
    origin: String,
}

impl fmt::Debug for SessionStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionStore")
            .field("dir", &self.dir)
            .finish_non_exhaustive()
    }
}

/// RFC3339 문자열
pub(crate) fn fmt_time(t: OffsetDateTime) -> String {
    t.format(&Rfc3339)
        .expect("UTC 시각은 늘 RFC3339로 쓸 수 있다")
}

/// RFC3339 문자열 → UTC 시각
pub(crate) fn parse_time(s: &str) -> Option<OffsetDateTime> {
    OffsetDateTime::parse(s, &Rfc3339)
        .ok()
        .map(|t| t.to_offset(UtcOffset::UTC))
}

impl SessionStore {
    /// 설정 폴더와 Worker 출처로 연다.
    pub fn new(dir: PathBuf, base: &WorkerBase) -> Self {
        Self {
            dir,
            origin: base.origin().to_string(),
        }
    }

    /// 파일 경로
    pub fn path(&self) -> PathBuf {
        self.dir.join(SESSION_FILE)
    }

    /// 읽는다(D21). 어떤 실패도 파일을 지우지 않는다.
    pub fn load(&self) -> LoadOutcome {
        let bytes = match std::fs::read(self.path()) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return LoadOutcome::Missing,
            Err(_) => return LoadOutcome::Unreadable,
        };
        // serde 오류 문자열은 값 조각이 들어갈 수 있어 버린다.
        let Ok(f) = serde_json::from_slice::<SessionFile>(&bytes) else {
            return LoadOutcome::Corrupt;
        };
        if f.v != SESSION_VERSION {
            return LoadOutcome::Corrupt;
        }
        if f.origin != self.origin {
            return LoadOutcome::OtherOrigin;
        }
        let times = (
            parse_time(&f.access_expires_at),
            parse_time(&f.refresh_expires_at),
            parse_time(&f.verified_at),
        );
        let (Some(access_expires_at), Some(refresh_expires_at), Some(verified_at)) = times else {
            return LoadOutcome::Corrupt;
        };
        // 유예·재확인 시각 계산이 time 범위(9999년)를 넘는 파일은 깨진 것으로 본다(시작이 panic하지 않게)
        if verified_at.checked_add(super::verify::GRACE).is_none()
            || access_expires_at
                .checked_sub(super::verify::ACCESS_SKEW)
                .is_none()
        {
            return LoadOutcome::Corrupt;
        }
        if !token::is_channel_id(&f.channel_id)
            || !token::is_access_token(&f.access_token)
            || !token::is_refresh_token(&f.refresh_token)
            || f.channel_name.chars().count() > 128
        {
            return LoadOutcome::Corrupt;
        }
        LoadOutcome::Loaded(StoredSession {
            channel_id: f.channel_id,
            channel_name: f.channel_name,
            is_admin: f.is_admin,
            access_token: Secret::new(f.access_token),
            access_expires_at,
            refresh_token: Secret::new(f.refresh_token),
            refresh_expires_at,
            verified_at,
        })
    }

    /// 원자적으로 쓰고 권한을 좁힌다.
    pub fn save(&self, s: &StoredSession) -> Result<(), StoreError> {
        std::fs::create_dir_all(&self.dir).map_err(|e| StoreError {
            op: "create_dir",
            kind: e.kind(),
        })?;
        let file = SessionFile {
            v: SESSION_VERSION,
            origin: self.origin.clone(),
            channel_id: s.channel_id.clone(),
            channel_name: s.channel_name.clone(),
            is_admin: s.is_admin,
            access_token: s.access_token.expose().clone(),
            access_expires_at: fmt_time(s.access_expires_at),
            refresh_token: s.refresh_token.expose().clone(),
            refresh_expires_at: fmt_time(s.refresh_expires_at),
            verified_at: fmt_time(s.verified_at),
        };
        let bytes = serde_json::to_vec_pretty(&file).map_err(|_| StoreError {
            op: "serialize",
            kind: std::io::ErrorKind::Other,
        })?;
        let path = self.path();
        chzzk_core::fsutil::atomic_write(&path, &bytes).map_err(|e| StoreError {
            op: "write",
            kind: match e {
                chzzk_core::Error::Io { source, .. } => source.kind(),
                _ => std::io::ErrorKind::Other,
            },
        })?;
        restrict_permissions(&path).map_err(|e| StoreError {
            op: "chmod",
            kind: e.kind(),
        })
    }

    /// 지운다. 없으면 Ok.
    pub fn clear(&self) -> Result<(), StoreError> {
        match std::fs::remove_file(self.path()) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(StoreError {
                op: "remove",
                kind: e.kind(),
            }),
        }
    }
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> std::io::Result<()> {
    Ok(())
}
