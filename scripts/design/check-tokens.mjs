#!/usr/bin/env node
// design-tokens gate의 둘째 단계: 토큰 검사 DT2~DT17(governance.md §2.2).
// 첫째 단계 `tokens.mjs --check`가 DT1(생성물 바이트 동일)을 맡는다. 여기서는 원천·생성물·소스·문서를 읽어 판정한다.
// 소스 쪽 위반(DT2·DT3·DT4·DT12·DT13)만 허용 목록(allow.json)을 받는다. 원천·생성물 자체 검사는 허용 목록이 없다.
// 사용: node scripts/design/check-tokens.mjs [--root <dir>] [--print-allow]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runGate } from './allow.mjs';
import { composite, contrastRatio, hsl } from './contrast.mjs';
import { parseCss, stripComments, varRefs } from './css.mjs';
import { OUTPUTS, loadModel, resolveColor, textScaleValues } from './tokens.mjs';

export const FAMILIES = ['DT'];
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FOUNDATIONS = 'docs/design/system/foundations.md';
const TIMING_TS = 'app/src/lib/timing.ts';
const CONSTS_RS = 'crates/shell/src/consts.rs';
const NOTICE_TS = 'worker/src/core/notice.ts';
const APP_CSS = 'app/src/app.css';
const SITE_CSS = 'worker/src/http/site.css';
const UI_CSS = 'design/ui.css';
const WORKER_GENERATED = OUTPUTS.worker;
const APP_GENERATED = [OUTPUTS.tokens, OUTPUTS.ui];

/** 토큰 값을 담는 절. ui·site는 뺀다 */
export const TOKEN_SECTIONS = ['root', 'dark-media', 'dark-theme', 'theme-scheme', 'window-inactive', 'reading', 'text-scale', 'contrast', 'coarse', 'reduce'];

/** Worker 소스에서만 세는 토큰(앱에는 정의가 없다) */
const WORKER_ONLY = new Set(['--text-hero', '--leading-hero']);

/** §14 표에서 Worker가 코드로 갖는 상수(그 행의 "Worker + Rust" 중 Worker 쪽). 나머지 이름은 앱·Rust만의 값이다(DT15) */
const WORKER_CONSTS = new Set(['NOTICE_TTL_H', 'NOTICE_MAX_CHARS']);

/** 컴포넌트 상태 변수(components.md §2.20): 정의 없이 쓸 수 있는 유일한 이름 */
const LOCAL_VARS = new Set(['--p']);

// ───────────────────────── 공통 도우미 ─────────────────────────

const norm = (s) => s.replace(/\r\n/g, '\n');
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const posix = (p) => p.split(path.sep).join('/');

function readText(root, rel) {
  const abs = path.join(root, rel);
  return fs.existsSync(abs) ? norm(fs.readFileSync(abs, 'utf8')) : null;
}

function needText(root, rel) {
  const text = readText(root, rel);
  if (text === null) throw new Error(`필요한 파일이 없다: ${rel}`);
  return text;
}

/** 주석을 지우되 줄바꿈은 남긴다(줄 번호 보존) */
const blankKeepLines = (s) => s.replace(/[^\n]/g, '');

/** var(--x) 사용을 세려고 CSS·HTML·JS 주석을 지운다 */
function stripForRefs(src, kind) {
  let out = src;
  if (kind === 'svelte') out = out.replace(/<!--[\s\S]*?-->/g, blankKeepLines);
  out = stripComments(out);
  if (kind !== 'css') out = out.replace(/^[ \t]*\/\/.*$/gm, '');
  return out;
}

/** root 아래 디렉터리를 훑어 저장소 상대 POSIX 경로를 정렬해 돌려준다 */
function walk(root, dir, accept, { recursive = true, skipDirs = ['node_modules', 'bindings', '.svelte-kit', 'dist'] } = {}) {
  const base = path.join(root, dir);
  const out = [];
  if (!fs.existsSync(base)) return out;
  const visit = (abs, rel) => {
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (recursive && !skipDirs.includes(ent.name)) visit(path.join(abs, ent.name), r);
      } else if (accept(r)) out.push(r);
    }
  };
  visit(base, posix(dir));
  return out.sort();
}

/** 절 표지 줄의 위치를 모은다. 표지는 0열의 한 줄 주석 `[이름] 설명` 꼴이다 */
export function sectionMarkers(text, startLine = 1) {
  const marks = [];
  text.split('\n').forEach((line, i) => {
    const m = /^\/\* \[([a-z-]+)\] /.exec(line);
    if (m) marks.push({ name: m[1], line: startLine + i });
  });
  return marks;
}

export function annotateSections(rules, marks) {
  return rules.map((rule) => {
    let section = null;
    for (const m of marks) if (m.line <= rule.line) section = m.name;
    return { ...rule, section };
  });
}

const tokenRules = (target) => target.rules.filter((r) => TOKEN_SECTIONS.includes(r.section));

/** 토큰 절의 선언을 평탄화한다 */
function declsOf(target, sections = TOKEN_SECTIONS) {
  const out = [];
  for (const rule of target.rules) {
    if (!sections.includes(rule.section)) continue;
    for (const d of rule.decls) out.push({ ...d, rule, file: target.file, section: rule.section });
  }
  return out;
}

/** 앱·Worker에서 같은 (prop, value, 절)은 한 번만 본다(어긋나면 DT1이 따로 잡는다) */
function uniqueDecls(ctx, sections = TOKEN_SECTIONS) {
  const seen = new Set();
  const out = [];
  for (const target of [ctx.app, ctx.worker]) {
    for (const d of declsOf(target, sections)) {
      const key = `${d.section}|${d.prop}|${d.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out;
}

const tokenFile = (token) => `design/tokens/${token.file}.tokens.json`;

const v = (rule, file, line, text, msg) => ({ rule, file, line, text, msg });

// ───────────────────────── 컨텍스트 ─────────────────────────

/** 생성물 한 벌을 파싱한다 */
function parseGenerated(file, css, startLine) {
  const rules = annotateSections(parseCss(css, { startLine }).rules, sectionMarkers(css, startLine));
  return { file, rules, css, startLine };
}

/** Worker 생성 모듈에서 SITE_CSS 문자열을 꺼낸다 */
export function extractSiteCss(ts) {
  const m = /^export const SITE_CSS = `([\s\S]*?)`;$/m.exec(ts);
  if (!m) throw new Error(`${WORKER_GENERATED}에서 SITE_CSS 상수를 찾지 못했다`);
  const before = ts.slice(0, m.index + 'export const SITE_CSS = `'.length);
  return { css: m[1], startLine: before.split('\n').length };
}

function sourceEntries(root, files, kindOf) {
  return files.map((file) => {
    const raw = readText(root, file);
    const kind = kindOf(file);
    return { file, text: stripForRefs(raw, kind), raw };
  });
}

export function buildContext(root) {
  const model = loadModel(root);
  const appText = needText(root, OUTPUTS.tokens);
  const uiGenText = needText(root, OUTPUTS.ui);
  const workerTs = needText(root, OUTPUTS.worker);
  const site = extractSiteCss(workerTs);
  const appSourceFiles = walk(root, 'app/src', (r) => /\.(svelte|css)$/.test(r) && !APP_GENERATED.includes(r));
  const workerSourceFiles = walk(root, 'worker/src/http', (r) => /\.(ts|css)$/.test(r) && !/\.generated\.ts$/.test(r), { recursive: false });
  const uiRaw = readText(root, UI_CSS);
  return {
    model,
    fns: { resolveColor, textScaleValues, contrastRatio, composite, hsl },
    app: parseGenerated(OUTPUTS.tokens, appText, 1),
    worker: parseGenerated(WORKER_GENERATED, site.css, site.startLine),
    uiGen: { file: OUTPUTS.ui, text: uiGenText, rules: parseCss(stripComments(uiGenText)).rules },
    appSources: sourceEntries(root, appSourceFiles, (f) => (f.endsWith('.svelte') ? 'svelte' : 'css')),
    workerSources: sourceEntries(root, workerSourceFiles, (f) => (f.endsWith('.css') ? 'css' : 'ts')),
    uiSource: uiRaw === null ? null : { file: UI_CSS, text: stripForRefs(uiRaw, 'css'), raw: uiRaw },
    appCss: { file: APP_CSS, raw: readText(root, APP_CSS) },
    siteCss: { file: SITE_CSS, raw: readText(root, SITE_CSS) },
    foundations: needText(root, FOUNDATIONS),
    timing: readText(root, TIMING_TS),
    consts: readText(root, CONSTS_RS),
    notice: readText(root, NOTICE_TS),
  };
}

// ───────────────────────── var 사용 모으기 ─────────────────────────

/** [{ file, text }] → Map(name → [{ file, line }]) */
function collectRefs(entries) {
  const map = new Map();
  for (const e of entries) {
    for (const r of varRefs(e.text)) {
      if (!map.has(r.name)) map.set(r.name, []);
      map.get(r.name).push({ file: e.file, line: r.line });
    }
  }
  return map;
}

function sourceGroups(ctx) {
  const groups = {
    app: ctx.appSources,
    worker: ctx.workerSources,
    ui: ctx.uiSource ? [ctx.uiSource] : [],
  };
  return groups;
}

const namesOf = (decls) => new Set(decls.filter((d) => d.prop.startsWith('--')).map((d) => d.prop));

// ───────────────────────── DT2 미정의 토큰 ─────────────────────────

export function dt2(ctx) {
  const out = [];
  const workerDefined = namesOf(declsOf(ctx.worker));
  const common = new Set([...namesOf(declsOf(ctx.app)).values()].filter((n) => workerDefined.has(n)));
  // 앱: 앱 tokens.css 전체. ui 절·site 절은 정의로 세지 않는다(토큰 절만).
  const appAll = namesOf(ctx.app.rules.filter((r) => r.section !== 'ui' && r.section !== 'site').flatMap((r) => r.decls));
  const groups = sourceGroups(ctx);
  const check = (entries, defined) => {
    for (const e of entries) {
      for (const r of varRefs(e.text)) {
        if (defined.has(r.name) || LOCAL_VARS.has(r.name)) continue;
        out.push(v('DT2', e.file, r.line, r.name, `정의되지 않은 토큰 ${r.name}`));
      }
    }
  };
  check(groups.app, appAll);
  check(groups.ui, common);
  check(groups.worker, workerDefined);
  return out;
}

// ───────────────────────── DT3 미사용 토큰 ─────────────────────────

export function dt3(ctx) {
  const out = [];
  const groups = sourceGroups(ctx);
  const refsApp = collectRefs(groups.app);
  const refsUi = collectRefs(groups.ui);
  const refsWorker = collectRefs(groups.worker);

  // 생성물 안 별칭(var())이 가리키는 토큰은 쓰인 것으로 센다(ref → sys 별칭, sys → sys 별칭)
  const internal = new Set();
  for (const d of uniqueDecls(ctx)) {
    for (const r of varRefs(d.value)) internal.add(r.name);
  }

  const declared = new Map();
  for (const d of declsOf(ctx.app)) if (d.prop.startsWith('--') && !declared.has(d.prop)) declared.set(d.prop, ctx.app.file);
  for (const d of declsOf(ctx.worker)) if (d.prop.startsWith('--') && !declared.has(d.prop)) declared.set(d.prop, ctx.worker.file);

  for (const [name, file] of declared) {
    let used;
    if (WORKER_ONLY.has(name)) used = refsWorker.has(name);
    else used = refsApp.has(name) || refsUi.has(name) || refsWorker.has(name) || internal.has(name);
    if (!used) out.push(v('DT3', file, 0, name, `쓰이지 않는 토큰 ${name}`));
  }
  return out;
}

// ───────────────────────── DT4 단위 ─────────────────────────

const HTML_FONT_SIZE_TEXT = 'html { font-size: 16px }';

function hasHtmlFontSize(raw) {
  if (raw === null) return false;
  const { rules } = parseCss(stripComments(raw));
  return rules.some((r) => r.media.length === 0 && r.selector === 'html' && r.decls.some((d) => d.prop === 'font-size' && d.value === '16px'));
}

export function dt4(ctx) {
  const out = [];
  for (const t of ctx.model.tokens) {
    if (t.type !== 'dimension' || typeof t.value === 'string') continue; // 별칭은 대상 토큰이 본다
    const unit = t.value && typeof t.value === 'object' ? t.value.unit : undefined;
    if (unit !== 'px') out.push(v('DT4', tokenFile(t), 0, t.name, `dimension 단위가 px가 아니다: ${t.name} (${unit})`));
  }
  const gens = [ctx.app, ctx.worker, { file: ctx.uiGen.file, rules: ctx.uiGen.rules }];
  for (const g of gens) {
    for (const rule of g.rules) {
      for (const d of rule.decls) {
        const m = /(?:^|[^\w-])(-?\d*\.?\d+)(rem|em)\b/i.exec(d.value);
        if (m) out.push(v('DT4', g.file, d.line, `${d.prop}: ${d.value}`, `rem·em 단위 금지: ${d.prop}`));
      }
    }
  }
  for (const f of [ctx.appCss, ctx.siteCss]) {
    if (!hasHtmlFontSize(f.raw)) out.push(v('DT4', f.file, 0, HTML_FONT_SIZE_TEXT, `${f.file}에 ${HTML_FONT_SIZE_TEXT} 규칙이 없다`));
  }
  return out;
}

// ───────────────────────── DT5 글자 ─────────────────────────

export function dt5(ctx) {
  const out = [];
  for (const d of uniqueDecls(ctx)) {
    if (/^--text-/.test(d.prop)) {
      const m = /^(\d+(?:\.\d+)?)px$/.exec(d.value);
      if (!m || Number(m[1]) < 12) out.push(v('DT5', d.file, d.line, d.prop, `${d.prop}는 12px 이상이어야 한다: ${d.value}`));
    } else if (/^--leading-/.test(d.prop)) {
      if (!/^\d+px$/.test(d.value)) out.push(v('DT5', d.file, d.line, d.prop, `${d.prop}는 정수 px여야 한다: ${d.value}`));
    } else if (/^--weight-/.test(d.prop)) {
      if (d.value !== '400' && d.value !== '600') out.push(v('DT5', d.file, d.line, d.prop, `${d.prop}는 400·600뿐이다: ${d.value}`));
    }
  }
  return out;
}

// ───────────────────────── 캐스케이드 시뮬레이션(DT6·DT11·DT16) ─────────────────────────

/** 특이도가 전부 (0,1,0)이라 소스 순서만 본다. 모르는 media·selector는 맞지 않는 것으로 친다 */
export function mediaMatches(prelude, env) {
  const p = squash(prelude).toLowerCase();
  if (p === '@media (prefers-color-scheme: dark)') return env.scheme === 'dark';
  if (p === '@media (prefers-color-scheme: light)') return env.scheme === 'light';
  if (p === '@media (prefers-contrast: more)') return !!env.contrastMore;
  if (p === '@media (any-pointer: coarse)') return !!env.coarse;
  if (p === '@media (prefers-reduced-motion: reduce)') return !!env.reduce;
  if (p === '@media (max-width: 599px)') return !!env.narrow;
  return false;
}

function attrValue(env, name) {
  if (name === 'data-theme') return !env.theme || env.theme === 'none' ? null : env.theme;
  if (name === 'data-window-active') return env.windowInactive ? 'false' : null;
  if (name === 'data-text-scale') return env.textScale ?? null;
  return null;
}

function matchCompound(inner, env) {
  const s = inner.trim();
  if (s === '*') return true;
  let m = /^:not\((.*)\)$/.exec(s);
  if (m) return !matchCompound(m[1], env);
  m = /^\[([\w-]+)="([^"]*)"\]$/.exec(s);
  if (m) return attrValue(env, m[1]) === m[2];
  return false;
}

export function selectorMatches(selector, env) {
  const sel = selector.trim();
  if (sel.includes(',')) return sel.split(',').some((s) => selectorMatches(s, env));
  if (!sel.startsWith(':root')) return false; // [data-scale="reading"]은 main 요소라 루트 계산에서 뺀다
  const rest = sel.slice(':root'.length);
  if (rest === '') return true;
  const m = /^:where\((.*)\)$/.exec(rest);
  return m ? matchCompound(m[1], env) : false;
}

/** 규칙을 소스 순서로 쌓아 환경의 최종 선언(원문 값)을 돌려준다 */
export function evalCascade(rules, env) {
  const values = new Map();
  for (const rule of rules) {
    if (!rule.media.every((m) => mediaMatches(m, env))) continue;
    if (!selectorMatches(rule.selector, env)) continue;
    for (const d of rule.decls) values.set(d.prop, d.value);
  }
  return values;
}

/** var()를 풀어 최종 글자를 낸다 */
export function resolveValue(values, name, depth = 0) {
  const raw = values.get(name);
  if (raw === undefined) return undefined;
  if (depth > 8) throw new Error(`var() 사슬이 너무 깊다: ${name}`);
  return raw.replace(/var\((--[\w-]+)\)/g, (_, n) => resolveValue(values, n, depth + 1) ?? `var(${n})`);
}

const cascadeRules = (target) => tokenRules(target);

// ───────────────────────── DT6 값 집합 ─────────────────────────

const SPACE_SET = new Set([2, 4, 6, 8, 12, 16, 20, 24, 32, 40]);
const RADIUS_SET = new Set([4, 6, 10, 12, 999]);
const CONTROL_MOUSE = { '--control-h-sm': 24, '--control-h': 28, '--control-h-lg': 36, '--row-h': 36, '--toolbar-h': 44, '--hit-min': 24 };
const CONTROL_COARSE = { '--control-h-sm': 40, '--control-h': 40, '--control-h-lg': 44, '--row-h': 44, '--toolbar-h': 44, '--hit-min': 40 };

const pxNumber = (value) => {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(value ?? '');
  return m ? Number(m[1]) : null;
};

export function dt6(ctx) {
  const out = [];
  for (const d of uniqueDecls(ctx)) {
    if (/^--space-\d+$/.test(d.prop) && !SPACE_SET.has(pxNumber(d.value))) {
      out.push(v('DT6', d.file, d.line, d.prop, `${d.prop}는 {2,4,6,8,12,16,20,24,32,40}px 중 하나여야 한다: ${d.value}`));
    }
    if (/^--radius-/.test(d.prop) && !RADIUS_SET.has(pxNumber(d.value))) {
      out.push(v('DT6', d.file, d.line, d.prop, `${d.prop}는 {4,6,10,12,999}px 중 하나여야 한다: ${d.value}`));
    }
  }
  const rules = cascadeRules(ctx.app);
  for (const [label, env, table] of [
    ['마우스', { scheme: 'light', theme: 'none' }, CONTROL_MOUSE],
    ['터치', { scheme: 'light', theme: 'none', coarse: true }, CONTROL_COARSE],
  ]) {
    const values = evalCascade(rules, env);
    for (const [name, want] of Object.entries(table)) {
      const got = resolveValue(values, name);
      if (got !== `${want}px`) out.push(v('DT6', ctx.app.file, 0, name, `${name} ${label} 값이 ${want}px가 아니다: ${got}`));
    }
  }
  return out;
}

// ───────────────────────── DT7 이름 ─────────────────────────

const COLOR_PROPS = ['bg', 'surface', 'raised', 'track', 'fg', 'separator', 'border', 'accent', 'danger', 'warning', 'on', 'focus', 'scrim', 'ref'];
const DIMENSION_PROPS = ['text', 'leading', 'space', 'edge', 'gap', 'radius', 'control', 'row', 'toolbar', 'hit', 'icon', 'switch', 'radio', 'progress', 'badge', 'content', 'reading', 'dialog', 'label', 'pct'];
export const PROP_TYPE = Object.fromEntries([
  ...COLOR_PROPS.map((p) => [p, 'color']),
  ...DIMENSION_PROPS.map((p) => [p, 'dimension']),
  ['shadow', 'shadow'],
  ['font', 'fontFamily'],
  ['weight', 'fontWeight'],
  ['motion', 'duration'],
  ['progress-tween', 'duration'],
  ['ease', 'cubicBezier'],
  ['z', 'number'],
]);

export function propertyOf(name) {
  const bare = name.replace(/^--/, '');
  if (bare === 'progress-tween') return 'progress-tween';
  return bare.split('-')[0];
}

/** ref 이름 규칙: gray ×1000, 유채색 ×100, 알파 a{α×100} */
export function expectedRefKey(token) {
  const parts = token.path.split('.');
  const color = parts[1];
  const val = token.value;
  if (!val || typeof val !== 'object') return null;
  if (color === 'white' && parts.length === 2) return null; // ref.white 는 키 없음
  if (parts.length === 3 && typeof val.alpha === 'number') return `a${Math.round(val.alpha * 100)}`;
  const L = val.components?.[0];
  if (typeof L !== 'number') return null;
  return color === 'gray' ? String(Math.round(L * 1000)) : String(Math.round(L * 100));
}

export function dt7(ctx) {
  const out = [];
  const docNames = new Set();
  for (const r of ctx.docRules ?? []) for (const d of r.decls) if (d.prop.startsWith('--')) docNames.add(d.prop);
  for (const t of ctx.model.tokens) {
    if (t.noCss) continue;
    const prop = propertyOf(t.name);
    const want = PROP_TYPE[prop];
    if (want === undefined) {
      out.push(v('DT7', tokenFile(t), 0, t.name, `속성 자리 ${prop}는 foundations §1 표의 허용 값이 아니다: ${t.name}`));
    } else if (want !== t.type) {
      out.push(v('DT7', tokenFile(t), 0, t.name, `${t.name}의 $type은 ${want}여야 한다(${t.type})`));
    }
    if (/^--space-\d+$/.test(t.name)) {
      const n = Number(t.name.slice('--space-'.length));
      if (!(t.value && t.value.value === n && t.value.unit === 'px')) {
        out.push(v('DT7', tokenFile(t), 0, t.name, `값 이름 토큰은 이름 = 값이다: ${t.name}`));
      }
    }
    if (t.file === 'ref' && t.path.split('.').length === 3) {
      const key = expectedRefKey(t);
      const got = t.path.split('.')[2];
      if (key !== null && key !== got) out.push(v('DT7', tokenFile(t), 0, t.name, `ref 이름 규칙 위반: ${t.name}는 키 ${key}여야 한다`));
    }
  }
  const generated = new Set(uniqueDecls(ctx).filter((d) => d.prop.startsWith('--')).map((d) => d.prop));
  for (const n of generated) if (!docNames.has(n)) out.push(v('DT7', FOUNDATIONS, 0, n, `생성물에만 있는 이름(foundations §13에 없다): ${n}`));
  for (const n of docNames) if (!generated.has(n)) out.push(v('DT7', FOUNDATIONS, 0, n, `foundations §13에만 있는 이름(생성물에 없다): ${n}`));
  return out;
}

// ───────────────────────── DT8 대비 ─────────────────────────

export function dt8(ctx) {
  const out = [];
  const { resolveColor: rc, composite: comp, contrastRatio: cr } = ctx.fns;
  for (const theme of ['light', 'dark']) {
    for (const pair of ctx.model.contrast?.[theme] ?? []) {
      const text = `${theme} ${pair.fg} / ${pair.bg}`;
      try {
        const bg = rc(ctx.model, pair.bg, theme);
        const fg = rc(ctx.model, pair.fg, theme);
        const fgHex = fg.alpha < 1 ? comp(fg.hex, fg.alpha, bg.hex) : fg.hex;
        const ratio = cr(fgHex, bg.hex);
        if (ratio + 1e-9 < pair.min) {
          out.push(v('DT8', 'design/tokens/contrast.tokens.json', 0, text, `대비 ${ratio.toFixed(2)} < ${pair.min}: ${text}`));
        }
      } catch (e) {
        out.push(v('DT8', 'design/tokens/contrast.tokens.json', 0, text, `쌍을 풀지 못했다: ${e.message}`));
      }
    }
  }
  return out;
}

// ───────────────────────── DT9 색상각 ─────────────────────────

export function dt9(ctx) {
  const out = [];
  const { resolveColor: rc, hsl: toHsl } = ctx.fns;
  const seen = new Set();
  const test = (token, theme, block) => {
    let res;
    try {
      res = rc(ctx.model, token.name, theme, block);
    } catch {
      return;
    }
    if (!res || !res.hex) return;
    const { h, s } = toHsl(res.hex);
    const label = `${theme}${block ? `/${block}` : ''} ${token.name} ${res.hex}`;
    if (h >= 140 && h <= 170 && s >= 70 && !seen.has(label)) {
      seen.add(label);
      out.push(v('DT9', tokenFile(token), 0, label, `C1 위반(H ${h.toFixed(1)}° S ${s.toFixed(1)}%): ${label}`));
    }
    if (token.path.startsWith('ref.gray.') && s !== 0) {
      out.push(v('DT9', tokenFile(token), 0, label, `gray ref는 S=0이어야 한다(S ${s.toFixed(2)}): ${token.name}`));
    }
  };
  for (const token of ctx.model.tokens) {
    if (token.type !== 'color') continue;
    for (const theme of ['light', 'dark']) {
      test(token, theme);
      for (const block of ['window-inactive', 'contrast']) {
        if (token.overrides && token.overrides[block] !== undefined) test(token, theme, block);
      }
    }
  }
  return out;
}

// ───────────────────────── DT10 다크 ─────────────────────────

const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const DARK_MEDIA_SELECTOR = ':root:where(:not([data-theme="light"]))';
const DARK_THEME_SELECTOR = ':root:where([data-theme="dark"])';
const LIGHT_ONLY = new Set(['--on-accent', '--focus']);
const DARK_SURFACES = ['--bg', '--surface', '--raised', '--surface-2', '--surface-pressed'];

function declMap(rules) {
  const m = new Map();
  for (const r of rules) for (const d of r.decls) m.set(d.prop, d.value);
  return m;
}

export function dt10(ctx) {
  const out = [];
  for (const target of [ctx.app, ctx.worker]) {
    const media = target.rules.filter((r) => r.section === 'dark-media');
    const theme = target.rules.filter((r) => r.section === 'dark-theme');
    if (media.length !== 1 || squash(media[0].media.join(' ')) !== DARK_MEDIA || media[0].selector !== DARK_MEDIA_SELECTOR) {
      out.push(v('DT10', target.file, media[0]?.line ?? 0, 'dark-media', `dark-media 블록이 ${DARK_MEDIA} ${DARK_MEDIA_SELECTOR} 하나가 아니다`));
    }
    if (theme.length !== 1 || theme[0].selector !== DARK_THEME_SELECTOR) {
      out.push(v('DT10', target.file, theme[0]?.line ?? 0, 'dark-theme', `dark-theme 블록이 ${DARK_THEME_SELECTOR} 하나가 아니다`));
    }
    const a = declMap(media);
    const b = declMap(theme);
    for (const [prop, val] of a) {
      if (!b.has(prop)) out.push(v('DT10', target.file, 0, prop, `다크 두 블록이 다르다: ${prop}가 data-theme 블록에 없다`));
      else if (b.get(prop) !== val) out.push(v('DT10', target.file, 0, prop, `다크 두 블록이 다르다: ${prop} ${val} ≠ ${b.get(prop)}`));
    }
    for (const prop of b.keys()) if (!a.has(prop)) out.push(v('DT10', target.file, 0, prop, `다크 두 블록이 다르다: ${prop}가 미디어 블록에 없다`));
  }
  // 라이트 색 토큰 중 다크에 없는 것은 --on-accent·--focus뿐
  const darkProps = declMap(ctx.app.rules.filter((r) => r.section === 'dark-theme'));
  for (const t of ctx.model.tokens) {
    if (t.file !== 'sys' || t.noCss || t.rootless) continue;
    if (t.type !== 'color' && t.type !== 'shadow') continue;
    const inDark = darkProps.has(t.name);
    if (!inDark && !LIGHT_ONLY.has(t.name)) out.push(v('DT10', tokenFile(t), 0, t.name, `다크 값이 없다: ${t.name}`));
    if (inDark && LIGHT_ONLY.has(t.name)) out.push(v('DT10', tokenFile(t), 0, t.name, `${t.name}는 다크 블록에 없어야 한다`));
  }
  for (const name of DARK_SURFACES) {
    try {
      const res = ctx.fns.resolveColor(ctx.model, name, 'dark');
      const L = res.oklch?.[0];
      if (typeof L !== 'number' || L < 0.24 - 1e-9) out.push(v('DT10', 'design/tokens/sys.tokens.json', 0, name, `다크 ${name}의 OKLCH L이 0.24 미만이다: ${L}`));
    } catch (e) {
      out.push(v('DT10', 'design/tokens/sys.tokens.json', 0, name, `다크 ${name}를 풀지 못했다: ${e.message}`));
    }
  }
  return out;
}

// ───────────────────────── DT11 블록 값 ─────────────────────────

export function dt11(ctx) {
  const out = [];
  const file = ctx.app.file;
  const sectionDecls = (name) => declMap(ctx.app.rules.filter((r) => r.section === name));
  const compare = (label, got, want) => {
    for (const [prop, val] of want) {
      if (!got.has(prop)) out.push(v('DT11', file, 0, `${label} ${prop}`, `${label} 블록에 ${prop}가 없다`));
      else if (got.get(prop) !== val) out.push(v('DT11', file, 0, `${label} ${prop}`, `${label} 블록 ${prop}가 ${val}이어야 한다: ${got.get(prop)}`));
    }
    for (const prop of got.keys()) if (!want.has(prop)) out.push(v('DT11', file, 0, `${label} ${prop}`, `${label} 블록에 있으면 안 되는 선언: ${prop}`));
  };
  compare('reduce', sectionDecls('reduce'), new Map([['--motion-base', '1ms'], ['--motion-slow', '1ms'], ['--progress-tween', '1ms']]));
  compare(
    'contrast',
    sectionDecls('contrast'),
    new Map([['--fg-muted', 'var(--fg)'], ['--separator', 'var(--fg)'], ['--border-strong', 'var(--fg)']]),
  );
  // coarse: 마우스 값과 다른 것만 블록에 있고 값이 터치 열과 같다
  const coarse = sectionDecls('coarse');
  const wantCoarse = new Map(
    Object.entries(CONTROL_COARSE)
      .filter(([name]) => CONTROL_MOUSE[name] !== CONTROL_COARSE[name])
      .map(([name, n]) => [name, `${n}px`]),
  );
  compare('coarse', coarse, wantCoarse);
  // text-scale: 생성기 유도 규칙(foundations §3.2)과 같다
  for (const k of ['large', 'x-large']) {
    const sel = `:root:where([data-text-scale="${k}"])`;
    const rules = ctx.app.rules.filter((r) => r.section === 'text-scale' && r.selector === sel);
    if (rules.length === 0) {
      out.push(v('DT11', file, 0, `text-scale ${k}`, `text-scale ${k} 블록이 없다`));
      continue;
    }
    const scale = ctx.model.textScale?.[k];
    const want = new Map(ctx.fns.textScaleValues(ctx.model, scale));
    compare(`text-scale ${k}`, declMap(rules), want);
  }
  return out;
}

// ───────────────────────── DT12 글꼴 ─────────────────────────

export function dt12(ctx) {
  const out = [];
  const sans = ctx.model.tokens.find((t) => t.name === '--font-sans');
  if (!sans) out.push(v('DT12', 'design/tokens/type.tokens.json', 0, '--font-sans', '--font-sans 토큰이 없다'));
  else if (!(Array.isArray(sans.value) && sans.value[0] === 'system-ui')) {
    out.push(v('DT12', tokenFile(sans), 0, '--font-sans', '--font-sans가 system-ui로 시작하지 않는다'));
  }
  const scans = [
    [ctx.app.file, ctx.app.css, ctx.app.startLine],
    [ctx.uiGen.file, ctx.uiGen.text, 1],
    [ctx.worker.file, ctx.worker.css, ctx.worker.startLine],
    [ctx.appCss.file, ctx.appCss.raw, 1],
    [ctx.siteCss.file, ctx.siteCss.raw, 1],
  ];
  for (const [file, raw, startLine] of scans) {
    if (raw === null || raw === undefined) continue;
    const text = stripComments(raw);
    const lineAt = (i) => startLine + text.slice(0, i).split('\n').length - 1;
    for (const m of text.matchAll(/@font-face\b/g)) out.push(v('DT12', file, lineAt(m.index), '@font-face', '@font-face 금지(번들 글꼴 없음)'));
    for (const m of text.matchAll(/url\([^)]*\)/g)) out.push(v('DT12', file, lineAt(m.index), m[0], `url( 금지: ${m[0]}`));
    for (const m of text.matchAll(/@import[^;\n]*/g)) out.push(v('DT12', file, lineAt(m.index), m[0].trim(), `@import 금지: ${m[0].trim()}`));
  }
  return out;
}

// ───────────────────────── DT13 층 ─────────────────────────

export function dt13(ctx) {
  const out = [];
  const groups = sourceGroups(ctx);
  const all = [...groups.app, ...groups.ui, ...groups.worker];
  const zNames = new Set();
  for (const d of uniqueDecls(ctx)) if (/^--z-/.test(d.prop)) zNames.add(d.prop);
  for (const name of [...zNames].sort()) {
    const files = new Set();
    for (const e of all) if (varRefs(e.text).some((r) => r.name === name)) files.add(e.file);
    if (files.size !== 1) {
      out.push(v('DT13', ctx.app.file, 0, name, `${name}를 쓰는 파일이 정확히 하나여야 한다(${files.size}개${files.size ? `: ${[...files].join(', ')}` : ''})`));
    }
  }
  return out;
}

// ───────────────────────── DT14 문서 패리티(§13) ─────────────────────────

/** 마크다운에서 `## <num>.` 절 본문을 [startLine, text]로 돌려준다 */
export function sectionBody(md, num) {
  const lines = md.split('\n');
  const head = new RegExp(`^## ${num}\\.`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## \d+\./.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { startLine: start + 1, lines: lines.slice(start, end) };
}

/** 절 안 첫 ```css 블록과 그 첫 줄 번호 */
export function firstCssBlock(body) {
  const i = body.lines.findIndex((l) => /^```css\s*$/.test(l));
  if (i < 0) return null;
  const j = body.lines.findIndex((l, k) => k > i && /^```\s*$/.test(l));
  if (j < 0) return null;
  return { css: body.lines.slice(i + 1, j).join('\n'), startLine: body.startLine + i + 1 };
}

export function ruleDict(rules, { skip = () => false } = {}) {
  const dict = new Map();
  for (const rule of rules) {
    if (skip(rule)) continue;
    for (const d of rule.decls) {
      const key = `${rule.media.join(' ')} ${rule.selector} | ${d.prop}`;
      dict.set(key, { value: squash(d.value), line: d.line, file: rule.file });
    }
  }
  return dict;
}

export function parseFoundationsDoc(md) {
  const body = sectionBody(md, 13);
  if (!body) throw new Error('foundations.md에서 "## 13." 절을 찾지 못했다');
  const block = firstCssBlock(body);
  if (!block) throw new Error('foundations.md §13에서 ```css 블록을 찾지 못했다');
  const rules = parseCss(stripComments(block.css), { startLine: block.startLine }).rules;
  return rules;
}

export function dt14(ctx) {
  const out = [];
  const docRules = ctx.docRules ?? parseFoundationsDoc(ctx.foundations);
  const doc = ruleDict(docRules);
  const gen = new Map();
  for (const target of [ctx.app, ctx.worker]) {
    const rules = target.rules
      .filter((r) => TOKEN_SECTIONS.includes(r.section) && r.section !== 'dark-media')
      .map((r) => ({ ...r, file: target.file }));
    for (const [key, ent] of ruleDict(rules)) {
      const prev = gen.get(key);
      if (prev && prev.value !== ent.value) out.push(v('DT14', target.file, ent.line, key, `앱·Worker 생성물 값이 다르다: ${key} (${prev.value} ≠ ${ent.value})`));
      if (!prev) gen.set(key, ent);
    }
  }
  const nameOf = (key) => key.slice(key.lastIndexOf('| ') + 2);
  for (const [key, ent] of doc) {
    const g = gen.get(key);
    if (!g) out.push(v('DT14', FOUNDATIONS, ent.line, nameOf(key), `foundations §13에만 있다: ${key.trim()}`));
    else if (g.value !== ent.value) out.push(v('DT14', g.file, g.line, nameOf(key), `값이 다르다: ${key.trim()} 문서 «${ent.value}» ≠ 생성물 «${g.value}»`));
  }
  for (const [key, g] of gen) {
    if (!doc.has(key)) out.push(v('DT14', g.file, g.line, nameOf(key), `생성물에만 있다: ${key.trim()}`));
  }
  return out;
}

// ───────────────────────── DT15 상수 패리티(§14) ─────────────────────────

/** §14 표를 행 단위로 읽는다 → [{ names, values, fileCell, line }] */
export function parseConstTable(md) {
  const body = sectionBody(md, 14);
  if (!body) throw new Error('foundations.md에서 "## 14." 절을 찾지 못했다');
  const rows = [];
  body.lines.forEach((text, i) => {
    if (!text.startsWith('|')) return;
    const cells = text.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.length < 4) return;
    if (/^-+$/.test(cells[0].replace(/[:\s]/g, '')) || cells[0] === '이름') return;
    const names = [...cells[0].matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]);
    if (names.length === 0) return;
    const values = cells[1].split(' / ').map((s) => s.trim());
    rows.push({ names, values, fileCell: cells[3], line: body.startLine + i });
  });
  return rows;
}

const NUMERIC = /^\d+(?:\.\d+)?$/;
const toNumber = (s) => {
  const t = s.replace(/,/g, '');
  return NUMERIC.test(t) ? Number(t) : null;
};

/** 표 → { ts: Map(name → { value, line }), rs: Map(...), breakpoint } */
export function expectedConsts(rows) {
  const ts = new Map();
  const rs = new Map();
  const worker = new Map();
  let breakpoint = null;
  for (const row of rows) {
    if (row.names.length !== row.values.length) continue;
    row.names.forEach((name, i) => {
      const value = toNumber(row.values[i]);
      if (value === null) return;
      if (name === 'BREAKPOINT_NARROW') {
        breakpoint = { value, line: row.line };
        return;
      }
      if (row.fileCell.includes('timing.ts')) ts.set(name, { value, line: row.line });
      if (/\bRust\b(?!\()/.test(row.fileCell)) rs.set(name, { value, line: row.line });
      if (/\bWorker\b/.test(row.fileCell) && WORKER_CONSTS.has(name)) worker.set(name, { value, line: row.line });
    });
  }
  return { ts, rs, worker, breakpoint };
}

export function parseTimingConsts(src) {
  const map = new Map();
  src.split('\n').forEach((text, i) => {
    const m = /^export const ([A-Z][A-Z0-9_]*)\s*(?::\s*[^=]+)?=\s*([0-9_.]+)\s*;/.exec(text);
    if (m) map.set(m[1], { value: Number(m[2].replace(/_/g, '')), line: i + 1 });
  });
  return map;
}

export function parseRustConsts(src) {
  const map = new Map();
  src.split('\n').forEach((text, i) => {
    const m = /^pub const ([A-Z][A-Z0-9_]*)\s*:\s*[^=]+=\s*([0-9_.]+)\s*;/.exec(text);
    if (m) map.set(m[1], { value: Number(m[2].replace(/_/g, '')), line: i + 1 });
  });
  return map;
}

export function dt15(ctx) {
  const out = [];
  const { ts, rs, worker, breakpoint } = expectedConsts(parseConstTable(ctx.foundations));
  const compare = (file, src, want) => {
    const got = src === null || src === undefined ? new Map() : file === CONSTS_RS ? parseRustConsts(src) : parseTimingConsts(src);
    if (src === null || src === undefined) out.push(v('DT15', file, 0, file, `${file}이 없다`));
    for (const [name, exp] of want) {
      const g = got.get(name);
      if (!g) {
        if (src !== null && src !== undefined) out.push(v('DT15', file, 0, name, `${name}가 ${file}에 없다(표 ${exp.value})`));
      } else if (g.value !== exp.value) out.push(v('DT15', file, g.line, name, `${name} 값이 표와 다르다: 표 ${exp.value} ≠ 코드 ${g.value}`));
    }
    for (const [name, g] of got) if (!want.has(name)) out.push(v('DT15', file, g.line, name, `표에 없는 상수 ${name}`));
  };
  compare(TIMING_TS, ctx.timing, ts);
  compare(CONSTS_RS, ctx.consts, rs);
  // Worker 사본(core/notice.ts의 export const NAME = 숫자;): consts.rs와 같은 방식으로 표와 대조한다(서비스 공지 D41)
  compare(NOTICE_TS, ctx.notice, worker);
  if (!breakpoint) out.push(v('DT15', FOUNDATIONS, 0, 'BREAKPOINT_NARROW', '표에서 BREAKPOINT_NARROW 행을 찾지 못했다'));
  else if (breakpoint.value !== ctx.model.breakpointNarrow) {
    out.push(v('DT15', FOUNDATIONS, breakpoint.line, 'BREAKPOINT_NARROW', `BREAKPOINT_NARROW 표 ${breakpoint.value} ≠ 원천 ${ctx.model.breakpointNarrow}`));
  }
  return out;
}

// ───────────────────────── DT16 계산값 ─────────────────────────

/** 테마 조합: scheme(OS) × theme(data-theme) */
const THEME_COMBOS = [
  { scheme: 'light', theme: 'none' },
  { scheme: 'dark', theme: 'none' },
  { scheme: 'light', theme: 'light' },
  { scheme: 'dark', theme: 'light' },
  { scheme: 'light', theme: 'dark' },
  { scheme: 'dark', theme: 'dark' },
];
const comboLabel = (c) => `scheme=${c.scheme} theme=${c.theme}`;

export function dt16(ctx) {
  const out = [];
  for (const target of [ctx.app, ctx.worker]) {
    const rules = cascadeRules(target);
    const fail = (text, msg) => out.push(v('DT16', target.file, 0, text, msg));
    for (const combo of THEME_COMBOS) {
      // 대비 증가: --fg-muted·--separator·--border-strong = --fg
      const more = evalCascade(rules, { ...combo, contrastMore: true });
      const fg = resolveValue(more, '--fg');
      for (const name of ['--fg-muted', '--separator', '--border-strong']) {
        const got = resolveValue(more, name);
        if (got === undefined || got !== fg) fail(`contrast ${comboLabel(combo)} ${name}`, `대비 증가에서 ${name}가 --fg와 같아야 한다 (${comboLabel(combo)}): ${got} ≠ ${fg}`);
      }
      // 비활성 창: --accent-soft = --surface-2
      const inactive = evalCascade(rules, { ...combo, windowInactive: true });
      const soft = resolveValue(inactive, '--accent-soft');
      const s2 = resolveValue(inactive, '--surface-2');
      if (soft === undefined || soft !== s2) fail(`inactive ${comboLabel(combo)}`, `비활성 창에서 --accent-soft가 --surface-2와 같아야 한다 (${comboLabel(combo)}): ${soft} ≠ ${s2}`);
      // hover 면 ≠ 눌림 면
      const base = evalCascade(rules, combo);
      const hover = resolveValue(base, '--surface-2');
      const pressed = resolveValue(base, '--surface-pressed');
      if (hover === undefined || pressed === undefined || hover === pressed) fail(`pressed ${comboLabel(combo)}`, `--surface-2와 --surface-pressed가 달라야 한다 (${comboLabel(combo)}): ${hover} / ${pressed}`);
    }
  }
  return out;
}

// ───────────────────────── DT17 성공색 없음 ─────────────────────────

export function dt17(ctx) {
  const out = [];
  for (const t of ctx.model.tokens) {
    if (t.name.includes('success')) out.push(v('DT17', tokenFile(t), 0, t.name, `성공색 토큰 금지(ADR-0004): ${t.name}`));
    if (t.type === 'color' && t.name.includes('info')) out.push(v('DT17', tokenFile(t), 0, t.name, `info 색 토큰 금지(D10): ${t.name}`));
  }
  for (const d of uniqueDecls(ctx)) {
    if (d.prop.startsWith('--') && d.prop.includes('success')) out.push(v('DT17', d.file, d.line, d.prop, `성공색 선언 금지: ${d.prop}`));
  }
  return out;
}

// ───────────────────────── 진입점 ─────────────────────────

export const RULES = { DT2: dt2, DT3: dt3, DT4: dt4, DT5: dt5, DT6: dt6, DT7: dt7, DT8: dt8, DT9: dt9, DT10: dt10, DT11: dt11, DT12: dt12, DT13: dt13, DT14: dt14, DT15: dt15, DT16: dt16, DT17: dt17 };

export function runChecks(ctx) {
  if (!ctx.docRules) ctx = { ...ctx, docRules: parseFoundationsDoc(ctx.foundations) };
  const all = [];
  const seen = new Set();
  for (const fn of Object.values(RULES)) {
    for (const x of fn(ctx)) {
      const key = `${x.rule}|${x.file}|${x.line}|${x.text}`;
      if (seen.has(key)) continue; // 같은 줄의 같은 위반은 한 번만
      seen.add(key);
      all.push(x);
    }
  }
  return all;
}

export function check(root = ROOT) {
  return runChecks(buildContext(root));
}

function rootFromArgv(argv) {
  const i = argv.indexOf('--root');
  return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : ROOT;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const root = rootFromArgv(argv);
  process.exit(await runGate({ gate: 'design-tokens', families: FAMILIES, check, argv, root }));
}
