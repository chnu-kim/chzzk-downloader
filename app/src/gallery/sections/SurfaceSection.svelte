<script lang="ts">
  // 면과 행: Surface(group·card) · SettingsRow · FieldRow · PageContainer(content·reading)
  // (docs/design/system/components.md §2.16~§2.18, §2.26)
  import Button from '../../lib/components/ui/Button.svelte';
  import FieldRow from '../../lib/components/ui/FieldRow.svelte';
  import PageContainer from '../../lib/components/ui/PageContainer.svelte';
  import Select from '../../lib/components/ui/Select.svelte';
  import SettingsRow from '../../lib/components/ui/SettingsRow.svelte';
  import Surface from '../../lib/components/ui/Surface.svelte';
  import Switch from '../../lib/components/ui/Switch.svelte';
  import TextField from '../../lib/components/ui/TextField.svelte';
  import { PAGE_CONTAINER_VARIANT, SURFACE_VARIANT } from '../../lib/components/ui/vocab';
  import { FIELD, SELECT_OPTIONS, SURFACE, TEXT, TITLE } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const noop = () => {};
  let on = $state(true);
  let pick = $state<string>('a');
  let name = $state(FIELD.value);
  let long = $state(TEXT.unbroken);
</script>

<Section name="surface" heading={TITLE.surface}>
  {#each SURFACE_VARIANT as variant (variant)}
    <Row label={variant} vocab="SURFACE_VARIANT:{variant}" stack>
      {#if variant === 'group'}
        <Surface aria-label={SURFACE.groupLabel}>
          <SettingsRow label={SURFACE.rowLabel} help={SURFACE.rowHelp} value={SURFACE.rowValue} />
          <SettingsRow label={SURFACE.rowLabel} help={SURFACE.rowHelp}>
            {#snippet control({ labelId, helpId })}
              <Switch labelledby={labelId} aria-describedby={helpId} bind:value={on} />
            {/snippet}
          </SettingsRow>
          <SettingsRow label={SURFACE.rowLabel}>
            {#snippet control({ labelId })}
              <Select labelledby={labelId} options={SELECT_OPTIONS} bind:value={pick} />
            {/snippet}
          </SettingsRow>
          <SettingsRow label={TEXT.long} help={TEXT.long} value={TEXT.unbroken} />
        </Surface>
      {:else}
        <Surface {variant} aria-label={SURFACE.cardTitle}>
          {#snippet header()}<h3>{SURFACE.cardTitle}</h3>{/snippet}
          <FieldRow label={SURFACE.fieldLabel} help={SURFACE.fieldHelp}>
            {#snippet control({ labelId, helpId })}
              <TextField labelledby={labelId} aria-describedby={helpId} bind:value={name} />
            {/snippet}
            {#snippet actions()}<Button size="sm" onclick={noop}>{SURFACE.fieldAction}</Button>{/snippet}
          </FieldRow>
          <FieldRow label={SURFACE.fieldLabel} value={SURFACE.rowValue} />
          <FieldRow label={TEXT.long}>
            {#snippet control({ labelId })}
              <TextField labelledby={labelId} bind:value={long} />
            {/snippet}
          </FieldRow>
          {#snippet footer()}<Button variant="primary" onclick={noop}>{SURFACE.cardAction}</Button>{/snippet}
        </Surface>
      {/if}
    </Row>
  {/each}

  {#each PAGE_CONTAINER_VARIANT as variant (variant)}
    <Row label={variant} vocab="PAGE_CONTAINER_VARIANT:{variant}" stack>
      <PageContainer {variant}>
        <p>{variant === 'reading' ? SURFACE.readingText : SURFACE.contentText}</p>
      </PageContainer>
    </Row>
  {/each}
</Section>
