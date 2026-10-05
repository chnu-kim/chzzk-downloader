// node --test scripts/ci/entry.test.mjs — 진입 스크립트가 실제로 main을 돈다(조용히 0으로 끝나지 않는다).
// `import.meta.url`과 argv[1]의 비교가 어긋나면(심볼릭 링크 경로, Windows 드라이브 문자 등) main이 안 돌고 exit 0이
// 되어 gate가 무엇이든 통과시킨다. 모르는 인자에 사용법 오류(2)를 내는지로 main이 돌았는지 본다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';

const SCRIPTS = [
  'scripts/ci/run.mjs',
  'scripts/ci/parity.mjs',
  'scripts/ci/pin-check.mjs',
  'scripts/ci/version-check.mjs',
  'scripts/ci/public-scan.mjs',
  'scripts/ci/push-guard.mjs',
  'scripts/ci/commit-msg.mjs',
  'scripts/fixtures/gen-fixtures.mjs',
];

const run = (path) => spawnSync(process.execPath, [path, '--no-such-flag'], { cwd: ROOT, encoding: 'utf8' }).status;

test('진입 스크립트는 모르는 인자에 2를 낸다(main이 돈다)', () => {
  for (const s of SCRIPTS) assert.equal(run(join(ROOT, s)), 2, s);
});

test('심볼릭 링크 경로로 불러도 main이 돈다', { skip: process.platform === 'win32' && 'Windows는 symlink 권한이 없을 수 있다' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'entry-'));
  try {
    for (const s of SCRIPTS) {
      const link = join(d, s.replace(/\//g, '_'));
      symlinkSync(join(ROOT, s), link);
      assert.equal(run(link), 2, s);
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
