// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// jsdom은 배치를 계산하지 않으므로 잘림·포커스 링 같은 것은 소스에서 막는다.
function rule(file: string, selector: string): string {
  const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
  const style = src.slice(src.indexOf('<style'));
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bodies = [...style.matchAll(new RegExp(`(?:^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
  expect(bodies.length, `${file} ${selector}`).toBeGreaterThan(0);
  return bodies.join('\n');
}

describe('스타일 회귀', () => {
  it('작업 항목은 overflow로 깎지 않는다([⋯] 메뉴가 잘리고 항목 안이 스크롤됐다)', () => {
    expect(rule('./lib/components/jobs/JobItem.svelte', '.item')).not.toMatch(/overflow\s*:\s*(hidden|clip|auto|scroll)/);
  });

  it.each([
    ['./lib/components/app/AppHeader.svelte', '.title:focus'],
    ['./lib/components/jobs/JobList.svelte', '.list-title:focus'],
    ['./lib/views/LoginView.svelte', '.title:focus'],
  ])('%s %s는 전역 포커스 링(box-shadow)도 끈다', (file, sel) => {
    expect(rule(file, sel)).toMatch(/box-shadow\s*:\s*none/);
  });
});
