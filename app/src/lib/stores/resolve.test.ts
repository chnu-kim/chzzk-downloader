import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedDto } from '../bindings';
import { resolved } from '../../test/fixtures';

vi.mock('../api', () => ({ resolve: vi.fn(), ownershipRecheck: vi.fn() }));
const api = await import('../api');
const { ResolveStore } = await import('./resolve.svelte');

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ResolveStore 세대 번호', () => {
  beforeEach(() => vi.mocked(api.resolve).mockReset());

  it('늦게 온 앞 요청의 결과는 버린다', async () => {
    const a = deferred<ResolvedDto>();
    const b = deferred<ResolvedDto>();
    vi.mocked(api.resolve).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const s = new ResolveStore();
    const pa = s.load('https://chzzk.naver.com/video/1');
    const pb = s.load(' https://chzzk.naver.com/video/2 ');
    expect(s.input).toBe('https://chzzk.naver.com/video/2');
    b.resolve(resolved({ url: 'B' }));
    await pb;
    a.resolve(resolved({ url: 'A' }));
    await pa;
    expect(s.state.kind === 'ready' && s.state.view.url).toBe('B');
  });

  it('취소 뒤에 온 결과·오류도 버리고 입력은 남긴다', async () => {
    const a = deferred<ResolvedDto>();
    vi.mocked(api.resolve).mockReturnValueOnce(a.promise);
    const s = new ResolveStore();
    const p = s.load('https://chzzk.naver.com/video/1');
    expect(s.state.kind).toBe('loading');
    s.cancel();
    a.reject({ code: 'network', message: '', stage: null, resumable: true, payload: null });
    await p;
    expect(s.state.kind).toBe('idle');
    expect(s.input).toBe('https://chzzk.naver.com/video/1');
  });

  it('오류는 주소와 함께 남고, finish는 입력을 비운다', async () => {
    vi.mocked(api.resolve).mockRejectedValueOnce({
      code: 'invalidUrl',
      message: '',
      stage: null,
      resumable: false,
      payload: null,
    });
    const s = new ResolveStore();
    await s.load('https://chzzk.naver.com/live/x');
    expect(s.state).toMatchObject({ kind: 'error', url: 'https://chzzk.naver.com/live/x' });
    s.finish();
    expect(s.state.kind).toBe('idle');
    expect(s.input).toBe('');
  });

  it('빈 글은 부르지 않는다', async () => {
    const s = new ResolveStore();
    await s.load('   ');
    expect(api.resolve).not.toHaveBeenCalled();
    expect(s.state.kind).toBe('idle');
  });
});

describe('ResolveStore.recheck single-flight는 카드마다', () => {
  beforeEach(() => {
    vi.mocked(api.resolve).mockReset();
    vi.mocked(api.ownershipRecheck).mockReset();
  });

  it('앞 카드의 다시 불러오기가 끝나지 않았어도 새 카드의 다시 불러오기는 나간다', async () => {
    const first = deferred<ResolvedDto>();
    const second = deferred<ResolvedDto>();
    vi.mocked(api.ownershipRecheck).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    vi.mocked(api.resolve)
      .mockResolvedValueOnce(resolved({ url: 'X', ownership: 'notOwn' }))
      .mockResolvedValueOnce(resolved({ url: 'Y', ownership: 'notOwn' }));
    const s = new ResolveStore();
    await s.load('https://chzzk.naver.com/video/1');
    const px = s.recheck();
    expect(s.rechecking).toBe(true);
    await s.load('https://chzzk.naver.com/video/2');
    expect(s.rechecking).toBe(false);
    const py = s.recheck();
    expect(api.ownershipRecheck).toHaveBeenCalledTimes(2);
    expect(api.ownershipRecheck).toHaveBeenLastCalledWith('Y');
    expect(s.rechecking).toBe(true);
    // 같은 카드에서 두 번째 누름은 여전히 막는다
    void s.recheck();
    expect(api.ownershipRecheck).toHaveBeenCalledTimes(2);
    // 늦게 온 앞 카드의 응답은 새 카드의 loading을 끄지 않는다
    first.resolve(resolved({ url: 'X', ownership: 'delegated' }));
    await px;
    expect(s.rechecking).toBe(true);
    expect(s.state.kind === 'ready' && s.state.view.url).toBe('Y');
    second.resolve(resolved({ url: 'Y', ownership: 'notOwn' }));
    await py;
    expect(s.rechecking).toBe(false);
  });
});
