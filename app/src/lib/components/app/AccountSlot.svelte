<script lang="ts">
  // 헤더의 계정 자리(signedIn일 때만 그려진다): 채널 이름, 오프라인 유예 배지, 계정 메뉴(worker.md 구현 중 변경 62 (바)).
  import type { AuthStatusDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { formatDateTimeShort } from '../../format/date';
  import { auth } from '../../stores/auth.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import Menu, { type MenuItem } from '../ui/Menu.svelte';

  interface Props {
    status: AuthStatusDto;
  }

  let { status }: Props = $props();
  let confirmOpen = $state(false);

  const items = $derived<MenuItem[]>([
    // 온라인 [다시 연결]은 셸이 무시하므로(61) 오프라인일 때만 보인다
    ...(status.offline ? [{ id: 'reconnect', label: t('auth.reconnect'), onclick: () => void auth.reconnect() }] : []),
    { id: 'logout', label: t('auth.logout'), tone: 'danger' as const, onclick: () => (confirmOpen = true) },
  ]);
</script>

<span class="slot">
  <span
    class="name"
    title={status.verifiedAt ? t('account.lastVerified', { time: formatDateTimeShort(status.verifiedAt) }) : undefined}
  >
    {status.channelName ?? ''}
  </span>
  {#if status.offline}
    <!-- 상태 글자는 Badge가 아니다(Badge는 종류 표시만): 지역 스타일 글자 -->
    <span class="offline" title={t('auth.offline.tip')}>
      {t('auth.offline.badge', { until: formatDateTimeShort(status.offline.graceUntil) })}
    </span>
  {/if}
  <Menu label={t('account.menu')} {items} />
</span>

<ConfirmDialog
  open={confirmOpen}
  title={t('dialog.logout.title')}
  body={t('dialog.logout.body')}
  onclose={() => (confirmOpen = false)}
  primary={{ id: 'keep', label: t('dialog.logout.cancel'), onclick: () => (confirmOpen = false) }}
  secondary={{
    id: 'logout',
    label: t('dialog.logout.confirm'),
    loading: auth.isBusy('logout'),
    onclick: () => {
      confirmOpen = false;
      void auth.logout();
    },
  }}
/>

<style>
  .slot {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
  }
  .name {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--fg-muted);
  }
  .offline {
    flex: none;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
</style>
