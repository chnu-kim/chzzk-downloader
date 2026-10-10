<script lang="ts" module>
  import type { IconName } from './icons';

  export interface MenuItem {
    label: string;
    icon?: IconName;
    /** 파괴 동작("목록에서 지우기"): danger 글자, 맨 아래, 위에 선 */
    danger?: boolean;
    disabled?: boolean;
    onselect: () => void;
  }
</script>

<script lang="ts">
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';

  interface Props {
    /** 메뉴 버튼의 aria-label */
    label: string;
    items: MenuItem[];
  }

  let { label, items }: Props = $props();
  let open = $state(false);
  let trigger: HTMLButtonElement | null = $state(null);
  let list: HTMLElement | null = $state(null);
  const uid = Math.random().toString(36).slice(2, 9);

  // 파괴 항목은 맨 아래로(ui-visual §7)
  const ordered = $derived([...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)]);

  function entries(): HTMLElement[] {
    return list ? [...list.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')] : [];
  }

  function show(focusIndex: number) {
    open = true;
    queueMicrotask(() => {
      const e = entries();
      // 메뉴를 여는 것으로 둘레(목록·항목)가 스크롤되지 않게
      e[(focusIndex + e.length) % e.length]?.focus({ preventScroll: true });
    });
  }

  function hide(returnFocus = true) {
    open = false;
    if (returnFocus) trigger?.focus();
  }

  function select(item: MenuItem) {
    hide();
    item.onselect();
  }

  function onTriggerKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      show(-1);
    }
  }

  function onListKey(e: KeyboardEvent) {
    const e2 = entries();
    const i = e2.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e2[(i + 1) % e2.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e2[(i - 1 + e2.length) % e2.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      e2[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      e2[e2.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      hide(false);
    }
  }

  // 바깥을 누르면 닫는다
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!list?.contains(target) && !trigger?.contains(target)) hide(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
</script>

<span class="menu">
  <IconButton
    bind:el={trigger}
    icon="more"
    {label}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-controls="menu-{uid}"
    onclick={() => (open ? hide() : show(0))}
    onkeydown={onTriggerKey}
  />
  {#if open}
    <div id="menu-{uid}" class="list" role="menu" aria-label={label} tabindex="-1" bind:this={list} onkeydown={onListKey}>
      {#each ordered as item, i (item.label)}
        {#if item.danger && (i === 0 || !ordered[i - 1].danger) && i > 0}
          <div class="sep" role="separator"></div>
        {/if}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="item"
          class:danger={item.danger}
          disabled={item.disabled}
          onclick={() => select(item)}
        >
          {#if item.icon}<Icon name={item.icon} size={16} />{/if}
          <span>{item.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</span>

<style>
  .menu {
    position: relative;
    display: inline-flex;
  }
  .list {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: var(--z-menu);
    min-width: 200px;
    padding: 4px;
    border-radius: var(--radius-md);
    background: var(--surface-raised);
    box-shadow: var(--shadow-menu);
    animation: rise var(--dur-base) var(--ease-out);
  }
  .item {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    width: 100%;
    height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-sm);
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .item:hover:not(:disabled),
  .item:focus-visible {
    background: var(--surface-2);
  }
  .item:disabled {
    color: var(--fg-faint);
    cursor: default;
  }
  .item.danger {
    color: var(--danger);
  }
  .sep {
    height: 1px;
    margin: 4px 0;
    background: var(--border);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
