#!/usr/bin/env node
// 번들 수집(docs/design/cicd.md §2 `bundle`, §5 collect). `tauri build --bundles …`가 만든 target/release/bundle/에서
// release/expected-artifacts.json의 이 OS 항목을 **정확히** 찾아 정식 이름으로 모으고 bundles.json을 쓴다.
//
//   node scripts/ci/bundle.mjs collect [--out <폴더>]   # 기본 target/ci/bundle
//   node scripts/ci/bundle.mjs bundles                  # 이 OS의 --bundles 값(gates.mjs가 읽는다)
//
// 정식 이름: chzzk-downloader_<버전>_<name>(productName이 한글이라 그대로는 R2 키·URL에 쓰기 나쁘다).
// 실패: 항목 파일이 0개·2개 이상, bundle/ 아래 모르는 폴더(다른 번들이 섞임), 러너 arch가 표와 다름.
// 종료 코드: 0, 기대와 다름 1, 사용법·입력 오류 2.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, workspaceVersion } from './gates.mjs';
import { bundleSpec, osKey, targetDir } from './smoke.mjs';

export const CANONICAL_PREFIX = 'chzzk-downloader';

// bundle 폴더의 목록 { dir: [파일 이름…] }과 표 → { ok, problems, picks: [{artifact, file}] }
export function pick(listing, spec) {
  const problems = [];
  const picks = [];
  const allowed = new Set([...spec.artifacts.map((a) => a.dir), ...spec.extraDirs]);
  for (const d of Object.keys(listing).sort()) if (!allowed.has(d)) problems.push(`모르는 번들 폴더 bundle/${d}(--bundles 밖의 번들이 만들어졌다)`);
  for (const a of spec.artifacts) {
    const files = (listing[a.dir] ?? []).filter((f) => f.endsWith(a.ext)).sort();
    if (files.length !== 1) problems.push(`bundle/${a.dir}/*${a.ext}: ${files.length}개(${files.join(', ') || '없음'}) — 정확히 하나여야 한다`);
    else picks.push({ artifact: a, file: files[0] });
  }
  return { ok: problems.length === 0, problems, picks };
}

const canonical = (version, a) => `${CANONICAL_PREFIX}_${version}_${a.name}`;

function listing(bundleDir) {
  const out = {};
  if (!existsSync(bundleDir)) return out;
  for (const e of readdirSync(bundleDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    out[e.name] = readdirSync(join(bundleDir, e.name), { withFileTypes: true })
      .filter((f) => f.isFile())
      .map((f) => f.name);
  }
  return out;
}

function cmdCollect(out) {
  const os = osKey();
  const spec = bundleSpec()[os];
  if (!spec) {
    console.error(`bundle collect: ${os}의 항목이 release/expected-artifacts.json에 없다`);
    return 2;
  }
  if (process.arch !== spec.arch) {
    console.error(`::error::bundle collect: 러너 arch ${process.arch} ≠ 표 ${spec.arch}(이름 ${spec.artifacts.map((a) => a.name).join(', ')})`);
    return 1;
  }
  const bundleDir = join(targetDir(), 'release', 'bundle');
  const { ok, problems, picks } = pick(listing(bundleDir), spec);
  for (const p of problems) console.error(`::error::bundle collect: ${p}`);
  if (!ok) return 1;
  const version = workspaceVersion();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const artifacts = [];
  for (const { artifact: a, file } of picks) {
    const name = canonical(version, a);
    const src = join(bundleDir, a.dir, file);
    copyFileSync(src, join(out, name));
    const buf = readFileSync(join(out, name));
    const sha256 = createHash('sha256').update(buf).digest('hex');
    artifacts.push({ kind: a.kind, file: name, bytes: statSync(join(out, name)).size, sha256, size: a.size, source: `${a.dir}/${file}` });
    console.log(`${a.kind.padEnd(9)}${name}  ${buf.length} bytes  sha256 ${sha256}`);
  }
  writeFileSync(join(out, 'bundles.json'), JSON.stringify({ os, version, artifacts }, null, 2) + '\n');
  return 0;
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'collect' && (rest.length === 0 || (rest.length === 2 && rest[0] === '--out'))) {
    return cmdCollect(resolve(rest[1] ?? join(ROOT, 'target/ci/bundle')));
  }
  if (cmd === 'bundles' && rest.length === 0) {
    console.log(bundleSpec()[osKey()]?.bundles.join(',') ?? '');
    return 0;
  }
  console.error('사용법: bundle.mjs collect [--out <폴더>] | bundle.mjs bundles');
  return 2;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
