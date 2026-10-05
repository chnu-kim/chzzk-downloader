// release.mjs의 순수 함수(docs/design/cicd.md §5, 구현 중 변경 G6)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
import { checkPubkey, ciOkDecision, cmpSemver, preflight, preflightMessage, pubkeyProblems, RELEASE_SECRETS, REHEARSAL_MESSAGE, tagProblems } from './release.mjs';

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


test('semver 비교(xtask/src/semver.rs와 같은 표)', () => {
  assert.equal(cmpSemver('1.0.0', '0.9.9'), 1);
  assert.equal(cmpSemver('0.10.0', '0.9.0'), 1);
  assert.equal(cmpSemver('1.0.0-alpha', '1.0.0'), -1);
  assert.equal(cmpSemver('1.0.0-alpha.1', '1.0.0-alpha'), 1);
  assert.equal(cmpSemver('1.0.0-alpha.beta', '1.0.0-alpha.1'), 1);
  assert.equal(cmpSemver('1.0.0-beta.11', '1.0.0-beta.2'), 1);
  assert.equal(cmpSemver('2.1.3', '2.1.3'), 0);
  assert.throws(() => cmpSemver('1.0', '1.0.0'));
});

test('태그 단조 증가', () => {
  assert.deepEqual(tagProblems('v0.2.0', ['v0.1.0', 'v0.1.9', 'vnext']), []);
  assert.equal(tagProblems('v0.2.0', ['v0.2.0-rc.1', 'v0.3.0']).length, 1);
  assert.equal(tagProblems('v0.2.0', ['v0.2.0']).length, 1);
  assert.equal(tagProblems('0.2.0', []).length, 1);
  assert.equal(tagProblems('v0.2', []).length, 1);
});

test('ci-ok 판정: 어느 master 실행이든 ci-ok 녹색이면 통과, 모두 끝났는데 없으면 실패, 그 밖은 기다림', () => {
  const run = (status, ciok) => ({ status, jobs: ciok ? [{ name: 'ci-ok', conclusion: ciok }, { name: 'report', conclusion: 'failure' }] : [] });
  assert.equal(ciOkDecision([]), 'pending');
  assert.equal(ciOkDecision([run('in_progress')]), 'pending');
  assert.equal(ciOkDecision([run('completed', 'success')]), 'success');
  assert.equal(ciOkDecision([run('completed', 'failure')]), 'failure');
  assert.equal(ciOkDecision([run('completed', 'failure'), run('completed', 'success')]), 'success');
  assert.equal(ciOkDecision([run('completed', 'failure'), run('queued')]), 'pending');
  // 작업 이름이 ci-ok가 아니면 세지 않는다
  assert.equal(ciOkDecision([{ status: 'completed', jobs: [{ name: 'ci-ok (x)', conclusion: 'success' }] }]), 'failure');
});

test('preflight: 정확한 메시지, 리허설은 시크릿이 있어도 멈춘다', () => {
  assert.equal(
    preflightMessage(['R2_BUCKET', 'DIST_BASE_URL']),
    '릴리스 시크릿 없음: R2_BUCKET, DIST_BASE_URL. 빌드·수집·설치 스모크까지는 통과, 업로드하지 않음',
  );
  assert.deepEqual(preflight({ RELEASE_MODE: 'tag' }).missing, RELEASE_SECRETS);
  const all = Object.fromEntries(RELEASE_SECRETS.map((n) => [n, 'x']));
  assert.equal(preflight({ ...all, RELEASE_MODE: 'tag' }).code, 0);
  assert.equal(preflight({ ...all, RELEASE_MODE: 'rehearsal' }).message, REHEARSAL_MESSAGE);
  assert.equal(preflight({ ...all, RELEASE_MODE: '' }).code, 1);
  assert.deepEqual(preflight({ ...all, R2_BUCKET: '', RELEASE_MODE: 'tag' }).missing, ['R2_BUCKET']);
});
