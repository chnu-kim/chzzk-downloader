#!/usr/bin/env node
// 릴리스 진입점(docs/design/cicd.md §5, 구현 중 변경 G6). release.yml·rollback.yml·훅은 run.mjs gate로 이 파일을 부른다.
//
//   node scripts/ci/release.mjs pubkey      # release/updater.pub == tauri.conf.json plugins.updater.pubkey(바이트 동일, 형식)
//
// 종료 코드: 0 통과, 1 검사 실패, 2 사용법·환경 오류.

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';

const log = (m) => console.log(`release: ${m}`);
const err = (m) => console.error(`::error::release: ${m}`);

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

export function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'pubkey' && rest.length === 0) return cmdPubkey();
  console.error('사용법: release.mjs pubkey');
  return 2;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = main(process.argv.slice(2));
  if (typeof r === 'number') process.exit(r);
  else r.then((c) => process.exit(c));
}
