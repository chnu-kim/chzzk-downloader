import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../copy/ko';
import RangeTimeline from './RangeTimeline.svelte';

// jsdom은 배치를 하지 않으므로 막대의 좌표를 흉내 낸다(왼쪽 0, 폭 600)
function rect(el: Element, width = 600) {
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: 24, width, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

type Over = Partial<{
  length: number;
  start: number;
  end: number;
  band: boolean;
  position: number;
  disabled: boolean;
}>;

function setup(over: Over = {}) {
  const onmove = vi.fn();
  const onseek = vi.fn();
  const utils = render(RangeTimeline, {
    props: { length: 600, start: 60, end: 90, band: true, position: 0, onmove, onseek, ...over },
  });
  const track = utils.container.querySelector('.track') as HTMLElement;
  rect(track);
  return { ...utils, track, onmove, onseek };
}
const startThumb = () => screen.getByRole('slider', { name: t('range.start') });
const endThumb = () => screen.getByRole('slider', { name: t('range.end') });
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key: k, ...init });

describe('RangeTimeline (PVU-2)', () => {
  it('renders two sliders with names and values', () => {
    setup();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(startThumb()).toHaveAttribute('aria-valuenow', '60');
    expect(startThumb()).toHaveAttribute('aria-valuetext', '1분');
    expect(endThumb()).toHaveAttribute('aria-valuenow', '90');
    expect(endThumb()).toHaveAttribute('aria-valuetext', '1분 30초');
    expect(startThumb()).toHaveAttribute('tabindex', '0');
  });

  it('slider bounds constrain each other', () => {
    setup({ length: 600.4 });
    expect(startThumb()).toHaveAttribute('aria-valuemin', '0');
    expect(startThumb()).toHaveAttribute('aria-valuemax', '89');
    expect(endThumb()).toHaveAttribute('aria-valuemin', '61');
    expect(endThumb()).toHaveAttribute('aria-valuemax', '600');
  });

  it('valuenow is clamped into the bounds even if the parent hands an out-of-range value', () => {
    setup({ length: 80, start: 60, end: 90, band: true });
    expect(endThumb()).toHaveAttribute('aria-valuenow', '80');
    expect(endThumb()).toHaveAttribute('aria-valuetext', '1분 20초');
  });

  describe('keys', () => {
    it('arrow keys call onmove commit with clamped value', async () => {
      const { onmove } = setup();
      await key(startThumb(), 'ArrowRight');
      expect(onmove).toHaveBeenLastCalledWith('start', 61, 'commit');
      await key(startThumb(), 'ArrowLeft', { shiftKey: true });
      expect(onmove).toHaveBeenLastCalledWith('start', 50, 'commit');
      await key(endThumb(), 'End');
      expect(onmove).toHaveBeenLastCalledWith('end', 600, 'commit');
      await key(endThumb(), 'Home');
      expect(onmove).toHaveBeenLastCalledWith('end', 61, 'commit');
      await key(endThumb(), 'PageDown');
      expect(onmove).toHaveBeenLastCalledWith('end', 61, 'commit');
      await key(startThumb(), 'PageUp');
      expect(onmove).toHaveBeenLastCalledWith('start', 89, 'commit');
    });

    it('clamps the start handle to end-1 and the end handle to start+1', async () => {
      const { onmove } = setup();
      await key(startThumb(), 'End');
      expect(onmove).toHaveBeenLastCalledWith('start', 89, 'commit');
      await key(startThumb(), 'PageUp');
      expect(onmove).toHaveBeenLastCalledWith('start', 89, 'commit');
      await key(endThumb(), 'ArrowDown', { shiftKey: true });
      expect(onmove).toHaveBeenLastCalledWith('end', 80, 'commit');
    });

    it('prevents default only for keys it handled', async () => {
      setup();
      const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, bubbles: true });
      startThumb().dispatchEvent(handled);
      expect(handled.defaultPrevented).toBe(true);
      for (const init of [{ key: 'KeyI', code: 'KeyI' }, { key: ' ', code: 'Space' }, { key: 'ArrowRight', altKey: true }]) {
        const ev = new KeyboardEvent('keydown', { ...init, cancelable: true, bubbles: true });
        startThumb().dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(false);
      }
    });

    it('ignores Alt/Ctrl/Meta arrows and unrelated keys', async () => {
      const { onmove } = setup();
      await key(startThumb(), 'ArrowRight', { altKey: true });
      await key(startThumb(), 'ArrowRight', { ctrlKey: true });
      await key(startThumb(), 'ArrowRight', { metaKey: true });
      await key(startThumb(), 'a');
      expect(onmove).not.toHaveBeenCalled();
    });

    it('ime key ignored', async () => {
      const { onmove } = setup();
      await key(startThumb(), 'ArrowRight', { isComposing: true });
      await fireEvent.keyDown(startThumb(), { key: 'Process', keyCode: 229 });
      await fireEvent.keyDown(startThumb(), { key: 'ArrowRight', keyCode: 229 });
      expect(onmove).not.toHaveBeenCalled();
    });

    it('does nothing when the video is too short to edit (len < 2)', async () => {
      const { onmove } = setup({ length: 1.9, start: 0, end: 1, band: true });
      await key(startThumb(), 'ArrowRight');
      expect(onmove).not.toHaveBeenCalled();
    });
  });

  describe('pointer', () => {
    it('drag emits drag then commit', async () => {
      const { onmove } = setup();
      const thumb = startThumb();
      await fireEvent.pointerDown(thumb, { clientX: 60, pointerId: 1 });
      expect(onmove).not.toHaveBeenCalled();
      await fireEvent.pointerMove(thumb, { clientX: 300, pointerId: 1 });
      expect(onmove).toHaveBeenLastCalledWith('start', 300, 'drag');
      await fireEvent.pointerUp(thumb, { clientX: 300, pointerId: 1 });
      expect(onmove).toHaveBeenLastCalledWith('start', 300, 'commit');
      expect(onmove.mock.calls.filter((c) => c[2] === 'commit')).toHaveLength(1);
    });

    it('drag is not clamped by the component (parent clamps), but the position is bounded to the bar', async () => {
      const { onmove } = setup();
      const thumb = endThumb();
      await fireEvent.pointerDown(thumb, { clientX: 90, pointerId: 1 });
      await fireEvent.pointerMove(thumb, { clientX: 9999, pointerId: 1 });
      expect(onmove).toHaveBeenLastCalledWith('end', 600, 'drag');
      await fireEvent.pointerMove(thumb, { clientX: -50, pointerId: 1 });
      expect(onmove).toHaveBeenLastCalledWith('end', 0, 'drag');
    });

    it('moves without a press are ignored; a second press after release works', async () => {
      const { onmove } = setup();
      await fireEvent.pointerMove(startThumb(), { clientX: 300, pointerId: 1 });
      expect(onmove).not.toHaveBeenCalled();
      await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
      await fireEvent.pointerUp(startThumb(), { clientX: 120, pointerId: 1 });
      await fireEvent.pointerMove(startThumb(), { clientX: 300, pointerId: 1 });
      expect(onmove.mock.calls.map((c) => c[2])).toEqual(['commit']);
    });

    it('pointercancel commits the last dragged value once', async () => {
      const { onmove } = setup();
      await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
      await fireEvent.pointerMove(startThumb(), { clientX: 200, pointerId: 1 });
      await fireEvent.pointerCancel(startThumb(), { pointerId: 1 });
      expect(onmove).toHaveBeenLastCalledWith('start', 200, 'commit');
      await fireEvent.pointerMove(startThumb(), { clientX: 400, pointerId: 1 });
      expect(onmove.mock.calls.filter((c) => c[2] === 'commit')).toHaveLength(1);
    });

    it('cancel without any move commits nothing', async () => {
      const { onmove } = setup();
      await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
      await fireEvent.pointerCancel(startThumb(), { pointerId: 1 });
      expect(onmove).not.toHaveBeenCalled();
    });

    it('track click seeks and does not move thumbs', async () => {
      const { track, onmove, onseek } = setup();
      await fireEvent.pointerDown(track, { clientX: 300, pointerId: 1 });
      expect(onseek).toHaveBeenCalledExactlyOnceWith(300);
      expect(onmove).not.toHaveBeenCalled();
    });

    it('pressing a thumb does not also seek', async () => {
      const { onseek } = setup();
      await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
      await fireEvent.pointerUp(startThumb(), { clientX: 60, pointerId: 1 });
      expect(onseek).not.toHaveBeenCalled();
    });

    it('track click does not move focus into the bar', async () => {
      const { track } = setup();
      const before = document.activeElement;
      await fireEvent.pointerDown(track, { clientX: 300, pointerId: 1 });
      expect(document.activeElement).toBe(before);
      expect(document.activeElement).not.toBe(startThumb());
    });

    it('track click uses the fraction of the bar (floor)', async () => {
      const { track, onseek } = setup({ length: 599.9 });
      await fireEvent.pointerDown(track, { clientX: 600, pointerId: 1 });
      expect(onseek).toHaveBeenLastCalledWith(599);
    });

    it('right/middle button does not seek or drag', async () => {
      const { track, onmove, onseek } = setup();
      await fireEvent.pointerDown(track, { clientX: 300, button: 2, pointerId: 1 });
      await fireEvent.pointerDown(startThumb(), { clientX: 60, button: 2, pointerId: 1 });
      await fireEvent.pointerMove(startThumb(), { clientX: 200, pointerId: 1 });
      expect(onseek).not.toHaveBeenCalled();
      expect(onmove).not.toHaveBeenCalled();
    });
  });

  it('disabled: aria-disabled and no onmove', async () => {
    const { onmove } = setup({ disabled: true });
    expect(startThumb()).toHaveAttribute('aria-disabled', 'true');
    expect(endThumb()).toHaveAttribute('aria-disabled', 'true');
    expect(startThumb()).toHaveAttribute('tabindex', '0');
    await key(startThumb(), 'ArrowRight');
    await fireEvent.pointerDown(startThumb(), { clientX: 60, pointerId: 1 });
    await fireEvent.pointerMove(startThumb(), { clientX: 200, pointerId: 1 });
    await fireEvent.pointerUp(startThumb(), { clientX: 200, pointerId: 1 });
    expect(onmove).not.toHaveBeenCalled();
  });

  it('enabled sliders have no aria-disabled', () => {
    setup();
    expect(startThumb()).not.toHaveAttribute('aria-disabled');
  });

  it('band hidden when band=false', () => {
    const on = setup();
    expect(on.container.querySelector('.upto-end')).not.toBeNull();
    expect(on.container.querySelector('.before-start')).not.toBeNull();
    on.unmount();
    const off = setup({ band: false });
    expect(off.container.querySelector('.upto-end')).toBeNull();
    expect(off.container.querySelector('.before-start')).toBeNull();
  });

  it('band and handles reflect fractions through --p', () => {
    const { container } = setup();
    const p = (sel: string) => (container.querySelector(sel) as HTMLElement).style.getPropertyValue('--p');
    expect(p('.upto-end')).toBe('0.15');
    expect(p('.before-start')).toBe('0.1');
    expect(p('.anchor-start')).toBe('0.1');
    expect(p('.anchor-end')).toBe('0.15');
  });

  it('position marker reflects position', () => {
    const { container } = setup({ position: 300 });
    expect((container.querySelector('.position') as HTMLElement).style.getPropertyValue('--p')).toBe('0.5');
  });

  it('position is clamped to the bar', () => {
    const { container } = setup({ position: 9999 });
    expect((container.querySelector('.position') as HTMLElement).style.getPropertyValue('--p')).toBe('1');
  });

  it('Tab order is DOM order start then end even when inverted', () => {
    const { container } = setup({ start: 330, end: 65, band: false });
    const sliders = [...container.querySelectorAll('[role="slider"]')];
    expect(sliders.map((s) => s.getAttribute('aria-label'))).toEqual([t('range.start'), t('range.end')]);
    expect(sliders.every((s) => s.getAttribute('tabindex') === '0')).toBe(true);
    // 끝 손잡이가 시작 손잡이보다 왼쪽에 그려진다
    const p = (sel: string) => Number((container.querySelector(sel) as HTMLElement).style.getPropertyValue('--p'));
    expect(p('.anchor-end')).toBeLessThan(p('.anchor-start'));
  });

  describe('inverted (band=false)', () => {
    const inv = { start: 330, end: 65, band: false };

    it('both sliders bounded 0..floor(len) and valuenow within bounds', () => {
      setup({ ...inv, length: 600.7 });
      for (const s of [startThumb(), endThumb()]) {
        expect(s).toHaveAttribute('aria-valuemin', '0');
        expect(s).toHaveAttribute('aria-valuemax', '600');
        const now = Number(s.getAttribute('aria-valuenow'));
        expect(now).toBeGreaterThanOrEqual(0);
        expect(now).toBeLessThanOrEqual(600);
      }
    });

    it('→ on start moves +1 without jump', async () => {
      const { onmove } = setup(inv);
      await key(startThumb(), 'ArrowRight');
      expect(onmove).toHaveBeenLastCalledWith('start', 331, 'commit');
      await key(endThumb(), 'ArrowRight');
      expect(onmove).toHaveBeenLastCalledWith('end', 66, 'commit');
    });

    it('Home/End use the whole bar', async () => {
      const { onmove } = setup(inv);
      await key(startThumb(), 'End');
      expect(onmove).toHaveBeenLastCalledWith('start', 600, 'commit');
      await key(endThumb(), 'Home');
      expect(onmove).toHaveBeenLastCalledWith('end', 0, 'commit');
    });
  });

  describe('adjacent handles', () => {
    it('pointerdown on each thumb grabs that thumb only (outward hit areas never overlap)', async () => {
      const { onmove } = setup({ start: 100, end: 101 });
      await fireEvent.pointerDown(startThumb(), { clientX: 99, pointerId: 1 });
      await fireEvent.pointerMove(startThumb(), { clientX: 50, pointerId: 1 });
      expect(onmove).toHaveBeenLastCalledWith('start', 50, 'drag');
      await fireEvent.pointerUp(startThumb(), { clientX: 50, pointerId: 1 });
      await fireEvent.pointerDown(endThumb(), { clientX: 102, pointerId: 1 });
      await fireEvent.pointerMove(endThumb(), { clientX: 300, pointerId: 1 });
      expect(onmove).toHaveBeenLastCalledWith('end', 300, 'drag');
    });

    it('start=end-1: values stay valid and the keys respect min gap', async () => {
      const { onmove } = setup({ start: 100, end: 101 });
      expect(startThumb()).toHaveAttribute('aria-valuemax', '100');
      expect(endThumb()).toHaveAttribute('aria-valuemin', '101');
      await key(startThumb(), 'ArrowRight');
      expect(onmove).toHaveBeenLastCalledWith('start', 100, 'commit');
      await key(endThumb(), 'ArrowLeft');
      expect(onmove).toHaveBeenLastCalledWith('end', 101, 'commit');
    });

    it('hit areas extend outward: the start side is marked left, the end side right', () => {
      setup();
      expect(startThumb()).toHaveAttribute('data-side', 'start');
      expect(endThumb()).toHaveAttribute('data-side', 'end');
    });
  });

  it('len 0 draws a zero fraction without throwing', () => {
    const { container } = setup({ length: 0, start: 0, end: 0, band: false, position: 5 });
    expect((container.querySelector('.position') as HTMLElement).style.getPropertyValue('--p')).toBe('0');
    expect(startThumb()).toHaveAttribute('aria-valuenow', '0');
  });
});
