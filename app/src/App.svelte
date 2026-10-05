<script lang="ts">
  import AppHeader from './lib/components/app/AppHeader.svelte';
  import GlobalShortcuts from './lib/components/app/GlobalShortcuts.svelte';
  import LiveAnnouncer from './lib/components/app/LiveAnnouncer.svelte';
  import Toaster from './lib/components/app/Toaster.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import HomeView from './lib/views/HomeView.svelte';
  import SettingsView from './lib/views/SettingsView.svelte';

  // 뷰는 셋(home·settings·login)이다. login(S3)은 Phase 3이고 AuthGate가 features.auth로만 연다.
  // Phase 2에는 들어갈 길이 없으므로 아직 그리지 않는다(§12).
</script>

<div class="app">
  <AppHeader view={ui.view} onsettings={() => ui.goSettings()} onback={() => ui.goHome()} />
  <!-- AppBanners(B1·B2)는 §15-15·16에서 헤더 바로 아래에 둔다 -->
  <main class="main">
    {#if ui.view === 'settings'}
      <SettingsView />
    {:else}
      <HomeView />
    {/if}
  </main>
</div>
<Toaster />
<LiveAnnouncer />
<GlobalShortcuts />

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .main {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
</style>
