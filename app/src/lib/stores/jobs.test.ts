import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobDto, JobEvent } from '../bindings';
import { err, job, prog, signedInAs } from '../../test/jobFixtures';
import { errorCopy } from '../copy/errors';
import { t } from '../copy/ko';
import { formatFileSize } from '../format/bytes';
import { RECOVERY_NOTICE_MS, RECOVERY_SILENT_MS } from '../timing';

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
  clearFinished: vi.fn(),
  resolve: vi.fn(),
}));

const api = await import('../api');
const { JobsStore, HIGHLIGHT_MS } = await import('./jobs.svelte');
const { toasts } = await import('./toast.svelte');
const { auth } = await import('./auth.svelte');
const { announcer } = await import('./announce.svelte');
const { ui } = await import('./ui.svelte');

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
  // 앞 테스트가 남긴 되돌리기 토스트가 닫히며 remove_job을 부르므로 목을 비우기 전에 먼저 치운다
  toasts.clear();
  vi.mocked(api.subscribeJobs).mockReset();
  vi.mocked(api.resumeJob).mockReset().mockResolvedValue();
  vi.mocked(api.removeJob).mockReset().mockResolvedValue();
  vi.mocked(api.openOutput).mockReset().mockResolvedValue();
  vi.mocked(api.revealOutput).mockReset().mockResolvedValue();
  ui.view = 'settings';
  ui.windowFocused = true;
});

afterEach(() => {
  auth.status = null;
  ui.view = 'home';
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
    expect(toasts.items.map((i) => i.message)).toEqual([t('toast.completed', { title: '금요 방송' })]);
    b.send({ type: 'status', job: job(2, { status: 'completed', title: '금요 방송' }) });
    expect(toasts.items).toHaveLength(1);
  });

  describe('완료 토스트 조건(J12): 홈 밖이고 창이 활성일 때만', () => {
    async function finishOne() {
      const s = new JobsStore();
      const b = begin(s);
      b.snapshot([job(2, { status: 'running' })]);
      await b.started;
      b.send({ type: 'status', job: job(2, { status: 'completed', title: '금요 방송' }) });
    }

    it('설정 화면 + 창 활성 → 토스트', async () => {
      ui.view = 'settings';
      ui.windowFocused = true;
      await finishOne();
      expect(toasts.items.map((i) => i.message)).toEqual([t('toast.completed', { title: '금요 방송' })]);
    });

    it('홈 → 토스트 없이 행 상태만(라이브 영역이 한 줄 읽는다)', async () => {
      ui.view = 'home';
      ui.windowFocused = true;
      const say = vi.spyOn(announcer, 'say');
      await finishOne();
      expect(toasts.items).toHaveLength(0);
      expect(say).toHaveBeenCalledWith(t('a11y.jobStatus', { title: '금요 방송', status: t('job.status.completed') }));
      say.mockRestore();
    });

    it('창 비활성 → 토스트 없음(OS 알림은 Rust가 보낸다)', async () => {
      ui.view = 'settings';
      ui.windowFocused = false;
      await finishOne();
      expect(toasts.items).toHaveLength(0);
    });
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
    expect(toasts.items.map((t) => t.message)).toEqual([
      errorCopy(err('duplicateOutput', { payload: { type: 'duplicateOutput', jobId: 9 } }), { place: 'other' }).title,
    ]);
  });

  it('다른 채널 작업은 B1이 세지 않고 모두 이어받기도 건너뛴다', async () => {
    const A1 = '000000000000000000000000000000a1';
    const C3 = '000000000000000000000000000000c3';
    auth.status = signedInAs(A1);
    const { s, send } = await loaded([
      job(1, { status: 'interrupted', channelId: A1 }),
      job(2, { status: 'interrupted', channelId: C3 }),
    ]);
    expect(s.interruptedCount).toBe(2);
    expect(s.resumableCount).toBe(1);
    await s.resumeAllInterrupted();
    expect(vi.mocked(api.resumeJob).mock.calls).toEqual([[1, false]]);
    // 이어받을 작업이 사라지고 다른 채널만 남으면 배너가 없다
    send({ type: 'status', job: job(1, { status: 'running', channelId: A1 }) });
    expect(s.showInterruptedBanner).toBe(false);
  });

  it('채널 모르는 옛 작업은 B1이 세고, 셸이 남의 영상으로 거부해 채널을 고치면 빠진다', async () => {
    const A1 = '000000000000000000000000000000a1';
    const C3 = '000000000000000000000000000000c3';
    auth.status = signedInAs(A1);
    const { s, send } = await loaded([
      job(1, { status: 'interrupted', channelId: null }),
      job(2, { status: 'interrupted', channelId: A1 }),
    ]);
    expect(s.resumableCount).toBe(2);
    vi.mocked(api.resumeJob).mockImplementation(async (id) => {
      if (id === 1) {
        // 셸은 거부하면서 기록을 실제 채널로 고쳐 상태 이벤트를 보낸다(worker.md 86)
        send({ type: 'status', job: job(1, { status: 'interrupted', channelId: C3 }) });
        throw err('notOwnContent');
      }
    });
    await s.resumeAllInterrupted();
    expect(vi.mocked(api.resumeJob).mock.calls).toEqual([
      [1, false],
      [2, false],
    ]);
    expect(s.resumableIds).toEqual([2]);
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

  it('취소: .part가 없으면 바로 지우고, 1바이트라도 있으면 D2를 거친다', async () => {
    const { s } = await loaded([
      job(1, { status: 'paused' }),
      job(2, { status: 'paused', partialBytes: 1 }),
      job(3, { status: 'queued' }),
    ]);
    await s.act(1, 'cancel');
    expect(api.removeJob).toHaveBeenCalledWith(1);
    await s.act(3, 'cancel');
    expect(api.removeJob).toHaveBeenLastCalledWith(3);
    expect(toasts.items).toHaveLength(0);
    await s.act(2, 'cancel');
    expect(api.removeJob).toHaveBeenCalledTimes(2);
    // 멈춘 작업의 D2 안전 쪽 라벨은 [그대로 두기](running=false)
    expect(s.confirm).toMatchObject({ id: 2, bytes: 1, running: false });
    expect(s.confirmSize).toBe(formatFileSize(1, 1000));
    s.cancelConfirm();
    expect(s.confirm).toBeNull();
    expect(api.removeJob).toHaveBeenCalledTimes(2);
    await s.act(2, 'remove');
    await s.confirmRemove();
    expect(api.removeJob).toHaveBeenLastCalledWith(2);
  });

  it('받는 중인 작업의 D2는 running=true라 안전 쪽이 [계속 받기]다', async () => {
    const { s } = await loaded([job(1, { status: 'running', partialBytes: 5, progress: prog({ bytes: 5 }) })]);
    await s.act(1, 'cancel');
    expect(s.confirm).toMatchObject({ id: 1, running: true });
  });

  it('완료 지우기 대상: 받은 .part가 남은 건너뜀은 셸이 남기므로 세지 않는다', async () => {
    const { s } = await loaded([job(1, { status: 'skipped', partialBytes: 7 })]);
    expect(s.hasFinished).toBe(false);
    const { s: s2 } = await loaded([job(1, { status: 'skipped' })]);
    expect(s2.hasFinished).toBe(true);
  });

  it('덮어쓰고 받기는 D7을 거쳐야 resume이 간다(저장된 파일 이름으로 묻는다)', async () => {
    const { s } = await loaded([job(2, { status: 'skipped', output: 'C:\\영상\\a b.mp4' })]);
    await s.request(2, 'overwrite');
    expect(s.overwrite).toEqual({ id: 2, name: 'a b.mp4' });
    expect(api.resumeJob).not.toHaveBeenCalled();
    s.cancelOverwrite();
    expect(s.overwrite).toBeNull();
    expect(api.resumeJob).not.toHaveBeenCalled();
    await s.request(2, 'overwrite');
    await s.confirmOverwrite();
    expect(api.resumeJob).toHaveBeenCalledWith(2, false);
    expect(s.overwrite).toBeNull();
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
    // 토스트에는 제목만 보이고 원문('job 1')은 없다
    expect(toasts.items.map((t) => [t.message, t.kind])).toEqual([
      [errorCopy(err('jobNotFound', { message: 'job 1' }), { place: 'other' }).title, 'danger'],
    ]);
  });

  it('[파일 열기]에서 파일이 없으면 §9 문구 그대로, [폴더 열기]는 그 작업의 폴더를 연다', async () => {
    const { s } = await loaded([job(4, { status: 'completed' })]);
    vi.mocked(api.openOutput).mockRejectedValueOnce(err('fileMissing', { payload: { type: 'path', path: '/v/4.mp4' } }));
    vi.mocked(api.revealOutput).mockResolvedValueOnce();
    await s.act(4, 'openFile');
    expect(toasts.items).toHaveLength(1);
    const [toast] = toasts.items;
    expect(toast.message).toBe(errorCopy(err('fileMissing'), { place: 'other' }).title);
    expect(toast.kind).toBe('danger');
    expect(toast.action?.label).toBe(t('platform.other.reveal'));
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

describe('지연 삭제(patterns.md §4): 되돌리기 토스트가 사는 동안은 숨기기만 한다', () => {
  async function loaded(list: JobDto[]) {
    const s = new JobsStore();
    const b = begin(s);
    b.snapshot(list);
    await b.started;
    return { s, send: b.send };
  }
  const ids = (s: InstanceType<typeof JobsStore>) => s.order;

  it('지우기: 즉시 숨고 토스트가 뜨며, 아직 remove_job은 가지 않는다', async () => {
    const { s } = await loaded([job(1, { status: 'completed' }), job(2, { status: 'completed' })]);
    await s.act(1, 'remove');
    expect(ids(s)).toEqual([2]);
    expect(api.removeJob).not.toHaveBeenCalled();
    expect(toasts.items.map((i) => [i.message, i.action?.label])).toEqual([[t('toast.removed'), t('action.undo')]]);
  });

  it('[되돌리기]: 항목이 돌아오고 remove_job은 부르지 않는다', async () => {
    const { s } = await loaded([job(1, { status: 'completed' })]);
    await s.act(1, 'remove');
    toasts.runAction(toasts.items[0].id);
    expect(ids(s)).toEqual([1]);
    expect(toasts.items).toHaveLength(0);
    expect(api.removeJob).not.toHaveBeenCalled();
  });

  it.each(['dismiss', 'timeout'] as const)('토스트가 %s로 닫히면 remove_job', async (reason) => {
    const { s } = await loaded([job(1, { status: 'skipped' })]);
    await s.act(1, 'remove');
    toasts.dismiss(toasts.items[0].id, reason);
    expect(api.removeJob).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('타이머(TOAST_MS)가 지나면 확정한다', async () => {
    vi.useFakeTimers();
    const { s } = await loaded([job(1, { status: 'completed' })]);
    await s.act(1, 'remove');
    expect(api.removeJob).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5999);
    expect(api.removeJob).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(api.removeJob).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('둘째 지우기 토스트가 와도 첫 삭제가 먼저 확정되지 않는다(동작 토스트는 대체되지 않는다)', async () => {
    const { s } = await loaded([job(1, { status: 'completed' }), job(2, { status: 'completed' })]);
    await s.act(1, 'remove');
    await s.act(2, 'remove');
    expect(toasts.items).toHaveLength(2);
    expect(api.removeJob).not.toHaveBeenCalled();
    expect(ids(s)).toEqual([]);
    // 첫 토스트를 되돌리면 첫 항목만 돌아오고, 둘째는 줄에서 차례가 오면 확정된다
    toasts.runAction(toasts.items[0].id);
    expect(ids(s)).toEqual([1]);
    expect(api.removeJob).not.toHaveBeenCalled();
    toasts.dismiss(toasts.items[0].id);
    expect(api.removeJob).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('실패 항목도 .part가 없으면 지연 삭제, 있으면 D2', async () => {
    const { s } = await loaded([
      job(1, { status: 'failed', error: err('network') }),
      job(2, { status: 'failed', partialBytes: 1, error: err('network') }),
    ]);
    await s.act(2, 'remove');
    expect(s.confirm).toMatchObject({ id: 2 });
    expect(toasts.items).toHaveLength(0);
    await s.act(1, 'remove');
    expect(toasts.items).toHaveLength(1);
    expect(ids(s)).toEqual([2]);
  });

  it('remove_job이 실패하면 숨겨 두지 않고 오류를 알린다', async () => {
    const { s } = await loaded([job(1, { status: 'completed' })]);
    vi.mocked(api.removeJob).mockRejectedValueOnce(err('jobNotFound', { message: 'job 1' }));
    await s.act(1, 'remove');
    toasts.dismiss(toasts.items[0].id);
    await vi.waitFor(() => expect(toasts.items.map((i) => i.kind)).toEqual(['danger']));
    expect(ids(s)).toEqual([1]);
  });

  it('removed 이벤트가 오면 숨김 표시도 정리된다', async () => {
    const { s, send } = await loaded([job(1, { status: 'completed' })]);
    await s.act(1, 'remove');
    toasts.dismiss(toasts.items[0].id);
    send({ type: 'removed', id: 1 });
    expect(s.hidden.has(1)).toBe(false);
    expect(s.state.jobs.size).toBe(0);
  });

  describe('[완료 항목 지우기]', () => {
    it('그때의 완료·건너뜀 id를 숨기고, 닫힐 때 숨긴 id마다 remove_job(clear_finished는 부르지 않는다)', async () => {
      const { s, send } = await loaded([
        job(1, { status: 'completed' }),
        job(2, { status: 'skipped' }),
        job(3, { status: 'skipped', partialBytes: 5 }),
        job(4, { status: 'running' }),
      ]);
      expect(s.hasFinished).toBe(true);
      s.clearFinished();
      expect(s.order.sort()).toEqual([3, 4]);
      expect(s.hasFinished).toBe(false);
      expect(toasts.items.map((i) => i.message)).toEqual([t('toast.removedMany', { n: 2 })]);
      // 토스트가 살아 있는 동안 끝난 작업은 지워지지 않는다
      send({ type: 'status', job: job(4, { status: 'completed' }) });
      toasts.dismiss(toasts.items[0].id);
      expect(vi.mocked(api.removeJob).mock.calls).toEqual([[1], [2]]);
      expect(api.clearFinished).not.toHaveBeenCalled();
    });

    it('[되돌리기]면 전부 돌아온다', async () => {
      const { s } = await loaded([job(1, { status: 'completed' }), job(2, { status: 'completed' })]);
      s.clearFinished();
      expect(s.order).toEqual([]);
      toasts.runAction(toasts.items[0].id);
      expect(s.order).toEqual([2, 1]);
      expect(api.removeJob).not.toHaveBeenCalled();
    });

    it('지울 것이 없으면 토스트도 없다', async () => {
      const { s } = await loaded([job(1, { status: 'running' })]);
      s.clearFinished();
      expect(toasts.items).toHaveLength(0);
    });
  });
});

describe('접힘과 보이는 순서', () => {
  it('완료 11개: 접힌 동안 order는 최신 5개, 펼치면 전부', async () => {
    const s = new JobsStore();
    const b = begin(s);
    b.snapshot(Array.from({ length: 11 }, (_, i) => job(i + 1, { status: 'completed', createdAt: i + 1 })));
    await b.started;
    expect(s.finishedOpen).toBe(false);
    expect(s.order).toEqual([11, 10, 9, 8, 7]);
    s.finishedOpen = true;
    expect(s.order).toHaveLength(11);
  });
});

describe('연결 대기·회복 추적(patterns.md §3.2·§1.2)', () => {
  const WAIT = prog({ phase: 'waitingNetwork', speedBps: null, etaSecs: null });
  let say: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    say = vi.spyOn(announcer, 'say').mockImplementation(() => {});
  });
  afterEach(() => say.mockRestore());

  async function running() {
    const s = new JobsStore();
    const b = begin(s);
    b.snapshot([job(1, { status: 'running', progress: prog() })]);
    await b.started;
    return { s, b };
  }
  const enter = (b: ReturnType<typeof begin>) => b.send({ type: 'progress', id: 1, progress: WAIT });
  const leave = (b: ReturnType<typeof begin>) => b.send({ type: 'progress', id: 1, progress: prog() });

  it('진입은 처음 본 시각을 적고 polite 알림을 한 번만 낸다(진행 틱은 되풀이하지 않는다)', async () => {
    const { s, b } = await running();
    expect(s.waitingSince.has(1)).toBe(false);
    enter(b);
    const t0 = Date.now();
    expect(s.waitingSince.get(1)).toBe(t0);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith(t('a11y.jobStatus', { title: '영상 1', status: t('job.phase.waitingNetwork') }));
    vi.advanceTimersByTime(5000);
    enter(b);
    b.send({ type: 'status', job: job(1, { status: 'running', progress: WAIT }) });
    expect(say).toHaveBeenCalledTimes(1);
    expect(s.waitingSince.get(1)).toBe(t0);
  });

  it('스냅샷에서 이미 연결 대기인 작업은 지금부터 세고 알리지 않는다', async () => {
    const s = new JobsStore();
    const b = begin(s);
    b.snapshot([job(1, { status: 'running', progress: WAIT })]);
    await b.started;
    expect(s.waitingSince.get(1)).toBe(Date.now());
    expect(say).not.toHaveBeenCalled();
  });

  it('RECOVERY_SILENT_MS 안에 풀리면 조용하다', async () => {
    const { s, b } = await running();
    enter(b);
    vi.advanceTimersByTime(RECOVERY_SILENT_MS - 1);
    leave(b);
    expect(s.waitingSince.has(1)).toBe(false);
    expect(s.recovered.has(1)).toBe(false);
  });

  it('RECOVERY_SILENT_MS를 넘기고 풀리면 회복 줄이 RECOVERY_NOTICE_MS 동안 보인다', async () => {
    const { s, b } = await running();
    enter(b);
    vi.advanceTimersByTime(RECOVERY_SILENT_MS);
    leave(b);
    expect(s.recovered.has(1)).toBe(true);
    vi.advanceTimersByTime(RECOVERY_NOTICE_MS - 1);
    expect(s.recovered.has(1)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(s.recovered.has(1)).toBe(false);
  });

  it('오래 기다리다 일시정지·실패·삭제로 벗어난 것은 회복이 아니다', async () => {
    for (const next of [
      { type: 'status', job: job(1, { status: 'paused', partialBytes: 5 }) },
      { type: 'status', job: job(1, { status: 'failed', error: err('network'), partialBytes: 5 }) },
      { type: 'removed', id: 1 },
    ] as JobEvent[]) {
      const { s, b } = await running();
      enter(b);
      vi.advanceTimersByTime(RECOVERY_SILENT_MS * 2);
      b.send(next);
      expect(s.waitingSince.has(1)).toBe(false);
      expect(s.recovered.has(1)).toBe(false);
    }
  });

  it('회복 줄이 떠 있는 동안 다시 연결 대기에 들어가면 회복 줄은 사라진다', async () => {
    const { s, b } = await running();
    enter(b);
    vi.advanceTimersByTime(RECOVERY_SILENT_MS);
    leave(b);
    expect(s.recovered.has(1)).toBe(true);
    b.send({ type: 'status', job: job(1, { status: 'paused', partialBytes: 5 }) });
    expect(s.recovered.has(1)).toBe(false);
  });
});
