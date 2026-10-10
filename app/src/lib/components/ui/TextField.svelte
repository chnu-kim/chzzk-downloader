<script lang="ts">
  // 한 줄 입력(docs/design/system/components.md §2.3). 형식은 고정이고 mono는 SecretField 전용이다.
  import type { HTMLInputAttributes } from 'svelte/elements';
  import type { InvalidProps, NameProps } from './vocab';

  type Props = Omit<HTMLInputAttributes, 'type' | 'value' | 'size' | 'onchange'> &
    NameProps &
    InvalidProps & {
      value: string;
      onchange?: (value: string) => void;
      readonly?: boolean;
      disabled?: boolean;
      required?: boolean;
      placeholder?: string;
      el?: HTMLInputElement | null;
    };

  let {
    value = $bindable(),
    onchange,
    label,
    labelledby,
    invalid = false,
    el = $bindable(null),
    class: klass = '',
    oninput,
    oncompositionend,
    ...rest
  }: Props = $props();

  // 한글 조합 중에는 값을 밖으로 내보내지 않는다(조합이 끝날 때 한 번 내보낸다)
  function handleInput(e: Event) {
    (oninput as ((e: Event) => void) | null | undefined)?.(e);
    const ie = e as unknown as InputEvent & { keyCode?: number };
    if (ie.isComposing || ie.keyCode === 229) return;
    onchange?.((e.currentTarget as HTMLInputElement).value);
  }
  function handleCompositionEnd(e: CompositionEvent) {
    (oncompositionend as ((e: CompositionEvent) => void) | null | undefined)?.(e);
    onchange?.((e.currentTarget as HTMLInputElement).value);
  }
</script>

<input
  bind:this={el}
  bind:value
  {...rest}
  type="text"
  autocomplete="off"
  spellcheck="false"
  autocorrect="off"
  autocapitalize="off"
  class={['field', klass]}
  aria-label={label}
  aria-labelledby={labelledby}
  aria-invalid={invalid ? 'true' : undefined}
  oninput={handleInput}
  oncompositionend={handleCompositionEnd}
/>
