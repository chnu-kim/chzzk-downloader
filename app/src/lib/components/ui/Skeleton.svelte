<script lang="ts">
  // 결과와 같은 자리를 차지하는 회색 막대(docs/design/system/components.md §2.22). 정지, 장식.
  import type { HTMLAttributes } from 'svelte/elements';
  import type { SkeletonVariant } from './vocab';

  type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
    variant: SkeletonVariant;
    width?: 'full' | 'half';
  };

  let { variant, width = 'full', class: klass, ...rest }: Props = $props();
</script>

<span
  {...rest}
  class={['skeleton', `skeleton-${variant}`, width === 'half' && 'skeleton-half', klass]}
  aria-hidden="true"
></span>
