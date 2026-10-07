//! 로그인 단계와 사유(worker.md §11.4). DTO(`AuthState`·`AuthReason`) 매핑은 A2.

/// 로그인 단계(DTO `AuthState`에서 `Disabled`를 뺀 것 + `Checking`)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthPhase {
    /// 저장 세션을 서버로 확인하는 중
    Checking,
    /// 로그인 안 함
    SignedOut,
    /// 확인 페이지 응답을 기다리는 중
    Pending,
    /// 로그인됨(온라인·오프라인 유예·낙관 포함)
    SignedIn,
    /// 허용되지 않음
    Denied,
    /// 세션 만료
    Expired,
    /// 로그인 취소
    Cancelled,
    /// 오류
    Error,
}

/// §11.4 AuthReason과 같은 9개
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthReason {
    /// 로그인 제한 시간 초과
    LoginTimeout,
    /// 세션 만료
    SessionExpired,
    /// 세션이 끊김
    Revoked,
    /// 허용 목록에서 빠짐
    RemovedFromAllowlist,
    /// 재사용 감지로 끊김
    ReuseDetected,
    /// 오프라인 유예(72시간) 종료
    GraceExpired,
    /// 네트워크 문제
    Network,
    /// 서버 문제
    Server,
    /// 로그인 흐름을 서버가 잃음
    LoginLost,
}
