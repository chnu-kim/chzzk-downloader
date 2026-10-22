<script lang="ts">
  // 창 전체 시트(docs/design/system/components.md Sheet, D67). 구간 편집 화면의 레이어 뿌리다.
  // 대화상자(Dialog)와 같은 모달 층(`modalLayer`)이지만 확인을 묻는 작은 상자가 아니라 창 전체를 쓰는 편집기라 버튼 줄 규칙(ADR-0005)이 없다.
  // 붙으면 body 직속으로 옮겨지고 맨 위 층 말고는 inert다. 떨어질 때 연 요소로 포커스를 돌려준다.
  // 뿌리는 tabindex -1이라 포커스할 수 없는 곳을 눌러도 포커스가 body로 가지 않는다(키가 뿌리를 지난다). 키 처리·Esc·Tab 순환은 쓰는 쪽이 한다.
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { modalLayer } from './modalLayer';

  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role' | 'tabindex'> & {
    /** 제목(h1) 요소의 id: 접근 이름 */
    labelledby: string;
    /** 부제 요소의 id: 접근 설명 */
    describedby?: string;
    /** 연 요소. 떨어질 때 포커스를 돌려준다(기본: 붙을 때의 포커스 요소) */
    opener?: HTMLElement | null;
    /** 연 요소가 사라졌을 때 포커스를 대신 정한다 */
    returnFocus?: () => void;
    el?: HTMLDivElement | null;
    children: Snippet;
  };

  let { labelledby, describedby, opener, returnFocus, el = $bindable(null), children, class: klass = '', ...rest }: Props = $props();

  function layer(node: HTMLElement) {
    return modalLayer(node, { opener, returnFocus });
  }
</script>

<div
  {...rest}
  bind:this={el}
  class={['fullsheet', klass]}
  role="dialog"
  aria-modal="true"
  aria-labelledby={labelledby}
  aria-describedby={describedby}
  tabindex="-1"
  {@attach layer}
>
  {@render children()}
</div>
