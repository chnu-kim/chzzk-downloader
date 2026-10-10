// 로딩 표시의 지연·최소 유지(system/patterns.md §2.2): LOADER_DELAY_MS 안에 끝나면 한 번도 보이지 않고,
// 한 번 보이면 LOADER_MIN_MS 동안은 남는다(깜박임 방지). Spinner·Skeleton은 이것을 거친다(design-lint DX10).
import { LOADER_DELAY_MS, LOADER_MIN_MS } from './timing';

/** 타이머 판단(룬 없음, 가짜 타이머로 테스트한다). `onchange`는 `visible`이 바뀔 때만 부른다 */
export class DelayedLoading {
  visible = false;
  #active = false;
  #shownAt = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #onchange: (visible: boolean) => void;
  readonly #now: () => number;

  constructor(onchange: (visible: boolean) => void, now: () => number = () => Date.now()) {
    this.#onchange = onchange;
    this.#now = now;
  }

  set(active: boolean) {
    if (active === this.#active) return;
    this.#active = active;
    this.#clear();
    if (active) {
      if (this.visible) return;
      this.#timer = setTimeout(() => this.#show(), LOADER_DELAY_MS);
    } else if (this.visible) {
      const left = LOADER_MIN_MS - (this.#now() - this.#shownAt);
      if (left <= 0) this.#hide();
      else this.#timer = setTimeout(() => this.#hide(), left);
    }
  }

  dispose() {
    this.#clear();
  }

  #show() {
    this.#timer = null;
    this.#shownAt = this.#now();
    this.visible = true;
    this.#onchange(true);
  }

  #hide() {
    this.#timer = null;
    this.visible = false;
    this.#onchange(false);
  }

  #clear() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/**
 * 컴포넌트 초기화 중에 부른다. `active()`가 참인 동안 로딩 중이고, 돌려준 객체의 `visible`이 표시 여부다.
 * 예: `const loading = useDelayedLoading(() => busy);` → `{#if loading.visible}<Spinner />{/if}`
 */
export function useDelayedLoading(active: () => boolean): { readonly visible: boolean } {
  let visible = $state(false);
  const d = new DelayedLoading((v) => (visible = v));
  $effect(() => {
    d.set(active());
  });
  $effect(() => () => d.dispose());
  return {
    get visible() {
      return visible;
    },
  };
}
