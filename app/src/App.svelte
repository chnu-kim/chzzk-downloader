<script lang="ts">
  import { onMount } from 'svelte';
  import AppBanners from './lib/components/app/AppBanners.svelte';
  import AppHeader from './lib/components/app/AppHeader.svelte';
  import GlobalShortcuts from './lib/components/app/GlobalShortcuts.svelte';
  import LiveAnnouncer from './lib/components/app/LiveAnnouncer.svelte';
  import Toaster from './lib/components/app/Toaster.svelte';
  import { jobs } from './lib/stores/jobs.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import HomeView from './lib/views/HomeView.svelte';
  import SettingsView from './lib/views/SettingsView.svelte';

  // 뷰는 셋(home·settings·login)이다. login(S3)은 Phase 3이고 AuthGate가 features.auth로만 연다.
  // Phase 2에는 들어갈 길이 없으므로 아직 그리지 않는다(§12).

  onMount(() => {
    void settings.load();
    // 앱 수명 동안 구독 하나(§0). 웹뷰를 새로 고치면 여기서 다시 구독하고 스냅샷으로 맞춘다.
    void jobs.start();
  });
</script>

<div class="app">
  <AppHeader view={ui.view} onsettings={() => ui.goSettings()} onback={() => ui.goHome()} />
  <AppBanners />
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
