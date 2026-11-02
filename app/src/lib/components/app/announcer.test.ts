import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announcer } from '../../stores/announce.svelte';
import LiveAnnouncer from './LiveAnnouncer.svelte';

describe('LiveAnnouncer 상주 영역(ADR-0033)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    announcer.message = '';
    announcer.urgent = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('처음부터 비어 있는 polite·assertive 영역이 하나씩 있고 role은 없다', () => {
    render(LiveAnnouncer);
    // body 직속으로 옮겨져 있다(모달 inert 밖, ADR-0033)
    const container = document.body;
    expect(container.querySelector('[data-live-announcer]')?.parentElement).toBe(document.body);
    const polite = container.querySelectorAll('[aria-live="polite"]');
    const assertive = container.querySelectorAll('[aria-live="assertive"]');
    expect(polite).toHaveLength(1);
    expect(assertive).toHaveLength(1);
    for (const el of [polite[0], assertive[0]]) {
      expect(el.textContent).toBe('');
      expect(el).toHaveAttribute('aria-atomic', 'true');
      expect(el.hasAttribute('role')).toBe(false);
    }
  });

  it('alert는 assertive 영역에, say는 polite 영역에 들어간다', async () => {
    render(LiveAnnouncer);
    // body 직속으로 옮겨져 있다(모달 inert 밖, ADR-0033)
    const container = document.body;
    announcer.alert('x');
    announcer.say('y');
    vi.advanceTimersToNextFrame();
    await Promise.resolve();
    expect(container.querySelector('[aria-live="assertive"]')).toHaveTextContent('x');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('y');
  });
});
