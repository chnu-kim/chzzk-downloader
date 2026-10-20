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
      expect(screen.queryByText(t('range.toggle'))).toBeNull();
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

describe('구간 받기(ResolveCard)', () => {
  type User = ReturnType<typeof userEvent.setup>;
  const toggleEl = () => screen.getByText(t('range.toggle'));
  const detailsEl = () => toggleEl().closest('details') as HTMLDetailsElement;
  const startEl = () => screen.getByRole('textbox', { name: t('range.start') }) as HTMLInputElement;
  const endEl = () => screen.getByRole('textbox', { name: t('range.end') }) as HTMLInputElement;
  const settle = () => new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 60));

  async function openRange(user: User) {
    await user.click(toggleEl());
    await waitFor(() => expect(detailsEl()).toHaveAttribute('open'));
  }
  async function fill(user: User, el: HTMLInputElement, text: string) {
    await user.clear(el);
    await user.type(el, text);
  }
  /** 마지막 checkOutput 호출의 인자 */
  const lastCheckArg = () => vi.mocked(api.checkOutput).mock.lastCall?.[0] as unknown as Record<string, unknown>;
  const lastEnqueueArg = () => vi.mocked(api.enqueue).mock.lastCall?.[0] as unknown as Record<string, unknown>;

  it('접힘이 기본이다', async () => {
    await openCard();
    expect(detailsEl()).not.toHaveAttribute('open');
  });

  it('접힌 채 받으면 요청에 range가 없다', async () => {
    const user = await openCard();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect('range' in lastEnqueueArg()).toBe(false);
    expect('range' in lastCheckArg()).toBe(false);
  });

  it('펼쳤다 접고 받으면 range가 없다', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), '0:10:00');
    await user.click(toggleEl());
    await waitFor(() => expect(detailsEl()).not.toHaveAttribute('open'));
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect('range' in lastEnqueueArg()).toBe(false);
  });

  it('펼치기만 하면 초깃값(전체)이라 range가 없다', async () => {
    const user = await openCard();
    await openRange(user);
    expect(startEl()).toHaveValue('0:00:00');
    expect(endEl()).toHaveValue('3:12:45');
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect('range' in lastEnqueueArg()).toBe(false);
  });

  it('구간을 고르면 checkOutput과 enqueue가 같은 range를 쓴다', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), '0:10:00');
    await fill(user, endEl(), '0:20:00');
    await waitFor(() => expect(lastCheckArg().range).toEqual({ startMs: 600000, endMs: 1200000 }));
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 600000, endMs: 1200000 });
  });

  it('타이핑 중에는 오류를 내지 않는다(검증은 [받기] 때만)', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), 'abc');
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(startEl()).not.toHaveAttribute('aria-invalid');
    expect('range' in lastCheckArg()).toBe(false);
  });

  it('제출 오류(형식): 그 칸 아래 알림, aria-invalid, 포커스, 입력 보존, 받지 않음', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), 'abc');
    await settle();
    await user.click(await downloadButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('range.error.format', { example: '0:10:00' }));
    expect(alert.closest('.notice-inline')).not.toBeNull();
    expect(startEl()).toHaveAttribute('aria-invalid', 'true');
    // 설명 요소는 알림을 품은 Notice 루트다
    const ids = (startEl().getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.some((id) => document.getElementById(id)?.contains(alert))).toBe(true);
    expect(startEl()).toHaveFocus();
    expect(startEl()).toHaveValue('abc');
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('제출 오류(순서): 끝 칸', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), '0:30:00');
    await fill(user, endEl(), '0:20:00');
    await settle();
    await user.click(await downloadButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('range.error.order'));
    expect(endEl()).toHaveAttribute('aria-invalid', 'true');
    expect(endEl()).toHaveFocus();
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('제출 오류(길이 넘음): 시작 칸', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), '4:00:00');
    await settle();
    await user.click(await downloadButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('range.error.beyond'));
    expect(startEl()).toHaveFocus();
  });

  it('접으면 오류가 사라진다', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), 'abc');
    await settle();
    await user.click(await downloadButton());
    await screen.findByRole('alert');
    await user.click(toggleEl());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('Mod+Enter도 같은 검증을 한다', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), 'abc');
    await settle();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByRole('alert')).toHaveTextContent(t('range.error.format', { example: '0:10:00' }));
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('조합 중에는 오류 칸을 전체 선택하지 않는다', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, startEl(), 'abc');
    await settle();
    const select = vi.spyOn(HTMLInputElement.prototype, 'select');
    await fireEvent.compositionStart(startEl());
    await user.click(await downloadButton());
    await screen.findByRole('alert');
    expect(select).not.toHaveBeenCalled();
    select.mockRestore();
  });

  it('칸이 읽히면 화질 크기가 구간 기준이 되고, 못 읽으면 전체 기준이다', async () => {
    const user = await openCard();
    await openRange(user);
    const radio = () => screen.getAllByRole('radio')[0].closest('label') as HTMLElement;
    const q0 = resolved().qualities[0];
    await fill(user, endEl(), '1:00:00');
    await waitFor(() => expect(radio()).toHaveTextContent(qualitySize(q0, 3600) as string));
    await fill(user, endEl(), '1:00:0');
    await waitFor(() => expect(radio()).toHaveTextContent(qualitySize(q0, 11565) as string));
  });

  it('구간만 바꾸면 검사가 끝날 때까지 [받기]가 막힌다', async () => {
    const user = await openCard();
    await openRange(user);
    await fill(user, endEl(), '0:20:00');
    await settle();
    await downloadButton();
    await user.clear(endEl());
    await user.type(endEl(), '0:30:00');
    expectBlocked(screen.getByRole('button', { name: downloadName() }));
  });

  it('일반 VOD·클립·생방송 카드에는 구간 줄이 없다', async () => {
    await openCard({ playbackKind: 'progressive' });
    expect(screen.queryByText(t('range.toggle'))).toBeNull();
  });

  it('클립 카드에는 구간 줄이 없다', async () => {
    await openCard({ meta: { ...resolved().meta, kind: 'clip' }, playbackKind: 'progressive' });
    expect(screen.queryByText(t('range.toggle'))).toBeNull();
  });

  it('생방송 카드에는 구간 줄이 없다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(liveResolved());
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/live/abcd{Enter}');
    await screen.findByRole('heading', { name: liveResolved().meta.title });
    expect(screen.queryByText(t('range.toggle'))).toBeNull();
  });

  it('길이를 모르면 끝 칸이 비고 placeholder가 끝까지다', async () => {
    const user = await openCard({ meta: { ...resolved().meta, durationSecs: null } });
    await openRange(user);
    expect(endEl()).toHaveValue('');
    expect(endEl()).toHaveAttribute('placeholder', t('range.toEnd'));
    await fill(user, startEl(), '0:10:00');
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 600000, endMs: null });
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
  const toggleEl = () => screen.queryByText(t('watch.toggle'));

  /** 일반 VOD 카드를 연다(openCard는 resolved를 쓰므로 vodResolved를 직접 부른다) */
  async function openVod(over = {}) {
    vi.mocked(api.resolve).mockResolvedValue(vodResolved(over));
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/video/1234567{Enter}');
    await screen.findByRole('heading', { name: '금요 노가리 방송 - 신작 게임 해보기' });
    return user;
  }

  it('일반 VOD 카드에는 접힌 미리보기 줄이 있고 watchOpen을 부르지 않는다', async () => {
    await openVod();
    expect(toggleEl()).toBeInTheDocument();
    expect(toggleEl()!.closest('details')).not.toHaveAttribute('open');
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

  it('펼치면 카드의 주소·content로 watchOpen을 부르고 video src를 둔다', async () => {
    const user = await openVod();
    await user.click(toggleEl()!);
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

  it('빠른 다시보기 카드에도 줄이 있다(PV-6부터 HLS도 연다)', async () => {
    await openCard();
    expect(screen.getByText(t('kind.liveRewind'))).toBeInTheDocument();
    expect(toggleEl()).not.toBeNull();
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
    await user.click(toggleEl()!);
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
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

describe('구간 찍기(ResolveCard, preview.md PV17)', () => {
  const SID = 'ab'.repeat(16);
  const markStart = () => screen.queryByRole('button', { name: t('watch.mark.start') });
  const markEnd = () => screen.queryByRole('button', { name: t('watch.mark.end') });
  const startEl = () => screen.getByRole('textbox', { name: t('range.start') }) as HTMLInputElement;
  const endEl = () => screen.getByRole('textbox', { name: t('range.end') }) as HTMLInputElement;
  const rangeDetails = () => screen.getByText(t('range.toggle')).closest('details') as HTMLDetailsElement;
  const settle = () => new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 60));
  const lastEnqueueArg = () => vi.mocked(api.enqueue).mock.lastCall?.[0] as unknown as Record<string, unknown>;

  /** 빠른 다시보기 카드를 열고 미리보기를 hls.js 경로로 펼친다 */
  async function openRewindPlayer(over = {}) {
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'hls', src: `watch://localhost/${SID}/pl.m3u8` });
    const user = await openCard(over);
    await user.click(screen.getByText(t('watch.toggle')));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    return user;
  }
  /** 메타데이터가 읽힌 재생기의 currentTime을 정한다 */
  async function setTime(time: number) {
    const v = document.querySelector('video')!;
    Object.defineProperty(v, 'currentTime', { value: time, configurable: true, writable: true });
    await fireEvent(v, new Event('loadedmetadata'));
  }

  it('빠른 다시보기 카드에만 찍기 버튼이 있다(일반 VOD·클립에는 없다)', async () => {
    const user = await openRewindPlayer();
    expect(markStart()).not.toBeNull();
    expect(markEnd()).not.toBeNull();
    await user.click(cardFooter().getByRole('button', { name: t('common.close') }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());

    vi.mocked(api.resolve).mockResolvedValue(vodResolved());
    const user2 = userEvent.setup();
    await user2.clear(urlInput());
    await user2.type(urlInput(), 'https://chzzk.naver.com/video/1234567{Enter}');
    await screen.findByRole('heading', { name: /금요/ });
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'mp4', src: `watch://localhost/${SID}/v` });
    await user2.click(screen.getByText(t('watch.toggle')));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(markStart()).toBeNull();
    expect(markEnd()).toBeNull();
  });

  it('클립(progressive)에는 찍기 버튼이 없다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(
      vodResolved({ content: { kind: 'clip', clipId: 'clip0001' }, meta: { ...vodResolved().meta, kind: 'clip' } }),
    );
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/clips/clip0001{Enter}');
    await screen.findByRole('heading', { name: /금요/ });
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'mp4', src: `watch://localhost/${SID}/v` });
    await user.click(screen.getByText(t('watch.toggle')));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(markStart()).toBeNull();
  });

  it('[시작 찍기]는 구간 줄을 펼치고 시작 칸에 floor(currentTime)을 넣는다', async () => {
    const user = await openRewindPlayer();
    expect(rangeDetails()).not.toHaveAttribute('open');
    await setTime(65.9);
    await user.click(markStart()!);
    expect(rangeDetails()).toHaveAttribute('open');
    expect(startEl()).toHaveValue('0:01:05');
  });

  it('[끝 찍기]는 끝 칸을 채운다', async () => {
    const user = await openRewindPlayer();
    await setTime(3725.2);
    await user.click(markEnd()!);
    expect(rangeDetails()).toHaveAttribute('open');
    expect(endEl()).toHaveValue('1:02:05');
    expect(startEl()).toHaveValue('0:00:00');
  });

  it('찍은 시각이 영상 끝이면 끝까지 받기(전체)로 남는다', async () => {
    const user = await openRewindPlayer();
    await setTime(11565);
    await user.click(markEnd()!);
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect('range' in lastEnqueueArg()).toBe(false);
  });

  it('찍은 값이 enqueue의 range로 간다', async () => {
    const user = await openRewindPlayer();
    await setTime(600.7);
    await user.click(markStart()!);
    await setTime(1200.1);
    await user.click(markEnd()!);
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 600000, endMs: 1200000 });
  });

  it('끝을 시작보다 앞에 찍으면 [받기]에서 순서 오류가 난다', async () => {
    const user = await openRewindPlayer();
    await setTime(1800);
    await user.click(markStart()!);
    await setTime(1200);
    await user.click(markEnd()!);
    await settle();
    await user.click(await downloadButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('range.error.order'));
    expect(api.enqueue).not.toHaveBeenCalled();
  });

  it('찍어도 앞 [받기]가 남긴 구간 오류는 지워지지 않는다(손으로 칠 때와 같다)', async () => {
    const user = await openRewindPlayer();
    await user.click(screen.getByText(t('range.toggle')));
    await user.clear(startEl());
    await user.type(startEl(), 'abc');
    await settle();
    await user.click(await downloadButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('range.error.format', { example: '0:10:00' }));
    await setTime(30);
    await user.click(markEnd()!);
    expect(screen.getByRole('alert')).toHaveTextContent(t('range.error.format', { example: '0:10:00' }));
    expect(endEl()).toHaveValue('0:00:30');
  });

  it('카드가 busy(받기 요청 중)면 찍기 버튼이 비활성이다', async () => {
    let release!: (v: never) => void;
    vi.mocked(api.enqueue).mockReset().mockReturnValue(new Promise((r) => (release = r as never)));
    const user = await openRewindPlayer();
    await setTime(5);
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(markStart()).toBeDisabled());
    expect(markEnd()).toBeDisabled();
    release({} as never);
  });
});

describe('구간 편집 배치(ResolveCard, preview-ux PVU-3)', () => {
  const SID = 'ab'.repeat(16);
  const startEl = () => screen.getByRole('textbox', { name: t('range.start') }) as HTMLInputElement;
  const endEl = () => screen.getByRole('textbox', { name: t('range.end') }) as HTMLInputElement;
  const rangeDetails = () => screen.getByText(t('range.toggle')).closest('details') as HTMLDetailsElement;
  const thumb = (name: string) => screen.getByRole('slider', { name });
  const settle = () => new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 60));
  const lastEnqueueArg = () => vi.mocked(api.enqueue).mock.lastCall?.[0] as unknown as Record<string, unknown>;

  async function openRewindPlayer(over = {}) {
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'hls', src: `watch://localhost/${SID}/pl.m3u8` });
    const user = await openCard(over);
    await user.click(screen.getByText(t('watch.toggle')));
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
    return { v, writes };
  }
  const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });

  it('빠른 다시보기 카드의 순서: 메타 → 미리보기 → 일부만 받기 → 화질', async () => {
    await openCard();
    const watch = screen.getByText(t('watch.toggle'));
    const range = screen.getByText(t('range.toggle'));
    const quality = screen.getByRole('radiogroup');
    const after = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(watch, range)).toBe(true);
    expect(after(range, quality)).toBe(true);
  });

  it('미리보기를 펼치고 접어도 구간 줄은 같은 요소다(다시 마운트되지 않는다)', async () => {
    const user = await openRewindPlayer();
    const before = rangeDetails();
    await user.click(screen.getByText(t('watch.toggle')));
    expect(rangeDetails()).toBe(before);
    await user.click(screen.getByText(t('watch.toggle')));
    expect(rangeDetails()).toBe(before);
  });

  it('일반 VOD 카드에는 구간 줄도 편집 영역도 없다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(vodResolved());
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'mp4', src: `watch://localhost/${SID}/v` });
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(urlInput(), 'https://chzzk.naver.com/video/1234567{Enter}');
    await screen.findByRole('heading', { name: /금요/ });
    await user.click(screen.getByText(t('watch.toggle')));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(screen.queryByText(t('range.toggle'))).toBeNull();
    expect(screen.queryByRole('group', { name: /구간 고르기/ })).toBeNull();
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
  });

  it('시작 손잡이를 옮기면 구간 줄이 펼쳐지고 시작 칸이 바뀐다(끝 칸은 전체 값)', async () => {
    const user = await openRewindPlayer();
    await loadMeta();
    expect(rangeDetails()).not.toHaveAttribute('open');
    await key(thumb(t('range.start')), 'ArrowRight');
    expect(rangeDetails()).toHaveAttribute('open');
    expect(startEl()).toHaveValue('0:00:01');
    expect(endEl()).toHaveValue('3:12:45');
    void user;
  });

  it('끝 손잡이를 끝까지 보내면 끝 칸에 floor(길이)가 들어가고 받기 요청에는 range가 없다', async () => {
    const user = await openRewindPlayer();
    await loadMeta();
    await key(thumb(t('range.end')), 'End');
    expect(endEl()).toHaveValue('3:12:45');
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect('range' in lastEnqueueArg()).toBe(false);
  });

  it('meta 길이가 없고 영상 길이로 막대를 그리면 끝 손잡이가 끝일 때 끝 칸은 빈칸(끝까지)이다', async () => {
    const base = resolved();
    await openRewindPlayer({ meta: { ...base.meta, durationSecs: null } });
    await loadMeta(599.6);
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    await key(thumb(t('range.start')), 'ArrowRight');
    await key(thumb(t('range.end')), 'End');
    expect(endEl()).toHaveValue('');
    expect(startEl()).toHaveValue('0:00:01');
  });

  it('미리보기를 접어도 meta 길이는 남는다: 막대 길이의 주인은 카드다', async () => {
    const user = await openRewindPlayer();
    await loadMeta(300); // 영상이 meta(11565)보다 짧다: 길이는 meta가 우선
    expect(thumb(t('range.end'))).toHaveAttribute('aria-valuemax', '11565');
    await user.click(screen.getByText(t('watch.toggle')));
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    await user.click(screen.getByText(t('range.toggle')));
    expect(endEl()).toHaveValue('3:12:45');
    // 다시 펼쳐 새 영상이 더 짧아도 막대 길이는 여전히 카드의 meta 길이다
    await user.click(screen.getByText(t('watch.toggle')));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    await loadMeta(300);
    expect(thumb(t('range.end'))).toHaveAttribute('aria-valuemax', '11565');
  });

  it('meta 길이가 없고 접었다 다시 열면 영상 길이도 사라진다', async () => {
    const base = resolved();
    const user = await openRewindPlayer({ meta: { ...base.meta, durationSecs: null } });
    await loadMeta(599.6);
    expect(screen.getAllByRole('slider')).toHaveLength(2);
    await user.click(screen.getByText(t('watch.toggle')));
    await user.click(screen.getByText(t('watch.toggle')));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    // 새 loadedmetadata의 길이가 새 막대 길이다(앞 영상의 599.6이 아니다)
    await loadMeta(300);
    expect(thumb(t('range.end'))).toHaveAttribute('aria-valuemax', '300');
  });

  it('손잡이 이동은 앞 [받기]가 남긴 구간 오류를 지우고, 찍기는 지우지 않는다', async () => {
    const user = await openRewindPlayer();
    await user.click(screen.getByText(t('range.toggle')));
    await user.clear(startEl());
    await user.type(startEl(), 'abc');
    await settle();
    await user.click(await downloadButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(t('range.error.format', { example: '0:10:00' }));
    const { v } = await loadMeta();
    Object.defineProperty(v, 'currentTime', { configurable: true, writable: true, value: 30 });
    await user.click(screen.getByRole('button', { name: t('watch.mark.end') }));
    expect(screen.getByRole('alert')).toHaveTextContent(t('range.error.format', { example: '0:10:00' }));
    await key(thumb(t('range.start')), 'ArrowRight');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('접힌 채 끝을 찍으면 시작 칸은 전체 값(0:00:00)으로 돌아간다(PVU9)', async () => {
    const user = await openRewindPlayer();
    // 접힌 동안 옛 값이 남아 있게 한다
    await user.click(screen.getByText(t('range.toggle')));
    await user.clear(startEl());
    await user.type(startEl(), '0:03:00');
    await user.click(screen.getByText(t('range.toggle')));
    expect(rangeDetails()).not.toHaveAttribute('open');
    const { v } = await loadMeta();
    Object.defineProperty(v, 'currentTime', { configurable: true, writable: true, value: 65.4 });
    await user.click(screen.getByRole('button', { name: t('watch.mark.end') }));
    expect(rangeDetails()).toHaveAttribute('open');
    expect(startEl()).toHaveValue('0:00:00');
    expect(endEl()).toHaveValue('0:01:05');
  });

  it('손잡이로 고친 값이 enqueue의 range가 된다', async () => {
    const user = await openRewindPlayer();
    await loadMeta();
    for (let i = 0; i < 3; i++) await key(thumb(t('range.start')), 'ArrowRight');
    await key(thumb(t('range.end')), 'ArrowLeft');
    await settle();
    await user.click(await downloadButton());
    await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
    expect(lastEnqueueArg().range).toEqual({ startMs: 3000, endMs: 11564000 });
  });
});

describe('양방향·미세 조정·길이(ResolveCard + RangeField, preview-ux PVU-5)', () => {
  const SID = 'ab'.repeat(16);
  const startEl = () => screen.getByRole('textbox', { name: t('range.start') }) as HTMLInputElement;
  const endEl = () => screen.getByRole('textbox', { name: t('range.end') }) as HTMLInputElement;
  const rangeDetails = () => screen.getByText(t('range.toggle')).closest('details') as HTMLDetailsElement;
  const settle = () => new Promise((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 60));

  async function openRewindPlayer(over = {}) {
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'hls', src: `watch://localhost/${SID}/pl.m3u8` });
    const user = await openCard(over);
    await user.click(screen.getByText(t('watch.toggle')));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    return user;
  }
  async function loadMeta(duration = 11565, time = 0) {
    const v = document.querySelector('video') as HTMLVideoElement;
    let ct = time;
    const writes: number[] = [];
    Object.defineProperty(v, 'currentTime', { configurable: true, get: () => ct, set: (x: number) => { ct = x; writes.push(x); } });
    Object.defineProperty(v, 'duration', { configurable: true, get: () => duration });
    await fireEvent(v, new Event('loadedmetadata'));
    return { v, writes };
  }
  async function openRange(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByText(t('range.toggle')));
    await waitFor(() => expect(rangeDetails()).toHaveAttribute('open'));
  }
  async function typeInto(user: ReturnType<typeof userEvent.setup>, el: HTMLInputElement, text: string) {
    await user.clear(el);
    await user.type(el, text);
  }

  describe('칸 → 영상(blur)', () => {
    it('blur on parsed start seeks video', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      await typeInto(user, startEl(), '0:10:00');
      expect(writes).toEqual([]); // typing does not seek
      await user.tab();
      expect(writes).toEqual([600]);
    });

    it('blur on invalid does not seek', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      await typeInto(user, startEl(), '0:1x');
      await user.tab();
      expect(writes).toEqual([]);
    });

    it('blur with preview closed does nothing', async () => {
      const user = await openCard();
      await openRange(user);
      await typeInto(user, startEl(), '0:10:00');
      await user.tab();
      expect(document.querySelector('video')).toBeNull();
      expect(api.watchOpen).not.toHaveBeenCalled();
    });

    it('blur on parsed end seeks video', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      await typeInto(user, endEl(), '1:00:00');
      expect(writes).toEqual([]);
      await fireEvent.blur(endEl(), { relatedTarget: screen.getByRole('switch', { name: t('watch.range.loop.label') }) });
      expect(writes).toEqual([3600]);
    });

    it('blur before metadata does nothing', async () => {
      const user = await openRewindPlayer();
      const v = document.querySelector('video') as HTMLVideoElement;
      const writes: number[] = [];
      Object.defineProperty(v, 'currentTime', { configurable: true, get: () => 0, set: (x: number) => { writes.push(x); } });
      await openRange(user);
      await typeInto(user, startEl(), '0:10:00');
      await user.tab();
      expect(writes).toEqual([]);
    });

    it('blur without change does not seek (Tab으로 지나가기)', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      startEl().focus();
      await user.tab();
      expect(writes).toEqual([]);
    });

    it('blur into editor (track press) does not override track seek', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      await typeInto(user, startEl(), '0:10:00');
      const editor = document.querySelector('[data-local-keys]') as HTMLElement;
      await fireEvent.blur(startEl(), { relatedTarget: editor });
      expect(writes).toEqual([]);
      await typeInto(user, endEl(), '1:00:00');
      await fireEvent.blur(endEl(), { relatedTarget: screen.getByRole('slider', { name: t('range.start') }) });
      expect(writes).toEqual([]);
    });

    it('shift+tab from field into editor controls still seeks', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      await typeInto(user, startEl(), '0:10:00');
      await fireEvent.blur(startEl(), { relatedTarget: screen.getByRole('switch', { name: t('watch.range.loop.label') }) });
      expect(writes).toEqual([600]);
    });
  });

  describe('칸 ↑/↓(PS-1)', () => {
    // 기본 동작이 막히지 않았으면 true(fireEvent와 같은 뜻). Svelte 갱신이 끝난 뒤 돌려준다
    const arrow = async (el: Element, k: string, extra: Record<string, unknown> = {}) => {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra });
      if (typeof extra.keyCode === 'number') Object.defineProperty(ev, 'keyCode', { value: extra.keyCode });
      const ok = el.dispatchEvent(ev);
      await tick();
      return ok;
    };
    const hasNudgeButton = () =>
      screen.queryAllByRole('button').filter((b) => /당기기|미루기/.test(b.getAttribute('aria-label') ?? b.textContent ?? ''));

    it('no nudge buttons', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      expect(hasNudgeButton()).toHaveLength(0);
    });

    it('ArrowUp on start field adds one second, ArrowDown subtracts; default prevented', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      await typeInto(user, startEl(), '0:01:00');
      expect(await arrow(startEl(), 'ArrowUp')).toBe(false);
      expect(startEl()).toHaveValue('0:01:01');
      expect(await arrow(startEl(), 'ArrowDown')).toBe(false);
      expect(await arrow(startEl(), 'ArrowDown')).toBe(false);
      expect(startEl()).toHaveValue('0:00:59');
    });

    it('ArrowUp/Down clamps at the ends', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      await typeInto(user, startEl(), '0:00:00');
      await arrow(startEl(), 'ArrowDown');
      expect(startEl()).toHaveValue('0:00:00');
      await arrow(endEl(), 'ArrowDown');
      expect(endEl()).toHaveValue('3:12:44');
      await arrow(endEl(), 'ArrowUp');
      await arrow(endEl(), 'ArrowUp');
      expect(endEl()).toHaveValue('3:12:45');
      await typeInto(user, startEl(), '3:12:44');
      await arrow(endEl(), 'ArrowDown');
      expect(endEl()).toHaveValue('3:12:45'); // 끝 = 시작+1에서 ↓ → 그대로
    });

    it('unreadable field: arrow blocked, value unchanged', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      await typeInto(user, startEl(), 'abc');
      expect(await arrow(startEl(), 'ArrowUp')).toBe(false);
      expect(startEl()).toHaveValue('abc');
    });

    it('modifier arrows not handled', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      await typeInto(user, startEl(), '0:01:00');
      for (const m of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey']) {
        expect(await arrow(startEl(), 'ArrowUp', { [m]: true })).toBe(true);
      }
      expect(startEl()).toHaveValue('0:01:00');
    });

    it('IME composing arrow ignored', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      await typeInto(user, startEl(), '0:01:00');
      expect(await arrow(startEl(), 'ArrowUp', { isComposing: true })).toBe(true);
      expect(await arrow(startEl(), 'ArrowUp', { keyCode: 229 })).toBe(true);
      expect(startEl()).toHaveValue('0:01:00');
    });

    it('arrow seeks video when coupled; closed preview only changes the field', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      startEl().focus();
      await arrow(startEl(), 'ArrowUp');
      expect(writes).toEqual([1]);
      endEl().focus();
      await arrow(endEl(), 'ArrowDown');
      expect(writes).toEqual([1, 11564]);
    });

    it('arrow to the very end of a blank end field still seeks (영상 길이로 막대를 쓸 때)', async () => {
      const base = resolved();
      const user = await openRewindPlayer({ meta: { ...base.meta, durationSecs: null } });
      const { writes } = await loadMeta(11565.7);
      await openRange(user);
      await arrow(endEl(), 'ArrowDown');
      expect(writes.at(-1)).toBe(11564);
      await arrow(endEl(), 'ArrowUp');
      expect(endEl()).toHaveValue('');
      expect(writes.at(-1)).toBe(11565);
    });

    it('no seek when preview closed', async () => {
      const user = await openCard();
      await openRange(user);
      await arrow(startEl(), 'ArrowUp');
      expect(startEl()).toHaveValue('0:00:01');
      expect(api.watchOpen).not.toHaveBeenCalled();
    });

    it('held key changes field each repeat but seeks once on keyup', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      startEl().focus();
      await arrow(startEl(), 'ArrowUp');
      for (let i = 0; i < 4; i++) await arrow(startEl(), 'ArrowUp', { repeat: true });
      expect(startEl()).toHaveValue('0:00:05');
      expect(writes).toEqual([1]);
      await fireEvent.keyUp(startEl(), { key: 'ArrowUp' });
      expect(writes).toEqual([1, 5]);
    });

    it('held key then blur without keyup flushes final seek', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      startEl().focus();
      await arrow(startEl(), 'ArrowUp');
      for (let i = 0; i < 3; i++) await arrow(startEl(), 'ArrowUp', { repeat: true });
      await fireEvent.blur(startEl(), { relatedTarget: screen.getByRole('switch', { name: t('watch.range.loop.label') }) });
      expect(writes).toEqual([1, 4]);
    });

    it('blur after arrow does not seek again', async () => {
      const user = await openRewindPlayer();
      const { writes } = await loadMeta();
      await openRange(user);
      startEl().focus();
      await arrow(startEl(), 'ArrowUp');
      expect(writes).toEqual([1]);
      await fireEvent.blur(startEl(), { relatedTarget: null });
      expect(writes).toEqual([1]);
    });

    it('arrow clears previous range error', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      await typeInto(user, endEl(), '0:00:00');
      await settle();
      await user.click(await downloadButton());
      expect(await screen.findByRole('alert')).toHaveTextContent(t('range.error.order'));
      await arrow(endEl(), 'ArrowUp');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('busy: arrow does nothing', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      setCheck();
      vi.mocked(api.enqueue).mockImplementation(() => new Promise(() => {}));
      await settle();
      await user.click(await downloadButton());
      await waitFor(() => expect(startEl()).toBeDisabled());
      await arrow(startEl(), 'ArrowUp');
      expect(startEl()).toHaveValue('0:00:00');
    });

    it('aria-keyshortcuts on both fields', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      expect(startEl()).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
      expect(endEl()).toHaveAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown');
    });

    it('arrow feeds enqueue range', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      await arrow(startEl(), 'ArrowUp');
      await arrow(endEl(), 'ArrowDown');
      setCheck();
      await settle();
      await user.click(await downloadButton());
      await waitFor(() => expect(api.enqueue).toHaveBeenCalledTimes(1));
      const arg = vi.mocked(api.enqueue).mock.lastCall?.[0] as unknown as Record<string, unknown>;
      expect(arg.range).toEqual({ startMs: 1000, endMs: 11564000 });
    });
  });

  describe('구간 길이 줄', () => {
    const lengthLine = (text: string) => screen.queryByText(text);

    it('length line: 전체는 영상 길이, 구간이면 구간 길이, 크기 있음 → 길이 · 크기', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      const q0 = resolved().qualities[0];
      expect(lengthLine(t('range.lengthSize.label', { length: '3:12:45', size: qualitySize(q0, 11565) as string }))).not.toBeNull();
      await typeInto(user, endEl(), '1:00:00');
      await waitFor(() =>
        expect(lengthLine(t('range.lengthSize.label', { length: '1:00:00', size: qualitySize(q0, 3600) as string }))).not.toBeNull(),
      );
    });

    it('length line: 칸이 틀리면 영상 길이로 돌아간다', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      const q0 = resolved().qualities[0];
      await typeInto(user, endEl(), '1:00:0');
      await waitFor(() =>
        expect(lengthLine(t('range.lengthSize.label', { length: '3:12:45', size: qualitySize(q0, 11565) as string }))).not.toBeNull(),
      );
    });

    it('length line: 크기를 모르는 화질이면 길이만', async () => {
      const user = await openRewindPlayer();
      await openRange(user);
      await user.click(screen.getAllByRole('radio')[2]);
      await waitFor(() => expect(lengthLine(t('range.length.label', { length: '3:12:45' }))).not.toBeNull());
    });

    it('length line: 끝을 모르면 줄이 없다', async () => {
      const user = await openCard({ meta: { ...resolved().meta, durationSecs: null } });
      await openRange(user);
      expect(screen.queryByText(/구간 길이/)).toBeNull();
    });
  });
});

describe('구간 편집 영역의 Esc(ResolveCard + GlobalShortcuts, preview-ux PVU-4 5c)', () => {
  const SID = 'ab'.repeat(16);

  it('편집 영역 밖의 구간 칸에서는 Esc가 카드를 닫고, 영역 안의 [시작 찍기]에서는 닫지 않는다', async () => {
    render(GlobalShortcuts);
    vi.mocked(api.watchOpen).mockResolvedValue({ id: SID, kind: 'hls', src: `watch://localhost/${SID}/pl.m3u8` });
    const user = await openCard();
    await user.click(screen.getByText(t('watch.toggle')));
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    // 영상 메타가 읽혀야 편집 영역(막대·조작 줄)이 선다
    const v = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(v, 'duration', { configurable: true, get: () => 11565 });
    await fireEvent(v, new Event('loadedmetadata'));
    await user.click(screen.getByText(t('range.toggle')));
    const field = screen.getByRole('textbox', { name: t('range.start') });
    const mark = screen.getByRole('button', { name: t('watch.mark.start') });
    // 구간 칸은 편집 영역(.editor) 밖이어야 한다
    expect(field.closest('[data-local-keys]')).toBeNull();
    expect(mark.closest('[data-local-keys]')).not.toBeNull();

    const spy = vi.spyOn(ui, 'escape');
    try {
      await fireEvent.keyDown(mark, { key: 'Escape' });
      expect(spy).not.toHaveBeenCalled();
      expect(screen.queryByRole('heading', { name: /금요/ })).not.toBeNull();
      await fireEvent.keyDown(field, { key: 'Escape' });
      expect(spy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    } finally {
      spy.mockRestore();
    }
  });
});
