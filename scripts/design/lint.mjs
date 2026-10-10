#!/usr/bin/env node
// design-lint gate (docs/design/system/governance.md §2.3 DL·DS·DP, §2.9 DX1~DX13).
//
//   node scripts/design/lint.mjs                 # 허용 목록(allow.json)으로 거른 위반 → 0/1, 오류 2
//   node scripts/design/lint.mjs --print-allow   # 위반 전부를 허용 항목 JSON 배열로(단계 (a) 부트스트랩)
//   node scripts/design/lint.mjs --root <dir>    # 다른 저장소 루트
//
// 파일만 읽는다(`lint` 작업은 pnpm을 설치하지 않는다). 의존성 0.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, runGate } from './allow.mjs';
import { extractSvelte, lineOf, parseCss, stripComments } from './css.mjs';

export { ROOT };
export const FAMILIES = ['DL', 'DS', 'DP', 'DX'];

// ---------------------------------------------------------------------------
// 상수(허용 파일·예외는 코드 상수다. governance §2.3)
// ---------------------------------------------------------------------------

export const UI_DIR = 'app/src/lib/components/ui/';
export const VOCAB_PATH = 'app/src/lib/components/ui/vocab.ts';
const UI_CSS = 'design/ui.css';
const APP_CSS = 'app/src/app.css';
const SITE_CSS = 'worker/src/http/site.css';
const LAYOUT_CSS = 'app/src/styles/layout.css';
const TOKENS_CSS = 'app/src/styles/tokens.css';
const ICON_SVELTE = 'app/src/lib/components/ui/Icon.svelte';

/** 생성물 셋은 검사 대상이 아니다. */
const GENERATED = new Set([TOKENS_CSS, 'app/src/styles/ui.css', 'worker/src/http/site-css.generated.ts']);
/** DL13: 폭 쿼리를 쓸 수 있는 파일. */
const WIDTH_QUERY_FILES = new Set([TOKENS_CSS, LAYOUT_CSS, SITE_CSS]);
/** DS3: `:global(` 을 쓸 수 있는 파일. */
const GLOBAL_FILES = new Set([APP_CSS]);
/** DL5·DT4: `html { font-size: 16px }` 를 둘 수 있는 파일. */
const HTML_FONT_FILES = new Set([APP_CSS, SITE_CSS]);
/** DX4: 휠·제스처·컨텍스트 메뉴 리스너를 둘 수 있는 파일 이름. */
const GUARDS_BASENAME = 'guards.ts';
/** DX2: `cursor`·`user-select` 선언을 둘 수 있는 전역 CSS. */
const POINTER_STYLE_FILES = new Set([APP_CSS, SITE_CSS]);

/** DP2의 불리언 prop 허용 목록 기본값(vocab.ts가 있으면 그 파일의 값). */
const DEFAULT_BOOLEAN_PROPS = ['disabled', 'open', 'loading', 'required', 'readonly', 'invalid'];
/** DP4: label 또는 labelledby를 정확히 하나 받는(NameProps) 컴포넌트. */
const NAME_PROPS_COMPONENTS = ['TextField', 'SecretField', 'Select', 'Switch', 'RadioGroup', 'ProgressBar', 'Menu'];

const MSG = {
  DL1: '색 리터럴 금지(토큰 var(--…)만)',
  DL2: '길이 리터럴 금지(토큰 var(--…), 0, 선 굵기 1px·2px, 50%·100%만)',
  DL3: '시간 리터럴 금지(var(--motion-*)만)',
  DL4: 'z-index는 var(--z-*)만',
  DL5: '글자·반경 값은 var(--…)만(letter-spacing·-webkit-font-smoothing·line-height: normal 금지)',
  DL6: '컴포넌트에서 --ref-* 직접 사용 금지(sys 토큰만)',
  DL7: '컴포넌트 안 커스텀 속성 선언 금지(--p 하나만)',
  DL8: '금지된 선언(!important·transition: all·outline: none·forced-color-adjust·backdrop-filter·text-wrap·break-word·justify·cursor: pointer)',
  DL9: 'box-shadow는 var(--shadow-*)와 라디오 고리만, :focus 규칙 안에는 금지',
  DL10: '웹뷰 하한 밖 CSS 기능(foundations §11)',
  DL11: '1px 계산·가운데 정렬 translate·정지 상태 transform·상태 클래스 금지',
  DL12: ':hover 규칙이 표시·크기를 바꾸면 안 된다',
  DL13: '폭·포인터 미디어 쿼리는 허용 파일에서만',
  DL14: '선 굵기는 0·1px·2px만',
  DS1: 'ui/ 밖에서 원시 요소·role 금지(기본 컴포넌트를 쓴다)',
  DS2: '인라인 style 금지(style:--p 디렉티브만)',
  DS3: ':global( 금지(app.css만)',
  DS4: '{@html 금지',
  DS5: '<svg 직접 사용 금지(<Icon name>)',
  DS6: '.svelte 안 한글 리터럴·조각 결합 금지(문구는 copy deck에서만)',
  DS7: 'title= 속성은 허용 목록에 이유와 함께만',
  DS8: 'cursor: pointer가 앱 소스에 있다',
  DS9: 'Worker HTML 템플릿에 <style·style=·<script·onclick= 금지',
  DP1: 'vocab.ts 없음 또는 prop 값이 어휘 밖',
  DP2: 'ui/ 컴포넌트의 불리언 prop은 BOOLEAN_PROPS만',
  DP3: '이벤트 prop은 on + 소문자 동사 하나, 같은 뜻 둘 금지',
  DP4: '접근 이름(label·NameProps)이 필수 타입이어야 한다',
  DP5: 'IconButton의 icon 값이 ICON_BUTTON_ICONS 밖',
  DX1: 'data-tauri-drag-region·titleBarStyle·hiddenTitle 금지',
  DX2: 'cursor: not-allowed 금지, cursor·user-select 선언은 전역 CSS에만',
  DX3: '<img·<a 에는 draggable="false"가 필요하다',
  DX4: 'wheel·gesture·webkitmouseforce·contextmenu 리스너는 guards.ts에만',
  DX5: 'pointer 미디어 쿼리·maxTouchPoints·navigator.platform·userAgent 금지(플랫폼은 Rust가 준다)',
  DX6: 'IME 조합 입력 처리 규칙 위반(isImeKey, Enter 분기, compositionend + setTimeout)',
  DX7: 'navigator.clipboard.readText( 금지',
  DX8: 'prefers-contrast: less·custom 금지',
  DX9: '컨트롤에 height 선언 금지(min-height만)',
  DX10: '로딩 표시는 useDelayedLoading 경유, setTimeout에 숫자 리터럴 금지',
  DX11: '조사 선택 함수 금지',
  DX12: 'role="alert" 리터럴은 Notice.svelte에만',
  DX13: '오버레이에 color-mix(… transparent) 금지',
};

// ---------------------------------------------------------------------------
// 대상 파일
// ---------------------------------------------------------------------------

function walk(dir, rel, out) {
  if (!existsSync(dir)) return;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'target' || ent.name.startsWith('.')) continue;
    const r = `${rel}/${ent.name}`;
    if (ent.isDirectory()) walk(join(dir, ent.name), r, out);
    else out.push(r);
  }
}

/** 검사에서 빼는 경로(governance §2.3 제외 목록). */
export function isExcluded(rel) {
  return (
    GENERATED.has(rel) ||
    rel.endsWith('.test.ts') ||
    rel.endsWith('.d.ts') ||
    rel.startsWith('app/src/lib/bindings/') ||
    rel.startsWith('app/src/test/') ||
    rel.startsWith(`${UI_DIR}test/`)
  );
}

/** 검사 대상의 저장소 상대 경로(정렬). */
export function listTargets(root) {
  const all = [];
  if (existsSync(join(root, UI_CSS))) all.push(UI_CSS);
  const app = [];
  walk(join(root, 'app', 'src'), 'app/src', app);
  for (const r of app) if (/\.(svelte|css|ts)$/.test(r)) all.push(r);
  const http = join(root, 'worker', 'src', 'http');
  if (existsSync(http)) {
    for (const ent of readdirSync(http, { withFileTypes: true })) {
      if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name === 'site.css')) all.push(`worker/src/http/${ent.name}`);
    }
  }
  return all.filter((r) => !isExcluded(r)).sort();
}

// ---------------------------------------------------------------------------
// 글자 도우미
// ---------------------------------------------------------------------------

const lf = (s) => String(s).replace(/\r\n?/g, '\n');
const squash = (s) => s.replace(/\s+/g, ' ').trim();

/** HTML 주석을 지우되 줄바꿈 수는 남긴다. */
function stripHtmlComments(s) {
  return s.replace(/<!--[\s\S]*?(?:-->|$)/g, (m) => m.replace(/[^\n]/g, ''));
}

/**
 * JS/TS 주석을 지우되 줄바꿈 수는 남긴다. 문자열·템플릿 안은 건드리지 않는다.
 * 짝이 없는 따옴표가 뒤를 삼키지 않게 ' 와 " 문자열은 줄바꿈에서 닫는다(정규식 리터럴 안의 따옴표 대비).
 */
export function stripJsComments(code) {
  const s = lf(code);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== c && s[j] !== '\n') {
        if (s[j] === '\\') j++;
        j++;
      }
      const end = s[j] === c ? j + 1 : j;
      out += s.slice(i, end);
      i = end;
    } else if (c === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== '`') {
        if (s[j] === '\\') j++;
        j++;
      }
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && s[i + 1] === '/') {
      let j = i;
      while (j < s.length && s[j] !== '\n') j++;
      i = j;
    } else if (c === '/' && s[i + 1] === '*') {
      const close = s.indexOf('*/', i + 2);
      const end = close === -1 ? s.length : close + 2;
      out += s.slice(i, end).replace(/[^\n]/g, '');
      i = end;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** 소스에서 문자열 리터럴(`'…'`·`"…"`·템플릿)을 뽑는다. `${}` 안의 문자열도 따로 나온다. */
export function scanStrings(code, startLine = 1) {
  const out = [];
  let i = 0;
  const str = (q) => {
    const s = i;
    i++;
    while (i < code.length && code[i] !== q && code[i] !== '\n') {
      if (code[i] === '\\') i++;
      i++;
    }
    out.push({ value: code.slice(s + 1, i), line: lineOf(code, s, startLine) });
    if (code[i] === q) i++;
  };
  const tpl = () => {
    const s = i;
    i++;
    while (i < code.length && code[i] !== '`') {
      if (code[i] === '\\') {
        i += 2;
        continue;
      }
      if (code[i] === '$' && code[i + 1] === '{') {
        i += 2;
        body(true);
        continue;
      }
      i++;
    }
    out.push({ value: code.slice(s + 1, i), line: lineOf(code, s, startLine) });
    i++;
  };
  const body = (stopAtBrace) => {
    let depth = 0;
    while (i < code.length) {
      const c = code[i];
      if (c === '"' || c === "'") str(c);
      else if (c === '`') tpl();
      else {
        if (c === '{') depth++;
        else if (c === '}') {
          if (stopAtBrace && depth === 0) {
            i++;
            return;
          }
          depth--;
        }
        i++;
      }
    }
  };
  body(false);
  return out;
}

/** `open` 위치의 `{`와 짝인 `}` 위치(없으면 -1). 문자열은 건너뛴다. */
function braceMatch(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < code.length && code[i] !== c) {
        if (code[i] === '\\') i++;
        i++;
      }
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** 거꾸로: `close` 위치의 `}`와 짝인 `{` 위치(없으면 -1). */
function braceMatchBack(code, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === '}') depth++;
    else if (code[i] === '{' && --depth === 0) return i;
  }
  return -1;
}

/** 컴포넌트 `$props()` 타입 본문(interface Props {…}, type Props = {…}, 인라인 `}: {…} = $props()`). */
export function propsBodies(code) {
  const bodies = [];
  const re = /(?:interface\s+\w*Props\b[^{;]*|type\s+\w*Props\s*=[^{;]*)\{/g;
  let m;
  while ((m = re.exec(code))) {
    const open = m.index + m[0].length - 1;
    const close = braceMatch(code, open);
    if (close > open) bodies.push(code.slice(open + 1, close));
  }
  const pr = /=\s*\$props\s*\(\s*\)/g;
  while ((m = pr.exec(code))) {
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(code[j])) j--;
    if (code[j] === '}') {
      const open = braceMatchBack(code, j);
      if (open >= 0) bodies.push(code.slice(open + 1, j));
    }
  }
  return bodies;
}

/** 태그: `<name attrs>`. `{}` 안과 따옴표 안의 `>`는 끝이 아니다. */
export function findTags(markup, startLine = 1) {
  const tags = [];
  const re = /<([A-Za-z][\w:.-]*)/g;
  let m;
  while ((m = re.exec(markup))) {
    let i = m.index + m[0].length;
    let depth = 0;
    let q = null;
    const from = i;
    for (; i < markup.length; i++) {
      const c = markup[i];
      if (q) {
        if (c === q) q = null;
        continue;
      }
      if (depth === 0 && (c === '"' || c === "'")) q = c;
      else if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      else if (c === '>' && depth === 0) break;
    }
    tags.push({ name: m[1], attrs: markup.slice(from, i), index: m.index, line: lineOf(markup, m.index, startLine) });
    re.lastIndex = Math.max(re.lastIndex, from);
  }
  return tags;
}

/** 정적 속성 값: `a="v"`면 'v', `a={…}`면 null(동적), 없으면 undefined. */
export function attrValue(attrs, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\{[^}]*\\}))`);
  const m = re.exec(attrs);
  if (!m) return undefined;
  if (m[3] !== undefined) return null;
  return m[1] ?? m[2];
}

/** vocab.ts에서 `export const NAME = [...]` 배열들을 읽는다. 파일이 없으면 null. */
export function parseVocab(text) {
  const vocab = {};
  const re = /export\s+const\s+(\w+)\s*=\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(lf(text)))) vocab[m[1]] = [...m[2].matchAll(/['"]([^'"]*)['"]/g)].map((x) => x[1]);
  return vocab;
}

// ---------------------------------------------------------------------------
// CSS 검사(DL*, DX2·DX8·DX9·DX13, DS3)
// ---------------------------------------------------------------------------

const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);
/** 색 이름 낱말을 볼 속성(다른 속성의 값 낱말이 색 이름과 겹치는 오탐을 피한다). */
const COLOR_PROP_RE = /color|^(?:background|border|outline|fill|stroke|box-shadow|text-shadow|text-decoration|column-rule|filter)(?:-|$)|^(?:background|border|outline|fill|stroke|box-shadow|text-shadow|text-decoration|column-rule|filter)$/;

/** 값에서 따옴표 문자열·url(…)·var 이름을 걷어 낸다(오탐 방지). */
function scrub(value) {
  return value
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')
    .replace(/url\([^)]*\)/gi, 'url()')
    .replace(/var\(\s*--[\w-]+/gi, 'var(');
}

/** `calc(` 의 바깥쪽 범위 목록. */
function calcSpans(value) {
  const spans = [];
  const re = /calc\(/gi;
  let m;
  while ((m = re.exec(value))) {
    let depth = 0;
    let i = m.index + 4;
    for (; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')' && --depth === 0) break;
    }
    spans.push({ start: m.index, end: i + 1, text: value.slice(m.index, i + 1) });
    re.lastIndex = i;
  }
  return spans;
}

const RADIO_RING = 'inset 0 0 0 4px var(--surface)';
const STATE_SELECTOR_RE = /:(?:active|hover|focus|focus-visible|checked|disabled)(?![\w-])|\[(?:open|aria-[\w-]+|disabled|data-)/;
const HOVER_RE = /:hover(?![\w-])/;
const FOCUS_RE = /:focus(?:-visible)?(?![\w-])/;
const CONTROL_RE = /\.(?:btn|field|select|row)(?!\w)/;
const CONTROL_EXEMPT_RE = /icon|bar|knob|switch|progress|fill|track|spinner/i;

/**
 * CSS 한 덩어리를 검사한다. `startLine`은 `.svelte` `<style>` 안쪽 시작 줄.
 * `add(rule, line, text)`로 위반을 낸다.
 */
function checkCss(rel, css, startLine, add) {
  const { rules } = parseCss(css, { startLine });
  const isWorker = rel.startsWith('worker/');
  const seenMedia = new Set();

  for (const rule of rules) {
    const sel = rule.selector;

    // --- 미디어·at-rule 수준
    for (const m of rule.media) {
      const key = m;
      if (seenMedia.has(key)) continue;
      seenMedia.add(key);
      if (/\((?:any-)?pointer|\((?:any-)?hover|\((?:min-|max-)?width/.test(m) && !WIDTH_QUERY_FILES.has(rel)) {
        add('DL13', rule.line, m);
      }
      if (/^@(?:starting-style|scope|view-transition)\b/.test(m)) add('DL10', rule.line, m);
      if (/prefers-contrast\s*:\s*(?:less|custom)/.test(m)) add('DX8', rule.line, m);
    }

    // --- selector 수준
    if (/::-webkit-scrollbar|\[popover\]|:popover-open|::view-transition/.test(sel)) add('DL10', rule.line, sel);
    if (rel === UI_CSS && /\.(?:is-[\w-]+|active|open)(?![\w-])/.test(sel)) add('DL11', rule.line, sel);
    const controlSel = sel.split(',').some((p) => CONTROL_RE.test(p) && !CONTROL_EXEMPT_RE.test(p));
    const hoverSel = HOVER_RE.test(sel);
    const focusSel = FOCUS_RE.test(sel);
    const stateSel = STATE_SELECTOR_RE.test(sel);
    const inKeyframes = rule.media.some((m) => /^@(?:-webkit-)?keyframes\b/.test(m));
    const dropOverlay = /DropOverlay/.test(rel) || /drop/i.test(sel);

    for (const d of rule.decls) {
      const { prop, value } = d;
      const txt = `${prop}: ${value}`;
      const at = (r, t = txt) => add(r, d.line, t);
      const isVar = prop.startsWith('--');
      const clean = scrub(value);

      if (d.important) at('DL8', `${txt} !important`);

      if (isVar) {
        if (prop !== '--p') at('DL7', prop);
      }
      // DL6: 어디서든 --ref-* 직접 사용
      for (const m of value.matchAll(/var\(\s*(--ref-[\w-]+)/g)) at('DL6', m[1]);

      // DL10: 값·속성
      if (
        /^(?:scrollbar-gutter|scrollbar-width|accent-color|field-sizing|anchor-name|interpolate-size|corner-shape|view-transition[\w-]*)$/.test(prop) ||
        /light-dark\(|(?<![\w-])linear\(|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*from\b|\bAccentColor(?:Text)?\b|view-transition/i.test(clean)
      ) {
        at('DL10');
      }
      if (/prefers-contrast\s*:\s*(?:less|custom)/.test(value)) at('DX8');

      if (isVar) continue;

      // DL1: 색 리터럴
      let color = /#[0-9a-f]{3,8}(?![\w-])/i.test(clean) || /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(clean);
      if (!color && COLOR_PROP_RE.test(prop)) {
        for (const w of clean.toLowerCase().matchAll(/(?<![\w-])[a-z]+(?![\w-(])/g)) {
          if (NAMED_COLORS.has(w[0])) {
            color = true;
            break;
          }
        }
      }
      if (color) at('DL1');

      // DL2·DL11·DL14: 길이
      const borderLike = /^(?:border|outline)/.test(prop) && !prop.includes('radius');
      const spans = calcSpans(clean);
      const ring = prop === 'box-shadow' && value === RADIO_RING;
      // html { font-size: 16px } 는 DL5·DL2 모두의 예외다(DT4)
      const okHtmlSize = prop === 'font-size' && sel === 'html' && value === '16px' && HTML_FONT_FILES.has(rel);
      let dl2 = false;
      let dl14 = false;
      let dl11 = false;
      for (const s of spans) if (/[+-]\s*1px(?![\w.])/.test(s.text)) dl11 = true;
      if (!ring && !okHtmlSize) {
        for (const m of clean.matchAll(/(?<![\w.])(\d*\.?\d+)px(?![\w-])/gi)) {
          const n = Number(m[1]);
          if (n === 0) continue;
          const inCalc = spans.some((s) => m.index >= s.start && m.index < s.end);
          if (inCalc) {
            const signed = /[+-]\s*$/.test(clean.slice(0, m.index));
            if (n === 1 && signed && dl11) continue;
            dl2 = true;
          } else if (borderLike) {
            if (n !== 1 && n !== 2) dl14 = true;
          } else dl2 = true;
        }
      }
      if (dl2) at('DL2');
      if (dl14) at('DL14');
      if (/translate(?:3d|X|Y)?\(\s*-50%/i.test(clean)) dl11 = true;
      if (
        /^(?:transform|translate|rotate|scale)$/.test(prop) &&
        clean !== 'none' &&
        !stateSel &&
        !inKeyframes &&
        !/^scaleX\(/i.test(clean) &&
        !/spinner/i.test(sel)
      ) {
        dl11 = true;
      }
      if (dl11) at('DL11');

      // DL3: 시간
      if (/(?<![\w.#-])\d*\.?\d+m?s(?![\w-])/i.test(clean)) at('DL3');

      // DL4: z-index
      if (prop === 'z-index' && !/^var\(--z-[\w-]+\)$/.test(value)) at('DL4');

      // DL5: 글자·반경
      if (prop === 'letter-spacing' || prop === '-webkit-font-smoothing') at('DL5');
      else if (/^(?:font-size|font-weight|line-height|font-family)$|^border(?:-[a-z]+)*-radius$/.test(prop)) {
        const wide = /^(?:inherit|initial|unset|revert)$/.test(value);
        const fam = prop === 'font-family' ? /^var\(--font-(?:sans|mono)\)$/.test(value) : /^var\(--[\w-]+\)$/.test(value);
        if (!okHtmlSize && !wide && !fam) at('DL5');
      }

      // DL8
      if (
        ((prop === 'transition' || prop === 'transition-property') && /(?:^|[\s,])all(?=[\s,]|$)/.test(value)) ||
        (prop === 'outline' && /^(?:none|0|0px)(?:\s|$)/.test(value) && sel !== '[data-focus-container]:focus-visible') ||
        prop === 'forced-color-adjust' ||
        /^(?:-webkit-)?backdrop-filter$/.test(prop) ||
        /^text-wrap(?:-[a-z]+)?$/.test(prop) ||
        /\bbreak-word\b/.test(clean) ||
        (prop === 'text-align' && value === 'justify') ||
        (prop === 'cursor' && value === 'pointer' && !isWorker)
      ) {
        at('DL8');
      }

      // DL9
      if (prop === 'box-shadow') {
        if (focusSel || !(/^var\(--shadow-[\w-]+\)$/.test(value) || ring)) at('DL9');
      }

      // DL12
      if (hoverSel && (/^(?:display|visibility|opacity|width|height)$|^(?:min|max)-/.test(prop))) at('DL12');

      // DX2
      if (/not-allowed/.test(value) && prop === 'cursor') at('DX2');
      else if (/^(?:cursor|(?:-webkit-)?user-select)$/.test(prop) && !POINTER_STYLE_FILES.has(rel) && !(prop === 'cursor' && value === 'pointer')) at('DX2');

      // DX9
      if (prop === 'height' && controlSel) at('DX9');

      // DX13
      if (dropOverlay && /color-mix\(.*transparent/i.test(value)) at('DX13');
    }
  }

  // DL13: layout.css의 두 블록은 선언이 같아야 한다(foundations §8)
  if (rel === LAYOUT_CSS) {
    const norm = (decls) => decls.map((d) => `${d.prop}:${d.value}`).sort().join(';');
    const narrow = new Map();
    const xlarge = new Map();
    for (const r of rules) {
      if (r.media.some((m) => /^@media\s*\(\s*max-width\s*:\s*599px\s*\)$/.test(m))) narrow.set(r.selector, { v: norm(r.decls), line: r.line });
      const pre = ':root[data-text-scale="x-large"]';
      if (r.selector.startsWith(pre)) xlarge.set(r.selector.slice(pre.length).trim(), { v: norm(r.decls), line: r.line });
    }
    for (const [sel, a] of narrow) {
      const b = xlarge.get(sel);
      if (!b || b.v !== a.v) add('DL13', a.line, `layout.css 두 블록이 다르다: ${sel}`);
    }
    for (const [sel, b] of xlarge) if (!narrow.has(sel)) add('DL13', b.line, `layout.css 두 블록이 다르다: ${sel}`);
  }
}

// ---------------------------------------------------------------------------
// 소스 검사(DS*, DP*, DX*)
// ---------------------------------------------------------------------------

const HANGUL_RE = /[ㄱ-ㆎ가-힣]/;
const RAW_ELEMENTS = new Set(['button', 'input', 'select', 'textarea', 'dialog', 'progress']);
const ROLE_RAW = new Set(['dialog', 'switch', 'menu', 'alert']);

/** 정규식 전체 일치마다 `cb(match, line)`. */
function scan(text, startLine, re, cb) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  while ((m = g.exec(text))) {
    cb(m, lineOf(text, m.index, startLine));
    if (m[0] === '') g.lastIndex++;
  }
}

/** 함수 `name`의 몸통(중괄호 안) 글자. 못 찾으면 ''. */
function functionBody(pieces, name) {
  for (const p of pieces) {
    const re = new RegExp(`(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\s*=)[^{;]*\\{`);
    const m = re.exec(p.text);
    if (m) {
      const open = m.index + m[0].length - 1;
      const close = braceMatch(p.text, open);
      if (close > open) return p.text.slice(open, close);
    }
  }
  return '';
}

/**
 * 소스 파일(.svelte·.ts) 하나를 검사한다.
 * @param {string} rel 저장소 상대 경로
 * @param {string} src 원문
 * @param {{ vocab?: object|null }} opt vocab.ts 해석 결과(없으면 DP1·DP5 판정을 건너뛴다)
 */
function checkSource(rel, src, add, { vocab }) {
  const isSvelte = rel.endsWith('.svelte');
  const isApp = rel.startsWith('app/');
  const isWorker = rel.startsWith('worker/');
  const inUi = rel.startsWith(UI_DIR);
  const base = basename(rel);

  /** 검사할 덩어리: {text, startLine, role} */
  const pieces = [];
  let markup = '';
  let scripts = [];
  let styles = [];
  if (isSvelte) {
    const ex = extractSvelte(src);
    markup = stripHtmlComments(ex.markup);
    styles = ex.styles;
    scripts = ex.scripts.map((s) => ({ text: stripJsComments(s.code), startLine: s.startLine, role: 'script' }));
    pieces.push({ text: markup, startLine: 1, role: 'markup' }, ...scripts);
    for (const st of styles) {
      checkCss(rel, st.css, st.startLine, add);
      scan(stripComments(st.css), st.startLine, /:global\(/, (m, ln) => {
        if (!GLOBAL_FILES.has(rel)) add('DS3', ln, ':global(');
      });
    }
  } else {
    const code = stripJsComments(src);
    pieces.push({ text: code, startLine: 1, role: isWorker ? 'worker' : 'script' });
  }

  const codePieces = pieces.filter((p) => p.role !== 'markup');
  const allPieces = pieces;

  // ---------- 모든 소스 공통
  for (const p of allPieces) {
    // DX8
    scan(p.text, p.startLine, /prefers-contrast\s*:\s*(?:less|custom)/, (m, ln) => add('DX8', ln, m[0].replace(/\s+/g, ' ')));
  }

  if (isWorker) {
    const p = pieces[0];
    // DS2: 인라인 style, DS9: Worker HTML 템플릿 금지어
    scan(p.text, 1, /\bstyle\s*=/, (m, ln) => add('DS2', ln, 'style='));
    scan(p.text, 1, /<style\b|\bstyle\s*=|<script\b|\bonclick\s*=/, (m, ln) => add('DS9', ln, m[0].replace(/\s+/g, '')));
    return;
  }
  if (!isApp) return;

  // ---------- 앱: 마크업·스크립트 공통
  for (const p of allPieces) {
    scan(p.text, p.startLine, /data-tauri-drag-region|titleBarStyle|hiddenTitle/, (m, ln) => add('DX1', ln, m[0]));
    scan(p.text, p.startLine, /cursor\s*:\s*pointer/, (m, ln) => add('DS8', ln, 'cursor: pointer'));
    scan(p.text, p.startLine, /navigator\s*\.\s*clipboard\s*\.\s*readText\s*\(/, (m, ln) => add('DX7', ln, 'navigator.clipboard.readText('));
    scan(p.text, p.startLine, /matchMedia\(\s*['"`]\s*\((?:any-)?pointer/, (m, ln) => add('DX5', ln, 'matchMedia((pointer'));
    scan(p.text, p.startLine, /maxTouchPoints|navigator\s*\.\s*platform|navigator\s*\.\s*userAgent/, (m, ln) => add('DX5', ln, m[0].replace(/\s+/g, '')));
    scan(p.text, p.startLine, /\b(\w*(?:josa|particle)\w*)\s*\(/i, (m, ln) => add('DX11', ln, m[1]));
    if (base !== GUARDS_BASENAME) {
      scan(p.text, p.startLine, /addEventListener\(\s*['"`](wheel|gesturestart|gesturechange|webkitmouseforce\w*|contextmenu)['"`]/, (m, ln) => add('DX4', ln, m[1]));
      scan(p.text, p.startLine, /(?<![\w$.])on:?(wheel|gesturestart|gesturechange|webkitmouseforce\w*|contextmenu)\b/, (m, ln) => add('DX4', ln, m[1]));
    }
    // DX10: 숫자 리터럴 지연 setTimeout
    scan(p.text, p.startLine, /setTimeout\s*\(/, (m, ln) => {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      const t = p.text;
      for (; i < t.length; i++) {
        if (t[i] === '(') depth++;
        else if (t[i] === ')' && --depth === 0) break;
      }
      const args = t.slice(m.index + m[0].length, i);
      const last = /,\s*(\d[\d_.]*)\s*$/.exec(args);
      if (last && !/useDelayedLoading/i.test(base)) add('DX10', ln, `setTimeout(…, ${last[1]})`);
    });
  }

  // DX6: keydown 리스너 파일은 isImeKey를 쓴다
  {
    const joined = codePieces.map((p) => p.text).join('\n') + '\n' + markup;
    const hasImeKey = /\bisImeKey\b/.test(joined);
    for (const p of allPieces) {
      scan(p.text, p.startLine, /addEventListener\(\s*['"`]keydown['"`]|(?<![\w$.])on:?keydown\b/, (m, ln) => {
        if (!hasImeKey) add('DX6', ln, 'keydown without isImeKey');
      });
      scan(p.text, p.startLine, /compositionend[\s\S]{0,300}?setTimeout/, (m, ln) => add('DX6', ln, 'compositionend+setTimeout'));
    }
  }

  // ---------- .svelte 마크업
  if (isSvelte) {
    const tags = findTags(markup);
    for (const t of tags) {
      const lname = t.name;
      // DS1·DX12
      if (RAW_ELEMENTS.has(lname) && !inUi) add('DS1', t.line, `<${lname}`);
      const role = attrValue(t.attrs, 'role');
      if (typeof role === 'string' && ROLE_RAW.has(role)) {
        if (!inUi) add('DS1', t.line, `role="${role}"`);
        else if (role === 'alert' && base !== 'Notice.svelte') add('DX12', t.line, 'role="alert"');
      }
      if (inUi && base === 'Spinner.svelte') {
        if (role !== undefined) add('DS1', t.line, 'Spinner role');
        if (attrValue(t.attrs, 'aria-label') !== undefined) add('DS1', t.line, 'Spinner aria-label');
      }
      // DS2: 인라인 style
      for (const m of t.attrs.matchAll(/(?:^|\s)(style\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))/g)) add('DS2', t.line, squash(m[1]));
      for (const m of t.attrs.matchAll(/(?:^|\s)style:([\w-]+)/g)) if (m[1] !== '--p') add('DS2', t.line, `style:${m[1]}`);
      // DS5: <svg
      if (lname === 'svg' && rel !== ICON_SVELTE) add('DS5', t.line, '<svg');
      // DS7: title=
      for (const m of t.attrs.matchAll(/(?:^|\s)(title\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]*\}))/g)) add('DS7', t.line, squash(m[1]));
      // DX3: draggable
      if ((lname === 'img' || lname === 'a') && !/(?:^|\s)draggable\s*=\s*(?:"false"|'false'|\{\s*false\s*\})/.test(t.attrs)) add('DX3', t.line, `<${lname}`);
      // DP1·DP5: 컴포넌트 사용처의 어휘
      if (vocab && /^[A-Z]/.test(lname)) {
        const pick = (arr) => arr ?? [];
        const table = {
          variant: [...pick(vocab.BUTTON_VARIANT), ...pick(vocab.NOTICE_VARIANT)],
          tone: pick(vocab.TONE),
          size: pick(vocab.SIZE),
          kind: pick(vocab.KIND),
          state: pick(vocab.PROGRESS_STATE),
        };
        for (const [attr, allowed] of Object.entries(table)) {
          const v = attrValue(t.attrs, attr);
          if (typeof v === 'string' && !v.includes('{') && !allowed.includes(v)) add('DP1', t.line, `${attr}="${v}"`);
        }
        if (lname === 'IconButton') {
          const icon = attrValue(t.attrs, 'icon');
          if (typeof icon === 'string' && !(vocab.ICON_BUTTON_ICONS ?? []).includes(icon)) add('DP5', t.line, `icon="${icon}"`);
        }
      }
      // DX6: <input> 의 onkeydown 안에 Enter 분기
      if (lname === 'input') {
        const m = /(?:^|\s)onkeydown\s*=\s*\{([^}]*)\}/.exec(t.attrs);
        if (m) {
          const expr = m[1].trim();
          const body = /^[\w$]+$/.test(expr) ? functionBody(codePieces, expr) : expr;
          if (/['"`]Enter['"`]/.test(body)) add('DX6', t.line, 'input onkeydown Enter');
        }
      }
    }
    // DX10: Spinner·Skeleton은 useDelayedLoading 경유
    if (!inUi) {
      const uses = tags.find((t) => t.name === 'Spinner' || t.name === 'Skeleton');
      const hook = codePieces.some((p) => /useDelayedLoading/.test(p.text));
      if (uses && !hook) add('DX10', uses.line, `<${uses.name} without useDelayedLoading`);
    }
    // DS4: {@html
    scan(markup, 1, /\{@html\b/, (m, ln) => add('DS4', ln, '{@html'));
    // DS6: 한글 리터럴(마크업 텍스트·속성 값), 템플릿 aria-label, 조각 결합
    scan(markup, 1, /[^<>{}"'`]+/, (m, ln) => {
      if (HANGUL_RE.test(m[0])) add('DS6', ln + (m[0].match(/^\s*/)[0].match(/\n/g)?.length ?? 0), squash(m[0]));
    });
    scan(markup, 1, /aria-label\s*=\s*\{\s*`[^`]*`\s*\}/, (m, ln) => add('DS6', ln, squash(m[0])));
    scan(markup, 1, /\}\s*·\s*\{/, (m, ln) => add('DS6', ln, squash(m[0])));
    scan(markup, 1, /\.join\(\s*(['"`])\s*(?:,|·)\s*\1\s*\)/, (m, ln) => add('DS6', ln, m[0]));
    // 스크립트 안 문자열
    for (const p of scripts) {
      for (const s of scanStrings(p.text, p.startLine)) {
        if (HANGUL_RE.test(s.value)) add('DS6', s.line, squash(s.value));
        if (/^\s*·\s*$/.test(s.value) || (s.value.includes('${') && s.value.includes('·'))) add('DS6', s.line, squash(s.value));
      }
      scan(p.text, p.startLine, /\.join\(\s*(['"`])\s*(?:,|·)\s*\1\s*\)/, (m, ln) => add('DS6', ln, m[0]));
    }
  }

  // ---------- ui/ 컴포넌트의 prop 선언(DP2~DP4)
  if (isSvelte && inUi && !rel.startsWith(`${UI_DIR}test/`)) {
    const bool = vocab?.BOOLEAN_PROPS ?? DEFAULT_BOOLEAN_PROPS;
    const bodies = scripts.flatMap((p) => propsBodies(p.text));
    const names = new Set();
    for (const body of bodies) {
      for (const m of body.matchAll(/(?:^|[;,{\n])\s*(\w+)\??\s*:\s*boolean\b/g)) {
        if (!bool.includes(m[1])) add('DP2', 1, m[1]);
      }
      for (const m of body.matchAll(/(?:^|[;,{\n])\s*(on\w*)\??\s*:/g)) {
        names.add(m[1]);
        if (!/^on[a-z]+$/.test(m[1])) add('DP3', 1, m[1]);
      }
    }
    if (names.has('onclose') && names.has('ondismiss')) add('DP3', 1, 'onclose+ondismiss');
    const component = base.replace(/\.svelte$/, '');
    const joined = bodies.join('\n');
    if (component === 'IconButton') {
      if (!/(?:^|[;,{\n])\s*label\s*:/.test(joined)) add('DP4', 1, 'IconButton label');
    } else if (NAME_PROPS_COMPONENTS.includes(component) && !/\bNameProps\b/.test(scripts.map((s) => s.text).join('\n'))) {
      add('DP4', 1, `${component} NameProps`);
    }
  }
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

/**
 * 파일 하나를 검사한다(테스트에서 직접 부른다).
 * @returns {{rule:string,file:string,line:number,text:string,msg:string}[]}
 */
export function lintFile(rel, src, { vocab = null } = {}) {
  const out = [];
  const text = lf(src);
  const add = (rule, line, t) => out.push({ rule, file: rel, line, text: t, msg: `${MSG[rule] ?? rule}: ${t}` });
  if (rel.endsWith('.css')) {
    checkCss(rel, text, 1, add);
    scan(stripComments(text), 1, /:global\(/, (m, ln) => {
      if (!GLOBAL_FILES.has(rel)) add('DS3', ln, ':global(');
    });
  } else {
    checkSource(rel, text, add, { vocab });
  }
  return out;
}

/** 위반을 (규칙, 파일, 글자)가 같고 줄만 다른 중복 없이 정렬해 돌려준다. */
function finalize(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const key = `${v.rule}|${v.file}|${v.line}|${v.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  // 파일 단위로 한 번만 말하는 규칙: 같은 (규칙, 파일, 글자)의 첫 줄만 남긴다
  const once = new Set(['DL13', 'DX8']);
  const seenOnce = new Set();
  return out
    .filter((v) => {
      if (!once.has(v.rule)) return true;
      const k = `${v.rule}|${v.file}|${v.text}`;
      if (seenOnce.has(k)) return false;
      seenOnce.add(k);
      return true;
    })
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)));
}

/** 저장소 전체를 검사한다. */
export function check(root = ROOT) {
  const out = [];
  const vocabPath = join(root, VOCAB_PATH);
  let vocab = null;
  if (existsSync(vocabPath)) vocab = parseVocab(readFileSync(vocabPath, 'utf8'));
  else out.push({ rule: 'DP1', file: VOCAB_PATH, line: 0, text: 'vocab.ts 없음', msg: `${MSG.DP1}: vocab.ts 없음` });
  for (const rel of listTargets(root)) {
    out.push(...lintFile(rel, readFileSync(join(root, rel), 'utf8'), { vocab }));
  }
  return finalize(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runGate({ gate: 'design-lint', families: FAMILIES, check, argv: process.argv.slice(2), root: ROOT });
}
