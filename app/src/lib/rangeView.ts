// 구간 편집 화면의 시간 영역 순수 모델(명세 docs/design/features/range-editor.md §6.2·§7).
// DOM·Svelte·`t()`를 import하지 않는다. 컴포넌트는 이 함수만 부르고 결과를 쓴다.
// 시간 단위는 초(실수 허용)다. 손잡이 값을 정수 초로 내리는 일은 호출자가 한다.

/** 보이는 범위: `start`부터 `span`초 */
export interface View {
  start: number;
  span: number;
}

/** 확대 하한(초) */
export const MIN_VIEW_SECS = 20;
/** `clampView`가 거의 전체인 span을 전체로 맞추는 허용치(초) */
export const SNAP_SECS = 0.5;
/** 휠 `deltaMode` 줄 단위의 px 환산 */
export const LINE_PX = 16;
/** 눈금 사이 최소 px */
export const TICK_MIN_PX = 80;
/** 키 `+`·`-` 배율 */
export const KEY_ZOOM_FACTOR = 2;

const WHEEL_ZOOM_RATE = 0.002;

function validLength(L: number): boolean {
  return Number.isFinite(L) && L > 0;
}

/** 전체 보기. 길이가 이상하면 `{0, 0}` */
export function fullView(L: number): View {
  return validLength(L) ? { start: 0, span: L } : { start: 0, span: 0 };
}

/** 보이는 범위를 불변식 안으로 자른다(span ∈ [min(minSpan, L), L], start ∈ [0, L − span]) */
export function clampView(v: View, L: number, minSpan: number): View {
  if (!validLength(L)) return { start: 0, span: 0 };
  if (!Number.isFinite(v.start) || !Number.isFinite(v.span)) return fullView(L);
  const lo = Math.min(minSpan, L);
  const span = Math.min(L, Math.max(lo, v.span));
  // 휠 배율이 확대·축소를 정확히 상쇄하지 않아 `L − ε`가 남는 것을 전체로 맞춘다.
  // 하한 `lo`가 스냅 구간에 들어가면 확대가 막히므로 맞춤 폭은 (L − lo)/2 이하로 줄인다
  const snap = Math.min(SNAP_SECS, (L - lo) / 2);
  if (span >= L - snap) return { start: 0, span: L };
  return { start: Math.min(L - span, Math.max(0, v.start)), span };
}

/** 확대돼 있는가 */
export function zoomed(v: View, L: number): boolean {
  return v.span < L;
}

/** 트랙 x(px) → 초. 범위 밖 x는 자르고 내리지 않는다. 폭이 0 이하이면 `start` */
export function secsAtX(x: number, w: number, v: View): number {
  if (!(w > 0)) return v.start;
  return v.start + Math.min(1, Math.max(0, x / w)) * v.span;
}

/** 초 → 트랙 x(px). 보이는 범위 밖은 음수·폭 초과로 나온다(자르지 않는다) */
export function xOfSecs(secs: number, w: number, v: View): number {
  if (!(v.span > 0)) return 0;
  return ((secs - v.start) / v.span) * w;
}

export type Placement = 'before' | 'inside' | 'after';

/** 시각이 보이는 범위 어디에 있나(양 끝은 안) */
export function placement(secs: number, v: View): Placement {
  if (secs < v.start) return 'before';
  if (secs > v.start + v.span) return 'after';
  return 'inside';
}

/** `anchor`(초)의 화면 위치를 지키며 `factor`배 확대한다(1보다 작으면 축소) */
export function zoomAt(v: View, factor: number, anchor: number, L: number, minSpan: number): View {
  if (!(factor > 0) || !Number.isFinite(factor) || !(v.span > 0)) return v;
  const lo = Math.min(minSpan, L);
  const span = Math.min(L, Math.max(lo, v.span / factor));
  const start = anchor - ((anchor - v.start) * span) / v.span;
  return clampView({ start, span }, L, minSpan);
}

/** `dSecs`만큼 옮긴다. 실제로 움직였는지 함께 돌려준다(휠 `preventDefault` 판단) */
export function panBy(v: View, dSecs: number, L: number): { view: View; moved: boolean } {
  if (!Number.isFinite(dSecs)) return { view: v, moved: false };
  const start = Math.min(Math.max(0, L - v.span), Math.max(0, v.start + dSecs));
  return { view: { start, span: v.span }, moved: start !== v.start };
}

/** 휠 px → 초 */
export function wheelPanSecs(px: number, trackW: number, span: number): number {
  return trackW > 0 ? (px / trackW) * span : 0;
}

/** `secs`가 가장자리 margin 안이면 그 자리까지 옮긴다. 안이면 그대로 */
export function reveal(v: View, secs: number, L: number, margin = 0.1): View {
  const lo = v.start + margin * v.span;
  const hi = v.start + (1 - margin) * v.span;
  if (secs >= lo && secs <= hi) return v;
  const start = secs < lo ? secs - margin * v.span : secs - (1 - margin) * v.span;
  return clampView({ start, span: v.span }, L, v.span);
}

/** 재생 위치가 보이는 범위를 벗어나면 쪽을 넘긴다. 전체 보기면 그대로 */
export function follow(v: View, pos: number, L: number): View {
  if (!zoomed(v, L)) return v;
  if (pos >= v.start && pos < v.start + v.span) return v;
  return clampView({ start: pos - 0.1 * v.span, span: v.span }, L, v.span);
}

/** 눈금 간격 후보(초) */
const NICE_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** 보이는 범위의 눈금 시각들(초). 간격은 한 칸이 `TICK_MIN_PX` 이상인 가장 작은 값 */
export function ticks(v: View, w: number): number[] {
  if (!(v.span > 0) || !(w > 0)) return [];
  const minStep = (TICK_MIN_PX / w) * v.span;
  let step = NICE_STEPS.find((s) => s >= minStep);
  if (step == null) step = Math.ceil(minStep / 7200) * 7200;
  const out: number[] = [];
  const end = v.start + v.span;
  for (let s = Math.ceil(v.start / step) * step; s <= end + 1e-9; s += step) out.push(s);
  return out;
}

export interface WheelEventLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type WheelIntent = { kind: 'zoom'; dyPx: number } | { kind: 'pan'; px: number } | null;

/** 휠 이벤트 → 확대 또는 이동(§7.3). 축은 하나만 고른다 */
export function wheelIntent(e: WheelEventLike, ctx: { mac: boolean; trackW: number }): WheelIntent {
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? ctx.trackW : 1;
  const dx = e.deltaX * unit;
  const dy = e.deltaY * unit;
  if (dx === 0 && dy === 0) return null;
  if (e.ctrlKey || (ctx.mac && e.metaKey)) return { kind: 'zoom', dyPx: dy };
  const px = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
  return px === 0 ? null : { kind: 'pan', px };
}

/** 휠 dy(px) → 확대 배율. 위로 굴리면(dy < 0) 확대. 한 이벤트당 [0.5, 2] */
export function zoomFactor(dyPx: number): number {
  return Math.min(2, Math.max(0.5, Math.exp(-dyPx * WHEEL_ZOOM_RATE)));
}

export interface MonitorInput {
  stageW: number;
  stageH: number;
  /** 조작 줄 높이 */
  controlsH: number;
  /** 영상 위 여백 */
  padTop: number;
  narrow: boolean;
  videoMinH: number;
  controlsMinW: number;
}

/** 영상 상자와 조작 줄 폭(§6.2). 좁은 레이아웃은 `stageH`를 쓰지 않는다 */
export function monitorSize(i: MonitorInput): { videoW: number; videoH: number; rowW: number } {
  // 첫 측정 전(0)이나 이상한 폭은 영상 폭 0, 높이 하한, 조작 줄 0
  if (!(i.stageW > 0)) return { videoW: 0, videoH: i.videoMinH, rowW: 0 };
  if (i.narrow) {
    return {
      videoW: i.stageW,
      videoH: Math.max(i.videoMinH, Math.round((i.stageW * 9) / 16)),
      rowW: i.stageW,
    };
  }
  const h = Math.max(i.videoMinH, i.stageH - i.controlsH - i.padTop);
  const videoW = Math.min(i.stageW, Math.round((h * 16) / 9));
  const videoH = Math.round((videoW * 9) / 16);
  return { videoW, videoH, rowW: Math.min(i.stageW, Math.max(videoW, i.controlsMinW)) };
}

/** 범위 막대 엄지의 폭·왼쪽 x(§7.5). 폭에 최소(`hitMin`)를 둔다 */
export function scrollThumb(v: View, L: number, barW: number, hitMin: number): { w: number; x: number } {
  const w = Math.min(barW, Math.max(hitMin, validLength(L) ? (v.span / L) * barW : barW));
  const room = L - v.span;
  return { w, x: room > 0 ? (v.start / room) * (barW - w) : 0 };
}

/** 엄지 왼쪽 x → `start`(오프셋 유지 끌기용). 0..L − span으로 자른다 */
export function startAtThumbX(x: number, v: View, L: number, barW: number, hitMin: number): number {
  const { w } = scrollThumb(v, L, barW, hitMin);
  const room = L - v.span;
  const travel = barW - w;
  if (!(room > 0) || !(travel > 0)) return 0;
  return Math.min(room, Math.max(0, (x / travel) * room));
}

/** 엄지 가장자리 끌기: 반대쪽 끝을 고정하고 span을 바꾼다(§7.5) */
export function dragViewEdge(v: View, edge: 'start' | 'end', secs: number, L: number, minSpan: number): View {
  const lo = Math.min(minSpan, L);
  if (edge === 'start') {
    const end = v.start + v.span;
    const span = Math.min(end, Math.max(lo, end - secs));
    return clampView({ start: end - span, span }, L, minSpan);
  }
  const span = Math.min(L - v.start, Math.max(lo, secs - v.start));
  return clampView({ start: v.start, span }, L, minSpan);
}
