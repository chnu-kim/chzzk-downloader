<script lang="ts">
  // 설정의 한 구역: 제목 h2(13/600) + 그룹 상자(docs/design/system/patterns.md §14.4).
  // 구역 사이 간격은 뷰가, 행은 SettingsRow가 맡는다.
  import type { Snippet } from 'svelte';
  import Surface from '../ui/Surface.svelte';

  let {
    title,
    children,
    /** 제목에 코드로 포커스를 줄 수 있게 한다(메뉴 "…에 관하여"가 정보 절 제목으로 옮긴다) */
    focusable = false,
    headingEl = $bindable(null),
  }: { title: string; children: Snippet; focusable?: boolean; headingEl?: HTMLHeadingElement | null } = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
</script>

<div class="settings-section">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <h2 id={titleId} tabindex={focusable ? -1 : undefined} bind:this={headingEl}>{title}</h2>
  <Surface variant="group" aria-labelledby={titleId}>
    {@render children()}
  </Surface>
</div>

<style>
  h2 {
    margin: 0 0 var(--space-8);
    font-size: var(--text-body);
    line-height: var(--leading-body);
    font-weight: var(--weight-strong);
  }
</style>
