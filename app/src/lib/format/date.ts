// 날짜 표시.

/**
 * 치지직 API 날짜 문자열 `"YYYY-MM-DD HH:MM:SS"`(KST)를 `YYYY.MM.DD HH:MM`으로.
 * `Date`를 거치지 않는다: 값이 이미 KST 벽시계라 사용자의 시간대로 옮기면 틀린다.
 * 모양이 다르면 `null`(표시를 생략한다).
 */
export function formatKstDateTime(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}`;
}

/** 같은 문자열의 날짜만: `YYYY.MM.DD`. */
export function formatKstDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}`;
}

/**
 * 완료 시각(unix 초)을 사용자 시간대의 `오후 9:41`로(§8.5 `job.completed`).
 * `timeZone`은 테스트가 고정하려고 받는다.
 */
export function formatTimeOfDay(unixSecs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(unixSecs * 1000));
}

/**
 * 시각(unix 초)을 사용자 시간대의 `10월 9일 오후 3:20`으로(오프라인 배지·마지막 확인).
 * `timeZone`은 테스트가 고정하려고 받는다.
 */
export function formatDateTimeShort(unixSecs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(unixSecs * 1000));
}
