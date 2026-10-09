// 로그인 상태(worker.md §11, 구현 중 변경 62). 상태 판단은 Rust(`AuthService`)가 하고 여기서는 받은 값을 따라가며,
// 화면은 이 값 하나로 게이트를 그린다. 셸 command 게이트(55)가 권위이고 화면은 어긋나지 않게만 한다.
import * as api from '../api';
import type { AuthStatusDto } from '../bindings';
import { errorCopy, toAppError } from '../copy/errors';
import { t } from '../copy/ko';
import { toasts } from './toast.svelte';

const EMPTY = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null, canReconnect: false } as const;

/** 상태를 알 수 없을 때(시작 실패 등): 닫힌 채로 두고 로그인 화면의 [다시 로그인]으로 갈 길을 둔다. 원인은 단정하지 않는다(사유 없음) */
export const AUTH_UNKNOWN_ERROR: AuthStatusDto = { ...EMPTY, state: 'error' };
/** 로그인을 쓰지 않는 빌드 */
export const AUTH_DISABLED: AuthStatusDto = { ...EMPTY, state: 'disabled' };

const key = (s: AuthStatusDto | null) => (s ? `${s.state}:${s.reason ?? ''}` : '');

/** 사용자 동작. 같은 동작만 겹치지 않게 막는다(구현 중 변경 66 (가)) */
export type AuthAction = 'login' | 'reconnect' | 'reopen' | 'copy' | 'cancel' | 'logout';

export class AuthStore {
  status: AuthStatusDto | null = $state(null);
  /** 진행 중인 동작별 표시(그 동작의 버튼만 끈다). 다른 동작은 막지 않는다: 경합은 셸의 single-flight·세대 검사가 맡는다 */
  #busy: Record<AuthAction, boolean> = $state({
    login: false,
    reconnect: false,
    reopen: false,
    copy: false,
    cancel: false,
    logout: false,
  });
  /** [다시 연결]이 상태를 바꾸지 못한 그 상태의 키. 지금 상태가 이 키일 때만 안내를 보인다 */
  #failedAt: string | null = $state(null);
  /** 상태가 바뀐 횟수(이벤트·응답). 동작은 시작 때 값을 기억했다가 그사이 바뀌었으면 응답을 버린다(늦게 온 응답이 새 상태를 덮지 않게) */
  #seq = 0;

  ready = $derived(this.status !== null);
  locked = $derived(this.status !== null && this.status.state !== 'disabled' && this.status.state !== 'signedIn');
  unlocked = $derived(this.status !== null && !this.locked);
  signedIn = $derived(this.status?.state === 'signedIn');
  /** 어느 동작이든 진행 중 */
  busy = $derived(Object.values(this.#busy).some(Boolean));
  /** 직전 [다시 연결]이 상태를 바꾸지 못했고 지금도 그 상태다 */
  reconnectFailed = $derived(this.#failedAt !== null && key(this.status) === this.#failedAt);

  isBusy(a: AuthAction): boolean {
    return this.#busy[a];
  }

  /**
   * 앱 수명 동안 한 번. 먼저 이벤트를 듣고 그다음 상태를 묻는다(사이에 온 변화를 놓치지 않게).
   * 이벤트가 먼저 왔으면 응답은 버린다. 돌려준 함수로 그만 듣는다.
   */
  async start(): Promise<() => void> {
    let off: () => void = () => {};
    try {
      off = await api.onAuthChanged((s) => this.apply(s));
    } catch {
      // 듣지 못해도 상태는 묻는다
    }
    const s0 = this.#seq;
    let s: AuthStatusDto;
    try {
      s = await api.authStatus();
    } catch {
      s = AUTH_UNKNOWN_ERROR;
    }
    if (this.#seq === s0) this.apply(s);
    return off;
  }

  /** 새 상태를 받는다(이벤트·응답 모두). Checking은 지나가는 상태라 [다시 연결] 실패 표시를 지우지 않는다 */
  apply(s: AuthStatusDto): void {
    this.#seq += 1;
    const k = key(s);
    if (this.#failedAt !== null && k !== this.#failedAt && s.state !== 'checking') this.#failedAt = null;
    this.status = s;
  }

  /** 테스트용: 싱글턴이 테스트 사이에 새지 않게 */
  reset(): void {
    this.status = null;
    for (const a of Object.keys(this.#busy) as AuthAction[]) this.#busy[a] = false;
    this.#failedAt = null;
    this.#seq = 0;
  }

  async #run(a: AuthAction, f: () => Promise<void>): Promise<void> {
    if (this.#busy[a]) return;
    this.#busy[a] = true;
    try {
      await f();
    } finally {
      this.#busy[a] = false;
    }
  }

  /** command 하나를 부르고, 그사이 상태가 바뀌지 않았으면 응답을 반영한다. 실패하면 토스트 후 null */
  async #call(f: () => Promise<AuthStatusDto>): Promise<AuthStatusDto | null> {
    const s0 = this.#seq;
    try {
      const s = await f();
      if (this.#seq === s0) this.apply(s);
      return s;
    } catch (e) {
      toasts.push(errorCopy(toAppError(e), { place: 'other' }).title, 'danger');
      return null;
    }
  }

  login(): Promise<void> {
    return this.#run('login', async () => {
      await this.#call(() => api.authLogin());
    });
  }

  /** 대기 중 [다시 로그인](auth.pending.stuck): 지금 로그인을 취소하고 새로 시작한다(Pending의 authLogin은 같은 주소를 돌려준다) */
  restartLogin(): Promise<void> {
    return this.#run('login', async () => {
      const c = await this.#call(() => api.authCancel());
      // 취소가 실패했거나 아직 대기 중이면 authLogin은 같은 주소를 돌려줄 뿐이니 부르지 않는다
      if (!c || c.state === 'pending') return;
      await this.#call(() => api.authLogin());
    });
  }

  reconnect(): Promise<void> {
    return this.#run('reconnect', async () => {
      const before = key(this.status);
      this.#failedAt = null;
      const s = await this.#call(() => api.authRetry());
      if (!s) return;
      if (s.state === 'signedIn') {
        // 계정 메뉴의 [다시 연결]: 여전히 오프라인이면 화면에 변화가 없으니 토스트로 알린다
        if (s.offline) toasts.push(t('auth.reconnectFailed'), 'danger');
      } else if (key(s) === before && (key(this.status) === before || this.status?.state === 'checking')) {
        // 그사이 사용자가 다른 동작(로그인 등)으로 상태를 옮겼으면 기억하지 않는다(나중에 같은 상태로 돌아와도 옛 안내가 살아나지 않게)
        this.#failedAt = before;
      }
    });
  }

  reopen(): Promise<void> {
    return this.#run('reopen', async () => {
      await api.authReopen().catch(() => false);
    });
  }

  copyLoginUrl(): Promise<void> {
    return this.#run('copy', async () => {
      const ok = await api.authCopyLoginUrl().catch(() => false);
      if (ok) toasts.push(t('toast.copied'), 'copied');
      else toasts.push(t('toast.copyFailed'), 'danger');
    });
  }

  cancel(): Promise<void> {
    return this.#run('cancel', async () => {
      await this.#call(() => api.authCancel());
    });
  }

  logout(): Promise<void> {
    return this.#run('logout', async () => {
      await this.#call(() => api.authLogout());
    });
  }
}

export const auth = new AuthStore();
