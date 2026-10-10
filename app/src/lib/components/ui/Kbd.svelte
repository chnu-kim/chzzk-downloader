<script lang="ts">
  // 단축키 표시(docs/design/system/components.md §2.8). 글자는 호출부가 넣는다.
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<kbd class="kbd">{@render children()}</kbd>
