import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, AppInfo, AuthStatusDto, Os, SettingsDto } from '../../bindings';
import { errorCopy } from '../../copy/errors';
import { t } from '../../copy/ko';
import { revealLabel } from '../../platform';

vi.mock('../../api', () => ({
  getSettings: vi.fn(),
  appInfo: vi.fn(),
  updateSettings: vi.fn(),
  setNaverCookies: vi.fn(),
  clearNaverCookies: vi.fn(),
  importLegacy: vi.fn(),
  pickFolder: vi.fn(),
  openAppFolder: vi.fn(),
  openWebPage: vi.fn(),
}));

const api = await import('../../api');
const { settings } = await import('../../stores/settings.svelte');
const { auth } = await import('../../stores/auth.svelte');
const { platform } = await import('../../stores/platform.svelte');
const { ui } = await import('../../stores/ui.svelte');
const { toasts } = await import('../../stores/toast.svelte');
const { default: SettingsView } = await import('../../views/SettingsView.svelte');
const { default: AppBanners } = await import('../app/AppBanners.svelte');
const { default: LegacyFound } = await import('./LegacyFound.svelte');

const base: SettingsDto = {
  downloadFolder: null,
  effectiveDownloadFolder: '/Users/me/Movies/치지직',
  useNaverCookies: false,
  naverCookiesSaved: false,
  lastQualityLabel: null,
  lastUrl: null,
  recentVods: [],
  segmentConcurrency: 4,
  maxParallelDownloads: 2,
  autoResumeInterrupted: false,
  importedFrom: null,
  textScale: 'default',
  theme: 'system',
};

const info: AppInfo = {
  version: '0.1.0',
  coreVersion: '0.1.0',
  configDir: '/c',
  dataDir: '/d',
  logDir: '/l',
  defaultDownloadFolder: '/Users/me/Movies/치지직',
  features: { auth: false },
  legacyCandidate: null,
  platform: 'macos',
  textScale: 'default',
  theme: 'system',
};

function appError(code: AppError['code'], over: Partial<AppError> = {}): AppError {
  return { code, message: code, stage: null, resumable: false, payload: null, ...over };
}

beforeEach(() => {
  for (const f of Object.values(api)) vi.mocked(f as () => unknown).mockReset();
  vi.mocked(api.updateSettings).mockImplementation(async (p) => ({ ...settings.dto!, ...(p as object) }) as SettingsDto);
  vi.mocked(api.openAppFolder).mockResolvedValue();
  settings.dto = { ...base };
  settings.info = { ...info };
  settings.saveError = null;
  settings.legacyWarnings = [];
  settings.legacyPromptDone = false;
  ui.openCookieSection = false;
  ui.logoutConfirm = false;
  auth.reset();
  platform.set('macos');
  document.documentElement.removeAttribute('data-text-scale');
  document.documentElement.removeAttribute('data-theme');
  toasts.clear();
});

const signedIn: AuthStatusDto = {
  state: 'signedIn',
  channelId: 'c1',
  channelName: '테스트 채널',
  reason: null,
  pending: null,
  offline: null,
  verifiedAt: 1_760_000_000,
  canReconnect: false,
};

async function openCookies(user: ReturnType<typeof userEvent.setup>) {
  // Disclosure는 <details><summary><h2>이라 제목을 눌러 펼친다
  await user.click(screen.getByRole('heading', { name: t('settings.advanced') }));
}

describe('설정: 즉시 저장', () => {
  it('동시에 받는 영상 수·연결 수·자동 이어받기를 바꾸면 바로 저장한다', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    await user.selectOptions(screen.getByRole('combobox', { name: t('settings.parallel') }), '3');
    expect(api.updateSettings).toHaveBeenLastCalledWith({ maxParallelDownloads: 3 });
    await user.selectOptions(screen.getByRole('combobox', { name: t('settings.segments') }), '8');
    expect(api.updateSettings).toHaveBeenLastCalledWith({ segmentConcurrency: 8 });
    const sw = screen.getByRole('switch', { name: t('settings.autoResume') });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(api.updateSettings).toHaveBeenLastCalledWith({ autoResumeInterrupted: true });
    expect(screen.getByRole('combobox', { name: t('settings.parallel') })).toHaveDisplayValue('3');
    expect(screen.getAllByRole('option', { name: /^\d$/ }).length).toBe(3 + 8);
  });

  it('설정 파일 저장 실패: B2 배너, 컨트롤은 저장된 값으로 돌아가고 [다시 시도]가 같은 패치를 보낸다', async () => {
    vi.mocked(api.updateSettings).mockRejectedValueOnce(appError('settings'));
    const user = userEvent.setup();
    render(SettingsView);
    const banner = within(render(AppBanners).container);
    await user.selectOptions(screen.getByRole('combobox', { name: t('settings.parallel') }), '1');
    expect(await banner.findByText('설정을 저장하지 못했어요. 디스크 공간과 권한을 확인해 주세요.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: t('settings.parallel') })).toHaveDisplayValue('2'),
    );
    await user.click(banner.getByRole('button', { name: t('common.openConfigFolder') }));
    expect(api.openAppFolder).toHaveBeenLastCalledWith('config');
    await user.click(banner.getByRole('button', { name: t('action.retry') }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ maxParallelDownloads: 1 });
    await waitFor(() => expect(screen.queryByText(/설정을 저장하지 못했어요/)).toBeNull());
  });

  it('입력 오류는 B2가 아니라 화면 안에 보인다', async () => {
    vi.mocked(api.pickFolder).mockResolvedValue('/x');
    vi.mocked(api.updateSettings).mockRejectedValueOnce(appError('invalidInput', { message: '절대 경로가 아닙니다' }));
    const user = userEvent.setup();
    render(SettingsView);
    await user.click(screen.getByRole('button', { name: t('folder.change') }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ downloadFolder: '/x' });
    expect(await screen.findByText(errorCopy(appError('invalidInput'), { place: 'other' }).title)).toBeInTheDocument();
    expect(settings.saveError).toBeNull();
  });

  it('저장 폴더 열기·설정 폴더 열기·로그 폴더 열기, 버전', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    expect(screen.getByText('/Users/me/Movies/치지직')).toBeInTheDocument();
    expect(screen.getByText(t('settings.about.version', { app: '0.1.0' }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: revealLabel('macos') }));
    await user.click(screen.getByRole('button', { name: t('common.openConfigFolder') }));
    await user.click(screen.getByRole('button', { name: t('settings.about.openLogs') }));
    expect(vi.mocked(api.openAppFolder).mock.calls).toEqual([['downloads'], ['config'], ['logs']]);
  });
});

describe('설정: 보기·계정·정보', () => {
  it.each([
    ['linux', true],
    ['macos', false],
    ['windows', false],
  ] as const)('%s: 모양 행은 %s', (os: Os, has: boolean) => {
    platform.set(os);
    render(SettingsView);
    expect(screen.getByRole('radiogroup', { name: t('settings.textScale') })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: t('settings.theme') }) !== null).toBe(has);
  });

  it('폴더 보기 버튼 이름은 OS를 따른다', () => {
    platform.set('windows');
    render(SettingsView);
    expect(screen.getByRole('button', { name: revealLabel('windows') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: revealLabel('macos') })).toBeNull();
  });

  it('글자 크기를 고르면 패치를 보내고 <html data-text-scale>이 바뀐다', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    expect(screen.getByRole('radio', { name: t('settings.textScale.default') })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: t('settings.textScale.xLarge') }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ textScale: 'x-large' });
    await waitFor(() => expect(document.documentElement.getAttribute('data-text-scale')).toBe('x-large'));
    await waitFor(() => expect(screen.getByRole('radio', { name: t('settings.textScale.xLarge') })).toBeChecked());
  });

  it('Linux에서 모양을 고르면 theme 패치를 보내고 data-theme이 붙는다', async () => {
    platform.set('linux');
    const user = userEvent.setup();
    render(SettingsView);
    await user.click(screen.getByRole('radio', { name: t('settings.theme.dark') }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ theme: 'dark' });
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'));
  });

  it('로그인하지 않았으면 계정 구역이 없다', () => {
    render(SettingsView);
    expect(screen.queryByRole('button', { name: t('account.logout') })).toBeNull();
  });

  it('계정 행: 채널 이름·범위·마지막 확인, [로그아웃…]은 확인 대화상자를 요청만 한다', async () => {
    auth.apply(signedIn);
    const user = userEvent.setup();
    render(SettingsView);
    expect(screen.getByText(signedIn.channelName!)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t('account.scope')))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t('account.lastSeen', { time: '.+' })))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('account.logout') }));
    expect(ui.logoutConfirm).toBe(true);
  });

  it('오프라인이면 마지막 확인 대신 오프라인 안내', () => {
    auth.apply({ ...signedIn, offline: { since: 1_760_000_000, graceUntil: 1_760_100_000 } });
    render(SettingsView);
    expect(screen.getByText(new RegExp(t('account.offline', { until: '.+' }).split('.+')[0]))).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(t('account.lastSeen', { time: '.+' })))).toBeNull();
  });

  it('개인정보 처리방침 링크는 로그인 기능이 있는 빌드에서만 있고 웹 페이지를 연다', async () => {
    vi.mocked(api.openWebPage).mockResolvedValue();
    const user = userEvent.setup();
    const view = render(SettingsView);
    expect(screen.queryByRole('button', { name: t('auth.privacy') })).toBeNull();
    view.unmount();
    settings.info = { ...info, features: { auth: true } };
    render(SettingsView);
    await user.click(screen.getByRole('button', { name: t('auth.privacy') }));
    expect(api.openWebPage).toHaveBeenCalledWith('privacy');
  });

  it('정보: 비공식 고지가 있고 저작권 줄은 없다', () => {
    render(SettingsView);
    expect(screen.getByText(t('notice.unofficial'))).toBeInTheDocument();
    expect(screen.queryByText(/©/)).toBeNull();
  });

  it('업데이트 확인은 로그인했을 때만 있다', () => {
    const view = render(SettingsView);
    expect(screen.queryByRole('button', { name: t('settings.about.checkUpdate') })).toBeNull();
    view.unmount();
    auth.apply(signedIn);
    render(SettingsView);
    expect(screen.getByRole('button', { name: t('settings.about.checkUpdate') })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('설정을 아직 못 읽었으면 값 컨트롤을 그리지 않고 버튼은 비활성이다', () => {
    settings.dto = null;
    render(SettingsView);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('button', { name: t('folder.change') })).toBeDisabled();
  });
});

describe('설정: 네이버 로그인 정보', () => {
  it('저장된 값이 있어도 입력칸은 비어 있고, 저장 뒤에도 비운다', async () => {
    settings.dto = { ...base, naverCookiesSaved: true, useNaverCookies: true };
    vi.mocked(api.setNaverCookies).mockResolvedValue({ ...base, naverCookiesSaved: true, useNaverCookies: true });
    const user = userEvent.setup();
    render(SettingsView);
    await openCookies(user);
    const aut = screen.getByLabelText('NID_AUT', { selector: 'input' });
    const ses = screen.getByLabelText('NID_SES', { selector: 'input' });
    expect(aut).toHaveValue('');
    expect(ses).toHaveValue('');
    expect(aut).toHaveAttribute('type', 'password');
    expect(screen.getByText(t('settings.cookie.saved'))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: t('settings.cookie.use') })).toHaveAttribute('aria-checked', 'true');

    await user.type(aut, 'AUTVALUE');
    await user.type(ses, 'SESVALUE');
    await user.click(screen.getByRole('button', { name: t('settings.cookie.save') }));
    expect(api.setNaverCookies).toHaveBeenCalledWith('AUTVALUE', 'SESVALUE');
    await waitFor(() => expect(aut).toHaveValue(''));
    expect(ses).toHaveValue('');
  });

  it('하나라도 비면 보내지 않고 두 값을 모두 넣으라고 한다', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    await openCookies(user);
    await user.type(screen.getByLabelText('NID_AUT', { selector: 'input' }), 'A');
    await user.click(screen.getByRole('button', { name: t('settings.cookie.save') }));
    expect(api.setNaverCookies).not.toHaveBeenCalled();
    expect(screen.getByText(t('settings.cookie.bothRequired'))).toBeInTheDocument();
    expect(screen.getByLabelText('NID_SES', { selector: 'input' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('값을 찾는 방법은 단계 목록(ol)이고 개발자 도구 키는 OS 표기, 쿠키 이름은 코드 상수다', async () => {
    const user = userEvent.setup();
    platform.set('macos');
    render(SettingsView);
    await openCookies(user);
    await user.click(screen.getByText(t('settings.cookie.howto')));
    const steps = within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent?.trim());
    expect(steps).toEqual([
      t('settings.cookie.howto.step1'),
      t('settings.cookie.howto.step2', { devtools: t('platform.mac.devtools') }),
      t('settings.cookie.howto.step3'),
      t('settings.cookie.howto.step4', { cookieA: 'NID_AUT', cookieB: 'NID_SES' }),
    ]);
    // 번호는 문자열이 아니라 ol이 낸다
    for (const step of steps) expect(step).not.toMatch(/^\d\./);
  });

  it('저장된 값이 없으면 사용 스위치와 지우기가 비활성, 지우기는 입력칸도 비운다', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    await openCookies(user);
    expect(screen.getByText(t('settings.cookie.notSaved'))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: t('settings.cookie.use') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('settings.cookie.clear') })).toBeDisabled();

    settings.dto = { ...base, naverCookiesSaved: true };
    vi.mocked(api.clearNaverCookies).mockResolvedValue({ ...base });
    const sw = await screen.findByRole('switch', { name: t('settings.cookie.use') });
    await waitFor(() => expect(sw).toBeEnabled());
    await user.click(sw);
    expect(api.updateSettings).toHaveBeenLastCalledWith({ useNaverCookies: true });
    await user.type(screen.getByLabelText('NID_AUT', { selector: 'input' }), 'x');
    await user.click(screen.getByRole('button', { name: t('settings.cookie.clear') }));
    expect(api.clearNaverCookies).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('NID_AUT', { selector: 'input' })).toHaveValue(''));
    expect(screen.getByText(t('settings.cookie.notSaved'))).toBeInTheDocument();
  });

  it('접혀 있으면 쿠키 입력칸이 DOM에 없다', () => {
    render(SettingsView);
    expect(screen.queryByLabelText('NID_AUT', { selector: 'input' })).toBeNull();
    expect(screen.queryByLabelText('NID_SES', { selector: 'input' })).toBeNull();
  });

  it('오류 동작으로 들어오면 펼쳐지고 첫 입력칸에 포커스가 간다', async () => {
    ui.openCookieSection = true;
    render(SettingsView);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: t('settings.advanced') }).closest('details')).toHaveAttribute('open'),
    );
    await waitFor(() => expect(screen.getByLabelText('NID_AUT', { selector: 'input' })).toHaveFocus());
    expect(ui.openCookieSection).toBe(false);
  });

  it('사용 스위치 저장이 설정 파일 오류로 실패하면 B2에만 보이고, B2 [다시 시도] 뒤 남는 알림이 없다', async () => {
    settings.dto = { ...base, naverCookiesSaved: true };
    vi.mocked(api.updateSettings).mockRejectedValueOnce(appError('settings'));
    const user = userEvent.setup();
    const view = within(render(SettingsView).container);
    const banner = within(render(AppBanners).container);
    await openCookies(user);
    await user.click(view.getByRole('switch', { name: t('settings.cookie.use') }));
    expect(await banner.findByText(/설정을 저장하지 못했어요/)).toBeInTheDocument();
    expect(view.queryByText(/설정을 저장하지 못했어요/)).toBeNull();
    await user.click(banner.getByRole('button', { name: t('action.retry') }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ useNaverCookies: true });
    await waitFor(() => expect(banner.queryByText(/설정을 저장하지 못했어요/)).toBeNull());
    expect(view.queryByText(/설정을 저장하지 못했어요/)).toBeNull();
  });
});

const WARNING = '옛 파일에 평문 쿠키가 남아 있습니다'; // 가져오기가 돌려주는 경고 원문(데이터)

describe('이전 버전 가져오기', () => {
  it('폴더를 골라 가져오고 경고는 Notice로 남긴다', async () => {
    vi.mocked(api.pickFolder).mockResolvedValue('D:\\tools\\chzzk');
    vi.mocked(api.importLegacy).mockResolvedValue({
      recentCount: 2,
      hasCookies: true,
      warnings: [WARNING],
    });
    vi.mocked(api.getSettings).mockResolvedValue({ ...base, importedFrom: 'D:\\tools\\chzzk' });
    const user = userEvent.setup();
    render(SettingsView);
    await user.click(screen.getByRole('button', { name: t('settings.legacy.pick') }));
    expect(api.importLegacy).toHaveBeenCalledWith('D:\\tools\\chzzk');
    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    expect(await screen.findByText(t('settings.legacy.last', { path: 'D:\\tools\\chzzk' }))).toBeInTheDocument();
    expect(toasts.items.map((t) => t.message)).toEqual([t('legacy.done')]);
  });

  it('찾지 못하면 알린다', async () => {
    vi.mocked(api.pickFolder).mockResolvedValue('/empty');
    vi.mocked(api.importLegacy).mockResolvedValue(null);
    const user = userEvent.setup();
    render(SettingsView);
    await user.click(screen.getByRole('button', { name: t('settings.legacy.pick') }));
    await waitFor(() => expect(toasts.items.map((t) => t.message)).toEqual([t('legacy.notFound')]));
  });
});

describe('D3: 첫 실행에 이전 설정을 찾음', () => {
  it('가져오기는 후보를 적용하고, 경고는 설정 화면에 남는다', async () => {
    settings.info = { ...info, legacyCandidate: { dir: '/old', recentCount: 3, hasCookies: true } };
    vi.mocked(api.importLegacy).mockResolvedValue({ recentCount: 3, hasCookies: true, warnings: ['경고'] });
    vi.mocked(api.getSettings).mockResolvedValue({ ...base });
    const user = userEvent.setup();
    render(LegacyFound);
    const dialog = await screen.findByRole('dialog', { name: t('dialog.legacy.title') });
    expect(within(dialog).getByText(t('dialog.legacy.body'))).toBeInTheDocument();
    // 가져올 것은 `ul`의 항목 키로 나뉜다(문장 조각을 이어 붙이지 않는다)
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual([
      t('dialog.legacy.item.folder'),
      t('dialog.legacy.item.recent', { n: 3 }),
      t('dialog.legacy.item.cookies'),
    ]);
    // 오른쪽(primary, 첫 포커스)이 안전한 [나중에], 왼쪽(secondary)이 실행 쪽 [가져오기]
    await waitFor(() => expect(within(dialog).getByRole('button', { name: t('common.later') })).toHaveFocus());
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([t('dialog.legacy.import'), t('common.later')]);
    expect(api.importLegacy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: t('dialog.legacy.import') }));
    expect(api.importLegacy).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(settings.legacyWarnings).toEqual(['경고']);
  });

  it('나중에는 아무것도 바꾸지 않고 닫는다', async () => {
    settings.info = { ...info, legacyCandidate: { dir: '/old', recentCount: 1, hasCookies: false } };
    const user = userEvent.setup();
    render(LegacyFound);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent?.trim())).toEqual([
      t('dialog.legacy.item.folder'),
      t('dialog.legacy.item.recent', { n: 1 }),
    ]);
    await user.click(within(dialog).getByRole('button', { name: t('common.later') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.importLegacy).not.toHaveBeenCalled();
  });

  it('Esc는 onclose(나중에)만 하고 가져오지 않는다', async () => {
    settings.info = { ...info, legacyCandidate: { dir: '/old', recentCount: 1, hasCookies: false } };
    const user = userEvent.setup();
    render(LegacyFound);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.importLegacy).not.toHaveBeenCalled();
    expect(settings.legacyPromptDone).toBe(true);
  });
});
