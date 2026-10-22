// 공용 모달 층(range-editor.md RE1). 대화상자(Dialog)와 구간 편집 화면이 함께 쓴다.
// 층을 body 직속으로 옮기고, 열린 층의 스택을 갖고, 층이 붙거나 떨어질 때마다
// "맨 위 층 말고 body의 모든 자식은 inert"를 처음부터 다시 계산한다.
// 저장값 복원 방식(붙을 때 찍어 둔 이전 값으로 되돌리기)은 층이 생긴 역순으로 닫힐 때만 맞다: 편집 화면 위에 대화상자가 뜬 사이
// 카드가 사라지면 편집 화면이 먼저 떨어져 앱 전체가 inert로 남는다. 그래서 여기서는 스택과 "원래 값"만 기억한다.

const stack: HTMLElement[] = [];
/** 우리가 inert를 단 body 자식 → 달기 전의 inert 속성 값(없으면 null). 층이 붙기 전부터 있던 inert를 지우지 않으려는 기록이다 */
const touched = new Map<Element, string | null>();

function restore(child: Element) {
  if (!touched.has(child)) return;
  const prev = touched.get(child) ?? null;
  touched.delete(child);
  if (prev === null) child.removeAttribute('inert');
  else child.setAttribute('inert', prev);
}

/** 맨 위 층만 살리고 body의 나머지 자식을 inert로 다시 계산한다 */
function recompute() {
  // body에서 사라진 자식의 기록은 버린다
  for (const el of [...touched.keys()]) if (!el.isConnected || el.parentElement !== document.body) touched.delete(el);
  const top = stack[stack.length - 1] ?? null;
  for (const child of document.body.children) {
    if (top === null || child === top) {
      restore(child);
    } else if (!touched.has(child)) {
      touched.set(child, child.getAttribute('inert'));
      child.setAttribute('inert', '');
    }
  }
}

export interface ModalLayerOptions {
  /** 층이 떨어질 때 포커스를 돌려줄 요소. 기본은 붙을 때의 `document.activeElement` */
  opener?: HTMLElement | null;
  /** 연 요소가 사라졌을 때 포커스를 대신 정한다(없으면 그대로 둔다) */
  returnFocus?: () => void;
}

/**
 * `el`을 모달 층으로 올린다. `{@attach modalLayer}`나 `{@attach (el) => modalLayer(el, opts)}`로 쓴다.
 * 정리 함수는 순서대로 한다: 스택에서 빼고 inert를 다시 계산 → 요소를 떼기 → 연 요소로 포커스 복귀
 * (inert가 남은 곳으로 포커스를 주면 조용히 실패하므로 계산이 먼저다).
 */
export function modalLayer(el: HTMLElement, opts: ModalLayerOptions = {}): () => void {
  const opener = opts.opener !== undefined ? opts.opener : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.append(el);
  stack.push(el);
  recompute();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = stack.lastIndexOf(el);
    if (i >= 0) stack.splice(i, 1);
    // 떨어지는 층 자신도 body 자식이라 기록이 있을 수 있다
    touched.delete(el);
    el.remove();
    recompute();
    if (opener?.isConnected) opener.focus();
    else opts.returnFocus?.();
  };
}

/** 열린 모달 층의 수(0이면 모달이 없다) */
export function modalLayerDepth(): number {
  return stack.length;
}
