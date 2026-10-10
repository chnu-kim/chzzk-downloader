<script lang="ts">
  // 앱 툴바(system/patterns.md §14.1, components.md §2.28): ui/Toolbar의 start·end 두 칸.
  // 구성은 화면마다 다르되 오른쪽 자리는 흔들리지 않는다.
  //   홈      : 앱 이름                    | 계정 Menu · [⚙]
  //   설정    : [←] + h1 "설정"            | 계정 Menu · [⚙](aria-current="page", 눌러도 아무 일 없음)
  //   로그인  : 앱 이름                    | (비어 있음)
  // 계정 Menu는 로그인한 상태(signedIn)에서만 있다. 로그인을 쓰지 않는 빌드(disabled)는 [⚙]만 있다.
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
    {#if view === 'settings' && !locked}
      <IconButton class="edge-start" icon="arrow-left" label={t('header.back')} onclick={onback} />
      <!-- 뷰가 바뀌어 누르던 버튼이 사라지면 App이 이 제목으로 포커스를 옮긴다 -->
      <h1 class="toolbar-title" tabindex="-1" data-focus-container data-view-heading>{t('settings.title')}</h1>
    {:else}
      <span class="app-name">{t('app.title')}</span>
    {/if}
  {/snippet}
  {#snippet end()}
    {#if !locked}
      {#if auth.status?.state === 'signedIn'}<AccountSlot status={auth.status} />{/if}
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
