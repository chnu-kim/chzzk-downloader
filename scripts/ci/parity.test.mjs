// node --test scripts/ci/parity.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { HOOKS, NON_CODE_GLOBS, ROOT } from './gates.mjs';
import { checkParity, ENTRY, parseJobs, runCommands, toolInputs } from './parity.mjs';

test('저장소는 parity를 지킨다', () => {
  assert.deepEqual(checkParity(ROOT), []);
});

test('ci.yml의 run:을 모두 읽는다(파서가 비어 통과하지 않는다)', () => {
  const cmds = runCommands(readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')).map((c) => c.cmd);
  for (const g of ['changes', 'scan', 'fmt', 'workflows', 'rust', 'frontend', 'tauri', 'ci-ok']) {
    assert.ok(cmds.includes(`node scripts/ci/run.mjs ${g}`), g);
  }
  assert.ok(cmds.some((c) => c.startsWith('sudo apt-get install -y --no-install-recommends libwebkit2gtk-4.1-dev')));
});

test('runCommands: 한 줄·블록·줄 잇기·주석', () => {
  const t = `steps:
  - run: echo one
  - name: two
    run: |
      # 주석
      a \\
        b
      c
  - run: >-
      d
  - uses: x
`;
  assert.deepEqual(
    runCommands(t).map((c) => c.cmd),
    ['echo one', 'a b', 'c', 'd'],
  );
});

test('toolInputs', () => {
  assert.deepEqual(toolInputs('      tool: a@1.0.0, cargo-b@2.3.4\n'), [
    { line: 1, name: 'a', version: '1.0.0' },
    { line: 1, name: 'cargo-b', version: '2.3.4' },
  ]);
});

// 저장소 ci.yml을 한 군데 바꾼 사본에 parity를 돌려 위반 규칙 목록을 돌려준다.
// hooks: { 이름: 본문 | null(지움) } — 저장소 .githooks/ 사본을 덮어쓴다(사본은 git 저장소가 아니라 모드 검사는 빠진다).
const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
function rulesFor(mutate, hooks = {}) {
  const d = mkdtempSync(join(tmpdir(), 'parity-'));
  try {
    mkdirSync(join(d, '.github/workflows'), { recursive: true });
    mkdirSync(join(d, 'scripts/ci'), { recursive: true });
    cpSync(join(ROOT, 'scripts/ci/tools.json'), join(d, 'scripts/ci/tools.json'));
    cpSync(join(ROOT, '.githooks'), join(d, '.githooks'), { recursive: true });
    const text = mutate(CI);
    assert.notEqual(text, CI, '변형이 적용되지 않았다');
    writeFileSync(join(d, '.github/workflows/ci.yml'), text);
    for (const [h, body] of Object.entries(hooks)) {
      if (body === null) rmSync(join(d, '.githooks', h));
      else writeFileSync(join(d, '.githooks', h), body);
    }
    return checkParity(d).map((v) => v.rule);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
const once = (from, to) => (t) => t.replace(from, to);

test('변형하지 않은 사본은 깨끗하다', () => {
  assert.deepEqual(rulesFor((t) => t + '\n'), []);
});

test('run-entry: gate 뒤 셸 꼬리는 거부한다', () => {
  for (const tail of [' || true', '; exit 0', ' && true', ' | cat', ' > /dev/null', ' $(x)', ' `x`', ' &']) {
    assert.ok(rulesFor(once('run: node scripts/ci/run.mjs rust', `run: node scripts/ci/run.mjs rust${tail}`)).includes('run-entry'), tail);
  }
  assert.ok(ENTRY.test('node scripts/ci/run.mjs versions --tag v1.2.3'));
  assert.ok(ENTRY.test('node scripts/ci/run.mjs install-tool actionlint'));
});

test('soften: continue-on-error·shell·run.mjs 단계의 다른 if', () => {
  assert.ok(rulesFor(once('      - name: fmt\n', '      - name: fmt\n        continue-on-error: true\n')).includes('soften'));
  assert.ok(rulesFor(once('    timeout-minutes: 45\n', '    timeout-minutes: 45\n    continue-on-error: true\n')).includes('soften'));
  assert.ok(rulesFor(once('      - name: fmt\n', '      - name: fmt\n        shell: bash -c "true" {0}\n')).includes('soften'));
  assert.ok(rulesFor((t) => t.replace('jobs:\n', 'defaults:\n  run:\n    shell: sh\njobs:\n')).includes('soften'));
  const fmtIf = '      - name: fmt\n        if: ${{ !cancelled() }}\n';
  assert.ok(rulesFor(once(fmtIf, '      - name: fmt\n        if: false\n')).includes('soften'));
  assert.ok(rulesFor(once('      - name: rust\n        run:', '      - name: rust\n        if: github.event_name == \'push\'\n        run:')).includes('soften'));
});

test('tool-pin: taiki-e/install-action은 fallback: none', () => {
  assert.ok(rulesFor(once('          fallback: none\n', '')).includes('tool-pin'));
});

test('ci-ok: needs가 모든 작업을 덮고 guard가 글자 그대로 있다', () => {
  assert.ok(rulesFor(once(', smoke-install-linux, bundle]', ', smoke-install-linux]')).includes('ci-ok'));
  // 새 작업을 더하고 ci-ok needs에 넣지 않음
  assert.ok(
    rulesFor(once('  # 필수 체크는 이 작업 하나다', '  extra:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: node scripts/ci/run.mjs list\n\n  # 필수 체크는 이 작업 하나다')).includes('ci-ok'),
  );
  assert.ok(rulesFor(once("|| contains(needs.*.result, 'failure') ", '')).includes('ci-ok'));
  assert.ok(rulesFor(once('        run: exit 1\n', '        run: exit 0\n')).includes('ci-ok'));
  assert.ok(rulesFor(once('    if: always()\n', '    if: ${{ !cancelled() }}\n')).includes('ci-ok'));
});

test('job-if: code로 건너뛰는 작업은 CODE_GATED_JOBS와 같다', () => {
  // lint를 code로 건너뛰게 하면 CODE_GATED_JOBS와 달라진다
  assert.ok(rulesFor(once('  lint:\n    name: lint\n', "  lint:\n    name: lint\n    needs: changes\n    if: needs.changes.outputs.code == 'true'\n")).includes('job-if'));
  // rust의 if를 다른 식으로
  assert.ok(rulesFor(once("    if: needs.changes.outputs.code == 'true'\n    strategy:", "    if: false\n    strategy:")).includes('job-if'));
});

test('job-if: PR에서 건너뛰는 작업은 MASTER_ONLY_JOBS와 같고 report는 ci-ok 뒤다', () => {
  const MIF = "    if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true'\n";
  // macOS·Windows bundle을 PR에서도 돌게 하면 MASTER_ONLY_JOBS와 달라진다
  assert.ok(rulesFor(once(`    needs: changes\n${MIF}`, '    needs: changes\n')).includes('job-if'));
  // bundle-linux를 다시 master 전용으로 돌리면 CODE_GATED_JOBS·MASTER_ONLY_JOBS와 달라진다(리뷰 G6: PR에서 릴리스 빌드)
  assert.ok(rulesFor(once("  bundle-linux:\n    name: bundle (linux)\n    needs: changes\n    if: needs.changes.outputs.code == 'true'\n", `  bundle-linux:\n    name: bundle (linux)\n    needs: changes\n${MIF}`)).includes('job-if'));
  // master 전용 작업이 changes를 needs에 두지 않음
  assert.ok(rulesFor(once(`    needs: changes\n${MIF}`, `    needs: [lint]\n${MIF}`)).includes('job-if'));
  // report의 if를 바꿈, report가 ci-ok 뒤가 아님
  assert.ok(rulesFor(once("(github.event_name == 'workflow_dispatch' && inputs.loop_test))", "github.event_name == 'workflow_dispatch')")).includes('job-if'));
  assert.ok(rulesFor(once('    needs: [ci-ok, e2e-web, e2e-native]\n', '    needs: [changes, e2e-web, e2e-native]\n')).includes('ci-ok'));
});

const shim = (name) => `#!/bin/sh\nset -eu\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" hook ${name} "$@"\n`;

test('hook-entry: 훅은 run.mjs hook <자기 이름>만, 파일 집합은 HOOKS와 같다', () => {
  const base = (t) => t + '\n';
  assert.deepEqual(rulesFor(base, { 'pre-push': shim('pre-push') }), []);
  const bad = {
    'gate 직접(run.mjs <gate>)': { 'pre-commit': '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" scan-staged\n' },
    'public-scan 직접': { 'pre-commit': '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/public-scan.mjs" --staged\n' },
    '다른 훅 이름': { 'pre-push': shim('pre-commit') },
    '"$@" 없음': { 'commit-msg': shim('commit-msg').replace(' "$@"', '') },
    '|| true 꼬리': { 'pre-push': shim('pre-push').replace('"$@"\n', '"$@" || true\n') },
    '앞에 다른 명령': { 'pre-push': '#!/bin/sh\nexit 0\n' + shim('pre-push').slice('#!/bin/sh\n'.length) },
    'CRLF': { 'pre-push': shim('pre-push').replace(/\n/g, '\r\n') },
    'shebang 없음': { 'pre-push': shim('pre-push').slice('#!/bin/sh\n'.length) },
    '훅 파일 빠짐': { 'pre-push': null },
    'HOOKS에 없는 훅': { 'post-merge': shim('post-merge') },
  };
  for (const [name, hooks] of Object.entries(bad)) assert.ok(rulesFor(base, hooks).includes('hook-entry'), name);
});

test('hook-gate: 훅 gate는 ci.yml에 있거나 HOOK_ONLY 짝이 ci.yml에 있다', () => {
  // scan-staged의 짝 scan, scan-msg·scan-range·push-guard의 짝 scan-history, scan-msg의 짝 subjects, pre-commit의 fmt를 ci.yml에서 빼 본다
  for (const g of ['scan', 'scan-history', 'subjects', 'fmt', 'typos', 'rust', 'deny']) {
    const all = (t) => t.replaceAll(`        run: node scripts/ci/run.mjs ${g}\n`, '        run: node scripts/ci/run.mjs list\n');
    assert.ok(rulesFor(all).includes('hook-gate'), g);
  }
});

test('hook-entry: 저장소 훅은 인덱스에서 실행 가능(100755)', () => {
  const r = spawnSync('git', ['ls-files', '-s', '--', '.githooks'], { cwd: ROOT, encoding: 'utf8' });
  const modes = r.stdout.split('\n').filter(Boolean).map((l) => [l.slice(l.indexOf('\t') + 1), l.split(' ')[0]]);
  assert.deepEqual(modes.map(([p]) => p).sort(), Object.keys(HOOKS).map((h) => `.githooks/${h}`).sort());
  for (const [p, m] of modes) assert.equal(m, '100755', p);
});

test('parseJobs: 흐름·블록 needs', () => {
  const j = parseJobs('jobs:\n  a:\n    needs: [x, y]\n  b:\n    needs: x\n  c:\n    needs:\n      - x\n      - y\n    if: always()\n');
  assert.deepEqual(j.a.needs, ['x', 'y']);
  assert.deepEqual(j.b.needs, ['x']);
  assert.deepEqual(j.c.needs, ['x', 'y']);
  assert.equal(j.c.if, 'always()');
});

test('observed: 관찰 작업은 ci-ok needs에 없고, ci-ok 뒤가 아니며, report needs에 있다', () => {
  // ci-ok needs에 넣으면(편입했는데 OBSERVED_JOBS에서 빼지 않음) 있으면 안 되는 작업이 된다
  assert.ok(rulesFor(once(', smoke-install-linux, bundle]', ', smoke-install-linux, bundle, e2e-web]')).includes('ci-ok'));
  // report needs에서 빼면 master 실패가 이슈로 열리지 않는다
  assert.ok(rulesFor(once('    needs: [ci-ok, e2e-web, e2e-native]\n', '    needs: [ci-ok, e2e-web]\n')).includes('observed'));
  // 관찰 작업의 if를 바꾸면 code·master 집합이 달라진다
  assert.ok(rulesFor(once("  e2e-web:\n    name: e2e-web\n    needs: changes\n    if: needs.changes.outputs.code == 'true'\n", '  e2e-web:\n    name: e2e-web\n    needs: changes\n')).includes('job-if'));
  // 관찰 작업이 ci.yml에서 사라짐
  assert.ok(rulesFor((t) => t.replace(/\n {2}e2e-web:\n[\s\S]*?\n\n/, '\n').replace('needs: [ci-ok, e2e-web, e2e-native]', 'needs: [ci-ok, e2e-native]')).includes('observed'));
});

// nightly.yml을 바꾼 사본(ci.yml은 그대로)의 위반 규칙
const NIGHTLY = readFileSync(join(ROOT, '.github/workflows/nightly.yml'), 'utf8');
function nightlyRules(mutate) {
  const d = mkdtempSync(join(tmpdir(), 'parity-n-'));
  try {
    mkdirSync(join(d, '.github/workflows'), { recursive: true });
    mkdirSync(join(d, 'scripts/ci'), { recursive: true });
    cpSync(join(ROOT, 'scripts/ci/tools.json'), join(d, 'scripts/ci/tools.json'));
    cpSync(join(ROOT, '.githooks'), join(d, '.githooks'), { recursive: true });
    writeFileSync(join(d, '.github/workflows/ci.yml'), CI);
    const text = mutate(NIGHTLY);
    assert.notEqual(text, NIGHTLY, '변형이 적용되지 않았다');
    writeFileSync(join(d, '.github/workflows/nightly.yml'), text);
    return checkParity(d).map((v) => v.rule);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

test('nightly.yml 사본: 변형하지 않으면 깨끗하다', () => {
  assert.deepEqual(nightlyRules((t) => t + '\n'), []);
});

// 리뷰(G4): ci.yml e2e-native와 nightly 작업이 같은 체크 이름이었다
test('job-name: 워크플로를 통틀어 작업 표시 이름이 겹치면 거부', () => {
  assert.ok(nightlyRules((t) => t.replace('name: nightly e2e-native (linux)', 'name: e2e-native (linux)')).includes('job-name'));
  assert.ok(nightlyRules((t) => t.replace('name: nightly report', 'name: report')).includes('job-name'));
  assert.equal(parseJobs('jobs:\n  a:\n    name: "x (y)" # c\n').a.name, 'x (y)');
});

// 리뷰(G4): cron을 고치면 weekly 조건식이 영원히 거짓이 되어 Windows가 조용히 꺼진다
test('schedule: github.event.schedule 비교 글자가 그 파일의 cron이 아니면 거부', () => {
  assert.ok(nightlyRules((t) => t.replace('- cron: "47 18 * * 0"', '- cron: "50 18 * * 0"')).includes('schedule'));
  assert.ok(nightlyRules((t) => t.replace("github.event.schedule == '47 18 * * 0'", "github.event.schedule == '47 18 * * 1'")).includes('schedule'));
});

// 리뷰(G4): 손으로 나열한 paths가 lib.rs·Cargo.lock·crates 등 네이티브 E2E의 입력을 빠뜨렸다
test('pr-paths: pull_request paths:는 거부, paths-ignore는 NON_CODE_GLOBS와 같아야 한다', () => {
  // nightly.yml에는 PR 트리거가 없다(구현 중 변경 78). 규칙은 PR 경로 필터가 있는 모든 워크플로에 적용되므로 트리거를 넣어 본다
  const withPr = (t) => t.replace('on:\n  schedule:\n', `on:\n  pull_request:\n    paths-ignore:\n${NON_CODE_GLOBS.map((g) => `      - "${g}"\n`).join('')}  schedule:\n`);
  assert.ok(!nightlyRules(withPr).includes('pr-paths'), 'NON_CODE_GLOBS 그대로면 통과');
  assert.ok(nightlyRules((t) => withPr(t).replace('    paths-ignore:\n', '    paths:\n')).includes('pr-paths'));
  assert.ok(nightlyRules((t) => withPr(t).replace('      - "LICENSE.*"\n', '')).includes('pr-paths'));
  assert.ok(nightlyRules((t) => withPr(t).replace('      - "docs/**"\n', '      - "docs/**"\n      - app/**\n')).includes('pr-paths'));
});

// 리뷰(G5): ratchet mutants_missed는 살아남은 수만 본다. mutant를 범위에서 빼면(skip·설정 파일) 수가 줄어 조용히 통과한다
test('mutants-scope: crates/의 mutants::skip과 cargo-mutants 설정 파일은 거부', () => {
  const d = mkdtempSync(join(tmpdir(), 'parity-mut-'));
  try {
    mkdirSync(join(d, 'scripts/ci'), { recursive: true });
    cpSync(join(ROOT, 'scripts/ci/tools.json'), join(d, 'scripts/ci/tools.json'));
    cpSync(join(ROOT, '.githooks'), join(d, '.githooks'), { recursive: true });
    mkdirSync(join(d, 'crates/core/src'), { recursive: true });
    writeFileSync(join(d, 'crates/core/src/a.rs'), 'fn a() {}\n');
    assert.deepEqual(checkParity(d).filter((v) => v.rule === 'mutants-scope'), []);
    writeFileSync(join(d, 'crates/core/src/b.rs'), 'fn a() {}\n#[cfg_attr(test, mutants :: skip)]\nfn b() {}\n');
    const v = checkParity(d).filter((x) => x.rule === 'mutants-scope');
    assert.deepEqual(v.map((x) => `${x.file}:${x.line}`), ['crates/core/src/b.rs:2']);
    mkdirSync(join(d, '.cargo'));
    writeFileSync(join(d, '.cargo/mutants.toml'), 'exclude_re = ["x"]\n');
    assert.equal(checkParity(d).filter((x) => x.rule === 'mutants-scope').length, 2);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
