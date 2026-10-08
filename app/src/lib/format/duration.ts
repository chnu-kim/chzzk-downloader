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
