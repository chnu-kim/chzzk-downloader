<script lang="ts">
  import type { QualityDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { qualityFps, qualitySize } from '../../receive';
  import RadioGroup from '../ui/RadioGroup.svelte';

  interface Props {
    qualities: readonly QualityDto[];
    durationSecs: number | null;
    selected: number;
  }

  let { qualities, durationSecs, selected = $bindable() }: Props = $props();
</script>

<div class="field">
  <span id="quality-title" class="label">{t('quality.title')}</span>
  <RadioGroup items={qualities} bind:selected labelledby="quality-title">
    {#snippet row(q: QualityDto)}
      <span class="name tnum">{q.label}</span>
      <span class="fps tnum">{qualityFps(q) ?? ''}</span>
      <span class="size tnum">{qualitySize(q, durationSecs) ?? ''}</span>
    {/snippet}
  </RadioGroup>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .label {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--fg-muted);
  }
  .name {
    min-width: 4.5rem;
  }
  .fps {
    min-width: 3.5rem;
    color: var(--fg-muted);
  }
  .size {
    margin-left: auto;
    color: var(--fg-muted);
  }
</style>
