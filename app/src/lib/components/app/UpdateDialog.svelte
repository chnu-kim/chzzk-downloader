<script lang="ts">
  // 업데이트 확인 대화상자(worker.md §11.6): 받는 중인 영상이 있으면 일시정지하고 다시 시작한다는 것을 먼저 묻는다.
  // 오른쪽(primary, 첫 포커스)이 안전한 쪽 [나중에], 왼쪽이 실행 쪽(D1 CloseGuard와 같은 규칙).
  import { t } from '../../copy/ko';
  import { jobs } from '../../stores/jobs.svelte';
  import { update } from '../../stores/update.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';

  /** 받는 중인 생방송 수: 업데이트하면 그 녹화는 일시정지가 아니라 받은 만큼 저장하고 끝난다(ADR-0025) */
  const liveCount = $derived(
    [...jobs.state.jobs.values()].filter(
      (j) => j.playbackKind === 'live' && (j.status === 'running' || j.status === 'pausing'),
    ).length,
  );
  const bodyKey = $derived(
    liveCount === 0
      ? 'dialog.update.body'
      : liveCount >= update.confirmRunning
        ? 'dialog.updateLive.allBody'
        : 'dialog.updateLive.body',
  );
</script>

<ConfirmDialog
  open={update.phase === 'confirm'}
  title={t('dialog.update.title')}
  body={t(bodyKey, { n: update.confirmRunning })}
  onclose={() => update.cancelConfirm()}
  primary={{ id: 'later', label: t('common.later'), onclick: () => update.cancelConfirm() }}
  secondary={{ id: 'install', label: t('dialog.update.confirm'), onclick: () => void update.install(true) }}
/>
