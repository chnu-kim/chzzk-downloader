// design-gallery(docs/design/system/governance.md §2.6, §2.5 래스터): gallery.html의 ui/ 매트릭스를 환경 행렬로 돌며
// axe·대상 크기·리플로우·포커스 링·계산값·대화상자 규칙·어휘 노출·아이콘 번짐을 본다. 프로젝트 `gallery`(playwright.config.ts)에서만 돈다.
// 앱 fixture(app.open)는 쓰지 않는다: 갤러리는 IPC도 Tauri도 없다.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect, type Page } from '@playwright/test';
import { LOADER_DELAY_MS } from '../src/lib/timing';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const VOCAB_TS = fileURLToPath(new URL('../src/lib/components/ui/vocab.ts', import.meta.url));
const ICONS_BLUR = fileURLToPath(new URL('../../scripts/design/icons-blur.mjs', import.meta.url));
const OUT = fileURLToPath(new URL('../../target/e2e-web/', import.meta.url));

/** 페이지 오류·console.error는 실패다(갤러리가 깨진 채 통과하지 않게) */
const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      await use();
      expect(errors, '페이지 오류·console.error가 없어야 한다').toEqual([]);
    },
    { auto: true },
  ],
});

const SCHEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { width: 960, height: 700 }, // 앱 기본 창
  { width: 720, height: 520 }, // 앱 최소 창
  { width: 320, height: 231 }, // Windows 텍스트 225% 흉내
] as const;

async function openGallery(page: Page) {
  await page.goto('/gallery.html');
  await page.locator('[data-gallery="icons"]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  // 불러오는 중 칸(스피너·자리 표시)은 useDelayedLoading을 거쳐 LOADER_DELAY_MS 뒤에 나타난다: 그 뒤의 상태를 본다
  await page.locator('[data-gallery="skeleton"] .skeleton').first().waitFor({ timeout: LOADER_DELAY_MS + 2_000 });
}

/** 기존 e2e/fixtures.ts의 axe 실행 방식과 같다(앱 fixture 없이) */
async function axe(page: Page, label: string) {
  // 열리는 중인 전환(Disclosure·대화상자)의 중간 색·크기를 재지 않도록 애니메이션이 끝난 뒤 잰다
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await page.addScriptTag({ path: AXE });
  const violations = await page.evaluate(async () => {
    const r = await (
      window as unknown as {
        axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[]; any?: { message: string }[] }[] }[] }> };
      }
    ).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      resultTypes: ['violations'],
    });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.any?.[0]?.message ?? ''}`.trim()).join(' | ')}`);
  });
  expect(violations, `axe 위반(${label})`).toEqual([]);
}

/** 대화형 요소의 "보이는 대상" 상자를 모아 최소 크기(--hit-min)보다 작은 것을 돌려준다 */
async function smallTargets(page: Page, min: number) {
  return page.evaluate((limit) => {
    const sel = 'button, select, summary, input:not([type="hidden"]), a[href], [role="switch"], [role="menuitem"]';
    const seen = new Set<Element>();
    const small: string[] = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[inert]')) continue;
      // 보이는 대상: .sr-only 라디오는 label.choice, SecretField 안 input은 .field-wrap, summary는 자신
      let target: Element = el;
      if (el instanceof HTMLInputElement && el.type === 'radio') target = el.closest('label.choice') ?? el;
      else if (el instanceof HTMLInputElement && el.closest('.field-wrap')) target = el.closest('.field-wrap') ?? el;
      if (seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // 닫힌 <details> 안 등
      // 부동소수 오차 0.5px는 봐준다
      if (r.width < limit - 0.5 || r.height < limit - 0.5) {
        const name = `${target.tagName.toLowerCase()}${target.className ? '.' + String(target.className).trim().split(/\s+/).join('.') : ''}`;
        small.push(`${name} ${r.width.toFixed(1)}×${r.height.toFixed(1)} "${(target.textContent ?? '').trim().slice(0, 20) || (target.getAttribute('aria-label') ?? '')}"`);
      }
    }
    return small;
  }, min);
}

/** 문서가 가로로 넘치는가(WCAG 1.4.10 리플로우) */
async function overflowX(page: Page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    return { scroll: Math.max(html.scrollWidth, document.body.scrollWidth), client: html.clientWidth };
  });
}

// ---------------------------------------------------------------------------
// 환경 행렬: 라이트·다크 × 960×700·720×520·320×231 × axe 위반 0
// ---------------------------------------------------------------------------
test.describe('환경 행렬 axe', () => {
  for (const scheme of SCHEMES) {
    for (const vp of VIEWPORTS) {
      test(`${scheme} ${vp.width}×${vp.height}: axe 위반 0`, async ({ page }) => {
        await page.setViewportSize(vp);
        await page.emulateMedia({ colorScheme: scheme });
        await openGallery(page);
        await axe(page, `${scheme} ${vp.width}×${vp.height}`);
      });
    }
  }

  for (const which of ['confirm', 'danger', 'custom', 'loading']) {
    for (const scheme of SCHEMES) {
      test(`대화상자 ${which} 열림 ${scheme}: axe 위반 0`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openGallery(page);
        await page.locator(`[data-dialog-trigger="${which}"]`).click();
        await expect(page.locator('.scrim .dialog')).toBeVisible();
        await axe(page, `대화상자 ${which} 열림 ${scheme}`);
      });
    }
  }

  // 메뉴 트리거 넷(icon·text × md·sm) 모두 연다
  for (const [i, name] of ['icon md', 'icon sm', 'text md', 'text sm'].entries()) {
    for (const scheme of SCHEMES) {
      test(`메뉴 ${name} 열림 ${scheme}: axe 위반 0`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openGallery(page);
        await page.locator('[data-gallery="menu"]').getByRole('button').nth(i).click();
        await expect(page.getByRole('menu')).toBeVisible();
        await axe(page, `메뉴 ${name} 열림 ${scheme}`);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 대상 크기(WCAG 2.5.8): 마우스 ≥ --hit-min(24), coarse는 40
// ---------------------------------------------------------------------------
test.describe('대상 크기', () => {
  for (const vp of VIEWPORTS.slice(0, 2)) {
    test(`마우스 ${vp.width}×${vp.height}: 대화형 요소 상자 ≥ 24`, async ({ page }) => {
      await page.setViewportSize(vp);
      await openGallery(page);
      const hit = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hit-min')));
      expect(hit).toBe(24);
      expect(await smallTargets(page, hit)).toEqual([]);
    });
  }

  test('coarse 포인터: 상자 ≥ 40 [잠정]', async ({ browser }) => {
    // Playwright는 any-pointer를 직접 에뮬레이션하지 못한다: 터치 컨텍스트에서 matchMedia가 참일 때만 본다
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 960, height: 700 }, reducedMotion: 'reduce', locale: 'ko-KR' });
    try {
      const page = await context.newPage();
      await openGallery(page);
      const coarse = await page.evaluate(() => matchMedia('(any-pointer: coarse)').matches);
      test.skip(!coarse, '[잠정] 이 Chromium 컨텍스트가 any-pointer: coarse를 켜지 않는다: 토큰 블록 값은 DT11이 본다');
      expect(await smallTargets(page, 40)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 리플로우(WCAG 1.4.10): x-large 글자와 320 폭에서 가로 스크롤 없음
// ---------------------------------------------------------------------------
test.describe('리플로우', () => {
  for (const width of [320, 720, 960]) {
    for (const scale of ['normal', 'x-large'] as const) {
      test(`${width}px ${scale}: 가로 스크롤 없음`, async ({ page }) => {
        await page.setViewportSize({ width, height: 700 });
        await openGallery(page);
        if (scale === 'x-large') await page.evaluate(() => (document.documentElement.dataset.textScale = 'x-large'));
        const { scroll, client } = await overflowX(page);
        expect(scroll, `scrollWidth ${scroll} > clientWidth ${client}`).toBeLessThanOrEqual(client);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// forced-colors: 키보드 포커스 링이 그려진다
// ---------------------------------------------------------------------------
test('forced-colors: Tab으로 포커스한 요소마다 outline-style ≠ none', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await openGallery(page);
  const missing: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // sr-only 라디오는 고리를 형제 .radio가 그린다
      const ring = el instanceof HTMLInputElement && el.type === 'radio' ? (el.parentElement?.querySelector('.radio') ?? el) : el;
      const own = getComputedStyle(el).outlineStyle;
      const shown = getComputedStyle(ring).outlineStyle !== 'none' || own !== 'none';
      const idx = [...document.querySelectorAll('*')].indexOf(el);
      return { shown, key: String(idx), name: `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 16)}"` };
    });
    if (!r) continue;
    if (seen.has(r.key)) break; // 한 바퀴 돌았다
    seen.add(r.key);
    if (!r.shown) missing.push(r.name);
  }
  expect(seen.size).toBeGreaterThan(50);
  expect(missing, '포커스 링이 없는 요소').toEqual([]);
});

// ---------------------------------------------------------------------------
// 계산값
// ---------------------------------------------------------------------------
test.describe('계산값', () => {
  const tokens = (page: Page) =>
    page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { muted: cs.getPropertyValue('--fg-muted').trim(), fg: cs.getPropertyValue('--fg').trim() };
    });

  test('다크 + contrast: more: --fg-muted = --fg', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
    await openGallery(page);
    const t = await tokens(page);
    expect(t.fg).not.toBe('');
    expect(t.muted).toBe(t.fg);
  });

  test('다크 기본 대비에서는 --fg-muted ≠ --fg (위 검사가 의미 있는지)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', contrast: 'no-preference' });
    await openGallery(page);
    const t = await tokens(page);
    expect(t.muted).not.toBe(t.fg);
  });

  for (const scheme of SCHEMES) {
    test(`${scheme}: 유령 버튼 hover 면 ≠ pressed 면`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openGallery(page);
      const ghost = page.locator('[data-gallery="buttons"] .btn-ghost:not([aria-disabled]):not(:disabled)').first();
      await ghost.scrollIntoViewIfNeeded();
      const bg = () => ghost.evaluate((e) => getComputedStyle(e).backgroundColor);
      const rest = await bg();
      await ghost.hover();
      await expect.poll(bg).not.toBe(rest);
      const hover = await bg();
      await page.mouse.down();
      try {
        await expect.poll(bg).not.toBe(hover);
      } finally {
        await page.mouse.up();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 대화상자(D36): inert 아닌 층에 .btn-primary 정확히 1개, 열리면 오른쪽 끝 버튼에 포커스
// ---------------------------------------------------------------------------
test.describe('대화상자 규칙', () => {
  for (const which of ['confirm', 'danger', 'custom', 'loading']) {
    test(`${which}: 채움 버튼 1개·포커스는 오른쪽 끝`, async ({ page }) => {
      await openGallery(page);
      const trigger = page.locator(`[data-dialog-trigger="${which}"]`);
      await trigger.click();
      const dialog = page.locator('.scrim .dialog');
      await expect(dialog).toBeVisible();
      // 열린 동안 inert 아닌 층에 .btn-primary는 대화상자 것 하나
      const primaries = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].filter((e) => !e.closest('[inert]')).map((e) => !!e.closest('.dialog')));
      expect(primaries).toEqual([true]);
      // 포커스는 .actions의 오른쪽 끝(가장 큰 x) 버튼
      const r = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const buttons = [...document.querySelectorAll<HTMLElement>('.dialog .actions button')];
        const maxRight = Math.max(...buttons.map((b) => b.getBoundingClientRect().right));
        return {
          isButton: !!active && buttons.includes(active),
          rightmost: !!active && Math.abs(active.getBoundingClientRect().right - maxRight) < 0.5,
          primary: !!active?.classList.contains('btn-primary'),
          last: active === buttons[buttons.length - 1],
        };
      });
      expect(r).toEqual({ isButton: true, rightmost: true, primary: true, last: true });
      // danger secondary는 왼쪽 끝으로 간다
      if (which === 'danger') {
        const leftmost = await page.evaluate(() => {
          const b = [...document.querySelectorAll<HTMLElement>('.dialog .actions button')];
          const minLeft = Math.min(...b.map((x) => x.getBoundingClientRect().left));
          return b.find((x) => x.classList.contains('tone-danger'))?.getBoundingClientRect().left === minLeft;
        });
        expect(leftmost).toBe(true);
      }
      // Esc는 닫기만, 연 요소로 돌아온다
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
});

// ---------------------------------------------------------------------------
// 어휘: vocab.ts의 모든 값이 갤러리에 data-vocab으로 보인다
// ---------------------------------------------------------------------------
test('vocab.ts 어휘 전부가 갤러리에 보인다', async ({ page }) => {
  const src = readFileSync(VOCAB_TS, 'utf8');
  const arrays = [...src.matchAll(/export const ([A-Z_]+) = \[([^\]]*)\] as const;/g)]
    .filter(([, name]) => name !== 'BOOLEAN_PROPS' && name !== 'ICON_BUTTON_ICONS') // 불리언 이름·아이콘 목록은 어휘 노출 대상이 아니다
    .map(([, name, body]) => ({ name, values: [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]) }));
  // 어휘 배열을 읽지 못하면 이 검사가 빈 채로 통과한다
  expect(arrays.map((a) => a.name)).toEqual(
    expect.arrayContaining(['BUTTON_VARIANT', 'NOTICE_VARIANT', 'SURFACE_VARIANT', 'DISCLOSURE_VARIANT', 'EMPTY_STATE_VARIANT', 'SKELETON_VARIANT', 'PAGE_CONTAINER_VARIANT', 'MENU_TRIGGER', 'TONE', 'SIZE', 'KIND', 'PROGRESS_STATE']),
  );
  await openGallery(page);
  const missing: string[] = [];
  for (const { name, values } of arrays) {
    for (const value of values) {
      const hit = page.locator(`[data-vocab="${name}:${value}"]`).first();
      const visible = (await hit.count()) > 0 && (await hit.isVisible());
      if (!visible) missing.push(`${name}:${value}`);
    }
  }
  expect(missing, '갤러리에 보이지 않는 어휘').toEqual([]);
});

// ---------------------------------------------------------------------------
// 아이콘 번짐(래스터, [잠정]): 라이트 · DPR 1·2로 아이콘 시트를 찍고 icons-blur.mjs로 잰다
// ---------------------------------------------------------------------------
async function blurCheck(page: Page, dpr: number) {
  const sheet = page.locator('[data-gallery="icons"]');
  await sheet.scrollIntoViewIfNeeded();
  const box = await sheet.boundingBox();
  if (!box) throw new Error('아이콘 시트 상자를 못 읽었다');
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-icon]')].map((c) => {
      const r = c.getBoundingClientRect();
      return { name: c.dataset.icon as string, x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
    }),
  );
  expect(cells.length).toBeGreaterThanOrEqual(56);
  const origin = await sheet.evaluate((e) => ({ x: e.getBoundingClientRect().left + scrollX, y: e.getBoundingClientRect().top + scrollY }));
  mkdirSync(OUT, { recursive: true });
  const png = `${OUT}icons-dpr${dpr}.png`;
  await sheet.screenshot({ path: png, scale: 'device', animations: 'disabled' });
  // 칸 좌표는 PNG 픽셀(시트 왼쪽 위가 원점, 배율을 곱한다)
  const px = cells.map((c) => ({ name: c.name, x: Math.round((c.x - origin.x) * dpr), y: Math.round((c.y - origin.y) * dpr), w: Math.round(c.w * dpr), h: Math.round(c.h * dpr) }));
  const json = `${OUT}icons-dpr${dpr}.cells.json`;
  writeFileSync(json, JSON.stringify(px));
  const r = spawnSync(process.execPath, [ICONS_BLUR, png, '--cells', json], { encoding: 'utf8' });
  expect(r.status, `icons-blur(dpr ${dpr}):\n${r.stdout}\n${r.stderr}`).toBe(0);
}

test('아이콘 번짐: 라이트 DPR 1', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openGallery(page);
  expect(await page.evaluate(() => devicePixelRatio)).toBe(1);
  await blurCheck(page, 1);
});

test('아이콘 번짐: 라이트 DPR 2 (--force-device-scale-factor)', async ({ baseURL }) => {
  // 배율 에뮬레이션은 테두리 스냅을 건너뛰므로 별도 브라우저에 강제 배율을 준다(playwright.shots.config.ts와 같은 방식).
  // 프로젝트 기본값(Desktop Chrome)의 deviceScaleFactor는 viewport null과 함께 쓸 수 없어 undefined로 걷어 낸다
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=2', '--window-size=960,700'] });
  try {
    const context = await browser.newContext({ viewport: null, deviceScaleFactor: undefined, colorScheme: 'light', reducedMotion: 'reduce', locale: 'ko-KR', baseURL });
    const page = await context.newPage();
    await openGallery(page);
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    await blurCheck(page, 2);
  } finally {
    await browser.close();
  }
});
