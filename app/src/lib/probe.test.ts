import { afterEach, describe, expect, it, vi } from 'vitest';
import { engineProbe, probeOk } from './probe';

// jsdom에는 `CSS.supports`가 없다: 각 기능을 가짜로 주입해 다섯 키가 각자 자기 질의에 대응하는지 본다
function stubCss(supported: (q: string) => boolean) {
  vi.stubGlobal('CSS', {
    supports: (a: string, b?: string) => supported(b === undefined ? a : `${a}: ${b}`),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('엔진 프로브(platform.md §5)', () => {
  it('다섯 질의가 각자 자기 키에 간다', () => {
    const asked: string[] = [];
    stubCss((q) => {
      asked.push(q);
      return true;
    });
    const p = engineProbe();
    expect(asked).toEqual([
      'color: color-mix(in srgb, red 50%, blue)',
      'selector(:has(a))',
      'color: oklch(50% 0.1 200)',
      'container-type: inline-size',
    ]);
    expect(p).toEqual({ colorMix: true, has: true, oklch: true, containerQuery: true, inert: 'inert' in HTMLElement.prototype });
  });

  it('기능 하나가 없으면 그 키만 false다', () => {
    stubCss((q) => !q.startsWith('selector('));
    const p = engineProbe();
    expect(p.has).toBe(false);
    expect(p.colorMix && p.oklch && p.containerQuery).toBe(true);
  });

  it('CSS.supports가 없거나 던지는 엔진은 전부 false(던지지 않는다)', () => {
    vi.stubGlobal('CSS', undefined);
    expect(engineProbe()).toMatchObject({ colorMix: false, has: false, oklch: false, containerQuery: false });
    vi.stubGlobal('CSS', {
      supports: () => {
        throw new Error('x');
      },
    });
    expect(engineProbe()).toMatchObject({ colorMix: false, has: false, oklch: false, containerQuery: false });
  });

  it('probeOk는 다섯 모두 true일 때만 true', () => {
    const ok = { colorMix: true, has: true, oklch: true, containerQuery: true, inert: true };
    expect(probeOk(ok)).toBe(true);
    for (const k of Object.keys(ok) as (keyof typeof ok)[]) expect(probeOk({ ...ok, [k]: false }), k).toBe(false);
  });
});
