<script lang="ts">
  // 업데이트 배너(B4, worker.md §11.6). 표시 전용이다: 배선은 AppBanners와 update store가 한다(구현 중 변경 62 (사), A4).
  // `status`가 있으면(받는 중·설치 중) 본문이 그 문구로 바뀌고 [지금 업데이트]만 눌리지 않게 남는다. 닫을 수 없다.
  import { t } from '../../copy/ko';
  import Banner from '../ui/Banner.svelte';
  import Button from '../ui/Button.svelte';

  interface Props {
    version: string;
    busy?: boolean;
    /** 진행 문구. 있으면 [나중에]·닫기가 없다 */
    status?: string | null;
    oninstall: () => void;
    onlater: () => void;
  }

  let { version, busy = false, status = null, oninstall, onlater }: Props = $props();
</script>

{#if status}
  <Banner tone="info">
    {status}
    {#snippet actions()}
      <Button size="sm" accentText disabled>{t('update.install')}</Button>
    {/snippet}
  </Banner>
{:else}
  <Banner tone="info" onclose={onlater}>
    {t('update.banner', { version })}
    {#snippet actions()}
      <Button size="sm" accentText disabled={busy} onclick={oninstall}>{t('update.install')}</Button>
      <Button size="sm" onclick={onlater}>{t('update.later')}</Button>
    {/snippet}
  </Banner>
{/if}
