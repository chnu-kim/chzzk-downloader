<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  interface Props extends HTMLButtonAttributes {
    icon: IconName;
    /** 단독 아이콘 버튼이라 반드시 있어야 한다 */
    label: string;
    /** sm 28(기본), md 36(헤더) */
    size?: 'sm' | 'md';
    el?: HTMLButtonElement | null;
  }

  let { icon, label, size = 'sm', type = 'button', el = $bindable(null), class: klass = '', ...rest }: Props =
    $props();
</script>

<button bind:this={el} {type} class="icon-btn {size} {klass}" aria-label={label} title={label} {...rest}>
  <Icon name={icon} size={size === 'md' ? 20 : 16} />
</button>

<style>
  .icon-btn {
    display: inline-grid;
    place-items: center;
    width: var(--control-h-sm);
    height: var(--control-h-sm);
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--fg-muted);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .icon-btn.md {
    width: var(--control-h);
    height: var(--control-h);
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--fg);
  }
  .icon-btn:disabled {
    cursor: default;
    color: var(--fg-faint);
  }
</style>
