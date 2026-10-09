//! Worker 호출 seam과 응답 타입(worker.md §6.3·§11.3).

use std::fmt;

use chzzk_core::Secret;
use serde_json::Value;
use time::OffsetDateTime;

use super::base::WorkerBase;
use super::session::parse_time;
use super::token::{self, Grant};

/// 응답 본문 상한(64 KiB). 넘으면 Worker 형식이 아니다.
pub const MAX_BODY: usize = 64 * 1024;

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

/// `/auth/start` 요청 본문. 셋 다 비밀이 아니다(verifier는 loginSecret의 해시).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StartRequest {
    /// 루프백 수신기 포트(1024–65535)
    pub port: u16,
    /// `b64url(SHA-256(loginSecret))`
    pub login_verifier: String,
    /// 클라이언트 표시 문자열(`client_label`)
    pub client: String,
}

/// `/auth/start` 201 응답
#[derive(Clone, PartialEq, Eq)]
pub struct StartResponse {
    /// 확인 페이지 주소
    pub login_url: LoginUrl,
    /// 서버가 본 로그인 만료 시각
    pub expires_at: OffsetDateTime,
}

impl fmt::Debug for StartResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StartResponse")
            .field("login_url", &"***")
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

/// 성공한 토큰 묶음(redeem ok·refresh 200)
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

/// `/auth/redeem` 200 응답
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RedeemResponse {
    /// 로그인 성공(한 번뿐인 응답)
    Ok(TokenBundle),
    /// 허용되지 않은 채널
    Denied {
        /// 채널 이름(없으면 빈 문자열)
        channel_name: String,
    },
    /// 사용자가 확인 페이지에서 취소
    Cancelled,
    /// 서버 쪽 실패(낱말 코드)
    Failed {
        /// 실패 코드
        code: String,
    },
}

/// Worker 호출 실패(D3~D6). 주소·본문·토큰은 담지 않는다.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApiError {
    /// 응답이 없다(연결·DNS·TLS·시간 초과·본문 읽기 실패)
    Transport {
        /// 시간 초과인가
        timed_out: bool,
    },
    /// Worker 형식이 아닌 응답(HTML 오류 페이지·포털·3xx·64 KiB 초과·JSON이 아닌 성공 본문)
    NotWorker {
        /// HTTP 상태
        status: u16,
    },
    /// Worker 형식 오류 `{code}`(기대 상태가 아님)
    Worker {
        /// HTTP 상태
        status: u16,
        /// 오류 코드
        code: String,
    },
    /// 기대 상태·JSON인데 계약과 다른 본문
    Contract {
        /// HTTP 상태
        status: u16,
    },
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::Transport { timed_out: true } => f.write_str("Worker 연결 실패(시간 초과)"),
            ApiError::Transport { timed_out: false } => f.write_str("Worker 연결 실패"),
            ApiError::NotWorker { status } => write!(f, "Worker가 아닌 응답(HTTP {status})"),
            ApiError::Worker { status, code } => {
                write!(f, "Worker 오류(HTTP {status} {code})")
            }
            ApiError::Contract { status } => write!(f, "Worker 응답 형식 오류(HTTP {status})"),
        }
    }
}

impl std::error::Error for ApiError {}

/// Worker 호출 seam(§11.3). 반환 future는 `Send`(서비스가 spawn한 태스크에서 기다린다).
pub trait WorkerApi: Send + Sync + 'static {
    /// `POST /auth/start`
    fn start(
        &self,
        req: &StartRequest,
    ) -> impl Future<Output = Result<StartResponse, ApiError>> + Send;
    /// `POST /auth/redeem`
    fn redeem(
        &self,
        grant: &Grant,
        login_secret: &Secret<String>,
    ) -> impl Future<Output = Result<RedeemResponse, ApiError>> + Send;
    /// `POST /auth/refresh`
    fn refresh(
        &self,
        refresh_token: &Secret<String>,
    ) -> impl Future<Output = Result<TokenBundle, ApiError>> + Send;
    /// `POST /auth/logout`. 204면 Ok. 자격 둘 중 하나는 있어야 한다(둘 다 None이면 Worker가 401)
    fn logout(
        &self,
        access: Option<&Secret<String>>,
        refresh: Option<&Secret<String>>,
    ) -> impl Future<Output = Result<(), ApiError>> + Send;
}

/// Content-Type 미디어 형식이 application/json인가(대소문자 무시, `;` 뒤 매개변수 허용)
pub(crate) fn is_json_type(content_type: Option<&str>) -> bool {
    content_type
        .and_then(|c| c.split(';').next())
        .is_some_and(|m| m.trim().eq_ignore_ascii_case("application/json"))
}

fn is_code_word(s: &str, max: usize, digits: bool) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b == b'_' || (digits && b.is_ascii_digit()))
}

/// 기대 상태가 아닌 응답 → `Worker` 또는 `NotWorker`(D3). `body_truncated`는 64 KiB를 넘어 끝까지 읽지 않았다는 뜻
pub fn parse_error_response(
    status: u16,
    content_type: Option<&str>,
    body: &[u8],
    body_truncated: bool,
) -> ApiError {
    let not_worker = ApiError::NotWorker { status };
    // 리디렉션은 따라가지 않고 본문과 무관하게 Worker 형식이 아닌 응답으로 본다(47 (다))
    if (300..400).contains(&status) {
        return not_worker;
    }
    if body_truncated || !is_json_type(content_type) || body.len() > MAX_BODY {
        return not_worker;
    }
    let Ok(Value::Object(obj)) = serde_json::from_slice::<Value>(body) else {
        return not_worker;
    };
    match obj.get("code").and_then(Value::as_str) {
        Some(code) if is_code_word(code, 64, true) => ApiError::Worker {
            status,
            code: code.to_string(),
        },
        _ => not_worker,
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// start 201 본문(JSON) → 응답. 계약 위반이면 None.
/// loginUrl은 정확히 `{origin}/auth/login/<handle>`이어야 하고 expiresAt은 시각이어야 한다. 다른 키는 무시한다.
pub fn parse_start(body: &[u8], base: &WorkerBase) -> Option<StartResponse> {
    let v: Value = serde_json::from_slice(body).ok()?;
    let login_url = v.get("loginUrl")?.as_str()?;
    let expires_at = parse_time(v.get("expiresAt")?.as_str()?)?;
    let handle = login_url.strip_prefix(&format!("{}/auth/login/", base.origin()))?;
    if !token::is_id(handle) {
        return None;
    }
    Some(StartResponse {
        login_url: LoginUrl(Secret::new(login_url.to_string())),
        expires_at,
    })
}

/// redeem 200 본문. `ok`는 `parse_bundle`의 규칙, `denied`의 channelName·`failed`의 code는 값 검증 뒤 쓴다. 그 밖 → None
pub fn parse_redeem(body: &[u8]) -> Option<RedeemResponse> {
    let v: Value = serde_json::from_slice(body).ok()?;
    match v.get("status")?.as_str()? {
        "ok" => parse_bundle(body).map(RedeemResponse::Ok),
        "denied" => Some(RedeemResponse::Denied {
            channel_name: v
                .get("channelName")
                .and_then(Value::as_str)
                .map(|n| truncate_chars(n, 128))
                .unwrap_or_default(),
        }),
        "cancelled" => Some(RedeemResponse::Cancelled),
        "failed" => {
            let code = v
                .get("code")
                .and_then(Value::as_str)
                .filter(|c| is_code_word(c, 32, false))
                .unwrap_or("unknown");
            Some(RedeemResponse::Failed {
                code: code.to_string(),
            })
        }
        _ => None,
    }
}

/// 토큰 묶음(§6.3). serverTime은 읽지 않는다(유예 판정에 쓰지 않는다). channelName은 128자를 넘으면 잘라서 받는다
/// (한 번뿐인 redeem ok를 표시 문자열 때문에 버리지 않는다). 하나라도 틀리면 None
pub fn parse_bundle(body: &[u8]) -> Option<TokenBundle> {
    let v: Value = serde_json::from_slice(body).ok()?;
    if v.get("status")?.as_str()? != "ok" {
        return None;
    }
    let access = v.get("accessToken")?.as_str()?;
    let refresh = v.get("refreshToken")?.as_str()?;
    let channel_id = v.get("channelId")?.as_str()?;
    if !token::is_access_token(access)
        || !token::is_refresh_token(refresh)
        || !token::is_channel_id(channel_id)
    {
        return None;
    }
    Some(TokenBundle {
        access_token: Secret::new(access.to_string()),
        access_expires_at: parse_time(v.get("accessExpiresAt")?.as_str()?)?,
        refresh_token: Secret::new(refresh.to_string()),
        refresh_expires_at: parse_time(v.get("refreshExpiresAt")?.as_str()?)?,
        channel_id: channel_id.to_string(),
        channel_name: truncate_chars(v.get("channelName")?.as_str()?, 128),
        is_admin: v.get("isAdmin")?.as_bool()?,
    })
}
