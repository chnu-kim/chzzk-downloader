// node --test scripts/ci/fuzz.test.mjs — fuzz gate의 입력(target·seed·시간). 실제 fuzz는 nightly가 돌린다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { NIGHTLY, ROOT, seconds, seedFiles, TARGETS, URL_SEEDS } from './fuzz.mjs';
import { scanText, loadDenylist } from './public-scan.mjs';

test('target 4개 = fuzz/Cargo.toml의 [[bin]], 파일이 있다', () => {
  const toml = readFileSync(join(ROOT, 'fuzz/Cargo.toml'), 'utf8');
  const bins = [...toml.matchAll(/\[\[bin\]\]\s*\nname = "([^"]+)"\s*\npath = "([^"]+)"/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(bins.map(([n]) => n).sort(), [...TARGETS].sort());
  for (const [, p] of bins) assert.ok(existsSync(join(ROOT, 'fuzz', p)), p);
  assert.match(toml, /^\[workspace\]$/m, 'fuzz는 자기 워크스페이스다(루트 --locked·deny에 섞이지 않는다)');
  assert.ok(existsSync(join(ROOT, 'fuzz/Cargo.lock')));
  assert.match(readFileSync(join(ROOT, 'Cargo.toml'), 'utf8'), /^exclude = \["fuzz"\]$/m);
});

test('seed: url 말고는 testdata 합성 fixture가 하나 이상, 모두 누출 검사 통과', () => {
  const s = seedFiles();
  for (const t of TARGETS.filter((t) => t !== 'url')) {
    assert.ok(s[t].length > 0, t);
    for (const f of s[t]) assert.ok(f.startsWith('testdata/'), f);
  }
  const deny = loadDenylist();
  assert.deepEqual(scanText(URL_SEEDS.join('\n'), deny), []);
});

test('seconds·nightly 핀: 1~3600 정수만, 날짜가 박힌 nightly', () => {
  assert.equal(seconds({}), 300);
  assert.equal(seconds({ FUZZ_SECONDS: '20' }), 20);
  for (const bad of ['0', '3601', '1.5', '-1', 'x', '']) assert.equal(seconds({ FUZZ_SECONDS: bad }), null, bad);
  assert.match(NIGHTLY, /^nightly-\d{4}-\d{2}-\d{2}$/);
});
