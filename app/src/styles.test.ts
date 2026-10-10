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

  // 프로그램이 포커스를 옮기는 제목은 전역 [data-focus-container]:focus-visible { outline: none }이 링을 끈다(app.css).
  // 파일마다 같은 일을 하는 지역 :focus 끄기 규칙이 남아 있으면 안 된다.
  it.each([
    ['./lib/components/app/AppHeader.svelte', /<h1\b[^>]*\bdata-focus-container\b/],
    ['./lib/components/jobs/JobList.svelte', /<h2\b[^>]*\bclass="list-title"[^>]*\bdata-focus-container\b|<h2\b[^>]*\bdata-focus-container\b[^>]*\bclass="list-title"/],
    ['./lib/views/LoginView.svelte', /<h2\b[^>]*\bclass="title"[^>]*\bdata-focus-container\b/],
  ])('%s: 제목에 data-focus-container가 있고 지역 :focus 끄기 규칙이 없다', (file, heading) => {
    const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
    expect(src).toMatch(heading);
    expect(src.slice(src.indexOf('<style') < 0 ? src.length : src.indexOf('<style'))).not.toMatch(/:focus\s*\{/);
  });
});
