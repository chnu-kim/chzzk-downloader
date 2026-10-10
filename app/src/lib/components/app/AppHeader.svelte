<script lang="ts">
  // 앱 머리줄: ui/Toolbar의 start·end 두 칸(components.md §2.25). 계정 Menu·레이아웃 재설계는 (c)의 몫이다.
  import { t } from '../../copy/ko';
  import { auth } from '../../stores/auth.svelte';
  import type { View } from '../../stores/ui.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Toolbar from '../ui/Toolbar.svelte';
  import AccountSlot from './AccountSlot.svelte';

  interface Props {
    view: View;
    /** 로그인 화면이 떠 있거나 첫 상태 전: [설정]·계정 자리를 그리지 않는다 */
    locked: boolean;
    onsettings: () => void;
    onback: () => void;
  }

  let { view, locked, onsettings, onback }: Props = $props();
</script>

<Toolbar>
  {#snippet start()}
    {#if view === 'settings'}
      <IconButton class="edge-start" icon="arrow-left" label={t('header.back')} onclick={onback} />
      <!-- 뷰가 바뀌어 누르던 버튼이 사라지면 App이 이 제목으로 포커스를 옮긴다 -->
      <h1 class="toolbar-title" tabindex="-1" data-focus-container data-view-heading>{t('settings.title')}</h1>
    {:else}
      <span class="app-name">{t('app.title')}</span>
    {/if}
  {/snippet}
  {#snippet end()}
    {#if view === 'home' && !locked && auth.status?.state === 'signedIn'}<AccountSlot status={auth.status} />{/if}
    {#if !locked}
      <IconButton
        class="edge-end"
        icon="settings"
        label={t('header.settings')}
        aria-current={view === 'settings' ? 'page' : undefined}
        data-view-trigger
        onclick={onsettings}
      />
    {/if}
  {/snippet}
</Toolbar>
