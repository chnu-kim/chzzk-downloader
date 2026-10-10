<svelte:options runes />

<script lang="ts">
  // 펼침 매트릭스: section · inline × (닫힘·열림)(docs/design/system/components.md §2.8)
  import Disclosure from '../../lib/components/ui/Disclosure.svelte';
  import { DISCLOSURE_VARIANT } from '../../lib/components/ui/vocab';
  import { DISCLOSURE, STATE_LABEL, TITLE } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';
</script>

<Section name="disclosure" heading={TITLE.disclosure}>
  {#each DISCLOSURE_VARIANT as variant (variant)}
    {@const title = variant === 'section' ? DISCLOSURE.sectionTitle : DISCLOSURE.inlineTitle}
    <Row label={variant} vocab="DISCLOSURE_VARIANT:{variant}" stack>
      <Row label={STATE_LABEL.rest} stack>
        <Disclosure {variant} {title} heading="h3">{DISCLOSURE.body}</Disclosure>
      </Row>
      <Row label={STATE_LABEL.open} stack>
        <Disclosure {variant} {title} heading="h3" open>{DISCLOSURE.body}</Disclosure>
      </Row>
    </Row>
  {/each}
</Section>
