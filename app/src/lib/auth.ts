// 로그인 화면의 순수 판단(worker.md 구현 중 변경 62 (나)). 상태·사유 → 제목·설명·버튼 표 하나.
import type { AuthStatusDto } from './bindings';
import { t } from './copy/ko';

/** 로그인 화면의 동작: login → authLogin, reconnect → authRetry */
export type LoginAction = 'login' | 'reconnect';

export interface LoginButton {
  action: LoginAction;
  label: string;
  variant: 'primary' | 'secondary' | 'link';
}

export interface LoginScreen {
  /** 'pending'·'checking'은 LoginView가 따로 그린다(코드·남은 시간·스피너) */
  kind: 'message' | 'pending' | 'checking';
  title: string;
  /** 설명. 없으면 null(pending은 LoginView가 남은 시간을 채워 그린다) */
  body: string | null;
  /** 오류·거부 화면이면 true(경고 아이콘) */
  problem: boolean;
  /** 왼쪽부터 */
  buttons: LoginButton[];
  /** 다른 계정으로 로그인하는 길(네이버 로그아웃) 안내를 보일까 */
  otherAccountHelp: boolean;
}

const login = (key: Parameters<typeof t>[0], variant: LoginButton['variant']): LoginButton => ({
  action: 'login',
  label: t(key),
  variant,
});

function message(
  title: Parameters<typeof t>[0],
  body: string | null,
  problem: boolean,
  buttons: LoginButton[],
  otherAccountHelp = false,
): LoginScreen {
  return { kind: 'message', title: t(title), body, problem, buttons, otherAccountHelp };
}

/** 잠긴 상태(disabled·signedIn이 아닌 상태)의 화면. disabled·signedIn이면 null */
export function loginScreen(s: AuthStatusDto): LoginScreen | null {
  const name = s.channelName;
  switch (s.state) {
    case 'disabled':
    case 'signedIn':
      return null;
    case 'signedOut':
      return message('auth.signedOut.title', t('auth.intro'), false, [login('auth.login', 'primary')]);
    case 'checking':
      return {
        kind: 'checking',
        title: t('auth.checking'),
        body: t('auth.checking.body'),
        problem: false,
        buttons: [login('auth.relogin', 'link')],
        otherAccountHelp: false,
      };
    case 'pending':
      // 코드·기한 없는 pending은 그릴 것이 없다: 버튼 없는 화면이 되지 않게 [다시 로그인]으로 갈 길을 둔다(원인은 단정하지 않는다)
      if (!s.pending) {
        return message('auth.unknown.title', t('auth.unknown.body'), true, [login('auth.relogin', 'primary')]);
      }
      return {
        kind: 'pending',
        title: t('auth.pending.title'),
        body: null,
        problem: false,
        buttons: [],
        otherAccountHelp: true,
      };
    case 'denied':
      if (s.reason === 'removedFromAllowlist') {
        return message(
          'auth.removed.title',
          name ? t('auth.removed.body', { channelName: name }) : t('auth.removed.bodyNoName'),
          true,
          [login('auth.otherAccount', 'primary')],
          true,
        );
      }
      return message(
        'auth.denied.title',
        name ? t('auth.denied.body', { channelName: name }) : t('auth.denied.bodyNoName'),
        true,
        [login('auth.otherAccount', 'primary')],
        true,
      );
    case 'expired':
      switch (s.reason) {
        case 'loginTimeout':
          return message('auth.loginTimeout.title', t('auth.loginTimeout.body'), true, [login('auth.relogin', 'primary')]);
        case 'revoked':
          return message('auth.revoked.title', t('auth.revoked.body'), true, [login('auth.relogin', 'primary')]);
        case 'reuseDetected':
          return message('auth.revoked.title', t('auth.reuse.body'), true, [login('auth.relogin', 'primary')]);
        case 'graceExpired':
          return message('auth.graceExpired.title', t('auth.graceExpired.body'), true, [
            { action: 'reconnect', label: t('auth.reconnect'), variant: 'primary' },
            login('auth.relogin', 'secondary'),
          ]);
        default:
          // 60일마다 누구나 보는 화면이라 문제로 그리지 않는다(§11.7)
          return message('auth.sessionExpired.title', t('auth.sessionExpired.body'), false, [login('auth.relogin', 'primary')]);
      }
    case 'cancelled':
      return message('auth.cancelled.title', null, false, [login('auth.relogin', 'primary')]);
    case 'error':
      switch (s.reason) {
        case 'network':
          return message('auth.network.title', t('auth.network.body'), true, [login('auth.relogin', 'primary')]);
        case 'loginLost':
          return message('auth.lost.title', t('auth.lost.body'), true, [login('auth.relogin', 'primary')]);
        case 'server':
          return message('auth.server.title', t('auth.server.body'), true, [login('auth.relogin', 'primary')]);
        default:
          // 사유 없음(상태를 묻지 못함 등): 원인을 단정하지 않는다
          return message('auth.unknown.title', t('auth.unknown.body'), true, [login('auth.relogin', 'primary')]);
      }
  }
}

/** 남은 초(0 이상). expiresAt은 유닉스 초, nowMs는 Date.now() 값 */
export function remainingSecs(expiresAt: number, nowMs: number): number {
  return Math.max(0, expiresAt - Math.floor(nowMs / 1000));
}
