<script lang="ts" generics="T extends string | number">
  // 라디오 묶음(docs/design/system/components.md §2.7). 네이티브 라디오라 방향키·탭 순서는 브라우저가 맡는다.
  import type { Snippet } from 'svelte';
  import type { NameProps } from './vocab';

  type Option = { id: string; value: T; label: string; description?: string; disabled?: boolean };
  type Props = NameProps & {
    name: string;
    value: T;
    onchange?: (value: T) => void;
    options: ReadonlyArray<Option>;
    trailing?: Snippet<[Option]>;
    disabled?: boolean;
  };

  let {
    name,
    value = $bindable(),
    onchange,
    options,
    trailing,
    label,
    labelledby,
    disabled = false,
  }: Props = $props();

  function choose(option: Option) {
    if (option.value === value) return;
    value = option.value;
    onchange?.(option.value);
  }
</script>

<fieldset class="radiogroup" role="radiogroup" aria-label={label} aria-labelledby={labelledby}>
  {#each options as option (option.id)}
    <label class="choice">
      <input
        type="radio"
        class="sr-only"
        {name}
        checked={option.value === value}
        disabled={disabled || option.disabled}
        onchange={() => choose(option)}
      />
      <span class="radio" aria-hidden="true"></span>
      <span class="choice-label">{option.label}</span>
      {#if option.description}<span class="choice-description">{option.description}</span>{/if}
      {#if trailing}<span class="choice-trailing">{@render trailing(option)}</span>{/if}
    </label>
  {/each}
</fieldset>
