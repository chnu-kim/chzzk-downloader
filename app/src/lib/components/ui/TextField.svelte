<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    value: string;
    invalid?: boolean;
    /** SecretField·쿠키 칸 */
    mono?: boolean;
    el?: HTMLInputElement | null;
  }

  let {
    value = $bindable(),
    invalid = false,
    mono = false,
    type = 'text',
    el = $bindable(null),
    class: klass = '',
    ...rest
  }: Props = $props();
</script>

<input
  bind:this={el}
  bind:value
  {type}
  class="field {klass}"
  class:mono
  aria-invalid={invalid ? 'true' : undefined}
  autocomplete="off"
  spellcheck="false"
  {...rest}
/>

<style>
  .field {
    width: 100%;
    min-width: 0;
    height: var(--control-h);
    padding: 0 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    font-size: var(--text-md);
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  .field::placeholder {
    color: var(--fg-muted);
  }
  .field:hover:not(:disabled):not(:focus) {
    border-color: var(--fg-muted);
  }
  .field:focus {
    outline: none;
    border-color: var(--accent);
  }
  .field:focus-visible {
    box-shadow: var(--focus-ring);
    border-radius: var(--radius-md);
  }
  .field[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .field:disabled,
  .field:read-only {
    background: var(--surface-2);
    color: var(--fg-muted);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
</style>
