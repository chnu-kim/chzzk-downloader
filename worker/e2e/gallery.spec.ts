// design-worker 갤러리(docs/design/system/governance.md §2.6b, 계약 §5): 열여섯 페이지를 환경 행렬로 돌며
// axe · 대상 크기 · 가로 스크롤 · forced-colors 포커스 링 · contrast 계산값 · 채움 버튼 수 · CSP 위반 · 320 리플로우 · 랜딩 고지 위치를 본다.
// 프로젝트 `gallery`(playwright.config.ts)에서만 돈다. 페이지는 순수 렌더 함수의 응답을 가짜 출처로 내보낸 것이다(pages.ts).
// axe는 page.evaluate(소스)로 넣는다: CDP 평가라 CSP를 타지 않는다. addScriptTag·bypassCSP는 쓰지 않는다(CSP 회귀 검사가 사라진다).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { COPY } from "../src/http/copy";
import { ORIGIN, PAGES, READING_PAGES, serve } from "./pages";

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;

/** 환경 조합: 라이트·다크 × 기본, forced-colors(라이트 위), contrast: more + reduced-motion(라이트·다크) */
const MODES = [
  { name: "light", colorScheme: "light", forcedColors: "none", contrast: "no-preference", reducedMotion: "no-preference" },
  { name: "dark", colorScheme: "dark", forcedColors: "none", contrast: "no-preference", reducedMotion: "no-preference" },
  { name: "forced", colorScheme: "light", forcedColors: "active", contrast: "no-preference", reducedMotion: "no-preference" },
  { name: "light-contrast-reduce", colorScheme: "light", forcedColors: "none", contrast: "more", reducedMotion: "reduce" },
  { name: "dark-contrast-reduce", colorScheme: "dark", forcedColors: "none", contrast: "more", reducedMotion: "reduce" },
] as const;

/** CSP 위반 메시지만 실패로 센다(4xx 문서 자체의 "Failed to load resource"는 정상이다) */
const CSP_MESSAGE = /Content Security Policy|Refused to/;

async function open(page: Page, build: () => Response | Promise<Response>): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (CSP_MESSAGE.test(m.text())) violations.push(m.text());
  });
  page.on("pageerror", (e) => violations.push(`pageerror: ${e.message}`));
  await serve(page, await build());
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => document.fonts.ready);
  return violations;
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(AXE_SOURCE);
  return page.evaluate(async () => {
    const r = await (
      window as unknown as {
        axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[]; any?: { message: string }[] }[] }[] }> };
      }
    ).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      resultTypes: ["violations"],
    });
    return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.any?.[0]?.message ?? ""}`.trim()).join(" | ")}`);
  });
}

/** 대화형 요소의 상자가 --hit-min보다 작은 것. 본문 문단 안 링크는 WCAG 2.5.8 예외라 뺀다 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const min = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hit-min"));
    if (!(min > 0)) return [`--hit-min을 읽지 못했다(${min})`];
    const small: string[] = [];
    for (const el of document.querySelectorAll('a[href], button, summary, input:not([type="hidden"]), [tabindex="0"]')) {
      if (el.tagName === "A" && el.closest("p")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue; // 닫힌 details 안 등
      if (r.width < min - 0.5 || r.height < min - 0.5) {
        const label = (el.textContent ?? "").trim().slice(0, 20) || el.getAttribute("aria-label") || el.getAttribute("name") || "";
        small.push(`${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""} ${r.width.toFixed(1)}×${r.height.toFixed(1)} "${label}"`);
      }
    }
    return small;
  });
}

const overflowX = (page: Page) =>
  page.evaluate(() => ({ scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), client: document.documentElement.clientWidth }));

/** Tab으로 한 바퀴 돌며 포커스 링이 없는 요소를 모은다(forced-colors) */
async function focusRingMissing(page: Page): Promise<{ visited: number; missing: string[] }> {
  const missing: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const idx = [...document.querySelectorAll("*")].indexOf(el);
      return {
        key: String(idx),
        shown: getComputedStyle(el).outlineStyle !== "none",
        name: `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 16)}"`,
      };
    });
    if (r === null) continue;
    if (seen.has(r.key)) break; // 한 바퀴 돌았다
    seen.add(r.key);
    if (!r.shown) missing.push(r.name);
  }
  return { visited: seen.size, missing };
}

for (const vp of VIEWPORTS) {
  for (const mode of MODES) {
    test.describe(`${vp.width}×${vp.height} ${mode.name}`, () => {
      test.use({ viewport: vp, colorScheme: mode.colorScheme, forcedColors: mode.forcedColors, contrast: mode.contrast, reducedMotion: mode.reducedMotion });

      for (const p of PAGES) {
        test(p.name, async ({ page }) => {
          const csp = await open(page, p.build);

          // 읽기 척도는 랜딩과 읽기 페이지에만 있다(나머지는 앱 척도)
          expect.soft(await page.locator('main[data-scale="reading"]').count(), "읽기 척도(main[data-scale])").toBe(READING_PAGES.has(p.name) ? 1 : 0);
          expect.soft(await page.locator("h1").count(), "h1 개수").toBe(1);
          expect.soft(await axeViolations(page), "axe 위반(WCAG 2.x A·AA)").toEqual([]);
          expect.soft(await smallTargets(page), "대상 크기 < --hit-min").toEqual([]);
          const { scroll, client } = await overflowX(page);
          expect.soft(scroll, `가로 스크롤(scrollWidth ${scroll} > clientWidth ${client})`).toBeLessThanOrEqual(client);
          expect.soft(await page.locator(".btn-primary").count(), "채움 버튼(.btn-primary)은 페이지에 하나 이하").toBeLessThanOrEqual(1);

          if (mode.forcedColors === "active") {
            const { visited, missing } = await focusRingMissing(page);
            expect.soft(visited, "Tab으로 도달한 요소 수").toBeGreaterThan(3);
            expect.soft(missing, "forced-colors에서 포커스 링(outline-style)이 없는 요소").toEqual([]);
          }

          if (mode.colorScheme === "dark" && mode.contrast === "more") {
            const t = await page.evaluate(() => {
              const cs = getComputedStyle(document.documentElement);
              return { muted: cs.getPropertyValue("--fg-muted").trim(), fg: cs.getPropertyValue("--fg").trim() };
            });
            expect.soft(t.fg, "--fg를 읽는다").not.toBe("");
            expect.soft(t.muted, "다크 + contrast: more에서 --fg-muted = --fg").toBe(t.fg);
          }

          // 랜딩의 비공식 고지는 첫 화면(뷰포트) 안에 있어야 한다
          if (p.name.startsWith("landing-")) {
            const box = await page.locator(".notice", { hasText: COPY.notice.short }).first().boundingBox();
            expect.soft(box, "랜딩 고지 알림이 있다").not.toBeNull();
            if (box !== null) {
              expect.soft(box.y, "고지 위쪽").toBeGreaterThanOrEqual(0);
              expect.soft(box.y + box.height, `고지 아래쪽이 뷰포트(${vp.height}) 안`).toBeLessThanOrEqual(vp.height);
            }
          }

          expect(csp, "CSP 위반·페이지 오류").toEqual([]);
        });
      }
    });
  }
}

// 읽기 척도 페이지는 320 폭에서도 가로 스크롤이 없다(WCAG 1.4.10 리플로우)
test.describe("320 리플로우", () => {
  test.use({ viewport: { width: 320, height: 568 } });
  for (const p of PAGES.filter((x) => READING_PAGES.has(x.name))) {
    test(p.name, async ({ page }) => {
      const csp = await open(page, p.build);
      expect(await page.locator('main[data-scale="reading"]').count()).toBe(1);
      const { scroll, client } = await overflowX(page);
      expect(scroll, `scrollWidth ${scroll} > clientWidth ${client}`).toBeLessThanOrEqual(client);
      expect(csp).toEqual([]);
    });
  }
});

test("페이지 목록은 열여섯이고 이름이 겹치지 않는다", () => {
  expect(PAGES.length).toBe(16);
  expect(new Set(PAGES.map((p) => p.name)).size).toBe(16);
});
