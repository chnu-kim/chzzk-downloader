// App 뼈대(system/patterns.md §14.1·§1.3·§1.4·§13-7, platform.md §3): 열·툴바 구성 표·토스트 여백·로그인 성공 토스트·비활성 창.
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatusDto, Os, SettingsDto } from '../../bindings';
import { t } from '../../copy/ko';

class FakeChannel {
  onmessage: (e: unknown) => void = () => {};
}

const EMPTY = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null, canReconnect: false } as const;
const dto = (over: Partial<AuthStatusDto> & Pick<AuthStatusDto, 'state'>): AuthStatusDto => ({ ...EMPTY, ...over });

const settingsDto: SettingsDto = {
  downloadFolder: null,
  effectiveDownloadFolder: '/Movies',
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

let os: Os = 'windows';
const info = () => ({
  version: '0.1.0',
  coreVersion: '0.1.0',
  configDir: '/c',
  dataDir: '/d',
  logDir: '/l',
  defaultDownloadFolder: '/Movies',
  features: { auth: true },
  platform: os,
  textScale: 'default',
  theme: 'system',
  legacyCandidate: null,
});

vi.mock('../../api', () => ({
  Channel: FakeChannel,
  authStatus: vi.fn(),
  onAuthChanged: vi.fn(),
  authLogin: vi.fn(),
  authReopen: vi.fn(),
  authCopyLoginUrl: vi.fn(),
  authCancel: vi.fn(),
  authRetry: vi.fn(),
  authLogout: vi.fn(),
  getSettings: vi.fn(),
  appInfo: vi.fn(),
  subscribeJobs: vi.fn(),
  clipboardLink: vi.fn(),
  onWindowFocus: vi.fn(),
  onCloseRequested: vi.fn(),
  openWebPage: vi.fn(),
  importLegacy: vi.fn(),
  updateCheck: vi.fn(),
  updateAvailable: vi.fn(),
  updateInstall: vi.fn(),
  onUpdateAvailable: vi.fn(),
  onUpdateProgress: vi.fn(),
}));

const api = await import('../../api');
const { default: App } = await import('../../../App.svelte');
const { auth } = await import('../../stores/auth.svelte');
const { jobs } = await import('../../stores/jobs.svelte');
const { platform } = await import('../../stores/platform.svelte');
const { toasts } = await import('../../stores/toast.svelte');
const { ui } = await import('../../stores/ui.svelte');
const { update } = await import('../../stores/update.svelte');

let emit: (s: AuthStatusDto) => void = () => {};
let focusCb: (focused: boolean) => void = () => {};

function start(status: AuthStatusDto) {
  vi.mocked(api.authStatus).mockImplementation(() => Promise.resolve(status));
}

beforeEach(() => {
  os = 'windows';
  auth.reset();
  ui.goHome();
  ui.logoutConfirm = false;
  ui.windowFocused = true;
  toasts.clear();
  update.reset();
  platform.set('linux');
  document.documentElement.removeAttribute('data-window-active');
  emit = () => {};
  focusCb = () => {};
  vi.mocked(api.onAuthChanged).mockImplementation(async (cb) => {
    emit = cb;
    return () => {};
  });
  vi.mocked(api.onWindowFocus).mockImplementation(async (cb) => {
    focusCb = cb;
    return () => {};
  });
  vi.mocked(api.getSettings).mockResolvedValue(settingsDto);
  vi.mocked(api.appInfo).mockImplementation(async () => info() as never);
  vi.mocked(api.subscribeJobs).mockResolvedValue([]);
  vi.mocked(api.clipboardLink).mockResolvedValue(null);
  vi.mocked(api.onCloseRequested).mockResolvedValue(() => {});
  vi.mocked(api.onUpdateAvailable).mockResolvedValue(() => {});
  vi.mocked(api.onUpdateProgress).mockResolvedValue(() => {});
  vi.mocked(api.updateAvailable).mockResolvedValue(null);
});

afterEach(() => {
  jobs.state = { ...jobs.state };
});

/** 툴바 오른쪽 칸의 버튼 이름들(왼쪽부터) */
function endNames(): string[] {
  const end = document.querySelector('.toolbar-end') as HTMLElement;
  return within(end)
    .queryAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '');
}

describe('열과 스크롤 영역', () => {
  it('<main class="main">이 스크롤 영역이고 열(.col)은 App이 소유하며 배너는 열의 첫 요소다', async () => {
    start(dto({ state: 'signedIn', channelName: '테스트 채널' }));
    vi.mocked(api.updateAvailable).mockResolvedValue({ version: '0.2.0', current: '0.1.0', notes: null, pubDate: null });
    render(App);
    await screen.findByLabelText(t('url.label'));
    const main = screen.getByRole('main');
    expect(main).toHaveClass('main');
    const col = main.firstElementChild as HTMLElement;
    expect(col).toHaveClass('col');
    // 뷰는 자기 열을 두지 않는다: 홈의 루트는 열 안에 하나뿐이다
    expect(col.querySelectorAll('.col')).toHaveLength(0);
    await screen.findByText(t('update.banner', { version: '0.2.0' }));
    expect(col.firstElementChild).toContainElement(screen.getByText(t('update.banner', { version: '0.2.0' })));
  });

  it('토스트가 떠 있는 동안에만 .main에 has-toast(바닥 여백) 표시가 붙는다', async () => {
    start(dto({ state: 'disabled' }));
    render(App);
    await screen.findByLabelText(t('url.label'));
    const main = screen.getByRole('main');
    expect(main).not.toHaveClass('has-toast');
    toasts.push(t('action.copied'), 'copied');
    await waitFor(() => expect(main).toHaveClass('has-toast'));
    toasts.clear();
    await waitFor(() => expect(main).not.toHaveClass('has-toast'));
  });
});

describe('툴바 구성 표', () => {
  const signedIn = dto({ state: 'signedIn', channelName: '테스트 채널' });

  it('홈: 앱 이름 | 계정 Menu · [⚙]', async () => {
    start(signedIn);
    render(App);
    await screen.findByLabelText(t('url.label'));
    const bar = screen.getByRole('banner');
    expect(within(bar).getByText(t('app.title'))).toBeInTheDocument();
    expect(within(bar).queryByRole('heading', { level: 1 })).toBeNull();
    expect(endNames()).toEqual(['테스트 채널', t('header.settings')]);
    expect(screen.getByRole('button', { name: t('header.settings') })).not.toHaveAttribute('aria-current');
  });

  it('설정: [←] + h1 "설정" | 같은 자리의 계정 Menu · [⚙](aria-current="page")', async () => {
    const user = userEvent.setup();
    start(signedIn);
    render(App);
    await screen.findByLabelText(t('url.label'));
    await user.click(screen.getByRole('button', { name: t('header.settings') }));
    const bar = screen.getByRole('banner');
    await within(bar).findByRole('heading', { level: 1, name: t('header.settings') });
    expect(within(bar).getByRole('button', { name: t('header.back') })).toBeInTheDocument();
    expect(within(bar).queryByText(t('app.title'))).toBeNull();
    // 오른쪽 구성은 홈과 같다(자리가 흔들리지 않는다)
    expect(endNames()).toEqual(['테스트 채널', t('header.settings')]);
    expect(within(bar).getByRole('button', { name: t('header.settings') })).toHaveAttribute('aria-current', 'page');
    // 눌러도 아무 일이 없다
    await user.click(within(bar).getByRole('button', { name: t('header.settings') }));
    expect(ui.view).toBe('settings');
  });

  it('로그인을 쓰지 않는 빌드(disabled): 계정 Menu 없이 [⚙]만', async () => {
    start(dto({ state: 'disabled' }));
    render(App);
    await screen.findByLabelText(t('url.label'));
    expect(endNames()).toEqual([t('header.settings')]);
  });

  it('로그인 화면: 앱 이름뿐(계정·설정 없음)', async () => {
    start(dto({ state: 'signedOut' }));
    render(App);
    await screen.findByRole('heading', { name: t('auth.signedOut.title') });
    const bar = screen.getByRole('banner');
    expect(within(bar).getByText(t('app.title'))).toBeInTheDocument();
    expect(endNames()).toEqual([]);
  });
});

describe('로그인 성공 토스트(§13-7)', () => {
  it('브라우저 로그인(pending)을 거쳐 signedIn이 되면 toast.signedIn이 한 번 뜬다', async () => {
    start(dto({ state: 'signedOut' }));
    render(App);
    await screen.findByRole('heading', { name: t('auth.signedOut.title') });
    emit(dto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }));
    await screen.findByRole('heading', { name: t('auth.pending.title') });
    emit(dto({ state: 'checking' }));
    emit(dto({ state: 'signedIn', channelName: '테스트 채널' }));
    await waitFor(() => expect(toasts.items.map((i) => i.message)).toEqual([t('toast.signedIn', { channelName: '테스트 채널' })]));
    // 같은 로그인 상태가 다시 와도(오프라인 갱신 등) 되풀이하지 않는다
    toasts.clear();
    emit(dto({ state: 'signedIn', channelName: '테스트 채널', verifiedAt: 1_767_322_800 }));
    await screen.findByLabelText(t('url.label'));
    expect(toasts.items).toHaveLength(0);
  });

  it('시작할 때 저장된 세션 확인(checking → signedIn)은 로그인이 아니라 알리지 않는다', async () => {
    start(dto({ state: 'checking' }));
    render(App);
    await screen.findByRole('heading', { name: t('auth.checking') });
    emit(dto({ state: 'signedIn', channelName: '테스트 채널' }));
    await screen.findByLabelText(t('url.label'));
    expect(toasts.items).toHaveLength(0);
  });

  it('로그인이 거부로 끝나면 다음 로그인 없이 signedIn이 와도 옛 pending이 토스트를 만들지 않는다', async () => {
    start(dto({ state: 'signedOut' }));
    render(App);
    await screen.findByRole('heading', { name: t('auth.signedOut.title') });
    emit(dto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }));
    emit(dto({ state: 'denied', channelName: '다른 채널' }));
    await screen.findByRole('heading', { name: t('auth.denied.title') });
    emit(dto({ state: 'signedIn', channelName: '테스트 채널' }));
    await screen.findByLabelText(t('url.label'));
    expect(toasts.items).toHaveLength(0);
  });
});

describe('비활성 창(platform.md §3)', () => {
  it('macOS에서 window-focus가 false면 <html data-window-active="false">, true면 "true"', async () => {
    os = 'macos';
    start(dto({ state: 'disabled' }));
    render(App);
    await screen.findByLabelText(t('url.label'));
    await waitFor(() => expect(platform.os).toBe('macos'));
    focusCb(true);
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-window-active', 'true'));
    expect(ui.windowFocused).toBe(true);
    focusCb(false);
    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-window-active', 'false'));
    expect(ui.windowFocused).toBe(false);
  });

  it('macOS가 아니면 속성을 두지 않는다', async () => {
    os = 'windows';
    start(dto({ state: 'disabled' }));
    render(App);
    await screen.findByLabelText(t('url.label'));
    focusCb(false);
    await waitFor(() => expect(ui.windowFocused).toBe(false));
    expect(document.documentElement).not.toHaveAttribute('data-window-active');
  });
});
