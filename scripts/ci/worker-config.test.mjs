// node --test scripts/ci/worker-config.test.mjs
// 저장소 worker/ 그대로는 통과하고, 씨앗(불변식 하나를 깬 사본)은 실패해야 한다. 사본은 이름을 정한 파일과 src/·test/·scripts/만
// 복사한다(worker/의 실제 비밀값 파일은 건드리지 않는다).
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { ROOT } from './gates.mjs';
import {
  allowedBuilds,
  checkCorePurity,
  checkStorePurity,
  checkDeployPackage,
  checkDevVarsExample,
  checkOutbound,
  checkReleaseSources,
  DELETE_ALLOWLIST,
  checkDist,
  checkPackage,
  checkRawAllowlist,
  checkSources,
  checkVitestConfig,
  checkWorker,
  checkSentinel,
  checkWrangler,
  configKeys,
  DEPLOY_MAIN,
  DEPLOY_PKG_NAME,
  deployConfig,
  EXPECTED_SCRIPTS,
  lockedVersions,
  main,
  OUTBOUND_ALLOWLIST,
  parseJsonc,
  plantSentinel,
  R2_ALLOWLIST,
  RELEASE_FILES,
  RAW_ALLOWLIST,
  scriptCommands,
  SENTINEL_TEXT,
  stripJsComments,
  stripJsonc,
} from './worker-config.mjs';

const W = join(ROOT, 'worker');
const read = (rel) => readFileSync(join(W, rel), 'utf8');
const WRANGLER = parseJsonc(read('wrangler.jsonc'));
const PKG = JSON.parse(read('package.json'));
const EXAMPLE = read('.dev.vars.example');
const KEYS = configKeys(read('src/config.ts'));
const VITEST = read('vitest.config.ts');
const TOOLS_WRANGLER = JSON.parse(readFileSync(join(ROOT, 'scripts/ci/tools.json'), 'utf8')).tools.wrangler.version;
const PM = JSON.parse(readFileSync(join(ROOT, 'app/package.json'), 'utf8')).packageManager;

const tmp = mkdtempSync(join(tmpdir(), 'worker-config-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

// 저장소 사본(이름을 정한 파일만). files로 덮어쓰고 null이면 지운다
let seq = 0;
function copy(files = {}) {
  const d = join(tmp, `r${seq++}`);
  const w = join(d, 'worker');
  mkdirSync(w, { recursive: true });
  for (const f of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'wrangler.jsonc', 'tsconfig.json', 'vitest.config.ts', '.dev.vars.example']) {
    cpSync(join(W, f), join(w, f));
  }
  for (const dir of ['src', 'test', 'scripts']) cpSync(join(W, dir), join(w, dir), { recursive: true });
  mkdirSync(join(w, 'deploy'), { recursive: true });
  for (const f of ['package.json', 'pnpm-lock.yaml']) cpSync(join(W, 'deploy', f), join(w, 'deploy', f));
  mkdirSync(join(d, 'scripts/ci'), { recursive: true });
  cpSync(join(ROOT, 'scripts/ci/tools.json'), join(d, 'scripts/ci/tools.json'));
  mkdirSync(join(d, 'app'), { recursive: true });
  cpSync(join(ROOT, 'app/package.json'), join(d, 'app/package.json'));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(d, rel);
    if (text === null) rmSync(p, { force: true });
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    }
  }
  return d;
}
const withWrangler = (patch) => JSON.stringify({ ...WRANGLER, ...patch }, null, 2);

test('저장소 worker/는 위반이 없다', () => {
  assert.deepEqual(checkWorker(ROOT), []);
});

test('사본도 위반이 없다(씨앗의 기준선)', () => {
  assert.deepEqual(checkWorker(copy()), []);
});

test('JSONC: 문자열 안의 // 는 남기고 주석·끝 쉼표를 지운다', () => {
  const text = '{\n  // 주석\n  "u": "https://a.example.test/x", /* 블록 */\n  "a": [1, 2,], // 끝\n}\n';
  assert.deepEqual(JSON.parse(stripJsonc(text)), { u: 'https://a.example.test/x', a: [1, 2] });
  assert.deepEqual(JSON.parse(stripJsonc('{"s": "a\\"//b", "t": 1 /* x */}')), { s: 'a"//b', t: 1 });
});

test('씨앗: wrangler.jsonc에 account_id를 넣으면 실패(gate 진입점으로)', () => {
  const d = copy({ 'worker/wrangler.jsonc': read('wrangler.jsonc').replace('"name": "chzzk-downloader",', '"name": "chzzk-downloader",\n  "account_id": "0123",') });
  assert.notDeepEqual(checkWorker(d), []);
  assert.ok(checkWorker(d).some((e) => e.includes('account_id')));
  // 진입점(run.mjs가 부르는 것과 같은 main)도 1
  const err = console.error;
  console.error = () => {};
  try {
    assert.equal(main(['--root', d]), 1);
    assert.equal(main(['--root', copy()]), 0);
  } finally {
    console.error = err;
  }
});

test('씨앗: wrangler.jsonc 불변식', () => {
  const seeds = [
    ['중첩 account_id', { r2_buckets: [{ binding: 'DIST', bucket_name: 'chzzk-downloader-dist', account_id: 'x' }] }],
    ['routes', { routes: [{ pattern: 'x.example.test/*' }] }],
    ['route', { route: 'x.example.test/*' }],
    ['zone_id', { zone_id: 'z' }],
    ['custom_domain', { observability: { enabled: true, logs: { invocation_logs: false }, custom_domain: true } }],
    ['레거시 migrations', { migrations: [{ tag: 'v1', new_sqlite_classes: ['AuthStore'] }] }],
    ['env 절', { env: { staging: {} } }],
    ['workers_dev false', { workers_dev: false }],
    ['preview_urls 없음', { preview_urls: undefined }],
    ['send_metrics true', { send_metrics: true }],
    ['DO 클래스 이름 바뀜', { exports: { Store: { type: 'durable-object', storage: 'sqlite' } } }],
    ['DO 바인딩 이름 바뀜', { durable_objects: { bindings: [{ name: 'STORE', class_name: 'AuthStore' }] } }],
    ['DO 저장소가 sqlite 아님', { exports: { AuthStore: { type: 'durable-object', storage: 'kv' } } }],
    ['R2 바인딩 둘', { r2_buckets: [{ binding: 'DIST', bucket_name: 'chzzk-downloader-dist' }, { binding: 'X', bucket_name: 'x' }] }],
    ['vars에 PUBLIC_ORIGIN', { vars: { ...WRANGLER.vars, PUBLIC_ORIGIN: 'http://localhost:8787' } }],
    ['vars에 START_RATE_10M', { vars: { ...WRANGLER.vars, START_RATE_10M: '1000' } }],
    ['vars에 BUILD_ID', { vars: { ...WRANGLER.vars, BUILD_ID: 'dev' } }],
    ['vars에 CHZZK_REDIRECT_URI', { vars: { ...WRANGLER.vars, CHZZK_REDIRECT_URI: 'http://localhost:8787/auth/callback' } }],
    ['vars에 비밀처럼 보이는 키', { vars: { ...WRANGLER.vars, CHZZK_CLIENT_SECRET: 'x' } }],
    ['vars 치지직 주소가 가짜', { vars: { ...WRANGLER.vars, CHZZK_API_BASE: 'http://127.0.0.1:8788' } }],
    ['invocation 로그 켬', { observability: { enabled: true, logs: { invocation_logs: true } } }],
    ['invocation 로그 키 없음', { observability: { enabled: true } }],
    ['모르는 최상위 키', { kv_namespaces: [] }],
    ['main 바뀜', { main: 'src/other.ts' }],
  ];
  for (const [name, patch] of seeds) {
    const cfg = JSON.parse(JSON.stringify({ ...WRANGLER, ...patch }));
    assert.notDeepEqual(checkWrangler(cfg), [], name);
  }
  assert.deepEqual(checkWrangler(WRANGLER), []);
  // 사본 경로로도 같은 판정
  assert.notDeepEqual(checkWorker(copy({ 'worker/wrangler.jsonc': withWrangler({ routes: ['x'] }) })), []);
  // CHZZK_REDIRECT_URI는 dev 전용이라 메시지에 그렇게 적는다
  const redirect = checkWrangler({ ...WRANGLER, vars: { ...WRANGLER.vars, CHZZK_REDIRECT_URI: 'http://localhost:8787/auth/callback' } });
  assert.ok(redirect.some((e) => e.includes('CHZZK_REDIRECT_URI') && e.includes('dev 전용')), JSON.stringify(redirect));
});

test('씨앗: package.json', () => {
  const opts = { wrangler: TOOLS_WRANGLER, packageManager: PM };
  assert.deepEqual(checkPackage(PKG, opts), []);
  assert.deepEqual(PKG.scripts, { ...PKG.scripts, ...EXPECTED_SCRIPTS });
  const s = (scripts) => ({ ...PKG, scripts: { ...PKG.scripts, ...scripts } });
  const seeds = [
    ['런타임 의존성', { ...PKG, dependencies: { hono: '4.0.0' } }],
    ['범위 버전', { ...PKG, devDependencies: { ...PKG.devDependencies, vitest: '^4.1.11' } }],
    ['wrangler ≠ tools.json', { ...PKG, devDependencies: { ...PKG.devDependencies, wrangler: '4.146.0' } }],
    ['packageManager 다름', { ...PKG, packageManager: 'pnpm@11.0.0' }],
    ['dev에 --env-file 없음', s({ dev: 'wrangler dev --config wrangler.jsonc --port 8787' })],
    ['dev 포트 8788', s({ dev: 'wrangler dev --config wrangler.jsonc --port 8788 --env-file .dev.vars.example' })],
    ['dev가 실제 비밀값 파일', s({ dev: 'wrangler dev --config wrangler.jsonc --port 8787 --env-file .dev.vars' })],
    ['dev에 --config 없음', s({ dev: 'wrangler dev --port 8787 --env-file .dev.vars.example' })],
    ['dev:real에 --env-file 없음', s({ 'dev:real': 'wrangler dev --config wrangler.jsonc --port 8787 --var PUBLIC_ORIGIN:http://localhost:8787' })],
    ['check의 types에 --env-file 없음', s({ check: 'wrangler types worker-env.d.ts --config wrangler.jsonc --include-runtime=false && tsc --noEmit' })],
    ['check의 types가 기본 출력 경로', s({ check: 'wrangler types --config wrangler.jsonc --include-runtime=false --env-file .dev.vars.example && tsc --noEmit' })],
    ['build에 metafile 없음', s({ build: 'wrangler deploy --dry-run --config wrangler.jsonc --outdir dist' })],
    ['build에 --config 없음', s({ build: 'wrangler deploy --dry-run --outdir dist --metafile' })],
    ['test가 다른 설정', s({ test: 'vitest run --config other.config.ts' })],
    ['알려진 스크립트 빠짐', { ...PKG, scripts: { ...PKG.scripts, dev: undefined } }],
  ];
  for (const [name, pkg] of seeds) assert.notDeepEqual(checkPackage(pkg, opts), [], name);
  // 알려진 스크립트 밖의 스크립트(W7 도구 등)에도 일반 규칙이 걸린다. 각 씨앗의 사유 글자까지 본다(글자 고정 규칙에 가려지지 않게)
  const extra = [
    ['wrangler dev에 --env-file 없음', 'node x.mjs && wrangler dev --config wrangler.jsonc --port 8787', '--env-file이 없다'],
    ['실제 비밀값 파일을 --env-file로', 'wrangler dev --config wrangler.jsonc --port 8787 --env-file .dev.vars', '실제 비밀값 파일'],
    ['실제 비밀값 파일을 cat', 'cat .dev.vars', '실제 비밀값 파일'],
    ['실제 비밀값 파일을 node -e', `node -e "require('fs').readFileSync('.dev.vars')"`, '실제 비밀값 파일'],
    ['--env-file=값 형태', 'wrangler dev --config wrangler.jsonc --port 8787 --env-file .dev.vars.example --env-file=.dev.vars', '실제 비밀값 파일'],
    ['--env-file 뒤 위치 인자가 env 파일로', 'wrangler types --config wrangler.jsonc --env-file .dev.vars.example worker-env.d.ts', '--env-file은'],
    ['경로를 붙인 wrangler', 'node_modules/.bin/wrangler dev --port 8787', '--env-file이 없다'],
    ['npx wrangler@버전', 'npx wrangler@4.147.0 dev --port 8787', '--env-file이 없다'],
    ['wrangler.js 직접', 'node node_modules/wrangler/bin/wrangler.js dev --config wrangler.jsonc --port 8787', '--env-file이 없다'],
    ['wrangler --config가 다른 파일', 'wrangler dev --config wrangler.json --port 8787 --env-file .dev.vars.example', '--config wrangler.jsonc'],
    ['wrangler --config=다른 파일', 'wrangler deploy --dry-run --config=wrangler.toml', '--config wrangler.jsonc'],
    ['wrangler -c 둘', 'wrangler deploy --dry-run -c wrangler.jsonc -c wrangler.json', '--config wrangler.jsonc'],
    ['플래그 뒤 부명령도 본다', 'wrangler --config wrangler.jsonc dev --port 8787', '--env-file이 없다'],
    ['wrangler --env', 'wrangler dev --config wrangler.jsonc --env staging --port 8787 --env-file .dev.vars.example', '--env를'],
    ['dry-run 없는 deploy', 'wrangler deploy --config wrangler.jsonc', '--dry-run'],
    ['wrangler login', 'wrangler login', '스크립트로 두지 않는다'],
    ['wrangler secret', 'wrangler secret put X --config wrangler.jsonc', '스크립트로 두지 않는다'],
    ['wrangler tail', 'wrangler tail --config wrangler.jsonc', '스크립트로 두지 않는다'],
    ['dev:real을 pnpm으로', 'pnpm dev:real', '다른 스크립트에서 부르지 않는다'],
    ['dev:real을 npm run으로', 'node x.mjs && npm run dev:real', '다른 스크립트에서 부르지 않는다'],
    ['vitest --config', 'vitest run --config other.config.ts', '--config·--root'],
    ['vitest -c=', 'pnpm exec vitest run -c=other.config.ts', '--config·--root'],
    ['vitest --root', 'node_modules/.bin/vitest run --root ../x', '--config·--root'],
  ];
  for (const [name, cmd, why] of extra) {
    const errs = checkPackage(s({ e2e: cmd }), opts);
    assert.ok(errs.some((e) => e.startsWith('scripts.e2e') && e.includes(why)), `${name}: ${JSON.stringify(errs)}`);
  }
  // 알려진 dev:real만 실제 비밀값 파일을 쓴다(그 자체는 통과)
  assert.deepEqual(checkPackage(s({ e2e: 'wrangler dev --config wrangler.jsonc --port 8787 --env-file .dev.vars.example' }), opts), []);
  // 토큰화: 구분자·따옴표·--flag=값
  assert.deepEqual(scriptCommands(`a&&"wrangler" dev --port=8787; b | c`), [['a'], ['wrangler', 'dev', '--port', '8787'], ['b'], ['c']]);
});

test('씨앗: pnpm-workspace.yaml allowBuilds', () => {
  const ws = read('pnpm-workspace.yaml');
  assert.deepEqual(allowedBuilds(ws), ['esbuild', 'workerd']);
  assert.deepEqual(checkWorker(copy({ 'worker/pnpm-workspace.yaml': ws + '  sharp: true\n' })).length > 0, true);
  assert.deepEqual(checkWorker(copy({ 'worker/pnpm-workspace.yaml': ws.replace('  workerd: true\n', '') })).length > 0, true);
  assert.deepEqual(checkWorker(copy({ 'worker/pnpm-workspace.yaml': ws + 'dangerouslyAllowAllBuilds: true\n' })).length > 0, true);
});

test('씨앗: .dev.vars.example', () => {
  assert.deepEqual(checkDevVarsExample(EXAMPLE, KEYS), []);
  const seeds = [
    ['키 빠짐', EXAMPLE.replace(/^BUILD_ID=.*\n/m, '')],
    ['코드가 안 읽는 키', EXAMPLE + 'EXTRA_KEY=dev-x\n'],
    ['실제 같은 secret', EXAMPLE.replace('CHZZK_CLIENT_SECRET=dev-client-placeholder', 'CHZZK_CLIENT_SECRET=Zx9realLooking')],
    ['운영 출처', EXAMPLE.replace('PUBLIC_ORIGIN=http://localhost:8787', 'PUBLIC_ORIGIN=https://dist.example.test')],
    ['포트 다름', EXAMPLE.replace('PUBLIC_ORIGIN=http://localhost:8787', 'PUBLIC_ORIGIN=http://localhost:8788')],
    ['치지직 주소가 운영', EXAMPLE.replace('CHZZK_API_BASE=http://127.0.0.1:8788', 'CHZZK_API_BASE=https://openapi.chzzk.naver.com')],
    ['합성이 아닌 채널 ID', EXAMPLE.replace(/^ADMIN_CHANNEL_IDS=.*$/m, `ADMIN_CHANNEL_IDS=${'e5'.padStart(32, '0')}`)],
    ['따옴표 값', EXAMPLE.replace('BUILD_ID=dev', 'BUILD_ID="dev"')],
    ['키 중복', EXAMPLE + 'BUILD_ID=dev\n'],
    ['CHZZK_REDIRECT_URI 키 빠짐', EXAMPLE.replace(/^CHZZK_REDIRECT_URI=.*\n/m, '')],
    ['CHZZK_REDIRECT_URI 끝 슬래시', EXAMPLE.replace('/auth/callback', '/auth/callback/')],
    ['CHZZK_REDIRECT_URI 127.0.0.1', EXAMPLE.replace('CHZZK_REDIRECT_URI=http://localhost:', 'CHZZK_REDIRECT_URI=http://127.0.0.1:')],
    ['CHZZK_REDIRECT_URI 포트 8788', EXAMPLE.replace('CHZZK_REDIRECT_URI=http://localhost:8787', 'CHZZK_REDIRECT_URI=http://localhost:8788')],
  ];
  for (const [name, text] of seeds) assert.notDeepEqual(checkDevVarsExample(text, KEYS), [], name);
  assert.ok(checkWorker(copy({ 'worker/.dev.vars.example': null })).some((e) => e.includes('.dev.vars.example: 없다')));
});

test('씨앗: vitest.config.ts가 environment example을 잃음', () => {
  assert.deepEqual(checkVitestConfig(VITEST), []);
  const noEnv = VITEST.replace(/,\s*environment:\s*"example"/, '');
  assert.notEqual(noEnv, VITEST);
  const seeds = [
    ['environment undefined', VITEST.replace(/environment:\s*"example"/, 'environment: undefined')],
    ['environment 지움', noEnv],
    ['지우고 주석으로 남김(줄 주석)', `${noEnv}\n// environment: "example"\n`],
    ['지우고 주석으로 남김(블록 주석)', noEnv.replace('configPath:', '/* environment: "example", */ configPath:')],
    ['wrangler 객체 밖에 둠', noEnv.replace('miniflare:', 'environment: "example", miniflare:')],
    ['뒤에서 다시 덮음', VITEST.replace(/environment:\s*"example"/, 'environment: "example", environment: "other"')],
    ['펼침으로 덮을 수 있음', VITEST.replace(/environment:\s*"example"/, 'environment: "example", ...extra')],
    ['configPath 다른 파일', VITEST.replace('./wrangler.jsonc', './wrangler.json')],
    ['.dev.vars.example 이름이 주석에만', VITEST.replace(/new URL\("\.\/\.dev\.vars\.example"/, 'new URL("./x.env"')],
  ];
  for (const [name, text] of seeds) {
    assert.notEqual(text, VITEST, name);
    assert.notDeepEqual(checkVitestConfig(text), [], name);
  }
  // 주석 지우기: 문자열 안의 // 와 따옴표 종류는 그대로
  assert.equal(stripJsComments(`a("//x") /* b */ + 'c//d' + \`e/*f*/\` // g`), `a("//x")  + 'c//d' + \`e/*f*/\` `);
});

test('씨앗: 그림자 설정(wrangler.json·wrangler.toml·리디렉트·기본 타입 파일·다른 vitest 설정)', () => {
  const cases = [
    ['worker/wrangler.json', JSON.stringify({ ...WRANGLER, vars: { ...WRANGLER.vars, EXTRA: 'leak' } })],
    ['worker/wrangler.toml', '[vars]\nX = "1"\n'],
    ['worker/.wrangler/deploy/config.json', '{"configPath":"../../x.json"}'],
    ['worker/worker-configuration.d.ts', '// 생성물'],
    ['worker/vitest.config.mts', 'export default {}'],
    ['worker/vite.config.ts', 'export default {}'],
    ['worker/vitest.workspace.ts', 'export default []'],
  ];
  for (const [rel, text] of cases) {
    const errs = checkWorker(copy({ [rel]: text }));
    assert.ok(errs.some((e) => e.startsWith(rel)), `${rel}: ${JSON.stringify(errs)}`);
  }
});

test('--sentinel: CI에서만 심고, 이미 있으면(FIFO 포함) 열지 않고 실패하고, 씨앗이 아니면 지우지 않는다', () => {
  const CI = { CI: 'true' };
  const quiet = (fn) => {
    const [log, err] = [console.log, console.error];
    console.log = console.error = () => {};
    try {
      return fn();
    } finally {
      [console.log, console.error] = [log, err];
    }
  };
  // 로컬(CI 아님): 아무것도 만들지 않는다
  const local = copy();
  assert.deepEqual(plantSentinel(local, {}).errs, []);
  assert.equal(existsSync(join(local, 'worker/.dev.vars')), false);
  assert.deepEqual(checkSentinel(local, {}).errs, []);
  // CI: 심기 → 두 번째 심기는 EEXIST → 타입 파일 정상이면 지우고 통과
  const d = copy({ 'worker/worker-env.d.ts': 'interface Env { PUBLIC_ORIGIN: string }\n' });
  assert.deepEqual(plantSentinel(d, CI).errs, []);
  assert.equal(readFileSync(join(d, 'worker/.dev.vars'), 'utf8'), SENTINEL_TEXT);
  assert.notDeepEqual(plantSentinel(d, CI).errs, []);
  assert.deepEqual(checkSentinel(d, CI).errs, []);
  assert.equal(existsSync(join(d, 'worker/.dev.vars')), false);
  // 타입 파일에 씨앗 키가 있으면 실패(wrangler types가 실제 비밀값 파일을 읽었다)
  const leaked = copy({ 'worker/worker-env.d.ts': 'interface Env { LEAK_SENTINEL: string }\n' });
  plantSentinel(leaked, CI);
  assert.ok(checkSentinel(leaked, CI).errs.some((e) => e.includes('LEAK_SENTINEL')));
  // 씨앗 없이 check: 실패. 씨앗과 크기가 다른 파일은 지우지 않는다
  assert.notDeepEqual(checkSentinel(copy({ 'worker/worker-env.d.ts': 'x' }), CI).errs, []);
  const other = copy({ 'worker/worker-env.d.ts': 'x', 'worker/.dev.vars': 'CHZZK_CLIENT_ID=x\n' });
  assert.notDeepEqual(checkSentinel(other, CI).errs, []);
  assert.equal(existsSync(join(other, 'worker/.dev.vars')), true);
  // 진입점
  assert.equal(quiet(() => main(['--sentinel', 'plant', '--root', local], {})), 0);
  assert.equal(quiet(() => main(['--sentinel', 'nope', '--root', local], {})), 2);
  assert.equal(quiet(() => main(['--sentinel', '--root', local], {})), 2);
  // FIFO(POSIX): 심기가 막히지 않고 EEXIST로 실패한다(1Password 마운트 자리를 열지 않는다)
  if (process.platform !== 'win32') {
    const f = copy();
    execFileSync('mkfifo', [join(f, 'worker/.dev.vars')]);
    assert.ok(plantSentinel(f, CI).errs.some((e) => e.includes('이미 있다')));
    assert.ok(checkSentinel(f, CI).errs.some((e) => e.includes('씨앗이 아니다')));
    assert.equal(existsSync(join(f, 'worker/.dev.vars')), true);
  }
});

test('씨앗: 소스 규칙', () => {
  const ok = [
    { rel: 'src/core/log.ts', text: 'console.log(x);' },
    { rel: 'src/config.ts', text: '"CI_VERIFY_TOKEN",' },
    { rel: 'test/a.test.ts', text: 'vi.spyOn(console, "log"); console.log("x"); // .dev.vars.example' },
    // 이스케이프로 쓴 bidi 제어와 ZWJ·ZWSP 리터럴은 된다
    { rel: 'src/core/x.ts', text: 'const re = /[\\u202A-\\u202E]/u; const e = "a\u200Db\u200Bc";' },
  ];
  assert.deepEqual(checkSources(ok), []);
  const seeds = [
    ['log.ts 밖 console.', { rel: 'src/routes.ts', text: 'console.error(e);' }],
    ['console . 띄어 씀', { rel: 'src/http/x.ts', text: 'console .log(1)' }],
    ['CI_VERIFY_TOKEN 다른 파일', { rel: 'src/http/admin.ts', text: 'env.CI_VERIFY_TOKEN' }],
    ['테스트가 실제 비밀값 파일 이름', { rel: 'test/a.test.ts', text: 'readFile(".dev.vars")' }],
    ['설정이 실제 비밀값 파일 이름', { rel: 'vitest.config.ts', text: 'envFiles: [".dev.vars"]' }],
    ['scripts/의 다른 도구가 실제 비밀값 파일 이름', { rel: 'scripts/e2e-dev.mjs', text: "['--env-file', '.dev.vars']" }],
    // 구현 중 변경 16 (가): 표시 순서를 바꾸는 문자 리터럴(씨앗도 이스케이프로 만든다)
    ...['\u202E', '\u202A', '\u2066', '\u2069', '\u200E', '\u200F', '\u061C'].map((c) => [`bidi 리터럴 U+${c.codePointAt(0).toString(16)}`, { rel: 'test/a.test.ts', text: `["${c}evil", "evil"]` }]),
  ];
  // G-ID 도구는 사용자가 직접 돌리며 실제 비밀값 파일을 읽는다(예외)
  assert.deepEqual(checkSources([{ rel: 'scripts/channel-id-check.mjs', text: "join(dir, '..', '.dev.vars')" }]), []);
  for (const [name, f] of seeds) assert.notDeepEqual(checkSources([f]), [], name);
  // 사본: log.ts 밖에 console.을 넣으면 checkWorker가 실패
  const routes = read('src/routes.ts');
  assert.ok(checkWorker(copy({ 'worker/src/routes.ts': routes + '\nconsole.log("x");\n' })).some((e) => e.includes('console.')));
});

test('CONFIG_KEYS 추출', () => {
  assert.ok(KEYS.includes('PUBLIC_ORIGIN') && KEYS.includes('START_RATE_10M') && KEYS.includes('CHZZK_REDIRECT_URI'));
  assert.equal(configKeys('export const X = 1;'), null);
});

test('--dist: metafile 입력은 src/*.ts만, dist/wrangler.json 규칙', () => {
  const meta = (inputs) => JSON.stringify({ inputs: Object.fromEntries(inputs.map((i) => [i, {}])), outputs: {} });
  const good = { 'worker/dist/bundle-meta.json': meta(['src/index.ts', 'src/routes.ts']), 'worker/dist/index.js': 'x' };
  assert.deepEqual(checkDist(copy(good)), []);
  assert.notDeepEqual(checkDist(copy({ ...good, 'worker/dist/bundle-meta.json': meta(['src/index.ts', 'node_modules/evil/index.js']) })), []);
  assert.notDeepEqual(checkDist(copy({ ...good, 'worker/dist/bundle-meta.json': meta(['src/../x.ts']) })), []);
  assert.notDeepEqual(checkDist(copy({ 'worker/dist/index.js': 'x' })), []);
  assert.notDeepEqual(checkDist(copy({ 'worker/dist/bundle-meta.json': meta(['src/index.ts']) })), []);
  const dw = (cfg) => ({ ...good, 'worker/dist/wrangler.json': JSON.stringify(cfg) });
  assert.deepEqual(checkDist(copy(dw(deployConfig(WRANGLER)))), []);
  assert.deepEqual(checkDist(copy(dw({ ...WRANGLER, main: 'index.js', no_bundle: true }))), []);
  // 원본에서 main·no_bundle만 바꾼 것이어야 한다(worker.md 구현 중 변경 35 (나): main은 설정 파일 위치 기준이라 index.js)
  assert.notDeepEqual(checkDist(copy(dw({ ...WRANGLER, main: 'dist/index.js', no_bundle: true }))), []);
  assert.notDeepEqual(checkDist(copy(dw({ ...deployConfig(WRANGLER), compatibility_flags: ['nodejs_compat'] }))), []);
  assert.notDeepEqual(checkDist(copy(dw({ ...deployConfig(WRANGLER), workers_dev: false }))), []);
  assert.notDeepEqual(checkDist(copy(dw({ ...WRANGLER, main: 'index.js' }))), []);
  assert.notDeepEqual(checkDist(copy(dw({ ...WRANGLER, vars: { ...WRANGLER.vars, PUBLIC_ORIGIN: 'http://localhost:8787' } }))), []);
  assert.notDeepEqual(checkDist(copy(dw({ ...WRANGLER, account_id: 'x' }))), []);
});

test('씨앗: store 순수성(worker.md 구현 중 변경 21, cicd.md 89)', () => {
  const store = (rel, text) => [{ rel, text }];
  const ok = [
    ['src/store/flows.ts', 'export function f(db, now) { return db.first("SELECT 1 AS x", now); }'],
    ['src/store/AuthStore.ts', 'import { DurableObject } from "cloudflare:workers"; this.db = new Db(ctx.storage.sql); async x() { await this.ctx.storage.setAlarm(Date.now()); this.ctx.storage.transactionSync(() => 1); }'],
    ['src/store/db.ts', 'constructor(private readonly sql: SqlStorage) {} const m = RE.exec(x);'],
    ['src/store/db.ts', 'const c = this.sql.exec(q);'],
    ['src/core/token.ts', 'const m = BEARER.exec(h);'],
    ['src/store/sessions.ts', 'const d = new Date(now).toISOString(); const asyncLike = 1; const awaited = 2;'],
    // 낱말 경계: sqlite_master·sql_x는 sql이 아니다
    ['src/store/sweep.ts', 'db.all("SELECT name FROM sqlite_master WHERE name NOT LIKE \'sql_%\'");'],
    ['src/store/AuthStore.ts', 'this.db = new Db(ctx.storage.sql); this.ctx.storage.transactionSync(/* 동기 */ () => 1);'],
  ];
  for (const [rel, text] of ok) assert.deepEqual(checkStorePurity(store(rel, text)), [], `${rel}: ${text}`);
  const seeds = [
    ['async 함수', 'src/store/flows.ts', 'export async function f() {}'],
    ['await', 'src/store/flows.ts', 'const x = 1; await x;'],
    ['주석 속 await', 'src/store/flows.ts', '// 여기서 await을 쓰지 않는다'],
    ['Date.now', 'src/store/flows.ts', 'const t = Date.now();'],
    ['new Date()', 'src/store/flows.ts', 'const t = new Date();'],
    ['new 없는 Date()', 'src/store/flows.ts', 'const s = Date();'],
    ['performance.now', 'src/store/sweep.ts', 'const t = performance.now();'],
    ['cloudflare: 타입 import', 'src/store/flows.ts', 'import type { X } from "cloudflare:workers";'],
    ['store의 sql.exec', 'src/store/sessions.ts', 'db.sql.exec("x");'],
    ['http의 sql.exec', 'src/http/a.ts', 'ctx.storage.sql.exec("x");'],
    ['AuthStore의 sql.exec', 'src/store/AuthStore.ts', 'this.ctx.storage.sql.exec("x");'],
    ['async 트랜잭션 콜백', 'src/store/AuthStore.ts', 'this.ctx.storage.transactionSync(async () => 1);'],
    ['async 트랜잭션 콜백(줄바꿈)', 'src/http/a.ts', 'ctx.storage.transactionSync(\n  async () => 1);'],
    // 별칭 우회(cicd.md 구현 중 변경 90)
    ['대괄호 sql 접근', 'src/store/flows.ts', '(db as any)["sql"].exec("DELETE FROM flow");'],
    ['store의 sql 별칭', 'src/store/sessions.ts', 'const s = db.storage.sql; s.exec("x");'],
    ['AuthStore의 sql 별칭', 'src/store/AuthStore.ts', 'this.db = new Db(ctx.storage.sql); const s = this.ctx.storage.sql; s.exec("x");'],
    ['AuthStore의 storage 대괄호', 'src/store/AuthStore.ts', 'this.db = new Db(ctx.storage.sql); const s = this.ctx.storage["sql"];'],
    ['AuthStore의 sql이 Db 인자가 아님', 'src/store/AuthStore.ts', 'const s = ctx.storage.sql;'],
    ['async 없는 비동기', 'src/store/flows.ts', 'crypto.subtle.digest("SHA-256", b).then((h) => db.run("x"));'],
    ['SqlStorage 타입', 'src/store/sweep.ts', 'export function f(s: SqlStorage) {}'],
    ['AuthStore 밖 transactionSync', 'src/store/flows.ts', 'export function f(tx) { tx.transactionSync(() => 1); }'],
    ['http의 storage.sql', 'src/http/a.ts', 'const s = ctx.storage.sql;'],
    // 구조 분해 별칭·주석 끼운 async(cicd.md 구현 중 변경 91)
    ['http의 구조 분해 별칭', 'src/http/a.ts', 'const { sql: s } = ctx.storage; s.exec("x");'],
    ['http의 구조 분해(이름 그대로)', 'src/http/a.ts', 'const { sql } = ctx.storage;'],
    ['AuthStore의 구조 분해 별칭', 'src/store/AuthStore.ts', 'this.db = new Db(ctx.storage.sql); const { sql: s } = this.ctx.storage;'],
    ['중첩 구조 분해', 'src/http/a.ts', 'const { storage: { sql: s } } = ctx;'],
    ['storage 별칭 뒤 .sql', 'src/http/a.ts', 'const st = ctx.storage; const s = st.sql;'],
    ['storage 별칭 뒤 ["sql"]', 'src/http/a.ts', 'const st = ctx.storage; const s = st["sql"];'],
    ['주석 속 sql 별칭 설명', 'src/http/a.ts', '// sql 핸들을 여기서 꺼내지 않는다'],
    ['async 콜백 앞 블록 주석', 'src/store/AuthStore.ts', 'this.ctx.storage.transactionSync(/* c */ async () => 1);'],
    ['async 콜백 앞 줄 주석', 'src/store/AuthStore.ts', 'this.ctx.storage.transactionSync(\n  // c\n  async () => 1);'],
    ['async 콜백 겹괄호', 'src/store/AuthStore.ts', 'this.ctx.storage.transactionSync((async () => 1));'],
    ['이름 뒤 주석', 'src/store/AuthStore.ts', 'this.ctx.storage.transactionSync /* c */ (async () => 1);'],
  ];
  for (const [name, rel, text] of seeds) assert.notDeepEqual(checkStorePurity(store(rel, text)), [], name);
  // src 밖(test)은 보지 않는다
  assert.deepEqual(checkStorePurity(store('test/store/x.test.ts', 'await x; Date.now(); sql.exec("x");')), []);
});

test('씨앗: core 순수성(원문 전체, worker.md 구현 중 변경 15)', () => {
  const core = (text) => [{ rel: 'src/core/x.ts', text }];
  const ok = [
    'import { b64url } from "./token";',
    'import { parseVersion, type Version } from "./semver";',
    'const res = await deps.fetch(url, init);',
    'export interface D { readonly fetch: FetchLike; readonly f?: FetchLike }',
    'const n = Math.min(a, b);',
    'const re = /[&<>"\']/g; const x = "./a";',
    'if (pathname.includes("..")) return null;',
    'const d = new Date(ms).toISOString(); const e = new Date( t );',
    'const ok = a?.fetch ? 1 : 2; const { fetch: f } = deps;',
    'const d = new Date(/* 주입 */ ms); const e = new Date(// 주입\n  t);',
    'const newDate = shift(t); const isDate = (x) => x instanceof Date;',
  ];
  for (const text of ok) assert.deepEqual(checkCorePurity(core(text)), [], text);
  const seeds = [
    ['여러 줄 import', 'import {\n  env\n} from "cloudflare:workers";'],
    ['side-effect import', 'import "cloudflare:sockets";'],
    ['동적 import', 'const m = await import("cloudflare:workers");'],
    ['export … from', 'export { env } from "cloudflare:workers";'],
    ['타입 import', 'import type { X } from "cloudflare:workers";'],
    ['주석 속 cloudflare:', '// cloudflare:workers를 쓰지 않는다'],
    ['바깥 모듈 import', 'import { CONFIG_KEYS } from "../config";'],
    ['바깥 모듈 동적 import', "const c = await import('../config');"],
    ['./../ 우회', 'import { x } from "./../config";'],
    ['전역 fetch', 'const r = await fetch("http://x");'],
    ['전역 fetch 띄어 씀', 'await fetch ("http://x");'],
    ['전역 fetch 별칭', 'const f = fetch; f("http://x");'],
    ['globalThis.fetch', 'await globalThis.fetch("http://x");'],
    ['fetch 기본값 주입', 'export const DEFAULT = { fetch };'],
    ['주석 속 fetch(', '// 여기서 fetch(를 부르지 않는다'],
    ['Date.now', 'const t = Date.now();'],
    ['Date . now', 'const t = Date . now();'],
    ['정규식 리터럴 뒤(주석 제거기 미탐 경로)', 'const re = /["]/g; const t = Date.now(); // "'],
    ['Math.random', 'const r = Math.random();'],
    // 구현 중 변경 16 (나)
    ['맨 .. export', 'export * from "..";'],
    ['맨 .. import', "import x from '..';"],
    ['맨 .. 동적 import', 'const m = await import(`..`);'],
    ['문자열 줄 연속 ../', 'import { CONFIG_KEYS } from "\\\n../config";'],
    ['주석 속 ../', '// ../config를 쓰지 않는다'],
    ['삼항 속 fetch', 'const f = ok ? fetch : null;'],
    ['globalThis 구조 분해 별칭', 'const { fetch: f } = globalThis; f(u);'],
    ['self 구조 분해 별칭', 'const {\n  fetch: f,\n} = self;'],
    ['new Date()', 'const t = new Date().toISOString();'],
    ['new Date;', 'const t = +new Date;'],
    ['new Date( )', 'const t = new Date( ).getTime();'],
    ['performance.now', 'const t = performance.now();'],
    ['new 없는 Date()', 'const s = Date();'],
    ['new 없는 Date ( )', 'const s = String(Date ( ));'],
    // 구현 중 변경 16: 괄호 안이 주석뿐이면 인자 없는 호출이다
    ['new Date(블록 주석)', 'const t = new Date(/* 주입된 시각 */).getTime();'],
    ['new Date(줄 주석+줄바꿈)', 'const t = new Date(// 주입된 시각\n);'],
    ['new Date(주석 둘)', 'const t = new Date( /* a */ // b\n /* c */ );'],
    ['new Date 주석;', 'const t = +new Date /* x */;'],
    ['new 주석 Date()', 'const t = new /* x */ Date();'],
    ['new Date 주석 ()', 'const t = new Date /* x */ ();'],
    ['new 없는 Date 주석 ()', 'const s = Date /* x */ ();'],
    ['뒤에 다른 */가 있어도', 'const t = new Date(/* a */); const u = f(/* b */ x);'],
  ];
  for (const [name, text] of seeds) assert.notDeepEqual(checkCorePurity(core(text)), [], name);
  // core 밖은 cloudflare:·fetch·Date.now가 된다(핸들러·DO·라우터). Math.random은 src/** 어디서도 안 된다
  assert.deepEqual(checkCorePurity([{ rel: 'src/routes.ts', text: 'import { env } from "cloudflare:workers"; await fetch(u); Date.now();' }]), []);
  assert.notDeepEqual(checkCorePurity([{ rel: 'src/http/x.ts', text: 'const id = Math.random();' }]), []);
  assert.deepEqual(checkCorePurity([{ rel: 'test/a.test.ts', text: 'Math.random(); fetch(u); import "cloudflare:test";' }]), []);
  // 사본: core 파일에 타입 import 하나를 더하면 checkWorker가 실패
  const log = read('src/core/log.ts');
  assert.ok(checkWorker(copy({ 'worker/src/core/log.ts': `import type { X } from "cloudflare:workers";\n${log}` })).some((e) => e.includes('src/core/log.ts') && e.includes('cloudflare:')));
});

test('씨앗: raw 허용 목록(파일별 정확한 토큰 수)', () => {
  const HTML = 'src/core/html.ts';
  const html = read(HTML);
  assert.deepEqual(Object.keys(RAW_ALLOWLIST), [HTML]);
  assert.deepEqual(checkRawAllowlist([{ rel: HTML, text: html }]), []);
  const seeds = [
    ['html.ts 개수 +1', HTML, `${html}\nexport const y = raw("<b>");\n`],
    ['html.ts 개수 -1(주석 낱말도 센다)', HTML, html.replace(/(?<![\w$])raw(?![\w$])/, 'rawX')],
    ['목록 밖 파일의 호출', 'src/http/landing.ts', 'const p = html`${raw(x)}`;'],
    ['별칭 import', 'src/http/landing.ts', 'import { raw as r } from "../core/html";'],
    ['값 별칭', 'src/http/landing.ts', 'const r = raw;'],
    ['계산된 속성', 'src/http/landing.ts', 'const r = h["raw"];'],
    ['주석', 'src/http/landing.ts', '// raw 쓰지 않음'],
  ];
  for (const [name, rel, text] of seeds) {
    const files = rel === HTML ? [{ rel, text }] : [{ rel: HTML, text: html }, { rel, text }];
    assert.notDeepEqual(checkRawAllowlist(files), [], name);
  }
  // 통과: 테스트·다른 낱말(rawX·drawn·raw_x·$raw)
  assert.deepEqual(checkRawAllowlist([{ rel: HTML, text: html }, { rel: 'test/a.test.ts', text: 'raw("<b>")' }]), []);
  assert.deepEqual(checkRawAllowlist([{ rel: HTML, text: html }, { rel: 'src/http/x.ts', text: 'drawn rawX raw_x $raw raw$' }]), []);
  // 낡은 항목: checkWorker 경로(all)에서는 목록의 파일이 있어야 한다
  assert.notDeepEqual(checkRawAllowlist([], { all: true }), []);
  assert.deepEqual(checkRawAllowlist([]), []);
  // 사본: routes.ts에 raw(를 더하면 checkWorker가 실패
  const routes = read('src/routes.ts');
  assert.ok(checkWorker(copy({ 'worker/src/routes.ts': `${routes}\nraw("x");\n` })).some((e) => e.includes('src/routes.ts') && e.includes('raw')));
  assert.ok(checkWorker(copy({ 'worker/src/core/html.ts': null })).some((e) => e.includes('RAW_ALLOWLIST')));
});

test('씨앗: 바깥 요청(낱말 fetch)은 src/http/auth.ts 한 곳, 전역 객체·동적 실행·소켓은 0', () => {
  const AUTH = 'src/http/auth.ts';
  const auth = read(AUTH);
  assert.deepEqual(OUTBOUND_ALLOWLIST, { [AUTH]: 1 });
  assert.deepEqual(checkOutbound([{ rel: AUTH, text: auth }]), []);
  // 실패 씨앗: 다른 파일·같은 파일 2회·globalThis·self 대괄호·주석
  const seeds = [
    ['다른 파일의 호출', 'src/http/session.ts', 'const r = await fetch("https://x.example.test");'],
    ['공백이 낀 호출', 'src/http/session.ts', 'await fetch   (u);'],
    ['목록 파일 2회', AUTH, `${auth}\nawait fetch(u);\n`],
    ['globalThis.fetch', 'src/routes.ts', 'const f = globalThis.fetch;'],
    ['globalThis . fetch', 'src/routes.ts', 'globalThis\n  .fetch(u);'],
    ['self.fetch', 'src/routes.ts', 'self.fetch(u);'],
    ['globalThis 대괄호', 'src/routes.ts', 'globalThis["fe" + "tch"](u);'],
    ['self 대괄호', 'src/routes.ts', 'self["fetch"](u);'],
    ['주석 속 호출', 'src/http/health.ts', '// 여기서 fetch(u)를 부르면 안 된다'],
    ['목록 파일의 호출이 0개', AUTH, 'export const x = 1;'],
    // W4 리뷰(cicd.md 93): 별칭·우회 모양
    ['bind 속성', 'src/store/x.ts', 'const deps = { fetch: fetch.bind(null) };'],
    ['축약형 속성', 'src/store/x.ts', 'const deps = { fetch };'],
    ['call', 'src/store/x.ts', 'fetch.call(null, u);'],
    ['변수 별칭', 'src/store/x.ts', 'const f = fetch; f(u);'],
    ['쉼표 식', 'src/http/session.ts', '(0, fetch)(u);'],
    ['선택 호출', 'src/http/session.ts', 'fetch?.(u);'],
    ['같은 줄 삼항', 'src/http/session.ts', 'const f = ok ? fetch : g;'],
    ['여러 줄 삼항', 'src/http/session.ts', 'const f = ok\n  ? g\n  : fetch;'],
    ['속성 값', 'src/http/session.ts', 'const d = { fetch: fetch };'],
    ['globalThis 선택 접근', 'src/http/session.ts', 'globalThis?.fetch(u);'],
    ['globalThis 구조 분해', 'src/http/session.ts', 'const { fetch: f } = globalThis;'],
    ['Reflect.get', 'src/http/session.ts', 'Reflect.get(o, k)(u);'],
    ['new Function', 'src/http/session.ts', 'new Function("return fe" + "tch")()(u);'],
    ['eval', 'src/http/session.ts', '(0, eval)("fe" + "tch")(u);'],
    ['동적 import', 'src/http/session.ts', 'await import("cloud" + "flare:sockets");'],
    ['raw 소켓', 'src/http/session.ts', 'import { connect } from "cloudflare:sockets"; connect({ hostname: "x.example.test", port: 443 });'],
    ['WebSocket', 'src/store/x.ts', 'new WebSocket("wss://x.example.test");'],
    ['self 낱말', 'src/http/session.ts', 'const g = self; g.fetch(u);'],
  ];
  for (const [name, rel, text] of seeds) {
    const files = rel === AUTH ? [{ rel, text }] : [{ rel: AUTH, text: auth }, { rel, text }];
    assert.notDeepEqual(checkOutbound(files), [], name);
  }
  // 통과: 메서드 호출 deps.fetch(·속성 fetch:·다른 낱말·src 밖
  const clean = [
    ['메서드 호출', 'const r = await deps.fetch(url, init);'],
    ['속성 선언', 'const d = { fetch: (u) => g(u) };'],
    ['낱말 일부', 'prefetch(u); fetchAll(u); refetch (u);'],
    ['$ 접두', '$fetch(u);'],
    ['타입 속성', 'interface D {\n  readonly fetch: F;\n  fetch?: F;\n}'],
    ['여러 속성', 'const d = { a: 1, fetch: (u) => g(u) };\nconst e = {\n  fetch: h,\n};'],
    ['CSP 키워드', "const csp = \"default-src 'self'; img-src 'self'\";"],
    ['cloudflare:workers', 'import { DurableObject } from "cloudflare:workers";'],
  ];
  for (const [name, text] of clean) assert.deepEqual(checkOutbound([{ rel: AUTH, text: auth }, { rel: 'src/core/x.ts', text }]), [], name);
  assert.deepEqual(checkOutbound([{ rel: AUTH, text: auth }, { rel: 'test/a.test.ts', text: 'await fetch(u); globalThis.fetch(u);' }]), []);
  // 낡은 항목: checkWorker 경로(all)에서는 목록의 파일이 있어야 한다
  assert.notDeepEqual(checkOutbound([], { all: true }), []);
  assert.deepEqual(checkOutbound([]), []);
  // 사본: 다른 파일에 fetch(를 더하거나, auth.ts를 지우면 checkWorker가 실패
  const session = read('src/http/session.ts');
  assert.ok(checkWorker(copy({ 'worker/src/http/session.ts': `${session}\nawait fetch(u);\n` })).some((e) => e.includes('src/http/session.ts') && e.includes('전역 fetch')));
  assert.ok(checkWorker(copy({ 'worker/src/http/auth.ts': null })).some((e) => e.includes('OUTBOUND_ALLOWLIST')));
});

test('씨앗: 릴리스 읽기 소스(worker.md 구현 중 변경 31 (차), cicd.md 94·95)', () => {
  const R2 = 'src/http/r2.ts';
  const r2 = read(R2);
  assert.deepEqual(R2_ALLOWLIST, { [R2]: 1 });
  assert.deepEqual(RELEASE_FILES, [R2, 'src/http/release-auth.ts', 'src/http/releases.ts', 'src/http/update.ts']);
  assert.deepEqual(checkReleaseSources([{ rel: R2, text: r2 }]), []);
  // 실패 씨앗(이름, 파일, 내용)
  const seeds = [
    ['ciVerifyToken 읽기', 'src/http/session.ts', 'const t = ctx.config.ciVerifyToken;'],
    ['ciVerifyToken 구조 분해', 'src/http/session.ts', 'const { ciVerifyToken: t } = ctx.config;'],
    ['ciVerifyToken 주석', 'src/routes.ts', '// ciVerifyToken'],
    ['releaseAuth 호출', 'src/http/session.ts', 'await releaseAuth(req, ctx, true);'],
    ['R2 바인딩이 r2.ts 밖', 'src/http/releases.ts', 'const b = ctx.env.DIST;'],
    ['r2.ts 바인딩 2회', R2, `${r2}\nconst b = env.DIST;\n`],
    ['r2.ts .put(', R2, `${r2}\nbucket.put(k, v);\n`],
    ['r2.ts 주석 속 list', R2, `${r2}\n// list는 쓰지 않는다\n`],
    ['.list(', 'src/http/update.ts', 'await b.list();'],
    ['어디든 .put(', 'src/store/x.ts', 'env.X.put(k);'],
    ['Response.redirect', 'src/http/releases.ts', 'return Response.redirect(u, 302);'],
    ['Location 헤더', 'src/http/releases.ts', 'headers.set("Location", u);'],
    ['대소문자 다른 location 낱말', 'src/http/update.ts', '// location 주석'],
    ['릴리스 파일의 .delete(', 'src/http/update.ts', 'cache.delete(k);'],
    ['멀티파트', R2, `${r2}\nb.createMultipartUpload(k);\n`],
    // 모양 검사가 놓치던 것(cicd.md 95): 옵셔널 호출·대괄호·구조 분해·DIST 없이 바인딩 얻기
    ['.list?.(', 'src/http/update.ts', 'await b.list?.({ prefix: "releases/" });'],
    ['.put?.(', 'src/http/releases.ts', 'await b.put?.(k, v);'],
    ['["list"](', 'src/http/landing.ts', 'await b["list"]({});'],
    ['{ list } 구조 분해', 'src/http/landing.ts', 'const { list } = b; await list({});'],
    ['typeof v?.list', 'src/http/landing.ts', 'Object.values(ctx.env).find((v) => typeof v?.list === "function");'],
    ['릴리스 파일의 .delete?.(', 'src/http/releases.ts', 'await b.delete?.(k);'],
    ['릴리스 파일의 ["delete"](', 'src/http/update.ts', 'await b["delete"](k);'],
    ['목록 밖 파일의 Map.delete', 'src/http/health.ts', 'm.delete(k);'],
    ['lru.ts에 delete 하나 더', 'src/core/lru.ts', `${read('src/core/lru.ts')}\nb.delete(k);\n`],
    ['flows.ts의 delete 하나 덜', 'src/store/flows.ts', read('src/store/flows.ts').replace('map.delete(key);', 'void key;')],
  ];
  for (const [name, rel, text] of seeds) {
    const files = rel === R2 && text.startsWith(r2) ? [{ rel, text }] : [{ rel: R2, text: r2 }, { rel, text }];
    assert.notDeepEqual(checkReleaseSources(files), [], name);
  }
  // 목록 파일이 없다(낡은 항목): checkWorker 경로(all)에서만
  assert.notDeepEqual(checkReleaseSources([], { all: true }), [], '목록 파일 없음');
  assert.deepEqual(checkReleaseSources([]), []);
  // 통과: 다른 파일의 Map.delete, 허용된 파일의 낱말, src 밖(test)
  assert.deepEqual(DELETE_ALLOWLIST, { 'src/core/lru.ts': 3, 'src/store/flows.ts': 5 });
  const clean = [
    ['Lru의 Map.delete(실제 파일)', 'src/core/lru.ts', read('src/core/lru.ts')],
    ['flows의 Map.delete(실제 파일)', 'src/store/flows.ts', read('src/store/flows.ts')],
    ['낱말이 아닌 put·list', 'src/http/health.ts', 'const input = listing; const outputs = putative; const deleted = 1;'],
    ['설정 필드', 'src/config.ts', 'ciVerifyToken: required(env, "CI_VERIFY_TOKEN", devMode),'],
    ['release-auth의 낱말', 'src/http/release-auth.ts', 'const ci = ctx.config.ciVerifyToken; export async function releaseAuth() {}'],
    ['releaseAuth 호출', 'src/http/releases.ts', 'const who = await releaseAuth(req, ctx, true);'],
    ['DIST_BASE_URL 같은 이름', 'src/http/health.ts', 'const u = DIST_BASE_URL;'],
    ['낱말이 아닌 allocation', 'src/http/releases.ts', 'const allocation = 1; // allocation'],
    ['test는 보지 않는다', 'test/x.test.ts', 'env.DIST.put(k, v); await b.list(); // Location redirect ciVerifyToken'],
  ];
  for (const [name, rel, text] of clean) assert.deepEqual(checkReleaseSources([{ rel: R2, text: r2 }, { rel, text }]), [], name);
  // 사본: 다른 파일에 .put(을 더하거나 r2.ts를 지우면 checkWorker가 실패
  const health = read('src/http/health.ts');
  assert.ok(checkWorker(copy({ 'worker/src/http/health.ts': `${health}\nawait env.X.put(k);\n` })).some((e) => e.includes('src/http/health.ts') && e.includes('.put(')));
  assert.ok(checkWorker(copy({ 'worker/src/http/health.ts': `${health}\nawait b.list?.({});\n` })).some((e) => e.includes('src/http/health.ts') && e.includes('list')));
  assert.ok(checkWorker(copy({ 'worker/src/http/r2.ts': null })).some((e) => e.includes('릴리스 읽기 검사 목록')));
  assert.ok(checkWorker(copy({ 'worker/src/core/lru.ts': null })).some((e) => e.includes('src/core/lru.ts') && e.includes('릴리스 읽기 검사 목록')));
});

test('deployConfig: 원본에서 main·no_bundle만 바꾸고 원본은 그대로', () => {
  const before = structuredClone(WRANGLER);
  const d = deployConfig(WRANGLER);
  assert.deepEqual(WRANGLER, before);
  assert.equal(d.main, DEPLOY_MAIN);
  assert.equal(DEPLOY_MAIN, 'index.js');
  assert.equal(d.no_bundle, true);
  const { main: _m, no_bundle: _n, ...rest } = d;
  const { main: _m0, ...orig } = WRANGLER;
  assert.deepEqual(rest, orig);
  assert.equal(d.$schema, WRANGLER.$schema);
});

test('worker/deploy: 저장소 그대로는 통과, package.json·lockfile 씨앗은 실패', () => {
  const DEP = JSON.parse(read('deploy/package.json'));
  const opts = { wrangler: TOOLS_WRANGLER, packageManager: PM };
  assert.deepEqual(checkDeployPackage(DEP, opts), []);
  assert.equal(DEP.name, DEPLOY_PKG_NAME);
  const seeds = [
    ['scripts 있음', { ...DEP, scripts: { postinstall: 'x' } }],
    ['devDependencies 있음', { ...DEP, devDependencies: { vitest: '1.0.0' } }],
    ['의존성 둘', { ...DEP, dependencies: { wrangler: TOOLS_WRANGLER, esbuild: '0.1.0' } }],
    ['범위 버전', { ...DEP, dependencies: { wrangler: `^${TOOLS_WRANGLER}` } }],
    ['다른 wrangler 버전', { ...DEP, dependencies: { wrangler: '4.0.0' } }],
    ['name 다름', { ...DEP, name: 'x' }],
    ['private 아님', { ...DEP, private: false }],
    ['packageManager 다름', { ...DEP, packageManager: 'pnpm@1.0.0' }],
    ['배열', []],
  ];
  for (const [name, pkg] of seeds) assert.notDeepEqual(checkDeployPackage(pkg, opts), [], name);
  // 진입점으로: 사본의 deploy/package.json을 망가뜨리면 checkWorker가 실패한다
  assert.ok(checkWorker(copy({ 'worker/deploy/package.json': JSON.stringify({ ...DEP, scripts: { x: 'y' } }) })).some((e) => e.includes('deploy/package.json')));
  assert.ok(checkWorker(copy({ 'worker/deploy/package.json': null })).some((e) => e.includes('deploy/package.json')));
  assert.ok(checkWorker(copy({ 'worker/deploy/pnpm-lock.yaml': null })).some((e) => e.includes('deploy/pnpm-lock.yaml')));
});

test('lockedVersions: 두 lockfile의 wrangler = tools.json, 다른 버전·peer 접미·CRLF', () => {
  for (const f of ['pnpm-lock.yaml', 'deploy/pnpm-lock.yaml']) assert.deepEqual(lockedVersions(read(f), 'wrangler'), [TOOLS_WRANGLER], f);
  const lock = (v) => `packages:\n\n  wrangler@${v}:\n    resolution: {}\n\nsnapshots:\n\n  wrangler@${v}(@x/y@1.0.0):\n    dependencies: {}\n  other-wrangler@9.9.9:\n    x: 1\n`;
  assert.deepEqual(lockedVersions(lock('4.1.0'), 'wrangler'), ['4.1.0']);
  assert.deepEqual(lockedVersions(lock('4.1.0') + '  wrangler@4.2.0:\n', 'wrangler'), ['4.1.0', '4.2.0']);
  assert.deepEqual(lockedVersions(lock('4.1.0').replace(/\n/g, '\r\n'), 'wrangler'), ['4.1.0']);
  assert.deepEqual(lockedVersions('nothing', 'wrangler'), []);
  // 버전이 tools.json과 다른 lock은 checkWorker가 잡는다(둘 다)
  for (const f of ['pnpm-lock.yaml', 'deploy/pnpm-lock.yaml']) {
    const bad = read(f).replaceAll(`wrangler@${TOOLS_WRANGLER}`, 'wrangler@4.0.0');
    assert.ok(checkWorker(copy({ [`worker/${f}`]: bad })).some((e) => e.includes(f) && e.includes('tools.json')), f);
  }
});
