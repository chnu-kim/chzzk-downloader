// 색 수학(OKLCH → sRGB, WCAG 2.x 대비, HSL, 알파 합성)과 대비 표 CLI.
// 생성기(tokens.mjs)와 design-tokens 검사(check-tokens.mjs DT8·DT9)가 같은 함수를 쓴다.
// CLI: node scripts/design/contrast.mjs [--root dir]
//   모델의 contrast 쌍을 계산해 foundations.md 2.4 모양의 마크다운 표를 stdout에 찍고, 미달이 있으면 1(모델 오류는 2).
// 변환식: OKLCH → OKLab → LMS → 선형 sRGB(Björn Ottosson 2020 행렬, CSS Color 4와 같다) → 감마.

import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// OKLCH(L 0..1, C, H 도) → 감마 인코딩 sRGB [r, g, b] (0..1, 범위 밖이면 클램프하지 않는다)
export function oklchToSrgb(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map(toGamma);
}

// 0..1 → '#RRGGBB'(클램프·반올림·대문자)
export function toHex([r, g, b]) {
  const h = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

// '#RRGGBB' → [R, G, B] (0..255 정수)
export function parseHex(hex) {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) throw new Error(`hex 형식이 아니다: ${hex}`);
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}

// WCAG 2.x 상대 휘도
export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fgHex, bgHex) {
  const [hi, lo] = [relativeLuminance(fgHex), relativeLuminance(bgHex)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

// fg를 알파 alpha로 bg 위에 얹은 색(채널별 반올림)
export function composite(fgHex, alpha, bgHex) {
  const f = parseHex(fgHex);
  const b = parseHex(bgHex);
  return `#${f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

// h 0..360, s·l 0..100 (소수를 유지한다. 경계 판정은 부른 쪽이 한다)
export function hsl(hex) {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

// ---- CLI ----

// 쌍 목록을 계산한다. resolve(name)은 { hex, alpha }를 낸다. 알파 색은 바탕 위에 합성한 뒤 잰다.
export function pairRows(pairs, resolve) {
  return pairs.map(({ fg, bg, min }) => {
    const b = resolve(bg);
    const f = resolve(fg);
    if (b.alpha < 1) throw new Error(`${bg}: 바탕이 알파 색이다`);
    const fgHex = f.alpha < 1 ? composite(f.hex, f.alpha, b.hex) : f.hex;
    const ratio = contrastRatio(fgHex, b.hex);
    return { fg, bg, fgHex, bgHex: b.hex, ratio, min, pass: ratio >= min };
  });
}

export function renderTable(rows) {
  const lines = ['| 전경 | 바탕 | 대비 | 최소 | 판정 |', '|---|---|---|---|---|'];
  for (const r of rows) {
    lines.push(`| \`${r.fg}\` ${r.fgHex} | \`${r.bg}\` ${r.bgHex} | ${r.ratio.toFixed(2)} | ${r.min} | ${r.pass ? 'PASS' : 'FAIL'} |`);
  }
  return lines.join('\n');
}

export async function main(argv) {
  let root = ROOT;
  const i = argv.indexOf('--root');
  if (i >= 0) {
    if (!argv[i + 1]) {
      console.error('사용법: node scripts/design/contrast.mjs [--root dir]');
      return 2;
    }
    root = resolve(argv[i + 1]);
  }
  // tokens.mjs가 이 파일을 import하므로 순환을 피하려고 늦게 불러온다
  const { loadModel, resolveColor } = await import('./tokens.mjs');
  let model;
  try {
    model = loadModel(root);
  } catch (e) {
    console.error(`원천 오류: ${e.message}`);
    return 2;
  }
  let fail = 0;
  for (const theme of ['light', 'dark']) {
    const rows = pairRows(model.contrast[theme], (name) => resolveColor(model, name, theme));
    console.log(`### ${theme === 'light' ? '라이트' : '다크'}\n`);
    console.log(renderTable(rows));
    console.log('');
    fail += rows.filter((r) => !r.pass).length;
  }
  if (fail) {
    console.error(`${fail}쌍 미달`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // 최상위 await를 쓰지 않는다(main이 tokens.mjs를 불러오는데 tokens.mjs도 이 파일을 불러와 순환 대기가 된다)
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
