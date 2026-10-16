//! 채팅 요청 실패 분류.

use crate::error::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChatFailure {
    Retry,
    Fatal,
}

/// 채팅 전용 분류. 미디어용 `download::retry::classify_failure`를 쓰지 않는다(403을 Expired로 바꾼다, chat.md §3.2-5).
pub fn classify(e: &Error) -> ChatFailure {
    match e {
        Error::HttpStatus {
            status: 408 | 429 | 500..=599,
            ..
        }
        | Error::Network(_) => ChatFailure::Retry,
        _ => ChatFailure::Fatal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::RequestKind;

    fn http(status: u16) -> Error {
        Error::HttpStatus {
            status,
            kind: RequestKind::Api,
        }
    }

    #[test]
    fn classify_table() {
        for s in [408, 429, 500, 503, 599] {
            assert_eq!(classify(&http(s)), ChatFailure::Retry, "{s}");
        }
        for s in [400, 404, 410] {
            assert_eq!(classify(&http(s)), ChatFailure::Fatal, "{s}");
        }
        // 403은 미디어처럼 Expired·Retry로 가지 않는다
        for s in [401, 403] {
            assert_eq!(
                classify(&Error::AuthRequired { status: s }),
                ChatFailure::Fatal
            );
        }
        let parse = Error::Parse {
            what: "chat",
            detail: String::new(),
        };
        assert_eq!(classify(&parse), ChatFailure::Fatal);
        let api = Error::Api {
            code: 500,
            message: None,
        };
        assert_eq!(classify(&api), ChatFailure::Fatal);
        assert_eq!(classify(&Error::Cancelled), ChatFailure::Fatal);
    }
}
