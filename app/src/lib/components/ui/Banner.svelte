<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../../copy/ko';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    tone: 'info' | 'danger';
    children: Snippet;
    actions?: Snippet;
    onclose?: () => void;
  }

  let { tone, children, actions, onclose }: Props = $props();
</script>

<div class="banner {tone}" role={tone === 'danger' ? 'alert' : 'status'}>
  <div class="inner">
    <span class="icon"><Icon name={tone === 'danger' ? 'alert' : 'info'} /></span>
    <p class="text">{@render children()}</p>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
    {#if onclose}<IconButton icon="x" label={t('common.close')} onclick={onclose} />{/if}
  </div>
</div>

<style>
  .banner {
    flex: none;
    width: 100%;
    border-bottom: 1px solid;
  }
  .info {
    background: var(--accent-soft);
    border-bottom-color: color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .danger {
    background: var(--danger-soft);
    border-bottom-color: color-mix(in srgb, var(--danger) 20%, transparent);
  }
  .inner {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    min-height: 40px;
    padding: var(--space-4) var(--gutter);
  }
  .info .icon {
    color: var(--accent);
  }
  .danger .icon {
    color: var(--danger);
  }
  .text {
    flex: 1;
    margin: 0;
    font-size: var(--text-md);
  }
  .actions {
    display: flex;
    gap: var(--space-8);
  }
  @media (min-width: 840px) {
    .inner {
      padding-inline: var(--gutter-wide);
    }
  }
</style>
