import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobDto, JobEvent } from '../../bindings';
import { err, job, prog, signedInAs } from '../../../test/jobFixtures';

class FakeChannel {
  onmessage: (e: JobEvent) => void = () => {};
}

vi.mock('../../api', () => ({
  Channel: FakeChannel,
  subscribeJobs: vi.fn(),
  pauseJob: vi.fn(),
  resumeJob: vi.fn(),
  removeJob: vi.fn(),
  clearFinished: vi.fn(),
  openOutput: vi.fn(),
  revealOutput: vi.fn(),
  resolve: vi.fn(),
}));

const api = await import('../../api');
const { jobs } = await import('../../stores/jobs.svelte');
const { auth } = await import('../../stores/auth.svelte');
const { default: JobList } = await import('./JobList.svelte');
const { default: AppBanners } = await import('../app/AppBanners.svelte');

let send: (e: JobEvent) => void = () => {};

async function load(list: JobDto[]) {
  vi.mocked(api.subscribeJobs).mockImplementationOnce(async (c) => {
    const ch = c as unknown as FakeChannel;
    send = (e) => ch.onmessage(e);
    return list;
  });
  await jobs.start();
  jobs.bannerDismissed = false;
  jobs.confirm = null;
}

const BIG = 512 * 1024 * 1024 + 1;

beforeEach(() => {
  for (const f of [api.pauseJob, api.resumeJob, api.removeJob, api.clearFinished, api.openOutput, api.revealOutput]) {
    vi.mocked(f).mockReset().mockResolvedValue(undefined as never);
  }
});

afterEach(() => {
  auth.status = null;
});

describe('JobList', () => {
  it('빈 목록: 안내 문구, 완료 항목 지우기 비활성', async () => {
    await load([]);
    render(JobList);
    expect(screen.getByText('아직 받은 영상이 없어요')).toBeInTheDocument();
    expect(screen.getByText('위에 치지직 영상 주소를 붙여넣으세요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '완료 항목 지우기' })).toBeDisabled();
  });

  it('그룹 헤더와 항목, 상태별 버튼이 command로 이어진다', async () => {
    await load([
      job(1, { status: 'running', progress: prog(), title: '금요 방송' }),
      job(2, { status: 'completed', finalBytes: 10, title: '클립' }),
    ]);
    const user = userEvent.setup();
    render(JobList);
    expect(screen.getByRole('heading', { name: '받는 중 1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '완료 1' })).toBeInTheDocument();
    const running = screen.getByRole('article', { name: '금요 방송' });
    const bar = within(running).getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '57');
    expect(bar).toHaveAttribute('aria-valuetext', '57퍼센트, 2분 18초 남음');
    // 상태 줄 구분점은 양쪽에 빈칸(` · `, copy deck과 같은 모양). Svelte가 요소 안 빈칸을 깎아 `받는 중· …`이 됐다
    const status = running.querySelector('.status-row .status')?.textContent ?? '';
    expect(status).toMatch(/받는 중 · \S/);
    expect(status).not.toMatch(/\S·/);
    await user.click(within(running).getByRole('button', { name: '일시정지' }));
    expect(api.pauseJob).toHaveBeenCalledWith(1);

    const done = screen.getByRole('article', { name: '클립' });
    await user.click(within(done).getByRole('button', { name: '파일 열기' }));
    await user.click(within(done).getByRole('button', { name: '폴더 열기' }));
    expect(api.openOutput).toHaveBeenCalledWith(2);
    expect(api.revealOutput).toHaveBeenCalledWith(2);
    await user.click(screen.getByRole('button', { name: '완료 항목 지우기' }));
    expect(api.clearFinished).toHaveBeenCalled();
  });

  it('실패 항목: 오류 줄과 오류 표의 동작', async () => {
    await load([
      job(3, {
        status: 'failed',
        partialBytes: 100,
        error: err('diskFull', { payload: { type: 'path', path: 'D:\\영상' } }),
      }),
    ]);
    const user = userEvent.setup();
    render(JobList);
    const item = screen.getByRole('article', { name: '영상 3' });
    expect(within(item).getByText('저장 공간이 부족해요')).toBeInTheDocument();
    expect(within(item).getByText('D:\\영상가 있는 디스크의 공간을 비운 뒤 이어받으세요.')).toBeInTheDocument();
    await user.click(within(item).getByRole('button', { name: '이어받기' }));
    expect(api.resumeJob).toHaveBeenCalledWith(3, false);
  });

  it('D2: 512 MiB를 넘게 받은 작업만 취소 전에 묻고, 기본 포커스는 돌아가기', async () => {
    await load([
      job(1, { status: 'paused', partialBytes: 10 }),
      job(2, { status: 'paused', partialBytes: BIG }),
    ]);
    const user = userEvent.setup();
    render(JobList);
    await user.click(screen.getByRole('button', { name: '취소: 영상 1' }));
    expect(api.removeJob).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: '취소: 영상 2' }));
    const dialog = await screen.findByRole('dialog', { name: '다운로드를 취소할까요?' });
    expect(within(dialog).getByText('지금까지 받은 512.0 MB도 함께 지워져요.')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '돌아가기' })).toHaveFocus());
    await user.click(within(dialog).getByRole('button', { name: '돌아가기' }));
    expect(api.removeJob).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '취소: 영상 2' }));
    await user.click(await screen.findByRole('button', { name: '취소하고 지우기' }));
    expect(api.removeJob).toHaveBeenLastCalledWith(2);
  });

  it('키보드: 위·아래 이동, Space 일시정지, Delete 지우기, 안쪽 버튼의 키는 항목이 받지 않는다', async () => {
    await load([
      job(1, { status: 'running', progress: prog(), createdAt: 2 }),
      job(2, { status: 'completed', createdAt: 1 }),
    ]);
    render(JobList);
    const [a, b] = screen.getAllByRole('article');
    expect(a).toHaveAttribute('tabindex', '0');
    expect(b).toHaveAttribute('tabindex', '-1');
    a.focus();
    await fireEvent.keyDown(a, { key: 'ArrowDown' });
    expect(b).toHaveFocus();
    expect(b).toHaveAttribute('tabindex', '0');
    await fireEvent.keyDown(b, { key: 'Delete' });
    expect(api.removeJob).toHaveBeenCalledWith(2);
    await fireEvent.keyDown(b, { key: 'ArrowUp' });
    expect(a).toHaveFocus();
    await fireEvent.keyDown(a, { key: ' ' });
    expect(api.pauseJob).toHaveBeenCalledTimes(1);
    // 안쪽 버튼에서 Space: 항목의 처리기는 돌지 않는다
    await fireEvent.keyDown(within(a).getByRole('button', { name: '일시정지' }), { key: ' ' });
    expect(api.pauseJob).toHaveBeenCalledTimes(1);
  });

  it('포커스를 가진 항목이 지워지면 이웃 항목으로, 마지막이면 목록 제목으로', async () => {
    await load([job(1, { status: 'completed', createdAt: 2 }), job(2, { status: 'completed', createdAt: 1 })]);
    render(JobList);
    const [a] = screen.getAllByRole('article');
    a.focus();
    send({ type: 'removed', id: 1 });
    await waitFor(() => expect(screen.getByRole('article', { name: '영상 2' })).toHaveFocus());
    send({ type: 'removed', id: 2 });
    await waitFor(() => expect(screen.getByRole('heading', { name: '다운로드' })).toHaveFocus());
  });

  it('[목록에서 보기]: 그 항목으로 포커스', async () => {
    await load([job(1), job(2)]);
    render(JobList);
    jobs.reveal(1);
    await waitFor(() => expect(screen.getByRole('article', { name: '영상 1' })).toHaveFocus());
  });
});

describe('B1 배너', () => {
  it('중단된 작업 수와 모두 이어받기, 닫기', async () => {
    await load([job(1, { status: 'interrupted' }), job(2, { status: 'interrupted' }), job(3)]);
    const user = userEvent.setup();
    render(AppBanners);
    expect(screen.getByText('지난번에 받다가 멈춘 다운로드가 2개 있어요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '모두 이어받기' }));
    expect(vi.mocked(api.resumeJob).mock.calls).toEqual([
      [1, false],
      [2, false],
    ]);
    send({ type: 'status', job: job(1) });
    expect(await screen.findByText('지난번에 받다가 멈춘 다운로드가 1개 있어요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByText(/지난번에 받다가/)).toBeNull();
  });
});

describe('막힌 작업(A5)', () => {
  const A1 = '000000000000000000000000000000a1';
  const C3 = '000000000000000000000000000000c3';

  it('다른 채널의 멈춘 작업은 안내만 있고 이어받기 버튼이 없다', async () => {
    auth.status = signedInAs(A1);
    await load([job(1, { status: 'interrupted', channelId: C3, partialBytes: 100, title: '남의 영상' })]);
    const user = userEvent.setup();
    render(JobList);
    const item = screen.getByRole('article', { name: '남의 영상' });
    expect(within(item).getByText('다른 채널로 로그인해 이어받을 수 없어요')).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: '이어받기' })).toBeNull();
    // 지우기는 남는다
    expect(within(item).getByRole('button', { name: /취소/ })).toBeInTheDocument();
    item.focus();
    await user.keyboard(' ');
    expect(api.resumeJob).not.toHaveBeenCalled();
  });

  it('채널 모르는 옛 작업은 막지 않고 셸 판정에 맡긴다', async () => {
    auth.status = signedInAs(A1);
    await load([job(1, { status: 'interrupted', channelId: null, title: '옛 작업' })]);
    render(JobList);
    const item = screen.getByRole('article', { name: '옛 작업' });
    expect(within(item).queryByText('다른 채널로 로그인해 이어받을 수 없어요')).toBeNull();
    expect(within(item).getByRole('button', { name: '이어받기' })).toBeInTheDocument();
  });

  it('같은 채널 작업은 이어받기가 있다', async () => {
    auth.status = signedInAs(A1);
    await load([job(1, { status: 'interrupted', channelId: A1, title: '내 영상' })]);
    render(JobList);
    const item = screen.getByRole('article', { name: '내 영상' });
    expect(within(item).getByRole('button', { name: '이어받기' })).toBeInTheDocument();
    expect(within(item).queryByText(/이어받을 수 없어요/)).toBeNull();
  });
});
