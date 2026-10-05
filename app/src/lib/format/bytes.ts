// 코어 `chzzk_core::format_bytes`(crates/core/src/progress.rs)를 그대로 옮긴 것이다.
// 1024 단위, 소수 한 자리. 반올림은 Rust `{:.1}`(= Go `%.1f`)와 같이 정확한 .x5를 짝수 쪽으로 보낸다.
// JS `toFixed`는 1.25 → "1.3"이라 쓰지 않는다. 나눗셈은 BigInt로 정확하게 한다(div가 2의 거듭제곱이라
// 코어의 f64 나눗셈도 2^53 미만에서 정확하다).

const UNITS = 'KMGTPE';

export function formatBytes(n: number): string {
  const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (v < 1024) return `${v} B`;

  const big = BigInt(v);
  let div = 1024n;
  let exp = 0;
  let q = big / 1024n;
  while (q >= 1024n) {
    div *= 1024n;
    exp += 1;
    q /= 1024n;
  }

  // 10배 한 몫(소수 한 자리)과 나머지로 반올림한다.
  const scaled = big * 10n;
  let tenths = scaled / div;
  const twiceRem = (scaled % div) * 2n;
  if (twiceRem > div || (twiceRem === div && tenths % 2n === 1n)) tenths += 1n;

  return `${tenths / 10n}.${tenths % 10n} ${UNITS[exp]}B`;
}

/** 속도: `12.4 MB/s` */
export function formatSpeed(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

/**
 * 화질별 예상 크기(바이트). `bandwidth`(bps) × 재생 시간 / 8. 둘 중 하나라도 없으면 `null`(§8.3).
 */
export function estimateSize(bandwidth: number | null, durationSecs: number | null): number | null {
  if (bandwidth == null || durationSecs == null || bandwidth <= 0 || durationSecs <= 0) return null;
  return Math.round((bandwidth * durationSecs) / 8);
}
