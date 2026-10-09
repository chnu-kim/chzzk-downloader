#!/usr/bin/env node
// 훅·워크플로·도구 버전이 한 진입점을 따르는지 본다(docs/design/cicd.md §2 `parity`).
//
//   node scripts/ci/parity.mjs [--root <dir>]
//
// 규칙
//   run-entry   워크플로의 모든 `run:` 명령 줄은 `node scripts/ci/run.mjs <gate|하위 명령> [인자]`이거나 setup 허용 목록이다.
//               인자는 셸 메타문자 없는 토큰뿐이다(`|| true`, `; exit 0`으로 gate를 무력화하지 못한다).
//               (raw cargo·pnpm·public-scan을 부르면 훅과 CI의 결과가 갈릴 수 있다)
//   gate-known  run.mjs에 넘긴 이름이 gates.mjs의 gate이거나 하위 명령이다.
//   soften      `continue-on-error`, `shell:`(run: 해석을 바꾼다)을 쓰지 않는다. run.mjs 단계의 `if:`는 없거나
//               `${{ !cancelled() }}`뿐이다(`if: false`로 gate를 끄지 못한다).
//   tool-pin    `tool:` 입력의 도구@버전이 scripts/ci/tools.json과 같고, taiki-e/install-action 단계는 `fallback: none`이다.
//   ci-ok       작업 id `ci-ok`는 ci.yml에만, 정확히 한 번 있다. ci-ok의 needs는 ci.yml의 다른 모든 작업이고
//               (CI_OK_EXEMPT 제외), `if: always()`이며, 식으로만 판정하는 guard 단계(CI_OK_GUARD)를 글자 그대로 갖는다.
//   job-if      ci.yml 작업 수준 `if:`는 ci-ok의 `always()`, areaIf(영역), MASTER_IF, report의 REPORT_IF뿐이고,
//               areaIf를 단 작업 = gates.mjs CODE_GATED_JOBS(+ OBSERVED_JOBS의 영역; 작업 → 영역이 맞아야 한다), MASTER_IF를 단 작업 =
//               MASTER_ONLY_JOBS(+ OBSERVED_JOBS의 'master')다.
//   changes-outputs  ci.yml changes 작업의 outputs는 gates.mjs AREAS 순서의 영역마다 하나뿐이다(죽은 출력·빠진 출력 금지).
//   observed    gates.mjs OBSERVED_JOBS(D14 관찰 중)는 ci.yml에 있고, ci-ok needs에 없고, ci-ok를 needs에 두지 않으며,
//               report의 needs에 있다(master 실패는 master-failure 이슈로 본다).
//   hook-entry  .githooks/의 파일 집합은 gates.mjs HOOKS와 같고, 각 훅은 `run.mjs hook <자기 이름> "$@"`만 exec한다.
//               LF 줄끝, #!/bin/sh, (git 저장소면) 인덱스 모드 100755.
//   hook-gate   훅이 부르는 gate ⊂ ci.yml의 gate ∪ HOOK_ONLY 짝(짝이 모두 ci.yml에 있어야 한다). CI가 최종 권위다.
//   job-name    작업 표시 이름(name:, 없으면 id)은 모든 워크플로를 통틀어 하나뿐이다(같은 이름의 체크가 둘이면 필수 체크·
//               stale 판정이 다른 작업에 만족된다).
//   schedule    `github.event.schedule == '<cron>'`(또는 !=)의 글자는 그 파일의 `- cron:` 중 하나다(cron을 고치면
//               조건이 영원히 거짓이 되어 작업이 조용히 꺼진다).
//   pr-paths    pull_request 트리거는 `paths:`를 쓰지 않고, `paths-ignore:`를 쓰면 run.mjs NON_CODE_GLOBS와 같다(코드 변경은
//               ci.yml의 changes와 같은 기준으로 모두 돈다: 의존 파일을 손으로 나열하면 빠진다).
//   mutants-scope  crates/의 .rs에 `mutants::skip`이 없고 `.cargo/mutants.toml`·`mutants.toml`이 없다. ratchet
//               mutants_missed는 살아남은 수만 보므로, mutant를 범위에서 빼면 수가 줄어 조용히 통과한다(리뷰 G5).
// 위반이 있으면 1, 없으면 0.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AREAS, CODE_GATED_JOBS, COMMANDS, GATES, HOOK_ONLY, HOOKS, MASTER_ONLY_JOBS, NON_CODE_GLOBS, OBSERVED_JOBS } from './gates.mjs';

const ROOT_DEFAULT = join(fileURLToPath(import.meta.url), '..', '..', '..');

// setup 단계 허용 목록(검증이 아니라 환경 준비). 여기에 검증 명령을 더하지 않는다.
export const SETUP_ALLOW = [
  /^git config --global core\.autocrlf false$/,
  /^rustup toolchain install$/,
  /^sudo apt-get update$/,
  /^sudo apt-get install -y --no-install-recommends [a-z0-9.+\- ]+$/,
  // ubuntu:22.04 컨테이너 작업(bundle-linux)은 root라 sudo가 없다
  /^apt-get update$/,
  /^apt-get install -y --no-install-recommends [a-z0-9.+\- ]+$/,
  // ci-ok guard: 실패만 할 수 있다
  /^exit 1$/,
];
export const ENTRY = /^node scripts\/ci\/run\.mjs ([a-z0-9-]+)(?: [A-Za-z0-9._@\/=:+,-]+)*$/;

// ci-ok 뒤에 도는, ci-ok의 needs에서 뺀 작업과 이유. 넣을 때는 cicd.md에 이유를 적는다(D14 관찰 작업은 gates.mjs OBSERVED_JOBS).
//   report: ci-ok의 결과를 읽어 이슈를 여닫는다(ci-ok 뒤에 돈다). 실패해도 커밋의 녹색 여부와 무관하다.
export const CI_OK_EXEMPT = ['report'];

// 작업 수준 if 허용 목록. 영역: CODE_GATED_JOBS(작업 → 영역), master: MASTER_ONLY_JOBS(app 영역), report: 고리 작업.
export const areaIf = (a) => `needs.changes.outputs.${a} == 'true'`;
export const MASTER_IF = `github.event_name != 'pull_request' && ${areaIf('app')}`;
export const REPORT_IF =
  "always() && ((github.event_name == 'push' && github.ref == 'refs/heads/master') || (github.event_name == 'workflow_dispatch' && inputs.loop_test))";

// ci-ok 첫 단계. 저장소 코드 없이 needs 결과만으로 판정한다(run.mjs ci-ok는 두 번째 판정).
//   push·dispatch: skipped가 하나라도 있으면 실패. pull_request: MASTER_ONLY_JOBS의 skipped는 허용,
//   CODE_GATED_JOBS의 skipped는 그 작업의 영역 출력이 'false'일 때만 허용(영역마다 절 하나). 그 밖의 작업은 skipped가 될 수 없다
//   (작업 if가 위 둘뿐이고 needs가 성공해야 돈다: 앞 작업 실패는 failure 검사가 잡는다).
export function ciOkGuard(gated = CODE_GATED_JOBS) {
  const clauses = AREAS.flatMap((a) => {
    const jobs = Object.keys(gated).filter((j) => gated[j] === a);
    return jobs.length ? [`|| (needs.changes.outputs.${a} != 'false'`, `&& (${jobs.map((j) => `needs.${j}.result == 'skipped'`).join(' || ')}))`] : [];
  });
  return [
    '- name: guard',
    'if: >-',
    "needs.changes.result != 'success' || needs.lint.result != 'success'",
    "|| needs.scripts-windows.result != 'success'",
    "|| contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')",
    "|| (github.event_name != 'pull_request' && contains(needs.*.result, 'skipped'))",
    ...clauses,
    'run: exit 1',
  ];
}
export const CI_OK_GUARD = ciOkGuard();

// 워크플로 본문 → run: 명령 줄 [{line, cmd}]. 블록 스칼라(| >)와 `\` 줄 잇기를 푼다.
export function runCommands(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const head = m[3].trim();
    const body = [];
    if (/^[|>][-+]?$/.test(head)) {
      // 블록은 `run:` 키 열보다 깊게 들여쓴 줄들이다
      const keyCol = m[1].length + (m[2]?.length ?? 0);
      for (let j = i + 1; j < lines.length; j++) {
        const t = lines[j];
        if (t.trim() !== '' && /^ */.exec(t)[0].length <= keyCol) break;
        body.push({ line: j + 1, text: t.trim() });
      }
    } else {
      body.push({ line: i + 1, text: head.replace(/^["']|["']$/g, '') });
    }
    // 줄 잇기와 빈 줄·주석 정리
    let acc = null;
    for (const b of body) {
      if (b.text === '' || b.text.startsWith('#')) continue;
      const piece = b.text.replace(/\s*\\$/, '');
      acc = acc ? { line: acc.line, cmd: `${acc.cmd} ${piece}` } : { line: b.line, cmd: piece };
      if (!/\\$/.test(b.text)) {
        out.push({ line: acc.line, cmd: acc.cmd.replace(/\s+/g, ' ') });
        acc = null;
      }
    }
    if (acc) out.push({ line: acc.line, cmd: acc.cmd.replace(/\s+/g, ' ') });
  }
  return out;
}

export function toolInputs(text) {
  const out = [];
  text.replace(/\r\n/g, '\n').split('\n').forEach((l, i) => {
    const m = /^\s*tool:\s*["']?([^"'#]+?)["']?\s*(#.*)?$/.exec(l);
    if (!m) return;
    for (const t of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const [name, version] = t.split('@');
      out.push({ line: i + 1, name, version: version ?? null });
    }
  });
  return out;
}

// 줄 i가 속한 단계(`- ` 항목)의 범위 [start, end)와 키 들여쓰기. 단계 밖이면 null.
function stepRange(lines, i) {
  let start = i;
  while (start >= 0 && !/^\s*-\s/.test(lines[start])) start--;
  if (start < 0) return null;
  const ind = /^ */.exec(lines[start])[0].length;
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^ */.exec(lines[end])[0].length > ind)) end++;
  return { start, end, keyIndent: ind + 2 };
}

// 단계 범위에서 키 들여쓰기에 있는 `key:`의 값(없으면 null)
function stepKey(lines, r, key) {
  const re = new RegExp(`^ {${r.keyIndent}}(?:- )?${key}:\\s*(.*?)\\s*$`);
  const first = new RegExp(`^ *- ${key}:\\s*(.*?)\\s*$`);
  for (let j = r.start; j < r.end; j++) {
    const m = (j === r.start ? first : re).exec(lines[j]);
    if (m) return { line: j, value: m[1] };
  }
  return null;
}

// 워크플로 본문 → { id: { line, name, needs: [..], if: string|null, body: [줄...] } } (jobs: 아래 두 칸 들여쓴 작업)
export function parseJobs(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const jobs = {};
  const at = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (at < 0) return jobs;
  let cur = null;
  for (let j = at + 1; j < lines.length; j++) {
    const t = lines[j];
    if (/^\S/.test(t)) break;
    const job = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(t);
    if (job) {
      cur = jobs[job[1]] = { line: j + 1, name: null, needs: [], if: null, body: [] };
      continue;
    }
    if (!cur) continue;
    cur.body.push(t);
    const needs = /^ {4}needs:\s*(.*?)\s*(#.*)?$/.exec(t);
    if (needs) {
      const v = needs[1];
      if (v.startsWith('[')) cur.needs = v.replace(/[[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean);
      else if (v) cur.needs = [v];
      else {
        for (let k = j + 1; k < lines.length && /^ {6,}- /.test(lines[k]); k++) cur.needs.push(lines[k].replace(/^\s*- /, '').trim());
      }
    }
    const name = /^ {4}name:\s*(.*?)\s*(#.*)?$/.exec(t);
    if (name) cur.name = name[1].replace(/^(["'])(.*)\1$/, '$2');
    const iff = /^ {4}if:\s*(.*?)\s*$/.exec(t);
    if (iff) cur.if = iff[1].replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  }
  return jobs;
}

function checkCiJobs(text, add) {
  const rel = '.github/workflows/ci.yml';
  const jobs = parseJobs(text);
  const ids = Object.keys(jobs);
  const ciOk = jobs['ci-ok'];
  if (!ciOk) return;
  const observed = Object.keys(OBSERVED_JOBS);
  const want = ids.filter((id) => id !== 'ci-ok' && !CI_OK_EXEMPT.includes(id) && !observed.includes(id)).sort();
  const have = [...ciOk.needs].sort();
  const missing = want.filter((id) => !have.includes(id));
  const extra = have.filter((id) => !want.includes(id));
  if (missing.length) add(rel, ciOk.line, 'ci-ok', `ci-ok needs에 없는 작업: ${missing.join(', ')}`);
  if (extra.length) add(rel, ciOk.line, 'ci-ok', `ci-ok needs에 있으면 안 되는 작업: ${extra.join(', ')}`);
  if (ciOk.if !== 'always()') add(rel, ciOk.line, 'ci-ok', `ci-ok는 if: always()여야 한다(지금: ${ciOk.if})`);
  const body = ciOk.body.map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  const g0 = body.indexOf(CI_OK_GUARD[0]);
  const firstStep = body.findIndex((l) => l.startsWith('- '));
  if (g0 < 0 || g0 !== firstStep || CI_OK_GUARD.some((l, k) => body[g0 + k] !== l)) {
    add(rel, ciOk.line, 'ci-ok', 'ci-ok의 첫 단계가 parity.mjs CI_OK_GUARD와 글자 그대로 같지 않다');
  }
  const ifArea = Object.fromEntries(AREAS.map((a) => [areaIf(a), a]));
  const gated = {};
  const masterOnly = [];
  for (const [id, j] of Object.entries(jobs)) {
    if (id === 'ci-ok' || j.if === null) continue;
    if (id === 'report' && j.if === REPORT_IF) continue;
    const area = ifArea[j.if];
    if (area) gated[id] = area;
    else if (j.if === MASTER_IF) masterOnly.push(id);
    else { add(rel, j.line, 'job-if', `작업 ${id}의 if는 ${AREAS.map((a) => `areaIf(${a})`).join('·')}·MASTER_IF(report는 REPORT_IF)만 허용한다(지금: ${j.if})`); continue; }
    if (!j.needs.includes('changes')) add(rel, j.line, 'job-if', `작업 ${id}는 needs에 changes가 있어야 한다(if가 changes 출력을 읽는다)`);
  }
  const same = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');
  const fmt = (m) => Object.keys(m).sort().map((k) => `${k}:${m[k]}`).join(', ');
  const wantGated = { ...CODE_GATED_JOBS, ...Object.fromEntries(observed.filter((id) => OBSERVED_JOBS[id] !== 'master').map((id) => [id, OBSERVED_JOBS[id]])) };
  const wantMaster = [...MASTER_ONLY_JOBS, ...observed.filter((id) => OBSERVED_JOBS[id] === 'master')];
  if (fmt(gated) !== fmt(wantGated)) add(rel, 0, 'job-if', `영역으로 건너뛰는 작업 [${fmt(gated)}] ≠ gates.mjs CODE_GATED_JOBS + OBSERVED_JOBS(영역) [${fmt(wantGated)}]`);
  if (!same(masterOnly, wantMaster)) add(rel, 0, 'job-if', `PR에서 건너뛰는 작업 [${masterOnly.sort()}] ≠ gates.mjs MASTER_ONLY_JOBS + OBSERVED_JOBS(master) [${wantMaster.sort()}]`);
  // changes 출력은 영역마다 하나, 그 밖은 없다(죽은 출력·빠진 출력 금지)
  const ch = jobs.changes?.body ?? [];
  const at = ch.findIndex((l) => /^ {4}outputs:\s*$/.test(l));
  const outs = [];
  for (let k = at + 1; at >= 0 && k < ch.length && /^ {6}\S/.test(ch[k]); k++) outs.push(ch[k].trim());
  const wantOuts = AREAS.map((a) => `${a}: \${{ steps.classify.outputs.${a} }}`);
  if (outs.join('\n') !== wantOuts.join('\n')) add(rel, jobs.changes?.line ?? 0, 'changes-outputs', `changes outputs는 gates.mjs AREAS 순서로 [${wantOuts.join(' | ')}]여야 한다(지금: [${outs.join(' | ')}])`);
  for (const id of observed) {
    if (!jobs[id]) {
      add(rel, 0, 'observed', `OBSERVED_JOBS의 ${id}가 ci.yml에 없다(편입했으면 gates.mjs에서 뺀다)`);
      continue;
    }
    if (jobs[id].needs.includes('ci-ok')) add(rel, jobs[id].line, 'observed', `관찰 작업 ${id}는 ci-ok 뒤에 돌지 않는다(needs에서 ci-ok를 뺀다)`);
    if (!jobs.report?.needs.includes(id)) add(rel, jobs[id].line, 'observed', `관찰 작업 ${id}가 report의 needs에 없다(master 실패가 이슈로 열리지 않는다)`);
  }
  for (const id of CI_OK_EXEMPT) {
    if (jobs[id] && !jobs[id].needs.includes('ci-ok')) add(rel, jobs[id].line, 'ci-ok', `ci-ok에서 뺀 작업 ${id}는 ci-ok 뒤에 돌아야 한다(needs: ci-ok)`);
  }
}

// continue-on-error·shell·run.mjs 단계의 if·taiki-e fallback
function checkSoften(rel, text, add) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((l, i) => {
    const t = l.replace(/\s+#.*$/, '');
    if (/^\s*(-\s+)?continue-on-error\s*:/.test(t)) add(rel, i + 1, 'soften', 'continue-on-error를 쓰지 않는다(실패가 성공으로 보고된다)');
    if (/^\s*(-\s+)?shell\s*:/.test(t)) add(rel, i + 1, 'soften', 'shell:을 쓰지 않는다(run: 해석이 바뀌어 run-entry 검사를 피한다)');
    if (/^\s*(-\s+)?uses:\s*taiki-e\/install-action@/.test(t)) {
      const r = stepRange(lines, i);
      const with_ = r && lines.slice(r.start, r.end).some((x) => /^\s*fallback:\s*none\s*(#.*)?$/.test(x));
      if (!with_) add(rel, i + 1, 'tool-pin', 'taiki-e/install-action에 fallback: none이 없다(manifest에 없는 버전을 다른 경로로 받는다)');
    }
  });
  for (const { line, cmd } of runCommands(text)) {
    if (!ENTRY.test(cmd)) continue;
    const r = stepRange(lines, line - 1);
    const iff = r && stepKey(lines, r, 'if');
    if (iff && iff.value !== '${{ !cancelled() }}') add(rel, iff.line + 1, 'soften', `run.mjs 단계의 if는 \${{ !cancelled() }}만 허용한다: ${iff.value}`);
  }
}

export const HOOK_LINE = /^exec node "\$\(git rev-parse --show-toplevel\)\/scripts\/ci\/run\.mjs" hook ([a-z-]+) "\$@"$/;

// .githooks/: 파일 집합 = HOOKS 키, 각 파일은 `run.mjs hook <자기 이름> "$@"`만 exec, LF 줄끝, (git 저장소면) 인덱스 모드 100755.
// 훅이 부르는 gate는 ci.yml에도 있거나(같은 gate) HOOK_ONLY의 짝이 ci.yml에 있어야 한다.
function checkHooks(root, add, ciGates) {
  const hookDir = join(root, '.githooks');
  if (!existsSync(hookDir)) {
    add('.githooks', 0, 'hook-entry', '.githooks/가 없다');
    return;
  }
  const files = readdirSync(hookDir).sort();
  for (const h of Object.keys(HOOKS)) if (!files.includes(h)) add(`.githooks/${h}`, 0, 'hook-entry', `훅 파일이 없다(gates.mjs HOOKS에 있음)`);
  for (const h of files) {
    const rel = `.githooks/${h}`;
    if (!Object.hasOwn(HOOKS, h)) add(rel, 0, 'hook-entry', `gates.mjs HOOKS에 없는 훅`);
    const raw = readFileSync(join(hookDir, h), 'utf8');
    if (raw.includes('\r')) add(rel, 0, 'hook-entry', 'CRLF 줄끝(sh가 잘못 읽는다)');
    const lines = raw.split(/\r?\n/);
    if (lines[0] !== '#!/bin/sh') add(rel, 1, 'hook-entry', '첫 줄은 #!/bin/sh여야 한다');
    let execs = 0;
    lines.forEach((l, i) => {
      const t = l.trim();
      if (t === '' || t.startsWith('#') || /^set -[eu]+$/.test(t)) return;
      const m = HOOK_LINE.exec(t);
      if (!m) add(rel, i + 1, 'hook-entry', `훅은 run.mjs hook <이름> "$@"만 exec한다: ${t}`);
      else if (m[1] !== h) add(rel, i + 1, 'hook-entry', `훅 이름(${m[1]})이 파일 이름(${h})과 다르다`);
      else execs++;
    });
    if (execs !== 1) add(rel, 0, 'hook-entry', `exec 줄이 ${execs}개다(1개여야 한다)`);
  }
  // git이 실행하려면 실행 비트가 있어야 한다. 인덱스의 모드를 본다(Windows 체크아웃도 같은 값)
  const ls = spawnSync('git', ['ls-files', '-s', '--', '.githooks'], { cwd: root, encoding: 'utf8' });
  if (ls.status === 0 && ls.stdout.trim() !== '') {
    for (const l of ls.stdout.split('\n').filter(Boolean)) {
      const [mode] = l.split(' ');
      const path = l.slice(l.indexOf('\t') + 1);
      if (mode !== '100755') add(path, 0, 'hook-entry', `인덱스 모드 ${mode}(100755여야 git이 실행한다: git update-index --chmod=+x)`);
    }
  }
  if (ciGates.size === 0) return; // ci.yml이 없는 사본
  for (const [h, spec] of Object.entries(HOOKS)) {
    for (const g of [...spec.always, ...spec.when.map((w) => w.gate)]) {
      if (!Object.hasOwn(GATES, g)) add(`scripts/ci/gates.mjs`, 0, 'hook-gate', `HOOKS.${h}의 모르는 gate: ${g}`);
      else if (ciGates.has(g)) continue;
      else if (!Object.hasOwn(HOOK_ONLY, g)) add('.github/workflows/ci.yml', 0, 'hook-gate', `훅 gate ${g}(${h})가 ci.yml에 없다(CI가 최종 권위다)`);
      else for (const c of HOOK_ONLY[g]) if (!ciGates.has(c)) add('.github/workflows/ci.yml', 0, 'hook-gate', `훅 전용 gate ${g}의 CI 짝 ${c}이 ci.yml에 없다`);
    }
  }
}

// on.schedule의 cron 문자열들
export function crons(text) {
  return [...text.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map((m) => m[1]);
}
// on.pull_request 아래 키(paths·paths-ignore) → 값 목록 | null(키 없음). pull_request가 없으면 null.
export function prFilters(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => /^ {2}pull_request:\s*(#.*)?$/.test(l));
  if (at < 0) return null;
  const out = {};
  let key = null;
  for (let j = at + 1; j < lines.length && (lines[j].trim() === '' || /^ {4}/.test(lines[j])); j++) {
    const k = /^ {4}([a-z-]+):\s*(.*?)\s*(#.*)?$/.exec(lines[j]);
    if (k) {
      key = k[1];
      out[key] = k[2] ? [k[2]] : [];
      continue;
    }
    const item = /^ {6}-\s*["']?(.*?)["']?\s*(#.*)?$/.exec(lines[j]);
    if (item && key) out[key].push(item[1]);
  }
  return out;
}

function checkWorkflowShape(rel, text, add) {
  const cs = crons(text);
  text.split(/\r?\n/).forEach((l, i) => {
    for (const m of l.matchAll(/github\.event\.schedule\s*[!=]=\s*'([^']*)'/g)) {
      if (!cs.includes(m[1])) add(rel, i + 1, 'schedule', `'${m[1]}'은 이 파일의 cron(${cs.map((c) => `'${c}'`).join(', ') || '없음'})이 아니다 — 조건이 늘 같아진다`);
    }
  });
  const pr = prFilters(text);
  if (!pr) return;
  if (pr.paths) add(rel, 0, 'pr-paths', 'pull_request에 paths:를 쓰지 않는다(의존 파일을 손으로 나열하면 빠진다). 코드가 아닌 경로는 paths-ignore로 뺀다');
  if (pr['paths-ignore'] && pr['paths-ignore'].join('\n') !== NON_CODE_GLOBS.join('\n')) {
    add(rel, 0, 'pr-paths', `pull_request paths-ignore [${pr['paths-ignore']}] ≠ gates.mjs NON_CODE_GLOBS [${NON_CODE_GLOBS}]`);
  }
}

// cargo-mutants 범위를 줄이는 것(살아남은 mutant를 숨긴다). 바꾸려면 이 규칙과 ratchet을 함께 고치는 PR로 한다.
export const MUTANTS_SKIP = /\bmutants\s*::\s*skip\b/;
export const MUTANTS_CONFIGS = ['.cargo/mutants.toml', 'mutants.toml'];
function rsFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'target') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...rsFiles(p));
    else if (e.isFile() && e.name.endsWith('.rs')) out.push(p);
  }
  return out;
}
function checkMutantsScope(root, add) {
  for (const f of MUTANTS_CONFIGS) if (existsSync(join(root, f))) add(f, 0, 'mutants-scope', `${f}가 있다: cargo-mutants 범위를 줄이면 ratchet mutants_missed가 살아남은 mutant를 놓친다`);
  for (const p of rsFiles(join(root, 'crates'))) {
    readFileSync(p, 'utf8')
      .split('\n')
      .forEach((l, i) => {
        if (MUTANTS_SKIP.test(l)) add(p.slice(root.length + 1).split('\\').join('/'), i + 1, 'mutants-scope', 'mutants::skip은 쓰지 않는다(살아남은 mutant를 숨긴다). 테스트로 잡는다');
      });
  }
}

export function checkParity(root) {
  const out = [];
  const add = (file, line, rule, msg) => out.push({ file, line, rule, msg });
  const tools = JSON.parse(readFileSync(join(root, 'scripts/ci/tools.json'), 'utf8')).tools;
  const wfDir = join(root, '.github', 'workflows');
  const files = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  const ciOkIn = [];
  const ciGates = new Set();
  const names = new Map();
  for (const f of files) {
    const rel = `.github/workflows/${f}`;
    const text = readFileSync(join(wfDir, f), 'utf8');
    for (const { line, cmd } of runCommands(text)) {
      const m = ENTRY.exec(cmd);
      if (m && f === 'ci.yml') ciGates.add(m[1]);
      if (m) {
        if (!Object.hasOwn(GATES, m[1]) && !COMMANDS.includes(m[1])) add(rel, line, 'gate-known', `모르는 gate: ${m[1]}`);
      } else if (!SETUP_ALLOW.some((re) => re.test(cmd))) {
        add(rel, line, 'run-entry', `run.mjs를 거치지 않는 명령: ${cmd}`);
      }
    }
    checkSoften(rel, text, add);
    checkWorkflowShape(rel, text, add);
    if (f === 'ci.yml') checkCiJobs(text, add);
    for (const [id, j] of Object.entries(parseJobs(text))) {
      const n = j.name ?? id;
      if (names.has(n)) add(rel, j.line, 'job-name', `작업 이름 '${n}'이 ${names.get(n)}에도 있다(체크 이름이 겹친다)`);
      else names.set(n, `${rel}:${j.line}`);
    }
    for (const t of toolInputs(text)) {
      const spec = tools[t.name];
      if (!spec) add(rel, t.line, 'tool-pin', `tools.json에 없는 도구: ${t.name}`);
      else if (t.version !== spec.version) add(rel, t.line, 'tool-pin', `${t.name}@${t.version} ≠ tools.json ${spec.version}`);
    }
    text.split(/\r?\n/).forEach((l, i) => {
      if (/^ {2}ci-ok:\s*(#.*)?$/.test(l)) ciOkIn.push({ rel, line: i + 1 });
    });
  }
  const inCi = ciOkIn.filter((c) => c.rel === '.github/workflows/ci.yml');
  for (const c of ciOkIn.filter((c) => c.rel !== '.github/workflows/ci.yml')) add(c.rel, c.line, 'ci-ok', 'ci-ok 작업은 ci.yml에만 둔다');
  if (files.includes('ci.yml') && inCi.length !== 1) add('.github/workflows/ci.yml', 0, 'ci-ok', `ci-ok 작업이 ${inCi.length}개다(1개여야 한다)`);

  checkHooks(root, add, ciGates);
  checkMutantsScope(root, add);
  return out;
}

export function main(argv) {
  let root = ROOT_DEFAULT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && i + 1 < argv.length) root = resolve(argv[++i]);
    else {
      console.error('사용법: parity.mjs [--root <dir>]');
      return 2;
    }
  }
  const found = checkParity(root);
  for (const v of found) console.error(`${v.file}:${v.line}: [${v.rule}] ${v.msg}`);
  if (found.length === 0) console.log('parity: 위반 없음');
  return found.length ? 1 : 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
