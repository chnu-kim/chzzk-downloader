import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcer } from './announce.svelte';

describe('Announcer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    announcer.message = '';
  });
  afterEach(() => vi.useRealTimers());

  it('먼저 비우고 다음 프레임에 문장을 넣는다(같은 문장도 다시 읽히게)', () => {
    announcer.say('완료');
    expect(announcer.message).toBe('');
    vi.advanceTimersToNextFrame();
    expect(announcer.message).toBe('완료');
    announcer.say('완료');
    expect(announcer.message).toBe('');
    vi.advanceTimersToNextFrame();
    expect(announcer.message).toBe('완료');
  });

  it('프레임 안에 연달아 부르면 마지막 문장만 남는다', () => {
    announcer.say('하나');
    announcer.say('둘');
    vi.advanceTimersToNextFrame();
    expect(announcer.message).toBe('둘');
  });
});
