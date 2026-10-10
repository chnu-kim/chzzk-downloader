<script lang="ts" module>
  import type { IconName } from './icons';
  import type { NameProps, Size } from './vocab';

  export interface MenuItem {
    id: string;
    label: string;
    icon?: IconName;
    /** danger: 파괴 동작("목록에서 지우기"). 글자가 danger이고 맨 아래, 위에 선 */
    tone?: 'neutral' | 'danger';
    disabled?: boolean;
    onclick: () => void;
  }

  export type MenuProps = Extract<NameProps, { label: string }> & {
    items: MenuItem[];
    size?: Exclude<Size, 'lg'>;
    el?: HTMLButtonElement | null;
  } & (
      | { trigger?: 'icon'; icon?: 'ellipsis' | 'settings'; text?: never }
      | { trigger: 'text'; text: string; icon?: never }
    );
</script>

<script lang="ts">
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import { enterMotion, isImeKey } from './focus';

  let {
    label,
    items,
    size = 'md',
    el = $bindable(null),
    trigger = 'icon',
    icon = 'ellipsis',
    text = '',
  }: MenuProps = $props();

  const uid = $props.id();
  const panelId = `${uid}-menu`;

  let open = $state(false);
  let list: HTMLElement | null = $state(null);
  let placement = $state<'bottom' | 'top'>('bottom');

  // 위험 항목은 맨 아래로(components.md §2.9)
  const ordered = $derived([
    ...items.filter((i) => i.tone !== 'danger'),
    ...items.filter((i) => i.tone === 'danger'),
  ]);

  function entries(): HTMLElement[] {
    return list ? [...list.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
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
    placement = 'bottom';
    if (returnFocus) el?.focus();
  }

  function select(item: MenuItem) {
    // aria-disabled 항목은 포커스는 받지만 실행하지 않는다
    if (item.disabled) return;
    hide();
    item.onclick();
  }

  function onTriggerKey(e: KeyboardEvent) {
    if (isImeKey(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      show(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      show(-1);
    }
  }

  function onListKey(e: KeyboardEvent) {
    if (isImeKey(e)) return;
    const all = entries();
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      hide();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      all[(i + 1) % all.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      all[(i - 1 + all.length) % all.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      all[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      all[all.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      hide(false);
    }
  }

  // 창 밖으로 나가면 위로 뒤집는다(JS 측정). 등장 전환은 enterMotion
  function place(panel: HTMLElement) {
    const rect = panel.getBoundingClientRect();
    const triggerRect = el?.getBoundingClientRect();
    if (triggerRect && rect.bottom > window.innerHeight && triggerRect.top - rect.height >= 0) placement = 'top';
    return enterMotion(panel);
  }

  // 바깥을 누르면 닫는다
  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!list?.contains(target) && !el?.contains(target)) hide(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  });
</script>

<span class="menu-wrap">
  {#if trigger === 'text'}
    <!-- 보이는 글자가 이름이다. 패널 이름은 label -->
    <Button
      bind:el
      variant="ghost"
      {size}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={panelId}
      onclick={() => (open ? hide() : show(0))}
      onkeydown={onTriggerKey}
    >
      {text}
      <Icon name="chevron-down" size="sm" />
    </Button>
  {:else}
    <IconButton
      bind:el
      {icon}
      {label}
      {size}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={panelId}
      onclick={() => (open ? hide() : show(0))}
      onkeydown={onTriggerKey}
    />
  {/if}
  {#if open}
    <div
      id={panelId}
      class="menu"
      role="menu"
      aria-label={label}
      tabindex="-1"
      data-placement={placement === 'top' ? 'top' : undefined}
      bind:this={list}
      onkeydown={onListKey}
      {@attach place}
    >
      {#each ordered as item, i (item.id)}
        {#if item.tone === 'danger' && i > 0 && ordered[i - 1].tone !== 'danger'}
          <hr class="menu-separator" />
        {/if}
        <button
          type="button"
          role="menuitem"
          tabindex="-1"
          class="menu-item {item.tone === 'danger' ? 'tone-danger' : ''}"
          aria-disabled={item.disabled ? 'true' : undefined}
          onclick={() => select(item)}
        >
          {#if item.icon}<Icon name={item.icon} size="sm" />{/if}
          <span>{item.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</span>
