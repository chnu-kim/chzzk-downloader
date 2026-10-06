#!/usr/bin/env node
// 릴리스 진입점(docs/design/cicd.md §5, 구현 중 변경 G6). release.yml·rollback.yml·훅은 run.mjs gate로 이 파일을 부른다.
// 판정은 모두 결정적이다(종료 코드, 해시, 서명, 스키마, 실제 빌드·실행). 무거운 일은 xtask(Rust)가 하고 여기서는 순서를 정한다.
//
//   node scripts/ci/release.mjs pubkey        # release/updater.pub == tauri.conf.json plugins.updater.pubkey, release/tauri.release.json 허용 목록
//   node scripts/ci/release.mjs gate          # 태그 = 버전 파일, 단조 증가, master 조상, 그 커밋의 master ci-ok 녹색(기다림)
//   node scripts/ci/release.mjs build         # 임시 키로 릴리스 번들 + updater 산출물 → collect --release → 서명 형식 자체 확인
//   node scripts/ci/release.mjs xtask         # xtask를 빌드해 target/ci/xtask-bin에 담고 sha256을 출력(시크릿 없는 작업에서만)
//   node scripts/ci/release.mjs stage         # 받은 3 OS 산출물로 publish → verify를 가짜 S3에(임시 키, 시크릿 없음. 리허설의 끝)
//   node scripts/ci/release.mjs preflight     # 시크릿·변수가 모두 있는지(없으면 정확한 메시지로 실패)
//   node scripts/ci/release.mjs publish       # collect → sign → verify-sig → sums → manifest → put → promote(latest.json은 마지막)
//   node scripts/ci/release.mjs verify        # latest.json을 보고 결정표(verifyPlan)대로 확인. 판정 실패면 prev로 rollback하고 1
//   node scripts/ci/release.mjs rollback      # rollback.yml: ROLLBACK_VERSION으로 latest.json을 바꾼다(되돌리기·다시 올리기)
//   node scripts/ci/release.mjs selftest      # 가짜 S3(s3-fake.mjs)에 합성 산출물로 publish·verify·rollback 진입점 시나리오(release-selftest gate)
//   node scripts/ci/release.mjs worker        # Phase 3 seam: Worker 배포·확인. worker/가 생기기 전에는 늘 실패한다
//
// 종료 코드: 0 통과, 1 검사 실패(판정), 2 사용법·환경·기반 시설 오류(네트워크, HTTP 5xx: 되돌리지 않는다).

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, workspaceVersion } from './gates.mjs';
import { spawnTool } from './run.mjs';
import { osKey, targetDir } from './smoke.mjs';
import { main as versionCheck } from './version-check.mjs';

const IS_WIN = process.platform === 'win32';
const log = (m) => console.log(`release: ${m}`);
const err = (m) => console.error(`::error::release: ${m}`);
const sha256hex = (b) => createHash('sha256').update(b).digest('hex');

// release.yml sign-publish의 preflight가 보는 이름(docs/design/cicd.md §8). 순서가 메시지 순서다
export const RELEASE_SECRETS = [
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'DIST_BASE_URL',
];
export const preflightMessage = (missing) => `릴리스 시크릿 없음: ${missing.join(', ')}. 빌드·설치 스모크·수집·서명·매니페스트(가짜 S3, stage)까지는 통과, 업로드하지 않음`;
export const REHEARSAL_MESSAGE = '리허설은 업로드하지 않는다(시크릿이 모두 있어도 여기서 멈춘다)';

function ghOutput(env, pairs) {
  if (!env.GITHUB_OUTPUT) return;
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join(''));
}

// ---- semver ----

// xtask/src/semver.rs와 같은 규칙이다(worker.md 구현 중 변경 16 (마)). 공유 벡터 xtask/testdata/semver-vectors.json을
// release.test.mjs가 읽는다. 한쪽만 고치지 않는다.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const U64_MAX = '18446744073709551615';
// 숫자 문자열 → BigInt(u64 범위) | null. 앞자리 0은 값으로 읽는다(Rust parse::<u64>)
export function parseU64(s) {
  if (!/^\d+$/.test(s)) return null;
  const t = s.replace(/^0+(?=\d)/, '');
  if (t.length > 20 || (t.length === 20 && t > U64_MAX)) return null;
  return BigInt(t);
}
export function parseSemver(v) {
  const m = typeof v === 'string' ? SEMVER.exec(v) : null;
  if (!m) return null;
  const nums = [parseU64(m[1]), parseU64(m[2]), parseU64(m[3])];
  if (nums.some((n) => n === null)) return null;
  return { nums, pre: m[4] ? m[4].split('.') : [] };
}
export function cmpSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`semver가 아니다: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    const [pv, qv] = [parseU64(p), parseU64(q)];
    if (pv !== null && qv !== null) {
      if (pv !== qv) return pv < qv ? -1 : 1;
      continue;
    }
    // 한쪽만 숫자면 숫자가 작다. 둘 다 숫자가 아니면(u64를 넘는 숫자열 포함) 문자열 비교
    if (pv !== null) return -1;
    if (qv !== null) return 1;
    return p < q ? -1 : 1;
  }
  return Math.sign(x.pre.length - y.pre.length);
}

// ---- pubkey ----

// 공개 키 파일 내용 → 문제 목록. Tauri 형식: base64("untrusted comment: minisign public key: <16 hex>\n<base64 56자>\n"), 끝 줄바꿈 없음
export function pubkeyProblems(text) {
  const out = [];
  if (text !== text.trim() || text === '') return ['앞뒤 공백·줄바꿈 없는 base64 한 줄이어야 한다'];
  if (!/^[A-Za-z0-9+/]+=*$/.test(text)) return ['base64가 아니다'];
  const inner = Buffer.from(text, 'base64').toString('utf8');
  if (!/^untrusted comment: minisign public key: [0-9A-F]{16}\nRW[A-Za-z0-9+/]{54}\n$/.test(inner)) out.push('minisign 공개 키 텍스트(base64)가 아니다');
  return out;
}

// app/src-tauri/tauri*.conf.json마다 plugins.updater.pubkey → [{file, pubkey}](없는 파일은 pubkey undefined)
export function confPubkeys(root = ROOT) {
  const dir = join(root, 'app/src-tauri');
  return readdirSync(dir)
    .filter((f) => /^tauri(\.[a-z0-9-]+)?\.conf\.json$/.test(f))
    .sort()
    .map((f) => ({ file: `app/src-tauri/${f}`, pubkey: JSON.parse(readFileSync(join(dir, f), 'utf8'))?.plugins?.updater?.pubkey }));
}

// release/tauri.release.json(릴리스 빌드가 기본 설정 위에 덮어쓰는 파일) → 문제 목록. 허용 목록이다: bundle.createUpdaterArtifacts
// = true 하나만 둘 수 있다. plugins.updater.pubkey·endpoints 같은 키를 여기서 바꾸면 릴리스 앱만 다른 키·주소를 믿게 되는데
// 다른 어떤 검사도 그 파일을 보지 않는다(리뷰 G6).
export const RELEASE_CONF = 'release/tauri.release.json';
export function releaseConfProblems(conf) {
  const out = [];
  if (!conf || typeof conf !== 'object' || Array.isArray(conf)) return [`${RELEASE_CONF}: 객체가 아니다`];
  for (const k of Object.keys(conf)) if (k !== 'bundle') out.push(`${RELEASE_CONF}: 허용하지 않는 키 ${k}(bundle.createUpdaterArtifacts만 둔다)`);
  const b = conf.bundle;
  if (!b || typeof b !== 'object' || Array.isArray(b)) out.push(`${RELEASE_CONF}: bundle이 객체가 아니다`);
  else {
    for (const k of Object.keys(b)) if (k !== 'createUpdaterArtifacts') out.push(`${RELEASE_CONF}: 허용하지 않는 키 bundle.${k}`);
    if (b.createUpdaterArtifacts !== true) out.push(`${RELEASE_CONF}: bundle.createUpdaterArtifacts가 true가 아니다`);
  }
  return out;
}

export function checkPubkey(root = ROOT) {
  const problems = [];
  const rc = join(root, RELEASE_CONF);
  if (!existsSync(rc)) problems.push(`${RELEASE_CONF}가 없다`);
  else {
    try {
      problems.push(...releaseConfProblems(JSON.parse(readFileSync(rc, 'utf8'))));
    } catch (e) {
      problems.push(`${RELEASE_CONF}: JSON이 아니다(${e.message})`);
    }
  }
  const p = join(root, 'release/updater.pub');
  if (!existsSync(p)) return ['release/updater.pub가 없다'];
  const pub = readFileSync(p, 'utf8');
  for (const x of pubkeyProblems(pub)) problems.push(`release/updater.pub: ${x}`);
  const confs = confPubkeys(root);
  const base = confs.find((c) => c.file === 'app/src-tauri/tauri.conf.json');
  if (!base || base.pubkey === undefined) problems.push('tauri.conf.json에 plugins.updater.pubkey가 없다');
  for (const c of confs) {
    // 플랫폼별 덮어쓰기 파일은 pubkey를 두지 않거나 같은 값이어야 한다(다른 키로 바뀐 빌드가 나오지 않게)
    if (c.pubkey !== undefined && c.pubkey !== pub) problems.push(`${c.file} plugins.updater.pubkey ≠ release/updater.pub`);
  }
  return problems;
}

function cmdPubkey() {
  const problems = checkPubkey();
  for (const p of problems) err(`pubkey: ${p}`);
  if (problems.length) return 1;
  log(`pubkey: release/updater.pub = tauri.conf.json plugins.updater.pubkey, ${RELEASE_CONF}는 허용 목록 안`);
  return 0;
}

// ---- gate ----

const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '').trim() };
};

// 태그 이름과 저장소의 다른 v* 태그 → 문제 목록(단조 증가)
export function tagProblems(tag, others) {
  const v = tag.replace(/^v/, '');
  if (!/^v/.test(tag) || !parseSemver(v)) return [`태그 ${tag}는 v<semver>여야 한다`];
  const out = [];
  for (const o of others) {
    const ov = o.replace(/^v/, '');
    if (!parseSemver(ov)) continue; // semver가 아닌 v* 태그는 비교하지 않는다
    if (cmpSemver(v, ov) <= 0) out.push(`${tag}가 기존 태그 ${o}보다 크지 않다`);
  }
  return out;
}

// master에서 그 커밋을 빌드한 ci.yml push 실행들([{id, status, jobs:[{name, conclusion, status}]}]) → 'success'|'failure'|'pending'
// 성공: 어느 실행이든 작업 ci-ok가 success. 실패: 모든 실행이 끝났고 ci-ok success가 없다(재실행으로 녹색이 되면 그때 다시 태그).
export function ciOkDecision(runs) {
  if (runs.some((r) => r.jobs.some((j) => j.name === 'ci-ok' && j.conclusion === 'success'))) return 'success';
  if (runs.length && runs.every((r) => r.status === 'completed')) return 'failure';
  return 'pending';
}

function ghJson(args, env) {
  const r = spawnSync('gh', args, { encoding: 'utf8', env, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')}: exit ${r.status} ${(r.stderr ?? '').trim().slice(0, 300)}`);
  return JSON.parse(r.stdout || 'null');
}

function masterRuns(env, sha) {
  const repo = env.GITHUB_REPOSITORY;
  const runs = ghJson(['api', `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=master&per_page=20`, '--jq', '[.workflow_runs[] | {id, status, repo: .head_repository.full_name}]'], env);
  return runs
    .filter((r) => r.repo === repo)
    .map((r) => ({ ...r, jobs: ghJson(['api', `repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`, '--jq', '[.jobs[] | {name, status, conclusion}]'], env) }));
}

async function cmdGate(env) {
  const mode = env.RELEASE_MODE;
  const sha = env.GITHUB_SHA;
  if (!['tag', 'rehearsal'].includes(mode) || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
    err('gate: RELEASE_MODE(tag|rehearsal)·GITHUB_SHA가 필요하다');
    return 2;
  }
  const version = workspaceVersion();
  const tag = env.RELEASE_TAG ?? '';
  let bad = 0;
  // 1. 버전 파일 = 태그(리허설은 tag 입력이 있을 때만 비교: 버전 불일치 입력으로 gate가 빨개지는지 확인하는 용도)
  if (mode === 'tag' || tag) {
    if (versionCheck(['--tag', tag]) !== 0) {
      err(`gate: 버전 파일 ≠ 태그 ${tag}`);
      bad++;
    }
  } else if (versionCheck([]) !== 0) bad++;
  if (mode === 'tag') {
    // 2. 단조 증가: 저장소의 다른 v* 태그보다 커야 한다
    const others = git(['tag', '-l', 'v*']).out.split('\n').filter((t) => t && t !== tag);
    for (const p of tagProblems(tag, others)) {
      err(`gate: ${p}`);
      bad++;
    }
    // 3. 태그 커밋이 master의 조상(master 밖 커밋은 배포하지 않는다)
    if (git(['merge-base', '--is-ancestor', sha, 'origin/master']).code !== 0) {
      err(`gate: ${sha}가 origin/master의 조상이 아니다`);
      bad++;
    }
    // 4. 그 커밋의 master ci-ok가 녹색. 태그가 master CI보다 먼저 올 수 있어 기다린다
    if (!bad) {
      const timeout = Number(env.CI_WAIT_TIMEOUT ?? 1800) * 1000;
      const start = Date.now();
      let d = 'pending';
      for (;;) {
        try {
          d = ciOkDecision(masterRuns(env, sha));
        } catch (e) {
          err(`gate: ${e.message}`);
          d = 'pending';
        }
        if (d !== 'pending' || Date.now() - start >= timeout) break;
        log(`gate: master ci-ok를 기다린다(${Math.round((Date.now() - start) / 1000)}초)`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
      if (d !== 'success') {
        err(`gate: ${sha}의 master ci-ok가 녹색이 아니다(${d === 'pending' ? '시간 초과' : '실패'})`);
        bad++;
      } else log(`gate: master ci-ok 녹색(${sha})`);
    }
  }
  const pubDate = git(['show', '-s', '--format=%cI', sha]).out;
  ghOutput(env, { version, pub_date: pubDate });
  log(`gate: mode=${mode} version=${version} pub_date=${pubDate}`);
  return bad ? 1 : 0;
}

// ---- xtask 바이너리 ----

const exe = (name) => (IS_WIN ? `${name}.exe` : name);
// 미리 빌드한 xtask를 담는 곳(release.yml xtask 작업이 올리고 시크릿 작업이 받는다. artifact 이름은 release-<v>-*와 겹치지 않는다)
export const XTASK_PACK_DIR = 'target/ci/xtask-bin';
const builtXtask = () => join(targetDir(), 'debug', exe('xtask'));
// 부를 xtask: env XTASK_BIN(미리 빌드해 받은 것) 또는 이 checkout에서 빌드한 것
export const xtaskBin = (env = process.env) => (env.XTASK_BIN ? resolve(ROOT, env.XTASK_BIN) : builtXtask());

function step(what, r) {
  if (r.status !== 0) {
    err(`${what}: exit ${r.status ?? r.error?.message}`);
    return false;
  }
  return true;
}

// xtask를 빌드해 XTASK_PACK_DIR에 담고 sha256을 GITHUB_OUTPUT(sha256)에 쓴다. 시크릿·환경이 없는 작업에서만 부른다:
// 시크릿 작업은 컴파일러를 돌리지 않는다(의존성 build.rs가 GITHUB_ENV·GITHUB_PATH나 target/에 무엇을 남겨도 시크릿 단계에
// 닿지 않게, D10, 리뷰 G6). 시크릿 작업은 받은 바이너리의 sha256을 이 작업의 출력과 맞춘 뒤에만 부른다(prepareXtask).
function cmdXtask(env = process.env) {
  if (!step('xtask 빌드', spawnTool('cargo', ['build', '-p', 'xtask', '--locked'], { cwd: ROOT }))) return 1;
  const dir = join(ROOT, XTASK_PACK_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = join(dir, exe('xtask'));
  cpSync(builtXtask(), out);
  const sha = sha256hex(readFileSync(out));
  ghOutput(env, { sha256: sha });
  log(`xtask: ${XTASK_PACK_DIR}/${exe('xtask')} sha256 ${sha}`);
  return 0;
}

// 미리 빌드한 xtask(XTASK_BIN)를 쓰기 전에: sha256이 XTASK_SHA256(빌드 작업의 출력, artifact 안의 값이 아니다)과 같아야 하고,
// artifact는 실행 비트를 잃으므로 되살린다. tag 모드는 미리 빌드한 xtask만 받는다(시크릿 작업에서 빌드하지 않는다).
// → 문제 문자열 또는 null
export function prepareXtask(env) {
  if (!env.XTASK_BIN) {
    if (env.RELEASE_MODE === 'tag') return 'tag 모드는 미리 빌드한 xtask(XTASK_BIN·XTASK_SHA256)만 부른다';
    return existsSync(builtXtask()) ? null : `${builtXtask()}가 없다(release.mjs xtask 먼저)`;
  }
  if (!/^[0-9a-f]{64}$/.test(env.XTASK_SHA256 ?? '')) return 'XTASK_BIN에는 XTASK_SHA256(xtask 작업의 출력)이 있어야 한다';
  const bin = xtaskBin(env);
  if (!existsSync(bin)) return `${bin}가 없다(xtask artifact를 받지 않았다)`;
  const got = sha256hex(readFileSync(bin));
  if (got !== env.XTASK_SHA256) return `${bin} sha256 ${got} ≠ xtask 작업의 출력 ${env.XTASK_SHA256}`;
  if (!IS_WIN) chmodSync(bin, 0o755);
  return null;
}

// xtask release <args>. XTASK_ROOT: 미리 빌드한 바이너리도 이 checkout의 release/ 표·스키마를 읽게 한다
function xtask(args, env = process.env, opts = {}) {
  const bin = xtaskBin(env);
  if (!existsSync(bin)) return { status: 2, error: new Error(`${bin}가 없다(release.mjs xtask 먼저)`) };
  return spawnSync(bin, ['release', ...args], { stdio: 'inherit', env: { ...env, XTASK_ROOT: ROOT }, cwd: ROOT, ...opts });
}

// ---- build(OS마다) ----

function cmdBuild(env) {
  const os = osKey();
  const spec = JSON.parse(readFileSync(join(ROOT, 'release/expected-artifacts.json'), 'utf8'))[os];
  if (!spec) {
    err(`build: ${os}의 항목이 release/expected-artifacts.json에 없다`);
    return 2;
  }
  const version = workspaceVersion();
  const work = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'chzzk-eph-'));
  const key = join(work, 'eph.key');
  const pw = randomBytes(18).toString('hex');
  try {
    // 1. 임시 키(createUpdaterArtifacts는 키 없이 빌드가 실패한다). 진짜 키는 이 작업에 오지 않는다(D10)
    if (!step('임시 키 만들기', spawnTool('pnpm', ['tauri', 'signer', 'generate', '--ci', '-p', pw, '-w', key, '-f'], { cwd: join(ROOT, 'app') }))) return 1;
    const eph = { ...env, TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: pw };
    if (os === 'linux') eph.APPIMAGE_EXTRACT_AND_RUN = '1';
    // 2. 릴리스 번들 + updater 산출물
    const conf = resolve(ROOT, 'release/tauri.release.json');
    if (!step('tauri build', spawnTool('pnpm', ['tauri', 'build', '--ci', '--config', conf, '--bundles', spec.bundles.join(',')], { cwd: join(ROOT, 'app'), env: eph }))) return 1;
    // 3. 모으기(표와 정확히 같은 집합, Tauri가 만든 임시 .sig는 따로)
    const sigDir = join(work, 'tauri-sig');
    if (!step('collect --release', spawnSync(process.execPath, [join(ROOT, 'scripts/ci/bundle.mjs'), 'collect', '--release'], { stdio: 'inherit', env: { ...env, RELEASE_TAURI_SIG_DIR: sigDir } }))) return 1;
    // 4. 서명 형식 자체 확인: Tauri CLI의 서명을 xtask(updater와 같은 검증)가 받고, xtask가 같은 키로 한 서명도 받는다
    if (cmdXtask({ ...env, GITHUB_OUTPUT: '' }) !== 0) return 1;
    const check = join(work, 'check');
    const bundle = join(ROOT, 'target/ci/bundle');
    const ok =
      step('xtask collect --os', xtask(['collect', '--from', bundle, '--out', check, '--version', version, '--os', os])) &&
      step('Tauri CLI 서명 검증', xtask(['verify-sig', '--dir', check, '--sig-dir', sigDir, '--pubkey', `${key}.pub`])) &&
      step('xtask 서명', xtask(['sign', '--dir', check], { ...env, TAURI_SIGNING_PRIVATE_KEY: eph.TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: pw })) &&
      step('xtask 서명 검증', xtask(['verify-sig', '--dir', check, '--pubkey', `${key}.pub`]));
    if (!ok) return 1;
    log(`build: ${os} 번들·updater 산출물 모음, 임시 서명 형식 확인(임시 키·서명은 버린다)`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- 모드·경계 ----

// publish·verify·rollback의 RELEASE_MODE:
//   tag: 진짜 릴리스(R2, 시크릿, 환경 release). R2_ENDPOINT·RELEASE_PUBKEY·RELEASE_VERSION·RELEASE_STAGE_DIR 덮어쓰기를 받지 않고
//        미리 빌드한 xtask(XTASK_BIN + XTASK_SHA256)만 부른다.
//   dry: 가짜 S3(release.yml stage 작업과 selftest). R2_ENDPOINT가 루프백이어야 하고 위 덮어쓰기를 받는다.
// 같은 publish·verify 코드가 두 모드에서 돈다(selftest·stage가 배포하는 코드를 그대로 부른다, 리뷰 G6).
export const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;
export const DRY_OVERRIDES = ['R2_ENDPOINT', 'RELEASE_PUBKEY', 'RELEASE_VERSION', 'RELEASE_STAGE_DIR'];
export function boundaryProblems(env) {
  const mode = env.RELEASE_MODE;
  if (mode === 'tag') return DRY_OVERRIDES.filter((n) => env[n]).map((n) => `tag 모드는 ${n}를 받지 않는다(진짜 릴리스를 다른 곳·키·버전으로 돌리지 못하게)`);
  if (mode === 'dry') return LOOPBACK.test(env.R2_ENDPOINT ?? '') ? [] : [`dry 모드의 R2_ENDPOINT는 루프백(가짜 S3)이어야 한다: ${JSON.stringify(env.R2_ENDPOINT ?? '')}`];
  return [`RELEASE_MODE는 tag|dry여야 한다: ${JSON.stringify(mode ?? '')}`];
}
const dry = (env) => env.RELEASE_MODE === 'dry';
const pubkeyPath = (env) => (dry(env) && env.RELEASE_PUBKEY ? resolve(env.RELEASE_PUBKEY) : join(ROOT, 'release/updater.pub'));
const releaseVersion = (env) => (dry(env) && env.RELEASE_VERSION ? env.RELEASE_VERSION : workspaceVersion());
const stageDir = (env) => (dry(env) && env.RELEASE_STAGE_DIR ? resolve(env.RELEASE_STAGE_DIR) : join(ROOT, 'target/ci/release-stage'));

// publish·verify·rollback의 공통 시작(경계 → xtask). 문제가 있으면 2
function begin(what, env) {
  const problems = boundaryProblems(env);
  if (!problems.length) {
    const x = prepareXtask(env);
    if (x) problems.push(x);
  }
  for (const p of problems) err(`${what}: ${p}`);
  return problems.length ? 2 : 0;
}

// ---- preflight / publish / verify / rollback ----

export function preflight(env) {
  const missing = RELEASE_SECRETS.filter((n) => !env[n]);
  if (missing.length) return { code: 1, message: preflightMessage(missing), missing };
  if (env.RELEASE_MODE !== 'tag' && env.RELEASE_MODE !== 'dry') return { code: 1, message: REHEARSAL_MESSAGE, missing };
  return { code: 0, message: null, missing };
}

function cmdPreflight(env) {
  const r = preflight(env);
  ghOutput(env, { missing: r.missing.join(',') });
  if (r.code) console.error(`::error::${r.message}`);
  else log('preflight: 시크릿·변수 모두 있음');
  return r.code;
}

// 업로드 순서(이 목록 하나뿐이다: release.yml sign-publish, stage, selftest가 모두 이 함수를 지난다)
export const PUBLISH_STEPS = ['collect', 'sign', 'verify-sig', 'sums', 'manifest', 'put', 'promote'];

function cmdPublish(env) {
  const p = preflight(env);
  if (p.code) {
    console.error(`::error::${p.message}`);
    return 1;
  }
  if (begin('publish', env)) return 2;
  const version = releaseVersion(env);
  const stage = stageDir(env);
  rmSync(stage, { recursive: true, force: true });
  const from = resolve(env.RELEASE_IN || join(ROOT, 'target/ci/release-in'));
  const pub = pubkeyPath(env);
  const args = {
    collect: ['collect', '--from', from, '--out', stage, '--version', version],
    sign: ['sign', '--dir', stage],
    // 시크릿의 개인 키가 커밋된 공개 키와 짝인지(아니면 아무것도 올리지 않는다)
    'verify-sig': ['verify-sig', '--dir', stage, '--pubkey', pub],
    sums: ['sums', '--dir', stage],
    manifest: ['manifest', '--dir', stage, '--version', version, '--pub-date', env.RELEASE_PUB_DATE ?? '', '--base-url', env.DIST_BASE_URL],
    put: ['put', '--dir', stage, '--version', version],
    // 마지막: releases/latest.json(CAS)
    promote: ['promote', '--dir', stage, '--version', version],
  };
  for (const name of PUBLISH_STEPS) if (!step(`publish ${name}`, xtask(args[name], env))) return 1;
  log(`publish: ${version} 올림, latest.json 승격(${env.RELEASE_MODE})`);
  return 0;
}

export const LATEST_KEY = 'releases/latest.json';

// 객체 하나 → { code: 0 있음 | 1 없음 | 2 기반 시설 오류, data }
function getObject(env, key) {
  const dir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'release-get-'));
  try {
    const out = join(dir, 'obj');
    const r = xtask(['get', '--key', key, '--out', out], env, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    if (r.status === 0) return { code: 0, data: readFileSync(out) };
    if (r.status === 1) return { code: 1, data: null };
    process.stderr.write(r.stderr ?? '');
    return { code: 2, data: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const versionOf = (bytes) => {
  try {
    const v = JSON.parse(bytes.toString('utf8'))?.version;
    return typeof v === 'string' ? v : '?';
  } catch {
    return '?';
  }
};

// 지금 latest.json의 버전(없으면 null, 읽을 수 없으면 '?')과 이번 버전 → 할 일(verify 결정표, release.test.mjs가 표로 본다)
//   full:         latest = 이번 버전. 전부 확인하고 판정 실패(1)면 prev로 되돌린다. 기반 시설 오류(2)는 되돌리지 않는다.
//   superseded:   latest가 더 높은 버전(다른 태그 실행이 뒤에 승격했다). 이번 버전의 객체만 확인하고 되돌리지 않는다.
//   not-promoted: latest가 없거나 낮거나 읽을 수 없다(승격 전에 실패). 바뀐 것이 없어 되돌리지 않고 실패한다.
export function verifyPlan(latest, version) {
  if (latest === version) return 'full';
  if (latest && parseSemver(latest) && cmpSemver(latest, version) > 0) return 'superseded';
  return 'not-promoted';
}

const validPrev = (v) => v === 'none' || !!parseSemver(v);

// release.yml verify 작업(sign-publish가 어떻게 끝났든 돈다: 승격 뒤에 실패하거나 취소돼도 latest.json을 확인한다)
function cmdVerify(env) {
  // 시크릿이 없으면(sign-publish가 preflight에서 멈춘 태그 실행) 같은 메시지로 멈춘다(기반 시설 오류로 보이지 않게)
  const missing = RELEASE_SECRETS.filter((n) => !n.startsWith('TAURI_') && !env[n]);
  if (missing.length) {
    console.error(`::error::${preflightMessage(missing)}`);
    return 1;
  }
  if (begin('verify', env)) return 2;
  const version = releaseVersion(env);
  const envPrev = env.RELEASE_PREV ?? '';
  if (envPrev && !validPrev(envPrev)) {
    err(`verify: RELEASE_PREV(sign-publish의 prev 출력) 형식이 아니다: ${JSON.stringify(envPrev)}`);
    return 2;
  }
  const base = ['--pubkey', pubkeyPath(env), '--base-url', env.DIST_BASE_URL ?? ''];
  const cur = getObject(env, LATEST_KEY);
  if (cur.code === 2) {
    err('verify: latest.json을 읽지 못했다(기반 시설 오류) — 판정이 아니므로 되돌리지 않는다. verify 작업을 다시 실행한다');
    return 2;
  }
  const latest = cur.data ? versionOf(cur.data) : null;
  const plan = verifyPlan(latest, version);
  ghOutput(env, { plan });
  if (plan === 'not-promoted') {
    err(`verify: latest.json이 ${latest ?? '없음'}이다 — ${version}은 승격되지 않았다(바뀐 것이 없어 되돌리지 않는다)`);
    return 1;
  }
  if (plan === 'superseded') {
    const c = xtask(['verify', '--version', version, ...base, '--objects-only'], env).status;
    if (c === 0) console.log(`::notice::release verify: latest.json은 더 높은 ${latest}다(나중 태그가 승격). ${version}은 객체만 확인했고 통과`);
    else err(`verify: ${version} 객체 확인 실패(exit ${c}). latest.json은 ${latest}라 되돌리지 않는다`);
    return c === 0 ? 0 : c === 2 ? 2 : 1;
  }
  const c = xtask(['verify', '--version', version, ...base], env).status;
  if (c === 0) {
    log(`verify: ${version} 통과`);
    return 0;
  }
  if (c !== 1) {
    err(`verify: 기반 시설 오류(exit ${c}) — 판정이 아니므로 되돌리지 않는다. verify 작업을 다시 실행한다(docs/design/cicd.md §5.7)`);
    ghOutput(env, { rolled_back: 'no' });
    return 2;
  }
  // 판정 실패 → prev로 되돌린다. prev는 sign-publish의 출력, 없으면(승격 뒤 그 작업이 실패·취소) releases/<v>/previous
  let prev = envPrev;
  if (!prev) {
    const p = getObject(env, `releases/${version}/previous`);
    const t = p.code === 0 ? p.data.toString('utf8') : '';
    prev = validPrev(t) ? t : '';
  }
  if (!prev) {
    err(`verify: ${version} 확인 실패인데 되돌릴 버전을 모른다(releases/${version}/previous 없음) — 사람이 rollback.yml로 되돌린다`);
    ghOutput(env, { rolled_back: 'failed' });
    return 1;
  }
  err(`verify: ${version} 확인 실패 → ${prev}로 되돌린다`);
  const r = xtask(['rollback', '--to', prev, '--from', version, ...base], env);
  if (r.status === 0) err(`verify: latest.json을 ${prev}로 되돌렸다(실패한 버전의 객체는 진단용으로 남긴다)`);
  else err('verify: 되돌리기도 실패했다 — 사람이 rollback.yml로 되돌린다');
  ghOutput(env, { rolled_back: r.status === 0 ? prev : 'failed' });
  return 1;
}

// rollback.yml: latest.json을 ROLLBACK_VERSION으로(낮은 버전으로 되돌리기, 잘못 되돌린 뒤 다시 올리기 모두. none이면 지운다)
function cmdRollback(env) {
  const v = env.ROLLBACK_VERSION ?? '';
  if (!validPrev(v)) {
    err(`rollback: ROLLBACK_VERSION은 semver 또는 none: ${JSON.stringify(v)}`);
    return 2;
  }
  const missing = RELEASE_SECRETS.filter((n) => !n.startsWith('TAURI_') && !env[n]);
  if (missing.length) {
    console.error(`::error::${preflightMessage(missing)}`);
    return 1;
  }
  if (begin('rollback', env)) return 2;
  const r = xtask(['rollback', '--to', v, '--pubkey', pubkeyPath(env), '--base-url', env.DIST_BASE_URL], env);
  return r.status === 0 ? 0 : r.status === 2 ? 2 : 1;
}

// ---- 가짜 S3 실행(stage·selftest) ----

export const FAKE_BASE = 'https://dist.example.invalid';

function startFake(creds) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [join(ROOT, 'scripts/ci/s3-fake.mjs'), '--bucket', creds.R2_BUCKET, '--access', creds.R2_ACCESS_KEY_ID, '--secret', creds.R2_SECRET_ACCESS_KEY], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c;
      const m = /listening (\d+)/.exec(buf);
      if (m) {
        const port = Number(m[1]);
        const fault = (f) => fetch(`http://127.0.0.1:${port}/__fault`, { method: 'POST', body: JSON.stringify(f) }).then((r) => r.status);
        res({ port, fault, stop: () => p.kill() });
      }
    });
    p.on('exit', (c) => rej(new Error(`s3-fake가 끝났다(${c})`)));
  });
}

const fakeCreds = () => ({ R2_ACCESS_KEY_ID: 'dry-access', R2_SECRET_ACCESS_KEY: randomBytes(16).toString('hex'), R2_BUCKET: 'dry-bucket', R2_ACCOUNT_ID: 'dry-run', R2_REGION: 'auto' });

// dry 모드 env: 가짜 S3 자격 증명·루프백 엔드포인트·시험 키. 시크릿 이름은 모두 채운다(preflight가 진짜와 같은 길로 지난다)
function dryEnv(env, creds, port, { key, pw, pub }) {
  const D = { ...env, ...creds, RELEASE_MODE: 'dry', R2_ENDPOINT: `http://127.0.0.1:${port}`, DIST_BASE_URL: FAKE_BASE, TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: pw, RELEASE_PUBKEY: pub };
  for (const n of ['VERIFY_VIA', 'CI_VERIFY_TOKEN', 'RELEASE_PREV', 'GITHUB_OUTPUT']) delete D[n];
  return D;
}

// release.mjs <cmd>를 하위 프로세스로(배포하는 진입점 그대로)
function runRelease(cmd, env, capture = false) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/release.mjs'), cmd], { env, cwd: ROOT, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 1 << 26 });
  return { status: r.status, out: capture ? `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() : '' };
}

const readOutput = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.includes('='))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
    : {};

// release.yml stage 작업(시크릿·환경 없음, 리허설과 태그 모두): 진짜로 받은 3 OS artifact로 publish → verify를 가짜 S3에 그대로
// 돌린다(collect의 OS 집합·bundles.json 하나씩·download-artifact 폴더 모양, 진짜 크기 파일의 서명·SHA256SUMS·매니페스트·put·
// promote·다시 받아 확인). 키는 xtask keygen 임시 키다. 리허설은 여기서 끝난다(업로드 경계). 태그는 sign-publish가 진짜로 돈다.
async function cmdStage(env) {
  const mode = env.RELEASE_MODE;
  if (mode !== 'tag' && mode !== 'rehearsal') {
    err(`stage: RELEASE_MODE는 tag|rehearsal: ${JSON.stringify(mode ?? '')}`);
    return 2;
  }
  const pre = prepareXtask({ ...env, RELEASE_MODE: 'dry' });
  if (pre) {
    err(`stage: ${pre}`);
    return 2;
  }
  const work = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'release-stage-'));
  const creds = fakeCreds();
  let fake;
  try {
    const key = join(work, 'eph.key');
    const pw = randomBytes(18).toString('hex');
    if (!step('임시 키', xtask(['keygen', '--out', key], { ...env, XTASK_KEY_PASSWORD: pw }))) return 1;
    fake = await startFake(creds);
    const out = join(work, 'publish.out');
    const D = { ...dryEnv(env, creds, fake.port, { key, pw, pub: `${key}.pub` }), RELEASE_IN: env.RELEASE_IN || join(ROOT, 'target/ci/release-in'), RELEASE_STAGE_DIR: join(work, 'stage') };
    if (runRelease('publish', { ...D, GITHUB_OUTPUT: out }).status !== 0) {
      err('stage: publish(가짜 S3)가 실패했다');
      return 1;
    }
    const prev = readOutput(out).prev;
    if (prev !== 'none') {
      err(`stage: 빈 가짜 버킷인데 prev가 ${JSON.stringify(prev)}다`);
      return 1;
    }
    if (runRelease('verify', { ...D, RELEASE_PREV: prev, GITHUB_OUTPUT: join(work, 'verify.out') }).status !== 0) {
      err('stage: verify(가짜 S3)가 실패했다');
      return 1;
    }
    const next = mode === 'tag' ? 'sign-publish가 진짜 키·R2로 같은 단계를 돈다' : '리허설은 여기서 끝난다(업로드 경계, 진짜 키·R2에는 닿지 않는다)';
    console.log(`::notice::release stage: 받은 3 OS 산출물로 collect·서명·서명 검증·SHA256SUMS·매니페스트·put·promote·verify를 가짜 S3에서 통과. ${next}`);
    return 0;
  } catch (e) {
    err(`stage: ${e.message}`);
    return 1;
  } finally {
    fake?.stop();
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- selftest(가짜 S3) ----

// 표의 산출물마다 합성 파일(버전마다 다른 내용)을 download-artifact가 만드는 모양(<dir>/release-<v>-<os>/)으로 만들고
// bundles.json(collect --release 형식)을 쓴다
export function synthBundles(dir, version, spec = JSON.parse(readFileSync(join(ROOT, 'release/expected-artifacts.json'), 'utf8'))) {
  for (const os of ['linux', 'darwin', 'windows']) {
    const d = join(dir, `release-${version}-${os}`);
    mkdirSync(d, { recursive: true });
    const artifacts = spec[os].artifacts.map((a) => {
      const file = `chzzk-downloader_${version}_${a.name}`;
      const data = Buffer.from(`synthetic ${os} ${a.kind} ${version}\n`.repeat(64));
      writeFileSync(join(d, file), data);
      return { kind: a.kind, file, bytes: data.length, sha256: sha256hex(data), size: a.size ?? null, updater: a.updater ?? [] };
    });
    writeFileSync(join(d, 'bundles.json'), JSON.stringify({ os, version, release: true, artifacts }, null, 2) + '\n');
  }
}

// publish·verify·rollback은 배포하는 진입점(release.mjs <cmd>)을 하위 프로세스로 부른다(RELEASE_MODE=dry). xtask를 직접 부르는
// 것은 변조·진단(get, put-raw)과 낮은 수준의 거부(CAS, 덮어쓰기)를 보는 곳뿐이다.
async function cmdSelftest(env) {
  if (cmdXtask({ ...env, GITHUB_OUTPUT: '' }) !== 0) return 1;
  const work = mkdtempSync(join(tmpdir(), 'release-selftest-'));
  const creds = fakeCreds();
  const fake = await startFake(creds);
  const results = [];
  const key = join(work, 'test.key');
  let last = '';
  // 다시 시도 대기를 짧게(가짜 서버의 일시 오류 시나리오)
  const base0 = { ...env, ...creds, R2_ENDPOINT: `http://127.0.0.1:${fake.port}`, XTASK_RETRY_ATTEMPTS: '3', XTASK_RETRY_BASE_MS: '20', XTASK_ROOT: ROOT };
  for (const n of ['VERIFY_VIA', 'CI_VERIFY_TOKEN', 'RELEASE_PREV', 'GITHUB_OUTPUT', 'XTASK_BIN', 'XTASK_SHA256']) delete base0[n];
  const x = (args, extra = {}) => {
    const r = spawnSync(xtaskBin(base0), ['release', ...args], { env: { ...base0, ...extra }, cwd: ROOT, encoding: 'utf8' });
    last = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    return r.status;
  };
  const expect = (name, want, got) => {
    const ok = want === 'nonzero' ? got !== 0 && got !== null : got === want;
    results.push({ name, want, got, ok, out: ok ? '' : last });
  };
  const get = (k) => {
    const out = join(work, 'get.bin');
    rmSync(out, { force: true });
    return x(['get', '--key', k, '--out', out]) === 0 ? readFileSync(out) : null;
  };
  const same = (a, b) => (a && b && Buffer.compare(a, b) === 0 ? 0 : 1);
  try {
    if (x(['keygen', '--out', key], { XTASK_KEY_PASSWORD: 'selftest-pw' }) !== 0) throw new Error('keygen 실패');
    const pub = `${key}.pub`;
    const S = dryEnv(base0, creds, fake.port, { key, pw: 'selftest-pw', pub });
    let n = 0;
    const publish = (v, pubDate, extra = {}) => {
      const inDir = join(work, `in-${v}`);
      const st = join(work, `stage-${v}`);
      const out = join(work, `out-${++n}`);
      if (!existsSync(inDir)) synthBundles(inDir, v);
      const r = runRelease('publish', { ...S, RELEASE_VERSION: v, RELEASE_IN: inDir, RELEASE_STAGE_DIR: st, RELEASE_PUB_DATE: pubDate, GITHUB_OUTPUT: out, ...extra }, true);
      last = r.out;
      return { code: r.status, prev: readOutput(out).prev, st };
    };
    const verify = (v, prev = '', extra = {}) => {
      const out = join(work, `out-${++n}`);
      const r = runRelease('verify', { ...S, RELEASE_VERSION: v, RELEASE_PREV: prev, GITHUB_OUTPUT: out, ...extra }, true);
      last = r.out;
      return { code: r.status, ...readOutput(out) };
    };
    const rollback = (v) => {
      const r = runRelease('rollback', { ...S, ROLLBACK_VERSION: v }, true);
      last = r.out;
      return r.status;
    };
    const vx = (v, k = pub, objectsOnly = false) => x(['verify', '--version', v, '--pubkey', k, '--base-url', FAKE_BASE, ...(objectsOnly ? ['--objects-only'] : [])]);

    // (a) 빈 버킷 happy path: publish(preflight → 경계 → PUBLISH_STEPS) → verify
    const p1 = publish('1.0.0', '2026-10-06T00:00:00Z');
    expect('(a) publish 1.0.0', 0, p1.code);
    expect('(a) prev 출력 = none', 0, p1.prev === 'none' ? 0 : 1);
    expect('(a) verify 1.0.0(full)', 0, verify('1.0.0', 'none').code);
    expect('(a) latest.json = 1.0.0 manifest.json(바이트)', 0, same(get(LATEST_KEY), readFileSync(join(p1.st, 'manifest.json'))));
    expect('(a) 커밋된 공개 키로 verify(시험 키 ≠ release/updater.pub)', 'nonzero', vx('1.0.0', join(ROOT, 'release/updater.pub')));
    expect('(a) 커밋된 공개 키로 verify-sig', 'nonzero', x(['verify-sig', '--dir', p1.st, '--pubkey', join(ROOT, 'release/updater.pub')]));
    // (b) 두 번째 버전과 CAS·단조 증가
    const before = get(LATEST_KEY);
    const p2 = publish('1.1.0', '2026-10-07T00:00:00+09:00');
    expect('(b) publish 1.1.0', 0, p2.code);
    expect('(b) prev 출력 = 1.0.0', 0, p2.prev === '1.0.0' ? 0 : 1);
    expect('(b) verify 1.1.0', 0, verify('1.1.0', '1.0.0').code);
    expect('(b) previous = 1.0.0', 0, (get('releases/1.1.0/previous') ?? '').toString() === '1.0.0' ? 0 : 1);
    expect('(b) 낮은 버전 승격 거부(1.0.0)', 'nonzero', x(['promote', '--dir', p1.st, '--version', '1.0.0']));
    expect('(b) 1.0.0 objects-only는 그대로 통과', 0, vx('1.0.0', pub, true));
    // (c) 객체 하나 변조 → release.mjs verify가 실패하고 되돌린다. prev 출력이 없어도(승격 뒤 sign-publish 실패) 버킷의 previous로
    const victim = 'releases/1.1.0/chzzk-downloader_1.1.0_windows-x86_64.msi';
    const bad = Buffer.from(get(victim));
    bad[Math.floor(bad.length / 2)] ^= 1;
    writeFileSync(join(work, 'bad.bin'), bad);
    expect('(c) 변조(put-raw)', 0, x(['put-raw', '--key', victim, '--file', join(work, 'bad.bin')], { XTASK_ALLOW_RAW: '1' }));
    expect('(c) put-raw는 XTASK_ALLOW_RAW 없이 거부', 'nonzero', x(['put-raw', '--key', victim, '--file', join(work, 'bad.bin')]));
    const vc = verify('1.1.0', '');
    expect('(c) verify 1.1.0 실패(prev 출력 없음)', 1, vc.code);
    expect('(c) previous를 읽어 1.0.0으로 되돌림', 0, vc.rolled_back === '1.0.0' ? 0 : 1);
    expect('(c) latest.json = 승격 전(바이트 동일)', 0, same(get(LATEST_KEY), before));
    expect('(c) 되돌린 뒤 verify 1.0.0', 0, verify('1.0.0').code);
    expect('(c) 망가진 1.1.0으로는 rollback.yml도 거부', 'nonzero', rollback('1.1.0'));
    expect('(c) 거부 뒤에도 latest.json = 1.0.0', 0, same(get(LATEST_KEY), before));
    // (d) 재실행 멱등: 같은 내용은 성공, 다른 내용은 덮어쓰지 않는다
    expect('(d) put 1.0.0 재실행', 0, x(['put', '--dir', p1.st, '--version', '1.0.0']));
    expect('(d) promote 1.0.0 재실행(이미 승격)', 0, x(['promote', '--dir', p1.st, '--version', '1.0.0']));
    const st2b = join(work, 'stage-1.1.0-b');
    cpSync(p2.st, st2b, { recursive: true });
    writeFileSync(join(st2b, 'chzzk-downloader_1.1.0_linux-x86_64.deb'), 'different\n');
    expect('(d) 다른 내용 put 거부', 'nonzero', x(['put', '--dir', st2b, '--version', '1.1.0']));
    const st1c = join(work, 'stage-1.0.0-c');
    cpSync(p1.st, st1c, { recursive: true });
    writeFileSync(join(st1c, 'SHA256SUMS'), readFileSync(join(st1c, 'SHA256SUMS'), 'utf8').split('\n').filter((l) => !l.endsWith('.AppImage.sig')).join('\n'));
    expect('(d) 서명 없는 sums 목록(.sig 지움) put 거부', 'nonzero', x(['put', '--dir', st1c, '--version', '1.0.0']));
    // (e) preflight·경계: 시크릿 없음 → 정확한 메시지, 리허설은 멈춤, tag는 엔드포인트·키 덮어쓰기와 빌드한 xtask를 거부
    const pf = preflight({ RELEASE_MODE: 'tag' });
    expect('(e) preflight 메시지(시크릿 없음)', 0, pf.code === 1 && pf.message === preflightMessage(RELEASE_SECRETS) ? 0 : 1);
    const pf2 = preflight({ RELEASE_MODE: 'rehearsal', ...Object.fromEntries(RELEASE_SECRETS.map((s) => [s, 'x'])) });
    expect('(e) 리허설은 시크릿이 있어도 멈춤', 0, pf2.code === 1 && pf2.message === REHEARSAL_MESSAGE ? 0 : 1);
    const bare = { PATH: env.PATH, SystemRoot: env.SystemRoot, RELEASE_MODE: 'tag' };
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/release.mjs'), 'preflight'], { env: bare, encoding: 'utf8' });
    expect('(e) preflight 프로세스: exit 1 + 정확한 줄', 0, r.status === 1 && r.stderr.split('\n').includes(`::error::${preflightMessage(RELEASE_SECRETS)}`) ? 0 : 1);
    const latestE = get(LATEST_KEY);
    const pe = publish('1.5.0', '2026-10-08T00:00:00Z', { RELEASE_MODE: 'tag', RELEASE_VERSION: '', RELEASE_STAGE_DIR: '', RELEASE_PUBKEY: '' });
    expect('(e) tag 모드 publish는 R2_ENDPOINT 덮어쓰기 거부(exit 2)', 2, pe.code);
    const pe2 = publish('1.5.0', '2026-10-08T00:00:00Z', { R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com' });
    expect('(e) dry 모드 publish는 루프백이 아닌 엔드포인트 거부(exit 2)', 2, pe2.code);
    expect('(e) tag 모드 verify는 빌드한 xtask 거부(XTASK_BIN 없음, exit 2)', 2, runRelease('verify', { ...bare, ...Object.fromEntries(RELEASE_SECRETS.map((s) => [s, 'x'])) }, true).status);
    expect('(e) 시크릿 없는 verify는 preflight 메시지로 1', 1, runRelease('verify', bare, true).status);
    expect('(e) XTASK_SHA256이 다르면 거부(exit 2)', 2, verify('1.0.0', '', { XTASK_BIN: xtaskBin(base0), XTASK_SHA256: '0'.repeat(64) }).code);
    expect('(e) 거부들 뒤 latest.json 그대로', 0, same(get(LATEST_KEY), latestE));
    // (h) 기반 시설 오류와 판정을 가른다(리뷰 G6): 일시 5xx는 다시 시도해 통과, 계속되면 exit 2로 되돌리지 않음,
    //     CAS가 적용된 뒤 응답을 잃으면(500) 다시 읽어 성공
    expect('(h) 장애 주입 GET SHA256SUMS 503×2', 204, await fake.fault({ method: 'GET', key: 'releases/1.0.0/SHA256SUMS', mode: 'before', status: 503, times: 2 }));
    expect('(h) 일시 503 뒤 verify 1.0.0 통과', 0, verify('1.0.0').code);
    expect('(h) 장애 주입 GET SHA256SUMS 503×3(시도 횟수만큼)', 204, await fake.fault({ method: 'GET', key: 'releases/1.0.0/SHA256SUMS', mode: 'before', status: 503, times: 3 }));
    const vh = verify('1.0.0', 'none');
    expect('(h) 계속된 503: verify exit 2', 2, vh.code);
    expect('(h) 계속된 503: 되돌리지 않음', 0, vh.rolled_back === 'no' ? 0 : 1);
    expect('(h) 계속된 503 뒤 latest.json 그대로(1.0.0)', 0, same(get(LATEST_KEY), before));
    expect('(h) 장애 주입 PUT latest.json 적용 뒤 500×1', 204, await fake.fault({ method: 'PUT', key: LATEST_KEY, mode: 'after', status: 500, times: 1 }));
    const p3 = publish('1.2.0', '2026-10-09T00:00:00Z');
    expect('(h) 응답 잃은 CAS: publish 1.2.0 성공', 0, p3.code);
    expect('(h) latest.json = 1.2.0 manifest.json', 0, same(get(LATEST_KEY), readFileSync(join(p3.st, 'manifest.json'))));
    expect('(h) verify 1.2.0', 0, verify('1.2.0', p3.prev).code);
    // (i) verify 결정표의 나머지: 나중 태그가 승격(superseded), 승격 전에 실패(not-promoted)
    const vs = verify('1.0.0');
    expect('(i) latest가 더 높으면 objects-only로 통과(superseded)', 0, vs.code === 0 && vs.plan === 'superseded' ? 0 : 1);
    const vn = verify('1.3.0', '1.2.0');
    expect('(i) 승격되지 않은 버전: exit 1, 되돌리지 않음(not-promoted)', 0, vn.code === 1 && vn.plan === 'not-promoted' && vn.rolled_back === undefined ? 0 : 1);
    expect('(i) latest.json = 1.2.0 그대로', 0, same(get(LATEST_KEY), readFileSync(join(p3.st, 'manifest.json'))));
    // (f) rollback.yml 경로: 잘못 되돌린 뒤 다시 올리기(낮은 → 높은 버전), 첫 릴리스 전으로 되돌리기(latest.json 지움)
    expect('(f) rollback.yml 1.0.0', 0, rollback('1.0.0'));
    expect('(f) latest.json = 1.0.0', 0, same(get(LATEST_KEY), before));
    expect('(f) rollback.yml 1.2.0(다시 올리기)', 0, rollback('1.2.0'));
    expect('(f) latest.json = 1.2.0', 0, same(get(LATEST_KEY), readFileSync(join(p3.st, 'manifest.json'))));
    expect('(f) rollback --to none --from 9.9.9 거부(지금 latest와 다름)', 'nonzero', x(['rollback', '--to', 'none', '--from', '9.9.9', '--pubkey', pub]));
    expect('(f) rollback.yml none', 0, rollback('none'));
    expect('(f) latest.json 없음', 0, get(LATEST_KEY) === null ? 0 : 1);
    // (g) 서명 검증 서버: 틀린 비밀 키는 403 → 기반 시설 오류(exit 2, 판정이 아니다)
    expect('(g) 틀린 S3 비밀 키는 exit 2', 2, x(['get', '--key', 'releases/1.0.0/SHA256SUMS', '--out', join(work, 'g.bin')], { R2_SECRET_ACCESS_KEY: 'wrong' }));
  } catch (e) {
    results.push({ name: `예외: ${e.message}`, want: 0, got: 'throw', ok: false, out: last });
  } finally {
    fake.stop();
    rmSync(work, { recursive: true, force: true });
  }
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(60)} 기대 ${String(r.want).padEnd(8)} 결과 ${r.got}`);
    if (r.out) console.log(r.out.replace(/^/gm, '     | '));
  }
  const bad = results.filter((r) => !r.ok).length;
  if (bad) err(`selftest: ${bad}개가 기대와 다르다`);
  else log(`selftest: ${results.length}개 모두 기대대로`);
  return bad ? 1 : 0;
}

// Phase 3 seam(docs/design/cicd.md §5.5). worker/가 생기면 여기서 wrangler(고정 버전) 배포 → /health 200 → updater 엔드포인트가
// prev 버전 요청에 200 + 새 버전, 새 버전 요청에 204인지 확인한다. 그 전에는 켜도(vars.WORKER_DEPLOY_ENABLED) 녹색이 되지 않는다.
function cmdWorker() {
  if (!existsSync(join(ROOT, 'worker'))) {
    err('worker: worker/가 없다(Phase 3 seam). vars.WORKER_DEPLOY_ENABLED를 끄거나 Worker를 먼저 더한다');
    return 1;
  }
  err('worker: 배포·확인 단계가 아직 없다(Phase 3에서 이 함수를 채운다)');
  return 1;
}

export function main(argv, env = process.env) {
  const [cmd, ...rest] = argv;
  if (rest.length) {
    console.error('사용법: release.mjs <pubkey|gate|build|xtask|preflight|publish|verify|rollback|stage|selftest|worker>');
    return 2;
  }
  switch (cmd) {
    case 'pubkey':
      return cmdPubkey();
    case 'gate':
      return cmdGate(env);
    case 'build':
      return cmdBuild(env);
    case 'xtask':
      return cmdXtask(env);
    case 'preflight':
      return cmdPreflight(env);
    case 'publish':
      return cmdPublish(env);
    case 'verify':
      return cmdVerify(env);
    case 'rollback':
      return cmdRollback(env);
    case 'stage':
      return cmdStage(env);
    case 'selftest':
      return cmdSelftest(env);
    case 'worker':
      return cmdWorker();
    default:
      console.error('사용법: release.mjs <pubkey|gate|build|xtask|preflight|publish|verify|rollback|stage|selftest|worker>');
      return 2;
  }
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).then((c) => process.exit(c));
}
