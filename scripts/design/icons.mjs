#!/usr/bin/env node
// design-icons gate의 정적 부분(docs/design/system/governance.md §2.5, DI1~DI7).
// 래스터(번짐) 측정은 design-gallery 안에서 돌고 여기에는 없다.
// 의존성 0. 위반 레코드는 계약 §1.3 모양 { rule, file, line, text, msg }.
//
// 단계 (a)에는 licenses/·worker/src/http/icons.generated.ts·ui/vocab.ts가 없다:
//   - licenses/lucide.txt 없음 → DI2 위반 하나(line 0)
//   - Worker 생성물 없음 → DI1의 Worker 비교를 건너뜀
//   - vocab.ts 없음 → DI7을 건너뜀(단계 (b)에서 켜진다)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runGate } from './allow.mjs';
import { deckEntries, exprEnd, matchClose, tokenize } from './copy.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FAMILIES = ['DI'];

export const PATHS = {
  icons: 'app/src/lib/components/ui/icons.ts',
  iconSvelte: 'app/src/lib/components/ui/Icon.svelte',
  vocab: 'app/src/lib/components/ui/vocab.ts',
  workerIcons: 'worker/src/http/icons.generated.ts',
  workerIcon: 'worker/src/http/icon.ts',
  license: 'licenses/lucide.txt',
  ko: 'app/src/lib/copy/ko.ts',
  workerCopy: 'worker/src/http/copy.ts',
};

/** 글꼴 아이콘 세트 이름(brief §2.7: 쓸 수 없다). DI6 */
const FONT_ICON_WORDS = /SF Symbols|MDL2|Segoe Fluent|Material Icons/;
/** 같은 아이콘을 두 동작에 써도 되는 유일한 예외(foundations §9.1) */
const DI4_EXEMPT = new Set(['copy']);
const ICON_SIZES = new Set(['sm', 'md']);

// ---------------------------------------------------------------------------
// 읽기 도구
// ---------------------------------------------------------------------------

function readText(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (['node_modules', 'bindings', 'test'].includes(name)) continue;
      walk(p, accept, out);
    } else if (accept(name)) out.push(p);
  }
  return out;
}

const posix = (root, p) => relative(root, p).split('\\').join('/');

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** DI4·DI5·DI6이 훑는 소스: 앱 .svelte·.ts·.css와 Worker http의 .ts(생성물·테스트 제외) */
function sourceFiles(root) {
  const app = walk(join(root, 'app/src'), (n) => /\.(?:svelte|ts|css)$/.test(n) && !/\.test\.ts$/.test(n) && !/\.generated\.ts$/.test(n));
  const worker = walk(join(root, 'worker/src/http'), (n) => /\.(?:ts|css)$/.test(n) && !/\.generated\.ts$/.test(n) && !/\.test\.ts$/.test(n));
  return [...app, ...worker]
    .map((p) => ({ rel: posix(root, p), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }))
    .filter((f) => !f.rel.startsWith('app/src/test/') && f.rel !== 'app/src/styles/tokens.css' && f.rel !== 'app/src/styles/ui.css');
}

// ---------------------------------------------------------------------------
// icons.ts 파서
// ---------------------------------------------------------------------------

/**
 * `ICONS = { 이름: { … } }` 객체에서 아이콘별 { name, line, meta, paths }를 뽑는다.
 * meta는 항목 안의 `set`·`name`·`version` 문자열 속성이다(`{ set: 'lucide', name, version }` 직접 또는 `meta: {…}` 안).
 * 메타 속성이 하나도 없으면 meta는 null. paths는 메타를 뺀 나머지 문자열이다.
 */
export function parseIcons(source) {
  const toks = tokenize(source);
  let open = -1;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t === 'id' && toks[i].v === 'ICONS') {
      let j = i + 1;
      while (j < toks.length && !(toks[j].t === 'p' && ['=', ';'].includes(toks[j].v))) j++;
      if (toks[j]?.v === '=' && toks[j + 1]?.v === '{') {
        open = j + 1;
        break;
      }
    }
  }
  if (open < 0) return null;
  const close = matchClose(toks, open);
  const icons = [];
  let i = open + 1;
  while (i < close) {
    const t = toks[i];
    if (t.t === 'p' && t.v === ',') {
      i++;
      continue;
    }
    if (!(t.t === 'id' || (t.t === 'str' && !t.tpl)) || toks[i + 1]?.v !== ':') {
      i++;
      continue;
    }
    const name = t.v;
    const line = t.line;
    let vs = i + 2;
    let ve;
    if (toks[vs]?.v === '{') ve = matchClose(toks, vs);
    else ve = exprEnd(toks, vs);
    const meta = {};
    const paths = [];
    for (let j = vs; j <= ve; j++) {
      const u = toks[j];
      if (u.t === 'id' && ['set', 'name', 'version'].includes(u.v) && toks[j + 1]?.v === ':' && toks[j + 2]?.t === 'str') {
        meta[u.v] = toks[j + 2].v;
        j += 2;
      } else if (u.t === 'str' && !u.key) paths.push(u.v);
    }
    icons.push({ name, line, meta: Object.keys(meta).length ? meta : null, paths });
    i = ve + 1;
  }
  return icons;
}

// ---------------------------------------------------------------------------
// 규칙
// ---------------------------------------------------------------------------

const PATH_STYLE = /fill="|stroke-width="|stroke="|#[0-9A-Fa-f]{3,8}\b|rgba?\(/;

function di3Paths(file, ic, v) {
  if (ic.paths.some((p) => PATH_STYLE.test(p))) {
    v.push({ rule: 'DI3', file, line: ic.line, text: ic.name, msg: `DI3 path에 fill·stroke-width·색 지정이 있다(CSS와 currentColor가 맡는다): ${ic.name}` });
  }
}

function di1(root, v) {
  const text = readText(root, PATHS.icons);
  if (text === null) {
    v.push({ rule: 'DI1', file: PATHS.icons, line: 0, text: 'icons.ts 없음', msg: 'DI1 아이콘 원천 icons.ts가 없다' });
    return { version: null };
  }
  const icons = parseIcons(text);
  if (icons === null) {
    v.push({ rule: 'DI1', file: PATHS.icons, line: 0, text: 'ICONS 없음', msg: 'DI1 icons.ts에서 ICONS 객체를 찾지 못했다' });
    return { version: null };
  }
  let version = null;
  for (const ic of icons) {
    const m = ic.meta;
    if (!m || m.set === undefined || m.name === undefined || m.version === undefined) {
      v.push({ rule: 'DI1', file: PATHS.icons, line: ic.line, text: ic.name, msg: `DI1 { set: 'lucide', name, version } 메타가 없다: ${ic.name}` });
      continue;
    }
    if (m.set !== 'lucide') v.push({ rule: 'DI1', file: PATHS.icons, line: ic.line, text: ic.name, msg: `DI1 set은 lucide 하나다: ${ic.name} (${m.set})` });
    if (version === null) version = m.version;
    else if (m.version !== version) {
      v.push({ rule: 'DI1', file: PATHS.icons, line: ic.line, text: ic.name, msg: `DI1 version이 다른 항목과 다르다: ${ic.name} (${m.version} ≠ ${version})` });
    }
  }
  for (const ic of icons) di3Paths(PATHS.icons, ic, v);
  // Worker 생성물은 같은 원천에서 나와 path가 같아야 한다(없으면 단계 (e) 전이라 건너뜀)
  const wtext = readText(root, PATHS.workerIcons);
  if (wtext !== null) {
    const w = parseIcons(wtext);
    if (w === null) {
      v.push({ rule: 'DI1', file: PATHS.workerIcons, line: 0, text: 'ICONS 없음', msg: 'DI1 icons.generated.ts에서 ICONS 객체를 찾지 못했다' });
    } else {
      const byName = new Map(w.map((x) => [x.name, x]));
      for (const ic of icons) {
        const o = byName.get(ic.name);
        if (!o) continue; // Worker는 쓰는 아이콘만 담는다
        if (JSON.stringify(o.paths) !== JSON.stringify(ic.paths)) {
          v.push({ rule: 'DI1', file: PATHS.workerIcons, line: o.line, text: ic.name, msg: `DI1 Worker path가 앱 icons.ts와 다르다: ${ic.name}` });
        }
        if (o.meta && ic.meta && (o.meta.set !== ic.meta.set || o.meta.version !== ic.meta.version)) {
          v.push({ rule: 'DI1', file: PATHS.workerIcons, line: o.line, text: ic.name, msg: `DI1 Worker 메타가 앱과 다르다: ${ic.name}` });
        }
      }
      for (const x of w) {
        if (!icons.some((ic) => ic.name === x.name)) {
          v.push({ rule: 'DI1', file: PATHS.workerIcons, line: x.line, text: x.name, msg: `DI1 Worker에만 있는 아이콘이다: ${x.name}` });
        }
      }
    }
    for (const x of parseIcons(wtext) ?? []) di3Paths(PATHS.workerIcons, x, v);
  }
  return { version };
}

function di2(root, v, version) {
  const text = readText(root, PATHS.license);
  if (text === null) {
    v.push({ rule: 'DI2', file: PATHS.license, line: 0, text: 'licenses/lucide.txt 없음', msg: 'DI2 고지 파일 licenses/lucide.txt가 없다' });
    return;
  }
  const miss = (what) => v.push({ rule: 'DI2', file: PATHS.license, line: 0, text: what, msg: `DI2 고지 파일에 ${what}이(가) 없다` });
  if (!/lucide/i.test(text)) miss('세트 이름(Lucide)');
  if (version !== null && !text.includes(version)) miss(`아이콘 버전(${version})`);
  if (!/ISC License|Permission to use, copy, modify, and\/or distribute/i.test(text)) miss('ISC 본문');
  if (!/Feather/.test(text) || !/MIT License|Permission is hereby granted, free of charge/i.test(text)) miss('Feather MIT 단락');
}

/** 한 `<path …>` 태그 안의 속성 검사. 정규화한 태그 글자를 text로 쓴다 */
function pathTagViolations(file, text, v) {
  for (const m of text.matchAll(/<path\b[^>]*>/g)) {
    const tag = m[0].replace(/\s+/g, ' ');
    const line = lineOf(text, m.index);
    if (!/vector-effect="non-scaling-stroke"/.test(tag)) {
      v.push({ rule: 'DI3', file, line, text: tag, msg: 'DI3 모든 path에 vector-effect="non-scaling-stroke"가 있어야 한다(화면 px 고정)' });
    }
    if (/\bfill=|\bstroke-width=|\bstroke=/.test(tag)) {
      v.push({ rule: 'DI3', file, line, text: tag, msg: 'DI3 path에 fill·stroke·stroke-width 속성을 쓰지 않는다(CSS가 맡는다)' });
    }
  }
}

function di3(root, v) {
  const svelte = readText(root, PATHS.iconSvelte);
  const wicon = readText(root, PATHS.workerIcon);
  for (const [file, text] of [
    [PATHS.iconSvelte, svelte],
    [PATHS.workerIcon, wicon],
  ]) {
    if (text === null) continue;
    pathTagViolations(file, text, v);
    // 굵기 속성 리터럴은 앱·Worker 모두 쓰지 않는다(.icon path { stroke-width: var(--icon-stroke) })
    for (const m of text.matchAll(/\bstroke-width=(?:"[^"]*"|'[^']*')/g)) {
      v.push({ rule: 'DI3', file, line: lineOf(text, m.index), text: m[0], msg: 'DI3 stroke-width 속성 리터럴을 쓰지 않는다(CSS --icon-stroke)' });
    }
    // 색은 currentColor만
    for (const m of text.matchAll(/\b(fill|stroke)=(?:"([^"]*)"|'([^']*)')/g)) {
      const val = m[2] ?? m[3];
      if (!['none', 'currentColor'].includes(val)) {
        v.push({ rule: 'DI3', file, line: lineOf(text, m.index), text: m[0], msg: `DI3 ${m[1]}는 none·currentColor만 쓴다` });
      }
    }
  }
}

/** 아이콘 사용처를 모은다: { icon, file, index, line, kind } */
function iconUsages(file) {
  const out = [];
  const { text } = file;
  const lit = String.raw`(?:"([^"]+)"|'([^']+)'|\{\s*"([^"]+)"\s*\}|\{\s*'([^']+)'\s*\})`;
  const add = (m, kind, extra = {}) => {
    const icon = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (icon) out.push({ icon, file: file.rel, index: m.index, line: lineOf(text, m.index), kind, ...extra });
  };
  for (const m of text.matchAll(new RegExp(String.raw`<Icon\b[^>]*?\bname=${lit}`, 'g'))) add(m, 'Icon');
  for (const m of text.matchAll(new RegExp(String.raw`<(IconButton|Button|MenuItem)\b[^>]*?\bicon=${lit}`, 'g'))) {
    const icon = m[2] ?? m[3] ?? m[4] ?? m[5];
    if (icon) out.push({ icon, file: file.rel, index: m.index, line: lineOf(text, m.index), kind: m[1] });
  }
  for (const m of text.matchAll(/\bicon\(\s*(?:"([^"]+)"|'([^']+)')/g)) add(m, 'call');
  for (const m of text.matchAll(/\bicon:\s*(?:"([^"]+)"|'([^']+)')/g)) add(m, 'prop');
  return out;
}

/** 아이콘이 놓인 동작의 이름(가장 가까운 Button의 copy 키·aria-label). 모르면 null */
function actionOf(file, usage) {
  const { text } = file;
  const opener = /<(Button|IconButton|button|a|MenuItem)\b/g;
  let start = -1;
  let name = '';
  for (const m of text.slice(0, usage.index + 1).matchAll(opener)) {
    start = m.index;
    name = m[1];
  }
  if (usage.kind === 'IconButton' || usage.kind === 'Button' || usage.kind === 'MenuItem') {
    // 아이콘이 그 태그의 속성이다: 태그 자체가 동작 범위
    start = usage.index;
    name = usage.kind;
  }
  let win;
  if (usage.kind === 'prop') {
    const open = text.lastIndexOf('{', usage.index);
    const close = text.indexOf('}', usage.index);
    win = open >= 0 && close > open ? text.slice(open, close) : '';
  } else if (start < 0) {
    return null;
  } else {
    const gt = text.indexOf('>', start);
    const selfClosing = gt > 0 && text[gt - 1] === '/';
    const end = selfClosing ? gt : text.indexOf(`</${name}>`, start);
    if (end < 0 || end < usage.index) return null;
    win = text.slice(start, end);
  }
  const t = /\bt\(\s*['"]([^'"]+)['"]/.exec(win);
  if (t) return t[1];
  const c = /\bCOPY\.([A-Za-z0-9_.]+)/.exec(win);
  if (c) return c[1];
  const a = /aria-label=(?:"([^"]+)"|'([^']+)')/.exec(win);
  if (a) return `aria-label:${a[1] ?? a[2]}`;
  return null;
}

function di4(root, files, v) {
  const koText = readText(root, PATHS.ko);
  const wText = readText(root, PATHS.workerCopy);
  // 키가 달라도 보이는 글자가 같으면 같은 동작이다(common.close = card.close = "닫기")
  const values = new Map();
  for (const text of [koText, wText]) {
    if (text === null) continue;
    for (const e of deckEntries(text)) if (!values.has(e.key)) values.set(e.key, e.value);
  }
  const byIcon = new Map();
  for (const f of files) {
    if (!/\.(?:svelte|ts)$/.test(f.rel)) continue;
    for (const u of iconUsages(f)) {
      const action = actionOf(f, u);
      if (action === null) continue;
      const label = values.get(action) ?? action;
      if (!byIcon.has(u.icon)) byIcon.set(u.icon, { first: u, actions: new Map() });
      const rec = byIcon.get(u.icon);
      if (!rec.actions.has(label)) rec.actions.set(label, `${u.file}:${u.line}`);
    }
  }
  for (const [icon, rec] of byIcon) {
    if (rec.actions.size > 1 && !DI4_EXEMPT.has(icon)) {
      const list = [...rec.actions].map(([k, where]) => `${k}(${where})`).join(' · ');
      v.push({ rule: 'DI4', file: rec.first.file, line: rec.first.line, text: icon, msg: `DI4 같은 아이콘이 서로 다른 동작에 쓰였다: ${icon} → ${list}` });
    }
  }
}

function di5(root, files, v) {
  const svelte = readText(root, PATHS.iconSvelte);
  if (svelte !== null) {
    // 리터럴 합집합 타입(`16 | 20 | 32`, `'sm' | 'md'`)만 본다. 별칭 타입은 건너뛴다
    const lit = String.raw`(?:'[\w-]+'|"[\w-]+"|\d+)`;
    const m = new RegExp(String.raw`\bsize\??:\s*(${lit}(?:\s*\|\s*${lit})*)`).exec(svelte);
    if (m) {
      const parts = m[1].split('|').map((x) => x.trim().replace(/^['"]|['"]$/g, ''));
      if (!parts.every((p) => ICON_SIZES.has(p)) || parts.length !== ICON_SIZES.size) {
        v.push({ rule: 'DI5', file: PATHS.iconSvelte, line: lineOf(svelte, m.index), text: `size?: ${m[1].trim()}`, msg: "DI5 Icon의 size 타입은 'sm' | 'md' 둘뿐이다(lg·숫자 금지)" });
      }
    }
  }
  for (const f of files) {
    if (!f.rel.endsWith('.svelte')) continue;
    for (const m of f.text.matchAll(/<Icon\b([^>]*)>/g)) {
      const sm = /\bsize=(?:"([^"]*)"|\{\s*([^}]*?)\s*\})/.exec(m[1]);
      if (!sm) continue;
      const raw = (sm[1] ?? sm[2]).trim().replace(/^['"]|['"]$/g, '');
      if (!ICON_SIZES.has(raw)) {
        v.push({ rule: 'DI5', file: f.rel, line: lineOf(f.text, m.index), text: `size=${raw}`, msg: `DI5 <Icon size>는 sm·md만 쓴다: ${raw}` });
      }
    }
  }
}

function di6(files, extra, v) {
  for (const f of [...files, ...extra]) {
    for (const m of f.text.matchAll(new RegExp(FONT_ICON_WORDS.source, 'g'))) {
      v.push({ rule: 'DI6', file: f.rel, line: lineOf(f.text, m.index), text: m[0], msg: `DI6 글꼴 아이콘 세트 이름을 소스에 쓰지 않는다: ${m[0]}` });
    }
  }
}

function di7(root, files, v) {
  const vocab = readText(root, PATHS.vocab);
  if (vocab === null) return; // 단계 (b)에서 켜진다
  const toks = tokenize(vocab);
  let allowed = null;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].t === 'id' && toks[i].v === 'ICON_BUTTON_ICONS') {
      let j = i + 1;
      while (j < toks.length && toks[j].v !== '[') j++;
      if (j < toks.length) allowed = toks.slice(j, matchClose(toks, j)).filter((t) => t.t === 'str').map((t) => t.v);
      break;
    }
  }
  if (allowed === null) {
    v.push({ rule: 'DI7', file: PATHS.vocab, line: 0, text: 'ICON_BUTTON_ICONS 없음', msg: 'DI7 vocab.ts에서 ICON_BUTTON_ICONS를 찾지 못했다' });
    return;
  }
  for (const f of files) {
    if (!f.rel.endsWith('.svelte')) continue;
    for (const m of f.text.matchAll(/<IconButton\b[^>]*?\bicon=(?:"([^"]+)"|'([^']+)'|\{\s*"([^"]+)"\s*\}|\{\s*'([^']+)'\s*\})/g)) {
      const icon = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!allowed.includes(icon)) {
        v.push({ rule: 'DI7', file: f.rel, line: lineOf(f.text, m.index), text: icon, msg: `DI7 IconButton icon은 ICON_BUTTON_ICONS만 쓴다: ${icon}` });
      }
    }
  }
}

/** design-icons 정적 검사. 위반 레코드 배열을 돌려준다 */
export function check(root = ROOT) {
  const v = [];
  const { version } = di1(root, v);
  di2(root, v, version);
  di3(root, v);
  const files = sourceFiles(root);
  di4(root, files, v);
  di5(root, files, v);
  // DI6은 아이콘 원천과 고지 파일도 훑는다
  const extra = [PATHS.icons, PATHS.license]
    .map((rel) => ({ rel, text: readText(root, rel) }))
    .filter((f) => f.text !== null && !files.some((x) => x.rel === f.rel));
  di6(files, extra, v);
  di7(root, files, v);
  const seen = new Set();
  const uniq = [];
  for (const x of v) {
    const k = `${x.rule}\0${x.file}\0${x.line}\0${x.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // 출력이 `RULE: 내용`이므로 메시지 머리의 규칙 번호는 뗀다
    uniq.push({ ...x, msg: x.msg.replace(/^D[CI]\d+ /, '') });
  }
  return uniq.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)));
}

export async function main(argv = process.argv.slice(2)) {
  return runGate({ gate: 'design-icons', families: FAMILIES, check, argv, root: ROOT });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
