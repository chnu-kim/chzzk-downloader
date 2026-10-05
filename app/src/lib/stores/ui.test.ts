import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastStore } from './toast.svelte';
import { UiStore, modKey } from './ui.svelte';

describe('UiStore Esc', () => {
  it('안쪽(나중에 쌓은) 처리기부터, 받지 않으면 다음으로', () => {
    const ui = new UiStore();
    const order: string[] = [];
    ui.onEscape(() => {
      order.push('card');
      return true;
    });
    const offLoading = ui.onEscape(() => {
      order.push('loading');
      return false;
    });
    expect(ui.escape()).toBe(true);
    expect(order).toEqual(['loading', 'card']);
    offLoading();
    order.length = 0;
    ui.escape();
    expect(order).toEqual(['card']);
  });

  it('아무도 받지 않으면 설정에서 홈으로', () => {
    const ui = new UiStore();
    ui.goSettings({ cookies: true });
    expect(ui.view).toBe('settings');
    expect(ui.openCookieSection).toBe(true);
    expect(ui.escape()).toBe(true);
    expect(ui.view).toBe('home');
    expect(ui.escape()).toBe(false);
  });

  it('Mod는 macOS에서 Cmd, 그 밖은 Ctrl', () => {
    const cmd = new KeyboardEvent('keydown', { key: 'l', metaKey: true });
    const ctrl = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true });
    expect(modKey(cmd, true)).toBe(true);
    expect(modKey(ctrl, true)).toBe(false);
    expect(modKey(ctrl, false)).toBe(true);
    expect(modKey(cmd, false)).toBe(false);
  });
});

describe('ToastStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('5초 뒤 사라지고, 올려 둔 동안은 멈춘다', () => {
    vi.useFakeTimers();
    const s = new ToastStore();
    const a = s.push('복사했어요', 'copied');
    const b = s.push("'영상' 다운로드를 마쳤어요", 'success');
    expect(s.items.map((i) => i.id)).toEqual([a, b]);

    vi.advanceTimersByTime(3000);
    s.pause(b);
    vi.advanceTimersByTime(2000);
    expect(s.items.map((i) => i.id)).toEqual([b]);

    vi.advanceTimersByTime(10_000);
    expect(s.items).toHaveLength(1);
    s.resume(b);
    vi.advanceTimersByTime(1999);
    expect(s.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(s.items).toHaveLength(0);
  });

  it('dismiss는 바로 지운다', () => {
    const s = new ToastStore();
    const id = s.push('x');
    s.dismiss(id);
    expect(s.items).toEqual([]);
  });
});
