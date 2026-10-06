#!/usr/bin/env node
// worker/ 불변식 검사(docs/design/worker.md §13.2, cicd.md 구현 중 변경 83·85·86). 의존성 없는 Node라 worker gate에서
// pnpm install보다 먼저 돌고(allowBuilds를 넓힌 변경이 설치 스크립트를 돌리기 전에 멈춘다), worker/node_modules가 없는
// scripts (windows) 작업에서도 돈다(테스트는 worker-config.test.mjs).
//
//   node scripts/ci/worker-config.mjs [--root <dir>]                    # 원본: wrangler.jsonc·package.json·.dev.vars.example·소스
//   node scripts/ci/worker-config.mjs --dist [--root <dir>]             # worker gate의 pnpm build(deploy --dry-run) 뒤 산출물
//   node scripts/ci/worker-config.mjs --sentinel plant|check [--root …]  # (CI만) 가짜 비밀값 파일 씨앗을 심고 새지 않았는지 본다
//
// 이 스크립트는 worker/의 비밀값 파일(.dev.vars, 1Password FIFO 마운트)을 열지 않는다: 이름을 정해 읽는 파일과 src/·test/·
// scripts/ 아래의 일반 파일만 읽고, 그림자 설정은 있는지만 본다. --sentinel은 CI(CI=true)에서만 움직이고 그 파일을 읽지 않는다
// (plant는 O_EXCL로 만들어 무엇이든 이미 있으면 열지 않고 실패한다). 검사 목록:
//   wrangler.jsonc  최상위 키 허용 목록. account_id·routes·route·zone_id·zone_name·custom_domain·migrations·env는 어디에도 없다.
//                   workers_dev true·preview_urls false·send_metrics false, DO는 exports(AuthStore, sqlite)와 바인딩 AUTH만,
//                   R2는 DIST 하나, vars는 운영 치지직 주소 두 개뿐(PUBLIC_ORIGIN·START_RATE_10M·BUILD_ID·비밀값 없음),
//                   observability.logs.invocation_logs false(요청 URL에 OAuth code·state가 실린다).
//   그림자 파일     worker/에 wrangler.json·wrangler.toml(wrangler가 jsonc보다 먼저 고른다)·.wrangler/deploy/config.json
//                   (리디렉트)·worker-configuration.d.ts(wrangler dev가 이 파일이 있으면 env 파일 없이 타입을 다시 만들며
//                   실제 비밀값 파일을 연다, worker.md 구현 중 변경 9)·vitest.config.ts 밖의 vite/vitest 설정이 없다.
//   package.json    런타임 의존성 0, devDependencies 정확 고정, wrangler = tools.json, packageManager = app/package.json.
//                   알려진 스크립트(check·test·build·dev·dev:real)는 글자 그대로(EXPECTED_SCRIPTS). 모든 스크립트에서:
//                   실제 비밀값 파일 이름과 dev:real 호출은 dev:real 밖에 없다, wrangler(경로·@버전·.js 포함)는 dev·types·deploy만이고 늘
//                   --config wrangler.jsonc, dev·types는 --env-file(값은 .dev.vars.example, dev:real만 .dev.vars),
//                   dev는 --port 8787, deploy는 --dry-run, --env 금지, types는 출력 경로 worker-env.d.ts가 바로 뒤.
//                   vitest는 --config·--root를 쓰지 않는다(vitest.config.ts만 검사된다). --flag=값은 --flag 값으로 본다.
//   pnpm-workspace.yaml  설치 스크립트 허용(allowBuilds)은 esbuild·workerd만.
//   .dev.vars.example    키 집합 = src/config.ts CONFIG_KEYS, 값은 자리표시(루프백·dev- 접두·합성 채널 ID).
//   vitest.config.ts     주석을 지운 코드의 cloudflareTest({ wrangler: { … } }) 안에 environment "example" 하나와
//                        configPath ./wrangler.jsonc(vitest가 실제 비밀값 파일 대신 .dev.vars.example을 읽는다,
//                        worker.md 구현 중 변경 5), .dev.vars.example 바인딩.
//   소스            console.은 src/core/log.ts에서만, CI_VERIFY_TOKEN은 src/config.ts·src/http/release-auth.ts에서만,
//                   src/core/는 cloudflare:* 값 import 없음, src·test·scripts·설정에 실제 비밀값 파일 이름이 나오지 않는다
//                   (사용자가 직접 돌리는 scripts/channel-id-check.mjs만 예외).
//   --dist          dist/bundle-meta.json(esbuild metafile)의 입력이 모두 src/*.ts(런타임 의존성 0), dist/index.js 있음,
//                   dist/wrangler.json이 있으면(W8 worker-bundle이 만든다) 금지 키·vars 규칙.
//   --sentinel      plant: worker/.dev.vars를 LEAK_SENTINEL 한 줄로 새로 만든다(pnpm check·vitest 전). check: 그 파일을
//                   지우고 worker-env.d.ts에 LEAK_SENTINEL이 없는지 본다(vitest 쪽은 test/bindings.test.ts의 "문자열 바인딩
//                   집합 = CONFIG_KEYS"가 잡는다). 로컬(CI 아님)에서는 아무것도 하지 않는다: 그 자리에 실제 FIFO가 있다.
// 위반이 있으면 1, 사용법 오류 2.

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DEFAULT = join(fileURLToPath(import.meta.url), '..', '..', '..');
export const WORKER_DIR = 'worker';

// ---- 고정 값(바꾸려면 설계 문서와 함께) ----
export const WORKER_NAME = 'chzzk-downloader';
export const DO_CLASS = 'AuthStore';
export const DO_BINDING = 'AUTH';
export const R2_BINDING = 'DIST';
export const R2_BUCKET = 'chzzk-downloader-dist';
export const DEV_PORT = '8787';
export const EXAMPLE_FILE = '.dev.vars.example';
// 실제 비밀값 파일(1Password FIFO 마운트). 이 스크립트는 이 이름을 lstat·O_EXCL 생성·unlink에만 쓴다(열지 않는다)
export const REAL_FILE = '.dev.vars';
export const CONFIG_FILE = 'wrangler.jsonc';
// wrangler types 출력. 기본 이름(worker-configuration.d.ts)을 쓰지 않는다: wrangler dev가 그 파일이 있으면 env 파일 목록 없이
// 타입을 다시 만들어 보며 실제 비밀값 파일을 연다(worker.md 구현 중 변경 9)
export const TYPES_FILE = 'worker-env.d.ts';
export const DEFAULT_TYPES_FILE = 'worker-configuration.d.ts';
// 알려진 스크립트는 글자 그대로다(바꾸려면 여기·설계 문서·FIFO 실측을 함께)
export const EXPECTED_SCRIPTS = {
  check: `wrangler types ${TYPES_FILE} --config ${CONFIG_FILE} --include-runtime=false --env-file ${EXAMPLE_FILE} && tsc --noEmit`,
  test: 'vitest run',
  build: `wrangler deploy --dry-run --config ${CONFIG_FILE} --outdir dist --metafile`,
  dev: `wrangler dev --config ${CONFIG_FILE} --port ${DEV_PORT} --env-file ${EXAMPLE_FILE}`,
  'dev:real': `wrangler dev --config ${CONFIG_FILE} --port ${DEV_PORT} --env-file ${REAL_FILE} --var PUBLIC_ORIGIN:http://localhost:${DEV_PORT}`,
};
// 실제 비밀값 파일을 쓰는 유일한 스크립트(사용자가 직접 돌리는 실제 치지직 로그인)
export const REAL_SCRIPT = 'dev:real';
// worker/에 있으면 안 되는 그림자 설정(있는지만 본다). wrangler는 --config가 없으면 wrangler.json → wrangler.jsonc →
// wrangler.toml 순으로 고르고 .wrangler/deploy/config.json 리디렉트를 따른다(wrangler 4.147.0 findWranglerConfig)
export const SHADOW_FILES = ['wrangler.json', 'wrangler.toml', '.wrangler/deploy/config.json', DEFAULT_TYPES_FILE];
// vitest가 고를 수 있는 다른 설정(vitest.config.ts만 검사한다)
const OTHER_VITE_CONFIG = /^(?:vite|vitest)\.(?:config|workspace)\.[cm]?[jt]s$/;
// CI 누출 씨앗(--sentinel)
export const SENTINEL_KEY = 'LEAK_SENTINEL';
export const SENTINEL_TEXT = `${SENTINEL_KEY}=leak-sentinel\n`;
// 운영 치지직 주소(공개 값). src/config.ts의 PROD_*와 같다
export const PROD_VARS = {
  CHZZK_AUTHORIZE_URL: 'https://chzzk.naver.com/account-interlock',
  CHZZK_API_BASE: 'https://openapi.chzzk.naver.com',
};
// 어디에도 있으면 안 되는 키(계정·도메인을 저장소에 묶거나, exports와 섞이는 레거시 DO 선언이거나, 환경별 절)
export const FORBIDDEN_KEYS = ['account_id', 'routes', 'route', 'zone_id', 'zone_name', 'custom_domain', 'migrations', 'env'];
// wrangler.jsonc 최상위 키 허용 목록. 새 키를 쓰면 여기와 설계 문서를 함께 고친다
export const TOP_KEYS = ['$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls', 'send_metrics', 'exports', 'durable_objects', 'r2_buckets', 'vars', 'observability'];
// 설치 스크립트를 허용하는 패키지
export const ALLOWED_BUILDS = ['esbuild', 'workerd'];
// 합성 채널 ID(testdata/README.md, public-scan HEX_ID_ALLOWLIST의 앞 넷)
export const SYNTHETIC_CHANNEL_IDS = ['a1', 'b2', 'c3', 'd4'].map((s) => s.padStart(32, '0'));
// CI 토큰을 읽어도 되는 소스(worker.md §4.5)
export const CI_TOKEN_FILES = ['src/config.ts', 'src/http/release-auth.ts'];
export const LOG_FILE = 'src/core/log.ts';
// 실제 비밀값 파일을 직접 읽어도 되는 도구(사용자가 직접 돌리는 G-ID 확인, worker.md §15)
export const DEV_VARS_READERS = ['scripts/channel-id-check.mjs'];

const LOOPBACK = new Set(['localhost', '127.0.0.1']);
const isLoopbackHttp = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
};
// .dev.vars.example 값 규칙(키마다 하나. 규칙이 없는 키는 실패한다: 키를 더하면 자리표시 규칙도 정한다)
export const PLACEHOLDER_RULES = {
  PUBLIC_ORIGIN: (v) => v === `http://localhost:${DEV_PORT}`,
  CHZZK_AUTHORIZE_URL: isLoopbackHttp,
  CHZZK_API_BASE: isLoopbackHttp,
  CHZZK_CLIENT_ID: (v) => /^dev-[a-z0-9-]+$/.test(v),
  CHZZK_CLIENT_SECRET: (v) => /^dev-[a-z0-9-]+$/.test(v),
  CI_VERIFY_TOKEN: (v) => /^dev-[a-z0-9-]+$/.test(v),
  ADMIN_CHANNEL_IDS: (v) => v === '' || v.split(',').every((id) => SYNTHETIC_CHANNEL_IDS.includes(id)),
  BUILD_ID: (v) => v === 'dev',
  START_RATE_10M: (v) => /^[1-9][0-9]{0,6}$/.test(v),
};

// ---- JSONC ----

// 문자열 밖만 훑는다. comments: 주석(// …, /* … */)을 지운다, 아니면 끝 쉼표(다음 의미 있는 글자가 } 또는 ])를 지운다.
// 문자열 안(예: "https://…")은 그대로 둔다. 주석을 먼저 지우고 쉼표를 지워야 `1, // 주석\n}`도 풀린다.
function scanJsonc(text, comments) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (comments && c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (comments && c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('닫히지 않은 /* 주석');
      i = end + 2;
    } else if (!comments && c === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] !== '}' && text[j] !== ']') out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function stripJsonc(text) {
  return scanJsonc(scanJsonc(text, true), false);
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

// 객체 안 어디든(배열 포함) 금지 키의 경로
export function findKeys(value, keys, path = '') {
  const out = [];
  if (Array.isArray(value)) value.forEach((v, i) => out.push(...findKeys(v, keys, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (keys.includes(k)) out.push(p);
      out.push(...findKeys(v, keys, p));
    }
  }
  return out;
}

// vars 규칙(원본·dist 공통): 운영 치지직 주소 두 개만, 값은 운영 값과 같다
function varsErrors(vars) {
  const errs = [];
  if (vars === undefined) return errs;
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) return ['vars는 객체다'];
  for (const [k, v] of Object.entries(vars)) {
    if (!Object.hasOwn(PROD_VARS, k)) {
      const why = k === 'PUBLIC_ORIGIN' ? '(배포 --var로만, dev 값이 운영 Worker를 dev 모드로 띄운다)' : k === 'START_RATE_10M' ? '(dev 모드 전용)' : k === 'BUILD_ID' ? '(배포 --var로만)' : /SECRET|TOKEN|KEY|PASSWORD|ADMIN|CLIENT/.test(k) ? '(비밀값은 wrangler secret put)' : '';
      errs.push(`vars에 ${k}를 두지 않는다${why}`);
    } else if (v !== PROD_VARS[k]) errs.push(`vars.${k}는 운영 값 ${PROD_VARS[k]}여야 한다`);
  }
  return errs;
}

export function checkWrangler(cfg) {
  const errs = [];
  for (const p of findKeys(cfg, FORBIDDEN_KEYS)) errs.push(`금지 키 ${p}(account_id는 배포 env CLOUDFLARE_ACCOUNT_ID, 경로·도메인·환경 절·migrations는 두지 않는다)`);
  for (const k of Object.keys(cfg)) if (!TOP_KEYS.includes(k) && !FORBIDDEN_KEYS.includes(k)) errs.push(`허용 목록에 없는 최상위 키 ${k}(scripts/ci/worker-config.mjs TOP_KEYS와 설계를 함께 고친다)`);
  if (cfg.name !== WORKER_NAME) errs.push(`name은 ${WORKER_NAME}`);
  if (cfg.main !== 'src/index.ts') errs.push('main은 src/index.ts');
  if (typeof cfg.compatibility_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cfg.compatibility_date)) errs.push('compatibility_date는 YYYY-MM-DD로 고정한다');
  if (cfg.workers_dev !== true) errs.push('workers_dev: true');
  if (cfg.preview_urls !== false) errs.push('preview_urls: false');
  if (cfg.send_metrics !== false) errs.push('send_metrics: false');
  if (!isDeepStrictEqual(cfg.exports, { [DO_CLASS]: { type: 'durable-object', storage: 'sqlite' } })) errs.push(`exports는 {"${DO_CLASS}": {"type":"durable-object","storage":"sqlite"}} 하나(클래스 이름은 첫 배포 뒤 바꾸지 않는다)`);
  if (!isDeepStrictEqual(cfg.durable_objects, { bindings: [{ name: DO_BINDING, class_name: DO_CLASS }] })) errs.push(`durable_objects는 바인딩 ${DO_BINDING} → ${DO_CLASS} 하나`);
  if (!isDeepStrictEqual(cfg.r2_buckets, [{ binding: R2_BINDING, bucket_name: R2_BUCKET }])) errs.push(`r2_buckets는 ${R2_BINDING} → ${R2_BUCKET} 하나`);
  errs.push(...varsErrors(cfg.vars));
  if (cfg.observability?.logs?.invocation_logs !== false) errs.push('observability.logs.invocation_logs: false(요청 URL의 code·state가 로그에 남는다)');
  return errs;
}

// ---- package.json·pnpm-workspace.yaml ----

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// 셸 명령 문자열 → 명령(구분자 &&·||·;·| 기준)마다 토큰 배열. 둘레 따옴표를 벗기고 --flag=값은 [--flag, 값]으로 나눈다
export function scriptCommands(cmd) {
  const toks = String(cmd)
    .replace(/(&&|\|\||;|\|)/g, ' $1 ')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^["']|["']$/g, ''))
    .flatMap((t) => {
      const m = /^(--?[\w-]+)=(.*)$/.exec(t);
      return m ? [m[1], m[2]] : [t];
    });
  const parts = [[]];
  for (const t of toks) {
    if (['&&', '||', ';', '|'].includes(t)) parts.push([]);
    else if (t !== '') parts.at(-1).push(t);
  }
  return parts.filter((p) => p.length);
}
// 경로·@버전·.js를 붙여도 그 도구다(node_modules/.bin/wrangler, npx wrangler@4, …/bin/wrangler.js)
const isTool = (name) => (t) => new RegExp(`(?:^|[\\\\/])${name}(?:@[^\\\\/]*)?(?:\\.[cm]?js)?$`).test(t);
const isWrangler = isTool('wrangler');
const isVitest = isTool('vitest');
// 값을 받는 wrangler 플래그(부명령을 찾을 때 그 값을 건너뛴다). --env-file은 여러 값을 받는다(yargs array)
const WRANGLER_VALUE_FLAGS = new Set(['--config', '-c', '--env', '-e', '--cwd']);
const WRANGLER_SUBS = ['dev', 'types', 'deploy'];
// flag 뒤의 값들. multi면 다음 -로 시작하는 토큰 전까지(yargs array 옵션은 뒤따르는 위치 인자도 삼킨다)
function flagValues(toks, flags, multi = false) {
  const out = [];
  toks.forEach((t, i) => {
    if (!flags.includes(t)) return;
    if (!multi) out.push(toks[i + 1]);
    else for (let j = i + 1; j < toks.length && !toks[j].startsWith('-'); j++) out.push(toks[j]);
  });
  return out;
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// wrangler 명령 하나(토큰 배열, wrangler 토큰 뒤부터)
function wranglerErrors(name, rest) {
  const errs = [];
  const at = `scripts.${name}`;
  let sub;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t.startsWith('-')) {
      if (WRANGLER_VALUE_FLAGS.has(t)) i++;
      continue;
    }
    sub = t;
    break;
  }
  if (!WRANGLER_SUBS.includes(sub)) {
    errs.push(`${at}: wrangler ${sub ?? '(부명령 없음)'}을 스크립트로 두지 않는다(dev·types·deploy만. 배포·로그인·리소스는 release.yml·사람)`);
    return errs;
  }
  // --config가 없으면 wrangler가 wrangler.json·wrangler.toml·리디렉트를 먼저 고를 수 있다
  if (!same(flagValues(rest, ['--config', '-c']), [CONFIG_FILE])) errs.push(`${at}: wrangler ${sub}는 --config ${CONFIG_FILE} 하나(검사된 설정만 쓴다)`);
  if (flagValues(rest, ['--env', '-e']).length) errs.push(`${at}: wrangler --env를 쓰지 않는다(wrangler.jsonc에 환경 절이 없다)`);
  if (sub === 'dev' || sub === 'types') {
    const files = flagValues(rest, ['--env-file'], true);
    const allowed = name === REAL_SCRIPT ? [REAL_FILE] : [EXAMPLE_FILE];
    if (files.length === 0) errs.push(`${at}: wrangler ${sub}에 --env-file이 없다(없으면 wrangler가 실제 비밀값 파일을 연다)`);
    else if (!files.every((f) => allowed.includes(f))) errs.push(`${at}: wrangler ${sub}의 --env-file은 ${allowed.join('·')}만(지금 ${files.join(' ')}. 뒤따르는 위치 인자도 env 파일로 읽힌다)`);
  }
  if (sub === 'dev' && !same(flagValues(rest, ['--port']), [DEV_PORT])) errs.push(`${at}: wrangler dev는 --port ${DEV_PORT}(등록된 개발용 리디렉션 http://localhost:${DEV_PORT}/auth/callback)`);
  if (sub === 'deploy' && !rest.includes('--dry-run')) errs.push(`${at}: wrangler deploy는 --dry-run만(배포는 release.yml deploy-worker)`);
  if (sub === 'types' && rest[rest.indexOf('types') + 1] !== TYPES_FILE) errs.push(`${at}: wrangler types는 출력 경로 ${TYPES_FILE}를 바로 뒤에(기본 ${DEFAULT_TYPES_FILE}가 있으면 wrangler dev가 실제 비밀값 파일을 연다)`);
  return errs;
}

export function checkPackage(pkg, { wrangler, packageManager } = {}) {
  const errs = [];
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) errs.push(`런타임 의존성은 0개다: ${Object.keys(pkg.dependencies).join(', ')}`);
  for (const [name, v] of Object.entries(pkg.devDependencies ?? {})) if (!EXACT.test(v)) errs.push(`devDependencies.${name}은 정확한 버전이어야 한다(지금 ${v})`);
  if (wrangler && pkg.devDependencies?.wrangler !== wrangler) errs.push(`wrangler ${pkg.devDependencies?.wrangler} ≠ tools.json ${wrangler}`);
  if (packageManager && pkg.packageManager !== packageManager) errs.push(`packageManager ${pkg.packageManager} ≠ app/package.json ${packageManager}`);
  const scripts = pkg.scripts ?? {};
  for (const [name, want] of Object.entries(EXPECTED_SCRIPTS)) {
    if (scripts[name] !== want) errs.push(`scripts.${name}는 글자 그대로 "${want}"(scripts/ci/worker-config.mjs EXPECTED_SCRIPTS와 설계를 함께 고친다)`);
  }
  for (const [name, cmd] of Object.entries(scripts)) {
    // 실제 비밀값 파일은 dev:real만 쓴다(어떤 명령으로든: cat·node -e·--env-file=…)
    if (name !== REAL_SCRIPT && BARE_DEV_VARS.test(String(cmd))) errs.push(`scripts.${name}: 실제 비밀값 파일(${REAL_FILE})은 ${REAL_SCRIPT}만 쓴다`);
    for (const p of scriptCommands(cmd)) {
      // dev:real을 다른 스크립트가 부르면(pnpm dev:real·pnpm run dev:real·npm run dev:real) 이름 없이 실제 비밀값 파일을 쓴다
      if (name !== REAL_SCRIPT && p.includes(REAL_SCRIPT)) errs.push(`scripts.${name}: ${REAL_SCRIPT}를 다른 스크립트에서 부르지 않는다(실제 비밀값 파일은 사용자가 직접 ${REAL_SCRIPT}로만)`);
      const w = p.findIndex(isWrangler);
      if (w >= 0) errs.push(...wranglerErrors(name, p.slice(w + 1)));
      const v = p.findIndex(isVitest);
      if (v >= 0 && flagValues(p.slice(v + 1), ['--config', '-c', '--root', '-r']).length) errs.push(`scripts.${name}: vitest에 --config·--root를 주지 않는다(검사되는 설정은 vitest.config.ts뿐)`);
    }
  }
  return errs;
}

// allowBuilds 블록의 키(값이 true인 것). 이 파일의 모양(2칸 들여쓴 `이름: true`)만 읽는다
export function allowedBuilds(yaml) {
  const out = [];
  let inBlock = false;
  for (const line of yaml.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\S/.test(line)) inBlock = /^allowBuilds:\s*(#.*)?$/.test(line);
    else if (inBlock) {
      const m = /^\s+["']?([@\w./-]+)["']?:\s*(\S+)\s*(#.*)?$/.exec(line);
      if (m && m[2] !== 'false') out.push(m[1]);
    }
  }
  return out.sort();
}

export function checkWorkspace(yaml) {
  const errs = [];
  if (/dangerouslyAllowAllBuilds|onlyBuiltDependencies|neverBuiltDependencies/.test(yaml)) errs.push('설치 스크립트 허용은 allowBuilds로만 한다');
  const got = allowedBuilds(yaml);
  if (got.join(',') !== [...ALLOWED_BUILDS].sort().join(',')) errs.push(`allowBuilds [${got}] ≠ [${ALLOWED_BUILDS}]`);
  return errs;
}

// ---- .dev.vars.example·config.ts·vitest.config.ts ----

// src/config.ts의 `export const CONFIG_KEYS = [ … ] as const;`
export function configKeys(configTs) {
  const m = /export const CONFIG_KEYS = \[([\s\S]*?)\] as const;/.exec(configTs);
  if (!m) return null;
  return [...m[1].matchAll(/"([A-Z0-9_]+)"/g)].map((x) => x[1]);
}

export function parseDevVars(text) {
  const out = {};
  const errs = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*)=([^\s"'`$\\]*)$/.exec(t);
    if (!m) errs.push(`줄 형식(KEY=값, 따옴표·공백·$ 없음): ${t.split('=')[0]}`);
    else if (Object.hasOwn(out, m[1])) errs.push(`키 중복: ${m[1]}`);
    else out[m[1]] = m[2];
  }
  return { vars: out, errs };
}

export function checkDevVarsExample(text, keys) {
  const { vars, errs } = parseDevVars(text);
  const have = Object.keys(vars).sort();
  const want = [...keys].sort();
  for (const k of want) if (!have.includes(k)) errs.push(`${EXAMPLE_FILE}에 ${k}가 없다(src/config.ts CONFIG_KEYS)`);
  for (const k of have) if (!want.includes(k)) errs.push(`${EXAMPLE_FILE}의 ${k}를 코드가 읽지 않는다(CONFIG_KEYS에 없음)`);
  for (const [k, v] of Object.entries(vars)) {
    const rule = PLACEHOLDER_RULES[k];
    if (!rule) errs.push(`${k}: 자리표시 규칙이 없다(worker-config.mjs PLACEHOLDER_RULES)`);
    else if (!rule(v)) errs.push(`${k}: 자리표시 값이 아니다(루프백·dev- 접두·합성 채널 ID만)`);
  }
  return errs;
}

// JS·TS 주석을 지운다(문자열 ' " ` 안은 그대로. 정규식 리터럴·템플릿 안의 ${} 중첩은 다루지 않는다: vitest.config.ts 모양만)
export function stripJsComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function checkVitestConfig(text) {
  const errs = [];
  const code = stripJsComments(text);
  // cloudflareTest({ … wrangler: { … } … }) 안의 wrangler 객체(중괄호 중첩 없음). 주석 속 글자로는 통과하지 않는다
  const wranglerKeys = code.match(/\bwrangler\s*:/g) ?? [];
  const m = /cloudflareTest\(\s*\{[\s\S]*?\bwrangler\s*:\s*\{([^{}]*)\}/.exec(code);
  if (wranglerKeys.length !== 1 || !m) errs.push('vitest.config.ts: cloudflareTest({ wrangler: { … } })가 하나여야 한다');
  else {
    const body = m[1];
    const envs = body.match(/\benvironment\s*:/g) ?? [];
    if (envs.length !== 1 || !/\benvironment\s*:\s*["']example["']/.test(body)) errs.push('vitest.config.ts: wrangler environment "example"가 없다(없으면 vitest가 실제 비밀값 파일을 연다)');
    if (!/\bconfigPath\s*:\s*["']\.\/wrangler\.jsonc["']/.test(body)) errs.push('vitest.config.ts: configPath는 ./wrangler.jsonc');
    if (body.includes('...')) errs.push('vitest.config.ts: wrangler 객체에 펼침(...)을 쓰지 않는다(뒤에서 environment를 덮을 수 있다)');
  }
  // 바인딩 원천: new URL("./.dev.vars.example", import.meta.url)을 읽어 miniflare.bindings로 덮는다
  if (!/new URL\(\s*["']\.\/\.dev\.vars\.example["']/.test(code) || !/\bminiflare\s*:\s*\{\s*bindings\s*:/.test(code)) errs.push(`vitest.config.ts: 바인딩을 ${EXAMPLE_FILE}에서 만들지 않는다(miniflare.bindings)`);
  return errs;
}

// ---- 소스 ----

// 실제 비밀값 파일 이름(.dev.vars 뒤에 . 또는 글자가 붙지 않는 것)
export const BARE_DEV_VARS = /\.dev\.vars(?![.\w])/;

// files: [{ rel(worker/ 기준), text }]
export function checkSources(files) {
  const errs = [];
  for (const { rel, text } of files) {
    const lines = text.split(/\r?\n/);
    lines.forEach((l, i) => {
      const at = `${rel}:${i + 1}`;
      if (BARE_DEV_VARS.test(l) && !DEV_VARS_READERS.includes(rel)) errs.push(`${at}: 실제 비밀값 파일 이름(.dev.vars)을 쓰지 않는다(${EXAMPLE_FILE}만)`);
      if (rel.startsWith('src/')) {
        if (/\bconsole\s*\./.test(l) && rel !== LOG_FILE) errs.push(`${at}: console.은 ${LOG_FILE}에서만(log() 하나로 허용 필드만 남긴다)`);
        if (l.includes('CI_VERIFY_TOKEN') && !CI_TOKEN_FILES.includes(rel)) errs.push(`${at}: CI_VERIFY_TOKEN은 ${CI_TOKEN_FILES.join('·')}에서만 읽는다`);
        if (rel.startsWith('src/core/') && /^\s*import\s+(?!type\b)[^;]*from\s+["']cloudflare:/.test(l)) errs.push(`${at}: src/core/는 cloudflare:* 를 import하지 않는다(순수 함수)`);
      }
    });
  }
  return errs;
}

// dir 아래 일반 파일(심볼릭 링크·FIFO 제외)을 worker/ 기준 경로로. node_modules·dist·.wrangler는 들어가지 않는다
function listFiles(workerRoot, rel) {
  const out = [];
  const abs = join(workerRoot, rel);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!['node_modules', 'dist', '.wrangler'].includes(e.name)) out.push(...listFiles(workerRoot, p));
    } else if (e.isFile() && /\.(?:[cm]?[jt]s|tsx?|json|jsonc)$/.test(e.name)) out.push(p);
  }
  return out;
}

const readText = (p) => readFileSync(p, 'utf8');
// 일반 파일만 읽는다(FIFO·장치를 열면 막힐 수 있다)
function readRegular(p) {
  if (!existsSync(p)) return null;
  if (!lstatSync(p).isFile()) throw new Error(`${p}가 일반 파일이 아니다`);
  return readText(p);
}

// ---- 진입 ----

export function checkWorker(root) {
  const w = join(root, WORKER_DIR);
  const errs = [];
  const add = (file, list) => list.forEach((m) => errs.push(`${WORKER_DIR}/${file}: ${m}`));
  const need = (file) => {
    const t = readRegular(join(w, file));
    if (t === null) errs.push(`${WORKER_DIR}/${file}: 없다`);
    return t;
  };

  // 그림자 설정: 있는지만 본다(열지 않는다)
  for (const f of SHADOW_FILES) {
    if (existsSync(join(w, f))) errs.push(`${WORKER_DIR}/${f}: 두지 않는다(${f === DEFAULT_TYPES_FILE ? `wrangler dev가 이 파일이 있으면 실제 비밀값 파일을 연다. 지우고 pnpm check로 ${TYPES_FILE}를 만든다` : `wrangler가 ${CONFIG_FILE} 대신 고를 수 있다`})`);
  }
  if (existsSync(w)) {
    for (const f of readdirSync(w)) if (OTHER_VITE_CONFIG.test(f) && f !== 'vitest.config.ts') errs.push(`${WORKER_DIR}/${f}: vitest 설정은 vitest.config.ts 하나(다른 설정은 검사되지 않는다)`);
  }
  const wr = need(CONFIG_FILE);
  if (wr !== null) {
    try {
      add('wrangler.jsonc', checkWrangler(parseJsonc(wr)));
    } catch (e) {
      add('wrangler.jsonc', [`JSONC 해석 실패: ${e.message}`]);
    }
  }
  const pkgText = need('package.json');
  if (pkgText !== null) {
    const tools = JSON.parse(readText(join(root, 'scripts/ci/tools.json'))).tools;
    const appPkg = readRegular(join(root, 'app/package.json'));
    add('package.json', checkPackage(JSON.parse(pkgText), { wrangler: tools.wrangler?.version ?? '(tools.json에 wrangler 없음)', packageManager: appPkg ? JSON.parse(appPkg).packageManager : undefined }));
  }
  const ws = need('pnpm-workspace.yaml');
  if (ws !== null) add('pnpm-workspace.yaml', checkWorkspace(ws));
  if (need('pnpm-lock.yaml') === null) errs.push(`${WORKER_DIR}/pnpm-lock.yaml: 독립 lockfile이 있어야 한다(--frozen-lockfile)`);
  const configTs = need('src/config.ts');
  const keys = configTs === null ? null : configKeys(configTs);
  if (configTs !== null && !keys) add('src/config.ts', ['export const CONFIG_KEYS = [ … ] as const; 를 찾지 못했다']);
  const ex = need(EXAMPLE_FILE);
  if (ex !== null && keys) add(EXAMPLE_FILE, checkDevVarsExample(ex, keys));
  const vc = need('vitest.config.ts');
  if (vc !== null) add('vitest.config.ts', checkVitestConfig(vc));
  const files = [...listFiles(w, 'src'), ...listFiles(w, 'test'), ...listFiles(w, 'scripts'), 'vitest.config.ts', 'wrangler.jsonc', 'tsconfig.json']
    .filter((rel) => existsSync(join(w, rel)))
    .map((rel) => ({ rel, text: readRegular(join(w, rel)) }));
  errs.push(...checkSources(files).map((m) => `${WORKER_DIR}/${m}`));
  return errs;
}

export function checkDist(root) {
  const w = join(root, WORKER_DIR);
  const errs = [];
  const meta = readRegular(join(w, 'dist/bundle-meta.json'));
  if (meta === null) errs.push(`${WORKER_DIR}/dist/bundle-meta.json이 없다(pnpm build = deploy --dry-run --outdir dist --metafile 뒤에 돈다)`);
  else {
    const m = JSON.parse(meta);
    const inputs = Object.keys(m.inputs ?? {});
    if (inputs.length === 0) errs.push(`${WORKER_DIR}/dist/bundle-meta.json: 입력이 없다`);
    // 번들에 들어간 모듈은 우리 소스뿐이다(런타임 의존성 0. 의존성이 코드를 끼우면 여기 보인다, 위험 R3)
    for (const i of inputs) if (!/^src\/[\w./-]+\.ts$/.test(i) || i.includes('..')) errs.push(`${WORKER_DIR}/dist: 번들 입력이 src/*.ts가 아니다: ${i}`);
  }
  if (!existsSync(join(w, 'dist/index.js'))) errs.push(`${WORKER_DIR}/dist/index.js가 없다`);
  // deploy --dry-run은 dist/wrangler.json을 쓰지 않는다(worker.md 구현 중 변경 2). W8 worker-bundle이 만들면 여기서 본다
  const dw = readRegular(join(w, 'dist/wrangler.json'));
  if (dw !== null) {
    const cfg = JSON.parse(dw);
    for (const p of findKeys(cfg, FORBIDDEN_KEYS)) errs.push(`${WORKER_DIR}/dist/wrangler.json: 금지 키 ${p}`);
    for (const e of varsErrors(cfg.vars)) errs.push(`${WORKER_DIR}/dist/wrangler.json: ${e}`);
  }
  return errs;
}

// ---- CI 누출 씨앗(--sentinel) ----

export const inCI = (env) => env.CI === 'true' || env.CI === '1';

// worker gate의 pnpm check·vitest 전에 실제 비밀값 파일 자리에 가짜 키 하나를 심는다. 로컬에서는 그 자리가 1Password FIFO라
// 아무것도 하지 않는다. CI에서도 O_EXCL(wx)이라 무엇이든 이미 있으면(FIFO 포함) 열지 않고 EEXIST로 실패한다.
export function plantSentinel(root, env = process.env) {
  if (!inCI(env)) return { errs: [], note: '로컬이라 건너뜀(CI에서만 심는다)' };
  const p = join(root, WORKER_DIR, REAL_FILE);
  try {
    writeFileSync(p, SENTINEL_TEXT, { flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') return { errs: [`${WORKER_DIR}/${REAL_FILE}가 이미 있다: CI 체크아웃에는 없어야 한다(열지 않고 멈춘다)`] };
    throw e;
  }
  return { errs: [], note: `${WORKER_DIR}/${REAL_FILE}에 ${SENTINEL_KEY} 씨앗을 심었다` };
}

// vitest·pnpm check 뒤: 씨앗을 지우고(일반 파일이고 크기가 씨앗과 같을 때만, 읽지 않는다) 타입 생성물에 씨앗 키가 없는지 본다.
// vitest 쪽 누출은 test/bindings.test.ts의 "문자열 바인딩 집합 = CONFIG_KEYS"가 이미 실패시켰다.
export function checkSentinel(root, env = process.env) {
  if (!inCI(env)) return { errs: [], note: '로컬이라 건너뜀(CI에서만 본다)' };
  const w = join(root, WORKER_DIR);
  const p = join(w, REAL_FILE);
  const errs = [];
  let st = null;
  try {
    st = lstatSync(p);
  } catch {
    errs.push(`${WORKER_DIR}/${REAL_FILE} 씨앗이 없다(--sentinel plant가 먼저 돈다)`);
  }
  if (st) {
    if (st.isFile() && st.size === Buffer.byteLength(SENTINEL_TEXT)) unlinkSync(p);
    else errs.push(`${WORKER_DIR}/${REAL_FILE}가 씨앗이 아니다(일반 파일·크기 다름): 지우지 않는다`);
  }
  const types = readRegular(join(w, TYPES_FILE));
  if (types === null) errs.push(`${WORKER_DIR}/${TYPES_FILE}가 없다(pnpm check가 먼저 돈다)`);
  else if (types.includes(SENTINEL_KEY)) errs.push(`${WORKER_DIR}/${TYPES_FILE}에 ${SENTINEL_KEY}가 있다: wrangler types가 실제 비밀값 파일을 읽었다(--env-file 확인, worker.md 구현 중 변경 4)`);
  return { errs, note: errs.length ? undefined : `씨앗을 지웠고 ${TYPES_FILE}에 ${SENTINEL_KEY}가 없다` };
}

export function main(argv, env = process.env) {
  let root = ROOT_DEFAULT;
  let mode = 'source';
  const usage = () => {
    console.error('사용법: worker-config.mjs [--dist | --sentinel plant|check] [--root <dir>]');
    return 2;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && i + 1 < argv.length) root = resolve(argv[++i]);
    else if (argv[i] === '--dist' && mode === 'source') mode = 'dist';
    else if (argv[i] === '--sentinel' && mode === 'source' && ['plant', 'check'].includes(argv[i + 1])) mode = `sentinel-${argv[++i]}`;
    else return usage();
  }
  let errs;
  let note;
  if (mode === 'sentinel-plant') ({ errs, note } = plantSentinel(root, env));
  else if (mode === 'sentinel-check') ({ errs, note } = checkSentinel(root, env));
  else errs = mode === 'dist' ? checkDist(root) : checkWorker(root);
  for (const e of errs) console.error(e);
  if (errs.length === 0) console.log(`worker-config ${mode}: ${note ?? '위반 없음'}`);
  return errs.length ? 1 : 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
