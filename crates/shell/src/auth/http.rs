//! `WorkerApi`의 reqwest 구현(worker.md §11.3). 리디렉션은 따라가지 않고, 오류 문자열은 URL이 들어 있어 쓰지 않는다.

use std::fmt;
use std::time::Duration;

use chzzk_core::Secret;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{Value, json};

use super::api::{
    ApiError, MAX_BODY, PollResponse, StartRequest, StartResponse, TokenBundle, WorkerApi,
    is_json_type, parse_bundle, parse_error_response, parse_poll, parse_start,
};
use super::base::WorkerBase;

/// 요청 하나의 전체 시간 상한(§11.3 "10초 시간 초과")
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// reqwest로 Worker를 부른다.
#[derive(Clone)]
pub struct HttpWorkerApi {
    client: reqwest::Client,
    base: WorkerBase,
}

impl fmt::Debug for HttpWorkerApi {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HttpWorkerApi").finish_non_exhaustive()
    }
}

struct Raw {
    status: u16,
    content_type: Option<String>,
    body: Vec<u8>,
    truncated: bool,
}

impl HttpWorkerApi {
    /// 요청당 `REQUEST_TIMEOUT`. 클라이언트를 만들지 못하면 `Transport`.
    pub fn new(base: WorkerBase) -> Result<Self, ApiError> {
        Self::with_timeout(base, REQUEST_TIMEOUT)
    }

    /// 테스트용: 시간 상한을 바꾼다.
    pub fn with_timeout(base: WorkerBase, timeout: Duration) -> Result<Self, ApiError> {
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .connect_timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .user_agent(format!("chzzk-downloader/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| {
                // 원인을 로그에 남긴다. 요청 전이라 주소가 없지만 규칙대로 URL을 떼고 남긴다
                tracing::error!(error = %e.without_url(), "로그인 서버 HTTP 클라이언트를 만들지 못함");
                ApiError::Transport { timed_out: false }
            })?;
        Ok(Self { client, base })
    }

    /// 검증된 Worker 출처
    pub fn base(&self) -> &WorkerBase {
        &self.base
    }

    /// POST {origin}{path}, JSON 본문, 선택 Bearer. 오류 값(URL 포함)은 버리고 종류만 남긴다.
    async fn post(&self, path: &str, body: Value, bearer: Option<&str>) -> Result<Raw, ApiError> {
        let transport = |e: reqwest::Error| ApiError::Transport {
            timed_out: e.is_timeout(),
        };
        let bytes =
            serde_json::to_vec(&body).map_err(|_| ApiError::Transport { timed_out: false })?;
        let mut req = self
            .client
            .post(self.base.url(path))
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "application/json")
            .body(bytes);
        if let Some(b) = bearer {
            req = req.header(AUTHORIZATION, format!("Bearer {b}"));
        }
        let mut resp = req.send().await.map_err(transport)?;
        let status = resp.status().as_u16();
        let content_type = resp
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let mut buf = Vec::new();
        let mut truncated = resp.content_length().is_some_and(|n| n > MAX_BODY as u64);
        while !truncated {
            match resp.chunk().await.map_err(transport)? {
                Some(c) => {
                    buf.extend_from_slice(&c);
                    if buf.len() > MAX_BODY {
                        truncated = true;
                    }
                }
                None => break,
            }
        }
        Ok(Raw {
            status,
            content_type,
            body: buf,
            truncated,
        })
    }
}

/// 기대 상태면 본문을 `parse`로, 아니면 오류 분류. JSON이 아니거나 잘렸으면 `NotWorker`, 계약 위반이면 `Contract`.
fn expect<T>(raw: Raw, want: u16, parse: impl FnOnce(&[u8]) -> Option<T>) -> Result<T, ApiError> {
    if raw.status != want {
        return Err(parse_error_response(
            raw.status,
            raw.content_type.as_deref(),
            &raw.body,
            raw.truncated,
        ));
    }
    if raw.truncated || !is_json_type(raw.content_type.as_deref()) {
        return Err(ApiError::NotWorker { status: want });
    }
    parse(&raw.body).ok_or(ApiError::Contract { status: want })
}

impl WorkerApi for HttpWorkerApi {
    fn start(
        &self,
        req: &StartRequest,
    ) -> impl Future<Output = Result<StartResponse, ApiError>> + Send {
        let body = json!({"pollVerifier": req.poll_verifier, "client": req.client});
        async move {
            let raw = self.post("/auth/start", body, None).await?;
            expect(raw, 201, |b| parse_start(b, &self.base))
        }
    }

    fn poll(
        &self,
        login_id: &Secret<String>,
        poll_secret: &Secret<String>,
    ) -> impl Future<Output = Result<PollResponse, ApiError>> + Send {
        let body = json!({"loginId": login_id.expose(), "pollSecret": poll_secret.expose()});
        async move {
            let raw = self.post("/auth/poll", body, None).await?;
            expect(raw, 200, parse_poll)
        }
    }

    fn refresh(
        &self,
        refresh_token: &Secret<String>,
    ) -> impl Future<Output = Result<TokenBundle, ApiError>> + Send {
        let body = json!({"refreshToken": refresh_token.expose()});
        async move {
            let raw = self.post("/auth/refresh", body, None).await?;
            expect(raw, 200, parse_bundle)
        }
    }

    fn logout(
        &self,
        access: Option<&Secret<String>>,
        refresh: Option<&Secret<String>>,
    ) -> impl Future<Output = Result<(), ApiError>> + Send {
        let body = match refresh {
            Some(r) => json!({"refreshToken": r.expose()}),
            None => json!({}),
        };
        let bearer = access.map(|a| a.expose().clone());
        async move {
            let raw = self.post("/auth/logout", body, bearer.as_deref()).await?;
            if raw.status == 204 {
                return Ok(());
            }
            Err(parse_error_response(
                raw.status,
                raw.content_type.as_deref(),
                &raw.body,
                raw.truncated,
            ))
        }
    }
}
