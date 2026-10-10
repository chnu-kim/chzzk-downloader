// 시각 회귀 스냅샷(design-shots, docs/design/system/governance.md §2.7). 설정은 playwright.shots.config.ts.
// 프로젝트 이름이 배율·폭이다(dpr1-720·dpr1-960·dpr2-720·dpr2-960). 갤러리 섹션마다 toHaveScreenshot을 찍고
// 이름에 테마를 넣는다: <섹션>-<light|dark|forced>.png → e2e/__shots__/<프로젝트>/<이름>.
// 기준선은 Linux CI에서만 만든다(scripts/design/shots.mjs --accept). 로컬에서는 기준선이 없어 "snapshot doesn't exist"로 실패한다.
// 창 크기는 --window-size로 정했으므로 page.setViewportSize를 쓰지 않는다(배율이 1로 돌아간다).
import { expect, test, type Page } from '@playwright/test';
import { LOADER_DELAY_MS } from './copy';
import { test as appTest } from './fixtures';
import { SCREENS, scenarioFor, type Env, type Screen } from './screens-data';

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

/** 고정 시각: 가짜 시계가 이 시각에서 시작해 글자(남은 시간 등)가 실행마다 같다 */
const T0 = new Date('2026-01-01T00:00:00+09:00');

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: T0 });
});

/**
 * 갤러리를 열고 불러오는 중 칸(스피너·자리 표시)이 나타날 때까지 가짜 시계를 흘려보낸다:
 * 이 칸들은 useDelayedLoading을 거쳐 LOADER_DELAY_MS 뒤에 나타난다(시계가 가짜라 저절로 흐르지 않는다)
 */
async function openGallery(page: Page) {
  await page.goto('/gallery.html');
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(LOADER_DELAY_MS + 100);
}

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
      await openGallery(page);
      await expect(page.locator(`section[data-gallery="${section}"]`)).toHaveScreenshot(`${section}-${theme.name}.png`);
    });
  }

  // 열린 대화상자(막과 대화상자) 변형 전부. 트리거를 눌러 연다. 시계가 가짜라 등장 전환(rAF)을 직접 흘려보낸다
  for (const which of DIALOGS) {
    test(`dialog-open-${which}-${theme.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.colorScheme, forcedColors: theme.forcedColors });
      await openGallery(page);
      await page.locator(`[data-dialog-trigger="${which}"]`).click();
      await page.clock.runFor(500);
      await expect(page.locator('.scrim .dialog')).toBeVisible();
      await expect(page).toHaveScreenshot(`dialog-open-${which}-${theme.name}.png`);
    });
  }

  // 열린 메뉴(첫 아이콘 트리거의 패널)
  test(`menu-open-${theme.name}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme.colorScheme, forcedColors: theme.forcedColors });
    await openGallery(page);
    const section = page.locator('section[data-gallery="menu"]');
    await section.scrollIntoViewIfNeeded();
    await section.getByRole('button').first().click();
    await page.clock.runFor(500);
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page).toHaveScreenshot(`menu-open-${theme.name}.png`);
  });
}

// ───────────────────────── 화면 스냅샷(실제 앱 + 가짜 백엔드) ─────────────────────────
// 갤러리 섹션과 같은 이름 규칙: screen-<화면>-<light|dark|forced>.png → e2e/__shots__/<프로젝트>/ (720·960 × 배율 1·2).
// 기준선은 만들지 않는다: CI 실행의 artifact를 `node scripts/design/shots.mjs --accept <run id>`로 받는다.
// 가짜 시계를 고정(pauseAt)하고 필요한 만큼만 흘려보낸다: 로딩 칸은 LOADER_DELAY_MS 뒤, 남은 시간 같은 글자는 늘 같은 값이다.
// 화면 데이터는 합성이다. OS는 macOS(설정은 OS별 화면이 따로 있다)이고, 카드·목록은 Windows 한 벌을 더 찍는다(고정 데이터 두 벌).

const bySlug = (slug: string) => SCREENS.find((s) => s.slug === slug) as Screen;
const WINDOWS_COPIES: Screen[] = ['card-worst', 'jobs-all'].map((slug) => ({ ...bySlug(slug), slug: `${slug}-windows`, os: 'windows' as const }));
const SHOT_SCREENS: Screen[] = [...SCREENS, ...WINDOWS_COPIES];
const NOW = Math.floor(T0.getTime() / 1000);

for (const theme of THEMES) {
  for (const screen of SHOT_SCREENS) {
    appTest(`screen-${screen.slug}-${theme.name}`, async ({ app }) => {
      const { page } = app;
      const env: Env = {
        name: '스냅샷',
        vp: { width: 0, height: 0 },
        scheme: theme.colorScheme,
        forced: theme.forcedColors === 'active',
        os: 'macos',
        tick: (ms) => page.clock.runFor(ms),
      };
      await page.emulateMedia({ colorScheme: theme.colorScheme, forcedColors: theme.forcedColors });
      await page.clock.pauseAt(new Date(T0.getTime() + 1000));
      await app.open(scenarioFor(screen, env, NOW));
      await screen.drive?.(app, env);
      await page.clock.runFor(LOADER_DELAY_MS + 100);
      await screen.ready(page).waitFor();
      if (screen.toastAction) {
        await screen.toastAction(app);
        await page.clock.runFor(500);
        await page.locator('.notice-toast').waitFor();
        // 메뉴가 닫히고 포인터가 행 위에 남지 않게(hover 면이 찍히지 않게) 한 뒤 찍는다
        await expect(page.getByRole('menu')).toBeHidden();
        await page.mouse.move(0, 0);
        // 메뉴가 닫히며 포커스가 [⋯]로 돌아가고, 브라우저가 그 버튼을 보이게 .main을 스크롤하는 양은 레이아웃 시점(토스트 padding)에 따라
        // 실행마다 달라진다. 레이아웃이 가라앉길 기다린 뒤 스크롤을 맨 위로 명시 고정해 찍는다(앱 코드는 그대로).
        // 가짜 시계에서는 rAF도 가짜라 runFor로 흘리고, 강제 레이아웃(offsetHeight)으로 확정한다
        const raf2 = async () => {
          await page.clock.runFor(100);
          await page.evaluate(() => document.querySelector('.main')?.getBoundingClientRect().height);
        };
        await page.clock.runFor(500);
        await raf2();
        await page.evaluate(() => {
          const main = document.querySelector('.main');
          if (main) main.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        });
        await raf2();
      }
      await screen.settle?.(page, env);
      await page.clock.runFor(500);
      await expect(page).toHaveScreenshot(`screen-${screen.slug}-${theme.name}.png`);
    });
  }
}
