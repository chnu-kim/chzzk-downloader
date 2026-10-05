<script lang="ts">
  import RadioGroup from '../RadioGroup.svelte';

  let { onchange }: { onchange?: (i: number) => void } = $props();
  const items = ['1080p', '720p', '480p'];
  let selected = $state(1);
</script>

<span id="q-label">화질</span>
<span data-testid="selected">{selected}</span>
<RadioGroup {items} bind:selected labelledby="q-label" {onchange}>
  {#snippet row(item: string)}
    <span>{item}</span>
  {/snippet}
</RadioGroup>
