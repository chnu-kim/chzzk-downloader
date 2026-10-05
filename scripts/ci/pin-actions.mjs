#!/usr/bin/env node
// 워크플로의 `uses:`를 커밋 SHA로 고정한다(docs/design/cicd.md §7). 네트워크(gh api)를 쓰므로 gate가 아니라 사람이 돌린다.
//
//   node scripts/ci/pin-actions.mjs            # 확인만: 주석의 태그를 다시 해석해 SHA가 같은지 본다(다르면 1)
//   node scripts/ci/pin-actions.mjs --write    # `uses: o/r@<태그>`를 `uses: o/r@<sha> # <태그>`로 바꾼다
//
// annotated tag는 tag 객체를 한 번 더 벗겨 커밋 SHA를 쓴다. Dependabot이 올린 PR도 이 형식을 유지한다.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const cache = new Map();

function gh(path) {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh api ${path}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}

export function resolveTag(repo, tag) {
  const key = `${repo}@${tag}`;
  if (cache.has(key)) return cache.get(key);
  let obj = gh(`repos/${repo}/git/ref/tags/${tag}`).object;
  if (obj.type === 'tag') obj = gh(`repos/${repo}/git/tags/${obj.sha}`).object;
  if (obj.type !== 'commit') throw new Error(`${key}: 커밋이 아니다(${obj.type})`);
  cache.set(key, obj.sha);
  return obj.sha;
}

function main(argv) {
  const write = argv.includes('--write');
  const dir = join(ROOT, '.github', 'workflows');
  let bad = 0;
  for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const p = join(dir, f);
    const before = readFileSync(p, 'utf8');
    const after = before.replace(
      /^(\s*(?:-\s+)?uses:\s*)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)((?:\/[A-Za-z0-9_.\/-]+)?)@([^\s#]+)(?:\s+#\s*(\S+))?[^\n]*$/gm,
      (line, pre, repo, sub, ref, comment) => {
        const tag = /^[0-9a-f]{40}$/.test(ref) ? comment : ref;
        if (!tag) {
          console.error(`${f}: ${repo}@${ref}에 버전 주석이 없다`);
          bad++;
          return line;
        }
        const sha = resolveTag(repo, tag);
        if (/^[0-9a-f]{40}$/.test(ref) && ref !== sha) {
          console.error(`${f}: ${repo} ${tag} = ${sha}, 고정값 ${ref}`);
          bad++;
        }
        return `${pre}${repo}${sub}@${sha} # ${tag}`;
      },
    );
    if (write && after !== before) {
      writeFileSync(p, after);
      console.log(`고침: ${f}`);
    }
  }
  if (!bad) console.log('pin-actions: 모든 고정값이 태그와 같다');
  return bad && !write ? 1 : 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
