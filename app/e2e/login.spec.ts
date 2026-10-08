// 로그인 화면과 AuthGate(worker.md 구현 중 변경 62): 잠긴 동안 로그인 화면만 보이고, 풀리면 홈이 열린다.
import type { AuthStatusDto } from '../src/lib/bindings';
import { expect, test } from './fixtures';

const EMPTY = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null, canReconnect: false } as const;
const auth = (over: Partial<AuthStatusDto> & Pick<AuthStatusDto, 'state'>): AuthStatusDto => ({ ...EMPTY, ...over });

test('로그인 전에는 로그인 화면만 보이고 게이트 뒤 command를 부르지 않는다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'signedOut' }) });
  await expect(page.getByRole('heading', { name: '로그인이 필요해요' })).toBeVisible();
  await expect(page.getByRole('button', { name: '치지직으로 로그인' })).toBeVisible();
  await expect(page.getByLabel('영상 주소')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '설정' })).toHaveCount(0);
  const cmds = await app.cmds();
  for (const gated of ['get_settings', 'clipboard_link', 'import_legacy', 'update_available', 'update_check']) expect(cmds).not.toContain(gated);
  await app.axe('로그인 화면');
});

test('로그인하면 확인 코드를 보이고, 끝나면 홈으로 간다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'signedOut' }) });
  await page.getByRole('button', { name: '치지직으로 로그인' }).click();
  await expect(page.getByText('K7QX-4MRA')).toBeVisible();
  await expect(page.getByText(/남은 시간 (10:00|9:\d\d)/)).toBeVisible();
  await page.getByRole('button', { name: '로그인 주소 복사' }).click();
  await expect(page.getByText('복사했어요')).toBeVisible();
  expect(await app.cmds()).toContain('auth_copy_login_url');
  await app.axe('로그인 대기');

  await app.ctl((c, s) => c.setAuth(s), auth({ state: 'signedIn', channelName: '테스트 채널', verifiedAt: 1_767_322_800 }));
  await expect(page.getByLabel('영상 주소')).toBeVisible();
  await expect(page.getByText('테스트 채널')).toBeVisible();
  const cmds = await app.cmds();
  expect(cmds.indexOf('get_settings')).toBeGreaterThan(cmds.indexOf('auth_login'));
});

test('거부·유예 만료 화면과 다시 연결', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'denied', channelName: '테스트 채널' }) });
  await expect(page.getByRole('heading', { name: '사용 허가가 없는 채널이에요' })).toBeVisible();
  await expect(page.getByText(/채널: 테스트 채널\./)).toBeVisible();
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await expect(page.getByText(/네이버 로그아웃 후/)).toBeVisible();
  await expect(page.getByRole('button', { name: '다른 계정으로 로그인' })).toBeVisible();
  await app.axe('로그인 거부');

  await app.ctl((c, s) => c.setAuth(s), auth({ state: 'expired', reason: 'graceExpired' }));
  await expect(page.getByRole('heading', { name: '로그인 서버에 한동안 연결하지 못했어요' })).toBeVisible();
  await page.getByRole('button', { name: '다시 연결' }).click();
  expect(await app.cmds()).toContain('auth_retry');
  await expect(page.getByText(/아직 연결되지 않았어요/)).toBeVisible();
});

test('저장 세션이 있으면 로그인을 취소해도 유예 만료 화면으로 돌아가고, [다시 연결]은 확인 중을 거친다', async ({ app }) => {
  const { page } = app;
  const grace = auth({ state: 'expired', reason: 'graceExpired' });
  await app.open({
    auth: auth({ state: 'pending', pending: { userCode: 'K7QX-4MRA', expiresAt: Math.floor(Date.now() / 1000) + 600 } }),
    authHeld: grace,
  });
  await page.getByRole('button', { name: '취소' }).click();
  await expect(page.getByRole('heading', { name: '로그인 서버에 한동안 연결하지 못했어요' })).toBeVisible();
  await page.getByRole('button', { name: '다시 연결' }).click();
  await expect(page.getByText(/아직 연결되지 않았어요/)).toBeVisible();
  expect(await page.evaluate(() => window.__e2e.authEvents)).toEqual(['expired', 'checking', 'expired']);
});

test('오프라인 배지와 로그아웃', async ({ app }) => {
  const { page } = app;
  await app.open({
    auth: auth({
      state: 'signedIn',
      channelName: '테스트 채널',
      verifiedAt: 1_767_322_800,
      offline: { since: 1_767_322_800, graceUntil: 1_767_582_000 },
    }),
  });
  await expect(page.getByText(/^오프라인 · 1월 5일 오후 12:00까지 사용 가능$/)).toBeVisible();
  await page.getByRole('button', { name: '계정 메뉴' }).click();
  await expect(page.getByRole('menuitem', { name: '다시 연결' })).toBeVisible();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
  const dialog = page.getByRole('dialog', { name: '로그아웃할까요?' });
  await expect(dialog).toBeVisible();
  await app.axe('로그아웃 확인');
  await dialog.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByRole('heading', { name: '로그인이 필요해요' })).toBeVisible();
  expect(await app.cmds()).toContain('auth_logout');
});
