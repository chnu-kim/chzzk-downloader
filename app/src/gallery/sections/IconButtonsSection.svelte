<svelte:options runes />

<script lang="ts">
  // 아이콘 버튼 매트릭스: 허용 모양 10 × 크기 2 × (기본·꺼짐·aria-disabled)(docs/design/system/components.md §2.2)
  import IconButton from '../../lib/components/ui/IconButton.svelte';
  import { ICON_BUTTON_ICONS } from '../../lib/components/ui/vocab';
  import { ICON_LABELS, STATE_LABEL, TITLE, WHY, pair } from '../fixtures';
  import Note from '../Note.svelte';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const uid = $props.id();
  const whyId = `${uid}-why`;
  const SIZES = ['sm', 'md'] as const;
</script>

<Section name="icon-buttons" heading={TITLE.iconButtons}>
  <Note id={whyId}>{WHY}</Note>
  {#each SIZES as size (size)}
    <Row label={pair(STATE_LABEL.size, size)}>
      {#each ICON_BUTTON_ICONS as icon (icon)}
        <IconButton {icon} {size} label={ICON_LABELS[icon]} />
      {/each}
    </Row>
    <Row label={pair(size, STATE_LABEL.disabled)}>
      {#each ICON_BUTTON_ICONS as icon (icon)}
        <IconButton {icon} {size} label={ICON_LABELS[icon]} disabled />
      {/each}
    </Row>
    <Row label={pair(size, STATE_LABEL.ariaDisabled)}>
      {#each ICON_BUTTON_ICONS as icon (icon)}
        <IconButton {icon} {size} label={ICON_LABELS[icon]} aria-disabled="true" aria-describedby={whyId} />
      {/each}
    </Row>
  {/each}
</Section>
