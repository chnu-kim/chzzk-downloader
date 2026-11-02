<script lang="ts">
  import { announcer } from '../../stores/announce.svelte';

  // 모달 층(대화상자·구간 편집 화면)이 열리면 modalLayer가 body의 다른 자식을 모두 inert로 만든다. 상주 영역이 앱 루트 안에 있으면
  // 그동안 접근성 트리에서 빠져 낭독이 막힌다. 그래서 body 직속으로 옮기고 `data-live-announcer`로 inert 대상에서 뺀다(ADR-0033).
  function toBody(el: HTMLElement) {
    document.body.append(el);
    return () => el.remove();
  }
</script>

<div data-live-announcer {@attach toBody}>
  <div class="sr-only" aria-live="polite" aria-atomic="true">{announcer.message}</div>
  <!-- 오류 토스트·오류 배너 전용(ADR-0033). role="alert" 리터럴은 Notice.svelte에만 둘 수 있어(design-lint DS1·DX12) aria-live로 같은 뜻을 낸다 -->
  <div class="sr-only" aria-live="assertive" aria-atomic="true">{announcer.urgent}</div>
</div>
