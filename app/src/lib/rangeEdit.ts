// 미리보기 구간 편집의 상태 규칙(순수 함수, 명세 docs/design/features/preview-ux.md §5.1·§6).
// DOM·Svelte·`t()`를 import하지 않는다. 컴포넌트는 이 함수만 부르고 결과를 쓴다.
// 시간 단위는 정수 초다(PVU6). ms는 `parseClock` 경계에서만 쓴다.
import { formatClock, parseClock } from './format/duration';

export type Handle = 'start' | 'end';
/** `receive.ts`의 `RangeInput`과 같은 모양(카드의 구간 칸 상태) */
export interface Fields {
  open: boolean;
  start: string;
  end: string;
}
export type BarLength = { secs: number; source: 'meta' | 'video' };
type Mods = { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean };

/** 양수 유한수인가 */
function positive(n: number | null): n is number {
  return n != null && Number.isFinite(n) && n > 0;
}

/** 막대 길이(PVU7): meta가 있으면 meta, 없으면 유한한 video.duration, 둘 다 없으면 null */
export function timelineLength(metaSecs: number | null, videoSecs: number | null): BarLength | null {
  if (positive(metaSecs)) return { secs: metaSecs, source: 'meta' };
  if (positive(videoSecs)) return { secs: videoSecs, source: 'video' };
  return null;
}

/** 칸 글자 → 정수 초. 못 읽으면 null */
function readSecs(text: string): number | null {
  const ms = parseClock(text);
  return ms == null ? null : Math.floor(ms / 1000);
}

/** 시작 칸 글자 → 정수 초. 빈칸은 0초("처음부터", PS10). 못 읽으면 null */
function readStart(text: string): number | null {
  return text.trim() === '' ? 0 : readSecs(text);
}

/** floor(len). 길이가 이상하면 0 */
function top(len: number): number {
  return Number.isFinite(len) && len > 0 ? Math.floor(len) : 0;
}

export interface Selection {
  start: number;
  end: number;
  band: boolean;
}

/**
 * 막대에 그릴 선택(PVU8·PVU9). 접힘이면 전체. 칸을 못 읽으면 그 손잡이는 끝값(0 또는 길이).
 * 두 값은 [0, floor(len)]로 자른다. 순서가 뒤집혔거나(start ≥ end) 시작이 길이 이상이면 band=false.
 */
export function selection(f: Fields, len: number): Selection {
  const max = top(len);
  if (!f.open) return { start: 0, end: max, band: max > 0 };
  const s = Math.min(readSecs(f.start) ?? 0, max);
  const e = f.end.trim() === '' ? max : Math.min(readSecs(f.end) ?? max, max);
  return { start: s, end: e, band: s < e };
}

/** 손잡이 하나의 슬라이더 경계(aria-valuemin/max). band면 PVU6(서로 제한), 아니면 둘 다 [0, floor(len)] */
export function handleBounds(h: Handle, sel: Selection, len: number): { min: number; max: number } {
  const max = top(len);
  if (!sel.band) return { min: 0, max };
  return h === 'start' ? { min: 0, max: sel.end - 1 } : { min: sel.start + 1, max };
}

/** 막대 위 비율. 0..1로 자른다. 길이가 이상하면 0 */
export function fractionOf(secs: number, len: number): number {
  if (!(Number.isFinite(len) && len > 0) || Number.isNaN(secs)) return 0;
  return Math.min(1, Math.max(0, secs / len));
}

/** 막대 위 비율 → 초. 0..1로 자르고 내림 */
export function secsAt(fraction: number, len: number): number {
  if (!(Number.isFinite(len) && len > 0) || Number.isNaN(fraction)) return 0;
  return Math.floor(Math.min(1, Math.max(0, fraction)) * len);
}

/**
 * 손잡이 값 자르기(PVU6): other가 수면 start ∈ [0, other−1], end ∈ [other+1, floor(len)].
 * other가 null이면(band=false, PVU9) [0, floor(len)]만. len < 2면 null(고칠 수 없음). 소수 secs는 내림.
 */
export function clampHandle(h: Handle, secs: number, other: number | null, len: number): number | null {
  if (!(len >= 2) || Number.isNaN(secs)) return null;
  const max = top(len);
  let lo = 0;
  let hi = max;
  if (other != null) {
    const o = Math.min(Math.max(Math.floor(other), 0), max);
    if (h === 'start') hi = Math.max(0, o - 1);
    else lo = Math.min(max, o + 1);
  }
  return Math.min(hi, Math.max(lo, Math.floor(secs)));
}

/** 키 → 손잡이 이동(APG): ←/↓ −1, →/↑ +1, Shift는 ×10, PageDown/PageUp ∓60, Home/End는 'min'/'max'. Alt·Ctrl·Meta가 있으면 null */
export function handleKey(key: string, mods: Mods): number | 'min' | 'max' | null {
  if (mods.alt || mods.ctrl || mods.meta) return null;
  const step = mods.shift ? 10 : 1;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return -step;
    case 'ArrowRight':
    case 'ArrowUp':
      return step;
    case 'PageDown':
      return -60;
    case 'PageUp':
      return 60;
    case 'Home':
      return 'min';
    case 'End':
      return 'max';
    default:
      return null;
  }
}

/** 키 → 재생 위치 이동(편집 영역, 손잡이 밖): ←/→ ∓5. 수식 키가 하나라도 있으면 null */
export function seekKey(key: string, mods: Mods): number | null {
  if (mods.shift || mods.alt || mods.ctrl || mods.meta) return null;
  if (key === 'ArrowLeft') return -5;
  if (key === 'ArrowRight') return 5;
  return null;
}

/** 접힘(PVU8)이면 두 칸을 전체 값으로 되돌리고 연다. 열려 있으면 그대로(복사본) */
function begin(f: Fields, initialEnd: string): Fields {
  return f.open ? { ...f } : { open: true, start: formatClock(0), end: initialEnd };
}

/** 끝 칸 글자: video 길이를 쓰는 중이고 끝이 floor(len) 이상이면 '' (끝까지, PVU7), 아니면 시각 */
function endText(v: number, len: BarLength): string {
  return len.source === 'video' && v >= top(len.secs) ? '' : formatClock(v);
}

/**
 * 손잡이 하나를 secs로 옮긴 뒤의 새 칸(PVU6·PVU7·PVU8·PVU9). 접힘이면 다른 칸을 전체 값으로 되돌리고 open=true.
 * 자르기는 selection(f).band가 참이면 다른 손잡이로, 거짓이면 [0, floor(len)]만. 고칠 수 없으면(len < 2) null.
 */
export function moveHandle(f: Fields, h: Handle, secs: number, len: BarLength, initialEnd: string): Fields | null {
  const sel = selection(f, len.secs);
  const other = sel.band ? (h === 'start' ? sel.end : sel.start) : null;
  const v = clampHandle(h, secs, other, len.secs);
  if (v == null) return null;
  const next = begin(f, initialEnd);
  if (h === 'start') next.start = formatClock(v);
  else next.end = endText(v, len);
  return next;
}

/**
 * ±n초(PVU6). len은 카드의 막대 길이(없으면 null: 끝 상한 없이 시작만 끝−1로 묶는다).
 * 고칠 칸을 못 읽으면 null(단추 비활성). 순서가 뒤집혔으면 그 칸만 [0, floor(len)](len null이면 [0, ∞))로 자른다.
 */
export function nudge(f: Fields, h: Handle, delta: number, len: BarLength | null, initialEnd: string): Fields | null {
  if (len != null && !(len.secs >= 2)) return null;
  const next = begin(f, initialEnd);
  const max = len == null ? Number.POSITIVE_INFINITY : top(len.secs);
  const sRaw = readStart(next.start);
  // 빈 끝 칸은 "끝까지": 길이를 알면 그 값, 모르면 값이 없다(끝 칸은 고칠 수 없고 시작 상한은 없다)
  const blankEnd = next.end.trim() === '';
  const eRaw = blankEnd ? (len == null ? Number.POSITIVE_INFINITY : max) : readSecs(next.end);
  const cur = h === 'start' ? sRaw : eRaw;
  if (cur == null || !Number.isFinite(cur)) return null;
  // 못 읽는 다른 칸은 selection과 같게 본다: 시작은 0, 끝은 길이(길이 모르면 ∞). 그래서 moveHandle과 경계가 같다
  const s = sRaw ?? 0;
  const e = eRaw ?? max;
  const sc = Math.min(s, max);
  const ec = Math.min(e, max);
  const band = sc < ec;
  let lo = 0;
  let hi = max;
  if (band) {
    if (h === 'start') hi = ec - 1;
    else lo = sc + 1;
  }
  const v = Math.min(hi, Math.max(lo, Math.floor(cur + delta)));
  if (h === 'start') next.start = formatClock(v);
  else next.end = len == null ? formatClock(v) : endText(v, len);
  return next;
}

/** 찍기(PVU9): 그 칸에 formatClock(floor(t))만 넣는다(자르지 않음). 접힘이면 다른 칸을 전체 값으로 */
export function mark(f: Fields, h: Handle, t: number, initialEnd: string): Fields {
  const next = begin(f, initialEnd);
  next[h] = formatClock(t);
  return next;
}

/** 칸 → 영상(PVU10): 읽히면 그 초(floor(len)로 자름), 아니면 null. 빈 끝 칸은 null(이동 없음), 빈 시작 칸은 0초(PS10) */
export function seekTargetOf(text: string, len: number, h: Handle = 'end'): number | null {
  const s = h === 'start' ? readStart(text) : readSecs(text);
  return s == null ? null : Math.min(s, top(len));
}

/** 구간 보기 한 걸음(PVU11, §6.3 표) */
export type PlayMode = 'off' | 'range' | 'loop';
export function playStep(
  mode: PlayMode,
  ev: { kind: 'time' | 'ended' | 'pause' | 'seeked'; t: number; byUs: boolean },
  sel: { start: number; end: number; toEnd: boolean },
): { mode: PlayMode; action: 'none' | 'pause' | 'restart' } {
  const stay = { mode, action: 'none' as const };
  const off = { mode: 'off' as const, action: 'none' as const };
  if (mode === 'off') return off;
  switch (ev.kind) {
    case 'time':
      if (ev.t < sel.end) return stay;
      return mode === 'loop' ? { mode, action: 'restart' } : { mode: 'off', action: 'pause' };
    case 'pause':
      return ev.byUs ? stay : off;
    case 'seeked':
      return ev.byUs || (ev.t >= sel.start && ev.t < sel.end) ? stay : off;
    case 'ended':
      return mode === 'loop' && sel.toEnd ? { mode, action: 'restart' } : off;
  }
}

/** 우리 탐색 표시(V6): 목표가 있고 |t − target| ≤ 0.5이면 byUs=true. 맞든 아니든 표시는 한 번 쓰고 버린다 */
export function consumeOwnSeek(pending: number | null, t: number): { byUs: boolean; pending: null } {
  return { byUs: pending != null && Math.abs(t - pending) <= 0.5, pending: null };
}

/** 끝이 영상 끝인가: 끝 칸이 빈칸(끝까지)이거나 end ≥ floor(len) */
export function reachesEnd(sel: { end: number }, endText: string, len: number): boolean {
  return endText.trim() === '' || sel.end >= top(len);
}
