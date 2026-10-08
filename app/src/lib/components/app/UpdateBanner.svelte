<script lang="ts">
  // 업데이트 배너(B2 > B1 > B4 순, worker.md §11.6). 표시 전용이다: A4가 update store·command와 함께
  // AppBanners에 잇는다(worker.md 구현 중 변경 A3-1 (사)).
  import { t } from '../../copy/ko';
  import Banner from '../ui/Banner.svelte';
  import Button from '../ui/Button.svelte';

  interface Props {
    version: string;
    busy?: boolean;
    oninstall: () => void;
    onlater: () => void;
  }

  let { version, busy = false, oninstall, onlater }: Props = $props();
</script>

<Banner tone="info" onclose={onlater}>
  {t('update.banner', { version })}
  {#snippet actions()}
    <Button size="sm" accentText disabled={busy} onclick={oninstall}>{t('update.install')}</Button>
    <Button size="sm" onclick={onlater}>{t('update.later')}</Button>
  {/snippet}
</Banner>
