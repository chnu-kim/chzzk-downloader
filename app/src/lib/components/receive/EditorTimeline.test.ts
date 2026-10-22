// 구간 편집 타임라인(EditorTimeline, range-editor.md RE-4, §7). 옛 RangeTimeline 시험을 새 손잡이로 옮기고
// 눈금·트랙·화면 밖 손잡이·휠·범위 막대·확대·이동·끌기 취소를 더했다. 예시 값(시각·길이)은 모두 가짜다.
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../copy/ko';
import { formatClock } from '../../format/duration';
import { MIN_VIEW_SECS, fullView, reveal, scrollThumb, visibleTicks, zoomAt, zoomFactor, type View } from '../../rangeView';
import { platform } from '../../stores/platform.svelte';
import EditorTimeline from './EditorTimeline.svelte';

// jsdom은 배치를 하지 않으므로 트랙 칸·범위 막대의 좌표를 흉내 낸다(왼쪽 0, 폭 600)
function rect(el: Element | null, width = 600) {
  el!.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: 24, width, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

type Over = Partial<{
  length: number;
  start: number;
  end: number;
  band: boolean;
  position: number | null;
  coupled: boolean;
  view: View;
  narrow: boolean;
}>;

function setup(over: Over = {}) {
  // 렌더 때 이미 폭을 잰다(눈금 간격): 모든 요소의 rect를 폭 600으로 흉내 낸다
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return { left: 0, top: 0, right: 600, bottom: 24, width: 600, height: 24, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  const length = over.length ?? 600;
  const onmove = vi.fn();
  const onseek = vi.fn();
  const onfollow = vi.fn();
  const ondrag = vi.fn();
  const oncancel = vi.fn();
  const onview = vi.fn((v: View) => {
    void utils.rerender({ view: v });
  });
  const utils = render(EditorTimeline, {
    props: {
      length,
      start: 60,
      end: 90,
      band: true,
      position: 0,
      coupled: true,
      view: fullView(length),
      describedby: 'help',
      onmove,
      onseek,
      onview,
      onfollow,
      ondrag,
      oncancel,
      ...over,
    },
  });
  const group = utils.container.querySelector('[data-timeline]') as HTMLElement;
  const track = utils.container.querySelector('.track') as HTMLElement;
  rect(track);
  return { ...utils, group, track, onmove, onseek, onview, onfollow, ondrag, oncancel };
}
const startThumb = () => screen.getByRole('slider', { name: t('range.start') });
const endThumb = () => screen.getByRole('slider', { name: t('range.end') });
const scrollbar = () => screen.queryByRole('scrollbar');
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key: k, ...init });
const wheel = (el: Element, init: WheelEventInit) => {
  const ev = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init });
  el.dispatchEvent(ev);
  return ev;
};
const ZOOMED: View = { start: 200, span: 100 };
const lastView = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0] as View;

afterEach(() => {
  platform.set('linux');
  vi.restoreAllMocks();
});

describe('구조(시험 1)', () => {
  it('눈금·영상 트랙·소리 트랙이 이 순서이고 장식은 aria-hidden이다', () => {
    const { track } = setup();
    const parts = [...track.querySelectorAll('.ruler, .lane')].map((e) => `${e.className.split(' ')[0]}:${e.getAttribute('data-lane') ?? ''}`);
    expect(parts).toEqual(['ruler:', 'lane:video', 'lane:audio']);
    for (const el of track.querySelectorAll('.ruler, .lane, .dim, .band, .position')) {
      expect(el.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(screen.getByText(t('rangeEditor.track.video.label'))).toBeInTheDocument();
    expect(screen.getByText(t('rangeEditor.track.audio.label'))).toBeInTheDocument();
  });

  it('시간 영역은 이름 있는 group이고 tabindex -1, 안내 줄을 가리키며, 확대 키를 aria-keyshortcuts로 단다', () => {
    const { group } = setup();
    expect(group).toHaveAttribute('role', 'group');
    expect(group).toHaveAttribute('aria-label', t('rangeEditor.timeline.title'));
    expect(group).toHaveAttribute('tabindex', '-1');
    expect(group).toHaveAttribute('aria-describedby', 'help');
    expect(group).toHaveAttribute('aria-keyshortcuts', 'Plus Minus 0');
  });

  it('흐림은 트랙 줄 안에만 있고 눈금 줄에는 없다(눈금 글자 대비)', () => {
    const { track } = setup();
    expect(track.querySelectorAll('.dim').length).toBeGreaterThan(0);
    expect(track.querySelector('.ruler .dim')).toBeNull();
    expect(track.querySelector('.lanes .dim')).not.toBeNull();
  });

  it('narrow면 이름 칸을 접는 클래스를 단다(좁은 레이아웃)', () => {
    const a = setup();
    expect(a.group).not.toHaveClass('narrow');
    a.unmount();
    const b = setup({ narrow: true });
    expect(b.group).toHaveClass('narrow');
  });

  it('띠가 없으면(순서가 뒤집힘) 흐림·띠 없이 손잡이 둘만 그린다', () => {
    const { track } = setup({ start: 90, end: 60, band: false });
    expect(track.querySelector('.dim')).toBeNull();
    expect(track.querySelector('.band')).toBeNull();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
  });
});

describe('눈금(시험 2)', () => {
  it('전체 보기: visibleTicks(view, 폭)과 같은 시각의 눈금이 선다(오른쪽 끝에서 글자가 넘치는 눈금은 뺀다)', () => {
    const { track } = setup();
    const want = visibleTicks(fullView(600), 600);
    const got = [...track.querySelectorAll('.tick')];
    expect(got).toHaveLength(want.length);
    expect(got.map((e) => e.textContent?.trim())).toEqual(want.map((s) => formatClock(s)));
  });

  it('확대하면 그 범위의 눈금으로 바뀐다', () => {
    const { track } = setup({ view: ZOOMED });
    const want = visibleTicks(ZOOMED, 600);
    expect([...track.querySelectorAll('.tick')].map((e) => e.textContent?.trim())).toEqual(want.map((s) => formatClock(s)));
    expect(want[0]).toBeGreaterThanOrEqual(200);
  });
});

describe('손잡이 ARIA(시험 3)', () => {
  it('두 slider가 이름과 값을 가진다', () => {
    setup();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(startThumb()).toHaveAttribute('aria-valuenow', '60');
    expect(startThumb()).toHaveAttribute('aria-valuetext', '1분');
    expect(endThumb()).toHaveAttribute('aria-valuenow', '90');
    expect(endThumb()).toHaveAttribute('aria-valuetext', '1분 30초');
    expect(startThumb()).toHaveAttribute('tabindex', '0');
  });

  it('상대 손잡이가 서로를 제한한다(시작 0…end−1, 끝 start+1…floor(L))', () => {
    setup({ length: 600.4 });
    expect(startThumb()).toHaveAttribute('aria-valuemin', '0');
    expect(startThumb()).toHaveAttribute('aria-valuemax', '89');
    expect(endThumb()).toHaveAttribute('aria-valuemin', '61');
    expect(endThumb()).toHaveAttribute('aria-valuemax', '600');
  });

  it('띠가 없으면 둘 다 전체 [0, floor(L)]이다', () => {
    setup({ start: 90, end: 60, band: false });
    for (const el of [startThumb(), endThumb()]) {
      expect(el).toHaveAttribute('aria-valuemin', '0');
      expect(el).toHaveAttribute('aria-valuemax', '600');
    }
  });

  it('부모가 범위 밖 값을 줘도 valuenow는 경계 안이다', () => {
    setup({ length: 80, start: 60, end: 90, band: true });
    expect(endThumb()).toHaveAttribute('aria-valuenow', '80');
    expect(endThumb()).toHaveAttribute('aria-valuetext', '1분 20초');
  });

  it('Tab 순서는 DOM 순서(시작 → 끝)이고 뒤집혀도 같다', () => {
    const { container } = setup({ start: 90, end: 60, band: false });
    const order = [...container.querySelectorAll('[role="slider"]')].map((e) => e.getAttribute('data-side'));
    expect(order).toEqual(['start', 'end']);
  });
});

describe('키', () => {
  it('화살표 키가 자른 값으로 commit한다', async () => {
    const { onmove } = setup();
    await key(startThumb(), 'ArrowRight');
    expect(onmove).toHaveBeenLastCalledWith('start', 61, 'commit');
    await key(startThumb(), 'ArrowLeft', { shiftKey: true });
    expect(onmove).toHaveBeenLastCalledWith('start', 50, 'commit');
    await key(endThumb(), 'End');
    expect(onmove).toHaveBeenLastCalledWith('end', 600, 'commit');
    await key(endThumb(), 'Home');
    expect(onmove).toHaveBeenLastCalledWith('end', 61, 'commit');
    await key(startThumb(), 'PageUp');
    expect(onmove).toHaveBeenLastCalledWith('start', 89, 'commit');
  });

  it('처리한 키만 preventDefault한다', () => {
    setup();
    const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true });
    startThumb().dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);
    for (const init of [{ key: 'KeyI', code: 'KeyI' }, { key: ' ', code: 'Space' }, { key: 'ArrowRight', altKey: true }, { key: '+' }]) {
      const ev = new KeyboardEvent('keydown', { ...init, cancelable: true, bubbles: true });
      startThumb().dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
  });

  it('Alt·Ctrl·Meta 화살표와 IME 키는 처리하지 않는다', async () => {
    const { onmove } = setup();
    await key(startThumb(), 'ArrowRight', { altKey: true });
    await key(startThumb(), 'ArrowRight', { ctrlKey: true });
    await key(startThumb(), 'ArrowRight', { metaKey: true });
    await key(startThumb(), 'ArrowRight', { isComposing: true });
    await fireEvent.keyDown(startThumb(), { key: 'ArrowRight', keyCode: 229 });
    expect(onmove).not.toHaveBeenCalled();
  });

  it('영상이 너무 짧으면(len < 2) 아무 일도 없다', async () => {
    const { onmove } = setup({ length: 1.9, start: 0, end: 1 });
    await key(startThumb(), 'ArrowRight');
    expect(onmove).not.toHaveBeenCalled();
  });
});

describe('끌기(시험 4·5)', () => {
  it('끌기는 drag 뒤 commit 한 번을 낸다', async () => {
    const { onmove, ondrag } = setup();
    await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
    expect(ondrag).toHaveBeenLastCalledWith(true);
    expect(onmove).not.toHaveBeenCalled();
    await fireEvent.pointerMove(startThumb(), { clientX: 300, pointerId: 1 });
    expect(onmove).toHaveBeenLastCalledWith('start', 300, 'drag');
    await fireEvent.pointerUp(startThumb(), { clientX: 300, pointerId: 1 });
    expect(onmove).toHaveBeenLastCalledWith('start', 300, 'commit');
    expect(onmove.mock.calls.filter((c) => c[2] === 'commit')).toHaveLength(1);
    expect(ondrag).toHaveBeenLastCalledWith(false);
  });

  it('누른 점과 앵커의 차이를 기억한다: +30px는 정확히 +30초', async () => {
    const { onmove } = setup();
    await fireEvent.pointerDown(startThumb(), { clientX: 40, pointerId: 1 });
    await fireEvent.pointerMove(startThumb(), { clientX: 70, pointerId: 1 });
    expect(onmove).toHaveBeenLastCalledWith('start', 90, 'drag');
  });

  it('확대해도 앵커 오프셋이 맞다(보이는 범위의 좌표 변환)', async () => {
    // 시작 250초는 {200,100}에서 x=300. 5px 안쪽을 눌러 +60px 끌면 +10초
    const { onmove } = setup({ view: ZOOMED, start: 250, end: 280 });
    await fireEvent.pointerDown(startThumb(), { clientX: 295, pointerId: 1 });
    await fireEvent.pointerMove(startThumb(), { clientX: 355, pointerId: 1 });
    expect(onmove).toHaveBeenLastCalledWith('start', 260, 'drag');
  });

  it('끌기는 보이는 범위 안으로 자른다(RE13): 오른쪽 끝 너머로 끌어도 보이는 범위 끝', async () => {
    const { onmove } = setup({ view: ZOOMED, start: 250, end: 280 });
    await fireEvent.pointerDown(endThumb(), { clientX: 480, pointerId: 1 });
    await fireEvent.pointerMove(endThumb(), { clientX: 9999, pointerId: 1 });
    expect(onmove).toHaveBeenLastCalledWith('end', 300, 'drag');
    await fireEvent.pointerMove(endThumb(), { clientX: -50, pointerId: 1 });
    expect(onmove).toHaveBeenLastCalledWith('end', 200, 'drag');
  });

  it('움직이지 않고 놓으면 commit도 없다. 끌기가 끝나면 ondrag(false)', async () => {
    const { onmove, ondrag } = setup();
    await fireEvent.pointerDown(startThumb(), { clientX: 40, pointerId: 1 });
    await fireEvent.pointerUp(startThumb(), { clientX: 40, pointerId: 1 });
    expect(onmove).not.toHaveBeenCalled();
    expect(ondrag).toHaveBeenLastCalledWith(false);
  });

  it('pointercancel은 마지막 끌기 값으로 commit한다. 움직인 적 없으면 아무것도 없다', async () => {
    const a = setup();
    await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
    await fireEvent.pointerMove(startThumb(), { clientX: 200, pointerId: 1 });
    await fireEvent.pointerCancel(startThumb(), { pointerId: 1 });
    expect(a.onmove).toHaveBeenLastCalledWith('start', 200, 'commit');
    await fireEvent.pointerMove(startThumb(), { clientX: 400, pointerId: 1 });
    expect(a.onmove.mock.calls.filter((c) => c[2] === 'commit')).toHaveLength(1);
    a.unmount();
    const b = setup();
    await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
    await fireEvent.pointerCancel(startThumb(), { pointerId: 1 });
    expect(b.onmove).not.toHaveBeenCalled();
  });

  it('누르면 포커스하고 기본 동작을 막는다. 오른쪽 단추는 끌지 않는다', async () => {
    const { onmove } = setup();
    const ev = new PointerEvent('pointerdown', { cancelable: true, bubbles: true, button: 0, pointerId: 1 });
    startThumb().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(startThumb());
    await fireEvent.pointerUp(startThumb(), { pointerId: 1 });
    await fireEvent.pointerDown(startThumb(), { clientX: 60, button: 2, pointerId: 1 });
    await fireEvent.pointerMove(startThumb(), { clientX: 200, pointerId: 1 });
    expect(onmove).not.toHaveBeenCalled();
  });

  it('끌기 중 Esc는 취소한다: oncancel, commit 없음, 전파 중단, 이후 움직임 무시', async () => {
    const { onmove, oncancel, ondrag } = setup();
    await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
    await fireEvent.pointerMove(startThumb(), { clientX: 200, pointerId: 1 });
    onmove.mockClear();
    const parent = vi.fn();
    // Svelte는 이벤트를 위임한다: 전파를 멈추면 문서까지 올라가지 않는다
    document.addEventListener('keydown', parent);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    startThumb().dispatchEvent(esc);
    document.removeEventListener('keydown', parent);
    expect(esc.defaultPrevented).toBe(true);
    expect(parent).not.toHaveBeenCalled();
    expect(oncancel).toHaveBeenCalledOnce();
    expect(ondrag).toHaveBeenLastCalledWith(false);
    await fireEvent.pointerMove(startThumb(), { clientX: 400, pointerId: 1 });
    await fireEvent.pointerUp(startThumb(), { clientX: 400, pointerId: 1 });
    expect(onmove).not.toHaveBeenCalled();
  });

  it('끌기 중이 아닌 Esc(반복 포함)는 처리하지 않고 위로 넘긴다(RE16 (0): 닫기 규칙은 뿌리 몫)', () => {
    const { oncancel } = setup();
    for (const repeat of [false, true]) {
      const esc = new KeyboardEvent('keydown', { key: 'Escape', repeat, cancelable: true, bubbles: true });
      startThumb().dispatchEvent(esc);
      expect(esc.defaultPrevented).toBe(false);
    }
    expect(oncancel).not.toHaveBeenCalled();
  });

  it('cancelDrag()는 끌기 중일 때만 true다(Esc 사다리 처리기용)', async () => {
    const { component, oncancel } = setup();
    const c = component as unknown as { cancelDrag(): boolean };
    expect(c.cancelDrag()).toBe(false);
    await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
    await fireEvent.pointerMove(startThumb(), { clientX: 200, pointerId: 1 });
    expect(c.cancelDrag()).toBe(true);
    expect(oncancel).toHaveBeenCalledOnce();
    expect(c.cancelDrag()).toBe(false);
  });
});

describe('화면 밖 손잡이(시험 6, RE12)', () => {
  it('보이는 범위 밖이어도 DOM에 slider로 남고 가장자리에 붙는다', () => {
    setup({ view: ZOOMED, start: 60, end: 90 });
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(startThumb()).toHaveAttribute('data-placement', 'before');
    expect(endThumb()).toHaveAttribute('data-placement', 'before');
    expect(startThumb()).toHaveAttribute('aria-valuenow', '60');
    expect(startThumb()).toHaveAttribute('aria-valuetext', t('rangeEditor.offscreen.label', { time: '1분' }));
  });

  it('오른쪽으로 벗어난 쪽은 after', () => {
    setup({ view: ZOOMED, start: 250, end: 400 });
    expect(startThumb()).toHaveAttribute('data-placement', 'inside');
    expect(endThumb()).toHaveAttribute('data-placement', 'after');
    expect(endThumb()).toHaveAttribute('aria-valuetext', t('rangeEditor.offscreen.label', { time: '6분 40초' }));
  });

  it('같은 쪽에 둘이 쌓이면 세로로 나눠 시작이 위다', () => {
    setup({ view: ZOOMED, start: 60, end: 90 });
    expect(startThumb()).toHaveAttribute('data-stack', 'top');
    expect(endThumb()).toHaveAttribute('data-stack', 'bottom');
  });

  it('한 쪽에 하나뿐이면 쌓지 않는다', () => {
    setup({ view: ZOOMED, start: 60, end: 250 });
    expect(startThumb()).not.toHaveAttribute('data-stack');
    expect(endThumb()).not.toHaveAttribute('data-stack');
  });

  it('누르면 값은 그대로 두고 보이는 범위만 그 손잡이로 옮긴다(끌기 시작 없음)', async () => {
    const { onmove, onview, ondrag, onfollow } = setup({ view: ZOOMED, start: 60, end: 90 });
    await fireEvent.pointerDown(startThumb(), { clientX: 5, pointerId: 1 });
    expect(onview).toHaveBeenCalledExactlyOnceWith(reveal(ZOOMED, 60, 600));
    expect(onmove).not.toHaveBeenCalled();
    expect(ondrag).not.toHaveBeenCalled();
    expect(onfollow).toHaveBeenCalledWith(false);
    await fireEvent.pointerMove(startThumb(), { clientX: 300, pointerId: 1 });
    await fireEvent.pointerUp(startThumb(), { clientX: 300, pointerId: 1 });
    expect(onmove).not.toHaveBeenCalled();
  });

  it('키로 값을 바꾸면 바뀐 값이 보이게 범위를 옮긴다', async () => {
    const { onmove, onview } = setup({ view: ZOOMED, start: 60, end: 90 });
    await key(startThumb(), 'ArrowRight');
    expect(onmove).toHaveBeenLastCalledWith('start', 61, 'commit');
    expect(onview).toHaveBeenCalledWith(reveal(ZOOMED, 61, 600));
  });

  it('포커스만으로는 범위를 옮기지 않는다', async () => {
    const { onview } = setup({ view: ZOOMED, start: 60, end: 90 });
    startThumb().focus();
    await fireEvent.focus(startThumb());
    expect(onview).not.toHaveBeenCalled();
  });

  it('안에 있는 손잡이를 키로 가장자리 margin 안까지 옮기면 범위가 따라간다', async () => {
    const { onview } = setup({ view: ZOOMED, start: 205, end: 280 });
    await key(startThumb(), 'ArrowLeft');
    expect(onview).toHaveBeenCalledWith(reveal(ZOOMED, 204, 600));
  });
});

describe('휠(시험 7)', () => {
  it('wheel 리스너는 { passive: false }로 시간 영역에 단다', () => {
    const spy = vi.spyOn(Element.prototype, 'addEventListener');
    const { group } = setup();
    const idx = spy.mock.calls.findIndex((c) => c[0] === 'wheel');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(spy.mock.calls[idx][2]).toEqual({ passive: false });
    expect(spy.mock.contexts[idx]).toBe(group);
    spy.mockRestore();
  });

  it('Ctrl+휠은 커서를 중심으로 확대하고 preventDefault한다. 따라가기를 끈다', () => {
    const { group, onview, onfollow } = setup();
    const ev = wheel(group, { deltaY: -100, ctrlKey: true, clientX: 300 });
    expect(ev.defaultPrevented).toBe(true);
    expect(onview).toHaveBeenCalledExactlyOnceWith(zoomAt(fullView(600), zoomFactor(-100), 300, 600, MIN_VIEW_SECS));
    expect(onfollow).toHaveBeenCalledWith(false);
  });

  it('커서 위치가 중심이다: 오른쪽 끝에서 확대하면 오른쪽 끝이 남는다', () => {
    const { group, onview } = setup();
    wheel(group, { deltaY: -100, ctrlKey: true, clientX: 600 });
    const v = lastView(onview);
    expect(v.start + v.span).toBeCloseTo(600, 6);
  });

  it('macOS에서는 ⌘+휠도 확대다. 그 밖에서는 이동으로 읽혀 전체 보기라 무시된다', () => {
    platform.set('macos');
    const a = setup();
    const ev = wheel(a.group, { deltaY: -100, metaKey: true, clientX: 300 });
    expect(ev.defaultPrevented).toBe(true);
    expect(a.onview).toHaveBeenCalledTimes(1);
    a.unmount();
    platform.set('windows');
    const b = setup();
    const ev2 = wheel(b.group, { deltaY: -100, metaKey: true, clientX: 300 });
    expect(ev2.defaultPrevented).toBe(false);
    expect(b.onview).not.toHaveBeenCalled();
  });

  it('이동은 확대돼 있고 움직일 수 있을 때만 처리한다', () => {
    const { group, onview, onfollow } = setup({ view: ZOOMED });
    const ev = wheel(group, { deltaY: 60 });
    expect(ev.defaultPrevented).toBe(true);
    // 60px / 600px × 100초 = 10초
    expect(lastView(onview).start).toBeCloseTo(210, 6);
    expect(onfollow).toHaveBeenCalledWith(false);
  });

  it('전체 보기에서는 이동하지 않고 preventDefault도 하지 않는다(바깥 스크롤로 넘어간다)', () => {
    const { group, onview } = setup();
    const ev = wheel(group, { deltaY: 120 });
    expect(ev.defaultPrevented).toBe(false);
    expect(onview).not.toHaveBeenCalled();
  });

  it('끝에 닿으면 처리하지 않는다. 반대 방향은 처리한다', () => {
    const { group, onview } = setup({ view: { start: 500, span: 100 } });
    const ev = wheel(group, { deltaY: 120 });
    expect(ev.defaultPrevented).toBe(false);
    expect(onview).not.toHaveBeenCalled();
    const back = wheel(group, { deltaY: -120 });
    expect(back.defaultPrevented).toBe(true);
  });

  it('대각선은 합산하지 않고 큰 축 하나만 쓴다', () => {
    const { group, onview } = setup({ view: ZOOMED });
    wheel(group, { deltaX: 30, deltaY: 60 });
    expect(lastView(onview).start).toBeCloseTo(210, 6);
    wheel(group, { deltaX: 60, deltaY: 30 });
    // 첫 이동으로 보기가 210에서 시작한다: 60px = 10초 더
    expect(lastView(onview).start).toBeCloseTo(220, 6);
  });

  it('deltaMode 줄은 ×16px, 쪽은 ×트랙 폭으로 정규화한다', () => {
    const a = setup({ view: ZOOMED });
    wheel(a.group, { deltaY: 3, deltaMode: 1 });
    expect(lastView(a.onview).start).toBeCloseTo(200 + ((3 * 16) / 600) * 100, 6);
    a.unmount();
    const b = setup({ view: ZOOMED });
    wheel(b.group, { deltaY: 1, deltaMode: 2 });
    expect(lastView(b.onview).start).toBeCloseTo(300, 6);
  });

  it('끌기 중에는 preventDefault만 하고 보이는 범위를 바꾸지 않는다(RE13)', async () => {
    const { group, onview } = setup({ view: ZOOMED, start: 250, end: 280 });
    await fireEvent.pointerDown(startThumb(), { clientX: 300, pointerId: 1 });
    const z = wheel(group, { deltaY: -100, ctrlKey: true, clientX: 300 });
    const p = wheel(group, { deltaY: 60 });
    expect(z.defaultPrevented).toBe(true);
    expect(p.defaultPrevented).toBe(true);
    expect(onview).not.toHaveBeenCalled();
  });

  it('길이가 20초 미만이면 확대하지 않고 preventDefault도 하지 않는다', () => {
    const { group, onview } = setup({ length: 15, start: 2, end: 9 });
    const ev = wheel(group, { deltaY: -100, ctrlKey: true, clientX: 300 });
    expect(ev.defaultPrevented).toBe(false);
    expect(onview).not.toHaveBeenCalled();
  });

  it('확대 상한에 닿아 더 안 바뀌어도 preventDefault한다(바깥 확대로 새지 않게)', () => {
    const { group } = setup({ view: { start: 100, span: MIN_VIEW_SECS } });
    const ev = wheel(group, { deltaY: -100, ctrlKey: true, clientX: 300 });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('시간 영역 밖 요소의 휠은 처리하지 않는다', () => {
    const { container } = setup({ view: ZOOMED });
    const outside = document.createElement('div');
    container.appendChild(outside);
    const ev = wheel(outside, { deltaY: 60 });
    expect(ev.defaultPrevented).toBe(false);
  });

  it('x는 트랙 칸 rect 기준이다: 칸이 왼쪽 64px에서 시작하면 그만큼 뺀다', () => {
    const { group, onview, track } = setup();
    track.getBoundingClientRect = () => ({ left: 64, top: 0, right: 664, bottom: 24, width: 600, height: 24, x: 64, y: 0, toJSON: () => ({}) }) as DOMRect;
    wheel(group, { deltaY: -100, ctrlKey: true, clientX: 364 });
    expect(lastView(onview)).toEqual(zoomAt(fullView(600), zoomFactor(-100), 300, 600, MIN_VIEW_SECS));
  });
});

describe('범위 막대(시험 9)', () => {
  it('확대했을 때만 있고, 전체 보기에는 없다', () => {
    const a = setup();
    expect(scrollbar()).toBeNull();
    a.unmount();
    setup({ view: ZOOMED });
    expect(scrollbar()).not.toBeNull();
  });

  it('이름·방향·값: aria-controls는 시간 영역 group을 가리킨다(눈금 줄만이 아니다)', () => {
    const { group } = setup({ view: ZOOMED });
    const sb = scrollbar()!;
    expect(sb).toHaveAccessibleName(t('rangeEditor.viewport.label'));
    expect(sb).toHaveAttribute('aria-orientation', 'horizontal');
    expect(group.id).not.toBe('');
    expect(sb).toHaveAttribute('aria-controls', group.id);
    expect(sb).toHaveAttribute('aria-valuemin', '0');
    expect(sb).toHaveAttribute('aria-valuemax', '100');
    // 200 / (600 − 100) = 40%
    expect(sb).toHaveAttribute('aria-valuenow', '40');
    expect(sb).toHaveAttribute('aria-valuetext', t('rangeEditor.viewport.value.label', { from: '3분 20초', to: '5분' }));
    expect(sb).toHaveAttribute('tabindex', '0');
  });

  it('키: ←/→ ∓10% span, Shift+←/→·PageUp/Down ∓1 span, Home/End 맨 앞·맨 뒤. preventDefault와 따라가기 끔', async () => {
    const { onview, onfollow } = setup({ view: ZOOMED });
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true });
    scrollbar()!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(lastView(onview).start).toBeCloseTo(210, 6);
    expect(onfollow).toHaveBeenCalledWith(false);
    await key(scrollbar()!, 'ArrowLeft');
    expect(lastView(onview).start).toBeCloseTo(200, 6);
    await key(scrollbar()!, 'ArrowRight', { shiftKey: true });
    expect(lastView(onview).start).toBeCloseTo(300, 6);
    await key(scrollbar()!, 'PageUp');
    expect(lastView(onview).start).toBeCloseTo(200, 6);
    await key(scrollbar()!, 'PageDown');
    expect(lastView(onview).start).toBeCloseTo(300, 6);
    await key(scrollbar()!, 'Home');
    expect(lastView(onview).start).toBe(0);
    await key(scrollbar()!, 'End');
    expect(lastView(onview).start).toBe(500);
  });

  it('수식 키 조합과 다른 키는 처리하지 않는다', async () => {
    const { onview } = setup({ view: ZOOMED });
    const ev = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, cancelable: true, bubbles: true });
    scrollbar()!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    await key(scrollbar()!, 'a');
    expect(onview).not.toHaveBeenCalled();
  });

  it('엄지 몸통을 끌면 오프셋을 유지하며 start가 바뀐다', async () => {
    const { container, onview, onfollow } = setup({ view: ZOOMED });
    rect(container.querySelector('.sb'));
    const thumb = container.querySelector('.sb-thumb') as HTMLElement;
    // span 100/600 × 600 = 100px 엄지, 왼쪽 x = 200/500 × (600 − 100) = 200
    await fireEvent.pointerDown(thumb, { clientX: 250, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 300, pointerId: 1 });
    // +50px → 엄지 x 250 → start = 250/500 × 500 = 250
    expect(lastView(onview).start).toBeCloseTo(250, 6);
    expect(onfollow).toHaveBeenCalledWith(false);
  });

  it('엄지 최소 폭 --hit-min(24): 43200초에서도 24px로 잡고 끌기 식이 그 폭을 쓴다', async () => {
    const view = { start: 0, span: 20 };
    const { container, onview } = setup({ length: 43200, start: 100, end: 200, view });
    rect(container.querySelector('.sb'));
    const thumb = container.querySelector('.sb-thumb') as HTMLElement;
    expect(scrollThumb(view, 43200, 600, 24).w).toBe(24);
    await fireEvent.pointerDown(thumb, { clientX: 10, pointerId: 1 });
    // 엄지 이동 가능 폭 = 600 − 24 = 576px. 288px 끌면 절반: start = 0.5 × (43200 − 20)
    await fireEvent.pointerMove(thumb, { clientX: 298, pointerId: 1 });
    expect(lastView(onview).start).toBeCloseTo(0.5 * (43200 - 20), 3);
  });

  it('엄지 밖 막대를 누르면 그쪽으로 1 span 옮긴다', async () => {
    const { container, onview } = setup({ view: ZOOMED });
    const sb = container.querySelector('.sb') as HTMLElement;
    rect(sb);
    // 엄지는 x 200~300. 왼쪽(50)을 누르면 한 쪽 앞, 오른쪽(500)을 누르면 한 쪽 뒤
    await fireEvent.pointerDown(sb, { clientX: 50, pointerId: 1 });
    expect(lastView(onview).start).toBeCloseTo(100, 6);
    await fireEvent.pointerDown(sb, { clientX: 500, pointerId: 1 });
    expect(lastView(onview).start).toBeCloseTo(200, 6);
  });

  it('엄지 가장자리를 끌면 반대쪽 끝을 고정하고 span을 바꾼다', async () => {
    const { container, onview } = setup({ view: ZOOMED });
    rect(container.querySelector('.sb'));
    const right = container.querySelector('.sb-edge[data-edge="end"]') as HTMLElement;
    // 엄지 오른쪽 끝 x = 300. +60px → 끝 시각 360
    await fireEvent.pointerDown(right, { clientX: 300, pointerId: 1 });
    await fireEvent.pointerMove(right, { clientX: 360, pointerId: 1 });
    const v = lastView(onview);
    expect(v.start).toBeCloseTo(200, 6);
    expect(v.start + v.span).toBeCloseTo(360, 6);
  });

  it('왼쪽 가장자리도 반대(오른쪽) 끝을 고정한다', async () => {
    const { container, onview } = setup({ view: ZOOMED });
    rect(container.querySelector('.sb'));
    const left = container.querySelector('.sb-edge[data-edge="start"]') as HTMLElement;
    await fireEvent.pointerDown(left, { clientX: 200, pointerId: 2 });
    await fireEvent.pointerMove(left, { clientX: 250, pointerId: 2 });
    const w = lastView(onview);
    expect(w.start).toBeCloseTo(250, 6);
    expect(w.start + w.span).toBeCloseTo(300, 6);
  });

  it('거의 전체로 축소하면(SNAP_SECS) 범위 막대가 사라진다', async () => {
    const { container } = setup({ view: { start: 0, span: 599 } });
    rect(container.querySelector('.sb'));
    const right = container.querySelector('.sb-edge[data-edge="end"]') as HTMLElement;
    await fireEvent.pointerDown(right, { clientX: 599, pointerId: 2 });
    await fireEvent.pointerMove(right, { clientX: 599.9, pointerId: 2 });
    expect(scrollbar()).toBeNull();
  });
});

describe('눈금 두 번 누르기(시험 8)', () => {
  it('눈금 줄 dblclick은 그 자리를 중심으로 ×2 확대한다', async () => {
    const { container, onview, onfollow } = setup();
    await fireEvent.dblClick(container.querySelector('.ruler') as HTMLElement, { clientX: 300 });
    expect(onview).toHaveBeenCalledExactlyOnceWith(zoomAt(fullView(600), 2, 300, 600, MIN_VIEW_SECS));
    expect(onfollow).toHaveBeenCalledWith(false);
  });

  it('결합 전에도 확대된다. 20초 미만이면 아무 일도 없다', async () => {
    const a = setup({ coupled: false });
    await fireEvent.dblClick(a.container.querySelector('.ruler') as HTMLElement, { clientX: 300 });
    expect(a.onview).toHaveBeenCalledTimes(1);
    a.unmount();
    const b = setup({ length: 15, start: 2, end: 9 });
    await fireEvent.dblClick(b.container.querySelector('.ruler') as HTMLElement, { clientX: 300 });
    expect(b.onview).not.toHaveBeenCalled();
  });

  it('트랙 줄 dblclick은 확대하지 않는다', async () => {
    const { container, onview } = setup();
    await fireEvent.dblClick(container.querySelector('.lane') as HTMLElement, { clientX: 300 });
    expect(onview).not.toHaveBeenCalled();
  });
});

describe('트랙 누름·지금 위치선(시험 10)', () => {
  it('결합 중이면 눌린 시각으로 한 번 탐색한다(내리지 않은 값)', async () => {
    const { track, onseek, onmove } = setup({ length: 599.9 });
    await fireEvent.pointerDown(track, { clientX: 300, pointerId: 1 });
    expect(onseek).toHaveBeenCalledExactlyOnceWith(299.95);
    expect(onmove).not.toHaveBeenCalled();
  });

  it('확대 중에는 보이는 범위의 시각이다', async () => {
    const { track, onseek } = setup({ view: ZOOMED });
    await fireEvent.pointerDown(track, { clientX: 300, pointerId: 1 });
    expect(onseek).toHaveBeenCalledExactlyOnceWith(250);
  });

  it('결합 전에는 아무것도 하지 않는다', async () => {
    const { track, onseek } = setup({ coupled: false });
    await fireEvent.pointerDown(track, { clientX: 300, pointerId: 1 });
    expect(onseek).not.toHaveBeenCalled();
  });

  it('손잡이·범위 막대를 누르면 탐색하지 않는다. 오른쪽 단추도 아니다', async () => {
    const { track, onseek, container } = setup({ view: ZOOMED });
    await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
    await fireEvent.pointerDown(container.querySelector('.sb') as HTMLElement, { clientX: 50, pointerId: 1 });
    await fireEvent.pointerDown(track, { clientX: 300, button: 2, pointerId: 1 });
    expect(onseek).not.toHaveBeenCalled();
  });

  it('트랙을 눌러도 포커스를 코드로 옮기지 않는다', async () => {
    const { track } = setup();
    const before = document.activeElement;
    await fireEvent.pointerDown(track, { clientX: 300, pointerId: 1 });
    expect(document.activeElement).toBe(before);
  });

  it('지금 위치선은 결합 중(position 있음)이고 보이는 범위 안일 때만 있다', () => {
    const a = setup({ position: 150 });
    expect((a.container.querySelector('.position') as HTMLElement).style.getPropertyValue('--p')).toBe('0.25');
    a.unmount();
    expect(setup({ position: null }).container.querySelector('.position')).toBeNull();
  });

  it('쌓임 순서: 위치선은 흐림·띠 뒤(위)이고 손잡이 앞(아래)이다(DOM 순서)', () => {
    const { container } = setup({ position: 150 });
    const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const shade = container.querySelector('.shade')!;
    const position = container.querySelector('.position')!;
    expect(after(shade, position)).toBe(true);
    expect(after(position, startThumb())).toBe(true);
    expect(after(position, endThumb())).toBe(true);
  });

  it('확대하면 위치선도 보이는 범위 기준이고, 범위 밖이면 그리지 않는다', () => {
    const a = setup({ view: ZOOMED, position: 250 });
    expect((a.container.querySelector('.position') as HTMLElement).style.getPropertyValue('--p')).toBe('0.5');
    a.unmount();
    expect(setup({ view: ZOOMED, position: 50 }).container.querySelector('.position')).toBeNull();
  });
});
