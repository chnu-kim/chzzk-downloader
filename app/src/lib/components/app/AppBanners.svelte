<script lang="ts">
  // 헤더 바로 아래 배너 자리(ui-visual §6.6). 하나씩만 보인다.
  // B1: 재시작 직후 중단된 다운로드(§8.6). "모두 이어받기"는 중단된 작업을 하나씩 다시 줄 세운다.
  import { t } from '../../copy/ko';
  import { jobs } from '../../stores/jobs.svelte';
  import Banner from '../ui/Banner.svelte';
  import Button from '../ui/Button.svelte';

  let resuming = $state(false);

  async function resumeAll() {
    resuming = true;
    try {
      await jobs.resumeAllInterrupted();
    } finally {
      resuming = false;
    }
  }
</script>

{#if jobs.showInterruptedBanner}
  <Banner tone="info" onclose={() => jobs.dismissBanner()}>
    {t('banner.interrupted', { n: jobs.interruptedCount })}
    {#snippet actions()}
      <Button size="sm" accentText disabled={resuming} onclick={resumeAll}>{t('banner.resumeAll')}</Button>
    {/snippet}
  </Banner>
{/if}
