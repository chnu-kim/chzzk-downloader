import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, OutputCheck, SettingsDto } from '../../bindings';
import { check, resolved } from '../../../test/fixtures';
import { signedInAs } from '../../../test/jobFixtures';

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
};

function appError(code: AppError['code'], over: Partial<AppError> = {}): AppError {
  return { code, message: code, stage: null, resumable: false, payload: null, ...over };
}

function setCheck(c: Partial<OutputCheck> = {}) {
  vi.mocked(api.checkOutput).mockResolvedValue(check(c));
}

async function openCard(over = {}) {
  vi.mocked(api.resolve).mockResolvedValue(resolved(over));
  const user = userEvent.setup();
  render(InputPanel);
  await user.type(screen.getByLabelText('영상 주소'), 'https://chzzk.naver.com/video/1234567{Enter}');
  await screen.findByRole('heading', { name: '금요 노가리 방송 - 신작 게임 해보기' });
  return user;
}

async function downloadButton() {
  const btn = screen.getByRole('button', { name: /다운로드/ });
  await waitFor(() => expect(btn).toBeEnabled());
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

describe('UrlBar', () => {
  it('invalidUrl: 입력을 지우지 않고 오류 문구와 aria-invalid', async () => {
    vi.mocked(api.resolve).mockRejectedValue(appError('invalidUrl'));
    const user = userEvent.setup();
    render(InputPanel);
    const input = screen.getByLabelText('영상 주소');
    await user.type(input, 'https://chzzk.naver.com/live/abcd{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('치지직 VOD나 클립 주소가 아니에요');
    expect(input).toHaveValue('https://chzzk.naver.com/live/abcd');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(api.resolve).toHaveBeenCalledWith('https://chzzk.naver.com/live/abcd');
    // §9 "입력 선택": 입력 전체가 골라져 있다
    const el = input as HTMLInputElement;
    expect([el.selectionStart, el.selectionEnd]).toEqual([0, el.value.length]);

    // [다시 시도]는 같은 주소로 다시 부른다
    await user.click(within(alert).getByRole('button', { name: '다시 시도' }));
    expect(api.resolve).toHaveBeenCalledTimes(2);
    expect(api.resolve).toHaveBeenLastCalledWith('https://chzzk.naver.com/live/abcd');
  });

  it('오류를 [닫기]로 닫으면 포커스가 입력줄로 돌아온다', async () => {
    vi.mocked(api.resolve).mockRejectedValue(
      appError('http', { payload: { type: 'http', status: 404, requestKind: 'api' } }),
    );
    const user = userEvent.setup();
    render(InputPanel);
    await user.type(screen.getByLabelText('영상 주소'), 'https://chzzk.naver.com/video/1{Enter}');
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(screen.getByLabelText('영상 주소')).toHaveFocus());
  });

  it('빈 칸에 붙여넣으면 바로 불러온다', async () => {
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    const user = userEvent.setup();
    render(InputPanel);
    await user.click(screen.getByLabelText('영상 주소'));
    await user.paste('https://chzzk.naver.com/video/9');
    expect(api.resolve).toHaveBeenCalledWith('https://chzzk.naver.com/video/9');
  });

  it('불러오는 중 Esc로 취소하면 늦게 온 결과를 버린다', async () => {
    let finish!: (v: ReturnType<typeof resolved>) => void;
    vi.mocked(api.resolve).mockReturnValue(new Promise((r) => (finish = r)));
    const user = userEvent.setup();
    const { container } = render(InputPanel);
    await user.type(screen.getByLabelText('영상 주소'), 'https://chzzk.naver.com/video/1{Enter}');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    // Esc 키는 GlobalShortcuts가 ui.escape()로 넘긴다(그 연결은 shortcuts.test.ts). 여기서는 InputPanel이 쌓은 처리기를 본다.
    expect(ui.escape()).toBe(true);
    expect(resolver.state.kind).toBe('idle');
    finish(resolved());
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull();
    expect(screen.getByLabelText('영상 주소')).toHaveValue('https://chzzk.naver.com/video/1');
  });
});

describe('ResolveCard', () => {
  it('기본 화질은 defaultQualityIndex, 메타·예상 크기를 보인다', async () => {
    await openCard({ defaultQualityIndex: 1 });
    const radios = screen.getAllByRole('radio');
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios[1]).toHaveTextContent('720p');
    expect(screen.getByText('2026.10.03 21:00 방송')).toBeInTheDocument();
    expect(screen.getByText('빠른 다시보기')).toBeInTheDocument();
    // 4 Mbps × 11565초 / 8
    expect(radios[1]).toHaveTextContent('약 5.4 GB');
    expect(screen.getByRole('heading', { name: /금요/ })).toHaveFocus();
  });

  it('Esc(ui.escape)는 카드를 닫고 포커스를 입력줄로 돌린다', async () => {
    await openCard();
    expect(screen.getByRole('heading', { name: /금요/ })).toHaveFocus();
    expect(ui.escape()).toBe(true);
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    expect(resolver.state.kind).toBe('idle');
    await waitFor(() => expect(screen.getByLabelText('영상 주소')).toHaveFocus());
  });

  it('카드 [닫기]·[취소]는 포커스를 입력줄로 돌린다', async () => {
    const user = await openCard();
    await user.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.getByLabelText('영상 주소')).toHaveFocus());

    await user.click(screen.getByRole('button', { name: '불러오기' }));
    await screen.findByRole('heading', { name: /금요/ });
    await user.click(screen.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    await waitFor(() => expect(screen.getByLabelText('영상 주소')).toHaveFocus());
  });

  it('다운로드 버튼 이름에 단축키 표시가 들어가지 않는다', async () => {
    await openCard();
    expect(screen.getByRole('button', { name: '다운로드' })).toBeInTheDocument();
  });

  it('충돌 없음 → 검사 결과가 온 뒤 다운로드, 카드를 접고 입력줄로', async () => {
    const user = await openCard();
    await user.click(await downloadButton());
    expect(api.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ qualityId: 'q1080', fileName: check().fileName, restart: false, onExisting: 'skip' }),
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: /금요/ })).toBeNull());
    expect(screen.getByLabelText('영상 주소')).toHaveValue('');
    expect(screen.getByLabelText('영상 주소')).toHaveFocus();
  });

  it('완성 파일: 번호 붙이기(기본) → freeFileName, 덮어쓰기 → 같은 이름', async () => {
    setCheck({ exists: true, freeFileName: '[251003] 채널이름 - 금요 노가리 방송 (2)' });
    const user = await openCard();
    expect(await screen.findByText('같은 이름의 파일이 이미 있어요.')).toBeInTheDocument();
    expect(screen.getByLabelText('번호 붙여 새로 저장')).toBeChecked();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({
      fileName: '[251003] 채널이름 - 금요 노가리 방송 (2)',
      onExisting: 'skip',
    });
  });

  it('완성 파일: 덮어쓰기를 고르면 그 이름 그대로', async () => {
    setCheck({ exists: true, freeFileName: 'x (2)' });
    const user = await openCard();
    await user.click(await screen.findByLabelText('덮어쓰기'));
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ fileName: check().fileName, restart: false });
  });

  it('같은 작업의 .part: 기본 이어받기, [처음부터 받기]면 restart', async () => {
    setCheck({ partial: { bytes: 1288490188, sameJob: true } });
    const user = await openCard();
    expect(await screen.findByText('이전에 받다 만 파일이 있어요 (1.2 GB). 이어서 받아요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '처음부터 받기' }));
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ restart: true });
  });

  it('다른 .part: 안내만, restart=false', async () => {
    setCheck({ partial: { bytes: 10, sameJob: false } });
    const user = await openCard();
    expect(await screen.findByText('다른 화질로 받다 만 파일이 있어요. 처음부터 받아요.')).toBeInTheDocument();
    await user.click(await downloadButton());
    expect(vi.mocked(api.enqueue).mock.lastCall?.[0]).toMatchObject({ restart: false });
  });

  it('목록에 같은 파일이 있으면 다운로드를 막는다', async () => {
    setCheck({ duplicateJobId: 7 });
    await openCard();
    expect(await screen.findByText('이 파일은 이미 다운로드 목록에 있어요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /다운로드/ })).toBeDisabled();
  });

  it('파일 이름·화질을 바꾸면 다시 검사하고, 결과가 올 때까지 막는다', async () => {
    const user = await openCard();
    await downloadButton();
    await user.click(screen.getAllByRole('radio')[2]);
    expect(screen.getByRole('button', { name: /다운로드/ })).toBeDisabled();
    await downloadButton();
    expect(vi.mocked(api.checkOutput).mock.lastCall?.[0]).toMatchObject({ qualityId: 'q480' });

    const name = screen.getByLabelText('파일 이름');
    await user.clear(name);
    await user.type(name, '새 이름');
    await waitFor(() => expect(vi.mocked(api.checkOutput).mock.lastCall?.[0]).toMatchObject({ fileName: '새 이름' }));
    // 150ms 디바운스: 글자마다 부르지 않는다
    const calls = vi.mocked(api.checkOutput).mock.calls.filter(([a]) => a.fileName.startsWith('새'));
    expect(calls.length).toBeLessThan(3);
  });

  it('폴더를 카드에서 바꾸면 설정도 바꾼다', async () => {
    vi.mocked(api.pickFolder).mockResolvedValue('/Volumes/외장/영상');
    vi.mocked(api.updateSettings).mockResolvedValue({ ...settingsDto, downloadFolder: '/Volumes/외장/영상' });
    const user = await openCard();
    await user.click(screen.getByRole('button', { name: '변경' }));
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
    expect(screen.getByText('여기에 놓으면 불러와요')).toBeInTheDocument();
    await fireEvent.drop(window, { dataTransfer: data });
    expect(screen.queryByText('여기에 놓으면 불러와요')).toBeNull();
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
    const name = screen.getByLabelText('파일 이름');
    const data = dt({ 'text/plain': 'https://chzzk.naver.com/video/9' });
    await fireEvent.dragStart(name, { dataTransfer: data });
    await fireEvent.dragEnter(name, { dataTransfer: data });
    expect(screen.queryByText('여기에 놓으면 불러와요')).toBeNull();
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
    expect(screen.queryByText('여기에 놓으면 불러와요')).toBeNull();
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
    const group = await screen.findByRole('group', { name: '복사한 주소가 있어요' });
    expect(group).toHaveTextContent('chzzk.naver.com/video/42');
    await user.click(within(group).getByRole('button', { name: '불러오기' }));
    expect(api.resolve).toHaveBeenCalledWith(link);
    expect(api.enqueue).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: '복사한 주소가 있어요' })).toBeNull();
  });

  it('닫은 주소는 다시 묻지 않고, 입력이 있으면 숨긴다', async () => {
    vi.mocked(api.clipboardLink).mockResolvedValue(link);
    const user = userEvent.setup();
    render(InputPanel);
    const group = await screen.findByRole('group', { name: '복사한 주소가 있어요' });
    await user.click(within(group).getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('group', { name: '복사한 주소가 있어요' })).toBeNull();
    await fireEvent.focus(window);
    await waitFor(() => expect(api.clipboardLink).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('group', { name: '복사한 주소가 있어요' })).toBeNull();

    // 다른 주소는 제안하지만 입력줄에 글이 생기면 숨긴다
    vi.mocked(api.clipboardLink).mockResolvedValue('https://chzzk.naver.com/video/43');
    await fireEvent.focus(window);
    await screen.findByRole('group', { name: '복사한 주소가 있어요' });
    await user.type(screen.getByLabelText('영상 주소'), 'a');
    expect(screen.queryByRole('group', { name: '복사한 주소가 있어요' })).toBeNull();
  });

  it('다른 길(붙여넣기)로 불러와 목록에 넣은 주소는 다시 제안하지 않는다', async () => {
    vi.mocked(api.clipboardLink).mockResolvedValue(link);
    vi.mocked(api.resolve).mockResolvedValue(resolved());
    const user = userEvent.setup();
    render(InputPanel);
    await screen.findByRole('group', { name: '복사한 주소가 있어요' });
    await user.click(screen.getByLabelText('영상 주소'));
    await user.paste(link);
    expect(api.resolve).toHaveBeenCalledWith(link);
    await screen.findByRole('heading', { name: /금요/ });
    await user.click(await downloadButton());
    await waitFor(() => expect(screen.getByLabelText('영상 주소')).toHaveValue(''));
    expect(screen.queryByRole('group', { name: '복사한 주소가 있어요' })).toBeNull();
    // 다음 창 포커스에도 묻지 않는다
    await fireEvent.focus(window);
    await waitFor(() => expect(api.clipboardLink).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('group', { name: '복사한 주소가 있어요' })).toBeNull();
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

  it('로그인한 채널 이름을 보이고 [다운로드]는 비활성이다', async () => {
    auth.status = signedInAs('a1', '내 채널');
    await openCard({ ownership: 'notOwn', meta: { ...resolved().meta, channelName: '다른 채널', channelId: 'c3' } });
    expect(screen.getByText('내 채널의 영상만 받을 수 있어요')).toBeInTheDocument();
    expect(screen.getByText("이 영상은 '다른 채널' 채널의 영상이에요. 로그인한 채널: '내 채널'")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /다운로드/ })).toBeDisabled();
  });

  it('로그인한 채널 이름을 모르면 이름 없는 문장이다', async () => {
    await openCard({ ownership: 'notOwn' });
    expect(screen.getByText('로그인한 채널의 영상이 아니에요.')).toBeInTheDocument();
  });
});
