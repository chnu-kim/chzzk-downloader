<script lang="ts">
  import { toasts } from '../../stores/toast.svelte';
  import Toast from '../ui/Toast.svelte';
</script>

<div class="toaster">
  {#each toasts.items as item (item.id)}
    <Toast
      {item}
      ondismiss={() => toasts.dismiss(item.id)}
      onpause={() => toasts.pause(item.id)}
      onresume={() => toasts.resume(item.id)}
    />
  {/each}
</div>

<style>
  /* 오른쪽 아래, 쌓이면 위로 */
  .toaster {
    position: fixed;
    right: var(--gutter);
    bottom: var(--gutter);
    z-index: var(--z-toast);
    display: flex;
    flex-direction: column-reverse;
    gap: var(--space-2);
    pointer-events: none;
  }
  .toaster > :global(*) {
    pointer-events: auto;
  }
</style>
