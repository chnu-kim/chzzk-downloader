<script lang="ts">
  interface Props {
    /** CSS 길이(`60%`, `8rem`) */
    width?: string;
    /** px: 12·16 */
    height?: number;
  }

  let { width = '100%', height = 12 }: Props = $props();
</script>

<span class="skeleton" aria-hidden="true" style:width style:height="{height}px"></span>

<style>
  .skeleton {
    position: relative;
    display: block;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    overflow: hidden;
  }
  .skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, var(--surface), transparent);
    opacity: 0.6;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  @keyframes shimmer {
    to {
      transform: translateX(100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton::after {
      animation: none;
      display: none;
    }
  }
</style>
