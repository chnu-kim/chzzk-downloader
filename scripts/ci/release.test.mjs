// release.mjs의 순수 함수(docs/design/cicd.md §5, 구현 중 변경 G6)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { HOOKS, PUBKEY_FILES, RELEASE_SELFTEST_FILES, ROOT } from './gates.mjs';
import {
  boundaryProblems,
  checkPubkey,
  ciOkDecision,
  cmpSemver,
  parseSemver,
  preflight,
  preflightMessage,
  pubkeyProblems,
  RELEASE_CONF,
  RELEASE_SECRETS,
  REHEARSAL_MESSAGE,
  releaseConfProblems,
  tagProblems,
  verifyPlan,
} from './release.mjs';

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

const RELEASE_CONF_REAL = JSON.parse(readFileSync(join(ROOT, RELEASE_CONF), 'utf8'));

function repo(conf, extra = {}, releaseConf = RELEASE_CONF_REAL) {
  const d = mkdtempSync(join(tmpdir(), 'pubkey-'));
  mkdirSync(join(d, 'release'));
  mkdirSync(join(d, 'app/src-tauri'), { recursive: true });
  writeFileSync(join(d, 'release/updater.pub'), PUB);
  writeFileSync(join(d, RELEASE_CONF), JSON.stringify(releaseConf));
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

// xtask(Rust)·worker(TS)와 같은 공유 벡터(worker.md 구현 중 변경 16 (마)). 한쪽만 고치지 않는다
const VECTORS = JSON.parse(readFileSync(join(ROOT, 'xtask/testdata/semver-vectors.json'), 'utf8'));
test('semver 공유 벡터(xtask/testdata/semver-vectors.json): 비교는 정·역방향, 유효·무효 목록', () => {
  assert.ok(VECTORS.cmp.length >= 10, 'cmp 벡터가 비었다');
  for (const [a, b, want] of VECTORS.cmp) {
    assert.equal(cmpSemver(a, b), want, `${a} vs ${b}`);
    assert.equal(cmpSemver(b, a), want === 0 ? 0 : -want, `${b} vs ${a}`);
  }
  for (const v of VECTORS.valid) assert.ok(parseSemver(v), `valid: ${JSON.stringify(v)}`);
  assert.ok(VECTORS.invalid.length >= 10, 'invalid 벡터가 비었다');
  for (const v of VECTORS.invalid) assert.equal(parseSemver(v), null, `invalid: ${JSON.stringify(v)}`);
  assert.equal(parseSemver(undefined), null);
  assert.equal(parseSemver(null), null);
  assert.equal(parseSemver(1), null);
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
    '릴리스 시크릿 없음: R2_BUCKET, DIST_BASE_URL. 빌드·설치 스모크·수집·서명·매니페스트(가짜 S3, stage)까지는 통과, 업로드하지 않음',
  );
  assert.deepEqual(preflight({ RELEASE_MODE: 'tag' }).missing, RELEASE_SECRETS);
  const all = Object.fromEntries(RELEASE_SECRETS.map((n) => [n, 'x']));
  assert.equal(preflight({ ...all, RELEASE_MODE: 'tag' }).code, 0);
  assert.equal(preflight({ ...all, RELEASE_MODE: 'dry' }).code, 0);
  assert.equal(preflight({ ...all, RELEASE_MODE: 'rehearsal' }).message, REHEARSAL_MESSAGE);
  assert.equal(preflight({ ...all, RELEASE_MODE: '' }).code, 1);
  assert.deepEqual(preflight({ ...all, R2_BUCKET: '', RELEASE_MODE: 'tag' }).missing, ['R2_BUCKET']);
});

test('concurrency: 어떤 실행도 대기 중에 조용히 취소되지 않는다(태그마다 그룹, rollback은 실행마다, 리허설끼리만 묶음)', () => {
  const rel = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const rb = readFileSync(join(ROOT, '.github/workflows/rollback.yml'), 'utf8');
  const group = (t) => /^concurrency:\n {2}group: (.+)$/m.exec(t)?.[1];
  assert.equal(group(rel), "${{ github.event_name == 'push' && format('release-{0}', github.ref_name) || 'release-rehearsal' }}");
  assert.equal(group(rb), 'rollback-${{ github.run_id }}');
  assert.match(rel, /^ {4}tags: \["v\*"\]$/m);
});

test('pubkey: release/tauri.release.json은 허용 목록(bundle.createUpdaterArtifacts = true)만', () => {
  assert.deepEqual(releaseConfProblems(RELEASE_CONF_REAL), []);
  const bad = [
    { bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: PUB } } },
    { bundle: { createUpdaterArtifacts: true }, plugins: { updater: { endpoints: ['https://x.invalid'] } } },
    { bundle: { createUpdaterArtifacts: true, resources: ['x'] } },
    { bundle: { createUpdaterArtifacts: 'v1Compatible' } },
    { bundle: {} },
    {},
    [],
  ];
  for (const b of bad) assert.ok(releaseConfProblems(b).length > 0, JSON.stringify(b));
  // 같은 공개 키라도 plugins는 두지 않는다(검사가 그 파일을 보는지 checkPubkey로)
  const d = repo({ plugins: { updater: { pubkey: PUB } } }, {}, bad[0]);
  try {
    assert.ok(checkPubkey(d).some((p) => p.includes('plugins')), checkPubkey(d).join('\n'));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('pubkey 훅: checkPubkey가 읽는 파일이 바뀌면 pre-commit pubkey gate가 돈다', () => {
  const when = HOOKS['pre-commit'].when.find((w) => w.gate === 'pubkey').paths;
  assert.equal(when, PUBKEY_FILES);
  for (const f of ['release/updater.pub', RELEASE_CONF, 'app/src-tauri/tauri.conf.json', 'app/src-tauri/tauri.linux.conf.json']) {
    assert.ok(PUBKEY_FILES.some((re) => re.test(f)), f);
  }
});

test('release-selftest 훅: release.mjs·s3-fake·bundle의 정적 import 그래프 전부가 pre-push 경로에 있다', () => {
  const when = HOOKS['pre-push'].when.find((w) => w.gate === 'release-selftest').paths;
  assert.equal(when, RELEASE_SELFTEST_FILES);
  const seen = new Set();
  const q = ['release.mjs', 's3-fake.mjs', 'bundle.mjs'];
  while (q.length) {
    const f = q.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const t = readFileSync(join(ROOT, 'scripts/ci', f), 'utf8');
    for (const m of t.matchAll(/^import[^;]*?from '\.\/([^']+)'/gms)) q.push(m[1]);
  }
  assert.ok(seen.size >= 5, [...seen].join(','));
  for (const f of seen) assert.ok(RELEASE_SELFTEST_FILES.some((re) => re.test(`scripts/ci/${f}`)), `scripts/ci/${f}`);
  for (const f of ['xtask/src/s3.rs', 'release/expected-artifacts.json', 'Cargo.lock']) assert.ok(RELEASE_SELFTEST_FILES.some((re) => re.test(f)), f);
});

test('verify 결정표: latest.json 상태 → full | superseded | not-promoted', () => {
  const rows = [
    ['1.2.0', '1.2.0', 'full'],
    ['1.3.0', '1.2.0', 'superseded'],
    ['1.2.1-rc.1', '1.2.0', 'superseded'],
    ['1.1.0', '1.2.0', 'not-promoted'],
    [null, '1.2.0', 'not-promoted'],
    ['?', '1.2.0', 'not-promoted'],
    ['1.2.0-rc.1', '1.2.0', 'not-promoted'],
  ];
  for (const [latest, v, want] of rows) assert.equal(verifyPlan(latest, v), want, `${latest} ${v}`);
});

test('경계: tag는 덮어쓰기를 받지 않고, dry는 루프백 엔드포인트만', () => {
  assert.deepEqual(boundaryProblems({ RELEASE_MODE: 'tag' }), []);
  for (const n of ['R2_ENDPOINT', 'RELEASE_PUBKEY', 'RELEASE_VERSION', 'RELEASE_STAGE_DIR']) {
    assert.equal(boundaryProblems({ RELEASE_MODE: 'tag', [n]: 'x' }).length, 1, n);
  }
  for (const e of ['http://127.0.0.1:9000', 'http://localhost:1', 'http://[::1]:65535']) assert.deepEqual(boundaryProblems({ RELEASE_MODE: 'dry', R2_ENDPOINT: e }), [], e);
  for (const e of ['', 'https://127.0.0.1:9000', 'http://127.0.0.1.evil:9000', 'https://acct.r2.cloudflarestorage.com', 'http://10.0.0.1:9000']) {
    assert.equal(boundaryProblems({ RELEASE_MODE: 'dry', R2_ENDPOINT: e }).length, 1, e);
  }
  assert.equal(boundaryProblems({ RELEASE_MODE: 'rehearsal' }).length, 1);
  assert.equal(boundaryProblems({}).length, 1);
});
