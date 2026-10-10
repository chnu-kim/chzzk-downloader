import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatusDto, SettingsDto } from '../../bindings';
import { t } from '../../copy/ko';
import { formatDateTimeShort } from '../../format/date';
import { LOADER_DELAY_MS } from '../../timing';
import { job } from '../../../test/jobFixtures';

class FakeChannel {
  onmessage: (e: unknown) => void = () => {};
}

const EMPTY = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null, canReconnect: false } as const;
const authDto = (over: Partial<AuthStatusDto> & Pick<AuthStatusDto, 'state'>): AuthStatusDto => ({ ...EMPTY, ...over });

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

const info = (legacy: boolean) => ({
  version: '0.1.0',
  coreVersion: '0.1.0',
  configDir: '/c',
  dataDir: '/d',
  logDir: '/l',
  defaultDownloadFolder: '/Movies',
  features: { auth: true },
  platform: 'windows',
  textScale: 'default',
  theme: 'system',
  legacyCandidate: legacy ? { dir: '/old', vodCount: 2, hasCookies: false } : null,
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
  onWindowFocus: vi.fn(async () => () => {}),
  openWebPage: vi.fn(),
  onCloseRequested: vi.fn(),
  importLegacy: vi.fn(),
  updateCheck: vi.fn(),
  updateAvailable: vi.fn(),
  updateInstall: vi.fn(),
  onUpdateAvailable: vi.fn(),
  onUpdateProgress: vi.fn(),
}));

const api = await import('../../api');
const { default: App } = await import('../../../App.svelte');
const { default: AccountSlot } = await import('./AccountSlot.svelte');
const { default: UpdateBanner } = await import('./UpdateBanner.svelte');
const { auth, AUTH_UNKNOWN_ERROR } = await import('../../stores/auth.svelte');
const { jobs } = await import('../../stores/jobs.svelte');
const { ui } = await import('../../stores/ui.svelte');
const { toasts } = await import('../../stores/toast.svelte');
const { update } = await import('../../stores/update.svelte');

let emit: (s: AuthStatusDto) => void = () => {};
let jobList = [] as ReturnType<typeof job>[];
let legacy = false;

function start(status: AuthStatusDto | Promise<AuthStatusDto>) {
  vi.mocked(api.authStatus).mockImplementation(() => Promise.resolve(status));
}

beforeEach(() => {
  auth.reset();
  ui.goHome();
  toasts.clear();
  legacy = false;
  jobList = [];
  emit = () => {};
  for (const f of [
    api.authStatus, api.onAuthChanged, api.authLogin, api.authReopen, api.authCopyLoginUrl, api.authCancel,
    api.authRetry, api.authLogout, api.getSettings, api.appInfo, api.subscribeJobs, api.clipboardLink,
    api.onCloseRequested, api.importLegacy, api.updateCheck, api.updateAvailable, api.updateInstall,
    api.onUpdateAvailable, api.onUpdateProgress,
  ]) {
    vi.mocked(f).mockReset();
  }
  vi.mocked(api.onAuthChanged).mockImplementation(async (cb) => {
    emit = cb;
    return () => {};
  });
  vi.mocked(api.getSettings).mockResolvedValue(settingsDto);
  vi.mocked(api.appInfo).mockImplementation(async () => info(legacy) as never);
  vi.mocked(api.subscribeJobs).mockImplementation(async () => jobList);
  vi.mocked(api.clipboardLink).mockResolvedValue(null);
  vi.mocked(api.onCloseRequested).mockResolvedValue(() => {});
  update.reset();
  vi.mocked(api.onUpdateAvailable).mockResolvedValue(() => {});
  vi.mocked(api.onUpdateProgress).mockResolvedValue(() => {});
  vi.mocked(api.updateAvailable).mockResolvedValue(null);
  vi.mocked(api.authReopen).mockResolvedValue(true);
  vi.mocked(api.authCopyLoginUrl).mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  jobs.state = { ...jobs.state };
});

describe('AuthStore.start', () => {
  it('먼저 이벤트를 듣고 그다음 상태를 묻는다', async () => {
    start(authDto({ state: 'signedOut' }));
    await auth.start();
    const order = [
      vi.mocked(api.onAuthChanged).mock.invocationCallOrder[0],
      vi.mocked(api.authStatus).mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]);
    expect(auth.status?.state).toBe('signedOut');
  });

  it('이벤트가 응답보다 먼저 오면 응답은 버린다', async () => {
    let resolve: (s: AuthStatusDto) => void = () => {};
    start(new Promise<AuthStatusDto>((r) => (resolve = r)));
    const p = auth.start();
    await waitFor(() => expect(api.authStatus).toHaveBeenCalled());
    emit(authDto({ state: 'signedIn', channelName: '새 채널' }));
    resolve(authDto({ state: 'signedOut' }));
    await p;
    expect(auth.status?.state).toBe('signedIn');
  });

  it('상태를 묻다 실패하면 닫힌 채로 오류 상태를 둔다', async () => {
    vi.mocked(api.authStatus).mockRejectedValue(new Error('x'));
    await auth.start();
    expect(auth.status).toEqual(AUTH_UNKNOWN_ERROR);
    expect(auth.locked).toBe(true);
  });

  it('이벤트를 듣지 못해도 상태는 묻는다', async () => {
    vi.mocked(api.onAuthChanged).mockRejectedValue(new Error('x'));
    start(authDto({ state: 'disabled' }));
    await auth.start();
    expect(auth.unlocked).toBe(true);
  });
});

describe('AuthGate 화면', () => {
  it('잠긴 동안 로그인 화면만 그리고 게이트 뒤 command를 부르지 않는다', async () => {
    legacy = true;
    jobList = [job(1, { status: 'interrupted' })];
    start(authDto({ state: 'signedOut' }));
    render(App);
    await screen.findByRole('heading', { name: '로그인이 필요해요' });
    expect(screen.getByRole('button', { name: '치지직으로 로그인' })).toBeInTheDocument();
    expect(screen.queryByLabelText('영상 주소')).toBeNull();
    expect(screen.queryByRole('button', { name: '설정' })).toBeNull();
    expect(screen.queryByRole('button', { name: '모두 이어받기' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.getSettings).not.toHaveBeenCalled();
    expect(api.clipboardLink).not.toHaveBeenCalled();
    expect(api.authLogin).not.toHaveBeenCalled();
  });

  it('처음 로그인 화면은 네 요소(auth.intro·notice.short·auth.consent·auth.privacy)와 전폭 주 버튼을 그리고, 처리방침은 브라우저로 연다', async () => {
    const user = userEvent.setup();
    start(authDto({ state: 'signedOut' }));
    vi.mocked(api.openWebPage).mockResolvedValue(undefined as never);
    render(App);
    const title = await screen.findByRole('heading', { name: t('auth.signedOut.title') });
    const panel = title.closest('section') as HTMLElement;
    expect(within(panel).getByText(t('auth.intro'))).toBeInTheDocument();
    expect(within(panel).getByText(t('notice.short'))).toBeInTheDocument();
    expect(within(panel).getByText(t('auth.consent'))).toBeInTheDocument();
    const login = within(panel).getByRole('button', { name: t('auth.login') });
    expect(login).toHaveClass('btn-primary');
    // 창에 채움은 하나: 처리방침은 링크형(ghost)이다
    const privacy = within(panel).getByRole('button', { name: t('auth.privacy') });
    expect(privacy).toHaveClass('btn-ghost', 'edge-start', 'btn-inline');
    expect(panel.querySelectorAll('.btn-primary')).toHaveLength(1);
    // 로그인 화면에는 툴바에 앱 이름뿐(계정·설정 없음)이고 배너 자리도 없다
    expect(screen.queryByRole('button', { name: t('header.settings') })).toBeNull();
    expect(screen.getByRole('main').querySelector('.notice-banner')).toBeNull();
    await user.click(privacy);
    expect(api.openWebPage).toHaveBeenCalledExactlyOnceWith('privacy');
    expect(api.authLogin).not.toHaveBeenCalled();
  });

  it('다른 로그인 화면(거부 등)에는 처음 로그인용 고지·동의·처리방침이 붙지 않는다', async () => {
    start(authDto({ state: 'denied', channelName: '테스트 채널' }));
    render(App);
    await screen.findByRole('heading', { name: t('auth.denied.title') });
    expect(screen.queryByText(t('notice.short'))).toBeNull();
    expect(screen.queryByText(t('auth.consent'))).toBeNull();
    expect(screen.queryByRole('button', { name: t('auth.privacy') })).toBeNull();
  });

  it('첫 상태 전에는 아무 화면도 없다', async () => {
    start(new Promise<AuthStatusDto>(() => {}));
    render(App);
    await waitFor(() => expect(api.authStatus).toHaveBeenCalled());
    // 열(.col)은 App이 소유하지만 안에는 아무 화면도 배너도 없다
    expect(screen.getByRole('main').querySelector('.col')?.children).toHaveLength(0);
    expect(screen.queryByLabelText('영상 주소')).toBeNull();
  });

  it('disabled면 홈이 뜨고 설정을 한 번 읽는다', async () => {
    start(authDto({ state: 'disabled' }));
    render(App);
    await screen.findByLabelText('영상 주소');
    expect(api.getSettings).toHaveBeenCalledTimes(1);
  });

  it('로그인하면 홈과 설정이 열리고, 다시 만료되면 로그인 화면과 홈으로 돌아간다', async () => {
    start(authDto({ state: 'signedOut' }));
    render(App);
    await screen.findByRole('heading', { name: '로그인이 필요해요' });
    emit(authDto({ state: 'signedIn', channelName: '테스트 채널' }));
    await screen.findByLabelText('영상 주소');
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(1));
    ui.goSettings();
    emit(authDto({ state: 'expired', reason: 'sessionExpired' }));
    await screen.findByRole('heading', { name: '로그인이 만료됐어요' });
    expect(ui.view).toBe('home');
    emit(authDto({ state: 'signedIn', channelName: '테스트 채널' }));
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
  });

  it('잠긴 동안 설정·붙여넣기 단축키가 듣지 않는다', async () => {
    start(authDto({ state: 'signedOut' }));
    render(App);
    await screen.findByRole('heading', { name: '로그인이 필요해요' });
    const mac = /Mac/.test(navigator.platform);
    await fireEvent.keyDown(window, { key: ',', metaKey: mac, ctrlKey: !mac });
    expect(ui.view).toBe('home');
    expect(screen.queryByRole('heading', { name: '설정' })).toBeNull();
    // 입력칸 밖 붙여넣기와 Mod+L도 잠긴 동안은 아무것도 하지 않는다
    const paste = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = { getData: () => 'https://chzzk.naver.com/video/1' };
    document.body.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(false);
    const modL = await fireEvent.keyDown(window, { key: 'l', metaKey: mac, ctrlKey: !mac });
    expect(modL).toBe(true);
    await Promise.resolve();
    expect(screen.queryByLabelText('영상 주소')).toBeNull();
    expect(api.clipboardLink).not.toHaveBeenCalled();
  });

  it('로그인을 시작하면 pending이 되고 제목으로 포커스가 간다', async () => {
    const user = userEvent.setup();
    start(authDto({ state: 'signedOut' }));
    vi.mocked(api.authLogin).mockResolvedValue(
      authDto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }),
    );
    render(App);
    await user.click(await screen.findByRole('button', { name: '치지직으로 로그인' }));
    const h = await screen.findByRole('heading', { name: '브라우저에서 로그인해 주세요' });
    await waitFor(() => expect(h).toHaveFocus());
  });

  it('pending의 [로그인 주소 복사]도 링크형이라 밑줄(btn-inline)이다(WCAG 1.4.1)', async () => {
    start(authDto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }));
    render(App);
    expect(await screen.findByRole('button', { name: t('auth.copyLoginUrl') })).toHaveClass('btn-inline');
  });

  it('로그인이 끝나 잠금이 풀리면 포커스가 body에 남지 않고 홈 입력줄로 간다', async () => {
    start(authDto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }));
    render(App);
    const cancel = await screen.findByRole('button', { name: '취소' });
    cancel.focus();
    expect(cancel).toHaveFocus();
    emit(authDto({ state: 'signedIn', channelName: '테스트 채널' }));
    const input = await screen.findByLabelText('영상 주소');
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('처음부터 열려 있으면(잠긴 적 없음) 입력줄로 포커스를 옮기지 않는다', async () => {
    start(authDto({ state: 'disabled' }));
    render(App);
    const input = await screen.findByLabelText('영상 주소');
    await Promise.resolve();
    expect(input).not.toHaveFocus();
  });

  it('코드 없는 pending이면 버튼 없는 화면 대신 [다시 로그인]을 보인다', async () => {
    const user = userEvent.setup();
    start(authDto({ state: 'pending' }));
    vi.mocked(api.authLogin).mockResolvedValue(authDto({ state: 'checking' }));
    render(App);
    await user.click(await screen.findByRole('button', { name: '다시 로그인' }));
    expect(api.authLogin).toHaveBeenCalledTimes(1);
  });

  it('checking 화면은 안내·[다시 로그인]을 처음부터 보이고 스피너는 지연 뒤에 보이며 로그인을 시작할 수 있다', async () => {
    const user = userEvent.setup();
    start(authDto({ state: 'checking' }));
    render(App);
    await screen.findByRole('heading', { name: t('auth.checking') });
    expect(screen.getByText(t('auth.checking.body'))).toBeInTheDocument();
    // 300ms 안에 끝나면 한 번도 보이지 않는다(깜박임 방지, useDelayedLoading)
    expect(document.querySelector('.spinner')).toBeNull();
    await waitFor(() => expect(document.querySelector('.spinner')).not.toBeNull(), { timeout: LOADER_DELAY_MS + 2000 });
    vi.mocked(api.authLogin).mockResolvedValue(authDto({ state: 'checking' }));
    await user.click(screen.getByRole('button', { name: '다시 로그인' }));
    expect(api.authLogin).toHaveBeenCalledTimes(1);
  });

  it('[다시 연결] 응답을 기다리는 동안 Checking이 와도 [다시 로그인]은 눌리고 로그인이 시작된다', async () => {
    const user = userEvent.setup();
    const grace = authDto({ state: 'expired', reason: 'graceExpired' });
    start(grace);
    vi.mocked(api.authRetry).mockImplementation(() => new Promise(() => {}));
    vi.mocked(api.authLogin).mockResolvedValue(
      authDto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }),
    );
    render(App);
    await user.click(await screen.findByRole('button', { name: '다시 연결' }));
    emit(authDto({ state: 'checking' }));
    await screen.findByRole('heading', { name: '로그인 정보를 확인하는 중이에요…' });
    const relogin = screen.getByRole('button', { name: '다시 로그인' });
    expect(relogin).toBeEnabled();
    await user.click(relogin);
    expect(api.authLogin).toHaveBeenCalledTimes(1);
    await screen.findByRole('heading', { name: '브라우저에서 로그인해 주세요' });
  });

  it('[다시 연결] 응답이 이벤트보다 먼저 와도 늦게 온 Checking·만료 이벤트 뒤에 안내가 남는다', async () => {
    const user = userEvent.setup();
    const grace = authDto({ state: 'expired', reason: 'graceExpired' });
    start(grace);
    vi.mocked(api.authRetry).mockResolvedValue(grace);
    render(App);
    await user.click(await screen.findByRole('button', { name: '다시 연결' }));
    expect(await screen.findByText(/아직 연결되지 않았어요/)).toBeInTheDocument();
    emit(authDto({ state: 'checking' }));
    await waitFor(() => expect(screen.queryByText(/아직 연결되지 않았어요/)).toBeNull());
    emit(grace);
    expect(await screen.findByText(/아직 연결되지 않았어요/)).toBeInTheDocument();
  });

  it('유예 만료: [다시 연결]이 같은 상태면 안내를 보이고, 상태가 바뀌면 사라진다', async () => {
    const user = userEvent.setup();
    const grace = authDto({ state: 'expired', reason: 'graceExpired' });
    start(grace);
    vi.mocked(api.authRetry).mockResolvedValue(grace);
    render(App);
    await user.click(await screen.findByRole('button', { name: '다시 연결' }));
    expect(await screen.findByText(/아직 연결되지 않았어요/)).toBeInTheDocument();
    emit(authDto({ state: 'signedIn', channelName: '테스트 채널' }));
    await waitFor(() => expect(screen.queryByText(/아직 연결되지 않았어요/)).toBeNull());
  });

  it('거부 화면: 채널 이름, 주 버튼 [다시 시도], 안내 문장 속 링크형 [다른 계정으로 로그인]', async () => {
    const user = userEvent.setup();
    start(authDto({ state: 'denied', channelName: '테스트 채널' }));
    vi.mocked(api.authLogin).mockResolvedValue(authDto({ state: 'denied', channelName: '테스트 채널' }));
    render(App);
    await screen.findByRole('heading', { name: '사용 허가가 없는 채널이에요' });
    expect(screen.getByText(/채널: 테스트 채널\./)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: '다시 시도' });
    expect(retry).toHaveClass('btn-primary');
    const other = screen.getByRole('button', { name: '다른 계정으로 로그인' });
    expect(other).toHaveClass('btn-ghost');
    expect(other.closest('p')).toHaveTextContent(/네이버 로그아웃 후\s*다른 계정으로 로그인$/);
    // 둘 다 같은 로그인을 시작한다
    await user.click(retry);
    await user.click(other);
    expect(api.authLogin).toHaveBeenCalledTimes(2);
  });

  it('받는 중·대기 중 작업이 있으면 계속 받는다는 안내, 없고 중단된 작업이 있으면 로그인 안내', async () => {
    jobList = [job(1, { status: 'running' }), job(4, { status: 'queued' })];
    start(authDto({ state: 'signedOut' }));
    const { unmount } = render(App);
    await screen.findByText(/받는 중·대기 중인 다운로드 2개는 계속 받아요/);
    unmount();
    jobList = [job(2, { status: 'interrupted' }), job(3, { status: 'interrupted' })];
    render(App);
    await screen.findByText('지난번에 받다가 멈춘 다운로드가 2개 있어요. 로그인하면 이어받을 수 있어요.');
  });
});

describe('로그인 대기 화면', () => {
  it('남은 시간이 줄며, 버튼이 command로 이어진다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(1_800_000_000_000));
    start(authDto({ state: 'pending', pending: { expiresAt: 1_800_000_600 } }));
    render(App);
    expect(await screen.findByText(/남은 시간 10:00/)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1100);
    await waitFor(() => expect(screen.getByText(/남은 시간 9:5\d/)).toBeInTheDocument());

    await fireEvent.click(screen.getByRole('button', { name: '브라우저 다시 열기' }));
    expect(api.authReopen).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: '로그인 주소 복사' }));
    await waitFor(() => expect(toasts.items.map((i) => i.message)).toContain('복사했어요'));
    vi.mocked(api.authCopyLoginUrl).mockResolvedValue(false);
    await fireEvent.click(screen.getByRole('button', { name: '로그인 주소 복사' }));
    await waitFor(() => expect(toasts.items.map((i) => i.message)).toContain('복사하지 못했어요. 다시 시도해 주세요.'));
    vi.mocked(api.authCancel).mockResolvedValue(authDto({ state: 'signedOut' }));
    await fireEvent.click(screen.getByRole('button', { name: '취소' }));
    await screen.findByRole('heading', { name: '로그인이 필요해요' });
  });

  it('pending 화면에는 확인 코드가 없고 같은 컴퓨터 안내가 있다', async () => {
    start(authDto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }));
    render(App);
    await screen.findByRole('heading', { name: '브라우저에서 로그인해 주세요' });
    expect(screen.getByText('로그인 주소는 이 컴퓨터의 브라우저에서 열어 주세요.')).toBeInTheDocument();
    expect(screen.queryByText(/확인 코드/)).toBeNull();
    expect(screen.queryByText(/[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}/)).toBeNull();
    expect(screen.queryByText('브라우저에 연결할 수 없다는 오류가 보이면 다시 로그인해 주세요.')).toBeNull();
  });

  it('남은 시간이 510초 이하면 stuck 안내가 보이고 [다시 로그인]은 authCancel 뒤 authLogin을 부른다', async () => {
    const user = userEvent.setup();
    start(authDto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 500 } }));
    vi.mocked(api.authCancel).mockResolvedValue(authDto({ state: 'signedOut' }));
    vi.mocked(api.authLogin).mockResolvedValue(
      authDto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 600 } }),
    );
    render(App);
    await screen.findByText('브라우저에 연결할 수 없다는 오류가 보이면 다시 로그인해 주세요.');
    await user.click(screen.getByRole('button', { name: '다시 로그인' }));
    await waitFor(() => expect(api.authLogin).toHaveBeenCalledTimes(1));
    expect(api.authCancel).toHaveBeenCalledTimes(1);
    const cancelOrder = vi.mocked(api.authCancel).mock.invocationCallOrder[0];
    const loginOrder = vi.mocked(api.authLogin).mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(loginOrder);
  });

  it('[다시 로그인]: 취소가 실패하거나 아직 pending이면 authLogin을 부르지 않는다', async () => {
    const user = userEvent.setup();
    const stuck = authDto({ state: 'pending', pending: { expiresAt: Math.floor(Date.now() / 1000) + 500 } });
    start(stuck);
    vi.mocked(api.authCancel).mockResolvedValue(stuck);
    render(App);
    await screen.findByText('브라우저에 연결할 수 없다는 오류가 보이면 다시 로그인해 주세요.');
    await user.click(screen.getByRole('button', { name: '다시 로그인' }));
    await waitFor(() => expect(api.authCancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '다시 로그인' })).toBeEnabled());
    vi.mocked(api.authCancel).mockRejectedValue(new Error('x'));
    await user.click(screen.getByRole('button', { name: '다시 로그인' }));
    await waitFor(() => expect(api.authCancel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: '다시 로그인' })).toBeEnabled());
    expect(api.authLogin).not.toHaveBeenCalled();
  });
});

describe('AccountSlot', () => {
  const signed = authDto({ state: 'signedIn', channelName: '테스트 채널', verifiedAt: 1_767_322_800 });
  const offlineDto = { ...signed, offline: { since: 1_767_322_800, graceUntil: 1_767_582_000 } };

  it('채널 이름이 메뉴 트리거이고, 메뉴에는 [로그아웃…]만(온라인). title 툴팁은 없다', async () => {
    const user = userEvent.setup();
    const { container } = render(AccountSlot, { status: signed });
    const trigger = screen.getByRole('button', { name: '테스트 채널' });
    expect(trigger).toHaveClass('btn-ghost');
    expect(container.querySelector('[title]')).toBeNull();
    expect(screen.queryByText(/오프라인/)).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole('menu', { name: t('account.menu') })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: t('account.logout') })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: t('auth.reconnect') })).toBeNull();
  });

  it('채널 이름이 없으면 트리거 이름은 계정 메뉴다(이름 없는 버튼이 없다)', () => {
    render(AccountSlot, { status: { ...signed, channelName: null } });
    expect(screen.getByRole('button', { name: t('account.menu') })).toBeInTheDocument();
  });

  it('오프라인이면 account.offline 글자와 [다시 연결]이 보인다', async () => {
    const user = userEvent.setup();
    vi.mocked(api.authRetry).mockResolvedValue(signed);
    render(AccountSlot, { status: offlineDto });
    expect(screen.getByText(t('account.offline', { until: formatDateTimeShort(1_767_582_000) }), { exact: false })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '테스트 채널' }));
    await user.click(screen.getByRole('menuitem', { name: t('auth.reconnect') }));
    expect(api.authRetry).toHaveBeenCalled();
    expect(toasts.items.map((i) => i.message)).not.toContain(t('auth.reconnectFailed'));
  });

  it('계정 메뉴의 [다시 연결] 뒤에도 오프라인이면 토스트로 알린다', async () => {
    const user = userEvent.setup();
    vi.mocked(api.authRetry).mockResolvedValue(offlineDto);
    render(AccountSlot, { status: offlineDto });
    await user.click(screen.getByRole('button', { name: '테스트 채널' }));
    await user.click(screen.getByRole('menuitem', { name: t('auth.reconnect') }));
    await waitFor(() => expect(toasts.items.map((i) => i.message)).toContain(t('auth.reconnectFailed')));
  });

  it('[로그아웃…]은 대화상자를 직접 띄우지 않고 D4 요청(ui.logoutConfirm)만 올린다', async () => {
    const user = userEvent.setup();
    render(AccountSlot, { status: signed });
    await user.click(screen.getByRole('button', { name: '테스트 채널' }));
    await user.click(screen.getByRole('menuitem', { name: t('account.logout') }));
    expect(ui.logoutConfirm).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    ui.logoutConfirm = false;
  });
});

describe('D4 로그아웃 확인(App의 LogoutDialog)', () => {
  const signed = authDto({ state: 'signedIn', channelName: '테스트 채널', verifiedAt: 1_767_322_800 });

  afterEach(() => {
    ui.logoutConfirm = false;
  });

  async function openFromMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: '테스트 채널' }));
    await user.click(screen.getByRole('menuitem', { name: t('account.logout') }));
    return screen.findByRole('dialog', { name: t('dialog.logout.title') });
  }

  it('오른쪽 끝이 안전한 [로그인 유지], 왼쪽이 [로그아웃]. Esc·안전 버튼은 아무것도 하지 않고, 실행하면 로그아웃한다', async () => {
    const user = userEvent.setup();
    start(signed);
    vi.mocked(api.authLogout).mockResolvedValue(authDto({ state: 'signedOut' }));
    render(App);
    let d = await openFromMenu(user);
    // 오른쪽(primary, 첫 포커스)이 안전한 쪽, 왼쪽(secondary)이 실행 쪽
    const keep = within(d).getByRole('button', { name: t('dialog.logout.cancel') });
    await waitFor(() => expect(keep).toHaveFocus());
    expect(keep).toHaveClass('btn-primary');
    expect(within(d).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
      t('dialog.logout.confirm'),
      t('dialog.logout.cancel'),
    ]);
    expect(within(d).getByRole('button', { name: t('dialog.logout.confirm') })).not.toHaveClass('tone-danger');
    // Esc는 닫기만 한다
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ui.logoutConfirm).toBe(false);
    expect(api.authLogout).not.toHaveBeenCalled();
    // 안전한 버튼도 닫기만 한다
    d = await openFromMenu(user);
    await user.click(within(d).getByRole('button', { name: t('dialog.logout.cancel') }));
    expect(api.authLogout).not.toHaveBeenCalled();
    // 실행
    d = await openFromMenu(user);
    await user.click(within(d).getByRole('button', { name: t('dialog.logout.confirm') }));
    expect(api.authLogout).toHaveBeenCalledTimes(1);
    expect(auth.status?.state).toBe('signedOut');
  });

  it('로그인 화면이 열린 동안에는 마운트하지 않고, 요청 플래그가 남아도 다시 로그인한 뒤 되살아나지 않는다', async () => {
    start(signed);
    render(App);
    await screen.findByRole('button', { name: '테스트 채널' });
    ui.logoutConfirm = true;
    await screen.findByRole('dialog', { name: t('dialog.logout.title') });
    emit(authDto({ state: 'expired', reason: 'sessionExpired' }));
    await screen.findByRole('heading', { name: t('auth.sessionExpired.title') });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(ui.logoutConfirm).toBe(false);
    emit(signed);
    await screen.findByLabelText(t('url.label'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('App 업데이트 배선', () => {
  it('로그인한 사용자는 잠금이 풀릴 때 캐시된 업데이트를 읽어 배너를 본다', async () => {
    start(authDto({ state: 'signedIn', channelName: '채널' }));
    vi.mocked(api.updateAvailable).mockResolvedValue({ version: '0.2.0', current: '0.1.0', notes: null, pubDate: null });
    render(App);
    expect(await screen.findByText('새 버전 0.2.0이 있어요.')).toBeInTheDocument();
    expect(api.onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it('로그인을 쓰지 않는 빌드(disabled)나 로그인 전에는 업데이트를 묻지 않는다', async () => {
    start(authDto({ state: 'disabled' }));
    render(App);
    await screen.findByLabelText('영상 주소');
    expect(api.updateAvailable).not.toHaveBeenCalled();
  });
});

describe('UpdateBanner', () => {
  it('[지금 업데이트]와 [×]만 있다([나중에]는 [×]와 같은 일이라 두지 않는다)', async () => {
    const oninstall = vi.fn();
    const onlater = vi.fn();
    render(UpdateBanner, { version: '0.1.1', oninstall, onlater });
    expect(screen.getByText(t('update.banner', { version: '0.1.1' }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('dialog.update.later') })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: t('update.install') }));
    expect(oninstall).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: t('common.close') }));
    expect(onlater).toHaveBeenCalledOnce();
  });

  it('busy·진행 중이면 같은 버튼이 loading(aria-disabled·aria-busy)으로 남고 눌러도 설치하지 않으며 [×]가 없다(77)', async () => {
    const oninstall = vi.fn();
    const { rerender } = render(UpdateBanner, { version: '0.1.1', oninstall, onlater: () => {} });
    const install = screen.getByRole('button', { name: t('update.install') });
    expect(install).not.toHaveAttribute('aria-disabled');
    await rerender({ version: '0.1.1', busy: true, oninstall, onlater: () => {} });
    // 포커스를 잃지 않게 disabled 없이 같은 버튼 노드가 남는다
    const same = screen.getByRole('button', { name: t('update.install') });
    expect(same).toBe(install);
    expect(same).toHaveAttribute('aria-disabled', 'true');
    expect(same).toHaveAttribute('aria-busy', 'true');
    await fireEvent.click(same);
    expect(oninstall).not.toHaveBeenCalled();
    await rerender({ version: '0.1.1', status: t('update.downloading'), detail: '42%', oninstall, onlater: () => {} });
    expect(screen.getByText(t('update.downloading'), { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('common.close') })).toBeNull();
  });
});

describe('AuthStore 동작', () => {
  it('busy 중 다시 부르면 아무것도 하지 않고, 실패하면 토스트', async () => {
    let resolve: (s: AuthStatusDto) => void = () => {};
    vi.mocked(api.authLogin).mockImplementation(() => new Promise((r) => (resolve = r)));
    const p = auth.login();
    void auth.login();
    expect(api.authLogin).toHaveBeenCalledTimes(1);
    resolve(authDto({ state: 'checking' }));
    await p;
    expect(auth.busy).toBe(false);
    vi.mocked(api.authLogin).mockRejectedValue({ code: 'internal', message: 'x' });
    await auth.login();
    expect(toasts.items.some((i) => i.kind === 'danger')).toBe(true);
  });

  it('로그아웃 응답이 늦게 와도 그사이 시작한 로그인 상태를 덮지 않는다', async () => {
    let resolveLogout: (s: AuthStatusDto) => void = () => {};
    vi.mocked(api.authLogout).mockImplementation(() => new Promise((r) => (resolveLogout = r)));
    const pending = authDto({ state: 'pending', pending: { expiresAt: 1 } });
    vi.mocked(api.authLogin).mockResolvedValue(pending);
    auth.apply(authDto({ state: 'signedIn', channelName: '테스트 채널' }));
    const out = auth.logout();
    // 셸은 서버 로그아웃을 기다리기 전에 SignedOut을 먼저 알린다
    auth.apply(authDto({ state: 'signedOut' }));
    expect(auth.isBusy('logout')).toBe(true);
    expect(auth.isBusy('login')).toBe(false);
    await auth.login();
    expect(api.authLogin).toHaveBeenCalledTimes(1);
    expect(auth.status?.state).toBe('pending');
    resolveLogout(authDto({ state: 'signedOut' }));
    await out;
    expect(auth.status?.state).toBe('pending');
  });

  it('다시 연결 중 로그인으로 옮겼다가 취소해 같은 상태로 돌아와도 옛 실패 안내는 살아나지 않는다', async () => {
    const grace = authDto({ state: 'expired', reason: 'graceExpired' });
    let resolveRetry: (s: AuthStatusDto) => void = () => {};
    vi.mocked(api.authRetry).mockImplementation(() => new Promise((r) => (resolveRetry = r)));
    vi.mocked(api.authLogin).mockResolvedValue(authDto({ state: 'pending', pending: { expiresAt: 1 } }));
    auth.apply(grace);
    const re = auth.reconnect();
    auth.apply(authDto({ state: 'checking' }));
    await auth.login();
    expect(auth.status?.state).toBe('pending');
    resolveRetry(grace);
    await re;
    expect(auth.status?.state).toBe('pending');
    auth.apply(grace);
    expect(auth.reconnectFailed).toBe(false);
  });

  it('주소 복사·다시 열기·취소·로그아웃이 실패해도 던지지 않는다', async () => {
    vi.mocked(api.authCopyLoginUrl).mockRejectedValue(new Error('x'));
    vi.mocked(api.authReopen).mockRejectedValue(new Error('x'));
    vi.mocked(api.authCancel).mockRejectedValue({ code: 'internal', message: 'x' });
    vi.mocked(api.authLogout).mockRejectedValue({ code: 'internal', message: 'x' });
    vi.mocked(api.authRetry).mockRejectedValue({ code: 'internal', message: 'x' });
    await auth.copyLoginUrl();
    await auth.reopen();
    await auth.cancel();
    await auth.logout();
    await auth.reconnect();
    expect(auth.busy).toBe(false);
  });
});
