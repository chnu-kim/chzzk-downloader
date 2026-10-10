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
  };

  let {
    icon,
    label,
    size = 'md',
    disabled = false,
    el = $bindable(null),
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
  title={label}
  {disabled}
>
  <Icon name={icon} {size} />
</button>
