//! 프런트로 가는 오류(`AppError`)와 코어 오류의 매핑(docs/design/app.md §5 "오류 DTO").
//!
//! - `code`는 `ErrorKind`를 빠짐없이 match해서 정한다(`_` arm 없음). 코어에 종류가 늘면 컴파일이 깨진다.
//!   예외 하나: HLS 미디어 playlist의 `EXT-X-KEY`(코어 `Unsupported::Encrypted`, kind `unsupported`)는
//!   `encrypted`로 올린다. 사용자에게는 정보 API의 `EncryptedVod`와 같은 "보호된 영상"이다(app.md 구현 중 변경).
//! - `payload`는 `Error` 변형을 match해서 정한다. `Error`는 crate 밖에서 `#[non_exhaustive]`라 `_ => None`이 필요하다.
//! - `message`는 코어 `Display`만 쓴다. 쿠키·서명 토큰이 없다는 것은 코어 불변식이다.
//! - `Deserialize`도 붙인다. 작업 저장(`jobs.json`의 `lastError`)이 그대로 읽어 들인다.

use std::fmt;
use std::path::Path;

use chzzk_core::{Error, ErrorKind, PlaybackKind, RequestKind, Unsupported};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dto::{JobId, PlaybackKindTs};

/// 프런트로 가는 오류 하나. 모든 command의 `Err` 타입이다.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    /// UI 분기 키
    pub code: ErrorCode,
    /// 코어 `Error`의 Display(셸 오류는 셸 문구). 문제 보고용
    pub message: String,
    /// 작업 오류에만. 어느 단계에서 실패했는가
    pub stage: Option<Stage>,
    /// `Error::is_resumable()`. `.part`가 실제로 남았는지는 `JobDto.partialBytes`로 본다
    pub resumable: bool,
    pub payload: Option<ErrorPayload>,
}

/// 오류 종류. 앞 20개는 `chzzk_core::ErrorKind`와 1:1, 뒤는 셸 전용이다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    InvalidUrl,
    Api,
    Http,
    AuthRequired,
    NoPlayback,
    Encrypted,
    NoQualities,
    QualityNotFound,
    PlaybackChanged,
    SourceChanged,
    RefreshExhausted,
    Unsupported,
    Parse,
    LengthMismatch,
    Network,
    DiskFull,
    FileLocked,
    Io,
    Settings,
    Cancelled,
    // 셸 전용
    JobNotFound,
    DuplicateOutput,
    InvalidInput,
    FileMissing,
    NotLoggedIn,
    NotOwnContent,
    OwnershipUnknown,
    Internal,
}

impl From<ErrorKind> for ErrorCode {
    /// 빠짐없는 match. 코어에 `ErrorKind`가 늘면 여기서 컴파일이 깨진다.
    fn from(k: ErrorKind) -> Self {
        match k {
            ErrorKind::InvalidUrl => ErrorCode::InvalidUrl,
            ErrorKind::Api => ErrorCode::Api,
            ErrorKind::Http => ErrorCode::Http,
            ErrorKind::AuthRequired => ErrorCode::AuthRequired,
            ErrorKind::NoPlayback => ErrorCode::NoPlayback,
            ErrorKind::Encrypted => ErrorCode::Encrypted,
            ErrorKind::NoQualities => ErrorCode::NoQualities,
            ErrorKind::QualityNotFound => ErrorCode::QualityNotFound,
            ErrorKind::PlaybackChanged => ErrorCode::PlaybackChanged,
            ErrorKind::SourceChanged => ErrorCode::SourceChanged,
            ErrorKind::RefreshExhausted => ErrorCode::RefreshExhausted,
            ErrorKind::Unsupported => ErrorCode::Unsupported,
            ErrorKind::Parse => ErrorCode::Parse,
            ErrorKind::LengthMismatch => ErrorCode::LengthMismatch,
            ErrorKind::Network => ErrorCode::Network,
            ErrorKind::DiskFull => ErrorCode::DiskFull,
            ErrorKind::FileLocked => ErrorCode::FileLocked,
            ErrorKind::Io => ErrorCode::Io,
            ErrorKind::Settings => ErrorCode::Settings,
            ErrorKind::Cancelled => ErrorCode::Cancelled,
        }
    }
}

/// 작업 오류가 난 단계.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Resolve,
    Download,
}

/// 요청 종류(코어 `RequestKind`는 직렬화되지 않아 셸이 미러를 둔다).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "RequestKind")]
pub enum RequestKindDto {
    Api,
    Mpd,
    Media,
}

impl From<RequestKind> for RequestKindDto {
    fn from(k: RequestKind) -> Self {
        match k {
            RequestKind::Api => RequestKindDto::Api,
            RequestKind::Mpd => RequestKindDto::Mpd,
            RequestKind::Media => RequestKindDto::Media,
        }
    }
}

/// 오류 문구에 끼워 넣을 값. 없는 종류가 대부분이다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ErrorPayload {
    Api {
        code: i64,
        api_message: Option<String>,
    },
    Http {
        status: u16,
        request_kind: RequestKindDto,
    },
    AuthRequired {
        status: u16,
    },
    NoPlayback {
        adult: bool,
    },
    QualityNotFound {
        requested: String,
        available: Vec<String>,
    },
    PlaybackChanged {
        #[ts(as = "PlaybackKindTs")]
        was: PlaybackKind,
        #[ts(as = "PlaybackKindTs")]
        now: PlaybackKind,
    },
    /// `DiskFull`, `FileLocked`, `Io`, `FileMissing`
    Path {
        path: String,
    },
    DuplicateOutput {
        job_id: JobId,
    },
}

/// UI 분기 키. `ErrorKind`를 그대로 옮기되 playlist 암호화만 `encrypted`로 올린다.
fn code_of(e: &Error) -> ErrorCode {
    match e {
        Error::Unsupported(Unsupported::Encrypted(_)) => ErrorCode::Encrypted,
        _ => e.kind().into(),
    }
}

fn path_payload(p: &Path) -> Option<ErrorPayload> {
    Some(ErrorPayload::Path {
        path: p.to_string_lossy().into_owned(),
    })
}

fn payload_of(e: &Error) -> Option<ErrorPayload> {
    match e {
        Error::Api { code, message } => Some(ErrorPayload::Api {
            code: *code,
            api_message: message.clone(),
        }),
        Error::HttpStatus { status, kind } => Some(ErrorPayload::Http {
            status: *status,
            request_kind: (*kind).into(),
        }),
        Error::AuthRequired { status } => Some(ErrorPayload::AuthRequired { status: *status }),
        Error::NoPlayback { adult } => Some(ErrorPayload::NoPlayback { adult: *adult }),
        Error::QualityNotFound {
            requested,
            available,
        } => Some(ErrorPayload::QualityNotFound {
            requested: requested.clone(),
            available: available.clone(),
        }),
        Error::PlaybackChanged { was, now } => Some(ErrorPayload::PlaybackChanged {
            was: *was,
            now: *now,
        }),
        Error::DiskFull { path } | Error::FileLocked { path } | Error::Io { path, .. } => {
            path_payload(path)
        }
        _ => None,
    }
}

impl AppError {
    /// 셸 전용 오류. `resumable = false`, `stage = None`.
    fn shell(code: ErrorCode, message: impl Into<String>, payload: Option<ErrorPayload>) -> Self {
        AppError {
            code,
            message: message.into(),
            stage: None,
            resumable: false,
            payload,
        }
    }

    /// 작업 오류의 단계를 붙인다.
    pub fn at(mut self, stage: Stage) -> Self {
        self.stage = Some(stage);
        self
    }

    /// 목록에 없는 작업 id.
    pub fn job_not_found(id: JobId) -> Self {
        Self::shell(
            ErrorCode::JobNotFound,
            format!("작업을 찾을 수 없습니다: {}", id.0),
            None,
        )
    }

    /// 같은 최종 경로의 활성 작업이 이미 있다.
    pub fn duplicate_output(job_id: JobId) -> Self {
        Self::shell(
            ErrorCode::DuplicateOutput,
            "같은 파일의 작업이 이미 목록에 있습니다",
            Some(ErrorPayload::DuplicateOutput { job_id }),
        )
    }

    /// 사용자 입력이 잘못됐다(예: 쿠키 두 값 중 하나가 비었다).
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::shell(ErrorCode::InvalidInput, message, None)
    }

    /// 열려는 파일이 없다.
    pub fn file_missing(path: &Path) -> Self {
        Self::shell(
            ErrorCode::FileMissing,
            "파일을 찾을 수 없습니다",
            path_payload(path),
        )
    }

    /// (Phase 3) 로그인하지 않았다.
    pub fn not_logged_in() -> Self {
        Self::shell(ErrorCode::NotLoggedIn, "로그인이 필요합니다", None)
    }

    /// (Phase 3) 로그인한 채널의 영상이 아니다.
    pub fn not_own_content() -> Self {
        Self::shell(ErrorCode::NotOwnContent, "내 채널의 영상이 아닙니다", None)
    }

    /// (Phase 3) 영상의 채널을 알 수 없어 거부한다(fail closed).
    pub fn ownership_unknown() -> Self {
        Self::shell(
            ErrorCode::OwnershipUnknown,
            "영상의 채널을 확인하지 못했습니다",
            None,
        )
    }

    /// 있어서는 안 되는 상태.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::shell(ErrorCode::Internal, message, None)
    }
}

impl From<Error> for AppError {
    fn from(e: Error) -> Self {
        AppError::from(&e)
    }
}

impl From<&Error> for AppError {
    fn from(e: &Error) -> Self {
        AppError {
            code: code_of(e),
            message: e.to_string(),
            stage: None,
            resumable: e.is_resumable(),
            payload: payload_of(e),
        }
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}
