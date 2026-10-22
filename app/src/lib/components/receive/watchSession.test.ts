import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, WatchOpenDto } from '../../bindings';

vi.mock('../../api', () => ({
  watchOpen: vi.fn(),
  watchClose: vi.fn(),
}));

// hls.js/light 흉내: 호출 순서를 log에 남긴다
const hlsMock = vi.hoisted(() => {
  const log: string[] = [];
  const instances: FakeHls[] = [];
  class FakeHls {
    static supported = true;
    static isSupported = () => FakeHls.supported;
    static Events = { ERROR: 'hlsError' };
    handlers = new Map<string, (event: string, data: unknown) => void>();
    loadSource = vi.fn();
    attachMedia = vi.fn(() => void log.push('attach'));
    destroy = vi.fn(() => void log.push('destroy'));
    constructor() {
      instances.push(this);
    }
    on(event: string, handler: (event: string, data: unknown) => void) {
      this.handlers.set(event, handler);
    }
  }
  return { FakeHls, instances, log };
});
vi.mock('hls.js/light', () => ({ default: hlsMock.FakeHls }));

const api = await import('../../api');
const { WatchSession } = await import('./watchSession.svelte');

const SID = 'ab'.repeat(16);
const SRC = `watch://localhost/${SID}/v`;
const HLS_SRC = `watch://localhost/${SID}/pl.m3u8`;
const opened = (over: Partial<WatchOpenDto> = {}): WatchOpenDto => ({ id: SID, kind: 'mp4', src: SRC, ...over });
const appError = (code: AppError['code']): AppError => ({ code, message: code, stage: null, resumable: false, payload: null });
const content = { kind: 'video', videoNo: 1234567 } as const;

let video: HTMLVideoElement | null;
let onready: Mock<() => void>;
let onfailed: Mock<(videoFocused: boolean, cause: 'open' | 'video') => void>;
let onclosed: Mock<() => void>;

function make(initialOpen = true) {
  return new WatchSession({
    initialOpen,
    target: () => ({ url: 'https://chzzk.naver.com/video/1234567', content }),
    video: () => video,
    onready,
    onfailed,
    onclosed,
  });
}

/** 마이크로태스크를 비운다(tick·동적 import) */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  video = document.createElement('video');
  document.body.append(video);
  onready = vi.fn<() => void>();
  onfailed = vi.fn<(videoFocused: boolean, cause: 'open' | 'video') => void>();
  onclosed = vi.fn<() => void>();
  hlsMock.instances.length = 0;
  hlsMock.log.length = 0;
  hlsMock.FakeHls.supported = true;
  vi.mocked(api.watchOpen).mockReset().mockResolvedValue(opened());
  vi.mocked(api.watchClose)
    .mockReset()
    .mockImplementation(async () => void hlsMock.log.push('close') as never);
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type) => (type === 'video/mp4' ? 'maybe' : ''));
});
afterEach(() => {
  video?.remove();
  vi.restoreAllMocks();
});

describe('WatchSession', () => {
  it('처음 단계는 initialOpen이 정한다', () => {
    expect(make(true).phase).toBe('idle');
    expect(make(false).phase).toBe('closed');
  });

  it('open → ready(mp4): phase·src·watch_open 1회, onready', async () => {
    const s = make();
    await s.start();
    await settle();
    expect(s.phase).toBe('ready');
    expect(s.src).toBe(SRC);
    expect(api.watchOpen).toHaveBeenCalledTimes(1);
    expect(api.watchOpen).toHaveBeenCalledWith('https://chzzk.naver.com/video/1234567', content);
    expect(onready).toHaveBeenCalledTimes(1);
  });

  it('opening 동안 phase는 opening', async () => {
    const s = make();
    const p = s.start();
    expect(s.phase).toBe('opening');
    await p;
  });

  it('open → ready(hls.js): usingHls, attachMedia 뒤 onready', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ kind: 'hls', src: HLS_SRC }));
    onready.mockImplementation(() => hlsMock.log.push('ready'));
    const s = make();
    await s.start();
    await settle();
    expect(s.phase).toBe('ready');
    expect(s.usingHls).toBe(true);
    expect(hlsMock.instances[0].attachMedia).toHaveBeenCalledWith(video);
    expect(hlsMock.instances[0].loadSource).toHaveBeenCalledWith(HLS_SRC);
    expect(hlsMock.log).toEqual(['attach', 'ready']);
  });

  it('native m3u8 fallback: usingHls = false, src를 단다', async () => {
    hlsMock.FakeHls.supported = false;
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockImplementation((type) => (type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''));
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ kind: 'hls', src: HLS_SRC }));
    const s = make();
    await s.start();
    await settle();
    expect(s.phase).toBe('ready');
    expect(s.usingHls).toBe(false);
    expect(s.src).toBe(HLS_SRC);
    expect(hlsMock.instances).toHaveLength(0);
    expect(onready).toHaveBeenCalledTimes(1);
  });

  it('hls.js도 네이티브 m3u8도 없으면 실패하고 세션을 닫는다', async () => {
    hlsMock.FakeHls.supported = false;
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ kind: 'hls', src: HLS_SRC }));
    const s = make();
    await s.start();
    await settle();
    expect(s.phase).toBe('failed');
    expect(api.watchClose).toHaveBeenCalledTimes(1);
    expect(onfailed).toHaveBeenCalledWith(false, 'open');
  });

  it('mp4를 못 읽는 웹뷰: src 없이 실패, 세션 1회 닫기', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('');
    const s = make();
    await s.start();
    await settle();
    expect(s.phase).toBe('failed');
    expect(s.src).toBe('');
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('late result after close is closed immediately', async () => {
    let resolve!: (d: WatchOpenDto) => void;
    vi.mocked(api.watchOpen).mockReturnValue(new Promise((r) => (resolve = r)));
    const s = make();
    const p = s.start();
    s.collapse();
    resolve(opened());
    await p;
    await settle();
    expect(api.watchClose).toHaveBeenCalledTimes(1);
    expect(api.watchClose).toHaveBeenCalledWith(SID);
    expect(s.phase).toBe('idle');
    expect(s.src).toBe('');
    expect(onready).not.toHaveBeenCalled();
  });

  it('reopen during opening discards first', async () => {
    const first = opened({ id: 'aa'.repeat(16), src: 'watch://localhost/first/v' });
    const second = opened({ id: 'bb'.repeat(16), src: 'watch://localhost/second/v' });
    let resolveFirst!: (d: WatchOpenDto) => void;
    vi.mocked(api.watchOpen)
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(second);
    const s = make();
    const p1 = s.start();
    const p2 = s.start();
    await p2;
    resolveFirst(first);
    await p1;
    await settle();
    expect(s.src).toBe('watch://localhost/second/v');
    expect(api.watchClose).toHaveBeenCalledTimes(1);
    expect(api.watchClose).toHaveBeenCalledWith(first.id);
    expect(onready).toHaveBeenCalledTimes(1);
  });

  it('close order: hls.destroy before watch_close', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ kind: 'hls', src: HLS_SRC }));
    const s = make();
    await s.start();
    await settle();
    hlsMock.log.length = 0;
    s.collapse();
    expect(hlsMock.log).toEqual(['destroy', 'close']);
    expect(s.usingHls).toBe(false);
    expect(onclosed).toHaveBeenCalled();
  });

  it('collapse는 세션을 한 번만 닫고 phase를 idle로 돌린다', async () => {
    const s = make();
    await s.start();
    await settle();
    s.collapse();
    s.collapse();
    expect(api.watchClose).toHaveBeenCalledTimes(1);
    expect(s.phase).toBe('idle');
    expect(s.src).toBe('');
  });

  it('video error → failed, session closed once, onfailed(영상에 포커스)', async () => {
    const s = make();
    await s.start();
    await settle();
    video!.tabIndex = 0;
    video!.focus();
    s.videoFailed();
    s.videoFailed();
    await settle();
    expect(s.phase).toBe('failed');
    expect(s.src).toBe('');
    expect(api.watchClose).toHaveBeenCalledTimes(1);
    expect(onfailed).toHaveBeenCalledWith(true, 'video');
  });

  it('video error: 포커스가 영상 밖이면 false', async () => {
    const s = make();
    await s.start();
    await settle();
    s.videoFailed();
    await settle();
    expect(onfailed).toHaveBeenCalledWith(false, 'video');
  });

  it('hls fatal 오류도 같은 실패 경로', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ kind: 'hls', src: HLS_SRC }));
    const s = make();
    await s.start();
    await settle();
    hlsMock.instances[0].handlers.get('hlsError')?.('hlsError', { fatal: false });
    expect(s.phase).toBe('ready');
    hlsMock.instances[0].handlers.get('hlsError')?.('hlsError', { fatal: true });
    expect(s.phase).toBe('failed');
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it.each(['notLoggedIn', 'notOwnContent', 'ownershipUnknown'] as const)('gate denial keeps error for copy: %s', async (code) => {
    vi.mocked(api.watchOpen).mockRejectedValue(appError(code));
    const s = make();
    await s.start();
    await settle();
    expect(s.phase).toBe('failed');
    expect(s.gateError?.code).toBe(code);
    expect(onfailed).toHaveBeenCalledWith(false, 'open');
  });

  it('그 밖의 오류는 gateError 없이 실패, 다시 열면 비운다', async () => {
    vi.mocked(api.watchOpen).mockRejectedValueOnce(appError('network'));
    const s = make();
    await s.start();
    expect(s.phase).toBe('failed');
    expect(s.gateError).toBeNull();
    vi.mocked(api.watchOpen).mockRejectedValueOnce(appError('notLoggedIn'));
    await s.start();
    expect(s.gateError).not.toBeNull();
    vi.mocked(api.watchOpen).mockResolvedValueOnce(opened());
    await s.start();
    expect(s.gateError).toBeNull();
  });

  it('늦게 온 실패는 버린다(접은 뒤)', async () => {
    let reject!: (e: AppError) => void;
    vi.mocked(api.watchOpen).mockReturnValue(new Promise((_, r) => (reject = r)));
    const s = make();
    const p = s.start();
    s.collapse();
    reject(appError('network'));
    await p;
    await settle();
    expect(s.phase).toBe('idle');
    expect(onfailed).not.toHaveBeenCalled();
  });

  it('destroy는 세션을 닫고 늦은 결과를 막는다', async () => {
    const s = make();
    await s.start();
    await settle();
    s.destroy();
    expect(api.watchClose).toHaveBeenCalledTimes(1);
  });

  it('no signed URL leaves the controller: 노출 값은 src·phase 등 화면 상태뿐', async () => {
    vi.mocked(api.watchOpen).mockResolvedValue(opened({ kind: 'hls', src: HLS_SRC }));
    const s = make();
    await s.start();
    await settle();
    // 세션 ID는 어떤 열거 가능한 속성에도 없다(src의 watch: 주소 안에만 있다)
    const seen = JSON.stringify(Object.fromEntries(Object.keys(s).map((k) => [k, (s as unknown as Record<string, unknown>)[k]])));
    expect(seen).not.toContain(SID);
    expect(s.src).toBe('');
    // 프로토타입의 읽기 값도 마찬가지
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(s)).filter((k) => k !== 'constructor');
    expect(proto).not.toContain('sessionId');
    expect(proto).not.toContain('id');
    expect(proto).not.toContain('hls');
  });
});
