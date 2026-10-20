<script lang="ts">
  // 구간 줄(range.md §5, patterns.md §6.5): 빠른 다시보기 카드의 화질 아래 Disclosure inline 한 줄. 기본 접힘이고 펼치면
  // FieldRow(구간) + 시각 칸 둘. 검증은 카드의 [받기] 때만 하고(error prop), 오류가 오면 그 칸에 포커스하고 IME 조합이
  // 끝났을 때만 전체 선택한다(patterns.md §6.1). Enter에는 동작을 달지 않는다(제출은 카드의 Mod+Enter·[받기]).
  import { t, type CopyKey } from '../../copy/ko';
  import { formatClock } from '../../format/duration';
  import { RANGE_FORMAT_EXAMPLE_SECS, type RangeError } from '../../receive';
  import Button from '../ui/Button.svelte';
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
    /** 칸 포커스·blur(PVU10: 카드가 바뀐 값과 relatedTarget을 보고 영상을 탐색한다) */
    onfocusfield?: (field: 'start' | 'end') => void;
    onblurfield?: (field: 'start' | 'end', relatedTarget: EventTarget | null) => void;
    /** ±1초 단추(PVU-5). delta는 −1 또는 +1 */
    onnudge?: (field: 'start' | 'end', delta: -1 | 1) => void;
    /** 그 칸의 단추를 누를 수 있는가(칸을 못 읽으면 false). 없으면 늘 true */
    canNudge?: (field: 'start' | 'end') => boolean;
    /** 구간 길이 줄 글자(PVU17). 없으면 줄이 없다 */
    lengthText?: string | null;
  }

  let {
    open = $bindable(),
    start = $bindable(),
    end = $bindable(),
    error,
    lengthUnknown,
    disabled = false,
    ontoggle,
    onfocusfield,
    onblurfield,
    onnudge,
    canNudge,
    lengthText = null,
  }: Props = $props();

  const ERROR_KEY = {
    format: 'range.error.format',
    order: 'range.error.order',
    beyond: 'range.error.beyond',
  } as const satisfies Record<RangeError['kind'], CopyKey>;

  /** ±n초 단추의 n(코드 상수, 문구는 자리표시) */
  const NUDGE_SECS = 1;
  const NUDGE_NAME = {
    start: { earlier: 'range.nudge.startEarlier.label', later: 'range.nudge.startLater.label' },
    end: { earlier: 'range.nudge.endEarlier.label', later: 'range.nudge.endLater.label' },
  } as const satisfies Record<'start' | 'end', Record<'earlier' | 'later', CopyKey>>;

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

{#snippet nudges(field: 'start' | 'end')}
  {@const can = !disabled && (canNudge?.(field) ?? true)}
  <Button size="sm" disabled={!can} aria-label={t(NUDGE_NAME[field].earlier, { n: NUDGE_SECS })} onclick={() => onnudge?.(field, -1)}>
    {t('range.nudge.earlier.label', { n: NUDGE_SECS })}
  </Button>
  <!-- `~`는 [미루기]와 한 덩어리라 접힐 때 혼자 떨어지지 않는다 -->
  <span class="tail">
    <Button size="sm" disabled={!can} aria-label={t(NUDGE_NAME[field].later, { n: NUDGE_SECS })} onclick={() => onnudge?.(field, 1)}>
      {t('range.nudge.later.label', { n: NUDGE_SECS })}
    </Button>
    {#if field === 'start'}<span aria-hidden="true">~</span>{/if}
  </span>
{/snippet}

<div class="range">
  <Disclosure variant="inline" title={t('range.toggle')} bind:open onchange={(o) => ontoggle?.(o)}>
    <FieldRow label={t('range.label')} help={t('range.help')}>
      {#snippet control({ helpId })}
        <span class="groups">
          <!-- 칸 하나와 그 칸의 단추 둘은 한 묶음이라 좁은 폭에서도 떨어지지 않는다(PVU-5 V23). `~`는 시작 묶음 끝에 붙는다 -->
          <span class="group">
            <span class="clock">
              <TextField
                label={t('range.start')}
                bind:value={start}
                bind:el={startEl}
                {disabled}
                {...fieldProps('start', helpId)}
                oncompositionstart={() => (composing = true)}
                oncompositionend={() => (composing = false)}
                onfocus={() => onfocusfield?.('start')}
                onblur={(e) => onblurfield?.('start', e.relatedTarget)}
              />
            </span>
            {@render nudges('start')}
          </span>
          <span class="group">
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
                onfocus={() => onfocusfield?.('end')}
                onblur={(e) => onblurfield?.('end', e.relatedTarget)}
              />
            </span>
            {@render nudges('end')}
          </span>
        </span>
      {/snippet}
    </FieldRow>
    {#if lengthText}
      <!-- 값이 바뀔 때마다 읽으면 시끄러워 aria-live를 두지 않는다 -->
      <p class="range-length">{lengthText}</p>
    {/if}
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
  /* 시작 묶음과 끝 묶음은 좁은 폭에서 두 줄로 접힌다(PVU-5 V23) */
  .groups {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-sibling);
    min-width: 0;
  }
  .group {
    flex: 0 1 auto;
    max-width: 100%;
    display: inline-flex;
    /* 320 폭·보통 글자에서는 한 줄에 들고, 아주 크게에서는 단추가 칸 아래로 접힌다 */
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
  }
  .range-length {
    margin: var(--space-4) 0 0;
    color: var(--fg-muted);
  }
  .tail {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
  }
  /* 줄 바꿈 판정은 min-width 기준(basis 0)이라 5글자 폭으로 한 줄에 들고, 남는 만큼 6글자까지 늘어난다 */
  .clock {
    flex: 1 1 0;
    min-width: calc(5 * var(--text-body));
    max-width: calc(6 * var(--text-body));
  }
  .range-error {
    margin-top: var(--space-4);
  }
</style>
