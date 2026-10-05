//! 본인 영상 게이트(docs/design/app.md §6.2 1단계, §12).
//!
//! Phase 2에는 로그인이 없으므로 게이트는 늘 허용한다. Phase 3에서 로그인 채널을 붙일 때 쓸 판정 규칙
//! (`verdict`)만 미리 둔다: 코어 `is_own_content`의 결과가 `None`(컨텐츠에 채널 ID가 없다)이면 **거부**한다
//! (§16 사용자 결정, fail closed). 클립은 코어가 `ownerChannel`을 채널 ID로 쓰므로 제작자는 보지 않는다.

use crate::dto::EnqueueRequest;
use crate::error::AppError;

/// `enqueue` 앞의 본인 영상 검사.
#[derive(Clone, Debug, Default)]
pub struct OwnershipGate {
    _phase2: (),
}

impl OwnershipGate {
    /// Phase 2 게이트(늘 허용).
    pub fn disabled() -> Self {
        OwnershipGate::default()
    }

    /// 작업을 추가해도 되는가. Phase 2는 늘 `Ok`.
    pub fn check(&self, _req: &EnqueueRequest) -> Result<(), AppError> {
        Ok(())
    }
}

/// 코어 `is_own_content` 결과를 허용·거부로 바꾼다(Phase 3). `None`은 거부다.
pub fn verdict(own: Option<bool>) -> Result<(), AppError> {
    match own {
        Some(true) => Ok(()),
        Some(false) => Err(AppError::not_own_content()),
        None => Err(AppError::ownership_unknown()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    #[test]
    fn verdict_fails_closed() {
        assert!(verdict(Some(true)).is_ok());
        assert_eq!(
            verdict(Some(false)).unwrap_err().code,
            ErrorCode::NotOwnContent
        );
        assert_eq!(verdict(None).unwrap_err().code, ErrorCode::OwnershipUnknown);
    }
}
