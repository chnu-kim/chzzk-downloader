<script lang="ts">
  interface Props {
    size?: 16 | 20;
    /** 있으면 상태를 읽어 준다. 없으면 장식 */
    label?: string;
  }

  let { size = 16, label }: Props = $props();
</script>

<span
  class="spinner"
  class:lg={size === 20}
  role={label ? 'status' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
></span>

<style>
  .spinner {
    display: inline-block;
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: var(--radius-full);
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  .lg {
    width: 20px;
    height: 20px;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* 회전 대신 호를 3/4로 둔 정지 링 */
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      border-right-color: var(--accent);
      border-bottom-color: var(--accent);
    }
  }
</style>
