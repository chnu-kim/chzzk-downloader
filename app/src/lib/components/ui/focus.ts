// 대화상자·메뉴가 함께 쓰는 포커스·움직임 도우미(docs/design/system/components.md §2.9·§2.10, 계약 §5).

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** `root` 안에서 Tab으로 닿는 요소. 숨김·`inert` 안의 요소는 뺀다 */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden && !el.closest('[inert]'));
}

/** IME 조합 중의 keydown이면 true. Esc·Enter·화살표 처리기는 먼저 이것을 거른다(G-IME-R4) */
export function isImeKey(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
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

// ---- 등장·퇴장(계약 §5): data-motion 속성 훅 + ui.css transition. 숫자 타이머 없음 ----

/** 붙을 때 `data-motion="enter"`를 두고 requestAnimationFrame 두 번 뒤에 지운다(등장 전환이 시작된다). 반환값은 정리 */
export function enterMotion(el: HTMLElement): () => void {
  el.dataset.motion = 'enter';
  let id = requestAnimationFrame(() => {
    id = requestAnimationFrame(() => {
      // 그 사이 퇴장이 시작됐으면 건드리지 않는다
      if (el.dataset.motion === 'enter') delete el.dataset.motion;
    });
  });
  return () => cancelAnimationFrame(id);
}

/** 전환이 없으면(jsdom, 시간 0) 기다릴 필요가 없다 */
function hasNoTransition(el: HTMLElement): boolean {
  const durations = getComputedStyle(el).transitionDuration;
  if (!durations) return true;
  return durations.split(',').every((d) => parseFloat(d) === 0);
}

/**
 * 퇴장: `data-motion="leave"`를 두고 전환이 끝나면 `done`을 한 번 부른다.
 * 전환 시간이 비었거나 0이면, 움직임 줄이기가 켜져 있으면 곧바로 부른다.
 * 요소 자신의 transitionend·transitioncancel만 본다(자식의 전환은 무시). 반환값은 취소 함수.
 */
export function leaveMotion(el: HTMLElement, done: () => void): () => void {
  el.dataset.motion = 'leave';
  let finished = false;
  const onEnd = (e: Event) => {
    if (e.target === el) finish();
  };
  function off() {
    el.removeEventListener('transitionend', onEnd);
    el.removeEventListener('transitioncancel', onEnd);
  }
  function finish() {
    if (finished) return;
    finished = true;
    off();
    done();
  }
  if (
    hasNoTransition(el) ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  ) {
    finish();
    return () => {};
  }
  el.addEventListener('transitionend', onEnd);
  el.addEventListener('transitioncancel', onEnd);
  return () => {
    finished = true;
    off();
    if (el.dataset.motion === 'leave') delete el.dataset.motion;
  };
}
