// 시간·개수 상수. 이름과 값의 단일 원천은 docs/design/system/foundations.md §14 표이고,
// design-tokens 의 DT15 가 이 파일을 표와 대조한다. 값을 바꾸면 표도 같이 고친다.

/** 로딩 표시를 띄우기 전 지연(patterns.md §2.2) */
export const LOADER_DELAY_MS = 300;
/** 로딩 표시가 한 번 뜨면 최소로 유지하는 시간 */
export const LOADER_MIN_MS = 400;
/** 정보 토스트 수명이자 [되돌리기] 지연 삭제 창 */
export const TOAST_MS = 6000;
/** 새 항목의 --accent-soft 강조 시간 */
export const HIGHLIGHT_MS = 1000;
/** "복사했어요" 라벨이 원래 글자로 돌아오는 시간 */
export const COPIED_LABEL_MS = 2000;
/** 속도·남은 시간 갱신 간격 */
export const ETA_REFRESH_MS = 1000;
/** 로그인 상태 확인 상한(auth.checking.body 의 {secs}) */
export const AUTH_CHECK_TIMEOUT_MS = 40000;
/** 로그인 대기 화면의 stuck 안내·[다시 로그인]이 나오는 남은 시간(10분 기한에서 90초 지남) */
export const PENDING_STUCK_REMAINING_SECS = 510;
/** OS 알림 본문·대화상자 제목·토스트 안 외부 문자열 절단 길이(clipGraphemes) */
export const NOTIFY_TITLE_MAX_GRAPHEMES = 40;
/** 회복 알림을 띄우는 기준(이 시간 안에 풀리면 조용히 넘어간다) */
export const RECOVERY_SILENT_MS = 60000;
/** 회복 알림 표시 시간 */
export const RECOVERY_NOTICE_MS = 10000;
/** 완료 그룹을 접는 개수 */
export const COMPLETED_FOLD_AT = 11;
/** 멈춘 지 이 일수가 지나면 오래된 작업으로 본다 */
export const STALE_DAYS = 30;
/** 최근 영상 목록 개수 */
export const RECENT_MAX = 5;
