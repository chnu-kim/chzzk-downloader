#!/usr/bin/env node
// 훅·워크플로·도구 버전이 한 진입점을 따르는지 본다(docs/design/cicd.md §2 `parity`).
//
//   node scripts/ci/parity.mjs [--root <dir>]
//
// 규칙
//   run-entry   워크플로의 모든 `run:` 명령 줄은 `node scripts/ci/run.mjs <gate|하위 명령>`이거나 setup 허용 목록이다.
//               (raw cargo·pnpm·public-scan을 부르면 훅과 CI의 결과가 갈릴 수 있다)
//   gate-known  run.mjs에 넘긴 이름이 gates.mjs의 gate이거나 하위 명령이다.
//   tool-pin    `tool:` 입력의 도구@버전이 scripts/ci/tools.json과 같다.
//   ci-ok       작업 id `ci-ok`는 ci.yml에만, 정확히 한 번 있다.
//   hook-entry  .githooks/의 훅은 run.mjs 또는 public-scan.mjs만 exec한다.
// 위반이 있으면 1, 없으면 0.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { COMMANDS, GATES } from './gates.mjs';

const ROOT_DEFAULT = join(fileURLToPath(import.meta.url), '..', '..', '..');

// setup 단계 허용 목록(검증이 아니라 환경 준비). 여기에 검증 명령을 더하지 않는다.
export const SETUP_ALLOW = [
  /^git config --global core\.autocrlf false$/,
  /^rustup toolchain install$/,
  /^sudo apt-get update$/,
  /^sudo apt-get install -y --no-install-recommends [a-z0-9.+\- ]+$/,
];
const ENTRY = /^node scripts\/ci\/run\.mjs ([a-z0-9-]+)(?: .*)?$/;

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

export function checkParity(root) {
  const out = [];
  const add = (file, line, rule, msg) => out.push({ file, line, rule, msg });
  const tools = JSON.parse(readFileSync(join(root, 'scripts/ci/tools.json'), 'utf8')).tools;
  const wfDir = join(root, '.github', 'workflows');
  const files = existsSync(wfDir) ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
  const ciOkIn = [];
  for (const f of files) {
    const rel = `.github/workflows/${f}`;
    const text = readFileSync(join(wfDir, f), 'utf8');
    for (const { line, cmd } of runCommands(text)) {
      const m = ENTRY.exec(cmd);
      if (m) {
        if (!Object.hasOwn(GATES, m[1]) && !COMMANDS.includes(m[1])) add(rel, line, 'gate-known', `모르는 gate: ${m[1]}`);
      } else if (!SETUP_ALLOW.some((re) => re.test(cmd))) {
        add(rel, line, 'run-entry', `run.mjs를 거치지 않는 명령: ${cmd}`);
      }
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

  const hookDir = join(root, '.githooks');
  if (existsSync(hookDir)) {
    for (const h of readdirSync(hookDir).sort()) {
      const lines = readFileSync(join(hookDir, h), 'utf8').split(/\r?\n/);
      lines.forEach((l, i) => {
        const t = l.trim();
        if (t === '' || t.startsWith('#') || /^set -[eu]+$/.test(t)) return;
        if (!/^exec node "\$\(git rev-parse --show-toplevel\)\/scripts\/ci\/(run|public-scan)\.mjs"( .*)?$/.test(t)) {
          add(`.githooks/${h}`, i + 1, 'hook-entry', `훅은 scripts/ci 진입점만 exec한다: ${t}`);
        }
      });
    }
  }
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
