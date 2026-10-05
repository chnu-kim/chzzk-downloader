#!/usr/bin/env node
// 훅과 CI의 단일 진입점(docs/design/cicd.md §3). 워크플로의 run:은 setup 단계를 빼면 이것만 부른다.
//
//   node scripts/ci/run.mjs <gate> [args]     # gates.mjs의 gate 하나(예: fmt, rust, workflows, versions --tag v1.2.3)
//   node scripts/ci/run.mjs list              # gate 목록
//   node scripts/ci/run.mjs doctor            # 도구 유무·버전 표(tools.json과 비교)
//   node scripts/ci/run.mjs install-hooks     # git config core.hooksPath .githooks
//   node scripts/ci/run.mjs changes           # (CI) 바뀐 경로로 code/release/docs_only 출력
//   node scripts/ci/run.mjs ci-ok             # (CI) env NEEDS(toJSON(needs))로 집계 판정
//
// 종료 코드: gate가 낸 첫 0이 아닌 코드. 도구가 없으면 로컬은 0(경고), CI는 2. 사용법 오류 2.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CODE_GATED_JOBS, COMMANDS, GATES, ROOT } from './gates.mjs';

const IS_WIN = process.platform === 'win32';
export const inCI = (env = process.env) => env.CI === 'true' || env.CI === '1';
const GHA = process.env.GITHUB_ACTIONS === 'true';

// ---- 실행 파일 찾기 ----

// PATH(+Windows PATHEXT)에서 실행 파일 경로를 찾는다. 없으면 null.
export function which(name, env = process.env) {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
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

export function runGate(name, extra = [], env = process.env) {
  const gate = GATES[name];
  if (gate.ciOnly && !inCI(env)) {
    console.warn(`[${name}] 건너뜀: CI 전용 gate(로컬 클론에는 비공개 원격 ref가 있을 수 있다)`);
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
  const steps = gate.steps;
  for (let i = 0; i < steps.length; i++) {
    const { cmd, cwd } = steps[i];
    const args = [...cmd.slice(1), ...(gate.passArgs && i === steps.length - 1 ? extra : [])];
    const title = `${name}: ${[cmd[0], ...args].join(' ')}${cwd ? ` (in ${cwd})` : ''}`;
    const r = group(title, () => spawn(cmd[0], args, { cwd: join(ROOT, cwd ?? '.') }));
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

// 이 패턴에만 맞는 변경은 코드가 아니다(문서). 모르는 경로는 코드로 본다(안전한 쪽).
const NON_CODE = [/^docs\//, /\.md$/i, /^\.claude\//, /^LICENSE(\.|$)/i];
const RELEASE = [/^xtask\//, /^release\//, /^\.github\/workflows\/(release|rollback)\.yml$/];

// 바뀐 파일 목록 → { code, release, docs_only }. 목록이 없으면(판단 불가) 전부 실행한다.
export function classify(files) {
  if (!files || files.length === 0) return { code: true, release: true, docs_only: false };
  const code = files.some((f) => !NON_CODE.some((re) => re.test(f)));
  const release = files.some((f) => RELEASE.some((re) => re.test(f)));
  return { code, release, docs_only: !code };
}

const ZERO = /^0+$/;

// env: CHANGES_EVENT, CHANGES_BASE, CHANGES_HEAD. git 오류·기준 없음은 전부 실행(fail-safe).
export function changedFiles(env = process.env) {
  const base = (env.CHANGES_BASE ?? '').trim();
  const head = (env.CHANGES_HEAD ?? '').trim() || 'HEAD';
  if (!base || ZERO.test(base)) return { files: null, why: '기준 커밋 없음' };
  const r = spawnSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return { files: null, why: `git diff 실패: ${(r.stderr ?? '').trim()}` };
  return { files: r.stdout.split('\0').filter(Boolean), why: null };
}

function cmdChanges(env = process.env) {
  const { files, why } = changedFiles(env);
  const c = classify(files);
  const out = Object.entries(c).map(([k, v]) => `${k}=${v}`);
  console.log(why ? `전부 실행: ${why}` : `바뀐 파일 ${files.length}개`);
  if (files) for (const f of files.slice(0, 200)) console.log(`  ${f}`);
  console.log(out.join('\n'));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, out.join('\n') + '\n');
  return 0;
}

// ---- ci-ok ----

// needs(toJSON(needs)) → { ok, lines }. 규칙(docs/design/cicd.md §2):
//   changes는 success여야 한다. 그 밖의 작업은 success, 또는 changes.code == 'false'일 때 CODE_GATED_JOBS의 skipped만 허용.
export function decideCiOk(needs, gated = CODE_GATED_JOBS) {
  const lines = [];
  let ok = true;
  const changes = needs?.changes;
  if (!changes) {
    return { ok: false, lines: ['changes: needs에 없음'] };
  }
  const codeFalse = changes.result === 'success' && changes.outputs?.code === 'false';
  for (const [job, v] of Object.entries(needs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const r = v?.result;
    let good = r === 'success';
    if (!good && r === 'skipped' && job !== 'changes' && codeFalse && gated.includes(job)) good = true;
    if (!good) ok = false;
    lines.push(`${good ? 'ok  ' : 'FAIL'} ${job}: ${r}`);
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
  const { ok, lines } = decideCiOk(needs);
  for (const l of lines) console.log(l);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### ci-ok: ${ok ? 'success' : 'failure'}\n\n\`\`\`\n${lines.join('\n')}\n\`\`\`\n`);
  }
  if (!ok) console.error('::error::ci-ok: 실패하거나 취소된 작업이 있다');
  return ok ? 0 : 1;
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
    case 'install-hooks':
      return cmdInstallHooks();
    case 'list':
      return cmdList();
    default:
      if (name && Object.hasOwn(GATES, name)) return runGate(name, rest, env);
      console.error(`사용법: node scripts/ci/run.mjs <gate|${COMMANDS.join('|')}> — gate: ${Object.keys(GATES).join(', ')}`);
      return 2;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
