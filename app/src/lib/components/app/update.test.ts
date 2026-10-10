import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, AuthStatusDto, JobDto, SettingsDto, UpdateInfoDto } from '../../bindings';
import { job } from '../../../test/jobFixtures';

class FakeChannel {
  onmessage: (e: unknown) => void = () => {};
}

vi.mock('../../api', () => ({
  Channel: FakeChannel,
  subscribeJobs: vi.fn(),
  getSettings: vi.fn(),
  appInfo: vi.fn(),
  updateSettings: vi.fn(),
  openAppFolder: vi.fn(),
  updateCheck: vi.fn(),
  updateAvailable: vi.fn(),
  updateInstall: vi.fn(),
  onUpdateAvailable: vi.fn(),
  onUpdateProgress: vi.fn(),
}));

const api = await import('../../api');
const { jobs } = await import('../../stores/jobs.svelte');
const { settings } = await import('../../stores/settings.svelte');
const { auth } = await import('../../stores/auth.svelte');
const { update } = await import('../../stores/update.svelte');
const { toasts } = await import('../../stores/toast.svelte');
const { default: UpdateBanner } = await import('./UpdateBanner.svelte');
const { default: UpdateDialog } = await import('./UpdateDialog.svelte');
const { default: AppBanners } = await import('./AppBanners.svelte');
const { default: SettingsView } = await import('../../views/SettingsView.svelte');

const info = (version: string): UpdateInfoDto => ({ version, current: '0.1.0', notes: null, pubDate: null });
const authDto = (state: AuthStatusDto['state']): AuthStatusDto => ({
  state,
  channelId: null,
  channelName: null,
  reason: null,
  pending: null,
  offline: null,
  verifiedAt: null,
  canReconnect: false,
});

const dto: SettingsDto = {
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

const appError = (code: AppError['code']): AppError => ({ code, message: code, stage: null, resumable: false, payload: null });

async function loadJobs(list: JobDto[]) {
  vi.mocked(api.subscribeJobs).mockImplementationOnce(async () => list);
  await jobs.start();
  jobs.bannerDismissed = false;
}

beforeEach(async () => {
  for (const f of [api.updateCheck, api.updateAvailable, api.updateInstall, api.openAppFolder]) vi.mocked(f).mockReset();
  update.reset();
  auth.reset();
  toasts.clear();
  settings.saveError = null;
  settings.dto = { ...dto };
  settings.info = null;
  await loadJobs([]);
});

describe('UpdateBanner status', () => {
  it('status가 있으면 그 문구와 눌리지 않는 [지금 업데이트], [나중에]·닫기는 없다. 퍼센트는 읽히지 않는다', async () => {
    const user = userEvent.setup();
    const oninstall = vi.fn();
    render(UpdateBanner, { version: '0.2.0', status: '업데이트 받는 중', detail: '42%', oninstall, onlater: vi.fn() });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('업데이트 받는 중 42%');
    expect(screen.getByText('42%', { exact: false })).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText(/새 버전/)).toBeNull();
    // Notice 동작 버튼은 aria-disabled를 줄 수 없어(Action에 disabled가 없다) 눌러도 아무 일이 없는 것으로 확인한다
    const btn = screen.getByRole('button', { name: '지금 업데이트' });
    await user.click(btn);
    expect(oninstall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '나중에' })).toBeNull();
    expect(screen.queryByRole('button', { name: '닫기' })).toBeNull();
  });

  it('busy면 [지금 업데이트]가 눌리지 않는다', async () => {
    const user = userEvent.setup();
    const oninstall = vi.fn();
    render(UpdateBanner, { version: '0.2.0', busy: true, oninstall, onlater: vi.fn() });
    await user.click(screen.getByRole('button', { name: '지금 업데이트' }));
    expect(oninstall).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '나중에' })).toBeInTheDocument();
  });
});

describe('B1은 이어받을 수 있는 작업만 센다(A5)', () => {
  it('다른 채널 작업은 세지 않는다', async () => {
    auth.apply({ ...authDto('signedIn'), channelId: 'a1', channelName: '내 채널' });
    await loadJobs([
      job(1, { status: 'interrupted', channelId: 'a1' }),
      job(2, { status: 'interrupted', channelId: 'c3' }),
    ]);
    render(AppBanners);
    expect(screen.getByText('지난번에 받다가 멈춘 다운로드가 1개 있어요.')).toBeInTheDocument();
  });

  it('다른 채널 작업만 남으면 배너가 없다', async () => {
    auth.apply({ ...authDto('signedIn'), channelId: 'a1', channelName: '내 채널' });
    await loadJobs([job(2, { status: 'interrupted', channelId: 'c3' })]);
    render(AppBanners);
    expect(screen.queryByRole('button', { name: '모두 이어받기' })).toBeNull();
  });
});

describe('AppBanners 순서', () => {
  it('B2(저장 실패)가 B1·B4보다 앞이다', async () => {
    await loadJobs([job(1, { status: 'interrupted' })]);
    settings.saveError = appError('settings');
    update.available = info('0.2.0');
    render(AppBanners);
    expect(screen.getByText(/설정을 저장하지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByText(/새 버전/)).toBeNull();
    expect(screen.queryByText(/멈춘/)).toBeNull();
  });

  it('B1(중단된 다운로드)이 B4보다 앞이다', async () => {
    await loadJobs([job(1, { status: 'interrupted' })]);
    update.available = info('0.2.0');
    render(AppBanners);
    expect(screen.getByRole('button', { name: '모두 이어받기' })).toBeInTheDocument();
    expect(screen.queryByText('새 버전 0.2.0이 있어요.')).toBeNull();
  });

  it('둘 다 없고 업데이트가 있으면 B4: [지금 업데이트]는 updateInstall(false), [나중에]는 숨김', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateInstall).mockResolvedValue({ result: 'restarting' });
    update.available = info('0.2.0');
    render(AppBanners);
    expect(screen.getByText('새 버전 0.2.0이 있어요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '지금 업데이트' }));
    expect(api.updateInstall).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByText('설치하고 다시 시작해요…')).toBeInTheDocument());
  });

  it('[나중에]를 누르면 배너가 사라진다', async () => {
    const user = userEvent.setup();
    update.available = info('0.2.0');
    render(AppBanners);
    await user.click(screen.getByRole('button', { name: '나중에' }));
    expect(screen.queryByText(/새 버전/)).toBeNull();
  });

  it('받는 중에는 진행 문구(퍼센트, 크기를 모르면 바이트)가 나오고 B1이 켜져도 가리지 않는다', async () => {
    await loadJobs([job(1, { status: 'interrupted' })]);
    update.available = info('0.2.0');
    update.phase = 'downloading';
    update.total = 200;
    update.received = 50;
    render(AppBanners);
    expect(screen.getByRole('status')).toHaveTextContent('업데이트 받는 중 25%');
    expect(screen.queryByRole('button', { name: '모두 이어받기' })).toBeNull();
    update.total = null;
    update.received = 2048;
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/업데이트 받는 중 2(\.0)? ?KB/i));
  });

  it('[지금 업데이트]를 누른 뒤 받는 중이 되어도 같은 버튼에 포커스가 남는다', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateInstall).mockImplementation(() => new Promise(() => {}));
    update.available = info('0.2.0');
    render(AppBanners);
    const btn = screen.getByRole('button', { name: '지금 업데이트' });
    await user.click(btn);
    expect(btn).toHaveFocus();
    await user.click(btn);
    expect(api.updateInstall).toHaveBeenCalledTimes(1);
    update.phase = 'downloading';
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('업데이트 받는 중'));
    expect(screen.getByRole('button', { name: '지금 업데이트' })).toBe(btn);
    expect(btn).toHaveFocus();
  });

  it('받는 중에 확인 결과가 available을 비워도 진행 배너가 남는다', async () => {
    update.available = info('0.2.0');
    update.installVersion = '0.2.0';
    update.phase = 'downloading';
    render(AppBanners);
    update.available = null;
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('업데이트 받는 중'));
  });
});

describe('UpdateDialog', () => {
  it('confirm 단계에서 제목·본문이 뜨고 처음 포커스는 [나중에], [업데이트하고 다시 시작]은 updateInstall(true)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateInstall).mockResolvedValue({ result: 'restarting' });
    update.available = info('0.2.0');
    update.confirmRunning = 2;
    update.phase = 'confirm';
    render(UpdateDialog);
    const d = await screen.findByRole('dialog', { name: '업데이트하고 다시 시작할까요?' });
    expect(within(d).getByText('받는 중인 영상 2개가 일시정지되고, 다시 시작한 뒤 이어받을 수 있어요.')).toBeInTheDocument();
    await waitFor(() => expect(within(d).getByRole('button', { name: '나중에' })).toHaveFocus());
    // 오른쪽(primary, 첫 포커스)이 안전한 [나중에], 왼쪽(secondary)이 실행 쪽
    expect(within(d).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['업데이트하고 다시 시작', '나중에']);
    expect(api.updateInstall).not.toHaveBeenCalled();
    await user.click(within(d).getByRole('button', { name: '업데이트하고 다시 시작' }));
    expect(api.updateInstall).toHaveBeenCalledWith(true);
  });

  it('Esc는 닫기(onclose)만 하고 설치하지 않는다', async () => {
    const user = userEvent.setup();
    update.phase = 'confirm';
    render(UpdateDialog);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(update.phase).toBe('idle');
    expect(api.updateInstall).not.toHaveBeenCalled();
  });

  it('[나중에]는 닫기만 한다', async () => {
    const user = userEvent.setup();
    update.phase = 'confirm';
    render(UpdateDialog);
    await user.click(await screen.findByRole('button', { name: '나중에' }));
    expect(update.phase).toBe('idle');
    expect(api.updateInstall).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// 설정 화면의 확인 결과 줄(<p role="status">). 접힌 쿠키 절의 Notice(.notice-text role=status)는 세지 않는다
const checkLine = () => screen.queryAllByRole('status').filter((el) => el.tagName === 'P');

describe('SettingsView 업데이트 확인', () => {
  it('로그인하지 않았으면 버튼이 없다', () => {
    auth.apply(authDto('disabled'));
    render(SettingsView);
    expect(screen.queryByRole('button', { name: '업데이트 확인' })).toBeNull();
  });

  it('로그인했으면 결과가 표대로 한 줄로 나온다', async () => {
    const user = userEvent.setup();
    auth.apply(authDto('signedIn'));
    render(SettingsView);
    expect(checkLine()).toEqual([]);

    vi.mocked(api.updateCheck).mockResolvedValueOnce({ result: 'upToDate' });
    await user.click(screen.getByRole('button', { name: '업데이트 확인' }));
    expect(await screen.findByText('최신 버전이에요')).toBeInTheDocument();

    vi.mocked(api.updateCheck).mockResolvedValueOnce({ result: 'offline' });
    await user.click(screen.getByRole('button', { name: '업데이트 확인' }));
    expect(await screen.findByText('로그인 서버에 연결할 수 없어 확인하지 못했어요.')).toBeInTheDocument();

    vi.mocked(api.updateCheck).mockResolvedValueOnce({ result: 'available', info: info('0.2.0') });
    await user.click(screen.getByRole('button', { name: '업데이트 확인' }));
    expect(await screen.findByText('새 버전 0.2.0이 있어요.')).toBeInTheDocument();

    vi.mocked(api.updateCheck).mockResolvedValueOnce({ result: 'failed' });
    await user.click(screen.getByRole('button', { name: '업데이트 확인' }));
    expect(await screen.findByText(/업데이트를 확인하지 못했어요/)).toBeInTheDocument();

    vi.mocked(api.updateCheck).mockResolvedValueOnce({ result: 'untrusted' });
    await user.click(screen.getByRole('button', { name: '업데이트 확인' }));
    expect(await screen.findByText('업데이트 주소를 확인할 수 없어 받지 않았어요.')).toBeInTheDocument();
  });

  it('확인 결과가 available인데 값이 비었으면 줄을 숨긴다', () => {
    auth.apply(authDto('signedIn'));
    update.check = 'available';
    update.available = null;
    render(SettingsView);
    expect(screen.queryByText(/새 버전/)).toBeNull();
    expect(checkLine()).toEqual([]);
  });

  it('확인하는 중에는 문구가 나오고 버튼이 눌리지 않는다', async () => {
    const user = userEvent.setup();
    auth.apply(authDto('signedIn'));
    let resolve: (v: { result: 'upToDate' }) => void = () => {};
    vi.mocked(api.updateCheck).mockImplementation(() => new Promise((r) => (resolve = r)));
    render(SettingsView);
    await user.click(screen.getByRole('button', { name: '업데이트 확인' }));
    expect(await screen.findByText('업데이트를 확인하는 중이에요…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '업데이트 확인' })).toBeDisabled();
    resolve({ result: 'upToDate' });
    expect(await screen.findByText('최신 버전이에요')).toBeInTheDocument();
  });
});
