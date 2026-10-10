<svelte:options runes />

<script lang="ts">
  // 메뉴: 트리거 둘(icon·text) × 크기(docs/design/system/components.md §2.9). 패널은 눌러야 열린다(gallery.spec이 연다).
  import Menu from '../../lib/components/ui/Menu.svelte';
  import { MENU_TRIGGER } from '../../lib/components/ui/vocab';
  import { MENU, TITLE } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  const noop = () => {};
  const items = [
    { id: 'open', label: MENU.items[0], icon: 'folder' as const, onclick: noop },
    { id: 'copy', label: MENU.items[1], icon: 'copy' as const, onclick: noop },
    { id: 'off', label: MENU.items[3], disabled: true, onclick: noop },
    { id: 'remove', label: MENU.items[2], icon: 'trash-2' as const, tone: 'danger' as const, onclick: noop },
  ];
</script>

<Section name="menu" heading={TITLE.menu}>
  {#each MENU_TRIGGER as trigger (trigger)}
    <Row label={trigger} vocab="MENU_TRIGGER:{trigger}">
      {#if trigger === 'icon'}
        <Menu label={MENU.label} {items} />
        <Menu label={MENU.label} {items} size="sm" icon="settings" />
      {:else}
        <Menu label={MENU.label} {items} trigger="text" text={MENU.text} />
        <Menu label={MENU.label} {items} trigger="text" text={MENU.text} size="sm" />
      {/if}
    </Row>
  {/each}
</Section>
