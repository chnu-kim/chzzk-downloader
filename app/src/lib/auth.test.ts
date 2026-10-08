import { describe, expect, it } from 'vitest';
import { loginScreen, remainingSecs } from './auth';
import type { AuthReason, AuthState, AuthStatusDto } from './bindings';
import { ko } from './copy/ko';

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
  { kind: string; title: string; body: string | null; problem: boolean; buttons: [string, string, string][]; help: 'help' | 'link' | null },
];

const L = 'login';
const R = 'reconnect';

const rows: Row[] = [
  [st('signedOut'), { kind: 'message', title: ko['auth.signedOut.title'], body: ko['auth.intro'], problem: false, buttons: [[L, ko['auth.login'], 'primary']], help: null }],
  [st('checking'), { kind: 'checking', title: ko['auth.checking'], body: ko['auth.checking.body'], problem: false, buttons: [[L, ko['auth.relogin'], 'link']], help: null }],
  [{ ...st('pending'), pending: { userCode: 'TEST-CODE', expiresAt: 1 } }, { kind: 'pending', title: ko['auth.pending.title'], body: null, problem: false, buttons: [], help: 'help' }],
  // 코드 없는 pending: 버튼 없는 화면이 되지 않게 [다시 로그인]
  [st('pending'), { kind: 'message', title: ko['auth.unknown.title'], body: ko['auth.unknown.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('denied', 'removedFromAllowlist', '테스트 채널'), { kind: 'message', title: ko['auth.removed.title'], body: '채널: 테스트 채널. 계속 쓰려면 관리자에게 문의해 주세요.', problem: true, buttons: [[L, ko['action.retry'], 'primary']], help: 'link' }],
  [st('denied', 'removedFromAllowlist'), { kind: 'message', title: ko['auth.removed.title'], body: ko['auth.removed.bodyNoName'], problem: true, buttons: [[L, ko['action.retry'], 'primary']], help: 'link' }],
  [st('denied', null, '테스트 채널'), { kind: 'message', title: ko['auth.denied.title'], body: '채널: 테스트 채널. 허가를 받으려면 관리자에게 채널 이름을 알려 주세요.', problem: true, buttons: [[L, ko['action.retry'], 'primary']], help: 'link' }],
  [st('denied'), { kind: 'message', title: ko['auth.denied.title'], body: ko['auth.denied.bodyNoName'], problem: true, buttons: [[L, ko['action.retry'], 'primary']], help: 'link' }],
  [st('expired', 'loginTimeout'), { kind: 'message', title: ko['auth.loginTimeout.title'], body: ko['auth.loginTimeout.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('expired', 'revoked'), { kind: 'message', title: ko['auth.revoked.title'], body: ko['auth.revoked.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('expired', 'reuseDetected'), { kind: 'message', title: ko['auth.revoked.title'], body: ko['auth.reuse.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('expired', 'graceExpired'), { kind: 'message', title: ko['auth.graceExpired.title'], body: ko['auth.graceExpired.body'], problem: true, buttons: [[R, ko['auth.reconnect'], 'primary'], [L, ko['auth.relogin'], 'secondary']], help: null }],
  [st('expired', 'sessionExpired'), { kind: 'message', title: ko['auth.sessionExpired.title'], body: ko['auth.sessionExpired.body'], problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('expired'), { kind: 'message', title: ko['auth.sessionExpired.title'], body: ko['auth.sessionExpired.body'], problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('cancelled'), { kind: 'message', title: ko['auth.cancelled.title'], body: null, problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('error', 'network'), { kind: 'message', title: ko['auth.network.title'], body: ko['auth.network.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('error', 'loginLost'), { kind: 'message', title: ko['auth.lost.title'], body: ko['auth.lost.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('error', 'server'), { kind: 'message', title: ko['auth.server.title'], body: ko['auth.server.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
  [st('error'), { kind: 'message', title: ko['auth.unknown.title'], body: ko['auth.unknown.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: null }],
];

describe('loginScreen 표', () => {
  it.each(rows)('%j', (status, want) => {
    const s = loginScreen(status);
    expect(s).not.toBeNull();
    expect({
      kind: s!.kind,
      title: s!.title,
      body: s!.body,
      problem: s!.problem,
      buttons: s!.buttons.map((b) => [b.action, b.label, b.variant]),
      help: s!.otherAccount,
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
    const p = { ...st('pending'), pending: { userCode: 'K7QX-4MRA', expiresAt: 1 }, canReconnect: true };
    expect(loginScreen(p)!.buttons).toEqual([]);
    expect(loginScreen({ ...st('checking'), canReconnect: true })!.buttons.map((b) => b.action)).toEqual([L]);
  });

  it('disabled·signedIn은 화면이 없다', () => {
    expect(loginScreen(st('disabled'))).toBeNull();
    expect(loginScreen(st('signedIn'))).toBeNull();
  });

  it('세션 만료·서버 문구는 원인을 단정하지 않는다(401 invalid_token도 같은 화면, Worker 형식 4xx도 server)', () => {
    for (const k of ['auth.sessionExpired.title', 'auth.sessionExpired.body'] as const) {
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

describe('remainingSecs', () => {
  it('유닉스 초 기한까지 남은 초(0 이상, 소수 ms는 내림)', () => {
    expect(remainingSecs(1600, 1_000_000)).toBe(600);
    expect(remainingSecs(1600, 1_000_999)).toBe(600);
    expect(remainingSecs(1600, 1_001_000)).toBe(599);
    expect(remainingSecs(1000, 2_000_000)).toBe(0);
  });
});
