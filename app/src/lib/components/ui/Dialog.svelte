<script lang="ts">
  import type { Snippet } from 'svelte';
  import { focusables, trapTab } from './focus';

  interface Props {
    open: boolean;
    title: string;
    /** Esc·닫기 = 안전한 쪽(대화상자를 연 동작을 하지 않는다) */
    onclose: () => void;
    children: Snippet;
    actions: Snippet;
  }

  let { open, title, onclose, children, actions }: Props = $props();
  const uid = Math.random().toString(36).slice(2, 9);

  // 열릴 때: 연 요소를 기억하고 [data-autofocus](기본 버튼) 또는 첫 요소로 포커스.
  // 닫힐 때(이 요소가 사라질 때): 연 요소로 되돌린다.
  function trap(box: HTMLElement) {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = box.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(box)[0] ?? box;
    target.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
      return;
    }
    trapTab(e, e.currentTarget as HTMLElement);
  }
</script>

{#if open}
  <div class="scrim">
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dlg-title-{uid}"
      aria-describedby="dlg-body-{uid}"
      tabindex="-1"
      {onkeydown}
      {@attach trap}
    >
      <h2 id="dlg-title-{uid}" class="title">{title}</h2>
      <div id="dlg-body-{uid}" class="body">{@render children()}</div>
      <div class="actions">{@render actions()}</div>
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    display: grid;
    place-items: center;
    padding: var(--space-8);
    background: var(--scrim);
    animation: fade var(--dur-slow) var(--ease-out);
  }
  .dialog {
    width: min(400px, 100%);
    padding: var(--space-5) var(--space-6);
    border-radius: var(--radius-lg);
    background: var(--surface-raised);
    box-shadow: var(--shadow-dialog);
    animation: pop var(--dur-slow) var(--ease-out);
  }
  .dialog:focus {
    outline: none;
  }
  .title {
    margin: 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
  }
  .body {
    margin-top: var(--space-2);
    color: var(--fg-muted);
    font-size: var(--text-md);
    line-height: var(--leading-relaxed);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-5);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.98);
      opacity: 0;
    }
  }
</style>
