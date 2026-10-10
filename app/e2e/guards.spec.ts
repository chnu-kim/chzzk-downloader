// 웹 흔적 지우기 가드(platform §4.3·§4.4, guards.ts): 컨텍스트 메뉴와 브라우저 단축키.
// 실제 프로덕션 dist(vite preview)라 import.meta.env.DEV가 false여서 main.ts가 가드를 설치한다.
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

type Seen = { type: string; key: string; prevented: boolean };

// 문서 버블 단계에서 defaultPrevented를 기록한다(window 캡처의 가드가 먼저 돈 뒤다)
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __seen: Seen[] };
    w.__seen = [];
    for (const type of ['keydown', 'contextmenu']) {
      document.addEventListener(type, (e) => w.__seen.push({ type, key: (e as KeyboardEvent).key ?? '', prevented: e.defaultPrevented }));
    }
  });
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen.slice());
const last = async (page: Page, type: string) => (await seen(page)).filter((s) => s.type === type).at(-1);

test('컨텍스트 메뉴: 본문은 막고 입력칸은 남긴다', async ({ app }) => {
  const { page } = app;
  await app.open();
  await record(page);
  await page.locator('body').click({ button: 'right', position: { x: 2, y: 2 } });
  expect((await last(page, 'contextmenu'))?.prevented).toBe(true);
  await page.locator('#url-input').click({ button: 'right' });
  expect((await last(page, 'contextmenu'))?.prevented).toBe(false);
});

test('브라우저 단축키: 본문에서 F5·Ctrl+R·Ctrl+F가 막힌다', async ({ app }) => {
  const { page } = app;
  await app.open();
  await record(page);
  await page.locator('body').click({ position: { x: 2, y: 2 } });
  for (const key of ['F5', 'Control+r', 'Control+f', 'Control+Shift+r', 'F12']) {
    await page.keyboard.press(key);
    expect((await last(page, 'keydown'))?.prevented, key).toBe(true);
  }
  // 페이지가 다시 불러와지지 않았다: 기록 배열이 그대로 있다
  expect((await seen(page)).length).toBeGreaterThan(0);
});

test('브라우저 단축키: 입력칸 안의 Ctrl+F·Alt+ArrowLeft는 막지 않는다', async ({ app }) => {
  const { page } = app;
  await app.open();
  await record(page);
  await page.locator('#url-input').click();
  for (const key of ['Control+f', 'Alt+ArrowLeft']) {
    await page.keyboard.press(key);
    expect((await last(page, 'keydown'))?.prevented, key).toBe(false);
  }
  // 붙여넣기·복사 같은 편집 키는 어디서나 통과
  await page.keyboard.press('Control+a');
  expect((await last(page, 'keydown'))?.prevented).toBe(false);
});
