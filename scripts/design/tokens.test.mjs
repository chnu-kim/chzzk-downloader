// tokens.mjs 단위 테스트: 변환 골든 33색, 임시 루트에서 생성·--check, 원천 오류, 출력 서식, text-scale 유도.
// 저장소의 design/tokens 원천은 임시 루트로 복사해 읽기만 한다(저장소 파일을 쓰지 않는다).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { oklchToSrgb, parseHex, toHex } from './contrast.mjs';
import { HEADER, OUTPUTS, ROOT, SECTIONS, cssName, cssValue, generate, loadModel, main, resolveColor, siteCssOf, splitSections, textScaleValues } from './tokens.mjs';

const UI = '.x {\n  color: var(--fg);\n}\n';
const SITE = '/* Worker 웹 전용 CSS(docs/design/system/web.md). 단계 (e)에서 채운다 */\nhtml {\n  font-size: 16px;\n}\n';

function mkRoot({ ui = UI } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  mkdirSync(join(dir, 'design'));
  mkdirSync(join(dir, 'worker', 'src', 'http'), { recursive: true });
  cpSync(join(ROOT, 'design', 'tokens'), join(dir, 'design', 'tokens'), { recursive: true });
  if (ui !== null) writeFileSync(join(dir, 'design', 'ui.css'), ui);
  writeFileSync(join(dir, 'worker', 'src', 'http', 'site.css'), SITE);
  return dir;
}
const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

function quiet(fn) {
  const logs = [];
  const errs = [];
  const [log, err] = [console.log, console.error];
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  try {
    return { code: fn(), logs, errs };
  } finally {
    [console.log, console.error] = [log, err];
  }
}

function mutate(dir, file, fn) {
  const p = join(dir, 'design', 'tokens', `${file}.tokens.json`);
  const json = JSON.parse(readFileSync(p, 'utf8'));
  fn(json);
  writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
}

// ---- (가) 변환 골든: foundations.md 2.2 표의 알파 아닌 ref 33색 ----
const GOLDEN = [
  ['gray.965', 0.965, 0, 0, '#F3F3F3'], ['gray.930', 0.93, 0, 0, '#E8E8E8'], ['gray.720', 0.72, 0, 0, '#A4A4A4'],
  ['gray.890', 0.89, 0, 0, '#DBDBDB'], ['gray.700', 0.7, 0, 0, '#9E9E9E'], ['gray.620', 0.62, 0, 0, '#868686'],
  ['gray.600', 0.6, 0, 0, '#808080'], ['gray.540', 0.54, 0, 0, '#6F6F6F'], ['gray.480', 0.48, 0, 0, '#5D5D5D'],
  ['gray.400', 0.4, 0, 0, '#484848'], ['gray.350', 0.35, 0, 0, '#3A3A3A'], ['gray.320', 0.32, 0, 0, '#333333'],
  ['gray.290', 0.29, 0, 0, '#2B2B2B'], ['gray.240', 0.24, 0, 0, '#1F1F1F'], ['gray.220', 0.22, 0, 0, '#1B1B1B'],
  ['white', 1, 0, 0, '#FFFFFF'],
  ['blue.54', 0.54, 0.2, 258, '#0067DF'], ['blue.48', 0.48, 0.19, 258, '#0056C5'], ['blue.50', 0.5, 0.18, 258, '#085DC7'],
  ['blue.57', 0.57, 0.19, 258, '#1E72E4'], ['blue.74', 0.74, 0.13, 255, '#70ADFB'], ['blue.95', 0.95, 0.03, 258, '#E2F0FF'],
  ['blue.33', 0.33, 0.055, 258, '#233651'],
  ['red.53', 0.53, 0.2, 27, '#C51E21'], ['red.52', 0.52, 0.19, 27, '#BE2323'], ['red.56', 0.56, 0.19, 27, '#CC3430'],
  ['red.75', 0.75, 0.14, 25, '#FA8880'], ['red.95', 0.95, 0.03, 27, '#FFE7E4'], ['red.33', 0.33, 0.06, 27, '#502824'],
  ['amber.51', 0.51, 0.12, 65, '#945500'], ['amber.78', 0.78, 0.13, 75, '#E8AA4E'], ['amber.96', 0.96, 0.04, 80, '#FFF0D4'],
  ['amber.33', 0.33, 0.05, 80, '#433215'],
];

test('변환 골든: 알파 아닌 ref 33색의 OKLCH → hex가 ±1/255 안이다', () => {
  assert.equal(GOLDEN.length, 33);
  for (const [name, L, C, H, hex] of GOLDEN) {
    const got = parseHex(toHex(oklchToSrgb(L, C, H)));
    const want = parseHex(hex);
    assert.ok(got.every((v, i) => Math.abs(v - want[i]) <= 1), `${name}: ${toHex(oklchToSrgb(L, C, H))} ≠ ${hex}`);
  }
});

test('원천 ref hex가 골든 표와 같고 변환값과 1/255 안이다', () => {
  const model = loadModel(ROOT);
  for (const [name, , , , hex] of GOLDEN) {
    const t = model.byName.get(cssName(`ref.${name}`));
    assert.ok(t, `${name}: ref 토큰이 없다`);
    assert.equal(t.value.hex, hex, name);
  }
  assert.equal(model.tokens.filter((t) => t.file === 'ref').length, 39);
});

test('이름 규칙: ref는 --ref-경로, 그 밖은 잎 키', () => {
  assert.equal(cssName('ref.gray.965'), '--ref-gray-965');
  assert.equal(cssName('ref.black.a8'), '--ref-black-a8');
  assert.equal(cssName('ref.white'), '--ref-white');
  assert.equal(cssName('ref.white-a10'), '--ref-white-a10');
  assert.equal(cssName('sys.color.fg-muted'), '--fg-muted');
  assert.equal(cssName('space.space-8'), '--space-8');
  assert.equal(cssName('layer.z-menu'), '--z-menu');
});

// ---- 모델 ----
test('모델: 토큰 수·확장 키·대비 쌍 수', () => {
  const m = loadModel(ROOT);
  assert.equal(m.contrast.light.length, 46);
  assert.equal(m.contrast.dark.length, 46);
  assert.equal(m.breakpointNarrow, 600);
  assert.deepEqual(m.textScale, { large: 1.3, 'x-large': 2 });
  assert.equal(m.byName.get('--text-hero').rootless, true);
  assert.equal(m.byName.get('--breakpoint-narrow').noCss, true);
  assert.deepEqual(Object.keys(m.byName.get('--fg-muted').overrides), ['contrast']);
  assert.equal(m.byName.get('--motion-spin').overrides.reduce, undefined);
  assert.ok(!m.byName.has('--success') && !m.byName.has('--text-xs'));
});

test('resolveColor: 별칭을 ref까지 따라가고 테마·블록 값을 낸다', () => {
  const m = loadModel(ROOT);
  assert.equal(resolveColor(m, '--bg', 'light').hex, '#F3F3F3');
  assert.equal(resolveColor(m, '--bg', 'dark').hex, '#1F1F1F');
  assert.deepEqual(resolveColor(m, '--bg', 'light').oklch, [0.965, 0, 0]);
  assert.equal(resolveColor(m, '--surface', 'light').oklch, null);
  assert.equal(resolveColor(m, '--focus', 'light').hex, '#085DC7');
  assert.equal(resolveColor(m, '--focus', 'dark').hex, '#70ADFB');
  assert.equal(resolveColor(m, '--on-accent', 'dark').hex, '#FFFFFF');
  const sep = resolveColor(m, '--separator', 'dark');
  assert.equal(sep.hex, '#FFFFFF');
  assert.equal(sep.alpha, 0.1);
  assert.equal(resolveColor(m, '--accent-soft', 'dark', 'window-inactive').hex, '#3A3A3A');
  assert.equal(resolveColor(m, '--fg-muted', 'dark', 'contrast').hex, '#E8E8E8');
  assert.equal(resolveColor(m, '--fg-muted', 'light', 'contrast').hex, '#1B1B1B');
  assert.throws(() => resolveColor(m, '--space-8', 'light'), /색 토큰/);
});

// ---- (라) text-scale 유도 ----
test('text-scale 유도값이 foundations 3.2 표와 같다', () => {
  const m = loadModel(ROOT);
  const px = (rows) => Object.fromEntries(rows.map(([n, v]) => [n, Number.parseInt(v, 10)]));
  const large = px(textScaleValues(m, 1.3));
  assert.deepEqual(large, {
    '--text-caption': 16, '--leading-caption': 20, '--text-body': 17, '--leading-body': 22,
    '--text-title': 20, '--leading-title': 26, '--text-display': 22, '--leading-display': 28, '--leading-read': 26,
  });
  const xl = px(textScaleValues(m, 2));
  assert.deepEqual(xl, {
    '--text-caption': 24, '--leading-caption': 30, '--text-body': 26, '--leading-body': 34,
    '--text-title': 30, '--leading-title': 38, '--text-display': 34, '--leading-display': 44, '--leading-read': 40,
  });
  assert.deepEqual(textScaleValues(m, 1.3).map(([n]) => n), [
    '--text-caption', '--leading-caption', '--text-body', '--leading-body', '--text-title', '--leading-title', '--text-display', '--leading-display', '--leading-read',
  ]);
});

// ---- (마) 값 → CSS ----
test('cssValue: 그림자·글꼴·알파·이징·길이 0', () => {
  const m = loadModel(ROOT);
  const css = (n, raw) => cssValue(m, m.byName.get(n), raw ?? m.byName.get(n).value);
  assert.equal(css('--shadow-menu'), '0 0 0 1px var(--ref-black-a8), 0 4px 12px rgba(0, 0, 0, 0.14)');
  assert.equal(css('--shadow-menu', m.byName.get('--shadow-menu').dark), 'inset 0 0 0 1px var(--ref-white-a8), 0 4px 12px rgba(0, 0, 0, 0.40)');
  assert.equal(css('--shadow-dialog'), '0 0 0 1px var(--ref-black-a10), 0 16px 40px rgba(0, 0, 0, 0.22)');
  assert.equal(css('--font-sans'), "system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans CJK KR', 'Noto Sans KR', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif");
  assert.equal(css('--font-mono'), "ui-monospace, 'SF Mono', Menlo, Consolas, 'Cascadia Mono', 'D2Coding', monospace");
  assert.equal(css('--ref-black-a10'), 'rgba(0, 0, 0, 0.10)');
  assert.equal(css('--ref-white-a8'), 'rgba(255, 255, 255, 0.08)');
  assert.equal(css('--ref-gray-965'), '#F3F3F3');
  assert.equal(css('--ease-out'), 'cubic-bezier(0.2, 0, 0, 1)');
  assert.equal(css('--ease-in'), 'cubic-bezier(0.4, 0, 1, 1)');
  assert.equal(css('--icon-stroke'), '1.5px');
  assert.equal(css('--motion-fast'), '100ms');
  assert.equal(css('--weight-strong'), '600');
  assert.equal(css('--z-dialog'), '50');
  assert.equal(css('--edge'), 'var(--space-20)');
  assert.equal(css('--focus'), 'var(--accent-ink)');
});

// ---- (다) 출력 서식 ----
test('생성물: 머리줄·절 표지 순서·서식, 앱에는 reading 없음, Worker에는 text-scale·legacy 없음', () => {
  const dir = mkRoot();
  try {
    const { files, siteCss, hash } = generate(dir);
    const tokens = files[OUTPUTS.tokens];
    assert.ok(tokens.startsWith(`${HEADER}\n/* [root] `));
    assert.ok(tokens.endsWith('}\n') && !tokens.endsWith('\n\n') && !tokens.includes('\r'));
    assert.ok(tokens.includes('\n  --space-8: 8px;\n'));
    assert.ok(tokens.includes('  color-scheme: light dark;\n'));
    const appNames = splitSections(tokens).map((s) => s.name);
    assert.deepEqual(appNames, ['root', 'dark-media', 'dark-theme', 'theme-scheme', 'window-inactive', 'text-scale', 'contrast', 'coarse', 'reduce', 'legacy']);
    assert.ok(appNames.every((n) => SECTIONS.includes(n)));
    assert.ok(!tokens.includes('data-scale="reading"') && !tokens.includes('--text-hero'));

    const worker = files[OUTPUTS.worker];
    const css = siteCssOf(worker);
    assert.equal(css, siteCss);
    const wkNames = splitSections(css).map((s) => s.name);
    assert.deepEqual(wkNames, ['root', 'dark-media', 'dark-theme', 'theme-scheme', 'window-inactive', 'reading', 'contrast', 'coarse', 'reduce', 'ui', 'site']);
    assert.ok(!css.includes('data-text-scale') && !css.includes('[legacy]') && !css.includes('--fg-faint'));
    assert.match(worker, /^\/\* 생성물[^\n]*\*\/\nexport const SITE_CSS = `[^`]*`;\nexport const SITE_CSS_HASH = "[0-9a-f]{16}";\n$/);
    assert.equal(hash, createHash('sha256').update(css, 'utf8').digest('hex').slice(0, 16));
    assert.ok(worker.endsWith(`SITE_CSS_HASH = "${hash}";\n`));

    // 앱·Worker의 같은 이름 절은 바이트까지 같다
    const app = new Map(splitSections(tokens).map((s) => [s.name, s.text]));
    for (const s of splitSections(css)) if (app.has(s.name)) assert.equal(s.text, app.get(s.name), s.name);
    // ui 절은 design/ui.css 그대로, 앱 ui.css와 같다
    assert.equal(files[OUTPUTS.ui], `${HEADER}\n/* [ui] design/ui.css */\n${UI}`);
    assert.equal(splitSections(css).find((s) => s.name === 'ui').text, `/* [ui] design/ui.css */\n${UI.trimEnd()}`);
    assert.ok(css.includes('\n\n/* [ui] design/ui.css */\n') && css.includes(`${UI}\n/* [site] worker/src/http/site.css */\n${SITE}`));
    // 절 사이에는 빈 줄 하나
    assert.ok(!/\n\n\n/.test(tokens) && !/\n\n\n/.test(css));
    // 선언 줄은 모두 들여쓰기 2칸의 배수
    for (const line of tokens.split('\n')) assert.ok(!/^ [^ ]|^ {3}[^ ]/.test(line) || /^ {2}\S|^ {4}\S|^ {6}\S/.test(line), line);
  } finally {
    cleanup(dir);
  }
});

test('생성: 결정적이고 입력 순서에 기대지 않는다', () => {
  const dir = mkRoot();
  try {
    const a = generate(dir);
    const b = generate(dir);
    assert.deepEqual(a.files, b.files);
    assert.equal(a.hash, b.hash);
  } finally {
    cleanup(dir);
  }
});

test('splitSections: 표지 앞 글자는 버리고 절 끝 빈 줄은 뗀다', () => {
  const text = `${HEADER}\n/* [a] 하나 */\n:root {\n  --x: 1;\n}\n\n\n/* [b-c] 둘 */\n.y {}\r\n`;
  assert.deepEqual(splitSections(text), [
    { name: 'a', text: '/* [a] 하나 */\n:root {\n  --x: 1;\n}' },
    { name: 'b-c', text: '/* [b-c] 둘 */\n.y {}' },
  ]);
  assert.deepEqual(splitSections('머리만'), []);
  assert.equal(siteCssOf('아무거나'), null);
});

// ---- (나) --check ----
test('--check: 생성 직후 0, 생성물 한 글자 바꾸면 1', () => {
  const dir = mkRoot();
  try {
    assert.equal(quiet(() => main(['--root', dir])).code, 0);
    for (const rel of Object.values(OUTPUTS)) assert.ok(read(dir, rel).length > 0);
    assert.equal(quiet(() => main(['--check', '--root', dir])).code, 0);

    const p = join(dir, OUTPUTS.tokens);
    const orig = readFileSync(p, 'utf8');
    assert.ok(orig.includes('  --space-8: 8px;'));
    writeFileSync(p, orig.replace('  --space-8: 8px;', '  --space-8: 9px;'));
    const r = quiet(() => main(['--check', '--root', dir]));
    assert.equal(r.code, 1);
    assert.match(r.logs.join('\n'), /app\/src\/styles\/tokens\.css:\d+: DT1: /);
    writeFileSync(p, orig);
    assert.equal(quiet(() => main(['--check', '--root', dir])).code, 0);

    // 생성물이 없어도 1
    rmSync(join(dir, OUTPUTS.ui));
    const miss = quiet(() => main(['--check', '--root', dir]));
    assert.equal(miss.code, 1);
    assert.match(miss.logs.join('\n'), /app\/src\/styles\/ui\.css:0: DT1: 생성물이 없다/);
  } finally {
    cleanup(dir);
  }
});

test('--check: 원천 ui.css가 바뀌었는데 생성물이 그대로면 1, GITHUB_ACTIONS면 ::error 형식', () => {
  const dir = mkRoot();
  try {
    quiet(() => main(['--root', dir]));
    writeFileSync(join(dir, 'design', 'ui.css'), '.x {\n  color: var(--bg);\n}\n');
    const prev = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = 'true';
    try {
      const r = quiet(() => main(['--check', '--root', dir]));
      assert.equal(r.code, 1);
      assert.match(r.logs[0], /^::error file=app\/src\/styles\/ui\.css,line=\d+::DT1: /);
    } finally {
      if (prev === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = prev;
    }
  } finally {
    cleanup(dir);
  }
});

test('--check: Worker 생성물의 공통 절이 앱과 다르면 1(두 생성물이 각자 원천과 같아도)', () => {
  const dir = mkRoot();
  try {
    quiet(() => main(['--root', dir]));
    const p = join(dir, OUTPUTS.worker);
    writeFileSync(p, readFileSync(p, 'utf8').replace('--space-8: 8px;', '--space-8: 9px;'));
    const r = quiet(() => main(['--check', '--root', dir]));
    assert.equal(r.code, 1);
    assert.match(r.logs.join('\n'), /site-css\.generated\.ts:\d+: DT1: /);
  } finally {
    cleanup(dir);
  }
});

test('CLI 인자 오류는 2', () => {
  assert.equal(quiet(() => main(['--nope'])).code, 2);
  assert.equal(quiet(() => main(['--root'])).code, 2);
});

// ---- 원천 오류는 2 ----
const BAD = [
  ['허용 밖 키', 'space', (j) => { j.space['space-8'].$deprecated = true; }, /허용 밖 키 \$deprecated/],
  ['$description 없음', 'space', (j) => { delete j.space['space-8'].$description; }, /\$description/],
  ['알 수 없는 $type', 'space', (j) => { j.space['space-8'].$type = 'typography'; }, /\$type/],
  ['허용 밖 확장 키', 'space', (j) => { j.space['space-8'].$extensions = { 'io.github.chnu-kim.chzzk': { foo: 1 } }; }, /허용 밖 확장 키 foo/],
  ['다른 확장 이름', 'space', (j) => { j.space['space-8'].$extensions = { other: {} }; }, /\$extensions/],
  ['알 수 없는 블록', 'size', (j) => { j.size['row-h'].$extensions['io.github.chnu-kim.chzzk'].overrides.print = { value: 1, unit: 'px' }; }, /알 수 없는 블록 print/],
  ['ref 별칭', 'ref', (j) => { j.ref.blue['54'].$value = '{ref.blue.48}'; }, /ref 토큰은 별칭/],
  ['hex 어긋남', 'ref', (j) => { j.ref.blue['54'].$value.hex = '#0067F0'; }, /변환값/],
  ['hex 형식', 'ref', (j) => { j.ref.blue['54'].$value.hex = '#0067df'; }, /hex는/],
  ['dimension 단위', 'space', (j) => { j.space['space-8'].$value = { value: 0.5, unit: 'rem' }; }, /단위는 px/],
  ['duration 단위', 'motion', (j) => { j.motion['motion-fast'].$value = { value: 1, unit: 's' }; }, /단위는 ms/],
  ['없는 별칭 대상', 'space', (j) => { j.space.edge.$value = '{space.space-99}'; }, /별칭 대상/],
  ['별칭 타입 불일치', 'space', (j) => { j.space.edge.$value = '{ref.white}'; }, /타입/],
  ['별칭 깊이 초과', 'space', (j) => { j.space['gap-label'].$value = '{space.edge}'; j.space.edge.$value = '{space.gap-sibling}'; }, /깊이 2/],
  ['별칭 순환', 'space', (j) => { j.space['space-8'].$value = '{space.edge}'; j.space.edge.$value = '{space.space-8}'; }, /돌고 돈다|깊이 2/],
  ['잎 키(CSS 이름) 중복', 'space', (j) => { j.space['space-9'] = j.space['space-8']; j.space.nested = { 'space-8': j.space['space-8'] }; }, /겹친다/],
  ['이름 규칙', 'space', (j) => { j.space.Bad_Name = j.space['space-8']; }, /규칙/],
  ['최상위 키', 'space', (j) => { j.extra = {}; }, /최상위 키/],
  ['rootless에 reading 없음', 'type', (j) => { delete j.type.text['text-hero'].$extensions['io.github.chnu-kim.chzzk'].overrides; }, /rootless/],
  ['textScale 없음', 'type', (j) => { delete j.type.$extensions; }, /textScale/],
  ['대비 쌍의 없는 토큰', 'contrast', (j) => { j.light[0] = ['nope', 'bg', 4.5]; }, /sys 색 토큰 nope/],
  ['대비 쌍 모양', 'contrast', (j) => { j.light[0] = ['fg', 'bg']; }, /모양/],
  ['폰트 이름 주입', 'type', (j) => { j.type.font['font-sans'].$value[1] = "x'; } body { display:none"; }, /안전하지 않다/],
];
for (const [label, file, fn, re] of BAD) {
  test(`원천 오류는 2: ${label}`, () => {
    const dir = mkRoot();
    try {
      mutate(dir, file, fn);
      const r = quiet(() => main(['--root', dir]));
      assert.equal(r.code, 2, r.logs.join('\n'));
      assert.match(r.errs.join('\n'), re);
      assert.equal(quiet(() => main(['--check', '--root', dir])).code, 2);
    } finally {
      cleanup(dir);
    }
  });
}

test('원천 파일이 없거나 JSON이 깨지면 2', () => {
  const dir = mkRoot();
  try {
    rmSync(join(dir, 'design', 'tokens', 'layer.tokens.json'));
    assert.match(quiet(() => main(['--root', dir])).errs.join('\n'), /layer\.tokens\.json: 파일이 없다/);
    writeFileSync(join(dir, 'design', 'tokens', 'layer.tokens.json'), '{ 깨짐');
    const r = quiet(() => main(['--root', dir]));
    assert.equal(r.code, 2);
    assert.match(r.errs.join('\n'), /JSON을 읽을 수 없다/);
  } finally {
    cleanup(dir);
  }
});

// ---- (바) 입력 CSS 제약 ----
test('design/ui.css가 없으면 2', () => {
  const dir = mkRoot({ ui: null });
  try {
    const r = quiet(() => main(['--root', dir]));
    assert.equal(r.code, 2);
    assert.match(r.errs.join('\n'), /design\/ui\.css: 파일이 없다/);
  } finally {
    cleanup(dir);
  }
});

for (const [label, ch] of [['백틱', '`'], ['백슬래시', '\\'], ['$', '$'], ['<', '<']]) {
  test(`SITE_CSS에 ${label}가 있으면 2`, () => {
    const dir = mkRoot({ ui: `.x {\n  content: "a${ch}b";\n}\n` });
    try {
      const r = quiet(() => main(['--root', dir]));
      assert.equal(r.code, 2);
      assert.match(r.errs.join('\n'), /백틱·백슬래시·\$·</);
      assert.equal(quiet(() => main(['--check', '--root', dir])).code, 2);
    } finally {
      cleanup(dir);
    }
  });
}

for (const bad of ['@import "x.css";', '.x { background: url(a.png); }']) {
  test(`SITE_CSS에 ${bad.slice(0, 7)}가 있으면 2`, () => {
    const dir = mkRoot({ ui: `${bad}\n` });
    try {
      assert.equal(quiet(() => main(['--root', dir])).code, 2);
    } finally {
      cleanup(dir);
    }
  });
}

test('CRLF 원문도 LF로 다룬다', () => {
  const dir = mkRoot({ ui: '.x {\r\n  color: var(--fg);\r\n}\r\n' });
  try {
    const { files } = generate(dir);
    assert.ok(!Object.values(files).some((t) => t.includes('\r')));
    assert.equal(files[OUTPUTS.ui], `${HEADER}\n/* [ui] design/ui.css */\n${UI}`);
  } finally {
    cleanup(dir);
  }
});
