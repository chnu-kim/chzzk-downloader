// 디자인 gate가 함께 쓰는 작은 CSS 파서(governance §2.0 "선언 단위 파서").
// 의존성 0. stylelint를 쓰지 않는 이유는 governance §2.0에 있다.
// 줄 번호는 1부터이고 주석을 지울 때도 줄바꿈 수를 남겨 보존한다.

/** CRLF를 LF로 맞춘다(Windows 러너에서 autocrlf가 꺼져 있어도 같은 줄 번호). */
function norm(s) {
  return String(s).replace(/\r\n?/g, '\n');
}

/**
 * 블록 주석을 지우되 안의 줄바꿈은 남긴다. 문자열 안의 여는 주석 표시는 주석이 아니다.
 * CSS 문자열은 줄을 넘지 못하므로 따옴표는 줄바꿈에서 닫힌 것으로 본다(짝 없는 따옴표가 뒤를 삼키지 않게).
 */
export function stripComments(css) {
  const s = norm(css);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      while (j < s.length && s[j] !== q && s[j] !== '\n') {
        if (s[j] === '\\') j++;
        j++;
      }
      // 닫는 따옴표까지(줄바꿈에서 멈췄으면 그 앞까지) 그대로 둔다
      const end = s[j] === q ? j + 1 : j;
      out += s.slice(i, end);
      i = end;
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

/** 1부터 세는 줄 번호. `index`는 `text` 안의 글자 위치. */
export function lineOf(text, index, startLine = 1) {
  let n = startLine;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** 문자열 밖의 연속 공백을 하나로 줄이고 앞뒤를 자른다. */
function squash(s) {
  let out = '';
  let q = null;
  let space = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      out += c;
      if (c === '\\') out += s[++i] ?? '';
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      if (space && out) out += ' ';
      space = false;
      q = c;
      out += c;
    } else if (/\s/.test(c)) {
      space = true;
    } else {
      if (space && out) out += ' ';
      space = false;
      out += c;
    }
  }
  return out;
}

/** 괄호·대괄호·따옴표 밖의 쉼표로 selector 목록을 나눈다. */
function splitTop(s, sep = ',') {
  const parts = [];
  let depth = 0;
  let q = null;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\') cur += s[++i] ?? '';
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += c;
  }
  parts.push(cur);
  return parts;
}

/** selector 글자 정규화: 연속 공백 하나, 콤마 뒤 공백 하나. */
function normSelector(s) {
  return splitTop(squash(s))
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ');
}

/** CSS nesting 평탄화: `&`는 바깥 selector로 치환하고, 없으면 공백으로 잇는다. */
function flatten(parent, child) {
  const c = normSelector(child);
  if (parent == null) return c;
  const out = [];
  for (const p of splitTop(parent).map((x) => x.trim())) {
    for (const k of splitTop(c).map((x) => x.trim())) {
      out.push(k.includes('&') ? k.replaceAll('&', p) : `${p} ${k}`);
    }
  }
  return out.join(', ');
}

/** 이름이 `@name`이고 안에 규칙이 들어가는(묶는) at-rule. */
const GROUPING = new Set(['media', 'supports', 'layer', 'container', 'document', 'starting-style', 'scope']);

/**
 * CSS를 규칙과 블록 없는 at-rule로 나눈다.
 * - Rule: `{ selector, media, decls, line }`. `@font-face`는 selector `@font-face`.
 *   `@keyframes` 안 규칙은 media `['@keyframes spin']`에 selector `from`/`to`/`50%`.
 * - Decl: `{ prop, value, important, line }`
 * - AtStmt: `{ name, prelude, line }` — name은 `@` 없이(`import`, `charset`).
 */
export function parseCss(css, { startLine = 1 } = {}) {
  const text = stripComments(css);
  const rules = [];
  const atStatements = [];

  // 줄 시작 위치 표(이진 탐색으로 글자 위치 → 줄 번호)
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  const lineAt = (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return startLine + lo;
  };

  let pos = 0;

  /** 최상위 `;` `{` `}` 중 하나가 나올 때까지 읽는다. */
  function readChunk() {
    let q = null;
    let paren = 0;
    const from = pos;
    while (pos < text.length) {
      const c = text[pos];
      if (q) {
        if (c === '\\') pos++;
        else if (c === q || c === '\n') q = null;
        pos++;
        continue;
      }
      if (c === '"' || c === "'") q = c;
      else if (c === '(') paren++;
      else if (c === ')') paren = Math.max(0, paren - 1);
      else if (paren === 0 && (c === ';' || c === '{' || c === '}')) {
        const raw = text.slice(from, pos);
        pos++;
        return { raw, from, term: c };
      }
      pos++;
    }
    return { raw: text.slice(from, pos), from, term: null };
  }

  const firstNonSpace = (chunk) => {
    const m = /\S/.exec(chunk.raw);
    return chunk.from + (m ? m.index : 0);
  };

  function makeDecl(chunk) {
    const raw = chunk.raw;
    let colon = -1;
    let q = null;
    let paren = 0;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) {
        if (c === '\\') i++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'") q = c;
      else if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (c === ':' && paren === 0) {
        colon = i;
        break;
      }
    }
    if (colon < 1) return null;
    const rawProp = raw.slice(0, colon).trim();
    if (!rawProp || /\s/.test(rawProp)) return null;
    let value = squash(raw.slice(colon + 1));
    const important = /\s*!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/\s*!\s*important\s*$/i, '');
    return {
      prop: rawProp.startsWith('--') ? rawProp : rawProp.toLowerCase(),
      value,
      important,
      line: lineAt(firstNonSpace(chunk)),
    };
  }

  /**
   * 블록 본문(또는 최상위)을 읽는다.
   * ctx.selector: 바깥 규칙의 selector(없으면 null), ctx.rule: 선언을 받을 규칙(없으면 null),
   * ctx.media: 바깥→안 at-rule prelude 목록, ctx.top: 최상위 여부.
   */
  function parseBody(ctx) {
    const ensureRule = () => {
      if (!ctx.rule && ctx.selector != null) {
        ctx.rule = { selector: ctx.selector, media: ctx.media.slice(), decls: [], line: ctx.line };
        rules.push(ctx.rule);
      }
      return ctx.rule;
    };
    for (;;) {
      const chunk = readChunk();
      const body = chunk.raw.trim();
      if (chunk.term === '{') {
        const line = lineAt(firstNonSpace(chunk));
        const prelude = squash(body);
        if (prelude.startsWith('@')) {
          const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
          if (name.endsWith('keyframes')) {
            parseBody({ selector: null, rule: null, media: [...ctx.media, prelude], line });
          } else if (GROUPING.has(name)) {
            parseBody({ selector: ctx.selector, rule: null, media: [...ctx.media, prelude], line });
          } else {
            // @font-face · @property 같은 선언 블록: at-rule 글자가 selector
            const sel = name === 'font-face' ? '@font-face' : prelude;
            const rule = { selector: sel, media: ctx.media.slice(), decls: [], line };
            rules.push(rule);
            parseBody({ selector: sel, rule, media: ctx.media, line });
          }
        } else {
          const sel = flatten(ctx.selector, body);
          const rule = { selector: sel, media: ctx.media.slice(), decls: [], line };
          rules.push(rule);
          parseBody({ selector: sel, rule, media: ctx.media, line });
        }
        continue;
      }
      if (body) {
        if (body.startsWith('@')) {
          const m = /^@([\w-]+)\s*([\s\S]*)$/.exec(body);
          if (m) atStatements.push({ name: m[1].toLowerCase(), prelude: squash(m[2]), line: lineAt(firstNonSpace(chunk)) });
        } else {
          const d = makeDecl(chunk);
          if (d) ensureRule()?.decls.push(d);
        }
      }
      if (chunk.term === '}') {
        if (ctx.top) continue; // 짝 없는 `}`는 건너뛴다
        return;
      }
      if (chunk.term == null) return;
    }
  }

  parseBody({ selector: null, rule: null, media: [], line: startLine, top: true });
  return { rules, atStatements };
}

/**
 * `.svelte` 원문을 `<style>`·`<script>`·마크업으로 나눈다.
 * markup은 두 블록(태그 포함)을 같은 줄 수의 빈 줄로 바꾼 원문이라 줄 번호가 그대로다.
 * startLine은 블록 안쪽 글자가 시작하는 줄(여는 태그와 같은 줄에서 시작할 수 있다).
 */
export function extractSvelte(src) {
  const s = norm(src);
  const styles = [];
  const scripts = [];
  let markup = '';
  let last = 0;
  const re = /<(style|script)\b([^>]*)>([\s\S]*?)<\/\1\s*>/g;
  let m;
  while ((m = re.exec(s))) {
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    const startLine = lineOf(s, bodyStart);
    if (m[1] === 'style') styles.push({ css: m[3], startLine });
    else scripts.push({ code: m[3], startLine, attrs: m[2] });
    markup += s.slice(last, m.index) + m[0].replace(/[^\n]/g, '');
    last = m.index + m[0].length;
  }
  markup += s.slice(last);
  return { styles, scripts, markup };
}

/** `var(--x)`·`var(--x, …)`의 `--x`와 줄 번호. 주석은 호출하는 쪽이 먼저 지운다. */
export function varRefs(text, { startLine = 1 } = {}) {
  const out = [];
  const re = /var\(\s*(--[\w-]+)/g;
  let m;
  while ((m = re.exec(text))) out.push({ name: m[1], line: lineOf(text, m.index, startLine) });
  return out;
}
