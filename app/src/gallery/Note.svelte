<script lang="ts">
  // 설명 요소(aria-describedby 대상). 갤러리에서 "막힌 이유"·"오류 문구"를 이 요소로 보인다.
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    children: Snippet;
  }

  let { id, children }: Props = $props();
</script>

<p {id} class="g-note">{@render children()}</p>

<style>
  .g-note {
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--fg-muted);
  }
</style>
