// design-icons(icons.mjs) 단위 테스트. 임시 루트에 최소 사본을 만들어 규칙마다 통과·위반 씨앗을 본다.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { toEntries, validateAllow } from './allow.mjs';
import { PATHS, ROOT, check, parseIcons } from './icons.mjs';

const VERSION = '0.400.0';

const ICONS_OK = `export const ICONS = {
  x: { set: 'lucide', name: 'x', version: '${VERSION}', paths: ['M18 6 6 18', 'M6 6l12 12'] },
  'arrow-left': { meta: { set: 'lucide', name: 'arrow-left', version: '${VERSION}' }, paths: ['M19 12H5'] },
} as const;
`;

const ICON_SVELTE_OK = `<script lang="ts">
  import { ICONS } from './icons';
  let { name, size = 'md' }: { name: keyof typeof ICONS; size?: 'sm' | 'md' } = $props();
</script>
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
  {#each ICONS[name].paths as d (d)}
    <path {d} vector-effect="non-scaling-stroke" />
  {/each}
</svg>
`;

const LICENSE_OK = `Lucide ${VERSION}

ISC License
Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted.

Feather (MIT License)
Permission is hereby granted, free of charge, to any person obtaining a copy of this software.
`;

function mkRoot(files = {}, { base = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ds-icons-'));
  const all = base
    ? {
        [PATHS.icons]: ICONS_OK,
        [PATHS.iconSvelte]: ICON_SVELTE_OK,
        [PATHS.license]: LICENSE_OK,
        [PATHS.ko]: "export const ko = { 'common.close': '닫기', 'action.cancel': '취소', 'card.close': '닫기' } as const;\n",
        ...files,
      }
    : files;
  for (const [rel, text] of Object.entries(all)) {
    if (text === null) continue;
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), text);
  }
  return d;
}

const run = (files, opts) => check(mkRoot(files, opts));
const has = (v, rule, text) => v.some((x) => x.rule === rule && (text === undefined || x.text === text));

test('parseIcons: 직접 메타·meta 객체·메타 없음·함수 호출 path를 구분한다', () => {
  const src = `const ring = (r) => 'z';
export const ICONS = {
  a: { set: 'lucide', name: 'a', version: '1', paths: ['M1'] },
  'b-c': { meta: { set: 'lucide', name: 'b-c', version: '1' }, paths: ['M2', 'M3'] },
  d: { paths: ['M4', ring(3)] },
} satisfies Record<string, unknown>;
`;
  const icons = parseIcons(src);
  assert.deepEqual(icons.map((i) => i.name), ['a', 'b-c', 'd']);
  assert.deepEqual(icons[0].meta, { set: 'lucide', name: 'a', version: '1' });
  assert.deepEqual(icons[1].paths, ['M2', 'M3']);
  assert.equal(icons[2].meta, null);
  assert.deepEqual(icons[2].paths, ['M4']);
  assert.equal(icons[2].line, 5);
  assert.equal(parseIcons('export const OTHER = {};'), null);
});

test('깨끗한 최소 사본은 위반 0(Worker 생성물·vocab이 없어도)', () => {
  assert.deepEqual(run(), []);
});

// DI1 -----------------------------------------------------------------------

test('DI1: 메타가 없는 항목은 아이콘마다 위반이다', () => {
  const v = run({ [PATHS.icons]: "export const ICONS = {\n  x: { paths: ['M1'] },\n  y: { paths: ['M2'] },\n} as const;\n" });
  assert.deepEqual(v.filter((x) => x.rule === 'DI1').map((x) => [x.text, x.line]), [['x', 2], ['y', 3]]);
});

test('DI1: set은 lucide 하나이고 version은 모든 항목이 같아야 한다', () => {
  const src = `export const ICONS = {
  a: { set: 'lucide', name: 'a', version: '1.0.0', paths: ['M1'] },
  b: { set: 'lucide', name: 'b', version: '1.1.0', paths: ['M2'] },
  c: { set: 'feather', name: 'c', version: '1.0.0', paths: ['M3'] },
} as const;
`;
  const v = run({ [PATHS.icons]: src, [PATHS.license]: LICENSE_OK.replaceAll(VERSION, '1.0.0') });
  assert.deepEqual(v.filter((x) => x.rule === 'DI1').map((x) => x.text), ['b', 'c']);
});

test('DI1: icons.ts가 없으면 위반 하나(line 0)', () => {
  const v = run({ [PATHS.icons]: null }, { base: true });
  // base 안의 null은 파일을 만들지 않는다
  assert.ok(has(v, 'DI1', 'icons.ts 없음'));
  assert.equal(v.find((x) => x.text === 'icons.ts 없음').line, 0);
});

test('DI1: Worker 생성물이 있으면 path가 앱 원천과 같아야 한다', () => {
  const same = run({ [PATHS.workerIcons]: ICONS_OK });
  assert.deepEqual(same, []);
  const drift = run({
    [PATHS.workerIcons]: ICONS_OK.replace("'M19 12H5'", "'M19 13H5'"),
  });
  assert.ok(has(drift, 'DI1', 'arrow-left'));
  const extra = run({ [PATHS.workerIcons]: `${ICONS_OK.replace('} as const;', "  zz: { paths: ['M0'] },\n} as const;")}` });
  assert.ok(has(extra, 'DI1', 'zz'));
});

// DI2 -----------------------------------------------------------------------

test('DI2: 고지 파일이 없으면 위반 하나, 있어도 버전·ISC·Feather MIT가 빠지면 각각 위반', () => {
  const none = run({ [PATHS.license]: null });
  assert.deepEqual(none.map((x) => [x.rule, x.file, x.line, x.text]), [['DI2', 'licenses/lucide.txt', 0, 'licenses/lucide.txt 없음']]);
  const noVersion = run({ [PATHS.license]: LICENSE_OK.replace(VERSION, 'x') });
  assert.ok(has(noVersion, 'DI2', `아이콘 버전(${VERSION})`));
  const noIsc = run({ [PATHS.license]: 'Lucide 0.400.0\nFeather MIT License\n' });
  assert.ok(has(noIsc, 'DI2', 'ISC 본문'));
  const noFeather = run({ [PATHS.license]: `Lucide ${VERSION}\nISC License\n` });
  assert.ok(has(noFeather, 'DI2', 'Feather MIT 단락'));
});

// DI3 -----------------------------------------------------------------------

test('DI2: Worker 라이선스 생성 모듈이 있으면 고지 파일과 같은 글이어야 한다', () => {
  const mod = (text) => `// 생성물\nexport const LICENSES = [{ name: "Lucide", text: ${JSON.stringify(text)} }] as const;\n`;
  assert.deepEqual(run({ [PATHS.workerLicenses]: mod(LICENSE_OK) }), []);
  assert.ok(has(run({ [PATHS.workerLicenses]: mod(`${LICENSE_OK}손 수정`) }), 'DI2', 'licenses.generated.ts'));
  assert.ok(has(run({ [PATHS.workerLicenses]: 'export const LICENSES = [];\n' }), 'DI2', 'licenses.generated.ts'));
  // 줄끝만 다른 체크아웃(CRLF)은 같은 글이다
  assert.deepEqual(run({ [PATHS.license]: LICENSE_OK.replace(/\n/g, '\r\n'), [PATHS.workerLicenses]: mod(LICENSE_OK) }), []);
});

test('DI3: path 문자열에 fill·stroke-width·색이 있으면 위반', () => {
  const v = run({ [PATHS.icons]: `export const ICONS = {\n  x: { set: 'lucide', name: 'x', version: '${VERSION}', paths: ['<path fill="red" d="M1"/>'] },\n} as const;\n` });
  assert.ok(has(v, 'DI3', 'x'));
});

test('DI3: Icon.svelte의 path에는 vector-effect가 필요하고 stroke-width 속성·색 지정은 쓰지 않는다', () => {
  const bad = ICON_SVELTE_OK.replace(' vector-effect="non-scaling-stroke"', '').replace('stroke="currentColor"', 'stroke="currentColor" stroke-width="1.75"');
  const v = run({ [PATHS.iconSvelte]: bad });
  assert.ok(has(v, 'DI3', '<path {d} />'));
  assert.ok(has(v, 'DI3', 'stroke-width="1.75"'));
  const color = run({ [PATHS.iconSvelte]: ICON_SVELTE_OK.replace('stroke="currentColor"', 'stroke="#FF0000"') });
  assert.ok(has(color, 'DI3', 'stroke="#FF0000"'));
  const pathFill = run({ [PATHS.iconSvelte]: ICON_SVELTE_OK.replace('<path {d}', '<path fill="none" {d}') });
  assert.ok(pathFill.some((x) => x.rule === 'DI3' && /fill=/.test(x.text)));
});

test('DI3: Worker icon.ts도 같은 규칙을 받는다', () => {
  const v = run({ [PATHS.workerIcon]: 'export const icon = (d) => `<svg><path d="${d}"/></svg>`;\n' });
  assert.ok(v.some((x) => x.rule === 'DI3' && x.file === PATHS.workerIcon));
});

// DI4 -----------------------------------------------------------------------

const BTN = (icon, key) => `<Button onclick={go}><Icon name="${icon}" />{t('${key}')}</Button>\n`;

test('DI4: 같은 아이콘이 서로 다른 동작에 쓰이면 위반이다', () => {
  const v = run({
    'app/src/lib/components/a/A.svelte': BTN('x', 'action.cancel'),
    'app/src/lib/components/a/B.svelte': BTN('x', 'common.close'),
  });
  assert.ok(has(v, 'DI4', 'x'));
});

test('DI4: 키가 달라도 보이는 글자가 같으면 같은 동작이다', () => {
  const v = run({
    'app/src/lib/components/a/A.svelte': BTN('x', 'card.close'),
    'app/src/lib/components/a/B.svelte': BTN('x', 'common.close'),
  });
  assert.ok(!has(v, 'DI4'));
});

test('DI4: copy는 예외이고 동작을 알 수 없는 사용처는 세지 않는다', () => {
  const v = run({
    'app/src/lib/components/a/A.svelte': BTN('copy', 'action.cancel'),
    'app/src/lib/components/a/B.svelte': BTN('copy', 'common.close'),
    'app/src/lib/components/a/C.svelte': '<span><Icon name="x" /></span>\n',
  });
  assert.ok(!has(v, 'DI4'));
});

test('DI4: IconButton의 icon 속성과 aria-label도 동작으로 센다', () => {
  const v = run({
    'app/src/lib/components/a/A.svelte': '<IconButton icon="eye" label={t(\'action.cancel\')} />\n',
    'app/src/lib/components/a/B.svelte': '<IconButton icon="eye" label={t(\'common.close\')} />\n',
  });
  assert.ok(has(v, 'DI4', 'eye'));
});

// DI5 -----------------------------------------------------------------------

test('DI5: <Icon size>는 sm·md만, 숫자·lg는 위반', () => {
  const ok = run({ 'app/src/lib/components/a/A.svelte': '<Icon name="x" size="sm" /><Icon name="x" size={"md"} />\n' });
  assert.ok(!has(ok, 'DI5'));
  const bad = run({ 'app/src/lib/components/a/A.svelte': '<Icon name="x" size={16} /><Icon name="x" size="lg" />\n' });
  assert.deepEqual(bad.filter((x) => x.rule === 'DI5').map((x) => x.text), ['size=16', 'size=lg']);
});

test('DI5: Icon.svelte의 size 타입이 16 | 20 | 32이면 위반', () => {
  const v = run({ [PATHS.iconSvelte]: ICON_SVELTE_OK.replace("'sm' | 'md'", '16 | 20 | 32') });
  assert.ok(v.some((x) => x.rule === 'DI5' && x.file === PATHS.iconSvelte));
});

// DI6 -----------------------------------------------------------------------

test('DI6: .svelte 속성 값의 글꼴 아이콘 세트 이름(selftest 씨앗)을 잡는다', () => {
  for (const word of ['SF Symbols', 'MDL2', 'Segoe Fluent', 'Material Icons']) {
    const v = run({ 'app/src/lib/components/a/A.svelte': `<span data-x="${word}">a</span>\n` });
    assert.ok(has(v, 'DI6', word), word);
  }
  const ts = run({ 'worker/src/http/pages.ts': "export const note = 'uses Material Icons';\n" });
  assert.ok(has(ts, 'DI6', 'Material Icons'));
});

// DI7 -----------------------------------------------------------------------

test('DI7: vocab.ts가 없으면 건너뛰고, 있으면 IconButton icon을 ICON_BUTTON_ICONS로 제한한다', () => {
  const svelte = { 'app/src/lib/components/a/A.svelte': '<IconButton icon="trash" label="x" /><IconButton icon="x" label="y" />\n' };
  assert.ok(!has(run(svelte), 'DI7'));
  const v = run({
    ...svelte,
    [PATHS.vocab]: "export const ICON_BUTTON_ICONS = ['x', 'ellipsis'] as const;\n",
  });
  assert.deepEqual(v.filter((x) => x.rule === 'DI7').map((x) => x.text), ['trash']);
  const broken = run({ [PATHS.vocab]: 'export const OTHER = 1;\n' });
  assert.ok(has(broken, 'DI7', 'ICON_BUTTON_ICONS 없음'));
});

// 저장소 --------------------------------------------------------------------

test('저장소: check(ROOT)가 던지지 않고 위반 레코드가 계약 모양이며 항목이 허용 목록 스키마를 통과한다', () => {
  const v = check(ROOT);
  for (const x of v) {
    assert.match(x.rule, /^DI[1-7]$/);
    assert.ok(!x.file.includes('\\'));
    assert.ok(Number.isInteger(x.line) && x.line >= 0);
    assert.ok(x.text.length > 0);
  }
  assert.deepEqual(validateAllow({ entries: toEntries(v) }), []);
});
