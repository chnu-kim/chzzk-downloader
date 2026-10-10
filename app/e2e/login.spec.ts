// 로그인 화면과 AuthGate(worker.md 구현 중 변경 62): 잠긴 동안 로그인 화면만 보이고, 풀리면 홈이 열린다.
import type { AuthStatusDto } from '../src/lib/bindings';
import { channelRow, t, tRegex, whenText } from './copy';
import { expect, test } from './fixtures';

/** playwright.config의 timezoneId(Asia/Seoul)와 같은 UTC 오프셋(분) */
const KST_OFFSET_MIN = 540;

const EMPTY = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null, canReconnect: false, isAdmin: false } as const;
const auth = (over: Partial<AuthStatusDto> & Pick<AuthStatusDto, 'state'>): AuthStatusDto => ({ ...EMPTY, ...over });

test('로그인 전에는 로그인 화면만 보이고 게이트 뒤 command를 부르지 않는다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'signedOut' }) });
  await expect(page.getByRole('heading', { name: t('auth.signedOut.title') })).toBeVisible();
  await expect(page.getByRole('button', { name: t('auth.login') })).toBeVisible();
  await expect(page.getByLabel(t('url.label'))).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('header.settings') })).toHaveCount(0);
  const cmds = await app.cmds();
  for (const gated of ['get_settings', 'clipboard_link', 'import_legacy', 'update_available', 'update_check']) expect(cmds).not.toContain(gated);
  await app.axe('로그인 화면');
});

test('로그인하면 브라우저 안내와 남은 시간을 보이고, 끝나면 홈으로 간다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'signedOut' }) });
  await page.getByRole('button', { name: t('auth.login') }).click();
  await expect(page.getByText(/[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}/)).toHaveCount(0);
  await expect(page.getByText(t('auth.pending.sameDevice'))).toBeVisible();
  await expect(page.getByText(t('auth.pending.stuck'))).toHaveCount(0);
  await expect(page.getByText(tRegex('auth.pending.remaining'))).toContainText(/(10:00|9:\d\d)/);
  await page.getByRole('button', { name: t('auth.copyLoginUrl') }).click();
  await expect(page.getByText(t('action.copied'))).toBeVisible();
  expect(await app.cmds()).toContain('auth_copy_login_url');
  await app.axe('로그인 대기');

  await app.ctl((c, s) => c.setAuth(s), auth({ state: 'signedIn', channelName: '테스트 채널', verifiedAt: 1_767_322_800 }));
  await expect(page.getByLabel(t('url.label'))).toBeVisible();
  // 계정 메뉴 트리거는 채널 이름이고, 로그인 성공은 토스트 한 번으로 알린다
  await expect(page.getByRole('button', { name: '테스트 채널' })).toBeVisible();
  await expect(page.getByText(t('toast.signedIn', { channelName: '테스트 채널' }))).toBeVisible();
  const cmds = await app.cmds();
  expect(cmds.indexOf('get_settings')).toBeGreaterThan(cmds.indexOf('auth_login'));
});

test('거부·유예 만료 화면과 다시 연결', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'denied', channelName: '테스트 채널' }) });
  await expect(page.getByRole('heading', { name: t('auth.denied.title') })).toBeVisible();
  await expect(page.getByText(t('auth.denied.body'))).toBeVisible();
  await expect(page.getByText(channelRow('테스트 채널') ?? '')).toBeVisible();
  await expect(page.getByRole('button', { name: t('action.retry') })).toBeVisible();
  await expect(page.getByText(t('auth.otherAccount.help'))).toBeVisible();
  await expect(page.getByRole('button', { name: t('auth.otherAccount') })).toBeVisible();
  await app.axe('로그인 거부');

  await app.ctl((c, s) => c.setAuth(s), auth({ state: 'expired', reason: 'graceExpired' }));
  await expect(page.getByRole('heading', { name: t('auth.graceExpired.title') })).toBeVisible();
  await page.getByRole('button', { name: t('auth.reconnect') }).click();
  expect(await app.cmds()).toContain('auth_retry');
  await expect(page.getByText(t('auth.reconnectFailed'))).toBeVisible();
});

test('저장 세션이 있으면 로그인을 취소해도 유예 만료 화면으로 돌아가고, [다시 연결]은 확인 중을 거친다', async ({ app }) => {
  const { page } = app;
  const grace = auth({ state: 'expired', reason: 'graceExpired' });
  await app.open({
    auth: auth({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }),
    authHeld: grace,
  });
  await page.getByRole('button', { name: t('common.cancel') }).click();
  await expect(page.getByRole('heading', { name: t('auth.graceExpired.title') })).toBeVisible();
  await page.getByRole('button', { name: t('auth.reconnect') }).click();
  await expect(page.getByText(t('auth.reconnectFailed'))).toBeVisible();
  expect(await page.evaluate(() => window.__e2e.authEvents)).toEqual(['expired', 'checking', 'expired']);
});

test('대기 90초가 지나면 연결 오류 안내와 [다시 로그인]이 보이고, 누르면 취소 뒤 새로 시작한다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 500 } }) });
  await expect(page.getByText(t('auth.pending.stuck'))).toBeVisible();
  await app.axe('로그인 대기 지연');
  await page.getByRole('button', { name: t('auth.relogin') }).click();
  await expect(page.getByText(t('auth.pending.stuck'))).toHaveCount(0);
  const cmds = await app.cmds();
  expect(cmds.lastIndexOf('auth_cancel')).toBeGreaterThanOrEqual(0);
  expect(cmds.lastIndexOf('auth_cancel')).toBeLessThan(cmds.lastIndexOf('auth_login'));
  await expect(page.getByRole('heading', { name: t('auth.pending.title') })).toBeVisible();
});

test('수신기를 열지 못하면 안내와 [다시 로그인]', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'error', reason: 'receiver' }) });
  await expect(page.getByRole('heading', { name: t('auth.receiver.title') })).toBeVisible();
  await expect(page.getByText(t('auth.receiver.body'))).toBeVisible();
  await app.axe('수신기 실패');
  await page.getByRole('button', { name: t('auth.relogin') }).click();
  expect(await app.cmds()).toContain('auth_login');
});

test('오프라인 배지와 로그아웃', async ({ app }) => {
  const { page } = app;
  const graceUntil = 1_767_582_000;
  await app.open({
    auth: auth({
      state: 'signedIn',
      channelName: '테스트 채널',
      verifiedAt: 1_767_322_800,
      offline: { since: 1_767_322_800, graceUntil },
    }),
  });
  await expect(page.getByText(t('account.offline', { until: whenText(graceUntil, Date.now(), KST_OFFSET_MIN) }))).toBeVisible();
  await page.getByRole('button', { name: '테스트 채널' }).click();
  await expect(page.getByRole('menuitem', { name: t('auth.reconnect') })).toBeVisible();
  await page.getByRole('menuitem', { name: t('account.logout') }).click();
  const dialog = page.getByRole('dialog', { name: t('dialog.logout.title') });
  await expect(dialog).toBeVisible();
  // 안전한 쪽([로그인 유지])이 오른쪽 끝·첫 포커스다
  await expect(dialog.getByRole('button', { name: t('dialog.logout.keep') })).toBeFocused();
  await app.axe('로그아웃 확인');
  await dialog.getByRole('button', { name: t('dialog.logout.confirm') }).click();
  await expect(page.getByRole('heading', { name: t('auth.signedOut.title') })).toBeVisible();
  expect(await app.cmds()).toContain('auth_logout');
});

test('처음 로그인 화면은 비공식 고지·동의 문구·개인정보 처리방침 링크를 보이고, 링크는 페이지를 연다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: auth({ state: 'signedOut' }) });
  await expect(page.getByText(t('auth.intro'))).toBeVisible();
  await expect(page.getByText(t('notice.short'))).toBeVisible();
  await expect(page.getByText(t('auth.consent'))).toBeVisible();
  await page.getByRole('button', { name: t('auth.privacy') }).click();
  await expect.poll(() => app.args('open_web_page')).toEqual([{ page: 'privacy' }]);
  // 로그인 전이라 게이트 뒤 command는 부르지 않았다
  expect(await app.cmds()).not.toContain('get_settings');
});
