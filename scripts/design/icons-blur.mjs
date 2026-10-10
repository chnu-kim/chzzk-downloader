#!/usr/bin/env node
// 아이콘 번짐 측정(docs/design/system/governance.md §2.5 래스터 부분, foundations §9 "확인") [잠정].
// design-gallery(app/e2e/gallery.spec.ts)가 갤러리 아이콘 시트(16·20, 라이트, DPR 1·2)를 PNG로 찍고 칸 좌표를 JSON으로 남긴 뒤
// 이 CLI를 부른다. 칸마다 세로 단면(열)을 훑어 바탕보다 어두운 연속 구간(= 가로로 지나가는 획의 단면)을 찾고, 가장 선명한
// 구간의 최대 농도(peak)와 농도 합(sum, 화면에서 보이는 굵기)을 잰다. 판정: peak ≥ 0.5 이고 sum ≥ 1.0.
// 기준은 Windows 100% 실기 아이콘 시트와 비교해 맞춘 뒤 확정한다. 실패하면 README §6-4 조치(16px만 1.25, ADR)다.
//
//   node scripts/design/icons-blur.mjs <png> --cells <cells.json>
//     cells.json = [{ "name": "x@16", "x": 0, "y": 0, "w": 16, "h": 16 }, …] (PNG 픽셀 좌표)
//
// 농도 d = 1 − 휘도/바탕휘도(0~1). 바탕은 칸에서 가장 많이 나온 휘도다. 종료 코드: 0 통과, 1 기준 미달, 2 사용법·입력 오류.
// 의존성 0(PNG 해독은 stem.mjs).
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { decodePng, StemError } from './stem.mjs';

export const MIN_PEAK = 0.5;
export const MIN_SUM = 1.0;
/** 바탕보다 이만큼 이하로 어두운 픽셀은 잡음이다 */
const NOISE = 0.02;

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

/** 칸 안에서 가장 많이 나온 휘도(바탕) */
function background(png, c) {
  const hist = new Map();
  for (let y = c.y; y < c.y + c.h; y++) {
    for (let x = c.x; x < c.x + c.w; x++) {
      const k = Math.round(luminance(png, x, y));
      hist.set(k, (hist.get(k) ?? 0) + 1);
    }
  }
  let bg = 255;
  let best = -1;
  for (const [k, n] of hist) {
    if (n > best || (n === best && k > bg)) {
      best = n;
      bg = k;
    }
  }
  return bg;
}

/**
 * 칸 하나를 잰다. 돌려주는 값: { peak, sum, x, y } — 가장 높은 peak를 가진 구간(같으면 sum이 큰 것)과 그 위치.
 * 구간이 하나도 없으면 peak·sum이 0이다.
 */
export function measureCell(png, c) {
  if (!(c.x >= 0 && c.y >= 0 && c.w > 0 && c.h > 0 && c.x + c.w <= png.width && c.y + c.h <= png.height)) {
    throw new StemError(`칸이 그림 밖이다: ${JSON.stringify(c)}(그림 ${png.width}×${png.height})`);
  }
  const bg = background(png, c);
  let best = { peak: 0, sum: 0, x: c.x, y: c.y };
  for (let x = c.x; x < c.x + c.w; x++) {
    let cur = null;
    const flush = () => {
      if (cur && (cur.peak > best.peak || (cur.peak === best.peak && cur.sum > best.sum))) best = cur;
      cur = null;
    };
    for (let y = c.y; y < c.y + c.h; y++) {
      const d = bg > 0 ? Math.max(0, 1 - luminance(png, x, y) / bg) : 0;
      if (d > NOISE) {
        if (!cur) cur = { peak: 0, sum: 0, x, y };
        cur.peak = Math.max(cur.peak, d);
        cur.sum += d;
      } else flush();
    }
    flush();
  }
  return { peak: Math.round(best.peak * 1000) / 1000, sum: Math.round(best.sum * 1000) / 1000, x: best.x, y: best.y };
}

export const passes = (m) => m.peak >= MIN_PEAK && m.sum >= MIN_SUM;

/** CLI. 종료 코드: 0 통과, 1 기준 미달, 2 사용법·입력 오류 */
export function main(argv = process.argv.slice(2), { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  const ci = argv.indexOf('--cells');
  const file = argv.find((a, i) => !a.startsWith('--') && i !== ci + 1);
  if (!file || ci === -1 || !argv[ci + 1]) {
    err('사용법: node scripts/design/icons-blur.mjs <png> --cells <cells.json>\n');
    return 2;
  }
  let png;
  let cells;
  try {
    png = decodePng(readFileSync(file));
    cells = JSON.parse(readFileSync(argv[ci + 1], 'utf8'));
    if (!Array.isArray(cells) || cells.length === 0) throw new StemError('cells.json은 비지 않은 배열이다');
  } catch (e) {
    err(`icons-blur: ${e.message}\n`);
    return 2;
  }
  let bad = 0;
  for (const c of cells) {
    let m;
    try {
      m = measureCell(png, c);
    } catch (e) {
      err(`icons-blur: ${e.message}\n`);
      return 2;
    }
    const ok = passes(m);
    if (!ok) bad++;
    out(`${ok ? 'ok  ' : 'FAIL'} ${String(c.name ?? '?').padEnd(24)} peak ${m.peak.toFixed(3)} sum ${m.sum.toFixed(3)}\n`);
  }
  out(`[icons-blur] ${cells.length}칸 중 미달 ${bad}(기준 peak ≥ ${MIN_PEAK}, sum ≥ ${MIN_SUM})\n`);
  return bad ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
