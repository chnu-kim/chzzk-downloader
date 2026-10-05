import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobDto, JobEvent } from '../bindings';
import { err, job, prog } from '../../test/jobFixtures';

class FakeChannel {
  onmessage: (e: JobEvent) => void = () => {};
}

vi.mock('../api', () => ({
  Channel: FakeChannel,
  subscribeJobs: vi.fn(),
  resumeJob: vi.fn(),
  removeJob: vi.fn(),
  pauseJob: vi.fn(),
  openOutput: vi.fn(),
  revealOutput: vi.fn(),
  resolve: vi.fn(),
}));

const api = await import('../api');
const { JobsStore, HIGHLIGHT_MS } = await import('./jobs.svelte');
const { toasts } = await import('./toast.svelte');

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/** 구독을 시작하고, 넘겨받은 Channel과 스냅샷을 돌려줄 함수를 준다 */
function begin(store: InstanceType<typeof JobsStore>) {
  const snap = deferred<JobDto[]>();
  let channel!: FakeChannel;
  vi.mocked(api.subscribeJobs).mockImplementationOnce((c) => {
    channel = c as unknown as FakeChannel;
    return snap.promise;
  });
  const started = store.start();
  return { send: (e: JobEvent) => channel.onmessage(e), snapshot: snap.resolve, started };
}

beforeEach(() => {
  vi.mocked(api.subscribeJobs).mockReset();
  vi.mocked(api.resumeJob).mockReset().mockResolvedValue();
  vi.mocked(api.removeJob).mockReset().mockResolvedValue();
  toasts.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('JobsStore 구독', () => {
  it('스냅샷보다 먼저 온 이벤트는 모았다가 스냅샷 뒤에 순서대로 반영한다', async () => {
    const s = new JobsStore();
    const b = begin(s);
    b.send({ type: 'status', job: job(1, { status: 'running' }) });
    b.send({ type: 'progress', id: 1, progress: prog({ bytes: 7 }) });
    b.send({ type: 'added', job: job(2) });
    expect(s.ready).toBe(false);
    expect(s.state.jobs.size).toBe(0);
    b.snapshot([job(1)]);
    await b.started;
    expect(s.ready).toBe(true);
    expect(s.state.jobs.get(1)?.status).toBe('running');
    expect(s.state.progress.get(1)?.bytes).toBe(7);
    expect([...s.state.jobs.keys()]).toEqual([1, 2]);
  });

  it('다시 구독하면 앞 Channel의 늦은 메시지와 늦은 스냅샷은 버린다', async () => {
    const s = new JobsStore();
    const first = begin(s);
    const second = begin(s);
    second.snapshot([job(5, { status: 'paused' })]);
    await second.started;
    first.send({ type: 'added', job: job(9) });
    first.snapshot([job(1)]);
    await first.started;
    expect([...s.state.jobs.keys()]).toEqual([5]);
    second.send({ type: 'added', job: job(6) });
    expect([...s.state.jobs.keys()]).toEqual([5, 6]);
  });

  it('완료 토스트는 완료로 바뀌는 status 이벤트에서만(스냅샷·added의 완료 항목은 알리지 않는다)', async () => {
    const s = new JobsStore();
    const b = begin(s);
    b.snapshot([job(1, { status: 'completed' }), job(2, { status: 'running' })]);
    await b.started;
    b.send({ type: 'added', job: job(3, { status: 'completed' }) });
    expect(toasts.items).toHaveLength(0);
    b.send({ type: 'status', job: job(2, { status: 'completed', title: '금요 방송' }) });
    expect(toasts.items.map((t) => t.message)).toEqual(["'금요 방송' 다운로드를 마쳤어요"]);
    b.send({ type: 'status', job: job(2, { status: 'completed', title: '금요 방송' }) });
    expect(toasts.items).toHaveLength(1);
  });

  it('added만 1초 강조한다', async () => {
    vi.useFakeTimers();
    const s = new JobsStore();
    const b = begin(s);
    b.snapshot([job(1)]);
    await b.started;
    b.send({ type: 'added', job: job(2) });
    b.send({ type: 'status', job: job(1, { status: 'running' }) });
    expect([...s.highlight]).toEqual([2]);
    vi.advanceTimersByTime(HIGHLIGHT_MS);
    expect(s.highlight.size).toBe(0);
  });

  it('대기 순서를 따라간다', async () => {
    const s = new JobsStore();
    const b = begin(s);
    b.snapshot([job(1), job(2), job(3, { status: 'paused' })]);
    await b.started;
    expect(s.queueOrder).toEqual([1, 2]);
    b.send({ type: 'status', job: job(3) });
    b.send({ type: 'status', job: job(1, { status: 'running' }) });
    expect(s.queueOrder).toEqual([2, 3]);
  });
});

describe('JobsStore 동작', () => {
  async function loaded(list: JobDto[]) {
    const s = new JobsStore();
    const b = begin(s);
    b.snapshot(list);
    await b.started;
    return { s, send: b.send };
  }

  it('모두 이어받기: 중단된 작업을 id 순으로, 하나가 거부돼도 나머지는 계속한다', async () => {
    const { s } = await loaded([
      job(4, { status: 'interrupted' }),
      job(2, { status: 'interrupted' }),
      job(3, { status: 'paused' }),
      job(1, { status: 'interrupted' }),
    ]);
    expect(s.interruptedCount).toBe(3);
    expect(s.showInterruptedBanner).toBe(true);
    vi.mocked(api.resumeJob).mockImplementation(async (id) => {
      if (id === 2) throw err('duplicateOutput', { payload: { type: 'duplicateOutput', jobId: 9 } });
    });
    await s.resumeAllInterrupted();
    expect(vi.mocked(api.resumeJob).mock.calls).toEqual([
      [1, false],
      [2, false],
      [4, false],
    ]);
    expect(toasts.items.map((t) => t.message)).toEqual(['이 파일은 이미 다운로드 목록에 있어요.']);
  });

  it('배너는 중단된 작업이 없거나 닫으면 숨는다', async () => {
    const { s, send } = await loaded([job(1, { status: 'interrupted' })]);
    expect(s.showInterruptedBanner).toBe(true);
    send({ type: 'status', job: job(1) });
    expect(s.showInterruptedBanner).toBe(false);
    send({ type: 'status', job: job(1, { status: 'interrupted' }) });
    s.dismissBanner();
    expect(s.showInterruptedBanner).toBe(false);
  });

  it('취소: 512 MiB 이하는 바로 지우고, 넘으면 D2를 거친다', async () => {
    const big = 512 * 1024 * 1024 + 1;
    const { s } = await loaded([job(1, { status: 'paused', partialBytes: 10 }), job(2, { status: 'paused', partialBytes: big })]);
    await s.act(1, 'cancel');
    expect(api.removeJob).toHaveBeenCalledWith(1);
    await s.act(2, 'cancel');
    expect(api.removeJob).toHaveBeenCalledTimes(1);
    expect(s.confirm).toMatchObject({ id: 2, bytes: big });
    expect(s.confirmSize).toBe('512.0 MB');
    s.cancelConfirm();
    expect(s.confirm).toBeNull();
    expect(api.removeJob).toHaveBeenCalledTimes(1);
    await s.act(2, 'remove');
    await s.confirmRemove();
    expect(api.removeJob).toHaveBeenLastCalledWith(2);
  });

  it('완료 지우기 대상: 받은 .part가 남은 건너뜀은 셸이 남기므로 세지 않는다', async () => {
    const { s } = await loaded([job(1, { status: 'skipped', partialBytes: 7 })]);
    expect(s.hasFinished).toBe(false);
    const { s: s2 } = await loaded([job(1, { status: 'skipped' })]);
    expect(s2.hasFinished).toBe(true);
  });

  it('처음부터 다시 받기는 restart, 덮어쓰고 받기는 resume', async () => {
    const { s } = await loaded([job(1, { status: 'failed', partialBytes: 5, error: err('network') }), job(2, { status: 'skipped' })]);
    await s.act(1, 'restartFresh');
    await s.act(2, 'overwrite');
    expect(vi.mocked(api.resumeJob).mock.calls).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('동작이 실패하면 오류 문구를 토스트로', async () => {
    const { s } = await loaded([job(1, { status: 'paused' })]);
    vi.mocked(api.resumeJob).mockRejectedValueOnce(err('jobNotFound', { message: 'job 1' }));
    await s.act(1, 'resume');
    expect(toasts.items.map((t) => [t.message, t.kind])).toEqual([
      ['문제가 생겼어요. 앱을 다시 시작해 주세요. (job 1)', 'danger'],
    ]);
  });

  it('[파일 열기]에서 파일이 없으면 §9 문구 그대로, [폴더 열기]는 그 작업의 폴더를 연다', async () => {
    const { s } = await loaded([job(4, { status: 'completed' })]);
    vi.mocked(api.openOutput).mockRejectedValueOnce(err('fileMissing', { payload: { type: 'path', path: '/v/4.mp4' } }));
    vi.mocked(api.revealOutput).mockResolvedValueOnce();
    await s.act(4, 'openFile');
    expect(toasts.items).toHaveLength(1);
    const [toast] = toasts.items;
    expect(toast.message).toBe('파일을 찾을 수 없어요. 옮기거나 지웠을 수 있어요');
    expect(toast.kind).toBe('danger');
    expect(toast.action?.label).toBe('폴더 열기');
    toast.action!.run();
    expect(api.revealOutput).toHaveBeenCalledWith(4);
  });

  it('작업 id 없이 난 오류 토스트에는 동작 버튼이 없다', async () => {
    const { s } = await loaded([job(1, { status: 'paused' })]);
    vi.mocked(api.resumeJob).mockRejectedValueOnce(err('fileMissing'));
    await s.act(1, 'resume');
    expect(toasts.items[0].action).toBeUndefined();
  });
});
