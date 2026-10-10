#!/usr/bin/env node
// Worker 생성 모듈 넷의 생성기·검사기(docs/design/system/web.md §9·governance.md §12 (e), 계약 §2.2). 의존성 0.
//   icons     app/src/lib/components/ui/icons.ts → worker/src/http/icons.generated.ts (Worker가 쓰는 여섯 개만)
//   assets    worker/assets/{icon.svg,favicon.ico,apple-touch-icon.png,og.png} → worker/src/http/assets.generated.ts (base64 + 해시)
//   licenses  licenses/lucide.txt → worker/src/http/licenses.generated.ts
//   help      help/*.md(+ help/ids.json) → worker/src/http/help.generated.ts
// 사용: node scripts/design/worker-gen.mjs --write|--check [icons assets licenses help …] [--root <dir>]   (대상이 없으면 전부)
//   --write  생성물을 다시 쓴다. help는 help/ids.json에 새 id를 덧붙인다(지우지 않는다: 추가만).
//   --check  원천에서 다시 만든 결과와 저장된 생성물이 바이트로 같은지 본다. 다시 래스터하지 않는다(PNG·ICO 바이트를 옮길 뿐).
//            assets는 헤더를 읽어 크기도 본다: og 1200×630, apple-touch 180×180, ico는 16·32 층 둘. help는 ids.json 규칙도 본다.
// 위반이 있으면 한 줄씩 stderr에 쓰고 1, 쓰기·원천 오류도 1, 사용법 오류는 2다.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseIcons } from './icons.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TARGETS = ['icons', 'assets', 'licenses', 'help'];

/** Worker가 쓰는 아이콘(foundations §9.1 은유: 정보·휴대폰 안내·완료·오류·경고·접힘). icon.ts의 WorkerIconName이 이 키다 */
export const WORKER_ICONS = ['info', 'monitor', 'circle-check', 'circle-x', 'triangle-alert', 'chevron-right'];

/** 체크인 에셋. 순서가 생성물의 키 순서다 */
export const ASSET_FILES = [
  { name: 'icon.svg', type: 'image/svg+xml' },
  { name: 'favicon.ico', type: 'image/x-icon' },
  { name: 'apple-touch-icon.png', type: 'image/png' },
  { name: 'og.png', type: 'image/png' },
];

export const PATHS = {
  appIcons: 'app/src/lib/components/ui/icons.ts',
  assetsDir: 'worker/assets',
  license: 'licenses/lucide.txt',
  helpDir: 'help',
  ids: 'help/ids.json',
  out: {
    icons: 'worker/src/http/icons.generated.ts',
    assets: 'worker/src/http/assets.generated.ts',
    licenses: 'worker/src/http/licenses.generated.ts',
    help: 'worker/src/http/help.generated.ts',
  },
};

const ID_RE = /^[a-z0-9-]+$/;
const HEADER = (target, source) => `// 생성물(node scripts/design/worker-gen.mjs --write ${target}). 손으로 고치지 않는다. 원천: ${source}\n`;

/** 원천 오류. 메시지가 그대로 출력된다 */
export class GenError extends Error {}

const norm = (s) => s.replace(/\r\n/g, '\n');

function readText(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) throw new GenError(`${rel}: 파일이 없다`);
  return norm(readFileSync(p, 'utf8'));
}

// ───────────────────────── icons ─────────────────────────

const q = (s) => `'${s}'`;

export function buildIcons(root) {
  const parsed = parseIcons(readText(root, PATHS.appIcons));
  if (parsed === null) throw new GenError(`${PATHS.appIcons}: ICONS 객체를 찾지 못했다`);
  const byName = new Map(parsed.map((x) => [x.name, x]));
  const entries = WORKER_ICONS.map((name) => {
    const ic = byName.get(name);
    if (!ic) throw new GenError(`${PATHS.appIcons}: Worker 아이콘 ${name}이(가) 없다`);
    const m = ic.meta;
    if (!m || m.set === undefined || m.name === undefined || m.version === undefined) throw new GenError(`${PATHS.appIcons}: ${name}의 메타(set·name·version)가 없다`);
    for (const p of ic.paths) if (p.includes("'") || p.includes('\\') || p.includes('\n')) throw new GenError(`${PATHS.appIcons}: ${name}의 path에 옮길 수 없는 글자가 있다`);
    const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : q(name);
    return `  ${key}: { set: ${q(m.set)}, name: ${q(m.name)}, version: ${q(m.version)}, paths: [\n${ic.paths.map((p) => `    ${q(p)},\n`).join('')}  ] },\n`;
  });
  return { file: PATHS.out.icons, text: `${HEADER('icons', PATHS.appIcons)}export const ICONS = {\n${entries.join('')}} as const;\n` };
}

// ───────────────────────── assets ─────────────────────────

/** 에셋 바이트. svg는 줄끝을 LF로 맞춘다(autocrlf 체크아웃에서도 해시가 같다). PNG·ICO는 그대로 */
function assetBytes(root, name) {
  const rel = `${PATHS.assetsDir}/${name}`;
  const p = join(root, rel);
  if (!existsSync(p)) throw new GenError(`${rel}: 파일이 없다(worker/scripts/render-assets.mjs로 만들어 체크인한다)`);
  const raw = readFileSync(p);
  return name.endsWith('.svg') ? Buffer.from(norm(raw.toString('utf8')), 'utf8') : raw;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG 머리의 { width, height }. PNG가 아니면 null */
export function pngSize(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG) || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** ICO 머리의 층 목록 [{ width, height, png }]. ICO가 아니면 null */
export function icoLayers(buf) {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const n = buf.readUInt16LE(4);
  if (n < 1 || buf.length < 6 + n * 16) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 16;
    const size = buf.readUInt32LE(o + 8);
    const off = buf.readUInt32LE(o + 12);
    if (off + size > buf.length) return null;
    const png = pngSize(buf.subarray(off, off + size));
    out.push({ width: buf[o] === 0 ? 256 : buf[o], height: buf[o + 1] === 0 ? 256 : buf[o + 1], png });
  }
  return out;
}

/** 에셋 크기 규칙 → 위반 메시지 배열 */
export function assetSizeErrors(bytesOf) {
  const errs = [];
  const want = (name, w, h) => {
    const s = pngSize(bytesOf(name));
    if (s === null) errs.push(`${PATHS.assetsDir}/${name}: PNG가 아니다`);
    else if (s.width !== w || s.height !== h) errs.push(`${PATHS.assetsDir}/${name}: 크기 ${s.width}×${s.height} ≠ ${w}×${h}`);
  };
  want('og.png', 1200, 630);
  want('apple-touch-icon.png', 180, 180);
  const layers = icoLayers(bytesOf('favicon.ico'));
  if (layers === null) errs.push(`${PATHS.assetsDir}/favicon.ico: ICO가 아니다`);
  else {
    for (const s of [16, 32]) {
      const l = layers.find((x) => x.width === s && x.height === s);
      if (!l) errs.push(`${PATHS.assetsDir}/favicon.ico: ${s}×${s} 층이 없다`);
      else if (l.png === null || l.png.width !== s || l.png.height !== s) errs.push(`${PATHS.assetsDir}/favicon.ico: ${s}×${s} 층이 그 크기의 PNG가 아니다`);
    }
  }
  return errs;
}

export function buildAssets(root) {
  const lines = ASSET_FILES.map(({ name, type }) => {
    const bytes = assetBytes(root, name);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    return `  ${JSON.stringify(name)}: { type: ${JSON.stringify(type)}, hash: ${JSON.stringify(hash)}, b64: ${JSON.stringify(bytes.toString('base64'))} },\n`;
  });
  return { file: PATHS.out.assets, text: `${HEADER('assets', `${PATHS.assetsDir}/`)}export const ASSETS = {\n${lines.join('')}} as const;\n` };
}

// ───────────────────────── licenses ─────────────────────────

/** 생성 모듈 문자열에 들어가면 안 되는 것(worker-config의 모양 검사와 같은 목록) */
const MODULE_BANNED = [
  [/`/, '백틱'],
  [/\$\{/, '${'],
  [/<script/i, '<script'],
  [/<style/i, '<style'],
  [/data:/i, 'data:'],
];

function bannedIn(text) {
  return MODULE_BANNED.filter(([re]) => re.test(text)).map(([, n]) => n);
}

export function buildLicenses(root) {
  const text = readText(root, PATHS.license);
  const bad = [...bannedIn(text), ...(text.includes('<') ? ['<'] : [])];
  if (bad.length) throw new GenError(`${PATHS.license}: 생성 모듈에 옮길 수 없는 글자가 있다: ${bad.join(', ')}`);
  return { file: PATHS.out.licenses, text: `${HEADER('licenses', PATHS.license)}export const LICENSES = [{ name: "Lucide", text: ${JSON.stringify(text)} }] as const;\n` };
}

// ───────────────────────── help ─────────────────────────

/**
 * help/<id>.md 한 장 → { title, blocks }. 부분집합: 첫 줄 `# 제목`, 빈 줄로 나뉜 문단, `1. ` 목록(번호가 1부터 이어진다), 펜스 코드(```만).
 * 그 밖(둘째 제목·글머리·인용·표·인라인 코드·강조·링크·`<`)은 GenError다.
 */
export function parseHelp(src, where = 'help') {
  const fail = (line, msg) => {
    throw new GenError(`${where}:${line}: ${msg}`);
  };
  if (src.includes('\r')) fail(1, '줄끝은 LF만');
  if (!src.endsWith('\n')) fail(1, '파일이 줄바꿈으로 끝나지 않는다');
  const lines = src.slice(0, -1).split('\n');
  const head = /^# (\S.*)$/.exec(lines[0]);
  if (!head) fail(1, '첫 줄은 `# 제목`이어야 한다');
  const title = head[1];
  if (lines[1] !== '') fail(2, '제목 다음 줄은 빈 줄이다');
  const inline = (text, line) => {
    if (/[<`]/.test(text)) fail(line, '인라인 코드·`<`는 부분집합 밖이다');
    if (/\*\*|__|\]\(|!\[/.test(text)) fail(line, '강조·링크·이미지는 부분집합 밖이다');
    if (/\s$/.test(text)) fail(line, '줄 끝 공백');
    return text;
  };
  inline(title, 1);
  const blocks = [];
  let i = 2;
  while (i < lines.length) {
    const l = lines[i];
    const no = i + 1;
    if (l === '') {
      i++;
      continue;
    }
    if (l === '```') {
      const body = [];
      let j = i + 1;
      while (j < lines.length && lines[j] !== '```') {
        if (/[<`]/.test(lines[j])) fail(j + 1, '코드 안의 `<`·백틱은 부분집합 밖이다');
        body.push(lines[j]);
        j++;
      }
      if (j >= lines.length) fail(no, '닫는 ```가 없다');
      if (body.length === 0) fail(no, '빈 코드 블록');
      blocks.push({ t: 'pre', text: body.join('\n') });
      i = j + 1;
      continue;
    }
    if (/^\d+\. /.test(l)) {
      const items = [];
      let j = i;
      while (j < lines.length && lines[j] !== '') {
        const m = /^(\d+)\. (\S.*)$/.exec(lines[j]);
        if (!m) fail(j + 1, '목록 안에는 `N. 항목` 줄만 둘 수 있다');
        if (Number(m[1]) !== items.length + 1) fail(j + 1, `목록 번호는 1부터 차례로 이어져야 한다(${items.length + 1}번 자리에 ${m[1]})`);
        items.push(inline(m[2], j + 1));
        j++;
      }
      blocks.push({ t: 'ol', items });
      i = j;
      continue;
    }
    if (/^(#|>|\||[-*+] |---|===|\s)/.test(l) || l.startsWith('```')) fail(no, `부분집합 밖의 줄이다: ${l.slice(0, 20)}`);
    const para = [];
    let j = i;
    while (j < lines.length && lines[j] !== '') {
      if (/^(#|>|\||[-*+] |\d+\. |```|\s)/.test(lines[j])) fail(j + 1, `문단 안에 부분집합 밖의 줄이 섞였다: ${lines[j].slice(0, 20)}`);
      para.push(inline(lines[j], j + 1));
      j++;
    }
    blocks.push({ t: 'p', text: para.join(' ') });
    i = j;
  }
  if (blocks.length === 0) fail(1, '본문이 없다');
  return { title, blocks };
}

const S = JSON.stringify;

function helpSource(root) {
  const dir = join(root, PATHS.helpDir);
  if (!existsSync(dir)) throw new GenError(`${PATHS.helpDir}/: 폴더가 없다`);
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => n.slice(0, -3));
}

/** help/ids.json 읽기 → { ids, retired } 또는 null(없음). 모양이 틀리면 GenError */
function readIds(root) {
  const p = join(root, PATHS.ids);
  if (!existsSync(p)) return null;
  let j;
  try {
    j = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new GenError(`${PATHS.ids}: JSON 해석 실패: ${e.message}`);
  }
  const strs = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (j === null || typeof j !== 'object' || !strs(j.ids) || !strs(j.retired) || Object.keys(j).length !== 2) {
    throw new GenError(`${PATHS.ids}: { "ids": string[], "retired": string[] } 모양이 아니다`);
  }
  return { ids: j.ids, retired: j.retired };
}

/** help-check (나)(다): id 규칙 → 위반 메시지 배열 */
export function idsErrors(ids, mdIds) {
  const errs = [];
  const f = PATHS.ids;
  const seen = new Set();
  for (const id of ids.ids) {
    if (!ID_RE.test(id)) errs.push(`${f}: id ${S(id)}가 ^[a-z0-9-]+$가 아니다`);
    if (seen.has(id)) errs.push(`${f}: id ${id}가 두 번 있다`);
    seen.add(id);
  }
  for (const id of ids.retired) if (!seen.has(id)) errs.push(`${f}: retired의 ${id}가 ids에 없다(은퇴해도 ids에는 남긴다: 추가만)`);
  for (const id of mdIds) {
    if (!ID_RE.test(id)) errs.push(`${PATHS.helpDir}/${id}.md: 파일 이름(id)이 ^[a-z0-9-]+$가 아니다`);
    if (!seen.has(id)) errs.push(`${PATHS.helpDir}/${id}.md: ${f}의 ids에 없다(id는 한 번 정하면 바꾸지 않는다. --write가 덧붙인다)`);
  }
  for (const id of ids.ids) if (!mdIds.includes(id) && !ids.retired.includes(id)) errs.push(`${f}: ${id}의 ${PATHS.helpDir}/${id}.md가 없고 retired에도 없다`);
  return errs;
}

export function buildHelp(root, { ids = readIds(root), mdIds = helpSource(root) } = {}) {
  if (ids === null) throw new GenError(`${PATHS.ids}: 파일이 없다(--write help가 만든다)`);
  const errs = idsErrors(ids, mdIds);
  if (errs.length) throw new GenError(errs.join('\n'));
  const sections = ids.ids
    .filter((id) => mdIds.includes(id))
    .map((id) => ({ id, ...parseHelp(readText(root, `${PATHS.helpDir}/${id}.md`), `${PATHS.helpDir}/${id}.md`) }));
  for (const s of sections) {
    const bad = bannedIn(JSON.stringify(s));
    if (bad.length) throw new GenError(`${PATHS.helpDir}/${s.id}.md: 생성 모듈에 옮길 수 없는 글자가 있다: ${bad.join(', ')}`);
  }
  const block = (b) => {
    if (b.t === 'ol') return `    { t: "ol", items: [${b.items.map(S).join(', ')}] },\n`;
    return `    { t: ${S(b.t)}, text: ${S(b.text)} },\n`;
  };
  const body = sections.map((s) => `  { id: ${S(s.id)}, title: ${S(s.title)}, blocks: [\n${s.blocks.map(block).join('')}  ] },\n`).join('');
  return { file: PATHS.out.help, text: `${HEADER('help', `${PATHS.helpDir}/*.md`)}export const HELP = [\n${body}] as const;\n` };
}

// ───────────────────────── 진입 ─────────────────────────

const BUILDERS = { icons: buildIcons, assets: buildAssets, licenses: buildLicenses, help: buildHelp };

/** ids.json에 없는 md id를 ids 끝에 덧붙인다(이미 있는 것은 건드리지 않는다). 없으면 새로 만든다 */
function syncIds(root) {
  const mdIds = helpSource(root);
  const cur = readIds(root) ?? { ids: [], retired: [] };
  const add = mdIds.filter((id) => !cur.ids.includes(id));
  const next = { ids: [...cur.ids, ...add], retired: cur.retired };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  const p = join(root, PATHS.ids);
  if (!existsSync(p) || readFileSync(p, 'utf8') !== text) writeFileSync(p, text);
}

/** 대상들을 다시 만들어 저장된 생성물과 비교한다 → 위반 메시지 배열 */
export function check(root, targets = TARGETS) {
  const errs = [];
  for (const t of targets) {
    let built;
    try {
      built = BUILDERS[t](root);
      if (t === 'assets') {
        errs.push(...assetSizeErrors((name) => assetBytes(root, name)));
      }
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
      errs.push(...e.message.split('\n'));
      continue;
    }
    const p = join(root, built.file);
    if (!existsSync(p)) errs.push(`${built.file}: 없다(node scripts/design/worker-gen.mjs --write ${t})`);
    else if (readFileSync(p, 'utf8') !== built.text) errs.push(`${built.file}: 원천과 다르다(손으로 고쳤거나 원천이 바뀌었다. node scripts/design/worker-gen.mjs --write ${t})`);
  }
  return errs;
}

/** 생성물을 쓴다 → 쓴 파일 배열. 원천 오류는 GenError */
export function write(root, targets = TARGETS) {
  const out = [];
  for (const t of targets) {
    if (t === 'help') syncIds(root);
    const built = BUILDERS[t](root);
    if (t === 'assets') {
      const errs = assetSizeErrors((name) => assetBytes(root, name));
      if (errs.length) throw new GenError(errs.join('\n'));
    }
    const p = join(root, built.file);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, built.text);
    out.push(built.file);
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  let root = ROOT;
  let mode = null;
  const targets = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write' || a === '--check') {
      if (mode !== null) return usage();
      mode = a.slice(2);
    } else if (a === '--root' && argv[i + 1]) root = resolve(argv[++i]);
    else if (TARGETS.includes(a)) targets.push(a);
    else return usage();
  }
  if (mode === null) return usage();
  const want = targets.length ? targets : TARGETS;
  try {
    if (mode === 'write') {
      for (const f of write(root, want)) console.log(`worker-gen: ${f}`);
      return 0;
    }
    const errs = check(root, want);
    for (const e of errs) console.error(e);
    if (errs.length === 0) console.log(`worker-gen --check ${want.join(' ')}: 위반 없음`);
    return errs.length ? 1 : 0;
  } catch (e) {
    if (!(e instanceof GenError)) throw e;
    for (const l of e.message.split('\n')) console.error(l);
    return 1;
  }
}

function usage() {
  console.error('사용법: worker-gen.mjs --write|--check [icons assets licenses help …] [--root <dir>]');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
