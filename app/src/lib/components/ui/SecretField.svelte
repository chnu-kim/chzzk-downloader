<script lang="ts">
  // 쿠키 같은 비밀값 입력(docs/design/system/components.md §2.4). 값은 가린 채로 시작한다.
  // 보기를 켜도 저장하지 않는 한 Rust로 보내지 않는다. 토글 라벨은 상태가 바뀌어도 그대로고 aria-pressed가 상태를 말한다.
  import { t } from '../../copy/ko';
  import IconButton from './IconButton.svelte';
  import type { InvalidProps, NameProps } from './vocab';

  type Props = NameProps &
    InvalidProps & {
      value: string;
      onchange?: (value: string) => void;
      disabled?: boolean;
      readonly?: boolean;
      placeholder?: string;
      name?: string;
      'aria-describedby'?: string;
      el?: HTMLInputElement | null;
    };

  let {
    value = $bindable(),
    onchange,
    label,
    labelledby,
    invalid = false,
    disabled = false,
    readonly = false,
    placeholder,
    name,
    'aria-describedby': describedby,
    el = $bindable(null),
  }: Props = $props();

  let shown = $state(false);

  function handleInput(e: Event) {
    const ie = e as unknown as InputEvent & { keyCode?: number };
    if (ie.isComposing || ie.keyCode === 229) return;
    onchange?.((e.currentTarget as HTMLInputElement).value);
  }
</script>

<div class="field-wrap">
  <input
    bind:this={el}
    bind:value
    type={shown ? 'text' : 'password'}
    autocomplete="off"
    spellcheck="false"
    autocorrect="off"
    autocapitalize="off"
    {name}
    {placeholder}
    {disabled}
    {readonly}
    aria-label={label}
    aria-labelledby={labelledby}
    aria-describedby={describedby}
    aria-invalid={invalid ? 'true' : undefined}
    oninput={handleInput}
    oncompositionend={(e) => onchange?.(e.currentTarget.value)}
  />
  <IconButton
    size="sm"
    icon={shown ? 'eye-off' : 'eye'}
    label={t('settings.cookie.show')}
    aria-pressed={shown}
    onclick={() => (shown = !shown)}
  />
</div>
