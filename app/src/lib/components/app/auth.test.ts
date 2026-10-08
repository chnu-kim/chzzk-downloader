import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatusDto, SettingsDto } from '../../bindings';
import { job } from '../../../test/jobFixtures';

class FakeChannel {
  onmessage: (e: unknown) => void = () => {};
}

const EMPTY = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null } as const;
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
};

const info = (legacy: boolean) => ({
  version: '0.1.0',
  coreVersion: '0.1.0',
  configDir: '/c',
  dataDir: '/d',
  logDir: '/l',
  defaultDownloadFolder: '/Movies',
  features: { auth: true },
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
  onCloseRequested: vi.fn(),
  importLegacy: vi.fn(),
}));

const api = await import('../../api');
const { default: App } = await import('../../../App.svelte');
const { default: AccountSlot } = await import('./AccountSlot.svelte');
const { default: UpdateBanner } = await import('./UpdateBanner.svelte');
const { auth, AUTH_UNKNOWN_ERROR } = await import('../../stores/auth.svelte');
const { jobs } = await import('../../stores/jobs.svelte');
const { ui } = await import('../../stores/ui.svelte');
const { toasts } = await import('../../stores/toast.svelte');

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
    api.onCloseRequested, api.importLegacy,
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

  it('첫 상태 전에는 아무 화면도 없다', async () => {
    start(new Promise<AuthStatusDto>(() => {}));
    render(App);
    await waitFor(() => expect(api.authStatus).toHaveBeenCalled());
    expect(screen.getByRole('main')).toBeEmptyDOMElement();
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
    await screen.findByRole('heading', { name: '다시 로그인해 주세요' });
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
      authDto({ state: 'pending', pending: { userCode: 'K7QX-4MRA', expiresAt: Math.floor(Date.now() / 1000) + 600 } }),
    );
    render(App);
    await user.click(await screen.findByRole('button', { name: '치지직으로 로그인' }));
    const h = await screen.findByRole('heading', { name: '브라우저에서 로그인해 주세요' });
    await waitFor(() => expect(h).toHaveFocus());
  });

  it('checking 화면은 스피너·안내·[다시 로그인]을 처음부터 보이고 로그인을 시작할 수 있다', async () => {
    const user = userEvent.setup();
    start(authDto({ state: 'checking' }));
    render(App);
    await screen.findByRole('heading', { name: '로그인 정보를 확인하는 중이에요…' });
    expect(screen.getByText('최대 40초쯤 걸려요.')).toBeInTheDocument();
    expect(document.querySelector('.spinner')).not.toBeNull();
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
      authDto({ state: 'pending', pending: { userCode: 'K7QX-4MRA', expiresAt: Math.floor(Date.now() / 1000) + 600 } }),
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

  it('거부 화면: 채널 이름과 다른 계정 안내', async () => {
    start(authDto({ state: 'denied', channelName: '테스트 채널' }));
    render(App);
    await screen.findByRole('heading', { name: '사용 허가가 없는 채널이에요' });
    expect(screen.getByText(/채널: 테스트 채널\./)).toBeInTheDocument();
    expect(screen.getByText(/네이버 로그아웃을 먼저/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다른 계정으로 로그인' })).toBeInTheDocument();
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
  it('확인 코드를 따로 보이고 남은 시간이 줄며, 버튼이 command로 이어진다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(1_800_000_000_000));
    start(authDto({ state: 'pending', pending: { userCode: 'K7QX-4MRA', expiresAt: 1_800_000_600 } }));
    render(App);
    const code = await screen.findByText('K7QX-4MRA');
    // 스크린리더용 머리말과 한 문단으로 읽힌다
    expect(code.parentElement).toHaveTextContent(/^확인 코드\s*K7QX-4MRA$/);
    expect(code.parentElement?.querySelector('.sr-only')).toHaveTextContent('확인 코드');
    expect(screen.getByText(/남은 시간 10:00/)).toBeInTheDocument();
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
});

describe('AccountSlot', () => {
  const signed = authDto({ state: 'signedIn', channelName: '테스트 채널', verifiedAt: 1_767_322_800 });

  it('채널 이름과 마지막 확인, 메뉴에는 [로그아웃]만(온라인)', async () => {
    const user = userEvent.setup();
    render(AccountSlot, { status: signed });
    const name = screen.getByText('테스트 채널');
    expect(name.getAttribute('title')).toMatch(/^마지막 확인 /);
    expect(screen.queryByText(/오프라인/)).toBeNull();
    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    expect(screen.getByRole('menuitem', { name: '로그아웃' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '다시 연결' })).toBeNull();
  });

  it('오프라인이면 배지와 [다시 연결]이 보인다', async () => {
    const user = userEvent.setup();
    vi.mocked(api.authRetry).mockResolvedValue(signed);
    render(AccountSlot, { status: { ...signed, offline: { since: 1_767_322_800, graceUntil: 1_767_582_000 } } });
    expect(screen.getByText(/^오프라인 · .+까지 사용 가능$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '다시 연결' }));
    expect(api.authRetry).toHaveBeenCalled();
    expect(toasts.items.map((i) => i.message)).not.toContain('아직 연결되지 않았어요. 잠시 뒤 다시 시도해 주세요.');
  });

  it('계정 메뉴의 [다시 연결] 뒤에도 오프라인이면 토스트로 알린다', async () => {
    const user = userEvent.setup();
    const offline = { ...signed, offline: { since: 1_767_322_800, graceUntil: 1_767_582_000 } };
    vi.mocked(api.authRetry).mockResolvedValue(offline);
    render(AccountSlot, { status: offline });
    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '다시 연결' }));
    await waitFor(() =>
      expect(toasts.items.map((i) => i.message)).toContain('아직 연결되지 않았어요. 잠시 뒤 다시 시도해 주세요.'),
    );
  });

  it('[로그아웃]은 확인 대화상자(기본 [취소]) 뒤에 동작한다', async () => {
    const user = userEvent.setup();
    vi.mocked(api.authLogout).mockResolvedValue(authDto({ state: 'signedOut' }));
    render(AccountSlot, { status: signed });
    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '로그아웃' }));
    const d = await screen.findByRole('dialog', { name: '로그아웃할까요?' });
    await waitFor(() => expect(within(d).getByRole('button', { name: '취소' })).toHaveFocus());
    await user.click(within(d).getByRole('button', { name: '취소' }));
    expect(api.authLogout).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '계정 메뉴' }));
    await user.click(screen.getByRole('menuitem', { name: '로그아웃' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '로그아웃' }));
    expect(api.authLogout).toHaveBeenCalledTimes(1);
    expect(auth.status?.state).toBe('signedOut');
  });

  it('헤더에서는 로그인한 상태에서만 보인다', async () => {
    start(signed);
    render(App);
    await screen.findByLabelText('영상 주소');
    expect(screen.getByRole('button', { name: '계정 메뉴' })).toBeInTheDocument();
  });
});

describe('UpdateBanner', () => {
  it('버전 문구와 두 버튼, 닫기는 나중에와 같다', async () => {
    const oninstall = vi.fn();
    const onlater = vi.fn();
    const { rerender } = render(UpdateBanner, { version: '0.1.1', oninstall, onlater });
    expect(screen.getByText('새 버전 0.1.1이 있어요.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '지금 업데이트' }));
    expect(oninstall).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: '나중에' }));
    await fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(onlater).toHaveBeenCalledTimes(2);
    await rerender({ version: '0.1.1', busy: true, oninstall, onlater });
    expect(screen.getByRole('button', { name: '지금 업데이트' })).toBeDisabled();
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
    const pending = authDto({ state: 'pending', pending: { userCode: 'K7QX-4MRA', expiresAt: 1 } });
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
