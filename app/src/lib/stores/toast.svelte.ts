// 토스트(ui-visual §6.9): 오른쪽 아래에 쌓이고 5초 뒤 사라진다. 마우스를 올리면 멈춘다.

export type ToastKind = 'success' | 'copied' | 'danger' | 'info';

/** 토스트 안의 버튼 하나(예: `fileMissing`의 [폴더 열기]). 누르면 실행하고 토스트를 닫는다 */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

export interface ToastOptions {
  timeout?: number;
  action?: ToastAction;
}

interface Timer {
  handle: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

export const TOAST_MS = 5000;

export class ToastStore {
  items: ToastItem[] = $state([]);
  #next = 1;
  #timers = new Map<number, Timer>();

  push(message: string, kind: ToastKind = 'info', { timeout = TOAST_MS, action }: ToastOptions = {}): number {
    const id = this.#next++;
    this.items = [...this.items, action ? { id, kind, message, action } : { id, kind, message }];
    this.#timers.set(id, { handle: null, remaining: timeout, startedAt: 0 });
    this.resume(id);
    return id;
  }

  dismiss(id: number) {
    const t = this.#timers.get(id);
    if (t?.handle) clearTimeout(t.handle);
    this.#timers.delete(id);
    this.items = this.items.filter((i) => i.id !== id);
  }

  pause(id: number) {
    const t = this.#timers.get(id);
    if (!t || !t.handle) return;
    clearTimeout(t.handle);
    t.handle = null;
    t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
  }

  resume(id: number) {
    const t = this.#timers.get(id);
    if (!t || t.handle) return;
    t.startedAt = Date.now();
    t.handle = setTimeout(() => this.dismiss(id), t.remaining);
  }

  clear() {
    for (const id of [...this.#timers.keys()]) this.dismiss(id);
  }
}

export const toasts = new ToastStore();
