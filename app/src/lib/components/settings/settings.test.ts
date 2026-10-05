import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, AppInfo, SettingsDto } from '../../bindings';

vi.mock('../../api', () => ({
  getSettings: vi.fn(),
  appInfo: vi.fn(),
  updateSettings: vi.fn(),
  setNaverCookies: vi.fn(),
  clearNaverCookies: vi.fn(),
  importLegacy: vi.fn(),
  pickFolder: vi.fn(),
  openAppFolder: vi.fn(),
}));

const api = await import('../../api');
const { settings } = await import('../../stores/settings.svelte');
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
  toasts.clear();
});

async function openCookies(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '고급: 네이버 로그인 정보' }));
}

describe('설정: 즉시 저장', () => {
  it('동시에 받는 영상 수·연결 수·자동 이어받기를 바꾸면 바로 저장한다', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    await user.selectOptions(screen.getByRole('combobox', { name: '동시에 받는 영상 수' }), '3');
    expect(api.updateSettings).toHaveBeenLastCalledWith({ maxParallelDownloads: 3 });
    await user.selectOptions(screen.getByRole('combobox', { name: '빠른 다시보기 연결 수' }), '8');
    expect(api.updateSettings).toHaveBeenLastCalledWith({ segmentConcurrency: 8 });
    const sw = screen.getByRole('switch', { name: '앱을 열면 멈춘 다운로드를 자동으로 이어받기' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(api.updateSettings).toHaveBeenLastCalledWith({ autoResumeInterrupted: true });
    expect(screen.getByRole('combobox', { name: '동시에 받는 영상 수' })).toHaveDisplayValue('3');
    expect(screen.getAllByRole('option', { name: /^\d$/ }).length).toBe(3 + 8);
  });

  it('설정 파일 저장 실패: B2 배너, 컨트롤은 저장된 값으로 돌아가고 [다시 시도]가 같은 패치를 보낸다', async () => {
    vi.mocked(api.updateSettings).mockRejectedValueOnce(appError('settings'));
    const user = userEvent.setup();
    render(SettingsView);
    const banner = within(render(AppBanners).container);
    await user.selectOptions(screen.getByRole('combobox', { name: '동시에 받는 영상 수' }), '1');
    expect(await banner.findByText('설정을 저장하지 못했어요. 디스크 공간과 권한을 확인해 주세요.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '동시에 받는 영상 수' })).toHaveDisplayValue('2'),
    );
    await user.click(banner.getByRole('button', { name: '설정 폴더 열기' }));
    expect(api.openAppFolder).toHaveBeenLastCalledWith('config');
    await user.click(banner.getByRole('button', { name: '다시 시도' }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ maxParallelDownloads: 1 });
    await waitFor(() => expect(screen.queryByText(/설정을 저장하지 못했어요/)).toBeNull());
  });

  it('입력 오류는 B2가 아니라 화면 안에 보인다', async () => {
    vi.mocked(api.pickFolder).mockResolvedValue('/x');
    vi.mocked(api.updateSettings).mockRejectedValueOnce(appError('invalidInput', { message: '절대 경로가 아닙니다' }));
    const user = userEvent.setup();
    render(SettingsView);
    await user.click(screen.getByRole('button', { name: '변경' }));
    expect(api.updateSettings).toHaveBeenLastCalledWith({ downloadFolder: '/x' });
    expect(await screen.findByText('입력한 값을 쓸 수 없어요')).toBeInTheDocument();
    expect(settings.saveError).toBeNull();
  });

  it('저장 폴더 열기·설정 폴더 열기·로그 폴더 열기, 버전', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    expect(screen.getByText('/Users/me/Movies/치지직')).toBeInTheDocument();
    expect(screen.getByText('버전 0.1.0 (코어 0.1.0)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '폴더 열기' }));
    await user.click(screen.getByRole('button', { name: '설정 폴더 열기' }));
    await user.click(screen.getByRole('button', { name: '로그 폴더 열기' }));
    expect(vi.mocked(api.openAppFolder).mock.calls).toEqual([['downloads'], ['config'], ['logs']]);
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
    expect(screen.getByText('저장됨')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '로그인 정보 사용' })).toHaveAttribute('aria-checked', 'true');

    await user.type(aut, 'AUTVALUE');
    await user.type(ses, 'SESVALUE');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(api.setNaverCookies).toHaveBeenCalledWith('AUTVALUE', 'SESVALUE');
    await waitFor(() => expect(aut).toHaveValue(''));
    expect(ses).toHaveValue('');
  });

  it('하나라도 비면 보내지 않고 두 값을 모두 넣으라고 한다', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    await openCookies(user);
    await user.type(screen.getByLabelText('NID_AUT', { selector: 'input' }), 'A');
    await user.click(screen.getByRole('button', { name: '저장' }));
    expect(api.setNaverCookies).not.toHaveBeenCalled();
    expect(screen.getByText('두 값을 모두 넣어 주세요')).toBeInTheDocument();
    expect(screen.getByLabelText('NID_SES', { selector: 'input' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('저장된 값이 없으면 사용 스위치와 지우기가 비활성, 지우기는 입력칸도 비운다', async () => {
    const user = userEvent.setup();
    render(SettingsView);
    await openCookies(user);
    expect(screen.getByText('저장된 값 없음')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '로그인 정보 사용' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '지우기' })).toBeDisabled();

    settings.dto = { ...base, naverCookiesSaved: true };
    vi.mocked(api.clearNaverCookies).mockResolvedValue({ ...base });
    const sw = await screen.findByRole('switch', { name: '로그인 정보 사용' });
    await waitFor(() => expect(sw).toBeEnabled());
    await user.click(sw);
    expect(api.updateSettings).toHaveBeenLastCalledWith({ useNaverCookies: true });
    await user.type(screen.getByLabelText('NID_AUT', { selector: 'input' }), 'x');
    await user.click(screen.getByRole('button', { name: '지우기' }));
    expect(api.clearNaverCookies).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('NID_AUT', { selector: 'input' })).toHaveValue(''));
    expect(screen.getByText('저장된 값 없음')).toBeInTheDocument();
  });

  it('오류 동작으로 들어오면 펼쳐져 있다', async () => {
    ui.openCookieSection = true;
    render(SettingsView);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '고급: 네이버 로그인 정보' })).toHaveAttribute('aria-expanded', 'true'),
    );
    expect(ui.openCookieSection).toBe(false);
  });
});

describe('이전 버전 가져오기', () => {
  it('폴더를 골라 가져오고 경고는 InlineAlert로 남긴다', async () => {
    vi.mocked(api.pickFolder).mockResolvedValue('D:\\tools\\chzzk');
    vi.mocked(api.importLegacy).mockResolvedValue({
      recentCount: 2,
      hasCookies: true,
      warnings: ['옛 파일에 평문 쿠키가 남아 있습니다'],
    });
    vi.mocked(api.getSettings).mockResolvedValue({ ...base, importedFrom: 'D:\\tools\\chzzk' });
    const user = userEvent.setup();
    render(SettingsView);
    await user.click(screen.getByRole('button', { name: '폴더 선택해서 가져오기' }));
    expect(api.importLegacy).toHaveBeenCalledWith('D:\\tools\\chzzk');
    expect(await screen.findByText('옛 파일에 평문 쿠키가 남아 있습니다')).toBeInTheDocument();
    expect(await screen.findByText('마지막 가져오기: D:\\tools\\chzzk')).toBeInTheDocument();
    expect(toasts.items.map((t) => t.message)).toEqual(['설정을 가져왔어요']);
  });

  it('찾지 못하면 알린다', async () => {
    vi.mocked(api.pickFolder).mockResolvedValue('/empty');
    vi.mocked(api.importLegacy).mockResolvedValue(null);
    const user = userEvent.setup();
    render(SettingsView);
    await user.click(screen.getByRole('button', { name: '폴더 선택해서 가져오기' }));
    await waitFor(() => expect(toasts.items.map((t) => t.message)).toEqual(['이 폴더에서 예전 설정을 찾지 못했어요']));
  });
});

describe('D3: 첫 실행에 이전 설정을 찾음', () => {
  it('가져오기는 후보를 적용하고, 경고는 설정 화면에 남는다', async () => {
    settings.info = { ...info, legacyCandidate: { dir: '/old', recentCount: 3, hasCookies: true } };
    vi.mocked(api.importLegacy).mockResolvedValue({ recentCount: 3, hasCookies: true, warnings: ['경고'] });
    vi.mocked(api.getSettings).mockResolvedValue({ ...base });
    const user = userEvent.setup();
    render(LegacyFound);
    const dialog = await screen.findByRole('dialog', { name: '이전 버전 설정을 찾았어요' });
    expect(
      within(dialog).getByText('예전 치지직 다운로더의 저장 폴더와 최근 VOD 3개, 네이버 로그인 정보를 가져올까요?'),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '가져오기' })).toHaveFocus());
    await user.click(within(dialog).getByRole('button', { name: '가져오기' }));
    expect(api.importLegacy).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(settings.legacyWarnings).toEqual(['경고']);
  });

  it('나중에는 아무것도 바꾸지 않고 닫는다', async () => {
    settings.info = { ...info, legacyCandidate: { dir: '/old', recentCount: 1, hasCookies: false } };
    const user = userEvent.setup();
    render(LegacyFound);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('예전 치지직 다운로더의 저장 폴더와 최근 VOD 1개를 가져올까요?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '나중에' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.importLegacy).not.toHaveBeenCalled();
  });
});
