// 토스트(ui-visual §6.9): 오른쪽 아래에 쌓이고 5초 뒤 사라진다. 마우스를 올리면 멈춘다.

export type ToastKind = 'success' | 'copied' | 'danger' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
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

  push(message: string, kind: ToastKind = 'info', timeout = TOAST_MS): number {
    const id = this.#next++;
    this.items = [...this.items, { id, kind, message }];
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
