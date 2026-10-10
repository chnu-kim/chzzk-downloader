// `--smoke`의 프런트 쪽(docs/design/cicd.md §6): 앱을 띄우면 `frontend_ready`를 정확히 한 번 보낸다.
import { mockIPC } from '@tauri-apps/api/mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('svelte', async (orig) => ({ ...(await orig<typeof import('svelte')>()), mount: vi.fn(() => ({})) }));
vi.mock('./App.svelte', () => ({ default: {} }));

const probes: unknown[] = [];
function countReady(): () => number {
  let n = 0;
  probes.length = 0;
  mockIPC((cmd, args) => {
    if (cmd === 'frontend_ready') {
      n++;
      probes.push((args as { probe: unknown }).probe);
    }
    return null;
  });
  return () => n;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('frontend_ready', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
  });

  it('main.ts를 실으면 mount 뒤 한 번 보낸다', async () => {
    const count = countReady();
    const { mount } = await import('svelte');
    await import('./main');
    await flush();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(count()).toBe(1);
  });

  it('signalReady를 여러 번 불러도 한 번만 보낸다', async () => {
    const count = countReady();
    const { signalReady } = await import('./lib/ready');
    signalReady();
    signalReady();
    signalReady();
    await flush();
    expect(count()).toBe(1);
  });

  it('엔진 프로브를 probe 인자로 보내고, 하나라도 false면 엔진 경고 상태를 켠다', async () => {
    const count = countReady();
    const { signalReady } = await import('./lib/ready');
    const { engine } = await import('./lib/stores/engine.svelte');
    const stale = { colorMix: true, has: false, oklch: true, containerQuery: true, inert: true };
    signalReady(undefined, () => stale);
    await flush();
    expect(count()).toBe(1);
    expect(probes[0]).toEqual(stale);
    expect(engine.old).toBe(true);
    expect(engine.showBanner).toBe(true);
    engine.dismiss();
    expect(engine.showBanner).toBe(false);
  });

  it('프로브가 모두 true면 경고 상태가 꺼져 있다', async () => {
    countReady();
    const { signalReady } = await import('./lib/ready');
    const { engine } = await import('./lib/stores/engine.svelte');
    signalReady(undefined, () => ({ colorMix: true, has: true, oklch: true, containerQuery: true, inert: true }));
    await flush();
    expect(engine.old).toBe(false);
    expect(engine.showBanner).toBe(false);
  });

  it('보내기가 실패해도 던지지 않는다', async () => {
    const { signalReady } = await import('./lib/ready');
    const send = vi.fn(() => Promise.reject(new Error('x')));
    expect(() => signalReady(send)).not.toThrow();
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('#app이 없으면 보내지 않는다', async () => {
    document.body.innerHTML = '';
    const count = countReady();
    await expect(import('./main')).rejects.toThrow('#app');
    await flush();
    expect(count()).toBe(0);
  });
});
