<script lang="ts">
  // 켜고 끄는 스위치(docs/design/system/components.md §2.6). 네이티브 버튼이라 Space·Enter가 클릭이다.
  import type { NameProps } from './vocab';

  type Props = NameProps & {
    value: boolean;
    onchange?: (value: boolean) => void;
    disabled?: boolean;
    'aria-describedby'?: string;
    el?: HTMLButtonElement | null;
  };

  let {
    value = $bindable(),
    onchange,
    label,
    labelledby,
    disabled = false,
    'aria-describedby': describedby,
    el = $bindable(null),
  }: Props = $props();

  function toggle() {
    value = !value;
    onchange?.(value);
  }
</script>

<button
  bind:this={el}
  type="button"
  role="switch"
  class="switch"
  aria-checked={value}
  aria-label={label}
  aria-labelledby={labelledby}
  aria-describedby={describedby}
  {disabled}
  onclick={toggle}
></button>
