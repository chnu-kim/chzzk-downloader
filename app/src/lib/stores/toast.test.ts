import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_MS } from '../timing';
import { ToastStore } from './toast.svelte';

describe('토스트 닫힘 알림(지연 삭제, patterns.md §4)', () => {
  afterEach(() => vi.useRealTimers());

  it('까닭마다 onclose를 한 번만 부른다: 동작·닫기·시간·대체·비우기', () => {
    vi.useFakeTimers();
    const s = new ToastStore();
    const seen: string[] = [];
    const undo = { label: '되돌리기', run: () => seen.push('run') };
    const a = s.push('지웠어요', 'info', { action: undo, onclose: (r) => seen.push(`a:${r}`) });
    s.runAction(a);
    expect(seen).toEqual(['run', 'a:action']);
    s.dismiss(a);
    expect(seen).toEqual(['run', 'a:action']);

    const b = s.push('지웠어요', 'info', { action: undo, onclose: (r) => seen.push(`b:${r}`) });
    s.dismiss(b);
    const c = s.push('지웠어요', 'info', { action: undo, onclose: (r) => seen.push(`c:${r}`) });
    vi.advanceTimersByTime(TOAST_MS);
    expect(s.items.some((i) => i.id === c)).toBe(false);

    s.push('정보', 'info', { onclose: (r) => seen.push(`d:${r}`) });
    s.push('새 정보', 'info', { onclose: (r) => seen.push(`e:${r}`) });
    s.clear();
    expect(seen).toEqual(['run', 'a:action', 'b:dismiss', 'c:timeout', 'd:replaced', 'e:clear']);
  });

  it('동작이 있는 토스트는 대체되지 않고 줄을 선다', () => {
    const s = new ToastStore();
    const closed: string[] = [];
    const undo = { label: '되돌리기', run: () => {} };
    const first = s.push('하나', 'info', { action: undo, onclose: (r) => closed.push(`1:${r}`) });
    s.push('둘', 'info', { action: undo, onclose: (r) => closed.push(`2:${r}`) });
    expect(s.current?.id).toBe(first);
    expect(closed).toEqual([]);
    s.clear();
  });
});
