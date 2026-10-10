import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, AuthStatusDto, JobDto, SettingsDto, UpdateInfoDto } from '../../bindings';
import { t } from '../../copy/ko';
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
const { default: AppBanners, pickBanner } = await import('./AppBanners.svelte');
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
  isAdmin: false,
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
  textScale: 'default',
  theme: 'system',
  keepAwake: true,
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
  it('status가 있으면 그 문구와 눌리지 않는 [지금 업데이트], [나중에]·닫기는 없다. 정확한 퍼센트는 읽히지 않는다', async () => {
    const user = userEvent.setup();
    const oninstall = vi.fn();
    render(UpdateBanner, {
      version: '0.2.0',
      status: t('update.downloading', { percent: '25%' }),
      shown: t('update.downloading', { percent: '42%' }),
      oninstall,
      onlater: vi.fn(),
    });
    const status = screen.getByRole('status');
    // 화면에는 정확한 값이 보이고(aria-hidden), 라이브로 읽히는 글은 25% 단위다
    expect(screen.getByText(t('update.downloading', { percent: '42%' }))).toHaveAttribute('aria-hidden', 'true');
    expect(status).toHaveTextContent(t('update.downloading', { percent: '25%' }));
    expect(status.querySelector('.sr-only')).not.toHaveTextContent('42%');
    expect(screen.queryByText(/새 버전/)).toBeNull();
    // 진행 중 버튼은 loading: aria-disabled·aria-busy라 포커스는 남고 눌러도 아무 일이 없다
    const btn = screen.getByRole('button', { name: '지금 업데이트' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('aria-busy', 'true');
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
    expect(screen.getByRole('button', { name: '지금 업데이트' })).toHaveAttribute('aria-disabled', 'true');
    // [나중에]는 [×]와 같은 일이라 없고 닫기는 남는다
    expect(screen.queryByRole('button', { name: '나중에' })).toBeNull();
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();
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
    expect(screen.getByText(t('banner.interrupted', { n: 1 }))).toBeInTheDocument();
  });

  it('다른 채널 작업만 남으면 배너가 없다', async () => {
    auth.apply({ ...authDto('signedIn'), channelId: 'a1', channelName: '내 채널' });
    await loadJobs([job(2, { status: 'interrupted', channelId: 'c3' })]);
    render(AppBanners);
    expect(screen.queryByRole('button', { name: '모두 이어받기' })).toBeNull();
  });
});

describe('배너 우선순위 표(patterns.md §1.4)', () => {
  const none = {
    settingsError: false,
    updateFailure: false,
    updateBusy: false,
    engineOld: false,
    interrupted: false,
    updateAvailable: false,
  };

  // B2 → B4 실패 → B4 진행 → (B5 자리) → 엔진 미달 경고 → B1 → B4 새 버전. 켜진 조합 전부에서 하나만 고른다
  it('아무것도 없으면 null, 하나만 켜지면 그 배너', () => {
    expect(pickBanner(none)).toBeNull();
    expect(pickBanner({ ...none, settingsError: true })).toBe('settings');
    expect(pickBanner({ ...none, updateFailure: true })).toBe('updateFailed');
    expect(pickBanner({ ...none, updateBusy: true })).toBe('update');
    expect(pickBanner({ ...none, engineOld: true })).toBe('engine');
    expect(pickBanner({ ...none, interrupted: true })).toBe('interrupted');
    expect(pickBanner({ ...none, updateAvailable: true })).toBe('update');
  });

  it('모든 켜짐 조합에서 순서가 표대로다', () => {
    const order: [keyof typeof none, string][] = [
      ['settingsError', 'settings'],
      ['updateFailure', 'updateFailed'],
      ['updateBusy', 'update'],
      ['engineOld', 'engine'],
      ['interrupted', 'interrupted'],
      ['updateAvailable', 'update'],
    ];
    const keys = order.map(([k]) => k);
    for (let mask = 1; mask < 1 << keys.length; mask++) {
      const on = keys.filter((_, i) => mask & (1 << i));
      const state = { ...none, ...Object.fromEntries(on.map((k) => [k, true])) };
      const first = order.find(([k]) => on.includes(k))!;
      expect(pickBanner(state), on.join('+')).toBe(first[1]);
    }
  });
});

describe('B4 실패 배너', () => {
  it('failed: warning 배너(지금 버전은 계속 쓸 수 있다)에 [다시 시도]·[×]. 다시 시도는 install을 부른다', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateInstall).mockResolvedValue({ result: 'restarting' });
    update.available = info('0.2.0');
    update.failure = 'failed';
    const { container } = render(AppBanners);
    expect(screen.getByText(t('update.failed'))).toBeInTheDocument();
    expect(container.querySelector('.notice-banner')).toHaveClass('tone-warning');
    // 실패 배너가 새 버전 배너보다 앞이다(둘이 함께 보이지 않는다)
    expect(screen.queryByText(t('update.banner', { version: '0.2.0' }))).toBeNull();
    await user.click(screen.getByRole('button', { name: t('action.retry') }));
    expect(api.updateInstall).toHaveBeenCalledWith(false);
    expect(update.failure).toBeNull();
  });

  it('[×]는 실패 배너를 닫고 새 버전 배너가 뒤를 잇는다', async () => {
    const user = userEvent.setup();
    update.available = info('0.2.0');
    update.failure = 'failed';
    render(AppBanners);
    await user.click(screen.getByRole('button', { name: t('common.close') }));
    expect(update.failure).toBeNull();
    expect(screen.getByText(t('update.banner', { version: '0.2.0' }))).toBeInTheDocument();
  });

  it('untrusted: danger, 다시 시도 없음', () => {
    update.failure = 'untrusted';
    const { container } = render(AppBanners);
    expect(screen.getByText(t('update.untrusted'))).toBeInTheDocument();
    expect(container.querySelector('.notice-banner')).toHaveClass('tone-danger');
    expect(screen.queryByRole('button', { name: t('action.retry') })).toBeNull();
  });

  it('B2가 실패 배너보다 앞이고, 실패 배너가 진행·B1·새 버전보다 앞이다', async () => {
    await loadJobs([job(1, { status: 'interrupted' })]);
    update.available = info('0.2.0');
    update.failure = 'failed';
    settings.saveError = appError('settings');
    const { unmount } = render(AppBanners);
    expect(screen.getByText(/설정을 저장하지 못했어요/)).toBeInTheDocument();
    expect(screen.queryByText(t('update.failed'))).toBeNull();
    unmount();
    settings.saveError = null;
    render(AppBanners);
    expect(screen.getByText(t('update.failed'))).toBeInTheDocument();
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
    expect(screen.queryByText(t('update.banner', { version: '0.2.0' }))).toBeNull();
  });

  it('둘 다 없고 업데이트가 있으면 B4: [지금 업데이트]는 updateInstall(false), [×]는 숨김', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateInstall).mockResolvedValue({ result: 'restarting' });
    update.available = info('0.2.0');
    render(AppBanners);
    expect(screen.getByText(t('update.banner', { version: '0.2.0' }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '지금 업데이트' }));
    expect(api.updateInstall).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByText(t('update.installing'))).toBeInTheDocument());
  });

  it('[×]를 누르면 배너가 사라진다', async () => {
    const user = userEvent.setup();
    update.available = info('0.2.0');
    render(AppBanners);
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByText(/새 버전/)).toBeNull();
  });

  it('받는 중에는 진행 문구(퍼센트, 크기를 모르면 바이트)가 나오고 B1이 켜져도 가리지 않는다', async () => {
    await loadJobs([job(1, { status: 'interrupted' })]);
    update.available = info('0.2.0');
    update.phase = 'downloading';
    update.total = 200;
    update.received = 90;
    render(AppBanners);
    // 화면은 정확한 45%, 읽히는 글은 25% 단위
    expect(screen.getByRole('status')).toHaveTextContent(t('update.downloading', { percent: '45%' }));
    expect(screen.getByRole('status').querySelector('.sr-only')).toHaveTextContent(t('update.downloading', { percent: '25%' }));
    expect(screen.queryByRole('button', { name: '모두 이어받기' })).toBeNull();
    update.total = null;
    update.received = 2048;
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t('update.downloading', { percent: '2.05KB' })));
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
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t('update.downloading', { percent: '0B' })));
    expect(screen.getByRole('button', { name: '지금 업데이트' })).toBe(btn);
    expect(btn).toHaveFocus();
  });

  it('받는 중에 확인 결과가 available을 비워도 진행 배너가 남는다', async () => {
    update.available = info('0.2.0');
    update.installVersion = '0.2.0';
    update.phase = 'downloading';
    render(AppBanners);
    update.available = null;
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t('update.downloading', { percent: '0B' })));
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
    expect(within(d).getByText(t('dialog.update.body', { n: 2 }))).toBeInTheDocument();
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
    expect(await screen.findByText(t('update.banner', { version: '0.2.0' }))).toBeInTheDocument();

    vi.mocked(api.updateCheck).mockResolvedValueOnce({ result: 'failed' });
    await user.click(screen.getByRole('button', { name: '업데이트 확인' }));
    expect(await screen.findByText(t('settings.about.checkFailed'), { exact: false })).toBeInTheDocument();

    vi.mocked(api.updateCheck).mockResolvedValueOnce({ result: 'untrusted' });
    await user.click(screen.getByRole('button', { name: '업데이트 확인' }));
    expect(await screen.findByText(t('update.untrusted'))).toBeInTheDocument();
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
    expect(await screen.findByText(t('settings.about.checking'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '업데이트 확인' })).toBeDisabled();
    resolve({ result: 'upToDate' });
    expect(await screen.findByText('최신 버전이에요')).toBeInTheDocument();
  });
});
