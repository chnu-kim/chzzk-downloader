#!/usr/bin/env node
// 릴리스 바이너리 검사(docs/design/cicd.md §2 `glibc-floor`, `release-hygiene`).
//
//   node scripts/ci/artifact-check.mjs glibc [--max 2.35] [--file <경로>]   # objdump -T의 GLIBC_x.y 최댓값 ≤ max(Linux)
//   node scripts/ci/artifact-check.mjs hygiene [--file <경로>]               # 바이너리에 E2E 표식 없음 + cargo tree에 e2e feature 없음
//                                                                           # + app/dist에 디자인 갤러리 없음(gallery.html·갤러리 표식)
//   node scripts/ci/artifact-check.mjs hygiene-seed [--file <경로>]          # 거꾸로: --features e2e 빌드(기본 <target>/debug)에는
//                                                                           # 표식이 있고 cargo tree --features e2e에 e2e가 보여야 한다.
//                                                                           # hygiene 검사가 e2e 빌드를 실제로 알아보는지(씨앗) 증명한다
//
// 기본 파일은 <target>/release/chzzk-app[.exe]. 종료 코드: 통과 0, 위반 1, 사용법·도구 오류 2.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';
import { spawnTool } from './run.mjs';
import { osKey, targetDir } from './smoke.mjs';

export const GLIBC_MAX = '2.35'; // ubuntu 22.04(컨테이너 빌드)의 glibc
// E2E 빌드(G4 cargo feature `e2e`)만 읽는 환경 변수 접두사. 릴리스 바이너리에 이 글자가 있으면 e2e 코드가 들어간 것이다.
// 이 파일 자체가 걸리지 않게 조각을 잇는다.
export const E2E_MARK = 'CHZZK_' + 'E2E_';

// 디자인 갤러리(app/src/gallery, CHZZK_GALLERY=1 빌드 전용)의 표식. app/src/gallery/main.ts GALLERY_MARK와 같은 글자다.
// 바이너리는 자산을 압축해 넣으므로 바이너리가 아니라 그 바이너리에 들어간 dist(app/dist)를 본다. 이 파일 자체가 걸리지 않게 잇는다.
export const GALLERY_MARK = 'chzzk-' + 'design-gallery';
export const APP_DIST = 'app/dist';

/** dist 폴더에서 갤러리 흔적(이름에 gallery가 든 파일, 내용에 GALLERY_MARK가 든 파일)을 찾는다. 상대 경로 목록 */
export function galleryTraces(dist) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else if (/gallery/i.test(e.name) || readFileSync(p).includes(GALLERY_MARK)) out.push(r);
    }
  };
  walk(dist, '');
  return out;
}

const cmpVer = (a, b) => {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

// objdump -T 출력 → 가장 높은 GLIBC_ 버전(없으면 null)
export function maxGlibc(text) {
  let max = null;
  for (const m of text.matchAll(/\bGLIBC_(\d+(?:\.\d+)+)\b/g)) if (max === null || cmpVer(m[1], max) > 0) max = m[1];
  return max;
}

export const glibcOk = (found, limit) => found !== null && cmpVer(found, limit) <= 0;

// cargo tree -e features 출력에서 이 워크스페이스 crate의 e2e feature 줄(서드파티의 같은 이름 feature는 무관하다)
export function e2eFeatureLines(text) {
  return text.split('\n').filter((l) => /\bchzzk-(?:app|core|shell) feature "e2e"/.test(l));
}

const defaultBin = (profile = 'release') => join(targetDir(), profile, `chzzk-app${osKey() === 'windows' ? '.exe' : ''}`);

function cmdGlibc(file, max) {
  if (!existsSync(file)) {
    console.error(`glibc: ${file}가 없다`);
    return 2;
  }
  const r = spawnSync('objdump', ['-T', file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error || r.status !== 0) {
    console.error(`glibc: objdump -T 실패: ${r.error?.message ?? r.stderr}`);
    return 2;
  }
  const found = maxGlibc(r.stdout);
  console.log(`glibc: ${file} 최대 GLIBC_${found ?? '(없음)'} (한도 ${max})`);
  if (!glibcOk(found, max)) {
    console.error(`::error::glibc-floor: GLIBC_${found ?? '?'} > ${max} — 더 새 glibc에서만 실행된다(빌드 컨테이너를 확인한다)`);
    return 1;
  }
  return 0;
}

const hasMark = (file) => readFileSync(file).includes(Buffer.from(E2E_MARK));

// chzzk-app의 feature 트리. 정방향 트리는 의존성(chzzk-core·shell)의 feature만 보이고 루트 crate 자신의 feature는 보이지
// 않는다(hygiene-seed가 찾아낸 구멍): `-i chzzk-app`(역방향)이 루트에 켜진 feature(default가 켜는 것 포함)를 보인다. 둘을 잇는다.
function cargoTreeFeatures(extra) {
  let out = '';
  for (const shape of [['-p', 'chzzk-app'], ['-i', 'chzzk-app']]) {
    const r = spawnTool('cargo', ['tree', '-e', 'features', ...shape, '--locked', '--target', 'all', ...extra], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
    if (r.error || r.status !== 0) throw new Error(`cargo tree ${shape.join(' ')} 실패: ${r.error?.message ?? r.status}`);
    out += r.stdout;
  }
  return out;
}

// 씨앗: e2e 빌드에는 두 검사가 모두 걸려야 한다. 하나라도 걸리지 않으면 hygiene이 e2e 코드를 놓친다는 뜻이다(1).
function cmdHygieneSeed(file) {
  if (!existsSync(file)) {
    console.error(`hygiene-seed: ${file}가 없다(--features e2e로 먼저 빌드한다)`);
    return 2;
  }
  let bad = 0;
  if (hasMark(file)) console.log(`hygiene-seed: e2e 빌드 ${file}에 ${E2E_MARK} 있음(hygiene가 잡는다)`);
  else {
    console.error(`::error::hygiene-seed: e2e 빌드 ${file}에 ${E2E_MARK}가 없다 — hygiene의 바이트 검사가 e2e 코드를 알아보지 못한다(E2E_MARK와 app/src-tauri/src/e2e.rs를 맞춘다)`);
    bad++;
  }
  let tree;
  try {
    tree = cargoTreeFeatures(['--features', 'e2e']);
  } catch (e) {
    console.error(`hygiene-seed: ${e.message}`);
    return 2;
  }
  if (e2eFeatureLines(tree).length) console.log('hygiene-seed: cargo tree --features e2e에 e2e 있음(hygiene가 잡는다)');
  else {
    console.error('::error::hygiene-seed: cargo tree --features e2e에서 e2e feature 줄을 찾지 못했다 — e2eFeatureLines가 낡았다');
    bad++;
  }
  return bad ? 1 : 0;
}

function cmdHygiene(file, dist = join(ROOT, APP_DIST)) {
  if (!existsSync(file)) {
    console.error(`hygiene: ${file}가 없다`);
    return 2;
  }
  if (!existsSync(dist)) {
    console.error(`hygiene: ${dist}가 없다(릴리스 빌드가 dist를 먼저 만든다)`);
    return 2;
  }
  let bad = 0;
  const traces = galleryTraces(dist);
  if (traces.length) {
    console.error(`::error::release-hygiene: 릴리스 dist에 디자인 갤러리가 들어갔다(CHZZK_GALLERY 빌드): ${traces.join(', ')}`);
    bad++;
  } else console.log(`hygiene: ${dist}에 갤러리 없음`);
  if (hasMark(file)) {
    console.error(`::error::release-hygiene: ${file}에 ${E2E_MARK} 글자가 있다(e2e 코드가 릴리스에 들어갔다)`);
    bad++;
  } else console.log(`hygiene: ${file}에 ${E2E_MARK} 없음`);
  let tree;
  try {
    tree = cargoTreeFeatures([]);
  } catch (e) {
    console.error(`hygiene: ${e.message}`);
    return 2;
  }
  const lines = e2eFeatureLines(tree);
  if (lines.length) {
    console.error(`::error::release-hygiene: 기본 feature 트리에 e2e가 켜져 있다:\n${lines.join('\n')}`);
    bad++;
  } else console.log('hygiene: cargo tree -e features(-p·-i chzzk-app)에 e2e 없음');
  return bad ? 1 : 0;
}

export function main(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--file', '--max'].includes(rest[i]) || rest[i + 1] === undefined) {
      opts.bad = true;
      break;
    }
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  if (!opts.bad && cmd === 'glibc') return cmdGlibc(resolve(opts.file ?? defaultBin()), opts.max ?? GLIBC_MAX);
  if (!opts.bad && cmd === 'hygiene' && opts.max === undefined) return cmdHygiene(resolve(opts.file ?? defaultBin()));
  if (!opts.bad && cmd === 'hygiene-seed' && opts.max === undefined) return cmdHygieneSeed(resolve(opts.file ?? defaultBin('debug')));
  console.error('사용법: artifact-check.mjs glibc [--max x.y] [--file <경로>] | hygiene [--file <경로>] | hygiene-seed [--file <경로>]');
  return 2;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
