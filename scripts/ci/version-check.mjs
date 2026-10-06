#!/usr/bin/env node
// 버전 원천이 모두 같은지 본다(docs/design/cicd.md §2 `versions`).
//
//   node scripts/ci/version-check.mjs [--root <dir>] [--tag vX.Y.Z]
//
// 원천: `cargo metadata --no-deps`의 모든 워크스페이스 멤버, app/src-tauri/tauri.conf.json, app/package.json.
// --tag를 주면 태그(앞의 v를 뗀 값)도 같아야 한다. 같으면 0, 다르면 1, 읽기 실패·사용법 오류 2.

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DEFAULT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

// [{source, version}] → { ok, problems }
export function compareVersions(sources, tag) {
  const problems = [];
  const all = [...sources];
  if (tag !== undefined) {
    if (!/^v/.test(tag)) problems.push(`태그 ${JSON.stringify(tag)}가 v로 시작하지 않는다`);
    all.push({ source: `tag ${tag}`, version: tag.replace(/^v/, '') });
  }
  for (const s of all) {
    if (typeof s.version !== 'string' || !SEMVER.test(s.version)) {
      problems.push(`${s.source}: semver가 아니다 (${JSON.stringify(s.version)})`);
    }
  }
  const distinct = [...new Set(all.map((s) => s.version))];
  if (distinct.length > 1) problems.push(`버전이 다르다: ${all.map((s) => `${s.source}=${s.version}`).join(', ')}`);
  return { ok: problems.length === 0, problems };
}

export function readSources(root) {
  const r = spawnSync(
    'cargo',
    ['metadata', '--no-deps', '--format-version', '1', '--offline', '--manifest-path', join(root, 'Cargo.toml')],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  if (r.status !== 0) throw new Error(`cargo metadata 실패: ${r.error?.message ?? r.stderr}`);
  const meta = JSON.parse(r.stdout);
  const members = new Set(meta.workspace_members);
  const sources = meta.packages
    .filter((p) => members.has(p.id))
    .map((p) => ({ source: `crate ${p.name}`, version: p.version }))
    .sort((a, b) => (a.source < b.source ? -1 : 1));
  const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  sources.push({ source: 'app/src-tauri/tauri.conf.json', version: json('app/src-tauri/tauri.conf.json').version });
  sources.push({ source: 'app/package.json', version: json('app/package.json').version });
  return sources;
}

export function main(argv) {
  let root = ROOT_DEFAULT;
  let tag;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && i + 1 < argv.length) root = resolve(argv[++i]);
    else if (argv[i] === '--tag' && i + 1 < argv.length) tag = argv[++i];
    else {
      console.error('사용법: version-check.mjs [--root <dir>] [--tag vX.Y.Z]');
      return 2;
    }
  }
  let sources;
  try {
    sources = readSources(root);
  } catch (e) {
    console.error(`version-check: ${e.message}`);
    return 2;
  }
  const { ok, problems } = compareVersions(sources, tag);
  for (const s of sources) console.log(`${s.source.padEnd(34)}${s.version}`);
  if (tag !== undefined) console.log(`${'tag'.padEnd(34)}${tag}`);
  for (const p of problems) console.error(`version-check: ${p}`);
  return ok ? 0 : 1;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
