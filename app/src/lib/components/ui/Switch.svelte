<script lang="ts">
  interface Props {
    checked: boolean;
    /** 라벨 요소의 id(라벨은 행 왼쪽에 따로 둔다) 또는 직접 읽을 이름 */
    labelledby?: string;
    label?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  }

  let { checked = $bindable(), labelledby, label, disabled = false, onchange }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button
  type="button"
  role="switch"
  class="switch"
  aria-checked={checked}
  aria-labelledby={labelledby}
  aria-label={labelledby ? undefined : label}
  {disabled}
  onclick={toggle}
>
  <span class="knob"></span>
</button>

<style>
  .switch {
    position: relative;
    flex: none;
    width: 40px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-full);
    background: var(--surface-2);
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }
  .knob {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--border-strong);
    transition: transform var(--dur-fast) var(--ease-out);
  }
  .switch[aria-checked='true'] {
    background: var(--accent);
    border-color: var(--accent);
  }
  .switch[aria-checked='true'] .knob {
    transform: translateX(18px);
    box-shadow: none;
  }
  .switch:disabled {
    cursor: default;
    border-color: var(--border);
  }
  .switch:disabled .knob {
    background: var(--surface-2);
    box-shadow: 0 0 0 1px var(--border);
  }
</style>
