// 설정(S2), 글자 크기·모양, 비활성 창, 닫기 가드(D1).
import type { AuthStatusDto } from '../src/lib/bindings';
import { resolved } from '../src/test/fixtures';
import { revealLabel, t } from './copy';
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

test('설정: 값을 바꾸면 바로 저장하고, 쿠키는 저장 뒤 다시 채우지 않는다', async ({ app }) => {
  const { page } = app;
  await app.open();
  await page.getByRole('button', { name: t('header.settings') }).click();
  await expect(page.getByRole('heading', { name: t('header.settings'), level: 1 })).toBeVisible();
  await app.axe('설정');

  await page.getByRole('combobox', { name: t('settings.parallel') }).selectOption('3');
  await page.getByRole('combobox', { name: t('settings.segments') }).selectOption('8');
  await page.getByRole('switch', { name: t('settings.autoResume') }).click();
  await expect.poll(() => app.args('update_settings')).toEqual([
    { patch: { maxParallelDownloads: 3 } },
    { patch: { segmentConcurrency: 8 } },
    { patch: { autoResumeInterrupted: true } },
  ]);

  // 고급: 접힌 동안은 쿠키 입력이 DOM에 없다. 가짜 값이다(실제 쿠키 모양이 아니다)
  // Disclosure는 네이티브 <details>라 제목줄이 <summary>다(role=button이 아니다)
  await expect(page.getByLabel('NID_AUT', { exact: true })).toHaveCount(0);
  await page.locator('summary', { hasText: t('settings.advanced') }).click();
  await app.axe('쿠키 섹션');
  await page.getByRole('button', { name: t('common.save'), exact: true }).click();
  await expect(page.getByText(t('settings.cookie.bothRequired'))).toBeVisible();
  await page.getByLabel('NID_AUT', { exact: true }).fill('e2e-aut');
  await page.getByLabel('NID_SES', { exact: true }).fill('e2e-ses');
  await page.getByRole('button', { name: t('common.save'), exact: true }).click();
  await expect(page.getByText(t('settings.cookie.saved'), { exact: true })).toBeVisible();
  expect(await app.args('set_naver_cookies')).toEqual([{ nidAut: 'e2e-aut', nidSes: 'e2e-ses' }]);
  await expect(page.getByLabel('NID_AUT', { exact: true })).toHaveValue('');

  // 뒤로 → 홈, 입력줄로 포커스
  await page.getByRole('button', { name: t('header.back') }).click();
  await expect(page.getByLabel(t('url.label'))).toBeFocused();
});

test('글자 크기를 바꾸면 바로 적용·저장하고, 다시 열어도 유지한다', async ({ app }) => {
  const { page } = app;
  await app.open();
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-text-scale', /.+/);
  await page.getByRole('button', { name: t('header.settings') }).click();
  const group = page.getByRole('radiogroup', { name: t('settings.textScale') });
  await expect(group.getByRole('radio', { name: t('settings.textScale.default') })).toBeChecked();
  await group.locator('label.choice').filter({ hasText: t('settings.textScale.xLarge') }).click();
  await expect(html).toHaveAttribute('data-text-scale', 'x-large');
  expect(await app.args('update_settings')).toEqual([{ patch: { textScale: 'x-large' } }]);
  await app.axe('아주 크게');

  // 홈으로 돌아가도 유지하고, 기본으로 되돌리면 속성이 빠진다
  await page.getByRole('button', { name: t('header.back') }).click();
  await expect(html).toHaveAttribute('data-text-scale', 'x-large');
  await page.getByRole('button', { name: t('header.settings') }).click();
  await group.locator('label.choice').filter({ hasText: t('settings.textScale.default') }).click();
  await expect(html).not.toHaveAttribute('data-text-scale', /.+/);
});

test('저장된 글자 크기는 시작하자마자 적용한다(로그인 전 화면 포함)', async ({ app }) => {
  const { page } = app;
  await app.open({
    settings: { textScale: 'x-large' },
    auth: { state: 'signedOut', channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null, canReconnect: false, isAdmin: false, delegatedChannels: [], delegationsCheckedAt: null },
  });
  await expect(page.getByRole('heading', { name: t('auth.signedOut.title') })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-text-scale', 'x-large');
});

test('모양 행은 Linux에만 있고, 고르면 data-theme을 붙인다', async ({ app }) => {
  const { page } = app;
  await app.open({ platform: 'linux' });
  await page.getByRole('button', { name: t('header.settings') }).click();
  const group = page.getByRole('radiogroup', { name: t('settings.theme') });
  await group.locator('label.choice').filter({ hasText: t('settings.theme.dark') }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await app.args('update_settings')).toEqual([{ patch: { theme: 'dark' } }]);
});

for (const os of ['macos', 'windows'] as const) {
  test(`${os}: 모양 행이 없고, 폴더 보기 버튼 글자가 OS 표기다`, async ({ app }) => {
    const { page } = app;
    await app.open({ platform: os });
    await page.getByRole('button', { name: t('header.settings') }).click();
    await expect(page.getByText(t('settings.textScale'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('settings.theme'), { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: revealLabel(os), exact: true })).toBeVisible();
    await app.axe(`설정 ${os}`);
  });
}

test('로그인한 빌드의 설정: 계정 행의 [로그아웃…]은 확인(D4)을 열고, 개인정보 처리방침 링크는 페이지를 연다', async ({ app }) => {
  const { page } = app;
  await app.open({ auth: signedIn });
  await page.getByRole('button', { name: t('header.settings') }).click();
  await expect(page.getByText(t('account.scope'))).toBeVisible();
  await page.getByRole('button', { name: t('auth.privacy') }).click();
  await expect.poll(() => app.args('open_web_page')).toEqual([{ page: 'privacy' }]);

  await page.getByRole('main').getByRole('button', { name: t('account.logout') }).click();
  const dialog = page.getByRole('dialog', { name: t('dialog.logout.title') });
  await expect(dialog).toBeVisible();
  // 안전한 쪽([로그인 유지])이 오른쪽 끝·첫 포커스다
  await expect(dialog.getByRole('button', { name: t('dialog.logout.keep') })).toBeFocused();
  await dialog.getByRole('button', { name: t('dialog.logout.keep') }).click();
  await expect(dialog).toBeHidden();
  expect(await app.cmds()).not.toContain('auth_logout');
});

test('비활성 창(macOS): 포커스를 잃으면 html[data-window-active="false"], 돌아오면 "true"', async ({ app }) => {
  const { page } = app;
  await app.open({ platform: 'macos' });
  const html = page.locator('html');
  await app.ctl((c) => c.windowFocus(false), null);
  await expect(html).toHaveAttribute('data-window-active', 'false');
  await app.ctl((c) => c.windowFocus(true), null);
  await expect(html).toHaveAttribute('data-window-active', 'true');
});

test('비활성 창 속성은 macOS에만 붙는다', async ({ app }) => {
  const { page } = app;
  await app.open({ platform: 'windows' });
  await app.ctl((c) => c.windowFocus(false), null);
  // 이벤트가 처리될 시간을 한 번 준 뒤에도 속성이 없다
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  await expect(page.locator('html')).not.toHaveAttribute('data-window-active', /.+/);
});

test('닫기 가드: [계속 받기]는 닫지 않고, [닫기]는 quit을 한 번 부른다', async ({ app }) => {
  const { page } = app;
  await app.open();
  await app.ctl((c, p) => c.emit('close-requested', p), { running: 2 });
  const dialog = page.getByRole('dialog', { name: t('dialog.close.title') });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(t('dialog.close.body', { n: 2 }));
  await expect(dialog.getByRole('button', { name: t('dialog.cancel.keepRunning') })).toBeFocused();
  await app.axe('닫기 확인');
  await dialog.getByRole('button', { name: t('dialog.cancel.keepRunning') }).click();
  await expect(dialog).toBeHidden();
  expect(await app.cmds()).not.toContain('quit');

  await app.ctl((c, p) => c.emit('close-requested', p), { running: 1 });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: t('dialog.close.confirm'), exact: true }).click();
  await expect.poll(async () => (await app.cmds()).filter((c) => c === 'quit').length).toBe(1);
});

test('이전 설정을 찾았다는 확인(D3)에서 [나중에]는 가져오지 않는다', async ({ app }) => {
  const { page } = app;
  await app.open({ info: { legacyCandidate: { dir: '/e2e/legacy', recentCount: 3, hasCookies: false } } });
  const dialog = page.getByRole('dialog', { name: t('dialog.legacy.title') });
  await expect(dialog).toBeVisible();
  // 안전한 쪽([나중에])이 오른쪽 끝·첫 포커스다
  await expect(dialog.getByRole('button', { name: t('common.later') })).toBeFocused();
  await dialog.getByRole('button', { name: t('common.later') }).click();
  await expect(dialog).toBeHidden();
  expect(await app.cmds()).not.toContain('import_legacy');
});

test('파일 이름 규칙: 기본 문자열 · 예시 · 저장 때만 오류 · 저장 · 기본값으로 · 카드 제안 이름', async ({ app }) => {
  const { page } = app;
  const r = resolved();
  await app.open({ resolve: { [r.url]: r } });
  await page.getByRole('button', { name: t('header.settings') }).click();
  const field = page.getByRole('textbox', { name: t('settings.fileNameTemplate') });
  const save = page.getByRole('button', { name: t('common.save'), exact: true });
  const reset = page.getByRole('button', { name: t('settings.fileNameTemplate.reset') });

  // ① 기본 문자열이 보이고 [저장]·[기본값으로]는 없다
  await expect(field).toHaveValue('{prefix} {channel} - {title}');
  await expect(save).toHaveCount(0);
  await expect(reset).toHaveCount(0);
  await expect(page.getByText(t('settings.fileNameTemplate.preview', { name: '[261018] 채널이름 - 저녁 방송.mp4' }))).toBeVisible();
  await app.axe('파일 이름 규칙');

  // ② 치면 예시가 바뀐다
  await field.fill('{date}_{channel}_{title}');
  await expect(page.getByText(t('settings.fileNameTemplate.preview', { name: '261018_채널이름_저녁 방송.mp4' }))).toBeVisible();

  // ③ 읽을 수 없는 값은 치는 동안 조용하고, [저장]을 누르면 칸 아래 오류가 뜬다
  await field.fill('{foo}');
  await expect(page.getByText(/^예: /)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await save.click();
  await expect(page.getByRole('alert')).toContainText(t('settings.fileNameTemplate.error.unknown', { token: '{foo}' }));
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();
  await app.axe('파일 이름 규칙 오류');
  expect(await app.args('update_settings')).toEqual([]);

  // ④ 올바른 값을 저장하면 [기본값으로]가 나타나고, 누르면 사라진다
  await field.fill('{date}_{channel}_{title}');
  await save.click();
  await expect(reset).toBeVisible();
  await expect(save).toHaveCount(0);
  expect(await app.args('update_settings')).toEqual([{ patch: { fileNameTemplate: '{date}_{channel}_{title}' } }]);

  // ⑤ 저장 뒤 영상을 불러오면 카드의 제안 이름이 새 규칙을 따른다
  await page.getByRole('button', { name: t('header.back') }).click();
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const card = page.getByRole('region', { name: r.meta.title });
  await expect(card.getByLabel(t('filename.label'))).toHaveValue('261018_채널이름_저녁 방송');

  await page.getByRole('button', { name: t('header.settings') }).click();
  await reset.click();
  await expect(field).toHaveValue('{prefix} {channel} - {title}');
  await expect(reset).toHaveCount(0);
  expect((await app.args('update_settings')).at(-1)).toEqual({ patch: { fileNameTemplate: null } });
});
