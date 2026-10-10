<script lang="ts">
  // 본문 열 하나(docs/design/system/components.md §2.18)
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { PageContainerVariant } from './vocab';

  type Props = HTMLAttributes<HTMLDivElement> & {
    variant?: PageContainerVariant;
    children: Snippet;
  };

  let { variant = 'content', children, class: klass, ...rest }: Props = $props();
</script>

<div {...rest} class={['col', variant === 'reading' && 'col-reading', klass]}>
  {@render children()}
</div>
