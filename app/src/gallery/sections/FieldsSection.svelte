<script lang="ts">
  // 입력 칸 매트릭스: TextField·SecretField × (기본·값 있음·꺼짐·읽기 전용·오류·필수) + 글자 견본
  // (docs/design/system/components.md §2.3·§2.4). 오류 칸은 문구 요소를 aria-describedby로 가리킨다.
  import SecretField from '../../lib/components/ui/SecretField.svelte';
  import TextField from '../../lib/components/ui/TextField.svelte';
  import { ERROR_TEXT, FIELD, STATE_LABEL, TEXT_SAMPLES, TITLE } from '../fixtures';
  import Note from '../Note.svelte';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const uid = $props.id();
  const errId = `${uid}-err`;
  const secretErrId = `${uid}-secret-err`;

  let empty = $state('');
  let filled = $state(FIELD.value);
  let off = $state(FIELD.value);
  let ro = $state(FIELD.value);
  let bad = $state(FIELD.value);
  let req = $state('');
  let samples = $state(TEXT_SAMPLES.map((s) => s.text));

  let sEmpty = $state('');
  let sFilled = $state(FIELD.secret);
  let sOff = $state(FIELD.secret);
  let sRo = $state(FIELD.secret);
  let sBad = $state(FIELD.secret);
</script>

<Section name="fields" heading={TITLE.fields}>
  <Note id={errId}>{ERROR_TEXT}</Note>
  <Note id={secretErrId}>{ERROR_TEXT}</Note>

  <Row label="TextField" stack>
    <Row label={STATE_LABEL.rest}><TextField label={FIELD.label} placeholder={FIELD.placeholder} bind:value={empty} /></Row>
    <Row label={STATE_LABEL.filled}><TextField label={FIELD.label} bind:value={filled} /></Row>
    <Row label={STATE_LABEL.disabled}><TextField label={FIELD.label} bind:value={off} disabled /></Row>
    <Row label={STATE_LABEL.readonly}><TextField label={FIELD.label} bind:value={ro} readonly /></Row>
    <Row label={STATE_LABEL.invalid}><TextField label={FIELD.label} bind:value={bad} invalid aria-describedby={errId} /></Row>
    <Row label={STATE_LABEL.required}><TextField label={FIELD.label} placeholder={FIELD.placeholder} bind:value={req} required /></Row>
  </Row>

  <Row label={STATE_LABEL.samples} stack>
    {#each TEXT_SAMPLES as sample, i (sample.id)}
      <TextField label={FIELD.label} bind:value={samples[i]} />
    {/each}
  </Row>

  <Row label="SecretField" stack>
    <Row label={STATE_LABEL.rest}><SecretField label={FIELD.label} placeholder={FIELD.placeholder} bind:value={sEmpty} /></Row>
    <Row label={STATE_LABEL.filled}><SecretField label={FIELD.label} bind:value={sFilled} /></Row>
    <Row label={STATE_LABEL.disabled}><SecretField label={FIELD.label} bind:value={sOff} disabled /></Row>
    <Row label={STATE_LABEL.readonly}><SecretField label={FIELD.label} bind:value={sRo} readonly /></Row>
    <Row label={STATE_LABEL.invalid}><SecretField label={FIELD.label} bind:value={sBad} invalid aria-describedby={secretErrId} /></Row>
  </Row>
</Section>
