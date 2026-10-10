<script lang="ts">
  // 최근 VOD(§8.1). {url, title}만 있어 날짜·종류는 보이지 않는다. 없으면 예시 한 줄.
  import type { RecentVodDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    items: readonly RecentVodDto[];
    onreopen: (url: string) => void;
  }

  let { items, onreopen }: Props = $props();
</script>

{#if items.length === 0}
  <p class="hint">{t('url.hintExample')}</p>
{:else}
  <section class="recent" aria-labelledby="recent-title">
    <h2 id="recent-title" class="title">{t('recent.title')}</h2>
    <ul>
      {#each items as item (item.url)}
        <li class="recent-row">
          <span class="clock"><Icon name="clock" size="sm" /></span>
          <span class="name" title={item.title || item.url}>{item.title || item.url}</span>
          <Button variant="ghost" size="sm" aria-label="{t('recent.reopen')}: {item.title || item.url}" onclick={() => onreopen(item.url)}>
            {t('recent.reopen')}
          </Button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .hint {
    margin: var(--space-4) 0 0;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .recent {
    margin-top: var(--space-8);
  }
  .title {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--fg-muted);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .recent-row {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    min-height: 28px;
    padding: 0 var(--space-4);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
  }
  .recent-row:hover {
    background: var(--surface-2);
  }
  .clock {
    color: var(--fg-faint);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow-wrap: normal;
  }
</style>
