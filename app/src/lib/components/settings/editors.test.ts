import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, EditorDto, EditorsDto } from '../../bindings';
import { signedInAs } from '../../../test/jobFixtures';
import { t } from '../../copy/ko';
import { dayText } from '../../when';
import { COPIED_LABEL_MS } from '../../timing';

vi.mock('../../api', () => ({
  editorsList: vi.fn(),
  editorsInvite: vi.fn(),
  editorsRemove: vi.fn(),
  delegationsLeave: vi.fn(),
}));

const api = await import('../../api');
const { editors } = await import('../../stores/editors.svelte');
const { auth } = await import('../../stores/auth.svelte');
const { toasts } = await import('../../stores/toast.svelte');
const { default: AccountSection } = await import('./AccountSection.svelte');

const A = 'a'.repeat(31) + '1';
const B = 'b'.repeat(31) + '2';
const C = 'c'.repeat(31) + '3';
const D = 'd'.repeat(31) + '4';
const SINCE = 1_760_000_000;

const ed = (channelId: string, channelName: string, status: EditorDto['status'] = 'active'): EditorDto => ({
  channelId,
  channelName,
  since: SINCE,
  status,
});

function list(over: Partial<EditorsDto> = {}): EditorsDto {
  return { editors: [], delegatedChannels: [], pendingInviteUntil: null, editorsMax: 10, delegationsMax: 20, ...over };
}

const appError = (code: AppError['code']): AppError => ({ code, message: code, stage: null, resumable: false, payload: null });

function signIn(over: Parameters<typeof Object.assign>[1] = {}) {
  auth.apply({ ...signedInAs(A), ...over });
  editors.onAuth(auth.status);
}

async function show(d: EditorsDto = list()) {
  vi.mocked(api.editorsList).mockResolvedValue(d);
  const view = render(AccountSection);
  await waitFor(() => expect(editors.load).toBe('ready'));
  return view;
}

const makeButton = () => screen.getByRole('button', { name: t('editors.invite.make') });
const helpOf = (el: HTMLElement) => el.getAttribute('aria-describedby');

beforeEach(() => {
  for (const f of Object.values(api)) vi.mocked(f as () => unknown).mockReset();
  vi.mocked(api.editorsRemove).mockResolvedValue();
  vi.mocked(api.delegationsLeave).mockResolvedValue();
  toasts.clear();
  auth.reset();
  editors.reset();
  signIn();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('편집자 머리 행', () => {
  it('EV1 편집자가 없으면 도움말과 누를 수 있는 버튼', async () => {
    await show();
    expect(screen.getByText(t('editors.title'))).toBeInTheDocument();
    expect(screen.getByText(t('editors.empty'))).toBeInTheDocument();
    expect(makeButton()).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(t('delegated.title'))).toBeNull();
  });

  it('EV2 기다리는 초대가 있으면 기한을 말한다', async () => {
    const until = Math.floor(Date.now() / 1000) + 5 * 86400;
    await show(list({ pendingInviteUntil: until }));
    expect(screen.getByText(t('editors.pending', { date: dayText(until, Date.now()) }))).toBeInTheDocument();
  });

  it('EV3 편집자 행: 이름은 <bdi> 안, 도움말은 부터/기다리는 중, 버튼 이름에 편집자 이름', async () => {
    await show(list({ editors: [ed(B, '편집자 하나'), ed(D, '편집자 둘', 'pending')] }));
    const one = document.querySelector(`[data-editor="${B}"]`) as HTMLElement;
    const two = document.querySelector(`[data-editor="${D}"]`) as HTMLElement;
    expect(one.querySelector('bdi')).toHaveTextContent('편집자 하나');
    expect(within(one).getByText(t('editors.since', { date: dayText(SINCE, Date.now()) }))).toBeInTheDocument();
    expect(within(two).getByText(t('editors.waiting', { date: dayText(SINCE, Date.now()) }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) })).toBeInTheDocument();
    // 편집자가 있으면 머리 행 도움말이 안내 문장
    expect(screen.getByText(t('editors.help'))).toBeInTheDocument();
  });

  it('EV4 상한이면 버튼이 aria-disabled이고 이유를 읽는다', async () => {
    const full = Array.from({ length: 10 }, (_, i) => ed(`e${i}`.padEnd(32, '0'), `편집자${i}`));
    await show(list({ editors: full }));
    const b = makeButton();
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b).toHaveAccessibleDescription(t('editors.limit', { n: 10 }));
  });

  it('EV5 오프라인이면 묻지 않고 버튼 셋이 모두 aria-disabled', async () => {
    signIn({ offline: { since: 1, graceUntil: 2 }, delegatedChannels: [{ channelId: C, channelName: '맡긴 채널' }] });
    vi.mocked(api.editorsList).mockResolvedValue(list());
    render(AccountSection);
    expect(api.editorsList).not.toHaveBeenCalled();
    const b = makeButton();
    expect(b).toHaveAttribute('aria-disabled', 'true');
    expect(b).toHaveAccessibleDescription(t('editors.offline'));
    expect(screen.getByRole('button', { name: t('a11y.leaveDelegation', { name: '맡긴 채널' }) })).toHaveAttribute('aria-disabled', 'true');
  });

  it('오프라인에서 [편집자 빼기]도 aria-disabled(Z11)', async () => {
    await show(list({ editors: [ed(B, '편집자 하나')] }));
    signIn({ offline: { since: 1, graceUntil: 2 } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) })).toHaveAttribute('aria-disabled', 'true'),
    );
  });

  it('처음 읽기가 실패하면 안내 문장', async () => {
    vi.mocked(api.editorsList).mockRejectedValue(appError('network'));
    render(AccountSection);
    expect(await screen.findByText(t('editors.loadFailed'))).toBeInTheDocument();
    expect(makeButton()).not.toHaveAttribute('aria-disabled');
  });
});

describe('초대 주소', () => {
  it('EV6 만들면 읽기 전용 칸에 주소가 나오고 [주소 복사]는 라벨이 잠깐 바뀐다', async () => {
    await show();
    const url = 'https://w.example.invalid/invite/cdi_testtoken';
    vi.mocked(api.editorsInvite).mockResolvedValue({ url, expiresAt: Math.floor(Date.now() / 1000) + 7 * 86400 });
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(makeButton());
    const field = await screen.findByLabelText(t('editors.invite.label'));
    expect(field).toHaveValue(url);
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAccessibleDescription(t('editors.invite.help', { days: 7 }));
    // 두 라벨을 같은 칸에 겹쳐 폭을 지키고, 보이지 않는 쪽은 .off(visibility: hidden)다
    const label = (key: 'action.copyUrl' | 'action.copied') => screen.getByText(t(key));
    expect(label('action.copied')).toHaveClass('off');
    expect(label('action.copyUrl')).not.toHaveClass('off');
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.click(label('action.copyUrl'));
    expect(writeText).toHaveBeenCalledWith(url);
    await waitFor(() => expect(label('action.copyUrl')).toHaveClass('off'));
    expect(label('action.copied')).not.toHaveClass('off');
    await vi.advanceTimersByTimeAsync(COPIED_LABEL_MS + 50);
    expect(label('action.copied')).toHaveClass('off');
    expect(toasts.items).toHaveLength(0);
  });

  it('EV7 만들기 실패는 그 행 안에 alert 하나', async () => {
    await show();
    vi.mocked(api.editorsInvite).mockRejectedValue(appError('network'));
    await userEvent.setup().click(makeButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('editors.invite.failed'));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});

describe('빼기·그만두기', () => {
  it('EV8 [편집자 빼기] 뒤 행이 사라지고 포커스는 다음 편집자의 버튼으로 간다', async () => {
    await show(list({ editors: [ed(B, '편집자 하나'), ed(D, '편집자 둘')] }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) }));
    expect(document.querySelector(`[data-editor="${B}"]`)).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 둘' }) })).toHaveFocus(),
    );
    expect(toasts.current?.action?.label).toBe(t('action.undo'));
  });

  it('EV8 마지막 편집자를 빼면 포커스는 [초대 주소 만들기]로 간다', async () => {
    await show(list({ editors: [ed(B, '편집자 하나')] }));
    await userEvent.setup().click(screen.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) }));
    await waitFor(() => expect(makeButton()).toHaveFocus());
  });

  it('EV9 맡은 채널이 없으면 머리 행이 없고, 있으면 머리 행과 채널 행이 있다', async () => {
    await show();
    expect(screen.queryByText(t('delegated.title'))).toBeNull();
  });

  it('EV9 [편집자 그만두기]는 보내고 토스트를 띄운다', async () => {
    await show(list({ delegatedChannels: [{ channelId: C, channelName: '맡긴 채널', since: SINCE }] }));
    signIn({ delegatedChannels: [{ channelId: C, channelName: '맡긴 채널' }] });
    expect(screen.getByText(t('delegated.title'))).toBeInTheDocument();
    expect(screen.getByText(t('delegated.help'))).toBeInTheDocument();
    const row = document.querySelector(`[data-delegated="${C}"]`) as HTMLElement;
    expect(within(row).getByText(t('editors.since', { date: dayText(SINCE, Date.now()) }))).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: t('a11y.leaveDelegation', { name: '맡긴 채널' }) }));
    await waitFor(() => expect(api.delegationsLeave).toHaveBeenCalledWith(C));
    await waitFor(() => expect(toasts.current?.message).toBe(t('toast.delegationLeft', { name: '맡긴 채널' })));
    await waitFor(() => expect(document.querySelector(`[data-delegated="${C}"]`)).toBeNull());
  });

  it('EV10 값이 auth에서 온 맡은 채널 행은 날짜 줄이 없다', async () => {
    signIn({ delegatedChannels: [{ channelId: C, channelName: '맡긴 채널' }] });
    vi.mocked(api.editorsList).mockRejectedValue(appError('network'));
    render(AccountSection);
    await waitFor(() => expect(editors.load).toBe('failed'));
    const row = document.querySelector(`[data-delegated="${C}"]`) as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.querySelector('.row-help')).toBeNull();
  });

  it('EV11 편집자 이름의 방향 제어 문자는 화면에 남지 않는다', async () => {
    await show(list({ editors: [ed(B, '‮편집자')] }));
    const row = document.querySelector(`[data-editor="${B}"]`) as HTMLElement;
    expect(row.querySelector('bdi')!.textContent).toBe('편집자');
  });

  it('빼기 실패는 행 안에 alert', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await show(list({ editors: [ed(B, '편집자 하나')] }));
    vi.mocked(api.editorsRemove).mockRejectedValue(appError('network'));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) }),
    );
    await vi.advanceTimersByTimeAsync(7000);
    const row = document.querySelector(`[data-editor="${B}"]`) as HTMLElement;
    expect(await within(row).findByRole('alert')).toHaveTextContent(t('editors.remove.failed'));
    expect(helpOf(makeButton())).toBeTruthy();
  });
});

describe('화면 수명·포커스(EV12~EV15, 리뷰 반영)', () => {
  function held<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((res) => (resolve = res));
    return { promise, resolve };
  }

  it('EV12 다시 만든 주소에는 앞 주소의 [복사했어요]가 남지 않는다', async () => {
    await show();
    const exp = Math.floor(Date.now() / 1000) + 7 * 86400;
    vi.mocked(api.editorsInvite).mockResolvedValueOnce({ url: 'https://w.example.invalid/invite/cdi_one', expiresAt: exp });
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(makeButton());
    await screen.findByLabelText(t('editors.invite.label'));
    const label = (key: 'action.copyUrl' | 'action.copied') => screen.getByText(t(key));
    await user.click(label('action.copyUrl'));
    await waitFor(() => expect(label('action.copied')).not.toHaveClass('off'));
    vi.mocked(api.editorsInvite).mockResolvedValueOnce({ url: 'https://w.example.invalid/invite/cdi_two', expiresAt: exp });
    await user.click(makeButton());
    await waitFor(() => expect(screen.getByLabelText(t('editors.invite.label'))).toHaveValue('https://w.example.invalid/invite/cdi_two'));
    expect(label('action.copied')).toHaveClass('off');
    expect(label('action.copyUrl')).not.toHaveClass('off');
  });

  it('EV13 그만두기 응답 전에 포커스를 옮겼으면 성공 뒤에 빼앗지 않는다', async () => {
    const X = 'e'.repeat(31) + '5';
    await show(
      list({
        delegatedChannels: [
          { channelId: C, channelName: '채널 엑스', since: SINCE },
          { channelId: X, channelName: '채널 와이', since: SINCE },
        ],
      }),
    );
    const h = held<void>();
    vi.mocked(api.delegationsLeave).mockReturnValueOnce(h.promise);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: t('a11y.leaveDelegation', { name: '채널 엑스' }) }));
    makeButton().focus(); // Tab으로 다른 곳에 갔다
    h.resolve();
    await waitFor(() => expect(document.querySelector(`[data-delegated="${C}"]`)).toBeNull());
    await tickAll();
    expect(makeButton()).toHaveFocus();
  });

  it('EV13 포커스가 사라진 행에 남아 body로 떨어졌으면 다음 행으로 옮긴다', async () => {
    const X = 'e'.repeat(31) + '5';
    await show(
      list({
        delegatedChannels: [
          { channelId: C, channelName: '채널 엑스', since: SINCE },
          { channelId: X, channelName: '채널 와이', since: SINCE },
        ],
      }),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: t('a11y.leaveDelegation', { name: '채널 엑스' }) }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: t('a11y.leaveDelegation', { name: '채널 와이' }) })).toHaveFocus(),
    );
  });

  it('EV14 기다리는 편집자 빼기도 응답 전에 옮긴 포커스를 빼앗지 않는다', async () => {
    await show(list({ editors: [ed(B, '편집자 하나', 'pending'), ed(D, '편집자 둘')] }));
    const h = held<void>();
    vi.mocked(api.editorsRemove).mockReturnValueOnce(h.promise);
    await userEvent.setup().click(screen.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) }));
    makeButton().focus();
    h.resolve();
    await waitFor(() => expect(document.querySelector(`[data-editor="${B}"]`)).toBeNull());
    await tickAll();
    expect(makeButton()).toHaveFocus();
  });

  it('EV15 설정을 떠난 뒤 실패한 지연 빼기는 다시 들어오면 그 행 안에 alert', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const view = await show(list({ editors: [ed(B, '편집자 하나')] }));
    vi.mocked(api.editorsRemove).mockRejectedValue(appError('network'));
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(
      screen.getByRole('button', { name: t('a11y.removeEditor', { name: '편집자 하나' }) }),
    );
    view.unmount(); // 홈으로
    await vi.advanceTimersByTimeAsync(7000);
    expect(api.editorsRemove).toHaveBeenCalledWith(B);
    await show(list({ editors: [ed(B, '편집자 하나')] }));
    const row = document.querySelector(`[data-editor="${B}"]`) as HTMLElement;
    expect(within(row).getByRole('alert')).toHaveTextContent(t('editors.remove.failed'));
  });
});

async function tickAll() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}
