// 생방송 녹화(ADR-0025): 주소 → 카드(생방송 배지·안내, 크기 예상 없음) → 받기 → 녹화 중(막대 없이 글자만) → [녹화 마치기] → 완료.
// 가짜 백엔드는 시간을 쓰지 않으므로 녹화 진행은 테스트가 window.__e2e로 일으킨다. 화면 글자는 e2e/copy.ts에서 가져온다.
import { liveResolved } from '../src/test/fixtures';
import { errorCopy, t, tRegex } from './copy';
import { expect, test } from './fixtures';

const GB = 1024 ** 3;

test('생방송 주소를 불러와 녹화하고 [녹화 마치기]로 마친다', async ({ app }) => {
  const r = liveResolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });

  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const card = page.getByRole('region', { name: r.meta.title });
  await expect(card).toBeVisible();
  await expect(card.locator('.badge').filter({ hasText: t('kind.live') })).toBeVisible();
  // 방송 중 안내: 받기를 누르면 녹화가 시작되고 방송이 끝나거나 [녹화 마치기]를 누를 때까지 받는다
  await expect(card.getByText(t('card.live.body'))).toBeVisible();
  await expect(card.getByRole('button', { name: t('card.download') })).not.toHaveAttribute('aria-disabled', 'true');
  await app.axe('생방송 카드');

  await card.getByRole('button', { name: t('card.download') }).click();
  await expect(card).toBeHidden();
  const enq = (await app.args('enqueue')) as { req: { content: unknown; expectedKind: string } }[];
  expect(enq).toHaveLength(1);
  expect(enq[0].req.content).toEqual(r.content);
  expect(enq[0].req.expectedKind).toBe('live');

  // 녹화 중: 막대·퍼센트·남은 시간 없이 상태 줄 글자만. 일시정지는 없고 [녹화 마치기]가 있다
  const item = page.getByRole('article', { name: r.meta.title });
  await app.ctl((c, gb) => c.liveProgress(1, 3 * gb, 3725), GB);
  await expect(item).toContainText(tRegex('job.live.running'));
  await expect(item.locator('.badge').filter({ hasText: t('kind.live') })).toBeVisible();
  await expect(item.getByRole('progressbar')).toHaveCount(0);
  await expect(item.getByRole('button', { name: t('action.pause') })).toHaveCount(0);
  await app.axe('녹화 중');

  // 놓친 조각이 생기면 상태 줄 끝에 알린다
  await app.ctl((c, gb) => c.liveProgress(1, 3 * gb, 3730, 2), GB);
  await expect(item).toContainText(t('job.live.gaps', { n: 2 }));

  // [녹화 마치기]: 취소가 아니라 stop_job → 완료(받은 만큼 저장)
  await item.getByRole('button', { name: t('action.stopRecording') }).click();
  await expect(item).toContainText(tRegex('job.completed'));
  expect(await app.args('stop_job')).toEqual([{ id: 1 }]);
  expect(await app.cmds()).not.toContain('pause_job');
  expect(await app.cmds()).not.toContain('remove_job');
  await app.axe('녹화를 마침');
});

test('녹화 중인 작업을 취소하면 녹화한 부분이 지워진다고 묻는다', async ({ app }) => {
  const r = liveResolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  await page.getByRole('button', { name: t('card.download') }).click();
  await app.ctl((c, gb) => c.liveProgress(1, 1 * gb, 600), GB);
  const item = page.getByRole('article', { name: r.meta.title });
  await item.getByRole('button', { name: t('a11y.cancelJob', { title: r.meta.title }), exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t('dialog.cancel.title', { title: r.meta.title }) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(tRegex('dialog.cancel.live.body'))).toBeVisible();
  await dialog.getByRole('button', { name: t('dialog.cancel.keepRunning') }).click();
  await expect(dialog).toBeHidden();
  expect(await app.cmds()).not.toContain('remove_job');
});

test('방송 중이 아니면 안내하고 다시 시도할 수 있다', async ({ app }) => {
  const r = liveResolved();
  const { page } = app;
  const error = { code: 'notLive', message: 'x', stage: null, resumable: true, payload: null } as const;
  await app.open({ resolve: { [r.url]: { error } } });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  await expect(page.getByText(errorCopy(error, { place: 'resolve' }).title)).toBeVisible();
  await app.axe('방송 중 아님');
});
