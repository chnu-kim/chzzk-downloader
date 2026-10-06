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
  prunePlan,
  pubkeyProblems,
  RELEASE_CONF,
  RELEASE_SECRETS,
  REHEARSAL_MESSAGE,
  RELEASE_KEEP,
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

// 보존 상한 prune의 지울 목록(release.mjs prunePlan). 키는 releases/<v>/…(버전 폴더)와 releases/latest.json이다
const dirKeys = (vs) => ['releases/latest.json', ...vs.flatMap((v) => [`releases/${v}/SHA256SUMS`, `releases/${v}/manifest.json`])];
const range = (a, b, major = 1) => Array.from({ length: b - a + 1 }, (_, i) => `${major}.${a + i}.0`);

test('prune 판정: 최신 5개 ∪ latest ∪ previous를 남기고 나머지를 오래된 것부터 지운다', () => {
  assert.equal(RELEASE_KEEP, 5);
  const rows = [
    { name: '다섯 개 이하는 그대로', vs: ['1.0.0', '1.1.0', '1.2.0'], latest: '1.2.0', prev: '1.1.0', del: [] },
    { name: '일곱 개', vs: range(0, 6), latest: '1.6.0', prev: '1.5.0', del: ['1.0.0', '1.1.0'] },
    { name: 'previous가 상위 5개 밖이면 남긴다', vs: range(0, 7), latest: '1.7.0', prev: '1.0.0', del: ['1.1.0', '1.2.0'] },
    { name: '사전순이 아니라 semver 순', vs: range(8, 14, 0), latest: '0.14.0', prev: '0.13.0', del: ['0.8.0', '0.9.0'] },
    { name: 'prerelease 순서', vs: ['1.0.0-rc.1', '1.0.0-rc.2', '1.0.0', '1.0.1', '1.1.0-beta.1', '1.1.0', '1.2.0'], latest: '1.2.0', prev: '1.1.0', del: ['1.0.0-rc.1', '1.0.0-rc.2'] },
    { name: 'previous = none', vs: range(0, 6), latest: '1.6.0', prev: 'none', del: ['1.0.0', '1.1.0'] },
    { name: 'previous 형식이 아니면 무시', vs: range(0, 6), latest: '1.6.0', prev: '?', del: ['1.0.0', '1.1.0'] },
    { name: 'previous가 목록에 없어도 탈 없다', vs: range(0, 6), latest: '1.6.0', prev: '0.9.0', del: ['1.0.0', '1.1.0'] },
    { name: 'keep=1: latest와 previous만', vs: ['1.0.0', '1.1.0', '1.2.0'], latest: '1.2.0', prev: '1.1.0', keep: 1, del: ['1.0.0'] },
    { name: '낮은 버전이 latest(되돌린 뒤)여도 latest는 남긴다', vs: range(0, 7), latest: '1.1.0', prev: 'none', del: ['1.0.0', '1.2.0'] },
  ];
  for (const r of rows) {
    const plan = prunePlan({ keys: dirKeys(r.vs), latest: r.latest, previous: r.prev, ...(r.keep ? { keep: r.keep } : {}) });
    assert.equal(plan.abort, undefined, r.name);
    assert.deepEqual(plan.delete, r.del, r.name);
    // 남기는 것과 지우는 것은 겹치지 않고 합치면 전부다. latest·previous(목록에 있으면)는 늘 남는다
    assert.deepEqual([...plan.keep, ...plan.delete].sort(), [...r.vs].sort(), r.name);
    assert.ok(plan.keep.includes(r.latest), r.name);
    if (r.vs.includes(r.prev)) assert.ok(plan.keep.includes(r.prev), r.name);
  }
});

test('prune 판정: semver가 아닌 폴더는 건드리지 않고, 믿을 수 없는 목록은 아무것도 지우지 않는다', () => {
  const vs = range(0, 6);
  const plan = prunePlan({ keys: [...dirKeys(vs), 'releases/tmp/x.bin', 'releases/v1.0.0/a'], latest: '1.6.0', previous: '1.5.0' });
  assert.deepEqual(plan.delete, ['1.0.0', '1.1.0']);
  assert.deepEqual(plan.ignored, ['tmp', 'v1.0.0']);
  assert.ok(!plan.keep.includes('tmp'));
  for (const [latest, why] of [['2.0.0', '목록에 없음'], ['?', 'semver 아님'], ['', '빈 값'], [null, 'null']]) {
    const a = prunePlan({ keys: dirKeys(vs), latest, previous: '1.5.0' });
    assert.ok(a.abort, why);
    assert.deepEqual([a.keep, a.delete], [[], []], why);
  }
  // 목록이 비어도(latest.json만) latest가 없으니 abort
  assert.ok(prunePlan({ keys: ['releases/latest.json'], latest: '1.0.0', previous: 'none' }).abort);
  // 같은 폴더의 키가 여럿이어도 한 번만 센다
  assert.deepEqual(prunePlan({ keys: dirKeys(range(0, 5)), latest: '1.5.0', previous: '1.4.0' }).delete, ['1.0.0']);
  for (const keep of [0, -1, 1.5, '5', NaN]) assert.throws(() => prunePlan({ keys: dirKeys(vs), latest: '1.6.0', previous: 'none', keep }), /keep/);
});

test('release.yml: prune는 verify 뒤 태그에서만 돌고, report가 보고하며 deploy-worker를 막지 않는다', () => {
  const rel = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const block = (id) => new RegExp(`^ {2}${id}:\n(?:(?: {4}|\n).*\n)+`, 'm').exec(rel)?.[0] ?? '';
  const needsOf = (id) => (/^ {4}needs: \[([^\]]+)\]/m.exec(block(id))?.[1] ?? '').split(',').map((x) => x.trim());
  const prune = block('prune');
  assert.ok(prune, 'prune 작업이 없다');
  assert.ok(needsOf('prune').includes('verify'));
  assert.match(prune, /if: needs\.gate\.outputs\.mode == 'tag'/);
  assert.match(prune, /environment: release/);
  assert.match(prune, /run\.mjs release-prune/);
  assert.ok(!needsOf('deploy-worker').includes('prune'), 'prune 실패가 배포를 막으면 안 된다');
  assert.ok(needsOf('report').includes('prune'));
});
