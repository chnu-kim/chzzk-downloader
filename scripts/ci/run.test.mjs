// node --test scripts/ci/run.test.mjs — 진입점의 순수 함수(changes 분류, ci-ok 판정)와 gate 표
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CODE_GATED_JOBS, GATES, HOOK_ONLY, HOOKS, msrv, testFiles } from './gates.mjs';
import { classify, decideCiOk, firstSemver, hookGates, runGate } from './run.mjs';

test('classify: 문서만 바뀌면 code=false', () => {
  assert.deepEqual(classify(['docs/design/cicd.md', 'README.md', 'CLAUDE.md', '.claude/x.json', 'LICENSE']), {
    code: false,
    release: false,
    docs_only: true,
  });
});

test('classify: 루트 밖의 .md는 코드다(테스트가 읽는 fixture일 수 있다)', () => {
  for (const f of ['testdata/README.md', 'crates/core/README.md', 'app/README.md', 'scripts/x.md', '.github/x.md']) {
    assert.equal(classify([f]).code, true, f);
  }
});

test('classify: 코드·설정·모르는 경로는 code=true', () => {
  for (const f of [
    'crates/core/src/lib.rs',
    'app/src/App.svelte',
    'Cargo.lock',
    '.github/workflows/ci.yml',
    'scripts/ci/run.mjs',
    'testdata/hls/media.m3u8',
    'rust-toolchain.toml',
    'deny.toml',
    '.gitattributes',
    'something-new',
  ]) {
    assert.equal(classify(['docs/x.md', f]).code, true, f);
  }
});

test('classify: 목록이 없거나 비면 전부 실행(fail-safe)', () => {
  assert.deepEqual(classify(null), { code: true, release: true, docs_only: false });
  assert.deepEqual(classify([]), { code: true, release: true, docs_only: false });
});

test('classify: release 경로', () => {
  assert.equal(classify(['xtask/src/main.rs']).release, true);
  assert.equal(classify(['release/updater.pub']).release, true);
  assert.equal(classify(['.github/workflows/release.yml']).release, true);
  assert.equal(classify(['crates/core/src/lib.rs']).release, false);
});

const ok = { result: 'success', outputs: {} };
const changes = (code, result = 'success') => ({ result, outputs: { code: String(code) } });
const PR = 'pull_request';

test('ci-ok: 모두 success면 통과', () => {
  assert.equal(decideCiOk({ changes: changes(true), lint: ok, rust: ok }, PR).ok, true);
});

test('ci-ok: failure·cancelled는 실패', () => {
  assert.equal(decideCiOk({ changes: changes(true), lint: ok, rust: { result: 'failure' } }, PR).ok, false);
  assert.equal(decideCiOk({ changes: changes(true), lint: { result: 'cancelled' } }, PR).ok, false);
});

test('ci-ok: skipped는 code=false일 때 무거운 작업만 허용', () => {
  for (const job of CODE_GATED_JOBS) {
    assert.equal(decideCiOk({ changes: changes(false), lint: ok, [job]: { result: 'skipped' } }, PR).ok, true, job);
    assert.equal(decideCiOk({ changes: changes(true), lint: ok, [job]: { result: 'skipped' } }, PR).ok, false, job);
  }
  assert.equal(decideCiOk({ changes: changes(false), lint: { result: 'skipped' } }, PR).ok, false);
  assert.equal(decideCiOk({ changes: changes(false), 'scripts-windows': { result: 'skipped' } }, PR).ok, false);
});

test('ci-ok: push·dispatch는 skipped를 허용하지 않는다', () => {
  for (const ev of ['push', 'workflow_dispatch', 'schedule']) {
    assert.equal(decideCiOk({ changes: changes(false), lint: ok, rust: { result: 'skipped' } }, ev).ok, false, ev);
    assert.equal(decideCiOk({ changes: changes(true), lint: ok, rust: ok }, ev).ok, true, ev);
  }
  assert.equal(decideCiOk({ changes: changes(true), lint: ok }, undefined).ok, false);
});

test('ci-ok: changes가 실패·skipped·없으면 실패', () => {
  assert.equal(decideCiOk({ changes: changes(false, 'failure'), rust: { result: 'skipped' } }, PR).ok, false);
  assert.equal(decideCiOk({ changes: { result: 'skipped' } }, PR).ok, false);
  assert.equal(decideCiOk({ lint: ok }, PR).ok, false);
});

test('firstSemver', () => {
  assert.equal(firstSemver('typos-cli 1.50.3'), '1.50.3');
  assert.equal(firstSemver('1.7.12\ninstalled by go'), '1.7.12');
  assert.equal(firstSemver('none'), null);
});

test('gate 표: 모든 단계가 명령을 갖고 scripts-test가 테스트 파일을 찾는다', () => {
  for (const [name, g] of Object.entries(GATES)) {
    assert.ok(g.steps.length > 0, name);
    for (const s of g.steps) assert.ok(Array.isArray(s.cmd) && s.cmd.length > 0, name);
  }
  assert.ok(testFiles().includes('scripts/ci/run.test.mjs'));
  assert.ok(testFiles().includes('scripts/ci/public-scan.test.mjs'));
  assert.match(msrv(), /^\d+\.\d+(\.\d+)?$/);
});

// 각 gate가 검사를 실제로 켜는 인자를 갖는지(빼면 gate가 조용히 통과한다). selftest가 씨앗으로 동작을 보고,
// 여기서는 씨앗으로 드러나지 않는 플래그를 본다.
test('gate 표: 검사를 켜는 플래그', () => {
  const cmds = (g) => GATES[g].steps.map((s) => s.cmd.join(' '));
  assert.deepEqual(cmds('fmt'), ['cargo fmt --all --check']);
  assert.deepEqual(cmds('workflows'), [
    'node scripts/ci/pin-check.mjs',
    'actionlint',
    'zizmor --offline --pedantic --config zizmor.yml .',
  ]);
  assert.deepEqual(cmds('scan'), ['node scripts/ci/public-scan.mjs']);
  assert.deepEqual(cmds('scan-staged'), ['node scripts/ci/public-scan.mjs --staged']);
  assert.deepEqual(cmds('scan-history'), ['node scripts/ci/public-scan.mjs --all-history']);
  assert.equal(GATES['scan-history'].ciOnly, true);
  assert.deepEqual(cmds('fixtures'), ['node scripts/fixtures/gen-fixtures.mjs --check']);
  for (const g of ['rust', 'tauri']) {
    for (const c of cmds(g).filter((c) => c.startsWith('cargo clippy'))) assert.ok(c.endsWith('--locked -- -D warnings'), c);
    assert.ok(cmds(g).some((c) => c.startsWith('cargo test') && c.endsWith('--locked')), g);
  }
  assert.ok(cmds('frontend').includes('pnpm install --frozen-lockfile'));
  assert.deepEqual(cmds('deny'), ['cargo deny --locked check bans licenses sources']);
  assert.deepEqual(cmds('scan-msg'), ['node scripts/ci/public-scan.mjs --message-file', 'node scripts/ci/commit-msg.mjs']);
  assert.deepEqual(cmds('scan-range'), ['node scripts/ci/public-scan.mjs --rev-range']);
  assert.deepEqual(cmds('push-guard'), ['node scripts/ci/push-guard.mjs']);
  assert.equal(GATES['push-guard'].stdin, true);
  assert.deepEqual(cmds('subjects'), ['node scripts/ci/commit-msg.mjs --stored']);
  for (const g of ['scan-msg', 'scan-range', 'push-guard', 'versions', 'subjects']) assert.equal(GATES[g].passArgs, true, g);
  // 로컬과 CI가 같은 표를 쓰므로 CI 전용은 scan-history 하나뿐이다
  assert.deepEqual(Object.keys(GATES).filter((g) => GATES[g].ciOnly), ['scan-history']);
});

test('훅 표: 끌 수 없는 gate와 조건부 gate', () => {
  assert.deepEqual(HOOKS['pre-commit'].always, ['scan-staged']);
  assert.deepEqual(HOOKS['commit-msg'].always, ['scan-msg']);
  assert.deepEqual(HOOKS['pre-push'].always, ['push-guard', 'scan-range']);
  assert.equal(HOOKS['pre-commit'].fastSkip, undefined, 'CHZZK_HOOK_FAST는 pre-push의 조건부 gate만 끈다');
  for (const [g, pairs] of Object.entries(HOOK_ONLY)) {
    assert.ok(Object.hasOwn(GATES, g) && Array.isArray(pairs) && pairs.length > 0, g);
    for (const c of pairs) assert.ok(Object.hasOwn(GATES, c), `${g} → ${c}`);
  }
  assert.deepEqual(HOOK_ONLY['scan-msg'], ['scan-history', 'subjects'], '메시지 누출과 제목 형식 모두 CI 짝이 있다');
});

test('hookGates: 바뀐 경로로 조건부 gate를 고른다', () => {
  assert.deepEqual(hookGates('pre-commit', ['docs/x.md']), ['typos']);
  assert.deepEqual(hookGates('pre-commit', ['crates/core/src/lib.rs']), ['fmt', 'typos']);
  assert.deepEqual(hookGates('pre-commit', ['.github/workflows/ci.yml']), ['typos', 'workflows', 'parity']);
  assert.deepEqual(hookGates('pre-commit', ['app/package.json']), ['typos', 'versions']);
  assert.deepEqual(hookGates('pre-commit', ['crates/core/Cargo.toml']), ['typos', 'versions']);
  assert.deepEqual(hookGates('pre-commit', ['testdata/hls/a.m3u8']), ['typos', 'fixtures']);
  assert.deepEqual(hookGates('pre-commit', []), []);
  assert.deepEqual(hookGates('pre-push', ['docs/x.md']), []);
  assert.deepEqual(hookGates('pre-push', ['crates/core/src/lib.rs']), ['rust']);
  assert.deepEqual(hookGates('pre-push', ['app/src/App.svelte']), ['frontend']);
  assert.deepEqual(hookGates('pre-push', ['app/src-tauri/src/lib.rs']), []);
  assert.deepEqual(hookGates('pre-push', ['scripts/ci/run.mjs']), ['scripts-test']);
  assert.deepEqual(hookGates('pre-push', ['Cargo.lock']), ['rust', 'deny']);
  // 훅·.gitattributes만 바뀌어도 parity(인덱스 모드 100755 등)를 본다
  assert.deepEqual(hookGates('pre-push', ['.githooks/pre-push']), ['scripts-test']);
  assert.deepEqual(hookGates('pre-push', ['.gitattributes']), ['scripts-test']);
  assert.deepEqual(hookGates('pre-commit', ['.githooks/pre-push']), ['typos', 'parity']);
  assert.deepEqual(hookGates('pre-commit', ['scripts/ci/gates.mjs']), ['typos', 'parity']);
});

test('runGate: 인자를 받지 않는 gate에 인자를 주면 2', () => {
  assert.equal(runGate('parity', ['--x'], { ...process.env, CI: '' }), 2);
});
