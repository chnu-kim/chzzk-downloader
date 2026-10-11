// 받기 흐름(docs/design/cicd.md §6 "웹 E2E"): URL → 영상 카드 → 목록에 넣기 → 진행 → 일시정지 → 이어받기 → 완료 → 지우기(되돌리기 창) → 확정.
// 가짜 백엔드는 시간을 쓰지 않으므로 상태 변화는 테스트가 window.__e2e로 하나씩 일으킨다.
// 화면 글자는 모두 e2e/copy.ts(copy deck)에서 가져온다: 리터럴은 고정 데이터의 제목뿐이다.
import { resolved } from '../src/test/fixtures';
import { t, tRegex } from './copy';
import { expect, test } from './fixtures';

const GB = 1024 ** 3;

test('주소를 불러와 받고, 멈췄다 이어받아 끝까지 받는다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });
  await expect(page.getByText(t('list.empty.title'))).toBeVisible();
  await app.axe('빈 홈');

  // 불러오기 → 카드
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const card = page.getByRole('region', { name: r.meta.title });
  await expect(card).toBeVisible();
  await expect(card.getByText(t('kind.liveRewind'))).toBeVisible();
  await expect(card.getByRole('radio', { name: /1080p/ })).toBeChecked();
  await expect(card.getByLabel(t('filename.label'))).toHaveValue(r.suggestedFileName);
  // 소유 확인이 끝나 [받기]가 활성(aria-disabled 없음)으로 바뀐 뒤에 본다: 전환 중 색 대비를 피한다
  await expect(card.getByRole('button', { name: t('card.download') })).not.toHaveAttribute('aria-disabled', 'true');
  await app.axe('영상 카드');

  // 720p를 골라 받는다
  // 라디오 입력은 .sr-only라 보이는 대상(label.choice)을 누른다
  await card.locator('label.choice').filter({ hasText: /720p/ }).click();
  await card.getByRole('button', { name: t('card.download') }).click();
  await expect(card).toBeHidden();
  const enq = await app.args('enqueue');
  expect(enq).toEqual([
    {
      req: {
        url: r.url,
        content: r.content,
        title: r.meta.title,
        channelName: r.meta.channelName,
        channelId: r.meta.channelId,
        qualityId: 'q720',
        qualityLabel: '720p',
        expectedKind: 'liveRewindHls',
        folder: null,
        fileName: r.suggestedFileName,
        onExisting: 'skip',
        restart: false,
        // 최근 영상 둘째 줄의 날짜: 방송 시작 시각이 있으면 그것(meta.liveOpenDate ?? meta.publishDate)
        contentDate: r.meta.liveOpenDate,
      },
    },
  ]);
  const item = page.getByRole('article', { name: r.meta.title });
  await expect(item).toBeVisible();
  await expect(item).toContainText(t('job.queuedNext'));

  // 진행
  await app.ctl((c, gb) => c.progress(1, 1 * gb, 4 * gb), GB);
  await expect(item).toContainText(t('job.phase.downloading'));
  await expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await app.axe('받는 중');

  // 일시정지 → 이어받기
  await item.getByRole('button', { name: t('action.pause') }).click();
  await expect(item).toContainText(t('job.status.paused'));
  await item.getByRole('button', { name: t('action.resume') }).click();
  await expect(item).toContainText(t('job.queuedNext'));
  const acts = await app.ctl((c) => c.calls.filter((x) => ['pause_job', 'resume_job'].includes(x.cmd)), null);
  expect(acts).toEqual([
    { cmd: 'pause_job', args: { id: 1 } },
    { cmd: 'resume_job', args: { id: 1, restart: false } },
  ]);

  // 끝까지 → 홈에서는 완료 토스트 없이 행 상태만 → 완료 항목 지우기
  await app.ctl((c, gb) => c.progress(1, 3 * gb, 4 * gb), GB);
  await app.ctl((c, gb) => c.complete(1, 4 * gb), GB);
  await expect(item).toContainText(tRegex('job.completed'));
  await expect(page.getByText(t('toast.completed', { title: r.meta.title }))).toHaveCount(0);
  await app.axe('완료');

  // [완료 항목 지우기]는 숨기고 되돌리기 토스트를 준다. 지금 지우지 않는다(clear_finished도 부르지 않는다)
  await page.getByRole('button', { name: t('list.clearFinished') }).click();
  await expect(item).toBeHidden();
  const toast = page.locator('.notice-toast');
  await expect(toast).toContainText(t('toast.removedMany', { n: 1 }));
  await expect(toast.getByRole('button', { name: t('action.undo') })).toBeVisible();
  expect(await app.args('remove_job')).toEqual([]);
  await expect(page.getByText(t('list.empty.title'))).toBeVisible();

  // 토스트를 [×]로 닫으면 숨긴 id마다 remove_job으로 확정한다
  await toast.getByRole('button', { name: t('common.close') }).click();
  await expect.poll(() => app.args('remove_job')).toEqual([{ id: 1 }]);
  expect(await app.cmds()).not.toContain('clear_finished');
});

test('지운 항목은 [되돌리기]로 돌아오고 그때는 remove_job을 부르지 않는다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  await page.getByRole('button', { name: t('card.download') }).click();
  await app.ctl((c, gb) => c.complete(1, 4 * gb), GB);
  const item = page.getByRole('article', { name: r.meta.title });
  await expect(item).toContainText(tRegex('job.completed'));

  await page.getByRole('button', { name: t('list.clearFinished') }).click();
  await expect(item).toBeHidden();
  await page.locator('.notice-toast').getByRole('button', { name: t('action.undo') }).click();
  await expect(item).toBeVisible();
  await expect(page.locator('.notice-toast')).toHaveCount(0);
  expect(await app.args('remove_job')).toEqual([]);
});

test('받는 중인 작업을 취소하면 확인(D2)을 거쳐 목록에서 지운다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  await page.getByRole('button', { name: t('card.download') }).click();
  await app.ctl((c, gb) => c.progress(1, 1 * gb, 4 * gb), GB);
  const item = page.getByRole('article', { name: r.meta.title });
  // 받은 부분(.part)이 있으면 크기와 무관하게 danger [취소]가 확인을 연다
  await item.getByRole('button', { name: t('a11y.cancelJob', { title: r.meta.title }), exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t('dialog.cancel.title', { title: r.meta.title }) });
  await expect(dialog).toBeVisible();
  // 받는 중이라 안전한 쪽([계속 받기])이 오른쪽 끝·첫 포커스다
  await expect(dialog.getByRole('button', { name: t('dialog.cancel.keepRunning') })).toBeFocused();
  await app.axe('취소 확인');
  await dialog.getByRole('button', { name: t('dialog.cancel.confirm') }).click();
  await expect(item).toBeHidden();
  expect(await app.args('remove_job')).toEqual([{ id: 1 }]);
});

test('받은 바이트가 없는 작업은 확인 없이 바로 취소한다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  await page.getByRole('button', { name: t('card.download') }).click();
  const item = page.getByRole('article', { name: r.meta.title });
  await item.getByRole('button', { name: t('a11y.cancelJob', { title: r.meta.title }), exact: true }).click();
  await expect(item).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await app.args('remove_job')).toEqual([{ id: 1 }]);
});

test('같은 이름의 파일이 있으면 번호를 붙이거나, 덮어쓰기는 확인(D7)을 거친다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({
    resolve: { [r.url]: r },
    outputs: { [r.suggestedFileName]: { exists: true, freeFileName: `${r.suggestedFileName} (1)` } },
  });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const card = page.getByRole('region', { name: r.meta.title });
  await expect(card.getByText(t('conflict.exists'))).toBeVisible();
  // 경고는 알림(role=alert)이 아니다
  await expect(card.getByRole('alert').filter({ hasText: t('conflict.exists') })).toHaveCount(0);
  await expect(card.getByRole('radio', { name: t('conflict.number') })).toBeChecked();
  await app.axe('같은 이름 경고');

  // 덮어쓰기를 고르고 [받기] → 확인. [그대로 두기]는 아무것도 하지 않는다
  await card.locator('label.choice').filter({ hasText: t('conflict.overwrite') }).click();
  await card.getByRole('button', { name: t('card.download') }).click();
  const dialog = page.getByRole('dialog', { name: t('dialog.overwrite.title', { name: `${r.suggestedFileName}.mp4` }) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: t('dialog.cancel.keepPaused') })).toBeFocused();
  await app.axe('덮어쓰기 확인');
  await dialog.getByRole('button', { name: t('dialog.cancel.keepPaused') }).click();
  await expect(dialog).toBeHidden();
  expect(await app.args('enqueue')).toEqual([]);

  await card.getByRole('button', { name: t('card.download') }).click();
  await dialog.getByRole('button', { name: t('dialog.overwrite.confirm') }).click();
  await expect(card).toBeHidden();
  const enq = (await app.args('enqueue')) as { req: { onExisting: string } }[];
  expect(enq.map((e) => e.req.onExisting)).toEqual(['overwrite']);
});

test('설정에 있는 동안 끝난 작업은 완료 토스트로 알린다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  await page.getByRole('button', { name: t('card.download') }).click();
  await page.getByRole('button', { name: t('header.settings') }).click();
  await app.ctl((c, gb) => c.complete(1, 4 * gb), GB);
  await expect(page.getByText(t('toast.completed', { title: r.meta.title }))).toBeVisible();
});
