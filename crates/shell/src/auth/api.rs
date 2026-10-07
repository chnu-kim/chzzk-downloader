//! Worker 호출 seam과 응답 타입(worker.md §6.3·§11.3).

use std::fmt;

use chzzk_core::Secret;
use time::OffsetDateTime;

/// 확인 페이지 주소(`{origin}/auth/login/<handle>`). handle은 확인 페이지 자격이라 `Debug`·로그에 내지 않는다.
#[derive(Clone, PartialEq, Eq)]
pub struct LoginUrl(Secret<String>);

impl LoginUrl {
    /// 주소 문자열(브라우저로 열 때만 쓴다)
    pub fn expose(&self) -> &str {
        self.0.expose()
    }
}

impl fmt::Debug for LoginUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LoginUrl(***)")
    }
}

/// 성공한 토큰 묶음(poll ok·refresh 200)
#[derive(Clone, PartialEq, Eq)]
pub struct TokenBundle {
    /// access 토큰
    pub access_token: Secret<String>,
    /// access 만료
    pub access_expires_at: OffsetDateTime,
    /// refresh 토큰
    pub refresh_token: Secret<String>,
    /// refresh 만료
    pub refresh_expires_at: OffsetDateTime,
    /// 채널 ID
    pub channel_id: String,
    /// 채널 이름
    pub channel_name: String,
    /// 관리자 여부
    pub is_admin: bool,
}

impl fmt::Debug for TokenBundle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TokenBundle")
            .field("access_token", &"***")
            .field("access_expires_at", &self.access_expires_at)
            .field("refresh_token", &"***")
            .field("refresh_expires_at", &self.refresh_expires_at)
            .field("channel_id", &self.channel_id)
            .field("channel_name", &self.channel_name)
            .field("is_admin", &self.is_admin)
            .finish()
    }
}
