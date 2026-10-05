<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** 테두리·글자 색. 면은 늘 투명(ui-visual §1.3) */
    tone: 'rewind' | 'vod' | 'clip' | 'adult';
    /** 글자만으로 뜻이 모자랄 때(성인 "19") */
    label?: string;
    title?: string;
    children: Snippet;
  }

  let { tone, label, title, children }: Props = $props();
</script>

<span class="badge {tone}" role={label ? 'img' : undefined} aria-label={label} {title}>
  {@render children()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 6px;
    border: 1px solid currentColor;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    line-height: 1;
    white-space: nowrap;
  }
  .rewind {
    color: var(--kind-rewind);
  }
  .vod {
    color: var(--kind-vod);
  }
  .clip {
    color: var(--kind-clip);
  }
  .adult {
    color: var(--danger);
  }
</style>
