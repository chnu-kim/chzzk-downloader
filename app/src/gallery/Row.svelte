<script lang="ts">
  // 갤러리 한 줄: 이름표 + 줄바꿈하는 칸들. vocab이면 data-vocab="<배열 이름>:<값>"으로 어휘를 알린다(gallery.spec이 대조).
  import type { Snippet } from 'svelte';

  interface Props {
    label?: string;
    vocab?: string;
    /** 세로로 쌓는다(폭이 넓은 항목) */
    stack?: boolean;
    children: Snippet;
  }

  let { label, vocab, stack = false, children }: Props = $props();
</script>

<div class="g-row" data-vocab={vocab}>
  {#if label}<span class="g-label">{label}</span>{/if}
  <div class="g-cells" class:g-stack={stack}>
    {@render children()}
  </div>
</div>

<style>
  .g-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-inline-size: 0;
  }
  .g-label {
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--fg-muted);
  }
  .g-cells {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    min-inline-size: 0;
  }
  .g-stack {
    /* 여러 줄 열 컨테이너는 줄 폭이 가장 넓은 자식을 따라가 stretch가 좁히지 못한다 */
    flex-wrap: nowrap;
    flex-direction: column;
    align-items: stretch;
  }
</style>
