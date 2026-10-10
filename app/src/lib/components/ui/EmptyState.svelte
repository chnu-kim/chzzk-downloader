<script lang="ts">
  // 빈 상태(docs/design/system/components.md §2.15). 제목 + 본문 + 단계 + 동작 하나.
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import Button from './Button.svelte';
  import type { EmptyStateVariant, NoticeAction } from './vocab';

  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> & {
    children: Snippet;
    steps?: string[];
    action?: NoticeAction;
  } & ({ variant: Extract<EmptyStateVariant, 'inline'>; title?: never } | { variant?: Exclude<EmptyStateVariant, 'inline'>; title?: string });

  let { variant = 'panel', title, children, steps, action, class: klass, ...rest }: Props = $props();
</script>

<div {...rest} class={['empty', `empty-${variant}`, klass]}>
  {#if title}<h2>{title}</h2>{/if}
  <p>{@render children()}</p>
  {#if steps?.length}
    <ol class="steps">
      {#each steps as step, i (i)}
        <li>{step}</li>
      {/each}
    </ol>
  {/if}
  {#if action}
    <Button variant="secondary" onclick={action.onclick}>{action.label}</Button>
  {/if}
</div>
