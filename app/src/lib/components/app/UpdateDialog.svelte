<script lang="ts">
  // 업데이트 확인 대화상자(worker.md §11.6): 받는 중인 영상이 있으면 일시정지하고 다시 시작한다는 것을 먼저 묻는다.
  // 오른쪽(primary, 첫 포커스)이 안전한 쪽 [나중에], 왼쪽이 실행 쪽(D1 CloseGuard와 같은 규칙).
  import { t } from '../../copy/ko';
  import { update } from '../../stores/update.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
</script>

<ConfirmDialog
  open={update.phase === 'confirm'}
  title={t('dialog.update.title')}
  body={t('dialog.update.body', { n: update.confirmRunning })}
  onclose={() => update.cancelConfirm()}
  primary={{ id: 'later', label: t('common.later'), onclick: () => update.cancelConfirm() }}
  secondary={{ id: 'install', label: t('dialog.update.confirm'), onclick: () => void update.install(true) }}
/>
