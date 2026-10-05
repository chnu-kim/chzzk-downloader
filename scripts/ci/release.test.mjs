// release.mjs의 순수 함수(docs/design/cicd.md §5, 구현 중 변경 G6)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
import { checkPubkey, pubkeyProblems } from './release.mjs';

const PUB = readFileSync(join(ROOT, 'release/updater.pub'), 'utf8');

test('pubkey: 저장소의 공개 키는 형식이 맞고 tauri.conf.json과 같다', () => {
  assert.deepEqual(pubkeyProblems(PUB), []);
  assert.deepEqual(checkPubkey(), []);
});

test('pubkey: 줄바꿈·base64 아님·다른 텍스트는 거부', () => {
  assert.equal(pubkeyProblems(`${PUB}\n`).length, 1);
  assert.equal(pubkeyProblems('not base64!').length, 1);
  assert.equal(pubkeyProblems(Buffer.from('untrusted comment: x\nRW\n').toString('base64')).length, 1);
});

function repo(conf, extra = {}) {
  const d = mkdtempSync(join(tmpdir(), 'pubkey-'));
  mkdirSync(join(d, 'release'));
  mkdirSync(join(d, 'app/src-tauri'), { recursive: true });
  writeFileSync(join(d, 'release/updater.pub'), PUB);
  writeFileSync(join(d, 'app/src-tauri/tauri.conf.json'), JSON.stringify(conf));
  for (const [f, v] of Object.entries(extra)) writeFileSync(join(d, 'app/src-tauri', f), JSON.stringify(v));
  return d;
}

test('pubkey: conf가 다르거나 없거나 플랫폼 conf가 다른 키면 실패', () => {
  const cases = [
    [{ plugins: { updater: { pubkey: PUB.slice(1) } } }, {}],
    [{}, {}],
    [{ plugins: { updater: { pubkey: PUB } } }, { 'tauri.linux.conf.json': { plugins: { updater: { pubkey: 'x' } } } }],
  ];
  for (const [conf, extra] of cases) {
    const d = repo(conf, extra);
    try {
      assert.ok(checkPubkey(d).length > 0, JSON.stringify(conf));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }
  const ok = repo({ plugins: { updater: { pubkey: PUB } } }, { 'tauri.windows.conf.json': { bundle: {} } });
  try {
    assert.deepEqual(checkPubkey(ok), []);
  } finally {
    rmSync(ok, { recursive: true, force: true });
  }
});
