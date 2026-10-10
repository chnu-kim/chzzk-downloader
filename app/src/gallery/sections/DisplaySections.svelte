<svelte:options runes />

<script lang="ts">
  // 배지·진행 막대·자리 표시 세 섹션(docs/design/system/components.md §2.19~§2.22)
  import Badge from '../../lib/components/ui/Badge.svelte';
  import ProgressBar from '../../lib/components/ui/ProgressBar.svelte';
  import Skeleton from '../../lib/components/ui/Skeleton.svelte';
  import { KIND, PROGRESS_STATE, SKELETON_VARIANT } from '../../lib/components/ui/vocab';
  import { useDelayedLoading } from '../../lib/useDelayedLoading.svelte';
  import { PROGRESS, TITLE } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const WIDTHS = ['full', 'half'] as const;
  const VALUES: (number | null)[] = [...PROGRESS.values, null];

  // 자리 표시는 실제 화면과 같은 훅을 거친다(patterns.md §2.2, DX10): LOADER_DELAY_MS 뒤에 나타난다. 갤러리 spec은 그 뒤에 본다
  const pending = useDelayedLoading(() => true);
</script>

<Section name="badge" heading={TITLE.badge}>
  <Row>
    {#each KIND as kind (kind)}
      <Row label={kind} vocab="KIND:{kind}"><Badge {kind} /></Row>
    {/each}
  </Row>
</Section>

<Section name="progress" heading={TITLE.progress}>
  {#each PROGRESS_STATE as state (state)}
    <Row label={state} vocab="PROGRESS_STATE:{state}" stack>
      {#each VALUES as value (value)}
        <ProgressBar label={PROGRESS.label} {value} {state} valuetext={PROGRESS.valuetext(value)} />
      {/each}
    </Row>
  {/each}
</Section>

<Section name="skeleton" heading={TITLE.skeleton}>
  {#each SKELETON_VARIANT as variant (variant)}
    <Row label={variant} vocab="SKELETON_VARIANT:{variant}" stack>
      {#each WIDTHS as width (width)}
        {#if pending.visible}<Skeleton {variant} {width} />{/if}
      {/each}
    </Row>
  {/each}
</Section>
