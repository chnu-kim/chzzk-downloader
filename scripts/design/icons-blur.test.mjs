// icons-blur.mjs 단위 테스트. 합성 회색 그림으로 획 단면의 농도·굵기를 잰다.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { main, measureCell, passes } from './icons-blur.mjs';

/** 8비트 회색 그림 객체(decodePng 결과 모양). rows는 휘도 배열의 배열 */
const gray = (rows) => ({ width: rows[0].length, height: rows.length, channels: 1, colorType: 0, data: Buffer.from(rows.flat()) });
/** w×h 흰 바탕에 y행부터 가로 획(행마다 휘도) */
function sheet(w, h, y, lums) {
  const rows = Array.from({ length: h }, () => Array(w).fill(255));
  lums.forEach((l, i) => rows[y + i].fill(l, 2, w - 2));
  return rows;
}

test('measureCell: 1.5px 선명한 가로 획은 통과(peak 1, sum 1.5)', () => {
  const png = gray(sheet(16, 16, 7, [0, 128]));
  const m = measureCell(png, { x: 0, y: 0, w: 16, h: 16 });
  assert.equal(m.peak, 1);
  assert.equal(m.sum, 1.498);
  assert.equal(passes(m), true);
});

test('measureCell: 번진 획(최대 농도 < .5)과 가는 획(합 < 1)은 미달', () => {
  const blurred = measureCell(gray(sheet(16, 16, 6, [200, 150, 150, 200])), { x: 0, y: 0, w: 16, h: 16 });
  assert.ok(blurred.peak < 0.5, JSON.stringify(blurred));
  assert.equal(passes(blurred), false);
  const thin = measureCell(gray(sheet(16, 16, 7, [64])), { x: 0, y: 0, w: 16, h: 16 });
  assert.ok(thin.sum < 1, JSON.stringify(thin));
  assert.equal(passes(thin), false);
});

test('measureCell: 칸이 그림 밖이면 던진다', () => {
  assert.throws(() => measureCell(gray(sheet(8, 8, 3, [0])), { x: 4, y: 0, w: 8, h: 8 }), /그림 밖/);
});

// 필터 0, 회색 8비트 PNG
function png(rows) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const t = Buffer.from(type, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, body])));
    return Buffer.concat([head, t, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(rows[0].length, 0);
  ihdr.writeUInt32BE(rows.length, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.concat(rows.map((r) => Buffer.from([0, ...r])));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('main: 칸마다 판정하고 하나라도 미달이면 1, 입력 오류는 2', () => {
  const d = mkdtempSync(join(tmpdir(), 'blur-'));
  const rows = sheet(32, 16, 7, [0, 128]).map((r, y) => r.map((v, x) => (x >= 16 ? (y === 7 ? 64 : 255) : v)));
  writeFileSync(join(d, 'a.png'), png(rows));
  writeFileSync(join(d, 'ok.json'), JSON.stringify([{ name: 'x@16', x: 0, y: 0, w: 16, h: 16 }]));
  writeFileSync(join(d, 'bad.json'), JSON.stringify([{ name: 'x@16', x: 0, y: 0, w: 16, h: 16 }, { name: 'thin', x: 16, y: 0, w: 16, h: 16 }]));
  const lines = [];
  const io = { out: (s) => lines.push(s), err: (s) => lines.push(s) };
  assert.equal(main([join(d, 'a.png'), '--cells', join(d, 'ok.json')], io), 0);
  assert.equal(main([join(d, 'a.png'), '--cells', join(d, 'bad.json')], io), 1);
  assert.ok(lines.some((l) => l.startsWith('FAIL thin')));
  assert.equal(main([join(d, 'a.png')], io), 2);
  writeFileSync(join(d, 'empty.json'), '[]');
  assert.equal(main([join(d, 'a.png'), '--cells', join(d, 'empty.json')], io), 2);
});
