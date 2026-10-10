<script lang="ts">
  // 진행 표시 호(docs/design/system/components.md §2.23). 장식이다: 상태는 옆 글자나 aria-busy가 전한다.
  // 3/4 호 하나라 reduce 모션에서 멈춰도 "진행 중" 모양이 남는다(ui.css).
  let { size = 'md' }: { size?: 'sm' | 'md' } = $props();
</script>

<svg class={['spinner', size === 'sm' && 'spinner-sm']} viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 3a9 9 0 1 0 9 9" />
</svg>
