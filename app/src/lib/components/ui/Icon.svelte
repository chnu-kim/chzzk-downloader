<script lang="ts">
  // 아이콘(docs/design/system/components.md §2.24). 늘 장식이다: 뜻은 옆 글자가 전한다(label prop 없음).
  // 굵기·색은 ui.css(.icon path { stroke-width: var(--icon-stroke) }, stroke: currentColor)가 맡고,
  // path마다 vector-effect로 화면 px 굵기를 고정한다(design-icons DI3).
  import { ICONS, type IconName } from './icons';

  interface Props {
    name: IconName;
    /** sm 16 · md 20(기본, foundations §9). 32·12는 없다 */
    size?: 'sm' | 'md';
    /** 바깥 여백용(ui.css 클래스 재정의 금지) */
    class?: string;
  }

  // 기본 md(components.md §1 "size 기본값은 md로 통일")
  let { name, size = 'md', class: klass = '' }: Props = $props();
  const paths = $derived(ICONS[name].paths);
</script>

<svg class={['icon', size === 'md' && 'icon-md', klass]} viewBox="0 0 24 24" aria-hidden="true">
  {#each paths as d, i (i)}
    <path {d} vector-effect="non-scaling-stroke" />
  {/each}
</svg>
