import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS } from '../timing';
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

  it('정보 토스트는 TOAST_MS 뒤 사라지고, 올려 둔 동안은 멈췄다가 떠나면 처음부터 센다', () => {
    vi.useFakeTimers();
    const s = new ToastStore();
    const a = s.push('완료했어요', 'success');
    expect(s.items.map((i) => i.id)).toEqual([a]);

    vi.advanceTimersByTime(TOAST_MS - 1000);
    s.pause(a);
    vi.advanceTimersByTime(TOAST_MS * 3);
    expect(s.items.map((i) => i.id)).toEqual([a]);
    s.resume(a);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(s.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(s.items).toHaveLength(0);
    expect(s.current).toBeNull();
  });

  it('한 번에 하나만 보이고, 정보·완료 토스트는 새 토스트가 오면 대체되어 items에서 빠진다', () => {
    const s = new ToastStore();
    s.push('복사했어요', 'copied');
    const b = s.push('저장했어요', 'info');
    expect(s.items.map((i) => i.id)).toEqual([b]);
    expect(s.current?.id).toBe(b);
    const c = s.push('오류', 'danger');
    expect(s.items.map((i) => i.id)).toEqual([c]); // b도 대체됐다
  });

  it('danger·action 토스트는 대체되지 않고 FIFO로 기다린다', () => {
    const s = new ToastStore();
    const d1 = s.push('첫째 오류', 'danger');
    const d2 = s.push('둘째 오류', 'danger');
    const act = s.push('지웠어요', 'info', { action: { label: '되돌리기', run: () => {} } });
    expect(s.items.map((i) => i.id)).toEqual([d1, d2, act]);
    expect(s.current?.id).toBe(d1);
    s.push('복사했어요', 'copied');
    expect(s.items.slice(0, 3).map((i) => i.id)).toEqual([d1, d2, act]); // 오류는 하나도 잃지 않는다
    s.dismiss(d1);
    expect(s.current?.id).toBe(d2);
    s.dismiss(d2);
    expect(s.current?.id).toBe(act);
  });

  it('danger는 타이머가 없고, action 토스트는 타이머가 있다', () => {
    vi.useFakeTimers();
    const s = new ToastStore();
    const d = s.push('오류', 'danger');
    vi.advanceTimersByTime(TOAST_MS * 10);
    expect(s.items.map((i) => i.id)).toEqual([d]);
    s.dismiss(d);
    const a = s.push('지웠어요', 'info', { action: { label: '되돌리기', run: () => {} } });
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(s.items.map((i) => i.id)).toEqual([a]);
    vi.advanceTimersByTime(1);
    expect(s.items).toEqual([]);
  });

  it('대기 중이던 토스트는 보이게 된 때부터 수명을 센다', () => {
    vi.useFakeTimers();
    const s = new ToastStore();
    const d = s.push('오류', 'danger');
    const act = s.push('지웠어요', 'info', { action: { label: '되돌리기', run: () => {} } });
    vi.advanceTimersByTime(TOAST_MS * 2);
    expect(s.items.map((i) => i.id)).toEqual([d, act]);
    s.dismiss(d);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(s.items.map((i) => i.id)).toEqual([act]);
    vi.advanceTimersByTime(1);
    expect(s.items).toEqual([]);
  });

  it('dismiss는 바로 지우고, clear는 모두 지운다', () => {
    const s = new ToastStore();
    const id = s.push('x');
    s.dismiss(id);
    expect(s.items).toEqual([]);
    s.push('a', 'danger');
    s.push('b', 'danger');
    s.clear();
    expect(s.items).toEqual([]);
    expect(s.current).toBeNull();
  });
});
