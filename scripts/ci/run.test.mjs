// node --test scripts/ci/run.test.mjs — 진입점의 순수 함수(changes 분류, ci-ok 판정)와 gate 표
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AREAS, CODE_GATED_JOBS, GATES, HOOK_ONLY, HOOKS, MASTER_ONLY_JOBS, msrv, testFiles } from './gates.mjs';
import { gitOk } from './test-git.mjs';
import { changedFiles, classify, decideCiOk, firstSemver, forceFail, hookGates, runGate } from './run.mjs';

const T = { app: true, worker: true };
const F = { app: false, worker: false };
const WORKER_ONLY = { app: false, worker: true };
const APP_ONLY = { app: true, worker: false };

test('classify: 영역 표(AREA_SKIP)', () => {
  const table = [
    [['docs/design/cicd.md', 'README.md', 'CLAUDE.md', '.claude/x.json', 'LICENSE'], F],
    [['scripts/ci/worker-config.test.mjs'], F],
    [['worker/src/index.ts'], WORKER_ONLY],
    [['worker/test/deploy-contract.mjs'], WORKER_ONLY],
    [['worker/pnpm-lock.yaml'], WORKER_ONLY],
    [['scripts/ci/worker-config.mjs'], WORKER_ONLY],
    // #29 유형: worker/ + worker-config + 그 테스트 + 문서
    [['worker/src/a.ts', 'scripts/ci/worker-config.mjs', 'scripts/ci/worker-config.test.mjs', 'docs/design/worker.md'], WORKER_ONLY],
    ...[
      'worker/wrangler.jsonc', 'scripts/ci/worker-deploy.mjs', 'xtask/testdata/semver-vectors.json', 'app/package.json',
      'app/src-tauri/tauri.conf.json', 'release/expected-artifacts.json', 'scripts/ci/tools.json', 'scripts/ci/run.mjs',
      'scripts/ci/gates.mjs', 'ci/ratchet.json', '.github/workflows/ci.yml', '.gitattributes', 'something-new',
      // 공유 KAT: worker vitest와 Rust 테스트(include_str!)가 함께 읽는다
      'worker/test/vectors/loopback-vectors.json', 'worker/test/vectors/new.json',
    ].map((f) => [[f], T]),
    ...[
      'crates/core/src/lib.rs', 'app/src/App.svelte', 'app/src-tauri/src/lib.rs', 'xtask/src/main.rs', 'testdata/hls/media.m3u8',
      'Cargo.lock', 'deny.toml', 'rust-toolchain.toml', '.cargo/config.toml', 'testdata/README.md',
      // fuzz/는 app: supply의 cargo machete가 루트 exclude와 상관없이 fuzz/Cargo.toml과 target 소스를 본다
      'fuzz/Cargo.toml', 'fuzz/Cargo.lock', 'fuzz/fuzz_targets/url.rs',
    ].map((f) => [[f], APP_ONLY]),
    [['docs/x.md', 'worker/src/a.ts', 'crates/core/src/lib.rs'], T],
    [null, T],
    [[], T],
  ];
  for (const [files, want] of table) assert.deepEqual(classify(files), want, String(files));
});

test('classify: 출력 키는 AREAS이고 모든 영역에 건너뛰는 작업이 있다(죽은 출력 금지)', () => {
  assert.deepEqual(Object.keys(classify(['x'])), AREAS);
  for (const a of AREAS) assert.ok(Object.values(CODE_GATED_JOBS).includes(a), a);
});

test('changedFiles: --no-renames라 이름 바꾸기도 옛 경로와 새 경로를 둘 다 낸다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'area-rename-'));
  try {
    gitOk(dir, ['init', '-q']);
    mkdirSync(join(dir, 'crates'));
    writeFileSync(join(dir, 'crates/a.rs'), 'fn main() {}\n'.repeat(20));
    gitOk(dir, ['add', '-A']);
    gitOk(dir, ['commit', '-q', '-m', 'base']);
    const base = gitOk(dir, ['rev-parse', 'HEAD']);
    mkdirSync(join(dir, 'worker'));
    gitOk(dir, ['mv', 'crates/a.rs', 'worker/a.rs']);
    gitOk(dir, ['commit', '-q', '-m', 'move']);
    const head = gitOk(dir, ['rev-parse', 'HEAD']);
    const { files } = changedFiles({ CHANGES_BASE: base, CHANGES_HEAD: head }, dir);
    assert.deepEqual([...files].sort(), ['crates/a.rs', 'worker/a.rs']);
    assert.deepEqual(classify(files), T);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ok = { result: 'success', outputs: {} };
const changes = (app, worker = app, result = 'success') => ({ result, outputs: { app: String(app), worker: String(worker) } });
const PR = 'pull_request';

test('ci-ok: 모두 success면 통과', () => {
  assert.equal(decideCiOk({ changes: changes(true), lint: ok, rust: ok }, PR).ok, true);
});

test('ci-ok: failure·cancelled는 실패', () => {
  assert.equal(decideCiOk({ changes: changes(true), lint: ok, rust: { result: 'failure' } }, PR).ok, false);
  assert.equal(decideCiOk({ changes: changes(true), lint: { result: 'cancelled' } }, PR).ok, false);
});

test('ci-ok: skipped는 그 작업의 영역 출력이 false일 때만 허용', () => {
  for (const [job, a] of Object.entries(CODE_GATED_JOBS)) {
    const other = AREAS.find((x) => x !== a);
    const skipped = { lint: ok, [job]: { result: 'skipped' } };
    const only = (area, v) => ({ result: 'success', outputs: Object.fromEntries(AREAS.map((x) => [x, String(x === area ? v : !v)])) });
    assert.equal(decideCiOk({ changes: only(a, false), ...skipped }, PR).ok, true, job);
    assert.equal(decideCiOk({ changes: only(a, true), ...skipped }, PR).ok, false, job);
    assert.equal(decideCiOk({ changes: only(other, false), ...skipped }, PR).ok, false, `${job}: 다른 영역만 false`);
    assert.equal(decideCiOk({ changes: { result: 'success', outputs: {} }, ...skipped }, PR).ok, false, `${job}: 출력 없음`);
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

test('ci-ok: MASTER_ONLY_JOBS의 skipped는 pull_request에서만 허용', () => {
  for (const job of MASTER_ONLY_JOBS) {
    assert.equal(decideCiOk({ changes: changes(true), lint: ok, [job]: { result: 'skipped' } }, PR).ok, true, job);
    assert.equal(decideCiOk({ changes: changes(false), lint: ok, [job]: { result: 'skipped' } }, PR).ok, true, job);
    for (const ev of ['push', 'workflow_dispatch']) {
      assert.equal(decideCiOk({ changes: changes(true), lint: ok, [job]: { result: 'skipped' } }, ev).ok, false, `${job} ${ev}`);
    }
  }
  assert.equal(decideCiOk({ changes: changes(true), lint: ok, bundle: { result: 'failure' } }, PR).ok, false);
  // 겹치지 않는다(같은 작업이 두 규칙에 걸리면 판정이 모호하다)
  assert.deepEqual(Object.keys(CODE_GATED_JOBS).filter((j) => MASTER_ONLY_JOBS.includes(j)), []);
});

test('ci-ok: force_fail이면 모두 success여도 실패', () => {
  assert.equal(decideCiOk({ changes: changes(true), lint: ok }, 'workflow_dispatch', CODE_GATED_JOBS, MASTER_ONLY_JOBS, { force: true }).ok, false);
  assert.equal(forceFail({ CI_FORCE_FAIL: 'true' }), true);
  assert.equal(forceFail({ CI_FORCE_FAIL: 'false' }), false);
  assert.equal(forceFail({ CI_FORCE_FAIL: '' }), false);
});

test('ci-ok: changes가 실패·skipped·없으면 실패', () => {
  assert.equal(decideCiOk({ changes: changes(false, false, 'failure'), rust: { result: 'skipped' } }, PR).ok, false);
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
  // chzzk-app clippy는 tauri-clippy(보통·e2e 둘 다 -D warnings), debug 빌드는 tauri-build(구현 중 변경 78)
  assert.deepEqual(cmds('tauri-clippy').filter((c) => c.startsWith('cargo clippy')), [
    'cargo clippy -p chzzk-app --all-targets --locked -- -D warnings',
    'cargo clippy -p chzzk-app --features e2e --all-targets --locked -- -D warnings',
  ]);
  assert.equal(cmds('tauri-build').at(-1), 'pnpm tauri build --ci --debug --no-bundle');
  assert.ok(cmds('frontend').includes('pnpm install --frozen-lockfile'));
  assert.deepEqual(cmds('deny'), ['cargo deny --locked check bans licenses sources']);
  assert.deepEqual(cmds('scan-msg'), ['node scripts/ci/public-scan.mjs --message-file', 'node scripts/ci/commit-msg.mjs']);
  assert.deepEqual(cmds('scan-range'), ['node scripts/ci/public-scan.mjs --rev-range']);
  assert.deepEqual(cmds('push-guard'), ['node scripts/ci/push-guard.mjs']);
  assert.equal(GATES['push-guard'].stdin, true);
  assert.deepEqual(cmds('subjects'), ['node scripts/ci/commit-msg.mjs --stored']);
  for (const g of ['scan-msg', 'scan-range', 'push-guard', 'versions', 'subjects']) assert.equal(GATES[g].passArgs, true, g);
  assert.deepEqual(cmds('smoke-bin'), ['node scripts/ci/smoke.mjs bin']);
  assert.deepEqual(cmds('smoke-install'), ['node scripts/ci/smoke.mjs install']);
  assert.ok(cmds('bundle')[1].startsWith('pnpm tauri build --ci --no-sign --bundles '), cmds('bundle')[1]);
  assert.equal(cmds('bundle')[2], 'node scripts/ci/bundle.mjs collect');
  assert.deepEqual(cmds('glibc-floor'), ['node scripts/ci/artifact-check.mjs glibc']);
  assert.deepEqual(cmds('release-hygiene'), ['node scripts/ci/artifact-check.mjs hygiene']);
  assert.deepEqual(cmds('size'), ['node scripts/ci/measure.mjs size', 'node scripts/ci/ratchet.mjs check size']);
  assert.deepEqual(cmds('coverage').slice(1), ['node scripts/ci/measure.mjs coverage', 'node scripts/ci/ratchet.mjs check coverage']);
  assert.deepEqual(cmds('test-count').slice(1), ['node scripts/ci/measure.mjs tests', 'node scripts/ci/ratchet.mjs check tests']);
  assert.deepEqual(cmds('ratchet-log'), ['node scripts/ci/ratchet.mjs lint', 'node scripts/ci/ratchet.mjs log-check']);
  assert.deepEqual(cmds('test-count-app'), ['node scripts/ci/measure.mjs tests-app', 'node scripts/ci/ratchet.mjs check tests']);
  // 디자인 gate 넷(governance.md §2.1): --check가 빠지면 생성물을 다시 써 버려 손 수정이 조용히 통과한다
  assert.deepEqual(cmds('design-tokens'), ['node scripts/design/tokens.mjs --check', 'node scripts/design/check-tokens.mjs']);
  assert.deepEqual(cmds('design-lint'), ['node scripts/design/lint.mjs', 'node scripts/ci/measure.mjs design', 'node scripts/ci/ratchet.mjs check design']);
  assert.deepEqual(cmds('design-copy'), ['node scripts/design/copy.mjs']);
  assert.deepEqual(cmds('design-icons'), ['node scripts/design/icons.mjs']);
  // 로컬과 CI가 같은 표를 쓰므로 CI 전용은 --all-history를 도는 둘뿐이다(로컬 클론에는 비공개 ref가 있어 늘 걸린다)
  assert.deepEqual(cmds('private-scan'), ['node scripts/ci/private-scan.mjs']);
  assert.deepEqual(Object.keys(GATES).filter((g) => GATES[g].ciOnly), ['scan-history', 'private-scan']);
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
  assert.deepEqual(hookGates('pre-commit', ['design/tokens/sys.tokens.json']), ['typos', 'design-tokens']);
  assert.deepEqual(hookGates('pre-commit', ['docs/design/system/foundations.md']), ['typos', 'design-tokens']);
  assert.deepEqual(hookGates('pre-commit', ['docs/design/system/content.md']), ['typos', 'design-copy']);
  assert.deepEqual(hookGates('pre-commit', ['app/src/lib/components/ui/icons.ts']), ['typos', 'design-lint', 'design-icons']);
  assert.deepEqual(hookGates('pre-commit', ['scripts/design/allow.json']), ['typos', 'design-tokens', 'design-lint', 'design-copy', 'design-icons']);
  assert.deepEqual(hookGates('pre-commit', ['app/src-tauri/src/lib.rs']), ['fmt', 'typos']);
  assert.deepEqual(hookGates('pre-commit', ['docs/x.md']), ['typos']);
  assert.deepEqual(hookGates('pre-commit', ['crates/core/src/lib.rs']), ['fmt', 'typos']);
  assert.deepEqual(hookGates('pre-commit', ['.github/workflows/ci.yml']), ['typos', 'workflows', 'parity']);
  assert.deepEqual(hookGates('pre-commit', ['app/package.json']), ['typos', 'versions']);
  assert.deepEqual(hookGates('pre-commit', ['crates/core/Cargo.toml']), ['typos', 'versions']);
  assert.deepEqual(hookGates('pre-commit', ['testdata/hls/a.m3u8']), ['typos', 'fixtures']);
  assert.deepEqual(hookGates('pre-commit', []), []);
  assert.deepEqual(hookGates('pre-push', ['docs/x.md']), []);
  assert.deepEqual(hookGates('pre-push', ['crates/core/src/lib.rs']), ['rust', 'fuzz-lock']);
  assert.deepEqual(hookGates('pre-push', ['app/src/App.svelte']), ['frontend']);
  assert.deepEqual(hookGates('pre-push', ['app/src-tauri/src/lib.rs']), []);
  // run.mjs는 release.mjs의 import 그래프에 있다(release-selftest도 돈다)
  assert.deepEqual(hookGates('pre-push', ['scripts/ci/run.mjs']), ['release-selftest', 'scripts-test']);
  assert.deepEqual(hookGates('pre-push', ['scripts/ci/issue.mjs']), ['scripts-test']);
  assert.deepEqual(hookGates('pre-push', ['Cargo.lock']), ['rust', 'release-selftest', 'deny', 'fuzz-lock']);
  assert.deepEqual(hookGates('pre-push', ['xtask/src/s3.rs']), ['rust', 'release-selftest']);
  assert.deepEqual(hookGates('pre-push', ['scripts/ci/release.mjs']), ['release-selftest', 'scripts-test']);
  assert.deepEqual(hookGates('pre-commit', ['release/updater.pub']), ['typos', 'pubkey']);
  assert.deepEqual(hookGates('pre-commit', ['release/tauri.release.json']), ['typos', 'pubkey']);
  assert.deepEqual(hookGates('pre-commit', ['app/src-tauri/tauri.conf.json']), ['typos', 'versions', 'pubkey']);
  // 앱 이름(productName)은 랜딩 xattr 경로의 원천이라 pre-push worker gate를 돈다
  assert.ok(hookGates('pre-push', ['app/src-tauri/tauri.conf.json']).includes('worker'));
  assert.deepEqual(hookGates('pre-push', ['fuzz/fuzz_targets/url.rs']), ['fuzz-lock']);
  // 훅·.gitattributes만 바뀌어도 parity(인덱스 모드 100755 등)를 본다
  assert.deepEqual(hookGates('pre-push', ['.githooks/pre-push']), ['scripts-test']);
  assert.deepEqual(hookGates('pre-push', ['.gitattributes']), ['scripts-test']);
  // release.test.mjs가 import하는 배포 뒤 검사 계약 표는 worker와 scripts-test 둘 다
  assert.deepEqual(hookGates('pre-push', ['worker/test/deploy-contract.mjs']), ['worker', 'scripts-test']);
  assert.deepEqual(hookGates('pre-commit', ['.githooks/pre-push']), ['typos', 'parity']);
  assert.deepEqual(hookGates('pre-commit', ['scripts/ci/gates.mjs']), ['typos', 'parity']);
});

// worker gate는 pnpm install이 필요해 selftest가 씨앗으로 돌리지 못한다. 그래서 단계 순서·인자를 여기서 고정한다
// (worker-config를 빼거나 --dist·--frozen-lockfile을 지우면 worker-config.test.mjs의 씨앗이 통과해도 gate가 그것을 부르지 않는다)
test('gate 표: worker(worker.md §13.2, cicd.md 85)', () => {
  const w = GATES.worker;
  assert.deepEqual(w.needs, ['pnpm']);
  assert.deepEqual(
    w.steps.map((s) => [s.cmd.join(' '), s.cwd ?? '.']),
    [
      // 불변식이 설치보다 먼저(allowBuilds를 넓힌 변경이 설치 스크립트를 돌리기 전에 멈춘다, cicd.md 86)
      ['node scripts/ci/worker-config.mjs', '.'],
      ['pnpm install --frozen-lockfile', 'worker'],
      // 배포용 wrangler의 따로인 lockfile(worker-bundle과 같은 인자)
      ['pnpm install --frozen-lockfile --ignore-scripts', 'worker/deploy'],
      // (CI) 누출 씨앗은 wrangler types·vitest를 감싼다
      ['node scripts/ci/worker-config.mjs --sentinel plant', '.'],
      ['pnpm check', 'worker'],
      ['node scripts/ci/measure.mjs tests-worker', '.'],
      ['node scripts/ci/worker-config.mjs --sentinel check', '.'],
      ['pnpm build', 'worker'],
      ['node scripts/ci/worker-config.mjs --dist', '.'],
      ['node scripts/ci/ratchet.mjs check tests', '.'],
    ],
  );
  // wrangler·vitest를 부르는 단계는 사용 통계를 끈다
  for (const s of w.steps.filter((s) => s.cmd[0] === 'pnpm' || s.cmd.includes('tests-worker'))) assert.equal(s.env?.WRANGLER_SEND_METRICS, 'false', s.cmd.join(' '));
  assert.equal(CODE_GATED_JOBS.worker, 'worker');
  assert.ok(GATES.advisories.steps.some((s) => s.cmd.join(' ') === 'pnpm audit --audit-level high' && s.cwd === 'worker'));
  // 배포용 wrangler(worker/deploy)도 따로인 lockfile이라 같이 본다(cicd.md 구현 중 변경 96)
  assert.ok(GATES.advisories.steps.some((s) => s.cmd.join(' ') === 'pnpm audit --audit-level high' && s.cwd === 'worker/deploy'));
  const hook = HOOKS['pre-push'].when.find((x) => x.gate === 'worker');
  assert.ok(hook, 'pre-push에 worker');
  assert.equal(HOOKS['pre-commit'].when.some((x) => x.gate === 'worker'), false, 'pre-commit에는 넣지 않는다(무겁다)');
  assert.deepEqual(hookGates('pre-push', ['worker/src/config.ts']), ['worker']);
  // selftest(w-dry)가 원본 wrangler.jsonc에서 배포 설정을 만들어 묶음과 맞춰 본다
  assert.deepEqual(hookGates('pre-push', ['worker/wrangler.jsonc']), ['release-selftest', 'worker']);
  // release.mjs는 worker-deploy만 import한다(cicd.md 구현 중 변경 110). worker-config는 worker gate와 scripts-test만
  assert.deepEqual(hookGates('pre-push', ['scripts/ci/worker-config.mjs']), ['worker', 'scripts-test']);
  assert.deepEqual(hookGates('pre-push', ['scripts/ci/worker-deploy.mjs']), ['release-selftest', 'worker', 'scripts-test']);
  assert.deepEqual(hookGates('pre-push', ['scripts/ci/worker-config.test.mjs']), ['scripts-test']);
  assert.deepEqual(hookGates('pre-push', ['app/package.json']), ['frontend', 'worker']);
  assert.ok(hookGates('pre-push', ['release/expected-artifacts.json']).includes('worker'));
  assert.ok(hookGates('pre-push', ['release/latest.schema.json']).includes('worker'));
  assert.equal(hookGates('pre-push', ['release/updater.pub']).includes('worker'), false);
});

// 릴리스의 Worker·보존 상한 gate(release.yml worker-bundle·deploy-worker·prune이 부른다): 진입점 인자를 고정한다
test('gate 표: release-worker-bundle·release-worker·release-prune(W8)', () => {
  assert.deepEqual(GATES['release-worker-bundle'].needs, ['pnpm']);
  const cmd = (g) => GATES[g].steps.map((s) => s.cmd.join(' '));
  assert.deepEqual(cmd('release-worker-bundle'), ['node scripts/ci/release.mjs worker-bundle']);
  assert.deepEqual(cmd('release-worker'), ['node scripts/ci/release.mjs worker']);
  assert.deepEqual(cmd('release-prune'), ['node scripts/ci/release.mjs prune']);
});

test('runGate: 인자를 받지 않는 gate에 인자를 주면 2', () => {
  assert.equal(runGate('parity', ['--x'], { ...process.env, CI: '' }), 2);
});

test('OBSERVED_JOBS(D14 관찰 작업)는 ci-ok 규칙의 작업 목록과 겹치지 않고 종류는 영역·master뿐이다', async () => {
  const { OBSERVED_JOBS } = await import('./gates.mjs');
  for (const [id, kind] of Object.entries(OBSERVED_JOBS)) {
    assert.ok([...AREAS, 'master'].includes(kind), id);
    assert.ok(!Object.hasOwn(CODE_GATED_JOBS, id) && !MASTER_ONLY_JOBS.includes(id), id);
  }
  for (const a of Object.values(CODE_GATED_JOBS)) assert.ok(AREAS.includes(a), a);
});

test('gate platforms: 다른 OS에서는 로컬은 건너뛰고(0) CI는 실패(2)', async () => {
  const { GATES: G } = await import('./gates.mjs');
  const other = process.platform === 'linux' ? 'win32' : 'linux';
  G['__platform_probe'] = { desc: 'test', platforms: [other], steps: [{ cmd: ['node', '-e', 'process.exit(7)'] }] };
  try {
    assert.equal(runGate('__platform_probe', [], { ...process.env, CI: '' }), 0);
    assert.equal(runGate('__platform_probe', [], { ...process.env, CI: 'true' }), 2);
    G['__platform_probe'].platforms = [process.platform];
    assert.equal(runGate('__platform_probe', [], { ...process.env, CI: '' }), 7);
  } finally {
    delete G['__platform_probe'];
  }
});

// nightly.yml pull_request paths-ignore(NON_CODE_GLOBS)와 classify(NON_CODE)가 같은 경로를 코드가 아니라고 본다.
// GitHub 필터 glob: `*`는 `/`를 넘지 않고 `**`는 넘는다(대소문자 구별).
test('NON_CODE_GLOBS와 NON_CODE 정규식이 같은 경로를 고른다', async () => {
  const { NON_CODE, NON_CODE_GLOBS } = await import('./gates.mjs');
  const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
  const byGlob = (f) => NON_CODE_GLOBS.some((g) => globRe(g).test(f));
  const byRe = (f) => NON_CODE.some((re) => re.test(f));
  const samples = [
    'docs/design/cicd.md', 'docs/a/b/c.png', 'README.md', 'CLAUDE.md', 'README.MD', 'x.md', '.claude/settings.json', 'LICENSE', 'LICENSE.txt', 'LICENSEX',
    'license', 'ci/RATCHET_LOG.md', 'testdata/README.md', 'app/src/App.svelte', 'app/src-tauri/src/lib.rs', 'Cargo.lock', 'scripts/ci/e2e-native.mjs',
    'docsx/a', '.github/workflows/nightly.yml', 'testdata/hls/x.m4s',
  ];
  for (const f of samples) assert.equal(byGlob(f), byRe(f), f);
});
