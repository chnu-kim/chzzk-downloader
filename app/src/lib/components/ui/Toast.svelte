<script lang="ts">
  // 토스트 하나(components.md §2.13): Notice variant="toast". 오류는 alert, 나머지는 status(Notice가 정한다).
  // 마우스·키보드 포커스가 안에 있는 동안은 수명 타이머를 멈추고, 떠나면 처음부터 다시 센다.
  import { toasts, type ToastCloseReason, type ToastItem } from '../../stores/toast.svelte';
  import Notice from './Notice.svelte';
  import type { NoticeAction } from './vocab';

  interface Props {
    item: ToastItem;
    /** 닫힘. 동작 버튼은 `'action'`, [×]는 인자 없이(= `'dismiss'`) 부른다 */
    onclose: (reason?: ToastCloseReason) => void;
  }

  let { item, onclose }: Props = $props();

  // 동작 버튼은 실행하고 닫는다
  const actions = $derived<NoticeAction[] | undefined>(
    item.action
      ? [
          {
            id: 'action',
            label: item.action.label,
            onclick: () => {
              item.action?.run();
              onclose('action');
            },
          },
        ]
      : undefined,
  );

  let hovered = false;
  let focused = false;
  function sync() {
    if (hovered || focused) toasts.pause(item.id);
    else toasts.resume(item.id);
  }
  const hold = {
    onmouseenter: () => ((hovered = true), sync()),
    onmouseleave: () => ((hovered = false), sync()),
    onfocusin: () => ((focused = true), sync()),
    onfocusout: () => ((focused = false), sync()),
  };
</script>

{#snippet message()}{item.message}{/snippet}

{#if item.kind === 'danger' || item.kind === 'info'}
  <Notice variant="toast" tone={item.kind} {actions} onclose={() => onclose('dismiss')} {...hold}>{@render message()}</Notice>
{:else}
  <!-- 완료·복사: 중립 톤 + 체크 -->
  <Notice variant="toast" tone="neutral" icon="circle-check" {actions} onclose={() => onclose('dismiss')} {...hold}>
    {@render message()}
  </Notice>
{/if}
