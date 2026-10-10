// 디자인 토큰 생성기(governance.md 1.3, foundations.md 13).
//   원천  design/tokens/*.tokens.json(DTCG 2025.10 부분집합) + design/ui.css + worker/src/http/site.css
//   생성물 app/src/styles/tokens.css · app/src/styles/ui.css · worker/src/http/site-css.generated.ts
// 사용법
//   node scripts/design/tokens.mjs [--root dir]            생성물 셋을 쓴다
//   node scripts/design/tokens.mjs --check [--root dir]    쓰지 않고 DT1(생성물 = 원천에서 다시 만든 것, 바이트 비교)을 본다
// 종료 코드: 통과 0, 위반 1, 원천·입력 오류 2. 의존성 0(Node 표준 모듈만), 출력은 결정적이다.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { oklchToSrgb, toHex } from './contrast.mjs';

export const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
export const HEADER = '/* 생성물. 원천 design/tokens/·design/ui.css, 생성기 scripts/design/tokens.mjs. 손으로 고치지 않는다 */';
export const OUTPUTS = {
  tokens: 'app/src/styles/tokens.css',
  ui: 'app/src/styles/ui.css',
  worker: 'worker/src/http/site-css.generated.ts',
};
export const SECTIONS = ['root', 'dark-media', 'dark-theme', 'theme-scheme', 'window-inactive', 'reading', 'text-scale', 'contrast', 'coarse', 'reduce'];

const UI_SRC = 'design/ui.css';
const SITE_SRC = 'worker/src/http/site.css';
const EXT = 'io.github.chnu-kim.chzzk';
// 토큰 파일 순서(출력 순서의 기준, foundations 13). contrast는 토큰이 아니라 따로 읽는다.
const TOKEN_FILES = ['ref', 'sys', 'type', 'space', 'radius', 'size', 'layout', 'motion', 'layer'];
const BLOCKS = ['window-inactive', 'reading', 'reading-narrow', 'contrast', 'coarse', 'reduce'];
const TYPES = ['color', 'dimension', 'duration', 'cubicBezier', 'fontFamily', 'fontWeight', 'number', 'shadow'];
const GENERIC_FAMILIES = new Set(['system-ui', 'ui-monospace', 'sans-serif', 'serif', 'monospace']);
const ROLES = ['caption', 'body', 'title', 'display'];
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const aliasOf = (v) => (typeof v === 'string' ? /^\{([^{}]+)\}$/.exec(v)?.[1] ?? null : null);
const lf = (s) => s.replace(/\r\n/g, '\n');

// ---------- 모델 ----------

export function cssName(path) {
  const p = path.split('.');
  return p[0] === 'ref' ? `--ref-${p.slice(1).join('-')}` : `--${p[p.length - 1]}`;
}

function readJson(root, rel) {
  const full = join(root, rel);
  if (!existsSync(full)) throw new Error(`${rel}: 파일이 없다`);
  try {
    return JSON.parse(lf(readFileSync(full, 'utf8')));
  } catch (e) {
    throw new Error(`${rel}: JSON을 읽을 수 없다(${e.message})`);
  }
}

// 확장 키 검사. 반환은 안쪽 객체
function checkExt(ext, where, allowed) {
  if (!isObj(ext) || Object.keys(ext).length !== 1 || !(EXT in ext) || !isObj(ext[EXT])) {
    throw new Error(`${where}: $extensions는 "${EXT}" 키 하나만 쓸 수 있다`);
  }
  for (const k of Object.keys(ext[EXT])) if (!allowed.includes(k)) throw new Error(`${where}: 허용 밖 확장 키 ${k}`);
  return ext[EXT];
}

function checkNum(v, where) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${where}: 숫자가 아니다`);
}

function checkUnitValue(v, unit, where) {
  if (!isObj(v) || Object.keys(v).sort().join() !== 'unit,value') throw new Error(`${where}: {"value","unit"} 모양이 아니다`);
  checkNum(v.value, `${where}.value`);
  if (v.unit !== unit) throw new Error(`${where}: 단위는 ${unit}만 쓸 수 있다(${v.unit})`);
}

function checkColorObject(v, where) {
  if (!isObj(v)) throw new Error(`${where}: 색 객체가 아니다`);
  for (const k of Object.keys(v)) if (!['colorSpace', 'components', 'alpha', 'hex'].includes(k)) throw new Error(`${where}: 허용 밖 색 키 ${k}`);
  if (v.colorSpace !== 'oklch' && v.colorSpace !== 'srgb') throw new Error(`${where}: colorSpace는 oklch·srgb만 쓸 수 있다`);
  if (!Array.isArray(v.components) || v.components.length !== 3) throw new Error(`${where}: components는 숫자 셋이다`);
  v.components.forEach((c, i) => checkNum(c, `${where}.components[${i}]`));
  if (typeof v.hex !== 'string' || !/^#[0-9A-F]{6}$/.test(v.hex)) throw new Error(`${where}: hex는 #RRGGBB(대문자)여야 한다`);
  if (v.alpha !== undefined) {
    checkNum(v.alpha, `${where}.alpha`);
    if (v.alpha < 0 || v.alpha > 1) throw new Error(`${where}: alpha는 0..1이다`);
  }
  const rgb = v.colorSpace === 'oklch' ? oklchToSrgb(...v.components) : v.components;
  const want = toHex(rgb);
  const diff = [1, 3, 5].map((i) => Math.abs(Number.parseInt(want.slice(i, i + 2), 16) - Number.parseInt(v.hex.slice(i, i + 2), 16)));
  if (diff.some((d) => d > 1)) throw new Error(`${where}: hex ${v.hex}가 ${v.colorSpace} 변환값 ${want}와 1/255보다 어긋난다`);
}

// 값 모양 검사. 별칭 문자열은 여기서 통과시키고 대상은 나중에 본다
function checkValue(type, v, where) {
  if (aliasOf(v) !== null) return;
  if (typeof v === 'string') throw new Error(`${where}: 문자열은 {경로} 별칭만 쓸 수 있다`);
  switch (type) {
    case 'color':
      return checkColorObject(v, where);
    case 'dimension':
      return checkUnitValue(v, 'px', where);
    case 'duration':
      return checkUnitValue(v, 'ms', where);
    case 'cubicBezier':
      if (!Array.isArray(v) || v.length !== 4) throw new Error(`${where}: 숫자 넷의 배열이다`);
      v.forEach((n, i) => checkNum(n, `${where}[${i}]`));
      return;
    case 'fontFamily':
      if (!Array.isArray(v) || v.length === 0) throw new Error(`${where}: 글꼴 이름 배열이다`);
      for (const f of v) if (typeof f !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(f)) throw new Error(`${where}: 글꼴 이름이 안전하지 않다(${f})`);
      return;
    case 'fontWeight':
      if (!Number.isInteger(v) || v < 1 || v > 1000) throw new Error(`${where}: 1..1000 정수다`);
      return;
    case 'number':
      return checkNum(v, where);
    case 'shadow':
      if (!Array.isArray(v) || v.length === 0) throw new Error(`${where}: 그림자 층 배열이다`);
      v.forEach((layer, i) => {
        const w = `${where}[${i}]`;
        if (!isObj(layer)) throw new Error(`${w}: 층 객체가 아니다`);
        for (const k of Object.keys(layer)) if (!['color', 'offsetX', 'offsetY', 'blur', 'spread', 'inset'].includes(k)) throw new Error(`${w}: 허용 밖 키 ${k}`);
        for (const k of ['color', 'offsetX', 'offsetY', 'blur', 'spread']) if (!(k in layer)) throw new Error(`${w}: ${k}가 없다`);
        checkValue('color', layer.color, `${w}.color`);
        for (const k of ['offsetX', 'offsetY', 'blur', 'spread']) checkUnitValue(layer[k], 'px', `${w}.${k}`);
        if (layer.inset !== undefined && layer.inset !== true) throw new Error(`${w}: inset은 true만 쓴다`);
      });
      return;
    default:
      throw new Error(`${where}: 알 수 없는 $type ${type}`);
  }
}

// 이 값에 든 별칭 경로 전부(그림자 층의 색 포함)
function aliasesIn(type, v) {
  if (type === 'shadow') return v.map((l) => aliasOf(l.color)).filter((x) => x !== null).map((p) => [p, 'color']);
  const a = aliasOf(v);
  return a === null ? [] : [[a, type]];
}

export function loadModel(root) {
  const tokens = [];
  const byName = new Map();
  const byPath = new Map();
  let textScale = null;

  const addToken = (file, segs, node) => {
    const path = segs.join('.');
    const where = `design/tokens/${file}.tokens.json ${path}`;
    for (const k of Object.keys(node)) if (!['$type', '$value', '$description', '$extensions'].includes(k)) throw new Error(`${where}: 허용 밖 키 ${k}`);
    if (!TYPES.includes(node.$type)) throw new Error(`${where}: $type은 ${TYPES.join('·')} 중 하나다`);
    if (typeof node.$description !== 'string' || node.$description.trim() === '') throw new Error(`${where}: $description이 필요하다`);
    if (!('$value' in node)) throw new Error(`${where}: $value가 필요하다`);
    for (const s of segs) if (!SEGMENT.test(s)) throw new Error(`${where}: 이름 조각 ${s}가 규칙(소문자·숫자·하이픈)을 어긴다`);
    if (file === 'ref' && aliasOf(node.$value) !== null) throw new Error(`${where}: ref 토큰은 별칭이 될 수 없다`);
    checkValue(node.$type, node.$value, `${where} $value`);
    let dark;
    let overrides = {};
    let rootless = false;
    let noCss = false;
    if (node.$extensions !== undefined) {
      const e = checkExt(node.$extensions, where, ['dark', 'overrides', 'rootless', 'noCss']);
      if (file === 'ref' && (e.dark !== undefined || e.overrides !== undefined)) throw new Error(`${where}: ref 토큰에는 dark·overrides를 쓸 수 없다`);
      if (e.dark !== undefined) {
        checkValue(node.$type, e.dark, `${where} dark`);
        dark = e.dark;
      }
      if (e.overrides !== undefined) {
        if (!isObj(e.overrides)) throw new Error(`${where}: overrides는 객체다`);
        for (const [b, v] of Object.entries(e.overrides)) {
          if (!BLOCKS.includes(b)) throw new Error(`${where}: 알 수 없는 블록 ${b}(${BLOCKS.join('·')})`);
          checkValue(node.$type, v, `${where} overrides.${b}`);
        }
        overrides = e.overrides;
      }
      for (const k of ['rootless', 'noCss']) if (e[k] !== undefined && e[k] !== true) throw new Error(`${where}: ${k}는 true만 쓴다`);
      rootless = e.rootless === true;
      noCss = e.noCss === true;
      if (rootless && overrides.reading === undefined) throw new Error(`${where}: rootless 토큰은 overrides.reading이 있어야 한다`);
      if (noCss && Object.keys(overrides).length > 0) throw new Error(`${where}: noCss 토큰에는 overrides를 쓸 수 없다`);
    }
    const name = cssName(path);
    if (byName.has(name)) throw new Error(`${where}: CSS 이름 ${name}이 ${byName.get(name).path}와 겹친다`);
    const t = { name, path, file, type: node.$type, value: node.$value, description: node.$description, dark, overrides, rootless, noCss };
    tokens.push(t);
    byName.set(name, t);
    byPath.set(path, t);
  };

  const walk = (file, segs, node) => {
    for (const [k, child] of Object.entries(node)) {
      const here = [...segs, k];
      const where = `design/tokens/${file}.tokens.json ${here.join('.')}`;
      if (k.startsWith('$')) {
        if (k === '$extensions' && here.join('.') === `type.${k}`) {
          const e = checkExt(child, where, ['textScale']);
          if (!isObj(e.textScale) || Object.keys(e.textScale).sort().join() !== 'large,x-large') throw new Error(`${where}: textScale은 large·x-large 둘이다`);
          for (const s of ['large', 'x-large']) {
            checkNum(e.textScale[s], `${where}.textScale.${s}`);
            if (e.textScale[s] <= 1) throw new Error(`${where}: 배율은 1보다 커야 한다`);
          }
          textScale = { large: e.textScale.large, 'x-large': e.textScale['x-large'] };
          continue;
        }
        throw new Error(`${where}: 그룹에는 ${k}를 쓸 수 없다`);
      }
      if (!isObj(child)) throw new Error(`${where}: 객체가 아니다`);
      if ('$value' in child || '$type' in child) addToken(file, here, child);
      else walk(file, here, child);
    }
  };

  for (const file of TOKEN_FILES) {
    const json = readJson(root, `design/tokens/${file}.tokens.json`);
    if (!isObj(json) || Object.keys(json).length !== 1 || !(file in json)) throw new Error(`design/tokens/${file}.tokens.json: 최상위 키는 "${file}" 하나다`);
    walk(file, [file], json[file]);
  }
  if (textScale === null) throw new Error('design/tokens/type.tokens.json: type 그룹의 textScale($extensions)이 없다');

  // 별칭: 대상 존재·타입 일치·사슬 깊이 ≤ 2(sys → sys → ref)
  const depth = (path, seen = new Set()) => {
    if (seen.has(path)) throw new Error(`${path}: 별칭이 돌고 돈다`);
    const t = byPath.get(path);
    const a = typeof t.value === 'string' ? aliasOf(t.value) : null;
    return a === null ? 0 : 1 + depth(a, new Set([...seen, path]));
  };
  for (const t of tokens) {
    const slots = [['$value', t.value], ...(t.dark !== undefined ? [['dark', t.dark]] : []), ...Object.entries(t.overrides).map(([b, v]) => [`overrides.${b}`, v])];
    for (const [slot, v] of slots) {
      for (const [target, want] of aliasesIn(t.type, v)) {
        const where = `${t.path} ${slot}`;
        const tt = byPath.get(target);
        if (!tt) throw new Error(`${where}: 별칭 대상 {${target}}이 없다`);
        if (tt.type !== want) throw new Error(`${where}: 별칭 대상 {${target}}의 타입 ${tt.type}이 ${want}와 다르다`);
        if (tt.noCss) throw new Error(`${where}: noCss 토큰 {${target}}은 별칭 대상이 될 수 없다`);
        if (1 + depth(target) > 2) throw new Error(`${where}: 별칭 사슬이 깊이 2를 넘는다({${target}})`);
      }
    }
  }

  const bp = byPath.get('layout.breakpoint-narrow');
  if (!bp || bp.type !== 'number' || !bp.noCss) throw new Error('design/tokens/layout.tokens.json: layout.breakpoint-narrow(number, noCss)가 없다');

  // 대비 쌍
  const cj = readJson(root, 'design/tokens/contrast.tokens.json');
  if (!isObj(cj) || Object.keys(cj).sort().join() !== '$description,dark,light' || typeof cj.$description !== 'string') {
    throw new Error('design/tokens/contrast.tokens.json: $description·light·dark 셋만 쓴다');
  }
  const contrast = {};
  for (const theme of ['light', 'dark']) {
    if (!Array.isArray(cj[theme]) || cj[theme].length === 0) throw new Error(`design/tokens/contrast.tokens.json ${theme}: 쌍 배열이 비었다`);
    contrast[theme] = cj[theme].map((row, i) => {
      const where = `design/tokens/contrast.tokens.json ${theme}[${i}]`;
      if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'string' || typeof row[1] !== 'string') throw new Error(`${where}: [전경, 바탕, 최소] 모양이 아니다`);
      checkNum(row[2], `${where}[2]`);
      if (row[2] <= 0) throw new Error(`${where}: 최소 대비는 0보다 크다`);
      for (const n of [row[0], row[1]]) {
        const t = byName.get(`--${n}`);
        if (!t || t.file !== 'sys' || t.type !== 'color') throw new Error(`${where}: sys 색 토큰 ${n}이 없다`);
      }
      return { fg: `--${row[0]}`, bg: `--${row[1]}`, min: row[2] };
    });
  }

  return { tokens, byName, byPath, textScale, breakpointNarrow: bp.value, contrast };
}

// ---------- 값 → CSS ----------

const lengthCss = (d) => (d.value === 0 ? '0' : `${d.value}px`);

function colorCss(model, raw) {
  const a = aliasOf(raw);
  if (a !== null) return `var(${model.byPath.get(a).name})`;
  if (raw.alpha === undefined || raw.alpha === 1) return raw.hex;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(raw.hex.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${raw.alpha.toFixed(2)})`;
}

function fontName(f) {
  if (GENERIC_FAMILIES.has(f)) return f;
  return /[\s0-9]/.test(f) ? `'${f}'` : f;
}

export function cssValue(model, token, raw) {
  const a = aliasOf(raw);
  if (a !== null) return `var(${model.byPath.get(a).name})`;
  switch (token.type) {
    case 'color':
      return colorCss(model, raw);
    case 'dimension':
      return `${raw.value}px`;
    case 'duration':
      return `${raw.value}ms`;
    case 'cubicBezier':
      return `cubic-bezier(${raw.map(String).join(', ')})`;
    case 'fontFamily':
      return raw.map(fontName).join(', ');
    case 'fontWeight':
    case 'number':
      return String(raw);
    case 'shadow':
      return raw
        .map((l) => [l.inset ? 'inset' : null, lengthCss(l.offsetX), lengthCss(l.offsetY), lengthCss(l.blur), l.spread.value !== 0 ? lengthCss(l.spread) : null, colorCss(model, l.color)].filter((x) => x !== null).join(' '))
        .join(', ');
    default:
      throw new Error(`${token.path}: 알 수 없는 $type ${token.type}`);
  }
}

// 그 테마(와 블록)의 원 값
function pickValue(t, theme, block) {
  if (block && t.overrides[block] !== undefined) return t.overrides[block];
  if (theme === 'dark' && t.dark !== undefined) return t.dark;
  return t.value;
}

// 별칭을 ref까지 따라가 그 테마의 색을 낸다
export function resolveColor(model, name, theme, block) {
  const t = model.byName.get(name);
  if (!t || t.type !== 'color') throw new Error(`${name}: 색 토큰이 아니다`);
  let raw = pickValue(t, theme, block);
  for (let hops = 0; hops < 8; hops++) {
    const a = aliasOf(raw);
    if (a === null) return { hex: raw.hex, alpha: raw.alpha ?? 1, oklch: raw.colorSpace === 'oklch' ? raw.components : null };
    raw = pickValue(model.byPath.get(a), theme);
  }
  throw new Error(`${name}: 별칭이 너무 깊다`);
}

// 글자 크기 배율 k의 유도값(foundations 3.2). 순서 고정
export function textScaleValues(model, k) {
  const base = (n) => model.byName.get(n).value.value;
  const out = [];
  for (const role of ROLES) {
    const size = Math.round(base(`--text-${role}`) * k);
    let lead = Math.ceil(size * 1.25);
    if (lead % 2 !== 0) lead += 1;
    out.push([`--text-${role}`, `${size}px`], [`--leading-${role}`, `${lead}px`]);
  }
  out.push(['--leading-read', `${Math.round(base('--leading-read') * k)}px`]);
  return out;
}

// ---------- 생성 ----------

function rule(selector, decls, ind = '') {
  return [`${ind}${selector} {`, ...decls.map(([n, v]) => `${ind}  ${n}: ${v};`), `${ind}}`];
}
function media(cond, inner) {
  return [`@media ${cond} {`, ...inner.map((l) => `  ${l}`), '}'];
}

function sectionBlocks(model) {
  const css = (t, raw) => cssValue(model, t, raw);
  const emitted = model.tokens.filter((t) => !t.noCss);
  const withOverride = (b) => emitted.filter((t) => t.overrides[b] !== undefined).map((t) => [t.name, css(t, t.overrides[b])]);
  const need = (name, decls) => {
    if (decls.length === 0) throw new Error(`${name} 절에 들어갈 토큰이 없다(원천 overrides를 확인한다)`);
    return decls;
  };
  const darkDecls = need('dark', emitted.filter((t) => t.dark !== undefined).map((t) => [t.name, css(t, t.dark)]));
  const bp = model.breakpointNarrow;
  const textScaleRules = Object.keys(model.textScale).flatMap((key) => rule(`:root:where([data-text-scale="${key}"])`, textScaleValues(model, model.textScale[key])));
  const block = (name, desc, lines) => [`/* [${name}] ${desc} */`, ...lines].join('\n');
  return {
    root: block('root', '라이트 기본값. ref 팔레트와 sys 토큰', rule(':root', [['color-scheme', 'light dark'], ...emitted.filter((t) => !t.rootless).map((t) => [t.name, css(t, t.value)])])),
    'dark-media': block('dark-media', 'OS가 다크일 때. data-theme="light"로 고른 라이트는 제외', media('(prefers-color-scheme: dark)', rule(':root:where(:not([data-theme="light"]))', darkDecls))),
    'dark-theme': block('dark-theme', '사용자가 고른 다크(dark-media와 같은 선언)', rule(':root:where([data-theme="dark"])', darkDecls)),
    'theme-scheme': block('theme-scheme', '고른 테마의 color-scheme', [...rule(':root:where([data-theme="light"])', [['color-scheme', 'light']]), ...rule(':root:where([data-theme="dark"])', [['color-scheme', 'dark']])]),
    'window-inactive': block('window-inactive', '비활성 창(macOS): 선택 면을 회색으로. 다크 블록 뒤에 온다', rule(':root:where([data-window-active="false"])', need('window-inactive', withOverride('window-inactive')))),
    reading: block('reading', 'Worker 읽기 척도. main에 붙는다', [
      ...rule('[data-scale="reading"]', need('reading', withOverride('reading'))),
      ...media(`(max-width: ${bp - 1}px)`, rule('[data-scale="reading"]', need('reading-narrow', withOverride('reading-narrow')), '')),
    ]),
    'text-scale': block('text-scale', '앱 글자 크기 설정. 배율에서 유도한다', textScaleRules),
    contrast: block('contrast', '대비 증가. 다크 블록 뒤라 다크에서도 이긴다', media('(prefers-contrast: more)', rule(':root:where(*)', need('contrast', withOverride('contrast'))))),
    coarse: block('coarse', '터치(2-in-1). any-pointer만 본다', media('(any-pointer: coarse)', rule(':root:where(*)', need('coarse', withOverride('coarse'))))),
    reduce: block('reduce', '움직임 줄이기: 이동·크기는 1ms, 눌림 피드백·불투명도는 남긴다', media('(prefers-reduced-motion: reduce)', rule(':root:where(*)', need('reduce', withOverride('reduce'))))),
  };
}

function readText(root, rel) {
  const full = join(root, rel);
  if (!existsSync(full)) throw new Error(`${rel}: 파일이 없다`);
  return `${lf(readFileSync(full, 'utf8')).replace(/\n+$/, '')}\n`;
}

const APP_SECTIONS = ['root', 'dark-media', 'dark-theme', 'theme-scheme', 'window-inactive', 'text-scale', 'contrast', 'coarse', 'reduce'];
const WORKER_SECTIONS = ['root', 'dark-media', 'dark-theme', 'theme-scheme', 'window-inactive', 'reading', 'contrast', 'coarse', 'reduce'];

export function generate(root) {
  const model = loadModel(root);
  const ui = readText(root, UI_SRC);
  const site = readText(root, SITE_SRC);
  const s = sectionBlocks(model);
  const uiSection = `/* [ui] ${UI_SRC} */\n${ui}`;
  const css = `${WORKER_SECTIONS.map((n) => s[n]).join('\n\n')}\n\n${uiSection}\n/* [site] ${SITE_SRC} */\n${site}`;
  if (/[`\\$<]/.test(css)) throw new Error(`Worker CSS에 백틱·백슬래시·$·<가 있다(이스케이프하지 않는다): ${/[`\\$<]/.exec(css)[0]}`);
  for (const bad of ['@import', 'url(']) if (css.includes(bad)) throw new Error(`Worker CSS에 ${bad}가 있다`);
  const hash = createHash('sha256').update(css, 'utf8').digest('hex').slice(0, 16);
  const files = {
    [OUTPUTS.tokens]: `${HEADER}\n${APP_SECTIONS.map((n) => s[n]).join('\n\n')}\n`,
    [OUTPUTS.ui]: `${HEADER}\n${uiSection}`,
    [OUTPUTS.worker]: `${HEADER}\nexport const SITE_CSS = \`${css}\`;\nexport const SITE_CSS_HASH = "${hash}";\n`,
  };
  return { files, siteCss: css, hash };
}

// ---------- 절 나누기 ----------

const MARKER = /^\/\* \[([a-z0-9-]+)\] .*\*\/$/;

// 머리줄 뒤 `/* [이름] … */` 표지(0열 한 줄)로 나눈다. 표지 앞 글자는 버리고 절 끝의 빈 줄은 떼어 낸다
export function splitSections(text) {
  const out = [];
  let cur = null;
  for (const line of lf(text).split('\n')) {
    const m = MARKER.exec(line);
    if (m) {
      cur = { name: m[1], lines: [line] };
      out.push(cur);
    } else if (cur) cur.lines.push(line);
  }
  return out.map(({ name, lines }) => ({ name, text: lines.join('\n').replace(/\n+$/, '') }));
}

// Worker 생성 모듈에서 SITE_CSS 원문을 꺼낸다(모양이 아니면 null)
export function siteCssOf(tsText) {
  const m = /^\/\*[^\n]*\*\/\nexport const SITE_CSS = `([^`]*)`;\nexport const SITE_CSS_HASH = "[0-9a-f]{16}";\n$/.exec(lf(tsText));
  return m ? m[1] : null;
}

// ---------- CLI ----------

function firstDiffLine(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 1;
}

function fmt(file, line, msg, env) {
  return env.GITHUB_ACTIONS === 'true' ? `::error file=${file},line=${line}::DT1: ${msg}` : `${file}:${line}: DT1: ${msg}`;
}

// DT1: (가) 두 번 생성이 같다 (나) 저장소 생성물 셋과 바이트 동일 (다) 앱·Worker의 같은 이름 절 동일, Worker ui 절 = design/ui.css
export function checkOutputs(root, env = process.env) {
  const out = [];
  const g1 = generate(root);
  const g2 = generate(root);
  if (JSON.stringify(g1.files) !== JSON.stringify(g2.files)) out.push(fmt('scripts/design/tokens.mjs', 0, '같은 원천을 두 번 생성한 결과가 다르다(비결정적)', env));
  const stored = {};
  for (const rel of Object.values(OUTPUTS)) {
    const full = join(root, rel);
    if (!existsSync(full)) {
      out.push(fmt(rel, 0, '생성물이 없다. node scripts/design/tokens.mjs로 만든다', env));
      continue;
    }
    stored[rel] = lf(readFileSync(full, 'utf8'));
    if (stored[rel] !== g1.files[rel]) out.push(fmt(rel, firstDiffLine(stored[rel], g1.files[rel]), '원천에서 다시 만든 것과 다르다. 손으로 고치지 않는다(node scripts/design/tokens.mjs)', env));
  }
  if (stored[OUTPUTS.tokens] && stored[OUTPUTS.worker]) {
    const app = new Map(splitSections(stored[OUTPUTS.tokens]).map((x) => [x.name, x.text]));
    const css = siteCssOf(stored[OUTPUTS.worker]);
    if (css === null) out.push(fmt(OUTPUTS.worker, 1, '생성물 모양이 아니다(머리 주석 + SITE_CSS + SITE_CSS_HASH)', env));
    else {
      const wk = new Map(splitSections(css).map((x) => [x.name, x.text]));
      for (const [name, text] of wk) {
        if (app.has(name) && app.get(name) !== text) out.push(fmt(OUTPUTS.worker, 0, `${name} 절이 앱 ${OUTPUTS.tokens}와 바이트가 다르다`, env));
      }
      const uiWant = splitSections(`${HEADER}\n/* [ui] ${UI_SRC} */\n${readText(root, UI_SRC)}`)[0].text;
      if (wk.get('ui') !== uiWant) out.push(fmt(OUTPUTS.worker, 0, `ui 절이 ${UI_SRC}와 다르다`, env));
      if (stored[OUTPUTS.ui]) {
        const appUi = splitSections(stored[OUTPUTS.ui]).find((x) => x.name === 'ui')?.text;
        if (appUi !== wk.get('ui')) out.push(fmt(OUTPUTS.ui, 0, 'ui 절이 Worker 생성물과 다르다', env));
      }
    }
  }
  return out;
}

export function main(argv, env = process.env) {
  let root = ROOT;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') check = true;
    else if (argv[i] === '--root' && argv[i + 1]) root = resolve(argv[++i]);
    else {
      console.error('사용법: node scripts/design/tokens.mjs [--check] [--root dir]');
      return 2;
    }
  }
  try {
    if (check) {
      const v = checkOutputs(root, env);
      for (const line of v) console.log(line);
      if (v.length) console.log(`[design-tokens] DT1 위반 ${v.length}`);
      return v.length ? 1 : 0;
    }
    const { files } = generate(root);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
      console.log(`쓴다: ${rel}`);
    }
    return 0;
  } catch (e) {
    console.error(`원천 오류: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
