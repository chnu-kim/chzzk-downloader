<script lang="ts">
  // 네이티브 타이틀바 아래 띠(docs/design/system/components.md §2.28). 안쪽은 PageContainer와 같은 .col.
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
    start: Snippet;
    end?: Snippet;
  };

  let { start, end, class: klass, ...rest }: Props = $props();
</script>

<header {...rest} class={['toolbar', klass]}>
  <div class="col">
    {@render start()}
    <div class="toolbar-end">{@render end?.()}</div>
  </div>
</header>
