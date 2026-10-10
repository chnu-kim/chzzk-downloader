// node --test scripts/design/css.test.mjs — 디자인 gate 공용 CSS 파서
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractSvelte, lineOf, parseCss, stripComments, varRefs } from './css.mjs';

test('stripComments: 주석을 지우고 줄바꿈 수를 남긴다', () => {
  const out = stripComments('a { /* x\ny\nz */ color: red; }');
  assert.equal(out.split('\n').length, 3);
  assert.ok(!out.includes('x'));
  assert.ok(out.includes('color: red'));
});

test('stripComments: 문자열 안의 여는 주석 표시는 주석이 아니다', () => {
  const css = 'a::after { content: "/* 유지 */"; color: red; } b { content: \'/*\'; }';
  assert.equal(stripComments(css), css);
});

test('stripComments: 닫히지 않은 주석은 끝까지 지운다, CRLF는 LF로', () => {
  assert.equal(stripComments('a{}\r\n/* 끝'), 'a{}\n');
});

test('parseCss: 기본 규칙·선언·줄 번호', () => {
  const { rules } = parseCss('.a,\n.b   >  c {\n  color: red;\n  padding : 4px  8px ;\n}\n');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, '.a, .b > c');
  assert.equal(rules[0].line, 1);
  assert.deepEqual(
    rules[0].decls.map((d) => [d.prop, d.value, d.line]),
    [
      ['color', 'red', 3],
      ['padding', '4px 8px', 4],
    ],
  );
});

test('parseCss: startLine을 더한다, 속성 이름은 소문자·커스텀 속성은 원문', () => {
  const { rules } = parseCss('a { COLOR: red; --Foo: 1px }', { startLine: 10 });
  assert.equal(rules[0].line, 10);
  assert.deepEqual(rules[0].decls.map((d) => d.prop), ['color', '--Foo']);
  assert.equal(rules[0].decls[0].line, 10);
});

test('parseCss: !important를 떼어 내고 표시한다', () => {
  const { rules } = parseCss('a { color: red !important; margin: 0 ! important; padding: 1px }');
  assert.deepEqual(
    rules[0].decls.map((d) => [d.prop, d.value, d.important]),
    [
      ['color', 'red', true],
      ['margin', '0', true],
      ['padding', '1px', false],
    ],
  );
});

test('parseCss: 중첩 @media는 바깥→안 순서로 media에 쌓인다', () => {
  const css = `
@media (prefers-color-scheme: dark) {
  :root { --a: 1; }
  @media (min-width: 600px) {
    .x { color: red }
  }
}
.y { top: 0 }
`;
  const { rules } = parseCss(css);
  assert.deepEqual(rules.map((r) => [r.selector, r.media]), [
    [':root', ['@media (prefers-color-scheme: dark)']],
    ['.x', ['@media (prefers-color-scheme: dark)', '@media (min-width: 600px)']],
    ['.y', []],
  ]);
  assert.equal(rules[1].line, 5);
});

test('parseCss: @keyframes 안 규칙은 media에 keyframes를 단다', () => {
  const { rules } = parseCss('@keyframes spin { from { transform: rotate(0deg) } 50%, to { opacity: 1 } }');
  assert.deepEqual(rules.map((r) => [r.selector, r.media]), [
    ['from', ['@keyframes spin']],
    ['50%, to', ['@keyframes spin']],
  ]);
  assert.equal(rules[0].decls[0].value, 'rotate(0deg)');
});

test('parseCss: @font-face는 selector @font-face 규칙, 블록 없는 at-rule은 atStatements', () => {
  const { rules, atStatements } = parseCss('@charset "utf-8";\n@import url("./a.css") layer(base);\n@font-face { font-family: X; src: url(x.woff2) }');
  assert.equal(rules[0].selector, '@font-face');
  assert.deepEqual(rules[0].decls.map((d) => d.prop), ['font-family', 'src']);
  assert.deepEqual(atStatements.map((a) => [a.name, a.line]), [['charset', 1], ['import', 2]]);
  assert.equal(atStatements[1].prelude, 'url("./a.css") layer(base)');
});

test('parseCss: CSS nesting을 평탄화한다(& 치환, 없으면 공백)', () => {
  const css = '.btn, .link { color: red; &:hover { color: blue } .icon { margin: 0 } & + & { top: 0 } @media (max-width: 599px) { padding: 0 } }';
  const { rules } = parseCss(css);
  assert.deepEqual(rules.map((r) => r.selector), [
    '.btn, .link',
    '.btn:hover, .link:hover',
    '.btn .icon, .link .icon',
    '.btn + .btn, .link + .link',
    '.btn, .link',
  ]);
  const inMedia = rules[4];
  assert.deepEqual(inMedia.media, ['@media (max-width: 599px)']);
  assert.deepEqual(inMedia.decls.map((d) => d.prop), ['padding']);
});

test('parseCss: 문자열·괄호 안의 ; { } 는 구분자가 아니다', () => {
  const css = 'a::before { content: "a;b{c}"; background: url(data:image/svg+xml;base64,AAA); color: red }';
  const { rules } = parseCss(css);
  assert.deepEqual(rules[0].decls.map((d) => d.prop), ['content', 'background', 'color']);
  assert.equal(rules[0].decls[0].value, '"a;b{c}"');
});

test('parseCss: 주석 안의 선언은 보이지 않고 줄 번호는 유지된다', () => {
  const { rules } = parseCss('/* a { color: red } */\n/* 둘째\n줄 */\nb { top: 0 }');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].line, 4);
});

test('parseCss: 닫는 괄호가 없어도 던지지 않는다', () => {
  assert.doesNotThrow(() => parseCss('a { color: red'));
  assert.doesNotThrow(() => parseCss('} } a { top: 0 }'));
  assert.equal(parseCss('} a { top: 0 }').rules.length, 1);
});

test('extractSvelte: style·script·markup 분리와 줄 번호', () => {
  const src = [
    '<script lang="ts">',
    '  let a = 1;',
    '</script>',
    '',
    '<div class="x">{a}</div>',
    '',
    '<style>',
    '  .x { color: red; }',
    '</style>',
    '',
  ].join('\n');
  const r = extractSvelte(src);
  assert.equal(r.scripts.length, 1);
  assert.equal(r.scripts[0].startLine, 1);
  assert.match(r.scripts[0].code, /let a = 1/);
  assert.equal(r.styles.length, 1);
  assert.equal(r.styles[0].startLine, 7);
  const { rules } = parseCss(r.styles[0].css, { startLine: r.styles[0].startLine });
  assert.equal(rules[0].line, 8);
  assert.equal(rules[0].decls[0].line, 8);
  // markup은 줄 수가 같고 블록 내용이 없다
  assert.equal(r.markup.split('\n').length, src.split('\n').length);
  assert.ok(r.markup.includes('<div class="x">{a}</div>'));
  assert.ok(!r.markup.includes('let a'));
  assert.ok(!r.markup.includes('color: red'));
  assert.equal(r.markup.split('\n')[4], '<div class="x">{a}</div>');
});

test('extractSvelte: 블록이 없으면 markup이 원문', () => {
  const r = extractSvelte('<p>안녕</p>\r\n');
  assert.deepEqual([r.styles, r.scripts], [[], []]);
  assert.equal(r.markup, '<p>안녕</p>\n');
});

test('varRefs: var(--x)와 폴백이 있는 var의 이름과 줄', () => {
  const r = varRefs('a {\n  color: var(--fg);\n  margin: var( --space-8 , 4px) var(--x,\n var(--y));\n}', { startLine: 3 });
  assert.deepEqual(r, [
    { name: '--fg', line: 4 },
    { name: '--space-8', line: 5 },
    { name: '--x', line: 5 },
    { name: '--y', line: 6 },
  ]);
});

test('lineOf: 1부터 센다', () => {
  assert.equal(lineOf('a\nb\nc', 0), 1);
  assert.equal(lineOf('a\nb\nc', 2), 2);
  assert.equal(lineOf('a\nb\nc', 4, 10), 12);
});
