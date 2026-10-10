<script lang="ts" generics="T extends string | number">
  // 고르는 칸(docs/design/system/components.md §2.5). 네이티브 <select>라 값이 문자열로 오가므로
  // 옵션 배열에서 찾아 원래 T(숫자 포함)로 돌려준다.
  import type { HTMLSelectAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { InvalidProps, NameProps } from './vocab';

  type Props = Omit<HTMLSelectAttributes, 'value' | 'onchange'> &
    NameProps &
    InvalidProps & {
      value: T;
      options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
      onchange?: (value: T) => void;
      disabled?: boolean;
      required?: boolean;
      el?: HTMLSelectElement | null;
    };

  let {
    value = $bindable(),
    options,
    onchange,
    label,
    labelledby,
    invalid = false,
    el = $bindable(null),
    class: klass = '',
    ...rest
  }: Props = $props();

  function handleChange(e: Event & { currentTarget: EventTarget & HTMLSelectElement }) {
    const picked = options.find((o) => String(o.value) === e.currentTarget.value);
    if (!picked) return;
    value = picked.value;
    onchange?.(picked.value);
  }
</script>

<span class={['select-wrap', klass]}>
  <select
    bind:this={el}
    {...rest}
    class="select"
    aria-label={label}
    aria-labelledby={labelledby}
    aria-invalid={invalid ? 'true' : undefined}
    onchange={handleChange}
  >
    {#each options as option (option.value)}
      <option value={String(option.value)} disabled={option.disabled} selected={option.value === value}>
        {option.label}
      </option>
    {/each}
  </select>
  <Icon name="chevron-down" size="sm" />
</span>
