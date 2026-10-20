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

async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(toggle());
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
});
