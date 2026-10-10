<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { DialogAction } from './vocab';

  export interface DialogProps {
    open: boolean;
    title: string;
    /** 오른쪽 끝 · 채움 · 기본 포커스 · 안전한 쪽(아무것도 바꾸지 않는 결과). `loading`은 진행 중인 동작을 막는다 */
    primary: DialogAction & { loading?: boolean };
    /** 왼쪽 · 실행 쪽. danger면 버튼 줄 왼쪽 끝으로 간다 */
    secondary?: DialogAction & { tone?: 'neutral' | 'danger'; loading?: boolean };
    /** Esc·닫기: 어떤 동작도 부르지 않고 닫기만 한다(결과는 primary와 같다) */
    onclose: () => void;
    children?: Snippet;
  }

  // 모달 둘 겹침 금지(components.md §2.10): 뒤에 온 대화상자는 먼저 것이 닫힐 때까지 기다린다
  interface Slot {
    grant: () => void;
  }
  let holder: Slot | null = null;
  const pending: Slot[] = [];

  function acquire(slot: Slot) {
    if (holder) pending.push(slot);
    else {
      holder = slot;
      slot.grant();
    }
  }

  function release(slot: Slot) {
    if (holder === slot) {
      holder = pending.shift() ?? null;
      holder?.grant();
    } else {
      const i = pending.indexOf(slot);
      if (i >= 0) pending.splice(i, 1);
    }
  }
</script>

<script lang="ts">
  import { untrack } from 'svelte';
  import Button from './Button.svelte';
  import { enterMotion, isImeKey, leaveMotion, trapTab } from './focus';

  let { open, title, primary, secondary, onclose, children }: DialogProps = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;

  // visible: 실제로 DOM에 있다(대기열을 통과했고 퇴장이 끝나지 않았다)
  let visible = $state(false);
  let primaryEl = $state<HTMLButtonElement | null>(null);
  let box = $state<HTMLElement | null>(null);
  let scrimEl: HTMLElement | null = null;
  let held = false;
  let attached = false;

  // 본문이 넘쳐 스크롤될 때만 키보드로 닿게 한다(axe scrollable-region-focusable)
  function scrollable(el: HTMLElement) {
    const update = () => {
      if (el.scrollHeight > el.clientHeight) el.tabIndex = 0;
      else el.removeAttribute('tabindex');
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }
  let cancelLeave: (() => void) | null = null;
  let leaving = false;

  const slot: Slot = {
    grant: () => {
      visible = true;
    },
  };

  $effect(() => {
    const wantOpen = open;
    untrack(() => {
      if (wantOpen) {
        // 퇴장 중에 다시 열렸으면 퇴장을 취소한다
        if (leaving) {
          cancelLeave?.();
          leaving = false;
          cancelLeave = null;
        }
        if (!held) {
          held = true;
          acquire(slot);
        }
      } else if (held) {
        if (!visible || !scrimEl) {
          // 아직 뜨지 못한 채 닫혔다
          visible = false;
          held = false;
          release(slot);
        } else if (!leaving) {
          leaving = true;
          const cancel = leaveMotion(scrimEl, () => {
            leaving = false;
            cancelLeave = null;
            visible = false; // DOM이 떨어지면 layer 정리가 슬롯을 놓는다
          });
          if (leaving) cancelLeave = cancel;
        }
      }
    });
  });

  // 대화상자가 통째로 사라질 때 대기열에서 빠진다
  $effect(() => () => {
    cancelLeave?.();
    if (!attached) release(slot);
  });

  /**
   * `.scrim`을 body 직속으로 옮기고 열린 동안 body의 다른 자식을 inert로 만든다.
   * 정리: inert 복원 → 연 요소로 포커스 복귀 → 슬롯 반납(다음 대기 대화상자가 뜬다).
   */
  function layer(el: HTMLElement) {
    scrimEl = el;
    attached = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.append(el);
    const others: Array<[Element, string | null]> = [];
    for (const child of document.body.children) {
      if (child === el) continue;
      others.push([child, child.getAttribute('inert')]);
      child.setAttribute('inert', '');
    }
    const stopEnter = enterMotion(el);
    // 열리면 늘 primary에 포커스(:focus-visible 휴리스틱에 맡긴다)
    queueMicrotask(() => (primaryEl ?? box)?.focus());
    return () => {
      stopEnter();
      for (const [child, prev] of others) {
        if (prev === null) child.removeAttribute('inert');
        else child.setAttribute('inert', prev);
      }
      el.remove();
      scrimEl = null;
      attached = false;
      if (opener?.isConnected) opener.focus();
      held = false;
      release(slot);
    };
  }

  function onkeydown(e: KeyboardEvent) {
    if (isImeKey(e)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
      return;
    }
    // 포커스가 버튼이 아닐 때 Enter는 아무것도 하지 않는다(버튼 위 Enter는 네이티브 클릭)
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      return;
    }
    trapTab(e, e.currentTarget as HTMLElement);
  }
</script>

{#if visible}
  <div class="scrim" {@attach layer}>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      tabindex="-1"
      data-focus-container
      bind:this={box}
      {onkeydown}
    >
      <h2 id={titleId}>{title}</h2>
      {#if children}<div class="dialog-body" id={bodyId} {@attach scrollable}>{@render children()}</div>{/if}
      <div class="actions">
        {#if secondary}
          <Button
            variant="secondary"
            tone={secondary.tone ?? 'neutral'}
            loading={secondary.loading}
            onclick={secondary.onclick}
          >
            {secondary.label}
          </Button>
        {/if}
        <Button variant="primary" bind:el={primaryEl} loading={primary.loading} onclick={primary.onclick}>
          {primary.label}
        </Button>
      </div>
    </div>
  </div>
{/if}
