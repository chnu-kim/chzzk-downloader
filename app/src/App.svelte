<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { onMenuAbout, onMenuSettings, onWindowFocus } from './lib/api';
  import { applyWindowActive } from './lib/appearance';
  import AppBanners from './lib/components/app/AppBanners.svelte';
  import AppHeader from './lib/components/app/AppHeader.svelte';
  import CloseGuard from './lib/components/app/CloseGuard.svelte';
  import GlobalShortcuts from './lib/components/app/GlobalShortcuts.svelte';
  import LiveAnnouncer from './lib/components/app/LiveAnnouncer.svelte';
  import LogoutDialog from './lib/components/app/LogoutDialog.svelte';
  import Toaster from './lib/components/app/Toaster.svelte';
  import UpdateDialog from './lib/components/app/UpdateDialog.svelte';
  import LegacyFound from './lib/components/settings/LegacyFound.svelte';
  import PageContainer from './lib/components/ui/PageContainer.svelte';
  import { t } from './lib/copy/ko';
  import { auth } from './lib/stores/auth.svelte';
  import { jobs } from './lib/stores/jobs.svelte';
  import { platform } from './lib/stores/platform.svelte';
  import { power } from './lib/stores/power.svelte';
  import { settings } from './lib/stores/settings.svelte';
  import { toasts } from './lib/stores/toast.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import { update } from './lib/stores/update.svelte';
  import HomeView from './lib/views/HomeView.svelte';
  import LoginView from './lib/views/LoginView.svelte';
  import SettingsView from './lib/views/SettingsView.svelte';

  // 뷰는 둘(home·settings)이다. 로그인 화면은 뷰가 아니라 게이트 분기다(worker.md 구현 중 변경 62):
  // 로그인 상태가 잠겨 있으면 뷰와 무관하게 LoginView만 그린다(단축키·Esc로 둘러 갈 수 없다).

  // 뷰가 바뀌면 누르던 버튼(뒤로)이 사라져 포커스가 body로 떨어진다. 설정 [⚙]은 설정 화면에도 남아
  // (aria-current="page") 포커스를 쥐고 있으니 그 경우도 같다. 설정은 제목, 홈은 입력줄로 옮긴다
  // (§10 접근성: 포커스 복귀). 다른 곳(쿠키 섹션 펼치기 등)이 이미 포커스를 옮겼으면 그대로 둔다.
  let lastView = ui.view;
  $effect(() => {
    const v = ui.view;
    if (v === lastView) return;
    lastView = v;
    void tick().then(() => {
      const a = document.activeElement;
      if (a && a !== document.body && !a.hasAttribute('data-view-trigger')) return;
      if (v === 'home') ui.urlTarget?.focus();
      else document.querySelector<HTMLElement>('[data-view-heading]')?.focus();
    });
  });

  onMount(() => {
    // 앱 수명 동안 구독 하나씩(§0). 웹뷰를 새로 고치면 여기서 다시 구독하고 스냅샷으로 맞춘다.
    // 로그인 상태는 먼저 듣고 그다음 묻는다(auth.start). 작업 구독은 게이트 허용 목록이라 바로 한다.
    let off: (() => void) | null = null;
    let gone = false;
    // OS·저장된 글자 크기·모양은 로그인 전에도 필요하다(app_info는 gate 허용 목록)
    void settings.loadInfo();
    // 비활성 창(platform.md §3): Rust `window-focus` → <html data-window-active>(macOS만)
    ui.windowFocused = document.hasFocus();
    let offFocus: (() => void) | null = null;
    void onWindowFocus((f) => {
      ui.windowFocused = f;
      applyWindowActive(document.documentElement, f, platform.os);
    }).then((f) => {
      if (gone) f();
      else offFocus = f;
    });
    // macOS 메뉴(platform.md §7): "설정…"은 설정 화면으로, "…에 관하여"는 설정의 정보 절로. 로그인 화면이 잠겨 있으면
    // 화면을 바꾸지 않는다(`ui.view`는 잠금과 무관하지만 App이 LoginView만 그리고, 풀리면 그 화면으로 열린다)
    const offs: (() => void)[] = [];
    const listen = (p: Promise<() => void>) =>
      void p.then((f) => {
        if (gone) f();
        else offs.push(f);
      });
    listen(onMenuSettings(() => ui.goSettings()));
    listen(onMenuAbout(() => ui.goSettings({ about: true })));
    // 잠자기 방지 표시(platform.md §15): 보호를 실제로 얻었을 때만 true
    listen(power.start());
    void auth.start().then((f) => {
      if (gone) f();
      else off = f;
    });
    // 업데이트 이벤트도 같다: 듣고 나서(update.sync) 자동 확인이 찾아 둔 캐시를 묻는다
    let offUpdate: (() => void) | null = null;
    void update.start().then((f) => {
      if (gone) f();
      else offUpdate = f;
    });
    void jobs.start();
    return () => {
      gone = true;
      off?.();
      offUpdate?.();
      offFocus?.();
      for (const f of offs) f();
    };
  });

  // OS가 app_info로 정해지면(또는 바뀌면) 지금 포커스 상태를 다시 옮긴다
  $effect(() => {
    const os = platform.os;
    untrack(() => applyWindowActive(document.documentElement, document.hasFocus(), os));
  });

  // 로그인 성공 토스트(patterns.md §13-7): 이 실행에서 브라우저 로그인(pending)을 거쳐 signedIn이 됐을 때 한 번만.
  // 시작할 때의 저장 세션 확인(checking → signedIn)이나 [다시 연결]은 로그인이 아니라 알리지 않는다.
  let loginInFlight = false;
  $effect(() => {
    const st = auth.status;
    if (!st) return;
    untrack(() => {
      if (st.state === 'pending') loginInFlight = true;
      else if (st.state === 'signedIn') {
        if (loginInFlight && st.channelName) toasts.push(t('toast.signedIn', { channelName: st.channelName }), 'success');
        loginInFlight = false;
      } else if (st.state !== 'checking') loginInFlight = false;
    });
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
    // 로그인한 사용자만 업데이트를 본다(update_*는 게이트 허용 목록 밖이고 disabled 빌드에는 업데이트가 없다)
    if (u && !wasUnlocked && auth.signedIn) void untrack(() => update.sync());
    if (l) {
      untrack(() => {
        ui.goHome();
        // 잠기는 순간 D4 요청을 접는다(다시 로그인했을 때 대화상자가 되살아나지 않게)
        ui.logoutConfirm = false;
      });
    }
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
  <!-- .main이 스크롤 영역이고 열(PageContainer)은 App이 소유한다: 뷰는 자기 열·좌우 패딩을 두지 않는다.
       카드까지 이 사이 어떤 조상에도 overflow를 두지 않는다(sticky 입력줄·카드 바닥이 깨진다, patterns.md §9 F-7) -->
  <main class="main" class:has-toast={toasts.current !== null}>
    <PageContainer>
      <!-- 배너는 열의 첫 요소. 로그인 화면이 열린 동안은 꺼진다(patterns.md §1.4) -->
      {#if auth.unlocked}<AppBanners />{/if}
      {#if !auth.ready}
        <!-- 첫 로그인 상태 전: 아무것도 그리지 않는다(게이트 뒤 command를 부르지 않게) -->
      {:else if auth.locked}
        <LoginView />
      {:else if ui.view === 'settings'}
        <SettingsView />
      {:else}
        <HomeView />
      {/if}
    </PageContainer>
  </main>
</div>
<!-- 대화상자: D1(창 닫기)·D3(이전 설정 찾음)·D4(로그아웃)·D5(업데이트)는 여기, D2(취소 확인)·D7(덮어쓰기)는 목록·카드 -->
<CloseGuard />
{#if auth.unlocked}<LegacyFound />{/if}
{#if auth.unlocked}<UpdateDialog />{/if}
{#if auth.unlocked}<LogoutDialog />{/if}
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
    /* sticky 입력줄이 포커스를 가리지 않게(툴바는 이 영역 밖이라 계산에 없다) */
    scroll-padding-top: calc(var(--control-h) + var(--space-8));
  }
  /* 토스트가 떠 있는 동안 마지막 행의 버튼이 가려지지 않게 바닥 여백(시각·포커스 모두) */
  .main.has-toast {
    padding-bottom: calc(var(--row-h) + 2 * var(--edge));
    scroll-padding-bottom: calc(var(--row-h) + 2 * var(--edge));
  }
</style>
