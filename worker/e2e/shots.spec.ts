// design-worker 시각 회귀 스냅샷(docs/design/system/governance.md §2.6b, 계약 §5). 설정은 playwright.config.ts다.
// 프로젝트 이름이 배율·폭이다(dpr1-1280·dpr1-390·dpr2-1280·dpr2-390). 페이지의 main(landing-anon은 header·footer도)을 라이트·다크·forced로 찍는다.
// 이름: <페이지>-<light|dark|forced>.png → e2e/__shots__/<프로젝트>/<이름>. 기준선은 Linux CI에서만 만든다(scripts/design/shots.mjs --accept --target worker).
// 로컬에서는 기준선이 없어 "snapshot doesn't exist"로 실패한다. 창 크기는 --window-size로 정했으므로 page.setViewportSize를 쓰지 않는다(배율이 1로 돌아간다).
import { expect, test } from "@playwright/test";
import { FIXED_NOW, ORIGIN, PAGES, serve } from "./pages";

/** 찍는 여덟 페이지(계약 §5) */
const SHOT_PAGES = ["landing-anon", "landing-member-mac", "admin", "admin-confirm", "done-denied", "login-confirm", "error-404", "help"] as const;

/** 테마 셋: forced는 라이트 위에 forced-colors를 켠 것이다 */
const THEMES = [
  { name: "light", colorScheme: "light", forcedColors: "none" },
  { name: "dark", colorScheme: "dark", forcedColors: "none" },
  { name: "forced", colorScheme: "light", forcedColors: "active" },
] as const;

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(FIXED_NOW) });
});

test("배율 단언", async ({ page }, info) => {
  const [, n, w] = /^dpr(\d)-(\d+)$/.exec(info.project.name) ?? [];
  const home = PAGES.find((p) => p.name === "help");
  if (home === undefined) throw new Error("help 페이지가 없다");
  await serve(page, await home.build());
  await page.goto(`${ORIGIN}/`);
  expect(await page.evaluate(() => [window.devicePixelRatio, window.innerWidth])).toEqual([Number(n), Number(w)]);
});

test("찍는 페이지는 모두 갤러리 목록에 있다", () => {
  const names = new Set(PAGES.map((p) => p.name));
  for (const n of SHOT_PAGES) expect(names.has(n), n).toBe(true);
});

for (const theme of THEMES) {
  for (const name of SHOT_PAGES) {
    test(`${name}-${theme.name}`, async ({ page }) => {
      const def = PAGES.find((p) => p.name === name);
      if (def === undefined) throw new Error(`${name} 페이지가 없다`);
      await page.emulateMedia({ colorScheme: theme.colorScheme, forcedColors: theme.forcedColors });
      await serve(page, await def.build());
      await page.goto(`${ORIGIN}/`);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("main")).toHaveScreenshot(`${name}-${theme.name}.png`);
      if (name === "landing-anon") {
        await expect(page.locator("header.site-header")).toHaveScreenshot(`${name}-header-${theme.name}.png`);
        await expect(page.locator("footer.site-footer")).toHaveScreenshot(`${name}-footer-${theme.name}.png`);
      }
    });
  }
}
