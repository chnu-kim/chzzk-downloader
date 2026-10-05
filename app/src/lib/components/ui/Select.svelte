<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    value: number;
    options: readonly number[];
    id?: string;
    labelledby?: string;
    disabled?: boolean;
    onchange?: (value: number) => void;
  }

  // 숫자 1~3·1~8 두 곳뿐이라 네이티브 <select>를 쓴다(ui-visual §7).
  let { value = $bindable(), options, id, labelledby, disabled = false, onchange }: Props = $props();
</script>

<span class="select">
  <select
    {id}
    aria-labelledby={labelledby}
    {disabled}
    class="tnum"
    bind:value
    onchange={() => onchange?.(value)}
  >
    {#each options as n (n)}
      <option value={n}>{n}</option>
    {/each}
  </select>
  <span class="chevron"><Icon name="chevron-down" size={16} /></span>
</span>

<style>
  .select {
    position: relative;
    display: inline-flex;
    width: 72px;
  }
  select {
    appearance: none;
    width: 100%;
    height: var(--control-h);
    padding: 0 28px 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-md);
    cursor: pointer;
  }
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  select:disabled {
    background: var(--surface-2);
    color: var(--fg-muted);
  }
  .chevron {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--fg-muted);
    pointer-events: none;
  }
</style>
