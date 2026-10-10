<script lang="ts">
  // 정보 7요소(patterns.md §14.4): 앱 이름 · 버전 · [정보 복사] · 비공식 고지 · 처리방침 · 오픈소스 라이선스, [업데이트 확인] + 결과 한 줄.
  // 저작권 줄은 그리지 않는다(소유자 문구가 정해지지 않았다).
  import { tick, untrack } from 'svelte';
  import * as api from '../../api';
  import type { AppError, AppFolder } from '../../bindings';
  import { t } from '../../copy/ko';
  import { copyAppReport } from '../../report';
  import { auth } from '../../stores/auth.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { ui } from '../../stores/ui.svelte';
  import { update } from '../../stores/update.svelte';
  import { useDelayedLoading } from '../../useDelayedLoading.svelte';
  import Button from '../ui/Button.svelte';
  import { ICON_SET_VERSION } from '../ui/icons';
  import SettingsRow from '../ui/SettingsRow.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let { onerror }: { onerror: (e: AppError) => void } = $props();

  let headingEl: HTMLHeadingElement | null = $state(null);

  // macOS 메뉴 "…에 관하여"(`menu-about`): 설정 화면이 열리면 이 절 제목으로 포커스를 옮기고 보이는 곳으로 스크롤한다.
  // 요청은 한 번 쓰고 비운다(남겨 두면 설정을 다시 열 때마다 이 절로 끌려온다)
  $effect(() => {
    if (!ui.focusAbout || !headingEl) return;
    const el = headingEl;
    untrack(() => (ui.focusAbout = false));
    void tick().then(() => {
      el.focus();
      el.scrollIntoView?.({ block: 'start' });
    });
  });

  const info = $derived(settings.info);
  const loading = useDelayedLoading(() => !settings.info);

  /** [업데이트 확인] 결과 한 줄 */
  const checkText = $derived.by(() => {
    switch (update.check) {
      case 'checking':
        return t('settings.about.checking');
      case 'upToDate':
        return t('settings.about.upToDate');
      case 'failed':
        return t('settings.about.checkFailed');
      case 'offline':
        return t('settings.about.checkOffline');
      case 'untrusted':
        return t('update.untrusted');
      case 'available':
        // 설치 결과 등으로 available이 비었으면 줄을 숨긴다(빈 버전을 보이지 않게)
        return update.available ? t('update.banner', { version: update.available.version }) : '';
      default:
        return '';
    }
  });

  /** 확인 실패 줄 아래 한 줄: 지금 버전은 계속 쓸 수 있다는 안내(`update.failed`의 도움말과 같은 키) */
  const checkHelp = $derived(update.check === 'failed' ? t('common.keepUsing') : '');

  async function openFolder(kind: AppFolder) {
    try {
      await api.openAppFolder(kind);
    } catch (e) {
      onerror(e as AppError);
    }
  }

  async function openPrivacy() {
    try {
      await api.openWebPage('privacy');
    } catch (e) {
      onerror(e as AppError);
    }
  }
</script>

<SettingsSection title={t('settings.about.title')} focusable bind:headingEl>
  <!-- 이름·버전·동작과 업데이트 결과 줄. 결과 줄이 role=status라 SettingsRow 대신 같은 클래스로 직접 짠다 -->
  <div class="row">
    <div class="row-main">
      <span class="row-label">{t('app.title')}</span>
      <span class="row-help num">
        {#if info}
          {t('settings.about.version', { app: info.version })}
        {:else if loading.visible}
          <Skeleton variant="line" width="half" />
        {/if}
      </span>
    </div>
    <div class="row-control">
      {#if auth.signedIn}
        <Button variant="ghost" size="sm" disabled={update.check === 'checking'} onclick={() => void update.checkNow()}>
          {t('settings.about.checkUpdate')}
        </Button>
      {/if}
      <Button variant="ghost" size="sm" class="edge-end" onclick={() => void copyAppReport(info)}>
        {t('action.copyReport')}
      </Button>
    </div>
    {#if auth.signedIn}
      <span class="row-help status" role="status">{checkText}{#if checkHelp}<span class="status-help">{checkHelp}</span>{/if}</span>
    {/if}
  </div>

  <div class="row links">
    {#if info?.features.auth}
      <Button variant="ghost" size="sm" class="edge-start" onclick={() => void openPrivacy()}>{t('auth.privacy')}</Button>
    {/if}
    <Button variant="ghost" size="sm" onclick={() => void openFolder('config')}>{t('common.openConfigFolder')}</Button>
    <Button variant="ghost" size="sm" onclick={() => void openFolder('logs')}>{t('settings.about.openLogs')}</Button>
  </div>

  <SettingsRow label={t('settings.about.licenses')} value={`Lucide ${ICON_SET_VERSION} (ISC)`} class="num" />

  <div class="row">
    <p class="read">{t('notice.unofficial')}</p>
  </div>
</SettingsSection>

<style>
  .status {
    flex: 1 1 100%;
  }
  /* 결과가 없으면 줄이 없는 것처럼 접는다(role=status 자리는 늘 있어야 알림이 읽힌다) */
  .status-help {
    display: block;
  }
  .status:empty {
    margin-block-start: calc(0px - var(--gap-sibling));
  }
  .links {
    gap: var(--space-4);
  }
  .read {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-body);
    line-height: var(--leading-read);
  }
</style>
