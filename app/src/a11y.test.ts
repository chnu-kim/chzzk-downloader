// 접근성 점검(§10 "접근성·시각 기본", §15-17): 랜드마크, 이름 없는 버튼, 뷰 전환 뒤 포커스.
import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsDto } from './lib/bindings';
import { t } from './lib/copy/ko';
import { job, prog } from './test/jobFixtures';

class FakeChannel {
  onmessage: (e: unknown) => void = () => {};
}

const dto: SettingsDto = {
  downloadFolder: null,
  effectiveDownloadFolder: '/Movies/치지직',
  useNaverCookies: false,
  naverCookiesSaved: true,
  lastQualityLabel: null,
  lastUrl: null,
  recentVods: [{ url: 'https://chzzk.naver.com/video/1', title: '최근 영상', kind: 'rewind', date: null }],
  segmentConcurrency: 4,
  maxParallelDownloads: 2,
  autoResumeInterrupted: false,
  importedFrom: null,
  textScale: 'default',
  theme: 'system',
  keepAwake: true,
};

const disabled = {
  state: 'disabled',
  channelId: null,
  channelName: null,
  reason: null,
  pending: null,
  offline: null,
  verifiedAt: null,
  canReconnect: false,
  isAdmin: false,
};

vi.mock('./lib/api', () => ({
  Channel: FakeChannel,
  authStatus: vi.fn(async () => disabled),
  onAuthChanged: vi.fn(async () => () => {}),
  getSettings: vi.fn(async () => dto),
  appInfo: vi.fn(async () => ({
    version: '0.1.0',
    coreVersion: '0.1.0',
    configDir: '/c',
    dataDir: '/d',
    logDir: '/l',
    defaultDownloadFolder: '/Movies/치지직',
    features: { auth: false },
    legacyCandidate: null,
  })),
  subscribeJobs: vi.fn(async () => [
    job(1, { status: 'running', progress: prog() }),
    job(2, { status: 'paused', partialBytes: 100 }),
    job(3, { status: 'completed', finalBytes: 10 }),
    job(4, { status: 'interrupted' }),
  ]),
  clipboardLink: vi.fn(async () => null),
  onCloseRequested: vi.fn(async () => () => {}),
  onWindowFocus: vi.fn(async () => () => {}),
  onMenuSettings: vi.fn(async () => () => {}),
  onMenuAbout: vi.fn(async () => () => {}),
  onKeepAwake: vi.fn(async () => () => {}),
  updateCheck: vi.fn(),
  updateAvailable: vi.fn(async () => null),
  updateInstall: vi.fn(),
  onUpdateAvailable: vi.fn(async () => () => {}),
  onUpdateProgress: vi.fn(async () => () => {}),
}));

const { default: App } = await import('./App.svelte');
const { ui } = await import('./lib/stores/ui.svelte');
const { jobs } = await import('./lib/stores/jobs.svelte');
const { auth } = await import('./lib/stores/auth.svelte');
const api = await import('./lib/api');

beforeEach(() => {
  ui.goHome();
  auth.reset();
});

/** 접근 가능한 이름: aria-label, aria-labelledby, 아니면 글자 */
function nameOf(el: HTMLElement): string {
  const label = el.getAttribute('aria-label');
  if (label) return label;
  const by = el.getAttribute('aria-labelledby');
  if (by) return by.split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
  return (el.textContent ?? '').trim();
}

describe('접근성', () => {
  it('랜드마크와 목록 구획, 모든 버튼·스위치·진행 막대에 이름이 있다', async () => {
    const user = userEvent.setup();
    render(App);
    await screen.findByRole('article', { name: '영상 1' });
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: t('list.title') })).toBeInTheDocument();
    for (const el of [...screen.getAllByRole('button'), ...screen.getAllByRole('progressbar')]) {
      expect(nameOf(el), el.outerHTML).not.toBe('');
    }
    // 설정 화면도
    await user.click(await screen.findByRole('button', { name: t('header.settings') }));
    // 고급(Disclosure, 제목이 h2)을 펼쳐 쿠키 입력까지 이름을 본다
    await user.click(await screen.findByRole('heading', { name: t('settings.advanced') }));
    for (const el of [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('switch'),
      ...screen.getAllByRole('combobox'),
    ]) {
      expect(nameOf(el), el.outerHTML).not.toBe('');
    }
  });

  it('뷰가 바뀌면 포커스가 body로 떨어지지 않는다: 설정은 제목, 홈은 입력줄', async () => {
    const user = userEvent.setup();
    render(App);
    await user.click(await screen.findByRole('button', { name: '설정' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '설정' })).toHaveFocus());
    // [⚙]은 설정 화면에도 남아 현재 쪽임을 알린다
    expect(screen.getByRole('button', { name: '설정' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: '뒤로' }));
    await waitFor(() => expect(screen.getByLabelText('영상 주소')).toHaveFocus());
    // Esc로 돌아와도
    await user.click(screen.getByRole('button', { name: '설정' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '설정' })).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByLabelText('영상 주소')).toHaveFocus());
  });

  it('[목록에서 보기] 요청은 한 번만 쓰이고, D2는 뷰를 떠나면 닫힌다', async () => {
    const user = userEvent.setup();
    render(App);
    await screen.findByRole('article', { name: '영상 1' });
    jobs.reveal(2);
    await waitFor(() => expect(screen.getByRole('article', { name: '영상 2' })).toHaveFocus());
    await user.click(screen.getByRole('button', { name: '설정' }));
    await user.click(await screen.findByRole('button', { name: '뒤로' }));
    await waitFor(() => expect(screen.getByLabelText('영상 주소')).toHaveFocus());

    jobs.confirm = { id: 2, title: '영상 2', bytes: 600 * 1024 * 1024, running: false };
    expect(await screen.findByRole('dialog', { name: t('dialog.cancel.title', { title: '영상 2' }) })).toBeInTheDocument();
    ui.goSettings();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    ui.goHome();
    await screen.findByRole('article', { name: '영상 1' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('상태는 색만으로 말하지 않는다: 멈춤·완료 항목에 상태 문구가 글자로 있다', async () => {
    render(App);
    // 아이콘·막대 구성은 작업 행 테스트(jobs.test.ts, patterns.md §3.2 표)가 소유한다. 여기서는 글자가 있음을 본다
    const paused = await screen.findByRole('article', { name: '영상 2' });
    expect(within(paused).getByText(t('job.status.paused'), { exact: false })).toBeInTheDocument();
    const done = screen.getByRole('article', { name: '영상 3' });
    expect(within(done).getByText(t('job.status.completed'), { exact: false })).toBeInTheDocument();
    // 재시작 직후 배너(B1)는 열의 첫 요소
    expect(screen.getByText(t('banner.interrupted', { n: 1 }))).toBeInTheDocument();
  });

  it('로그인 화면에도 main 랜드마크가 있고 모든 버튼에 이름이 있다', async () => {
    vi.mocked(api.authStatus).mockResolvedValueOnce({ ...disabled, state: 'signedOut' } as never);
    render(App);
    await screen.findByRole('heading', { name: t('auth.signedOut.title') });
    expect(screen.getByRole('main')).toBeInTheDocument();
    for (const el of screen.getAllByRole('button')) expect(nameOf(el), el.outerHTML).not.toBe('');
  });
});
