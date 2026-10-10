/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Rust 셸의 AuthGate 허용 목록(crates/shell/src/gate.rs)과 웹 E2E 가짜 백엔드(app/e2e/mock/backend.ts)가 같은지 본다.
const read = (rel: string) => readFileSync(fileURLToPath(new globalThis.URL(rel, import.meta.url).href), 'utf8');
const listIn = (text: string, start: RegExp) => {
  const m = start.exec(text);
  if (!m) throw new Error(`목록을 찾지 못함: ${start}`);
  const body = text.slice(m.index + m[0].length, text.indexOf(']', m.index + m[0].length));
  return [...body.matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]);
};

describe('AuthGate 허용 목록', () => {
  it('Rust OPEN_COMMANDS와 가짜 백엔드 OPEN_COMMANDS가 같다', () => {
    const rust = listIn(read('../../../crates/shell/src/gate.rs'), /pub const OPEN_COMMANDS: &\[&str\] = &\[/);
    const mock = listIn(read('../../e2e/mock/backend.ts'), /export const OPEN_COMMANDS = \[/);
    expect(rust).toHaveLength(13);
    expect(mock).toEqual(rust);
  });
});
