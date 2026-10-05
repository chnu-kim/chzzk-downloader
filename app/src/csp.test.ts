// @vitest-environment node
/// <reference types="node" />
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CSP는 `style-src 'self'`이다(tauri.conf.json). Svelte는 마크업을 innerHTML로 만들기 때문에
// 템플릿의 `style="…"` 속성은 런타임에 막힌다. jsdom 테스트는 이것을 잡지 못하므로 소스에서 막는다.
// 값은 `style:prop={…}` 지시자(CSSOM, 허용)로만 준다. `{@html}`도 쓰지 않는다.
const root = fileURLToPath(new URL('.', import.meta.url));

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return svelteFiles(p);
    return p.endsWith('.svelte') ? [p] : [];
  });
}

describe('CSP: 인라인 스타일 없음', () => {
  const files = svelteFiles(root);

  it('Svelte 파일을 찾았다', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [f.slice(root.length)]))('%s', (rel) => {
    const src = readFileSync(join(root, rel), 'utf8');
    // <style> 블록은 빼고 본다
    const markup = src.replace(/<style[\s\S]*?<\/style>/g, '');
    expect(markup).not.toMatch(/\sstyle\s*=/);
    expect(markup).not.toMatch(/\{@html\s/);
  });
});
