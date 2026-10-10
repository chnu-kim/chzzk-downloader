// @vitest-environment node
// 지원 기준선(app/baseline.json)과 그것을 쓰는 곳이 어긋나지 않는지, 첫 프레임 순서(index.html)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const baseline = JSON.parse(read('../baseline.json')) as Record<string, string>;
const ver = (v: string) => v.split('.').map(Number);

describe('baseline.json', () => {
  it('네 엔진 키가 있고 점으로 나뉜 숫자다', () => {
    expect(Object.keys(baseline).sort()).toEqual(['chrome', 'macos', 'safari', 'webkitgtk']);
    for (const v of Object.values(baseline)) expect(v).toMatch(/^\d+(\.\d+)?$/);
  });

  it('vite cssTarget이 baseline의 chrome·safari다', () => {
    expect(config.build?.cssTarget).toEqual([`chrome${baseline.chrome}`, `safari${baseline.safari}`]);
  });

  it('lightningcss targets가 baseline에서 계산한 값이다(major<<16 | minor<<8)', () => {
    expect(config.css?.transformer).toBe('lightningcss');
    const [cMaj] = ver(baseline.chrome);
    const [sMaj, sMin = 0] = ver(baseline.safari);
    expect(config.css?.lightningcss?.targets).toEqual({ chrome: cMaj << 16, safari: (sMaj << 16) | (sMin << 8) });
  });
});

describe('index.html 첫 프레임', () => {
  const html = read('../index.html');

  it('color-scheme meta가 있다', () => {
    expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/);
  });

  it('첫 stylesheet 링크가 모든 스크립트보다 앞에 있다', () => {
    const link = html.search(/<link\s+rel="stylesheet"\s+href="\/src\/styles\/first\.css"\s*\/?>/);
    const script = html.search(/<script\b/);
    expect(link).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(-1);
    expect(link).toBeLessThan(script);
    // 다른 stylesheet보다도 앞(첫 번째 링크)
    expect(html.search(/<link\s+rel="stylesheet"/)).toBe(link);
  });

  it('first.css는 tokens.css와 html 배경이고, main.ts는 tokens.css를 다시 싣지 않는다', () => {
    const first = read('./styles/first.css');
    expect(first).toMatch(/@import\s+'\.\/tokens\.css'/);
    expect(first).toMatch(/html\s*\{\s*background:\s*var\(--bg\)/);
    expect(read('./main.ts')).not.toMatch(/tokens\.css['"]\s*;/);
  });
});
