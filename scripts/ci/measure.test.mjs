// node --test scripts/ci/measure.test.mjs — 측정 출력 파서(docs/design/cicd.md §4.2)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';

import { allowEntryCount, countActive, countListed, gzipTotal, llvmLinesPct, MUTANTS_AS_LIMIT, MUTANTS_OK_CODES, missedList, mutantsEnv, parseShard, playwrightCount, shardSummary, sumShards, vitestCount, vitestLinesPct } from './measure.mjs';

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

test('mutants: shard 표기, outcomes 요약, shard 합(빠지거나 겹치면 오류)', () => {
  assert.deepEqual(parseShard('0/4'), { k: 0, n: 4 });
  assert.deepEqual(parseShard('3/4'), { k: 3, n: 4 });
  for (const bad of ['4/4', '1/0', 'x', '', undefined, '0/17', '-1/4']) assert.throws(() => parseShard(bad), /MUTANTS_SHARD/, String(bad));
  const o = { total_mutants: 20, missed: 3, caught: 13, timeout: 0, unviable: 4, success: 0, cargo_mutants_version: '27.1.0', outcomes: [] };
  const s0 = shardSummary(o, { k: 0, n: 2 });
  assert.deepEqual(s0, { shard: 0, of: 2, total_mutants: 20, missed: 3, caught: 13, timeout: 0, unviable: 4, cargo_mutants_version: '27.1.0' });
  assert.throws(() => shardSummary({ ...o, missed: undefined }, { k: 0, n: 2 }), /missed/);
  const s1 = { ...s0, shard: 1, missed: 2, total_mutants: 10 };
  assert.deepEqual(sumShards([s1, s0]), { shards: 2, total: 30, missed: 5, caught: 26, timeout: 0, unviable: 8 });
  assert.throws(() => sumShards([s0]), /정확히/, '빠진 shard');
  assert.throws(() => sumShards([s0, s0]), /정확히/, '겹친 shard');
  assert.throws(() => sumShards([s0, { ...s1, of: 3 }]), /정확히/);
  assert.throws(() => sumShards([s0, { ...s1, cargo_mutants_version: '26.0.0' }]), /버전/);
  assert.throws(() => sumShards([]), /없다/);
  assert.deepEqual(MUTANTS_OK_CODES, [0, 2, 3]);
});

test('mutants: 테스트 바이너리 메모리 상한(Linux runner, cicd.md 구현 중 변경 125)', () => {
  const base = { PATH: '/usr/bin', HOME: '/home/x' };
  const e = mutantsEnv('linux', 'x64', base);
  // 나머지 env(PATH·HOME)를 지우지 않는다
  assert.equal(e.PATH, '/usr/bin');
  assert.equal(e.HOME, '/home/x');
  assert.equal(e.CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER, `prlimit --as=${MUTANTS_AS_LIMIT} --`);
  assert.equal(e.MALLOC_ARENA_MAX, '2');
  assert.equal(base.MALLOC_ARENA_MAX, undefined, '입력 env를 바꾸지 않는다');
  assert.equal(mutantsEnv('linux', 'arm64', base).CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUNNER, `prlimit --as=${MUTANTS_AS_LIMIT} --`);
  assert.throws(() => mutantsEnv('linux', 'ia32', base), /arch/);
  // 작업 2개 × 상한이 러너 16GB 안에 들고, 정상 테스트에 넉넉하다(1GiB 이상)
  assert.ok(Number.isInteger(MUTANTS_AS_LIMIT) && 2 * MUTANTS_AS_LIMIT < 16e9 && MUTANTS_AS_LIMIT >= 2 ** 30);
  // Linux가 아니면(prlimit 없음) 그대로
  for (const os of ['darwin', 'win32']) assert.deepEqual(mutantsEnv(os, 'x64', base), base);
});

test('mutants: survivor 목록(missed.txt)은 줄:열을 빼고 정렬한다', () => {
  const txt = 'crates/core/src/http.rs:254:15: replace += with *= in redact_url\n\ncrates/core/src/a.rs:9:1: replace f -> bool with true\r\n';
  assert.deepEqual(missedList(txt), ['crates/core/src/a.rs: replace f -> bool with true', 'crates/core/src/http.rs: replace += with *= in redact_url']);
  assert.deepEqual(missedList(''), []);
  assert.deepEqual(missedList(undefined), []);
});

test('design: 허용 목록 entries 배열의 길이, 모양이 틀리면 오류', () => {
  assert.equal(allowEntryCount({ entries: [] }), 0);
  assert.equal(allowEntryCount({ entries: [{}, {}, {}] }), 3);
  assert.throws(() => allowEntryCount({}), /entries/);
  assert.throws(() => allowEntryCount([]), /entries/);
});
