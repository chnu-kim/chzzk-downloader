<script lang="ts">
  // 툴바의 계정 자리(signedIn일 때만 그려진다, patterns.md §14.1): 계정 Menu(`trigger="text"`, 채널 이름 ▾)와 오프라인 유예 글자.
  // [로그아웃…]은 확인 대화상자(D4)를 `ui.logoutConfirm`으로 요청할 뿐이다 — 대화상자는 App의 LogoutDialog 하나다.
  import type { AuthStatusDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { formatDateTimeShort } from '../../format/date';
  import { auth } from '../../stores/auth.svelte';
  import { ui } from '../../stores/ui.svelte';
  import Menu, { type MenuItem } from '../ui/Menu.svelte';

  interface Props {
    status: AuthStatusDto;
  }

  let { status }: Props = $props();

  const items = $derived<MenuItem[]>([
    // 온라인 [다시 연결]은 셸이 무시하므로(61) 오프라인일 때만 보인다
    ...(status.offline ? [{ id: 'reconnect', label: t('auth.reconnect'), onclick: () => void auth.reconnect() }] : []),
    // 로그아웃은 다시 로그인하면 복구되므로 파괴 동작(danger)이 아니다(D4 실행 쪽도 neutral)
    { id: 'logout', label: t('account.logout'), onclick: () => (ui.logoutConfirm = true) },
  ]);
</script>

<span class="slot">
  {#if status.offline}
    <!-- 상태 글자는 Badge가 아니다(Badge는 종류 표시만). title 툴팁 대신 풀이는 스크린 리더에게만 읽힌다 -->
    <span class="offline">
      {t('account.offline', { until: formatDateTimeShort(status.offline.graceUntil) })}
      <span class="sr-only">{t('auth.offline.tip')}</span>
    </span>
  {/if}
  <Menu label={t('account.menu')} trigger="text" text={status.channelName ?? t('account.menu')} {items} />
</span>

<style>
  .slot {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
  }
  .offline {
    flex: none;
    color: var(--fg-muted);
  }
</style>
