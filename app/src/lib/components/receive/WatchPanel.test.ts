import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, WatchOpenDto } from '../../bindings';
import { vodResolved } from '../../../test/fixtures';
import { errorCopy } from '../../copy/errors';
import { t } from '../../copy/ko';
import { announcer } from '../../stores/announce.svelte';

vi.mock('../../api', () => ({
  watchOpen: vi.fn(),
  watchClose: vi.fn(),
  openContentPage: vi.fn(),
}));

// hls.js/light 흉내: 실제 MSE 없이 생성자 인자·호출·오류 이벤트만 본다
const hlsMock = vi.hoisted(() => {
  const instances: Array<{
    config: Record<string, unknown>;
    handlers: Map<string, (event: string, data: unknown) => void>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  class FakeHls {
    static supported = true;
    static isSupported = () => FakeHls.supported;
    static Events = { ERROR: 'hlsError' };
    config: Record<string, unknown>;
    handlers = new Map<string, (event: string, data: unknown) => void>();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor(config: Record<string, unknown>) {
      this.config = config;
      instances.push(this);
    }
    on(event: string, handler: (event: string, data: unknown) => void) {
      this.handlers.set(event, handler);
    }
    emit(event: string, data: unknown) {
      this.handlers.get(event)?.(event, data);
    }
  }
  return { FakeHls, instances };
});
vi.mock('hls.js/light', () => ({ default: hlsMock.FakeHls }));

const api = await import('../../api');
const { default: WatchPanel } = await import('./WatchPanel.svelte');

const SID = 'ab'.repeat(16);
const SRC = `watch://localhost/${SID}/v`;
const opened = (over: Partial<WatchOpenDto> = {}): WatchOpenDto => ({ id: SID, kind: 'mp4', src: SRC, ...over });
const appError = (code: AppError['code']): AppError => ({ code, message: code, stage: null, resumable: false, payload: null });

const view = vodResolved();
const toggle = () => screen.getByText(t('watch.toggle'));
const videoEl = () => document.querySelector('video') as HTMLVideoElement | null;

const startBtn = () => screen.getByRole('button', { name: t('watch.start.a11y', { title: view.meta.title }) });

/** 줄만 펼친다(PS-2: 이것만으로는 watch_open을 부르지 않는다) */
async function expandOnly(user: ReturnType<typeof userEvent.setup>) {
  await user.click(toggle());
}

/** 펼치고 [영상 보기]를 눌러 세션을 연다 */
async function expand(user: ReturnType<typeof userEvent.setup>) {
  await expandOnly(user);
  await user.click(startBtn());
}

const HLS_SRC = `watch://localhost/${SID}/pl.m3u8`;
const hlsOpened = (over: Partial<WatchOpenDto> = {}) => opened({ kind: 'hls', src: HLS_SRC, ...over });
const lastHls = () => hlsMock.instances[hlsMock.instances.length - 1];
/** 오류 이벤트를 보낸다(오류 객체에 서명 주소 모양의 표지 문자열을 심을 수 있다) */
const hlsError = (data: Record<string, unknown>) => (lastHls() as unknown as { emit(e: string, d: unknown): void }).emit('hlsError', data);

beforeEach(() => {
  hlsMock.instances.length = 0;
  hlsMock.FakeHls.supported = true;
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

  it.each(['notLoggedIn', 'notOwnContent', 'ownershipUnknown'] as const)(
    '게이트 오류(%s)는 받기와 같은 오류 문구를 보이고 재시도·치지직 버튼과 video가 없다',
    async (code) => {
      vi.mocked(api.watchOpen).mockRejectedValue(appError(code));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(errorCopy(appError(code), { place: 'resolve' }).title);
      expect(alert).not.toHaveTextContent(t('watch.error.body'));
      expect(screen.queryByRole('button', { name: t('action.retry') })).toBeNull();
      expect(screen.queryByRole('button', { name: t('watch.openInChzzk.label') })).toBeNull();
      expect(videoEl()).toBeNull();
      expect(api.watchClose).not.toHaveBeenCalled();
    },
  );

  it('게이트가 아닌 코드(network)는 일반 문구와 두 버튼을 보인다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError('network'));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
    expect(screen.getByRole('button', { name: t('action.retry') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('watch.openInChzzk.label') })).toBeInTheDocument();
  });

  it('접은 뒤에 늦게 온 거절은 버려지고 닫힌 채 알림이 없다', async () => {
    let reject!: (e: AppError) => void;
    vi.mocked(api.watchOpen).mockReturnValue(new Promise((_, rj) => (reject = rj)));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    await user.click(toggle());
    reject(appError('network'));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(toggle().closest('details')).not.toHaveAttribute('open');
    expect(videoEl()).toBeNull();
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

  it('mp4도 hls도 아닌 종류가 오면 세션을 닫고 실패 Notice', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ kind: 'dash' as never }));
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(videoEl()).toBeNull();
    await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
    expect(hlsMock.instances).toHaveLength(0);
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

  it('접었다 다시 펼치면 표지 자리로 돌아가 있고 자동으로 열지 않는다, [영상 보기]를 누르면 새 세션을 연다', async () => {
    const user = userEvent.setup();
    render(WatchPanel, { view });
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    await user.click(toggle());
    await waitFor(() => expect(videoEl()).toBeNull());
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ id: 'ef'.repeat(16) }));
    await expandOnly(user);
    expect(videoEl()).toBeNull();
    expect(api.watchOpen).toHaveBeenCalledTimes(1);
    await user.click(startBtn());
    await waitFor(() => expect(videoEl()).not.toBeNull());
    expect(api.watchOpen).toHaveBeenCalledTimes(2);
  });

  describe('표지 자리·지연 세션(PS-2)', () => {
    const externalField = () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      return input;
    };
    let play: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      vi.spyOn(announcer, 'say').mockImplementation(() => {});
    });
    afterEach(() => {
      document.querySelectorAll('body > input').forEach((el) => el.remove());
    });

    it('expand shows stage with 영상 보기 and makes no watch_open', async () => {
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expandOnly(user);
      expect(startBtn()).toBeInTheDocument();
      expect(startBtn()).toHaveTextContent(t('watch.start.label'));
      expect(document.querySelector('.stage')).not.toBeNull();
      expect(videoEl()).toBeNull();
      expect(api.watchOpen).not.toHaveBeenCalled();
    });

    it('clicking 영상 보기 opens session once and shows loading with focus kept', async () => {
      let resolve!: (d: WatchOpenDto) => void;
      vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expandOnly(user);
      await user.click(startBtn());
      await user.click(startBtn()); // 연타: 두 번째는 loading이라 무시
      expect(api.watchOpen).toHaveBeenCalledTimes(1);
      expect(startBtn()).toHaveAttribute('aria-disabled', 'true');
      expect(startBtn()).toHaveFocus();
      resolve(opened());
      await waitFor(() => expect(videoEl()).not.toBeNull());
    });

    it('ready moves focus to video and tries play once', async () => {
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(videoEl()).not.toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(videoEl()));
      expect(play).toHaveBeenCalledTimes(1);
    });

    it('play rejection keeps ready without notice', async () => {
      play.mockRejectedValue(new DOMException('NotAllowedError'));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(videoEl()).not.toBeNull());
      await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 0));
      expect(videoEl()).not.toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(announcer.say).not.toHaveBeenCalled();
    });

    it('hls: focus and play come after attachMedia', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view, markable: true });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      await waitFor(() => expect(document.activeElement).toBe(videoEl()));
      expect(play).toHaveBeenCalledTimes(1);
      expect(lastHls().attachMedia).toHaveBeenCalledTimes(1);
      // 순서: 붙이기 → 재생 시도(play가 먼저면 아직 소스가 없는 video를 재생하려는 것이다)
      expect(lastHls().attachMedia.mock.invocationCallOrder[0]).toBeLessThan(play.mock.invocationCallOrder[0]);
      expect(lastHls().loadSource.mock.invocationCallOrder[0]).toBeLessThan(play.mock.invocationCallOrder[0]);
    });

    it('focus moved away during opening stays put on ready', async () => {
      let resolve!: (d: WatchOpenDto) => void;
      vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      const field = externalField();
      await expand(user);
      field.focus();
      resolve(opened());
      await waitFor(() => expect(videoEl()).not.toBeNull());
      await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
      expect(field).toHaveFocus();
    });

    it('focus moved away during opening stays put on failed too', async () => {
      let reject!: (e: AppError) => void;
      vi.mocked(api.watchOpen).mockReturnValue(new Promise((_, rj) => (reject = rj)));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      const field = externalField();
      await expand(user);
      field.focus();
      reject(appError('network'));
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(field).toHaveFocus();
    });

    it('collapse while opening closes late session and returns to idle', async () => {
      let resolve!: (d: WatchOpenDto) => void;
      vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await user.click(toggle());
      resolve(opened());
      await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
      expect(api.watchClose).toHaveBeenCalledTimes(1);
      expect(videoEl()).toBeNull();
      await expandOnly(user);
      expect(startBtn()).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('collapse while ready closes session once and returns to idle; re-expand makes no watch_open', async () => {
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(videoEl()).not.toBeNull());
      await user.click(toggle());
      await waitFor(() => expect(api.watchClose).toHaveBeenCalledTimes(1));
      await expandOnly(user);
      expect(videoEl()).toBeNull();
      expect(startBtn()).toBeInTheDocument();
      expect(api.watchOpen).toHaveBeenCalledTimes(1);
    });

    it('failure moves focus to summary and leaves the announcing to the alert Notice; retry opens again', async () => {
      vi.mocked(api.watchOpen).mockRejectedValueOnce(appError('network'));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
      expect(announcer.say).not.toHaveBeenCalled();
      await waitFor(() => expect(document.activeElement).toBe(toggle().closest('summary')));
      await user.click(screen.getByRole('button', { name: t('action.retry') }));
      await waitFor(() => expect(videoEl()).not.toBeNull());
      expect(api.watchOpen).toHaveBeenCalledTimes(2);
    });

    it('gate denial shows the same copy as 받기 in the alert and moves focus to summary', async () => {
      vi.mocked(api.watchOpen).mockRejectedValue(appError('notLoggedIn'));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      const title = errorCopy(appError('notLoggedIn'), { place: 'resolve' }).title;
      expect(await screen.findByRole('alert')).toHaveTextContent(title);
      expect(announcer.say).not.toHaveBeenCalled();
      await waitFor(() => expect(document.activeElement).toBe(toggle().closest('summary')));
    });

    it('mid-play error leaves focus elsewhere alone and does not announce twice', async () => {
      const user = userEvent.setup();
      render(WatchPanel, { view });
      const field = externalField();
      await expand(user);
      await waitFor(() => expect(videoEl()).not.toBeNull());
      await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
      field.focus();
      await fireEvent.error(videoEl()!);
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(announcer.say).not.toHaveBeenCalled();
      expect(field).toHaveFocus();
    });

    it('mid-play error with focus on the video moves focus to summary', async () => {
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(document.activeElement).toBe(videoEl()));
      await fireEvent.error(videoEl()!);
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      await waitFor(() => expect(document.activeElement).toBe(toggle().closest('summary')));
      expect(announcer.say).not.toHaveBeenCalled();
    });

    it('hls fatal mid-play fails, moves focus from the video to summary and does not announce', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view, markable: true });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      await waitFor(() => expect(document.activeElement).toBe(videoEl()));
      hlsError({ fatal: true });
      expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
      await waitFor(() => expect(document.activeElement).toBe(toggle().closest('summary')));
      expect(lastHls().destroy).toHaveBeenCalledTimes(1);
      expect(api.watchClose).toHaveBeenCalledTimes(1);
      expect(announcer.say).not.toHaveBeenCalled();
    });

    it('native m3u8 path (hls.js unsupported) also focuses the video and plays once', async () => {
      hlsMock.FakeHls.supported = false;
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) => (type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''));
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view, markable: true });
      await expand(user);
      await waitFor(() => expect(videoEl()).not.toBeNull());
      expect(videoEl()!.getAttribute('src')).toBe(HLS_SRC);
      await waitFor(() => expect(document.activeElement).toBe(videoEl()));
      expect(play).toHaveBeenCalledTimes(1);
      expect(hlsMock.instances).toHaveLength(0);
    });

    it('card closed (destroy) while opening closes the late session', async () => {
      let resolve!: (d: WatchOpenDto) => void;
      vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
      const user = userEvent.setup();
      const { unmount } = render(WatchPanel, { view });
      await expand(user);
      unmount();
      expect(api.watchClose).not.toHaveBeenCalled();
      resolve(opened());
      await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
      expect(api.watchClose).toHaveBeenCalledTimes(1);
    });

    it('rewind (markable) card also starts idle without editor', async () => {
      const user = userEvent.setup();
      render(WatchPanel, { view, markable: true });
      await expandOnly(user);
      expect(startBtn()).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: /구간 고르기/ })).toBeNull();
      expect(api.watchOpen).not.toHaveBeenCalled();
    });
  });

  describe('HLS(hls.js light)', () => {
    it('hls 종류는 hls.js light를 동적으로 불러 enableWorker false로 video에 붙인다(src는 loadSource로만)', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      const h = lastHls();
      expect(h.config).toMatchObject({ enableWorker: false, lowLatencyMode: false });
      expect(h.loadSource).toHaveBeenCalledWith(HLS_SRC);
      expect(h.attachMedia).toHaveBeenCalledWith(videoEl());
      // MSE로 붙이므로 video 자체에는 src를 달지 않는다
      expect(videoEl()!.hasAttribute('src')).toBe(false);
      expect(videoEl()!.getAttribute('preload')).toBe('metadata');
      expect(videoEl()!.hasAttribute('autoplay')).toBe(false);
      expect(api.watchClose).not.toHaveBeenCalled();
    });

    it('hls.js를 못 쓰지만 네이티브 m3u8을 읽으면 video src를 쓴다', async () => {
      hlsMock.FakeHls.supported = false;
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) =>
        type === 'application/vnd.apple.mpegurl' ? 'maybe' : '',
      );
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(videoEl()).not.toBeNull());
      expect(videoEl()!.getAttribute('src')).toBe(HLS_SRC);
      expect(hlsMock.instances).toHaveLength(0);
      expect(api.watchClose).not.toHaveBeenCalled();
    });

    it('hls.js도 네이티브도 못 쓰면 세션을 닫고 실패 Notice', async () => {
      hlsMock.FakeHls.supported = false;
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
      expect(videoEl()).toBeNull();
      await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
      expect(api.watchClose).toHaveBeenCalledTimes(1);
      expect(hlsMock.instances).toHaveLength(0);
    });

    it('치명 오류는 실패 Notice로 가고 hls.destroy와 watchClose를 한 번씩 부른다', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      const h = lastHls();
      hlsError({ fatal: true, details: 'manifestLoadError' });
      expect(await screen.findByRole('alert')).toHaveTextContent(t('watch.error.body'));
      expect(videoEl()).toBeNull();
      expect(h.destroy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
      expect(api.watchClose).toHaveBeenCalledTimes(1);
    });

    it('치명이 아닌 오류는 무시한다(hls.js가 스스로 복구한다)', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      hlsError({ fatal: false, details: 'fragLoadError' });
      expect(screen.queryByRole('alert')).toBeNull();
      expect(videoEl()).not.toBeNull();
      expect(lastHls().destroy).not.toHaveBeenCalled();
      expect(api.watchClose).not.toHaveBeenCalled();
    });

    it('접으면 hls.destroy와 watchClose를 한 번씩 부르고 이어서 지워져도 다시 부르지 않는다', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      const { unmount } = render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      const h = lastHls();
      await user.click(toggle());
      await waitFor(() => expect(h.destroy).toHaveBeenCalledTimes(1));
      expect(api.watchClose).toHaveBeenCalledTimes(1);
      expect(api.watchClose).toHaveBeenCalledWith(SID);
      expect(videoEl()).toBeNull();
      unmount();
      expect(h.destroy).toHaveBeenCalledTimes(1);
      expect(api.watchClose).toHaveBeenCalledTimes(1);
    });

    it('펼친 채 지워져도(카드 닫기) hls.destroy를 부른다', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      const { unmount } = render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      const h = lastHls();
      unmount();
      expect(h.destroy).toHaveBeenCalledTimes(1);
      expect(api.watchClose).toHaveBeenCalledWith(SID);
    });

    it('오류는 fatal만 보고, 오류 객체의 url(전체 세션 ID)을 화면·IPC·로그로 넘기지 않는다', async () => {
      const MARK = 'LEAK-MARK-9f3a';
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      hlsError({
        fatal: true,
        details: 'fragLoadError',
        url: `watch://localhost/${MARK}/s/3`,
        frag: { url: `watch://localhost/${MARK}/s/3` },
        response: { url: `watch://localhost/${MARK}/s/3`, code: 502 },
        error: new Error(`failed ${MARK}`),
      });
      await screen.findByRole('alert');
      expect(document.body.innerHTML).not.toContain(MARK);
      const ipcArgs = JSON.stringify([
        vi.mocked(api.watchOpen).mock.calls,
        vi.mocked(api.watchClose).mock.calls,
        vi.mocked(api.openContentPage).mock.calls,
      ]);
      expect(ipcArgs).not.toContain(MARK);
      for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(MARK);
    });

    it('열리는 중에 접으면 hls.js를 만들지 않고 늦게 온 세션을 닫는다', async () => {
      let resolve!: (d: WatchOpenDto) => void;
      vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await user.click(toggle());
      resolve(hlsOpened());
      await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
      expect(hlsMock.instances).toHaveLength(0);
      expect(videoEl()).toBeNull();
    });

    it('video가 그려진 직후 접으면(붙이기 직전) hls.js를 만들지 않고 세션을 닫는다', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      // video가 DOM에 들어오는 바로 그 마이크로태스크에서 접는다(hls.js를 붙이기 전의 틈)
      const observer = new MutationObserver(() => {
        if (!videoEl()) return;
        observer.disconnect();
        const details = toggle().closest('details') as HTMLDetailsElement;
        details.open = false;
        details.dispatchEvent(new Event('toggle'));
      });
      observer.observe(document.body, { childList: true, subtree: true });
      await expand(user);
      await waitFor(() => expect(api.watchClose).toHaveBeenCalledWith(SID));
      await new Promise((r) => setTimeout(r, 0));
      observer.disconnect();
      expect(hlsMock.instances).toHaveLength(0);
      expect(api.watchClose).toHaveBeenCalledTimes(1);
    });

    it('치명 오류 뒤 [다시 시도]는 새 세션과 새 hls.js를 만든다', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      hlsError({ fatal: true, details: 'levelLoadError' });
      await user.click(await screen.findByRole('button', { name: t('action.retry') }));
      await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
      expect(hlsMock.instances[0].destroy).toHaveBeenCalledTimes(1);
      expect(hlsMock.instances[1].loadSource).toHaveBeenCalledWith(HLS_SRC);
    });
  });
  describe('구간 찍기(PV-7)', () => {
    const markStart = () => screen.queryByRole('button', { name: t('watch.mark.start') });
    const markEnd = () => screen.queryByRole('button', { name: t('watch.mark.end') });

    /** 빠른 다시보기로 연다. markable은 카드가 정한다(빠른 다시보기 tone) */
    async function openHlsMarkable(onmark = vi.fn(), disabled = false) {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view, markable: true, onmark, disabled });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      return { user, onmark };
    }
    /** 메타데이터가 읽힌 것처럼 currentTime을 정해 이벤트를 쏜다 */
    async function loaded(time: number) {
      const v = videoEl()!;
      Object.defineProperty(v, 'currentTime', { value: time, configurable: true, writable: true });
      await fireEvent(v, new Event('loadedmetadata'));
    }

    it('markable이 아니면(일반 VOD·클립) 찍기 버튼이 없다', async () => {
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view });
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
      await loaded(10);
      expect(markStart()).toBeNull();
      expect(markEnd()).toBeNull();
    });

    it('mp4 경로에는 markable이어도 버튼이 없다', async () => {
      const user = userEvent.setup();
      render(WatchPanel, { view, markable: true, onmark: vi.fn() });
      await expand(user);
      await waitFor(() => expect(videoEl()).not.toBeNull());
      expect(markStart()).toBeNull();
    });

    it('메타데이터가 읽히기 전에는 비활성이다', async () => {
      await openHlsMarkable();
      expect(markStart()).toBeDisabled();
      expect(markEnd()).toBeDisabled();
      await loaded(0);
      expect(markStart()).toBeEnabled();
      expect(markEnd()).toBeEnabled();
    });

    it('[시작 찍기]는 floor(currentTime)을 onmark로 넘긴다', async () => {
      const { user, onmark } = await openHlsMarkable();
      await loaded(65.9);
      await user.click(markStart()!);
      expect(onmark).toHaveBeenCalledExactlyOnceWith('start', 65);
    });

    it('[끝 찍기]는 끝 칸으로 넘긴다', async () => {
      const { user, onmark } = await openHlsMarkable();
      await loaded(3599.99);
      await user.click(markEnd()!);
      expect(onmark).toHaveBeenCalledExactlyOnceWith('end', 3599);
    });

    it('찍는 순간의 currentTime을 읽는다(메타데이터 때가 아니다)', async () => {
      const { user, onmark } = await openHlsMarkable();
      await loaded(1);
      Object.defineProperty(videoEl()!, 'currentTime', { value: 120.4, configurable: true, writable: true });
      await user.click(markStart()!);
      expect(onmark).toHaveBeenCalledWith('start', 120);
    });

    it('disabled(카드 busy)면 메타데이터가 읽혀도 비활성이다', async () => {
      await openHlsMarkable(vi.fn(), true);
      await loaded(5);
      expect(markStart()).toBeDisabled();
      expect(markEnd()).toBeDisabled();
    });

    it('hls.js를 못 쓰고 네이티브 m3u8로 재생하면 찍기 버튼이 없다', async () => {
      hlsMock.FakeHls.supported = false;
      vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) =>
        type === 'application/vnd.apple.mpegurl' ? 'maybe' : '',
      );
      vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
      const user = userEvent.setup();
      render(WatchPanel, { view, markable: true, onmark: vi.fn() });
      await expand(user);
      await waitFor(() => expect(videoEl()).not.toBeNull());
      await loaded(10);
      expect(markStart()).toBeNull();
      expect(markEnd()).toBeNull();
    });

    it('다시 열면 메타데이터 준비가 다시 필요하다', async () => {
      const { user } = await openHlsMarkable();
      await loaded(5);
      expect(markStart()).toBeEnabled();
      await user.click(toggle());
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
      expect(markStart()).toBeDisabled();
    });
  });
});

// 구간 편집 배치(preview-ux PVU-3): 막대·조작 줄·구간 보기
describe('구간 편집(PVU-3)', () => {
  const LEN = { secs: 600, source: 'meta' as const };
  const CLOSED = { open: false, start: '0:00:00', end: '0:10:00' };
  const sliders = () => screen.queryAllByRole('slider');
  const slider = (name: string) => screen.getByRole('slider', { name });
  const playBtn = () => screen.queryByRole('button', { name: t('watch.range.play.label') });
  const fromStartBtn = () => screen.queryByRole('button', { name: t('watch.range.fromStart.label') });
  const loopSwitch = () => screen.queryByRole('switch', { name: t('watch.range.loop.label') });

  /** jsdom은 배치를 하지 않으므로 막대의 좌표를 흉내 낸다(왼쪽 0, 폭 600) */
  function rectOf(el: Element) {
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 24, width: 600, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }

  /** currentTime 쓰기를 세는 video 흉내(jsdom은 재생·탐색을 하지 않는다) */
  function mockVideo(duration = 600, time = 0) {
    const v = videoEl()!;
    let ct = time;
    let dur = duration;
    let ended = false;
    const writes: number[] = [];
    Object.defineProperty(v, 'currentTime', { configurable: true, get: () => ct, set: (x: number) => { ct = x; writes.push(x); } });
    Object.defineProperty(v, 'duration', { configurable: true, get: () => dur });
    Object.defineProperty(v, 'ended', { configurable: true, get: () => ended });
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    v.play = play as never;
    v.pause = pause as never;
    return {
      v,
      writes,
      play,
      pause,
      setTime: (x: number) => (ct = x),
      setDuration: (x: number) => (dur = x),
      setEnded: (x: boolean) => (ended = x),
    };
  }

  async function openEditor(over: Record<string, unknown> = {}) {
    vi.mocked(api.watchOpen).mockResolvedValue(hlsOpened());
    const user = userEvent.setup();
    const onfields = vi.fn();
    const onduration = vi.fn();
    const props = { view, markable: true, fields: CLOSED, len: LEN, initialEnd: '0:10:00', onfields, onduration, ...over };
    const utils = render(WatchPanel, props as never);
    await expand(user);
    await waitFor(() => expect(hlsMock.instances).toHaveLength(1));
    return { user, onfields, onduration, ...utils };
  }
  /** 메타데이터를 읽은 것처럼 만든다 */
  async function ready(duration = 600, time = 0) {
    const m = mockVideo(duration, time);
    await fireEvent(m.v, new Event('loadedmetadata'));
    return m;
  }

  it('hls.js 경로에서 메타데이터를 읽은 뒤에만 막대가 있다(조작 줄 찍기는 그 전에도 비활성으로 있다)', async () => {
    await openEditor();
    expect(sliders()).toHaveLength(0);
    expect(screen.getByRole('button', { name: t('watch.mark.start') })).toBeDisabled();
    await ready();
    expect(sliders()).toHaveLength(2);
    expect(screen.getByRole('group', { name: t('watch.editor.a11y', { title: view.meta.title }) })).toHaveAttribute('data-local-keys');
  });

  it('길이(len)를 모르면 막대는 없고 찍기·조작 줄은 있다', async () => {
    await openEditor({ len: null });
    await ready();
    expect(sliders()).toHaveLength(0);
    expect(screen.getByRole('button', { name: t('watch.mark.start') })).toBeEnabled();
    expect(playBtn()).toBeDisabled();
  });

  it('mp4 경로·네이티브 m3u8·markable 아님에는 편집 영역이 없다', async () => {
    const user = userEvent.setup();
    render(WatchPanel, { view, markable: true, fields: CLOSED, len: LEN, initialEnd: '0:10:00' } as never);
    await expand(user);
    await waitFor(() => expect(videoEl()).not.toBeNull());
    await fireEvent(videoEl()!, new Event('loadedmetadata'));
    expect(sliders()).toHaveLength(0);
    expect(screen.queryByRole('group', { name: /구간 고르기/ })).toBeNull();
    expect(playBtn()).toBeNull();
  });

  it('손잡이를 끌면 칸 값만 바꾸고(영상은 그대로), 놓으면 한 번 탐색한다', async () => {
    const { onfields } = await openEditor();
    const m = await ready();
    const track = document.querySelector('.track') as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 24, width: 600, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const thumb = slider(t('range.start'));
    await fireEvent.pointerDown(thumb, { button: 0, clientX: 0, pointerId: 1 });
    await fireEvent.pointerMove(thumb, { clientX: 120, pointerId: 1 });
    expect(onfields).toHaveBeenLastCalledWith({ open: true, start: '0:02:00', end: '0:10:00' }, 'handle');
    expect(m.writes).toEqual([]);
    await fireEvent.pointerUp(thumb, { clientX: 120, pointerId: 1 });
    expect(onfields).toHaveBeenLastCalledWith({ open: true, start: '0:02:00', end: '0:10:00' }, 'handle');
    expect(m.writes).toEqual([120]);
  });

  it('키로 손잡이를 옮기면 누를 때마다 탐색한다', async () => {
    const { onfields } = await openEditor({ fields: { open: true, start: '0:01:00', end: '0:05:00' } });
    const m = await ready();
    await fireEvent.keyDown(slider(t('range.start')), { key: 'ArrowRight' });
    expect(onfields).toHaveBeenLastCalledWith({ open: true, start: '0:01:01', end: '0:05:00' }, 'handle');
    expect(m.writes).toEqual([61]);
  });

  it('막대(손잡이 밖)를 누르면 그 시각으로 탐색하고 칸은 바꾸지 않는다', async () => {
    const { onfields } = await openEditor();
    const m = await ready();
    const track = document.querySelector('.track') as HTMLElement;
    track.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 24, width: 600, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await fireEvent.pointerDown(track, { button: 0, clientX: 300, pointerId: 1 });
    expect(m.writes).toEqual([300]);
    expect(onfields).not.toHaveBeenCalled();
  });

  it('seek는 [0, video.duration]으로 자른다(meta가 실제 영상보다 길 때)', async () => {
    const { component } = await openEditor();
    const m = await ready(590);
    (component as unknown as { seek(s: number): void }).seek(600);
    (component as unknown as { seek(s: number): void }).seek(-4);
    expect(m.writes).toEqual([590, 0]);
  });

  it('길이를 알리는 onduration: 메타데이터에서 유한한 길이, 접으면 null', async () => {
    const { user, onduration } = await openEditor();
    await ready(599.6);
    expect(onduration).toHaveBeenLastCalledWith(599.6);
    await user.click(toggle());
    expect(onduration).toHaveBeenLastCalledWith(null);
  });

  it('유한하지 않은 길이는 null로 알린다', async () => {
    const { onduration } = await openEditor();
    await ready(Number.POSITIVE_INFINITY);
    expect(onduration).toHaveBeenLastCalledWith(null);
  });

  describe('구간 보기', () => {
    const RANGE = { open: true, start: '0:01:00', end: '0:01:30' };

    it('[구간 보기]는 시작으로 가서 재생하고 끝에서 일시정지한다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(playBtn()!);
      expect(m.writes).toEqual([60]);
      expect(m.play).toHaveBeenCalledTimes(1);
      m.setTime(89.8);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).not.toHaveBeenCalled();
      m.setTime(90);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).toHaveBeenCalledTimes(1);
      // 우리가 건 일시정지가 구간 보기를 다시 끄는 일은 없다(이미 꺼졌다). 더는 아무 일도 없다
      await fireEvent(m.v, new Event('pause'));
      m.setTime(95);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).toHaveBeenCalledTimes(1);
    });

    it('구간 반복하기가 켜져 있으면 끝에서 시작으로 돌아가고 일시정지하지 않는다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(loopSwitch()!);
      await user.click(playBtn()!);
      m.setTime(90.1);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.writes).toEqual([60, 60]);
      expect(m.pause).not.toHaveBeenCalled();
    });

    it('우리 탐색(시작·restart)이 만든 seeked는 구간 보기를 끄지 않는다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(playBtn()!);
      m.setTime(60);
      await fireEvent(m.v, new Event('seeked'));
      m.setTime(100);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).toHaveBeenCalledTimes(1);
    });

    it('우리 탐색이 키프레임 때문에 시작 조금 앞에 닿아도(0.5초 안) 구간 보기를 끄지 않는다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(playBtn()!);
      m.setTime(59.8);
      await fireEvent(m.v, new Event('seeked'));
      m.setTime(100);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).toHaveBeenCalledTimes(1);
    });

    it('우리 것이 아닌 탐색은 시작 조금 앞이어도 구간 보기를 끈다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(playBtn()!);
      m.setTime(60);
      await fireEvent(m.v, new Event('seeked')); // 시작 탐색 표시를 먼저 쓴다
      m.setTime(59.8);
      await fireEvent(m.v, new Event('seeked'));
      m.setTime(100);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).not.toHaveBeenCalled();
    });

    it('사용자가 일시정지하면 구간 보기에서 빠진다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(playBtn()!);
      await fireEvent(m.v, new Event('pause'));
      m.setTime(100);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).not.toHaveBeenCalled();
    });

    it('구간 밖으로 사용자가 탐색하면 빠진다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(playBtn()!);
      m.setTime(300);
      await fireEvent(m.v, new Event('seeked'));
      m.setTime(301);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).not.toHaveBeenCalled();
    });

    it('끝이 영상 끝이면 ended에서 반복은 처음으로 돌아가고 한 번뿐이면 끝낸다', async () => {
      const { user } = await openEditor({ fields: { open: true, start: '0:01:00', end: '' } });
      const m = await ready();
      await user.click(loopSwitch()!);
      await user.click(playBtn()!);
      await fireEvent(m.v, new Event('ended'));
      expect(m.writes).toEqual([60, 60]);
      expect(m.play).toHaveBeenCalledTimes(2);
    });

    it('실제 브라우저 순서(timeupdate → pause → ended)에서도 끝(toEnd) 반복은 이어진다', async () => {
      // 끝 칸이 빈칸이고 영상이 meta보다 짧다: 브라우저는 끝에서 pause를 건 뒤 ended를 보낸다
      const { user } = await openEditor({ fields: { open: true, start: '0:01:00', end: '' } });
      const m = await ready(599.6);
      await user.click(loopSwitch()!);
      await user.click(playBtn()!);
      m.setTime(599.6);
      m.setEnded(true);
      await fireEvent(m.v, new Event('timeupdate'));
      await fireEvent(m.v, new Event('pause'));
      await fireEvent(m.v, new Event('ended'));
      expect(m.writes).toEqual([60, 60]);
      expect(m.play).toHaveBeenCalledTimes(2);
    });

    it('반복을 끈 채 ended가 오면 처음으로 돌아가지도 다시 재생하지도 않는다', async () => {
      const { user } = await openEditor({ fields: { open: true, start: '0:01:00', end: '' } });
      const m = await ready();
      await user.click(playBtn()!);
      m.setEnded(true);
      await fireEvent(m.v, new Event('pause'));
      await fireEvent(m.v, new Event('ended'));
      expect(m.writes).toEqual([60]);
      expect(m.play).toHaveBeenCalledTimes(1);
    });

    it('끝 손잡이를 끄는 동안(drag)에도 구간 보기가 꺼진다: pause·restart가 끼어들지 않는다', async () => {
      const { user, container } = await openEditor({ fields: RANGE });
      const m = await ready();
      rectOf(container.querySelector('.track')!);
      await user.click(loopSwitch()!);
      await user.click(playBtn()!);
      const thumb = slider(t('range.end'));
      await fireEvent.pointerDown(thumb, { clientX: 90, pointerId: 1 });
      await fireEvent.pointerMove(thumb, { clientX: 70, pointerId: 1 });
      m.setTime(100);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).not.toHaveBeenCalled();
      expect(m.writes).toEqual([60]);
    });

    it('메타데이터 전에 durationchange만 와도 막대·찍기는 켜지지 않는다', async () => {
      await openEditor();
      const m = mockVideo();
      await fireEvent(m.v, new Event('durationchange'));
      expect(sliders()).toHaveLength(0);
      expect(screen.getByRole('button', { name: t('watch.mark.start') })).toBeDisabled();
      await fireEvent(m.v, new Event('loadedmetadata'));
      expect(sliders()).toHaveLength(2);
    });

    it('끝이 영상 끝이 아닌데 ended가 오면(meta가 더 길다) 반복도 끝낸다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(loopSwitch()!);
      await user.click(playBtn()!);
      await fireEvent(m.v, new Event('ended'));
      expect(m.writes).toEqual([60]);
    });

    it('손잡이를 고치면(keydown commit) 구간 보기를 끈다: restart·pause가 끼어들지 않는다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(loopSwitch()!);
      await user.click(playBtn()!);
      await fireEvent.keyDown(slider(t('range.end')), { key: 'ArrowLeft' });
      m.setTime(100);
      await fireEvent(m.v, new Event('timeupdate'));
      await fireEvent(m.v, new Event('seeked'));
      await fireEvent(m.v, new Event('pause'));
      expect(m.pause).not.toHaveBeenCalled();
      expect(m.writes).toEqual([60, 89]);
    });

    it('순서가 뒤집혔으면 [구간 보기]는 비활성이다', async () => {
      await openEditor({ fields: { open: true, start: '0:05:00', end: '0:01:00' } });
      await ready();
      expect(playBtn()).toBeDisabled();
      expect(fromStartBtn()).toBeEnabled();
    });

    it('카드가 busy면 보기 단추도 비활성이다', async () => {
      await openEditor({ fields: RANGE, disabled: true });
      await ready();
      expect(playBtn()).toBeDisabled();
    });

    it('play()가 거부되면 구간 보기를 끈다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      m.play.mockRejectedValueOnce(new Error('NotAllowed'));
      await user.click(playBtn()!);
      await Promise.resolve();
      await Promise.resolve();
      m.setTime(100);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).not.toHaveBeenCalled();
    });

    it('[시작부터 보기]는 시작으로 가서 재생만 하고 끝에서 멈추지 않는다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(fromStartBtn()!);
      expect(m.writes).toEqual([60]);
      expect(m.play).toHaveBeenCalledTimes(1);
      m.setTime(120);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).not.toHaveBeenCalled();
    });

    it('접으면 구간 보기가 꺼지고 다시 열어도 이어지지 않는다', async () => {
      const { user } = await openEditor({ fields: RANGE });
      const m = await ready();
      await user.click(playBtn()!);
      await user.click(toggle());
      await expand(user);
      await waitFor(() => expect(hlsMock.instances).toHaveLength(2));
      const m2 = await ready();
      m2.setTime(100);
      await fireEvent(m2.v, new Event('timeupdate'));
      expect(m2.pause).not.toHaveBeenCalled();
      expect(m.pause).not.toHaveBeenCalled();
    });
  });

  it('재생 위치를 막대에 알린다(timeupdate)', async () => {
    await openEditor();
    const m = await ready();
    m.setTime(150);
    await fireEvent(m.v, new Event('timeupdate'));
    const pos = document.querySelector('.position') as HTMLElement;
    expect(pos.style.getPropertyValue('--p')).toBe('0.25');
  });

  describe('키보드(PVU-4)', () => {
    const group = () => screen.getByRole('group', { name: t('watch.editor.a11y', { title: view.meta.title }) });
    const markS = () => screen.getByRole('button', { name: t('watch.mark.start') });
    const markE = () => screen.getByRole('button', { name: t('watch.mark.end') });
    const keyI = { key: 'i', code: 'KeyI' };
    const keyO = { key: 'o', code: 'KeyO' };
    const space = { key: ' ', code: 'Space' };

    /** paused를 바꿀 수 있게 한다(jsdom의 paused는 늘 true) */
    function pausedState(v: HTMLVideoElement, initial = true) {
      let paused = initial;
      Object.defineProperty(v, 'paused', { configurable: true, get: () => paused });
      return (x: boolean) => (paused = x);
    }
    async function setup(over: Record<string, unknown> = {}, time = 100) {
      const onmark = vi.fn();
      const utils = await openEditor({ onmark, ...over });
      const m = await ready(600, time);
      return { onmark, m, ...utils };
    }

    it('I는 시작, O는 끝을 찍는다(컨테이너·찍기 단추·손잡이·영상)', async () => {
      const { onmark } = await setup();
      const targets = [group(), markS(), markE(), slider(t('range.start')), slider(t('range.end')), videoEl()!];
      for (const el of targets) {
        onmark.mockClear();
        const noDefault = await fireEvent.keyDown(el, keyI);
        expect(onmark).toHaveBeenLastCalledWith('start', 100);
        expect(noDefault).toBe(false);
        await fireEvent.keyDown(el, keyO);
        expect(onmark).toHaveBeenLastCalledWith('end', 100);
        expect(onmark).toHaveBeenCalledTimes(2);
      }
    });

    it('한글 자판(key가 ㅑ)에서도 물리 키(KeyI)로 동작한다', async () => {
      const { onmark } = await setup();
      await fireEvent.keyDown(group(), { key: 'ㅑ', code: 'KeyI' });
      await fireEvent.keyDown(group(), { key: 'ㅐ', code: 'KeyO' });
      expect(onmark.mock.calls).toEqual([['start', 100], ['end', 100]]);
    });

    it('구간 보기·시작부터 보기 단추와 스위치 위의 I/O는 처리하지 않는다', async () => {
      const { onmark } = await setup({ fields: { open: true, start: '0:01:00', end: '0:01:30' } });
      for (const el of [playBtn()!, fromStartBtn()!, loopSwitch()!]) {
        expect(await fireEvent.keyDown(el, keyI)).toBe(true);
        expect(await fireEvent.keyDown(el, keyO)).toBe(true);
      }
      expect(onmark).not.toHaveBeenCalled();
    });

    it('수식 키가 있는 I는 무시하고, 영역 안 입력칸에서는 글자가 입력된다', async () => {
      const { onmark } = await setup();
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
        expect(await fireEvent.keyDown(group(), { ...keyI, ...mod })).toBe(true);
      }
      const input = document.createElement('input');
      group().appendChild(input);
      expect(await fireEvent.keyDown(input, keyI)).toBe(true);
      expect(onmark).not.toHaveBeenCalled();
    });

    it('이미 처리된 키(defaultPrevented)는 무시한다', async () => {
      const { onmark } = await setup();
      const el = group();
      el.addEventListener('keydown', (e) => e.preventDefault(), { capture: true });
      await fireEvent.keyDown(el, keyI);
      expect(onmark).not.toHaveBeenCalled();
    });

    it('IME 조합 중의 키는 무시한다', async () => {
      const { onmark } = await setup();
      await fireEvent.keyDown(group(), { ...keyI, isComposing: true });
      await fireEvent.keyDown(group(), { ...keyI, keyCode: 229 });
      await fireEvent.keyDown(group(), { ...space, isComposing: true });
      expect(onmark).not.toHaveBeenCalled();
    });

    it('Space는 손잡이·컨테이너에서 재생 ↔ 일시정지를 바꾸고 스크롤을 막는다', async () => {
      await setup();
      const m = mockVideo(600, 100);
      const setPaused = pausedState(m.v, true);
      for (const el of [group(), slider(t('range.start'))]) {
        setPaused(true);
        expect(await fireEvent.keyDown(el, space)).toBe(false);
        expect(m.play).toHaveBeenCalledTimes(1);
        m.play.mockClear();
        setPaused(false);
        await fireEvent.keyDown(el, space);
        expect(m.pause).toHaveBeenCalledTimes(1);
        expect(m.play).not.toHaveBeenCalled();
        m.pause.mockClear();
      }
    });

    it('Space·Enter는 단추·스위치에서 재생을 바꾸지 않는다', async () => {
      await setup();
      const m = mockVideo(600, 100);
      pausedState(m.v, true);
      for (const el of [markS(), markE(), playBtn()!, loopSwitch()!]) {
        expect(await fireEvent.keyDown(el, space)).toBe(true);
        expect(await fireEvent.keyDown(el, { key: 'Enter', code: 'Enter' })).toBe(true);
      }
      expect(m.play).not.toHaveBeenCalled();
      expect(m.pause).not.toHaveBeenCalled();
    });

    it('영상 위의 Space·화살표는 우리가 처리하지 않는다(네이티브 몫)', async () => {
      await setup();
      const m = mockVideo(600, 100);
      pausedState(m.v, true);
      expect(await fireEvent.keyDown(m.v, space)).toBe(true);
      expect(await fireEvent.keyDown(m.v, { key: 'ArrowRight' })).toBe(true);
      expect(await fireEvent.keyDown(m.v, { key: 'ArrowLeft' })).toBe(true);
      expect(m.play).not.toHaveBeenCalled();
      expect(m.writes).toEqual([]);
    });

    it('컨테이너·단추·스위치의 ←/→는 재생 위치를 5초씩 옮긴다(0과 길이로 자름)', async () => {
      await setup({ fields: { open: true, start: '0:01:00', end: '0:01:30' } });
      const m = mockVideo(600, 100);
      for (const el of [group(), markS(), loopSwitch()!]) {
        m.writes.length = 0;
        m.setTime(100);
        expect(await fireEvent.keyDown(el, { key: 'ArrowRight' })).toBe(false);
        await fireEvent.keyDown(el, { key: 'ArrowLeft' });
        expect(m.writes).toEqual([105, 100]);
      }
      m.writes.length = 0;
      m.setTime(2);
      await fireEvent.keyDown(group(), { key: 'ArrowLeft' });
      m.setTime(598);
      await fireEvent.keyDown(group(), { key: 'ArrowRight' });
      expect(m.writes).toEqual([0, 600]);
    });

    it('손잡이 위의 화살표는 손잡이를 옮기고 재생 위치는 5초 이동하지 않는다', async () => {
      const { onfields } = await setup({ fields: { open: true, start: '0:01:00', end: '0:05:00' } });
      const m = mockVideo(600, 100);
      await fireEvent.keyDown(slider(t('range.start')), { key: 'ArrowRight' });
      expect(onfields).toHaveBeenLastCalledWith({ open: true, start: '0:01:01', end: '0:05:00' }, 'handle');
      expect(m.writes).toEqual([61]);
    });

    it('구간 보기 중 화살표로 옮기면 구간 보기가 꺼진다', async () => {
      const { user } = await setup({ fields: { open: true, start: '0:01:00', end: '0:01:30' } });
      const m = mockVideo(600, 100);
      await user.click(playBtn()!);
      await fireEvent.keyDown(group(), { key: 'ArrowRight' });
      m.setTime(95);
      await fireEvent(m.v, new Event('timeupdate'));
      expect(m.pause).not.toHaveBeenCalled();
    });

    it('Ctrl/Meta/Alt + 화살표·Space는 처리하지 않는다', async () => {
      await setup();
      const m = mockVideo(600, 100);
      pausedState(m.v, true);
      for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        for (const el of [group(), slider(t('range.start')), markS()]) {
          expect(await fireEvent.keyDown(el, { key: 'ArrowRight', ...mod })).toBe(true);
          expect(await fireEvent.keyDown(el, { ...space, ...mod })).toBe(true);
        }
      }
      expect(m.writes).toEqual([]);
      expect(m.play).not.toHaveBeenCalled();
    });

    it('Shift+화살표는 컨테이너에서 처리하지 않는다', async () => {
      const { m } = await setup();
      expect(await fireEvent.keyDown(group(), { key: 'ArrowRight', shiftKey: true })).toBe(true);
      expect(m.writes).toEqual([]);
    });

    it('Esc는 편집 영역이 처리하지 않는다(창으로 그대로 올라간다)', async () => {
      await setup();
      for (const el of [group(), markS(), slider(t('range.end'))]) {
        expect(await fireEvent.keyDown(el, { key: 'Escape' })).toBe(true);
      }
    });

    it('받는 중(disabled)에는 I/O를 무시하고 손잡이 키는 값을 바꾸지 않으며, Space와 재생 위치 이동은 된다', async () => {
      const { onmark, onfields } = await setup({ disabled: true, fields: { open: true, start: '0:01:00', end: '0:05:00' } });
      const m = mockVideo(600, 100);
      const setPaused = pausedState(m.v, true);
      await fireEvent.keyDown(group(), keyI);
      await fireEvent.keyDown(markS(), keyO);
      await fireEvent.keyDown(slider(t('range.start')), { key: 'ArrowRight' });
      expect(onmark).not.toHaveBeenCalled();
      expect(onfields).not.toHaveBeenCalled();
      await fireEvent.keyDown(group(), space);
      expect(m.play).toHaveBeenCalledTimes(1);
      setPaused(true);
      await fireEvent.keyDown(group(), { key: 'ArrowRight' });
      expect(m.writes).toEqual([105]);
    });

    it('메타데이터 전에는 찍기를 하지 않는다', async () => {
      const onmark = vi.fn();
      await openEditor({ onmark });
      await fireEvent.keyDown(group(), keyI);
      expect(onmark).not.toHaveBeenCalled();
    });

    it('키를 누르고 있으면(자동 반복) 마지막 값이 남는다', async () => {
      const { onmark, m } = await setup();
      for (const t0 of [100, 101, 102]) {
        m.setTime(t0);
        await fireEvent.keyDown(group(), { ...keyI, repeat: true });
      }
      expect(onmark.mock.calls.at(-1)).toEqual(['start', 102]);
    });

    it('찍기 단추에 aria-keyshortcuts가 있다', async () => {
      await setup();
      expect(markS()).toHaveAttribute('aria-keyshortcuts', 'I');
      expect(markE()).toHaveAttribute('aria-keyshortcuts', 'O');
    });
  });
});
