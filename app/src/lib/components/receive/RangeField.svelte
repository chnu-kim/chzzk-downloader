<script lang="ts">
  // 구간 줄(range.md §5, patterns.md §6.5): 빠른 다시보기 카드의 화질 아래 Disclosure inline 한 줄. 기본 접힘이고 펼치면
  // FieldRow(구간) + 시각 칸 둘. 검증은 카드의 [받기] 때만 하고(error prop), 오류가 오면 그 칸에 포커스하고 IME 조합이
  // 끝났을 때만 전체 선택한다(patterns.md §6.1). Enter에는 동작을 달지 않는다(제출은 카드의 Mod+Enter·[받기]).
  import { t, type CopyKey } from '../../copy/ko';
  import { formatClock } from '../../format/duration';
  import { RANGE_FORMAT_EXAMPLE_SECS, type RangeError } from '../../receive';
  import Disclosure from '../ui/Disclosure.svelte';
  import FieldRow from '../ui/FieldRow.svelte';
  import Notice from '../ui/Notice.svelte';
  import TextField from '../ui/TextField.svelte';

  interface Props {
    open: boolean;
    start: string;
    end: string;
    /** 마지막 [받기]의 검증 결과(없으면 null). 새 객체가 올 때마다 그 칸으로 포커스 */
    error: RangeError | null;
    /** 영상 길이를 모른다: 끝 칸 placeholder `range.toEnd` */
    lengthUnknown: boolean;
    disabled?: boolean;
    /** 사용자가 펼치거나 접었을 때 */
    ontoggle?: (open: boolean) => void;
  }

  let {
    open = $bindable(),
    start = $bindable(),
    end = $bindable(),
    error,
    lengthUnknown,
    disabled = false,
    ontoggle,
  }: Props = $props();

  const ERROR_KEY = {
    format: 'range.error.format',
    order: 'range.error.order',
    beyond: 'range.error.beyond',
  } as const satisfies Record<RangeError['kind'], CopyKey>;

  const uid = $props.id();
  const errorId = `${uid}-error`;
  let startEl: HTMLInputElement | null = $state(null);
  let endEl: HTMLInputElement | null = $state(null);
  let composing = false;

  const errorText = $derived(
    error
      ? error.kind === 'format'
        ? t(ERROR_KEY.format, { example: formatClock(RANGE_FORMAT_EXAMPLE_SECS) })
        : t(ERROR_KEY[error.kind])
      : '',
  );

  // 오류면 설명 요소(아래 Notice)를 aria-describedby로 잇는다(InvalidProps 타입이 강제)
  function fieldProps(field: 'start' | 'end', helpId: string | undefined) {
    return error?.field === field
      ? { invalid: true as const, 'aria-describedby': helpId ? `${errorId} ${helpId}` : errorId }
      : { invalid: false as const, 'aria-describedby': helpId };
  }

  // [받기]마다 새 오류 객체가 와서 같은 오류가 다시 나도 다시 포커스한다
  $effect(() => {
    const e = error;
    if (!e || !open) return;
    const el = e.field === 'start' ? startEl : endEl;
    el?.focus();
    if (!composing) el?.select();
  });
</script>

<div class="range">
  <Disclosure variant="inline" title={t('range.toggle')} bind:open onchange={(o) => ontoggle?.(o)}>
    <FieldRow label={t('range.label')} help={t('range.help')}>
      {#snippet control({ helpId })}
        <span class="clock">
          <TextField
            label={t('range.start')}
            bind:value={start}
            bind:el={startEl}
            {disabled}
            {...fieldProps('start', helpId)}
            oncompositionstart={() => (composing = true)}
            oncompositionend={() => (composing = false)}
          />
        </span>
        <span aria-hidden="true">~</span>
        <span class="clock">
          <TextField
            label={t('range.end')}
            bind:value={end}
            bind:el={endEl}
            {disabled}
            placeholder={lengthUnknown ? t('range.toEnd') : undefined}
            {...fieldProps('end', helpId)}
            oncompositionstart={() => (composing = true)}
            oncompositionend={() => (composing = false)}
          />
        </span>
      {/snippet}
    </FieldRow>
    {#if error}
      <div class="range-error">
        <Notice id={errorId} variant="inline" tone="danger">{errorText}</Notice>
      </div>
    {/if}
  </Disclosure>
</div>

<style>
  .range {
    margin-block: var(--space-12);
  }
  .clock {
    flex: 0 1 calc(6 * var(--text-body));
    min-width: 0;
  }
  .range-error {
    margin-top: var(--space-4);
  }
</style>
