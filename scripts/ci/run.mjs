#!/usr/bin/env node
// 훅과 CI의 단일 진입점(docs/design/cicd.md §3). 워크플로의 run:은 setup 단계를 빼면 이것만 부른다.
//
//   node scripts/ci/run.mjs <gate> [args]     # gates.mjs의 gate 하나(예: fmt, rust, workflows, versions --tag v1.2.3)
//   node scripts/ci/run.mjs list              # gate 목록
//   node scripts/ci/run.mjs doctor            # 도구 유무·버전 표(tools.json과 비교)
//   node scripts/ci/run.mjs install-hooks     # git config core.hooksPath .githooks
//   node scripts/ci/run.mjs hook <pre-commit|commit-msg|pre-push> [git 인자]  # .githooks/*가 부른다(gates.mjs HOOKS)
//   node scripts/ci/run.mjs install-tool <t>  # tools.json download의 릴리스 파일을 받아 sha256 확인 후 설치(CI는 GITHUB_PATH에 더한다)
//   node scripts/ci/run.mjs changes           # (CI) 바뀐 경로로 code/release/docs_only 출력
//   node scripts/ci/run.mjs ci-ok             # (CI) env NEEDS(toJSON(needs))로 집계 판정
//
// 종료 코드: gate가 낸 첫 0이 아닌 코드. 도구가 없으면 로컬은 0(경고), CI는 2. 사용법 오류 2.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODE_GATED_JOBS, COMMANDS, GATES, HOOKS, MASTER_ONLY_JOBS, NON_CODE, ROOT } from './gates.mjs';
import { isPrivateTarget, parseLines, pushedPaths, scanRanges } from './push-guard.mjs';
import { runHookGates } from './snapshot.mjs';

const IS_WIN = process.platform === 'win32';
export const inCI = (env = process.env) => env.CI === 'true' || env.CI === '1';
const GHA = process.env.GITHUB_ACTIONS === 'true';

// ---- 실행 파일 찾기 ----

// PATH(+Windows PATHEXT)와 install-tool 폴더(toolDir)에서 실행 파일 경로를 찾는다. 없으면 null.
export function which(name, env = process.env) {
  const dirs = [...(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean), toolDir(env)];
  const exts = IS_WIN ? (env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const d of dirs) {
    for (const e of exts) {
      const p = join(d, name + e);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        // 다음 후보
      }
    }
  }
  return null;
}

// Windows의 .cmd/.bat 래퍼(pnpm 등)는 shell:false로 띄울 수 없다(CVE-2024-27980 이후 EINVAL).
// 그때만 cmd.exe로 띄운다. 인자는 gates.mjs의 고정 값뿐이라 셸 해석 위험이 없고, 공백이 있으면 따옴표로 감싼다.
export function spawnTool(bin, args, opts) {
  return spawn(bin, args, opts);
}

function spawn(bin, args, opts) {
  if (bin === 'node') return spawnSync(process.execPath, args, { stdio: 'inherit', ...opts });
  const path = which(bin);
  if (!path) return { status: null, error: new Error(`${bin}: PATH에 없음`) };
  if (IS_WIN && ['.cmd', '.bat'].includes(extname(path).toLowerCase())) {
    const q = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    return spawnSync([q(path), ...args.map(q)].join(' '), { stdio: 'inherit', shell: true, ...opts });
  }
  return spawnSync(path, args, { stdio: 'inherit', ...opts });
}

// ---- 도구 ----

const TOOLS = JSON.parse(readFileSync(join(ROOT, 'scripts/ci/tools.json'), 'utf8')).tools;

export function firstSemver(text) {
  return /(\d+\.\d+\.\d+)/.exec(text ?? '')?.[1] ?? null;
}

// { name, found, path, want, have, ok }
export function probeTool(name) {
  const spec = TOOLS[name];
  const bin = spec?.bin ?? name;
  const path = which(bin);
  if (!path) return { name, found: false, want: spec?.version ?? null, have: null, ok: false };
  if (!spec) return { name, found: true, path, want: null, have: null, ok: true };
  // 버전 플래그가 없는 도구(tauri-driver)는 install-tool이 정확한 버전으로 깐다. 여기서는 있는지만 본다
  if (!spec.versionArgs) return { name, found: true, path, want: spec.version, have: null, ok: true };
  const r = spawn(bin, spec.versionArgs, { stdio: 'pipe', encoding: 'utf8' });
  const have = firstSemver(`${r.stdout ?? ''}\n${r.stderr ?? ''}`);
  return { name, found: true, path, want: spec.version, have, ok: have === spec.version };
}

// ---- gate 실행 ----

function group(title, fn) {
  if (GHA) console.log(`::group::${title}`);
  else console.log(`\n== ${title}`);
  try {
    return fn();
  } finally {
    if (GHA) console.log('::endgroup::');
  }
}

export function runGate(name, extra = [], env = process.env, { input } = {}) {
  const gate = GATES[name];
  if (gate.ciOnly && !inCI(env)) {
    console.warn(`[${name}] 건너뜀: CI 전용 gate(로컬 클론에는 비공개 원격 ref가 있을 수 있다)`);
    return 0;
  }
  // 이 OS에서는 돌 수 없는 gate(예: e2e-native는 macOS에 WebDriver가 없다). CI는 그 OS의 작업에서만 부른다
  if (gate.platforms && !gate.platforms.includes(process.platform)) {
    const msg = `[${name}] ${process.platform}에서는 돌지 않는다(${gate.platforms.join('·')} 전용)`;
    if (inCI(env)) {
      console.error(`::error::${msg}`);
      return 2;
    }
    console.warn(`${msg} — 건너뜀: CI가 검사한다`);
    return 0;
  }
  for (const t of gate.needs ?? []) {
    const p = probeTool(t);
    if (!p.found) {
      if (inCI(env)) {
        console.error(`::error::[${name}] 도구 없음: ${t}${p.want ? ` ${p.want}` : ''}`);
        return 2;
      }
      console.warn(`[${name}] 건너뜀: ${t} 없음 — CI가 검사한다(설치: scripts/ci/tools.json)`);
      return 0;
    }
    if (!p.ok) {
      const msg = `[${name}] ${t} 버전 ${p.have ?? '?'} ≠ tools.json ${p.want}`;
      if (inCI(env)) {
        console.error(`::error::${msg}`);
        return 2;
      }
      console.warn(`경고: ${msg}`);
    }
  }
  if (!gate.passArgs && extra.length) {
    console.error(`[${name}] 인자를 받지 않는 gate다: ${extra.join(' ')}`);
    return 2;
  }
  // stdin gate는 표준 입력을 한 번 읽어 모든 단계에 같은 내용으로 넘긴다(훅은 input으로 직접 준다)
  const stdinText = gate.stdin ? (input ?? readFileSync(0, 'utf8')) : undefined;
  const io = gate.stdin ? { input: stdinText, stdio: ['pipe', 'inherit', 'inherit'] } : {};
  const steps = gate.steps;
  for (let i = 0; i < steps.length; i++) {
    const { cmd, cwd, env: stepEnv } = steps[i];
    const args = [...cmd.slice(1), ...(gate.passArgs ? extra : [])];
    const envNote = stepEnv ? ` [${Object.entries(stepEnv).map(([k, v]) => `${k}=${v}`).join(' ')}]` : '';
    const title = `${name}: ${[cmd[0], ...args].join(' ')}${cwd ? ` (in ${cwd})` : ''}${envNote}`;
    const r = group(title, () =>
      spawn(cmd[0], args, { cwd: join(ROOT, cwd ?? '.'), ...io, ...(stepEnv ? { env: { ...process.env, ...stepEnv } } : {}) }),
    );
    if (r.error) {
      console.error(`::error::[${name}] 실행 실패: ${r.error.message}`);
      return 2;
    }
    if (r.status !== 0) {
      console.error(`${GHA ? '::error::' : ''}[${name}] 실패(exit ${r.status ?? r.signal}): ${title}`);
      return r.status || 1;
    }
  }
  console.log(`[${name}] 통과`);
  return 0;
}

// ---- changes ----

// 문서로 보는 경로의 허용 목록. 여기에 맞지 않는 파일이 하나라도 있으면 code다(모르는 경로도 code, 안전한 쪽).
// *.md 전체가 아니라 루트의 *.md만 문서다: testdata/README.md처럼 테스트가 읽는 .md가 있다.
const RELEASE = [/^xtask\//, /^release\//, /^\.github\/workflows\/(release|rollback)\.yml$/];

// 바뀐 파일 목록 → { code, release, docs_only }. 목록이 없으면(판단 불가) 전부 실행한다.
export function classify(files) {
  if (!files || files.length === 0) return { code: true, release: true, docs_only: false };
  const code = files.some((f) => !NON_CODE.some((re) => re.test(f)));
  const release = files.some((f) => RELEASE.some((re) => re.test(f)));
  return { code, release, docs_only: !code };
}

const ZERO = /^0+$/;

// env: CHANGES_BASE, CHANGES_HEAD. git 오류·기준 없음은 전부 실행(fail-safe).
// ci.yml은 CHANGES_BASE를 pull_request에서만 준다. push·dispatch는 늘 전부 실행한다(master의 녹색 ci-ok는 빌드를 뜻한다).
export function changedFiles(env = process.env) {
  const base = (env.CHANGES_BASE ?? '').trim();
  const head = (env.CHANGES_HEAD ?? '').trim() || 'HEAD';
  if (!base || ZERO.test(base)) return { files: null, why: '기준 커밋 없음' };
  const r = spawnSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return { files: null, why: `git diff 실패: ${(r.stderr ?? '').trim()}` };
  return { files: r.stdout.split('\0').filter(Boolean), why: null };
}

// workflow_dispatch 입력 force_fail(env CI_FORCE_FAIL=true): 무거운 작업을 건너뛰게 해(code=false) ci-ok가 실패하게 한다.
// master 실패 고리(report)를 빨리·싸게 확인하는 용도다. push·dispatch에서 skipped는 ci-ok가 거부한다.
export const forceFail = (env = process.env) => env.CI_FORCE_FAIL === 'true';

function cmdChanges(env = process.env) {
  const { files, why } = changedFiles(env);
  const c = forceFail(env) ? { code: false, release: false, docs_only: false } : classify(files);
  if (forceFail(env)) console.log('::warning::force_fail: 무거운 작업을 건너뛰고 ci-ok를 실패시킨다(고리 확인용)');
  const out = Object.entries(c).map(([k, v]) => `${k}=${v}`);
  console.log(why ? `전부 실행: ${why}` : `바뀐 파일 ${files.length}개`);
  if (files) for (const f of files.slice(0, 200)) console.log(`  ${f}`);
  console.log(out.join('\n'));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, out.join('\n') + '\n');
  return 0;
}

// ---- ci-ok ----

// needs(toJSON(needs)), event(github.event_name) → { ok, lines }. 규칙(docs/design/cicd.md §2):
//   changes는 success여야 한다. 그 밖의 작업은 success, 또는 pull_request에서 changes.code == 'false'일 때
//   CODE_GATED_JOBS의 skipped만 허용한다. push·workflow_dispatch에서는 skipped를 하나도 허용하지 않는다.
// ci.yml의 ci-ok guard 단계가 같은 규칙을 식(expression)으로 먼저 판정한다. 이 함수는 두 번째 판정이다.
export function decideCiOk(needs, event, gated = CODE_GATED_JOBS, masterOnly = MASTER_ONLY_JOBS, { force = false } = {}) {
  const lines = [];
  let ok = true;
  const changes = needs?.changes;
  if (!changes) {
    return { ok: false, lines: ['changes: needs에 없음'] };
  }
  const isPr = event === 'pull_request';
  const skipAllowed = isPr && changes.result === 'success' && changes.outputs?.code === 'false';
  for (const [job, v] of Object.entries(needs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const r = v?.result;
    let good = r === 'success';
    if (!good && r === 'skipped' && job !== 'changes' && skipAllowed && gated.includes(job)) good = true;
    if (!good && r === 'skipped' && isPr && masterOnly.includes(job)) good = true;
    if (!good) ok = false;
    lines.push(`${good ? 'ok  ' : 'FAIL'} ${job}: ${r}`);
  }
  if (!event) {
    ok = false;
    lines.push('FAIL EVENT 환경 변수가 없다(github.event_name)');
  }
  if (force) {
    ok = false;
    lines.push('FAIL force_fail 입력(workflow_dispatch)');
  }
  return { ok, lines };
}

function cmdCiOk(env = process.env) {
  let needs;
  try {
    needs = JSON.parse(env.NEEDS ?? '');
  } catch {
    console.error('::error::NEEDS 환경 변수가 JSON이 아니다(toJSON(needs))');
    return 2;
  }
  const { ok, lines } = decideCiOk(needs, env.EVENT, CODE_GATED_JOBS, MASTER_ONLY_JOBS, { force: forceFail(env) });
  for (const l of lines) console.log(l);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### ci-ok: ${ok ? 'success' : 'failure'}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  }
  if (!ok) console.error('::error::ci-ok: 실패하거나 취소된 작업이 있다');
  return ok ? 0 : 1;
}

// ---- hook ----

// 바뀐 경로 목록 → HOOKS[hook].when에서 돌 gate 이름(표 순서)
export function hookGates(hook, files) {
  return HOOKS[hook].when.filter((w) => files.some((f) => w.paths.some((re) => re.test(f)))).map((w) => w.gate);
}

// 인덱스에 올린 경로(GIT_INDEX_FILE을 따른다). 처음 커밋도 된다(빈 트리와 비교).
function stagedPaths() {
  const r = spawnSync('git', ['diff', '--cached', '--name-only', '-z', '--no-renames'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split('\0').filter(Boolean) : null;
}

// 첫 0이 아닌 코드에서 멈춘다(훅은 빨리 실패한다)
function runAll(gates, env) {
  for (const [g, args, opts] of gates) {
    const code = runGate(g, args ?? [], env, opts ?? {});
    if (code !== 0) return code;
  }
  return 0;
}

// 조건부 gate는 커밋·push될 내용에서 돈다(snapshot.mjs). install-tool 폴더와 cargo 빌드 캐시는 이 저장소 것을 나눠 쓴다.
const snapOpts = (env) => ({ extraPath: toolDir(env), targetDir: join(ROOT, 'target') });

// push할 ref → 커밋 SHA(태그는 벗긴다). 커밋이 아니면 null.
function peel(sha) {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// .githooks/<hook>이 부른다. 훅과 CI가 같은 gate 표를 쓰므로 결과가 갈리지 않는다.
function cmdHook(hook, args, env = process.env) {
  if (!Object.hasOwn(HOOKS, hook)) {
    console.error(`사용법: node scripts/ci/run.mjs hook <${Object.keys(HOOKS).join('|')}> [git 인자]`);
    return 2;
  }
  const h = HOOKS[hook];
  const fast = h.fastSkip && env.CHZZK_HOOK_FAST === '1';
  if (hook === 'pre-commit') {
    const files = stagedPaths();
    if (files === null) {
      console.error('pre-commit: staged 경로를 읽지 못했다');
      return 2;
    }
    const code = runAll(h.always.map((g) => [g]), env); // scan-staged는 인덱스를 직접 읽는다
    if (code !== 0) return code;
    return runHookGates(ROOT, { index: true }, hookGates(hook, files), env, snapOpts(env));
  }
  if (hook === 'commit-msg') {
    if (args.length < 1) {
      console.error('commit-msg: 메시지 파일 인자가 없다');
      return 2;
    }
    return runAll([['scan-msg', [args[0]]]], env);
  }
  // pre-push: stdin을 한 번만 읽어 push-guard에 넘기고, 같은 줄로 scan-range 범위와 바뀐 경로를 계산한다
  const [remote, url = remote] = args;
  if (!remote) {
    console.error('pre-push: 원격 이름 인자가 없다');
    return 2;
  }
  const input = readFileSync(0, 'utf8');
  const guardCode = runGate('push-guard', [remote, url], env, { input });
  if (guardCode !== 0) return guardCode;
  if (isPrivateTarget(remote, url)) return 0;
  const refs = parseLines(input) ?? [];
  const ranges = scanRanges(ROOT, remote, refs);
  const code = runAll(ranges.map((r) => ['scan-range', r.args]), env);
  if (code !== 0) return code;
  if (fast) {
    console.warn('pre-push: CHZZK_HOOK_FAST=1 — 빌드·테스트 gate를 건너뛴다(CI가 검사한다)');
    return 0;
  }
  // 커밋마다(같은 커밋은 한 번) 그 커밋이 새로 가져오는 경로로 gate를 고르고 그 커밋의 트리에서 돌린다
  const bySha = new Map();
  for (const r of refs) {
    const sha = peel(r.localSha);
    if (!sha) continue; // 삭제·커밋이 아닌 객체
    const gates = new Set([...(bySha.get(sha) ?? []), ...hookGates(hook, pushedPaths(ROOT, remote, [r]))]);
    bySha.set(sha, gates);
  }
  for (const [sha, gates] of bySha) {
    const ordered = h.when.map((w) => w.gate).filter((g) => gates.has(g));
    const c = runHookGates(ROOT, { sha }, ordered, env, snapOpts(env));
    if (c !== 0) return c;
  }
  return 0;
}

// ---- doctor / install-hooks / list ----

function cmdDoctor() {
  const names = [...new Set(['node', 'git', 'cargo', 'rustup', 'pnpm', ...Object.keys(TOOLS)])];
  let bad = 0;
  for (const n of names) {
    const p = probeTool(n);
    const state = !p.found ? '없음' : p.want && !p.ok ? `버전 ${p.have} ≠ ${p.want}` : (p.have ?? '있음');
    if (!p.found || !p.ok) bad++;
    console.log(`${(p.found && p.ok ? 'ok ' : '-- ').padEnd(4)}${n.padEnd(15)}${state}`);
  }
  const hooks = spawnSync('git', ['config', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  console.log(`\ncore.hooksPath = ${hooks || '(없음)'}${hooks === '.githooks' ? '' : '  → node scripts/ci/run.mjs install-hooks'}`);
  if (bad) console.log(`\n${bad}개 도구가 없거나 버전이 다르다. 로컬 gate는 그 검사를 건너뛰고 CI가 검사한다.`);
  return 0;
}

function cmdInstallHooks() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 22) {
    console.error(`Node 22 이상이 필요하다(지금 ${process.versions.node})`);
    return 2;
  }
  if (!existsSync(join(ROOT, '.githooks'))) {
    console.error('.githooks/가 없다');
    return 2;
  }
  const r = spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) return r.status ?? 2;
  console.log('core.hooksPath = .githooks');
  return cmdDoctor();
}

// install-tool이 설치하는 곳. CI는 RUNNER_TEMP, 로컬은 저장소 안의 무시되는 폴더(target/ci-tools/bin)다.
export function toolDir(env = process.env) {
  return env.RUNNER_TEMP ? join(env.RUNNER_TEMP, 'ci-tools', 'bin') : join(ROOT, 'target', 'ci-tools', 'bin');
}

// tools.json의 download 항목으로 도구를 설치한다. 해시가 다르면 설치하지 않고 실패한다.
// 키는 <os>-<arch>(linux-x64, darwin-arm64, windows-x64 …). .zip·.tar.gz 모두 tar(bsdtar·GNU tar)로 푼다.
// tools.json download 항목을 받아 sha256이 같을 때만 { buf, dl, sha }를 돌려준다. 아니면 { code }.
async function downloadVerified(name) {
  const spec = TOOLS[name];
  const key = `${IS_WIN ? 'windows' : process.platform}-${process.arch}`;
  const dl = spec?.download?.[key];
  if (!dl) {
    const keys = Object.keys(spec?.download ?? {}).join(', ') || '없음';
    console.error(`install-tool: ${name}에 ${key}용 download 항목이 없다(tools.json: ${keys}). 직접 설치한다: ${spec?.version ?? ''}`);
    return { code: 2 };
  }
  const res = await fetch(dl.url);
  if (!res.ok) {
    console.error(`install-tool: ${dl.url} → HTTP ${res.status}`);
    return { code: 1 };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== dl.sha256) {
    console.error(`::error::install-tool: ${name} sha256 불일치(기대 ${dl.sha256}, 받음 ${got})`);
    return { code: 1 };
  }
  return { buf, dl, sha: got };
}

// cargo install로 까는 도구(tools.json cargoInstall). --locked는 그 crate가 배포한 Cargo.lock을 쓴다.
function installCargoTool(name, spec, env) {
  const dir = toolDir(env);
  const root = dirname(dir);
  mkdirSync(dir, { recursive: true });
  const r = spawn('cargo', ['install', '--locked', '--version', spec.version, '--root', root, spec.cargoInstall], { env });
  if (r.error || r.status !== 0) {
    console.error(`::error::install-tool: cargo install ${spec.cargoInstall}@${spec.version} 실패(${r.error?.message ?? r.status})`);
    return r.status || 2;
  }
  console.log(`install-tool: ${name} ${spec.version} (cargo install --locked) → ${dir}`);
  if (env.GITHUB_PATH) appendFileSync(env.GITHUB_PATH, dir + '\n');
  else console.log(`PATH에 더한다: ${IS_WIN ? `$env:Path = "${dir};$env:Path"` : `export PATH="${dir}:$PATH"`}`);
  return 0;
}

async function cmdInstallTool(name, env = process.env) {
  const spec = TOOLS[name];
  if (spec?.cargoInstall) return installCargoTool(name, spec, env);
  const d = await downloadVerified(name);
  if (d.code !== undefined) return d.code;
  const { buf, dl, sha: got } = d;
  const dir = toolDir(env);
  mkdirSync(dir, { recursive: true });
  const zip = dl.url.endsWith('.zip');
  const archive = join(dir, `${name}${zip ? '.zip' : '.tar.gz'}`);
  writeFileSync(archive, buf);
  const member = spec.bin + (IS_WIN ? '.exe' : '');
  const r = spawnSync('tar', ['-xf', archive, '-C', dir, member], { stdio: 'inherit' });
  if (r.status !== 0) return r.status ?? 2;
  console.log(`install-tool: ${name} ${spec.version} → ${dir} (sha256 ${got})`);
  if (env.GITHUB_PATH) appendFileSync(env.GITHUB_PATH, dir + '\n');
  else console.log(`PATH에 더한다: ${IS_WIN ? `$env:Path = "${dir};$env:Path"` : `export PATH="${dir}:$PATH"`}`);
  return 0;
}

// rustup이 없는 컨테이너(bundle-linux의 ubuntu:22.04)에 rustup을 깐다. rustup-init은 tools.json의 sha256으로 확인하고
// 툴체인은 깔지 않는다(다음 setup 단계 `rustup toolchain install`이 rust-toolchain.toml을 읽는다).
async function cmdInstallRustup(env = process.env) {
  if (IS_WIN) {
    console.error('install-rustup: Linux·macOS 전용');
    return 2;
  }
  const d = await downloadVerified('rustup-init');
  if (d.code !== undefined) return d.code;
  const dir = toolDir(env);
  mkdirSync(dir, { recursive: true });
  const init = join(dir, 'rustup-init');
  writeFileSync(init, d.buf, { mode: 0o755 });
  const r = spawnSync(init, ['-y', '--no-modify-path', '--default-toolchain', 'none', '--profile', 'minimal'], { stdio: 'inherit' });
  if (r.status !== 0) return r.status ?? 2;
  const bin = join(env.CARGO_HOME ?? join(env.HOME ?? '', '.cargo'), 'bin');
  console.log(`install-rustup: rustup-init ${TOOLS['rustup-init'].version} (sha256 ${d.sha}) → ${bin}`);
  if (env.GITHUB_PATH) appendFileSync(env.GITHUB_PATH, bin + '\n');
  return 0;
}

function cmdList() {
  for (const [n, g] of Object.entries(GATES)) console.log(`${n.padEnd(14)}${g.desc}`);
  console.log(`\n하위 명령: ${COMMANDS.join(', ')}`);
  return 0;
}

export function main(argv, env = process.env) {
  const [name, ...rest] = argv;
  switch (name) {
    case 'changes':
      return cmdChanges(env);
    case 'ci-ok':
      return cmdCiOk(env);
    case 'doctor':
      return cmdDoctor();
    case 'hook':
      return cmdHook(rest[0], rest.slice(1), env);
    case 'install-hooks':
      return cmdInstallHooks();
    case 'install-tool':
      return cmdInstallTool(rest[0], env);
    case 'install-rustup':
      return rest.length ? 2 : cmdInstallRustup(env);
    case 'report':
      // ci.yml report 작업(docs/design/cicd.md §4.1·§4.4). env: GITHUB_REPOSITORY·GITHUB_RUN_ID·GITHUB_SHA·CI_OK_RESULT·GH_TOKEN
      if (rest.length) return 2;
      return import('./issue.mjs').then((m) => m.report(env, m.realGh(env)));
    case 'report-loop':
      // 예약 워크플로(nightly.yml)의 report 작업. env: NEEDS·GITHUB_REPOSITORY·GITHUB_RUN_ID·GITHUB_SHA·GH_TOKEN
      if (rest.length) return 2;
      return import('./issue.mjs').then((m) => m.reportLoop(env, m.realGh(env)));
    case 'drift-log-check':
      // nightly.yml report 작업: drift 작업의 실제 로그에 canary·허용 밖 줄이 없는지(docs/design/cicd.md §4.3)
      if (rest.length) return 2;
      return Promise.all([import('./drift.mjs'), import('./issue.mjs')]).then(([d, i]) => d.driftLogCheck(env, i.realGh(env)));
    case 'list':
      return cmdList();
    default:
      if (name && Object.hasOwn(GATES, name)) return runGate(name, rest, env);
      console.error(`사용법: node scripts/ci/run.mjs <gate|${COMMANDS.join('|')}> — gate: ${Object.keys(GATES).join(', ')}`);
      return 2;
  }
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(2);
    },
  );
}
