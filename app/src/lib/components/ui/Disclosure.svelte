<script lang="ts">
  // 펼침(docs/design/system/components.md §2.8). 네이티브 <details>라 키보드·접근성은 브라우저가 맡는다.
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { DisclosureVariant } from './vocab';

  type Props = {
    variant?: DisclosureVariant;
    title: string;
    heading?: 'h2' | 'h3';
    open?: boolean;
    onchange?: (open: boolean) => void;
    children: Snippet;
  };

  let {
    variant = 'section',
    title,
    heading = 'h2',
    open = $bindable(false),
    onchange,
    children,
  }: Props = $props();

  // prop이 바뀌어 생긴 toggle은 이미 같은 값이라 건너뛴다(사용자가 바꿀 때만 onchange)
  function handleToggle(e: Event & { currentTarget: EventTarget & HTMLDetailsElement }) {
    const next = e.currentTarget.open;
    if (next === open) return;
    open = next;
    onchange?.(next);
  }
</script>

<details class={['disclosure', variant === 'inline' && 'disclosure-inline']} {open} ontoggle={handleToggle}>
  <summary>
    <Icon name="chevron-right" size="sm" />
    {#if variant === 'inline'}
      {title}
    {:else}
      <svelte:element this={heading}>{title}</svelte:element>
    {/if}
  </summary>
  <div class="disclosure-panel">
    {@render children()}
  </div>
</details>
