#!/usr/bin/env node
// Ratchet(docs/design/cicd.md §4.2). 기준값은 저장소의 ci/ratchet.json, 측정값은 measure.mjs가 쓴 target/ci/measure/<kind>.json.
//
//   node scripts/ci/ratchet.mjs check <coverage|tests|size|mutants|design>  # 측정값을 기준과 비교(나빠지면 실패)
//   node scripts/ci/ratchet.mjs write --from <폴더>              # 폴더 아래 측정 JSON으로 기준을 조인다(올리기만)
//   node scripts/ci/ratchet.mjs write --from-run <run id>        # gh run download로 CI 측정값을 받아 write
//                                                                 # (이 저장소의 성공한 push·dispatch 실행만 받는다)
//   node scripts/ci/ratchet.mjs lint                              # ratchet.json 모양: 0인 키는 모두 $pending에 있고
//                                                                 # $pending은 PENDING_ALLOWED 안이며 값이 0이다
//   node scripts/ci/ratchet.mjs log-check                         # env RATCHET_BASE 대비 기준을 느슨하게 했으면
//                                                                 # ci/RATCHET_LOG.md에 그 키를 적은 줄이 더해졌는지
//
// 측정값은 평평한 키 경로다: {"coverage_lines.rust": 87.1, "tests.vitest": 491, "size.binary.linux": 12345}.
// 판정(순수 함수 judge):
//   coverage_lines.*  현재 < 기준 − tolerance_pp 이면 실패
//   tests.*           현재 < 기준 이면 실패
//   size.*            현재 > 기준 × (1 + tolerance_pct/100) 이면 실패
//   mutants_missed.*  현재 > 기준 이면 실패(살아남은 mutant가 늘었다). 0은 실제 기준일 수 있다: 이 영역만 '안 잼'을
//                     값이 아니라 $pending에 있는지로만 정한다.
//   design.*          현재 > 기준 이면 실패(디자인 gate 허용 목록 항목이 늘었다). mutants_missed처럼 0도 실제 기준이다.
//   기준 0은 $pending(아직 안 잼)에 있을 때만 통과(알림만)하고, 없으면 실패한다(mutants_missed 제외). ratchet.json에 없는 키는 실패.
//   size는 이 OS의 기준 키(dist_gz, binary.<os>, bundle.<os>-*)가 측정에 빠져도 실패한다(번들 표에서 지운 것을 잡는다).
// 종료 코드: 통과 0, 위반 1, 사용법·입력 오류 2.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';
import { osKey } from './smoke.mjs';

export const RATCHET_PATH = 'ci/ratchet.json';
export const LOG_PATH = 'ci/RATCHET_LOG.md';
export const MEASURE_DIR = 'target/ci/measure';
export const KINDS = { coverage: 'coverage_lines', tests: 'tests', size: 'size', mutants: 'mutants_missed', design: 'design' };
// 0이 실제 기준일 수 있는 영역(살아남은 mutant 0개, 디자인 허용 목록 0항목은 목표다. design은 단계 (c)부터 0으로 남는다.
// shots.max_diff_pixels는 스냅샷 허용 오차이고 0이 처음 값이다, docs/design/system/governance.md §2.7).
// '안 잼'은 $pending으로만 정한다.
const ZERO_IS_REAL = new Set(['mutants_missed', 'design', 'shots']);
// 작을수록 좋은 영역(design.allow_entries: 허용 목록 항목 수, governance.md §2.3. shots: 늘리면 느슨하게 하기라 로그 줄이 필요하다)
const LOWER_IS_BETTER = new Set(['size', 'mutants_missed', 'design', 'shots']);
const SETTINGS = new Set(['tolerance_pp', 'tolerance_pct']);
// 기준 0(아직 안 잼)으로 둘 수 있는 키. 다른 키가 0이면 lint가 실패한다. tests.playwright는 G4에서 채웠다(실행 37324424781).
// tests.app_e2e.*는 G4 2차 리뷰에서 더해 실행 37334258200으로 채웠다. mutants_missed.chzzk-core는 G5에서 더해 nightly 실행
// 37342266385(only=mutants, shard 4개)로 채웠다(100). tests.worker는 Phase 3 W1에서 더했다: worker gate(ci.yml worker 작업)의
// 첫 master 실행 37434910274로 채우고 여기서 뺐다(57, worker.md §13.2).
export const PENDING_ALLOWED = [];

// 객체 → { "a.b.c": 숫자 } (설정 키·$comment·null 제외)
export function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (k.startsWith('$')) continue;
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') Object.assign(out, flatten(v, p));
    else if (typeof v === 'number' && !SETTINGS.has(k)) out[p] = v;
  }
  return out;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined), obj);
}

function setPath(obj, path, value) {
  const ks = path.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k];
  o[ks.at(-1)] = value;
}

const area = (key) => key.split('.')[0];

const pendingOf = (ratchet) => (Array.isArray(ratchet.$pending) ? ratchet.$pending : []);

// size 판정에서 이 OS가 반드시 내야 하는 키
export function expectedSizeKeys(ratchet, os) {
  return Object.keys(flatten(ratchet))
    .filter((k) => k === 'size.dist_gz' || k === `size.binary.${os}` || k.startsWith(`size.bundle.${os}-`))
    .sort();
}

// 기준(ratchet.json 객체), 측정({키: 값}), 꼭 있어야 할 키 → { ok, rows: [{key, floor, value, state, note}] }
// state: ok | fail | unmeasured | unknown | missing
export function judge(ratchet, measured, expected = []) {
  const rows = [];
  const pending = pendingOf(ratchet);
  for (const key of expected) {
    if (!Object.hasOwn(measured, key)) rows.push({ key, floor: getPath(ratchet, key) ?? null, value: null, state: 'missing', note: '기준이 있는데 측정되지 않았다(산출물·측정이 사라졌다)' });
  }
  const tolPp = ratchet.coverage_lines?.tolerance_pp ?? 0;
  const tolPct = ratchet.size?.tolerance_pct ?? 0;
  for (const key of Object.keys(measured).sort()) {
    const value = measured[key];
    const floor = getPath(ratchet, key);
    if (typeof floor !== 'number' || SETTINGS.has(key.split('.').at(-1)) || !Object.hasOwn(KIND_BY_AREA, area(key))) {
      rows.push({ key, floor: null, value, state: 'unknown', note: `${RATCHET_PATH}에 없는 키` });
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      rows.push({ key, floor, value, state: 'fail', note: '측정값이 0 이상의 수가 아니다' });
      continue;
    }
    if (pending.includes(key)) {
      rows.push({ key, floor, value, state: 'unmeasured', note: `기준 없음($pending). write로 ${value}을(를) 기준으로 삼을 수 있다` });
      continue;
    }
    if (floor === 0 && !ZERO_IS_REAL.has(area(key))) {
      rows.push({ key, floor, value, state: 'fail', note: '기준이 0인데 $pending에 없다' });
      continue;
    }
    let fail = false;
    let note = '';
    if (area(key) === 'coverage_lines') {
      fail = value < floor - tolPp - 1e-9;
      note = fail ? `${floor} − ${tolPp}pp 아래` : value > floor ? `기준을 ${value}(으)로 올릴 수 있다` : '';
    } else if (area(key) === 'tests') {
      fail = value < floor;
      note = fail ? `기준 ${floor}보다 적다(테스트가 사라졌다)` : value > floor ? `기준을 ${value}(으)로 올릴 수 있다` : '';
    } else if (area(key) === 'mutants_missed') {
      fail = value > floor;
      note = fail ? `살아남은 mutant가 ${value - floor}개 늘었다(기준 ${floor})` : value < floor ? `기준을 ${value}(으)로 낮출(조일) 수 있다` : '';
    } else if (area(key) === 'design') {
      fail = value > floor;
      note = fail ? `허용 목록 항목이 ${value - floor}개 늘었다(기준 ${floor}). 새 위반은 허용 목록이 아니라 코드에서 고친다` : value < floor ? `기준을 ${value}(으)로 낮출(조일) 수 있다` : '';
    } else {
      const max = floor * (1 + tolPct / 100);
      fail = value > max;
      const pct = (((value - floor) / floor) * 100).toFixed(2);
      note = fail ? `${pct}% 커졌다(허용 ${tolPct}%)` : value < floor ? `기준을 ${value}(으)로 낮출(조일) 수 있다` : '';
    }
    rows.push({ key, floor, value, state: fail ? 'fail' : 'ok', note });
  }
  return { ok: rows.every((r) => r.state === 'ok' || r.state === 'unmeasured'), rows };
}

// shots는 측정하지 않는 설정값(app/playwright.shots.config.ts가 읽는다)이라 KINDS(check 종류)에는 없고 lint·log-check만 본다
const KIND_BY_AREA = { coverage_lines: 'coverage', tests: 'tests', size: 'size', mutants_missed: 'mutants', design: 'design', shots: 'shots' };

// 측정값 하나가 그 종류로 말이 되는지. 아니면 예외(기준에 넣지 않는다).
export function assertMeasureValue(key, value) {
  const bad = (why) => {
    throw new Error(`측정값 ${key} = ${JSON.stringify(value)}: ${why}`);
  };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) bad('0 이상의 유한한 수가 아니다');
  if (area(key) === 'coverage_lines' && value > 100) bad('커버리지가 100%를 넘는다');
  if (area(key) !== 'coverage_lines' && !Number.isInteger(value)) bad('정수가 아니다');
}

// 커버리지 기준은 0.1 단위로 내린다(같은 커밋도 실행마다 0.01pp쯤 흔들려 운 좋은 값이 기준이 되지 않게)
export const coverageFloor = (v) => Math.floor(v * 10 + 1e-9) / 10;

// 기준을 조인다(느슨하게 하지 않는다). 측정 → 새 ratchet 객체와 바뀐 키 목록. 값을 넣은 키는 $pending에서 뺀다.
export function tighten(ratchet, measured) {
  const next = structuredClone(ratchet);
  const changed = [];
  for (const [key, value] of Object.entries(measured).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const floor = getPath(next, key);
    if (typeof floor !== 'number' || SETTINGS.has(key.split('.').at(-1)) || !Object.hasOwn(KIND_BY_AREA, area(key))) throw new Error(`${RATCHET_PATH}에 없는 키: ${key}`);
    assertMeasureValue(key, value);
    const v = area(key) === 'coverage_lines' ? coverageFloor(value) : value;
    let nv = floor;
    const pending = Array.isArray(next.$pending) && next.$pending.includes(key);
    if (pending || (floor === 0 && !ZERO_IS_REAL.has(area(key)))) nv = v;
    else if (LOWER_IS_BETTER.has(area(key))) nv = Math.min(floor, v);
    else nv = Math.max(floor, v);
    // 채운 키는 $pending에서 뺀다. 0이 '안 잼'인 영역에서 0을 쟀으면 그대로 둔다(lint가 0을 $pending 밖에 두지 않는다)
    if (pending && (nv !== 0 || ZERO_IS_REAL.has(area(key)))) {
      next.$pending = next.$pending.filter((k) => k !== key);
      if (nv === floor) changed.push({ key, from: '$pending', to: nv });
    }
    if (nv !== floor) {
      setPath(next, key, nv);
      changed.push({ key, from: floor, to: nv });
    }
  }
  return { next, changed };
}

// ratchet.json 모양 → 문제 목록(빈 배열이면 통과)
export function lintRatchet(ratchet, allowed = PENDING_ALLOWED) {
  const errs = [];
  const flat = flatten(ratchet);
  const pending = ratchet.$pending;
  if (pending !== undefined && (!Array.isArray(pending) || pending.some((k) => typeof k !== 'string'))) errs.push('$pending은 키 경로 문자열 배열이다');
  const p = pendingOf(ratchet);
  for (const [k, v] of Object.entries(flat)) {
    if (!Object.hasOwn(KIND_BY_AREA, area(k))) continue;
    if (v === 0 && !p.includes(k) && !ZERO_IS_REAL.has(area(k))) errs.push(`${k}: 기준이 0인데 $pending에 없다(ratchet.mjs write --from-run으로 채운다)`);
    if (v < 0 || !Number.isFinite(v)) errs.push(`${k}: 기준이 0 이상의 수가 아니다`);
  }
  for (const k of p) {
    if (!Object.hasOwn(flat, k)) errs.push(`$pending ${k}: ${RATCHET_PATH}에 없는 키`);
    else if (flat[k] !== 0) errs.push(`$pending ${k}: 값이 ${flat[k]}이다(채운 키는 $pending에서 뺀다)`);
    if (!allowed.includes(k)) errs.push(`$pending ${k}: PENDING_ALLOWED(${allowed.join(', ')})에 없다 — 측정해 채워야 한다`);
  }
  return errs;
}

// gh api repos/<repo>/actions/runs/<id> 응답 → 기준으로 쓸 수 없는 이유 목록. pull_request 실행(fork 코드가 측정)을 막는다.
// ci.yml은 실행 전체가 성공해야 한다. nightly.yml은 실행 전체가 설계상 빨갈 수 있어(toolchain·secret 전의 drift 등) 측정을 낸
// 작업(MEASURING_JOBS)이 성공했는지를 본다(jobs: 그 실행의 [{name, conclusion}]).
export const MEASURING_JOBS = { '.github/workflows/nightly.yml': ['nightly mutants'] };
export function runProvenance(run, repo, jobs = []) {
  const errs = [];
  if (!['push', 'workflow_dispatch', 'schedule'].includes(run?.event)) errs.push(`event ${run?.event}(push·workflow_dispatch·schedule만)`);
  if (run?.head_repository?.full_name !== repo) errs.push(`head 저장소 ${run?.head_repository?.full_name} ≠ ${repo}`);
  if (run?.repository?.full_name !== repo) errs.push(`저장소 ${run?.repository?.full_name} ≠ ${repo}`);
  if (run?.path === '.github/workflows/ci.yml') {
    if (run?.conclusion !== 'success') errs.push(`conclusion ${run?.conclusion}(success만)`);
  } else if (Object.hasOwn(MEASURING_JOBS, run?.path ?? '')) {
    for (const name of MEASURING_JOBS[run.path]) {
      const c = jobs.find((j) => j.name === name)?.conclusion;
      if (c !== 'success') errs.push(`작업 '${name}' ${c ?? '없음'}(success만)`);
    }
  } else errs.push(`워크플로 ${run?.path}(ci.yml·nightly.yml만)`);
  return errs;
}

// git remote origin URL → owner/name
export function repoFromRemote(url) {
  const m = /github\.com[:/]([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec((url ?? '').trim());
  return m ? m[1] : null;
}

// 옛 기준 → 새 기준에서 느슨해진 키(기준 0으로 되돌린 것, 키 삭제, 허용치 확대 포함)
export function loosened(oldR, newR) {
  const out = [];
  const o = flatten(oldR);
  const n = flatten(newR);
  for (const [key, ov] of Object.entries(o)) {
    if (!Object.hasOwn(KIND_BY_AREA, area(key))) continue;
    const nv = n[key];
    if (nv === undefined) out.push(key);
    else if (pendingOf(oldR).includes(key)) continue; // 안 잼 → 첫 기준은 느슨하게 하기가 아니다
    else if (ov === 0 && !ZERO_IS_REAL.has(area(key))) continue;
    else if (nv === 0 && !ZERO_IS_REAL.has(area(key))) out.push(key);
    else if (LOWER_IS_BETTER.has(area(key)) ? nv > ov : nv < ov) out.push(key);
  }
  for (const [path, wider] of [
    ['coverage_lines.tolerance_pp', (a, b) => b > a],
    ['size.tolerance_pct', (a, b) => b > a],
  ]) {
    const a = getPath(oldR, path);
    const b = getPath(newR, path);
    if (typeof a === 'number' && (typeof b !== 'number' || wider(a, b))) out.push(path);
  }
  return out.sort();
}

// 느슨해진 키 각각이 로그에 더해진 줄(diff의 + 줄)에 글자 그대로 있는지 → 빠진 키
export function missingLogKeys(keys, addedLines) {
  return keys.filter((k) => !addedLines.some((l) => l.includes(k)));
}

// ---- 입출력 ----

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function loadMeasured(root, kind) {
  const p = join(root, MEASURE_DIR, `${kind}.json`);
  if (!existsSync(p)) throw new Error(`${p}가 없다(measure.mjs ${kind}가 먼저 돌아야 한다)`);
  return readJson(p);
}

function summary(title, rows, ok) {
  const lines = rows.map((r) => `| \`${r.key}\` | ${r.floor ?? '—'} | ${r.value} | ${r.state} | ${r.note} |`);
  const md = `### ratchet ${title}: ${ok ? '통과' : '실패'}\n\n| 키 | 기준 | 측정 | 판정 | 메모 |\n|---|---|---|---|---|\n${lines.join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
}

function cmdCheck(root, kind) {
  if (!Object.hasOwn(KINDS, kind)) {
    console.error(`ratchet check: 모르는 종류 ${kind}(${Object.keys(KINDS).join('|')})`);
    return 2;
  }
  const ratchet = readJson(join(root, RATCHET_PATH));
  const measured = loadMeasured(root, kind);
  const foreign = Object.keys(measured).filter((k) => area(k) !== KINDS[kind]);
  if (foreign.length) {
    console.error(`ratchet check ${kind}: 다른 종류의 키 ${foreign.join(', ')}`);
    return 2;
  }
  const { ok, rows } = judge(ratchet, measured, kind === 'size' ? expectedSizeKeys(ratchet, osKey()) : []);
  for (const r of rows) {
    const mark = { ok: 'ok  ', fail: 'FAIL', unmeasured: 'new ', unknown: 'FAIL', missing: 'FAIL' }[r.state];
    console.log(`${mark} ${r.key.padEnd(28)} 기준 ${String(r.floor ?? '—').padEnd(12)} 측정 ${String(r.value).padEnd(12)} ${r.note}`);
    if (r.state === 'unmeasured' && process.env.GITHUB_ACTIONS === 'true') console.log(`::notice::ratchet ${r.key}: ${r.note}`);
  }
  summary(kind, rows, ok);
  if (!ok) console.error(`::error::ratchet ${kind}: 기준보다 나빠졌다. 의도한 것이면 ${RATCHET_PATH}를 고치고 ${LOG_PATH}에 키 이름과 이유를 적는다`);
  return ok ? 0 : 1;
}

// 폴더 아래 모든 *.json 측정 파일(키 경로 객체)을 합친다. 같은 키가 다른 값으로 두 번 나오면 오류.
function collectMeasured(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (Object.keys(KINDS).some((k) => e.name === `${k}.json`)) {
        for (const [k, v] of Object.entries(readJson(p))) {
          if (Object.hasOwn(out, k) && out[k] !== v) throw new Error(`측정값이 둘이다: ${k} = ${out[k]} / ${v}`);
          out[k] = v;
        }
      }
    }
  };
  walk(dir);
  return out;
}

function cmdWrite(root, from, runId) {
  let dir = from;
  let tmp = null;
  if (runId) {
    if (!/^\d+$/.test(runId)) {
      console.error('ratchet write: --from-run은 숫자 run id다');
      return 2;
    }
    const repo = repoFromRemote(git(root, ['remote', 'get-url', 'origin']).stdout);
    if (!repo) {
      console.error('ratchet write: origin이 github.com 저장소가 아니다');
      return 2;
    }
    const v = spawnSync('gh', ['api', `repos/${repo}/actions/runs/${runId}`], { cwd: root, encoding: 'utf8' });
    if (v.status !== 0) {
      console.error(`ratchet write: 실행 ${runId}을(를) 읽지 못했다: ${v.stderr}`);
      return 2;
    }
    const run = JSON.parse(v.stdout);
    let jobs = [];
    if (Object.hasOwn(MEASURING_JOBS, run.path ?? '')) {
      const j = spawnSync('gh', ['api', `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`, '--jq', '[.jobs[] | {name, conclusion}]'], { cwd: root, encoding: 'utf8' });
      if (j.status !== 0) {
        console.error(`ratchet write: 실행 ${runId}의 작업 목록을 읽지 못했다: ${j.stderr}`);
        return 2;
      }
      jobs = JSON.parse(j.stdout || '[]');
    }
    const errs = runProvenance(run, repo, jobs);
    if (errs.length) {
      console.error(`ratchet write: 실행 ${runId}은(는) 기준으로 쓸 수 없다: ${errs.join('; ')}`);
      return 2;
    }
    tmp = mkdtempSync(join(tmpdir(), 'ratchet-'));
    const r = spawnSync('gh', ['run', 'download', runId, '-R', repo, '--pattern', 'ratchet-measurements-*', '--dir', tmp], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) return 2;
    dir = tmp;
  }
  try {
    if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) {
      console.error(`ratchet write: 폴더가 없다: ${dir}`);
      return 2;
    }
    const measured = collectMeasured(dir);
    const path = join(root, RATCHET_PATH);
    const { next, changed } = tighten(readJson(path), measured);
    for (const c of changed) console.log(`${c.key}: ${c.from} → ${c.to}`);
    if (!changed.length) console.log('바뀐 기준 없음');
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n');
    return 0;
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
}

function cmdLogCheck(root, base) {
  const b = (base ?? '').trim();
  if (!b || /^0+$/.test(b)) {
    console.log('ratchet log-check: 기준 커밋 없음(RATCHET_BASE) — 건너뜀');
    return 0;
  }
  if (!/^[0-9a-f]{7,40}$/i.test(b)) {
    console.error(`ratchet log-check: RATCHET_BASE가 커밋 SHA가 아니다: ${b}`);
    return 2;
  }
  if (git(root, ['cat-file', '-e', `${b}^{commit}`]).status !== 0) {
    console.warn(`ratchet log-check: 기준 커밋 ${b}가 이 클론에 없다 — 건너뜀`);
    return 0;
  }
  const old = git(root, ['show', `${b}:${RATCHET_PATH}`]);
  if (old.status !== 0) {
    console.log(`ratchet log-check: ${b}에 ${RATCHET_PATH}가 없다 — 처음 만드는 것`);
    return 0;
  }
  const keys = loosened(JSON.parse(old.stdout), readJson(join(root, RATCHET_PATH)));
  if (!keys.length) {
    console.log('ratchet log-check: 느슨해진 기준 없음');
    return 0;
  }
  const diff = git(root, ['diff', '--no-color', '--unified=0', b, '--', LOG_PATH]);
  if (diff.status !== 0) {
    console.error(`ratchet log-check: git diff 실패: ${diff.stderr}`);
    return 2;
  }
  const added = diff.stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const missing = missingLogKeys(keys, added);
  console.log(`느슨해진 기준: ${keys.join(', ')}`);
  if (missing.length) {
    console.error(`::error::ratchet log-check: ${LOG_PATH}에 이유를 적은 줄이 없는 키: ${missing.join(', ')}`);
    return 1;
  }
  console.log(`ratchet log-check: ${LOG_PATH}에 모두 적혀 있다`);
  return 0;
}

function cmdLint(root) {
  const errs = lintRatchet(readJson(join(root, RATCHET_PATH)));
  for (const e of errs) console.error(`::error::ratchet lint: ${e}`);
  if (!errs.length) console.log(`ratchet lint: ${RATCHET_PATH} 통과`);
  return errs.length ? 1 : 0;
}

export function main(argv, env = process.env, root = ROOT) {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === 'check' && rest.length === 1) return cmdCheck(root, rest[0]);
    if (cmd === 'write' && rest.length === 2 && rest[0] === '--from') return cmdWrite(root, resolve(rest[1]), null);
    if (cmd === 'write' && rest.length === 2 && rest[0] === '--from-run') return cmdWrite(root, null, rest[1]);
    if (cmd === 'log-check' && rest.length === 0) return cmdLogCheck(root, env.RATCHET_BASE);
    if (cmd === 'lint' && rest.length === 0) return cmdLint(root);
  } catch (e) {
    console.error(`ratchet: ${e.message}`);
    return 2;
  }
  console.error('사용법: ratchet.mjs check <coverage|tests|size|mutants|design> | write --from <폴더> | write --from-run <id> | log-check | lint');
  return 2;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
