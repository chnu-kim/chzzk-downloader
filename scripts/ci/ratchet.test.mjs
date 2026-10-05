// node --test scripts/ci/ratchet.test.mjs — 판정은 순수 함수다(docs/design/cicd.md §4.2)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
import { flatten, judge, loosened, missingLogKeys, tighten } from './ratchet.mjs';

const R = {
  coverage_lines: { rust: 80, frontend: 90, tolerance_pp: 0.1 },
  tests: { rust: 300, vitest: 400, playwright: 0 },
  size: { dist_gz: 1000, binary: { linux: 10000, darwin: 0 }, bundle: { 'linux-deb': 5000 }, tolerance_pct: 3 },
};
const state = (m) => judge(R, m).rows.map((r) => r.state);

test('커버리지: 허용치(0.1pp) 안은 통과, 넘으면 실패', () => {
  assert.deepEqual(state({ 'coverage_lines.rust': 79.95 }), ['ok']);
  assert.deepEqual(state({ 'coverage_lines.rust': 79.9 }), ['ok']);
  assert.deepEqual(state({ 'coverage_lines.rust': 79.89 }), ['fail']);
  assert.deepEqual(state({ 'coverage_lines.rust': 79 }), ['fail'], '−1pp');
  assert.deepEqual(state({ 'coverage_lines.frontend': 95 }), ['ok']);
  assert.equal(judge(R, { 'coverage_lines.rust': 79 }).ok, false);
});

test('테스트 수: 하나라도 줄면 실패', () => {
  assert.deepEqual(state({ 'tests.rust': 300, 'tests.vitest': 401 }), ['ok', 'ok']);
  assert.deepEqual(state({ 'tests.rust': 299 }), ['fail']);
});

test('크기: +3%까지 통과, 넘으면 실패', () => {
  assert.deepEqual(state({ 'size.dist_gz': 1030 }), ['ok']);
  assert.deepEqual(state({ 'size.dist_gz': 1031 }), ['fail']);
  assert.deepEqual(state({ 'size.binary.linux': 10500 }), ['fail'], '+5%');
  assert.deepEqual(state({ 'size.bundle.linux-deb': 4000 }), ['ok']);
});

test('기준 0은 안 잼(통과), 모르는 키·설정 키·잘못된 값은 실패', () => {
  assert.deepEqual(state({ 'size.binary.darwin': 123 }), ['unmeasured']);
  assert.equal(judge(R, { 'size.binary.darwin': 123 }).ok, true);
  assert.deepEqual(state({ 'size.binary.freebsd': 1 }), ['unknown']);
  assert.deepEqual(state({ 'coverage_lines.tolerance_pp': 5 }), ['unknown']);
  assert.deepEqual(state({ 'tests.rust': -1 }), ['fail']);
  assert.deepEqual(state({ 'tests.rust': 'x' }), ['fail']);
  assert.equal(judge(R, { 'nope.x': 1 }).ok, false);
});

test('tighten: 조이기만 한다(커버리지·테스트는 max, 크기는 min, 0은 측정값)', () => {
  const { next, changed } = tighten(R, {
    'coverage_lines.rust': 81,
    'coverage_lines.frontend': 89,
    'tests.rust': 290,
    'size.dist_gz': 900,
    'size.binary.linux': 11000,
    'size.binary.darwin': 777,
  });
  assert.equal(next.coverage_lines.rust, 81);
  assert.equal(next.coverage_lines.frontend, 90);
  assert.equal(next.tests.rust, 300);
  assert.equal(next.size.dist_gz, 900);
  assert.equal(next.size.binary.linux, 10000);
  assert.equal(next.size.binary.darwin, 777);
  assert.deepEqual(changed.map((c) => c.key), ['coverage_lines.rust', 'size.binary.darwin', 'size.dist_gz']);
  assert.equal(R.coverage_lines.rust, 80, '원본은 그대로');
  assert.throws(() => tighten(R, { 'size.binary.freebsd': 1 }), /없는 키/);
  assert.deepEqual(loosened(R, next), [], 'tighten 결과는 느슨하지 않다');
});

test('loosened: 낮추기·키우기·0으로 되돌리기·삭제·허용치 확대', () => {
  const n = structuredClone(R);
  n.coverage_lines.rust = 79;
  n.tests.vitest = 0;
  n.size.dist_gz = 1100;
  delete n.size.bundle['linux-deb'];
  n.size.tolerance_pct = 5;
  n.coverage_lines.frontend = 91; // 조임은 아니다
  n.size.binary.linux = 9000;
  assert.deepEqual(loosened(R, n), ['coverage_lines.rust', 'size.bundle.linux-deb', 'size.dist_gz', 'size.tolerance_pct', 'tests.vitest']);
  // 0(안 잼)에서 값을 넣는 것은 조임
  const m = structuredClone(R);
  m.tests.playwright = 5;
  assert.deepEqual(loosened(R, m), []);
});

test('missingLogKeys: 로그에 더한 줄에 키 이름이 글자 그대로 있어야 한다', () => {
  const added = ['+| 2026-10-05 | `coverage_lines.rust` | 80 → 79 | 이유 |'];
  assert.deepEqual(missingLogKeys(['coverage_lines.rust', 'size.dist_gz'], added), ['size.dist_gz']);
  assert.deepEqual(missingLogKeys(['coverage_lines.rust'], added), []);
});

test('저장소의 ci/ratchet.json: 키가 측정 키와 맞는다', () => {
  const r = JSON.parse(readFileSync(join(ROOT, 'ci/ratchet.json'), 'utf8'));
  const keys = Object.keys(flatten(r)).sort();
  for (const k of ['coverage_lines.rust', 'coverage_lines.frontend', 'tests.rust', 'tests.vitest', 'size.dist_gz', 'size.binary.linux', 'size.binary.darwin', 'size.binary.windows']) {
    assert.ok(keys.includes(k), k);
  }
  const spec = JSON.parse(readFileSync(join(ROOT, 'release/expected-artifacts.json'), 'utf8'));
  for (const os of ['linux', 'darwin', 'windows']) for (const a of spec[os].artifacts) assert.ok(keys.includes(`size.bundle.${a.size}`), a.size);
  assert.equal(typeof r.coverage_lines.tolerance_pp, 'number');
  assert.equal(typeof r.size.tolerance_pct, 'number');
});
