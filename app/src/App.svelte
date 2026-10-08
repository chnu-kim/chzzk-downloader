<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import AppBanners from './lib/components/app/AppBanners.svelte';
  import AppHeader from './lib/components/app/AppHeader.svelte';
  import CloseGuard from './lib/components/app/CloseGuard.svelte';
  import GlobalShortcuts from './lib/components/app/GlobalShortcuts.svelte';
  import LiveAnnouncer from './lib/components/app/LiveAnnouncer.svelte';
  import Toaster from './lib/components/app/Toaster.svelte';
  import LegacyFound from './lib/components/settings/LegacyFound.svelte';
  import { auth } from './lib/stores/auth.svelte';
  import { jobs } from './lib/stores/jobs.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import HomeView from './lib/views/HomeView.svelte';
  import LoginView from './lib/views/LoginView.svelte';
  import SettingsView from './lib/views/SettingsView.svelte';

  // 뷰는 둘(home·settings)이다. 로그인 화면은 뷰가 아니라 게이트 분기다(worker.md 구현 중 변경 62):
  // 로그인 상태가 잠겨 있으면 뷰와 무관하게 LoginView만 그린다(단축키·Esc로 둘러 갈 수 없다).

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
    // 앱 수명 동안 구독 하나씩(§0). 웹뷰를 새로 고치면 여기서 다시 구독하고 스냅샷으로 맞춘다.
    // 로그인 상태는 먼저 듣고 그다음 묻는다(auth.start). 작업 구독은 게이트 허용 목록이라 바로 한다.
    let off: (() => void) | null = null;
    let gone = false;
    void auth.start().then((f) => {
      if (gone) f();
      else off = f;
    });
    void jobs.start();
    return () => {
      gone = true;
      off?.();
    };
  });

  // 잠금이 풀릴 때마다 설정을 다시 읽는다(get_settings는 게이트 뒤, app.md 구현 중 변경 60 (3)).
  // 잠기면 다시 열릴 때 홈부터 보이게 한다. 잠금이 풀리면(로그인 성공) 누르던 로그인 화면이 사라져
  // 포커스가 body로 떨어지니 홈 입력줄로 옮긴다(뷰 전환과 같은 규칙: 이미 다른 곳에 있으면 그대로).
  let wasUnlocked = false;
  let wasLocked = false;
  $effect(() => {
    const u = auth.unlocked;
    const l = auth.locked;
    if (u && !wasUnlocked) void untrack(() => settings.load());
    if (l) untrack(() => ui.goHome());
    if (u && wasLocked) {
      void tick().then(() => {
        const a = document.activeElement;
        if (a && a !== document.body) return;
        ui.urlTarget?.focus();
      });
    }
    wasUnlocked = u;
    wasLocked = l;
  });
</script>

<div class="app">
  <AppHeader view={ui.view} locked={!auth.unlocked} onsettings={() => ui.goSettings()} onback={() => ui.goHome()} />
  {#if auth.unlocked}<AppBanners />{/if}
  <main class="main">
    {#if !auth.ready}
      <!-- 첫 로그인 상태 전: 아무것도 그리지 않는다(게이트 뒤 command를 부르지 않게) -->
    {:else if auth.locked}
      <LoginView />
    {:else if ui.view === 'settings'}
      <SettingsView />
    {:else}
      <HomeView />
    {/if}
  </main>
</div>
<!-- 대화상자: D1(창 닫기)·D3(이전 설정 찾음)는 여기, D2(취소 확인)는 JobList -->
<CloseGuard />
{#if auth.unlocked}<LegacyFound />{/if}
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
