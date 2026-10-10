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
