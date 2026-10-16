import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError, EditorDto, EditorsDto } from '../bindings';
import { signedInAs } from '../../test/jobFixtures';
import { t } from '../copy/ko';
import { TOAST_MS } from '../timing';

vi.mock('../api', () => ({
  editorsList: vi.fn(),
  editorsInvite: vi.fn(),
  editorsRemove: vi.fn(),
  delegationsLeave: vi.fn(),
}));

const api = await import('../api');
const { editors } = await import('./editors.svelte');
const { auth } = await import('./auth.svelte');
const { toasts } = await import('./toast.svelte');

const A = 'a'.repeat(31) + '1';
const B = 'b'.repeat(31) + '2';
const C = 'c'.repeat(31) + '3';
const D = 'd'.repeat(31) + '4';

const ed = (channelId: string, channelName: string, status: EditorDto['status'] = 'active'): EditorDto => ({
  channelId,
  channelName,
  since: 1_760_000_000,
  status,
});

function list(over: Partial<EditorsDto> = {}): EditorsDto {
  return {
    editors: [ed(B, '편집자 하나'), ed(D, '편집자 둘')],
    delegatedChannels: [{ channelId: C, channelName: '맡긴 채널', since: 1_760_000_000 }],
    pendingInviteUntil: null,
    editorsMax: 10,
    delegationsMax: 20,
    ...over,
  };
}

const appError = (code: AppError['code']): AppError => ({ code, message: code, stage: null, resumable: false, payload: null });

function signIn(id: string) {
  auth.apply(signedInAs(id));
  editors.onAuth(auth.status);
}

async function open(d: EditorsDto = list()) {
  vi.mocked(api.editorsList).mockResolvedValue(d);
  await editors.openView();
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of Object.values(api)) vi.mocked(f as () => unknown).mockReset();
  vi.mocked(api.editorsRemove).mockResolvedValue();
  vi.mocked(api.delegationsLeave).mockResolvedValue();
  toasts.clear();
  auth.reset();
  editors.reset();
  signIn(A);
});

afterEach(() => {
  toasts.clear();
  vi.useRealTimers();
});

describe('지연 빼기(EZ1~EZ4)', () => {
  it('EZ1 토스트가 사는 동안은 숨기기만 하고 닫힐 때 보낸다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    expect(editors.hidden.has(B)).toBe(true);
    expect(editors.editors.map((e) => e.channelId)).toEqual([D]);
    expect(api.editorsRemove).not.toHaveBeenCalled();
    expect(toasts.current?.message).toBe(t('toast.editorRemoved', { name: '편집자 하나' }));
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(api.editorsRemove).toHaveBeenCalledTimes(1);
    expect(api.editorsRemove).toHaveBeenCalledWith(B);
    expect(editors.dto!.editors.map((e) => e.channelId)).toEqual([D]);
    expect(editors.hidden.has(B)).toBe(false);
  });

  it('EZ2 [되돌리기]면 행이 돌아오고 보내지 않는다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    toasts.runAction(toasts.current!.id);
    expect(editors.hidden.size).toBe(0);
    await vi.advanceTimersByTimeAsync(TOAST_MS * 3);
    expect(api.editorsRemove).not.toHaveBeenCalled();
    expect(editors.editors).toHaveLength(2);
  });

  it('EZ3 [×]로 닫아도 보낸다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    toasts.dismiss(toasts.current!.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.editorsRemove).toHaveBeenCalledTimes(1);
  });

  it('EZ4 둘째 빼기는 첫 토스트가 닫힌 뒤에 순서대로 보인다', async () => {
    await open();
    const [first, second] = editors.editors;
    editors.remove(first);
    editors.remove(second);
    expect(api.editorsRemove).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(api.editorsRemove).toHaveBeenCalledTimes(1);
    expect(api.editorsRemove).toHaveBeenLastCalledWith(B);
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(api.editorsRemove).toHaveBeenCalledTimes(2);
    expect(api.editorsRemove).toHaveBeenLastCalledWith(D);
  });

  it('EZ10 기다리는(pending) 편집자는 되돌리기 없이 곧바로 보낸다', async () => {
    await open(list({ editors: [ed(B, '편집자 하나', 'pending')] }));
    editors.remove(editors.editors[0]);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.editorsRemove).toHaveBeenCalledTimes(1);
    expect(api.editorsRemove).toHaveBeenCalledWith(B);
    expect(toasts.current?.action).toBeUndefined();
    expect(editors.dto!.editors).toHaveLength(0);
  });
});

describe('계정이 바뀌면(Z1, EZ5~EZ8)', () => {
  it('EZ5 다른 계정으로 바뀌면 토스트를 닫고 보내지 않는다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    signIn(C);
    expect(toasts.items).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TOAST_MS * 3);
    expect(api.editorsRemove).not.toHaveBeenCalled();
    expect(editors.dto).toBeNull();
    expect(editors.hidden.size).toBe(0);
  });

  it('EZ6 로그아웃도 같다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    auth.apply({ ...signedInAs(null), state: 'signedOut', channelName: null });
    editors.onAuth(auth.status);
    expect(toasts.items).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(TOAST_MS * 3);
    expect(api.editorsRemove).not.toHaveBeenCalled();
  });

  it('EZ7 checking은 지나가는 상태라 취소하지 않는다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    auth.apply({ ...signedInAs(null), state: 'checking', channelName: null });
    editors.onAuth(auth.status);
    expect(toasts.items).toHaveLength(1);
    signIn(A);
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(api.editorsRemove).toHaveBeenCalledTimes(1);
  });

  it('EZ8 이벤트를 놓쳐도 보내기 직전에 다시 보고 보내지 않는다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    auth.apply(signedInAs(C)); // onAuth를 부르지 않는다(웹뷰가 아직 이벤트를 못 받은 창)
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(api.editorsRemove).not.toHaveBeenCalled();
    expect(editors.hidden.has(B)).toBe(false);
  });
});

describe('checking 중에 토스트가 끝나면(EZ16·EZ17)', () => {
  const checking = () => {
    auth.apply({ ...signedInAs(null), state: 'checking', channelName: null });
    editors.onAuth(auth.status);
  };

  it('EZ16 보내기를 미뤘다가 같은 계정으로 돌아오면 보낸다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    checking();
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(api.editorsRemove).not.toHaveBeenCalled();
    expect(editors.hidden.has(B)).toBe(true); // 아직 빠진 것으로 보인다
    signIn(A);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.editorsRemove).toHaveBeenCalledTimes(1);
    expect(api.editorsRemove).toHaveBeenCalledWith(B);
    expect(editors.editors.map((e) => e.channelId)).toEqual([D]);
  });

  it('EZ17 미룬 사이 다른 계정이 되면 보내지 않는다', async () => {
    await open();
    editors.remove(editors.editors[0]);
    checking();
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    signIn(C);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.editorsRemove).not.toHaveBeenCalled();
    expect(editors.hidden.size).toBe(0);
  });
});

describe('실패 줄(EZ9·EZ11)', () => {
  it('EZ9 빼기 실패면 행이 돌아오고 실패 줄이 선다', async () => {
    await open();
    vi.mocked(api.editorsRemove).mockRejectedValue(appError('network'));
    editors.remove(editors.editors[0]);
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(editors.hidden.has(B)).toBe(false);
    expect(editors.rowError.get(B)).toBe(t('editors.remove.failed'));
    expect(editors.editors).toHaveLength(2);
  });

  it('EZ9 unsupported면 아직 쓸 수 없음 한 줄', async () => {
    await open();
    vi.mocked(api.editorsRemove).mockRejectedValue(appError('unsupported'));
    editors.remove(editors.editors[0]);
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    expect(editors.rowError.get(B)).toBe(t('editors.notReady'));
  });

  it('EZ11 초대 주소: 성공하면 주소를 쥐고 기한을 갱신한다', async () => {
    await open();
    vi.mocked(api.editorsInvite).mockResolvedValue({ url: 'https://w.example.invalid/invite/cdi_x', expiresAt: 1_760_600_000 });
    await editors.createInvite();
    expect(editors.invite?.url).toContain('/invite/');
    expect(editors.dto!.pendingInviteUntil).toBe(1_760_600_000);
    expect(editors.inviteError).toBeNull();
  });

  it('EZ11 초대 주소: 409면 상한 문구, unsupported면 준비 중 문구, 그 밖은 일반 실패', async () => {
    await open(list({ editorsMax: 7 }));
    vi.mocked(api.editorsInvite).mockRejectedValue(appError('invalidInput'));
    await editors.createInvite();
    expect(editors.inviteError).toBe(t('editors.limit', { n: 7 }));
    vi.mocked(api.editorsInvite).mockRejectedValue(appError('unsupported'));
    await editors.createInvite();
    expect(editors.inviteError).toBe(t('editors.notReady'));
    vi.mocked(api.editorsInvite).mockRejectedValue(appError('network'));
    await editors.createInvite();
    expect(editors.inviteError).toBe(t('editors.invite.failed'));
    expect(editors.invite).toBeNull();
  });
});

describe('읽기·그만두기·닫기', () => {
  it('EZ12 오프라인이면 묻지 않는다', async () => {
    auth.apply({ ...signedInAs(A), offline: { since: 1, graceUntil: 2 } });
    editors.onAuth(auth.status);
    await open();
    expect(api.editorsList).not.toHaveBeenCalled();
  });

  it('EZ13 계정이 바뀐 뒤 늦게 온 목록은 버린다', async () => {
    let resolve!: (d: EditorsDto) => void;
    vi.mocked(api.editorsList).mockReturnValue(new Promise((r) => (resolve = r)));
    const p = editors.openView();
    signIn(C);
    resolve(list());
    await p;
    expect(editors.dto).toBeNull();
  });

  it('EZ18 onAuth보다 먼저 열려도 지금 계정으로 읽어 버리지 않는다', async () => {
    await open();
    auth.apply(signedInAs(C)); // App effect(onAuth)가 아직 돌지 않았다
    vi.mocked(api.editorsList).mockResolvedValue(list({ editors: [] }));
    await editors.openView();
    editors.onAuth(auth.status); // 그 뒤에 App effect가 돈다
    expect(editors.load).toBe('ready');
    expect(editors.dto?.editors).toEqual([]);
  });

  it('처음 읽기가 실패하면 failed, 값이 있으면 그대로 둔다', async () => {
    vi.mocked(api.editorsList).mockRejectedValue(appError('network'));
    await editors.openView();
    expect(editors.load).toBe('failed');
    await open();
    expect(editors.load).toBe('ready');
    vi.mocked(api.editorsList).mockRejectedValue(appError('network'));
    await editors.openView();
    expect(editors.load).toBe('ready');
    expect(editors.dto).not.toBeNull();
  });

  it('EZ14 그만두기: 성공하면 토스트와 함께 목록에서 빠지고, 실패하면 줄이 선다', async () => {
    await open();
    await editors.leave(editors.dto!.delegatedChannels[0]);
    expect(api.delegationsLeave).toHaveBeenCalledWith(C);
    expect(editors.dto!.delegatedChannels).toHaveLength(0);
    expect(toasts.current?.message).toBe(t('toast.delegationLeft', { name: '맡긴 채널' }));

    await open();
    vi.mocked(api.delegationsLeave).mockRejectedValue(appError('network'));
    await editors.leave(editors.dto!.delegatedChannels[0]);
    expect(editors.leaveError.get(C)).toBe(t('delegated.leave.failed'));
    expect(editors.dto!.delegatedChannels).toHaveLength(1);
  });

  it('EZ15 closeView는 주소를 비운다', async () => {
    await open();
    vi.mocked(api.editorsInvite).mockResolvedValue({ url: 'https://w.example.invalid/invite/cdi_x', expiresAt: 1 });
    await editors.createInvite();
    editors.closeView();
    expect(editors.invite).toBeNull();
  });

  it('토스트의 이름은 위생 처리와 40자 절단을 거친다', async () => {
    await open(list({ editors: [ed(B, '‮' + '가'.repeat(60))] }));
    editors.remove(editors.editors[0]);
    expect(toasts.current?.message).toBe(t('toast.editorRemoved', { name: '가'.repeat(39) + '…' }));
  });
});

describe('화면 수명과 늦은 응답(EZ19~EZ22, 리뷰 반영)', () => {
  function held<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('EZ19 설정을 떠난 뒤 실패한 지연 빼기는 다음 설정 진입에 그 행의 실패 줄로 보인다', async () => {
    await open();
    vi.mocked(api.editorsRemove).mockRejectedValue(appError('network'));
    editors.remove(editors.editors[0]);
    editors.closeView(); // 홈으로 돌아갔다(토스트는 화면 밖에서도 산다)
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10);
    vi.mocked(api.editorsList).mockResolvedValue(list());
    const p = editors.openView();
    expect(editors.rowError.get(B)).toBe(t('editors.remove.failed'));
    await p;
    expect(editors.rowError.get(B)).toBe(t('editors.remove.failed'));
    expect(editors.editors.map((e) => e.channelId)).toEqual([B, D]);
    // 다시 닫으면 비운다(본 뒤에는 남기지 않는다)
    editors.closeView();
    expect(editors.rowError.size).toBe(0);
  });

  it('EZ20 설정이 닫힌 뒤 도착한 초대 응답은 주소를 되살리지 않는다', async () => {
    await open();
    const h = held<{ url: string; expiresAt: number }>();
    vi.mocked(api.editorsInvite).mockReturnValue(h.promise);
    const p = editors.createInvite();
    editors.closeView();
    expect(editors.inviting).toBe(false);
    h.resolve({ url: 'https://w.example.invalid/invite/cdi_old', expiresAt: 1_760_600_000 });
    await p;
    await open();
    expect(editors.invite).toBeNull();
    expect(editors.inviting).toBe(false);
  });

  it('EZ20 닫힌 뒤의 초대 실패도 버리고, 다시 연 화면의 새 요청은 막히지 않는다', async () => {
    await open();
    const h = held<{ url: string; expiresAt: number }>();
    vi.mocked(api.editorsInvite).mockReturnValueOnce(h.promise);
    const p = editors.createInvite();
    editors.closeView();
    await open();
    const h2 = held<{ url: string; expiresAt: number }>();
    vi.mocked(api.editorsInvite).mockReturnValueOnce(h2.promise);
    const p2 = editors.createInvite();
    expect(api.editorsInvite).toHaveBeenCalledTimes(2);
    h.reject(appError('network'));
    await p;
    expect(editors.inviteError).toBeNull();
    expect(editors.inviting).toBe(true); // 앞 요청의 finally가 새 요청의 표시를 끄지 않는다
    h2.resolve({ url: 'https://w.example.invalid/invite/cdi_new', expiresAt: 1_760_600_000 });
    await p2;
    expect(editors.invite?.url).toContain('cdi_new');
    expect(editors.inviting).toBe(false);
  });

  it('EZ21 늦게 도착한 목록이 그 사이 성공한 그만두기를 덮지 않는다', async () => {
    await open();
    const h = held<EditorsDto>();
    vi.mocked(api.editorsList).mockReturnValue(h.promise);
    const p = editors.openView();
    await editors.leave(editors.dto!.delegatedChannels[0]);
    h.resolve(list()); // C가 들어 있는 옛 스냅샷
    await p;
    expect(editors.delegated.map((d) => d.channelId)).toEqual([]);
    expect(editors.load).toBe('ready');
  });

  it('EZ21 늦게 도착한 목록이 그 사이 성공한 지연 빼기·즉시 빼기를 덮지 않는다', async () => {
    await open(list({ editors: [ed(B, '편집자 하나'), ed(D, '편집자 둘', 'pending')] }));
    editors.remove(editors.editors[0]); // B: 지연 빼기
    const h = held<EditorsDto>();
    vi.mocked(api.editorsList).mockReturnValue(h.promise);
    const p = editors.openView();
    await editors.remove(editors.editors.find((e) => e.channelId === D)!); // D: 기다리는 편집자, 즉시
    await vi.advanceTimersByTimeAsync(TOAST_MS + 10); // B 전송 성공
    expect(api.editorsRemove).toHaveBeenCalledTimes(2);
    h.resolve(list({ editors: [ed(B, '편집자 하나'), ed(D, '편집자 둘', 'pending')] }));
    await p;
    expect(editors.editors).toEqual([]);
    // 다음 읽기는 새 목록을 그대로 믿는다(같은 ID가 다시 편집자가 됐을 수 있다)
    await open(list({ editors: [ed(B, '편집자 하나')] }));
    expect(editors.editors.map((e) => e.channelId)).toEqual([B]);
  });

  it('EZ22 auth에서 온 맡은 채널을 그만둔 뒤 목록이 오면 그 채널은 빠지고 load는 ready가 된다', async () => {
    auth.apply({ ...signedInAs(A), delegatedChannels: [{ channelId: C, channelName: '맡긴 채널' }] });
    editors.onAuth(auth.status);
    const h = held<EditorsDto>();
    vi.mocked(api.editorsList).mockReturnValue(h.promise);
    const p = editors.openView();
    expect(editors.dto).toBeNull();
    await editors.leave(editors.delegated[0]);
    h.resolve(list());
    await p;
    expect(editors.load).toBe('ready');
    expect(editors.delegated).toEqual([]);
  });
});
