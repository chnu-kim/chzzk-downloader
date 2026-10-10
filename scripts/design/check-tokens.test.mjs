// check-tokens.mjs 단위 테스트. 판정 함수는 가짜 파싱 결과·가짜 모델로 한 쌍(통과·위반)씩 본다.
// 마지막에 저장소 자체(ROOT)에 대해 원천·생성물 검사(DT5~DT11·DT14~DT17)가 0인지 본다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { parseCss, stripComments } from './css.mjs';
import {
  ROOT,
  annotateSections,
  check,
  dt2,
  dt3,
  dt4,
  dt5,
  dt6,
  dt7,
  dt8,
  dt9,
  dt10,
  dt11,
  dt12,
  dt13,
  dt14,
  dt15,
  dt16,
  dt17,
  evalCascade,
  expectedConsts,
  extractSiteCss,
  mediaMatches,
  parseConstTable,
  parseFoundationsDoc,
  parseRustConsts,
  parseTimingConsts,
  propertyOf,
  resolveValue,
  sectionMarkers,
  selectorMatches,
} from './check-tokens.mjs';

// ───────────── 도우미 ─────────────

/** { 절이름: css } → 절 표지가 붙은 생성물 모양 대상 */
function target(file, sections) {
  const css = Object.entries(sections)
    .map(([name, body]) => `/* [${name}] 시험 */\n${body}`)
    .join('\n\n');
  const rules = annotateSections(parseCss(css).rules, sectionMarkers(css));
  return { file, css, startLine: 1, rules };
}

const entry = (file, css) => ({ file, text: stripComments(css) });

/** 가짜 모델: 토큰은 { name, path, file, type, value } 만 채운다 */
function model(tokens = [], extra = {}) {
  return {
    tokens: tokens.map((t) => ({ dark: undefined, overrides: {}, rootless: false, noCss: false, description: 'x', ...t })),
    textScale: { large: 1.3, 'x-large': 2 },
    breakpointNarrow: 600,
    contrast: { light: [], dark: [] },
    ...extra,
  };
}

const px = (n) => ({ value: n, unit: 'px' });

function ctxOf(over = {}) {
  const app = over.app ?? target('app/src/styles/tokens.css', { root: ':root { --a: 1px; }' });
  const worker = over.worker ?? target('worker/src/http/site-css.generated.ts', { root: ':root { --a: 1px; }' });
  return {
    model: model(),
    fns: {},
    app,
    worker,
    uiGen: { file: 'app/src/styles/ui.css', text: '', rules: [] },
    appSources: [],
    workerSources: [],
    uiSource: null,
    appCss: { file: 'app/src/app.css', raw: 'html { font-size: 16px; }' },
    siteCss: { file: 'worker/src/http/site.css', raw: 'html { font-size: 16px; }' },
    foundations: '',
    timing: null,
    consts: null,
    docRules: [],
    ...over,
  };
}

const texts = (violations) => violations.map((x) => x.text).sort();

// ───────────── 캐스케이드 도우미 ─────────────

test('selectorMatches: :root·:where 환경 평가, main 척도는 루트가 아니다', () => {
  const light = { scheme: 'light', theme: 'none' };
  assert.equal(selectorMatches(':root', light), true);
  assert.equal(selectorMatches(':root:where(*)', light), true);
  assert.equal(selectorMatches(':root:where(:not([data-theme="light"]))', light), true);
  assert.equal(selectorMatches(':root:where(:not([data-theme="light"]))', { scheme: 'dark', theme: 'light' }), false);
  assert.equal(selectorMatches(':root:where([data-theme="dark"])', { scheme: 'light', theme: 'dark' }), true);
  assert.equal(selectorMatches(':root:where([data-window-active="false"])', light), false);
  assert.equal(selectorMatches(':root:where([data-window-active="false"])', { ...light, windowInactive: true }), true);
  assert.equal(selectorMatches('[data-scale="reading"]', light), false);
  assert.equal(selectorMatches(':root:where([data-text-scale="large"])', { ...light, textScale: 'large' }), true);
});

test('mediaMatches: 알려진 조건만 환경을 따른다', () => {
  assert.equal(mediaMatches('@media (prefers-color-scheme: dark)', { scheme: 'dark' }), true);
  assert.equal(mediaMatches('@media (prefers-color-scheme: dark)', { scheme: 'light' }), false);
  assert.equal(mediaMatches('@media  (prefers-contrast: more)', { contrastMore: true }), true);
  assert.equal(mediaMatches('@media (any-pointer: coarse)', {}), false);
  assert.equal(mediaMatches('@media (hover: none)', { scheme: 'dark' }), false);
});

test('evalCascade·resolveValue: 소스 순서가 결정하고 var()를 푼다', () => {
  const t = target('x', {
    root: ':root { --fg: #111111; --fg-muted: #555555; --m: var(--fg-muted); }',
    'dark-media': '@media (prefers-color-scheme: dark) {\n  :root:where(:not([data-theme="light"])) {\n    --fg: #EEEEEE;\n  }\n}',
    contrast: '@media (prefers-contrast: more) {\n  :root:where(*) { --fg-muted: var(--fg); }\n}',
  });
  const light = evalCascade(t.rules, { scheme: 'light', theme: 'none' });
  assert.equal(resolveValue(light, '--m'), '#555555');
  const dark = evalCascade(t.rules, { scheme: 'dark', theme: 'none', contrastMore: true });
  assert.equal(resolveValue(dark, '--m'), '#EEEEEE');
});

// ───────────── DT2 ─────────────

test('DT2: 앱 소스의 미정의 var는 위반, --p·정의된 이름은 통과', () => {
  const app = target('app/src/styles/tokens.css', { root: ':root { --fg: #111; }' });
  const worker = target('worker/src/http/site-css.generated.ts', { root: ':root { --fg: #111; }' });
  const ok = ctxOf({ app, worker, appSources: [entry('app/src/a.svelte', '<style>a { color: var(--fg); width: var(--p); }</style>')] });
  assert.deepEqual(dt2(ok), []);
  const bad = ctxOf({ app, worker, appSources: [entry('app/src/a.svelte', '<style>\na { color: var(--nope); }</style>')] });
  const out = dt2(bad);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].rule, out[0].file, out[0].line, out[0].text], ['DT2', 'app/src/a.svelte', 2, '--nope']);
});

test('DT2: ui.css는 앱·Worker 공통 이름만, Worker 소스는 Worker 정의만 쓴다', () => {
  const app = target('app/src/styles/tokens.css', { root: ':root { --fg: #111; --only-app: 1px; }', legacy: ':root { --old: 1px; }' });
  const worker = target('worker/src/http/site-css.generated.ts', { root: ':root { --fg: #111; }', reading: '[data-scale="reading"] { --text-hero: 28px; }' });
  const c = ctxOf({
    app,
    worker,
    uiSource: entry('design/ui.css', 'a { color: var(--only-app); font-size: var(--text-hero); }'),
    workerSources: [entry('worker/src/http/pages.ts', 'x { color: var(--text-hero); margin: var(--only-app); }')],
    appSources: [entry('app/src/b.css', 'a { color: var(--old); }')],
  });
  const out = dt2(c);
  assert.deepEqual(texts(out), ['--only-app', '--only-app', '--text-hero']);
  assert.ok(!out.some((x) => x.file === 'app/src/b.css'), 'legacy 이름은 앱에서 정의된 것이다');
});

// ───────────── DT3 ─────────────

test('DT3: 생성물 토큰이 var()로 쓰이거나 별칭의 대상이면 통과, 아니면 위반', () => {
  const sections = {
    root: ':root { --ref-a: #fff; --bg: var(--ref-a); --unused: 1px; --used: 2px; }',
    legacy: ':root { --old: var(--unused); }',
  };
  const app = target('app/src/styles/tokens.css', sections);
  const worker = target('worker/src/http/site-css.generated.ts', { root: sections.root, reading: '[data-scale="reading"] { --text-hero: 28px; }' });
  const c = ctxOf({
    app,
    worker,
    appSources: [entry('app/src/a.css', 'a { color: var(--bg); padding: var(--used); }'), entry('app/src/h.css', 'h { font-size: var(--text-hero); }')],
  });
  // --text-hero는 앱 소스 사용으로는 세지 않는다. legacy 안의 var()도 사용이 아니다
  assert.deepEqual(texts(dt3(c)), ['--text-hero', '--unused']);
  const w = ctxOf({ app, worker, appSources: [entry('app/src/a.css', 'a { color: var(--bg); padding: var(--used); margin: var(--unused); }')], workerSources: [entry('worker/src/http/p.ts', 'h { font-size: var(--text-hero); }')] });
  assert.deepEqual(dt3(w), []);
});

// ───────────── DT4 ─────────────

test('DT4: html 16px 규칙·px 단위·rem 없음', () => {
  assert.deepEqual(dt4(ctxOf({ model: model([{ name: '--a', path: 'space.a', file: 'space', type: 'dimension', value: px(1) }]) })), []);
  const bad = ctxOf({
    model: model([{ name: '--a', path: 'space.a', file: 'space', type: 'dimension', value: { value: 1, unit: 'rem' } }]),
    app: target('app/src/styles/tokens.css', { root: ':root { --a: 1.5rem; --b: 2em; }' }),
    appCss: { file: 'app/src/app.css', raw: ':root { font-size: 14px; }' },
    siteCss: { file: 'worker/src/http/site.css', raw: null },
  });
  const out = dt4(bad);
  assert.deepEqual(texts(out).filter((t) => t.startsWith('--')), ['--a', '--a: 1.5rem', '--b: 2em']);
  assert.equal(out.filter((x) => x.text === 'html { font-size: 16px }').length, 2);
});

// ───────────── DT5 ─────────────

test('DT5: 글자 12px 이상·행간 정수 px·굵기 400/600', () => {
  const ok = target('t', { root: ':root { --text-body: 13px; --leading-body: 16px; --weight-regular: 400; --weight-strong: 600; }' });
  assert.deepEqual(dt5(ctxOf({ app: ok, worker: ok })), []);
  const bad = target('t', { root: ':root { --text-body: 11px; --leading-body: 16.5px; --weight-regular: 500; }' });
  assert.deepEqual(texts(dt5(ctxOf({ app: bad, worker: bad }))), ['--leading-body', '--text-body', '--weight-regular']);
});

// ───────────── DT6 ─────────────

const CONTROL_CSS = {
  root: ':root { --space-8: 8px; --radius-control: 6px; --control-h-sm: 24px; --control-h: 28px; --control-h-lg: 36px; --row-h: 36px; --toolbar-h: 44px; --hit-min: 24px; }',
  coarse: '@media (any-pointer: coarse) {\n  :root:where(*) { --control-h-sm: 40px; --control-h: 40px; --control-h-lg: 44px; --row-h: 44px; --hit-min: 40px; }\n}',
};

test('DT6: 간격·반경 값 집합과 컨트롤 높이(마우스·터치)', () => {
  const ok = target('app/src/styles/tokens.css', CONTROL_CSS);
  assert.deepEqual(dt6(ctxOf({ app: ok, worker: ok })), []);
  const bad = target('app/src/styles/tokens.css', {
    root: CONTROL_CSS.root.replace('--space-8: 8px', '--space-8: 9px').replace('--radius-control: 6px', '--radius-control: 7px'),
    coarse: CONTROL_CSS.coarse.replace('--hit-min: 40px', '--hit-min: 32px'),
  });
  assert.deepEqual(texts(dt6(ctxOf({ app: bad, worker: bad }))), ['--hit-min', '--radius-control', '--space-8']);
});

// ───────────── DT7 ─────────────

test('DT7: 속성 자리·$type 대응·값 이름·ref 이름 규칙·§13 이름 집합', () => {
  const docRules = parseCss(':root { --bg: 1; --space-8: 8px; }').rules;
  const t = (name, path, file, type, value) => ({ name, path, file, type, value });
  const goodApp = target('a', { root: ':root { --bg: #fff; --space-8: 8px; }' });
  const good = ctxOf({
    docRules,
    app: goodApp,
    worker: goodApp,
    model: model([t('--bg', 'sys.color.bg', 'sys', 'color', {}), t('--space-8', 'space.space-8', 'space', 'dimension', px(8))]),
  });
  assert.deepEqual(dt7(good), []);
  const badApp = target('a', { root: ':root { --bg: #fff; --space-8: 8px; --extra: 1px; }' });
  const bad = ctxOf({
    docRules,
    app: badApp,
    worker: badApp,
    model: model([
      t('--bg', 'sys.color.bg', 'sys', 'dimension', {}), // $type 어긋남
      t('--space-8', 'space.space-8', 'space', 'dimension', px(9)), // 이름 ≠ 값
      t('--zzz-x', 'sys.color.zzz-x', 'sys', 'color', {}), // 허용 밖 속성
      t('--ref-gray-965', 'ref.gray.960', 'ref', 'color', { components: [0.965, 0, 0], hex: '#F3F3F3' }), // 키 ≠ L×1000
      t('--ref-blue-54', 'ref.blue.54', 'ref', 'color', { components: [0.54, 0.2, 258], hex: '#0067DF' }),
      t('--ref-black-a10', 'ref.black.a10', 'ref', 'color', { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.1, hex: '#000000' }),
    ]),
  });
  const out = dt7(bad);
  const names = texts(out);
  assert.ok(names.includes('--bg'));
  assert.ok(names.includes('--space-8'));
  assert.ok(names.includes('--zzz-x'));
  assert.ok(names.includes('--ref-gray-965'));
  assert.ok(names.includes('--extra'), '생성물에만 있는 이름');
  assert.ok(!names.includes('--ref-blue-54') && !names.includes('--ref-black-a10'));
  assert.equal(propertyOf('--progress-tween'), 'progress-tween');
  assert.equal(propertyOf('--progress-h'), 'progress');
});

// ───────────── DT8 ─────────────

test('DT8: 대비 미달은 위반, 알파 전경은 바탕과 합성해 계산한다', () => {
  const table = { '--fg': { hex: '#000000', alpha: 1 }, '--bg': { hex: '#FFFFFF', alpha: 1 }, '--gray': { hex: '#777777', alpha: 1 }, '--sep': { hex: '#000000', alpha: 0.1 } };
  const fns = {
    resolveColor: (_m, name) => table[name],
    composite: (hex, alpha) => (alpha === 0.1 ? '#E6E6E6' : hex),
    contrastRatio: (a, b) => (a === '#000000' && b === '#FFFFFF' ? 21 : a === '#777777' ? 4.48 : 1.25),
  };
  const mk = (pairs) => ctxOf({ fns, model: model([], { contrast: { light: pairs, dark: [] } }) });
  assert.deepEqual(dt8(mk([{ fg: '--fg', bg: '--bg', min: 4.5 }])), []);
  assert.deepEqual(texts(dt8(mk([{ fg: '--gray', bg: '--bg', min: 4.5 }]))), ['light --gray / --bg']);
  assert.deepEqual(dt8(mk([{ fg: '--sep', bg: '--bg', min: 1.2 }])), []);
});

// ───────────── DT9 ─────────────

test('DT9: H 140~170°이고 S 70% 이상이면 위반, gray ref는 S=0', () => {
  const hsls = { '#00C75A': { h: 146, s: 100, l: 39 }, '#0067DF': { h: 212, s: 100, l: 44 }, '#777778': { h: 240, s: 0.4, l: 47 } };
  const fns = { resolveColor: (_m, name) => ({ hex: { '--a': '#00C75A', '--b': '#0067DF', '--ref-gray-480': '#777778' }[name], alpha: 1 }), hsl: (hex) => hsls[hex] };
  const t = (name, path, file) => ({ name, path, file, type: 'color', value: {} });
  const out = dt9(ctxOf({ fns, model: model([t('--a', 'sys.color.a', 'sys'), t('--b', 'sys.color.b', 'sys'), t('--ref-gray-480', 'ref.gray.480', 'ref')]) }));
  assert.equal(out.length, 4); // --a는 라이트·다크 둘, gray는 S≠0 둘
  assert.ok(out.some((x) => x.text.includes('--a')));
  assert.ok(out.some((x) => x.text.includes('--ref-gray-480')));
  assert.ok(!out.some((x) => x.text.includes('--b ')));
});

// ───────────── DT10 ─────────────

const DARK_BODY = '--bg: #1F1F1F; --fg: #E8E8E8;';
const DARK_MEDIA = `@media (prefers-color-scheme: dark) {\n  :root:where(:not([data-theme="light"])) { ${DARK_BODY} }\n}`;
const DARK_THEME = `:root:where([data-theme="dark"]) { ${DARK_BODY} }`;

test('DT10: 다크 두 블록 동일, 다크 없는 색은 on-accent·focus뿐, 다크 면 L ≥ 0.24', () => {
  const sysTokens = [
    { name: '--bg', path: 'sys.color.bg', file: 'sys', type: 'color', value: {} },
    { name: '--fg', path: 'sys.color.fg', file: 'sys', type: 'color', value: {} },
    { name: '--on-accent', path: 'sys.color.on-accent', file: 'sys', type: 'color', value: {} },
  ];
  const fns = { resolveColor: () => ({ oklch: [0.24, 0, 0] }) };
  const good = target('app/src/styles/tokens.css', { 'dark-media': DARK_MEDIA, 'dark-theme': DARK_THEME });
  assert.deepEqual(dt10(ctxOf({ app: good, worker: good, fns, model: model(sysTokens) })), []);
  const diff = target('app/src/styles/tokens.css', { 'dark-media': DARK_MEDIA, 'dark-theme': DARK_THEME.replace('#E8E8E8', '#E9E9E9') });
  assert.deepEqual(texts(dt10(ctxOf({ app: diff, worker: good, fns, model: model(sysTokens) }))), ['--fg']);
  const missing = ctxOf({ app: good, worker: good, fns, model: model([...sysTokens, { name: '--accent', path: 'sys.color.accent', file: 'sys', type: 'color', value: {} }]) });
  assert.deepEqual(texts(dt10(missing)), ['--accent']);
  const black = ctxOf({ app: good, worker: good, fns: { resolveColor: () => ({ oklch: [0.1, 0, 0] }) }, model: model(sysTokens) });
  assert.equal(dt10(black).length, 5);
  const wrongSel = target('app/src/styles/tokens.css', { 'dark-media': DARK_MEDIA.replace(':not([data-theme="light"])', '[data-theme="dark"]'), 'dark-theme': DARK_THEME });
  assert.ok(dt10(ctxOf({ app: wrongSel, worker: good, fns, model: model(sysTokens) })).some((x) => x.text === 'dark-media'));
});

// ───────────── DT11 ─────────────

const BLOCKS = {
  coarse: CONTROL_CSS.coarse,
  contrast: '@media (prefers-contrast: more) {\n  :root:where(*) { --fg-muted: var(--fg); --separator: var(--fg); --border-strong: var(--fg); }\n}',
  reduce: '@media (prefers-reduced-motion: reduce) {\n  :root:where(*) { --motion-base: 1ms; --motion-slow: 1ms; --progress-tween: 1ms; }\n}',
  'text-scale': ':root:where([data-text-scale="large"]) { --text-body: 17px; }\n:root:where([data-text-scale="x-large"]) { --text-body: 26px; }',
};
const scaleFns = { textScaleValues: (_m, k) => [['--text-body', k === 1.3 ? '17px' : '26px']] };

test('DT11: reduce·coarse·contrast·text-scale 블록 값', () => {
  const ok = target('app/src/styles/tokens.css', BLOCKS);
  assert.deepEqual(dt11(ctxOf({ app: ok, fns: scaleFns, model: model() })), []);
  const bad = target('app/src/styles/tokens.css', {
    ...BLOCKS,
    reduce: BLOCKS.reduce.replace('--progress-tween: 1ms;', '--progress-tween: 1ms; --motion-fast: 1ms;'),
    contrast: BLOCKS.contrast.replace('--border-strong: var(--fg);', '--border-strong: #000;'),
    coarse: BLOCKS.coarse.replace('--row-h: 44px;', '--row-h: 40px;'),
    'text-scale': BLOCKS['text-scale'].replace('17px', '18px'),
  });
  const names = texts(dt11(ctxOf({ app: bad, fns: scaleFns, model: model() })));
  assert.deepEqual(names, ['coarse --row-h', 'contrast --border-strong', 'reduce --motion-fast', 'text-scale large --text-body']);
});

// ───────────── DT12 ─────────────

test('DT12: --font-sans는 system-ui로 시작, @font-face·url(·@import 없음', () => {
  const sans = (first) => ({ name: '--font-sans', path: 'type.font-sans', file: 'type', type: 'fontFamily', value: [first, 'sans-serif'] });
  assert.deepEqual(dt12(ctxOf({ model: model([sans('system-ui')]) })), []);
  const bad = ctxOf({
    model: model([sans('Arial')]),
    appCss: { file: 'app/src/app.css', raw: "@import './styles/tokens.css';\n@font-face { font-family: X; src: url(x.woff2); }" },
  });
  const out = dt12(bad);
  assert.deepEqual(texts(out), ["@font-face", "@import './styles/tokens.css'", '--font-sans', 'url(x.woff2)'].sort());
  assert.equal(out.find((x) => x.text.startsWith('@import')).line, 1);
});

// ───────────── DT13 ─────────────

test('DT13: --z-* 사용 파일이 정확히 하나', () => {
  const app = target('app/src/styles/tokens.css', { root: ':root { --z-menu: 20; --z-toast: 40; --z-dialog: 50; }' });
  const c = ctxOf({
    app,
    worker: app,
    appSources: [entry('app/src/Menu.svelte', 'a { z-index: var(--z-menu); }'), entry('app/src/Toast.svelte', 'a { z-index: var(--z-toast); }'), entry('app/src/D2.svelte', 'a { z-index: var(--z-dialog); }')],
    uiSource: entry('design/ui.css', 'a { z-index: var(--z-dialog); }'),
  });
  const out = dt13(c);
  assert.deepEqual(texts(out), ['--z-dialog']);
  assert.match(out[0].msg, /2개/);
  const none = ctxOf({ app, worker: app });
  assert.equal(dt13(none).length, 3);
});

// ───────────── DT14 ─────────────

const DOC_MD = [
  '## 12. 변경',
  '',
  '## 13. 생성물',
  '',
  '```css',
  ':root {',
  '  color-scheme: light dark;',
  '  --font-sans: system-ui, serif,',
  '               sans-serif;',
  '  --bg: var(--ref-a);',
  '}',
  '/* 주석 { } */',
  ':root:where([data-theme="dark"]) { --bg: var(--ref-b); }',
  ':root:where([data-theme="dark"])  { color-scheme: dark; }',
  '@media (prefers-contrast: more) {',
  '  :root:where(*) { --fg-muted: var(--fg); }',
  '}',
  '```',
  '',
  '## 14. 상수',
].join('\n');

test('parseFoundationsDoc: 주석을 지우고 여러 줄 값·같은 selector 둘을 읽는다', () => {
  const rules = parseFoundationsDoc(DOC_MD);
  assert.equal(rules.filter((r) => r.selector === ':root:where([data-theme="dark"])').length, 2);
  const font = rules.flatMap((r) => r.decls).find((d) => d.prop === '--font-sans');
  assert.equal(font.value.replace(/\s+/g, ' '), 'system-ui, serif, sans-serif');
});

test('DT14: 문서 사전 = 생성물 사전(양방향, dark-media와 legacy는 뺀다)', () => {
  const sections = {
    root: ':root { color-scheme: light dark; --font-sans: system-ui, serif, sans-serif; --bg: var(--ref-a); }',
    'dark-media': '@media (prefers-color-scheme: dark) {\n  :root:where(:not([data-theme="light"])) { --bg: var(--ref-b); }\n}',
    'dark-theme': ':root:where([data-theme="dark"]) { --bg: var(--ref-b); }',
    'theme-scheme': ':root:where([data-theme="dark"]) { color-scheme: dark; }',
    contrast: '@media (prefers-contrast: more) {\n  :root:where(*) { --fg-muted: var(--fg); }\n}',
    legacy: ':root { --old: 1px; }',
  };
  const app = target('app/src/styles/tokens.css', sections);
  const worker = target('worker/src/http/site-css.generated.ts', sections);
  const c = ctxOf({ app, worker, foundations: DOC_MD, docRules: undefined });
  assert.deepEqual(dt14(c), []);
  const drift = target('app/src/styles/tokens.css', { ...sections, root: sections.root.replace('var(--ref-a)', 'var(--ref-z)').replace('}', '--extra: 1px; }') });
  const out = dt14(ctxOf({ app: drift, worker, foundations: DOC_MD, docRules: undefined }));
  assert.ok(out.some((x) => x.text === '--bg' && /값이 다르다/.test(x.msg)));
  assert.ok(out.some((x) => x.text === '--extra' && /생성물에만/.test(x.msg)));
  assert.ok(out.some((x) => /앱·Worker/.test(x.msg)), '앱과 Worker 값이 다르면 알린다');
});

// ───────────── DT15 ─────────────

const CONST_MD = [
  '## 14. 상수 표',
  '',
  '| 이름 | 값 | 표기 | 파일 | 쓰는 곳 | 근거·확인 |',
  '|---|---|---|---|---|---|',
  '| `BREAKPOINT_NARROW` | 600 | [잠정] | 생성기 상수(`tokens.mjs`) | 분기 | x |',
  '| `LOADER_DELAY_MS` / `LOADER_MIN_MS` | 300 / 400 | [제안] | `app/src/lib/timing.ts` | 로딩 | x |',
  '| `PENDING_STUCK_REMAINING_SECS` | 510 | 기존 코드 | 지금 `auth.ts`(DT15 대상 밖). 단계 (a)에서 `timing.ts`로 옮긴다 | 대기 | x |',
  '| `AUTH_CHECK_TIMEOUT_MS` | 40000 | [잠정] | `timing.ts` + Rust | 확인 | x |',
  '| `FAT32_FILE_LIMIT` | 4,294,967,296 | 사실 | Rust | FAT32 | x |',
  '| `LOW_SPACE_FACTOR` | 1.05 | [취향] | Rust | 경고 | x |',
  '| `NETWORK_PATIENCE_MS` | 1800000 | [잠정] | Rust(core) | 재시도 | x |',
  '| `METERED_CONFIRM_BYTES` | 1 GB | [취향] | Rust(v1.1) | 요금 | x |',
  '| `NOTICE_TTL_H` / `CIRCUIT_FAILURES` | 72 / 3 | [잠정] | Worker + Rust | 공지 | x |',
].join('\n');

test('parseConstTable·expectedConsts: A / B 짝, 천 단위 구분, 실수, 파일 칸 규칙', () => {
  const { ts, rs, breakpoint } = expectedConsts(parseConstTable(CONST_MD));
  assert.deepEqual([...ts.keys()], ['LOADER_DELAY_MS', 'LOADER_MIN_MS', 'PENDING_STUCK_REMAINING_SECS', 'AUTH_CHECK_TIMEOUT_MS']);
  assert.equal(ts.get('LOADER_MIN_MS').value, 400);
  assert.deepEqual([...rs.keys()], ['AUTH_CHECK_TIMEOUT_MS', 'FAT32_FILE_LIMIT', 'LOW_SPACE_FACTOR', 'NOTICE_TTL_H', 'CIRCUIT_FAILURES']);
  assert.equal(rs.get('FAT32_FILE_LIMIT').value, 4294967296);
  assert.equal(rs.get('LOW_SPACE_FACTOR').value, 1.05);
  assert.equal(rs.get('CIRCUIT_FAILURES').value, 3);
  assert.equal(breakpoint.value, 600);
});

test('parseTimingConsts·parseRustConsts: 숫자 리터럴과 _ 구분을 읽는다', () => {
  const ts = parseTimingConsts('// 주석\nexport const A_MS = 300;\nexport const B: number = 1.5;\nexport const C = foo();\n');
  assert.deepEqual([...ts.entries()].map(([k, x]) => [k, x.value, x.line]), [['A_MS', 300, 2], ['B', 1.5, 3]]);
  const rs = parseRustConsts('//! 머리\npub const A: u64 = 4_294_967_296;\npub const B: f64 = 1.05;\nconst PRIVATE: u64 = 1;\n');
  assert.deepEqual([...rs.entries()].map(([k, x]) => [k, x.value]), [['A', 4294967296], ['B', 1.05]]);
});

const GOOD_TS = [
  'export const LOADER_DELAY_MS = 300;',
  'export const LOADER_MIN_MS = 400;',
  'export const PENDING_STUCK_REMAINING_SECS = 510;',
  'export const AUTH_CHECK_TIMEOUT_MS = 40000;',
].join('\n');
const GOOD_RS = [
  '//! 상수',
  'pub const AUTH_CHECK_TIMEOUT_MS: u64 = 40_000;',
  'pub const FAT32_FILE_LIMIT: u64 = 4_294_967_296;',
  'pub const LOW_SPACE_FACTOR: f64 = 1.05;',
  'pub const NOTICE_TTL_H: u64 = 72;',
  'pub const CIRCUIT_FAILURES: usize = 3;',
].join('\n');

test('DT15: 값 일치는 통과, 값 불일치·누락·표에 없는 상수·분기점 어긋남은 위반', () => {
  const ok = ctxOf({ foundations: CONST_MD, timing: GOOD_TS, consts: GOOD_RS });
  assert.deepEqual(dt15(ok), []);
  const bad = ctxOf({
    foundations: CONST_MD,
    timing: GOOD_TS.replace('= 400', '= 401') + '\nexport const EXTRA_MS = 1;',
    consts: GOOD_RS.replace('pub const NOTICE_TTL_H: u64 = 72;\n', '').replace('1.05', '1.06'),
    model: model([], { breakpointNarrow: 640 }),
  });
  assert.deepEqual(texts(dt15(bad)), ['BREAKPOINT_NARROW', 'EXTRA_MS', 'LOADER_MIN_MS', 'LOW_SPACE_FACTOR', 'NOTICE_TTL_H']);
  const absent = dt15(ctxOf({ foundations: CONST_MD, timing: null, consts: GOOD_RS }));
  assert.ok(absent.some((x) => x.file === 'app/src/lib/timing.ts'));
});

// ───────────── DT16 ─────────────

const CASCADE = {
  root: ':root { --fg: #111; --fg-muted: #555; --separator: #ddd; --border-strong: #888; --surface-2: #e8e8e8; --surface-pressed: #dbdbdb; --accent-soft: #e2f0ff; }',
  'dark-media': '@media (prefers-color-scheme: dark) {\n  :root:where(:not([data-theme="light"])) { --fg: #eee; --surface-2: #3a3a3a; --surface-pressed: #484848; --accent-soft: #233651; }\n}',
  'dark-theme': ':root:where([data-theme="dark"]) { --fg: #eee; --surface-2: #3a3a3a; --surface-pressed: #484848; --accent-soft: #233651; }',
  'window-inactive': ':root:where([data-window-active="false"]) { --accent-soft: var(--surface-2); }',
  contrast: '@media (prefers-contrast: more) {\n  :root:where(*) { --fg-muted: var(--fg); --separator: var(--fg); --border-strong: var(--fg); }\n}',
};

test('DT16: 다크 + 대비 증가·비활성 창·눌림 면을 캐스케이드로 계산한다', () => {
  const ok = target('app/src/styles/tokens.css', CASCADE);
  assert.deepEqual(dt16(ctxOf({ app: ok, worker: ok })), []);
  // 대비 증가 블록이 다크 블록보다 앞서면 다크에서 죽는다(옛 결함)
  const early = target('app/src/styles/tokens.css', { root: CASCADE.root, contrast: CASCADE.contrast, 'dark-media': CASCADE['dark-media'].replace('--surface-2', '--fg-muted: #aaa; --surface-2'), 'dark-theme': CASCADE['dark-theme'], 'window-inactive': CASCADE['window-inactive'] });
  const out = dt16(ctxOf({ app: early, worker: ok }));
  assert.ok(out.some((x) => /^contrast scheme=dark theme=none --fg-muted$/.test(x.text)));
  assert.ok(!out.some((x) => /scheme=light theme=none/.test(x.text)));
  // 비활성 창이 다크 블록보다 앞서면 선택 면이 되살아난다
  const inactiveFirst = target('app/src/styles/tokens.css', { root: CASCADE.root, 'window-inactive': CASCADE['window-inactive'], 'dark-media': CASCADE['dark-media'], 'dark-theme': CASCADE['dark-theme'], contrast: CASCADE.contrast });
  assert.ok(dt16(ctxOf({ app: inactiveFirst, worker: ok })).some((x) => x.text.startsWith('inactive')));
  // hover 면 = 눌림 면
  const same = target('app/src/styles/tokens.css', { ...CASCADE, root: CASCADE.root.replace('--surface-pressed: #dbdbdb', '--surface-pressed: #e8e8e8') });
  assert.ok(dt16(ctxOf({ app: same, worker: ok })).some((x) => x.text.startsWith('pressed scheme=light theme=none')));
});

// ───────────── DT17 ─────────────

test('DT17: success·info 이름 금지', () => {
  const t = (name, type = 'color') => ({ name, path: `sys.color.${name.slice(2)}`, file: 'sys', type, value: {} });
  assert.deepEqual(dt17(ctxOf({ model: model([t('--fg'), t('--accent-ink')]) })), []);
  const out = dt17(ctxOf({ model: model([t('--success-ink'), t('--info-soft'), t('--info-w', 'dimension')]) }));
  assert.deepEqual(texts(out), ['--info-soft', '--success-ink']);
});

// ───────────── 보조 ─────────────

test('extractSiteCss: 템플릿 리터럴 안 CSS와 시작 줄', () => {
  const ts = '/* 머리 */\nexport const SITE_CSS = `/* [root] a */\n:root { --a: 1px; }`;\nexport const SITE_CSS_HASH = "0123456789abcdef";\n';
  const { css, startLine } = extractSiteCss(ts);
  assert.equal(css, '/* [root] a */\n:root { --a: 1px; }');
  assert.equal(startLine, 2);
});

// ───────────── 저장소 자체 ─────────────

const generatedPresent = ['app/src/styles/tokens.css', 'app/src/styles/ui.css', 'worker/src/http/site-css.generated.ts'].every((f) => fs.existsSync(path.join(ROOT, f)));

test('저장소: 원천·생성물 검사(DT5~DT11·DT14~DT17)는 위반이 0이다', { skip: !generatedPresent && '생성물이 아직 없다' }, () => {
  // 소스 쪽 위반은 허용 목록이 받는다. DT4는 app.css의 html 규칙(단계 (b)에서 고친다)만 소스 쪽이다
  const sourceSide = new Set(['DT2', 'DT3', 'DT12', 'DT13']);
  const bad = check(ROOT).filter((x) => !sourceSide.has(x.rule) && !(x.rule === 'DT4' && x.file === 'app/src/app.css'));
  assert.deepEqual(bad.map((x) => `${x.file}:${x.line}: ${x.rule}: ${x.msg}`), []);
});
