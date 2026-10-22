<script lang="ts">
  // 카드 구간 줄(range-editor.md RE5, D67). 빠른 다시보기 카드에만 있다. "구간 · 값 [구간 편집…] [구간 지우기]".
  // 값은 확정 구간 `applied`뿐이다(구간이 없으면 "전체"). [구간 지우기]는 확정값을 곧바로 지우고(초안이 아니다),
  // 단추가 사라지므로 포커스를 [구간 편집…]으로 옮긴다(body로 떨어지지 않게, F-4).
  import type { TimeRangeDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { rangeSummary } from '../../receive';
  import Button from '../ui/Button.svelte';
  import FieldRow from '../ui/FieldRow.svelte';

  interface Props {
    applied: TimeRangeDto | null;
    /** meta 길이(내림 끝 표시에 쓴다) */
    durationSecs: number | null;
    /** 카드가 받기 요청 중이면 두 단추를 막는다 */
    busy?: boolean;
    onedit: () => void;
    onclear: () => void;
    /** [구간 편집…] 단추(편집 화면이 닫힐 때 포커스를 돌려받는다) */
    editEl?: HTMLButtonElement | null;
  }

  let { applied, durationSecs, busy = false, onedit, onclear, editEl = $bindable(null) }: Props = $props();

  const summary = $derived(rangeSummary(applied, durationSecs));
  const valueText = $derived(
    summary == null
      ? t('range.summaryWhole.label')
      : summary.length == null
        ? summary.range
        : t('range.summary.label', { range: summary.range, length: summary.length }),
  );

  function clear() {
    onclear();
    // 이 단추가 사라진다: 포커스를 짝 단추로
    editEl?.focus();
  }
</script>

<div class="summary">
  <FieldRow label={t('range.label')}>
    {#snippet control()}
      <span class="value">{valueText}</span>
    {/snippet}
    {#snippet actions()}
      <Button size="sm" disabled={busy} bind:el={editEl} onclick={onedit}>{t('range.edit.label')}</Button>
      {#if applied}
        <Button size="sm" disabled={busy} onclick={clear}>{t('range.clear.label')}</Button>
      {/if}
    {/snippet}
  </FieldRow>
</div>

<style>
  .summary {
    margin-block: var(--space-12);
  }
  .value {
    overflow-wrap: anywhere;
  }
</style>
