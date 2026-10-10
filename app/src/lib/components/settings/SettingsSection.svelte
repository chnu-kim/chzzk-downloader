<script lang="ts">
  // 설정의 한 구역: 제목 h2(13/600) + 그룹 상자(docs/design/system/patterns.md §14.4).
  // 구역 사이 간격은 뷰가, 행은 SettingsRow가 맡는다.
  import type { Snippet } from 'svelte';
  import Surface from '../ui/Surface.svelte';

  let { title, children }: { title: string; children: Snippet } = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
</script>

<div class="settings-section">
  <h2 id={titleId}>{title}</h2>
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
