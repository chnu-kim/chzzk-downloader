// node --test scripts/ci/parity.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
import { checkParity, runCommands, toolInputs } from './parity.mjs';

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
