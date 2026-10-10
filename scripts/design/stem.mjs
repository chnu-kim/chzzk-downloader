#!/usr/bin/env node
// 글자 줄기 폭 측정 보조(docs/design/system/README.md §6-1: Windows 실기 글자 판독 확인).
// PNG 한 행에서 바탕보다 어두운 픽셀의 연속 구간을 찾아 구간마다 시작 x·길이·농도 가중 폭을 찍는다.
//
//   node scripts/design/stem.mjs <png> --row <y> [--x0 <a> --x1 <b>] [--threshold 0.5]
//
// 농도 d = 1 − 휘도/바탕휘도(0~1), 구간의 가중 폭 = Σd. 바탕은 행(x0~x1)에서 가장 많이 나온 휘도다.
// 안티앨리어싱된 줄기는 가중 폭이 "화면에서 보이는 굵기"에 가깝다(예: 1px 검은 줄기 = 1.00).
// --threshold는 가중 폭이 이 값보다 작은 구간(점잡음)을 버리는 하한이다.
// 8비트 그레이·그레이+알파·RGB·RGBA, 인터레이스 없는 PNG만 읽는다. 그 밖이면 종료 코드 2.
// 의존성 0(node:zlib만).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** 바탕보다 이만큼(농도) 이하로 어두운 픽셀은 잡음으로 보고 구간에 넣지 않는다 */
const NOISE = 0.02;

/** 입력 오류(종료 코드 2) */
export class StemError extends Error {}

const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * PNG를 읽어 { width, height, channels, colorType, data } 로 푼다(data는 필터를 푼 행 연속 바이트).
 * 지원 밖(비트 깊이≠8, 팔레트, 인터레이스)이면 StemError.
 */
export function decodePng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new StemError('PNG 파일이 아니다(시그니처 불일치)');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (body.length < len || pos + 12 + len > buf.length) throw new StemError(`PNG 청크가 잘렸다: ${type}`);
    if (typeof zlib.crc32 === 'function') {
      const crc = buf.readUInt32BE(pos + 8 + len);
      if (zlib.crc32(buf.subarray(pos + 4, pos + 8 + len)) !== crc) throw new StemError(`PNG 청크 CRC가 틀렸다: ${type}`);
    }
    if (type === 'IHDR') {
      ihdr = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new StemError('PNG에 IHDR가 없다');
  if (ihdr.bitDepth !== 8) throw new StemError(`지원하지 않는 비트 깊이: ${ihdr.bitDepth}(8비트만)`);
  const channels = CHANNELS[ihdr.colorType];
  if (!channels) throw new StemError(`지원하지 않는 색 형식: ${ihdr.colorType}(그레이·그레이+알파·RGB·RGBA만)`);
  if (ihdr.interlace !== 0) throw new StemError('인터레이스 PNG는 지원하지 않는다');
  if (ihdr.width === 0 || ihdr.height === 0) throw new StemError('PNG 크기가 0이다');
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch (e) {
    throw new StemError(`PNG 데이터를 풀지 못했다: ${e.message}`);
  }
  const stride = ihdr.width * channels;
  if (raw.length < (stride + 1) * ihdr.height) throw new StemError('PNG 데이터가 모자란다');
  const data = Buffer.alloc(stride * ihdr.height);
  const bpp = channels;
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[src + x];
      const a = x >= bpp ? data[dst + x - bpp] : 0;
      const b = y > 0 ? data[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? data[dst - stride + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = cur + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new StemError(`알 수 없는 PNG 필터: ${filter}(${y}행)`);
      }
      data[dst + x] = v & 0xff;
    }
  }
  return { width: ihdr.width, height: ihdr.height, channels, colorType: ihdr.colorType, data };
}

/** 한 픽셀의 휘도 0~255(알파는 흰 바탕에 올린다) */
function luminance(png, x, y) {
  const { channels, colorType, data, width } = png;
  const o = (y * width + x) * channels;
  let l;
  let a = 255;
  if (colorType === 0) l = data[o];
  else if (colorType === 4) {
    l = data[o];
    a = data[o + 1];
  } else {
    l = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    if (colorType === 6) a = data[o + 3];
  }
  return (l * a + 255 * (255 - a)) / 255;
}

/**
 * 행 y의 [x0, x1) 구간에서 바탕보다 어두운 픽셀의 연속 구간을 잰다.
 * 돌려주는 값: { background, runs: [{ x, length, width }] } (width = 농도 가중 폭, 소수 둘째 자리까지 의미 있음)
 */
export function measureRow(png, y, { x0 = 0, x1 = png.width, threshold = 0.5 } = {}) {
  if (!Number.isInteger(y) || y < 0 || y >= png.height) throw new StemError(`행이 범위 밖이다: ${y}(0~${png.height - 1})`);
  if (!(x0 >= 0 && x1 <= png.width && x0 < x1)) throw new StemError(`x 범위가 틀렸다: ${x0}~${x1}(너비 ${png.width})`);
  const lums = [];
  const hist = new Map();
  for (let x = x0; x < x1; x++) {
    const l = luminance(png, x, y);
    lums.push(l);
    const k = Math.round(l);
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  let background = 255;
  let best = -1;
  for (const [k, n] of hist) {
    if (n > best || (n === best && k > background)) {
      best = n;
      background = k;
    }
  }
  const runs = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.width >= threshold) runs.push({ x: cur.x, length: cur.length, width: cur.width });
    cur = null;
  };
  for (let i = 0; i < lums.length; i++) {
    const d = background > 0 ? 1 - lums[i] / background : 0;
    if (d > NOISE) {
      if (!cur) cur = { x: x0 + i, length: 0, width: 0 };
      cur.length++;
      cur.width += d;
    } else flush();
  }
  flush();
  return { background, runs };
}

const USAGE = '사용법: node scripts/design/stem.mjs <png> --row <y> [--x0 <a> --x1 <b>] [--threshold 0.5]';

function parseArgs(argv) {
  const opts = { file: null, row: null, x0: undefined, x1: undefined, threshold: 0.5 };
  const num = (name, v) => {
    const n = Number(v);
    if (v === undefined || !Number.isFinite(n)) throw new StemError(`${name} 값이 숫자가 아니다: ${v}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--row') opts.row = num('--row', argv[++i]);
    else if (a === '--x0') opts.x0 = num('--x0', argv[++i]);
    else if (a === '--x1') opts.x1 = num('--x1', argv[++i]);
    else if (a === '--threshold') opts.threshold = num('--threshold', argv[++i]);
    else if (a.startsWith('--')) throw new StemError(`알 수 없는 인자: ${a}`);
    else if (opts.file === null) opts.file = a;
    else throw new StemError(`인자가 많다: ${a}`);
  }
  if (opts.file === null || opts.row === null) throw new StemError('PNG 경로와 --row가 필요하다');
  return opts;
}

/** CLI. 종료 코드: 0 측정함, 2 사용법·입력 오류 */
export function main(argv = process.argv.slice(2), { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  try {
    const o = parseArgs(argv);
    let buf;
    try {
      buf = readFileSync(o.file);
    } catch (e) {
      throw new StemError(`파일을 읽지 못했다: ${o.file} (${e.code ?? e.message})`);
    }
    const png = decodePng(buf);
    const x0 = o.x0 ?? 0;
    const x1 = o.x1 ?? png.width;
    const { background, runs } = measureRow(png, o.row, { x0, x1, threshold: o.threshold });
    out(`png ${png.width}x${png.height} row ${o.row} x ${x0}~${x1} background ${background}\n`);
    for (const r of runs) out(`x=${r.x} length=${r.length} width=${r.width.toFixed(2)}\n`);
    out(`runs ${runs.length} total ${runs.reduce((s, r) => s + r.width, 0).toFixed(2)}\n`);
    return 0;
  } catch (e) {
    if (!(e instanceof StemError)) throw e;
    err(`stem: ${e.message}\n${USAGE}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
