// 본인 영상 게이트(worker.md 구현 중 변경 82·83): 남의 영상은 카드에서 막히고, 다른 채널의 멈춘 작업은 이어받을 수 없다.
// 판정은 셸이 한다. 가짜 백엔드는 resolve 시나리오의 `ownership`과 로그인 채널로 셸을 흉내 낸다.
import type { AuthStatusDto } from '../src/lib/bindings';
import { err, job } from '../src/test/jobFixtures';
import { resolved } from '../src/test/fixtures';
import { errorCopy, t } from './copy';
import { expect, test } from './fixtures';

const A1 = '000000000000000000000000000000a1';
const C3 = '000000000000000000000000000000c3';

const notOwn = (channelName: string) =>
  errorCopy({ code: 'notOwnContent', message: '', stage: null, resumable: false, payload: null }, { place: 'resolve', channelName, myChannel: '내 채널' });

const me: AuthStatusDto = {
  state: 'signedIn',
  channelId: A1,
  channelName: '내 채널',
  reason: null,
  pending: null,
  offline: null,
  verifiedAt: 1_767_322_800,
  canReconnect: false,
  isAdmin: false,
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

  await page.getByLabel(t('url.label')).fill(other.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const card = page.getByRole('region', { name: '남의 방송' });
  await expect(card).toBeVisible();
  const why = notOwn('다른 채널');
  await expect(card.getByText(why.title)).toBeVisible();
  await expect(card.getByText(why.body as string)).toBeVisible();
  // 못 받는 이유가 있으면 [받기]는 aria-disabled이고 그 문장이 설명이다
  const download = card.getByRole('button', { name: t('card.download') });
  await expect(download).toHaveAttribute('aria-disabled', 'true');
  await expect(download).toHaveAccessibleDescription(`${why.title} ${why.body}`);
  await download.click({ force: true });
  expect(await app.cmds()).not.toContain('enqueue');
  await app.axe('남의 영상 카드');

  await page.getByLabel(t('url.label')).fill(own.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const mine = page.getByRole('region', { name: '내 방송' });
  await expect(mine).toBeVisible();
  await mine.getByRole('button', { name: t('card.download') }).click();
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
  await expect(page.getByText(t('banner.interrupted', { n: 1 }))).toBeVisible();
  const other = page.getByRole('article', { name: '남의 작업' });
  await expect(other.getByText(t('job.otherChannel.body'))).toBeVisible();
  await expect(other.getByRole('button', { name: t('action.resume') })).toHaveCount(0);
  await app.axe('다른 채널 작업');

  await page.getByRole('button', { name: t('banner.resumeAll') }).click();
  await expect.poll(async () => (await app.args('resume_job')).length).toBe(1);
  expect(await app.args('resume_job')).toEqual([{ id: 1, restart: false }]);
});

test('실패한 다른 채널 작업은 다시 시도 안내 없이 막힌 이유만 보이고, 항목 설명으로 읽힌다', async ({ app }) => {
  const { page } = app;
  await app.open({
    auth: me,
    jobs: [job(3, { status: 'failed', title: '남의 실패', channelId: C3, error: err('network', { resumable: true }), partialBytes: 1024 })],
  });
  const item = page.getByRole('article', { name: '남의 실패' });
  const netCopy = errorCopy(err('network', { resumable: true }), { place: 'job', partialBytes: 1024, cookiesEnabled: false });
  await expect(item.getByText(netCopy.title)).toBeVisible();
  await expect(item.getByText(netCopy.body as string, { exact: false })).toHaveCount(0);
  await expect(item).toHaveAccessibleDescription(t('job.otherChannel.body'));
  await expect(item.getByRole('button', { name: t('action.retry') })).toHaveCount(0);
  await app.axe('실패한 다른 채널 작업');
});

test('관리자는 남의 영상을 안내와 함께 받고, 다른 채널의 멈춘 작업도 이어받는다', async ({ app }) => {
  const other = resolved({
    url: 'https://chzzk.naver.com/video/7654321',
    content: { kind: 'video', videoNo: 7654321 },
    ownership: 'adminOverride',
    meta: { ...resolved().meta, title: '남의 방송', channelName: '다른 채널', channelId: C3 },
  });
  const { page } = app;
  await app.open({
    auth: { ...me, isAdmin: true },
    resolve: { [other.url]: other },
    jobs: [job(2, { status: 'interrupted', title: '남의 작업', channelId: C3 })],
  });

  // 막힌 작업이 아니라서 이어받기 버튼이 보이고 B1도 센다
  const stopped = page.getByRole('article', { name: '남의 작업' });
  await expect(stopped.getByRole('button', { name: t('action.resume') })).toBeVisible();
  await expect(stopped.getByText(t('job.otherChannel.body'))).toHaveCount(0);

  await page.getByLabel(t('url.label')).fill(other.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const card = page.getByRole('region', { name: '남의 방송' });
  await expect(card).toBeVisible();
  await expect(card.getByText(t('receive.admin.otherChannel.title'))).toBeVisible();
  await expect(card.getByText(t('receive.admin.otherChannel.body'))).toBeVisible();
  const download = card.getByRole('button', { name: t('card.download') });
  await expect(download).not.toHaveAttribute('aria-disabled', 'true');
  await app.axe('관리자 남의 영상 카드');
  await download.click();
  await expect.poll(async () => (await app.cmds()).includes('enqueue')).toBe(true);
});
