<script lang="ts">
  // 카드 폼의 "라벨 · 값/컨트롤 · 동작" 행(docs/design/system/components.md §2.26)
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    label: string;
    help?: string;
    value?: string;
    control?: Snippet<[{ labelId: string; helpId?: string }]>;
    actions?: Snippet;
  };

  let { label, help, value, control, actions, class: klass, ...rest }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-label`;
  const helpId = $derived(help ? `${uid}-help` : undefined);
</script>

<div {...rest} class={['fieldrow', klass]}>
  <span class="fieldrow-label" id={labelId}>{label}</span>
  <div class="fieldrow-value">
    {#if control}{@render control({ labelId, helpId })}{:else if value != null}{value}{/if}
  </div>
  {#if actions}<div class="fieldrow-actions">{@render actions()}</div>{/if}
  {#if help}<span class="fieldrow-help" id={helpId}>{help}</span>{/if}
</div>
