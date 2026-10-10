<script lang="ts">
  // 스위치 매트릭스: 켜짐·꺼짐 × (기본·꺼짐 상태), 설명 연결(docs/design/system/components.md §2.6)
  import Switch from '../../lib/components/ui/Switch.svelte';
  import { FIELD, STATE_LABEL, TITLE, pair } from '../fixtures';
  import Note from '../Note.svelte';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const uid = $props.id();
  const helpId = `${uid}-help`;

  let on = $state(true);
  let off = $state(false);
  let disabledOn = $state(true);
  let disabledOff = $state(false);
  let described = $state(false);
</script>

<Section name="switches" heading={TITLE.switches}>
  <Note id={helpId}>{FIELD.switchLabel}</Note>
  <Row>
    <Row label={STATE_LABEL.on}><Switch label={FIELD.switchLabel} bind:value={on} /></Row>
    <Row label={STATE_LABEL.off}><Switch label={FIELD.switchLabel} bind:value={off} /></Row>
    <Row label={pair(STATE_LABEL.disabled, STATE_LABEL.on)}><Switch label={FIELD.switchLabel} bind:value={disabledOn} disabled /></Row>
    <Row label={pair(STATE_LABEL.disabled, STATE_LABEL.off)}><Switch label={FIELD.switchLabel} bind:value={disabledOff} disabled /></Row>
    <Row label="describedby"><Switch label={FIELD.switchLabel} bind:value={described} aria-describedby={helpId} /></Row>
  </Row>
</Section>
