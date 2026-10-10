import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, OutputCheck, RecentVodDto, SettingsDto } from '../../bindings';
import { check, quality, resolved } from '../../../test/fixtures';
import { signedInAs } from '../../../test/jobFixtures';
import { errorCopy } from '../../copy/errors';
import { t } from '../../copy/ko';
import { shortcutText } from '../../platform';
import { CHECK_DEBOUNCE_MS } from '../../receive';
import { LOADER_DELAY_MS } from '../../timing';

vi.mock('../../api', () => ({
  resolve: vi.fn(),
  checkOutput: vi.fn(),
  enqueue: vi.fn(),
  clipboardLink: vi.fn(),
  pickFolder: vi.fn(),
  updateSettings: vi.fn(),
  getSettings: vi.fn(),
  appInfo: vi.fn(),
}));

const api = await import('../../api');
const { resolver } = await import('../../stores/resolve.svelte');
const { settings } = await import('../../stores/settings.svelte');
const { ui } = await import('../../stores/ui.svelte');
const { auth } = await import('../../stores/auth.svelte');
const { platform } = await import('../../stores/platform.svelte');
const { default: InputPanel } = await import('./InputPanel.svelte');

const settingsDto: SettingsDto = {
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
  keepAwake: true,
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
  vi.mocked(api.checkOutput).mockReset();
  vi.mocked(api.enqueue).mockReset().mockResolvedValue({} as never);
  vi.mocked(api.clipboardLink).mockReset().mockResolvedValue(null);
  vi.mocked(api.pickFolder).mockReset();
  vi.mocked(api.updateSettings).mockReset();
  vi.mocked(api.getSettings).mockReset().mockResolvedValue(settingsDto);
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
    setCheck({ partial: { bytes: 1288490188, sameJob: true } });
    const user = await openCard();
    expect(await screen.findByText(t('conflict.partial.title'))).toBeInTheDocument();
    expect(screen.getByText(t('conflict.partial.body', { size: '1.29GB' }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('action.restartFresh') }));
    expect(screen.getByText(t('conflict.partial.freshChosen'))).toBeInTheDocument();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ restart: true });
  });

  it('다른 .part: 안내만, restart=false', async () => {
    setCheck({ partial: { bytes: 10, sameJob: false } });
    const user = await openCard();
    expect(await screen.findByText(t('conflict.partialOther'))).toBeInTheDocument();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ restart: false });
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
    expect(api.pickFolder).toHaveBeenCalledWith('/Users/me/Movies/치지직');
    expect(api.updateSettings).toHaveBeenCalledWith({ downloadFolder: '/Volumes/외장/영상' });
    expect(await screen.findByText('/Volumes/외장/영상')).toBeInTheDocument();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ folder: '/Volumes/외장/영상' });
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
