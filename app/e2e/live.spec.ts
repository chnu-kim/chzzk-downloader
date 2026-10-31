// 생방송 녹화(ADR-0025): 주소 → 카드(생방송 배지·안내, 크기 예상 없음) → 받기 → 녹화 중(막대 없이 글자만) → [녹화 마치기] → 완료.
// 가짜 백엔드는 시간을 쓰지 않으므로 녹화 진행은 테스트가 window.__e2e로 일으킨다. 화면 글자는 e2e/copy.ts에서 가져온다.
import { liveResolved } from '../src/test/fixtures';
import { err, job } from '../src/test/jobFixtures';
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
  // 끝난 이유와 놓친 조각(앞에서 2를 보냈다)이 남는다
  await expect(item).toContainText(t('job.live.end.stopped.body'));
  await expect(item).toContainText(t('job.live.gaps', { n: 2 }));
  expect(await app.args('stop_job')).toEqual([{ id: 1 }]);
  expect(await app.cmds()).not.toContain('pause_job');
  expect(await app.cmds()).not.toContain('remove_job');
  await app.axe('녹화를 마침');
});

test('방송이 다시 시작되어 끝난 녹화는 [다시 녹화]로 그 주소를 다시 불러온다', async ({ app }) => {
  const r = liveResolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });

  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const card = page.getByRole('region', { name: r.meta.title });
  await card.getByRole('button', { name: t('card.download') }).click();
  await expect(card).toBeHidden();

  const item = page.getByRole('article', { name: r.meta.title });
  await app.ctl((c, gb) => c.liveProgress(1, 3 * gb, 3725), GB);
  await expect(item).toContainText(tRegex('job.live.running'));
  await app.ctl((c, gb) => c.complete(1, 3 * gb, { reason: 'restarted', gaps: 0 }), GB);
  await expect(item).toContainText(t('job.live.end.restarted.body'));
  await expect(item).not.toContainText(t('job.live.gaps', { n: 0 }));
  await app.axe('재시작으로 끝난 녹화');

  // [다시 녹화]: 그 주소를 다시 불러와 카드가 뜬다. 받기는 사용자가 누른다(자동으로 시작하지 않는다)
  await item.getByRole('button', { name: t('action.recordAgain') }).click();
  await expect(page.getByLabel(t('url.label'))).toHaveValue(r.url);
  const again = page.getByRole('region', { name: r.meta.title });
  await expect(again).toBeVisible();
  await expect(again.getByText(t('card.live.body'))).toBeVisible();
  expect(await app.args('enqueue')).toHaveLength(1);
});

test('방송이 끝난 뒤 멈춘 녹화는 끊김으로 보이고 [이어받기]가 받은 부분을 저장한다', async ({ app }) => {
  const r = liveResolved();
  const { page } = app;
  const j = job(1, {
    url: r.url,
    title: r.meta.title,
    kind: 'live',
    playbackKind: 'live',
    status: 'interrupted',
    partialBytes: 3 * GB,
  });
  await app.open({ jobs: [j], resolve: { [r.url]: r } });
  const item = page.getByRole('article', { name: r.meta.title });
  // 생방송에는 일시정지가 없다: "일시정지됨"이 아니라 "녹화 끊김"이다
  await expect(item).toContainText(tRegex('job.live.interruptedBytes'));
  await expect(item).not.toContainText('일시정지');
  await app.axe('끊긴 녹화');

  await item.getByRole('button', { name: t('action.resume') }).click();
  expect(await app.args('resume_job')).toEqual([{ id: 1, restart: false }]);
  await app.ctl((c, gb) => c.complete(1, 3 * gb, { reason: 'other', gaps: 0 }), GB);
  await expect(item).toContainText(t('job.live.end.other.body'));
  expect(await app.cmds()).not.toContain('pause_job');
});

test('방송 중이 아니라 실패한 녹화는 [다시 시도] 대신 [다시 녹화]를 준다', async ({ app }) => {
  const r = liveResolved();
  const { page } = app;
  const j = job(1, {
    url: r.url,
    title: r.meta.title,
    kind: 'live',
    playbackKind: 'live',
    status: 'failed',
    partialBytes: null,
    error: err('notLive'),
  });
  await app.open({ jobs: [j], resolve: { [r.url]: r } });
  const item = page.getByRole('article', { name: r.meta.title });
  await expect(item.getByRole('button', { name: t('action.recordAgain') })).toBeVisible();
  await expect(item.getByRole('button', { name: t('action.retry') })).toHaveCount(0);
  await app.axe('방송 중 아님으로 실패한 녹화');

  // 그 주소를 다시 불러와 카드의 [받기]로 새 녹화를 시작한다(옛 제목·시각 파일로 이어 쓰지 않는다)
  await item.getByRole('button', { name: t('action.recordAgain') }).click();
  await expect(page.getByLabel(t('url.label'))).toHaveValue(r.url);
  await expect(page.getByRole('region', { name: r.meta.title })).toBeVisible();
  expect(await app.cmds()).not.toContain('resume_job');
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

test('받다 만 녹화가 있는 이름이면 번호 이름으로 녹화한다', async ({ app }) => {
  const r = liveResolved();
  const { page } = app;
  const free = `${r.suggestedFileName} (2)`;
  await app.open({
    resolve: { [r.url]: r },
    outputs: { [r.suggestedFileName]: { partial: { bytes: 5, sameJob: false, recording: true }, freeFileName: free } },
  });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const card = page.getByRole('region', { name: r.meta.title });
  // 받다 만 녹화는 지우지 않고 번호 이름으로 받는다: 처음부터·이어받기 안내는 없다
  await expect(card.getByText(t('conflict.partialRecording.title'))).toBeVisible();
  await expect(card.getByText(t('conflict.partialRecording.body', { name: free }))).toBeVisible();
  await expect(card.getByRole('button', { name: t('action.restartFresh') })).toHaveCount(0);
  await app.axe('받다 만 녹화');

  await card.getByRole('button', { name: t('card.download') }).click();
  const enq = (await app.args('enqueue')) as { req: { fileName: string; restart: boolean } }[];
  expect(enq).toHaveLength(1);
  expect(enq[0].req.fileName).toBe(free);
  expect(enq[0].req.restart).toBe(false);
});
