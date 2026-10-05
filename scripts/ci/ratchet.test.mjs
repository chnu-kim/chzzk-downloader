// node --test scripts/ci/ratchet.test.mjs — 판정은 순수 함수다(docs/design/cicd.md §4.2)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
import { coverageFloor, expectedSizeKeys, flatten, judge, lintRatchet, loosened, missingLogKeys, repoFromRemote, runProvenance, tighten } from './ratchet.mjs';

const R = {
  $pending: ['size.binary.darwin', 'tests.playwright'],
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

test('기준 0은 $pending일 때만 안 잼(통과), 아니면 실패. 모르는 키·설정 키·잘못된 값은 실패', () => {
  assert.deepEqual(state({ 'size.binary.darwin': 123 }), ['unmeasured']);
  assert.equal(judge(R, { 'size.binary.darwin': 123 }).ok, true);
  const noPending = { ...structuredClone(R), $pending: [] };
  assert.deepEqual(judge(noPending, { 'size.binary.darwin': 123 }).rows.map((r) => r.state), ['fail']);
  assert.deepEqual(state({ 'size.binary.freebsd': 1 }), ['unknown']);
  assert.deepEqual(state({ 'coverage_lines.tolerance_pp': 5 }), ['unknown']);
  assert.deepEqual(state({ 'tests.rust': -1 }), ['fail']);
  assert.deepEqual(state({ 'tests.rust': 'x' }), ['fail']);
  assert.equal(judge(R, { 'nope.x': 1 }).ok, false);
});

test('size: 이 OS의 기준 키가 측정에 빠지면 실패(번들 표에서 지운 산출물)', () => {
  assert.deepEqual(expectedSizeKeys(R, 'linux'), ['size.binary.linux', 'size.bundle.linux-deb', 'size.dist_gz']);
  assert.deepEqual(expectedSizeKeys(R, 'darwin'), ['size.binary.darwin', 'size.dist_gz']);
  const all = { 'size.dist_gz': 1000, 'size.binary.linux': 10000, 'size.bundle.linux-deb': 5000 };
  assert.equal(judge(R, all, expectedSizeKeys(R, 'linux')).ok, true);
  const { 'size.bundle.linux-deb': _, ...noDeb } = all;
  const j = judge(R, noDeb, expectedSizeKeys(R, 'linux'));
  assert.equal(j.ok, false);
  assert.deepEqual(j.rows.filter((r) => r.state === 'missing').map((r) => r.key), ['size.bundle.linux-deb']);
});

test('tighten: 값 검사(유한·0 이상·커버리지 ≤100·정수), 커버리지는 0.1 단위로 내리고 채운 키는 $pending에서 뺀다', () => {
  assert.throws(() => tighten(R, { 'coverage_lines.rust': 101 }), /100/);
  assert.throws(() => tighten(R, { 'tests.rust': 99999.5 }), /정수/);
  assert.throws(() => tighten(R, { 'size.dist_gz': -1 }), /0 이상/);
  assert.throws(() => tighten(R, { 'tests.rust': '5' }), /0 이상/);
  assert.throws(() => tighten(R, { 'size.tolerance_pct': 1 }), /없는 키/);
  assert.equal(coverageFloor(95.79), 95.7);
  assert.equal(coverageFloor(95.8), 95.8);
  assert.equal(coverageFloor(91.09), 91);
  const { next } = tighten(R, { 'coverage_lines.rust': 81.99, 'size.binary.darwin': 5 });
  assert.equal(next.coverage_lines.rust, 81.9);
  assert.deepEqual(next.$pending, ['tests.playwright']);
  // 같은 커밋의 흔들림(95.8 / 95.79)은 기준을 올리지 않는다
  const a = tighten({ ...R, coverage_lines: { rust: 95.7, frontend: 90, tolerance_pp: 0.1 } }, { 'coverage_lines.rust': 95.79 });
  assert.deepEqual(a.changed, []);
});

test('lintRatchet: 0은 $pending만, $pending은 허용 목록 안이고 값이 0', () => {
  assert.deepEqual(lintRatchet(R, ['size.binary.darwin', 'tests.playwright']), []);
  const z = structuredClone(R);
  z.tests.rust = 0;
  assert.match(lintRatchet(z, ['size.binary.darwin', 'tests.playwright']).join('\n'), /tests\.rust: 기준이 0인데/);
  assert.match(lintRatchet(R, ['tests.playwright']).join('\n'), /size\.binary\.darwin: PENDING_ALLOWED/);
  const f = structuredClone(R);
  f.$pending.push('tests.rust');
  assert.match(lintRatchet(f, ['size.binary.darwin', 'tests.playwright', 'tests.rust']).join('\n'), /값이 300/);
  assert.match(lintRatchet({ ...R, $pending: ['nope.x'] }, ['nope.x']).join('\n'), /없는 키/);
});

test('runProvenance: 이 저장소의 성공한 push·dispatch ci.yml 실행만 기준으로 쓴다', () => {
  const ok = { event: 'workflow_dispatch', conclusion: 'success', path: '.github/workflows/ci.yml', head_repository: { full_name: 'o/r' }, repository: { full_name: 'o/r' } };
  assert.deepEqual(runProvenance(ok, 'o/r'), []);
  assert.deepEqual(runProvenance({ ...ok, event: 'push' }, 'o/r'), []);
  assert.match(runProvenance({ ...ok, event: 'pull_request' }, 'o/r').join(), /event/);
  assert.match(runProvenance({ ...ok, head_repository: { full_name: 'fork/r' } }, 'o/r').join(), /head 저장소/);
  assert.match(runProvenance({ ...ok, conclusion: 'failure' }, 'o/r').join(), /conclusion/);
  assert.match(runProvenance({ ...ok, path: '.github/workflows/x.yml' }, 'o/r').join(), /워크플로/);
  assert.equal(repoFromRemote('https://github.com/chnu-kim/chzzk-downloader.git'), 'chnu-kim/chzzk-downloader');
  assert.equal(repoFromRemote('git@github.com:o/r.git\n'), 'o/r');
  assert.equal(repoFromRemote('https://gitlab.com/o/r'), null);
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

test('저장소의 ci/ratchet.json: 키가 측정 키와 맞고 lint를 통과한다', () => {
  const r = JSON.parse(readFileSync(join(ROOT, 'ci/ratchet.json'), 'utf8'));
  assert.deepEqual(lintRatchet(r), []);
  const keys = Object.keys(flatten(r)).sort();
  for (const os of ['linux', 'darwin', 'windows']) assert.ok(keys.includes(`tests.app.${os}`), os);
  for (const k of ['coverage_lines.rust', 'coverage_lines.frontend', 'tests.rust', 'tests.vitest', 'size.dist_gz', 'size.binary.linux', 'size.binary.darwin', 'size.binary.windows']) {
    assert.ok(keys.includes(k), k);
  }
  const spec = JSON.parse(readFileSync(join(ROOT, 'release/expected-artifacts.json'), 'utf8'));
  // 번들 크기 키 = 번들 표에서 만든 집합(양방향). 표에서 산출물을 지우면 키도 지워야 하고, 지우는 것은 느슨하게 하기라 로그가 필요하다
  const want = ['linux', 'darwin', 'windows'].flatMap((os) => spec[os].artifacts.map((a) => `size.bundle.${a.size}`)).sort();
  assert.deepEqual(keys.filter((k) => k.startsWith('size.bundle.')), want);
  assert.equal(typeof r.coverage_lines.tolerance_pp, 'number');
  assert.equal(typeof r.size.tolerance_pct, 'number');
});
