<script lang="ts">
  import { t } from '../../copy/ko';
  import type { View } from '../../stores/ui.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';

  interface Props {
    view: View;
    onsettings: () => void;
    onback: () => void;
  }

  let { view, onsettings, onback }: Props = $props();
</script>

<header class="header">
  {#if view === 'settings'}
    <IconButton icon="arrow-left" size="md" label={t('header.back')} onclick={onback} />
    <!-- 뷰가 바뀌어 누르던 버튼이 사라지면 App이 이 제목으로 포커스를 옮긴다 -->
    <h1 class="title settings" tabindex="-1" data-view-heading>{t('settings.title')}</h1>
  {:else}
    <span class="mark"><Icon name="drop" size={16} /></span>
    <h1 class="title">{t('app.title')}</h1>
    <!-- AccountSlot(Phase 3): features.auth가 꺼져 있으면 노드를 두지 않는다 -->
    <span class="spacer"></span>
    {#if view === 'home'}
      <IconButton icon="settings" size="md" label={t('header.settings')} onclick={onsettings} />
    {/if}
  {/if}
</header>

<style>
  .header {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: var(--header-h);
    padding: 0 var(--space-2) 0 var(--gutter);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .mark {
    color: var(--accent);
  }
  .title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
  }
  .title.settings {
    font-size: var(--text-xl);
  }
  .header:has(.title.settings) {
    padding-left: var(--space-2);
  }
  .spacer {
    flex: 1;
  }
  @media (min-width: 840px) {
    .header {
      padding-left: var(--gutter-wide);
    }
  }
  .title:focus {
    outline: none;
  }
</style>
