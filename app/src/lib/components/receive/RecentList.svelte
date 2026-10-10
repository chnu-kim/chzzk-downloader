<script lang="ts">
  // 최근 영상(system/patterns.md §14.1). 섹션 제목 + 그룹 상자. 행: 제목(말줄임) + 둘째 줄 `{kind} · {date}` + [다시 열기].
  // 둘째 줄은 같은 이름의 회차를 구별한다. 옛 항목(종류 없음)은 둘째 줄이 없다. 비어 있으면 아무것도 그리지 않는다
  // (붙여넣기 힌트는 InputPanel이 늘 한 줄 둔다).
  import type { RecentVodDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { recentSecondLine } from '../../receive';
  import { RECENT_MAX } from '../../timing';
  import Button from '../ui/Button.svelte';
  import Surface from '../ui/Surface.svelte';

  interface Props {
    items: readonly RecentVodDto[];
    onreopen: (url: string) => void;
  }

  let { items, onreopen }: Props = $props();
  const shown = $derived(items.slice(0, RECENT_MAX));
</script>

{#if shown.length > 0}
  <section class="recent" aria-labelledby="recent-title">
    <h2 id="recent-title" class="section-title">{t('recent.title')}</h2>
    <Surface variant="group" role="list">
      {#each shown as item (item.url)}
        {@const name = item.title || item.url}
        {@const second = recentSecondLine(item)}
        <div class="row recent-row" role="listitem">
          <div class="row-main">
            <span class="row-label ellipsis">{name}</span>
            {#if second}<span class="row-help">{second}</span>{/if}
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="edge-end"
            aria-label={t('a11y.reopen', { title: name })}
            onclick={() => onreopen(item.url)}
          >
            {t('recent.reopen')}
          </Button>
        </div>
      {/each}
    </Surface>
  </section>
{/if}

<style>
  /* 힌트와 최근 영상 사이는 섹션 간격 24(= 형제 gap 8 + 16) */
  .recent {
    margin-top: var(--space-16);
  }
  .section-title {
    margin: 0 0 var(--gap-label);
    color: var(--fg);
    font-size: var(--text-body);
    line-height: var(--leading-body);
    font-weight: var(--weight-strong);
  }
  /* 첫·끝 행의 바깥 모서리는 그룹 상자와 같이 둥글어야 hover 면이 상자 밖으로 나오지 않는다 */
  .recent-row:first-child {
    border-top-left-radius: var(--radius-group);
    border-top-right-radius: var(--radius-group);
  }
  .recent-row:last-child {
    border-bottom-left-radius: var(--radius-group);
    border-bottom-right-radius: var(--radius-group);
  }
  .recent-row:hover {
    background: var(--surface-2);
  }
  .recent-row:active {
    background: var(--surface-pressed);
  }
</style>
