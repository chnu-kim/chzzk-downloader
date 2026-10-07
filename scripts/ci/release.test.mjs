// release.mjs의 순수 함수(docs/design/cicd.md §5, 구현 중 변경 G6)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { contractPath, DEPLOY_CONTRACT, GARBAGE_BEARER as CONTRACT_GARBAGE } from '../../worker/test/deploy-contract.mjs';
import { HOOKS, PUBKEY_FILES, RELEASE_SELFTEST_FILES, ROOT, WORKER_PLACEHOLDER } from './gates.mjs';
import { createWorkerStub } from './worker-stub.mjs';
import {
  binaryWorkerBaseProblems,
  boundaryProblems,
  buildIdOf,
  buildWorkerBase,
  bundleMeta,
  checkPubkey,
  ciOkDecision,
  cmpSemver,
  distBaseProblems,
  DRY_OVERRIDES,
  envMs,
  GARBAGE_BEARER,
  judgeCheck,
  maskValues,
  parseSemver,
  parseWorkerArgs,
  preflight,
  preflightMessage,
  probeVerifyWorker,
  pruneMissingMessage,
  prunePlan,
  pubkeyProblems,
  RELEASE_CONF,
  RELEASE_SECRETS,
  REHEARSAL_MESSAGE,
  RELEASE_KEEP,
  releaseConfProblems,
  runWorkerChecks,
  TAG_VERIFY_TOKEN_MESSAGE,
  TAG_VERIFY_VIA,
  tagProblems,
  tagVerifyProblem,
  tagVerifyViaMessage,
  verifyPlan,
  WORKER_CHECKS,
  WORKER_SECRETS,
  workerMissingMessage,
  parseSecretNames,
  secretCheck,
  WORKER_CHECK_DEFAULTS,
  WORKER_LIMITS,
  WORKER_REQUIRED_SECRETS,
  workerDeploySteps,
  workerWorstCaseMs,
  wranglerDeployArgs,
  wranglerEnv,
  wranglerSecretListArgs,
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

test('prune·worker의 설정 없음 메시지는 업로드용 preflight 문구를 쓰지 않고 종류(시크릿·변수)를 적는다', () => {
  assert.equal(pruneMissingMessage(['R2_BUCKET']), 'prune: R2 설정 없음(시크릿·변수): R2_BUCKET. 지우지 않는다');
  assert.equal(workerMissingMessage(['CLOUDFLARE_API_TOKEN', 'R2_BUCKET']), 'Worker 배포 설정 없음(시크릿·변수): CLOUDFLARE_API_TOKEN, R2_BUCKET. 배포하지 않는다');
  // R2_BUCKET은 저장소 변수지만(cicd.md §8) 배포 모드가 S3로 latest.json을 읽으므로 함께 본다
  assert.ok(WORKER_SECRETS.includes('R2_BUCKET'));
  for (const m of [pruneMissingMessage(['x']), workerMissingMessage(['x'])]) assert.ok(!m.includes('업로드') && !m.includes('시크릿 없음'), m);
});

test('preflight: 정확한 메시지, 리허설은 시크릿이 있어도 멈춘다', () => {
  assert.equal(
    preflightMessage(['R2_BUCKET', 'DIST_BASE_URL']),
    '릴리스 시크릿 없음: R2_BUCKET, DIST_BASE_URL. 빌드·설치 스모크·수집·서명·매니페스트(가짜 S3, stage)까지는 통과, 업로드하지 않음',
  );
  assert.deepEqual(preflight({ RELEASE_MODE: 'tag' }).missing, RELEASE_SECRETS);
  const all = { ...Object.fromEntries(RELEASE_SECRETS.map((n) => [n, 'x'])), DIST_BASE_URL: 'https://dist.example.test' };
  const tagOk = { VERIFY_VIA: 'worker', CI_VERIFY_TOKEN: 'x' };
  assert.equal(preflight({ ...all, ...tagOk, RELEASE_MODE: 'tag' }).code, 0);
  // 태그는 VERIFY_VIA=worker·CI_VERIFY_TOKEN까지(dry·리허설은 보지 않는다)
  assert.deepEqual(preflight({ ...all, RELEASE_MODE: 'tag' }), { code: 1, message: `${tagVerifyViaMessage(undefined)}. 업로드하지 않음`, missing: [] });
  assert.deepEqual(preflight({ ...all, VERIFY_VIA: 'worker', RELEASE_MODE: 'tag' }), { code: 1, message: `${TAG_VERIFY_TOKEN_MESSAGE}. 업로드하지 않음`, missing: [] });
  assert.equal(preflight({ ...all, VERIFY_VIA: 's3', RELEASE_MODE: 'dry' }).code, 0);
  assert.equal(preflight({ ...all, RELEASE_MODE: 'dry' }).code, 0);
  assert.equal(preflight({ ...all, RELEASE_MODE: 'rehearsal' }).message, REHEARSAL_MESSAGE);
  assert.equal(preflight({ ...all, RELEASE_MODE: '' }).code, 1);
  assert.deepEqual(preflight({ ...all, R2_BUCKET: '', RELEASE_MODE: 'tag' }).missing, ['R2_BUCKET']);
});

test('preflight: DIST_BASE_URL은 경로 없는 https 출처(값은 메시지에 없다), 리허설 판정이 먼저', () => {
  const all = { ...Object.fromEntries(RELEASE_SECRETS.map((n) => [n, 'x'])), DIST_BASE_URL: 'https://dist.example.test' };
  for (const bad of ['x', 'http://dist.example.test', 'https://dist.example.test/', 'https://dist.example.test/releases', 'https://u:p@dist.example.test', 'https://DIST.example.test']) {
    for (const RELEASE_MODE of ['tag', 'dry']) {
      const r = preflight({ ...all, DIST_BASE_URL: bad, RELEASE_MODE });
      assert.equal(preflight({ ...all, VERIFY_VIA: 'worker', CI_VERIFY_TOKEN: 'x', DIST_BASE_URL: bad, RELEASE_MODE }).message, r.message);
      assert.equal(r.code, 1, `${RELEASE_MODE} ${bad}`);
      assert.equal(r.message, 'DIST_BASE_URL은 경로 없는 https 출처여야 한다(값은 찍지 않는다)');
      assert.deepEqual(r.missing, []);
      assert.ok(!r.message.includes('example.test'));
    }
    // 리허설은 값이 틀려도 리허설 메시지다(업로드 경계가 먼저)
    assert.equal(preflight({ ...all, DIST_BASE_URL: bad, RELEASE_MODE: 'rehearsal' }).message, REHEARSAL_MESSAGE);
  }
  // 없으면 시크릿 없음 메시지가 먼저
  assert.deepEqual(preflight({ ...all, DIST_BASE_URL: '', RELEASE_MODE: 'tag' }).missing, ['DIST_BASE_URL']);
});

const SECRET_REF = '${{ secrets.DIST_BASE_URL }}';
const BUILD_STEP_REF = "${{ needs.gate.outputs.mode == 'tag' && secrets.DIST_BASE_URL || '' }}";

test('워크플로: DIST_BASE_URL은 저장소 secret, R2_BUCKET은 저장소 변수(cicd.md 구현 중 변경 82 (다)·84)', () => {
  for (const f of ['release.yml', 'rollback.yml']) {
    const t = readFileSync(join(ROOT, '.github/workflows', f), 'utf8');
    assert.ok(!/vars\.DIST_BASE_URL/.test(t), `${f}: vars.DIST_BASE_URL`);
    assert.ok(!/secrets\.R2_BUCKET/.test(t), `${f}: secrets.R2_BUCKET`);
    for (const m of t.matchAll(/^\s+DIST_BASE_URL: (.+)$/gm)) assert.ok([SECRET_REF, BUILD_STEP_REF].includes(m[1]), `${f}: ${m[1]}`);
    for (const m of t.matchAll(/^\s+R2_BUCKET: (.+)$/gm)) assert.equal(m[1], '${{ vars.R2_BUCKET }}', f);
  }
  // 값이 있는 곳: 업로드·확인·되돌리기·배포 뒤 검사·보존 상한이 읽는 작업 전부
  const rel = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  assert.equal([...rel.matchAll(/^\s+DIST_BASE_URL: \$\{\{ secrets\.DIST_BASE_URL \}\}$/gm)].length, 4);
  // 빌드 단계(build-linux·build): 태그일 때만 secret을 받는다(A2). rollback.yml에는 없다
  assert.equal([...rel.matchAll(/^\s+DIST_BASE_URL: \$\{\{ needs\.gate\.outputs\.mode == 'tag' && secrets\.DIST_BASE_URL \|\| '' \}\}$/gm)].length, 2);
  // 주소는 release.mjs build가 정한다: 어떤 워크플로에도 CHZZK_WORKER_BASE가 없고 ci.yml은 secret을 쓰지 않는다
  for (const f of ['release.yml', 'rollback.yml', 'ci.yml']) {
    assert.ok(!readFileSync(join(ROOT, '.github/workflows', f), 'utf8').includes('CHZZK_WORKER_BASE'), `${f}: CHZZK_WORKER_BASE`);
  }
  assert.ok(!readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8').includes('secrets.DIST_BASE_URL'));
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
  // secret list 출력 주입과 prune 목록 페이지 크기(잘림 시험용)도 dry에서만
  assert.ok(DRY_OVERRIDES.includes('WORKER_SECRET_LIST'));
  assert.ok(DRY_OVERRIDES.includes('XTASK_LIST_MAX_KEYS'));
  for (const n of DRY_OVERRIDES) assert.equal(boundaryProblems({ RELEASE_MODE: 'tag', [n]: 'x' }).length, 1, n);
  for (const e of ['http://127.0.0.1:9000', 'http://localhost:1', 'http://[::1]:65535']) assert.deepEqual(boundaryProblems({ RELEASE_MODE: 'dry', R2_ENDPOINT: e }), [], e);
  for (const e of ['', 'https://127.0.0.1:9000', 'http://127.0.0.1.evil:9000', 'https://acct.r2.cloudflarestorage.com', 'http://10.0.0.1:9000']) {
    assert.equal(boundaryProblems({ RELEASE_MODE: 'dry', R2_ENDPOINT: e }).length, 1, e);
  }
  assert.equal(boundaryProblems({ RELEASE_MODE: 'rehearsal' }).length, 1);
  assert.equal(boundaryProblems({}).length, 1);
});

test('tagVerifyProblem: tag만 VERIFY_VIA=worker(정확히)와 CI_VERIFY_TOKEN을 요구한다(cicd.md 구현 중 변경 104)', () => {
  assert.equal(TAG_VERIFY_VIA, 'worker');
  for (const env of [{}, { RELEASE_MODE: 'dry' }, { RELEASE_MODE: 'dry', VERIFY_VIA: 's3' }, { RELEASE_MODE: 'rehearsal' }, { RELEASE_MODE: 'tag', VERIFY_VIA: 'worker', CI_VERIFY_TOKEN: 't' }]) {
    assert.equal(tagVerifyProblem(env), null, JSON.stringify(env));
  }
  for (const v of [undefined, '', 's3', 'Worker', 'WORKER', 'worker ', ' worker']) {
    assert.equal(tagVerifyProblem({ RELEASE_MODE: 'tag', VERIFY_VIA: v, CI_VERIFY_TOKEN: 't' }), tagVerifyViaMessage(v), JSON.stringify(v));
  }
  for (const t of [undefined, '']) assert.equal(tagVerifyProblem({ RELEASE_MODE: 'tag', VERIFY_VIA: 'worker', CI_VERIFY_TOKEN: t }), TAG_VERIFY_TOKEN_MESSAGE);
  // 둘 다 틀리면 VERIFY_VIA가 먼저
  assert.equal(tagVerifyProblem({ RELEASE_MODE: 'tag', VERIFY_VIA: 's3' }), tagVerifyViaMessage('s3'));
  // 값은 32자로 자르고, 토큰 값은 어떤 메시지에도 없다
  const long = tagVerifyViaMessage('x'.repeat(100));
  assert.ok(long.includes('x'.repeat(32)) && !long.includes('x'.repeat(33)));
  assert.ok(!String(tagVerifyProblem({ RELEASE_MODE: 'tag', VERIFY_VIA: 's3', CI_VERIFY_TOKEN: 'tok-SECRET-1' })).includes('tok-SECRET'));
  assert.ok(!TAG_VERIFY_TOKEN_MESSAGE.includes('tok-SECRET'));
});

test('release.mjs 진입점: tag 모드 preflight는 1(업로드 전), verify는 xtask 전에 2(되돌리지 않음)', async () => {
  const secrets = { ...Object.fromEntries(RELEASE_SECRETS.map((n) => [n, 'x'])), DIST_BASE_URL: 'https://dist.example.test' };
  const run = (cmd, extra) =>
    spawnSync(process.execPath, [join(ROOT, 'scripts/ci/release.mjs'), cmd], {
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, RELEASE_MODE: 'tag', ...secrets, ...extra },
      encoding: 'utf8',
    });
  const lines = (r) => r.stderr.split('\n');
  const s3 = run('preflight', { VERIFY_VIA: 's3', CI_VERIFY_TOKEN: 'tok' });
  assert.equal(s3.status, 1);
  assert.ok(lines(s3).includes(`::error::${tagVerifyViaMessage('s3')}. 업로드하지 않음`), s3.stderr);
  assert.equal(run('preflight', { CI_VERIFY_TOKEN: 'tok' }).status, 1);
  const noTok = run('preflight', { VERIFY_VIA: 'worker' });
  assert.equal(noTok.status, 1);
  assert.ok(lines(noTok).includes(`::error::${TAG_VERIFY_TOKEN_MESSAGE}. 업로드하지 않음`), noTok.stderr);
  // 변수가 모두 맞으면 Worker 프로브까지 간다. 잡았다 닫은 루프백 포트(https, DNS 없음)라 연결 거부로 1(업로드 전), 출력에 주소·토큰이 없다
  const gone = await probeServer(200);
  await gone.close();
  const ok = run('preflight', { VERIFY_VIA: 'worker', CI_VERIFY_TOKEN: 'tok-SECRET-probe', DIST_BASE_URL: gone.base.replace('http:', 'https:') });
  assert.equal(ok.status, 1, ok.stderr);
  assert.match(ok.stdout, /preflight: 시크릿·변수 모두 있음/);
  assert.ok(lines(ok).includes('::error::태그 릴리스 Worker 프로브 실패(ECONNREFUSED): Worker에 닿지 못했다. 업로드하지 않음'), ok.stderr);
  assert.ok(!/127\.0\.0\.1|example\.test|tok-SECRET/.test(ok.stdout + ok.stderr), ok.stderr);
  // verify: 방어 검사는 경계·xtask보다 먼저(xtask를 찾지 않는다)
  const v = run('verify', { VERIFY_VIA: 's3', CI_VERIFY_TOKEN: 'tok' });
  assert.equal(v.status, 2);
  assert.ok(lines(v).includes(`::error::release: verify: ${tagVerifyViaMessage('s3')} — 판정이 아니므로 되돌리지 않는다`), v.stderr);
  assert.ok(!v.stderr.includes('xtask'), v.stderr);
  // 통과하면 다음 경계(미리 빌드한 xtask 없음)까지 간다
  const v2 = run('verify', { VERIFY_VIA: 'worker', CI_VERIFY_TOKEN: 'tok' });
  assert.equal(v2.status, 2);
  assert.match(v2.stderr, /tag 모드는 미리 빌드한 xtask/);
  // 시크릿 없음이 VERIFY_VIA보다 먼저(1, preflight 문구)
  const bare = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/release.mjs'), 'verify'], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, RELEASE_MODE: 'tag', VERIFY_VIA: 's3' }, encoding: 'utf8' });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /릴리스 시크릿 없음/);
});

// 루프백 http 서버 하나(상태 고정 또는 응답 없음) → { base, close }
const probeServer = (status) =>
  new Promise((res) => {
    const seen = [];
    const s = createServer((req, r) => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization });
      if (status === null) return; // 응답하지 않는다(시간 초과)
      r.writeHead(status, status === 302 ? { location: 'http://127.0.0.1:1/' } : {});
      r.end('{"secret-body":"tok-SECRET"}');
    });
    s.listen(0, '127.0.0.1', () => res({ base: `http://127.0.0.1:${s.address().port}`, seen, close: () => new Promise((d) => s.closeAllConnections() || s.close(d)) }));
  });

test('probeVerifyWorker: 200·404만 통과, 401·403·5xx·3xx·연결 거부·시간 초과는 실패(cicd.md 구현 중 변경 104 (가))', async () => {
  const token = 'tok-SECRET-probe';
  for (const [status, code] of [[200, 0], [404, 0], [401, 1], [403, 1], [500, 1], [503, 1], [302, 1], [204, 1]]) {
    const s = await probeServer(status);
    try {
      const r = await probeVerifyWorker({ base: s.base, token });
      assert.equal(r.code, code, String(status));
      assert.equal(r.status, status);
      assert.deepEqual(s.seen, [{ method: 'GET', url: '/releases/latest.json', auth: `Bearer ${token}` }]);
      if (code) assert.match(r.message, new RegExp(`^태그 릴리스 Worker 프로브 실패\\(HTTP ${status}\\)`));
      if (status === 401 || status === 403) assert.match(r.message, /토큰이 Worker secret과 다르다/);
      assert.ok(!/127\.0\.0\.1|tok-SECRET|secret-body/.test(JSON.stringify(r)), JSON.stringify(r));
    } finally {
      await s.close();
    }
  }
  // 연결 거부: 포트를 잡았다 닫는다
  const gone = await probeServer(200);
  await gone.close();
  const refused = await probeVerifyWorker({ base: gone.base, token });
  assert.equal(refused.code, 1);
  assert.equal(refused.cause, 'ECONNREFUSED');
  assert.ok(!/127\.0\.0\.1|tok-SECRET/.test(JSON.stringify(refused)));
  // 시간 초과
  const hang = await probeServer(null);
  try {
    const t = await probeVerifyWorker({ base: hang.base, token, timeoutMs: 200 });
    assert.equal(t.code, 1);
    assert.equal(t.cause, 'TimeoutError');
    assert.match(t.message, /Worker에 닿지 못했다/);
  } finally {
    await hang.close();
  }
});

test('probeVerifyWorker: 가짜 Worker(worker-stub)와 계약 — 맞는 토큰 200 통과, 틀린 토큰 401 실패', async () => {
  const { server } = createWorkerStub({ token: 'tok-right', version: '1.2.0', build: 'abc1234' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await probeVerifyWorker({ base, token: 'tok-right' }), { code: 0, status: 200 });
    const bad = await probeVerifyWorker({ base, token: 'tok-wrong' });
    assert.equal(bad.code, 1);
    assert.equal(bad.status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('release.yml: VERIFY_VIA는 변수 그대로 preflight·publish·verify에, stage·rollback에는 없다', () => {
  const rel = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const block = (id) => new RegExp(`^ {2}${id}:\\n(?:(?: {4}|\\n).*\\n)+`, 'm').exec(rel)?.[0] ?? '';
  const vals = [...rel.matchAll(/^\s+VERIFY_VIA: (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(vals, ['${{ vars.VERIFY_VIA }}', '${{ vars.VERIFY_VIA }}', '${{ vars.VERIFY_VIA }}']);
  const sp = block('sign-publish');
  const pre = sp.slice(sp.indexOf('name: release-preflight'), sp.indexOf('name: release-publish'));
  const pub = sp.slice(sp.indexOf('name: release-publish'));
  const ver = block('verify');
  for (const [name, t] of [['preflight', pre], ['publish', pub], ['verify', ver]]) {
    assert.ok(t.length > 0, name);
    assert.match(t, /RELEASE_MODE: tag\n/, name);
    assert.match(t, /VERIFY_VIA: \$\{\{ vars\.VERIFY_VIA \}\}/, name);
    assert.match(t, /CI_VERIFY_TOKEN: \$\{\{ secrets\.CI_VERIFY_TOKEN \}\}/, name);
  }
  const stage = block('stage');
  assert.ok(stage.length > 0 && !/VERIFY_VIA|CI_VERIFY_TOKEN/.test(stage), '리허설·stage는 바꾸지 않는다');
  assert.ok(!/VERIFY_VIA/.test(readFileSync(join(ROOT, '.github/workflows/rollback.yml'), 'utf8')));
});

// 보존 상한 prune의 지울 목록(release.mjs prunePlan). 키는 releases/<v>/…(버전 폴더)와 releases/latest.json이다
const dirKeys = (vs) => ['releases/latest.json', ...vs.flatMap((v) => [`releases/${v}/SHA256SUMS`, `releases/${v}/manifest.json`])];
const range = (a, b, major = 1) => Array.from({ length: b - a + 1 }, (_, i) => `${major}.${a + i}.0`);

test('prune 판정: latest 이하 최신 5개 ∪ latest ∪ previous ∪ latest보다 높은 폴더를 남기고 나머지를 오래된 것부터 지운다', () => {
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
    // latest보다 높은 폴더는 rollback.yml로 다시 올릴 수 있는 버전이라 지우지 않고, 5개 자리로도 세지 않는다
    { name: '낮은 버전이 latest(되돌린 뒤)면 높은 폴더는 모두 남긴다', vs: range(0, 7), latest: '1.1.0', prev: 'none', del: [] },
    { name: '판정 실패로 남은 높은 폴더는 자리를 차지하지 않는다', vs: range(0, 6), latest: '1.5.0', prev: '1.4.0', del: ['1.0.0'] },
    { name: '높은 폴더가 여럿이어도 latest 이하에서 5개', vs: [...range(0, 7), '2.0.0', '2.1.0-rc.1'], latest: '1.7.0', prev: '1.6.0', del: ['1.0.0', '1.1.0', '1.2.0'] },
  ];
  for (const r of rows) {
    const plan = prunePlan({ keys: dirKeys(r.vs), latest: r.latest, previous: r.prev, ...(r.keep ? { keep: r.keep } : {}) });
    assert.equal(plan.abort, undefined, r.name);
    assert.deepEqual(plan.delete, r.del, r.name);
    // 남기는 것과 지우는 것은 겹치지 않고 합치면 전부다. latest·previous(목록에 있으면)는 늘 남는다
    assert.deepEqual([...plan.keep, ...plan.delete].sort(), [...r.vs].sort(), r.name);
    assert.ok(plan.keep.includes(r.latest), r.name);
    // 지우는 버전은 모두 latest보다 낮다
    for (const v of plan.delete) assert.ok(cmpSemver(v, r.latest) < 0, `${r.name}: ${v}`);
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

// ---- 배포 뒤 검사(worker.md §9.4, cicd.md 구현 중 변경 81·96) ----

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
    ['releases-latest-ci', R(200, { version: '1.2.0' }), 'pass'],
    ['releases-latest-ci', R(200, { version: '1.1.0' }), 'fail'],
    ['releases-latest-ci', R(401), 'fail'],
    ['releases-latest-ci', R(403), 'fail'],
    ['releases-latest-ci', R(503), 'retry'],
    ['neg-update-garbage', R(401), 'pass'],
    ['neg-update-garbage', R(200, { version: '1.2.0' }), 'fail'],
    ['neg-update-garbage', R(204), 'fail'],
    ['neg-update-garbage', R(400), 'fail'],
    ['neg-update-garbage', R(500), 'retry'],
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
  assert.equal(judgeCheck('releases-latest-ci', { status: 200, body: bytes }, { ...CTX, latestBytes: bytes }), 'pass');
  assert.equal(judgeCheck('releases-latest-ci', R(200, '{"version":"1.2.0"}'), { ...CTX, latestBytes: bytes }), 'fail');
  assert.throws(() => judgeCheck('nope', R(200), CTX));
});

// worker/test/deploy-contract.mjs 한 표: 진짜 Worker는 worker/test/http/update.test.ts가, 여기서는 release.mjs와 가짜 Worker를 본다
test('배포 뒤 검사 계약: WORKER_CHECKS = 표의 deploy 행, 가짜 Worker는 표의 모든 행을 지키고 judgeCheck는 그 응답을 통과로 본다', async () => {
  const V = '1.2.0';
  assert.equal(GARBAGE_BEARER, CONTRACT_GARBAGE);
  assert.deepEqual(
    WORKER_CHECKS.map((c) => ({ id: c.id, path: c.path(V), cred: c.cred })),
    DEPLOY_CONTRACT.filter((r) => r.deploy).map((r) => ({ id: r.id, path: contractPath(r, V), cred: r.cred })),
  );
  const { server, latest } = createWorkerStub({ token: 'tok-secret', version: V, build: 'abc1234' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { ci: { authorization: 'Bearer tok-secret' }, garbage: { authorization: `Bearer ${CONTRACT_GARBAGE}` }, none: {} };
    for (const row of DEPLOY_CONTRACT) {
      const r = await fetch(base + contractPath(row, V), { redirect: 'manual', headers: { ...headers[row.cred], connection: 'close' } });
      const body = Buffer.from(await r.arrayBuffer());
      const name = `${row.id} ${row.cred} ${row.path}`;
      if (row.notOk) assert.ok(r.status < 200 || r.status > 299, name);
      else assert.equal(r.status, row.status, name);
      if (row.location !== undefined) assert.equal(r.headers.get('location'), row.location, name);
      if (row.body === 'latest') assert.equal(body.toString('utf8'), latest, name);
      if (row.code !== undefined) assert.deepEqual(JSON.parse(body.toString('utf8')), { code: row.code }, name);
      if (row.status === 204) assert.equal(body.length, 0, name);
      if (row.deploy) assert.equal(judgeCheck(row.id, { status: r.status, body }, { version: V, build: null, latestBytes: Buffer.from(latest) }), 'pass', name);
    }
  } finally {
    server.close();
  }
});

// 가짜 fetch: 경로 → 응답 목록(차례로, 마지막은 반복). 호출을 기록한다
function fakeFetch(table) {
  const calls = [];
  const idx = {};
  const impl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ url, init, path });
    // "<자격> <경로>" 행이 있으면 그것을, 없으면 경로 행을 쓴다(자격: ci = Bearer tok-secret, garbage = 다른 Bearer, none)
    const a = init.headers.authorization;
    const cred = a === undefined ? 'none' : a === 'Bearer tok-secret' ? 'ci' : 'garbage';
    const key = table[`${cred} ${path}`] ? `${cred} ${path}` : path;
    const list = table[key];
    const r = list[Math.min(idx[key] ?? 0, list.length - 1)];
    idx[key] = (idx[key] ?? 0) + 1;
    if (r.error) throw Object.assign(new Error(`connect to dist.example.test failed ${r.error}`), { cause: { code: r.error } });
    return { status: r.status, arrayBuffer: async () => Buffer.from(r.body ?? '') };
  };
  return { impl, calls };
}
const OK_TABLE = () => ({
  '/health': [{ status: 200, body: JSON.stringify({ ok: true, build: 'abc1234' }) }],
  '/update/0.0.0': [{ status: 200, body: JSON.stringify({ version: '1.2.0' }) }],
  'garbage /update/0.0.0': [{ status: 401 }],
  '/update/1.2.0': [{ status: 204 }],
  '/admin': [{ status: 303 }],
  '/releases/latest.json': [{ status: 401 }],
  'ci /releases/latest.json': [{ status: 200, body: JSON.stringify({ version: '1.2.0' }) }],
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
  const garbage = r.f.calls.filter((c) => c.init.headers.authorization === `Bearer ${GARBAGE_BEARER}`).map((c) => c.path);
  assert.deepEqual(garbage, ['/update/0.0.0']);
  for (const c of r.f.calls.filter((x) => x.init.headers.authorization && !garbage.includes(x.path))) assert.equal(c.init.headers.authorization, 'Bearer tok-secret');
  assert.equal(r.f.calls.filter((x) => x.init.headers.authorization === 'Bearer tok-secret').length, 5);
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
  assert.equal(r1.results.length, 8);

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

test('buildWorkerBase: 모드 × 값 표(cicd 82 (나), A2)', () => {
  const D = 'https://dist.example.test';
  const rows = [
    [{ RELEASE_MODE: 'tag', DIST_BASE_URL: D }, D, null],
    [{ RELEASE_MODE: 'tag', DIST_BASE_URL: WORKER_PLACEHOLDER }, WORKER_PLACEHOLDER, '자리표시'],
    [{ RELEASE_MODE: 'tag', DIST_BASE_URL: 'https://w.foo.invalid' }, 'https://w.foo.invalid', '자리표시'],
    [{ RELEASE_MODE: 'tag' }, '', 'DIST_BASE_URL이 없다'],
    [{ RELEASE_MODE: 'tag', DIST_BASE_URL: '' }, '', 'DIST_BASE_URL이 없다'],
    [{ RELEASE_MODE: 'tag', DIST_BASE_URL: `${D}/x` }, `${D}/x`, 'https 출처'],
    [{ RELEASE_MODE: 'tag', DIST_BASE_URL: 'http://dist.example.test' }, 'http://dist.example.test', 'https 출처'],
    [{ RELEASE_MODE: 'rehearsal' }, WORKER_PLACEHOLDER, null],
    [{ RELEASE_MODE: 'rehearsal', DIST_BASE_URL: D }, WORKER_PLACEHOLDER, null],
    [{ RELEASE_MODE: 'rehearsal', CHZZK_WORKER_BASE: D }, D, null],
    [{}, WORKER_PLACEHOLDER, null],
  ];
  for (const [env, base, why] of rows) {
    const r = buildWorkerBase(env);
    assert.equal(r.base, base, JSON.stringify(env));
    if (why) assert.ok(r.problems.join(' ').includes(why), `${JSON.stringify(env)}: ${r.problems}`);
    else assert.deepEqual(r.problems, [], JSON.stringify(env));
    assert.ok(!r.problems.join(' ').includes('example.test') && !r.problems.join(' ').includes('foo'), '문제 문구에 값이 없다');
  }
});

test('binaryWorkerBaseProblems: 태그 빌드 원본 바이너리에 주소가 있고 자리표시가 없어야 한다', () => {
  const D = 'https://dist.example.test';
  const tag = { mode: 'tag', base: D };
  assert.deepEqual(binaryWorkerBaseProblems(Buffer.from(`xx${D}yy`), tag), []);
  const missing = binaryWorkerBaseProblems(Buffer.from(`xx${D}yy`), { mode: 'tag', base: 'https://other.example.test' });
  assert.equal(missing.length, 1);
  assert.ok(missing[0].includes('없다'));
  const placeholder = binaryWorkerBaseProblems(Buffer.from(`${D} worker.example.invalid`), tag);
  assert.equal(placeholder.length, 1);
  assert.ok(placeholder[0].includes('자리표시'));
  assert.deepEqual(binaryWorkerBaseProblems(Buffer.from('아무거나'), { mode: 'other', base: WORKER_PLACEHOLDER }), []);
  for (const p of [...missing, ...placeholder]) assert.ok(!p.includes('example.test'), '문제 문구에 값이 없다');
});

test('WORKER_PLACEHOLDER는 build.rs 릴리스 규칙을 통과하는 정규 출처다', () => {
  assert.equal(WORKER_PLACEHOLDER, 'https://worker.example.invalid');
  assert.deepEqual(distBaseProblems(WORKER_PLACEHOLDER), []);
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
  // Worker 배포는 저장소 공용 그룹에서 줄 서고, 진행 중인 배포를 취소하지 않는다(worker.md 구현 중 변경 36)
  assert.match(dw, /^ {4}concurrency:\n {6}group: worker-deploy\n {6}cancel-in-progress: false\n/m);
  // 작업 timeout은 release.mjs worker의 최악 시간 + 준비 여유(5분)보다 크다
  const tm = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(dw)?.[1]);
  assert.ok(tm * 60_000 > workerWorstCaseMs() + 5 * 60_000, `timeout-minutes ${tm} vs 최악 ${workerWorstCaseMs()}ms`);
});

test('workerWorstCaseMs: 상한 합(기본값 1438초)이고 요청·하위 프로세스 상한을 모두 센다', () => {
  assert.equal(workerWorstCaseMs(), 1_438_000);
  assert.equal(WORKER_CHECKS.length, 7);
  // 한 상한을 늘리면 최악 시간도 그만큼 는다(빠뜨린 항이 없다)
  for (const [k, n] of [['s3ReadMs', 3], ['extractMs', 1], ['secretListMs', 1], ['deployMs', 1], ['requestMs', 1 + 7 * WORKER_CHECK_DEFAULTS.attempts]]) {
    assert.equal(workerWorstCaseMs(WORKER_CHECK_DEFAULTS, { ...WORKER_LIMITS, [k]: WORKER_LIMITS[k] + 1 }) - workerWorstCaseMs(), n, k);
  }
  assert.equal(workerWorstCaseMs({ ...WORKER_CHECK_DEFAULTS, deadlineMs: WORKER_CHECK_DEFAULTS.deadlineMs + 1 }) - workerWorstCaseMs(), 1);
});

test('secret list: 인자는 묶음 설정의 이름만(json), 출력은 줄 머리 배열을 찾고 형식이 틀리면 error', () => {
  assert.deepEqual(wranglerSecretListArgs(), ['secret', 'list', '--config', 'dist/wrangler.json', '--format', 'json']);
  const j = (names) => JSON.stringify(names.map((name) => ({ name, type: 'secret_text' })), null, '  ');
  assert.deepEqual(parseSecretNames(j(['A', 'B'])), { names: ['A', 'B'] });
  assert.deepEqual(parseSecretNames('[]'), { names: [] });
  // 앞뒤 안내 줄(대괄호가 있어도)은 건너뛴다
  assert.deepEqual(parseSecretNames(`▲ [WARNING] x\n[note] y\n${j(['A'])}\n끝\n`), { names: ['A'] });
  for (const bad of ['', 'nope', '{"name":"A"}', '[1,2]', '[{"type":"secret_text"}]', '[{"name":3}]', '[\n{"name":"A"']) assert.ok(parseSecretNames(bad).error, bad);
  assert.deepEqual(WORKER_REQUIRED_SECRETS, ['CHZZK_CLIENT_ID', 'CHZZK_CLIENT_SECRET', 'CI_VERIFY_TOKEN']);
  assert.deepEqual(secretCheck([...WORKER_REQUIRED_SECRETS, 'ADMIN_CHANNEL_IDS']), { missing: [], bootstrap: false });
  // ADMIN_CHANNEL_IDS가 없으면 부트스트랩(§8.3): 필수가 아니다
  assert.deepEqual(secretCheck(WORKER_REQUIRED_SECRETS), { missing: [], bootstrap: true });
  assert.deepEqual(secretCheck(['CHZZK_CLIENT_ID', 'OTHER']), { missing: ['CHZZK_CLIENT_SECRET', 'CI_VERIFY_TOKEN'], bootstrap: true });
});

// 배포 순서(묶음 확인 뒤): 가짜 의존성으로 secret 확인·latest 다시 읽기·배포·검사·실패 뒤 다시 읽기를 본다
const latestOf = (v) => ({ code: 0, data: Buffer.from(JSON.stringify({ version: v })) });
function deployHarness({ secrets = [...WORKER_REQUIRED_SECRETS, 'ADMIN_CHANNEL_IDS'], listStatus = 0, listOut, reads = [latestOf('1.3.0')], deployCode = 0, checkCode = 0, dryRun = false } = {}) {
  const calls = { list: 0, read: 0, deploy: 0, checks: [] };
  const out = [];
  const q = [...reads];
  const run = workerDeploySteps({
    version: '1.3.0',
    dryRun,
    listSecrets: () => {
      calls.list++;
      return { status: listStatus, stdout: listOut ?? JSON.stringify(secrets.map((name) => ({ name, type: 'secret_text' }))) };
    },
    readLatest: () => {
      calls.read++;
      return q.length > 1 ? q.shift() : q[0];
    },
    deploy: () => {
      calls.deploy++;
      return deployCode;
    },
    checks: async (bytes) => {
      calls.checks.push(bytes && JSON.parse(bytes.toString()).version);
      return { code: checkCode };
    },
    emit: (kind, m) => out.push(`${kind}: ${m}`),
  });
  return run.then((code) => ({ code, calls, out: out.join('\n') }));
}

test('workerDeploySteps: 정상은 secret 확인 → 다시 읽기 → 배포 → 검사(다시 읽은 바이트로) 0', async () => {
  const r = await deployHarness();
  assert.equal(r.code, 0);
  assert.deepEqual({ list: r.calls.list, read: r.calls.read, deploy: r.calls.deploy }, { list: 1, read: 1, deploy: 1 });
  assert.deepEqual(r.calls.checks, ['1.3.0']);
  assert.equal(r.out, '');
});

test('workerDeploySteps: secret이 없으면 배포하지 않는다(필수 없음 1·목록 실패 2·출력 이상 2), ADMIN_CHANNEL_IDS만 없으면 경고 뒤 배포', async () => {
  let r = await deployHarness({ secrets: ['CHZZK_CLIENT_ID', 'ADMIN_CHANNEL_IDS'] });
  assert.equal(r.code, 1);
  assert.equal(r.calls.deploy + r.calls.read, 0);
  assert.match(r.out, /^error: .*Worker secret 없음: CHZZK_CLIENT_SECRET, CI_VERIFY_TOKEN\./m);
  assert.doesNotMatch(r.out, /CHZZK_CLIENT_ID|ADMIN_CHANNEL_IDS/);
  r = await deployHarness({ listStatus: 1 });
  assert.equal(r.code, 2);
  assert.equal(r.calls.deploy, 0);
  assert.match(r.out, /secret list 실패\(exit 1\)/);
  r = await deployHarness({ listOut: 'Error: not json' });
  assert.equal(r.code, 2);
  assert.equal(r.calls.deploy, 0);
  assert.doesNotMatch(r.out, /not json/, '출력 내용은 싣지 않는다');
  r = await deployHarness({ secrets: WORKER_REQUIRED_SECRETS });
  assert.equal(r.code, 0);
  assert.equal(r.calls.deploy, 1);
  assert.match(r.out, /^warning: .*ADMIN_CHANNEL_IDS.*부트스트랩/m);
});

test('workerDeploySteps: 배포 직전 다시 읽기가 superseded면 배포 없이 0, 낮아졌으면 1, 읽지 못하면 2', async () => {
  let r = await deployHarness({ reads: [latestOf('1.4.0')] });
  assert.equal(r.code, 0);
  assert.equal(r.calls.deploy, 0);
  assert.equal(r.calls.checks.length, 0);
  assert.match(r.out, /^notice: release worker: 배포 직전에 다시 읽은 latest\.json이 더 높은 1\.4\.0다.*superseded/m);
  r = await deployHarness({ reads: [latestOf('1.2.0')] });
  assert.equal(r.code, 1);
  assert.equal(r.calls.deploy, 0);
  r = await deployHarness({ reads: [{ code: 1, data: null }] });
  assert.equal(r.code, 1, 'latest.json이 사라지면 not-promoted');
  assert.equal(r.calls.deploy, 0);
  r = await deployHarness({ reads: [{ code: 2, data: null }] });
  assert.equal(r.code, 2);
  assert.equal(r.calls.deploy, 0);
  // dry는 다시 읽기까지 하고 배포 전에 멈춘다
  r = await deployHarness({ dryRun: true });
  assert.equal(r.code, 0);
  assert.deepEqual({ read: r.calls.read, deploy: r.calls.deploy, checks: r.calls.checks.length }, { read: 1, deploy: 0, checks: 0 });
  r = await deployHarness({ dryRun: true, reads: [latestOf('1.4.0')] });
  assert.match(r.out, /superseded/);
});

test('workerDeploySteps: deploy 실패는 2(검사 없음), 검사 실패 뒤 다시 읽어 다른 태그가 승격됐으면 오류에 싣는다', async () => {
  let r = await deployHarness({ deployCode: 1 });
  assert.equal(r.code, 2);
  assert.equal(r.calls.checks.length, 0);
  r = await deployHarness({ checkCode: 1, reads: [latestOf('1.3.0'), latestOf('1.4.0')] });
  assert.equal(r.code, 1);
  assert.equal(r.calls.read, 2);
  assert.match(r.out, /^error: worker: 배포 뒤 검사 실패\. 다른 태그 1\.4\.0가 승격됐다/m);
  r = await deployHarness({ checkCode: 2, reads: [latestOf('1.3.0'), latestOf('1.3.0')] });
  assert.equal(r.code, 2);
  assert.doesNotMatch(r.out, /다른 태그/);
  r = await deployHarness({ checkCode: 1, reads: [latestOf('1.3.0'), { code: 2, data: null }] });
  assert.equal(r.code, 1, '다시 읽기 실패는 검사 결과를 바꾸지 않는다');
  assert.doesNotMatch(r.out, /다른 태그/);
});
