<script lang="ts">
  import { t } from '../../copy/ko';
  import type { ToastItem } from '../../stores/toast.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import type { IconName } from './icons';

  interface Props {
    item: ToastItem;
    ondismiss: () => void;
    onpause: () => void;
    onresume: () => void;
  }

  let { item, ondismiss, onpause, onresume }: Props = $props();

  const ICON: Record<ToastItem['kind'], IconName> = {
    success: 'check',
    copied: 'copy',
    danger: 'alert',
    info: 'info',
  };
</script>

<!-- 실패는 놓치지 않게 role=alert(§10), 나머지는 role=status. 마우스·키보드가 안에 있으면 사라지지 않는다 -->
<div
  class="toast"
  role={item.kind === 'danger' ? 'alert' : 'status'}
  onmouseenter={onpause}
  onmouseleave={onresume}
  onfocusin={onpause}
  onfocusout={onresume}
>
  <span class="icon {item.kind}"><Icon name={ICON[item.kind]} /></span>
  <p class="msg">{item.message}</p>
  {#if item.action}
    {@const action = item.action}
    <Button
      size="sm"
      onclick={() => {
        ondismiss();
        action.run();
      }}>{action.label}</Button
    >
  {/if}
  <IconButton icon="x" label={t('common.close')} onclick={ondismiss} />
</div>

<style>
  .toast {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    width: 360px;
    max-width: calc(100vw - 2 * var(--gutter));
    padding: var(--space-12) var(--space-8) var(--space-12) var(--space-16);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    box-shadow: var(--shadow-toast);
    animation: rise var(--dur-base) var(--ease-out);
  }
  .icon {
    flex: none;
    padding-top: 1px;
  }
  .success {
    color: var(--success);
  }
  .copied,
  .info {
    color: var(--fg-muted);
  }
  .danger {
    color: var(--danger);
  }
  .msg {
    flex: 1;
    margin: 0;
    padding-top: 2px;
    font-size: var(--text-md);
    color: var(--fg);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
