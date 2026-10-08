// 본인 영상 게이트(worker.md 구현 중 변경 A5-1·A5-2): 남의 영상은 카드에서 막히고, 다른 채널의 멈춘 작업은 이어받을 수 없다.
// 판정은 셸이 한다. 가짜 백엔드는 resolve 시나리오의 `ownership`과 로그인 채널로 셸을 흉내 낸다.
import type { AuthStatusDto } from '../src/lib/bindings';
import { job } from '../src/test/jobFixtures';
import { resolved } from '../src/test/fixtures';
import { expect, test } from './fixtures';

const A1 = '000000000000000000000000000000a1';
const C3 = '000000000000000000000000000000c3';

const me: AuthStatusDto = {
  state: 'signedIn',
  channelId: A1,
  channelName: '내 채널',
  reason: null,
  pending: null,
  offline: null,
  verifiedAt: 1_767_322_800,
  canReconnect: false,
};

test('남의 영상은 카드에서 막히고, 본인 영상은 받는다', async ({ app }) => {
  const own = resolved({
    url: 'https://chzzk.naver.com/video/1234567',
    ownership: 'own',
    meta: { ...resolved().meta, title: '내 방송', channelName: '내 채널', channelId: A1 },
  });
  const other = resolved({
    url: 'https://chzzk.naver.com/video/7654321',
    content: { kind: 'video', videoNo: 7654321 },
    ownership: 'notOwn',
    meta: { ...resolved().meta, title: '남의 방송', channelName: '다른 채널', channelId: C3 },
  });
  const { page } = app;
  await app.open({ auth: me, resolve: { [own.url]: own, [other.url]: other } });

  await page.getByLabel('영상 주소').fill(other.url);
  await page.getByRole('button', { name: '불러오기' }).click();
  const card = page.getByRole('region', { name: '남의 방송' });
  await expect(card).toBeVisible();
  await expect(card.getByText('내 채널의 영상만 받을 수 있어요')).toBeVisible();
  await expect(card.getByText("이 영상은 '다른 채널' 채널의 영상이에요. 로그인한 채널: '내 채널'")).toBeVisible();
  await expect(card.getByRole('button', { name: '다운로드' })).toBeDisabled();
  expect(await app.cmds()).not.toContain('enqueue');
  await app.axe('남의 영상 카드');

  await page.getByLabel('영상 주소').fill(own.url);
  await page.getByRole('button', { name: '불러오기' }).click();
  const mine = page.getByRole('region', { name: '내 방송' });
  await expect(mine).toBeVisible();
  await mine.getByRole('button', { name: '다운로드' }).click();
  await expect(mine).toBeHidden();
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByRole('article', { name: '내 방송' })).toBeVisible();
});

test('다른 채널의 멈춘 작업은 이어받을 수 없고 B1이 세지 않는다', async ({ app }) => {
  const { page } = app;
  await app.open({
    auth: me,
    jobs: [
      job(1, { status: 'interrupted', title: '내 작업', channelId: A1 }),
      job(2, { status: 'interrupted', title: '남의 작업', channelId: C3 }),
    ],
  });
  await expect(page.getByText('지난번에 받다가 멈춘 다운로드가 1개 있어요.')).toBeVisible();
  const other = page.getByRole('article', { name: '남의 작업' });
  await expect(other.getByText('다른 채널로 로그인해 이어받을 수 없어요')).toBeVisible();
  await expect(other.getByRole('button', { name: '이어받기' })).toHaveCount(0);
  await app.axe('다른 채널 작업');

  await page.getByRole('button', { name: '모두 이어받기' }).click();
  await expect.poll(async () => (await app.args('resume_job')).length).toBe(1);
  expect(await app.args('resume_job')).toEqual([{ id: 1, restart: false }]);
});
