#!/usr/bin/env node
// 릴리스 진입점(docs/design/cicd.md §5, 구현 중 변경 G6). release.yml·rollback.yml·훅은 run.mjs gate로 이 파일을 부른다.
// 판정은 모두 결정적이다(종료 코드, 해시, 서명, 스키마, 실제 빌드·실행). 무거운 일은 xtask(Rust)가 하고 여기서는 순서를 정한다.
//
//   node scripts/ci/release.mjs pubkey        # release/updater.pub == tauri.conf.json plugins.updater.pubkey(바이트 동일, 형식)
//   node scripts/ci/release.mjs gate          # 태그 = 버전 파일, 단조 증가, master 조상, 그 커밋의 master ci-ok 녹색(기다림)
//   node scripts/ci/release.mjs build         # 임시 키로 릴리스 번들 + updater 산출물 → collect --release → 서명 형식 자체 확인
//   node scripts/ci/release.mjs xtask         # xtask를 빌드한다(시크릿 없는 단계에서. 시크릿 단계는 빌드하지 않는다)
//   node scripts/ci/release.mjs preflight     # 시크릿·변수가 모두 있는지(없으면 정확한 메시지로 실패, 리허설은 늘 여기서 멈춘다)
//   node scripts/ci/release.mjs publish       # collect → sign → verify-sig → sums → manifest → put → promote(latest.json은 마지막)
//   node scripts/ci/release.mjs verify        # 다시 받아 확인. 실패하면 prev로 rollback하고 1
//   node scripts/ci/release.mjs rollback      # rollback.yml: ROLLBACK_VERSION으로 latest.json을 되돌린다
//   node scripts/ci/release.mjs selftest      # 가짜 S3(s3-fake.mjs)에 합성 산출물로 (a)~(g) 시나리오(release-selftest gate)
//   node scripts/ci/release.mjs worker        # Phase 3 seam: Worker 배포·확인. worker/가 생기기 전에는 늘 실패한다
//
// 종료 코드: 0 통과, 1 검사 실패, 2 사용법·환경 오류.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
export const preflightMessage = (missing) => `릴리스 시크릿 없음: ${missing.join(', ')}. 빌드·수집·설치 스모크까지는 통과, 업로드하지 않음`;
export const REHEARSAL_MESSAGE = '리허설은 업로드하지 않는다(시크릿이 모두 있어도 여기서 멈춘다)';

function ghOutput(env, pairs) {
  if (!env.GITHUB_OUTPUT) return;
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join(''));
}

// ---- semver ----

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export function parseSemver(v) {
  const m = SEMVER.exec(v ?? '');
  return m ? { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] } : null;
}
export function cmpSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`semver가 아니다: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    const [pNum, qNum] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (p === q) continue;
    if (pNum && qNum) return +p < +q ? -1 : 1;
    if (pNum !== qNum) return pNum ? -1 : 1;
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

export function checkPubkey(root = ROOT) {
  const problems = [];
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
  log('pubkey: release/updater.pub = tauri.conf.json plugins.updater.pubkey');
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

// ---- build(OS마다) ----

const exe = (name) => (IS_WIN ? `${name}.exe` : name);
export const xtaskBin = () => join(targetDir(), 'debug', exe('xtask'));

function step(what, r) {
  if (r.status !== 0) {
    err(`${what}: exit ${r.status ?? r.error?.message}`);
    return false;
  }
  return true;
}

function cmdXtask() {
  // 시크릿이 없는 단계에서만 빌드한다(의존성 build.rs가 시크릿 env를 보지 않게, D10). 시크릿 단계는 이 바이너리만 부른다
  return step('xtask 빌드', spawnTool('cargo', ['build', '-p', 'xtask', '--locked'], { cwd: ROOT })) ? 0 : 1;
}

function xtask(args, env = process.env) {
  if (!existsSync(xtaskBin())) return { status: 2, error: new Error(`${xtaskBin()}가 없다(release.mjs xtask 먼저)`) };
  return spawnSync(xtaskBin(), ['release', ...args], { stdio: 'inherit', env, cwd: ROOT });
}

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
    if (cmdXtask() !== 0) return 1;
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

// ---- preflight / publish / verify / rollback ----

export function preflight(env) {
  const missing = RELEASE_SECRETS.filter((n) => !env[n]);
  if (missing.length) return { code: 1, message: preflightMessage(missing), missing };
  if (env.RELEASE_MODE !== 'tag') return { code: 1, message: REHEARSAL_MESSAGE, missing };
  return { code: 0, message: null, missing };
}

function cmdPreflight(env) {
  const r = preflight(env);
  ghOutput(env, { stopped: r.code ? 'preflight' : '', missing: r.missing.join(',') });
  if (r.code) console.error(`::error::${r.message}`);
  else log('preflight: 시크릿·변수 모두 있음');
  return r.code;
}

const STAGE = () => join(ROOT, 'target/ci/release-stage');

function cmdPublish(env) {
  const p = preflight(env);
  if (p.code) {
    console.error(`::error::${p.message}`);
    return 1;
  }
  const version = workspaceVersion();
  const stage = STAGE();
  rmSync(stage, { recursive: true, force: true });
  const from = resolve(env.RELEASE_IN || join(ROOT, 'target/ci/release-in'));
  const pub = join(ROOT, 'release/updater.pub');
  const steps = [
    ['collect', ['collect', '--from', from, '--out', stage, '--version', version]],
    ['sign', ['sign', '--dir', stage]],
    // 시크릿의 개인 키가 커밋된 공개 키와 짝인지(아니면 아무것도 올리지 않는다)
    ['verify-sig', ['verify-sig', '--dir', stage, '--pubkey', pub]],
    ['sums', ['sums', '--dir', stage]],
    ['manifest', ['manifest', '--dir', stage, '--version', version, '--pub-date', env.RELEASE_PUB_DATE ?? '', '--base-url', env.DIST_BASE_URL]],
    ['put', ['put', '--dir', stage, '--version', version]],
    // 마지막: releases/latest.json(CAS)
    ['promote', ['promote', '--dir', stage, '--version', version]],
  ];
  for (const [name, args] of steps) if (!step(`publish ${name}`, xtask(args, env))) return 1;
  return 0;
}

function cmdVerify(env) {
  const version = workspaceVersion();
  const prev = env.RELEASE_PREV;
  if (!prev || !(prev === 'none' || parseSemver(prev))) {
    err(`verify: RELEASE_PREV(sign-publish의 prev 출력)가 없거나 형식이 아니다: ${JSON.stringify(prev)}`);
    return 2;
  }
  const pub = join(ROOT, 'release/updater.pub');
  const base = ['--pubkey', pub, '--base-url', env.DIST_BASE_URL ?? ''];
  if (xtask(['verify', '--version', version, ...base], env).status === 0) {
    log(`verify: ${version} 통과`);
    return 0;
  }
  err(`verify: ${version} 확인 실패 → ${prev}로 되돌린다`);
  const r = xtask(['rollback', '--to', prev, '--from', version, ...base], env);
  if (r.status === 0) err(`verify: latest.json을 ${prev}로 되돌렸다(실패한 버전의 객체는 진단용으로 남긴다)`);
  else err('verify: 되돌리기도 실패했다 — 사람이 rollback.yml로 되돌린다');
  ghOutput(env, { rolled_back: r.status === 0 ? prev : 'failed' });
  return 1;
}

function cmdRollback(env) {
  const v = env.ROLLBACK_VERSION ?? '';
  if (!(v === 'none' || parseSemver(v))) {
    err(`rollback: ROLLBACK_VERSION은 semver 또는 none: ${JSON.stringify(v)}`);
    return 2;
  }
  const missing = RELEASE_SECRETS.filter((n) => !n.startsWith('TAURI_') && !env[n]);
  if (missing.length) {
    console.error(`::error::${preflightMessage(missing)}`);
    return 1;
  }
  const r = xtask(['rollback', '--to', v, '--pubkey', join(ROOT, 'release/updater.pub'), '--base-url', env.DIST_BASE_URL], env);
  return r.status === 0 ? 0 : 1;
}

// ---- selftest(가짜 S3) ----

// 표의 산출물마다 합성 파일(버전마다 다른 내용)을 OS 폴더에 만들고 bundles.json(collect --release 형식)을 쓴다
export function synthBundles(dir, version, spec = JSON.parse(readFileSync(join(ROOT, 'release/expected-artifacts.json'), 'utf8'))) {
  for (const os of ['linux', 'darwin', 'windows']) {
    const d = join(dir, os);
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

const sha256hex = (b) => createHash('sha256').update(b).digest('hex');

function startFake(env) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [join(ROOT, 'scripts/ci/s3-fake.mjs'), '--bucket', env.R2_BUCKET, '--access', env.R2_ACCESS_KEY_ID, '--secret', env.R2_SECRET_ACCESS_KEY], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c;
      const m = /listening (\d+)/.exec(buf);
      if (m) res({ port: Number(m[1]), stop: () => p.kill() });
    });
    p.on('exit', (c) => rej(new Error(`s3-fake가 끝났다(${c})`)));
  });
}

async function cmdSelftest(env) {
  if (cmdXtask() !== 0) return 1;
  const work = mkdtempSync(join(tmpdir(), 'release-selftest-'));
  const creds = { R2_ACCESS_KEY_ID: 'selftest-access', R2_SECRET_ACCESS_KEY: randomBytes(16).toString('hex'), R2_BUCKET: 'selftest-bucket', R2_REGION: 'auto' };
  const fake = await startFake(creds);
  const results = [];
  const base = 'https://dist.example.invalid';
  const S = { ...env, ...creds, R2_ENDPOINT: `http://127.0.0.1:${fake.port}`, DIST_BASE_URL: base, GITHUB_OUTPUT: '' };
  delete S.VERIFY_VIA;
  let last = '';
  const x = (args, extra = {}) => {
    const r = spawnSync(xtaskBin(), ['release', ...args], { env: { ...S, ...extra }, cwd: ROOT, encoding: 'utf8' });
    last = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    return r.status;
  };
  const expect = (name, want, got) => {
    const ok = want === 0 ? got === 0 : got !== 0 && got !== null;
    results.push({ name, want, got, ok, out: ok ? '' : last });
  };
  const get = (key) => {
    const out = join(work, 'get.bin');
    rmSync(out, { force: true });
    return x(['get', '--key', key, '--out', out]) === 0 ? readFileSync(out) : null;
  };
  try {
    // 키: 시험용 키 쌍(xtask keygen = Tauri 형식). 공개 키는 release/updater.pub 대신 이것으로 검증한다
    const key = join(work, 'test.key');
    if (x(['keygen', '--out', key], { XTASK_KEY_PASSWORD: 'selftest-pw' }) !== 0) throw new Error('keygen 실패');
    const SIGN = { TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'selftest-pw' };
    const pub = `${key}.pub`;
    const release = (v, pubDate) => {
      const inDir = join(work, `in-${v}`);
      const st = join(work, `stage-${v}`);
      synthBundles(inDir, v);
      const steps = [
        ['collect', ['collect', '--from', inDir, '--out', st, '--version', v]],
        ['sign', ['sign', '--dir', st], SIGN],
        ['verify-sig', ['verify-sig', '--dir', st, '--pubkey', pub]],
        ['sums', ['sums', '--dir', st]],
        ['manifest', ['manifest', '--dir', st, '--version', v, '--pub-date', pubDate, '--base-url', base]],
        ['put', ['put', '--dir', st, '--version', v]],
        ['promote', ['promote', '--dir', st, '--version', v]],
      ];
      for (const [n, a, e] of steps) expect(`(${v}) ${n}`, 0, x(a, e));
      return st;
    };
    const verify = (v, latest = true) => x(['verify', '--version', v, '--pubkey', pub, '--base-url', base, ...(latest ? [] : ['--objects-only'])]);

    // (a) 빈 버킷 happy path
    const st1 = release('1.0.0', '2026-10-06T00:00:00Z');
    expect('(a) verify 1.0.0', 0, verify('1.0.0'));
    expect('(a) latest.json = 1.0.0 manifest.json(바이트)', 0, Buffer.compare(get('releases/latest.json') ?? Buffer.alloc(0), readFileSync(join(st1, 'manifest.json'))) === 0 ? 0 : 1);
    expect('(a) 다른 공개 키로 verify', 'nonzero', x(['verify', '--version', '1.0.0', '--pubkey', join(ROOT, 'release/updater.pub'), '--base-url', base]));
    expect('(a) 다른 공개 키로 verify-sig(시크릿 키 ≠ 커밋 공개 키)', 'nonzero', x(['verify-sig', '--dir', st1, '--pubkey', join(ROOT, 'release/updater.pub')]));
    // (b) 두 번째 버전과 CAS·단조 증가
    const before = get('releases/latest.json');
    const st2 = release('1.1.0', '2026-10-07T00:00:00+09:00');
    expect('(b) verify 1.1.0', 0, verify('1.1.0'));
    expect('(b) previous = 1.0.0', 0, (get('releases/1.1.0/previous') ?? '').toString() === '1.0.0' ? 0 : 1);
    expect('(b) 낮은 버전 승격 거부(1.0.0)', 'nonzero', x(['promote', '--dir', st1, '--version', '1.0.0']));
    expect('(b) 1.0.0 objects-only는 그대로 통과', 0, verify('1.0.0', false));
    // (c) 객체 하나 변조 → verify 실패 → rollback → latest.json이 승격 전과 바이트 동일
    const victim = 'releases/1.1.0/chzzk-downloader_1.1.0_windows-x86_64.msi';
    const orig = get(victim);
    const bad = Buffer.from(orig);
    bad[Math.floor(bad.length / 2)] ^= 1;
    writeFileSync(join(work, 'bad.bin'), bad);
    expect('(c) 변조(put-raw)', 0, x(['put-raw', '--key', victim, '--file', join(work, 'bad.bin')], { XTASK_ALLOW_RAW: '1' }));
    expect('(c) 변조 뒤 verify 1.1.0 실패', 'nonzero', verify('1.1.0'));
    expect('(c) put-raw는 XTASK_ALLOW_RAW 없이 거부', 'nonzero', x(['put-raw', '--key', victim, '--file', join(work, 'bad.bin')]));
    expect('(c) rollback --to 1.0.0 --from 1.1.0', 0, x(['rollback', '--to', '1.0.0', '--from', '1.1.0', '--pubkey', pub, '--base-url', base]));
    expect('(c) latest.json = 승격 전(바이트 동일)', 0, before && Buffer.compare(get('releases/latest.json') ?? Buffer.alloc(0), before) === 0 ? 0 : 1);
    expect('(c) rollback 뒤 verify 1.0.0', 0, verify('1.0.0'));
    expect('(c) 망가진 1.1.0으로는 되돌리지 않는다', 'nonzero', x(['rollback', '--to', '1.1.0', '--pubkey', pub, '--base-url', base]));
    expect('(c) 되돌린 뒤에도 latest.json = 1.0.0', 0, Buffer.compare(get('releases/latest.json') ?? Buffer.alloc(0), before ?? Buffer.alloc(1)) === 0 ? 0 : 1);
    // (d) 재실행 멱등: 같은 내용은 성공, 다른 내용은 덮어쓰지 않는다
    expect('(d) put 1.0.0 재실행', 0, x(['put', '--dir', st1, '--version', '1.0.0']));
    expect('(d) promote 1.0.0 재실행(이미 승격)', 0, x(['promote', '--dir', st1, '--version', '1.0.0']));
    const st2b = join(work, 'stage-1.1.0-b');
    cpSync(st2, st2b, { recursive: true });
    writeFileSync(join(st2b, 'chzzk-downloader_1.1.0_linux-x86_64.deb'), 'different\n');
    expect('(d) 다른 내용 put 거부', 'nonzero', x(['put', '--dir', st2b, '--version', '1.1.0']));
    expect('(d) 서명 없는 sums 목록(.sig 지움) put 거부', 'nonzero', (() => {
      const st1c = join(work, 'stage-1.0.0-c');
      cpSync(st1, st1c, { recursive: true });
      const sums = readFileSync(join(st1c, 'SHA256SUMS'), 'utf8').split('\n').filter((l) => !l.endsWith('.AppImage.sig')).join('\n');
      writeFileSync(join(st1c, 'SHA256SUMS'), sums);
      return x(['put', '--dir', st1c, '--version', '1.0.0']);
    })());
    // (e) 시크릿 없음 → 정확한 preflight 메시지
    const pf = preflight({ RELEASE_MODE: 'tag' });
    expect('(e) preflight 메시지(시크릿 없음)', 0, pf.code === 1 && pf.message === preflightMessage(RELEASE_SECRETS) ? 0 : 1);
    const pf2 = preflight({ RELEASE_MODE: 'rehearsal', ...Object.fromEntries(RELEASE_SECRETS.map((n) => [n, 'x'])) });
    expect('(e) 리허설은 시크릿이 있어도 멈춤', 0, pf2.code === 1 && pf2.message === REHEARSAL_MESSAGE ? 0 : 1);
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/release.mjs'), 'preflight'], { env: { PATH: env.PATH, SystemRoot: env.SystemRoot, RELEASE_MODE: 'tag' }, encoding: 'utf8' });
    expect('(e) preflight 프로세스: exit 1 + 정확한 줄', 0, r.status === 1 && r.stderr.split('\n').includes(`::error::${preflightMessage(RELEASE_SECRETS)}`) ? 0 : 1);
    // (f) 첫 릴리스의 되돌리기: latest.json을 지운다(--from이 다르면 거부)
    expect('(f) rollback --to none --from 9.9.9 거부(지금 latest와 다름)', 'nonzero', x(['rollback', '--to', 'none', '--from', '9.9.9', '--pubkey', pub]));
    expect('(f) rollback --to none --from 1.0.0', 0, x(['rollback', '--to', 'none', '--from', '1.0.0', '--pubkey', pub]));
    expect('(f) latest.json 없음', 0, get('releases/latest.json') === null ? 0 : 1);
    // 서명 검증 서버: 틀린 비밀 키는 403(가짜 서버의 SigV4 검증이 실제로 돈다)
    expect('(g) 틀린 S3 비밀 키는 거부', 'nonzero', x(['get', '--key', 'releases/1.0.0/SHA256SUMS', '--out', join(work, 'g.bin')], { R2_SECRET_ACCESS_KEY: 'wrong' }));
  } catch (e) {
    results.push({ name: `예외: ${e.message}`, want: 0, got: 'throw', ok: false });
  } finally {
    fake.stop();
    rmSync(work, { recursive: true, force: true });
  }
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(52)} 기대 ${String(r.want).padEnd(8)} 결과 ${r.got}`);
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
    console.error('사용법: release.mjs <pubkey|gate|build|xtask|preflight|publish|verify|rollback|selftest|worker>');
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
      return cmdXtask();
    case 'preflight':
      return cmdPreflight(env);
    case 'publish':
      return cmdPublish(env);
    case 'verify':
      return cmdVerify(env);
    case 'rollback':
      return cmdRollback(env);
    case 'selftest':
      return cmdSelftest(env);
    case 'worker':
      return cmdWorker();
    default:
      console.error('사용법: release.mjs <pubkey|gate|build|xtask|preflight|publish|verify|rollback|selftest|worker>');
      return 2;
  }
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).then((c) => process.exit(c));
}
