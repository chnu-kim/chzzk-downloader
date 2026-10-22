import { describe, expect, it } from 'vitest';
import {
  MIN_VIEW_SECS,
  SNAP_SECS,
  clampView,
  dragViewEdge,
  follow,
  fullView,
  monitorSize,
  panBy,
  placement,
  reveal,
  scrollThumb,
  secsAtX,
  startAtThumbX,
  ticks,
  wheelIntent,
  wheelPanSecs,
  xOfSecs,
  zoomAt,
  zoomFactor,
  zoomed,
  type View,
  type WheelEventLike,
} from './rangeView';

const L = 5400;
const v = (start: number, span: number): View => ({ start, span });

describe('fullView / clampView (§7.1)', () => {
  it('유한하지 않거나 0 이하의 L은 {0, 0}', () => {
    for (const bad of [0, -5, Infinity, NaN]) {
      expect(fullView(bad)).toEqual({ start: 0, span: 0 });
      expect(clampView(v(10, 100), bad, MIN_VIEW_SECS)).toEqual({ start: 0, span: 0 });
    }
    expect(fullView(L)).toEqual({ start: 0, span: L });
  });
  it('start를 [0, L - span]로 자른다', () => {
    expect(clampView(v(-10, 100), L, 20)).toEqual({ start: 0, span: 100 });
    expect(clampView(v(5390, 100), L, 20)).toEqual({ start: 5300, span: 100 });
  });
  it('span을 [minSpan, L]로 자른다', () => {
    expect(clampView(v(0, 5), L, 20).span).toBe(20);
    expect(clampView(v(0, 9999), L, 20)).toEqual({ start: 0, span: L });
  });
  it('L < minSpan이면 span 하한은 min(minSpan, L)', () => {
    expect(clampView(v(0, 3), 10, 20)).toEqual({ start: 0, span: 10 });
  });
  it('NaN은 전체 보기', () => {
    expect(clampView(v(NaN, 100), L, 20)).toEqual(fullView(L));
    expect(clampView(v(0, NaN), L, 20)).toEqual(fullView(L));
  });
  it('span이 L - SNAP_SECS 이상이면 전체로 맞춘다', () => {
    expect(clampView(v(0.2, L - 0.3), L, 20)).toEqual({ start: 0, span: L });
    expect(clampView(v(0.2, L - SNAP_SECS - 1), L, 20).span).toBe(L - SNAP_SECS - 1);
  });
  it('zoomed: span < L', () => {
    expect(zoomed(v(0, 100), L)).toBe(true);
    expect(zoomed(fullView(L), L)).toBe(false);
  });
});

describe('secsAtX / xOfSecs / placement', () => {
  it('secsAtX: 양 끝·가운데, 범위 밖은 자른다, w=0이면 start', () => {
    const full = fullView(L);
    expect(secsAtX(0, 800, full)).toBe(0);
    expect(secsAtX(800, 800, full)).toBe(L);
    expect(secsAtX(400, 800, full)).toBe(2700);
    expect(secsAtX(-50, 800, full)).toBe(0);
    expect(secsAtX(900, 800, full)).toBe(L);
    expect(secsAtX(5, 0, v(600, 60))).toBe(600);
    expect(secsAtX(400, 800, v(600, 60))).toBe(630);
  });
  it('secsAtX는 내리지 않는다', () => {
    expect(secsAtX(1, 3, v(0, 10))).toBeCloseTo(3.3333, 3);
  });
  it('xOfSecs: 밖은 음수·폭 초과 그대로, span=0이면 0', () => {
    const view = v(600, 60);
    expect(xOfSecs(570, 600, view)).toBe(-300);
    expect(xOfSecs(690, 600, view)).toBe(900);
    expect(xOfSecs(5, 800, v(0, 0))).toBe(0);
  });
  it('왕복: secsAtX(xOfSecs(s)) = s (범위 안)', () => {
    const view = v(600, 60);
    for (const s of [600, 610.5, 630, 660]) expect(secsAtX(xOfSecs(s, 616, view), 616, view)).toBeCloseTo(s, 9);
  });
  it('placement: 양 끝은 안', () => {
    const view = v(600, 60);
    expect(placement(599.9, view)).toBe('before');
    expect(placement(600, view)).toBe('inside');
    expect(placement(660, view)).toBe('inside');
    expect(placement(660.1, view)).toBe('after');
  });
});

describe('zoomAt / panBy (§7.2)', () => {
  it('앵커의 화면 위치가 바뀌지 않는다', () => {
    const view = v(1000, 2000);
    const next = zoomAt(view, 2, 1500, L, 20);
    expect(next.span).toBe(1000);
    expect(xOfSecs(1500, 800, next)).toBeCloseTo(xOfSecs(1500, 800, view), 9);
  });
  it('상한(전체)과 하한(20초)', () => {
    expect(zoomAt(v(100, 3000), 0.1, 500, L, 20)).toEqual(fullView(L));
    expect(zoomAt(v(100, 40), 100, 120, L, 20).span).toBe(20);
  });
  it('0·L 근처 앵커는 자른다', () => {
    const a = zoomAt(v(0, 2000), 4, 0, L, 20);
    expect(a.start).toBe(0);
    const b = zoomAt(v(3400, 2000), 4, L, L, 20);
    expect(b.start + b.span).toBeLessThanOrEqual(L);
    expect(b.start).toBeGreaterThanOrEqual(0);
  });
  it('factor 1은 그대로', () => {
    const view = v(600, 1200);
    const next = zoomAt(view, 1, 900, L, 20);
    expect(next.span).toBe(1200);
    expect(next.start).toBeCloseTo(600, 9);
  });
  it('factor가 이상하면 그대로', () => {
    const view = v(600, 1200);
    for (const f of [0, -1, NaN]) expect(zoomAt(view, f, 900, L, 20)).toEqual(view);
  });
  it('휠 배율 ×k 뒤 ×1/k는 정확히 전체로 돌아온다', () => {
    const k = Math.exp(0.002 * 100);
    let view = fullView(L);
    for (let i = 0; i < 7; i++) view = zoomAt(view, k, 1234, L, 20);
    expect(zoomed(view, L)).toBe(true);
    for (let i = 0; i < 7; i++) view = zoomAt(view, 1 / k, 1234, L, 20);
    expect(zoomed(view, L)).toBe(false);
    expect(view).toEqual(fullView(L));
  });
  it('panBy: moved 참/거짓', () => {
    expect(panBy(v(100, 600), 50, L)).toEqual({ view: v(150, 600), moved: true });
    expect(panBy(v(100, 600), -500, L)).toEqual({ view: v(0, 600), moved: true });
    expect(panBy(v(4800, 600), 50, L)).toEqual({ view: v(4800, 600), moved: false });
    expect(panBy(v(0, 600), -5, L).moved).toBe(false);
    expect(panBy(fullView(L), 100, L).moved).toBe(false);
  });
  it('wheelPanSecs = px / trackW × span', () => {
    expect(wheelPanSecs(100, 616, 600)).toBeCloseTo(97.4, 1);
    expect(wheelPanSecs(100, 0, 600)).toBe(0);
  });
});

describe('reveal / follow', () => {
  const view = v(1000, 1000);
  it('reveal: 안은 그대로', () => {
    expect(reveal(view, 1500, L)).toEqual(view);
    expect(reveal(view, 1100, L)).toEqual(view);
    expect(reveal(view, 1900, L)).toEqual(view);
  });
  it('reveal: 밖은 margin 자리로 옮긴다', () => {
    expect(reveal(view, 500, L).start).toBeCloseTo(400, 9);
    expect(reveal(view, 2500, L).start).toBeCloseTo(1600, 9);
  });
  it('reveal: margin 경계 바로 밖', () => {
    expect(reveal(view, 1099, L).start).toBeCloseTo(999, 9);
    expect(reveal(view, 1901, L).start).toBeCloseTo(1001, 9);
  });
  it('follow: 안은 그대로, 끝을 넘으면 pos - 0.1 span', () => {
    expect(follow(view, 1500, L)).toEqual(view);
    expect(follow(view, 2000, L).start).toBeCloseTo(1900, 9);
    expect(follow(view, 2500, L).start).toBeCloseTo(2400, 9);
  });
  it('follow: 앞(반복 restart)도 같은 규칙', () => {
    expect(follow(view, 200, L).start).toBeCloseTo(100, 9);
  });
  it('follow: 전체 보기는 그대로', () => {
    expect(follow(fullView(L), 3000, L)).toEqual(fullView(L));
  });
  it('follow: 끝 근처는 자른다', () => {
    const next = follow(v(4000, 1000), 5390, L);
    expect(next.start + next.span).toBeLessThanOrEqual(L);
    expect(next.span).toBe(1000);
  });
});

describe('ticks (§7.6)', () => {
  it('5400초·전체·860px: 80px 이상인 가장 작은 간격(10분), 첫 눈금 0', () => {
    const t = ticks(fullView(5400), 860);
    expect(t[0]).toBe(0);
    expect(t[1]).toBe(600);
    expect(t.at(-1)).toBe(5400);
  });
  it('20초 창은 5초 이하 간격', () => {
    const t = ticks(v(600, 20), 856);
    expect(t[1]! - t[0]!).toBeLessThanOrEqual(5);
  });
  it('좁은 폭이면 간격이 넓어진다', () => {
    const wide = ticks(fullView(5400), 860);
    const narrow = ticks(fullView(5400), 320);
    expect(narrow[1]! - narrow[0]!).toBeGreaterThan(wide[1]! - wide[0]!);
    expect(narrow[1]! - narrow[0]!).toBe(1800);
  });
  it('첫 눈금은 ceil', () => {
    const t = ticks(v(601, 100), 800);
    expect(t[0]).toBe(610);
  });
  it('43200초·300px은 4시간 간격', () => {
    expect(ticks(fullView(43200), 300)).toEqual([0, 14400, 28800, 43200]);
  });
  it('3시간(10800초) 눈금', () => {
    const t = ticks(fullView(10800), 860);
    expect(t[0]).toBe(0);
    expect(t[1]).toBe(1800);
  });
  it('span 0·w 0이면 눈금 없음', () => {
    expect(ticks(v(0, 0), 800)).toEqual([]);
    expect(ticks(fullView(L), 0)).toEqual([]);
  });
});

describe('wheelIntent / zoomFactor (§7.3)', () => {
  const ev = (o: Partial<WheelEventLike>): WheelEventLike => ({
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...o,
  });
  const ctx = { mac: false, trackW: 600 };
  it('deltaMode 0·1·2 정규화', () => {
    expect(wheelIntent(ev({ deltaY: 10 }), ctx)).toEqual({ kind: 'pan', px: 10 });
    expect(wheelIntent(ev({ deltaY: 3, deltaMode: 1 }), ctx)).toEqual({ kind: 'pan', px: 48 });
    expect(wheelIntent(ev({ deltaY: 1, deltaMode: 2 }), ctx)).toEqual({ kind: 'pan', px: 600 });
  });
  it('ctrlKey는 zoom, mac metaKey는 zoom, 비mac metaKey는 pan', () => {
    expect(wheelIntent(ev({ deltaY: -100, ctrlKey: true }), ctx)).toEqual({ kind: 'zoom', dyPx: -100 });
    expect(wheelIntent(ev({ deltaY: -100, metaKey: true }), { ...ctx, mac: true })).toEqual({ kind: 'zoom', dyPx: -100 });
    expect(wheelIntent(ev({ deltaY: 100, metaKey: true }), ctx)).toEqual({ kind: 'pan', px: 100 });
  });
  it('|dx| >= |dy|면 dx, 아니면 dy (대각선은 합치지 않는다)', () => {
    expect(wheelIntent(ev({ deltaX: 30, deltaY: 40 }), ctx)).toEqual({ kind: 'pan', px: 40 });
    expect(wheelIntent(ev({ deltaX: 40, deltaY: 40 }), ctx)).toEqual({ kind: 'pan', px: 40 });
    expect(wheelIntent(ev({ deltaX: -50, deltaY: 40 }), ctx)).toEqual({ kind: 'pan', px: -50 });
  });
  it('Shift+deltaY는 pan', () => {
    expect(wheelIntent(ev({ deltaY: 80, shiftKey: true }), ctx)).toEqual({ kind: 'pan', px: 80 });
  });
  it('{0, 0}은 null', () => {
    expect(wheelIntent(ev({}), ctx)).toBeNull();
    expect(wheelIntent(ev({ ctrlKey: true }), ctx)).toBeNull();
  });
  it('zoomFactor: 0 → 1, [0.5, 2]로 자름, 부호', () => {
    expect(zoomFactor(0)).toBe(1);
    expect(zoomFactor(-100)).toBeCloseTo(Math.exp(0.2), 9);
    expect(zoomFactor(100)).toBeLessThan(1);
    expect(zoomFactor(-1e6)).toBe(2);
    expect(zoomFactor(1e6)).toBe(0.5);
  });
});

describe('monitorSize (§6.2)', () => {
  const base = { videoMinH: 90, controlsMinW: 380, padTop: 16, narrow: false };
  it('960×700 전체 보기 → 702×395', () => {
    const r = monitorSize({ ...base, stageW: 960, stageH: 455, controlsH: 44 });
    expect(r).toMatchObject({ videoW: 702, videoH: 395, rowW: 702 });
  });
  it('960×700 확대 → 660×371', () => {
    const r = monitorSize({ ...base, stageW: 960, stageH: 431, controlsH: 44 });
    expect(r).toMatchObject({ videoW: 660, videoH: 371 });
  });
  it('720×520 전체 보기 → 382×215, 조작 줄 382', () => {
    const r = monitorSize({ ...base, stageW: 720, stageH: 275, controlsH: 44 });
    expect(r).toMatchObject({ videoW: 382, videoH: 215, rowW: 382 });
  });
  it('720×520 확대: 조작 줄이 영상보다 넓다(380)', () => {
    const r = monitorSize({ ...base, stageW: 720, stageH: 251, controlsH: 44 });
    expect(r).toMatchObject({ videoW: 340, videoH: 191, rowW: 380 });
  });
  it('coarse: controlsMinW 464', () => {
    const r = monitorSize({ ...base, controlsMinW: 464, stageW: 720, stageH: 251, controlsH: 56 });
    expect(r).toMatchObject({ videoW: 318, videoH: 179, rowW: 464 });
  });
  it('좁은 레이아웃: 폭에서만 정한다(stageH가 달라도 같다)', () => {
    const a = monitorSize({ ...base, narrow: true, stageW: 320, stageH: 100, controlsH: 44 });
    const b = monitorSize({ ...base, narrow: true, stageW: 320, stageH: 900, controlsH: 44 });
    expect(a).toEqual(b);
    expect(a).toMatchObject({ videoW: 320, videoH: 180, rowW: 320 });
  });
  it('좁은 레이아웃에서 영상이 VIDEO_MIN_H보다 낮아지지 않는다', () => {
    const r = monitorSize({ ...base, narrow: true, stageW: 100, stageH: 0, controlsH: 44 });
    expect(r.videoH).toBeGreaterThanOrEqual(56);
    expect(r.videoW).toBe(100);
  });
  it('stageH가 작으면 VIDEO_MIN_H', () => {
    const r = monitorSize({ ...base, stageW: 960, stageH: 100, controlsH: 44 });
    expect(r.videoH).toBe(90);
    expect(r.videoW).toBe(160);
  });
});

describe('scrollThumb (§7.5)', () => {
  it('엄지 폭 = max(hitMin, span/L × barW): 20초/10800초/800px → 24', () => {
    expect(scrollThumb(v(0, 20), 10800, 800, 24).w).toBe(24);
    expect(scrollThumb(v(0, 5400), 10800, 800, 24).w).toBe(400);
  });
  it('엄지 x ↔ start 왕복은 (barW - thumbW) 기준', () => {
    const view = v(3000, 600);
    const { w, x } = scrollThumb(view, 10800, 800, 24);
    expect(x).toBeCloseTo((3000 / (10800 - 600)) * (800 - w), 9);
    expect(startAtThumbX(x, view, 10800, 800, 24)).toBeCloseTo(3000, 6);
    expect(startAtThumbX(-30, view, 10800, 800, 24)).toBe(0);
    expect(startAtThumbX(9999, view, 10800, 800, 24)).toBe(10800 - 600);
  });
  it('L - span = 0이면 x는 0', () => {
    expect(scrollThumb(fullView(L), L, 800, 24).x).toBe(0);
  });
  it('가장자리 끌기: 반대 끝 고정, span 상하한', () => {
    const view = v(1000, 600);
    const a = dragViewEdge(view, 'start', 1200, L, 20);
    expect(a.start + a.span).toBeCloseTo(1600, 9);
    expect(a.start).toBe(1200);
    const b = dragViewEdge(view, 'end', 2000, L, 20);
    expect(b).toEqual({ start: 1000, span: 1000 });
    expect(dragViewEdge(view, 'start', 1599, L, 20).span).toBe(20);
    expect(dragViewEdge(view, 'end', 1001, L, 20).span).toBe(20);
    expect(dragViewEdge(view, 'end', 99999, L, 20)).toEqual({ start: 1000, span: 4400 });
  });
});
