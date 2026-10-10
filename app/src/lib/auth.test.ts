import { describe, expect, it } from 'vitest';
import { PENDING_STUCK_REMAINING_SECS, loginScreen, remainingSecs } from './auth';
import type { AuthReason, AuthState, AuthStatusDto } from './bindings';
import { ko, t } from './copy/ko';

const st = (state: AuthState, reason: AuthReason | null = null, channelName: string | null = null): AuthStatusDto => ({
  state,
  reason,
  channelName,
  channelId: null,
  pending: null,
  offline: null,
  verifiedAt: null,
  canReconnect: false,
});

type Row = [
  AuthStatusDto,
  { kind: string; title: string; body: string | null; channelRow?: string; problem: boolean; buttons: [string, string, string][]; help: 'help' | 'link' | null; stuck: boolean },
];

const L = 'login';
const R = 'reconnect';

const rows: Row[] = [
  [st('signedOut'), { kind: 'message', title: ko['auth.signedOut.title'], body: ko['auth.intro'], problem: false, buttons: [[L, ko['auth.login'], 'primary']], help: null, stuck: false }],
  [st('checking'), { kind: 'checking', title: ko['auth.checking'], body: t('auth.checking.body', { secs: 40 }), problem: false, buttons: [[L, ko['auth.relogin'], 'link']], help: null, stuck: false }],
  [{ ...st('pending'), pending: { expiresAt: 1 } }, { kind: 'pending', title: ko['auth.pending.title'], body: null, problem: false, buttons: [], help: 'help', stuck: true }],
  // 기한 없는 pending: 버튼 없는 화면이 되지 않게 [다시 로그인]
  [st('pending'), { kind: 'message', title: ko['auth.unknown.title'], body: ko['auth.unknown.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('denied', 'removedFromAllowlist', '테스트 채널'), { kind: 'message', title: ko['auth.removed.title'], body: ko['auth.removed.body'], channelRow: `${ko['auth.channelLabel']}: ‘테스트 채널’`, problem: true, buttons: [[L, ko['action.retry'], 'primary']], help: 'link', stuck: false }],
  [st('denied', 'removedFromAllowlist'), { kind: 'message', title: ko['auth.removed.title'], body: ko['auth.removed.body'], problem: true, buttons: [[L, ko['action.retry'], 'primary']], help: 'link', stuck: false }],
  [st('denied', null, '테스트 채널'), { kind: 'message', title: ko['auth.denied.title'], body: ko['auth.denied.body'], channelRow: `${ko['auth.channelLabel']}: ‘테스트 채널’`, problem: true, buttons: [[L, ko['action.retry'], 'primary']], help: 'link', stuck: false }],
  [st('denied'), { kind: 'message', title: ko['auth.denied.title'], body: ko['auth.denied.body'], problem: true, buttons: [[L, ko['action.retry'], 'primary']], help: 'link', stuck: false }],
  [st('expired', 'loginTimeout'), { kind: 'message', title: ko['auth.loginTimeout.title'], body: t('auth.loginTimeout.body', { mins: 10 }), problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('expired', 'revoked'), { kind: 'message', title: ko['auth.revoked.title'], body: ko['auth.revoked.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('expired', 'reuseDetected'), { kind: 'message', title: ko['auth.revoked.title'], body: ko['auth.reuse.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('expired', 'graceExpired'), { kind: 'message', title: ko['auth.graceExpired.title'], body: ko['auth.graceExpired.body'], problem: true, buttons: [[R, ko['auth.reconnect'], 'primary'], [L, ko['auth.relogin'], 'secondary']], help: null, stuck: false }],
  [st('expired', 'sessionExpired'), { kind: 'message', title: ko['auth.sessionExpired.title'], body: ko['auth.relogin.help'], problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('expired'), { kind: 'message', title: ko['auth.sessionExpired.title'], body: ko['auth.relogin.help'], problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('cancelled'), { kind: 'message', title: ko['auth.cancelled.title'], body: null, problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('error', 'network'), { kind: 'message', title: ko['auth.network.title'], body: ko['auth.network.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('error', 'loginLost'), { kind: 'message', title: ko['auth.lost.title'], body: ko['auth.relogin.help'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('error', 'receiver'), { kind: 'message', title: ko['auth.receiver.title'], body: ko['auth.receiver.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('error', 'server'), { kind: 'message', title: ko['auth.server.title'], body: ko['auth.server.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
  [st('error'), { kind: 'message', title: ko['auth.unknown.title'], body: ko['auth.unknown.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null, stuck: false }],
];

describe('loginScreen 표', () => {
  it.each(rows)('%j', (status, want) => {
    const s = loginScreen(status, 0);
    expect(s).not.toBeNull();
    expect({
      kind: s!.kind,
      title: s!.title,
      body: s!.body,
      channelRow: s!.channelRow ?? undefined,
      problem: s!.problem,
      buttons: s!.buttons.map((b) => [b.action, b.label, b.variant]),
      help: s!.otherAccount,
      stuck: s!.stuck,
    }).toEqual(want);
  });

  it('저장 세션이 있으면(canReconnect) 메시지 화면에 [다시 연결]을 붙인다', () => {
    const buttons = (status: AuthStatusDto) => loginScreen({ ...status, canReconnect: true })!.buttons.map((b) => [b.action, b.label, b.variant]);
    const both = [[L, ko['auth.relogin'], 'primary'], ['reconnect', ko['auth.reconnect'], 'secondary']];
    for (const status of [st('expired', 'loginTimeout'), st('error', 'network'), st('error'), st('denied'), st('cancelled')]) {
      expect(buttons(status)).toEqual(status.state === 'denied' ? [[L, ko['action.retry'], 'primary'], both[1]] : both);
      // 세션이 없으면 그대로 하나
      expect(loginScreen({ ...status, canReconnect: false })!.buttons).toHaveLength(1);
    }
  });

  it('유예 만료는 [다시 연결]이 이미 있어 중복하지 않는다', () => {
    const s = loginScreen({ ...st('expired', 'graceExpired'), canReconnect: true })!;
    expect(s.buttons.filter((b) => b.action === 'reconnect')).toHaveLength(1);
  });

  it('pending·checking은 그대로다', () => {
    const p = { ...st('pending'), pending: { expiresAt: 1 }, canReconnect: true };
    expect(loginScreen(p)!.buttons).toEqual([]);
    expect(loginScreen({ ...st('checking'), canReconnect: true })!.buttons.map((b) => b.action)).toEqual([L]);
  });

  it('disabled·signedIn은 화면이 없다', () => {
    expect(loginScreen(st('disabled'))).toBeNull();
    expect(loginScreen(st('signedIn'))).toBeNull();
  });

  it('세션 만료·서버 문구는 원인을 단정하지 않는다(401 invalid_token도 같은 화면, Worker 형식 4xx도 server)', () => {
    for (const k of ['auth.sessionExpired.title', 'auth.relogin.help'] as const) {
      expect(ko[k]).not.toMatch(/오래|30일|60일/);
    }
    for (const k of ['auth.server.title', 'auth.server.body'] as const) {
      expect(ko[k]).not.toMatch(/문제|고장|오류/);
    }
  });

  it('revoked 문구는 원인을 단정하지 않는다(관리자 탓으로 읽히지 않게)', () => {
    for (const k of ['auth.revoked.title', 'auth.revoked.body', 'auth.reuse.body'] as const) {
      expect(ko[k]).not.toContain('관리자');
    }
  });
});

describe('stuck 경계', () => {
  it('남은 511초는 false, 510초는 true, pending이 아니면 늘 false', () => {
    expect(PENDING_STUCK_REMAINING_SECS).toBe(510);
    const p = { ...st('pending'), pending: { expiresAt: 1000 } };
    expect(loginScreen(p, (1000 - 511) * 1000)!.stuck).toBe(false);
    expect(loginScreen(p, (1000 - 510) * 1000)!.stuck).toBe(true);
    expect(loginScreen(st('signedOut'), 0)!.stuck).toBe(false);
  });
});

describe('remainingSecs', () => {
  it('유닉스 초 기한까지 남은 초(0 이상, 소수 ms는 내림)', () => {
    expect(remainingSecs(1600, 1_000_000)).toBe(600);
    expect(remainingSecs(1600, 1_000_999)).toBe(600);
    expect(remainingSecs(1600, 1_001_000)).toBe(599);
    expect(remainingSecs(1000, 2_000_000)).toBe(0);
  });
});
