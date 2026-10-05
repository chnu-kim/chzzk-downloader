// node --test scripts/ci/parity.test.mjs
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
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

// 저장소 ci.yml을 한 군데 바꾼 사본에 parity를 돌려 위반 규칙 목록을 돌려준다
const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
function rulesFor(mutate, hook) {
  const d = mkdtempSync(join(tmpdir(), 'parity-'));
  try {
    mkdirSync(join(d, '.github/workflows'), { recursive: true });
    mkdirSync(join(d, 'scripts/ci'), { recursive: true });
    cpSync(join(ROOT, 'scripts/ci/tools.json'), join(d, 'scripts/ci/tools.json'));
    const text = mutate(CI);
    assert.notEqual(text, CI, '변형이 적용되지 않았다');
    writeFileSync(join(d, '.github/workflows/ci.yml'), text);
    if (hook) {
      mkdirSync(join(d, '.githooks'));
      writeFileSync(join(d, '.githooks/pre-commit'), hook);
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
  assert.ok(rulesFor(once('needs: [changes, lint, scripts-windows, supply, rust, frontend, tauri]', 'needs: [changes, lint, scripts-windows, supply, rust, frontend]')).includes('ci-ok'));
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

test('hook-entry: 훅은 run.mjs <gate>만', () => {
  const base = (t) => t + '\n';
  assert.deepEqual(rulesFor(base, '#!/bin/sh\nset -eu\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" scan-staged\n'), []);
  assert.ok(rulesFor(base, '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/public-scan.mjs" --staged\n').includes('hook-entry'));
  assert.ok(rulesFor(base, '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" nope\n').includes('hook-entry'));
});

test('parseJobs: 흐름·블록 needs', () => {
  const j = parseJobs('jobs:\n  a:\n    needs: [x, y]\n  b:\n    needs: x\n  c:\n    needs:\n      - x\n      - y\n    if: always()\n');
  assert.deepEqual(j.a.needs, ['x', 'y']);
  assert.deepEqual(j.b.needs, ['x']);
  assert.deepEqual(j.c.needs, ['x', 'y']);
  assert.equal(j.c.if, 'always()');
});
