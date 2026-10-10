<script lang="ts">
  // 펼침(docs/design/system/components.md §2.8). section·inline은 네이티브 details라 키보드·접근성은 브라우저가 맡는다.
  // group은 목록 그룹 머리: 머리 줄 자체가 토글(button aria-expanded)이고, 접힌 동안에도 children(미리보기)이 그려진다.
  // 무엇을 보일지는 호출부가 open으로 정한다(§7-36).
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

  const uid = $props.id();
  const panelId = `${uid}-panel`;

  // prop이 바뀌어 생긴 toggle은 이미 같은 값이라 건너뛴다(사용자가 바꿀 때만 onchange)
  function handleToggle(e: Event & { currentTarget: EventTarget & HTMLDetailsElement }) {
    const next = e.currentTarget.open;
    if (next === open) return;
    open = next;
    onchange?.(next);
  }

  function toggle() {
    open = !open;
    onchange?.(open);
  }
</script>

{#if variant === 'group'}
  <div class="disclosure-group">
    <svelte:element this={heading} class="disclosure-head">
      <button type="button" class="disclosure-toggle" aria-expanded={open} aria-controls={panelId} onclick={toggle}>
        <Icon name="chevron-right" size="sm" />
        {title}
      </button>
    </svelte:element>
    <div id={panelId} class="disclosure-group-panel">
      {@render children()}
    </div>
  </div>
{:else}
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
{/if}
