// 로그인 상태(worker.md §11, 구현 중 변경 A3-1). 상태 판단은 Rust(`AuthService`)가 하고 여기서는 받은 값을 따라가며,
// 화면은 이 값 하나로 게이트를 그린다. 셸 command 게이트(55)가 권위이고 화면은 어긋나지 않게만 한다.
import * as api from '../api';
import type { AuthStatusDto } from '../bindings';
import { errorCopy, toAppError } from '../copy/errors';
import { t } from '../copy/ko';
import { toasts } from './toast.svelte';

const EMPTY = { channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null } as const;

/** 상태를 알 수 없을 때(시작 실패 등): 닫힌 채로 두고 로그인 화면의 [다시 로그인]으로 갈 길을 둔다 */
export const AUTH_UNKNOWN_ERROR: AuthStatusDto = { ...EMPTY, state: 'error', reason: 'network' };
/** 로그인을 쓰지 않는 빌드 */
export const AUTH_DISABLED: AuthStatusDto = { ...EMPTY, state: 'disabled' };

const key = (s: AuthStatusDto | null) => (s ? `${s.state}:${s.reason ?? ''}` : '');

export class AuthStore {
  status: AuthStatusDto | null = $state(null);
  /** 진행 중인 사용자 동작(버튼 비활성) */
  busy = $state(false);
  /** 직전 [다시 연결]이 상태를 바꾸지 못했다. 상태가 바뀌면 false */
  reconnectFailed = $state(false);

  ready = $derived(this.status !== null);
  locked = $derived(this.status !== null && this.status.state !== 'disabled' && this.status.state !== 'signedIn');
  unlocked = $derived(this.status !== null && !this.locked);
  signedIn = $derived(this.status?.state === 'signedIn');

  /**
   * 앱 수명 동안 한 번. 먼저 이벤트를 듣고 그다음 상태를 묻는다(사이에 온 변화를 놓치지 않게).
   * 이벤트가 먼저 왔으면 응답은 버린다. 돌려준 함수로 그만 듣는다.
   */
  async start(): Promise<() => void> {
    let gotEvent = false;
    let off: () => void = () => {};
    try {
      off = await api.onAuthChanged((s) => {
        gotEvent = true;
        this.apply(s);
      });
    } catch {
      // 듣지 못해도 상태는 묻는다
    }
    try {
      const s = await api.authStatus();
      if (!gotEvent) this.apply(s);
    } catch {
      if (!gotEvent) this.apply(AUTH_UNKNOWN_ERROR);
    }
    return off;
  }

  apply(s: AuthStatusDto): void {
    if (key(s) !== key(this.status)) this.reconnectFailed = false;
    this.status = s;
  }

  /** 테스트용: 싱글턴이 테스트 사이에 새지 않게 */
  reset(): void {
    this.status = null;
    this.busy = false;
    this.reconnectFailed = false;
  }

  async #run(f: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await f();
    } finally {
      this.busy = false;
    }
  }

  login(): Promise<void> {
    return this.#run(async () => {
      try {
        this.apply(await api.authLogin());
      } catch (e) {
        toasts.push(errorCopy(toAppError(e), { place: 'other' }).title, 'danger');
      }
    });
  }

  reconnect(): Promise<void> {
    return this.#run(async () => {
      const before = key(this.status);
      try {
        const s = await api.authRetry();
        this.apply(s);
        this.reconnectFailed = key(s) === before && s.state !== 'signedIn';
      } catch (e) {
        toasts.push(errorCopy(toAppError(e), { place: 'other' }).title, 'danger');
      }
    });
  }

  reopen(): Promise<void> {
    return this.#run(async () => {
      await api.authReopen().catch(() => false);
    });
  }

  copyLoginUrl(): Promise<void> {
    return this.#run(async () => {
      const ok = await api.authCopyLoginUrl().catch(() => false);
      if (ok) toasts.push(t('toast.copied'), 'copied');
      else toasts.push(t('toast.copyFailed'), 'danger');
    });
  }

  cancel(): Promise<void> {
    return this.#run(async () => {
      try {
        this.apply(await api.authCancel());
      } catch (e) {
        toasts.push(errorCopy(toAppError(e), { place: 'other' }).title, 'danger');
      }
    });
  }

  logout(): Promise<void> {
    return this.#run(async () => {
      try {
        this.apply(await api.authLogout());
      } catch (e) {
        toasts.push(errorCopy(toAppError(e), { place: 'other' }).title, 'danger');
      }
    });
  }
}

export const auth = new AuthStore();
