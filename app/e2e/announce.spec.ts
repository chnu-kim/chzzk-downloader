// 작업 행 키보드 지우기 · Mod+Z · 상주 라이브 영역(ADR-0033, app.md 구현 중 변경 132).
// 가짜 백엔드 명령은 그대로다: 지우기는 기존 `remove_job`, 플랫폼은 기본 linux라 되돌리기는 Ctrl+Z다.
import { job } from '../src/test/jobFixtures';
import { jobRowName } from '../src/test/jobRow';
import { TOAST_MS, t } from './copy';
import { expect, test } from './fixtures';

const TITLE = '완료한 영상';
const scenario = { jobs: [job(1, { title: TITLE, status: 'completed', finalBytes: 10 })] };

test('키보드로 지운 되돌리기 토스트는 시간이 지나도 남고 Ctrl+Z로 되돌린다', async ({ app }) => {
  const { page } = app;
  await page.clock.install();
  await app.open(scenario);
  const row = page.getByRole('article', { name: jobRowName(TITLE) });
  await row.focus();
  await page.keyboard.press('Delete');
  await expect(row).toBeHidden();
  const toast = page.locator('.notice-toast');
  await expect(toast).toContainText(t('toast.removed'));
  await page.mouse.move(0, 0);
  await page.clock.runFor(TOAST_MS * 2);
  await expect(toast).toBeVisible();
  expect(await app.args('remove_job')).toEqual([]);
  await page.keyboard.press('Control+z');
  await expect(row).toBeVisible();
  await expect(toast).toHaveCount(0);
  expect(await app.args('remove_job')).toEqual([]);
  await app.axe('되돌리기 뒤');
});

test('포인터로 지우면 기존대로 TOAST_MS 뒤에 확정한다', async ({ app }) => {
  const { page } = app;
  await page.clock.install();
  await app.open(scenario);
  const row = page.getByRole('article', { name: jobRowName(TITLE) });
  await row.getByRole('button', { name: t('a11y.more', { title: TITLE }) }).click();
  await page.getByRole('menuitem', { name: t('action.remove') }).click();
  await expect(row).toBeHidden();
  await page.mouse.move(0, 0);
  await page.clock.runFor(TOAST_MS + 100);
  await expect(page.locator('.notice-toast')).toHaveCount(0);
  await expect.poll(() => app.args('remove_job')).toEqual([{ id: 1 }]);
});

test('상주 라이브 영역 둘이 먼저 있고, 토스트 요소에는 role이 없다', async ({ app }) => {
  const { page } = app;
  await app.open(scenario);
  await expect(page.locator('.sr-only[aria-live="polite"]')).toHaveCount(1);
  await expect(page.locator('.sr-only[aria-live="assertive"]')).toHaveCount(1);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
  });
  const row = page.getByRole('article', { name: jobRowName(TITLE) });
  await row.getByRole('button', { name: t('a11y.more', { title: TITLE }) }).click();
  await page.getByRole('menuitem', { name: t('action.copyUrl') }).click();
  await expect(page.locator('.sr-only[aria-live="polite"]')).toHaveText(t('action.copied'));
  await expect(page.locator('.notice-toast')).toBeVisible();
  await expect(page.locator('.notice-toast [role="status"], .notice-toast [role="alert"]')).toHaveCount(0);
});

test('입력칸 안의 Ctrl+Z는 앱이 가로채지 않는다', async ({ app }) => {
  const { page } = app;
  await page.clock.install();
  await app.open(scenario);
  const row = page.getByRole('article', { name: jobRowName(TITLE) });
  await row.focus();
  await page.keyboard.press('Delete');
  await expect(row).toBeHidden();
  const input = page.getByLabel(t('url.label'));
  await input.fill('abc');
  await input.press('Control+z');
  await expect(row).toBeHidden();
  await expect(page.locator('.notice-toast')).toContainText(t('toast.removed'));
});
