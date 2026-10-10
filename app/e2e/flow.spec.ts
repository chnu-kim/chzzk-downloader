// 받기 흐름(docs/design/cicd.md §6 "웹 E2E"): URL → 영상 카드 → 목록에 넣기 → 진행 → 일시정지 → 이어받기 → 완료 → 지우기.
// 가짜 백엔드는 시간을 쓰지 않으므로 상태 변화는 테스트가 window.__e2e로 하나씩 일으킨다.
import { resolved } from '../src/test/fixtures';
import { expect, test } from './fixtures';

const GB = 1024 ** 3;

test('주소를 불러와 받고, 멈췄다 이어받아 끝까지 받는다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });
  await expect(page.getByText('아직 받은 영상이 없어요')).toBeVisible();
  await app.axe('빈 홈');

  // 불러오기 → 카드
  await page.getByLabel('영상 주소').fill(r.url);
  await page.getByRole('button', { name: '불러오기' }).click();
  const card = page.getByRole('region', { name: r.meta.title });
  await expect(card).toBeVisible();
  await expect(card.getByText('빠른 다시보기')).toBeVisible();
  await expect(card.getByRole('radio', { name: /1080p/ })).toBeChecked();
  await expect(card.getByLabel('파일 이름')).toHaveValue(r.suggestedFileName);
  // 소유 확인이 끝나 [다운로드]가 활성(aria-disabled 없음)으로 바뀐 뒤에 본다: 전환 중 색 대비를 피한다
  await expect(card.getByRole('button', { name: '다운로드' })).not.toHaveAttribute('aria-disabled', 'true');
  await app.axe('영상 카드');

  // 720p를 골라 받는다
  // 라디오 입력은 .sr-only라 보이는 대상(label.choice)을 누른다
  await card.locator('label.choice').filter({ hasText: /720p/ }).click();
  await card.getByRole('button', { name: '다운로드' }).click();
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
      },
    },
  ]);
  const item = page.getByRole('article', { name: r.meta.title });
  await expect(item).toBeVisible();
  await expect(item).toContainText('대기 중');

  // 진행
  await app.ctl((c, gb) => c.progress(1, 1 * gb, 4 * gb), GB);
  await expect(item).toContainText('받는 중');
  await expect(item.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await app.axe('받는 중');

  // 일시정지 → 이어받기
  await item.getByRole('button', { name: '일시정지' }).click();
  await expect(item).toContainText('일시정지됨');
  await item.getByRole('button', { name: '이어받기' }).click();
  await expect(item).toContainText('대기 중');
  const acts = await app.ctl((c) => c.calls.filter((x) => ['pause_job', 'resume_job'].includes(x.cmd)), null);
  expect(acts).toEqual([
    { cmd: 'pause_job', args: { id: 1 } },
    { cmd: 'resume_job', args: { id: 1, restart: false } },
  ]);

  // 끝까지 → 완료 알림 → 완료 항목 지우기
  await app.ctl((c, gb) => c.progress(1, 3 * gb, 4 * gb), GB);
  await app.ctl((c, gb) => c.complete(1, 4 * gb), GB);
  await expect(item).toContainText('완료');
  await expect(page.getByText(`'${r.meta.title}' 다운로드를 마쳤어요`)).toBeVisible();
  await app.axe('완료');
  await page.getByRole('button', { name: '완료 항목 지우기' }).click();
  await expect(item).toBeHidden();
  await expect(page.getByText('아직 받은 영상이 없어요')).toBeVisible();
  expect(await app.cmds()).toContain('clear_finished');
});

test('받는 중인 작업을 취소하면 확인을 거쳐 목록에서 지운다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: r } });
  await page.getByLabel('영상 주소').fill(r.url);
  await page.getByRole('button', { name: '불러오기' }).click();
  await page.getByRole('button', { name: '다운로드' }).click();
  await app.ctl((c, gb) => c.progress(1, 1 * gb, 4 * gb), GB);
  const item = page.getByRole('article', { name: r.meta.title });
  await item.getByRole('button', { name: `취소: ${r.meta.title}` }).click();
  const dialog = page.getByRole('dialog', { name: '다운로드를 취소할까요?' });
  await expect(dialog).toBeVisible();
  await app.axe('취소 확인');
  await dialog.getByRole('button', { name: '취소하고 지우기' }).click();
  await expect(item).toBeHidden();
  expect(await app.args('remove_job')).toEqual([{ id: 1 }]);
});
