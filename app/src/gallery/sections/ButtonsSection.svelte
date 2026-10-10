<svelte:options runes />

<script lang="ts">
  // 버튼 매트릭스: variant × tone × size × (기본·꺼짐·aria-disabled·불러오는 중) + 아이콘·kbd + 글자 견본
  // (docs/design/system/components.md §2.1). hover·pressed·focus-visible은 정적으로 그리지 않는다(Playwright가 만든다).
  import Button from '../../lib/components/ui/Button.svelte';
  import Kbd from '../../lib/components/ui/Kbd.svelte';
  import Spinner from '../../lib/components/ui/Spinner.svelte';
  import { BUTTON_VARIANT, SIZE, type ButtonVariant, type Size } from '../../lib/components/ui/vocab';
  import { useDelayedLoading } from '../../lib/useDelayedLoading.svelte';
  import { KBD, STATE_LABEL, TEXT, TEXT_SAMPLES, TITLE, WHY, pair } from '../fixtures';
  import Note from '../Note.svelte';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  // 판별 유니온(primary+danger 등 금지)을 반복문 값으로는 좁힐 수 없어 느슨한 모양으로 넘긴다. 못 만드는 조합은 tones()·states()가 거른다
  type ButtonProps = Record<string, unknown>;
  type State = 'rest' | 'disabled' | 'ariaDisabled' | 'loading';

  const uid = $props.id();
  const whyId = `${uid}-why`;

  // primary + danger, primary + disabled는 타입이 막는다: 그 칸은 그리지 않는다
  const tones = (variant: ButtonVariant) => (variant === 'primary' ? (['neutral'] as const) : (['neutral', 'danger'] as const));
  const states = (variant: ButtonVariant): State[] =>
    variant === 'primary' ? ['rest', 'ariaDisabled', 'loading'] : ['rest', 'disabled', 'ariaDisabled', 'loading'];

  function buttonProps(variant: ButtonVariant, tone: 'neutral' | 'danger', size: Size, state: State): ButtonProps {
    const base: ButtonProps = { variant, tone, size };
    if (state === 'disabled') return { ...base, disabled: true };
    if (state === 'ariaDisabled') return { ...base, 'aria-disabled': 'true', 'aria-describedby': whyId };
    if (state === 'loading') return { ...base, loading: busy.visible };
    return base;
  }

  // 불러오는 중 칸의 스피너는 실제 화면과 같은 훅을 거친다(patterns.md §2.2, DX10): LOADER_DELAY_MS 뒤에 나타난다.
  // 갤러리 spec은 그 뒤에 상태를 본다
  const busy = useDelayedLoading(() => true);
</script>

<Section name="buttons" heading={TITLE.buttons}>
  <Note id={whyId}>{WHY}</Note>

  {#each BUTTON_VARIANT as variant (variant)}
    <Row label={variant} vocab="BUTTON_VARIANT:{variant}" stack>
      {#each tones(variant) as tone (tone)}
        {#each SIZE as size (size)}
          <Row label={pair(tone, size)} vocab="SIZE:{size}">
            {#each states(variant) as state (state)}
              <Button {...buttonProps(variant, tone, size, state)}>{TEXT.short}</Button>
            {/each}
          </Row>
        {/each}
      {/each}
    </Row>
  {/each}

  <Row label="icon · kbd" stack>
    <Row>
      <Button icon="download">{TEXT.short}</Button>
      <Button variant="primary" icon="download" kbd={KBD}>{TEXT.short}</Button>
      <Button variant="ghost" size="sm" icon="folder">{TEXT.short}</Button>
      <Button variant="secondary" tone="danger" icon="trash-2" kbd={KBD}>{TEXT.short}</Button>
      <Button loading={busy.visible}>{TEXT.short}</Button>
    </Row>
  </Row>

  <Row label={STATE_LABEL.samples} stack>
    <!-- 버튼 글자는 줄바꿈하지 않는다(components.md §2.1: 라벨은 copy deck의 짧은 말). 짧은 한글과 큰 숫자만 견본으로 둔다 -->
    {#each TEXT_SAMPLES.filter((x) => x.id === 'short' || x.id === 'number') as sample (sample.id)}
      <Row>
        <Button>{sample.text}</Button>
        <Button variant="primary">{sample.text}</Button>
        <Button variant="ghost" size="sm">{sample.text}</Button>
      </Row>
    {/each}
  </Row>

  <Row label="Kbd · Spinner" stack>
    <Row>
      <Kbd>{KBD}</Kbd>
      {#if busy.visible}
        <Spinner size="sm" />
        <Spinner size="md" />
      {/if}
    </Row>
  </Row>
</Section>
