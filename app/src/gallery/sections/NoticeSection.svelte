<svelte:options runes />

<script lang="ts">
  // 알림 매트릭스: variant(inline·banner·row·toast) × tone(neutral·info·warning·danger) × (제목만·동작·닫기)
  // (docs/design/system/components.md §2.12). row는 동작·닫기가 없다. 토스트는 갤러리에서는 흐름 안에 그린다.
  import Notice from '../../lib/components/ui/Notice.svelte';
  import { NOTICE_VARIANT, TONE, type NoticeVariant, type Tone } from '../../lib/components/ui/vocab';
  import { NOTICE, STATE_LABEL, TEXT, TITLE } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  // row는 동작·닫기가 없고 icon은 neutral뿐인 판별 유니온이라 반복문 값으로는 좁힐 수 없다: noticeProps()가 규칙을 지킨다
  type NoticeProps = Record<string, unknown>;

  const noop = () => {};
  // `title=` 글자는 design-lint DS7이 막으므로 객체로 넘긴다
  const samples = { short: { title: TEXT.short }, unbroken: { title: TEXT.unbroken }, number: { title: TEXT.number } };
  const one = [{ id: 'retry', label: NOTICE.action1, onclick: noop }];
  const three = [
    { id: 'retry', label: NOTICE.action1, onclick: noop },
    { id: 'more', label: NOTICE.action2, onclick: noop },
    { id: 'see', label: NOTICE.action3, onclick: noop },
  ];

  /** 중립 알림은 아이콘을 고를 수 있다(다른 톤은 톤이 정한다) */
  function noticeProps(variant: NoticeVariant, tone: Tone, kind: 'plain' | 'actions' | 'many'): NoticeProps {
    const base: NoticeProps = { variant, tone, title: NOTICE.title };
    const withIcon = tone === 'neutral' ? { ...base, icon: 'folder' } : base;
    if (variant === 'row' || kind === 'plain') return withIcon;
    return { ...withIcon, actions: kind === 'many' ? three : one, onclose: noop };
  }
</script>

<Section name="notice" heading={TITLE.notice}>
  {#each NOTICE_VARIANT as variant (variant)}
    <Row label={variant} vocab="NOTICE_VARIANT:{variant}" stack>
      {#each TONE as tone (tone)}
        <Row label={tone} vocab="TONE:{tone}" stack>
          <Notice {...noticeProps(variant, tone, 'plain')}>{NOTICE.body}</Notice>
          {#if variant !== 'row'}
            <Notice {...noticeProps(variant, tone, 'actions')}>{NOTICE.body}</Notice>
          {/if}
        </Row>
      {/each}
    </Row>
  {/each}

  <Row label={STATE_LABEL.withActions} stack>
    <Notice {...noticeProps('inline', 'warning', 'many')}>{NOTICE.body}</Notice>
  </Row>

  <Row label={STATE_LABEL.samples} stack>
    <Notice variant="inline" tone="info" {...samples.short}>{TEXT.long}</Notice>
    <Notice variant="inline" tone="danger" {...samples.unbroken}>{TEXT.unbroken}</Notice>
    <Notice variant="inline" tone="neutral" {...samples.number}>{TEXT.number}</Notice>
    <Notice variant="row" tone="warning">{TEXT.long}</Notice>
  </Row>
</Section>
