<script lang="ts">
  // 글자 없는 아이콘 버튼(docs/design/system/components.md §2.2). 이름은 label 하나가 aria-label·title 둘 다 맡는다.
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconButtonIcon } from './vocab';

  type Props = HTMLButtonAttributes & {
    icon: IconButtonIcon;
    label: string;
    size?: 'sm' | 'md';
    disabled?: boolean;
    el?: HTMLButtonElement | null;
    /** 툴팁(`title`)만 덮어쓴다(예: "전체 보기(0)"). 이름(aria-label)은 label 그대로이고, 이름과 다른 title은 접근 가능한 설명으로 계산된다 */
    hint?: string;
  };

  let {
    icon,
    label,
    size = 'md',
    disabled = false,
    el = $bindable(null),
    hint,
    class: klass = '',
    ...rest
  }: Props = $props();
</script>

<button
  bind:this={el}
  type="button"
  {...rest}
  class={['icon-btn', size === 'sm' && 'icon-btn-sm', klass]}
  aria-label={label}
  title={hint ?? label}
  {disabled}
>
  <Icon name={icon} {size} />
</button>
