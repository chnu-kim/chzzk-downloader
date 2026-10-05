<script lang="ts">
  import { onMount, tick } from 'svelte';
  import AppBanners from './lib/components/app/AppBanners.svelte';
  import AppHeader from './lib/components/app/AppHeader.svelte';
  import CloseGuard from './lib/components/app/CloseGuard.svelte';
  import GlobalShortcuts from './lib/components/app/GlobalShortcuts.svelte';
  import LiveAnnouncer from './lib/components/app/LiveAnnouncer.svelte';
  import Toaster from './lib/components/app/Toaster.svelte';
  import LegacyFound from './lib/components/settings/LegacyFound.svelte';
  import { jobs } from './lib/stores/jobs.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import HomeView from './lib/views/HomeView.svelte';
  import SettingsView from './lib/views/SettingsView.svelte';

  // 뷰는 셋(home·settings·login)이다. login(S3)은 Phase 3이고 AuthGate가 features.auth로만 연다.
  // Phase 2에는 들어갈 길이 없으므로 아직 그리지 않는다(§12).

  // 뷰가 바뀌면 누르던 버튼(설정·뒤로)이 사라져 포커스가 body로 떨어진다. 설정은 제목, 홈은 입력줄로 옮긴다
  // (§10 접근성: 포커스 복귀). 다른 곳(쿠키 섹션 펼치기 등)이 이미 포커스를 옮겼으면 그대로 둔다.
  let lastView = ui.view;
  $effect(() => {
    const v = ui.view;
    if (v === lastView) return;
    lastView = v;
    void tick().then(() => {
      const a = document.activeElement;
      if (a && a !== document.body) return;
      if (v === 'home') ui.urlTarget?.focus();
      else document.querySelector<HTMLElement>('[data-view-heading]')?.focus();
    });
  });

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
<!-- 대화상자: D1(창 닫기)·D3(이전 설정 찾음)는 여기, D2(취소 확인)는 JobList -->
<CloseGuard />
<LegacyFound />
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
