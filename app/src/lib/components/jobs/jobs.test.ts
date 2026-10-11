import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobDto, JobEvent, SettingsDto } from '../../bindings';
import { err, job, prog, signedInAs } from '../../../test/jobFixtures';
import { t } from '../../copy/ko';
import { errorCopy } from '../../copy/errors';
import { formatFileSize } from '../../format/bytes';
import { COMPLETED_FOLD_AT, RECOVERY_NOTICE_MS, RECOVERY_SILENT_MS } from '../../timing';

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
const { settings } = await import('../../stores/settings.svelte');
const { platform } = await import('../../stores/platform.svelte');
const { toasts } = await import('../../stores/toast.svelte');
const { default: JobList } = await import('./JobList.svelte');
const { default: AppBanners } = await import('../app/AppBanners.svelte');

const baseSettings: SettingsDto = {
  downloadFolder: null,
  effectiveDownloadFolder: '/Users/me/Movies/VOD Clip Downloader',
  useNaverCookies: false,
  naverCookiesSaved: false,
  lastQualityLabel: null,
  lastUrl: null,
  recentVods: [],
  segmentConcurrency: 4,
  maxParallelDownloads: 2,
  autoResumeInterrupted: false,
  importedFrom: null,
  textScale: 'default',
  theme: 'system',
  keepAwake: true,
};

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
  jobs.overwrite = null;
  jobs.hidden.clear();
  jobs.finishedOpen = false;
}

/** 행의 [⋯]를 열고 항목을 누른다 */
async function pickMenu(user: ReturnType<typeof userEvent.setup>, item: HTMLElement, title: string, label: string) {
  await user.click(within(item).getByRole('button', { name: t('a11y.more', { title }) }));
  await user.click(await screen.findByRole('menuitem', { name: label }));
}

beforeEach(() => {
  toasts.clear();
  for (const f of [api.pauseJob, api.resumeJob, api.removeJob, api.clearFinished, api.openOutput, api.revealOutput]) {
    vi.mocked(f).mockReset().mockResolvedValue(undefined as never);
  }
  settings.dto = { ...baseSettings };
  platform.set('linux');
});

afterEach(() => {
  auth.status = null;
  settings.dto = null;
  platform.set('linux');
});

describe('빈 상태 두 종류(J13)', () => {
  it('기록이 없으면 첫 실행 안내: 제목·범위·3단계 ol, 완료 항목 지우기 버튼 없음', async () => {
    await load([]);
    render(JobList);
    expect(screen.getByText(t('list.empty.title'))).toBeInTheDocument();
    expect(screen.getByText(t('list.empty.scope'))).toBeInTheDocument();
    const steps = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toEqual([t('list.empty.step1'), t('list.empty.step2'), t('list.empty.step3')]);
    expect(screen.queryByText(t('list.cleared'))).toBeNull();
    // 지울 것이 없으면 버튼 자체가 없다
    expect(screen.queryByRole('button', { name: t('list.clearFinished') })).toBeNull();
  });

  it('최근 영상이 있으면 비운 뒤: list.cleared 한 줄만', async () => {
    settings.dto = {
      ...baseSettings,
      recentVods: [{ url: 'https://chzzk.naver.com/video/9', title: '지난 방송', kind: 'vod', date: null }],
    };
    await load([]);
    render(JobList);
    expect(screen.getByText(t('list.cleared'))).toBeInTheDocument();
    expect(screen.queryByText(t('list.empty.title'))).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('마지막 주소가 있어도 비운 뒤다', async () => {
    settings.dto = { ...baseSettings, lastUrl: 'https://chzzk.naver.com/video/9' };
    await load([]);
    render(JobList);
    expect(screen.getByText(t('list.cleared'))).toBeInTheDocument();
  });

  it('설정을 아직 모르면 "없음"을 먼저 보이지 않는다', async () => {
    settings.dto = null;
    await load([]);
    render(JobList);
    expect(screen.queryByText(t('list.empty.title'))).toBeNull();
    expect(screen.queryByText(t('list.cleared'))).toBeNull();
  });

  it('지워서 목록이 비면 첫 실행 안내가 아니라 비운 뒤 한 줄이다', async () => {
    settings.dto = { ...baseSettings, lastUrl: 'https://chzzk.naver.com/video/1' };
    await load([job(1, { status: 'completed' })]);
    const user = userEvent.setup();
    render(JobList);
    await user.click(screen.getByRole('button', { name: t('list.clearFinished') }));
    expect(screen.getByText(t('list.cleared'))).toBeInTheDocument();
  });
});

describe('JobList', () => {
  it('그룹 머리와 행, 상태별 버튼이 command로 이어진다', async () => {
    await load([
      job(1, { status: 'running', progress: prog(), title: '금요 방송' }),
      job(2, { status: 'completed', finalBytes: 10, title: '클립' }),
    ]);
    const user = userEvent.setup();
    render(JobList);
    expect(screen.getByRole('heading', { name: t('list.group.running', { n: 1 }) })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: t('list.group.finished', { n: 1 }) })).toBeInTheDocument();
    const running = screen.getByRole('article', { name: '금요 방송' });
    // 접근 이름 필수(제목), 값은 0~100 정수(내림)
    const bar = within(running).getByRole('progressbar', { name: '금요 방송' });
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuenow', '57');
    expect(bar).toHaveAttribute('data-state', 'active');
    expect(bar).toHaveAttribute('aria-valuetext', '57퍼센트 받았어요. 약 2분 남아요');
    // 퍼센트 칸은 막대 오른쪽에 늘 있다(P-2)
    expect(running.querySelector('.job-pct')).toHaveTextContent('57%');
    // 상태 줄은 조각을 ` · `로 잇는다
    const status = running.querySelector('.job-status')?.textContent ?? '';
    // 기본 OS(linux)는 1000 진법이다
    expect(status).toBe('받는 중 · 2.5GB / 4.3GB · 13.0MB/s · 약 2분 남음');
    await user.click(within(running).getByRole('button', { name: t('action.pause') }));
    expect(api.pauseJob).toHaveBeenCalledWith(1);

    const done = screen.getByRole('article', { name: '클립' });
    await user.click(within(done).getByRole('button', { name: t('action.openFile') }));
    await user.click(within(done).getByRole('button', { name: t('platform.other.reveal') }));
    expect(api.openOutput).toHaveBeenCalledWith(2);
    expect(api.revealOutput).toHaveBeenCalledWith(2);
  });

  it('폴더 보기 버튼 라벨은 OS를 따른다(macOS는 Finder)', async () => {
    platform.set('macos');
    await load([job(2, { status: 'completed', finalBytes: 10, title: '클립' })]);
    render(JobList);
    const done = screen.getByRole('article', { name: '클립' });
    expect(within(done).getByRole('button', { name: t('platform.mac.reveal') })).toBeInTheDocument();
  });

  it('동작 줄은 자기 줄이고 버튼은 글자(취소는 글자뿐) ghost sm, [⋯]는 오른쪽 끝', async () => {
    await load([job(1, { status: 'running', progress: prog(), title: '금요 방송' })]);
    render(JobList);
    const row = screen.getByRole('article', { name: '금요 방송' });
    const acts = row.querySelector('.job-actions') as HTMLElement;
    expect(acts).not.toBeNull();
    const buttons = within(acts).getAllByRole('button');
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([t('action.pause'), t('action.cancel'), '']);
    for (const b of buttons.slice(0, 2)) {
      expect(b).toHaveClass('btn-ghost');
      expect(b).toHaveClass('btn-sm');
    }
    // 일시정지는 글자 + 아이콘, 취소는 글자뿐(foundations §9.1)
    expect(buttons[0].querySelector('svg')).not.toBeNull();
    expect(buttons[1].querySelector('svg')).toBeNull();
    expect(buttons[2]).toHaveAttribute('aria-label', t('a11y.more', { title: '금요 방송' }));
    // 레일·행 안 스피너 없음
    expect(row.className).not.toMatch(/rail/);
    expect(row.querySelector('.spinner')).toBeNull();
  });

  it('준비 중: value=null 막대(aria-valuenow 없음), 퍼센트 칸은 비고 스피너가 없다', async () => {
    await load([job(1, { status: 'running', title: '준비' })]);
    render(JobList);
    const row = screen.getByRole('article', { name: '준비' });
    const bar = within(row).getByRole('progressbar');
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(row.querySelector('.job-pct')).toHaveTextContent('');
    expect(bar.querySelector('svg')).toBeNull();
    expect(row.querySelector('.job-status')).toHaveTextContent(t('job.status.resolving'));
  });

  it('퍼센트는 뒤로 가지 않고 100%는 완료에서만 보인다(P-4·P-6)', async () => {
    await load([job(1, { status: 'running', progress: prog({ bytes: 3_000_000_000 }), title: '단조' })]);
    render(JobList);
    const row = () => screen.getByRole('article', { name: '단조' });
    expect(row().querySelector('.job-pct')).toHaveTextContent('69%');
    // 코어 값이 줄어도 표시는 69%
    send({ type: 'progress', id: 1, progress: prog({ bytes: 1_000_000_000 }) });
    await waitFor(() => expect(within(row()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '69'));
    expect(row().querySelector('.job-pct')).toHaveTextContent('69%');
    // 마무리 중에 받은 양이 총량과 같아도 99%
    send({ type: 'progress', id: 1, progress: prog({ phase: 'finalizing', bytes: 4_294_967_296 }) });
    await waitFor(() => expect(row().querySelector('.job-pct')).toHaveTextContent('99%'));
    expect(row()).not.toHaveTextContent('100%');
  });

  it('실패 행: ⊗ + 오류 제목(상태 줄) + 본문 + 오류 표의 동작', async () => {
    const e = err('diskFull', { payload: { type: 'path', path: 'D:\\영상' } });
    await load([job(3, { status: 'failed', partialBytes: 100, error: e })]);
    const user = userEvent.setup();
    render(JobList);
    const item = screen.getByRole('article', { name: '영상 3' });
    const copy = errorCopy(e, { place: 'job', partialBytes: 100 });
    expect(within(item).getByText(copy.title)).toBeInTheDocument();
    expect(within(item).getByText(copy.body)).toBeInTheDocument();
    expect(item.querySelector('.notice-row.tone-danger svg')).not.toBeNull();
    await user.click(within(item).getByRole('button', { name: t('action.resume') }));
    expect(api.resumeJob).toHaveBeenCalledWith(3, false);
  });

  it('완료 · 파일 없음: 경고 아이콘 + 상태 조각 + 본문 줄 + [폴더에서 보기]만', async () => {
    await load([job(1, { status: 'completed', missing: true, title: '없는 파일' })]);
    render(JobList);
    const item = screen.getByRole('article', { name: '없는 파일' });
    expect(within(item).getByText(t('job.completedMissing'))).toBeInTheDocument();
    expect(within(item).getByText(t('job.completedMissing.body'))).toBeInTheDocument();
    expect(item.querySelector('.notice-row.tone-warning svg')).not.toBeNull();
    expect(within(item).queryByRole('button', { name: t('action.openFile') })).toBeNull();
    expect(within(item).getByRole('button', { name: t('platform.other.reveal') })).toBeInTheDocument();
  });

  it('완료 시각이 없는 완료 행: 끝에 · 가 남지 않는다', async () => {
    await load([job(1, { status: 'completed', finalBytes: 1024, title: '시각 없음' })]);
    render(JobList);
    const status = screen.getByRole('article', { name: '시각 없음' }).querySelector('.job-status')?.textContent;
    expect(status).toBe(t('job.completedNoTime', { size: '1.02KB' }));
  });

  it('완료 행에는 막대와 퍼센트가 없다', async () => {
    await load([job(1, { status: 'completed', finalBytes: 10, title: '끝' })]);
    render(JobList);
    const item = screen.getByRole('article', { name: '끝' });
    expect(within(item).queryByRole('progressbar')).toBeNull();
    expect(item.querySelector('.job-pct')).toBeNull();
  });

  it('목록 제목은 프로그램 포커스를 받는 컨테이너다', async () => {
    await load([job(1)]);
    render(JobList);
    const h = screen.getByRole('heading', { name: t('list.title') });
    expect(h).toHaveAttribute('tabindex', '-1');
    expect(h).toHaveAttribute('data-focus-container');
  });
});

describe('취소(D2): .part가 있으면 크기와 무관하게 묻는다', () => {
  it('받은 바이트 0은 [취소] 즉시, 1바이트부터는 [취소…] + D2', async () => {
    await load([
      job(1, { status: 'paused', title: '빈 것' }),
      job(2, { status: 'paused', partialBytes: 1, title: '한 바이트' }),
      job(3, { title: '대기' }),
    ]);
    const user = userEvent.setup();
    render(JobList);

    const waiting = screen.getByRole('article', { name: '대기' });
    const plain = within(waiting).getByRole('button', { name: t('a11y.cancelJob', { title: '대기' }) });
    expect(plain).toHaveTextContent(t('common.cancel'));
    expect(plain).not.toHaveClass('tone-danger');
    expect(within(waiting).queryByText(t('action.cancel'))).toBeNull();
    await user.click(plain);
    expect(api.removeJob).toHaveBeenCalledWith(3);
    expect(toasts.items).toHaveLength(0);

    const empty = screen.getByRole('article', { name: '빈 것' });
    await user.click(within(empty).getByRole('button', { name: t('a11y.cancelJob', { title: '빈 것' }) }));
    expect(api.removeJob).toHaveBeenLastCalledWith(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    const some = screen.getByRole('article', { name: '한 바이트' });
    const danger = within(some).getByRole('button', { name: t('a11y.cancelJob', { title: '한 바이트' }) });
    expect(danger).toHaveTextContent(t('action.cancel'));
    expect(danger).toHaveClass('tone-danger');
    // 취소는 글자뿐이다(x 아이콘 없음, foundations §9.1)
    expect(danger.querySelector('svg, .icon')).toBeNull();
    await user.click(danger);
    const dialog = await screen.findByRole('dialog', { name: t('dialog.cancel.title', { title: '한 바이트' }) });
    expect(within(dialog).getByText(t('dialog.cancel.body', { size: '1B' }))).toBeInTheDocument();
    // 버튼 순서는 [실행(danger)][안전(primary)]. 멈춘 작업이라 안전 쪽은 [그대로 두기](받는 중이면 [계속 받기])
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual([
      t('dialog.cancel.confirm'),
      t('dialog.cancel.keepPaused'),
    ]);
    expect(within(dialog).getByRole('button', { name: t('dialog.cancel.keepPaused') })).toHaveClass('btn-primary');
    expect(within(dialog).getByRole('button', { name: t('dialog.cancel.confirm') })).toHaveClass('tone-danger');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: t('dialog.cancel.keepPaused') })).toHaveFocus());
    await user.click(within(dialog).getByRole('button', { name: t('dialog.cancel.keepPaused') }));
    expect(api.removeJob).toHaveBeenCalledTimes(2);

    // Esc는 닫기만 한다(아무것도 지우지 않는다)
    await user.click(danger);
    await screen.findByRole('dialog', { name: t('dialog.cancel.title', { title: '한 바이트' }) });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.removeJob).toHaveBeenCalledTimes(2);

    await user.click(danger);
    await user.click(await screen.findByRole('button', { name: t('dialog.cancel.confirm') }));
    expect(api.removeJob).toHaveBeenLastCalledWith(2);
  });

  it('네이티브 E2E 훅: 실패한 항목 article에 failed 클래스', async () => {
    await load([job(3, { status: 'failed', partialBytes: 5, progress: prog(), title: '실패' })]);
    render(JobList);
    expect(document.querySelector('article[data-job-id]')).toHaveClass('failed');
  });

  it('진행 막대 state: 링크 갱신 waiting, 멈춤 paused, 실패 failed', async () => {
    await load([
      job(1, { status: 'running', progress: prog({ phase: 'reresolving' }), title: '갱신' }),
      job(2, { status: 'paused', progress: prog(), title: '멈춤' }),
      job(3, { status: 'failed', partialBytes: 5, progress: prog(), title: '실패' }),
    ]);
    render(JobList);
    const state = (name: string) => within(screen.getByRole('article', { name })).getByRole('progressbar').getAttribute('data-state');
    expect(state('갱신')).toBe('waiting');
    expect(state('멈춤')).toBe('paused');
    expect(state('실패')).toBe('failed');
    // 멈춤·실패에도 퍼센트가 남는다(P-2)
    for (const name of ['멈춤', '실패']) {
      expect(screen.getByRole('article', { name }).querySelector('.job-pct')).toHaveTextContent('57%');
    }
  });
});

describe('지우기와 되돌리기(지연 삭제)', () => {
  it('[⋯] › 목록에서 지우기: 즉시 숨고 토스트 [되돌리기], 되돌리면 복귀하고 remove_job은 없다', async () => {
    await load([job(1, { status: 'completed', title: '완료 하나' }), job(2, { status: 'completed', title: '완료 둘' })]);
    const user = userEvent.setup();
    render(JobList);
    const item = screen.getByRole('article', { name: '완료 하나' });
    await pickMenu(user, item, '완료 하나', t('action.remove'));
    expect(screen.queryByRole('article', { name: '완료 하나' })).toBeNull();
    expect(api.removeJob).not.toHaveBeenCalled();
    expect(toasts.items.map((i) => [i.message, i.action?.label])).toEqual([[t('toast.removed'), t('action.undo')]]);
    toasts.runAction(toasts.items[0].id);
    expect(await screen.findByRole('article', { name: '완료 하나' })).toBeInTheDocument();
    expect(api.removeJob).not.toHaveBeenCalled();
  });

  it('토스트가 닫히면 remove_job', async () => {
    await load([job(1, { status: 'skipped', title: '건너뜀' })]);
    const user = userEvent.setup();
    render(JobList);
    await pickMenu(user, screen.getByRole('article', { name: '건너뜀' }), '건너뜀', t('action.remove'));
    toasts.dismiss(toasts.items[0].id);
    expect(api.removeJob).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('Delete 키: 끝난 항목은 지연 삭제 + 포커스는 다음 행으로(F-4)', async () => {
    await load([job(1, { status: 'completed', createdAt: 2 }), job(2, { status: 'completed', createdAt: 1 })]);
    render(JobList);
    const [a] = screen.getAllByRole('article');
    a.focus();
    await fireEvent.keyDown(a, { key: 'Delete' });
    expect(api.removeJob).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('article', { name: '영상 2' })).toHaveFocus());
    expect(toasts.items).toHaveLength(1);
  });

  it('둘째 지우기 토스트가 와도 첫 삭제는 먼저 확정되지 않는다', async () => {
    await load([job(1, { status: 'completed' }), job(2, { status: 'completed' })]);
    const user = userEvent.setup();
    render(JobList);
    await pickMenu(user, screen.getByRole('article', { name: '영상 1' }), '영상 1', t('action.remove'));
    await pickMenu(user, screen.getByRole('article', { name: '영상 2' }), '영상 2', t('action.remove'));
    expect(toasts.items).toHaveLength(2);
    expect(api.removeJob).not.toHaveBeenCalled();
  });

  it('[완료 항목 지우기]: 완료·건너뜀을 숨기고 개수 토스트, 도움말은 sr-only 설명, 닫히면 숨긴 id마다 remove_job', async () => {
    await load([
      job(1, { status: 'completed' }),
      job(2, { status: 'skipped' }),
      job(3, { status: 'skipped', partialBytes: 5 }),
      job(4, { status: 'running', progress: prog() }),
    ]);
    const user = userEvent.setup();
    render(JobList);
    const button = screen.getByRole('button', { name: t('list.clearFinished') });
    expect(button).toHaveAccessibleDescription(t('list.clearFinished.help'));
    expect(button).toHaveClass('edge-end');
    await user.click(button);
    expect(screen.queryByRole('article', { name: '영상 1' })).toBeNull();
    expect(screen.queryByRole('article', { name: '영상 2' })).toBeNull();
    // 받은 .part가 남은 건너뜀과 받는 중인 항목은 그대로
    expect(screen.getByRole('article', { name: '영상 3' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: '영상 4' })).toBeInTheDocument();
    expect(toasts.items.map((i) => i.message)).toEqual([t('toast.removedMany', { n: 2 })]);
    // 더 지울 것이 없으니 버튼이 사라진다
    expect(screen.queryByRole('button', { name: t('list.clearFinished') })).toBeNull();
    toasts.dismiss(toasts.items[0].id);
    expect(vi.mocked(api.removeJob).mock.calls).toEqual([[1], [2]]);
    expect(api.clearFinished).not.toHaveBeenCalled();
  });
});

describe('건너뜀 행의 [덮어쓰고 받기…](D7)', () => {
  it('대화상자에서 확인해야 resume이 간다. [그대로 두기]는 아무 일도 없다', async () => {
    await load([job(5, { status: 'skipped', output: '/v/내 영상.mp4', title: '건너뜀' })]);
    const user = userEvent.setup();
    render(JobList);
    const item = screen.getByRole('article', { name: '건너뜀' });
    expect(within(item).getByText(t('job.status.skipped'))).toBeInTheDocument();
    expect(within(item).getByText(t('job.skipped.body'))).toBeInTheDocument();
    await user.click(within(item).getByRole('button', { name: t('action.overwriteAndDownload') }));
    const dialog = await screen.findByRole('dialog', { name: t('dialog.overwrite.title', { name: '내 영상.mp4' }) });
    expect(api.resumeJob).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: t('dialog.cancel.keepPaused') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.resumeJob).not.toHaveBeenCalled();

    await user.click(within(item).getByRole('button', { name: t('action.overwriteAndDownload') }));
    await user.click(await screen.findByRole('button', { name: t('dialog.overwrite.confirm') }));
    expect(api.resumeJob).toHaveBeenCalledExactlyOnceWith(5, false);
  });

  it('받는 동안 생긴 건너뜀은 본문이 다르다', async () => {
    await load([job(5, { status: 'skipped', partialBytes: 10, title: '받는 동안' })]);
    render(JobList);
    const item = screen.getByRole('article', { name: '받는 동안' });
    expect(within(item).getByText(t('job.skippedMeanwhile.body'))).toBeInTheDocument();
  });
});

describe('[⋯] › 제목 전체 보기', () => {
  it('행 아래에 전체 제목을 펼친다(다시 누르면 접힌다)', async () => {
    const title = '아주 긴 제목 '.repeat(12).trim();
    await load([job(1, { status: 'completed', title })]);
    const user = userEvent.setup();
    render(JobList);
    const item = screen.getByRole('article', { name: title });
    expect(item.querySelector('.job-fulltitle')).toBeNull();
    await pickMenu(user, item, title, t('action.showTitle'));
    expect(item.querySelector('.job-fulltitle')).toHaveTextContent(title);
    await pickMenu(user, item, title, t('action.showTitle'));
    expect(item.querySelector('.job-fulltitle')).toBeNull();
  });

  it('메뉴는 제목 전체 보기와 주소 복사를 늘 갖는다(항목 하나짜리 메뉴가 되지 않는다)', async () => {
    await load([job(1, { title: '대기' })]);
    const user = userEvent.setup();
    render(JobList);
    await user.click(screen.getByRole('button', { name: t('a11y.more', { title: '대기' }) }));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent?.trim())).toEqual([
      t('action.showTitle'),
      t('action.copyUrl'),
    ]);
  });
});

describe('완료 그룹 접힘', () => {
  const finished = (n: number) => Array.from({ length: n }, (_, i) => job(i + 1, { status: 'completed', createdAt: i + 1 }));

  it(`${COMPLETED_FOLD_AT - 1}개는 전부 보인다`, async () => {
    await load(finished(COMPLETED_FOLD_AT - 1));
    render(JobList);
    expect(screen.getAllByRole('article')).toHaveLength(COMPLETED_FOLD_AT - 1);
    expect(screen.getByRole('heading', { name: t('list.group.finished', { n: COMPLETED_FOLD_AT - 1 }) })).toBeInTheDocument();
  });

  it(`${COMPLETED_FOLD_AT}개부터 기본 접힘: 머리 + 최신 5개, 펼치면 전부, 다시 접힌다`, async () => {
    await load(finished(COMPLETED_FOLD_AT));
    const user = userEvent.setup();
    render(JobList);
    const head = screen.getByRole('heading', { name: t('list.group.finished', { n: COMPLETED_FOLD_AT }) });
    const toggle = within(head).getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 머리 줄 자체가 토글이고 미리보기는 같은 그룹 상자 안이다(details 상자 없음)
    expect(head.closest('details')).toBeNull();
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual([
      '영상 11',
      '영상 10',
      '영상 9',
      '영상 8',
      '영상 7',
    ]);
    await user.click(toggle);
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(COMPLETED_FOLD_AT));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(5));
  });

  it('접힌 동안 ↓는 미리 보이는 5개 안에서만 움직인다', async () => {
    await load(finished(COMPLETED_FOLD_AT));
    render(JobList);
    const items = screen.getAllByRole('article');
    items[4].focus();
    await fireEvent.keyDown(items[4], { key: 'ArrowDown' });
    expect(items[4]).toHaveFocus();
  });
});

describe('키보드', () => {
  it('위·아래 이동, Space 일시정지, 안쪽 버튼의 키는 행이 받지 않는다', async () => {
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
    await fireEvent.keyDown(b, { key: 'ArrowUp' });
    expect(a).toHaveFocus();
    await fireEvent.keyDown(a, { key: ' ' });
    expect(api.pauseJob).toHaveBeenCalledTimes(1);
    // 안쪽 버튼에서 Space: 행의 처리기는 돌지 않는다
    await fireEvent.keyDown(within(a).getByRole('button', { name: t('action.pause') }), { key: ' ' });
    expect(api.pauseJob).toHaveBeenCalledTimes(1);
  });

  it('IME 조합 중의 키는 무시한다(DX6)', async () => {
    await load([job(1, { status: 'running', progress: prog() })]);
    render(JobList);
    const a = screen.getByRole('article');
    a.focus();
    await fireEvent.keyDown(a, { key: ' ', isComposing: true });
    await fireEvent.keyDown(a, { key: ' ', keyCode: 229 });
    expect(api.pauseJob).not.toHaveBeenCalled();
  });

  it('포커스를 가진 행이 지워지면 이웃 행으로, 마지막이면 목록 제목으로', async () => {
    await load([job(1, { status: 'completed', createdAt: 2 }), job(2, { status: 'completed', createdAt: 1 })]);
    render(JobList);
    const [a] = screen.getAllByRole('article');
    a.focus();
    send({ type: 'removed', id: 1 });
    await waitFor(() => expect(screen.getByRole('article', { name: '영상 2' })).toHaveFocus());
    send({ type: 'removed', id: 2 });
    await waitFor(() => expect(screen.getByRole('heading', { name: t('list.title') })).toHaveFocus());
  });

  it('[목록에서 보기]: 그 행으로 포커스', async () => {
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
    expect(screen.getByText(t('banner.interrupted', { n: 2 }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '모두 이어받기' }));
    expect(vi.mocked(api.resumeJob).mock.calls).toEqual([
      [1, false],
      [2, false],
    ]);
    send({ type: 'status', job: job(1) });
    expect(await screen.findByText(t('banner.interrupted', { n: 1 }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('common.close') }));
    expect(screen.queryByText(t('banner.interrupted', { n: 1 }))).toBeNull();
  });
});

describe('막힌 작업(A5)', () => {
  const A1 = '000000000000000000000000000000a1';
  const C3 = '000000000000000000000000000000c3';

  it('받는 중인 작업의 D2는 안전 쪽이 [계속 받기]다', async () => {
    await load([job(1, { status: 'running', progress: prog({ bytes: 5 }), title: '받는 중' })]);
    const user = userEvent.setup();
    render(JobList);
    const item = screen.getByRole('article', { name: '받는 중' });
    await user.click(within(item).getByRole('button', { name: t('a11y.cancelJob', { title: '받는 중' }) }));
    const dialog = await screen.findByRole('dialog', { name: t('dialog.cancel.title', { title: '받는 중' }) });
    expect(within(dialog).getByRole('button', { name: t('dialog.cancel.keepRunning') })).toHaveClass('btn-primary');
    expect(within(dialog).queryByRole('button', { name: t('dialog.cancel.keepPaused') })).toBeNull();
  });

  it('다른 채널의 멈춘 작업은 안내만 있고 이어받기 버튼이 없다', async () => {
    auth.status = signedInAs(A1);
    await load([job(1, { status: 'interrupted', channelId: C3, partialBytes: 100, title: '남의 영상' })]);
    const user = userEvent.setup();
    render(JobList);
    const item = screen.getByRole('article', { name: '남의 영상' });
    expect(within(item).getByText(t('job.otherChannel.body'))).toBeInTheDocument();
    expect(item).toHaveAccessibleDescription(t('job.otherChannel.body'));
    expect(within(item).queryByRole('button', { name: t('action.resume') })).toBeNull();
    // 지우기는 남는다(.part가 있으니 [취소…])
    expect(within(item).getByRole('button', { name: t('a11y.cancelJob', { title: '남의 영상' }) })).toHaveTextContent(t('action.cancel'));
    item.focus();
    await user.keyboard(' ');
    expect(api.resumeJob).not.toHaveBeenCalled();
  });

  it('채널 모르는 옛 작업은 막지 않고 셸 판정에 맡긴다', async () => {
    auth.status = signedInAs(A1);
    await load([job(1, { status: 'interrupted', channelId: null, title: '옛 작업' })]);
    render(JobList);
    const item = screen.getByRole('article', { name: '옛 작업' });
    expect(within(item).queryByText(t('job.otherChannel.body'))).toBeNull();
    expect(within(item).getByRole('button', { name: t('action.resume') })).toBeInTheDocument();
  });

  it('같은 채널 작업은 이어받기가 있다', async () => {
    auth.status = signedInAs(A1);
    await load([job(1, { status: 'interrupted', channelId: A1, title: '내 영상' })]);
    render(JobList);
    const item = screen.getByRole('article', { name: '내 영상' });
    expect(within(item).getByRole('button', { name: t('action.resume') })).toBeInTheDocument();
    expect(within(item).queryByText(t('job.otherChannel.body'))).toBeNull();
  });
});

describe('연결 대기·회복·멈춘 지 30일 행(patterns.md §3.2)', () => {
  const WAIT = prog({ phase: 'waitingNetwork', speedBps: null, etaSecs: null });

  it('연결 대기: 줄무늬 막대·퍼센트 유지, 속도·남은 시간 없음, 본문 한 줄, [일시정지][취소…], 오류 모양 없음', async () => {
    await load([job(1, { title: '끊긴 영상', status: 'running', progress: WAIT })]);
    render(JobList);
    const item = screen.getByRole('article', { name: '끊긴 영상' });
    expect(within(item).getByText(/^연결 대기 중 · 1분째 · /)).toBeInTheDocument();
    expect(within(item).queryByText(/\/s|남음/)).toBeNull();
    expect(within(item).getByText(t('job.waitingNetwork.body'))).toBeInTheDocument();
    expect(within(item).getByRole('progressbar')).toHaveAttribute('data-state', 'waiting');
    expect(item.querySelector('.job-pct')).toHaveTextContent('57%');
    expect(within(item).getByRole('button', { name: t('action.pause') })).toBeInTheDocument();
    expect(within(item).getByRole('button', { name: t('a11y.cancelJob', { title: '끊긴 영상' }) })).toBeInTheDocument();
    // 오류가 아니다: 빨강 톤(role=alert / danger)이 없다
    expect(item.querySelector('.notice.tone-danger, .notice.tone-warning')).toBeNull();
  });

  it('연결 대기에서 풀려 1분 넘겼으면 회복 줄이 뜨고 RECOVERY_NOTICE_MS 뒤 사라진다', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    try {
      await load([job(1, { title: '끊긴 영상', status: 'running', progress: prog() })]);
      render(JobList);
      const item = screen.getByRole('article', { name: '끊긴 영상' });
      send({ type: 'progress', id: 1, progress: WAIT });
      await tick();
      expect(within(item).getByText(t('job.waitingNetwork.body'))).toBeInTheDocument();
      vi.advanceTimersByTime(RECOVERY_SILENT_MS);
      send({ type: 'progress', id: 1, progress: prog() });
      await tick();
      expect(within(item).queryByText(t('job.waitingNetwork.body'))).toBeNull();
      expect(within(item).getByText(t('job.recovered.body'))).toBeInTheDocument();
      vi.advanceTimersByTime(RECOVERY_NOTICE_MS);
      await tick();
      expect(within(item).queryByText(t('job.recovered.body'))).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('멈춘 지 30일 넘은 일시정지·실패 행에 본문 줄, 29일은 없다', async () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    await load([
      job(1, { title: '오래 멈춘 영상', status: 'paused', partialBytes: 5_000_000, stoppedAt: nowSecs - 31 * 86400 }),
      job(2, { title: '얼마 안 된 영상', status: 'paused', partialBytes: 5_000_000, stoppedAt: nowSecs - 29 * 86400 }),
      job(3, { title: '오래 전에 실패한 영상', status: 'failed', error: err('network', { resumable: true }), partialBytes: 5_000_000, stoppedAt: nowSecs - 40 * 86400 }),
      job(4, { title: '옛 기록', status: 'paused', partialBytes: 5_000_000, stoppedAt: null }),
    ]);
    render(JobList);
    const sized = formatFileSize(5_000_000, 1000);
    expect(within(screen.getByRole('article', { name: '오래 멈춘 영상' })).getByText(t('job.stale.body', { days: 31, size: sized }))).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: '얼마 안 된 영상' })).queryByText(/전에 멈췄어요/)).toBeNull();
    const failed = within(screen.getByRole('article', { name: '오래 전에 실패한 영상' }));
    expect(failed.getByText(t('job.stale.body', { days: 40, size: sized }))).toBeInTheDocument();
    expect(within(screen.getByRole('article', { name: '옛 기록' })).queryByText(/전에 멈췄어요/)).toBeNull();
  });
});

