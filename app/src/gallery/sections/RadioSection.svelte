<script lang="ts">
  // 라디오 묶음 매트릭스: 선택·꺼진 항목·설명·뒤쪽 요소·묶음 전체 꺼짐(docs/design/system/components.md §2.7)
  import RadioGroup from '../../lib/components/ui/RadioGroup.svelte';
  import Badge from '../../lib/components/ui/Badge.svelte';
  import { FIELD, INLINE_OPTIONS, RADIO_OPTIONS, STATE_LABEL, TITLE } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const uid = $props.id();

  let picked = $state<string>('one');
  let withTrailing = $state<string>('two');
  let inlinePicked = $state<string>('b');
  let groupOff = $state<string>('one');
</script>

<Section name="radio" heading={TITLE.radio}>
  <Row label={STATE_LABEL.selected} vocab="RADIO_GROUP_VARIANT:list" stack>
    <RadioGroup name="{uid}-a" label={FIELD.radioLabel} options={RADIO_OPTIONS} bind:value={picked} />
  </Row>
  <Row label="trailing" stack>
    <RadioGroup name="{uid}-b" label={FIELD.radioLabel} options={RADIO_OPTIONS} bind:value={withTrailing}>
      {#snippet trailing()}<Badge kind="vod" />{/snippet}
    </RadioGroup>
  </Row>
  <Row label="inline" vocab="RADIO_GROUP_VARIANT:inline" stack>
    <RadioGroup variant="inline" name="{uid}-d" label={FIELD.radioLabel} options={INLINE_OPTIONS} bind:value={inlinePicked} />
  </Row>
  <Row label={STATE_LABEL.disabled} stack>
    <RadioGroup name="{uid}-c" label={FIELD.radioLabel} options={RADIO_OPTIONS} bind:value={groupOff} disabled />
  </Row>
</Section>
