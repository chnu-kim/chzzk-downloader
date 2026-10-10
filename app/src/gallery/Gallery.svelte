<svelte:options runes />

<script lang="ts">
  // 디자인 갤러리 페이지(docs/design/system/governance.md §2.6, 계약 §6). ui/ 컴포넌트 × 상태 매트릭스와 아이콘 시트.
  // 네 화면·로그인·Windows 데이터는 단계 (c)의 몫이다. hover·pressed·focus-visible은 정적으로 그리지 않는다.
  import { TITLE } from './fixtures';
  import ButtonsSection from './sections/ButtonsSection.svelte';
  import DialogSection from './sections/DialogSection.svelte';
  import DisclosureSection from './sections/DisclosureSection.svelte';
  import Displays from './sections/DisplaySections.svelte';
  import EmptySection from './sections/EmptySection.svelte';
  import FieldsSection from './sections/FieldsSection.svelte';
  import IconButtonsSection from './sections/IconButtonsSection.svelte';
  import IconsSection from './sections/IconsSection.svelte';
  import MenuSection from './sections/MenuSection.svelte';
  import NoticeSection from './sections/NoticeSection.svelte';
  import RadioSection from './sections/RadioSection.svelte';
  import SelectSection from './sections/SelectSection.svelte';
  import SurfaceSection from './sections/SurfaceSection.svelte';
  import SwitchesSection from './sections/SwitchesSection.svelte';
  import ToolbarSection from './sections/ToolbarSection.svelte';
</script>

<main class="g-page" data-gallery-root>
  <h1 class="g-h1">{TITLE.page}</h1>
  <ButtonsSection />
  <IconButtonsSection />
  <FieldsSection />
  <SelectSection />
  <SwitchesSection />
  <RadioSection />
  <DisclosureSection />
  <NoticeSection />
  <DialogSection />
  <MenuSection />
  <Displays />
  <EmptySection />
  <SurfaceSection />
  <ToolbarSection />
  <IconsSection />
</main>

<style>
  .g-page {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    max-inline-size: var(--content-max);
    margin-inline: auto;
    padding: var(--space-24) var(--gutter);
    background: var(--bg);
    color: var(--fg);
  }
  .g-h1 {
    font-size: var(--text-display);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-title);
  }
</style>
