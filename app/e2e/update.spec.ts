// 앱 업데이트(worker.md §11.6, Phase 3b A4): 배너 B4·확인 대화상자·설정의 [업데이트 확인].
import type { AuthStatusDto, UpdateInfoDto } from '../src/lib/bindings';
import { t } from './copy';
import { expect, test } from './fixtures';

const signedIn: AuthStatusDto = {
  state: 'signedIn',
  channelId: null,
  channelName: '테스트 채널',
  reason: null,
  pending: null,
  offline: null,
  verifiedAt: 1_767_322_800,
  canReconnect: false,
  isAdmin: false,
  delegatedChannels: [],
  delegationsCheckedAt: null,
};
const available: UpdateInfoDto = { version: '9.9.9', current: '0.0.0-e2e', notes: null, pubDate: null };

test('배너와 [×], 설정의 확인', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: signedIn, update: { available, check: { result: 'upToDate' } } });
  const banner = page.getByRole('region', { name: t('update.banner', { version: available.version }) });
  await expect(banner).toBeVisible();
  await app.axe('업데이트 배너');

  // 나중에는 글자 버튼이 아니라 배너의 [×]다
  await banner.getByRole('button', { name: t('common.close') }).click();
  await expect(banner).toHaveCount(0);

  await page.getByRole('button', { name: t('header.settings') }).click();
  await page.getByRole('button', { name: t('settings.about.checkUpdate') }).click();
  await expect(page.getByText(t('settings.about.upToDate'))).toBeVisible();
  expect(await app.cmds()).toContain('update_check');
});

const withNotes: UpdateInfoDto = { ...available, notes: '구간을 고르는 화면이 빨라졌어요\n받기가 멈추면 바로 알려 줘요\n<b>글자</b> 그대로 보여요' };

test('바뀐 점이 있으면 배너에서 접어 두었다가 펼쳐 읽고, 이어서 설치한다(D69)', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: signedIn, update: { available: withNotes } });
  const banner = page.getByRole('region', { name: t('update.banner', { version: withNotes.version }) });
  const summary = banner.getByText(t('update.notes.title'));
  await expect(summary).toBeVisible();
  // 기본은 접힘이라 항목이 보이지 않는다
  await expect(banner.getByRole('listitem')).toHaveCount(0);
  await summary.click();
  await expect(banner.getByRole('listitem')).toHaveCount(3);
  // HTML은 해석하지 않고 글자 그대로 보인다
  await expect(banner.getByRole('listitem').nth(2)).toHaveText('<b>글자</b> 그대로 보여요');
  await app.axe('업데이트 바뀐 점 펼침');
  // 기존 흐름: [지금 업데이트]로 바로 설치한다
  await banner.getByRole('button', { name: t('update.install') }).click();
  await expect(page.getByText(t('update.installing'))).toBeVisible();
});

test('바뀐 점이 없으면 접는 줄이 없다(D69)', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: signedIn, update: { available } });
  const banner = page.getByRole('region', { name: t('update.banner', { version: available.version }) });
  await expect(banner).toBeVisible();
  await expect(banner.getByText(t('update.notes.title'))).toHaveCount(0);
});

test('받는 중이면 확인(D5) 뒤 설치한다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: signedIn, update: { available, running: 1 } });
  await page.getByRole('button', { name: t('update.install') }).click();
  const dialog = page.getByRole('dialog', { name: t('dialog.update.title') });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(t('dialog.update.body', { n: 1 }))).toBeVisible();
  // 안전한 쪽([나중에])이 오른쪽 끝·첫 포커스다
  await expect(dialog.getByRole('button', { name: t('common.later') })).toBeFocused();
  await app.axe('업데이트 확인 대화상자');

  await dialog.getByRole('button', { name: t('dialog.update.confirm') }).click();
  await expect(page.getByText(t('update.installing'))).toBeVisible();
  expect(await app.args('update_install')).toEqual([{ confirmPause: false }, { confirmPause: true }]);
});

test('설치에 실패하면 토스트가 아니라 배너로 알리고, [다시 시도]가 있다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: signedIn, update: { available, install: 'failed' } });
  await page.getByRole('button', { name: t('update.install') }).click();
  const banner = page.getByRole('region', { name: t('update.failed') });
  await expect(banner).toBeVisible();
  await expect(page.locator('.notice-toast')).toHaveCount(0);
  await expect(banner.getByRole('button', { name: t('action.retry') })).toBeVisible();
  await app.axe('업데이트 실패 배너');
});
