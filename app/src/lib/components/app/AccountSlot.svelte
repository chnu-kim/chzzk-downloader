<script lang="ts">
  // 헤더의 계정 자리(signedIn일 때만 그려진다): 채널 이름, 오프라인 유예 배지, 계정 메뉴(worker.md 구현 중 변경 A3-1 (바)).
  import type { AuthStatusDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { formatDateTimeShort } from '../../format/date';
  import { auth } from '../../stores/auth.svelte';
  import Badge from '../ui/Badge.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import Menu, { type MenuItem } from '../ui/Menu.svelte';

  interface Props {
    status: AuthStatusDto;
  }

  let { status }: Props = $props();
  let confirmOpen = $state(false);

  const items = $derived<MenuItem[]>([
    // 온라인 [다시 연결]은 셸이 무시하므로(61) 오프라인일 때만 보인다
    ...(status.offline ? [{ label: t('auth.reconnect'), onselect: () => void auth.reconnect() }] : []),
    { label: t('auth.logout'), danger: true, onselect: () => (confirmOpen = true) },
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
    <Badge tone="warning" title={t('auth.offline.tip')}>
      {t('auth.offline.badge', { until: formatDateTimeShort(status.offline.graceUntil) })}
    </Badge>
  {/if}
  <Menu label={t('account.menu')} {items} />
</span>

<ConfirmDialog
  open={confirmOpen}
  title={t('dialog.logout.title')}
  body={t('dialog.logout.body')}
  onclose={() => (confirmOpen = false)}
  buttons={[
    { label: t('dialog.logout.cancel'), variant: 'primary', autofocus: true, onclick: () => (confirmOpen = false) },
    {
      label: t('dialog.logout.confirm'),
      variant: 'secondary',
      disabled: auth.busy,
      onclick: () => {
        confirmOpen = false;
        void auth.logout();
      },
    },
  ]}
/>

<style>
  .slot {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
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
</style>
