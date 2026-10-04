//! 코어의 공개 오류 타입.
//!
//! - `Error`는 사람이 읽는 한국어 메시지(`Display`)를 가진다.
//! - `ErrorKind`는 UI가 분기할 수 있도록 직렬화되는 오류 종류다(Tauri가 그대로 넘긴다).
//! - `Display`와 `Debug` 어디에도 쿠키 값이나 서명 토큰이 들어가서는 안 된다.
//!
//! 다른 모듈의 타입에 의존하는 변형(`HttpStatus`, `Network`)은
//! 그 타입을 만드는 구현 단계에서 추가한다(설계 문서 `## 구현 중 변경` 참고).

use std::path::PathBuf;

use serde::Serialize;

use crate::model::PlaybackKind;

/// 코어의 모든 공개 오류.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    #[error("치지직 VOD 또는 클립 주소가 아닙니다")]
    InvalidUrl,
    #[error("API 오류 {code}: {message:?}")]
    Api { code: i64, message: Option<String> },
    #[error("로그인/성인 인증이 필요합니다 (HTTP {status})")]
    AuthRequired { status: u16 },
    #[error("재생 정보가 없습니다")]
    NoPlayback { adult: bool },
    #[error("암호화된 VOD({method})는 지원하지 않습니다")]
    EncryptedVod { method: String },
    #[error("다운로드 가능한 화질이 없습니다")]
    NoQualities,
    #[error("선택한 화질({requested})을 찾을 수 없습니다")]
    QualityNotFound {
        requested: String,
        available: Vec<String>,
    },
    #[error("재생 방식이 바뀌었습니다. 화질을 다시 고르세요")]
    PlaybackChanged {
        was: PlaybackKind,
        now: PlaybackKind,
    },
    #[error("원본이 바뀌어 이어받을 수 없습니다: {detail}")]
    SourceChanged { detail: String },
    #[error("토큰 갱신 한도를 넘었습니다")]
    RefreshExhausted,
    #[error("지원하지 않는 스트림: {0:?}")]
    Unsupported(Unsupported),
    #[error("응답 형식 오류({what}): {detail}")]
    Parse { what: &'static str, detail: String },
    #[error("길이 불일치: 예상 {expected}, 실제 {actual}")]
    LengthMismatch { expected: u64, actual: u64 },
    #[error("디스크 공간이 부족합니다: {path}")]
    DiskFull { path: PathBuf },
    #[error("다른 프로그램이 파일을 사용 중입니다: {path}")]
    FileLocked { path: PathBuf },
    #[error("파일 오류({op}) {path}: {source}")]
    Io {
        op: &'static str,
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("설정 파일 오류: {0}")]
    Settings(String),
    #[error("취소됨")]
    Cancelled,
}

/// 코어가 받지 않는 스트림 형태.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unsupported {
    Discontinuity,
    SecondMap,
    /// `EXT-X-KEY`의 METHOD 값(NONE 제외)
    Encrypted(String),
    ByteRange,
    MissingMap,
    NotEnded,
    NoHlsMedia,
}

/// UI 분기용 오류 종류. `Error::kind()`로 얻는다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorKind {
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
}

impl Error {
    /// 직렬화 가능한 오류 종류.
    pub fn kind(&self) -> ErrorKind {
        match self {
            Error::InvalidUrl => ErrorKind::InvalidUrl,
            Error::Api { .. } => ErrorKind::Api,
            Error::AuthRequired { .. } => ErrorKind::AuthRequired,
            Error::NoPlayback { .. } => ErrorKind::NoPlayback,
            Error::EncryptedVod { .. } => ErrorKind::Encrypted,
            Error::NoQualities => ErrorKind::NoQualities,
            Error::QualityNotFound { .. } => ErrorKind::QualityNotFound,
            Error::PlaybackChanged { .. } => ErrorKind::PlaybackChanged,
            Error::SourceChanged { .. } => ErrorKind::SourceChanged,
            Error::RefreshExhausted => ErrorKind::RefreshExhausted,
            Error::Unsupported(_) => ErrorKind::Unsupported,
            Error::Parse { .. } => ErrorKind::Parse,
            Error::LengthMismatch { .. } => ErrorKind::LengthMismatch,
            Error::DiskFull { .. } => ErrorKind::DiskFull,
            Error::FileLocked { .. } => ErrorKind::FileLocked,
            Error::Io { .. } => ErrorKind::Io,
            Error::Settings(_) => ErrorKind::Settings,
            Error::Cancelled => ErrorKind::Cancelled,
        }
    }

    /// `.part`가 남아 있어 같은 요청으로 이어받을 수 있는가.
    ///
    /// false인 오류로 끝나면 코어가 `.part`와 sidecar를 지운다. 지우기는 되돌릴 수 없으므로
    /// 받은 바이트가 틀렸거나 같은 요청이 끝내 완료될 수 없음을 증명하는 오류만 false다.
    /// 나머지는 `.part`를 남긴다(재개 시 sidecar 동일성·지문 검증이 낡은 `.part`를 거른다).
    /// 새 변형이 분류 없이 들어오지 않도록 `_` arm을 두지 않는다.
    pub fn is_resumable(&self) -> bool {
        match self {
            Error::LengthMismatch { .. }
            | Error::SourceChanged { .. }
            | Error::PlaybackChanged { .. }
            | Error::AuthRequired { .. }
            | Error::EncryptedVod { .. }
            | Error::Unsupported(_) => false,
            Error::RefreshExhausted
            | Error::Cancelled
            | Error::DiskFull { .. }
            | Error::FileLocked { .. }
            | Error::Io { .. }
            | Error::Parse { .. }
            | Error::Api { .. }
            | Error::NoPlayback { .. }
            | Error::InvalidUrl
            | Error::NoQualities
            | Error::QualityNotFound { .. }
            | Error::Settings(_) => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_mapping() {
        assert_eq!(Error::InvalidUrl.kind(), ErrorKind::InvalidUrl);
        assert_eq!(
            Error::EncryptedVod {
                method: "AES".into()
            }
            .kind(),
            ErrorKind::Encrypted
        );
        assert_eq!(
            Error::Unsupported(Unsupported::Discontinuity).kind(),
            ErrorKind::Unsupported
        );
        assert_eq!(Error::Cancelled.kind(), ErrorKind::Cancelled);
    }

    #[test]
    fn error_kind_serializes_camel_case() {
        let s = serde_json::to_string(&ErrorKind::AuthRequired).unwrap();
        assert_eq!(s, "\"authRequired\"");
        let s = serde_json::to_string(&ErrorKind::InvalidUrl).unwrap();
        assert_eq!(s, "\"invalidUrl\"");
    }

    #[test]
    fn resumable_classification() {
        assert!(Error::Cancelled.is_resumable());
        assert!(Error::RefreshExhausted.is_resumable());
        assert!(
            Error::DiskFull {
                path: PathBuf::from("a")
            }
            .is_resumable()
        );
        assert!(
            Error::FileLocked {
                path: PathBuf::from("a")
            }
            .is_resumable()
        );
        assert!(!Error::AuthRequired { status: 403 }.is_resumable());
        assert!(
            !Error::LengthMismatch {
                expected: 2,
                actual: 1
            }
            .is_resumable()
        );
        assert!(!Error::SourceChanged { detail: "x".into() }.is_resumable());
        let changed = Error::PlaybackChanged {
            was: PlaybackKind::LiveRewindHls,
            now: PlaybackKind::Progressive,
        };
        assert!(!changed.is_resumable());
        assert_eq!(changed.kind(), ErrorKind::PlaybackChanged);
        assert!(
            !Error::EncryptedVod {
                method: "AES-128".into()
            }
            .is_resumable()
        );
        assert!(!Error::Unsupported(Unsupported::Discontinuity).is_resumable());
    }

    /// 일시적일 수 있는 오류는 `.part`를 지우지 않는다(리뷰 회귀).
    #[test]
    fn transient_errors_keep_part() {
        assert!(
            Error::Io {
                op: "write",
                path: PathBuf::from("a.part"),
                source: std::io::Error::other("EIO"),
            }
            .is_resumable()
        );
        assert!(
            Error::Parse {
                what: "video info",
                detail: "html body".into()
            }
            .is_resumable()
        );
        assert!(
            Error::Api {
                code: 500,
                message: None
            }
            .is_resumable()
        );
        assert!(Error::NoPlayback { adult: false }.is_resumable());
        assert!(Error::Settings("x".into()).is_resumable());
    }

    #[test]
    fn display_messages() {
        assert_eq!(
            Error::InvalidUrl.to_string(),
            "치지직 VOD 또는 클립 주소가 아닙니다"
        );
        assert_eq!(
            Error::EncryptedVod {
                method: "AES".into()
            }
            .to_string(),
            "암호화된 VOD(AES)는 지원하지 않습니다"
        );
    }
}
