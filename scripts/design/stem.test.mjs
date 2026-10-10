// stem.mjs 단위 테스트. 테스트 안에서 합성 PNG를 만들어 줄기 폭을 잰다.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { StemError, decodePng, main, measureRow } from './stem.mjs';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, body])));
  return Buffer.concat([head, t, body, crc]);
}

/** 필터 id별로 행을 인코딩한다(디코더가 되돌리는지 보려고) */
function filterRow(filter, cur, prev, bpp) {
  const out = Buffer.alloc(cur.length);
  for (let x = 0; x < cur.length; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= bpp ? prev[x - bpp] : 0;
    let p;
    switch (filter) {
      case 0: p = 0; break;
      case 1: p = a; break;
      case 2: p = b; break;
      case 3: p = (a + b) >> 1; break;
      default: {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
    }
    out[x] = (cur[x] - p) & 0xff;
  }
  return out;
}

/**
 * rows: 행마다 픽셀 배열(각 픽셀은 채널 값 배열)
 * filters: 행별 필터 id(기본 0)
 */
function makePng(rows, { colorType = 0, bitDepth = 8, interlace = 0, filters = [] } = {}) {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType] ?? 1;
  const width = rows[0].length;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const lines = [];
  let prev = null;
  rows.forEach((row, y) => {
    const cur = Buffer.from(row.flat());
    const f = filters[y] ?? 0;
    lines.push(Buffer.concat([Buffer.from([f]), filterRow(f, cur, prev, channels)]));
    prev = cur;
  });
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(lines))), chunk('IEND', Buffer.alloc(0))]);
}

const WHITE = [255];
const BLACK = [0];
const row = (w, ink = []) => Array.from({ length: w }, (_, x) => (ink[x] ?? WHITE));

test('3px 검은 세로 줄기: 구간 하나, 길이 3, 가중 폭 3.00', () => {
  const png = decodePng(makePng([row(12, { 4: BLACK, 5: BLACK, 6: BLACK })]));
  const { background, runs } = measureRow(png, 0);
  assert.equal(background, 255);
  assert.deepEqual(runs.map((r) => [r.x, r.length, r.width.toFixed(2)]), [[4, 3, '3.00']]);
});

test('안티앨리어싱 줄기: 가장자리 반농도 픽셀이 폭에 반영된다', () => {
  const png = decodePng(makePng([row(10, { 3: [128], 4: BLACK, 5: [128] })]));
  const [r] = measureRow(png, 0).runs;
  assert.equal(r.length, 3);
  assert.ok(Math.abs(r.width - (1 + 2 * (1 - 128 / 255))) < 1e-9);
});

test('줄기가 둘이면 구간도 둘이고 x0~x1 창 밖은 보지 않는다', () => {
  const png = decodePng(makePng([row(20, { 2: BLACK, 3: BLACK, 12: BLACK })]));
  assert.deepEqual(measureRow(png, 0).runs.map((r) => [r.x, r.length]), [[2, 2], [12, 1]]);
  assert.deepEqual(measureRow(png, 0, { x0: 8, x1: 20 }).runs.map((r) => [r.x, r.length]), [[12, 1]]);
});

test('threshold보다 가는(가중 폭이 작은) 구간은 점잡음으로 버린다', () => {
  const png = decodePng(makePng([row(10, { 2: [200], 6: BLACK })]));
  assert.deepEqual(measureRow(png, 0, { threshold: 0.5 }).runs.map((r) => r.x), [6]);
  assert.deepEqual(measureRow(png, 0, { threshold: 0.1 }).runs.map((r) => r.x), [2, 6]);
});

test('바탕은 행에서 가장 많은 휘도다(어두운 바탕 위의 밝은 글자는 줄기가 아니다)', () => {
  const png = decodePng(makePng([row(10, Object.fromEntries(Array.from({ length: 10 }, (_, x) => [x, x === 5 ? [255] : [100]])))]));
  const { background, runs } = measureRow(png, 0);
  assert.equal(background, 100);
  assert.deepEqual(runs, []);
});

test('PNG 필터 0~4를 모두 되돌린다', () => {
  const rows = [0, 1, 2, 3, 4].map((y) => row(9, { [y + 1]: BLACK, [y + 2]: [60] }));
  const png = decodePng(makePng(rows, { filters: [0, 1, 2, 3, 4] }));
  rows.forEach((r, y) => {
    assert.deepEqual([...png.data.subarray(y * 9, y * 9 + 9)], r.map((p) => p[0]), `${y}행`);
  });
});

test('RGB·RGBA·그레이+알파도 읽는다(알파는 흰 바탕에 올린다)', () => {
  const W = [255, 255, 255];
  const K = [0, 0, 0];
  const rgb = decodePng(makePng([[W, K, K, W]], { colorType: 2 }));
  assert.deepEqual(measureRow(rgb, 0).runs.map((r) => [r.x, r.length, r.width.toFixed(2)]), [[1, 2, '2.00']]);
  const rgba = decodePng(makePng([[[255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 0]]], { colorType: 6 }));
  assert.deepEqual(measureRow(rgba, 0).runs.map((r) => [r.x, r.length]), [[1, 1]]);
  const ga = decodePng(makePng([[[255, 255], [0, 255], [0, 0]]], { colorType: 4 }));
  assert.deepEqual(measureRow(ga, 0).runs.map((r) => [r.x, r.length]), [[1, 1]]);
});

test('지원 밖 PNG는 StemError: 16비트·팔레트·인터레이스·시그니처·CRC', () => {
  assert.throws(() => decodePng(makePng([row(4)], { bitDepth: 16 })), StemError);
  assert.throws(() => decodePng(makePng([row(4)], { colorType: 3 })), /색 형식/);
  assert.throws(() => decodePng(makePng([row(4)], { interlace: 1 })), /인터레이스/);
  assert.throws(() => decodePng(Buffer.from('not a png file')), /PNG 파일이 아니다/);
  const bad = makePng([row(4)]);
  bad[bad.length - 20] ^= 0xff; // IDAT 데이터 한 바이트를 깬다
  assert.throws(() => decodePng(bad), StemError);
});

test('행·x 범위가 틀리면 StemError', () => {
  const png = decodePng(makePng([row(6)]));
  assert.throws(() => measureRow(png, 3), /행이 범위 밖/);
  assert.throws(() => measureRow(png, 0, { x0: 4, x1: 2 }), /x 범위/);
  assert.throws(() => measureRow(png, 0, { x1: 99 }), /x 범위/);
});

function cli(argv) {
  let out = '';
  let err = '';
  const code = main(argv, { out: (s) => (out += s), err: (s) => (err += s) });
  return { code, out, err };
}

test('CLI: 구간과 합계를 찍고 0, 인자·파일·PNG 오류는 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-stem-'));
  const file = join(dir, 'a.png');
  writeFileSync(file, makePng([row(12, { 4: BLACK, 5: BLACK, 6: BLACK })]));
  const ok = cli([file, '--row', '0']);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /^png 12x1 row 0 x 0~12 background 255\n/);
  assert.match(ok.out, /x=4 length=3 width=3\.00\n/);
  assert.match(ok.out, /runs 1 total 3\.00\n$/);
  const window = cli([file, '--row', '0', '--x0', '6', '--x1', '12']);
  assert.match(window.out, /x=6 length=1 width=1\.00/);

  assert.equal(cli([]).code, 2);
  assert.equal(cli([file]).code, 2);
  assert.equal(cli([file, '--row', 'abc']).code, 2);
  assert.equal(cli([file, '--row', '9']).code, 2);
  assert.equal(cli([file, '--row', '0', '--zzz']).code, 2);
  assert.equal(cli([join(dir, '없음.png'), '--row', '0']).code, 2);
  const junk = join(dir, 'junk.png');
  writeFileSync(junk, 'x');
  const r = cli([junk, '--row', '0']);
  assert.equal(r.code, 2);
  assert.match(r.err, /stem: PNG 파일이 아니다/);
});
