//! 셸 상수. 이름과 값의 단일 원천은 `docs/design/system/foundations.md` §14 표다.
//! `design-tokens`의 DT15가 이 파일을 표와 대조하므로 값을 바꾸면 표도 같이 고친다.

/// 로그인 상태 확인 상한(ms)
pub const AUTH_CHECK_TIMEOUT_MS: u64 = 40_000;
/// 첫 창 안전장치(ms)
pub const SHOW_DEADLINE_MS: u64 = 1_500;
/// Dock·작업 표시줄 진행 표시 호출의 최소 간격(ms)
pub const DOCK_PROGRESS_MIN_INTERVAL_MS: u64 = 1_000;
/// OS 알림 묶음 창(ms)
pub const NOTIFY_BATCH_MS: u64 = 3_000;
/// OS 알림 본문·대화상자 제목 안 외부 문자열 절단 길이(자소 수)
pub const NOTIFY_TITLE_MAX_GRAPHEMES: usize = 40;
/// 회복 알림 기준(ms)
pub const RECOVERY_SILENT_MS: u64 = 60_000;
/// 회복 알림 표시 시간(ms)
pub const RECOVERY_NOTICE_MS: u64 = 10_000;
/// 전원 사유 문자열 길이 상한(Apple QA1340)
pub const SLEEP_REASON_MAX: usize = 128;
/// 클립보드 제안 상한(바이트)
pub const CLIPBOARD_MAX_BYTES: u64 = 4_096;
/// FAT32 파일 크기 한계(바이트)
pub const FAT32_FILE_LIMIT: u64 = 4_294_967_296;
/// 여유 공간 경고 배율
pub const LOW_SPACE_FACTOR: f64 = 1.05;
/// Windows 경로 길이 차단(UTF-16 단위, MAX_PATH 260 - 널)
pub const WINDOWS_PATH_MAX_UTF16: usize = 259;
/// 완료 그룹을 접는 개수
pub const COMPLETED_FOLD_AT: usize = 11;
/// 멈춘 지 이 일수가 지나면 오래된 작업으로 본다
pub const STALE_DAYS: u64 = 30;
/// 최근 영상 개수
pub const RECENT_MAX: usize = 5;
/// 서비스 공지 수명(시간)
pub const NOTICE_TTL_H: u64 = 72;
/// 서비스 공지 캐시(시간)
pub const NOTICE_CACHE_H: u64 = 24;
/// 서비스 공지 글자 수 상한
pub const NOTICE_MAX_CHARS: usize = 80;
/// 서킷이 열리는 연속 실패 횟수
pub const CIRCUIT_FAILURES: usize = 3;
