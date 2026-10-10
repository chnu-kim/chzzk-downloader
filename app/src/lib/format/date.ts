// 날짜·시각 표기(content §7 D49). `Intl`·`Date` 지역 시간을 쓰지 않는다: 달력은 정수 산술(UTC 기준)이고,
// 사용자 시간대는 호출부가 분 단위 오프셋(`-new Date().getTimezoneOffset()`)으로 준다.
// Rust `chzzk_shell::format`과 같은 골든(design/format/*.json)을 읽는다.

/** 벽시계 시각(시간대 없음). `mo`는 1~12. */
export interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, mo: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
}

/** 1970-01-01부터 센 날 수(그레고리력, 음수 가능). */
function dayNumber(y: number, mo: number, d: number): number {
  const yy = mo <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (mo > 2 ? mo - 3 : mo + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 치지직 API 날짜 `"YYYY-MM-DD HH:MM:SS"`(KST)를 시간대 변환 없이 벽시계로. 모양·범위가 틀리면 null. */
export function parseKstWall(s: string | null | undefined): Wall | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59) return null;
  return { y, mo, d, h, mi };
}

/** unix 초를 `offsetMin`(UTC와의 분 차이) 시간대의 벽시계로. */
export function wallOf(unixSecs: number, offsetMin: number): Wall {
  const shifted = Math.floor(unixSecs) + offsetMin * 60;
  const days = Math.floor(shifted / 86400);
  const rem = shifted - days * 86400;
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const mo = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (mo <= 2 ? 1 : 0);
  return { y, mo, d, h: Math.floor(rem / 3600), mi: Math.floor((rem % 3600) / 60) };
}

/** `2026. 10. 3.`(끝 마침표 포함) */
export function formatDate(w: Wall): string {
  return `${w.y}. ${w.mo}. ${w.d}.`;
}

/** 12시간 `오후 9:00`(0시는 오전 12:00, 12시는 오후 12:00) */
function timeOfDay(w: Wall): string {
  return `${w.h < 12 ? '오전' : '오후'} ${w.h % 12 || 12}:${String(w.mi).padStart(2, '0')}`;
}

/** `2026. 10. 3. 오후 9:00` */
export function formatDateTime(w: Wall): string {
  return `${formatDate(w)} ${timeOfDay(w)}`;
}

/**
 * 최근 시각: 올해는 연도 생략(`10월 3일 오후 9:00`), 어제는 `어제 오후 9:00`, 오늘은 `방금`·`N분 전`·`N시간 전`.
 * 다른 해와 미래 시각은 연도를 포함한 `formatDateTime`(미래는 같은 해면 `10월 3일 …`).
 */
export function formatWhen(w: Wall, now: Wall): string {
  if (w.y !== now.y) return formatDateTime(w);
  const dayDiff = dayNumber(now.y, now.mo, now.d) - dayNumber(w.y, w.mo, w.d);
  const minDiff = dayDiff * 1440 + (now.h * 60 + now.mi) - (w.h * 60 + w.mi);
  if (minDiff >= 0 && dayDiff === 0) {
    if (minDiff < 1) return '방금';
    if (minDiff < 60) return `${minDiff}분 전`;
    return `${Math.floor(minDiff / 60)}시간 전`;
  }
  if (dayDiff === 1) return `어제 ${timeOfDay(w)}`;
  return `${w.mo}월 ${w.d}일 ${timeOfDay(w)}`;
}

/** 짧은 상대 시각: `방금` `N분 전` `N시간 전`(하루 넘게는 호출부가 `formatWhen`). */
export function formatAgo(unixSecs: number, nowUnixSecs: number): string {
  const diff = Math.floor(nowUnixSecs) - Math.floor(unixSecs);
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  return `${Math.floor(diff / 3600)}시간 전`;
}
