// node --test scripts/ci/measure.test.mjs — 측정 출력 파서(docs/design/cicd.md §4.2)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';

import { countListed, gzipTotal, llvmLinesPct, vitestCount, vitestLinesPct } from './measure.mjs';

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

test('vitest json: 수를 세고 실패가 있으면 오류', () => {
  assert.equal(vitestCount({ numTotalTests: 5, numFailedTests: 0, success: true }), 5);
  assert.throws(() => vitestCount({ numTotalTests: 5, numFailedTests: 1, success: false }), /실패/);
  assert.throws(() => vitestCount({}), /numTotalTests/);
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
