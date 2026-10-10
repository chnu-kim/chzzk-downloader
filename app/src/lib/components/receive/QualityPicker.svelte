<script lang="ts">
  import type { QualityDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { qualityFps, qualitySize } from '../../receive';
  import RadioGroup from '../ui/RadioGroup.svelte';

  interface Props {
    qualities: readonly QualityDto[];
    durationSecs: number | null;
    /** 고른 화질의 위치(RadioGroup의 값은 이 위치다) */
    selected: number;
  }

  let { qualities, durationSecs, selected = $bindable() }: Props = $props();

  const options = $derived(qualities.map((q, i) => ({ id: q.id, value: i, label: q.label })));
</script>

<div class="quality-field">
  <span id="quality-title" class="label">{t('quality.title')}</span>
  <RadioGroup name="quality" labelledby="quality-title" {options} bind:value={selected}>
    {#snippet trailing(option)}
      {@const q = qualities[option.value]}
      <span class="fps num">{qualityFps(q) ?? ''}</span>
      <span class="size num">{qualitySize(q, durationSecs) ?? ''}</span>
    {/snippet}
  </RadioGroup>
</div>

<style>
  .quality-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .label {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--fg-muted);
  }
  .fps {
    min-width: 3.5rem;
    color: var(--fg-muted);
  }
  .size {
    color: var(--fg-muted);
  }
</style>
