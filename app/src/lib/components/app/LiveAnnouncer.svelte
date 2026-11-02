<script lang="ts">
  import { announcer } from '../../stores/announce.svelte';
</script>

<div class="sr-only" aria-live="polite" aria-atomic="true">{announcer.message}</div>
<!-- 오류 토스트·오류 배너 전용(ADR-0033). role="alert" 리터럴은 Notice.svelte에만 둘 수 있어(design-lint DS1·DX12) aria-live로 같은 뜻을 낸다 -->
<div class="sr-only" aria-live="assertive" aria-atomic="true">{announcer.urgent}</div>
