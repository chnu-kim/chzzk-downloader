// 편집자 위임 화면(delegation.md §4·§5, app.md 구현 중 변경 81). 판정·서버 확인은 셸이 하고 가짜 백엔드는 결과만 흉내 낸다.
import type { AppError, AuthStatusDto, EditorsDto } from '../src/lib/bindings';
import { liveResolved, resolved } from '../src/test/fixtures';
import { COPIED_LABEL_MS, TOAST_MS, dayText, errorCopy, t } from './copy';
import { expect, test } from './fixtures';

const A1 = '000000000000000000000000000000a1';
const B2 = '000000000000000000000000000000b2';
const C3 = '000000000000000000000000000000c3';
const NOW = 1_767_322_800;

const me: AuthStatusDto = {
  state: 'signedIn',
  channelId: A1,
  channelName: '내 채널',
  reason: null,
  pending: null,
  offline: null,
  verifiedAt: NOW,
  canReconnect: false,
  isAdmin: false,
  delegatedChannels: [],
  delegationsCheckedAt: null,
};
const withDelegated: AuthStatusDto = { ...me, delegatedChannels: [{ channelId: C3, channelName: '맡긴 채널' }], delegationsCheckedAt: NOW };

const other = (over = {}) =>
  resolved({
    url: 'https://chzzk.naver.com/video/7654321',
    content: { kind: 'video', videoNo: 7654321 },
    ownership: 'notOwn',
    meta: { ...resolved().meta, title: '남의 방송', channelName: '맡긴 채널', channelId: C3 },
    ...over,
  });

const editorsDto = (over: Partial<EditorsDto> = {}): EditorsDto => ({
  editors: [{ channelId: B2, channelName: '편집자 하나', since: NOW - 13 * 86400, status: 'active' }],
  delegatedChannels: [],
  pendingInviteUntil: null,
  editorsMax: 10,
  delegationsMax: 20,
  ...over,
});

const appError = (code: AppError['code']): AppError => ({ code, message: code, stage: null, resumable: false, payload: null });

const notOwnCopy = (delegatedCount = 0) =>
  errorCopy({ code: 'notOwnContent', message: '', stage: null, resumable: false, payload: null }, { place: 'resolve', channelName: '맡긴 채널', myChannel: '내 채널', delegatedCount });

async function loadUrl(page: import('@playwright/test').Page, url: string) {
  await page.getByLabel(t('url.label')).fill(url);
  await page.getByRole('button', { name: t('common.load'), exact: true }).click();
}

const openSettings = (page: import('@playwright/test').Page) => page.getByRole('button', { name: t('header.settings') }).click();
const cmdCount = async (app: { cmds(): Promise<string[]> }, cmd: string) => (await app.cmds()).filter((c) => c === cmd).length;

test('D1 맡은 채널 영상은 경고 없이 메타 조각만 보이고 받는다', async ({ app }) => {
  const r = other({ ownership: 'delegated' });
  const { page } = app;
  await app.open({ auth: withDelegated, resolve: { [r.url]: r } });
  await loadUrl(page, r.url);
  const card = page.getByRole('region', { name: '남의 방송' });
  await expect(card).toBeVisible();
  await expect(card.locator('.meta')).toContainText(t('delegated.title'));
  await expect(card.locator('.tone-danger')).toHaveCount(0);
  await app.axe('맡은 채널 영상 카드');
  const download = card.getByRole('button', { name: t('card.download') });
  await expect(download).not.toHaveAttribute('aria-disabled', 'true');
  await download.click();
  await expect.poll(async () => (await app.cmds()).includes('enqueue')).toBe(true);
});

test('D2 남의 영상은 막히고, 맡은 채널이 된 뒤 [다시 불러오기]로 풀린다', async ({ app }) => {
  const r = other();
  const { page } = app;
  await app.open({ auth: { ...me, delegationsCheckedAt: NOW }, resolve: { [r.url]: r } });
  await loadUrl(page, r.url);
  const card = page.getByRole('region', { name: '남의 방송' });
  const why = notOwnCopy();
  await expect(card.getByText(why.title, { exact: true })).toBeVisible();
  await expect(card.getByText(why.body as string, { exact: true })).toBeVisible();
  await expect(card.getByText('영상의 채널: ‘맡긴 채널’')).toBeVisible();
  await expect(card.getByText(new RegExp(t('account.lastSeen', { time: '.+' })))).toBeVisible();
  const download = card.getByRole('button', { name: t('card.download') });
  await expect(download).toHaveAttribute('aria-disabled', 'true');
  await expect(download).toHaveAccessibleDescription(`${why.title} ${why.body}`);
  await app.axe('막힌 카드');

  await app.ctl((c, a) => c.setResolve(a.url, a.next), { url: r.url, next: other({ ownership: 'delegated' }) });
  await app.ctl((c, a) => c.setDelegated(a), [{ channelId: C3, channelName: '맡긴 채널' }]);
  const resolveBefore = await cmdCount(app, 'resolve');
  await card.getByRole('button', { name: t('action.reresolve') }).first().click();
  await expect(card.locator('.meta')).toContainText(t('delegated.title'));
  expect(await cmdCount(app, 'ownership_recheck')).toBe(1);
  expect(await cmdCount(app, 'resolve')).toBe(resolveBefore);
  await expect(page.getByRole('region', { name: '남의 방송' }).getByRole('button', { name: t('card.download') })).not.toHaveAttribute('aria-disabled', 'true');
});

test('D3 [다시 불러오기]가 서버에 닿지 못하면 그 줄이 보이고 카드는 그대로다', async ({ app }) => {
  const r = other();
  const { page } = app;
  await app.open({ auth: { ...me, delegationsCheckedAt: NOW }, resolve: { [r.url]: r } });
  await loadUrl(page, r.url);
  const card = page.getByRole('region', { name: '남의 방송' });
  await app.ctl((c, e) => c.failNext('ownership_recheck', e), appError('network'));
  await card.getByRole('button', { name: t('action.reresolve') }).first().click();
  await expect(card.getByText(t('receive.recheck.offline'))).toBeVisible();
  await expect(card.getByRole('button', { name: t('card.download') })).toHaveAttribute('aria-disabled', 'true');
});

test('D4 맡은 채널의 생방송은 막다른 길이라 버튼 없이 이유만 말한다', async ({ app }) => {
  const live = liveResolved({ ownership: 'notOwn' });
  live.meta = { ...live.meta, channelId: C3, channelName: '맡긴 채널' };
  const { page } = app;
  await app.open({ auth: withDelegated, resolve: { [live.url]: live } });
  await loadUrl(page, live.url);
  const card = page.getByRole('region', { name: live.meta.title });
  const copy = errorCopy({ code: 'notOwnContent', message: '', stage: null, resumable: false, payload: null }, { place: 'resolve', channelName: '맡긴 채널', delegatedLive: true });
  await expect(card.getByText(copy.title, { exact: true })).toBeVisible();
  await expect(card.getByText(copy.body as string, { exact: true })).toBeVisible();
  await expect(card.locator('.notice-actions')).toHaveCount(0);
  await expect(card.getByRole('button', { name: t('card.download') })).toHaveAttribute('aria-disabled', 'true');
});

test('D5 초대 주소를 만들고 복사한다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: me, editors: editorsDto({ editors: [] }) });
  await openSettings(page);
  await expect(page.getByText(t('editors.empty'))).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } });
  });
  await page.getByRole('button', { name: t('editors.invite.make') }).click();
  const field = page.getByLabel(t('editors.invite.label'));
  await expect(field).toHaveValue(/\/invite\//);
  await expect(page.getByText(t('editors.pending', { date: dayText(NOW + 7 * 86400, Date.now()) }))).toBeVisible();
  await app.axe('초대 주소');
  await page.getByRole('button', { name: t('action.copyUrl') }).click();
  await expect(page.getByRole('button', { name: t('action.copied') })).toBeVisible();
  await expect(page.locator('.notice-toast')).toHaveCount(0);
  await expect(page.getByRole('button', { name: t('action.copyUrl') })).toBeVisible({ timeout: COPIED_LABEL_MS + 2000 });
});

test('D6 편집자 빼기는 [되돌리기]가 되고, 토스트가 닫힐 때에야 서버로 간다', async ({ app }) => {
  const { page } = app;
  await page.clock.install();
  await app.open({ auth: me, editors: editorsDto() });
  await openSettings(page);
  const remove = page.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) });
  await remove.click();
  await expect(page.locator('[data-editor]')).toHaveCount(0);
  await expect(page.getByText(t('toast.editorRemoved', { name: '편집자 하나' }))).toBeVisible();
  await app.axe('빼기 토스트', '.toaster');
  await page.getByRole('button', { name: t('action.undo') }).click();
  await expect(page.locator('[data-editor]')).toHaveCount(1);
  expect(await cmdCount(app, 'editors_remove')).toBe(0);

  await remove.click();
  // 토스트는 올려 둔 동안 멈춘다(components.md §2.13): 포인터를 치운 뒤 시간을 흘린다
  await page.mouse.move(0, 0);
  await page.clock.runFor(TOAST_MS + 100);
  await expect.poll(async () => app.args('editors_remove')).toEqual([{ channelId: B2 }]);
});

test('D7 토스트가 사는 동안 계정이 바뀌면 보내지 않는다', async ({ app }) => {
  const { page } = app;
  await page.clock.install();
  await app.open({ auth: me, editors: editorsDto() });
  await openSettings(page);
  await page.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) }).click();
  await expect(page.getByText(t('toast.editorRemoved', { name: '편집자 하나' }))).toBeVisible();
  await app.ctl((c, s) => c.setAuth(s), { ...me, channelId: '000000000000000000000000000000d4', channelName: '다른 계정' });
  await expect(page.getByText(t('toast.editorRemoved', { name: '편집자 하나' }))).toHaveCount(0);
  await page.clock.runFor(TOAST_MS + 100);
  expect(await cmdCount(app, 'editors_remove')).toBe(0);
});

test('D8 편집자 그만두기: 보내고 토스트, 행과 머리 행이 사라진다', async ({ app }) => {
  const { page } = app;
  await app.open({
    auth: withDelegated,
    editors: editorsDto({ editors: [], delegatedChannels: [{ channelId: C3, channelName: '맡긴 채널', since: NOW - 13 * 86400 }] }),
  });
  await openSettings(page);
  await expect(page.getByText(t('delegated.title'), { exact: true })).toBeVisible();
  await page.getByRole('button', { name: t('a11y.leaveDelegation', { name: '맡긴 채널' }) }).click();
  await expect.poll(async () => app.args('delegations_leave')).toEqual([{ channelId: C3 }]);
  await expect(page.getByText(t('toast.delegationLeft', { name: '맡긴 채널' }))).toBeVisible();
  await expect(page.locator('[data-delegated]')).toHaveCount(0);
  await expect(page.getByText(t('delegated.title'), { exact: true })).toHaveCount(0);
});

test('D9 만들기가 아직 준비되지 않았으면 그 행 안에 이유 한 줄', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: me, editors: editorsDto({ editors: [] }) });
  await openSettings(page);
  await app.ctl((c, e) => c.failNext('editors_invite', e), appError('unsupported'));
  await page.getByRole('button', { name: t('editors.invite.make') }).click();
  await expect(page.getByRole('alert').filter({ hasText: t('editors.notReady') })).toBeVisible();
});

test('D10 오프라인이면 버튼이 aria-disabled이고 이유를 읽으며 편집자 목록을 묻지 않는다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: { ...me, offline: { since: NOW - 60, graceUntil: NOW + 86400 } }, editors: editorsDto() });
  await openSettings(page);
  const make = page.getByRole('button', { name: t('editors.invite.make') });
  await expect(make).toHaveAttribute('aria-disabled', 'true');
  await expect(make).toHaveAccessibleDescription(t('editors.offline'));
  expect(await cmdCount(app, 'editors_list')).toBe(0);
});

test('D11 사용 허가가 없는 채널의 거부 화면에 편집자 안내 한 줄', async ({ app }) => {
  await app.open({ auth: { ...me, state: 'denied', channelName: '테스트 채널' } });
  await expect(app.page.getByText(t('auth.denied.editorHint'))).toBeVisible();
});
