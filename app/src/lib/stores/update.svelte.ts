// 앱 업데이트(worker.md §11.6, 구현 중 변경 A4-1~A4-3). 판단은 Rust(`chzzk_shell::update`)가 하고, 여기서는 받은 값을 따라간다.
import * as api from '../api';
import type { UpdateInfoDto, UpdateInstallDto, UpdateProgressEvent } from '../bindings';
import { t } from '../copy/ko';
import { toasts } from './toast.svelte';

export type CheckState = 'idle' | 'checking' | 'upToDate' | 'failed' | 'offline' | 'untrusted' | 'available';
export type InstallPhase = 'idle' | 'confirm' | 'downloading' | 'installing';

export class UpdateStore {
  available: UpdateInfoDto | null = $state(null);
  /** [나중에]한 버전(이 실행 동안). 다른 버전이 오면 다시 보인다 */
  #dismissed: string | null = $state(null);
  check: CheckState = $state('idle');
  phase: InstallPhase = $state('idle');
  /** needsConfirm이 알려 준 받는 중 작업 수(대화상자 문구) */
  confirmRunning = $state(0);
  received = $state(0);
  total: number | null = $state(null);

  showBanner = $derived(this.available !== null && this.#dismissed !== this.available.version);
  busy = $derived(this.phase === 'downloading' || this.phase === 'installing');
  /** 0~100 정수, 크기를 모르면 null */
  pct = $derived(this.total && this.total > 0 ? Math.min(100, Math.floor((this.received * 100) / this.total)) : null);

  /** 이벤트·확인으로 `available`이 바뀐 횟수. `sync`는 호출 사이에 바뀌었으면 응답을 버린다(이벤트가 이긴다, auth store와 같은 규칙) */
  #seq = 0;
  /** install 호출이 진행 중 */
  #running = false;
  /** `start()`가 두 listen을 마치면(실패해도) resolve한다. App의 effect 순서와 무관하게 sync가 listen 뒤에 묻도록 생성 때 만든다 */
  #resolveListening: () => void = () => {};
  #listening: Promise<void> = this.#newListening();

  #newListening(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.#resolveListening = resolve;
    });
  }

  /** 앱 수명 동안 한 번: update-available·update-progress를 듣는다. 실패는 삼킨다. 돌려준 함수로 그만 듣는다 */
  async start(): Promise<() => void> {
    const offs: Array<() => void> = [];
    try {
      offs.push(await api.onUpdateAvailable((i) => this.#onAvailable(i)));
    } catch {
      // 듣지 못해도 sync로 캐시를 읽는다
    }
    try {
      offs.push(await api.onUpdateProgress((e) => this.#onProgress(e)));
    } catch {
      // 진행 표시만 없다
    }
    this.#resolveListening();
    return () => {
      for (const f of offs) f();
    };
  }

  /**
   * 잠금이 풀린 뒤(signedIn) 자동 확인이 찾아 둔 캐시를 읽는다. 듣고 나서 묻기: listen을 마친 뒤에 묻고,
   * 그사이 `update-available`이 왔으면 응답을 버린다. 실패는 삼킨다(available 유지).
   */
  async sync(): Promise<void> {
    await this.#listening;
    const s0 = this.#seq;
    try {
      const i = await api.updateAvailable();
      if (this.#seq === s0) this.available = i;
    } catch {
      // 캐시를 못 읽어도 설정의 [업데이트 확인]으로 찾을 수 있다
    }
  }

  /** [나중에]: 이 버전은 이 실행 동안 배너를 숨긴다 */
  later(): void {
    this.#dismissed = this.available?.version ?? null;
  }

  /** 설정의 [업데이트 확인]. checking 중이면 무시 */
  async checkNow(): Promise<void> {
    if (this.check === 'checking') return;
    this.check = 'checking';
    try {
      const r = await api.updateCheck();
      switch (r.result) {
        case 'available':
          this.#seq += 1;
          this.available = r.info;
          this.#dismissed = null;
          this.check = 'available';
          break;
        case 'upToDate':
        case 'untrusted':
          // Rust가 캐시를 비웠다
          this.#seq += 1;
          this.available = null;
          this.check = r.result;
          break;
        default:
          this.check = r.result;
      }
    } catch {
      this.check = 'failed';
    }
  }

  /** [지금 업데이트]·대화상자 [업데이트하고 다시 시작]. 이미 받는 중·설치 중이면 무시 */
  async install(confirmPause = false): Promise<void> {
    if (this.#running || this.busy) return;
    this.#running = true;
    if (confirmPause) {
      this.phase = 'downloading';
      this.received = 0;
      this.total = null;
    }
    try {
      this.#installed(await api.updateInstall(confirmPause));
    } catch {
      this.phase = 'idle';
      toasts.push(t('update.failed'), 'danger');
    } finally {
      this.#running = false;
    }
  }

  /** 대화상자 [나중에]·Esc */
  cancelConfirm(): void {
    this.phase = 'idle';
  }

  /** 테스트용: 싱글턴이 테스트 사이에 새지 않게 */
  reset(): void {
    this.available = null;
    this.#dismissed = null;
    this.check = 'idle';
    this.phase = 'idle';
    this.confirmRunning = 0;
    this.received = 0;
    this.total = null;
    this.#seq = 0;
    this.#running = false;
    this.#listening = this.#newListening();
  }

  #onAvailable(i: UpdateInfoDto): void {
    this.#seq += 1;
    this.available = i;
  }

  #onProgress(e: UpdateProgressEvent): void {
    switch (e.type) {
      case 'started':
        this.phase = 'downloading';
        this.received = 0;
        this.total = e.total;
        break;
      case 'chunk':
        this.received = e.received;
        this.total = e.total;
        break;
      case 'downloaded':
        break;
      case 'installing':
        this.phase = 'installing';
        break;
    }
  }

  #installed(r: UpdateInstallDto): void {
    switch (r.result) {
      case 'needsConfirm':
        this.confirmRunning = r.running;
        this.phase = 'confirm';
        break;
      case 'restarting':
        // 앱이 곧 다시 시작한다
        this.phase = 'installing';
        break;
      case 'upToDate':
        this.#seq += 1;
        this.available = null;
        this.phase = 'idle';
        toasts.push(t('settings.about.upToDate'));
        break;
      case 'untrusted':
        this.#seq += 1;
        this.available = null;
        this.phase = 'idle';
        toasts.push(t('update.untrusted'), 'danger');
        break;
      case 'failed':
      case 'offline':
        this.phase = 'idle';
        toasts.push(t('update.failed'), 'danger');
        break;
      case 'busy':
        this.phase = 'idle';
        break;
    }
  }
}

export const update = new UpdateStore();
