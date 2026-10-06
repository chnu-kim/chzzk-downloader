// node --test scripts/ci/toolchain.test.mjs — 주간 toolchain 고리(새 stable이면 1)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
import { cmp, pinnedChannel, stableVersion } from './toolchain.mjs';

const STABLE = (v) => `manifest-version = "2"\ndate = "2026-09-28"\n[pkg.cargo]\nversion = "0.1.0 (x)"\n\n[pkg.rust]\nversion = "${v} (b940084d7 2026-09-28)"\ngit_commit_hash = "x"\n`;

test('pinnedChannel: x.y.z만 받는다, stableVersion: [pkg.rust]의 버전', () => {
  assert.equal(pinnedChannel('[toolchain]\nchannel = "1.96.1"\n'), '1.96.1');
  assert.throws(() => pinnedChannel('[toolchain]\nchannel = "stable"\n'), /x\.y\.z/);
  assert.throws(() => pinnedChannel('[toolchain]\n'), /channel/);
  assert.equal(stableVersion(STABLE('1.99.0')), '1.99.0');
  assert.throws(() => stableVersion('nope'), /pkg\.rust/);
  assert.equal(cmp('1.96.1', '1.99.0'), -1);
  assert.equal(cmp('1.100.0', '1.99.9'), 1);
  assert.equal(cmp('1.96.1', '1.96.1'), 0);
});

test('toolchain.mjs: 고정값이 최신이면 0, 낮으면 1, 못 읽으면 2', () => {
  const d = mkdtempSync(join(tmpdir(), 'tc-'));
  try {
    const pinned = pinnedChannel(readFileSync(join(ROOT, 'rust-toolchain.toml'), 'utf8'));
    // 종료 코드와 GITHUB_OUTPUT kinds(이슈 kind: 제목이 원인을 단정하지 않는다, 리뷰 G5)
    const run = (text) => {
      const f = join(d, 's.toml');
      const out = join(d, 'out');
      writeFileSync(f, text);
      writeFileSync(out, '');
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/toolchain.mjs')], { env: { ...process.env, TOOLCHAIN_STABLE_TOML: f, GITHUB_OUTPUT: out }, encoding: 'utf8' });
      return `${r.status} ${readFileSync(out, 'utf8').trim()}`.trim();
    };
    assert.equal(run(STABLE(pinned)), '0');
    const [a, b, c] = pinned.split('.').map(Number);
    assert.equal(run(STABLE(`${a}.${b}.${c + 1}`)), '1 kinds=outdated');
    assert.equal(run(STABLE(`${a}.${b + 1}.0`)), '1 kinds=outdated');
    assert.equal(run('깨짐'), '2 kinds=network');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
