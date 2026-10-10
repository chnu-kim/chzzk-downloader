<script lang="ts">
  // 툴바와 끌어 놓기 안내(docs/design/system/components.md §2.27·§2.28). 끌어 놓기 안내는 화면 전체를 덮는 표시라
  // 스위치로 켠다(기본은 꺼짐, 포인터를 막지 않는다).
  import DropOverlay from '../../lib/components/ui/DropOverlay.svelte';
  import IconButton from '../../lib/components/ui/IconButton.svelte';
  import Switch from '../../lib/components/ui/Switch.svelte';
  import Toolbar from '../../lib/components/ui/Toolbar.svelte';
  import { TITLE, TOOLBAR } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  let showDrop = $state(false);
</script>

<Section name="toolbar" heading={TITLE.toolbar}>
  <Toolbar>
    {#snippet start()}
      <IconButton class="edge-start" icon="arrow-left" label={TOOLBAR.back} />
      <span class="app-name">{TOOLBAR.app}</span>
    {/snippet}
    {#snippet end()}
      <IconButton class="edge-end" icon="settings" label={TOOLBAR.settings} />
    {/snippet}
  </Toolbar>
  <Row label={TOOLBAR.dropToggle}>
    <Switch label={TOOLBAR.dropToggle} bind:value={showDrop} />
  </Row>
  <DropOverlay open={showDrop} />
</Section>
