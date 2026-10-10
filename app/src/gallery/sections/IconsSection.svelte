<svelte:options runes />

<script lang="ts">
  // 아이콘 시트: 아이콘마다 16 · 20 칸(docs/design/system/governance.md §2.5 래스터). gallery.spec이 칸 좌표를 읽어
  // icons-blur.mjs로 번짐을 잰다. 칸은 정확히 16×16·20×20이고 안에는 아이콘뿐이다(바탕이 한 색이어야 잰다).
  import Icon from '../../lib/components/ui/Icon.svelte';
  import { ICONS, type IconName } from '../../lib/components/ui/icons';
  import { TITLE } from '../fixtures';
  import Section from '../Section.svelte';

  const NAMES = Object.keys(ICONS) as IconName[];
</script>

<Section name="icons" heading={TITLE.icons}>
  <div class="sheet">
    {#each NAMES as name (name)}
      <div class="item">
        <span class="cell cell-sm" data-icon="{name}@16"><Icon {name} size="sm" /></span>
        <span class="cell cell-md" data-icon="{name}@20"><Icon {name} size="md" /></span>
        <span class="name ellipsis">{name}</span>
      </div>
    {/each}
  </div>
</Section>

<style>
  .sheet {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-12) var(--space-16);
  }
  .item {
    display: grid;
    grid-template-columns: var(--icon-sm) var(--icon-md) 1fr;
    align-items: center;
    gap: var(--space-8);
    inline-size: calc(var(--space-40) * 4);
    min-inline-size: 0;
  }
  .cell {
    display: block;
    box-sizing: border-box;
    color: var(--fg);
  }
  .cell-sm {
    inline-size: var(--icon-sm);
    block-size: var(--icon-sm);
  }
  .cell-md {
    inline-size: var(--icon-md);
    block-size: var(--icon-md);
  }
  .name {
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--fg-muted);
  }
</style>
