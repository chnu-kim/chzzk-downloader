/// <reference types="node" />
// vitest는 CSS import를 빈 문자열로 바꾸므로(`?raw`도) 파일을 직접 읽는다. 이 파일만 node 타입을 쓴다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

// docs/design/ui-visual.md §2의 대비 요구를 토큰 파일에서 직접 계산한다.
// 값이 바뀌면 여기서 바로 잡힌다(눈대중으로 통과시키지 않는다).

function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`${selector} 블록이 없다`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function tokens(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const light = tokens(block(':root {'));
const darkAuto = tokens(block(":root:not([data-theme='light'])"));
const darkForced = tokens(block(":root[data-theme='dark']"));

const isColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v) || v.startsWith('rgba(');
const colorKeys = [...light].filter(([, v]) => isColor(v)).map(([k]) => k);

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const ch = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [앞, 뒤, 최소 대비]
const pairs: [string, string, number][] = [
  // 본문 4.5:1
  ['--fg', '--bg', 4.5],
  ['--fg', '--surface', 4.5],
  ['--fg', '--surface-2', 4.5],
  ['--fg', '--surface-raised', 4.5],
  ['--fg', '--accent-soft', 4.5],
  ['--fg', '--danger-soft', 4.5],
  ['--fg', '--warning-soft', 4.5],
  ['--fg', '--success-soft', 4.5],
  ['--fg-muted', '--bg', 4.5],
  ['--fg-muted', '--surface', 4.5],
  ['--fg-muted', '--surface-2', 4.5],
  ['--accent-fg', '--accent', 4.5],
  ['--danger-fg', '--danger', 4.5],
  // 색 글자(배지·오류 제목·링크)도 본문 기준
  ['--accent', '--surface', 4.5],
  ['--accent', '--bg', 4.5],
  ['--accent', '--accent-soft', 4.5],
  ['--danger', '--surface', 4.5],
  ['--danger', '--danger-soft', 4.5],
  ['--warning', '--surface', 4.5],
  ['--warning', '--warning-soft', 4.5],
  ['--success', '--surface', 4.5],
  ['--success', '--success-soft', 4.5],
  ['--kind-rewind', '--surface', 4.5],
  ['--kind-vod', '--surface', 4.5],
  ['--kind-clip', '--surface', 4.5],
  // 보조 글자·비텍스트(입력 테두리·포커스 링·진행 막대) 3:1
  ['--fg-faint', '--surface', 3],
  ['--border-strong', '--surface', 3],
  ['--focus', '--surface', 3],
  ['--focus', '--bg', 3],
  ['--accent', '--surface-2', 3],
  ['--fg-muted', '--surface-2', 3],
];

describe('tokens.css', () => {
  it('다크 두 블록은 같은 값이다', () => {
    expect([...darkForced]).toEqual([...darkAuto]);
  });

  it('라이트의 모든 색 토큰이 다크에도 있다', () => {
    const missing = colorKeys.filter((k) => !darkAuto.has(k));
    expect(missing).toEqual([]);
    const extra = [...darkAuto.keys()].filter((k) => !light.has(k));
    expect(extra).toEqual([]);
  });

  for (const [theme, t] of [
    ['light', light],
    ['dark', darkAuto],
  ] as const) {
    describe(theme, () => {
      for (const [fg, bg, min] of pairs) {
        it(`${fg} / ${bg} ≥ ${min}:1`, () => {
          const a = t.get(fg);
          const b = t.get(bg);
          if (!a || !b) throw new Error(`${fg} 또는 ${bg}가 없다`);
          expect(contrast(a, b)).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }

  it('움직임 줄이기 블록이 모든 dur 토큰을 0으로 만든다', () => {
    const reduced = tokens(block('@media (prefers-reduced-motion: reduce)'));
    const durs = [...light.keys()].filter((k) => k.startsWith('--dur-'));
    for (const k of durs) expect(reduced.get(k)).toBe('0ms');
  });

  it('글꼴 스택은 시스템 글꼴만 쓴다(번들 글꼴 없음)', () => {
    expect(light.get('--font-sans')).toMatch(/^system-ui/);
    expect(css).not.toMatch(/@font-face|url\(/);
  });
});
