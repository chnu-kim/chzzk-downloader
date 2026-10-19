import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, WatchOpenDto } from '../../bindings';
import { vodResolved } from '../../../test/fixtures';
import { errorCopy } from '../../copy/errors';
import { t } from '../../copy/ko';

vi.mock('../../api', () => ({
  watchOpen: vi.fn(),
  watchClose: vi.fn(),
  openContentPage: vi.fn(),
}));

const api = await import('../../api');
const { default: WatchPanel } = await import('./WatchPanel.svelte');

const SID = 'ab'.repeat(16);
const SRC = `watch://localhost/${SID}/v`;
const opened = (over: Partial<WatchOpenDto> = {}): WatchOpenDto => ({ id: SID, kind: 'mp4', src: SRC, ...over });
const appError = (code: AppError['code']): AppError => ({ code, message: code, stage: null, resumable: false, payload: null });

const view = vodResolved();
const toggle = () => screen.getByText(t('watch.toggle'));
const videoEl = () => document.querySelector('video') as HTMLVideoElement | null;

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(toggle());
}

beforeEach(() => {
  vi.mocked(api.watchOpen).mockReset().mockResolvedValue(opened());
  vi.mocked(api.watchClose).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(api.openContentPage).mockReset().mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WatchPanel', () => {
  it('기본은 접혀 있고 watchOpen을 부르지 않는다', () => {
    render(WatchPanel, { view });
    expect(toggle().closest('details')).not.toHaveAttribute('open');
    expect(api.watchOpen).not.toHaveBeenCalled();
    expect(videoEl()).toBeNull();
  });

  it('펼치면 카드의 주소·content로 watchOpen을 부르고 video src를 DTO 값으로 둔다', async () => {
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(api.watchOpen).toHaveBeenCalledTimes(1);
    expect(api.watchOpen).toHaveBeenCalledWith(view.url, view.content);
    expect(videoEl()!.getAttribute('src')).toBe(SRC);
  });

  it('video는 자동재생이 없고 preload=metadata, 네이티브 controls, aria-label은 copy deck', async () => {
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    const v = videoEl()!;
    expect(v.hasAttribute('autoplay')).toBe(false);
    expect(v.autoplay).toBe(false);
    expect(v.getAttribute('preload')).toBe('metadata');
    expect(v.hasAttribute('controls')).toBe(true);
    expect(v.hasAttribute('playsinline')).toBe(true);
    expect(v).toHaveAttribute('aria-label', t('watch.player.a11y', { title: view.meta.title }));
  });

  it('열리는 동안에는 video가 없고 자리 표시 상자가 있다', async () => {
    let resolve!: (d: WatchOpenDto) => void;
    vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    expect(videoEl()).toBeNull();
    expect(document.querySelector('.stage')).not.toBeNull();
    resolve(opened());
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(document.querySelector('.stage')).toBeNull();
  });

  it('게이트 오류(notOwnContent)는 받기와 같은 오류 문구를 보이고 video가 없다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError('notOwnContent'));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(errorCopy(appError('notOwnContent'), { place: 'resolve' }).title);
    expect(videoEl()).toBeNull();
    expect(api.watchClose).not.toHaveBeenCalled();
  });

  it('그 밖의 열기 실패는 한 문구와 [다시 시도]·[치지직에서 보기]를 보인다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValueOnce(appError('network'));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('watch.error.body'));
    // 재시도는 watchOpen을 다시 부르고 성공하면 video가 뜬다
    await user.click(screen.getByRole('button', { name: t('action.retry') }));
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(api.watchOpen).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('video 오류는 inline Notice에 [다시 시도]·[치지직에서 보기]가 있고 재시도가 세션을 새로 연다', async () => {
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    await fireEvent.error(videoEl()!);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('watch.error.body'));
    expect(videoEl()).toBeNull();
    expect(screen.getByRole('button', { name: t('watch.openInChzzk.label') })).toBeInTheDocument();

    vi.mocked(api.watchOpen).mockResolvedValue(opened({ id: 'cd'.repeat(16), src: 'watch://localhost/new/v' }));
    await user.click(screen.getByRole('button', { name: t('action.retry') }));
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(api.watchOpen).toHaveBeenCalledTimes(2);
    expect(videoEl()!.getAttribute('src')).toBe('watch://localhost/new/v');
    // 낡은 세션은 닫혔다(새 세션은 아직 열려 있다)
    expect(api.watchClose).toHaveBeenCalledTimes(1);
    expect(api.watchClose).toHaveBeenCalledWith(SID);
  });

  it('[치지직에서 보기]는 카드의 content로 openContentPage를 부른다(웹뷰 문자열 없음)', async () => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError('network'));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    await user.click(await screen.findByRole('button', { name: t('watch.openInChzzk.label') }));
    expect(api.openContentPage).toHaveBeenCalledWith(view.content);
  });

  it('canPlayType이 비면 src를 달지 않고 세션을 닫은 채 실패 Notice', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
    expect(videoEl()).toBeNull();
    await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('mp4가 아닌 종류가 오면(이 PR은 mp4만) 세션을 닫고 실패 Notice', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ kind: 'hls' }));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(videoEl()).toBeNull();
    await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
  });

  it('접으면 watchClose를 한 번 부르고, 이어서 지워져도 다시 부르지 않는다', async () => {
    const user = userEvent.setup();
    const { unmount } = render(WatchPanel, { view });
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    await user.click(toggle());
    await waitFor(() => expect(api.watchClose).toHaveBeenCalledTimes(1));
    expect(api.watchClose).toHaveBeenCalledWith(SID);
    expect(videoEl()).toBeNull();
    unmount();
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('펼친 채 지워지면(카드 닫기) watchClose를 한 번 부른다', async () => {
    const user = userEvent.setup();
    const { unmount } = render(WatchPanel, { view });
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    unmount();
    expect(api.watchClose).toHaveBeenCalledTimes(1);
    expect(api.watchClose).toHaveBeenCalledWith(SID);
  });

  it('열리는 중에 접으면 늦게 온 세션을 곧바로 닫고 video를 그리지 않는다', async () => {
    let resolve!: (d: WatchOpenDto) => void;
    vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    await user.click(toggle());
    resolve(opened());
    await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
    expect(videoEl()).toBeNull();
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('열린 적 없이 지워지면 watchClose를 부르지 않는다', () => {
    const { unmount } = render(WatchPanel, { view });
    unmount();
    expect(api.watchClose).not.toHaveBeenCalled();
  });

  it('접었다 다시 펼치면 새 세션을 연다', async () => {
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    await user.click(toggle());
    await waitFor(() => expect(videoEl()).toBeNull());
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ id: 'ef'.repeat(16) }));
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(api.watchOpen).toHaveBeenCalledTimes(2);
  });
});
