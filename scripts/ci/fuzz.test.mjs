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

test('lockDrift: 루트에도 있는 패키지는 같은 버전이어야 하고, fuzz 전용은 무관, 지금 저장소의 두 lock은 같다', async () => {
  const { lockDrift, lockPackages } = await import('./fuzz.mjs');
  const pkg = (n, v) => `[[package]]\nname = "${n}"\nversion = "${v}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`;
  const root = 'version = 4\n\n' + pkg('url', '2.5.8') + pkg('serde', '1.0.229') + pkg('syn', '1.0.109') + pkg('syn', '2.0.1');
  assert.deepEqual(lockDrift(root, pkg('url', '2.5.8') + pkg('libfuzzer-sys', '0.4.13') + pkg('syn', '2.0.1')), []);
  assert.deepEqual(lockDrift(root, pkg('url', '2.5.7') + pkg('serde', '1.0.229')), ['url@2.5.7'], 'fuzz가 낡은 파서 의존성을 쓴다');
  assert.deepEqual([...lockPackages(root).get('syn')].sort(), ['1.0.109', '2.0.1']);
  assert.deepEqual(lockDrift(readFileSync(join(ROOT, 'Cargo.lock'), 'utf8'), readFileSync(join(ROOT, 'fuzz/Cargo.lock'), 'utf8')), []);
});
