// release.mjs의 순수 함수(docs/design/cicd.md §5, 구현 중 변경 G6)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { HOOKS, PUBKEY_FILES, RELEASE_SELFTEST_FILES, ROOT } from './gates.mjs';
import {
  boundaryProblems,
  buildIdOf,
  bundleMeta,
  checkPubkey,
  ciOkDecision,
  cmpSemver,
  distBaseProblems,
  DRY_OVERRIDES,
  envMs,
  judgeCheck,
  maskValues,
  parseSemver,
  parseWorkerArgs,
  preflight,
  preflightMessage,
  prunePlan,
  pubkeyProblems,
  RELEASE_CONF,
  RELEASE_SECRETS,
  REHEARSAL_MESSAGE,
  RELEASE_KEEP,
  releaseConfProblems,
  runWorkerChecks,
  tagProblems,
  verifyPlan,
  WORKER_CHECKS,
  wranglerDeployArgs,
  wranglerEnv,
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

test('release-selftest 훅: release.mjs·s3-fake·bundle·worker-stub의 정적 import 그래프 전부가 pre-push 경로에 있다', () => {
  const when = HOOKS['pre-push'].when.find((w) => w.gate === 'release-selftest').paths;
  assert.equal(when, RELEASE_SELFTEST_FILES);
  const seen = new Set();
  const q = ['release.mjs', 's3-fake.mjs', 'bundle.mjs', 'worker-stub.mjs'];
  while (q.length) {
    const f = q.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const t = readFileSync(join(ROOT, 'scripts/ci', f), 'utf8');
    for (const m of t.matchAll(/^import[^;]*?from '\.\/([^']+)'/gms)) q.push(m[1]);
  }
  assert.ok(seen.size >= 5, [...seen].join(','));
  for (const f of seen) assert.ok(RELEASE_SELFTEST_FILES.some((re) => re.test(`scripts/ci/${f}`)), `scripts/ci/${f}`);
  for (const f of ['xtask/src/s3.rs', 'release/expected-artifacts.json', 'Cargo.lock', 'worker/wrangler.jsonc', 'scripts/ci/tools.json', 'scripts/ci/worker-config.mjs', 'scripts/ci/worker-stub.mjs']) assert.ok(RELEASE_SELFTEST_FILES.some((re) => re.test(f)), f);
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
  assert.ok(DRY_OVERRIDES.includes('WORKER_BUNDLE'), '묶음 위치 덮어쓰기도 tag 모드가 거부한다');
  for (const n of DRY_OVERRIDES) assert.equal(boundaryProblems({ RELEASE_MODE: 'tag', [n]: 'x' }).length, 1, n);
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

// ---- 배포 뒤 검사(worker.md §9.4, cicd.md 구현 중 변경 81·W8-1) ----

const B = (t) => Buffer.from(typeof t === 'string' ? t : JSON.stringify(t));
const R = (status, body = '') => ({ status, body: B(body) });
const CTX = { version: '1.2.0', build: 'abc1234', latestBytes: null };

test('검사 판정: 상태·본문 표', () => {
  const rows = [
    // health: 200 + ok + 이번 build만 통과, 옛 build는 기다림(wait), config_error는 즉시 실패, 5xx·오류는 다시 시도
    ['health', R(200, { ok: true, build: 'abc1234' }), 'pass'],
    ['health', R(200, { ok: true, build: 'old0000' }), 'wait'],
    ['health', R(200, { ok: false, build: 'abc1234' }), 'fail'],
    ['health', R(200, 'not json'), 'fail'],
    ['health', R(404), 'fail'],
    ['health', R(503, { ok: false, code: 'config_error' }), 'fail'],
    ['health', R(503, { code: 'other' }), 'retry'],
    ['health', R(500), 'retry'],
    ['health', R(429), 'retry'],
    ['health', { error: 'ECONNREFUSED' }, 'retry'],
    ['update-latest', R(200, { version: '1.2.0' }), 'pass'],
    ['update-latest', R(200, { version: '1.1.0' }), 'fail'],
    ['update-latest', R(200, 'x'), 'fail'],
    ['update-latest', R(204), 'fail'],
    ['update-latest', R(401), 'fail'],
    ['update-latest', R(503), 'retry'],
    ['update-current', R(204), 'pass'],
    ['update-current', R(200, { version: '1.2.0' }), 'fail'],
    ['update-current', R(401), 'fail'],
    ['update-current', R(502), 'retry'],
    // /admin: 200이 아니면(로그인 303, 아직 없는 경로 404, 권한 없음 401·403) 통과
    ['neg-admin', R(303), 'pass'],
    ['neg-admin', R(404), 'pass'],
    ['neg-admin', R(401), 'pass'],
    ['neg-admin', R(200), 'fail'],
    ['neg-admin', R(204), 'fail'],
    ['neg-admin', R(500), 'retry'],
    ['neg-latest-anon', R(401), 'pass'],
    ['neg-latest-anon', R(200), 'fail'],
    ['neg-latest-anon', R(404), 'fail'],
    ['neg-latest-anon', R(403), 'fail'],
    ['neg-me-ci', R(401), 'pass'],
    ['neg-me-ci', R(200, {}), 'fail'],
    ['neg-me-ci', R(303), 'fail'],
    ['neg-me-ci', { error: 'ETIMEDOUT' }, 'retry'],
  ];
  for (const [id, res, want] of rows) assert.equal(judgeCheck(id, res, CTX), want, `${id} ${res.status ?? res.error}`);
  // build를 모르면(--build 없음) health는 build를 보지 않는다
  assert.equal(judgeCheck('health', R(200, { ok: true, build: 'x' }), { ...CTX, build: null }), 'pass');
  // 배포 모드: 본문이 S3의 latest.json과 바이트까지 같아야 한다
  const bytes = B('{"version":"1.2.0","platforms":{}}');
  assert.equal(judgeCheck('update-latest', { status: 200, body: bytes }, { ...CTX, latestBytes: bytes }), 'pass');
  assert.equal(judgeCheck('update-latest', R(200, '{"version":"1.2.0","platforms":{"x":1}}'), { ...CTX, latestBytes: bytes }), 'fail');
  assert.throws(() => judgeCheck('nope', R(200), CTX));
});

// 가짜 fetch: 경로 → 응답 목록(차례로, 마지막은 반복). 호출을 기록한다
function fakeFetch(table) {
  const calls = [];
  const idx = {};
  const impl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ url, init, path });
    const list = table[path];
    const r = list[Math.min(idx[path] ?? 0, list.length - 1)];
    idx[path] = (idx[path] ?? 0) + 1;
    if (r.error) throw Object.assign(new Error(`connect to dist.example.test failed ${r.error}`), { cause: { code: r.error } });
    return { status: r.status, arrayBuffer: async () => Buffer.from(r.body ?? '') };
  };
  return { impl, calls };
}
const OK_TABLE = () => ({
  '/health': [{ status: 200, body: JSON.stringify({ ok: true, build: 'abc1234' }) }],
  '/update/0.0.0': [{ status: 200, body: JSON.stringify({ version: '1.2.0' }) }],
  '/update/1.2.0': [{ status: 204 }],
  '/admin': [{ status: 303 }],
  '/releases/latest.json': [{ status: 401 }],
  '/api/me': [{ status: 401 }],
});
const runChecks = async (table, extra = {}) => {
  const f = fakeFetch(table);
  const logs = [];
  const sleeps = [];
  let t = 0;
  const sleep = async (ms) => {
    sleeps.push(ms);
    t += ms;
  };
  const r = await runWorkerChecks({ base: 'https://dist.example.test', token: 'tok-secret', version: '1.2.0', build: 'abc1234', fetchImpl: f.impl, sleep, now: () => t, log: (m) => logs.push(m), ...extra });
  return { ...r, f, logs, sleeps };
};

test('runWorkerChecks: 정상은 0, 요청은 늘 redirect manual이고 인증은 auth 검사에만 붙는다, 로그에 호스트·토큰이 없다', async () => {
  const r = await runChecks(OK_TABLE());
  assert.equal(r.code, 0);
  assert.deepEqual(r.results.map((x) => x.id), ['health', ...WORKER_CHECKS.map((c) => c.id)]);
  assert.ok(r.results.every((x) => x.outcome === 'pass'));
  for (const c of r.f.calls) assert.equal(c.init.redirect, 'manual', c.path);
  const anon = r.f.calls.filter((c) => !c.init.headers.authorization).map((c) => c.path).sort();
  assert.deepEqual(anon, ['/health', '/releases/latest.json']);
  for (const c of r.f.calls.filter((x) => x.init.headers.authorization)) assert.equal(c.init.headers.authorization, 'Bearer tok-secret');
  const all = r.logs.join('\n');
  assert.ok(!/example\.test|tok-secret|https:/.test(all), all);
  assert.match(all, /worker check neg-admin \/admin: pass \(HTTP 303\)/);
});

test('runWorkerChecks: 판정 실패는 1(나머지 검사는 계속), 5xx·네트워크가 끝까지 남으면 2, 둘이 섞이면 1', async () => {
  const bad = OK_TABLE();
  bad['/admin'] = [{ status: 200 }];
  const r1 = await runChecks(bad);
  assert.equal(r1.code, 1);
  assert.deepEqual(r1.results.filter((x) => x.outcome === 'fail').map((x) => x.id), ['neg-admin']);
  assert.equal(r1.results.length, 6);

  const infra = OK_TABLE();
  infra['/update/1.2.0'] = [{ status: 503 }];
  const r2 = await runChecks(infra);
  assert.equal(r2.code, 2);
  assert.equal(r2.results.find((x) => x.id === 'update-current').outcome, 'infra');
  assert.equal(r2.f.calls.filter((c) => c.path === '/update/1.2.0').length, 4);
  assert.deepEqual(r2.sleeps, [2000, 4000, 8000]);

  const net = OK_TABLE();
  net['/api/me'] = [{ error: 'ECONNRESET' }];
  const r3 = await runChecks(net);
  assert.equal(r3.code, 2);
  assert.equal(r3.results.at(-1).cause, 'ECONNRESET');
  assert.ok(!r3.logs.join('\n').includes('example.test'), '오류 메시지(호스트 포함)를 찍지 않는다');

  const mixed = OK_TABLE();
  mixed['/admin'] = [{ status: 200 }];
  mixed['/api/me'] = [{ status: 500 }];
  assert.equal((await runChecks(mixed)).code, 1);

  // 일시 5xx는 다시 시도해 통과
  const flaky = OK_TABLE();
  flaky['/update/1.2.0'] = [{ status: 502 }, { status: 204 }];
  assert.equal((await runChecks(flaky)).code, 0);
});

test('runWorkerChecks: health는 이번 build가 보일 때까지 기다리고(기한 안), 기한이 넘으면 옛 build는 1, 5xx는 2', async () => {
  const late = OK_TABLE();
  late['/health'] = [{ status: 200, body: JSON.stringify({ ok: true, build: 'old0000' }) }, { status: 200, body: JSON.stringify({ ok: true, build: 'abc1234' }) }];
  const r = await runChecks(late, { intervalMs: 30_000, deadlineMs: 300_000 });
  assert.equal(r.code, 0);
  assert.deepEqual(r.sleeps, [30_000]);

  const stale = OK_TABLE();
  stale['/health'] = [{ status: 200, body: JSON.stringify({ ok: true, build: 'old0000' }) }];
  const r2 = await runChecks(stale, { intervalMs: 30_000, deadlineMs: 300_000 });
  assert.equal(r2.code, 1);
  assert.equal(r2.results.length, 1, '기한이 넘으면 남은 검사는 돌지 않는다');
  assert.equal(r2.results[0].outcome, 'fail');
  assert.equal(r2.sleeps.length, 10, '0초부터 300초까지 30초 간격(검사 11번, 대기 10번)');

  const down = OK_TABLE();
  down['/health'] = [{ status: 503, body: '{}' }];
  const r3 = await runChecks(down, { intervalMs: 30_000, deadlineMs: 300_000 });
  assert.equal(r3.code, 2);
  assert.equal(r3.results[0].outcome, 'infra');

  const cfg = OK_TABLE();
  cfg['/health'] = [{ status: 503, body: JSON.stringify({ ok: false, code: 'config_error' }) }];
  const r4 = await runChecks(cfg);
  assert.equal(r4.code, 1);
  assert.deepEqual(r4.sleeps, []);
});

test('envMs: 정수 1..600000만, 아니면 기본값', () => {
  assert.equal(envMs({ X: '20' }, 'X', 5), 20);
  assert.equal(envMs({ X: '600000' }, 'X', 5), 600_000);
  for (const v of ['0', '600001', '-1', '1.5', 'abc', '', ' 5', '1e3']) assert.equal(envMs({ X: v }, 'X', 5), 5, v);
  assert.equal(envMs({}, 'X', 5), 5);
});

test('DIST_BASE_URL 출처 규칙: 경로 없는 https 출처만(값은 문제 목록에 싣지 않는다)', () => {
  for (const ok of ['https://a.example.test', 'https://a.example.test:8443', 'https://x.sub.workers.dev']) assert.deepEqual(distBaseProblems(ok), [], ok);
  for (const bad of ['http://a.example.test', 'https://a.example.test/', 'https://a.example.test/x', 'https://a.example.test?q=1', 'https://a.example.test#f', 'https://u:p@a.example.test', 'https://A.example.test', 'https://a.example.test:443', '', 'not a url', undefined]) {
    const p = distBaseProblems(bad);
    assert.ok(p.length > 0, String(bad));
    assert.ok(!p.join(' ').includes('example.test'), '문제 문구에 값이 없다');
  }
});

test('마스킹 값: 호스트와 workers.dev 계정 서브도메인 조각', () => {
  assert.deepEqual(maskValues('https://chzzk-downloader.acct-sub.workers.dev'), ['chzzk-downloader.acct-sub.workers.dev', 'acct-sub']);
  assert.deepEqual(maskValues('https://x.example.test'), ['x.example.test']);
  assert.deepEqual(maskValues('https://a.ab.workers.dev'), ['a.ab.workers.dev'], '짧은 조각(4자 미만)은 흔한 낱말을 가릴 수 있어 호스트만');
  assert.deepEqual(maskValues('x'), []);
  assert.deepEqual(maskValues(undefined), []);
});

test('worker 인자: 인자 없음은 배포, --check-only는 base·version 필수, 그 밖은 오류', () => {
  assert.deepEqual(parseWorkerArgs([]), { mode: 'deploy' });
  assert.deepEqual(parseWorkerArgs(['--check-only', '--base', 'http://127.0.0.1:1', '--version', '1.2.0']), { mode: 'check', base: 'http://127.0.0.1:1', version: '1.2.0', build: null });
  assert.deepEqual(parseWorkerArgs(['--version', '1.2.0-rc.1', '--build', 'abc1234', '--base', 'https://a.example.test', '--check-only']), { mode: 'check', base: 'https://a.example.test', version: '1.2.0-rc.1', build: 'abc1234' });
  const bad = [
    ['--nope'],
    ['--check-only'],
    ['--check-only', '--base', 'x'],
    ['--check-only', '--version', '1.2.0'],
    ['--check-only', '--base', 'x', '--version', '1.2'],
    ['--check-only', '--base', 'x', '--version', '1.2.0', '--build', 'a b'],
    ['--check-only', '--base', 'x', '--version', '1.2.0', '--build', 'x'.repeat(41)],
    ['--check-only', '--base'],
    ['--check-only', '--base', '--version', '1.2.0'],
    ['--check-only', '--check-only', '--base', 'x', '--version', '1.2.0'],
    ['--check-only', '--base', 'x', '--base', 'y', '--version', '1.2.0'],
    ['--base', 'x', '--version', '1.2.0'],
    ['extra'],
  ];
  for (const a of bad) assert.ok(parseWorkerArgs(a).error, a.join(' '));
});

test('BUILD_ID: 40자리 hex의 앞 7자, 그 밖은 null', () => {
  assert.equal(buildIdOf('a'.repeat(40)), 'aaaaaaa');
  assert.equal(buildIdOf(`${'1234567'}${'0'.repeat(33)}`), '1234567');
  for (const v of [undefined, '', 'abc', 'A'.repeat(40), 'g'.repeat(40), 'a'.repeat(41), 'a'.repeat(39)]) assert.equal(buildIdOf(v), null, String(v));
});

test('wrangler 인자·env: dry-run과 실제가 같은 배열에 --dry-run만 더하고, env는 허용 목록뿐이다', () => {
  const real = wranglerDeployArgs({ origin: 'https://a.example.test', build: 'abc1234', dryRun: false });
  const dry = wranglerDeployArgs({ origin: 'https://a.example.test', build: 'abc1234', dryRun: true });
  assert.deepEqual(dry, [...real, '--dry-run']);
  assert.deepEqual(real, ['deploy', '--no-bundle', '--config', 'dist/wrangler.json', '--var', 'PUBLIC_ORIGIN:https://a.example.test', '--var', 'BUILD_ID:abc1234']);
  const inEnv = { PATH: '/bin', HOME: '/real/home', CI_VERIFY_TOKEN: 't', R2_SECRET_ACCESS_KEY: 's', R2_ACCESS_KEY_ID: 'a', DIST_BASE_URL: 'https://a.example.test', GITHUB_TOKEN: 'g', GITHUB_SHA: 'x', CLOUDFLARE_API_BASE_URL: 'http://127.0.0.1:1', CLOUDFLARE_API_TOKEN: 'cf-t', CLOUDFLARE_ACCOUNT_ID: 'cf-a', NODE_OPTIONS: '--x', WRANGLER_LOG_PATH: '/x' };
  const allowed = new Set(['PATH', 'HOME', 'XDG_CONFIG_HOME', 'CI', 'WRANGLER_SEND_METRICS', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'USERPROFILE', 'SystemRoot']);
  for (const credentials of [false, true]) {
    const e = wranglerEnv(inEnv, { home: '/tmp/empty-home', credentials });
    for (const k of Object.keys(e)) assert.ok(allowed.has(k), `${k}는 허용 목록에 없다`);
    assert.equal(e.HOME, '/tmp/empty-home', '로컬 wrangler login 상태를 쓰지 않는다');
    assert.equal(e.WRANGLER_SEND_METRICS, 'false');
    assert.equal(Object.hasOwn(e, 'CLOUDFLARE_API_TOKEN'), credentials);
    assert.equal(Object.hasOwn(e, 'CLOUDFLARE_ACCOUNT_ID'), credentials);
  }
  assert.equal(wranglerEnv(inEnv, { home: '/h', credentials: true }).CLOUDFLARE_API_TOKEN, 'cf-t');
});

test('묶음 표시: bundleMeta는 이 실행의 platform·arch와 wrangler 버전', () => {
  assert.deepEqual(bundleMeta('4.0.0'), { platform: process.platform, arch: process.arch, wrangler: '4.0.0' });
});

test('release.yml: worker-bundle(시크릿·환경 없음)·deploy-worker(묶음·가드 입력)의 모양', () => {
  const rel = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const block = (id) => new RegExp(`^ {2}${id}:\\n(?:(?: {4}|\\n).*\\n)+`, 'm').exec(rel)?.[0] ?? '';
  const needsOf = (id) => (/^ {4}needs: (?:\[([^\]]+)\]|(\S+))/m.exec(block(id)) ?? []).slice(1).filter(Boolean).join(',').split(',').map((x) => x.trim());
  const wb = block('worker-bundle');
  assert.ok(wb, 'worker-bundle 작업이 없다');
  // 시크릿·환경이 없고 태그·리허설 모두 돈다(if 없음)
  assert.ok(!/^ {4}environment:/m.test(wb) && !/secrets\./.test(wb) && !/^ {4}if:/m.test(wb));
  assert.match(wb, /run\.mjs release-worker-bundle/);
  assert.match(wb, /sha256: \$\{\{ steps\.bundle\.outputs\.sha256 \}\}/);
  const dw = block('deploy-worker');
  assert.ok(dw, 'deploy-worker 작업이 없다');
  for (const n of ['verify', 'worker-bundle', 'xtask', 'gate']) assert.ok(needsOf('deploy-worker').includes(n), n);
  assert.match(dw, /WORKER_BUNDLE_SHA256: \$\{\{ needs\.worker-bundle\.outputs\.sha256 \}\}/);
  assert.match(dw, /worker-bundle-\$\{\{ github\.run_id \}\}/);
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CI_VERIFY_TOKEN']) assert.match(dw, new RegExp(`${k}: \\$\\{\\{ secrets\\.${k} \\}\\}`));
  assert.ok(needsOf('report').includes('worker-bundle'));
});
