<script lang="ts">
  // 흰 면 하나(docs/design/system/components.md §2.16). group은 자식 행이 패딩을, card는 header·body·footer.
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { SurfaceVariant } from './vocab';

  type Props = HTMLAttributes<HTMLElement> & {
    variant?: SurfaceVariant;
    header?: Snippet;
    footer?: Snippet;
    children: Snippet;
  };

  let { variant = 'group', header, footer, children, class: klass, ...rest }: Props = $props();
</script>

<section {...rest} class={['surface', `surface-${variant}`, klass]}>
  {#if variant === 'card'}
    {#if header}<div class="card-header">{@render header()}</div>{/if}
    <div class="card-body">{@render children()}</div>
    {#if footer}<div class="card-footer">{@render footer()}</div>{/if}
  {:else}
    {@render children()}
  {/if}
</section>
