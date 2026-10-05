<script lang="ts">
  // 홈(S1): 입력 영역(§15-14). 다운로드 목록은 §15-15에서 아래에 더한다.
  import InputPanel from '../components/receive/InputPanel.svelte';
</script>

<div class="home">
  <InputPanel />
</div>

<style>
  .home {
    width: 100%;
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--gutter);
  }
  @media (min-width: 840px) {
    .home {
      padding: var(--gutter-wide);
    }
  }
</style>
