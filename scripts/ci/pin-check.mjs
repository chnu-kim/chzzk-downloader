#!/usr/bin/env node
// 워크플로 공급망 규칙(docs/design/cicd.md §7). 네트워크 없이 줄 단위로 본다.
//
//   node scripts/ci/pin-check.mjs [--root <dir>]
//
// .github/workflows/*.yml 마다:
//   pin          모든 원격 `uses:`가 owner/repo[/path]@<40자리 hex> # <버전 주석>
//   permissions  최상위 `permissions: {}`
//   credentials  actions/checkout 단계마다 `persist-credentials: false`
//   timeout      모든 작업에 `timeout-minutes`
//   trigger      pull_request_target·workflow_run 트리거 없음
//   image        `container:`·`image:`의 이미지는 글자 그대로 `<이름>@sha256:<64 hex>`(태그만 쓰거나 식으로 고르지 않는다)
// 위반이 있으면 1, 없으면 0, 사용법 오류 2.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DEFAULT = join(fileURLToPath(import.meta.url), '..', '..', '..');

const indentOf = (l) => /^ */.exec(l)[0].length;
const stripComment = (l) => l.replace(/\s+#.*$/, '');

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[0-9a-f]{40}\s+#\s*\S+/;

// 워크플로 본문 → [{rule, line, msg}]
export function checkWorkflow(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const add = (rule, i, msg) => out.push({ rule, line: i + 1, msg });

  // pin
  lines.forEach((l, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*(.+?)\s*$/.exec(l);
    if (!m) return;
    const v = m[1].replace(/^["']|["']$/g, '');
    if (v.startsWith('./') || v.startsWith('docker://')) {
      if (v.startsWith('docker://') && !/@sha256:[0-9a-f]{64}/.test(v)) add('pin', i, `digest 없는 docker 이미지: ${v}`);
      return;
    }
    if (!PINNED.test(m[1])) add('pin', i, `SHA로 고정하지 않았거나 버전 주석이 없다: ${v}`);
  });

  // container·services 이미지 digest
  lines.forEach((l, i) => {
    const m = /^\s*(?:-\s+)?(container|image):\s*(.*?)\s*$/.exec(stripComment(l));
    if (!m || m[2] === '') return; // `container:` 다음 줄의 image:가 따로 걸린다
    const v = m[2].replace(/^["']|["']$/g, '');
    if (!/^[a-z0-9][a-z0-9._\/-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/.test(v)) add('image', i, `digest로 고정하지 않은 이미지: ${v}`);
  });

  // permissions: {}
  if (!lines.some((l) => /^permissions:\s*\{\s*\}\s*(#.*)?$/.test(l))) add('permissions', 0, '최상위 permissions: {}가 없다');

  // trigger
  lines.forEach((l, i) => {
    if (/^\s*(pull_request_target|workflow_run)\s*:/.test(stripComment(l)) || /^on:\s*\[?.*\b(pull_request_target|workflow_run)\b/.test(l)) {
      add('trigger', i, 'pull_request_target·workflow_run은 쓰지 않는다');
    }
  });

  // checkout의 persist-credentials: false
  lines.forEach((l, i) => {
    const m = /^(\s*)(-\s+)?uses:\s*actions\/checkout@/.exec(l);
    if (!m) return;
    // 단계 범위: 이 단계의 첫 줄(`- `) 들여쓰기보다 깊은 줄들
    let start = i;
    while (start > 0 && !/^\s*-\s/.test(lines[start])) start--;
    const stepIndent = indentOf(lines[start]);
    let found = false;
    for (let j = start + 1; j < lines.length; j++) {
      const t = lines[j];
      if (t.trim() === '' || /^\s*#/.test(t)) continue;
      if (indentOf(t) <= stepIndent) break;
      if (/^\s*persist-credentials:\s*false\s*(#.*)?$/.test(t)) found = true;
    }
    if (!found) add('credentials', i, 'actions/checkout에 persist-credentials: false가 없다');
  });

  // timeout-minutes: jobs: 아래 두 칸 들여쓴 작업마다
  const jobsAt = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsAt >= 0) {
    let cur = null;
    const flush = () => {
      if (cur && !cur.timeout) add('timeout', cur.line, `작업 ${cur.id}에 timeout-minutes가 없다`);
    };
    for (let j = jobsAt + 1; j < lines.length; j++) {
      const t = lines[j];
      if (/^\S/.test(t) && t.trim() !== '') break;
      const job = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(t);
      if (job) {
        flush();
        cur = { id: job[1], line: j, timeout: false };
      } else if (cur && /^ {4}timeout-minutes:\s*\S/.test(t)) cur.timeout = true;
    }
    flush();
  }
  return out;
}

export function checkRoot(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    for (const v of checkWorkflow(readFileSync(join(dir, f), 'utf8'))) out.push({ file: `.github/workflows/${f}`, ...v });
  }
  return out;
}

export function main(argv) {
  let root = ROOT_DEFAULT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && i + 1 < argv.length) root = resolve(argv[++i]);
    else {
      console.error('사용법: pin-check.mjs [--root <dir>]');
      return 2;
    }
  }
  const found = checkRoot(root);
  for (const v of found) console.error(`${v.file}:${v.line}: [${v.rule}] ${v.msg}`);
  if (found.length === 0) console.log('pin-check: 위반 없음');
  return found.length ? 1 : 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
