<script lang="ts">
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<kbd class="kbd">{@render children()}</kbd>

<style>
  .kbd {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    background: var(--surface-2);
    color: var(--fg-muted);
    font-family: inherit;
    font-size: 11px;
    font-weight: var(--weight-medium);
    line-height: 1;
  }
</style>
