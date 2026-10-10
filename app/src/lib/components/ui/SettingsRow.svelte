<script lang="ts">
  // 설정 한 행: [라벨 + 도움말] [현재 값?] [컨트롤](docs/design/system/components.md §2.17)
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    label: string;
    help?: string;
    /** 읽기만 하는 현재 값(경로·버전) */
    value?: string;
    control?: Snippet<[{ labelId: string; helpId?: string }]>;
  };

  let { label, help, value, control, class: klass, ...rest }: Props = $props();

  const uid = $props.id();
  const labelId = `${uid}-label`;
  const helpId = $derived(help ? `${uid}-help` : undefined);
</script>

<div {...rest} class={['row', klass]}>
  <div class="row-main">
    <span class="row-label" id={labelId}>{label}</span>
    {#if help}<span class="row-help" id={helpId}>{help}</span>{/if}
  </div>
  {#if value != null}<span class="row-value ellipsis">{value}</span>{/if}
  {#if control}<div class="row-control">{@render control({ labelId, helpId })}</div>{/if}
</div>
