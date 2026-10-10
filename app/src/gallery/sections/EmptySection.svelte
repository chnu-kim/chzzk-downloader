<svelte:options runes />

<script lang="ts">
  // 빈 상태: inline · panel · page × (제목·단계·동작)(docs/design/system/components.md §2.15)
  import EmptyState from '../../lib/components/ui/EmptyState.svelte';
  import { EMPTY_STATE_VARIANT } from '../../lib/components/ui/vocab';
  import { EMPTY, TEXT, TITLE } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const noop = () => {};
  const action = { id: 'paste', label: EMPTY.action, onclick: noop };
  // `title=` 글자는 design-lint DS7이 막으므로 객체로 넘긴다
  const full = { title: EMPTY.title, steps: [...EMPTY.steps], action };
  const long = { title: TEXT.long };
</script>

<Section name="empty" heading={TITLE.empty}>
  {#each EMPTY_STATE_VARIANT as variant (variant)}
    <Row label={variant} vocab="EMPTY_STATE_VARIANT:{variant}" stack>
      {#if variant === 'inline'}
        <EmptyState variant="inline">{EMPTY.body}</EmptyState>
        <EmptyState variant="inline" {action}>{TEXT.long}</EmptyState>
      {:else}
        <EmptyState {variant} {...full}>{EMPTY.body}</EmptyState>
        <EmptyState {variant} {...long}>{TEXT.unbroken}</EmptyState>
      {/if}
    </Row>
  {/each}
</Section>
