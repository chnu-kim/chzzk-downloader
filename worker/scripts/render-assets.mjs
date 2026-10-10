// Worker 에셋 래스터(한 번만 돌리고 결과를 체크인한다. CI에서는 돌지 않는다: 글꼴 때문에 바이트가 흔들린다).
// 입력 worker/assets/icon.svg → worker/assets/{favicon.ico, apple-touch-icon.png, og.png}. 그다음
// `node scripts/design/worker-gen.mjs --write assets`로 생성 모듈을 다시 만든다.
//
// 실행(저장소 루트에서):
//   pnpm -C worker exec playwright install chromium
//   node worker/scripts/render-assets.mjs
//
// 임시 글리프(docs/design/system/web.md §9.3 [잠정]): D5 파랑 둥근 사각 + 흰 Lucide download. D33 마크가 나오면 icon.svg를 바꾸고 다시 돌린다.
// og.png: 1200×630, --bg(라이트) 바탕에 제품 이름·부제·"비공식 도구"만. 핵심 요소는 가운데 1000×500 안에 둔다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, '..', 'assets');

// 토큰 값(라이트): --bg ref-gray-965, --fg, --fg-muted, --accent(D5). 생성 스타일시트와 같은 값이어야 한다
const BG = '#F3F3F3';
const FG = '#1F1F1F';
const MUTED = '#595959';
const ACCENT = '#0067DF';
// style 속성 안에 들어가므로 글꼴 이름은 작은따옴표로 감싼다
const FONT = "-apple-system, 'Apple SD Gothic Neo', 'Noto Sans CJK KR', 'Noto Sans KR', 'Malgun Gothic', sans-serif";

const svg = readFileSync(join(DIR, 'icon.svg'), 'utf8');
const dataUrl = (text) => `data:image/svg+xml;base64,${Buffer.from(text, 'utf8').toString('base64')}`;

/** 정사각 PNG. square가 true면 모서리를 둥글리지 않아 불투명 전면이 된다(apple-touch는 iOS가 직접 마스크한다) */
async function renderIcon(browser, size, { square = false } = {}) {
  const src = square ? svg.replace('rx="14"', 'rx="0"') : svg;
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<body style="margin:0;background:${square ? ACCENT : 'transparent'}"><img src="${dataUrl(src)}" width="${size}" height="${size}" style="display:block"></body>`);
  const png = await page.screenshot({ omitBackground: !square, type: 'png' });
  await page.close();
  return png;
}

/** PNG 층으로 묶은 ICO */
function ico(layers) {
  const head = Buffer.alloc(6 + layers.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(layers.length, 4);
  let offset = head.length;
  layers.forEach(({ size, png }, i) => {
    const o = 6 + i * 16;
    head[o] = size;
    head[o + 1] = size;
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...layers.map((l) => l.png)]);
}

async function renderOg(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;width:1200px;height:630px;background:${BG};font-family:${FONT};color:${FG};display:flex;align-items:center;justify-content:center">
<div style="width:1000px;height:500px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
<div style="font-size:112px;font-weight:700;line-height:1.2">치지직 다운로더</div>
<div style="font-size:44px;line-height:1.4;margin-top:24px;color:${MUTED}">비공식 다시보기·클립 다운로더</div>
<div style="font-size:30px;line-height:1;margin-top:48px;padding:14px 24px;border:2px solid ${ACCENT};border-radius:4px;color:${ACCENT};font-weight:600">비공식 도구</div>
</div></body>`);
  const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await page.close();
  return png;
}

/** 모든 픽셀의 알파가 255인가(apple-touch 불투명 확인) */
async function isOpaque(browser, png) {
  const page = await browser.newPage();
  const ok = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return false;
    return true;
  }, png.toString('base64'));
  await page.close();
  return ok;
}

mkdirSync(DIR, { recursive: true });
const browser = await chromium.launch();
try {
  const p16 = await renderIcon(browser, 16);
  const p32 = await renderIcon(browser, 32);
  writeFileSync(join(DIR, 'favicon.ico'), ico([{ size: 16, png: p16 }, { size: 32, png: p32 }]));
  const touch = await renderIcon(browser, 180, { square: true });
  if (!(await isOpaque(browser, touch))) throw new Error('apple-touch-icon.png가 불투명하지 않다');
  writeFileSync(join(DIR, 'apple-touch-icon.png'), touch);
  writeFileSync(join(DIR, 'og.png'), await renderOg(browser));
  console.log('render-assets: favicon.ico · apple-touch-icon.png · og.png');
} finally {
  await browser.close();
}
