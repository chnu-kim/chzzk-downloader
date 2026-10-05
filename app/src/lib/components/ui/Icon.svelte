<script lang="ts">
  import { ICONS, type IconName, type IconShape } from './icons';

  interface Props {
    name: IconName;
    /** 20(기본)·16·32 px */
    size?: 16 | 20 | 32;
    /** 있으면 뜻 있는 그림(role=img), 없으면 장식(aria-hidden) */
    label?: string;
    class?: string;
  }

  let { name, size = 20, label, class: klass = '' }: Props = $props();
  const shape: IconShape = $derived(ICONS[name]);
</script>

<svg
  class="icon {klass}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  {#each shape.paths as d (d)}
    <path {d} />
  {/each}
  {#each shape.dots ?? [] as [cx, cy, r] (`${cx},${cy}`)}
    <circle {cx} {cy} {r} fill="currentColor" stroke="none" />
  {/each}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
