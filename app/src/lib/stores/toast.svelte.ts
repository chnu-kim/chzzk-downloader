// 토스트(docs/design/system/components.md §2.13, 계약 §3): 한 번에 하나만 보이고 나머지는 대기열이다.
// - 정보·완료 토스트(danger 아님, action 없음)는 새 토스트가 오면 즉시 대체된다(대기열의 것도 같다).
// - danger 또는 action이 있는 토스트는 대체되지 않고 닫힐 때까지 남고, 뒤에 온 것은 FIFO로 기다린다.
// - 수명: danger와 `sticky`는 타이머 없음(닫을 때까지), 그 밖은 TOAST_MS. 올려 둔 동안 멈추고 떠나면 처음부터 다시 센다.
// - `sticky`: 키보드(또는 보조 기술 클릭)로 지운 되돌리기 토스트는 닫을 때까지 둔다(WCAG 2.2.1·2.1.1, ADR-0033).
// - `undo`: 이 동작이 방금 한 일을 되돌린다. 창 단축키 Mod+Z의 대상이고 낭독에 단축키를 안내한다.
// - 낭독: 토스트는 role 없이 그려지고, 보이게 될 때 한 번 상주 LiveAnnouncer로 읽는다(오류는 assertive).
import { toastSpeech } from '../spoken';
import { TOAST_MS } from '../timing';
import { announcer } from './announce.svelte';
import { platform } from './platform.svelte';

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
  /** 닫을 때까지 둔다(타이머 없음) */
  sticky?: true;
  /** 이 동작이 방금 한 일을 되돌린다(Mod+Z 대상) */
  undo?: true;
}

/** 토스트가 사라진 까닭. `action`은 동작 버튼을 눌러서다(되돌리기 등) */
export type ToastCloseReason = 'action' | 'dismiss' | 'timeout' | 'replaced' | 'clear';

export interface ToastOptions {
  timeout?: number;
  action?: ToastAction;
  /** 닫을 때까지 둔다(타이머 없음). 키보드로 지운 되돌리기 토스트가 쓴다 */
  sticky?: boolean;
  /** 이 동작이 방금 한 일을 되돌린다(Mod+Z 대상·낭독 안내) */
  undo?: boolean;
  /**
   * 목록에서 빠질 때 한 번 부른다(어떤 까닭이든). 지연 삭제(patterns.md §4)는 `reason !== 'action'`일 때
   * 실제로 지운다: 토스트가 사는 동안은 숨기기만 하고 닫힐 때 확정한다
   */
  onclose?: (reason: ToastCloseReason) => void;
}

/** 대체되지 않는 토스트 */
function isKept(i: ToastItem): boolean {
  return i.kind === 'danger' || i.action !== undefined;
}

export class ToastStore {
  /** 지금 보이는 것 + 대기열, 보일 순서대로(items[0]이 보이는 것). 대체된 정보 토스트는 빠진다 */
  items: ToastItem[] = $state([]);
  #next = 1;
  #timeouts = new Map<number, number>();
  #onclose = new Map<number, (reason: ToastCloseReason) => void>();
  /** 타이머가 걸린 토스트 id */
  #armed: number | null = null;
  /** 마지막으로 읽은 토스트 id */
  #announced: number | null = null;
  #handle: ReturnType<typeof setTimeout> | null = null;

  /** 지금 보이는 토스트 */
  get current(): ToastItem | null {
    return this.items[0] ?? null;
  }

  push(
    message: string,
    kind: ToastKind = 'info',
    { timeout = TOAST_MS, action, sticky, undo, onclose }: ToastOptions = {},
  ): number {
    const id = this.#next++;
    const item: ToastItem = { id, kind, message };
    if (action) item.action = action;
    if (sticky) item.sticky = true;
    if (undo) item.undo = true;
    // 새 토스트가 오면 정보·완료 토스트는 대체된다
    const kept = this.items.filter(isKept);
    const replaced = this.items.filter((i) => !isKept(i));
    this.#timeouts.set(id, timeout);
    if (onclose) this.#onclose.set(id, onclose);
    this.items = [...kept, item];
    for (const i of replaced) this.#closed(i.id, 'replaced');
    this.#arm();
    this.#speak();
    return id;
  }

  dismiss(id: number, reason: ToastCloseReason = 'dismiss') {
    if (!this.items.some((i) => i.id === id)) return;
    this.items = this.items.filter((i) => i.id !== id);
    this.#closed(id, reason);
    this.#arm();
    this.#speak();
  }

  /** 동작 버튼: 실행하고 닫는다(`onclose('action')`) */
  runAction(id: number) {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
    item.action?.run();
    this.dismiss(id, 'action');
  }

  /**
   * Mod+Z: 가장 나중에 올린 되돌리기(`undo`) 토스트의 동작을 실행한다. 보이는 토스트 뒤 대기열에 더 최근 것이 있으면 그쪽이 먼저다
   * (가장 최근 일부터 되돌린다). 실행할 것이 없으면 `false`
   */
  undoLatest(): boolean {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!this.items[i].undo) continue;
      this.runAction(this.items[i].id);
      return true;
    }
    return false;
  }

  /** 올려 둔 동안 수명 타이머를 멈춘다(보이는 토스트만 타이머가 있다) */
  pause(id: number) {
    if (this.#armed === id) this.#disarm();
  }

  /** 떠나면 처음부터 다시 센다 */
  resume(id: number) {
    const cur = this.current;
    if (!cur || cur.id !== id) return;
    this.#disarm();
    this.#arm();
  }

  clear() {
    this.#disarm();
    const ids = this.items.map((i) => i.id);
    this.items = [];
    for (const id of ids) this.#closed(id, 'clear');
    this.#timeouts.clear();
  }

  #closed(id: number, reason: ToastCloseReason) {
    this.#timeouts.delete(id);
    const cb = this.#onclose.get(id);
    this.#onclose.delete(id);
    cb?.(reason);
  }

  #disarm() {
    if (this.#handle) clearTimeout(this.#handle);
    this.#handle = null;
    this.#armed = null;
  }

  /** 보이는 토스트가 바뀌었으면 상주 라이브 영역으로 한 번 읽는다(ADR-0033). 대기열의 토스트는 보일 때 읽는다 */
  #speak() {
    const cur = this.current;
    if (!cur || cur.id === this.#announced) return;
    this.#announced = cur.id;
    const text = toastSpeech(cur, platform.os);
    if (cur.kind === 'danger') announcer.alert(text);
    else announcer.say(text);
  }

  /** 보이는 토스트가 바뀌었으면 타이머를 새로 건다(danger·sticky는 걸지 않는다) */
  #arm() {
    const cur = this.current;
    if (!cur) return this.#disarm();
    if (this.#armed === cur.id) return;
    this.#disarm();
    if (cur.kind === 'danger' || cur.sticky) return;
    const id = cur.id;
    this.#armed = id;
    this.#handle = setTimeout(() => this.dismiss(id, 'timeout'), this.#timeouts.get(id) ?? TOAST_MS);
  }
}

export const toasts = new ToastStore();
