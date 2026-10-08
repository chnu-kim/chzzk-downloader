<script lang="ts">
  // 업데이트 확인 대화상자(worker.md §11.6): 받는 중인 영상이 있으면 일시정지하고 다시 시작한다는 것을 먼저 묻는다.
  // 기본 포커스는 안전한 쪽 [나중에](D1 CloseGuard와 같은 규칙).
  import { t } from '../../copy/ko';
  import { update } from '../../stores/update.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
</script>

<ConfirmDialog
  open={update.phase === 'confirm'}
  title={t('dialog.update.title')}
  body={t('dialog.update.body', { n: update.confirmRunning })}
  onclose={() => update.cancelConfirm()}
  buttons={[
    { label: t('dialog.update.later'), variant: 'primary', autofocus: true, onclick: () => update.cancelConfirm() },
    { label: t('dialog.update.confirm'), variant: 'secondary', onclick: () => void update.install(true) },
  ]}
/>
