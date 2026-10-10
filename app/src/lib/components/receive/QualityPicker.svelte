<script lang="ts">
  // 화질 라디오 행(system/patterns.md §6.5, components.md §2.7). 꼬리표 `quality.best`는 늘 가장 높은 화질 행에 붙고
  // 기본 선택과 무관하다. 행의 면은 FieldRow 값 열 x에서 시작한다.
  import type { QualityDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { bestQualityIndex, qualityFps, qualitySize } from '../../receive';
  import FieldRow from '../ui/FieldRow.svelte';
  import RadioGroup from '../ui/RadioGroup.svelte';

  interface Props {
    qualities: readonly QualityDto[];
    durationSecs: number | null;
    /** 고른 화질의 위치(RadioGroup의 값은 이 위치다) */
    selected: number;
  }

  let { qualities, durationSecs, selected = $bindable() }: Props = $props();

  const options = $derived(qualities.map((q, i) => ({ id: q.id, value: i, label: q.label })));
  const best = $derived(bestQualityIndex(qualities));
</script>

<FieldRow label={t('quality.title')}>
  {#snippet control({ labelId })}
    <div class="picker">
      <RadioGroup name="quality" labelledby={labelId} {options} bind:value={selected}>
        {#snippet tail(option)}
          {@const q = qualities[option.value]}
          {@const fps = qualityFps(q)}
          <span class="tails">
            {#if fps}<span class="num">{fps}</span>{/if}
            {#if option.value === best}<span>{t('quality.best')}</span>{/if}
          </span>
        {/snippet}
        {#snippet trailing(option)}
          <span class="num">{qualitySize(qualities[option.value], durationSecs) ?? ''}</span>
        {/snippet}
      </RadioGroup>
    </div>
  {/snippet}
</FieldRow>

<style>
  .picker {
    flex: 1;
    min-width: 0;
  }
  /* 라벨 바로 뒤 보조 글자(fps · 꼬리표)는 한 줄에 나란히 놓는다. 크기만 오른쪽 열에 둔다 */
  .tails {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-8);
  }
</style>
