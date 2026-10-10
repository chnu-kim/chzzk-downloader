// 시간 표시. 숫자는 늘 정수로 내린다.

function whole(secs: number): number {
  return Number.isFinite(secs) && secs > 0 ? Math.floor(secs) : 0;
}

/**
 * 남은 시간 같은 "얼마 동안"(§8.11): `1시간 2분`, `2분 18초`, `14분`, `45초`.
 * 가장 큰 두 단위만 쓰고, 둘째 단위가 0이면 뗀다. 한 시간이 넘으면 초는 쓰지 않는다.
 */
export function formatSpan(secs: number): string {
  const s = whole(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  if (m > 0) return r > 0 ? `${m}분 ${r}초` : `${m}분`;
  return `${r}초`;
}

/** 영상 길이(§8.3): `H:MM:SS`. 시는 자리 맞춤 없이(`3:12:45`, `0:00:45`, `100:00:00`). */
export function formatClock(secs: number): string {
  const s = whole(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** 남은 시간 `m:ss`(분은 자리 맞춤 없음): 600 → `10:00`, 59 → `0:59`, 음수·NaN → `0:00` */
export function formatMmss(secs: number): string {
  const s = whole(secs);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 새 시간 표기(content §7 D50). Rust `chzzk_shell::format`과 같은 골든을 읽는다.

/** 남은 시간: 10초 미만 곧 끝나요 / 1분 미만 / 약 N분 / 약 N시간 M분 / 계산 전. 분은 내림이다. */
export function formatRemaining(secs: number | null): string {
  if (secs == null) return '남은 시간 계산 중';
  const s = whole(secs);
  if (s < 10) return '곧 끝나요';
  if (s < 60) return '1분 미만 남음';
  if (s < 3600) return `약 ${Math.floor(s / 60)}분 남음`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `약 ${h}시간 ${m}분 남음` : `약 ${h}시간 남음`;
}

/** 일 단위: `3일 전에`(하루 미만이어도 1일). */
export function formatDaysAgo(secs: number): string {
  return `${Math.max(1, Math.floor(whole(secs) / 86400))}일 전에`;
}

/** 경과(연결 대기·멈춘 지): `2분째`, `1시간 5분째`, `2시간째`. 하루 이상은 `formatDaysAgo`. 1분 미만은 `1분째`. */
export function formatElapsed(secs: number): string {
  const s = whole(secs);
  if (s >= 86400) return formatDaysAgo(s);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}분째`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `${h}시간 ${m}분째` : `${h}시간째`;
}

/** 개수: 세 자리 쉼표(`1,210`). `만`·`억` 축약 없음. */
export function formatCount(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 낭독용 남은 시간: `약 14분 남아요`, 계산 전 `남은 시간을 계산하고 있어요`, 10초 미만 `곧 끝나요`. */
export function formatSpokenRemaining(secs: number | null): string {
  if (secs == null) return '남은 시간을 계산하고 있어요';
  const s = whole(secs);
  if (s < 10) return '곧 끝나요';
  if (s < 60) return '1분도 안 남았어요';
  if (s < 3600) return `약 ${Math.floor(s / 60)}분 남아요`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m > 0 ? `약 ${h}시간 ${m}분 남아요` : `약 ${h}시간 남아요`;
}
