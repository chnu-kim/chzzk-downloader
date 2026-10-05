// 대화상자·메뉴가 함께 쓰는 포커스 도우미.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden);
}

/**
 * Tab·Shift+Tab을 `root` 안에서 돌린다. 처리했으면 true.
 */
export function trapTab(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.key !== 'Tab') return false;
  const list = focusables(root);
  if (list.length === 0) {
    e.preventDefault();
    root.focus();
    return true;
  }
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && root.contains(active);
  if (e.shiftKey && (active === first || !inside || active === root)) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (active === last || !inside)) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
