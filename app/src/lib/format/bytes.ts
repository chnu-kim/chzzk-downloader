// 크기·속도 표기(content.md §7 D47·D48, platform.md §20). 정수(BigInt) 산술만 쓰고 `Intl`·`toFixed`는 쓰지 않는다.
// Rust `chzzk_shell::format`과 같은 골든(design/format/*.json)을 읽는다.

import type { Os } from '../bindings';

/**
 * 화질별 예상 크기(바이트). `bandwidth`(bps) × 재생 시간 / 8. 둘 중 하나라도 없으면 `null`(§8.3).
 */
export function estimateSize(bandwidth: number | null, durationSecs: number | null): number | null {
  if (bandwidth == null || durationSecs == null || bandwidth <= 0 || durationSecs <= 0) return null;
  return Math.round((bandwidth * durationSecs) / 8);
}

// ---------------------------------------------------------------------------

/** 숫자와 단위 사이 띄움(D48). 뒤집으려면 이 상수 하나를 바꾼다. */
export const UNIT_GAP = '';

export type SizeBase = 1000 | 1024;
export type FormatOs = Os;

/**
 * Windows 탐색기는 내림이라는 보고가 있으나 실기 확인 전이다(content §16-2 [미확인]).
 * 'floor'로 바꾸면 1024 진법에서만 내림한다.
 */
export const WINDOWS_ROUNDING: 'round' | 'floor' = 'round';

/** OS 진법: Windows 1024, 그 밖 1000. */
export function sizeBaseOf(os: FormatOs): SizeBase {
  return os === 'windows' ? 1024 : 1000;
}

const LABELS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const SPOKEN = ['바이트', '킬로바이트', '메가바이트', '기가바이트', '테라바이트'] as const;
const MAX_UNIT = LABELS.length - 1;

function wholeBytes(n: number): bigint {
  return Number.isFinite(n) && n > 0 ? BigInt(Math.floor(n)) : 0n;
}

/** num/den를 정수로: 'round'는 0.5 올림, 'floor'는 내림. */
function divide(num: bigint, den: bigint, mode: 'round' | 'floor'): bigint {
  return mode === 'floor' ? num / den : (2n * num + den) / (2n * den);
}

function modeOf(base: SizeBase): 'round' | 'floor' {
  return base === 1024 ? WINDOWS_ROUNDING : 'round';
}

/** 단위 k의 몫(base^k). */
function powOf(base: SizeBase, k: number): bigint {
  return BigInt(base) ** BigInt(k);
}

/** 크기가 속한 단위 번호(0=B). 마지막 단위 TB 위는 TB로 둔다. */
function unitOf(v: bigint, base: SizeBase): number {
  let k = 0;
  while (k < MAX_UNIT && v >= powOf(base, k + 1)) k += 1;
  return k;
}

/** 정수 r을 소수 d자리로 찍는다: (1234, 2) → "12.34" */
function withDecimals(r: bigint, d: number): string {
  if (d === 0) return r.toString();
  const unit = 10n ** BigInt(d);
  return `${r / unit}.${(r % unit).toString().padStart(d, '0')}`;
}

/**
 * 완료된 크기: 유효숫자 3자리(7.82GB, 22.9KB, 123KB, 999B). 반올림이 한 단위(base)에 닿으면 다음 단위로 올린다
 * (999.5KB → 1.00MB). 1024 진법도 같다(1023.5KB → 1.00MB).
 */
export function formatFileSize(bytes: number, base: SizeBase): string {
  const v = wholeBytes(bytes);
  let k = unitOf(v, base);
  if (k === 0) return `${v}${UNIT_GAP}B`;
  const mode = modeOf(base);
  for (;;) {
    const div = powOf(base, k);
    // 소수 2자리(10 미만) → 1자리(100 미만) → 0자리 순으로 3자리에 맞는 첫 표기를 고른다
    let text = '';
    let carried = false;
    for (const d of [2, 1, 0]) {
      const r = divide(v * 10n ** BigInt(d), div, mode);
      if (d === 0 && r >= BigInt(base) && k < MAX_UNIT) {
        carried = true;
        break;
      }
      if (r < 1000n || d === 0) {
        text = withDecimals(r, d);
        break;
      }
    }
    if (!carried) return `${text}${UNIT_GAP}${LABELS[k]}`;
    k += 1;
  }
}

/** 소수 1자리 고정 표기를 위한 단위 번호: 반올림 결과가 base에 닿으면 올린다. */
function fixedUnit(v: bigint, base: SizeBase): number {
  let k = unitOf(v, base);
  const mode = modeOf(base);
  while (k > 0 && k < MAX_UNIT && divide(v * 10n, powOf(base, k), mode) >= BigInt(base) * 10n) k += 1;
  return k;
}

function fixed1(v: bigint, k: number, base: SizeBase): string {
  if (k === 0) return `${v}${UNIT_GAP}B`;
  return `${withDecimals(divide(v * 10n, powOf(base, k), modeOf(base)), 1)}${UNIT_GAP}${LABELS[k]}`;
}

/**
 * 진행 "받은 양 / 전체": 두 값을 같은 단위로 소수 1자리(2.3GB / 4.0GB). 전체를 모르면 받은 양의 단위.
 * 바이트(B) 단위는 소수가 없어 정수다.
 */
export function formatProgressSize(
  received: number,
  total: number | null,
  base: SizeBase,
): { received: string; total: string | null } {
  const r = wholeBytes(received);
  const t = total == null ? null : wholeBytes(total);
  const k = fixedUnit(t != null && t > r ? t : r, base);
  return { received: fixed1(r, k, base), total: t == null ? null : fixed1(t, k, base) };
}

/** 예상 크기: `약 7.8GB` */
export function formatEstimate(bytes: number, base: SizeBase): string {
  const v = wholeBytes(bytes);
  return `약 ${fixed1(v, fixedUnit(v, base), base)}`;
}

/** 속도: `12.4MB/s`(바이트만, Mbps 금지) */
export function formatSpeed(bytesPerSec: number, base: SizeBase): string {
  const v = wholeBytes(bytesPerSec);
  return `${fixed1(v, fixedUnit(v, base), base)}/s`;
}

/** 퍼센트: 정수 내림, 완료 전에는 0~99. `complete`가 참일 때만 100%. */
export function formatPercent(received: number, total: number, complete = false): string {
  if (complete) return '100%';
  const r = wholeBytes(received);
  const t = wholeBytes(total);
  if (t === 0n) return '0%';
  const p = (r * 100n) / t;
  return `${p > 99n ? 99n : p}%`;
}

/** 낭독용 크기: `7.8기가바이트` */
export function formatSpokenSize(bytes: number, base: SizeBase): string {
  const v = wholeBytes(bytes);
  const k = fixedUnit(v, base);
  if (k === 0) return `${v}${SPOKEN[0]}`;
  return `${withDecimals(divide(v * 10n, powOf(base, k), modeOf(base)), 1)}${SPOKEN[k]}`;
}

/** 낭독용 속도: `초당 12.4메가바이트` */
export function formatSpokenSpeed(bps: number, base: SizeBase): string {
  return `초당 ${formatSpokenSize(bps, base)}`;
}

/** 낭독용 퍼센트: `58퍼센트`(내림, 0~100) */
export function formatSpokenPercent(p: number): string {
  const v = Number.isFinite(p) && p > 0 ? Math.floor(p) : 0;
  return `${v > 100 ? 100 : v}퍼센트`;
}
