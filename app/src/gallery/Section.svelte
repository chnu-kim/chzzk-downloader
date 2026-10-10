<script lang="ts">
  // 갤러리 섹션 하나(docs/design/system/governance.md §2.6). shots.spec이 data-gallery 단위로 찍는다.
  import type { Snippet } from 'svelte';

  interface Props {
    name: string;
    heading: string;
    children: Snippet;
  }

  let { name, heading, children }: Props = $props();
  const uid = $props.id();
</script>

<section class="g-section" data-gallery={name} aria-labelledby="{uid}-title">
  <h2 id="{uid}-title" class="g-title">{heading}</h2>
  {@render children()}
</section>

<style>
  .g-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    padding: var(--space-16) 0;
    border-top: 1px solid var(--separator);
    background: var(--bg);
  }
  .g-title {
    font-size: var(--text-title);
    font-weight: var(--weight-strong);
    line-height: var(--leading-title);
    color: var(--fg);
  }
</style>
