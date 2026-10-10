<script lang="ts">
  // D3: 첫 실행에 옛 설정을 찾았을 때 한 번 묻는다(system/patterns.md §5.2 D3). 쿠키가 들어 있을 수 있어 자동으로 적용하지 않는다.
  // "나중에"를 고르면 이번 실행에서는 다시 묻지 않고, 셸은 이미 settings.json을 만들어 다음 실행에도 묻지 않는다
  // (구현 중 변경 34). 그 뒤에는 설정 > 이전 버전에서 폴더를 골라 가져온다.
  import type { AppError } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { settings } from '../../stores/settings.svelte';
  import { toasts } from '../../stores/toast.svelte';
  import { formatCount } from '../../format/duration';
  import Dialog from '../ui/Dialog.svelte';

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

<!-- 본문 한 문장 + 가져올 것의 목록(`ul`). 선택 항목은 문장 조각이 아니라 항목 키로 나눈다(content.md §2) -->
<Dialog
  open={c != null}
  title={t('dialog.legacy.title')}
  onclose={later}
  primary={{ id: 'later', label: t('common.later'), onclick: later }}
  secondary={{ id: 'import', label: t('dialog.legacy.import'), loading: busy, onclick: () => void doImport() }}
>
  <p class="lead">{t('dialog.legacy.body')}</p>
  <ul class="items">
    <li>{t('dialog.legacy.item.folder')}</li>
    {#if c && c.recentCount > 0}<li>{t('dialog.legacy.item.recent', { n: formatCount(c.recentCount) })}</li>{/if}
    {#if c?.hasCookies}<li>{t('dialog.legacy.item.cookies')}</li>{/if}
  </ul>
</Dialog>

<style>
  .lead {
    margin: 0;
  }
  .items {
    margin: var(--space-8) 0 0;
    padding-inline-start: var(--space-20);
  }
</style>
