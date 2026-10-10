import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOADER_DELAY_MS, LOADER_MIN_MS } from './timing';
import { DelayedLoading } from './useDelayedLoading.svelte';

describe('로딩 표시 지연·최소 유지(patterns.md §2.2)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('지연 안에 끝나면 한 번도 보이지 않는다', () => {
    const seen: boolean[] = [];
    const d = new DelayedLoading((v) => seen.push(v), () => Date.now());
    d.set(true);
    vi.advanceTimersByTime(LOADER_DELAY_MS - 1);
    d.set(false);
    vi.advanceTimersByTime(LOADER_MIN_MS * 2);
    expect(seen).toEqual([]);
  });

  it('지연을 넘기면 보이고, 곧 끝나도 최소 유지 시간까지 남는다', () => {
    const seen: boolean[] = [];
    const d = new DelayedLoading((v) => seen.push(v), () => Date.now());
    d.set(true);
    vi.advanceTimersByTime(LOADER_DELAY_MS + 1);
    expect(seen).toEqual([true]);
    d.set(false);
    vi.advanceTimersByTime(LOADER_MIN_MS - 2);
    expect(d.visible).toBe(true);
    vi.advanceTimersByTime(2);
    expect(seen).toEqual([true, false]);
  });

  it('최소 유지 중 다시 바빠지면 그대로 보인다', () => {
    const seen: boolean[] = [];
    const d = new DelayedLoading((v) => seen.push(v), () => Date.now());
    d.set(true);
    vi.advanceTimersByTime(LOADER_DELAY_MS + 1);
    d.set(false);
    d.set(true);
    vi.advanceTimersByTime(LOADER_MIN_MS * 2);
    expect(seen).toEqual([true]);
    d.dispose();
  });
});
