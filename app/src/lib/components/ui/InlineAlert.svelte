<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    /** danger만 role=alert(ui-visual §7) */
    tone: 'danger' | 'warning' | 'info';
    title: string;
    children?: Snippet;
    actions?: Snippet;
  }

  let { tone, title, children, actions }: Props = $props();
</script>

<div class="alert {tone}" role={tone === 'danger' ? 'alert' : 'note'}>
  <span class="icon"><Icon name={tone === 'info' ? 'info' : 'alert'} /></span>
  <div class="text">
    <p class="title">{title}</p>
    {#if children}<div class="body">{@render children()}</div>{/if}
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
</div>

<style>
  .alert {
    display: flex;
    gap: var(--space-2);
    padding: 10px 12px;
    border-left: var(--rail-w) solid;
    border-radius: var(--radius-sm);
  }
  .danger {
    background: var(--danger-soft);
    border-left-color: var(--danger);
  }
  .warning {
    background: var(--warning-soft);
    border-left-color: var(--warning);
  }
  .info {
    background: var(--accent-soft);
    border-left-color: var(--accent);
  }
  .icon {
    flex: none;
    padding-top: 1px;
  }
  .danger .icon,
  .danger .title {
    color: var(--danger);
  }
  .warning .icon,
  .warning .title {
    color: var(--warning);
  }
  .info .icon {
    color: var(--accent);
  }
  .text {
    flex: 1;
    min-width: 0;
  }
  .title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    padding-top: 2px;
  }
  .info .title {
    color: var(--fg);
  }
  .body {
    margin-top: var(--space-1);
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    color: var(--fg);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
</style>
