<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    title: string;
    open?: boolean;
    /** 설정의 "고급"은 섹션 제목, "값을 찾는 방법"은 작은 링크형 */
    variant?: 'section' | 'inline';
    children: Snippet;
  }

  let { title, open = $bindable(false), variant = 'section', children }: Props = $props();
  const id = `disclosure-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="disclosure {variant}">
  <button
    type="button"
    class="head"
    aria-expanded={open}
    aria-controls={id}
    onclick={() => (open = !open)}
  >
    <span>{title}</span>
    <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} />
  </button>
  <div {id} class="panel" hidden={!open}>
    {@render children()}
  </div>
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    width: 100%;
    min-height: var(--control-h);
    padding: 0 var(--space-8);
    border: none;
    border-radius: var(--radius-md);
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    text-align: left;
    cursor: pointer;
  }
  .head:hover {
    background: var(--surface-2);
  }
  .inline .head {
    display: inline-flex;
    width: auto;
    min-height: var(--control-h-sm);
    padding: 0 6px;
    color: var(--accent);
    font-weight: var(--weight-normal);
    font-size: var(--text-sm);
  }
  .inline .head:hover {
    background: none;
    text-decoration: underline;
  }
  .panel {
    padding-top: var(--space-8);
  }
</style>
