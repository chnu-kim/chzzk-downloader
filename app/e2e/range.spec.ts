// 구간 받기(range.md §5.7, preview-ux2): 기본 펼친 섹션 → 시각 → [받기] → 작업 행 1줄 조각. 가짜 백엔드가 check_output에서 접미사를 붙인다.
// 화면 글자는 모두 e2e/copy.ts(copy deck)에서 가져온다.
import type { Locator } from '@playwright/test';
import { liveResolved, resolved } from '../src/test/fixtures';
import { errorCopy, rangeChip, t } from './copy';
import { expect, test, type App } from './fixtures';

/** 섹션 머리("미리보기·구간"). 기본 펼침이라 열 일은 없고 접을 때만 쓴다(preview-ux2 PS8) */
const toggle = (card: Locator) => card.locator('.watch summary');
const start = (card: Locator) => card.getByRole('textbox', { name: t('range.start') });
const end = (card: Locator) => card.getByRole('textbox', { name: t('range.end') });
const enqReqs = async (app: App) => ((await app.args('enqueue')) as { req: Record<string, unknown> }[]).map((e) => e.req);

async function openCard(app: App, r = resolved()) {
  await app.open({ resolve: { [r.url]: r } });
  await app.page.getByLabel(t('url.label')).fill(r.url);
  await app.page.getByRole('button', { name: t('common.load') }).click();
  const card = app.page.getByRole('region', { name: r.meta.title });
  await expect(card).toBeVisible();
  return card;
}

const downloadBtn = (card: Locator) => card.getByRole('button', { name: t('card.download') });

test('구간을 골라 받으면 이름에 구간이 한 번 붙고 작업 행에 조각이 보인다', async ({ app }) => {
  const r = resolved();
  const card = await openCard(app, r);
  await start(card).fill('0:10:00');
  await end(card).fill('0:20:00');
  await expect(card.getByText(t('filename.willSaveAs', { name: `${r.suggestedFileName} (0.10.00~0.20.00)` }))).toBeVisible();
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  // 칸을 채우며 생긴 포커스 스크롤로 카드 머리가 sticky 입력줄 밑에 반쯤 걸린다: 카드를 입력줄 바로 아래에 두고 잰다
  await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await app.axe('구간 펼침');

  await downloadBtn(card).click();
  await expect(card).toBeHidden();
  const reqs = await enqReqs(app);
  expect(reqs).toHaveLength(1);
  expect(reqs[0].range).toEqual({ startMs: 600000, endMs: 1200000 });
  expect(reqs[0].fileName).toBe(`${r.suggestedFileName} (0.10.00~0.20.00)`);
  expect((reqs[0].fileName as string).split('(0.10.00~')).toHaveLength(2);
  const item = app.page.getByRole('article', { name: r.meta.title });
  await expect(item.locator('.job-quality')).toHaveText(`1080p · ${rangeChip({ startMs: 600000, endMs: 1200000 })}`);
});

test('손대지 않고 받으면 구간이 없다(칸이 비면 전체)', async ({ app }) => {
  const card = await openCard(app);
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect(card).toBeHidden();
  const reqs = await enqReqs(app);
  expect(reqs).toHaveLength(1);
  expect('range' in reqs[0]).toBe(false);
});

test('칸을 채운 뒤 섹션을 접고 받으면 구간이 없다', async ({ app }) => {
  const card = await openCard(app);
  await start(card).fill('0:10:00');
  await toggle(card).click();
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect(card).toBeHidden();
  const reqs = await enqReqs(app);
  expect(reqs).toHaveLength(1);
  expect('range' in reqs[0]).toBe(false);
});

test('형식이 틀리면 [받기] 때 칸 아래에 알리고 입력을 지우지 않는다', async ({ app }) => {
  const card = await openCard(app);
  await start(card).fill('abc');
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect(card.getByRole('alert')).toHaveText(t('range.error.format', { example: '0:10:00' }));
  await expect(start(card)).toHaveAttribute('aria-invalid', 'true');
  await expect(start(card)).toBeFocused();
  await expect(start(card)).toHaveValue('abc');
  await app.axe('구간 형식 오류');
  expect(await enqReqs(app)).toHaveLength(0);
});

test('끝이 시작보다 앞이면 끝 칸에 알린다', async ({ app }) => {
  const card = await openCard(app);
  await start(card).fill('0:30:00');
  await end(card).fill('0:20:00');
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect(card.getByRole('alert')).toHaveText(t('range.error.order'));
  await expect(end(card)).toHaveAttribute('aria-invalid', 'true');
  await expect(end(card)).toBeFocused();
});

test('구간만 바꾸고 바로 [받기]를 눌러도 새 구간 이름으로 받는다', async ({ app }) => {
  const card = await openCard(app);
  await start(card).fill('0:10:00');
  await end(card).fill('0:20:00');
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await end(card).fill('0:30:00');
  await downloadBtn(card).click();
  // 검사가 끝나 활성이 된 뒤 카드가 남아 있으면 한 번 더 누른다
  await expect(async () => {
    if (await card.isVisible()) {
      await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true', { timeout: 1000 });
      await downloadBtn(card).click({ timeout: 1000 });
    }
    expect((await enqReqs(app)).length).toBeGreaterThan(0);
  }).toPass();
  const reqs = await enqReqs(app);
  for (const req of reqs) {
    const name = req.fileName as string;
    expect(name.split('(0.10.00~0.30.00)')).toHaveLength(2);
    expect(name).not.toContain('(0.10.00~0.20.00)');
    expect((req.range as { endMs: number }).endMs).toBe(1800000);
  }
});

test('길이를 모르면 끝 칸을 비워 끝까지 받는다', async ({ app }) => {
  const base = resolved();
  const r = resolved({ meta: { ...base.meta, durationSecs: null } });
  const card = await openCard(app, r);
  await expect(end(card)).toHaveValue('');
  await expect(end(card)).toHaveAttribute('placeholder', t('range.toEnd'));
  await start(card).fill('0:10:00');
  await expect(card.getByText(t('filename.willSaveAs', { name: `${r.suggestedFileName} (0.10.00~)` }))).toBeVisible();
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect(card).toBeHidden();
  const reqs = await enqReqs(app);
  expect(reqs[0].range).toEqual({ startMs: 600000, endMs: null });
  const item = app.page.getByRole('article', { name: r.meta.title });
  await expect(item.locator('.job-quality')).toHaveText(`1080p · ${rangeChip({ startMs: 600000, endMs: null })}`);
});

test('생방송 카드에는 구간 줄이 없다', async ({ app }) => {
  const r = liveResolved();
  const card = await openCard(app, r);
  await expect(card.getByText(t('card.live.body'))).toBeVisible();
  await expect(toggle(card)).toHaveCount(0);
});

test('구간을 찾지 못하면 작업 행이 알린다', async ({ app }) => {
  const r = resolved();
  const card = await openCard(app, r);
  await start(card).fill('0:10:00');
  await end(card).fill('0:20:00');
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect(card).toBeHidden();
  const e = { code: 'rangeOutOfBounds', message: 'x', stage: null, resumable: false, payload: null } as const;
  await app.ctl((c, error) => c.fail(1, error), e);
  const item = app.page.getByRole('article', { name: r.meta.title });
  await expect(item).toContainText(errorCopy(e, { place: 'job' }).title);
});
