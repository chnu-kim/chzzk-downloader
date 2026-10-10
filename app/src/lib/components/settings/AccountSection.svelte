<script lang="ts">
  // 계정: 채널 이름 / 허가 범위·마지막 확인(또는 오프라인) / [로그아웃…](patterns.md §14.4).
  // 로그아웃 확인(D4)은 App의 LogoutDialog가 맡고, 여기서는 요청 플래그만 올린다.
  import { whenText } from '../../when';
  import { t } from '../../copy/ko';
  import { auth } from '../../stores/auth.svelte';
  import { ui } from '../../stores/ui.svelte';
  import Button from '../ui/Button.svelte';
    import SettingsSection from './SettingsSection.svelte';

  const status = $derived(auth.status);
  const state = $derived(
    status?.offline
      ? t('account.offline', { until: whenText(status.offline.graceUntil, Date.now()) })
      : status?.verifiedAt != null
        ? t('account.lastSeen', { time: whenText(status.verifiedAt, Date.now()) })
        : '',
  );
</script>

{#if auth.signedIn}
  <SettingsSection title={t('settings.account')}>
    <!-- 도움말이 "범위 · 마지막 확인" 두 조각이라 SettingsRow의 문자열 help 대신 같은 클래스로 짠다 -->
    <div class="row">
      <div class="row-main">
        <span class="row-label" id="l-account">{status?.channelName ?? t('settings.account')}</span>
        <span class="row-help">
          {t('account.scope')}
          {#if state}<span aria-hidden="true">{' · '}</span>{state}{/if}
        </span>
      </div>
      <div class="row-control">
        <Button variant="ghost" size="sm" class="edge-end" aria-describedby="l-account" onclick={() => (ui.logoutConfirm = true)}>
          {t('account.logout')}
        </Button>
      </div>
    </div>
  </SettingsSection>
{/if}
