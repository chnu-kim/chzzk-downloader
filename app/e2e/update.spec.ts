// 앱 업데이트(worker.md §11.6, Phase 3b A4): 배너 B4·확인 대화상자·설정의 [업데이트 확인].
import type { AuthStatusDto, UpdateInfoDto } from '../src/lib/bindings';
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
};
const available: UpdateInfoDto = { version: '9.9.9', current: '0.0.0-e2e', notes: null, pubDate: null };

test('배너와 [나중에], 설정의 확인', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: signedIn, update: { available, check: { result: 'upToDate' } } });
  await expect(page.getByText('새 버전 9.9.9이 있어요.')).toBeVisible();
  await app.axe('업데이트 배너');

  await page.getByRole('button', { name: '나중에' }).click();
  await expect(page.getByText('새 버전 9.9.9이 있어요.')).toHaveCount(0);

  await page.getByRole('button', { name: '설정' }).click();
  await page.getByRole('button', { name: '업데이트 확인' }).click();
  await expect(page.getByText('최신 버전이에요')).toBeVisible();
  expect(await app.cmds()).toContain('update_check');
});

test('받는 중이면 확인 뒤 설치한다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: signedIn, update: { available, running: 1 } });
  await page.getByRole('button', { name: '지금 업데이트' }).click();
  const dialog = page.getByRole('dialog', { name: '업데이트하고 다시 시작할까요?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('받는 중인 영상 1개가 일시정지되고, 다시 시작한 뒤 이어받을 수 있어요.')).toBeVisible();
  await app.axe('업데이트 확인 대화상자');

  await dialog.getByRole('button', { name: '업데이트하고 다시 시작' }).click();
  await expect(page.getByText('설치하고 다시 시작해요…')).toBeVisible();
  expect(await app.args('update_install')).toEqual([{ confirmPause: false }, { confirmPause: true }]);
});
