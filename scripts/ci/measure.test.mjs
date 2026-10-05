// node --test scripts/ci/measure.test.mjs — 측정 출력 파서(docs/design/cicd.md §4.2)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';

import { countActive, countListed, gzipTotal, llvmLinesPct, playwrightCount, vitestCount, vitestLinesPct } from './measure.mjs';

test('llvm-cov·vitest 커버리지 JSON', () => {
  assert.equal(llvmLinesPct({ data: [{ totals: { lines: { count: 3, covered: 2, percent: 66.666666 } } }] }), 66.67);
  assert.throws(() => llvmLinesPct({ data: [] }), /percent/);
  assert.equal(vitestLinesPct({ total: { lines: { pct: 91.09 } } }), 91.09);
  assert.throws(() => vitestLinesPct({}), /pct/);
});

test('cargo test --list --format terse 출력에서 테스트만 센다', () => {
  const out = ['a::b: test', 'c: test', 'bench_x: benchmark', '', 'Running x', 'd: test  '].join('\n');
  assert.equal(countListed(out), 3);
});

test('#[ignore] 테스트는 세지 않는다(--list − --list --ignored)', () => {
  const all = ['a: test', 'live_x: test', 'b: test', 'doc (line 3): test'].join('\n');
  assert.equal(countActive(all, 'live_x: test\n'), 3);
  assert.equal(countActive(all, ''), 4);
  // 테스트 하나를 #[ignore]로 바꾸면 전체 목록은 그대로지만 수가 준다
  assert.equal(countActive(all, 'live_x: test\nb: test\n'), 2);
  assert.throws(() => countActive('a: test', 'a: test\nb: test'), /많다/);
});

test('vitest json: 통과한 수만 센다(skip·todo 제외), 실패가 있으면 오류', () => {
  assert.equal(vitestCount({ numTotalTests: 5, numPassedTests: 5, numFailedTests: 0, success: true }), 5);
  // it.skip 하나, it.todo 하나: 전체 수는 그대로지만 통과 수가 준다
  assert.equal(vitestCount({ numTotalTests: 5, numPassedTests: 3, numPendingTests: 1, numTodoTests: 1, numFailedTests: 0, success: true }), 3);
  assert.throws(() => vitestCount({ numTotalTests: 5, numPassedTests: 4, numFailedTests: 1, success: false }), /실패/);
  assert.throws(() => vitestCount({ numTotalTests: 5 }), /numPassedTests/);
});

test('gzipTotal: 파일마다 gzip(level 9) 크기의 합, 결정적', () => {
  const d = mkdtempSync(join(tmpdir(), 'gz-'));
  try {
    mkdirSync(join(d, 'assets'));
    writeFileSync(join(d, 'index.html'), '<html>'.repeat(50));
    writeFileSync(join(d, 'assets/a.js'), 'console.log(1);'.repeat(30));
    const want = gzipSync(Buffer.from('<html>'.repeat(50)), { level: 9 }).length + gzipSync(Buffer.from('console.log(1);'.repeat(30)), { level: 9 }).length;
    assert.equal(gzipTotal(d), want);
    assert.equal(gzipTotal(d), gzipTotal(d));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('Playwright: 통과한 테스트만 세고, 실패·flaky가 있으면 오류', () => {
  assert.equal(playwrightCount({ stats: { expected: 7, unexpected: 0, flaky: 0, skipped: 2 } }), 7);
  assert.throws(() => playwrightCount({ stats: { expected: 6, unexpected: 1, flaky: 0, skipped: 0 } }), /실패 1개/);
  assert.throws(() => playwrightCount({ stats: { expected: 6, unexpected: 0, flaky: 1, skipped: 0 } }), /flaky 1개/);
  assert.throws(() => playwrightCount({}), /stats\.expected/);
  // skip을 늘리면 수가 준다(ratchet이 잡는다)
  assert.ok(playwrightCount({ stats: { expected: 5, skipped: 2 } }) < playwrightCount({ stats: { expected: 7, skipped: 0 } }));
});
