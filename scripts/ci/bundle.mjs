#!/usr/bin/env node
// 번들 수집(docs/design/cicd.md §2 `bundle`, §5 collect). `tauri build --bundles …`가 만든 target/release/bundle/에서
// release/expected-artifacts.json의 이 OS 항목을 **정확히** 찾아 정식 이름으로 모으고 bundles.json을 쓴다.
//
//   node scripts/ci/bundle.mjs collect [--out <폴더>] [--release]   # 기본 target/ci/bundle
//   node scripts/ci/bundle.mjs bundles                  # 이 OS의 --bundles 값(gates.mjs가 읽는다)
//
// 정식 이름: chzzk-downloader_<버전>_<name>(productName이 한글이라 그대로는 R2 키·URL에 쓰기 나쁘다).
// 실패: 항목 파일이 0개·2개 이상, bundle/ 아래 모르는 폴더(다른 번들이 섞임), 러너 arch가 표와 다름.
// --release(릴리스 빌드, release/tauri.release.json의 createUpdaterArtifacts): 표의 release 전용 항목(.app.tar.gz)도 찾고,
// updater 항목마다 Tauri가 임시 키로 만든 <파일>.sig가 있어야 하며 그 밖의 .sig는 없어야 한다. 그 .sig는 out에 넣지
// 않고 RELEASE_TAURI_SIG_DIR(기본 target/ci/release-tauri-sig)에 정식 이름으로 둔다(xtask가 형식을 확인한 뒤 버린다).
// 종료 코드: 0, 기대와 다름 1, 사용법·입력 오류 2.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, workspaceVersion } from './gates.mjs';
import { bundleSpec, osKey, targetDir } from './smoke.mjs';

export const CANONICAL_PREFIX = 'chzzk-downloader';

// 이 모드에서 찾는 항목(release 전용 항목은 --release에서만)
export const modeArtifacts = (spec, release) => spec.artifacts.filter((a) => release || !a.release);

// bundle 폴더의 목록 { dir: [파일 이름…] }과 표 → { ok, problems, picks: [{artifact, file}] }
// release: updater 항목마다 <파일>.sig가 정확히 있고, 그 밖의 .sig는 없어야 한다(서명되지 않을 산출물에 서명이 생기면
// 표가 실제와 어긋난 것이다).
export function pick(listing, spec, { release = false } = {}) {
  const problems = [];
  const picks = [];
  const arts = modeArtifacts(spec, release);
  const allowed = new Set([...spec.artifacts.map((a) => a.dir), ...spec.extraDirs]);
  for (const d of Object.keys(listing).sort()) if (!allowed.has(d)) problems.push(`모르는 번들 폴더 bundle/${d}(--bundles 밖의 번들이 만들어졌다)`);
  for (const a of arts) {
    const files = (listing[a.dir] ?? []).filter((f) => f.endsWith(a.ext)).sort();
    if (files.length !== 1) problems.push(`bundle/${a.dir}/*${a.ext}: ${files.length}개(${files.join(', ') || '없음'}) — 정확히 하나여야 한다`);
    else picks.push({ artifact: a, file: files[0] });
  }
  if (release) {
    const want = new Set(picks.filter((p) => p.artifact.updater?.length).map((p) => `${p.artifact.dir}/${p.file}.sig`));
    for (const w of [...want].sort()) {
      const [d, f] = w.split('/');
      if (!(listing[d] ?? []).includes(f)) problems.push(`bundle/${w}가 없다(updater 산출물의 서명, createUpdaterArtifacts)`);
    }
    for (const d of Object.keys(listing).sort()) {
      for (const f of (listing[d] ?? []).filter((x) => x.endsWith('.sig')).sort()) {
        if (!want.has(`${d}/${f}`)) problems.push(`bundle/${d}/${f}: 표의 updater 산출물이 아닌데 서명이 있다(release/expected-artifacts.json updater)`);
      }
    }
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

function cmdCollect(out, release) {
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
  const { ok, problems, picks } = pick(listing(bundleDir), spec, { release });
  for (const p of problems) console.error(`::error::bundle collect: ${p}`);
  if (!ok) return 1;
  const version = workspaceVersion();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const sigDir = resolve(process.env.RELEASE_TAURI_SIG_DIR || join(ROOT, 'target/ci/release-tauri-sig'));
  if (release) {
    rmSync(sigDir, { recursive: true, force: true });
    mkdirSync(sigDir, { recursive: true });
  }
  const artifacts = [];
  for (const { artifact: a, file } of picks) {
    const name = canonical(version, a);
    const src = join(bundleDir, a.dir, file);
    copyFileSync(src, join(out, name));
    const buf = readFileSync(join(out, name));
    const sha256 = createHash('sha256').update(buf).digest('hex');
    artifacts.push({ kind: a.kind, file: name, bytes: statSync(join(out, name)).size, sha256, size: a.size ?? null, updater: a.updater ?? [], source: `${a.dir}/${file}` });
    if (release && a.updater?.length) copyFileSync(`${src}.sig`, join(sigDir, `${name}.sig`));
    console.log(`${a.kind.padEnd(9)}${name}  ${buf.length} bytes  sha256 ${sha256}`);
  }
  writeFileSync(join(out, 'bundles.json'), JSON.stringify({ os, version, release, artifacts }, null, 2) + '\n');
  return 0;
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'collect') {
    let out = join(ROOT, 'target/ci/bundle');
    let release = false;
    let ok = true;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--release') release = true;
      else if (rest[i] === '--out' && i + 1 < rest.length) out = rest[++i];
      else ok = false;
    }
    if (ok) return cmdCollect(resolve(out), release);
  }
  if (cmd === 'bundles' && rest.length === 0) {
    console.log(bundleSpec()[osKey()]?.bundles.join(',') ?? '');
    return 0;
  }
  console.error('사용법: bundle.mjs collect [--out <폴더>] [--release] | bundle.mjs bundles');
  return 2;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
