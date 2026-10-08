<script lang="ts">
  // 헤더 바로 아래 배너 자리(ui-visual §6.6). 하나씩만 보인다.
  // B2: 설정 저장 실패(`settings`)가 B1보다 앞이다.
  // B1: 재시작 직후 중단된 다운로드(§8.6). "모두 이어받기"는 중단된 작업을 하나씩 다시 줄 세운다.
  // B4: 새 버전(worker.md §11.6)이 B1 뒤다. 단 받는 중·설치 중에는 진행 문구가 먼저다(설치가 받던 작업을 멈추면 B1이
  // 켜져 진행 문구를 가리기 때문, worker.md A4-7).
  import * as api from '../../api';
  import { t } from '../../copy/ko';
  import { formatBytes } from '../../format/bytes';
  import { jobs } from '../../stores/jobs.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { update } from '../../stores/update.svelte';
  import Banner from '../ui/Banner.svelte';
  import Button from '../ui/Button.svelte';
  import UpdateBanner from './UpdateBanner.svelte';

  let resuming = $state(false);

  async function resumeAll() {
    resuming = true;
    try {
      await jobs.resumeAllInterrupted();
    } finally {
      resuming = false;
    }
  }

  /** 지금 보일 배너 하나. B4가 기본 배너에서 진행 배너로 바뀌어도 같은 분기라 같은 노드로 남는다(A4-12) */
  const which = $derived.by((): 'update' | 'settings' | 'interrupted' | null => {
    if (update.busy) return 'update';
    if (settings.saveError) return 'settings';
    if (jobs.showInterruptedBanner) return 'interrupted';
    if (update.showBanner) return 'update';
    return null;
  });
  /** 받는 중에는 시작 때 본 버전(그사이 확인 결과가 available을 비워도 진행 배너가 남는다) */
  const updateVersion = $derived(update.busy ? (update.installVersion ?? update.available?.version ?? '') : (update.available?.version ?? ''));
  const updateStatus = $derived(
    update.phase === 'downloading' ? t('update.downloading') : update.phase === 'installing' ? t('update.installing') : null,
  );
  const updateDetail = $derived(
    update.phase !== 'downloading' ? null : update.pct !== null ? `${update.pct}%` : formatBytes(update.received),
  );
</script>

{#if which === 'update'}
  <UpdateBanner
    version={updateVersion}
    busy={update.busy || update.pending}
    status={updateStatus}
    detail={updateDetail}
    oninstall={() => void update.install()}
    onlater={() => update.later()}
  />
{:else if which === 'settings'}
  <Banner tone="danger" onclose={() => settings.dismissSaveError()}>
    {t('banner.settingsError')}
    {#snippet actions()}
      <Button size="sm" onclick={() => void api.openAppFolder('config').catch(() => {})}>
        {t('action.openConfigFolder')}
      </Button>
      <Button size="sm" onclick={() => void settings.retrySave()}>{t('action.retry')}</Button>
    {/snippet}
  </Banner>
{:else if which === 'interrupted'}
  <Banner tone="info" onclose={() => jobs.dismissBanner()}>
    {t('banner.interrupted', { n: jobs.interruptedCount })}
    {#snippet actions()}
      <Button size="sm" accentText disabled={resuming} onclick={resumeAll}>{t('banner.resumeAll')}</Button>
    {/snippet}
  </Banner>
{/if}
