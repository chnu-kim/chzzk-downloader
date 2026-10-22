import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { AppError, OutputCheck, RecentVodDto, SettingsDto } from '../../bindings';
import { check, liveResolved, quality, resolved, vodResolved } from '../../../test/fixtures';
import { signedInAs } from '../../../test/jobFixtures';
import { errorCopy, helpLinkLabel } from '../../copy/errors';
import { t } from '../../copy/ko';
import { shortcutText } from '../../platform';
import { CHECK_DEBOUNCE_MS, qualitySize } from '../../receive';
import { LOADER_DELAY_MS } from '../../timing';

vi.mock('../../api', () => ({
  resolve: vi.fn(),
  ownershipRecheck: vi.fn(),
  checkOutput: vi.fn(),
  enqueue: vi.fn(),
  clipboardLink: vi.fn(),
  pickFolder: vi.fn(),
  updateSettings: vi.fn(),
  getSettings: vi.fn(),
  appInfo: vi.fn(),
  openWebPage: vi.fn(),
  watchOpen: vi.fn(),
  watchClose: vi.fn(),
  openContentPage: vi.fn(),
}));

// hls.js/light 흉내(PV-7 찍기 테스트용): 실제 MSE 없이 붙고 떼는 것만 받는다
vi.mock('hls.js/light', () => ({
  default: class FakeHls {
    static isSupported = () => true;
    static Events = { ERROR: 'hlsError' };
    on() {}
    loadSource() {}
    attachMedia() {}
    destroy() {}
  },
}));

const api = await import('../../api');
const { resolver } = await import('../../stores/resolve.svelte');
const { settings } = await import('../../stores/settings.svelte');
const { ui } = await import('../../stores/ui.svelte');
const { auth } = await import('../../stores/auth.svelte');
const { platform } = await import('../../stores/platform.svelte');
const { default: InputPanel } = await import('./InputPanel.svelte');
const { default: GlobalShortcuts } = await import('../app/GlobalShortcuts.svelte');

const settingsDto: SettingsDto = {
  downloadFolder: null,
  effectiveDownloadFolder: '/Users/me/Movies/VOD Clip Downloader',
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
  embedMetadata: true,
  saveChat: false,
  chatSubtitle: 'ass',
  fileNameTemplate: null,
  totalRateLimit: null,
  jobRateLimit: null,
};

function appError(code: AppError['code'], over: Partial<AppError> = {}): AppError {
  return { code, message: code, stage: null, resumable: false, payload: null, ...over };
}

function setCheck(c: Partial<OutputCheck> = {}) {
  vi.mocked(api.checkOutput).mockResolvedValue(check(c));
}

const urlInput = () => screen.getByLabelText(t('url.label'));
/** 카드 바닥 줄·머리 줄(둘 다 [닫기]가 있어 이름만으로는 하나로 좁혀지지 않는다) */
const cardFooter = () => within(document.querySelector('.card-footer') as HTMLElement);
const cardHeader = () => within(document.querySelector('.card-header') as HTMLElement);
const downloadName = () => t('card.download');
const resolveErrorTitle = (e: AppError) => errorCopy(e, { place: 'resolve', cookiesEnabled: false }).title;

async function openCard(over = {}) {
  vi.mocked(api.resolve).mockResolvedValue(resolved(over));
  const user = userEvent.setup();
  render(InputPanel);
  await user.type(urlInput(), 'https://chzzk.naver.com/video/1234567{Enter}');
  await screen.findByRole('heading', { name: '금요 노가리 방송 - 신작 게임 해보기' });
  return user;
}

/** 섹션 머리: 빠른 다시보기는 "미리보기·구간", 일반 VOD·클립은 "미리보기" */
const sectionHead = () => document.querySelector('.watch summary') as HTMLElement;

/** 미리보기를 펼치고 [영상 보기]를 눌러 세션을 연다(PS-2: 펼치기만으로는 watch_open을 부르지 않는다). video가 뜰 때까지 기다린다 */
async function startWatch(user: ReturnType<typeof userEvent.setup>, toggle?: HTMLElement) {
  // 섹션은 기본 펼침이다(PS8): 접혀 있을 때만 머리를 눌러 편다
  const head = toggle ?? sectionHead();
  if (!head.closest('details')!.hasAttribute('open')) await user.click(head);
  await user.click(screen.getByRole('button', { name: /영상 보기/ }));
  await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
}

/** primary 버튼에는 disabled가 없다(Button 타입). 못 받는 동안은 aria-disabled="true"다 */
function expectBlocked(btn: HTMLElement) {
  expect(btn).toHaveAttribute('aria-disabled', 'true');
}

async function downloadButton() {
  const btn = screen.getByRole('button', { name: downloadName() });
  await waitFor(() => expect(btn).not.toHaveAttribute('aria-disabled', 'true'));
  return btn;
}

beforeEach(() => {
  ui.previewOpen = true; // 섹션 열림은 앱 메모리에 남으니 시험마다 기본(펼침)으로 되돌린다
  vi.mocked(api.resolve).mockReset();
  vi.mocked(api.ownershipRecheck).mockReset();
  vi.mocked(api.checkOutput).mockReset();
  vi.mocked(api.enqueue).mockReset().mockResolvedValue({} as never);
  vi.mocked(api.clipboardLink).mockReset().mockResolvedValue(null);
  vi.mocked(api.pickFolder).mockReset();
  vi.mocked(api.updateSettings).mockReset();
  vi.mocked(api.getSettings).mockReset().mockResolvedValue(settingsDto);
  vi.mocked(api.watchOpen)
    .mockReset()
    .mockResolvedValue({ id: 'ab'.repeat(16), kind: 'mp4', src: `watch://localhost/${'ab'.repeat(16)}/v` });
  vi.mocked(api.watchClose).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(api.openContentPage).mockReset().mockResolvedValue(undefined as never);
  resolver.finish();
  settings.dto = { ...settingsDto };
  setCheck();
});

afterEach(() => {
  platform.set('linux');
});

describe('UrlBar', () => {
  it('네이티브 E2E 훅: 입력칸 id는 url-input이다', () => {
    render(InputPanel);
    expect(urlInput().id).toBe('url-input');
  });

  it('invalidUrl: 입력을 지우지 않고 오류 문구와 aria-invalid', async () => {
    vi.mocked(api.resolve).mockRejectedValue(appError('invalidUrl'));
    const user = userEvent.setup();
    render(InputPanel);
    const input = urlInput();
    await user.type(input, 'https://chzzk.naver.com/live/abcd{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(resolveErrorTitle(appError('invalidUrl')));
    expect(input).toHaveValue('https://chzzk.naver.com/live/abcd');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // 오류 입력칸은 설명 요소(오류 알림)를 aria-describedby로 잇는다
    expect(input).toHaveAttribute('aria-describedby', 'resolve-error');
    expect(document.getElementById('resolve-error')).toContainElement(alert);
    expect(api.resolve).toHaveBeenCalledWith('https://chzzk.naver.com/live/abcd');
    // §9 "입력 선택": 입력 전체가 골라져 있다
    const el = input as HTMLInputElement;
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, el.value.length]);

    // 입력칸이 행동이라 버튼이 없다(content.md §15.2 `invalidUrl`: 유일한 예외)
    expect(screen.queryByRole('button', { name: t('action.retry') })).toBeNull();
  });

  it('요청이 몰린 오류의 [다시 시도]는 같은 주소로 다시 부른다', async () => {
    vi.mocked(api.resolve).mockRejectedValue(
      appError('http', { payload: { type: 'http', status: 429, requestKind: 'api' } }),
    );
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/video/7{Enter}');
    // 동작 버튼은 라이브 영역(.notice-text) 밖에 있다
    await user.click(await screen.findByRole('button', { name: t('action.retry') }));
    expect(api.resolve).toHaveBeenCalledTimes(2);
    expect(api.resolve).toHaveBeenLastCalledWith('https://chzzk.naver.com/video/7');
  });

  it('오류를 [닫기]로 닫으면 포커스가 입력줄로 돌아온다', async () => {
    vi.mocked(api.resolve).mockRejectedValue(
      appError('http', { payload: { type: 'http', status: 404, requestKind: 'api' } }),
    );
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/video/1{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).not.toContainElement(screen.getByRole('button', { name: t('common.close') }));
    await user.click(screen.getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(urlInput()).toHaveFocus());
  });

  it('빈 칸에 붙여넣으면 바로 불러온다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    const user = userEvent.setup();
    render(InputPanel);
    await user.click(urlInput());
    await user.paste('https://chzzk.naver.com/video/9');
    expect(api.resolve).toHaveBeenCalledWith('https://chzzk.naver.com/video/9');
  });

  it('불러오는 중 Esc로 취소하면 늦게 온 결과를 버린다', async () => {
    let finish!: (v: ReturnType<typeof resolved>) => void;
    vi.mocked(api.resolve).mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    const { container } = render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/video/1{Enter}');
    // 불러오는 중은 즉시 입력줄(form)이 aria-busy다(스피너·한 줄은 300ms 뒤)
    expect(container.querySelector('form[aria-busy="true"]')).not.toBeNull();
    // Esc 키는 GlobalShortcuts가 ui.escape()로 넘긴다(그 연결은 shortcuts.test.ts). 여기서는 InputPanel이 쌓은 처리기를 본다.
    expect(ui.escape()).toBe(true);
    expect(resolver.state.kind).toBe('idle');
    finish(resolved());
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull();
    expect(urlInput()).toHaveValue('https://chzzk.naver.com/video/1');
  });
});

describe('ResolveCard', () => {
  it('기본 화질은 defaultQualityIndex, 메타·예상 크기를 보인다', async () => {
    await openCard({ defaultQualityIndex: 1 });
    const radios = screen.getAllByRole('radio');
    expect(radios[1]).toBeChecked();
    expect(radios[1].closest('label')).toHaveTextContent('720p');
    expect(screen.getByText(t('meta.liveDate', { date: '2026. 10. 3. 오후 9:00' }))).toBeInTheDocument();
    expect(screen.getByText(t('kind.liveRewind'))).toBeInTheDocument();
    // 4 Mbps × 11565초 / 8
    expect(radios[1].closest('label')).toHaveTextContent('약 5.8GB');
    expect(screen.getByRole('heading', { name: /금요/ })).toHaveFocus();
  });

  it('Esc(ui.escape)는 카드를 닫고 포커스를 입력줄로 돌린다', async () => {
    await openCard();
    expect(screen.getByRole('heading', { name: /금요/ })).toHaveFocus();
    expect(ui.escape()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    expect(resolver.state.kind).toBe('idle');
    await waitFor(() => expect(urlInput()).toHaveFocus());
  });

  it('카드 바닥 [닫기]와 머리 [×]는 포커스를 입력줄로 돌린다', async () => {
    const user = await openCard();
    await user.click(cardFooter().getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(urlInput()).toHaveFocus());

    await user.click(screen.getByRole('button', { name: t('common.load') }));
    await screen.findByRole('heading', { name: /금요/ });
    await user.click(cardHeader().getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    await waitFor(() => expect(urlInput()).toHaveFocus());
  });

  it('머리는 h2 `card.title`, 영상 제목은 h3이고 열리면 영상 제목에 포커스', async () => {
    await openCard();
    expect(cardHeader().getByRole('heading', { level: 2, name: t('card.title') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /금요/ })).toHaveFocus();
    // 카드 section의 class에 `card`가 남는다(e2e-native XPATH가 찾는다, J25)
    expect(screen.getByRole('region', { name: /금요/ }).className).toMatch(/card/);
  });

  it('[받기]는 글자만이고 download 아이콘이 없다(foundations §9.1)', async () => {
    await openCard();
    expect(screen.getByRole('button', { name: downloadName() }).querySelector('svg, .icon')).toBeNull();
  });

  it('파일 이름을 바꾸면 [원래 이름으로]가 나타나 되돌리고, 원래 이름이면 보이지 않는다', async () => {
    const user = await openCard();
    const reset = () => screen.queryByRole('button', { name: t('filename.reset') });
    expect(reset()).toBeNull();
    const name = screen.getByLabelText(t('filename.label')) as HTMLInputElement;
    const original = name.value;
    await user.clear(name);
    await user.type(name, '새 이름');
    const btn = reset()!;
    expect(btn).toHaveClass('btn-ghost', 'btn-sm', 'edge-end');
    await user.click(btn);
    expect(name.value).toBe(original);
    expect(reset()).toBeNull();
  });

  it('다운로드 버튼 이름에 단축키 표시가 들어가지 않는다', async () => {
    await openCard();
    expect(screen.getByRole('button', { name: downloadName() })).toBeInTheDocument();
  });

  it('충돌 없음 → 검사 결과가 온 뒤 다운로드, 카드를 접고 입력줄로', async () => {
    const user = await openCard();
    await user.click(await downloadButton());
    expect(api.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        qualityId: 'q1080',
        fileName: check().fileName,
        restart: false,
        onExisting: 'skip',
        // 최근 영상 둘째 줄의 날짜: 방송 날짜가 있으면 그것(없으면 공개 날짜)
        contentDate: '2026-10-03 21:00:00',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    expect(urlInput()).toHaveValue('');
    expect(urlInput()).toHaveFocus();
  });

  it('완성 파일: 번호 붙이기(기본) → freeFileName, 덮어쓰기 → 같은 이름', async () => {
    setCheck({ exists: true, freeFileName: '[251003] 채널이름 - 금요 노가리 방송 (2)' });
    const user = await openCard();
    expect(await screen.findByText(t('conflict.exists'))).toBeInTheDocument();
    expect(screen.getByLabelText(t('conflict.number'))).toBeChecked();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({
      fileName: '[251003] 채널이름 - 금요 노가리 방송 (2)',
      onExisting: 'skip',
    });
  });

  it('완성 파일: 같은 이름 안내는 warning Notice 안 라디오이고 role=alert가 아니다', async () => {
    setCheck({ exists: true, freeFileName: 'x (2)' });
    await openCard();
    const title = await screen.findByText(t('conflict.exists'));
    const notice = title.closest('.notice') as HTMLElement;
    expect(notice).toHaveClass('tone-warning');
    expect(within(notice).getAllByRole('radio')).toHaveLength(2);
    expect(notice.querySelector('[role="alert"]')).toBeNull();
  });

  it('D7: 덮어쓰기를 고르면 [받기]가 확인을 열고, 확인해야 onExisting overwrite로 등록한다', async () => {
    setCheck({ exists: true, freeFileName: 'x (2)' });
    const user = await openCard();
    await user.click(await screen.findByLabelText(t('conflict.overwrite')));
    await user.click(await downloadButton());
    // 확인 전에는 등록하지 않는다. 대화상자의 이름은 저장될 파일 이름 + 확장자다
    expect(api.enqueue).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', {
      name: t('dialog.overwrite.title', { name: `${check().fileName}.mp4` }),
    });
    await user.click(within(dialog).getByRole('button', { name: t('dialog.overwrite.confirm') }));
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({
      fileName: check().fileName,
      restart: false,
      onExisting: 'overwrite',
    });
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
  });

  it('D7: [그대로 두기]면 등록하지 않고 카드는 그대로 남는다', async () => {
    setCheck({ exists: true, freeFileName: 'x (2)' });
    const user = await openCard();
    await user.click(await screen.findByLabelText(t('conflict.overwrite')));
    await user.click(await downloadButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: t('dialog.cancel.keepPaused') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.enqueue).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /금요/ })).toBeInTheDocument();
  });

  it('번호 붙이기(기본)면 확인 없이 곧바로 등록한다', async () => {
    setCheck({ exists: true, freeFileName: 'x (2)' });
    const user = await openCard();
    await user.click(await downloadButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.enqueue).toHaveBeenCalledTimes(1);
  });

  it('같은 작업의 .part: 기본 이어받기, [처음부터 받기]면 restart', async () => {
    setCheck({ partial: { bytes: 1288490188, sameJob: true, recording: false } });
    const user = await openCard();
    expect(await screen.findByText(t('conflict.partial.title'))).toBeInTheDocument();
    expect(screen.getByText(t('conflict.partial.body', { size: '1.29GB' }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('action.restartFresh') }));
    expect(screen.getByText(t('conflict.partial.freshChosen'))).toBeInTheDocument();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ restart: true });
  });

  it('다른 .part: 안내만, restart=false', async () => {
    setCheck({ partial: { bytes: 10, sameJob: false, recording: false } });
    const user = await openCard();
    expect(await screen.findByText(t('conflict.partialOther'))).toBeInTheDocument();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ restart: false });
  });

  it('받다 만 녹화: 안내만 띄우고 번호 이름으로, 처음부터·이어받기 선택은 없다', async () => {
    setCheck({
      partial: { bytes: 10, sameJob: false, recording: true },
      freeFileName: 'x (2)',
    });
    const user = await openCard();
    expect(await screen.findByText(t('conflict.partialRecording.title'))).toBeInTheDocument();
    expect(screen.getByText(t('conflict.partialRecording.body', { name: 'x (2)' }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('action.restartFresh') })).toBeNull();
    expect(screen.queryByText(t('conflict.partialOther'))).toBeNull();
    await user.click(await downloadButton());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ fileName: 'x (2)', restart: false });
  });

  it('목록에 같은 파일이 있으면 [받기]를 막고 사유 문장을 aria-describedby로 잇는다', async () => {
    setCheck({ duplicateJobId: 7 });
    const user = await openCard();
    const reason = await screen.findByText(t('conflict.inQueue'));
    const btn = screen.getByRole('button', { name: downloadName() });
    expectBlocked(btn);
    const id = btn.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).toContainElement(reason);
    expect(btn).toHaveAccessibleDescription(new RegExp(t('conflict.inQueue')));
    // 막힌 동안 눌러도 등록하지 않고, [목록에서 보기]는 그 작업으로 안내한다
    await user.click(btn);
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('[받기]에는 Mod+Enter가 같은 길이다(조합 중이면 무시)', async () => {
    const user = await openCard();
    await downloadButton();
    // 조합 중 Enter는 무시한다(G-IME-R4)
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(api.enqueue).not.toHaveBeenCalled();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
  });

  it('꼬리표 `quality.best`는 가장 높은 화질 행에만 붙고 기본 선택과 무관하다', async () => {
    await openCard({ defaultQualityIndex: 1 });
    const radios = screen.getAllByRole('radio');
    expect(radios[1]).toBeChecked();
    expect(screen.getAllByText(t('quality.best'))).toHaveLength(1);
    expect(radios[0].closest('label')).toHaveTextContent(t('quality.best'));
    expect(radios[1].closest('label')).not.toHaveTextContent(t('quality.best'));
  });

  describe('오디오만 행(일반 VOD에 서버 오디오 트랙이 있을 때)', () => {
    /** 오디오 행: 라디오가 속한 라벨 */
    const audioRow = () => screen.getAllByRole('radio')[2].closest('label') as HTMLElement;

    it('맨 끝 행에 "오디오만"과 예상 크기, 꼬리표(fps·가장 좋은 화질)는 없다', async () => {
      await openCard(vodResolved());
      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(3);
      // 코어 라벨 "audio"가 아니라 deck 문구
      expect(audioRow()).toHaveTextContent(t('quality.audioOnly'));
      expect(audioRow()).not.toHaveTextContent('audio');
      // 128kbps × 11565초 / 8
      expect(audioRow()).toHaveTextContent('약 185.0MB');
      expect(audioRow()).not.toHaveTextContent(t('quality.best'));
      expect(audioRow()).not.toHaveTextContent('fps');
      // 꼬리표는 비디오 행 하나에만, 기본 선택도 비디오다
      expect(screen.getAllByText(t('quality.best'))).toHaveLength(1);
      expect(radios[0].closest('label')).toHaveTextContent(t('quality.best'));
      expect(radios[2]).not.toBeChecked();
    });

    it('고르면 이름 칸 확장자가 .m4a가 되고, 검사는 audio로 다시 부른다', async () => {
      const user = await openCard(vodResolved());
      const ext = () => document.querySelector('.ext') as HTMLElement;
      expect(ext()).toHaveTextContent('.mp4');
      await user.click(screen.getAllByRole('radio')[2]);
      expect(ext()).toHaveTextContent('.m4a');
      await waitFor(() => expect(vi.mocked(api.checkOutput).mock.lastCall?.[0]).toMatchObject({ qualityId: 'audio' }));
      // 비디오로 돌아오면 다시 .mp4
      await user.click(screen.getAllByRole('radio')[1]);
      expect(ext()).toHaveTextContent('.mp4');
    });

    it('[받기]는 화질 키 audio와 문구 deck 라벨로 등록한다', async () => {
      const user = await openCard(vodResolved());
      await user.click(screen.getAllByRole('radio')[2]);
      await user.click(await downloadButton());
      expect(api.enqueue).toHaveBeenCalledTimes(1);
      expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({
        qualityId: 'audio',
        qualityLabel: t('quality.audioOnly'),
        expectedKind: 'progressive',
      });
    });

    it('덮어쓰기 확인의 이름도 .m4a다', async () => {
      setCheck({ exists: true, freeFileName: 'x (2)' });
      const user = await openCard(vodResolved());
      await user.click(screen.getAllByRole('radio')[2]);
      await user.click(await screen.findByLabelText(t('conflict.overwrite')));
      await user.click(await downloadButton());
      const dialog = await screen.findByRole('dialog', {
        name: t('dialog.overwrite.title', { name: `${check().fileName}.m4a` }),
      });
      expect(dialog).toBeInTheDocument();
    });

    it('오디오 행이 없는 카드(빠른 다시보기)는 화질 3개, 확장자 .mp4 그대로', async () => {
      await openCard();
      expect(screen.getAllByRole('radio')).toHaveLength(3);
      expect(screen.queryByText(t('quality.audioOnly'))).toBeNull();
      expect(document.querySelector('.ext')).toHaveTextContent('.mp4');
    });

    it('오디오 행은 구간(빠른 다시보기만)과 한 카드에 나오지 않는다', async () => {
      await openCard(vodResolved());
      expect(screen.queryByRole('textbox', { name: t('range.start') })).toBeNull();
    });

    it('클립 카드는 오디오 행이 없다', async () => {
      await openCard({
        content: { kind: 'clip', clipId: 'abc' },
        meta: { ...resolved().meta, kind: 'clip' },
        playbackKind: 'progressive',
        qualities: [quality(), quality({ id: 'q720', label: '720p', resolution: 720 })],
      });
      expect(screen.queryByText(t('quality.audioOnly'))).toBeNull();
    });
  });

  it('꼬리표는 목록 순서가 아니라 해상도로 고른다', async () => {
    await openCard({
      qualities: [
        quality({ id: 'q480', label: '480p', resolution: 480 }),
        quality({ id: 'q1080', label: '1080p', resolution: 1080 }),
        quality({ id: 'q720', label: '720p', resolution: 720 }),
      ],
    });
    const radios = screen.getAllByRole('radio');
    expect(radios[1].closest('label')).toHaveTextContent(t('quality.best'));
    expect(screen.getAllByText(t('quality.best'))).toHaveLength(1);
  });

  it('화질은 네이티브 라디오다: 같은 이름 하나, 방향키로 바로 고른다', async () => {
    const user = await openCard({ defaultQualityIndex: 0 });
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(new Set(radios.map((r) => r.name)).size).toBe(1);
    expect(radios.filter((r) => r.checked)).toHaveLength(1);
    radios[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
    await waitFor(() => expect(vi.mocked(api.checkOutput).mock.lastCall?.[0]).toMatchObject({ qualityId: 'q720' }));
  });

  it('파일 이름·화질을 바꾸면 다시 검사하고, 결과가 올 때까지 막는다', async () => {
    const user = await openCard();
    await downloadButton();
    await user.click(screen.getAllByRole('radio')[2]);
    expectBlocked(screen.getByRole('button', { name: downloadName() }));
    await downloadButton();
    expect(vi.mocked(api.checkOutput).mock.lastCall?.[0]).toMatchObject({ qualityId: 'q480' });

    const name = screen.getByLabelText(t('filename.label'));
    await user.clear(name);
    await user.type(name, '새 이름');
    await waitFor(() => expect(vi.mocked(api.checkOutput).mock.lastCall?.[0]).toMatchObject({ fileName: '새 이름' }));
    // CHECK_DEBOUNCE_MS 디바운스: 글자마다 부르지 않는다
    const calls = vi.mocked(api.checkOutput).mock.calls.filter(([a]) => a.fileName.startsWith('새'));
    expect(calls.length).toBeLessThan(3);
  });

  it('폴더를 카드에서 바꾸면 설정도 바꾼다', async () => {
    vi.mocked(api.pickFolder).mockResolvedValue('/Volumes/외장/영상');
    vi.mocked(api.updateSettings).mockResolvedValue({ ...settingsDto, downloadFolder: '/Volumes/외장/영상' });
    const user = await openCard();
    await user.click(screen.getByRole('button', { name: t('folder.change') }));
    expect(api.pickFolder).toHaveBeenCalledWith('/Users/me/Movies/VOD Clip Downloader');
    expect(api.updateSettings).toHaveBeenCalledWith({ downloadFolder: '/Volumes/외장/영상' });
    expect(await screen.findByText('/Volumes/외장/영상')).toBeInTheDocument();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ folder: '/Volumes/외장/영상' });
  });
});

/** 구간 편집 화면(range-editor.md D67) 진입·적용 도우미. 편집 화면은 body 직속 레이어라 screen이 그대로 찾는다(카드는 그동안 inert) */
const editButton = () => screen.getByRole('button', { name: t('range.edit.label') });
/** 카드 구간 줄의 [구간 지우기](편집 화면의 같은 이름 단추와 헷갈리지 않게 줄 안에서 찾는다) */
const rangeClearButton = () => within(editButton().closest('.fieldrow') as HTMLElement).getByRole('button', { name: t('range.clear.label') });
const editorDialog = () => screen.queryByRole('dialog', { name: t('rangeEditor.title') });
/** 편집 화면 안의 단추(카드 쪽에도 같은 이름의 [닫기]가 있다) */
const inEditor = () => within(screen.getByRole('dialog', { name: t('rangeEditor.title') }));
const editorClose = () => inEditor().getByRole('button', { name: t('common.close') });
const editorClear = () => inEditor().getByRole('button', { name: t('range.clear.label') });
const applyButton = () => screen.getByRole('button', { name: new RegExp(t('rangeEditor.apply.label')) });
async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(editButton());
  return screen.findByRole('dialog', { name: t('rangeEditor.title') });
}
/** [구간 적용하기]를 눌러 화면이 닫히길 기다린다 */
async function applyEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(applyButton());
  await waitFor(() => expect(editorDialog()).toBeNull());
}
const rangeStartInput = () => screen.getByRole('textbox', { name: t('range.start') }) as HTMLInputElement;
const rangeEndInput = () => screen.getByRole('textbox', { name: t('range.end') }) as HTMLInputElement;
async function fillRange(user: ReturnType<typeof userEvent.setup>, el: HTMLInputElement, text: string) {
  await user.clear(el);
  await user.type(el, text);
}

describe('구간 받기(ResolveCard, range-editor.md)', () => {
  type User = ReturnType<typeof userEvent.setup>;
  const settle = () => new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 60));
  /** 마지막 checkOutput 호출의 인자 */
  const lastCheckArg = () => vi.mocked(api.checkOutput).mock.lastCall?.[0] as unknown as Record<string, unknown>;
  const lastEnqueueArg = () => vi.mocked(api.enqueue).mock.lastCall?.[0] as unknown as Record<string, unknown>;
  /** 편집 화면에서 구간을 적고 적용한다 */
  async function setRange(user: User, start: string, end: string) {
    await openEditor(user);
    if (start) await fillRange(user, rangeStartInput(), start);
    if (end) await fillRange(user, rangeEndInput(), end);
    await applyEditor(user);
  }

  it('빠른 다시보기 카드는 섹션 없이 구간 줄 하나("구간 · 전체 [구간 편집…]")만 있고 [구간 지우기]는 없다', async () => {
    await openCard();
    expect(sectionHead()).toBeNull();
    expect(document.querySelector('details')).toBeNull();
    expect(screen.queryByText('미리보기·구간')).toBeNull();
    const row = editButton().closest('.fieldrow') as HTMLElement;
    expect(row).toHaveTextContent(t('range.label'));
    expect(row).toHaveTextContent(t('range.summaryWhole.label'));
    expect(screen.queryByRole('button', { name: t('range.clear.label') })).toBeNull();
    expect(screen.queryByRole('textbox', { name: t('range.start') })).toBeNull();
    // 열기만으로는 요청이 없고 편집 화면도 뜨지 않는다
    expect(editorDialog()).toBeNull();
    expect(api.watchOpen).not.toHaveBeenCalled();
  });

  it('구간 줄은 메타 줄 다음, 화질 앞에 있다', async () => {
    await openCard();
    const meta = document.querySelector('.meta') as HTMLElement;
    const row = editButton().closest('.fieldrow') as HTMLElement;
    const fields = document.querySelector('.fields') as HTMLElement;
    expect(meta.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('손대지 않고 받으면 요청에 range가 없다', async () => {
    const user = await openCard();
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect('range' in lastEnqueueArg()).toBe(false);
    expect('range' in lastCheckArg()).toBe(false);
  });

  it('구간을 적용하면 checkOutput과 enqueue가 같은 range를 쓰고 카드 구간 줄이 값을 보인다', async () => {
    const user = await openCard();
    await setRange(user, '0:10:00', '0:20:00');
    expect(editButton().closest('.fieldrow')).toHaveTextContent(`0:10:00~0:20:00 · 길이 0:10:00`);
    expect(rangeClearButton()).toBeInTheDocument();
    await waitFor(() => expect(lastCheckArg().range).toEqual({ startMs: 600000, endMs: 1200000 }));
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 600000, endMs: 1200000 });
  });

  it('ui.previewOpen이 false여도 적용한 range는 checkOutput·enqueue에 실린다(열림과 무관, RE2)', async () => {
    ui.previewOpen = false;
    const user = await openCard();
    await setRange(user, '0:10:00', '0:20:00');
    await waitFor(() => expect(lastCheckArg().range).toEqual({ startMs: 600000, endMs: 1200000 }));
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 600000, endMs: 1200000 });
    expect(ui.previewOpen).toBe(false);
  });

  it('빈 시작 칸은 0초라 끝만 적으면 처음부터 그 끝까지다(PS10)', async () => {
    const user = await openCard();
    await setRange(user, '', '0:20:00');
    expect(editButton().closest('.fieldrow')).toHaveTextContent('0:00:00~0:20:00');
    await waitFor(() => expect(lastCheckArg().range).toEqual({ startMs: 0, endMs: 1200000 }));
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 0, endMs: 1200000 });
  });

  it('시작만 적으면 영상 끝까지(올림 길이)다', async () => {
    const user = await openCard();
    await setRange(user, '0:10:00', '');
    await waitFor(() => expect(lastCheckArg().range).toEqual({ startMs: 600000, endMs: 11565000 }));
    // 카드 줄은 내림 끝(meta 줄의 길이)을 보인다: 올림 끝이 1초 길어 보이지 않게(§5.3)
    expect(editButton().closest('.fieldrow')).toHaveTextContent('0:10:00~3:12:45 · 길이 3:02:45');
  });

  it('두 칸이 비면 전체라 확정값이 그대로 null이고 range가 없다', async () => {
    const user = await openCard();
    await openEditor(user);
    await applyEditor(user);
    expect(editButton().closest('.fieldrow')).toHaveTextContent(t('range.summaryWhole.label'));
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect('range' in lastEnqueueArg()).toBe(false);
  });

  it('[닫기]는 초안을 버리고 확정값을 그대로 둔다: 다시 열면 확정값부터 시작한다', async () => {
    const user = await openCard();
    await setRange(user, '0:10:00', '0:20:00');
    await openEditor(user);
    await fillRange(user, rangeStartInput(), '0:15:00');
    await user.click(editorClose());
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(editButton().closest('.fieldrow')).toHaveTextContent('0:10:00~0:20:00');
    await openEditor(user);
    expect(rangeStartInput()).toHaveValue('0:10:00');
    expect(rangeEndInput()).toHaveValue('0:20:00');
  });

  it('Esc도 [닫기]와 같다: 초안을 버리고 확정값은 그대로, 카드는 닫히지 않는다', async () => {
    const user = await openCard();
    await setRange(user, '0:10:00', '0:20:00');
    await openEditor(user);
    await fillRange(user, rangeStartInput(), '0:15:00');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(screen.getByRole('heading', { name: /금요/ })).toBeInTheDocument();
    expect(editButton().closest('.fieldrow')).toHaveTextContent('0:10:00~0:20:00');
  });

  it('닫으면 포커스가 [구간 편집…]으로 돌아간다', async () => {
    const user = await openCard();
    await openEditor(user);
    await user.click(editorClose());
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(editButton()).toHaveFocus();
  });

  it('카드의 [구간 지우기]는 확정값을 곧바로 지우고 포커스를 [구간 편집…]으로 옮기며 알린다', async () => {
    const user = await openCard();
    await setRange(user, '0:10:00', '0:20:00');
    const say = vi.spyOn((await import('../../stores/announce.svelte')).announcer, 'say').mockImplementation(() => {});
    await user.click(rangeClearButton());
    expect(screen.queryByRole('button', { name: t('range.clear.label') })).toBeNull();
    expect(editButton()).toHaveFocus();
    expect(editButton().closest('.fieldrow')).toHaveTextContent(t('range.summaryWhole.label'));
    expect(say).toHaveBeenCalledWith(t('range.cleared.body'));
    await waitFor(() => expect('range' in lastCheckArg()).toBe(false));
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect('range' in lastEnqueueArg()).toBe(false);
    say.mockRestore();
  });

  it('적용 알림은 레이어가 떨어진 뒤 한 번: 구간이면 "받을 구간을 정했어요", 전체이면 "영상 전체를 받아요", 바뀐 것이 없으면 알리지 않는다', async () => {
    const user = await openCard();
    // 알림을 부르는 순간에 편집 화면이 DOM에 있었는지 기록한다(있으면 LiveAnnouncer가 inert 아래라 읽히지 않는다, §6.1)
    const editorWasOpen: boolean[] = [];
    const say = vi
      .spyOn((await import('../../stores/announce.svelte')).announcer, 'say')
      .mockImplementation(() => void editorWasOpen.push(!!editorDialog()));
    say.mockClear();
    await openEditor(user);
    await fillRange(user, rangeStartInput(), '0:10:00');
    await user.click(applyButton());
    await waitFor(() => expect(say).toHaveBeenCalledTimes(1));
    expect(say).toHaveBeenLastCalledWith(t('range.applied.body'));
    // 레이어는 알림보다 먼저 떨어졌다
    expect(editorWasOpen).toEqual([false]);
    // 같은 값으로 다시 적용: 알리지 않는다
    await openEditor(user);
    await applyEditor(user);
    expect(say).toHaveBeenCalledTimes(1);
    // 전체로 되돌리는 적용
    await openEditor(user);
    await user.click(editorClear());
    await user.click(applyButton());
    await waitFor(() => expect(say).toHaveBeenCalledTimes(2));
    expect(say).toHaveBeenLastCalledWith(t('range.appliedWhole.body'));
    expect(editorWasOpen).toEqual([false, false]);
    say.mockRestore();
  });

  it('편집 화면 [구간 지우기]는 초안만 지운다: 적용하기 전까지 카드의 확정값과 요청은 그대로다', async () => {
    const user = await openCard();
    await setRange(user, '0:10:00', '0:20:00');
    await openEditor(user);
    await user.click(editorClear());
    expect(rangeStartInput()).toHaveValue('');
    await user.click(editorClose());
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(editButton().closest('.fieldrow')).toHaveTextContent('0:10:00~0:20:00');
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 600000, endMs: 1200000 });
  });

  it('편집 화면이 열려 있는 동안의 초안은 검사·요청에 섞이지 않는다', async () => {
    const user = await openCard();
    await openEditor(user);
    await fillRange(user, rangeStartInput(), '0:10:00');
    await settle();
    expect(vi.mocked(api.checkOutput).mock.calls.every(([arg]) => !('range' in (arg as object)))).toBe(true);
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('화질 크기는 확정 구간 기준이 된다. 편집 화면의 길이 줄은 고른 화질의 크기를 곁들인다', async () => {
    const user = await openCard();
    const radio = () => screen.getAllByRole('radio')[0].closest('label') as HTMLElement;
    const q0 = resolved().qualities[0];
    await setRange(user, '', '1:00:00');
    await waitFor(() => expect(radio()).toHaveTextContent(qualitySize(q0, 3600) as string));
    await openEditor(user);
    expect(screen.getByText(new RegExp(`구간 길이: 1:00:00 · ${(qualitySize(q0, 3600) as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
  });

  it('구간만 바꾸면 검사가 끝날 때까지 [받기]가 막힌다', async () => {
    const user = await openCard();
    await setRange(user, '', '0:20:00');
    await settle();
    await downloadButton();
    await setRange(user, '', '0:30:00');
    expectBlocked(screen.getByRole('button', { name: downloadName() }));
  });

  it('받기 요청 중(busy)에는 [구간 편집…]·[구간 지우기]가 비활성이다', async () => {
    let release!: (v: never) => void;
    vi.mocked(api.enqueue).mockReset().mockReturnValue(new Promise((r) => (release = r as never)));
    const user = await openCard();
    await setRange(user, '0:10:00', '0:20:00');
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(editButton()).toBeDisabled());
    expect(rangeClearButton()).toBeDisabled();
    release({} as never);
  });

  it('일반 VOD·클립·생방송 카드에는 구간 줄이 없다', async () => {
    await openCard({ playbackKind: 'progressive' });
    expect(screen.queryByRole('button', { name: t('range.edit.label') })).toBeNull();
  });

  it('클립 카드에는 구간 줄이 없다', async () => {
    await openCard({ meta: { ...resolved().meta, kind: 'clip' }, playbackKind: 'progressive' });
    expect(screen.queryByRole('button', { name: t('range.edit.label') })).toBeNull();
  });

  it('생방송 카드에는 구간 줄이 없다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(liveResolved());
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/live/abcd{Enter}');
    await screen.findByRole('heading', { name: liveResolved().meta.title });
    expect(screen.queryByRole('button', { name: t('range.edit.label') })).toBeNull();
  });

  it('notOwn·unknown 카드에는 구간 줄이 없다(PS15)', async () => {
    await openCard({ ownership: 'notOwn' });
    expect(screen.queryByRole('button', { name: t('range.edit.label') })).toBeNull();
  });

  it('길이를 모르면 끝 칸은 비어 있고(끝까지) 시작만 적으면 끝 없는 구간이다', async () => {
    const user = await openCard({ meta: { ...resolved().meta, durationSecs: null } });
    await openEditor(user);
    expect(rangeEndInput()).toHaveValue('');
    expect(rangeEndInput()).toHaveAttribute('placeholder', t('range.toEnd'));
    await fillRange(user, rangeStartInput(), '0:10:00');
    await applyEditor(user);
    expect(editButton().closest('.fieldrow')).toHaveTextContent('0:10:00~');
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 600000, endMs: null });
  });

  it('편집 화면을 열기만 해서는 세션 요청이 없고, [영상 보기]를 누르면 카드의 주소·content로 한 번 부른다', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue({ id: 'ab'.repeat(16), kind: 'hls', src: `watch://localhost/${'ab'.repeat(16)}/pl.m3u8` });
    const user = await openCard();
    await openEditor(user);
    expect(api.watchOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^‘.+’ 영상 보기$/ }));
    await waitFor(() => expect(api.watchOpen).toHaveBeenCalledTimes(1));
    expect(api.watchOpen).toHaveBeenCalledWith('https://chzzk.naver.com/video/1234567', { kind: 'video', videoNo: 1234567 });
  });

  it('편집 화면이 열려 있는 동안 Mod+Enter는 [구간 적용하기]다: 받기(enqueue)를 시작하지 않는다', async () => {
    const user = await openCard();
    await settle();
    await openEditor(user);
    await fillRange(user, rangeStartInput(), '0:10:00');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(api.enqueue).not.toHaveBeenCalled();
    expect(editButton().closest('.fieldrow')).toHaveTextContent('0:10:00~');
  });

  it('깃발이 이미 내려갔어도(microtask 순서) 이미 막힌 Mod+Enter(defaultPrevented)는 카드가 받지 않는다', async () => {
    const user = await openCard();
    await settle();
    ui.rangeEditorOpen = false; // 적용 직후 깃발이 먼저 내려간 상황
    const e = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, cancelable: true, bubbles: true });
    e.preventDefault();
    window.dispatchEvent(e);
    expect(api.enqueue).not.toHaveBeenCalled();
    // 막히지 않은 같은 키는 받는다
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    void user;
  });

  it('길게 눌러 반복되는 Mod+Enter(repeat)는 적용 직후에도 카드가 받기로 받지 않는다', async () => {
    const user = await openCard();
    await settle();
    await openEditor(user);
    await user.keyboard('{Control>}{Enter}{/Control}'); // 첫 keydown이 적용하고 층이 떨어진다
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(ui.rangeEditorOpen).toBe(false);
    await fireEvent.keyDown(editButton(), { key: 'Enter', ctrlKey: true, repeat: true });
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true, repeat: true });
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('깃발이 켜져 있으면 포커스가 body에 떨어져 뿌리를 지나지 않은 Mod+Enter도 카드가 받지 않는다', async () => {
    const user = await openCard();
    await settle();
    await openEditor(user);
    (document.activeElement as HTMLElement | null)?.blur();
    await fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    expect(api.enqueue).not.toHaveBeenCalled();
    expect(editorDialog()).not.toBeNull();
  });

  it('카드가 사라지면(새 주소로 다시 불러오기) 편집 화면도 사라지고 깃발이 내려간다', async () => {
    const user = await openCard();
    await openEditor(user);
    expect(ui.rangeEditorOpen).toBe(true);
    resolver.close();
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(ui.rangeEditorOpen).toBe(false);
    // 연 단추도 함께 사라졌으니 포커스는 입력줄로 간다
    await waitFor(() => expect(urlInput()).toHaveFocus());
  });

  it('카드 안 어디에도 [data-local-keys] 속성이 없다(편집 영역 예외는 편집 화면이 생겨 쓰는 곳이 없어 지웠다)', async () => {
    const user = await openCard();
    expect(document.querySelector('[data-local-keys]')).toBeNull();
    await openEditor(user);
    expect(document.querySelector('[data-local-keys]')).toBeNull();
  });
});

describe('드래그 앤 드롭', () => {
  const dt = (data: Record<string, string>, types = Object.keys(data)) => ({
    types,
    getData: (t: string) => data[t] ?? '',
    dropEffect: 'none',
  });

  it('주소 글을 놓으면 그 주소를 불러온다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    render(InputPanel);
    const data = dt({ 'text/plain': '이거 https://chzzk.naver.com/clips/abc 봐' });
    await fireEvent.dragEnter(window, { dataTransfer: data });
    expect(screen.getByText(t('url.dropHere'))).toBeInTheDocument();
    await fireEvent.drop(window, { dataTransfer: data });
    expect(screen.queryByText(t('url.dropHere'))).toBeNull();
    expect(api.resolve).toHaveBeenCalledWith('https://chzzk.naver.com/clips/abc');
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('카드가 열려 있으면 주소가 아닌 글을 놓아도 카드를 버리지 않는다', async () => {
    await openCard();
    const data = dt({ 'text/plain': 'abc' });
    await fireEvent.dragEnter(window, { dataTransfer: data });
    await fireEvent.drop(window, { dataTransfer: data });
    expect(api.resolve).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: /금요/ })).toBeInTheDocument();
  });

  it('창 안에서 시작한 끌기(입력칸 글 옮기기)는 주소 드롭으로 받지 않고 기본 동작에 맡긴다', async () => {
    await openCard();
    const name = screen.getByLabelText(t('filename.label'));
    const data = dt({ 'text/plain': 'https://chzzk.naver.com/video/9' });
    await fireEvent.dragStart(name, { dataTransfer: data });
    await fireEvent.dragEnter(name, { dataTransfer: data });
    expect(screen.queryByText(t('url.dropHere'))).toBeNull();
    // 기본 동작(글 옮기기)을 막지 않는다
    expect(await fireEvent.drop(name, { dataTransfer: data })).toBe(true);
    await fireEvent.dragEnd(name, { dataTransfer: data });
    expect(api.resolve).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { name: /금요/ })).toBeInTheDocument();

    // 끌기가 끝나면 바깥에서 놓은 주소는 다시 받는다
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    await fireEvent.drop(window, { dataTransfer: data });
    expect(api.resolve).toHaveBeenLastCalledWith('https://chzzk.naver.com/video/9');
  });

  it('구간 편집 화면이 열려 있는 동안에는 주소 드롭을 무시한다(새 주소가 카드를 바꾸지 않게, RE15)', async () => {
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    render(InputPanel);
    const data = dt({ 'text/plain': 'https://chzzk.naver.com/clips/abc' });
    ui.rangeEditorOpen = true;
    try {
      await fireEvent.dragEnter(window, { dataTransfer: data });
      await fireEvent.drop(window, { dataTransfer: data });
      expect(api.resolve).not.toHaveBeenCalled();
    } finally {
      ui.rangeEditorOpen = false;
    }
  });

  it('파일은 받지 않는다', async () => {
    render(InputPanel);
    const data = dt({ 'text/plain': 'x' }, ['Files']);
    await fireEvent.dragEnter(window, { dataTransfer: data });
    expect(screen.queryByText(t('url.dropHere'))).toBeNull();
    await fireEvent.drop(window, { dataTransfer: data });
    expect(api.resolve).not.toHaveBeenCalled();
  });
});

describe('클립보드 제안', () => {
  const link = 'https://chzzk.naver.com/video/42';

  it('창 포커스 때 제안하고, 누르면 불러오기만 한다', async () => {
    vi.mocked(api.clipboardLink).mockResolvedValue(link);
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    const user = userEvent.setup();
    render(InputPanel);
    const group = await screen.findByRole('group', { name: t('url.clipboard.title') });
    expect(group).toHaveTextContent('chzzk.naver.com/video/42');
    await user.click(within(group).getByRole('button', { name: t('common.load') }));
    expect(api.resolve).toHaveBeenCalledWith(link);
    expect(api.enqueue).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: t('url.clipboard.title') })).toBeNull();
  });

  it('닫은 주소는 다시 묻지 않고, 입력이 있으면 숨긴다', async () => {
    vi.mocked(api.clipboardLink).mockResolvedValue(link);
    const user = userEvent.setup();
    render(InputPanel);
    const group = await screen.findByRole('group', { name: t('url.clipboard.title') });
    await user.click(within(group).getByRole('button', { name: t('common.close') }));
    expect(screen.queryByRole('group', { name: t('url.clipboard.title') })).toBeNull();
    await fireEvent.focus(window);
    await waitFor(() => expect(api.clipboardLink).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('group', { name: t('url.clipboard.title') })).toBeNull();

    // 다른 주소는 제안하지만 입력줄에 글이 생기면 숨긴다
    vi.mocked(api.clipboardLink).mockResolvedValue('https://chzzk.naver.com/video/43');
    await fireEvent.focus(window);
    await screen.findByRole('group', { name: t('url.clipboard.title') });
    await user.type(urlInput(), 'a');
    expect(screen.queryByRole('group', { name: t('url.clipboard.title') })).toBeNull();
  });

  it('다른 길(붙여넣기)로 불러와 목록에 넣은 주소는 다시 제안하지 않는다', async () => {
    vi.mocked(api.clipboardLink).mockResolvedValue(link);
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    const user = userEvent.setup();
    render(InputPanel);
    await screen.findByRole('group', { name: t('url.clipboard.title') });
    await user.click(urlInput());
    await user.paste(link);
    expect(api.resolve).toHaveBeenCalledWith(link);
    await screen.findByRole('heading', { name: /금요/ });
    await user.click(await downloadButton());
    await waitFor(() => expect(urlInput()).toHaveValue(''));
    expect(screen.queryByRole('group', { name: t('url.clipboard.title') })).toBeNull();
    // 다음 창 포커스에도 묻지 않는다
    await fireEvent.focus(window);
    await waitFor(() => expect(api.clipboardLink).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('group', { name: t('url.clipboard.title') })).toBeNull();
  });

  it('입력줄에 글이 있으면 묻지도 않는다', async () => {
    resolver.input = 'abc';
    render(InputPanel);
    await fireEvent.focus(window);
    expect(api.clipboardLink).not.toHaveBeenCalled();
  });
});

describe('남의 영상 안내(A5)', () => {
  afterEach(() => {
    auth.status = null;
  });

  it('로그인한 채널 이름을 보이고 [받기]는 비활성이며 사유 문장에 이어진다', async () => {
    auth.status = signedInAs('a1', '내 채널');
    await openCard({ ownership: 'notOwn', meta: { ...resolved().meta, channelName: '다른 채널', channelId: 'c3' } });
    const copy = errorCopy(appError('notOwnContent'), {
      place: 'resolve',
      channelName: '다른 채널',
      myChannel: '내 채널',
    });
    expect(screen.getByText(copy.title)).toBeInTheDocument();
    expect(screen.getByText(copy.body as string)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: downloadName() });
    expectBlocked(btn);
    expect(document.getElementById(btn.getAttribute('aria-describedby') as string)).toHaveTextContent(copy.title);
    // 본인 영상이 아님은 막힌 것이라 danger다
    expect(screen.getByText(copy.title).closest('.notice')).toHaveClass('tone-danger');
  });

  it('로그인한 채널 이름을 모르면 이름 없는 문장이다', async () => {
    await openCard({ ownership: 'notOwn' });
    const copy = errorCopy(appError('notOwnContent'), { place: 'resolve' });
    expect(screen.getByText(copy.body as string)).toBeInTheDocument();
  });

  it('확인하지 못한 영상은 warning이고 마찬가지로 막는다', async () => {
    await openCard({ ownership: 'unknown' });
    const copy = errorCopy(appError('ownershipUnknown'), { place: 'resolve' });
    expect(screen.getByText(copy.title).closest('.notice')).toHaveClass('tone-warning');
    expectBlocked(screen.getByRole('button', { name: downloadName() }));
  });

  it('관리자는 info 안내만 받고 [받기]는 막히지 않는다(채널을 알 때)', async () => {
    auth.status = { ...signedInAs('a1', '내 채널'), isAdmin: true };
    await openCard({ ownership: 'adminOverride', meta: { ...resolved().meta, channelName: '다른 채널', channelId: 'c3' } });
    const title = screen.getByText(t('receive.admin.otherChannel.title'));
    expect(title.closest('.notice')).toHaveClass('tone-info');
    expect(screen.getByText(t('receive.admin.otherChannel.body'))).toBeInTheDocument();
    expect(screen.queryByText(t('receive.admin.unknown.title'))).toBeNull();
    const btn = await downloadButton();
    // 막힘 사유가 아니라서 설명으로 잇지 않는다
    expect(btn.getAttribute('aria-describedby') ?? '').not.toContain('ownership-notice');
    expect(document.getElementById('ownership-notice')).toBeNull();
  });

  it('관리자가 채널을 모르는 영상은 문구가 갈린다', async () => {
    auth.status = { ...signedInAs('a1', '내 채널'), isAdmin: true };
    await openCard({ ownership: 'adminOverride', meta: { ...resolved().meta, channelId: null } });
    expect(screen.getByText(t('receive.admin.unknown.title'))).toBeInTheDocument();
    expect(screen.getByText(t('receive.admin.unknown.body'))).toBeInTheDocument();
    expect(screen.queryByText(t('receive.admin.otherChannel.title'))).toBeNull();
    await downloadButton();
  });

  it.each(['own', 'unchecked'] as const)('%s에서는 소유권 안내를 그리지 않는다', async (ownership) => {
    await openCard({ ownership });
    expect(document.getElementById('ownership-notice')).toBeNull();
    expect(screen.queryByText(t('receive.admin.otherChannel.title'))).toBeNull();
    expect(screen.queryByText(t('receive.admin.unknown.title'))).toBeNull();
  });
});

describe('막힌 카드의 [다시 불러오기](R)', () => {
  const OTHER = '0'.repeat(31) + 'c';
  const notOwn = (over = {}) => ({
    ownership: 'notOwn' as const,
    meta: { ...resolved().meta, channelName: '다른 채널', channelId: OTHER },
    ...over,
  });
  const recheckBtn = () => screen.getByRole('button', { name: t('action.reresolve') });

  beforeEach(() => {
    auth.status = { ...signedInAs('a1', '내 채널'), delegationsCheckedAt: 1_760_000_000 };
  });
  afterEach(() => {
    auth.status = null;
  });

  it('RV1 둘째 문장·두 채널 행·마지막 확인, Notice 안 버튼은 [다시 불러오기] 하나, [받기] 설명은 제목+본문', async () => {
    await openCard(notOwn());
    const copy = errorCopy(appError('notOwnContent'), { place: 'resolve', channelName: '다른 채널', myChannel: '내 채널' });
    expect(copy.body).toContain('초대 주소');
    expect(screen.getByText(copy.body)).toBeInTheDocument();
    expect(screen.getByText('영상의 채널: ‘다른 채널’')).toBeInTheDocument();
    expect(screen.getByText('로그인한 채널: ‘내 채널’')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t('account.lastSeen', { time: '.+' })))).toBeInTheDocument();
    const notice = screen.getByText(copy.title).closest('.notice') as HTMLElement;
    const actions = notice.querySelector('.notice-actions') as HTMLElement;
    expect(within(actions).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([t('action.reresolve')]);
    const btn = screen.getByRole('button', { name: downloadName() });
    expectBlocked(btn);
    expect(btn).toHaveAccessibleDescription(`${copy.title} ${copy.body}`);
  });

  it('RV9 L2 도움말 링크는 동작 줄과 분리된 줄에 있고 누르면 웹 도움말의 그 주제를 연다', async () => {
    vi.mocked(api.openWebPage).mockResolvedValue();
    const user = await openCard(notOwn());
    const copy = errorCopy(appError('notOwnContent'), { place: 'resolve', channelName: '다른 채널', myChannel: '내 채널' });
    expect(copy.helpId).toBe('editors');
    const notice = screen.getByText(copy.title).closest('.notice') as HTMLElement;
    const link = within(notice).getByRole('button', { name: helpLinkLabel('editors') });
    expect(link).toHaveTextContent('도움말 보기: 다른 채널의 영상 받기');
    // 버튼이 아니라 링크 모양(유령 + 밑줄)이고, 동작 줄·라이브 영역 밖의 자기 줄이다
    expect(link).toHaveClass('btn-ghost', 'btn-inline');
    expect(link.closest('.notice-help')).not.toBeNull();
    expect(link.closest('.notice-actions')).toBeNull();
    expect(link.closest('.notice-text')).toBeNull();
    // [받기]의 설명에는 섞이지 않는다
    expect(screen.getByRole('button', { name: downloadName() })).toHaveAccessibleDescription(`${copy.title} ${copy.body}`);
    await user.click(link);
    expect(api.openWebPage).toHaveBeenCalledExactlyOnceWith('help', 'editors');
  });

  it('RV2 누르면 ownershipRecheck를 한 번 부르고 기다리는 동안 aria-busy', async () => {
    let resolve!: (r: ReturnType<typeof resolved>) => void;
    vi.mocked(api.ownershipRecheck).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = await openCard(notOwn());
    await user.click(recheckBtn());
    await waitFor(() => expect(recheckBtn()).toHaveAttribute('aria-busy', 'true'));
    await user.click(recheckBtn());
    expect(api.ownershipRecheck).toHaveBeenCalledTimes(1);
    expect(api.ownershipRecheck).toHaveBeenCalledWith(resolved().url);
    resolve(resolved(notOwn()));
    await waitFor(() => expect(recheckBtn()).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('RV3 맡은 채널이 되면 카드가 다시 그려져 막힘이 풀린다', async () => {
    vi.mocked(api.ownershipRecheck).mockResolvedValue(resolved({ ownership: 'delegated', meta: { ...resolved().meta, channelId: OTHER, channelName: '다른 채널' } }));
    const user = await openCard(notOwn());
    await user.click(recheckBtn());
    await waitFor(() => expect(screen.queryByText(t('action.reresolve'))).toBeNull());
    expect(screen.getByText(t('delegated.title'))).toBeInTheDocument();
    expect(document.getElementById('ownership-notice')).toBeNull();
    await downloadButton();
  });

  it('RV4 판정이 그대로면 카드를 그대로 둔다', async () => {
    vi.mocked(api.ownershipRecheck).mockResolvedValue(resolved(notOwn()));
    const user = await openCard(notOwn());
    const title = screen.getByRole('heading', { name: '금요 노가리 방송 - 신작 게임 해보기' });
    await user.click(recheckBtn());
    await waitFor(() => expect(api.ownershipRecheck).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(recheckBtn()).not.toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('heading', { name: '금요 노가리 방송 - 신작 게임 해보기' })).toBe(title);
  });

  it('RV5 연결하지 못하면 그 줄이 보이고 카드는 그대로', async () => {
    vi.mocked(api.ownershipRecheck).mockRejectedValue(appError('network'));
    const user = await openCard(notOwn());
    await user.click(recheckBtn());
    expect(await screen.findByText(t('receive.recheck.offline'))).toBeInTheDocument();
    expectBlocked(screen.getByRole('button', { name: downloadName() }));
  });

  it('RV6 맡은 채널의 생방송은 막다른 길이라 버튼·마지막 확인·초대 안내가 없다', async () => {
    auth.status = {
      ...signedInAs('a1', '내 채널'),
      delegatedChannels: [{ channelId: OTHER, channelName: '다른 채널' }],
      delegationsCheckedAt: 1_760_000_000,
    };
    await openCard(
      notOwn({ meta: { ...resolved().meta, kind: 'live', channelName: '다른 채널', channelId: OTHER } }),
    );
    const copy = errorCopy(appError('notOwnContent'), { place: 'resolve', channelName: '다른 채널', delegatedLive: true });
    expect(copy.title).toBe('맡은 채널의 생방송은 녹화할 수 없어요');
    const notice = screen.getByText(copy.title).closest('.notice') as HTMLElement;
    expect(within(notice).queryAllByRole('button')).toHaveLength(0);
    expect(within(notice).queryByText(new RegExp(t('account.lastSeen', { time: '.+' })))).toBeNull();
    expect(within(notice).queryByText(/초대 주소/)).toBeNull();
    expectBlocked(screen.getByRole('button', { name: downloadName() }));
  });

  it('맡은 채널이 있으면 제목이 넓어진다', async () => {
    auth.status = { ...signedInAs('a1', '내 채널'), delegatedChannels: [{ channelId: 'zz', channelName: '다른 맡은 채널' }] };
    await openCard(notOwn());
    expect(screen.getByText('내 채널이나 맡은 채널의 영상만 받을 수 있어요')).toBeInTheDocument();
  });

  it('RV8 받기가 notOwnContent로 실패하면 오류 Notice에는 [다시 불러오기]와 [닫기]가 모두 있고 누르면 다시 묻는다', async () => {
    vi.mocked(api.enqueue).mockRejectedValue(appError('notOwnContent'));
    vi.mocked(api.ownershipRecheck).mockResolvedValue(resolved());
    const user = await openCard();
    await user.click(await downloadButton());
    const title = errorCopy(appError('notOwnContent'), { place: 'resolve' }).title;
    const notice = (await screen.findByText(title)).closest('.notice') as HTMLElement;
    const labels = within(notice.querySelector('.notice-actions') as HTMLElement)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
    expect(labels).toEqual([t('action.reresolve'), t('common.close')]);
    // 받기 실패 Notice도 같은 L2 링크를 단다
    expect(within(notice).getByRole('button', { name: helpLinkLabel('editors') })).toBeInTheDocument();
    await user.click(within(notice).getByRole('button', { name: t('action.reresolve') }));
    await waitFor(() => expect(api.ownershipRecheck).toHaveBeenCalledTimes(1));
  });
});

describe('막힌 생방송 카드·받기 실패의 다시 불러오기(①-5 수정)', () => {
  const OTHER = '0'.repeat(31) + 'c';
  const liveMeta = { ...resolved().meta, kind: 'live' as const, channelName: '다른 채널', channelId: OTHER };

  afterEach(() => {
    auth.status = null;
  });

  it('RV9 막힌 생방송 카드는 "받기를 누르면 녹화가 시작돼요" 안내를 그리지 않는다', async () => {
    auth.status = { ...signedInAs('a1', '내 채널'), delegatedChannels: [{ channelId: OTHER, channelName: '다른 채널' }] };
    await openCard({ ownership: 'notOwn', playbackKind: 'live', meta: liveMeta });
    expect(screen.getByText('맡은 채널의 생방송은 녹화할 수 없어요')).toBeInTheDocument();
    expect(screen.queryByText(t('card.live.body'))).toBeNull();
  });

  it('RV9 막히지 않은 생방송 카드는 안내를 그대로 둔다', async () => {
    auth.status = signedInAs('a1', '내 채널');
    await openCard({ ownership: 'own', playbackKind: 'live', meta: liveMeta });
    expect(screen.getByText(t('card.live.body'))).toBeInTheDocument();
  });

  it('RV10 받기 실패 Notice는 맡은 채널 수로 제목을 넓히고, 다시 불러오는 동안 aria-busy, 연결 실패 줄을 그 안에 보인다', async () => {
    auth.status = { ...signedInAs('a1', '내 채널'), delegatedChannels: [{ channelId: OTHER, channelName: '다른 채널' }] };
    vi.mocked(api.enqueue).mockRejectedValue(appError('notOwnContent'));
    let reject!: (e: unknown) => void;
    vi.mocked(api.ownershipRecheck).mockReturnValue(new Promise((_, r) => (reject = r)));
    const user = await openCard({ ownership: 'delegated' });
    await user.click(await downloadButton());
    const notice = (await screen.findByText('내 채널이나 맡은 채널의 영상만 받을 수 있어요')).closest('.notice') as HTMLElement;
    const btn = within(notice).getByRole('button', { name: t('action.reresolve') });
    await user.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-busy', 'true'));
    reject(appError('network'));
    expect(await within(notice).findByText(t('receive.recheck.offline'))).toBeInTheDocument();
    expect(btn).not.toHaveAttribute('aria-busy', 'true');
  });
});

describe('붙여넣기 힌트', () => {
  it.each([
    ['macos', '⌘V'],
    ['windows', 'Ctrl+V'],
  ] as const)('%s에서는 {paste}가 %s다', (os, key) => {
    platform.set(os);
    render(InputPanel);
    expect(shortcutText(os, 'paste')).toBe(key);
    expect(screen.getByText(t('url.pasteHint', { paste: key }))).toBeInTheDocument();
  });

  it('최근 영상이 없어도 같은 힌트 한 줄만 있고 따로 줄을 더하지 않는다', () => {
    render(InputPanel);
    expect(screen.getAllByText(t('url.pasteHint', { paste: shortcutText(platform.os, 'paste') }))).toHaveLength(1);
    expect(screen.queryByText(t('recent.title'))).toBeNull();
  });

  it('카드가 열리면 힌트와 최근 영상을 숨긴다', async () => {
    settings.dto = { ...settingsDto, recentVods: [{ url: 'https://chzzk.naver.com/video/9', title: '지난 방송', kind: 'vod', date: null }] };
    render(InputPanel);
    expect(screen.getByText(t('recent.title'))).toBeInTheDocument();
    const hint = t('url.pasteHint', { paste: shortcutText(platform.os, 'paste') });
    expect(screen.getByText(hint)).toBeInTheDocument();
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    await resolver.load('https://chzzk.naver.com/video/1234567');
    await screen.findByRole('heading', { name: /금요/ });
    expect(screen.queryByText(hint)).toBeNull();
    expect(screen.queryByText(t('recent.title'))).toBeNull();
  });
});

describe('최근 영상', () => {
  const recent = (over: Partial<RecentVodDto>): RecentVodDto => ({
    url: 'https://chzzk.naver.com/video/1',
    title: '지난 방송',
    kind: 'rewind',
    date: '2026-10-03 21:00:00',
    ...over,
  });

  it('둘째 줄: 종류와 날짜 / 종류만 / 없음(옛 항목)', () => {
    settings.dto = {
      ...settingsDto,
      recentVods: [
        recent({ url: 'https://chzzk.naver.com/video/1', title: '첫째' }),
        recent({ url: 'https://chzzk.naver.com/video/2', title: '둘째', kind: 'clip', date: null }),
        recent({ url: 'https://chzzk.naver.com/video/3', title: '셋째', kind: null, date: null }),
      ],
    };
    render(InputPanel);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(t('recent.meta', { kind: t('kind.liveRewind'), date: '2026. 10. 3.' }));
    expect(rows[1]).toHaveTextContent(t('kind.clip'));
    expect(rows[1]).not.toHaveTextContent('·');
    // 옛 항목은 제목과 [다시 열기]뿐이다
    expect(rows[2]).toHaveTextContent('셋째');
    expect(rows[2].querySelector('.row-help')).toBeNull();
  });

  it('최대 RECENT_MAX개, [다시 열기]는 곧바로 불러오고 제목 title 속성은 없다', async () => {
    settings.dto = {
      ...settingsDto,
      recentVods: Array.from({ length: 7 }, (_, i) => recent({ url: `https://chzzk.naver.com/video/${i + 1}`, title: `방송 ${i + 1}` })),
    };
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    const user = userEvent.setup();
    const { container } = render(InputPanel);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(container.querySelector('[title]')).toBeNull();
    await user.click(screen.getByRole('button', { name: t('a11y.reopen', { title: '방송 2' }) }));
    expect(api.resolve).toHaveBeenCalledWith('https://chzzk.naver.com/video/2');
  });
});

describe('불러오는 중 한 줄', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('LOADER_DELAY_MS 안에는 아무것도 없고 넘으면 한 줄과 [취소]가 뜬다. 입력은 잠긴다', async () => {
    vi.useFakeTimers();
    vi.mocked(api.resolve).mockReturnValue(new Promise(() => {}));
    render(InputPanel);
    void resolver.load('https://chzzk.naver.com/video/1');
    await vi.advanceTimersByTimeAsync(LOADER_DELAY_MS - 1);
    expect(screen.queryByText(t('resolve.loading'))).toBeNull();
    expect(urlInput()).toHaveAttribute('readonly');
    // 불러오는 중에는 최근 영상·힌트를 숨긴다
    expect(screen.queryByText(t('recent.title'))).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(screen.getByText(t('resolve.loading'))).toBeInTheDocument();
    // 스피너는 [불러오기] 안 하나뿐이다(한 줄에는 없다)
    const line = screen.getByText(t('resolve.loading')).closest('.notice') as HTMLElement;
    expect(line.querySelector('.spinner')).toBeNull();
    expect(screen.getByRole('button', { name: t('common.load') })).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(within(line).getByRole('button', { name: t('common.cancel') }));
    expect(resolver.state.kind).toBe('idle');
    expect(screen.queryByText(t('resolve.loading'))).toBeNull();
  });

  it('LOADER_DELAY_MS 안에 끝나면 한 줄도 스피너도 한 번도 보이지 않는다', async () => {
    vi.useFakeTimers();
    vi.mocked(api.resolve).mockImplementation(() => new Promise((r) => setTimeout(() => r(resolved()), 100)));
    const { container } = render(InputPanel);
    void resolver.load('https://chzzk.naver.com/video/1');
    await vi.advanceTimersByTimeAsync(50);
    expect(container.querySelector('.spinner')).toBeNull();
    await vi.advanceTimersByTimeAsync(60);
    expect(resolver.state.kind).toBe('ready');
    expect(screen.queryByText(t('resolve.loading'))).toBeNull();
    expect(container.querySelector('.spinner')).toBeNull();
    // 카드가 열렸으니 검사 디바운스를 흘려 보낸다
    await vi.advanceTimersByTimeAsync(CHECK_DEBOUNCE_MS + 10);
  });
});

describe('미리보기 줄(ResolveCard, preview.md PV14)', () => {
  const toggleEl = () => document.querySelector('.watch summary') as HTMLElement | null;

  /** 일반 VOD 카드를 연다(openCard는 resolved를 쓰므로 vodResolved를 직접 부른다) */
  async function openVod(over = {}) {
    vi.mocked(api.resolve).mockResolvedValue(vodResolved(over));
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/video/1234567{Enter}');
    await screen.findByRole('heading', { name: '금요 노가리 방송 - 신작 게임 해보기' });
    return user;
  }

  it('일반 VOD 카드에는 기본 펼침의 "미리보기" 섹션이 있고 표지 자리만 보이며 watchOpen을 부르지 않는다', async () => {
    await openVod();
    expect(toggleEl()).toHaveTextContent(t('watch.toggle'));
    expect(toggleEl()!.closest('details')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: /영상 보기/ })).toBeInTheDocument();
    expect(api.watchOpen).not.toHaveBeenCalled();
  });

  it('줄은 메타 줄 다음, 화질 앞에 있다', async () => {
    await openVod();
    const meta = document.querySelector('.meta') as HTMLElement;
    const watch = toggleEl()!.closest('details') as HTMLElement;
    const fields = document.querySelector('.fields') as HTMLElement;
    expect(meta.compareDocumentPosition(watch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(watch.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('접었다 펴도 watchOpen은 없고 [영상 보기]를 누르면 카드의 주소·content로 부르고 video src를 둔다', async () => {
    const user = await openVod();
    await user.click(toggleEl()!);
    await user.click(toggleEl()!);
    expect(api.watchOpen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /영상 보기/ }));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(api.watchOpen).toHaveBeenCalledWith('https://chzzk.naver.com/video/1234567', { kind: 'video', videoNo: 1234567 });
    expect(document.querySelector('video')!.getAttribute('src')).toContain('watch://localhost/');
  });

  it('생방송 카드에는 줄이 없다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(liveResolved());
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/live/000000000000000000000000000000e5{Enter}');
    await screen.findByRole('heading', { name: '오늘 저녁 생방송' });
    expect(toggleEl()).toBeNull();
  });

  it('빠른 다시보기 카드에는 미리보기 섹션 대신 구간 줄이 있다(D67)', async () => {
    await openCard();
    expect(screen.getByText(t('kind.liveRewind'))).toBeInTheDocument();
    expect(toggleEl()).toBeNull();
    expect(screen.getByRole('button', { name: t('range.edit.label') })).toBeInTheDocument();
  });

  it('소유권이 notOwn·unknown인 빠른 다시보기 카드에는 줄이 없다', async () => {
    await openCard({ ownership: 'notOwn' });
    expect(screen.getByText(t('kind.liveRewind'))).toBeInTheDocument();
    expect(toggleEl()).toBeNull();
  });

  it('클립이라도 재생 방식이 HLS면 줄이 있다(tone이 아니라 playbackKind로 판정)', async () => {
    await openCard({
      content: { kind: 'clip', clipId: 'clip0001' },
      meta: { ...resolved().meta, kind: 'clip' },
      playbackKind: 'liveRewindHls',
    });
    expect(screen.getByText(t('kind.clip'))).toBeInTheDocument();
    expect(toggleEl()).not.toBeNull();
  });

  it('클립이 progressive면 줄이 있다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(
      vodResolved({ content: { kind: 'clip', clipId: 'clip0001' }, meta: { ...vodResolved().meta, kind: 'clip' } }),
    );
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/clips/clip0001{Enter}');
    await screen.findByRole('heading', { name: '금요 노가리 방송 - 신작 게임 해보기' });
    expect(toggleEl()).toBeInTheDocument();
  });

  it.each(['notOwn', 'unknown'] as const)('ownership %s이면 줄을 그리지 않는다', async (ownership) => {
    await openVod({ ownership });
    expect(toggleEl()).toBeNull();
  });

  it.each(['own', 'delegated', 'adminOverride', 'unchecked'] as const)('ownership %s이면 줄이 있다', async (ownership) => {
    await openVod({ ownership });
    expect(toggleEl()).toBeInTheDocument();
  });

  it('카드를 닫으면 펼친 미리보기 세션을 한 번 닫는다', async () => {
    const user = await openVod();
    await startWatch(user, toggleEl()!);
    await user.click(cardFooter().getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('접힌 채 닫으면 watchClose를 부르지 않는다', async () => {
    const user = await openVod();
    await user.click(cardFooter().getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    expect(api.watchClose).not.toHaveBeenCalled();
  });
});

describe('구간 편집 흐름(ResolveCard + RangeEditor 통합, range-editor.md RE-3)', () => {
  const SID = 'ab'.repeat(16);
  const settle = () => new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 60));
  const lastEnqueueArg = () => vi.mocked(api.enqueue).mock.lastCall?.[0] as unknown as Record<string, unknown>;
  const markStart = () => screen.getByRole('button', { name: t('watch.mark.start') });
  const markEnd = () => screen.getByRole('button', { name: t('watch.mark.end') });
  const thumb = (name: string) => screen.getByRole('slider', { name });
  const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });

  /** 빠른 다시보기 카드를 열고 편집 화면에서 [영상 보기]를 눌러 hls.js 경로로 붙인다 */
  async function openRewindPlayer(over = {}) {
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'hls', src: `watch://localhost/${SID}/pl.m3u8` });
    const user = await openCard(over);
    await openEditor(user);
    await user.click(screen.getByRole('button', { name: /^‘.+’ 영상 보기$/ }));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    return user;
  }
  /** 메타데이터가 읽힌 재생기: currentTime 쓰기를 세고 길이를 정한다 */
  async function loadMeta(duration = 11565, time = 0) {
    const v = document.querySelector('video') as HTMLVideoElement;
    let ct = time;
    const writes: number[] = [];
    Object.defineProperty(v, 'currentTime', { configurable: true, get: () => ct, set: (x: number) => { ct = x; writes.push(x); } });
    Object.defineProperty(v, 'duration', { configurable: true, get: () => duration });
    await fireEvent(v, new Event('loadedmetadata'));
    return { v, writes, setTime: (x: number) => (ct = x) };
  }
  /** 적용하고 받는다 */
  async function applyAndDownload(user: ReturnType<typeof userEvent.setup>) {
    await applyEditor(user);
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
  }

  it('편집 화면이 열린 동안 카드는 inert이고 화면은 body 직속이다', async () => {
    await openCard();
    const user = userEvent.setup();
    const dlg = await openEditor(user);
    expect(dlg.parentElement).toBe(document.body);
    const card = screen.getByRole('heading', { name: /금요/, hidden: true }).closest('.card') as HTMLElement;
    expect(card.closest('[inert]')).not.toBeNull();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: t('rangeEditor.title') })).toHaveFocus());
    expect(ui.rangeEditorOpen).toBe(true);
  });

  it('[시작 찍기]·[끝 찍기]로 찍은 값을 적용하면 enqueue의 range가 된다', async () => {
    const user = await openRewindPlayer();
    const m = await loadMeta(11565, 600.7);
    await user.click(markStart());
    m.setTime(1200.1);
    await user.click(markEnd());
    expect(rangeStartInput()).toHaveValue('0:10:00');
    expect(rangeEndInput()).toHaveValue('0:20:00');
    await applyAndDownload(user);
    expect(lastEnqueueArg().range).toEqual({ startMs: 600000, endMs: 1200000 });
  });

  it('찍은 시각이 영상 끝이면 끝까지 받기(전체)로 남는다', async () => {
    const user = await openRewindPlayer();
    await loadMeta(11565, 11565);
    await user.click(markEnd());
    await applyAndDownload(user);
    expect('range' in lastEnqueueArg()).toBe(false);
  });

  it('끝만 찍으면 시작 칸은 빈칸 그대로이고 받기 요청은 0초부터다(PS10)', async () => {
    const user = await openRewindPlayer();
    await loadMeta(11565, 65.4);
    await user.click(markEnd());
    expect(rangeStartInput()).toHaveValue('');
    expect(rangeEndInput()).toHaveValue('0:01:05');
    await applyAndDownload(user);
    expect(lastEnqueueArg().range).toEqual({ startMs: 0, endMs: 65000 });
  });

  it('끝을 시작보다 앞에 찍고 적용하면 끝 칸에 순서 오류가 나고 화면은 열린 채이며 받지 않는다', async () => {
    const user = await openRewindPlayer();
    const m = await loadMeta(11565, 1800);
    await user.click(markStart());
    m.setTime(1200);
    await user.click(markEnd());
    await user.click(applyButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('range.error.order'));
    expect(editorDialog()).not.toBeNull();
    await waitFor(() => expect(rangeEndInput()).toHaveFocus());
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('손잡이로 고친 값이 enqueue의 range가 된다', async () => {
    const user = await openRewindPlayer();
    await loadMeta();
    for (let i = 0; i < 3; i++) await key(thumb(t('range.start')), 'ArrowRight');
    await key(thumb(t('range.end')), 'ArrowLeft');
    expect(rangeStartInput()).toHaveValue('0:00:03');
    await applyAndDownload(user);
    expect(lastEnqueueArg().range).toEqual({ startMs: 3000, endMs: 11564000 });
  });

  it('끝 손잡이를 끝까지 보내면 끝 칸에 floor(길이)가 들어가고 적용하면 전체라 range가 없다', async () => {
    const user = await openRewindPlayer();
    await loadMeta();
    await key(thumb(t('range.end')), 'End');
    expect(rangeEndInput()).toHaveValue('3:12:45');
    await applyAndDownload(user);
    expect('range' in lastEnqueueArg()).toBe(false);
  });

  it('meta 길이가 없고 영상 길이로 막대를 그리면 끝 손잡이가 끝일 때 끝 칸은 빈칸(끝까지)이다', async () => {
    const base = resolved();
    await openRewindPlayer({ meta: { ...base.meta, durationSecs: null } });
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    await loadMeta(599.6);
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    await key(thumb(t('range.start')), 'ArrowRight');
    await key(thumb(t('range.end')), 'End');
    expect(rangeEndInput()).toHaveValue('');
    expect(rangeStartInput()).toHaveValue('0:00:01');
  });

  it('칸 ↑/↓가 칸을 고치고 영상도 따라가며, 적용한 값이 enqueue의 range가 된다', async () => {
    const user = await openRewindPlayer();
    const { writes } = await loadMeta();
    await fillRange(user, rangeStartInput(), '0:10:00');
    await user.tab();
    expect(writes).toEqual([600]);
    rangeStartInput().focus();
    await key(rangeStartInput(), 'ArrowUp');
    expect(rangeStartInput()).toHaveValue('0:10:01');
    await key(rangeEndInput(), 'ArrowDown');
    expect(rangeEndInput()).toHaveValue('3:12:44');
    await applyAndDownload(user);
    expect(lastEnqueueArg().range).toEqual({ startMs: 601000, endMs: 11564000 });
  });

  it('미리보기가 실패해도 막대와 칸으로 구간을 골라 받을 수 있다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError('network'));
    const user = await openCard();
    await openEditor(user);
    await user.click(screen.getByRole('button', { name: /^‘.+’ 영상 보기$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
    await key(thumb(t('range.start')), 'ArrowRight');
    await applyAndDownload(user);
    expect(lastEnqueueArg().range).toEqual({ startMs: 1000, endMs: 11565000 });
  });

  it('재생 중 편집 화면을 닫으면 세션을 한 번 닫는다', async () => {
    const user = await openRewindPlayer();
    await user.click(editorClose());
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('적용해도 세션은 한 번 닫는다', async () => {
    const user = await openRewindPlayer();
    await applyEditor(user);
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('칸은 카드마다 새로 시작한다: 앞 카드에서 적용한 구간을 이어받지 않는다', async () => {
    const user = await openCard();
    await openEditor(user);
    await fillRange(user, rangeStartInput(), '0:10:00');
    await applyEditor(user);
    expect(editButton().closest('.fieldrow')).toHaveTextContent('0:10:00~');
    resolver.close();
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    await user.clear(urlInput());
    await user.type(urlInput(), 'https://chzzk.naver.com/video/1234567{Enter}');
    await screen.findByRole('heading', { name: /금요/ });
    expect(editButton().closest('.fieldrow')).toHaveTextContent(t('range.summaryWhole.label'));
  });

  describe('Esc', () => {
    it('편집 화면 안의 Esc(칸·찍기 단추·영상)는 편집 화면만 닫고 카드는 닫지 않는다', async () => {
      const user = await openRewindPlayer();
      await loadMeta();
      const targets = [() => rangeStartInput(), () => markStart(), () => document.querySelector('video') as HTMLElement];
      for (const target of targets) {
        await fireEvent.keyDown(target(), { key: 'Escape' });
        await waitFor(() => expect(editorDialog()).toBeNull());
        expect(screen.getByRole('heading', { name: /금요/ })).toBeInTheDocument();
        await openEditor(user);
        await user.click(screen.getByRole('button', { name: /^‘.+’ 영상 보기$/ }));
        await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
        await loadMeta();
      }
    });

    it('window까지 올라간 Esc도(포커스가 body) 편집 화면만 닫고 카드는 그대로다', async () => {
      const user = await openCard();
      render(GlobalShortcuts);
      await openEditor(user);
      (document.activeElement as HTMLElement | null)?.blur();
      await fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(editorDialog()).toBeNull());
      expect(screen.getByRole('heading', { name: /금요/ })).toBeInTheDocument();
    });

    it('길게 누른 Esc: 편집 화면이 닫힌 뒤의 반복 keydown이 카드까지 닫지 않는다', async () => {
      const user = await openCard();
      render(GlobalShortcuts);
      await openEditor(user);
      await fireEvent.keyDown(rangeStartInput(), { key: 'Escape' });
      await waitFor(() => expect(editorDialog()).toBeNull());
      await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', repeat: true });
      expect(screen.getByRole('heading', { name: /금요/ })).toBeInTheDocument();
      // 반복이 아닌 Esc는 카드를 닫는다
      await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    });

    it('영상이 전체 화면이면 Esc는 편집 화면도 카드도 닫지 않는다', async () => {
      const user = await openRewindPlayer();
      render(GlobalShortcuts);
      const video = document.querySelector('video') as HTMLVideoElement;
      Object.defineProperty(document, 'fullscreenElement', { value: video, configurable: true });
      try {
        await fireEvent.keyDown(video, { key: 'Escape' });
        (document.activeElement as HTMLElement | null)?.blur();
        await fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(editorDialog()).not.toBeNull();
        expect(screen.getByRole('heading', { name: /금요/, hidden: true })).toBeInTheDocument();
      } finally {
        Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
      }
      void user;
    });
  });
});


describe('미리보기 섹션 열림(일반 VOD, preview-ux2 PS-3 + range-editor.md RE14)', () => {
  async function openVodCard() {
    vi.mocked(api.resolve).mockResolvedValue(vodResolved());
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/video/1234567{Enter}');
    await screen.findByRole('heading', { name: /금요/ });
    return user;
  }

  it('섹션은 기본 펼침이고 머리는 "미리보기", "일부만 받기" 줄은 없다', async () => {
    await openVodCard();
    expect(sectionHead().closest('details')).toHaveAttribute('open');
    expect(sectionHead()).toHaveTextContent(t('watch.toggle'));
    expect(screen.queryByText('일부만 받기')).toBeNull();
    expect(document.querySelectorAll('.watch details')).toHaveLength(1);
  });

  it('접으면 다음 카드도 접힌 채 열리고, 펴면 다음 카드도 펼쳐 열린다', async () => {
    const user = await openVodCard();
    await user.click(sectionHead());
    expect(ui.previewOpen).toBe(false);
    await user.click(cardFooter().getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());

    vi.mocked(api.resolve).mockResolvedValue(vodResolved());
    const user2 = userEvent.setup();
    await user2.clear(urlInput());
    await user2.type(urlInput(), 'https://chzzk.naver.com/video/1234567{Enter}');
    await screen.findByRole('heading', { name: /금요/ });
    expect(sectionHead().closest('details')).not.toHaveAttribute('open');
    await user2.click(sectionHead());
    expect(ui.previewOpen).toBe(true);
    expect(sectionHead().closest('details')).toHaveAttribute('open');
  });

  it('마운트 때 펼쳐진 details가 쏘는 toggle 사건은 ui.previewOpen을 쓰지 않는다', async () => {
    await openVodCard();
    const details = sectionHead().closest('details') as HTMLDetailsElement;
    await fireEvent(details, new Event('toggle'));
    expect(ui.previewOpen).toBe(true);
    ui.previewOpen = false;
    await tick();
    await fireEvent(details, new Event('toggle'));
    // 속성이 이미 닫힘으로 반영된 뒤의 사건은 같은 값이라 되쓰지 않는다
    expect(ui.previewOpen).toBe(false);
  });

  it('빠른 다시보기 카드는 ui.previewOpen을 읽지도 쓰지도 않는다', async () => {
    ui.previewOpen = false;
    const user = await openCard();
    expect(sectionHead()).toBeNull();
    await openEditor(user);
    await user.click(editorClose());
    await waitFor(() => expect(editorDialog()).toBeNull());
    expect(ui.previewOpen).toBe(false);
    ui.previewOpen = true;
    await tick();
    expect(sectionHead()).toBeNull();
    expect(screen.queryByRole('button', { name: /영상 보기/ })).toBeNull();
  });

  it('재생 중 섹션을 접으면 세션을 한 번 닫고, 다시 펴면 요청 없이 표지 자리다', async () => {
    const SID = 'ab'.repeat(16);
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'mp4', src: `watch://localhost/${SID}/v` });
    const user = await openVodCard();
    await startWatch(user);
    await user.click(sectionHead());
    await waitFor(() => expect(api.watchClose).toHaveBeenCalledTimes(1));
    await user.click(sectionHead());
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getByRole('button', { name: /영상 보기/ })).toBeInTheDocument();
    expect(api.watchOpen).toHaveBeenCalledTimes(1);
  });

  it.each(['notOwn', 'unknown'] as const)('소유 판정 %s인 빠른 다시보기 카드에는 구간 줄도 섹션도 없다(PS15)', async (ownership) => {
    await openCard({ ownership });
    expect(document.querySelector('.watch')).toBeNull();
    expect(screen.queryByRole('button', { name: t('range.edit.label') })).toBeNull();
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
  });

  it('생방송 카드에는 섹션이 없다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(liveResolved());
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/live/abcd{Enter}');
    await screen.findByRole('heading', { name: liveResolved().meta.title });
    expect(document.querySelector('.watch')).toBeNull();
  });

  it('편집 화면이 닫혀 있을 때 카드의 Esc는 카드를 닫는다(레이어가 없으니 가로채지 않는다)', async () => {
    render(GlobalShortcuts);
    await openCard();
    const spy = vi.spyOn(ui, 'escape');
    try {
      await fireEvent.keyDown(editButton(), { key: 'Escape' });
      expect(spy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    } finally {
      spy.mockRestore();
    }
  });

  it('재생 전 편집 화면: 막대가 meta 길이로 있고 손잡이는 칸만 고친다(영상·재생 위치 없음, 요청 없음)', async () => {
    const user = await openCard();
    await openEditor(user);
    expect(document.querySelector('video')).toBeNull();
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    expect(screen.getByRole('slider', { name: t('range.end') })).toHaveAttribute('aria-valuemax', '11565');
    expect(document.querySelector('.position')).toBeNull();
    await fireEvent.keyDown(screen.getByRole('slider', { name: t('range.start') }), { key: 'ArrowRight' });
    expect(rangeStartInput()).toHaveValue('0:00:01');
    expect(api.watchOpen).not.toHaveBeenCalled();
  });

  it('meta 길이가 없으면 재생 전 편집 화면에는 타임라인 대신 안내 한 줄이고 칸 줄은 "전체 구간"이다', async () => {
    const user = await openCard({ meta: { ...resolved().meta, durationSecs: null } });
    await openEditor(user);
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    expect(screen.getByText(t('rangeEditor.noLength.body'))).toBeInTheDocument();
    expect(rangeStartInput()).toBeInTheDocument();
    expect(screen.getByText(t('range.whole.label'))).toBeInTheDocument();
  });
});
