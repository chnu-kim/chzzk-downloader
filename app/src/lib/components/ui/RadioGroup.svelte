<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  interface Props {
    items: readonly T[];
    /** 고른 항목의 번호 */
    selected: number;
    /** 묶음 이름(라벨 요소의 id) */
    labelledby: string;
    /** 행 하나의 내용 */
    row: Snippet<[T, boolean]>;
    onchange?: (index: number) => void;
  }

  let { items, selected = $bindable(), labelledby, row, onchange }: Props = $props();
  let rows: HTMLElement[] = $state([]);

  function choose(i: number, focus = false) {
    if (i < 0 || i >= items.length) return;
    if (i !== selected) {
      selected = i;
      onchange?.(i);
    }
    if (focus) rows[i]?.focus();
  }

  // ↑↓(←→)로 옮기면 선택이 바로 바뀐다. 끝에서는 반대쪽으로 돈다(WAI-ARIA radio group).
  function onkeydown(e: KeyboardEvent, i: number) {
    const n = items.length;
    let next: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % n;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === ' ') next = i;
    if (next == null) return;
    e.preventDefault();
    choose(next, true);
  }
</script>

<div class="group" role="radiogroup" aria-labelledby={labelledby}>
  {#each items as item, i (i)}
    <div
      bind:this={rows[i]}
      class="row"
      class:on={i === selected}
      role="radio"
      aria-checked={i === selected}
      tabindex={i === selected ? 0 : -1}
      onclick={() => choose(i)}
      onkeydown={(e) => onkeydown(e, i)}
    >
      <span class="dot" aria-hidden="true"></span>
      <span class="content">{@render row(item, i === selected)}</span>
    </div>
  {/each}
</div>

<style>
  .group {
    display: flex;
    flex-direction: column;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-out);
  }
  .row:hover:not(.on) {
    background: var(--surface-2);
  }
  .row.on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .dot {
    position: relative;
    flex: none;
    width: 16px;
    height: 16px;
    border: 2px solid var(--border-strong);
    border-radius: var(--radius-full);
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .on .dot {
    border-color: var(--accent);
    background: var(--accent);
  }
  .on .dot::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: var(--radius-full);
    background: var(--accent-fg);
  }
  .content {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
</style>
