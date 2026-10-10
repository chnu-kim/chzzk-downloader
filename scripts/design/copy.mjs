#!/usr/bin/env node
// design-copy gate(docs/design/system/governance.md §2.4, DC1~DC12).
// 문구 원천(copy deck)인 app/src/lib/copy/ko.ts·errors.ts, worker/src/http/copy.ts와 help/*.md를 읽어
// 용어집·어미·조사·구두점·키 규칙을 검사한다. 기계 원천은 design/copy/terms.json이고,
// 사람 원천 content.md §4 용어집 표와 양방향 패리티를 본다(허용 목록 없이 통과해야 한다).
// 의존성 0(Node 표준 모듈만). 위반 레코드는 계약 §1.3 모양 { rule, file, line, text, msg }.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runGate } from './allow.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FAMILIES = ['DC'];

export const FILES = {
  ko: 'app/src/lib/copy/ko.ts',
  errors: 'app/src/lib/copy/errors.ts',
  worker: 'worker/src/http/copy.ts',
};
export const TERMS_PATH = 'design/copy/terms.json';
const CONTENT_MD = 'docs/design/system/content.md';
const DOC_FILES = ['docs/design/system/patterns.md', 'docs/design/system/web.md'];
const HELP_DIR = 'help';

const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;
/** help/*.md에 적용하는 규칙(governance DC11: 도움말 원천은 DC1·DC2·DC5 대상) */
const HELP_RULES = new Set(['DC1', 'DC2', 'DC5']);
/** 키 접미로 쓰지 않는 말(content.md §2 키 이름, §15.1 `lead` 없음) */
const BANNED_SUFFIXES = ['tip', 'why', 'danger', 'word', 'NoBytes', 'lead'];
/** 앱과 Worker의 값이 바이트까지 같아야 하는 상수(governance DC6, content.md §2 두 deck 공통 상수) */
const SHARED_CONSTANTS = [
  ['NOTICE_UNOFFICIAL', 'notice.unofficial'],
  ['NOTICE_SHORT', 'notice.short'],
  ['skipLink'],
  ['copyright'],
  ['app.title', 'siteName'],
];

// ---------------------------------------------------------------------------
// TS 토크나이저(주석 제거, 문자열·템플릿·정규식 리터럴 구분, 줄 번호)
// ---------------------------------------------------------------------------

const ID_START = /[A-Za-z_$]/;
const ID_PART = /[A-Za-z0-9_$]/;
const OPENS = new Set(['(', '[', '{']);
const CLOSES = new Set([')', ']', '}']);
/** 이 구두점 뒤의 `/`는 나눗셈이 아니라 정규식 리터럴의 시작이다 */
const REGEX_PREV = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', '=>', '??']);

/**
 * TS 소스를 토큰으로 나눈다. 토큰은 { t: 'str'|'id'|'num'|'p'|'re', v, line }이다.
 * 문자열 토큰은 이스케이프를 푼 값이고, 백틱은 `tpl: true`에 `${식}`을 `{이름}`(단순 식별자) 또는
 * `{expr}`로 정규화한 값이다. 템플릿 식 안의 문자열은 `inner`에 따로 담는다.
 * 문자열 토큰에는 `key`(객체 키 자리)·`meta`(import 경로·case 라벨)가 붙는다.
 */
export function tokenize(src, startLine = 1) {
  const toks = [];
  const n = src.length;
  let i = 0;
  let line = startLine;

  function readEscape() {
    const c = src[i + 1];
    i += 2;
    switch (c) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'v': return '\v';
      case '0': return '\0';
      case 'x': {
        const h = src.slice(i, i + 2);
        i += 2;
        return String.fromCharCode(parseInt(h, 16));
      }
      case 'u': {
        if (src[i] === '{') {
          const e = src.indexOf('}', i);
          const cp = parseInt(src.slice(i + 1, e), 16);
          i = e + 1;
          return String.fromCodePoint(cp);
        }
        const h = src.slice(i, i + 4);
        i += 4;
        return String.fromCharCode(parseInt(h, 16));
      }
      case '\r':
        if (src[i] === '\n') i++;
        line++;
        return '';
      case '\n':
        line++;
        return '';
      default:
        return c ?? '';
    }
  }

  function readString(q) {
    const startLineNo = line;
    i++;
    let v = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') {
        v += readEscape();
        continue;
      }
      if (src[i] === '\n') break; // 닫히지 않은 문자열: 여기서 끊는다
      v += src[i++];
    }
    i++;
    return { t: 'str', v, line: startLineNo };
  }

  function readTemplate() {
    const startLineNo = line;
    i++;
    let v = '';
    const inner = [];
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') {
        v += readEscape();
        continue;
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        const exprStart = i;
        const exprLine = line;
        let depth = 1;
        while (i < n) {
          const ch = src[i];
          if (ch === '\n') {
            line++;
            i++;
            continue;
          }
          if (ch === '"' || ch === "'") {
            readString(ch);
            continue;
          }
          if (ch === '`') {
            readTemplate();
            continue;
          }
          if (ch === '{') depth++;
          else if (ch === '}' && --depth === 0) break;
          i++;
        }
        const expr = src.slice(exprStart, i);
        i++;
        for (const t of tokenize(expr, exprLine)) if (t.t === 'str') inner.push(t);
        v += /^\s*[A-Za-z_$][\w$]*\s*$/.test(expr) ? `{${expr.trim()}}` : '{expr}';
        continue;
      }
      if (src[i] === '\n') line++;
      v += src[i++];
    }
    i++;
    return { t: 'str', v, line: startLineNo, tpl: true, inner };
  }

  function regexAllowed() {
    const p = toks[toks.length - 1];
    if (!p) return true;
    if (p.t === 'p') return REGEX_PREV.has(p.v);
    if (p.t === 'id') return ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void'].includes(p.v);
    return false;
  }

  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      toks.push(readString(c));
      continue;
    }
    if (c === '`') {
      toks.push(readTemplate());
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) {
          ok = true;
          break;
        }
        j++;
      }
      if (ok) {
        j++;
        while (j < n && /[A-Za-z]/.test(src[j])) j++;
        toks.push({ t: 're', v: src.slice(i, j), line });
        i = j;
        continue;
      }
    }
    if (ID_START.test(c)) {
      let j = i + 1;
      while (j < n && ID_PART.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(src[j])) j++;
      toks.push({ t: 'num', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    const three = src.slice(i, i + 3);
    if (three === '...') {
      toks.push({ t: 'p', v: '...', line });
      i += 3;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '=>' || two === '?.' || two === '??') {
      toks.push({ t: 'p', v: two, line });
      i += 2;
      continue;
    }
    toks.push({ t: 'p', v: c, line });
    i++;
  }

  // 객체 키 자리·import/case 문자열 표시(사용자에게 보이는 문구가 아니다)
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'str') continue;
    const prev = toks[k - 1];
    const next = toks[k + 1];
    if (next?.t === 'p' && next.v === ':' && prev?.t === 'p' && (prev.v === '{' || prev.v === ',')) t.key = true;
    if (prev?.t === 'id' && ['case', 'from', 'import'].includes(prev.v)) t.meta = true;
    if (prev?.t === 'p' && prev.v === '(' && toks[k - 2]?.t === 'id' && toks[k - 2].v === 'import') t.meta = true;
  }
  return toks;
}

/** 토큰 열의 모든 문자열 토큰(템플릿 식 안의 것 포함). 객체 키·import 경로·case 라벨은 뺀다. */
export function allStrings(toks) {
  const out = [];
  const walk = (list) => {
    for (const t of list) {
      if (t.t !== 'str') continue;
      if (!t.key && !t.meta) out.push(t);
      if (t.inner) walk(t.inner);
    }
  };
  walk(toks);
  return out;
}

export function matchClose(toks, i) {
  let d = 0;
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.t !== 'p') continue;
    if (OPENS.has(t.v)) d++;
    else if (CLOSES.has(t.v) && --d === 0) return j;
  }
  return toks.length - 1;
}

/** 값 식의 끝: 깊이 0의 `,` 또는 바깥을 닫는 `}`·`)`·`]`의 위치(소비하지 않는다) */
export function exprEnd(toks, i) {
  let d = 0;
  for (let j = i; j < toks.length; j++) {
    const t = toks[j];
    if (t.t !== 'p') continue;
    if (OPENS.has(t.v)) d++;
    else if (CLOSES.has(t.v)) {
      if (d === 0) return j;
      d--;
    } else if (t.v === ',' && d === 0) return j;
  }
  return toks.length;
}

const isP = (t, v) => t?.t === 'p' && t.v === v;

/** 값 식에서 사용자 문구 문자열 토큰을 모은다(조각별로 따로) */
function valueStrings(toks, from, to) {
  const out = [];
  for (let j = from; j < to; j++) {
    const t = toks[j];
    if (t.t === 'str' && !t.key && !t.meta) out.push(t);
  }
  return out;
}

function parseObject(toks, i, path, out) {
  while (i < toks.length) {
    const tk = toks[i];
    if (isP(tk, '}')) return i;
    if (isP(tk, ',')) {
      i++;
      continue;
    }
    if (isP(tk, '...')) {
      i = exprEnd(toks, i + 1);
      continue;
    }
    let key = null;
    if ((tk.t === 'str' && !tk.tpl) || tk.t === 'id' || tk.t === 'num') {
      key = tk.v;
      i++;
    } else if (isP(tk, '[')) {
      i = matchClose(toks, i) + 1;
      if (isP(toks[i], ':')) i = exprEnd(toks, i + 1);
      continue;
    } else {
      i++;
      continue;
    }
    if (isP(toks[i], ':')) {
      i++;
      if (isP(toks[i], '{')) {
        i = parseObject(toks, i + 1, [...path, key], out) + 1;
        continue;
      }
      const end = exprEnd(toks, i);
      const full = [...path, key].join('.');
      for (const s of valueStrings(toks, i, end)) {
        s.entryKey = full;
        out.push({ key: full, value: s.v, line: s.line, tok: s });
      }
      i = end;
    } else if (isP(toks[i], '(')) {
      // 메서드 축약형: 매개변수와 몸통을 건너뛴다
      i = matchClose(toks, i) + 1;
      if (isP(toks[i], '{')) i = matchClose(toks, i) + 1;
    }
    // 그 밖(축약 속성)은 다음 토큰으로
  }
  return i;
}

/** 최상위 `const X = { … }` 객체의 중첩 키 경로 → 값, 최상위 `const X = '…'` 문자열 */
function parseDeck(toks) {
  const out = [];
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'p') {
      if (OPENS.has(t.v)) depth++;
      else if (CLOSES.has(t.v)) depth--;
      continue;
    }
    if (depth !== 0 || t.t !== 'id' || !['const', 'let', 'var'].includes(t.v)) continue;
    const name = toks[i + 1];
    if (name?.t !== 'id') continue;
    let j = i + 2;
    let d = 0;
    for (; j < toks.length; j++) {
      const u = toks[j];
      if (u.t !== 'p') continue;
      if (OPENS.has(u.v)) d++;
      else if (CLOSES.has(u.v)) d--;
      else if (u.v === '=' && d === 0) break;
      else if (u.v === ';' && d === 0) {
        j = toks.length;
        break;
      }
    }
    const k = j + 1;
    if (k >= toks.length) continue;
    if (isP(toks[k], '{')) {
      i = parseObject(toks, k + 1, [], out);
    } else if (toks[k].t === 'str') {
      let m = k;
      const pieces = [toks[m]];
      while (isP(toks[m + 1], '+') && toks[m + 2]?.t === 'str') {
        m += 2;
        pieces.push(toks[m]);
      }
      for (const s of pieces) {
        s.entryKey = name.v;
        out.push({ key: name.v, value: s.v, line: s.line, tok: s, top: true });
      }
      i = m;
    }
  }
  return out;
}

/**
 * copy deck 소스에서 { key, value, line } 목록을 뽑는다. 키는 중첩 객체 경로를 `.`로 이은 것이고
 * (평평한 `'a.b': '…'` 키도 그대로), 문자열을 `+`로 이은 식과 삼항·화살표 함수 몸통의 문자열은
 * 조각마다 같은 키로 나온다. 템플릿의 `${n}`은 `{n}`으로 정규화한다.
 */
export function deckEntries(source) {
  return parseDeck(tokenize(source)).map(({ key, value, line }) => ({ key, value, line }));
}

/**
 * errors.ts는 객체 deck이 아니라 `copy(title, body, …)` 호출로 문구를 조합한다.
 * `case '<코드>'` 안의 첫 인자를 `errors.<코드>.title`, 둘째 인자를 `errors.<코드>.body`로 본다(합성 키).
 */
function parseErrors(toks) {
  const out = [];
  let code = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === 'id' && t.v === 'case' && toks[i + 1]?.t === 'str') {
      code = toks[i + 1].v;
      continue;
    }
    if (t.t !== 'id' || t.v !== 'copy' || !isP(toks[i + 1], '(') || toks[i - 1]?.v === 'function') continue;
    const close = matchClose(toks, i + 1);
    let argStart = i + 2;
    let argNo = 0;
    while (argStart < close && argNo < 2) {
      const end = Math.min(exprEnd(toks, argStart), close);
      const role = argNo === 0 ? 'title' : 'body';
      for (const s of valueStrings(toks, argStart, end)) {
        const key = `errors.${code ?? 'unknown'}.${role}`;
        s.entryKey = key;
        out.push({ key, value: s.v, line: s.line, tok: s, synthetic: true });
      }
      argStart = end + 1;
      argNo++;
    }
    i = close;
  }
  return out;
}

/** errors.ts 소스에서 합성 키 `errors.<코드>.title|body`의 { key, value, line } 목록 */
export function errorEntries(source) {
  return parseErrors(tokenize(source)).map(({ key, value, line }) => ({ key, value, line }));
}

// ---------------------------------------------------------------------------
// 파일·문서 읽기
// ---------------------------------------------------------------------------

function readText(root, rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
}

function walk(dir, accept, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'bindings') continue;
      walk(p, accept, out);
    } else if (accept(name)) out.push(p);
  }
  return out;
}

/** 마크다운 표 한 줄을 셀로 나눈다(`\|`는 구분자가 아니다) */
function cells(line) {
  return line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
}

function section(md, headingRe) {
  const lines = md.split('\n');
  const s = lines.findIndex((l) => headingRe.test(l));
  if (s < 0) return [];
  let e = lines.findIndex((l, i) => i > s && /^## /.test(l));
  if (e < 0) e = lines.length;
  return lines.slice(s, e).map((text, k) => ({ n: s + k + 1, text }));
}

const stripMd = (x) => x.replace(/\*\*/g, '').replace(/`/g, '').trim();

/** 괄호 안의 쉼표는 구분자가 아니다 */
function splitTop(str) {
  const out = [];
  let d = 0;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '(' || c === '（') d++;
    if (c === ')' || c === '）') d--;
    if (c === ',' && d === 0 && str[i + 1] === ' ') {
      out.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** content.md §4 용어집 표 → [{ concept, avoid: string[], line }] */
export function parseGlossaryTable(md) {
  const rows = [];
  for (const { n, text } of section(md, /^## 4\. /)) {
    if (!text.startsWith('|')) continue;
    const c = cells(text);
    if (c.length < 3 || c[0] === '개념' || /^-+$/.test(c[0])) continue;
    rows.push({ concept: stripMd(c[0]), avoid: splitTop(stripMd(c[2]).replace(/["“”]/g, '')), line: n });
  }
  return rows;
}

const KEY_RE = '[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z0-9]+)+';

/** content.md §15 표의 "새 키·문구" 열에서 `` `키` **값** `` 쌍을 뽑는다 */
export function parseNewCopyPairs(md) {
  const pairs = [];
  const keys = new Set();
  let col = -1;
  for (const { n, text } of section(md, /^## 15\. /)) {
    if (!text.startsWith('|')) {
      col = -1;
      continue;
    }
    // 표의 백틱 키만 "문서가 아는 키"로 본다(문단에 적힌 지운 키는 뺀다)
    for (const m of text.matchAll(new RegExp('`(' + KEY_RE + '|[a-z][A-Za-z0-9]+)(?:\\.\\*)?`', 'g'))) keys.add(m[1]);
    const c = cells(text);
    if (/^-+$/.test(c[0] ?? '')) continue;
    const head = c.findIndex((x) => /^새\b|^새 /.test(x));
    if (head >= 0 && !c.some((x) => /`/.test(x))) {
      col = head;
      continue;
    }
    if (col < 0 || c.length <= col) continue;
    for (const m of c[col].matchAll(new RegExp('`(' + KEY_RE + ')`\\s*\\*\\*(.+?)\\*\\*', 'g'))) {
      pairs.push({ key: m[1], value: m[2].replace(/\s+/g, ' ').trim(), line: n });
    }
  }
  return { pairs, keys };
}

/** patterns.md·web.md 본문(코드 블록 밖)의 백틱 키 → [{ key, line }] */
export function parseDocKeys(md, knownKeys) {
  const out = [];
  let fenced = false;
  const lines = md.split('\n');
  for (let k = 0; k < lines.length; k++) {
    const text = lines[k];
    if (/^\s*```/.test(text)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const m of text.matchAll(/`([^`]+)`/g)) {
      const key = m[1];
      if (!new RegExp('^' + KEY_RE + '$').test(key)) continue;
      if (/\.(?:md|ts|css|json|svelte|mjs|rs|html|yml|toml|svg|png|ico|js)$/.test(key)) continue;
      const last = key.split('.').pop();
      if (['title', 'body', 'help', 'label', 'a11y'].includes(last) || knownKeys.has(key)) out.push({ key, line: k + 1 });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// terms.json
// ---------------------------------------------------------------------------

export function loadTerms(root) {
  const text = readText(root, TERMS_PATH);
  if (text === null) throw new Error(`${TERMS_PATH}가 없다`);
  let t;
  try {
    t = JSON.parse(text);
  } catch (e) {
    throw new Error(`${TERMS_PATH}: JSON이 깨졌다: ${e.message}`);
  }
  const bad = (m) => {
    throw new Error(`${TERMS_PATH}: ${m}`);
  };
  if (!Array.isArray(t.glossary)) bad('glossary가 배열이 아니다');
  if (!t.patterns || typeof t.patterns !== 'object') bad('patterns가 객체가 아니다');
  if (!Array.isArray(t.rules)) bad('rules가 배열이 아니다');
  if (!Array.isArray(t.interjections)) bad('interjections가 배열이 아니다');
  if (!Array.isArray(t.opensWindow)) bad('opensWindow가 배열이 아니다');
  if (!Array.isArray(t.allow)) bad('allow가 배열이 아니다');
  for (const g of t.glossary) {
    if (typeof g.concept !== 'string' || !Array.isArray(g.use) || !Array.isArray(g.avoid)) bad('glossary 항목 모양이 틀렸다');
    for (const a of g.avoid) if (!(a in t.patterns)) bad(`patterns에 "${a}" 키가 없다`);
  }
  for (const [k, p] of Object.entries(t.patterns)) {
    if (p === null) continue;
    try {
      new RegExp(p, 'gu');
    } catch (e) {
      bad(`patterns["${k}"] 정규식 오류: ${e.message}`);
    }
  }
  for (const r of t.rules) {
    if (!/^DC\d{1,2}$/.test(r.id ?? '') || typeof r.pattern !== 'string') bad('rules 항목은 { id: DCn, pattern } 이어야 한다');
    try {
      new RegExp(r.pattern, 'gu');
    } catch (e) {
      bad(`rules ${r.id} 정규식 오류: ${e.message}`);
    }
  }
  for (const a of t.allow) {
    if (typeof a.key !== 'string' || typeof a.word !== 'string' || typeof a.reason !== 'string' || a.reason.trim().length < 4) {
      bad('allow 항목은 { key, word, reason(4자 이상) } 이어야 한다');
    }
  }
  return t;
}

/** terms.json ↔ content.md §4 양방향 패리티. 위반 레코드를 돌려준다 */
export function glossaryParity(root, terms) {
  const out = [];
  const md = readText(root, CONTENT_MD);
  if (md === null) throw new Error(`${CONTENT_MD}가 없다`);
  const rows = parseGlossaryTable(md);
  const byConcept = new Map(rows.map((r) => [r.concept, r]));
  const jsonByConcept = new Map(terms.glossary.map((g) => [g.concept, g]));
  const v = (file, line, text, msg) => out.push({ rule: 'DC1', file, line, text, msg });
  for (const r of rows) {
    const g = jsonByConcept.get(r.concept);
    if (!g) {
      v(CONTENT_MD, r.line, r.concept, `용어집 행이 terms.json glossary에 없다: ${r.concept}`);
      continue;
    }
    for (const a of r.avoid) {
      if (!g.avoid.includes(a)) v(CONTENT_MD, r.line, `${r.concept}/${a}`, `쓰지 않는 말이 terms.json에 없다: ${r.concept} → ${a}`);
    }
    for (const a of g.avoid) {
      if (!r.avoid.includes(a)) v(TERMS_PATH, 0, `${r.concept}/${a}`, `terms.json의 쓰지 않는 말이 content.md §4 표에 없다: ${r.concept} → ${a}`);
    }
  }
  for (const g of terms.glossary) {
    if (!byConcept.has(g.concept)) v(TERMS_PATH, 0, g.concept, `terms.json glossary 행이 content.md §4 표에 없다: ${g.concept}`);
  }
  const used = new Set(terms.glossary.flatMap((g) => g.avoid));
  for (const k of Object.keys(terms.patterns)) {
    if (!used.has(k)) v(TERMS_PATH, 0, k, `patterns 키가 어느 쓰지 않는 말과도 짝이 아니다: ${k}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 규칙 적용
// ---------------------------------------------------------------------------

function compileRules(terms) {
  const rules = [];
  for (const r of terms.rules) rules.push({ id: r.id, re: new RegExp(r.pattern, 'gu'), note: r.note ?? '' });
  if (terms.interjections.length) {
    const alt = terms.interjections.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    // 문장 맨 앞의 감탄사만 본다("와"·"아"는 조사·접두와 겹치므로 단독으로 쓰인 자리만)
    rules.push({ id: 'DC1', re: new RegExp(`(?:^|[.?!]\\s)(?:${alt})(?=[,!.…]|$)`, 'gu'), note: '감탄사' });
  }
  for (const g of terms.glossary) {
    for (const a of g.avoid) {
      const p = terms.patterns[a];
      if (p) rules.push({ id: 'DC1', re: new RegExp(p, 'gu'), note: `용어집: ${g.concept} → ${a}` });
    }
  }
  return rules;
}

function ruleApplies(id, deck, lit, hangul) {
  if (id === 'DC9') return hangul || deck.kind !== 'errors';
  if (id === 'DC8') {
    const key = lit.entryKey;
    if (key === undefined) return hangul;
    return hangul && /\.(?:title|body)$/.test(key);
  }
  return hangul;
}

const isShellCommand = (v) => /^[a-z][a-z0-9_.-]*\s+-/.test(v);
const inPlatform = (key) => key !== undefined && key.split('.').includes('platform');

function allowed(terms, key, word) {
  if (key === undefined) return false;
  return terms.allow.some((a) => a.key === key && (a.word === '' || word.includes(a.word) || a.word.includes(word)));
}

/** 키 없는 리터럴과 키 있는 리터럴 모두에 적용하는 글자 규칙 */
function literalViolations(deck, lit, ctx) {
  const out = [];
  const val = lit.v;
  const hangul = HANGUL.test(val);
  const key = lit.entryKey;
  for (const r of ctx.rules) {
    if (deck.help && !HELP_RULES.has(r.id)) continue;
    if (!ruleApplies(r.id, deck, lit, hangul)) continue;
    if (r.id === 'DC5' && isShellCommand(val)) continue;
    if (r.id === 'DC9' && inPlatform(key)) continue;
    r.re.lastIndex = 0;
    const m = r.re.exec(val);
    if (!m) continue;
    if (allowed(ctx.terms, key, m[0])) continue;
    out.push({ rule: r.id, file: deck.rel, line: lit.line, text: val, msg: `${r.id} 금지: "${m[0]}"${r.note ? ` (${r.note})` : ''}` });
  }
  if (!hangul) return out;

  // 키 역할(접미)에 기대는 DC5 규칙
  if (key !== undefined && !deck.help) {
    const last = key.split('.').pop();
    const titleLike = last === 'title' || last === 'label' || key.startsWith('toast.') || key.includes('.status.');
    const push = (rule, word, msg) => {
      if (!allowed(ctx.terms, key, word)) out.push({ rule, file: deck.rel, line: lit.line, text: val, msg });
    };
    if (titleLike && /\.\s*$/.test(val)) push('DC5', '.', `DC5 제목·라벨·토스트·상태 값은 끝에 마침표가 없다: ${key}`);
    if (titleLike && /\. /.test(val)) push('DC5', '. ', `DC5 제목·라벨·토스트·상태 값 안에 ". "가 없다(한 문장): ${key}`);
    if ((last === 'body' || last === 'help') && val !== '' && !/\.$/.test(val)) push('DC5', '.', `DC5 본문·도움말은 끝에 마침표가 있어야 한다: ${key}`);
    if (/status\./.test(key) || key.startsWith('list.group.')) {
      if (/[어아여해예에네돼워려나]요(?![가-힣])/.test(val) && !val.includes('곧 끝나요')) push('DC2', '요', `DC2 상태 조각에 해요체 문장이 섞였다: ${key}`);
    }
    if (last === 'title' || last === 'body') {
      // 키에 기대는 DC8은 위 정규식 규칙에서 이미 처리한다
    }
  }
  if (/[?？]/.test(val) && !(key !== undefined && /^dialog\.[^.]+\.title$/.test(key))) {
    if (!allowed(ctx.terms, key, '?')) {
      out.push({ rule: 'DC5', file: deck.rel, line: lit.line, text: val, msg: `DC5 "?"는 dialog.*.title에만 쓴다${key ? `: ${key}` : ''}` });
    }
  }
  if (val.includes('…')) {
    const base = val.replace(/…$/, '').trim();
    const urlExample = /[/.]…|…\//.test(val);
    const urlKey = key !== undefined && key.split('.')[0] === 'url';
    const ok = urlExample || urlKey || (val.endsWith('…') && ctx.terms.opensWindow.includes(base));
    if (!ok && !allowed(ctx.terms, key, '…')) {
      out.push({ rule: 'DC5', file: deck.rel, line: lit.line, text: val, msg: '…는 다른 창을 여는 버튼 라벨 끝(opensWindow)과 주소 예시에만 쓴다' });
    }
  }
  // 번호 박힌 문자열 외에 DC12(접근성·로그인 키)
  if (key !== undefined) {
    if (key.startsWith('a11y.') && !val.startsWith('‘{')) {
      const word = val.split(' ')[0];
      if (!allowed(ctx.terms, key, word)) {
        out.push({ rule: 'DC12', file: deck.rel, line: lit.line, text: key, msg: `DC12 a11y 값은 ‘{…}’(대상)로 시작한다: ${key}` });
      }
    }
    if (key.startsWith('auth.') && val.includes('로그인 정보')) {
      out.push({ rule: 'DC12', file: deck.rel, line: lit.line, text: key, msg: `DC12 auth.* 키에 "로그인 정보"를 쓰지 않는다(앱 로그인은 "로그인"): ${key}` });
    }
    if ((key.startsWith('auth.revoked.') || key.startsWith('auth.reuse.')) && val.includes('관리자')) {
      out.push({ rule: 'DC12', file: deck.rel, line: lit.line, text: key, msg: `DC12 ${key}는 상태만 말한다("관리자" 금지)` });
    }
  }
  return out;
}

const refCache = new Map();

/** 키가 deck 밖 소스에서 참조되는가(정확한 문자열, 동적 접두, Worker는 COPY.경로) */
function referencedChecker(root, deck) {
  const cacheKey = `${root}|${deck.kind}`;
  if (refCache.has(cacheKey)) return refCache.get(cacheKey);
  const isWorker = deck.kind === 'worker';
  const base = join(root, isWorker ? 'worker/src' : 'app/src');
  const files = walk(base, (n) => /\.(?:ts|svelte)$/.test(n) && !/\.test\.ts$/.test(n)).filter((p) => resolve(p) !== resolve(join(root, deck.rel)));
  const texts = files.map((p) => readFileSync(p, 'utf8'));
  const prefixes = [];
  for (const t of texts) {
    for (const m of t.matchAll(/`([^`$]*)\$\{/g)) if (m[1].length >= 2) prefixes.push(m[1]);
    for (const m of t.matchAll(/['"]([\w.]+\.)['"]\s*\+/g)) prefixes.push(m[1]);
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const checker = (key) => {
    if (texts.length === 0) return true;
    const quoted = new RegExp(`['"\`]${esc(key)}['"\`]`);
    if (texts.some((t) => quoted.test(t))) return true;
    if (prefixes.some((p) => key.startsWith(p))) return true;
    const segs = key.split('.');
    if (isWorker || !key.includes('.')) {
      const idRe = isWorker
        ? segs.map((_, L) => new RegExp(`\\bCOPY\\s*\\.\\s*${segs.slice(0, L + 1).map(esc).join('\\s*\\.\\s*')}(?![\\w$]|\\s*\\.\\s*[A-Za-z_$])`))
        : [new RegExp(`\\b${esc(key)}\\b`)];
      if (texts.some((t) => idRe.some((re) => re.test(t)))) return true;
    }
    return false;
  };
  refCache.set(cacheKey, checker);
  return checker;
}

/** 확장자(`.mp4`)·상수 이름(`NID_AUT`)·점 경로(`a.b`)만인 값. 제품 이름(macOS)은 식별자가 아니다 */
function isIdentifierOnly(v) {
  return /^\.[A-Za-z0-9]+$/.test(v) || /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(v) || /^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/.test(v);
}

function keyViolations(deck, ctx) {
  const out = [];
  const entries = deck.entries.filter((e) => !e.synthetic);
  const perKey = new Map();
  for (const e of entries) perKey.set(e.key, (perKey.get(e.key) ?? 0) + 1);
  const single = entries.filter((e) => perKey.get(e.key) === 1);
  const v = (e, msg, rule = 'DC11') => out.push({ rule, file: deck.rel, line: e.line, text: e.key, msg });
  const isRef = ctx.checkRefs ? referencedChecker(ctx.root, deck) : null;
  const seen = new Set();
  for (const e of entries) {
    const last = e.key.split('.').pop();
    if (BANNED_SUFFIXES.includes(last)) v(e, `DC11 키 접미 "${last}"는 쓰지 않는다(title·body·help·label·a11y만): ${e.key}`);
    if (!e.top && !seen.has(e.key)) {
      seen.add(e.key);
      if (isRef && !isRef(e.key)) v(e, `DC11 참조가 없는 키다(지운다): ${e.key}`);
    }
  }
  for (const e of single) {
    if (/^\s*[,，、·;:)\]|/]/.test(e.value)) v(e, `DC11 값이 쉼표·구분자로 시작한다(조각 금지): ${e.key}`);
    if (!e.top && isIdentifierOnly(e.value)) {
      v(e, `DC11 값이 식별자·확장자만이다(코드 상수로 둔다): ${e.key}`);
    }
  }
  const byValue = new Map();
  for (const e of single) {
    if (e.value === '' || e.top) continue;
    if (!byValue.has(e.value)) byValue.set(e.value, []);
    byValue.get(e.value).push(e);
  }
  for (const [, list] of byValue) {
    if (list.length < 2) continue;
    for (const e of list.slice(1)) v(e, `DC11 값이 같은 키가 둘 이상이다(${list[0].key}와 같다): ${e.key}`);
  }
  return out;
}

function loadDecks(root) {
  const decks = [];
  for (const [kind, rel] of Object.entries(FILES)) {
    const text = readText(root, rel);
    if (text === null) continue;
    const toks = tokenize(text);
    const entries = kind === 'errors' ? parseErrors(toks) : parseDeck(toks);
    decks.push({ kind, rel, text, toks, entries, literals: allStrings(toks) });
  }
  return decks;
}

function helpDecks(root) {
  const decks = [];
  const dir = join(root, HELP_DIR);
  for (const p of walk(dir, (n) => n.endsWith('.md')).sort()) {
    const rel = `${HELP_DIR}/${p.slice(dir.length + 1).split('\\').join('/')}`;
    const literals = [];
    const lines = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n');
    let fenced = false;
    lines.forEach((raw, k) => {
      if (/^\s*```/.test(raw)) {
        fenced = !fenced;
        return;
      }
      if (fenced) return;
      const v = raw.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '').replace(/[*_`]/g, '').trim();
      if (v) literals.push({ t: 'str', v, line: k + 1 });
    });
    decks.push({ kind: 'help', rel, help: true, entries: [], literals });
  }
  return decks;
}

function docViolations(root, decks) {
  const out = [];
  const deckKeys = new Map();
  for (const d of decks) {
    for (const e of d.entries) {
      if (e.synthetic) continue;
      if (!deckKeys.has(e.key)) deckKeys.set(e.key, []);
      deckKeys.get(e.key).push({ ...e, rel: d.rel });
    }
  }
  const md = readText(root, CONTENT_MD);
  if (md === null) return out;
  const { pairs, keys } = parseNewCopyPairs(md);
  for (const p of pairs) {
    const found = deckKeys.get(p.key);
    if (!found) {
      out.push({ rule: 'DC10', file: CONTENT_MD, line: p.line, text: p.key, msg: `DC10 content.md §15의 키가 deck에 없다: ${p.key}` });
    } else if (!found.some((f) => f.value.replace(/\s+/g, ' ').trim() === p.value)) {
      const f = found[0];
      out.push({ rule: 'DC10', file: f.rel, line: f.line, text: p.key, msg: `DC10 deck 값이 content.md §15와 다르다: ${p.key} (문서 "${p.value}")` });
    }
  }
  for (const rel of DOC_FILES) {
    const doc = readText(root, rel);
    if (doc === null) continue;
    for (const { key, line } of parseDocKeys(doc, keys)) {
      if (!deckKeys.has(key)) {
        out.push({ rule: 'DC10', file: rel, line, text: key, msg: `DC10 ${rel}가 적은 키가 deck에 없다: ${key}` });
      }
    }
  }
  return out;
}

function sharedViolations(decks) {
  const out = [];
  const ko = decks.find((d) => d.kind === 'ko');
  const wk = decks.find((d) => d.kind === 'worker');
  if (!ko || !wk) return out;
  const find = (deck, names) => {
    for (const e of deck.entries) if (names.includes(e.key) && deck.entries.filter((x) => x.key === e.key).length === 1) return e;
    return null;
  };
  for (const names of SHARED_CONSTANTS) {
    const a = find(ko, names);
    const b = find(wk, names);
    if (a && b && a.value !== b.value) {
      out.push({
        rule: 'DC6',
        file: wk.rel,
        line: b.line,
        text: names[0],
        msg: `DC6 두 deck의 상수 값이 다르다: ${a.key}(${ko.rel}:${a.line}) ≠ ${b.key}`,
      });
    }
  }
  return out;
}

function sourceViolations(deck) {
  const out = [];
  const t = deck.toks;
  for (let i = 0; i < t.length; i++) {
    if (t[i].t === 'id' && t[i].v === 'toLocaleString') {
      out.push({ rule: 'DC4', file: deck.rel, line: t[i].line, text: 'toLocaleString', msg: 'DC4 toLocaleString를 직접 부르지 않는다(format 함수 사용)' });
    }
    if (t[i].t === 'id' && t[i].v === 'join' && isP(t[i + 1], '(') && t[i + 2]?.t === 'str' && t[i + 2].v === ', ' && isP(t[i + 3], ')')) {
      out.push({ rule: 'DC5', file: deck.rel, line: t[i].line, text: "join(', ')", msg: "DC5 join(', ')로 조각을 잇지 않는다(문장은 deck이 만든다)" });
    }
  }
  if (deck.kind === 'errors') {
    // apiMessage는 L1 "자세히"로만 간다: title·body 값이나 copy() 인자에 들어가면 안 된다
    for (let i = 0; i < t.length; i++) {
      if (t[i].t !== 'id' || t[i].v !== 'apiMessage') continue;
      let s = i;
      while (s > 0 && !(t[s - 1].t === 'p' && [';', '{', '}'].includes(t[s - 1].v))) s--;
      const head = t.slice(s, i).filter((x) => x.t === 'id').map((x) => x.v);
      let inCopy = false;
      for (let j = i; j >= 0; j--) {
        if (t[j].t === 'id' && t[j].v === 'copy' && isP(t[j + 1], '(') && matchClose(t, j + 1) > i) {
          inCopy = true;
          break;
        }
      }
      const toTitleBody = head.some((x, k) => ['const', 'let'].includes(x) && ['title', 'body'].includes(head[k + 1]));
      if (inCopy || toTitleBody) {
        out.push({ rule: 'DC8', file: deck.rel, line: t[i].line, text: 'apiMessage', msg: 'DC8 apiMessage는 title·body 인자로 들어가지 않는다(L1 "자세히"로 내린다)' });
      }
    }
  }
  return out;
}

/**
 * design-copy 검사. 위반 레코드 { rule, file, line, text, msg } 배열을 돌려준다.
 * terms.json·content.md가 없거나 깨졌으면 throw(종료 코드 2).
 */
export function check(root = ROOT, { checkRefs = true } = {}) {
  const terms = loadTerms(root);
  const out = [...glossaryParity(root, terms)];
  const decks = [...loadDecks(root), ...helpDecks(root)];
  const ctx = { terms, rules: compileRules(terms), root, checkRefs };
  for (const deck of decks) {
    for (const lit of deck.literals) out.push(...literalViolations(deck, lit, ctx));
    if (deck.kind === 'ko' || deck.kind === 'worker') out.push(...keyViolations(deck, ctx));
    if (!deck.help) out.push(...sourceViolations(deck));
  }
  out.push(...sharedViolations(decks));
  out.push(...docViolations(root, decks));
  // 같은 (규칙, 파일, 줄, 글자)는 하나로 합친다
  const seen = new Set();
  const uniq = [];
  for (const x of out) {
    const k = `${x.rule}\0${x.file}\0${x.line}\0${x.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // 출력이 `RULE: 내용`이므로 메시지 머리의 규칙 번호는 뗀다
    uniq.push({ ...x, msg: x.msg.replace(/^D[CI]\d+ /, '') });
  }
  return uniq.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0)));
}

export async function main(argv = process.argv.slice(2)) {
  return runGate({ gate: 'design-copy', families: FAMILIES, check, argv, root: ROOT });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
