// 시각 회귀 스냅샷(design-shots, docs/design/system/governance.md §2.7). 설정은 playwright.shots.config.ts.
// 프로젝트 이름이 배율·폭이다(dpr1-720·dpr1-960·dpr2-720·dpr2-960). 갤러리 섹션마다 toHaveScreenshot을 찍고
// 이름에 테마를 넣는다: <섹션>-<light|dark|forced>.png → e2e/__shots__/<프로젝트>/<이름>.
// 기준선은 Linux CI에서만 만든다(scripts/design/shots.mjs --accept). 로컬에서는 기준선이 없어 "snapshot doesn't exist"로 실패한다.
// 창 크기는 --window-size로 정했으므로 page.setViewportSize를 쓰지 않는다(배율이 1로 돌아간다).
import { expect, test } from '@playwright/test';

/** 갤러리 섹션 이름(src/gallery/fixtures.ts SECTIONS와 같다. e2e에서 src를 import하지 않으므로 복사하고 아래 테스트가 대조한다) */
const SECTIONS = [
  'buttons',
  'icon-buttons',
  'fields',
  'select',
  'switches',
  'radio',
  'disclosure',
  'notice',
  'dialog',
  'menu',
  'badge',
  'progress',
  'skeleton',
  'empty',
  'surface',
  'toolbar',
  'icons',
] as const;

/** 갤러리 대화상자 변형(DialogSection의 data-dialog-trigger와 같다) */
const DIALOGS = ['confirm', 'danger', 'custom', 'loading'] as const;

/** 테마 셋: forced는 라이트 위에 forced-colors를 켠 것이다 */
const THEMES = [
  { name: 'light', colorScheme: 'light', forcedColors: 'none' },
  { name: 'dark', colorScheme: 'dark', forcedColors: 'none' },
  { name: 'forced', colorScheme: 'light', forcedColors: 'active' },
] as const;

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00+09:00') });
});

test('배율 단언', async ({ page }, info) => {
  await page.goto('/gallery.html');
  const [, n, w] = /^dpr(\d)-(\d+)$/.exec(info.project.name) ?? [];
  expect(await page.evaluate(() => [window.devicePixelRatio, window.innerWidth])).toEqual([Number(n), Number(w)]);
});

test('섹션 목록이 갤러리와 같다', async ({ page }) => {
  await page.goto('/gallery.html');
  const found = await page.locator('section[data-gallery]').evaluateAll((els) => els.map((e) => e.getAttribute('data-gallery')));
  expect(new Set(found)).toEqual(new Set(SECTIONS));
  expect(found.length).toBe(SECTIONS.length);
});

for (const theme of THEMES) {
  for (const section of SECTIONS) {
    test(`${section}-${theme.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.colorScheme, forcedColors: theme.forcedColors });
      await page.goto('/gallery.html');
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(`section[data-gallery="${section}"]`)).toHaveScreenshot(`${section}-${theme.name}.png`);
    });
  }

  // 열린 대화상자(막과 대화상자) 변형 전부. 트리거를 눌러 연다. 시계가 가짜라 등장 전환(rAF)을 직접 흘려보낸다
  for (const which of DIALOGS) {
    test(`dialog-open-${which}-${theme.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.colorScheme, forcedColors: theme.forcedColors });
      await page.goto('/gallery.html');
      await page.evaluate(() => document.fonts.ready);
      await page.locator(`[data-dialog-trigger="${which}"]`).click();
      await page.clock.runFor(500);
      await expect(page.locator('.scrim .dialog')).toBeVisible();
      await expect(page).toHaveScreenshot(`dialog-open-${which}-${theme.name}.png`);
    });
  }

  // 열린 메뉴(첫 아이콘 트리거의 패널)
  test(`menu-open-${theme.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme.colorScheme, forcedColors: theme.forcedColors });
    await page.goto('/gallery.html');
    await page.evaluate(() => document.fonts.ready);
    const section = page.locator('section[data-gallery="menu"]');
    await section.scrollIntoViewIfNeeded();
    await section.getByRole('button').first().click();
    await page.clock.runFor(500);
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page).toHaveScreenshot(`menu-open-${theme.name}.png`);
  });
}
