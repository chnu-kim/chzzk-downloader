<script lang="ts">
  // 고르는 칸 매트릭스: 기본·꺼짐·오류·필수 + 글자 견본 옵션 + 숫자 옵션(docs/design/system/components.md §2.5)
  import Select from '../../lib/components/ui/Select.svelte';
  import { ERROR_TEXT, FIELD, SELECT_OPTIONS, STATE_LABEL, TITLE } from '../fixtures';
  import Note from '../Note.svelte';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const uid = $props.id();
  const errId = `${uid}-err`;
  const NUMBER_OPTIONS = [
    { value: 1, label: '1' },
    { value: 1234567890, label: '1,234,567,890' },
  ];

  let rest = $state<string>('a');
  let long = $state<string>('b');
  let unbroken = $state<string>('c');
  let off = $state<string>('a');
  let bad = $state<string>('a');
  let req = $state<string>('a');
  let num = $state<number>(1234567890);
</script>

<Section name="select" heading={TITLE.select}>
  <Note id={errId}>{ERROR_TEXT}</Note>
  <Row label={STATE_LABEL.rest}><Select label={FIELD.selectLabel} options={SELECT_OPTIONS} bind:value={rest} /></Row>
  <Row label={STATE_LABEL.disabled}><Select label={FIELD.selectLabel} options={SELECT_OPTIONS} bind:value={off} disabled /></Row>
  <Row label={STATE_LABEL.invalid}><Select label={FIELD.selectLabel} options={SELECT_OPTIONS} bind:value={bad} invalid aria-describedby={errId} /></Row>
  <Row label={STATE_LABEL.required}><Select label={FIELD.selectLabel} options={SELECT_OPTIONS} bind:value={req} required /></Row>
  <Row label={STATE_LABEL.samples} stack>
    <Select label={FIELD.selectLabel} options={SELECT_OPTIONS} bind:value={long} />
    <Select label={FIELD.selectLabel} options={SELECT_OPTIONS} bind:value={unbroken} />
    <Select label={FIELD.selectLabel} options={NUMBER_OPTIONS} bind:value={num} />
  </Row>
</Section>
