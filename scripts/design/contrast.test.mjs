// contrast.mjs 단위 테스트: 알려진 값(WCAG, foundations.md 2.4 몇 행)과 대비 표 CLI.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, composite, contrastRatio, hsl, main, oklchToSrgb, pairRows, parseHex, relativeLuminance, renderTable, toHex } from './contrast.mjs';

const r2 = (n) => n.toFixed(2);

test('WCAG 기준값: 검정/흰색 21, 같은 색 1', () => {
  assert.equal(r2(contrastRatio('#000000', '#FFFFFF')), '21.00');
  assert.equal(r2(contrastRatio('#FFFFFF', '#000000')), '21.00');
  assert.equal(contrastRatio('#808080', '#808080'), 1);
  assert.equal(relativeLuminance('#FFFFFF'), 1);
  assert.equal(relativeLuminance('#000000'), 0);
});

test('foundations 2.4 행을 소수 둘째 자리까지 재현한다', () => {
  const rows = [
    ['#1B1B1B', '#F3F3F3', '15.52'],
    ['#5D5D5D', '#E8E8E8', '5.37'],
    ['#808080', '#E8E8E8', '3.22'],
    ['#945500', '#FFF0D4', '5.25'],
    ['#FFFFFF', '#0067DF', '5.24'],
    ['#9E9E9E', '#FFFFFF', '2.68'],
    ['#A4A4A4', '#3A3A3A', '4.56'],
    ['#FA8880', '#3A3A3A', '4.82'],
    ['#70ADFB', '#233651', '5.27'],
    ['#FFFFFF', '#1E72E4', '4.58'],
    ['#A4A4A4', '#484848', '3.67'],
  ];
  for (const [fg, bg, want] of rows) assert.equal(r2(contrastRatio(fg, bg)), want, `${fg} / ${bg}`);
});

test('알파 합성: separator 합성값이 foundations와 같다', () => {
  assert.equal(composite('#000000', 0.1, '#F3F3F3'), '#DBDBDB');
  assert.equal(composite('#000000', 0.1, '#FFFFFF'), '#E6E6E6');
  assert.equal(composite('#FFFFFF', 0.1, '#1F1F1F'), '#353535');
  assert.equal(composite('#FFFFFF', 0.1, '#2B2B2B'), '#404040');
  assert.equal(composite('#123456', 1, '#FFFFFF'), '#123456');
  assert.equal(composite('#123456', 0, '#FFFFFF'), '#FFFFFF');
});

test('OKLCH → sRGB: 기준 색', () => {
  assert.equal(toHex(oklchToSrgb(1, 0, 0)), '#FFFFFF');
  assert.equal(toHex(oklchToSrgb(0, 0, 0)), '#000000');
  assert.equal(toHex(oklchToSrgb(0.965, 0, 0)), '#F3F3F3');
  assert.equal(toHex(oklchToSrgb(0.54, 0.2, 258)), '#0067DF');
  // 반환은 클램프 전이다: 색역 밖 값은 0..1을 벗어날 수 있고 toHex가 자른다
  const out = oklchToSrgb(0.5, 0.4, 145);
  assert.ok(out.some((v) => v < 0 || v > 1));
  assert.match(toHex(out), /^#[0-9A-F]{6}$/);
});

test('hex 입출력과 형식 검사', () => {
  assert.deepEqual(parseHex('#0067DF'), [0, 103, 223]);
  assert.equal(toHex([0, 0.5, 1.2]), '#0080FF');
  assert.equal(toHex([-1, 0, 0]), '#000000');
  assert.throws(() => parseHex('0067DF'), /hex 형식/);
  assert.throws(() => parseHex('#FFF'), /hex 형식/);
});

test('hsl: 소수를 유지하고 무채색은 S 0', () => {
  assert.deepEqual(hsl('#808080'), { h: 0, s: 0, l: 50.19607843137255 });
  const blue = hsl('#0067DF');
  assert.ok(blue.h > 210 && blue.h < 216, `h=${blue.h}`);
  assert.ok(blue.s > 95);
  assert.notEqual(blue.h, Math.round(blue.h));
  const green = hsl('#03C75A');
  assert.ok(green.h >= 140 && green.h <= 150 && green.s >= 70);
});

test('pairRows·renderTable: 알파 전경은 바탕과 합성하고 판정한다', () => {
  const colors = {
    '--fg': { hex: '#1B1B1B', alpha: 1 },
    '--bg': { hex: '#F3F3F3', alpha: 1 },
    '--sep': { hex: '#000000', alpha: 0.1 },
    '--gray': { hex: '#9E9E9E', alpha: 1 },
  };
  const rows = pairRows(
    [
      { fg: '--fg', bg: '--bg', min: 4.5 },
      { fg: '--sep', bg: '--bg', min: 1.2 },
      { fg: '--gray', bg: '--bg', min: 4.5 },
    ],
    (n) => colors[n],
  );
  assert.deepEqual(rows.map((r) => r.pass), [true, true, false]);
  assert.equal(rows[1].fgHex, '#DBDBDB');
  const table = renderTable(rows);
  assert.match(table, /^\| 전경 \| 바탕 \| 대비 \| 최소 \| 판정 \|\n\|---\|---\|---\|---\|---\|\n/);
  assert.match(table, /\| `--fg` #1B1B1B \| `--bg` #F3F3F3 \| 15\.52 \| 4\.5 \| PASS \|/);
  assert.match(table, /FAIL \|$/);
  assert.throws(() => pairRows([{ fg: '--fg', bg: '--sep', min: 3 }], (n) => colors[n]), /알파 색/);
});

function capture(fn) {
  const logs = [];
  const errs = [];
  const [log, err] = [console.log, console.error];
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  return Promise.resolve(fn()).then(
    (code) => {
      [console.log, console.error] = [log, err];
      return { code, logs, errs };
    },
    (e) => {
      [console.log, console.error] = [log, err];
      throw e;
    },
  );
}

test('CLI: 저장소 원천을 임시 루트로 복사해 표를 찍고 0', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  try {
    mkdirSync(join(dir, 'design'));
    cpSync(join(ROOT, 'design', 'tokens'), join(dir, 'design', 'tokens'), { recursive: true });
    const { code, logs } = await capture(() => main(['--root', dir]));
    assert.equal(code, 0);
    const out = logs.join('\n');
    assert.match(out, /### 라이트/);
    assert.match(out, /### 다크/);
    assert.equal((out.match(/PASS/g) ?? []).length, 92);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: 미달 쌍이 있으면 1, 원천이 없으면 2', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  try {
    mkdirSync(join(dir, 'design'));
    const empty = await capture(() => main(['--root', dir]));
    assert.equal(empty.code, 2);
    assert.match(empty.errs.join('\n'), /원천 오류/);
    cpSync(join(ROOT, 'design', 'tokens'), join(dir, 'design', 'tokens'), { recursive: true });
    const p = join(dir, 'design', 'tokens', 'contrast.tokens.json');
    const json = JSON.parse(readFileSync(p, 'utf8'));
    json.light[0] = ['fg-disabled', 'bg', 4.5];
    writeFileSync(p, `${JSON.stringify(json)}\n`);
    const bad = await capture(() => main(['--root', dir]));
    assert.equal(bad.code, 1);
    assert.match(bad.logs.join('\n'), /FAIL/);
    assert.equal((await capture(() => main(['--root']))).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
