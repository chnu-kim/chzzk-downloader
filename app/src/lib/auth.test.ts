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
});

type Row = [
  AuthStatusDto,
  { kind: string; title: string; body: string | null; problem: boolean; buttons: [string, string, string][]; help: boolean },
];

const L = 'login';
const R = 'reconnect';

const rows: Row[] = [
  [st('signedOut'), { kind: 'message', title: ko['auth.signedOut.title'], body: ko['auth.intro'], problem: false, buttons: [[L, ko['auth.login'], 'primary']], help: false }],
  [st('checking'), { kind: 'checking', title: ko['auth.checking'], body: ko['auth.checking.body'], problem: false, buttons: [[L, ko['auth.relogin'], 'link']], help: false }],
  [st('pending'), { kind: 'pending', title: ko['auth.pending.title'], body: null, problem: false, buttons: [], help: true }],
  [st('denied', 'removedFromAllowlist', '테스트 채널'), { kind: 'message', title: ko['auth.removed.title'], body: '채널: 테스트 채널. 계속 쓰려면 관리자에게 문의해 주세요.', problem: true, buttons: [[L, ko['auth.otherAccount'], 'primary']], help: true }],
  [st('denied', 'removedFromAllowlist'), { kind: 'message', title: ko['auth.removed.title'], body: ko['auth.removed.bodyNoName'], problem: true, buttons: [[L, ko['auth.otherAccount'], 'primary']], help: true }],
  [st('denied', null, '테스트 채널'), { kind: 'message', title: ko['auth.denied.title'], body: '채널: 테스트 채널. 허가를 받으려면 관리자에게 채널 이름을 알려 주세요.', problem: true, buttons: [[L, ko['auth.otherAccount'], 'primary']], help: true }],
  [st('denied'), { kind: 'message', title: ko['auth.denied.title'], body: ko['auth.denied.bodyNoName'], problem: true, buttons: [[L, ko['auth.otherAccount'], 'primary']], help: true }],
  [st('expired', 'loginTimeout'), { kind: 'message', title: ko['auth.loginTimeout.title'], body: ko['auth.loginTimeout.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('expired', 'revoked'), { kind: 'message', title: ko['auth.revoked.title'], body: ko['auth.revoked.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('expired', 'reuseDetected'), { kind: 'message', title: ko['auth.revoked.title'], body: ko['auth.reuse.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('expired', 'graceExpired'), { kind: 'message', title: ko['auth.graceExpired.title'], body: ko['auth.graceExpired.body'], problem: true, buttons: [[R, ko['auth.reconnect'], 'primary'], [L, ko['auth.relogin'], 'secondary']], help: false }],
  [st('expired', 'sessionExpired'), { kind: 'message', title: ko['auth.sessionExpired.title'], body: ko['auth.sessionExpired.body'], problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('expired'), { kind: 'message', title: ko['auth.sessionExpired.title'], body: ko['auth.sessionExpired.body'], problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('cancelled'), { kind: 'message', title: ko['auth.cancelled.title'], body: null, problem: false, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('error', 'network'), { kind: 'message', title: ko['auth.network.title'], body: ko['auth.network.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('error', 'loginLost'), { kind: 'message', title: ko['auth.lost.title'], body: ko['auth.lost.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('error', 'server'), { kind: 'message', title: ko['auth.server.title'], body: ko['auth.server.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
  [st('error'), { kind: 'message', title: ko['auth.unknown.title'], body: ko['auth.unknown.body'], problem: true, buttons: [[L, ko['auth.relogin'], 'primary']], help: false }],
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
      help: s!.otherAccountHelp,
    }).toEqual(want);
  });

  it('disabled·signedIn은 화면이 없다', () => {
    expect(loginScreen(st('disabled'))).toBeNull();
    expect(loginScreen(st('signedIn'))).toBeNull();
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
