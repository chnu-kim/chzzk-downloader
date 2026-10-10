<script lang="ts" generics="T extends string | number">
  // 라디오 묶음(docs/design/system/components.md §2.7). 네이티브 라디오라 방향키·탭 순서는 브라우저가 맡는다.
  import type { Snippet } from 'svelte';
  import type { NameProps, RadioGroupVariant } from './vocab';

  type Option = { id: string; value: T; label: string; description?: string; disabled?: boolean };
  type Props = NameProps & {
    /** list: 세로 행(기본, 화질). inline: 한 줄 가로(짧은 라벨 2~3개, 글자 크기·모양) */
    variant?: RadioGroupVariant;
    name: string;
    value: T;
    onchange?: (value: T) => void;
    options: ReadonlyArray<Option>;
    /** 라벨 바로 뒤의 보조 글자(fps·꼬리표). 대화형 요소 금지 */
    tail?: Snippet<[Option]>;
    trailing?: Snippet<[Option]>;
    disabled?: boolean;
  };

  let {
    variant = 'list',
    name,
    value = $bindable(),
    onchange,
    options,
    tail,
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

<fieldset class={['radiogroup', variant === 'inline' && 'radiogroup-inline']} role="radiogroup" aria-label={label} aria-labelledby={labelledby}>
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
      <span class="choice-label">{option.label}{#if tail}<span class="choice-tail">{@render tail(option)}</span>{/if}</span>
      {#if option.description}<span class="choice-description">{option.description}</span>{/if}
      {#if trailing}<span class="choice-trailing">{@render trailing(option)}</span>{/if}
    </label>
  {/each}
</fieldset>
