//! 셸 command 층 AuthGate(worker.md §11, Phase 3b A2, 구현 중 변경 55).
//!
//! 앱 어댑터(`app/src-tauri` `handler()`)가 모든 app command를 처리기로 보내기 전에 `App::gate_command`를 부른다.
//! **기본은 거부**다: 여기 목록에 없는 command(새로 더한 것 포함)는 로그인(`SignedIn`, 오프라인 유예·낙관 포함)이
//! 아니면 `notLoggedIn`이다. 목록은 로그인 화면·창 수명·읽기 전용 작업 동기화에 필요한 것뿐이다.
//! 판정은 상태(`phase`)만 본다(구현 중 변경 51). 로그인을 쓰지 않는 빌드(`App.auth == None`)는 모두 통과한다.
//! 가짜 백엔드(`app/e2e/mock/backend.ts` `OPEN_COMMANDS`)가 같은 목록을 쓴다(`app/src/lib/gate-sync.test.ts`).

use crate::error::AppError;

/// 로그인 없이 부를 수 있는 command(이름 순).
/// - `app_info`: features.auth·버전(화면이 로그인 화면을 고를 근거)
/// - `auth_*`: 로그인 화면 자체
/// - `frontend_ready`: 기동 스모크 신호
/// - `quit`: 로그인 화면 뒤에서도 받기는 계속되므로 D1 [닫기]가 동작해야 한다
/// - `list_jobs`·`subscribe_jobs`: 로컬 작업 목록 읽기(받기를 일으키지 않는다). 구독이 로그인 전에도 이어져 재구독이 필요 없다
/// - `pause_job`은 넣지 않는다(A3 결정): 로그인 화면은 작업 목록을 그리지 않고, 멈추는 길은 `quit`(D1)이다(worker.md 구현 중 변경 A3-2)
pub const OPEN_COMMANDS: &[&str] = &[
    "app_info",
    "auth_cancel",
    "auth_copy_login_url",
    "auth_login",
    "auth_logout",
    "auth_reopen",
    "auth_retry",
    "auth_status",
    "frontend_ready",
    "list_jobs",
    "quit",
    "subscribe_jobs",
];

/// 허용 목록에 있는가
pub fn is_open(cmd: &str) -> bool {
    OPEN_COMMANDS.contains(&cmd)
}

/// 앱 상태가 없을 때(시작 실패): 허용 목록만 통과, 나머지는 `notLoggedIn`(fail closed)
pub fn gate_without_app(cmd: &str) -> Result<(), AppError> {
    if is_open(cmd) {
        Ok(())
    } else {
        Err(AppError::not_logged_in())
    }
}
