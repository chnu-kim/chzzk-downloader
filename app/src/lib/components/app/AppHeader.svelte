<script lang="ts">
  import { t } from '../../copy/ko';
  import { auth } from '../../stores/auth.svelte';
  import type { View } from '../../stores/ui.svelte';
  import AccountSlot from './AccountSlot.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';

  interface Props {
    view: View;
    /** 로그인 화면이 떠 있거나 첫 상태 전: [설정]·계정 자리를 그리지 않는다 */
    locked: boolean;
    onsettings: () => void;
    onback: () => void;
  }

  let { view, locked, onsettings, onback }: Props = $props();
</script>

<header class="header">
  {#if view === 'settings'}
    <IconButton icon="arrow-left" size="md" label={t('header.back')} onclick={onback} />
    <!-- 뷰가 바뀌어 누르던 버튼이 사라지면 App이 이 제목으로 포커스를 옮긴다 -->
    <h1 class="title settings" tabindex="-1" data-view-heading>{t('settings.title')}</h1>
  {:else}
    <span class="mark"><Icon name="drop" size={16} /></span>
    <h1 class="title">{t('app.title')}</h1>
    <span class="spacer"></span>
    {#if !locked && auth.status?.state === 'signedIn'}<AccountSlot status={auth.status} />{/if}
    {#if view === 'home' && !locked}
      <IconButton icon="settings" size="md" label={t('header.settings')} onclick={onsettings} />
    {/if}
  {/if}
</header>

<style>
  .header {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-8);
    height: var(--header-h);
    padding: 0 var(--space-8) 0 var(--gutter);
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
    padding-left: var(--space-8);
  }
  .spacer {
    flex: 1;
  }
  @media (min-width: 840px) {
    .header {
      padding-left: var(--gutter-wide);
    }
  }
  /* 뷰 전환·지운 뒤 프로그램으로 주는 포커스라 링을 보이지 않는다(전역 :focus-visible은 box-shadow다) */
  .title:focus {
    outline: none;
    box-shadow: none;
  }
</style>
