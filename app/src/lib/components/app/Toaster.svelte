<script lang="ts">
  // 토스트 띠(components.md §2.13): 한 번에 하나만 보인다.
  // store에서 빠진 토스트는 퇴장 전환이 끝난 뒤에 떼어 내고, 그다음 대기열의 토스트를 띄운다.
  import { untrack } from 'svelte';
  import { toasts, type ToastItem } from '../../stores/toast.svelte';
  import { leaveMotion } from '../ui/focus';
  import Toast from '../ui/Toast.svelte';

  let shown = $state<ToastItem | null>(null);
  let wrap = $state<HTMLElement | null>(null);
  let leavingId: number | null = null;
  let cancelLeave: (() => void) | null = null;

  $effect(() => {
    const cur = toasts.current;
    untrack(() => {
      if (cur?.id === shown?.id) return;
      if (!shown) {
        shown = cur;
        return;
      }
      if (leavingId === shown.id) return; // 이미 나가는 중: 끝나면 그때의 현재 토스트를 띄운다
      const el = wrap?.querySelector<HTMLElement>('.notice-toast');
      leavingId = shown.id;
      const done = () => {
        leavingId = null;
        cancelLeave = null;
        shown = toasts.current;
      };
      if (el) cancelLeave = leaveMotion(el, done);
      else done();
    });
  });

  $effect(() => () => cancelLeave?.());
</script>

<div class="toaster">
  <div class="col">
    {#if shown}
      {@const item = shown}
      <div bind:this={wrap}>
        {#key item.id}
          <Toast {item} onclose={(reason) => toasts.dismiss(item.id, reason)} />
        {/key}
      </div>
    {/if}
  </div>
</div>
