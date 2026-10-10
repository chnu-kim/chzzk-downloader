<script lang="ts">
  // D3: 첫 실행에 옛 설정을 찾았을 때 한 번 묻는다(system/patterns.md §5.2 D3). 쿠키가 들어 있을 수 있어 자동으로 적용하지 않는다.
  // "나중에"를 고르면 이번 실행에서는 다시 묻지 않고, 셸은 이미 settings.json을 만들어 다음 실행에도 묻지 않는다
  // (구현 중 변경 34). 그 뒤에는 설정 > 이전 버전에서 폴더를 골라 가져온다.
  import type { AppError } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { settings } from '../../stores/settings.svelte';
  import { toasts } from '../../stores/toast.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';

  const c = $derived(settings.legacyCandidate);
  let busy = $state(false);

  function later() {
    settings.legacyPromptDone = true;
  }

  async function doImport() {
    if (busy) return;
    busy = true;
    try {
      const r = await settings.importLegacy(null);
      toasts.push(r ? t('legacy.done') : t('legacy.notFound'), r ? 'success' : 'info');
    } catch (e) {
      settings.legacyPromptDone = true;
      toasts.push(errorCopy(e as AppError, { place: 'other' }).title, 'danger');
    } finally {
      busy = false;
    }
  }
</script>

<ConfirmDialog
  open={c != null}
  title={t('dialog.legacy.title')}
  body={c
    ? t('dialog.legacy.body', { n: c.recentCount, cookies: c.hasCookies ? t('dialog.legacy.cookies') : '' })
    : ''}
  onclose={later}
  primary={{ id: 'later', label: t('dialog.legacy.later'), onclick: later }}
  secondary={{ id: 'import', label: t('dialog.legacy.import'), loading: busy, onclick: () => void doImport() }}
/>
