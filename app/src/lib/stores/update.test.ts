import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateCheckDto, UpdateInfoDto, UpdateInstallDto, UpdateProgressEvent } from '../bindings';

vi.mock('../api', () => ({
  updateCheck: vi.fn(),
  updateAvailable: vi.fn(),
  updateInstall: vi.fn(),
  onUpdateAvailable: vi.fn(),
  onUpdateProgress: vi.fn(),
}));

const api = await import('../api');
const { UpdateStore } = await import('./update.svelte');
const { toasts } = await import('./toast.svelte');

const info = (version: string): UpdateInfoDto => ({ version, current: '0.1.0', notes: null, pubDate: null });

let update: InstanceType<typeof UpdateStore>;
let emitAvailable: (i: UpdateInfoDto) => void = () => {};
let emitProgress: (e: UpdateProgressEvent) => void = () => {};
const unlisten = vi.fn();

beforeEach(() => {
  update = new UpdateStore();
  toasts.clear();
  unlisten.mockReset();
  for (const f of [api.updateCheck, api.updateAvailable, api.updateInstall, api.onUpdateAvailable, api.onUpdateProgress]) {
    vi.mocked(f).mockReset();
  }
  vi.mocked(api.onUpdateAvailable).mockImplementation(async (cb) => {
    emitAvailable = cb;
    return unlisten;
  });
  vi.mocked(api.onUpdateProgress).mockImplementation(async (cb) => {
    emitProgress = cb;
    return unlisten;
  });
  vi.mocked(api.updateAvailable).mockResolvedValue(null);
});

describe('start·sync', () => {
  it('start가 두 이벤트를 듣고 update-available를 반영하며, 돌려준 함수로 그만 듣는다', async () => {
    const off = await update.start();
    expect(api.onUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(api.onUpdateProgress).toHaveBeenCalledTimes(1);
    emitAvailable(info('0.2.0'));
    expect(update.available).toEqual(info('0.2.0'));
    expect(update.showBanner).toBe(true);
    off();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it('듣기에 실패해도 start는 끝나고 sync는 캐시를 읽는다', async () => {
    vi.mocked(api.onUpdateAvailable).mockRejectedValue(new Error('x'));
    vi.mocked(api.onUpdateProgress).mockRejectedValue(new Error('x'));
    vi.mocked(api.updateAvailable).mockResolvedValue(info('0.3.0'));
    await update.start();
    await update.sync();
    expect(update.available).toEqual(info('0.3.0'));
  });

  it('sync가 캐시를 반영하고, 던져도 상태를 유지한다', async () => {
    await update.start();
    vi.mocked(api.updateAvailable).mockResolvedValue(info('0.2.0'));
    await update.sync();
    expect(update.available).toEqual(info('0.2.0'));
    vi.mocked(api.updateAvailable).mockRejectedValue(new Error('x'));
    await update.sync();
    expect(update.available).toEqual(info('0.2.0'));
  });

  it('listen 등록이 늦게 끝나도 sync는 그 뒤에 updateAvailable을 부른다', async () => {
    const order: string[] = [];
    let finish: (f: () => void) => void = () => {};
    vi.mocked(api.onUpdateAvailable).mockImplementation(
      () =>
        new Promise((r) => {
          finish = (f) => {
            order.push('listened');
            r(f);
          };
        }),
    );
    vi.mocked(api.updateAvailable).mockImplementation(async () => {
      order.push('asked');
      return null;
    });
    const sync = update.sync(); // start보다 먼저 불러도
    const started = update.start();
    await Promise.resolve();
    expect(api.updateAvailable).not.toHaveBeenCalled();
    finish(() => {});
    await started;
    await sync;
    expect(order).toEqual(['listened', 'asked']);
  });

  it('sync 응답 전에 이벤트가 오면 응답(null)이 이벤트 값을 덮지 않는다', async () => {
    await update.start();
    let resolve: (v: UpdateInfoDto | null) => void = () => {};
    vi.mocked(api.updateAvailable).mockImplementation(() => new Promise((r) => (resolve = r)));
    const p = update.sync();
    await Promise.resolve();
    await Promise.resolve();
    emitAvailable(info('0.2.0'));
    resolve(null);
    await p;
    expect(update.available).toEqual(info('0.2.0'));
  });
});

describe('later·checkNow', () => {
  it('later는 같은 버전을 숨기고 다른 버전 이벤트는 다시 보인다', async () => {
    await update.start();
    emitAvailable(info('0.2.0'));
    update.later();
    expect(update.showBanner).toBe(false);
    emitAvailable(info('0.2.0'));
    expect(update.showBanner).toBe(false);
    emitAvailable(info('0.3.0'));
    expect(update.showBanner).toBe(true);
    // 받은 것이 없을 때 later는 아무것도 숨기지 않는다
    const fresh = new UpdateStore();
    fresh.later();
    expect(fresh.showBanner).toBe(false);
  });

  const rows: [UpdateCheckDto, string][] = [
    [{ result: 'upToDate' }, 'upToDate'],
    [{ result: 'offline' }, 'offline'],
    [{ result: 'failed' }, 'failed'],
    [{ result: 'untrusted' }, 'untrusted'],
    [{ result: 'available', info: info('0.2.0') }, 'available'],
  ];
  it.each(rows)('checkNow %j', async (r, want) => {
    vi.mocked(api.updateCheck).mockResolvedValue(r);
    await update.checkNow();
    expect(update.check).toBe(want);
    expect(update.available).toEqual(r.result === 'available' ? r.info : null);
  });

  it('checkNow가 던지면 failed', async () => {
    vi.mocked(api.updateCheck).mockRejectedValue({ code: 'notLoggedIn' });
    await update.checkNow();
    expect(update.check).toBe('failed');
  });

  it('available 결과는 [나중에]를 풀고, 최신·거부 결과는 배너를 걷고, 실패는 그대로 둔다', async () => {
    await update.start();
    emitAvailable(info('0.2.0'));
    update.later();
    vi.mocked(api.updateCheck).mockResolvedValue({ result: 'available', info: info('0.2.0') });
    await update.checkNow();
    expect(update.showBanner).toBe(true);
    vi.mocked(api.updateCheck).mockResolvedValue({ result: 'failed' });
    await update.checkNow();
    expect(update.available).toEqual(info('0.2.0'));
    vi.mocked(api.updateCheck).mockResolvedValue({ result: 'upToDate' });
    await update.checkNow();
    expect(update.available).toBeNull();
  });

  it('checking 중 두 번째 호출은 무시된다', async () => {
    let resolve: (r: UpdateCheckDto) => void = () => {};
    vi.mocked(api.updateCheck).mockImplementation(() => new Promise((r) => (resolve = r)));
    const p = update.checkNow();
    void update.checkNow();
    expect(update.check).toBe('checking');
    expect(api.updateCheck).toHaveBeenCalledTimes(1);
    resolve({ result: 'upToDate' });
    await p;
    expect(update.check).toBe('upToDate');
  });
});

describe('install', () => {
  it('needsConfirm이면 confirm 단계와 받는 중 수', async () => {
    vi.mocked(api.updateInstall).mockResolvedValue({ result: 'needsConfirm', running: 2 });
    await update.install();
    expect(api.updateInstall).toHaveBeenCalledWith(false);
    expect(update.phase).toBe('confirm');
    expect(update.confirmRunning).toBe(2);
    expect(update.busy).toBe(false);
    update.cancelConfirm();
    expect(update.phase).toBe('idle');
  });

  it('install(true)는 confirmPause를 넘기고 바로 받는 중으로 본다', async () => {
    let resolve: (r: UpdateInstallDto) => void = () => {};
    vi.mocked(api.updateInstall).mockImplementation(() => new Promise((r) => (resolve = r)));
    const p = update.install(true);
    expect(api.updateInstall).toHaveBeenCalledWith(true);
    expect(update.phase).toBe('downloading');
    expect(update.pct).toBeNull();
    resolve({ result: 'restarting' });
    await p;
    expect(update.phase).toBe('installing');
  });

  it('진행 이벤트가 phase·pct를 따라간다(크기를 모르면 pct는 null)', async () => {
    await update.start();
    emitProgress({ type: 'started', total: 200 });
    expect(update.phase).toBe('downloading');
    emitProgress({ type: 'chunk', received: 50, total: 200 });
    expect(update.pct).toBe(25);
    expect(update.received).toBe(50);
    emitProgress({ type: 'chunk', received: 999, total: 200 });
    expect(update.pct).toBe(100);
    emitProgress({ type: 'downloaded' });
    expect(update.phase).toBe('downloading');
    emitProgress({ type: 'installing' });
    expect(update.phase).toBe('installing');
    emitProgress({ type: 'started', total: null });
    emitProgress({ type: 'chunk', received: 1024, total: null });
    expect(update.pct).toBeNull();
    expect(update.received).toBe(1024);
  });

  const rows: [
    UpdateInstallDto,
    { phase: string; available: boolean; toast: string | null; kind?: string; failure: 'failed' | 'untrusted' | null },
  ][] = [
    [{ result: 'restarting' }, { phase: 'installing', available: true, toast: null, failure: null }],
    [{ result: 'upToDate' }, { phase: 'idle', available: false, toast: '최신 버전이에요', kind: 'info', failure: null }],
    // 실패는 토스트가 아니라 배너 B4 실패 자리에 남는다(한 사건 한 수단, patterns.md §12)
    [{ result: 'untrusted' }, { phase: 'idle', available: false, toast: null, failure: 'untrusted' }],
    [{ result: 'failed' }, { phase: 'idle', available: true, toast: null, failure: 'failed' }],
    [{ result: 'offline' }, { phase: 'idle', available: true, toast: null, failure: 'failed' }],
    [{ result: 'busy' }, { phase: 'idle', available: true, toast: null, failure: null }],
  ];
  it.each(rows)('install 결과 %j', async (r, want) => {
    await update.start();
    emitAvailable(info('0.2.0'));
    vi.mocked(api.updateInstall).mockResolvedValue(r);
    await update.install();
    expect(update.phase).toBe(want.phase);
    expect(update.available !== null).toBe(want.available);
    expect(update.failure).toBe(want.failure);
    const items = toasts.items;
    if (want.toast === null) expect(items).toHaveLength(0);
    else {
      expect(items).toHaveLength(1);
      expect(items[0].message).toBe(want.toast);
      expect(items[0].kind).toBe(want.kind);
    }
  });

  it('던지면 idle과 실패 배너 상태(토스트 없음)', async () => {
    vi.mocked(api.updateInstall).mockRejectedValue({ code: 'internal' });
    await update.install(true);
    expect(update.phase).toBe('idle');
    expect(update.failure).toBe('failed');
    expect(toasts.items).toHaveLength(0);
  });

  it('다시 설치를 시작하면 실패 표시가 걷히고, dismissFailure로도 닫는다', async () => {
    await update.start();
    emitAvailable(info('0.2.0'));
    vi.mocked(api.updateInstall).mockResolvedValueOnce({ result: 'failed' });
    await update.install();
    expect(update.failure).toBe('failed');
    update.dismissFailure();
    expect(update.failure).toBeNull();
    vi.mocked(api.updateInstall).mockResolvedValueOnce({ result: 'failed' });
    await update.install();
    expect(update.failure).toBe('failed');
    vi.mocked(api.updateInstall).mockResolvedValueOnce({ result: 'restarting' });
    await update.install();
    expect(update.failure).toBeNull();
  });

  it('받는 중·설치 중에는 install을 무시한다', async () => {
    await update.start();
    emitProgress({ type: 'started', total: null });
    await update.install();
    expect(api.updateInstall).not.toHaveBeenCalled();
  });

  it('호출이 진행 중이면 두 번째 호출은 무시한다', async () => {
    let resolve: (r: UpdateInstallDto) => void = () => {};
    vi.mocked(api.updateInstall).mockImplementation(() => new Promise((r) => (resolve = r)));
    const p = update.install();
    expect(update.pending).toBe(true);
    void update.install();
    expect(api.updateInstall).toHaveBeenCalledTimes(1);
    resolve({ result: 'busy' });
    await p;
    expect(update.pending).toBe(false);
  });

  it('설치를 시작할 때 본 버전을 잡아 둔다', async () => {
    await update.start();
    emitAvailable(info('0.2.0'));
    vi.mocked(api.updateInstall).mockResolvedValue({ result: 'restarting' });
    await update.install();
    expect(update.installVersion).toBe('0.2.0');
  });

  it.each(['upToDate', 'untrusted'] as const)('설치 결과 %s는 설정의 확인 결과도 맞춘다(available이 남지 않는다)', async (result) => {
    await update.start();
    vi.mocked(api.updateCheck).mockResolvedValue({ result: 'available', info: info('0.2.0') });
    await update.checkNow();
    expect(update.check).toBe('available');
    vi.mocked(api.updateInstall).mockResolvedValue({ result });
    await update.install();
    expect(update.check).toBe(result);
    expect(update.available).toBeNull();
  });

  it('최신이라고 본 뒤 자동 확인이 새 버전을 알리면 확인 결과도 available', async () => {
    await update.start();
    vi.mocked(api.updateCheck).mockResolvedValue({ result: 'upToDate' });
    await update.checkNow();
    emitAvailable(info('0.2.0'));
    expect(update.check).toBe('available');
  });

  it('확인한 적이 없으면 설치 결과가 확인 결과를 만들지 않는다', async () => {
    await update.start();
    emitAvailable(info('0.2.0'));
    vi.mocked(api.updateInstall).mockResolvedValue({ result: 'upToDate' });
    await update.install();
    expect(update.check).toBe('idle');
  });

  it('reset은 모든 상태를 처음으로 돌린다', async () => {
    await update.start();
    emitAvailable(info('0.2.0'));
    update.later();
    emitProgress({ type: 'started', total: 10 });
    update.reset();
    expect(update.available).toBeNull();
    expect(update.phase).toBe('idle');
    expect(update.check).toBe('idle');
    expect(update.total).toBeNull();
  });
});
