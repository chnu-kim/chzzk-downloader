<script lang="ts">
  import RadioGroup from '../RadioGroup.svelte';

  let {
    onchange,
    disabledId,
  }: { onchange?: (v: number) => void; disabledId?: string } = $props();
  const options = [
    { id: 'q1080', value: 1080, label: '1080p', description: '큰 화면' },
    { id: 'q720', value: 720, label: '720p' },
    { id: 'q480', value: 480, label: '480p' },
  ];
  let value = $state(720);
  const shown = $derived(options.map((o) => ({ ...o, disabled: o.id === disabledId })));
</script>

<span id="q-label">화질</span>
<span data-testid="value">{value}</span>
<RadioGroup name="quality" labelledby="q-label" bind:value options={shown} {onchange}>
  {#snippet trailing(option)}
    <span data-testid="trail-{option.id}">끝 {option.value}</span>
  {/snippet}
</RadioGroup>
