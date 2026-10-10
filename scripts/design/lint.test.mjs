// node --test scripts/design/lint.test.mjs — design-lint(DL·DS·DP·DX)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ALLOW_PATH, applyAllow, formatAllow, toEntries, validateAllow } from './allow.mjs';
import { FAMILIES, attrValue, check, findTags, isExcluded, lintFile, listTargets, parseVocab, propsBodies, scanStrings, stripJsComments } from './lint.mjs';

const SELF = fileURLToPath(new URL('./lint.mjs', import.meta.url));

const VOCAB = parseVocab(`
export const BUTTON_VARIANT = ['primary', 'secondary', 'ghost'] as const;
export const NOTICE_VARIANT = ['inline', 'banner', 'row', 'toast'] as const;
export const TONE = ['neutral', 'info', 'warning', 'danger'] as const;
export const SIZE = ['sm', 'md', 'lg'] as const;
export const KIND = ['vod', 'clip', 'rewind', 'adult'] as const;
export const PROGRESS_STATE = ['active', 'paused', 'failed', 'waiting'] as const;
export const BOOLEAN_PROPS = ['disabled', 'open', 'loading', 'required', 'readonly', 'invalid'] as const;
export const ICON_BUTTON_ICONS = ['x', 'ellipsis', 'chevron-down', 'settings'] as const;
`);

const COMP = 'app/src/lib/components/jobs/Item.svelte';
const UI = 'app/src/lib/components/ui/Thing.svelte';

/** 위반을 `RULE text` 문자열 목록(중복 없음, 정렬)으로. */
function got(rel, src, opt = { vocab: VOCAB }) {
  return [...new Set(lintFile(rel, src, opt).map((v) => `${v.rule} ${v.text}`))].sort();
}
/** CSS 선언 한 줄(들)을 규칙 안에 넣어 ui.css처럼 검사한다. */
const decl = (d, rel = 'design/ui.css', sel = '.x') => got(rel, `${sel} { ${d} }`);
const rulesOf = (list) => list.map((s) => s.split(' ')[0]);
const svelte = (markup, script = '', style = '') =>
  `${script ? `<script lang="ts">\n${script}\n</script>\n` : ''}${markup}\n${style ? `<style>\n${style}\n</style>\n` : ''}`;

test('FAMILIES는 DL·DS·DP·DX', () => {
  assert.deepEqual(FAMILIES, ['DL', 'DS', 'DP', 'DX']);
});

// ---------------------------------------------------------------------------
// DL: CSS 선언
// ---------------------------------------------------------------------------

test('DL1: 색 리터럴(#, rgb/hsl/oklch, 색 이름)은 위반, 토큰·transparent는 통과', () => {
  assert.deepEqual(decl('color: #fff'), ['DL1 color: #fff']);
  assert.deepEqual(decl('background: rgba(0, 0, 0, .5)'), ['DL1 background: rgba(0, 0, 0, .5)']);
  assert.deepEqual(decl('color: oklch(0.5 0.1 200)'), ['DL1 color: oklch(0.5 0.1 200)']);
  assert.deepEqual(decl('background: red'), ['DL1 background: red']);
  assert.deepEqual(decl('border: 1px solid white'), ['DL1 border: 1px solid white']);
  assert.deepEqual(decl('color: var(--fg)'), []);
  assert.deepEqual(decl('background: transparent'), []);
  assert.deepEqual(decl('border-color: var(--separator)'), []);
  assert.deepEqual(decl('fill: url(#shape)'), [], 'url 안의 # 는 색이 아니다');
  assert.deepEqual(decl('animation-name: tan'), [], '색 속성이 아니면 낱말 비교를 하지 않는다');
  assert.deepEqual(decl('color: var(--red-ish)'), [], 'var 이름의 낱말은 색 이름이 아니다');
});

test('DL2: px 길이 리터럴, 0·0px·선 굵기·50%·100%는 통과', () => {
  assert.deepEqual(decl('padding: 0 12px'), ['DL2 padding: 0 12px']);
  assert.deepEqual(decl('margin: 1px'), ['DL2 margin: 1px']);
  assert.deepEqual(decl('padding: 0 var(--space-12)'), []);
  assert.deepEqual(decl('margin: 0px'), []);
  assert.deepEqual(decl('width: 100%; height: 50%'), []);
  assert.deepEqual(decl('border: 1px solid var(--separator)'), []);
  assert.deepEqual(decl('outline: 2px solid var(--focus); outline-offset: 2px'), []);
  assert.deepEqual(decl('border-radius: 2px'), ['DL5 border-radius: 2px', 'DL2 border-radius: 2px'].sort(), '반경은 선 굵기가 아니다');
});

test('DL2: 라디오 고리만 box-shadow에 px를 쓸 수 있다', () => {
  assert.deepEqual(decl('box-shadow: inset 0 0 0 4px var(--surface)'), []);
  assert.deepEqual(rulesOf(decl('box-shadow: inset 0 0 0 3px var(--surface)')).sort(), ['DL2', 'DL9']);
});

test('DL2: calc 정책 — 숫자 리터럴 피연산자는 위반, 토큰·0px·100%는 통과', () => {
  assert.deepEqual(decl('width: calc(100% - 20px)'), ['DL2 width: calc(100% - 20px)']);
  assert.deepEqual(decl('margin-left: calc(0px - var(--space-6))'), []);
  assert.deepEqual(decl('max-width: calc(100% - 2 * var(--edge))'), []);
  assert.deepEqual(decl('left: calc(var(--switch-w) - var(--switch-h))'), []);
});

test('DL11: calc의 ±1px, translate(-50%, 정지 상태 transform, 상태 클래스', () => {
  assert.deepEqual(decl('width: calc(var(--control-h) - 1px)'), ['DL11 width: calc(var(--control-h) - 1px)']);
  assert.deepEqual(decl('top: calc(var(--x) + 1px)'), ['DL11 top: calc(var(--x) + 1px)']);
  assert.deepEqual(decl('transform: translate(-50%, -50%)'), ['DL11 transform: translate(-50%, -50%)']);
  assert.deepEqual(decl('transform: rotate(90deg)'), ['DL11 transform: rotate(90deg)']);
  assert.deepEqual(decl('transform: rotate(90deg)', 'design/ui.css', '.disclosure[open] .chev'), []);
  assert.deepEqual(decl('transform: scaleX(var(--p))', 'design/ui.css', '.fill'), []);
  assert.deepEqual(decl('transform: rotate(360deg)', 'design/ui.css', '.spinner'), []);
  assert.deepEqual(decl('transform: scale(1.05)', 'design/ui.css', '.btn:active'), []);
  assert.deepEqual(got('design/ui.css', '@keyframes spin { to { transform: rotate(360deg) } }'), []);
  assert.deepEqual(decl('color: var(--fg)', 'design/ui.css', '.is-open'), ['DL11 .is-open']);
  assert.deepEqual(decl('color: var(--fg)', 'design/ui.css', '.menu.active'), ['DL11 .menu.active']);
  assert.deepEqual(decl('color: var(--fg)', 'design/ui.css', '.menu[open]'), []);
  // 상태 클래스 금지는 ui.css 한정
  assert.deepEqual(decl('color: var(--fg)', 'app/src/app.css', '.is-open'), []);
});

test('DL3: 시간 리터럴', () => {
  assert.deepEqual(decl('transition: color 100ms'), ['DL3 transition: color 100ms']);
  assert.deepEqual(decl('animation: spin 1s linear infinite'), ['DL3 animation: spin 1s linear infinite']);
  assert.deepEqual(decl('animation-duration: 0.2s'), ['DL3 animation-duration: 0.2s']);
  assert.deepEqual(decl('transition: color var(--motion-fast)'), []);
  assert.deepEqual(decl('animation: spin var(--motion-spin) linear infinite'), []);
  assert.deepEqual(decl('transition: transform var(--progress-tween) linear'), []);
});

test('DL4: z-index는 var(--z-*)만', () => {
  assert.deepEqual(decl('z-index: 10'), ['DL4 z-index: 10']);
  assert.deepEqual(decl('z-index: var(--z-menu)'), []);
  assert.deepEqual(decl('z-index: var(--layer)'), ['DL4 z-index: var(--layer)']);
});

test('DL5: 글자·반경은 var만, letter-spacing·font-smoothing·line-height normal 금지', () => {
  assert.deepEqual(decl('font-size: 14px'), ['DL2 font-size: 14px', 'DL5 font-size: 14px']);
  assert.deepEqual(decl('font-size: var(--text-body)'), []);
  assert.deepEqual(decl('font-weight: 500'), ['DL5 font-weight: 500']);
  assert.deepEqual(decl('line-height: normal'), ['DL5 line-height: normal']);
  assert.deepEqual(decl('line-height: 1.5'), ['DL5 line-height: 1.5']);
  assert.deepEqual(decl('line-height: var(--leading-body)'), []);
  assert.deepEqual(decl('letter-spacing: 0'), ['DL5 letter-spacing: 0']);
  assert.deepEqual(decl('-webkit-font-smoothing: antialiased'), ['DL5 -webkit-font-smoothing: antialiased']);
  assert.deepEqual(decl('border-radius: 6px'), ['DL2 border-radius: 6px', 'DL5 border-radius: 6px']);
  assert.deepEqual(decl('border-radius: var(--radius-control)'), []);
  assert.deepEqual(decl('border-top-left-radius: 0'), ['DL5 border-top-left-radius: 0']);
  assert.deepEqual(decl('font-family: system-ui'), ['DL5 font-family: system-ui']);
  assert.deepEqual(decl('font-family: var(--font-mono)'), []);
  assert.deepEqual(decl('font-family: var(--font-other)'), ['DL5 font-family: var(--font-other)']);
  assert.deepEqual(decl('font-family: inherit'), []);
});

test('DL5: html { font-size: 16px }는 app.css·site.css에서만 통과', () => {
  assert.deepEqual(got('app/src/app.css', 'html { font-size: 16px }'), []);
  assert.deepEqual(got('worker/src/http/site.css', 'html { font-size: 16px }'), []);
  assert.deepEqual(got('app/src/app.css', ':root { font-size: 14px }').sort(), ['DL2 font-size: 14px', 'DL5 font-size: 14px']);
  assert.ok(got('design/ui.css', 'html { font-size: 16px }').includes('DL5 font-size: 16px'));
});

test('DL6: --ref-* 직접 사용', () => {
  assert.deepEqual(decl('color: var(--ref-gray-500)'), ['DL6 --ref-gray-500']);
  assert.deepEqual(decl('color: var(--fg)'), []);
});

test('DL7: 컴포넌트 안 -- 선언은 --p만', () => {
  assert.deepEqual(decl('--rail-color: var(--fg)'), ['DL7 --rail-color']);
  assert.deepEqual(decl('--p: 0'), []);
});

test('DL8: !important, transition: all, outline: none, forced-color-adjust, backdrop-filter, text-wrap, break-word, justify, cursor: pointer', () => {
  assert.deepEqual(decl('color: var(--fg) !important'), ['DL8 color: var(--fg) !important']);
  assert.deepEqual(decl('transition: all var(--motion-fast)'), ['DL8 transition: all var(--motion-fast)']);
  assert.deepEqual(decl('transition: color var(--motion-fast), all var(--motion-base)').length, 1);
  assert.deepEqual(decl('transition: color var(--motion-fast)'), []);
  assert.deepEqual(decl('outline: none'), ['DL8 outline: none']);
  assert.deepEqual(decl('outline: 0'), ['DL8 outline: 0']);
  assert.deepEqual(decl('outline: none', 'design/ui.css', '[data-focus-container]:focus-visible'), []);
  assert.deepEqual(decl('forced-color-adjust: none'), ['DL8 forced-color-adjust: none']);
  assert.deepEqual(decl('backdrop-filter: blur(var(--space-4))'), ['DL8 backdrop-filter: blur(var(--space-4))']);
  assert.deepEqual(decl('text-wrap: balance'), ['DL8 text-wrap: balance']);
  assert.deepEqual(decl('overflow-wrap: break-word'), ['DL8 overflow-wrap: break-word']);
  assert.deepEqual(decl('text-align: justify'), ['DL8 text-align: justify']);
  assert.deepEqual(decl('cursor: pointer'), ['DL8 cursor: pointer']);
  assert.deepEqual(decl('cursor: pointer', 'worker/src/http/site.css'), [], 'Worker site.css는 cursor: pointer 허용');
  assert.deepEqual(decl('word-break: keep-all; overflow-wrap: anywhere'), []);
});

test('DL9: box-shadow는 --shadow-*와 라디오 고리만, :focus 규칙 안은 금지', () => {
  assert.deepEqual(decl('box-shadow: var(--shadow-menu)'), []);
  assert.deepEqual(decl('box-shadow: 0 1px var(--fg)'), ['DL9 box-shadow: 0 1px var(--fg)', 'DL2 box-shadow: 0 1px var(--fg)'].sort());
  assert.deepEqual(decl('box-shadow: var(--shadow-menu)', 'design/ui.css', '.x:focus-visible'), ['DL9 box-shadow: var(--shadow-menu)']);
  assert.deepEqual(decl('box-shadow: var(--shadow-menu)', 'design/ui.css', '.x:focus-within'), []);
});

test('DL10: 하한 밖 기능', () => {
  assert.deepEqual(decl('color: light-dark(var(--a), var(--b))'), ['DL10 color: light-dark(var(--a), var(--b))']);
  assert.deepEqual(decl('transition-timing-function: linear(0, 1)'), ['DL10 transition-timing-function: linear(0, 1)']);
  assert.deepEqual(decl('background: repeating-linear-gradient(-45deg, var(--accent) 0 var(--space-4), transparent var(--space-4) var(--space-8))'), [], 'linear-gradient는 linear()가 아니다');
  assert.deepEqual(decl('scrollbar-width: none'), ['DL10 scrollbar-width: none']);
  assert.deepEqual(decl('scrollbar-gutter: stable'), ['DL10 scrollbar-gutter: stable']);
  assert.deepEqual(decl('accent-color: var(--accent)'), ['DL10 accent-color: var(--accent)']);
  assert.deepEqual(decl('field-sizing: content'), ['DL10 field-sizing: content']);
  assert.deepEqual(decl('color: rgb(from var(--a) r g b)'), ['DL1 color: rgb(from var(--a) r g b)', 'DL10 color: rgb(from var(--a) r g b)']);
  assert.deepEqual(decl('color: AccentColor'), ['DL10 color: AccentColor']);
  assert.deepEqual(decl('anchor-name: --a'), ['DL10 anchor-name: --a']);
  assert.deepEqual(got('design/ui.css', '.x::-webkit-scrollbar { top: 0 }'), ['DL10 .x::-webkit-scrollbar']);
  assert.deepEqual(got('design/ui.css', '@starting-style { .x { top: 0 } }'), ['DL10 @starting-style']);
  assert.deepEqual(decl('color: color-mix(in srgb, var(--a) 50%, var(--b))'), []);
});

test('DL12: :hover 규칙은 표시·크기를 바꾸지 않는다', () => {
  assert.deepEqual(decl('background: var(--surface-2)', 'design/ui.css', '.x:hover'), []);
  assert.deepEqual(decl('opacity: 1', 'design/ui.css', '.x:hover'), ['DL12 opacity: 1']);
  assert.deepEqual(decl('display: block', 'design/ui.css', '.x:hover'), ['DL12 display: block']);
  assert.deepEqual(decl('min-width: 0', 'design/ui.css', '.x:hover'), ['DL12 min-width: 0']);
  assert.deepEqual(decl('opacity: 1', 'design/ui.css', '.x'), []);
});

test('DL13: 폭·포인터 미디어 쿼리는 허용 파일에서만', () => {
  const q = '@media (max-width: 599px) { .x { top: 0 } }';
  assert.deepEqual(got('design/ui.css', q), ['DL13 @media (max-width: 599px)']);
  assert.deepEqual(got(COMP, svelte('<p></p>', '', `@media (min-width: 840px) { .x { top: 0 } }`)), ['DL13 @media (min-width: 840px)']);
  assert.deepEqual(got('design/ui.css', '@media (pointer: coarse) { .x { top: 0 } }'), ['DL13 @media (pointer: coarse)']);
  assert.deepEqual(got('design/ui.css', '@media (any-pointer: coarse) { .x { top: 0 } }'), ['DL13 @media (any-pointer: coarse)']);
  assert.deepEqual(got('design/ui.css', '@media (hover: hover) { .x { top: 0 } }'), ['DL13 @media (hover: hover)']);
  assert.deepEqual(got('worker/src/http/site.css', q), []);
  assert.deepEqual(got('app/src/styles/tokens.css', q), []);
  assert.deepEqual(got('design/ui.css', '@media (prefers-reduced-motion: reduce) { .x { top: 0 } }'), []);
});

test('DL13: layout.css의 두 블록 선언이 같아야 한다', () => {
  const ok = '@media (max-width: 599px) { .a { top: 0 } }\n:root[data-text-scale="x-large"] .a { top: 0 }';
  const bad = '@media (max-width: 599px) { .a { top: var(--a) } }\n:root[data-text-scale="x-large"] .a { top: var(--b) }';
  assert.deepEqual(got('app/src/styles/layout.css', ok), []);
  assert.deepEqual(got('app/src/styles/layout.css', bad), ['DL13 layout.css 두 블록이 다르다: .a']);
});

test('DL14: border·outline 선 굵기는 0·1px·2px만', () => {
  assert.deepEqual(decl('border: 3px solid var(--fg)'), ['DL14 border: 3px solid var(--fg)']);
  assert.deepEqual(decl('border-top: 1.5px solid var(--fg)'), ['DL14 border-top: 1.5px solid var(--fg)']);
  assert.deepEqual(decl('outline: 0.5px solid var(--fg)'), ['DL14 outline: 0.5px solid var(--fg)']);
  assert.deepEqual(decl('border: 2px solid var(--fg)'), []);
});

// ---------------------------------------------------------------------------
// DX: CSS 쪽 확장 검사
// ---------------------------------------------------------------------------

test('DX2: cursor: not-allowed 금지, cursor·user-select는 전역 CSS에만', () => {
  assert.deepEqual(decl('cursor: not-allowed'), ['DX2 cursor: not-allowed']);
  assert.deepEqual(decl('cursor: default'), ['DX2 cursor: default']);
  assert.deepEqual(decl('user-select: none'), ['DX2 user-select: none']);
  assert.deepEqual(decl('cursor: default', 'app/src/app.css', 'body'), []);
  assert.deepEqual(decl('user-select: none', 'app/src/app.css', 'body'), []);
});

test('DX8: prefers-contrast: less·custom 금지(CSS와 스크립트)', () => {
  assert.deepEqual(got('design/ui.css', '@media (prefers-contrast: less) { .x { top: 0 } }'), ['DX8 @media (prefers-contrast: less)']);
  assert.deepEqual(got('design/ui.css', '@media (prefers-contrast: more) { .x { top: 0 } }'), []);
  assert.deepEqual(got('app/src/lib/x.ts', "matchMedia('(prefers-contrast: custom)')"), ['DX8 prefers-contrast: custom']);
});

test('DX9: 컨트롤에는 height 대신 min-height', () => {
  assert.deepEqual(decl('height: var(--control-h)', 'design/ui.css', '.btn'), ['DX9 height: var(--control-h)']);
  assert.deepEqual(decl('min-height: var(--control-h)', 'design/ui.css', '.btn'), []);
  assert.deepEqual(decl('height: var(--progress-h)', 'design/ui.css', '.progress'), []);
  assert.deepEqual(decl('height: var(--switch-h)', 'design/ui.css', '.switch'), []);
  assert.deepEqual(decl('height: var(--icon-sm)', 'design/ui.css', '.btn-icon'), []);
  assert.deepEqual(decl('height: var(--row-h)', 'design/ui.css', '.row'), ['DX9 height: var(--row-h)']);
});

test('DX13: 오버레이에 color-mix(… transparent) 금지', () => {
  assert.deepEqual(decl('background: color-mix(in srgb, var(--scrim) 50%, transparent)', 'design/ui.css', '.drop-overlay'), [
    'DX13 background: color-mix(in srgb, var(--scrim) 50%, transparent)',
  ]);
  assert.deepEqual(decl('background: color-mix(in srgb, var(--scrim) 50%, transparent)', 'design/ui.css', '.other'), []);
  assert.deepEqual(decl('background: var(--scrim)', 'design/ui.css', '.drop-overlay'), []);
});

// ---------------------------------------------------------------------------
// DS: 소스 스캔
// ---------------------------------------------------------------------------

test('DS1: ui/ 밖의 원시 요소·role', () => {
  assert.deepEqual(got(COMP, svelte('<button>x</button><input /><select></select><textarea></textarea><dialog></dialog><progress></progress>')), [
    'DS1 <button',
    'DS1 <dialog',
    'DS1 <input',
    'DS1 <progress',
    'DS1 <select',
    'DS1 <textarea',
  ]);
  assert.deepEqual(got(COMP, svelte('<div role="dialog"></div><div role="switch"></div><div role="menu"></div><div role="alert"></div>')), [
    'DS1 role="alert"',
    'DS1 role="dialog"',
    'DS1 role="menu"',
    'DS1 role="switch"',
  ]);
  assert.deepEqual(got(COMP, svelte('<Button>x</Button><div role="group"></div>')), []);
  assert.deepEqual(got(UI, svelte('<button>x</button><input />')), []);
});

test('DS1: Spinner에는 role·aria-label 금지', () => {
  assert.deepEqual(got('app/src/lib/components/ui/Spinner.svelte', svelte('<span class="spinner" role="status" aria-label="x"></span>')), [
    'DS1 Spinner aria-label',
    'DS1 Spinner role',
  ]);
  assert.deepEqual(got('app/src/lib/components/ui/Spinner.svelte', svelte('<span class="spinner" aria-hidden="true"></span>')), []);
});

test('DX12: role="alert"는 Notice.svelte에만', () => {
  assert.deepEqual(got('app/src/lib/components/ui/Toast.svelte', svelte('<div role="alert"></div>')), ['DX12 role="alert"']);
  assert.deepEqual(got('app/src/lib/components/ui/Notice.svelte', svelte('<div role="alert"></div>')), []);
});

test('DS2: 인라인 style 속성은 위반, style:--p 디렉티브만 통과', () => {
  assert.deepEqual(got(COMP, svelte('<div style="width: 50%"></div>')), ['DS2 style="width: 50%"']);
  assert.deepEqual(got(COMP, svelte('<div style={css}></div>')), ['DS2 style={css}']);
  assert.deepEqual(got(COMP, svelte('<div style:width="50%"></div>')), ['DS2 style:width']);
  assert.deepEqual(got(COMP, svelte('<div style:--p={value / 100}></div>')), []);
});

test('DS3: :global( 은 app.css만', () => {
  assert.deepEqual(got(COMP, svelte('<p></p>', '', ':global(body) { top: 0 }')), ['DS3 :global(']);
  assert.deepEqual(got('app/src/app.css', ':global(body) { top: 0 }'), []);
  assert.deepEqual(got('app/src/other.css', ':global(body) { top: 0 }'), ['DS3 :global(']);
});

test('DS4·DS5: {@html, <svg (Icon.svelte만 허용)', () => {
  assert.deepEqual(got(COMP, svelte('<div>{@html raw}</div>')), ['DS4 {@html']);
  assert.deepEqual(got(COMP, svelte('<svg viewBox="0 0 1 1"></svg>')), ['DS5 <svg']);
  assert.deepEqual(got('app/src/lib/components/ui/Icon.svelte', svelte('<svg viewBox="0 0 1 1"></svg>')), []);
  // Spinner는 회전 호를 자기 svg로 그린다(components.md §2.21)
  assert.deepEqual(got('app/src/lib/components/ui/Spinner.svelte', svelte('<svg viewBox="0 0 1 1"></svg>')), []);
});

test('DS6: .svelte 안 한글 리터럴(텍스트·속성·스크립트 문자열), 주석과 .ts는 제외', () => {
  assert.deepEqual(got(COMP, svelte('<p>받기</p>')), ['DS6 받기']);
  assert.deepEqual(got(COMP, svelte('<Button aria-label="닫기">x</Button>')), ['DS6 닫기']);
  assert.deepEqual(got(COMP, svelte('<p>{label}</p>', "const t = '확인'; const u = `삭제 ${n}개`;")), ['DS6 삭제 ${n}개', 'DS6 확인']);
  assert.deepEqual(got(COMP, svelte('<!-- 설명 주석 -->\n<p>{label}</p>', '// 설명\n/* 둘째 */ const a = 1;')), []);
  assert.deepEqual(got('app/src/lib/copy/ko.ts', "export const a = '받기';"), []);
});

test('DS6: 템플릿 aria-label, 조각 결합(·, join)', () => {
  assert.deepEqual(got(COMP, svelte('<div aria-label={`${a} ${b}`}></div>')), ['DS6 aria-label={`${a} ${b}`}']);
  assert.deepEqual(got(COMP, svelte('<p>{a} · {b}</p>')), ['DS6 } · {']);
  assert.deepEqual(got(COMP, svelte('<p></p>', "const s = parts.join(', ');")), ["DS6 .join(', ')"]);
  assert.deepEqual(got(COMP, svelte('<p></p>', "const s = `${a} · ${b}`;")), ['DS6 ${a} · ${b}']);
  assert.deepEqual(got(COMP, svelte('<p></p>', "const s = parts.join('');")), []);
});

test('DS7: title= 속성은 허용 목록으로만', () => {
  assert.deepEqual(got(COMP, svelte('<span title={full}>x</span>')), ['DS7 title={full}']);
  assert.deepEqual(got(COMP, svelte('<span title="abc">x</span>')), ['DS7 title="abc"']);
  // 컴포넌트의 title prop(Dialog·Notice 제목)은 툴팁 속성이 아니다
  assert.deepEqual(got(COMP, svelte('<ConfirmDialog title={t("dialog.x.title")} />')), []);
  assert.deepEqual(got(COMP, svelte('<span>x</span>')), []);
  // IconButton의 title={label}은 명세다(components.md §2.2)
  assert.deepEqual(got('app/src/lib/components/ui/IconButton.svelte', svelte('<button title={label}>x</button>', 'let { label }: { label: string } = $props();')), []);
});

test('DS8: 앱 소스의 cursor: pointer(마크업·스크립트·ts)', () => {
  assert.deepEqual(got(COMP, svelte('<div class="a"></div>', "el.style.cssText = 'cursor: pointer';")), ['DS8 cursor: pointer']);
  assert.deepEqual(got('app/src/lib/x.ts', "const s = 'cursor:pointer';"), ['DS8 cursor: pointer']);
});

test('DS9·DS2: Worker HTML 템플릿', () => {
  const rel = 'worker/src/http/pages.ts';
  assert.deepEqual(got(rel, 'export const a = `<style>x</style><div style="a"></div><script>1</script><a onclick="f()">`;'), [
    'DS2 style=',
    'DS9 <script',
    'DS9 <style',
    'DS9 onclick=',
    'DS9 style=',
  ]);
  assert.deepEqual(got(rel, 'export const a = `<div class="btn"></div>`;'), []);
  assert.deepEqual(got(rel, '// <style> 은 쓰지 않는다\nexport const a = 1;'), []);
});

// ---------------------------------------------------------------------------
// DP
// ---------------------------------------------------------------------------

test('DP1: 사용처의 variant·tone·size·kind·state 글자 값은 어휘 안', () => {
  assert.deepEqual(got(COMP, svelte('<Button variant="primary" size="md">x</Button><Notice tone="info" variant="toast" />')), []);
  assert.deepEqual(got(COMP, svelte('<Button variant="link">x</Button>')), ['DP1 variant="link"']);
  assert.deepEqual(got(COMP, svelte('<Notice tone="success" />')), ['DP1 tone="success"']);
  assert.deepEqual(got(COMP, svelte('<Badge kind="live" />')), ['DP1 kind="live"']);
  assert.deepEqual(got(COMP, svelte('<ProgressBar state="stuck" />')), ['DP1 state="stuck"']);
  assert.deepEqual(got(COMP, svelte('<Button size={s}>x</Button>')), [], '동적 값은 타입이 막는다');
  assert.deepEqual(got(COMP, svelte('<input size="20" />')).filter((s) => s.startsWith('DP1')), [], '네이티브 요소는 보지 않는다');
});

test('DP1: variant는 그 컴포넌트의 *_VARIANT, 없으면 *_VARIANT 전부의 합집합', () => {
  const v = parseVocab(`
export const BUTTON_VARIANT = ['primary', 'secondary', 'ghost'] as const;
export const SURFACE_VARIANT = ['group', 'card'] as const;
export const EMPTY_STATE_VARIANT = ['inline', 'panel', 'page'] as const;
`);
  assert.deepEqual(got(COMP, svelte('<Surface variant="card">x</Surface><EmptyState variant="panel">x</EmptyState>'), { vocab: v }), []);
  assert.deepEqual(got(COMP, svelte('<Surface variant="ghost">x</Surface>'), { vocab: v }), ['DP1 variant="ghost"']);
  assert.deepEqual(got(COMP, svelte('<Button variant="card">x</Button>'), { vocab: v }), ['DP1 variant="card"']);
  // 자기 배열이 없는 컴포넌트(Thing)는 합집합으로 본다
  assert.deepEqual(got(COMP, svelte('<Thing variant="panel">x</Thing>'), { vocab: v }), []);
  assert.deepEqual(got(COMP, svelte('<Thing variant="nope">x</Thing>'), { vocab: v }), ['DP1 variant="nope"']);
});

test('DP5: IconButton의 icon 값은 ICON_BUTTON_ICONS 안', () => {
  assert.deepEqual(got(COMP, svelte('<IconButton icon="x" label="a" />')), []);
  assert.deepEqual(got(COMP, svelte('<IconButton icon="trash" label="a" />')), ['DP5 icon="trash"']);
});

test('DP1·DP5: vocab이 없으면 판정을 건너뛴다', () => {
  assert.deepEqual(got(COMP, svelte('<Button variant="link">x</Button><IconButton icon="trash" label="a" />'), { vocab: null }), []);
});

test('DP2: ui/ 컴포넌트의 불리언 prop은 BOOLEAN_PROPS만', () => {
  const inline = svelte('<span></span>', 'let { open = $bindable(false), checked, mono }: { open?: boolean; checked: boolean; mono?: boolean; label: string } = $props();');
  assert.deepEqual(got(UI, inline), ['DP2 checked', 'DP2 mono']);
  const iface = svelte('<span></span>', 'interface Props { disabled?: boolean; striped: boolean }\nlet { disabled, striped }: Props = $props();');
  assert.deepEqual(got(UI, iface), ['DP2 striped']);
  // $state 의 boolean 타입은 prop이 아니다
  assert.deepEqual(got(UI, svelte('<span></span>', 'let { a }: { a: string } = $props();\nlet hover: boolean = $state(false);')), []);
  // ui/ 밖은 보지 않는다
  assert.deepEqual(got(COMP, inline), []);
});

test('DP2: Switch의 value: boolean은 값 prop이라 걸리지 않는다', () => {
  const body = svelte('<span></span>', "import type { NameProps } from './vocab';\nlet { value = $bindable(), checked }: { value: boolean; checked: boolean; label: string } = $props();");
  assert.deepEqual(got('app/src/lib/components/ui/Switch.svelte', body), ['DP2 checked']);
  assert.deepEqual(got(UI, body), ['DP2 checked', 'DP2 value']);
});

test('DP3: 이벤트 prop은 on + 소문자 동사, 같은 뜻 둘 금지', () => {
  assert.deepEqual(got(UI, svelte('<span></span>', 'let { onclose }: { onclose?: () => void; onchange: () => void } = $props();')), []);
  assert.deepEqual(got(UI, svelte('<span></span>', 'let { onSubmit }: { onSubmit: () => void } = $props();')), ['DP3 onSubmit']);
  assert.deepEqual(got(UI, svelte('<span></span>', 'let { a }: { onclose?: () => void; ondismiss?: () => void } = $props();')), ['DP3 onclose+ondismiss']);
});

test('DP4: IconButton의 label은 필수, 입력류는 NameProps', () => {
  const ib = 'app/src/lib/components/ui/IconButton.svelte';
  assert.deepEqual(got(ib, svelte('<span></span>', 'let { icon, label }: { icon: string; label: string } = $props();')), []);
  assert.deepEqual(got(ib, svelte('<span></span>', 'let { icon, label }: { icon: string; label?: string } = $props();')), ['DP4 IconButton label']);
  assert.deepEqual(got(ib, svelte('<span></span>', 'let { icon }: { icon: string } = $props();')), ['DP4 IconButton label']);
  const tf = 'app/src/lib/components/ui/TextField.svelte';
  assert.deepEqual(got(tf, svelte('<span></span>', "import type { NameProps } from './types';\ntype Props = NameProps & { value: string };\nlet { value }: Props = $props();")), []);
  assert.deepEqual(got(tf, svelte('<span></span>', 'let { value }: { value: string } = $props();')), ['DP4 TextField NameProps']);
});

test('DP1: vocab.ts가 없으면 파일 없음 위반 하나(check)', () => {
  const d = tmpRepo({ 'app/src/lib/a.ts': 'export const a = 1;\n' });
  try {
    const vs = check(d);
    assert.deepEqual(vs.map((v) => [v.rule, v.file, v.line, v.text]), [['DP1', 'app/src/lib/components/ui/vocab.ts', 0, 'vocab.ts 없음']]);
    // vocab.ts가 생기면 사라지고 DP1·DP5 판정이 켜진다
    writeTree(d, {
      'app/src/lib/components/ui/vocab.ts': "export const BUTTON_VARIANT = ['primary'] as const;\n",
      'app/src/lib/b.svelte': '<Button variant="ghost">x</Button>\n',
    });
    assert.deepEqual(check(d).map((v) => `${v.rule} ${v.text}`), ['DP1 variant="ghost"']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// DX: 소스
// ---------------------------------------------------------------------------

test('DX1: 드래그 영역·titleBarStyle·hiddenTitle', () => {
  assert.deepEqual(got(COMP, svelte('<div data-tauri-drag-region></div>')), ['DX1 data-tauri-drag-region']);
  assert.deepEqual(got('app/src/lib/x.ts', "const c = { titleBarStyle: 'Overlay', hiddenTitle: true };"), ['DX1 hiddenTitle', 'DX1 titleBarStyle']);
  assert.deepEqual(got('app/src/lib/x.ts', '// titleBarStyle 은 쓰지 않는다\nexport const a = 1;'), []);
});

test('DX3: <img·<a 에는 draggable="false"', () => {
  assert.deepEqual(got(COMP, svelte('<img src="a" /><a href="b">x</a>')), ['DX3 <a', 'DX3 <img']);
  assert.deepEqual(got(COMP, svelte('<img src="a" draggable="false" /><a href="b" draggable={false}>x</a>')), []);
});

test('DX4: wheel·gesture·contextmenu 리스너는 guards.ts에만', () => {
  assert.deepEqual(got('app/src/lib/x.ts', "window.addEventListener('wheel', f);"), ['DX4 wheel']);
  assert.deepEqual(got('app/src/lib/x.ts', 'document.addEventListener("contextmenu", f);'), ['DX4 contextmenu']);
  assert.deepEqual(got(COMP, svelte('<div onwheel={f}></div>')), ['DX4 wheel']);
  assert.deepEqual(got(COMP, svelte('<svelte:window on:gesturestart={f} />')), ['DX4 gesturestart']);
  assert.deepEqual(got('app/src/lib/guards.ts', "window.addEventListener('wheel', f);"), []);
  assert.deepEqual(got('app/src/lib/x.ts', "window.addEventListener('scroll', f);"), []);
});

test('DX5: pointer 미디어·maxTouchPoints·navigator.platform·userAgent', () => {
  assert.deepEqual(got('app/src/lib/x.ts', "matchMedia('(pointer: coarse)')"), ['DX5 matchMedia((pointer']);
  assert.deepEqual(got('app/src/lib/x.ts', 'const n = navigator.maxTouchPoints + navigator.platform + navigator.userAgent;'), [
    'DX5 maxTouchPoints',
    'DX5 navigator.platform',
    'DX5 navigator.userAgent',
  ]);
  assert.deepEqual(got('app/src/lib/x.ts', "matchMedia('(prefers-color-scheme: dark)')"), []);
});

test('DX6: keydown 리스너 파일은 isImeKey, input의 Enter 분기, compositionend + setTimeout', () => {
  assert.deepEqual(got(COMP, svelte('<div onkeydown={f}></div>')), ['DX6 keydown without isImeKey']);
  assert.deepEqual(got(COMP, svelte('<div onkeydown={f}></div>', "import { isImeKey } from '$lib/ime';")), []);
  assert.deepEqual(got('app/src/lib/x.ts', "el.addEventListener('keydown', f);"), ['DX6 keydown without isImeKey']);
  assert.deepEqual(got('app/src/lib/x.ts', "import { isImeKey } from './ime';\nel.addEventListener('keydown', f);"), []);
  assert.deepEqual(
    got(COMP, svelte('<input onkeydown={(e) => e.key === \'Enter\' && go()} />', "import { isImeKey } from './ime';")),
    ['DS1 <input', 'DX6 input onkeydown Enter'],
  );
  assert.deepEqual(
    got(COMP, svelte('<input onkeydown={onKey} />', "import { isImeKey } from './ime';\nfunction onKey(e) { if (e.key === 'Enter') go(); }")),
    ['DS1 <input', 'DX6 input onkeydown Enter'],
  );
  assert.deepEqual(got('app/src/lib/x.ts', "el.addEventListener('compositionend', () => { setTimeout(go, DELAY); });"), ['DX6 compositionend+setTimeout']);
});

test('DX7: navigator.clipboard.readText(', () => {
  assert.deepEqual(got('app/src/lib/x.ts', 'const t = await navigator.clipboard.readText();'), ['DX7 navigator.clipboard.readText(']);
  assert.deepEqual(got('app/src/lib/x.ts', 'await navigator.clipboard.writeText(t);'), []);
});

test('DX10: setTimeout의 숫자 지연, Spinner·Skeleton은 useDelayedLoading', () => {
  assert.deepEqual(got('app/src/lib/x.ts', 'setTimeout(() => go(), 150);'), ['DX10 setTimeout(…, 150)']);
  assert.deepEqual(got('app/src/lib/x.ts', 'setTimeout(() => { a(); b(c, d); }, 1000);'), ['DX10 setTimeout(…, 1000)']);
  assert.deepEqual(got('app/src/lib/x.ts', 'setTimeout(go, DELAY_MS);'), []);
  assert.deepEqual(got(COMP, svelte('<Spinner />')), ['DX10 <Spinner without useDelayedLoading']);
  assert.deepEqual(got(COMP, svelte('<Skeleton />')), ['DX10 <Skeleton without useDelayedLoading']);
  assert.deepEqual(got(COMP, svelte('<Spinner />', "import { useDelayedLoading } from '$lib/loading';")), []);
});

test('DX11: 조사 선택 함수', () => {
  assert.deepEqual(got('app/src/lib/x.ts', 'const s = josa(name, "을");'), ['DX11 josa']);
  assert.deepEqual(got('app/src/lib/x.ts', 'function pickParticle(w) { return w; }'), ['DX11 pickParticle']);
  assert.deepEqual(got('app/src/lib/x.ts', 'const s = format(name);'), []);
});

// ---------------------------------------------------------------------------
// 대상·제외·도우미
// ---------------------------------------------------------------------------

test('isExcluded: 테스트·bindings·test 폴더·생성물·d.ts', () => {
  for (const r of [
    'app/src/lib/a.test.ts',
    'app/src/lib/bindings/Job.ts',
    'app/src/test/setup.ts',
    'app/src/lib/components/ui/test/DialogHarness.svelte',
    'app/src/styles/tokens.css',
    'app/src/styles/ui.css',
    'worker/src/http/site-css.generated.ts',
    'app/src/vite-env.d.ts',
  ]) {
    assert.equal(isExcluded(r), true, r);
  }
  for (const r of ['app/src/app.css', 'design/ui.css', 'app/src/lib/components/ui/Button.svelte', 'worker/src/http/site.css', 'app/src/lib/copy/ko.ts']) {
    assert.equal(isExcluded(r), false, r);
  }
});

test('listTargets: ui.css·앱·worker/src/http만, 제외 경로는 뺀다', () => {
  const d = tmpRepo({
    'design/ui.css': '.x { top: 0 }\n',
    'app/src/App.svelte': '<p></p>\n',
    'app/src/lib/a.ts': 'export const a = 1;\n',
    'app/src/lib/a.test.ts': 'export const a = 1;\n',
    'app/src/lib/bindings/B.ts': 'export type B = 1;\n',
    'app/src/styles/tokens.css': ':root{}\n',
    'app/src/lib/README.md': '# x\n',
    'worker/src/http/pages.ts': 'export const a = 1;\n',
    'worker/src/http/site.css': 'html { font-size: 16px }\n',
    'worker/src/http/site-css.generated.ts': 'export const SITE_CSS = ``;\n',
    'worker/src/core/x.ts': 'export const a = 1;\n',
    'app/node_modules/x/index.ts': 'export const a = 1;\n',
  });
  try {
    assert.deepEqual(listTargets(d), [
      'app/src/App.svelte',
      'app/src/lib/a.ts',
      'design/ui.css',
      'worker/src/http/pages.ts',
      'worker/src/http/site.css',
    ]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('stripJsComments·scanStrings: 문자열 안의 // 는 주석이 아니고 줄 번호가 유지된다', () => {
  const code = "const u = 'https://a.b'; // 뒤 주석\n/* 블록\n주석 */ const t = `x ${'한글'} y`;\n";
  const out = stripJsComments(code);
  assert.ok(out.includes("'https://a.b'"));
  assert.ok(!out.includes('뒤 주석') && !out.includes('블록'));
  assert.equal(out.split('\n').length, code.split('\n').length);
  const strs = scanStrings(out).map((s) => [s.value, s.line]);
  assert.deepEqual(strs, [
    ['https://a.b', 1],
    ['한글', 3],
    ["x ${'한글'} y", 3],
  ]);
});

test('findTags·attrValue·propsBodies·parseVocab', () => {
  const tags = findTags('<div a="1">\n  <Button variant="primary" onclick={() => (x = a > b)}>t</Button>\n</div>');
  assert.deepEqual(tags.map((t) => [t.name, t.line]), [['div', 1], ['Button', 2]]);
  assert.equal(attrValue(tags[1].attrs, 'variant'), 'primary');
  assert.equal(attrValue(tags[1].attrs, 'onclick'), null);
  assert.equal(attrValue(tags[1].attrs, 'size'), undefined);
  assert.equal(propsBodies('let { a }: { a: boolean; b: { c: string } } = $props();').length, 1);
  assert.equal(propsBodies('interface FooProps extends Bar { a: boolean }').length, 1);
  assert.equal(propsBodies('type FooProps = NameProps & { a: boolean };').length, 1);
  assert.deepEqual(parseVocab("export const SIZE = ['sm', \"md\"] as const;\n"), { SIZE: ['sm', 'md'] });
});

// ---------------------------------------------------------------------------
// CLI·허용 목록
// ---------------------------------------------------------------------------

function writeTree(d, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = join(d, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
}
function tmpRepo(files) {
  const d = mkdtempSync(join(tmpdir(), 'ds-'));
  writeTree(d, files);
  return d;
}

test('--print-allow는 허용 목록 스키마를 통과하고 자기 위반을 정확히 덮는다', () => {
  const d = tmpRepo({
    'design/ui.css': '.btn { padding: 0 12px; color: #fff; cursor: pointer }\n',
    'app/src/lib/components/jobs/A.svelte': svelte('<button title="a">한글</button>', '', '.a { z-index: 3 }'),
  });
  try {
    const r = spawnSync(process.execPath, [SELF, '--print-allow', '--root', d], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const entries = JSON.parse(r.stdout);
    assert.ok(entries.length >= 6);
    assert.deepEqual(validateAllow({ entries }), []);
    const { remaining, unused } = applyAllow(check(d), entries, FAMILIES);
    assert.deepEqual([remaining, unused], [[], []]);
    // 허용 목록 없이 돌리면 2, 허용 목록을 넣으면 0, 깨끗해진 뒤 항목이 남으면 1
    assert.equal(spawnSync(process.execPath, [SELF, '--root', d], { encoding: 'utf8' }).status, 2);
    writeTree(d, { [ALLOW_PATH]: formatAllow('c', entries) });
    const ok = spawnSync(process.execPath, [SELF, '--root', d], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout);
    writeTree(d, { 'design/ui.css': '.btn { padding: 0 var(--space-12) }\n', 'app/src/lib/components/jobs/A.svelte': '<p></p>\n' });
    const stale = spawnSync(process.execPath, [SELF, '--root', d], { encoding: 'utf8' });
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /허용 목록 항목이 맞는 위반이 없다/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('위반 출력은 file:line: RULE: 내용, GITHUB_ACTIONS면 ::error', () => {
  const d = tmpRepo({
    'design/ui.css': '.btn {\n  padding: 0 12px;\n}\n',
    'app/src/lib/components/ui/vocab.ts': 'export const SIZE = [] as const;\n',
    [ALLOW_PATH]: formatAllow('c', []),
  });
  try {
    const plain = spawnSync(process.execPath, [SELF, '--root', d], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
    assert.equal(plain.status, 1);
    assert.match(plain.stdout, /^design\/ui\.css:2: DL2: .*padding: 0 12px/m);
    const gh = spawnSync(process.execPath, [SELF, '--root', d], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' } });
    assert.match(gh.stdout, /^::error file=design\/ui\.css,line=2::DL2: /m);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('CRLF 원문도 같은 줄 번호', () => {
  const vs = lintFile('design/ui.css', '.a {\r\n  color: red;\r\n}\r\n', { vocab: VOCAB });
  assert.deepEqual(vs.map((v) => [v.rule, v.line]), [['DL1', 2]]);
});
