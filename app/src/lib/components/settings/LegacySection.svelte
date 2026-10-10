<script lang="ts">
  // 이전 버전(patterns.md §14.4): 폴더를 골라 예전 명령줄 버전의 설정·최근 VOD를 가져온다. 경고(평문 쿠키 등)는
  // 사용자가 행동해야 하는 내용이라 토스트가 아니라 여기 Notice로 남긴다(patterns.md §1.2).
  import * as api from '../../api';
  import type { AppError } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { settings } from '../../stores/settings.svelte';
  import { toasts } from '../../stores/toast.svelte';
  import Button from '../ui/Button.svelte';
  import Notice from '../ui/Notice.svelte';
  import SettingsRow from '../ui/SettingsRow.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let busy = $state(false);
  let error = $state<AppError | null>(null);
  const errCopy = $derived(error ? errorCopy(error, { place: 'other' }) : null);
  const last = $derived(settings.dto?.importedFrom ?? null);

  async function pick() {
    error = null;
    busy = true;
    try {
      const dir = await api.pickFolder();
      if (!dir) return;
      const r = await settings.importLegacy(dir);
      toasts.push(r ? t('legacy.done') : t('legacy.notFound'), r ? 'success' : 'info');
    } catch (e) {
      error = e as AppError;
    } finally {
      busy = false;
    }
  }
</script>

<SettingsSection title={t('settings.legacy.title')}>
  <SettingsRow
    label={t('settings.legacy.body')}
    help={last ? t('settings.legacy.last', { path: last }) : undefined}
  >
    {#snippet control({ labelId })}
      <Button aria-describedby={labelId} disabled={busy} onclick={pick}>{t('settings.legacy.pick')}</Button>
    {/snippet}
  </SettingsRow>
  {#each settings.legacyWarnings as w, i (i)}
    <div class="row"><div class="slot"><Notice tone="warning">{w}</Notice></div></div>
  {/each}
  {#if errCopy}
    <div class="row">
      <div class="slot">
        <Notice tone="danger" title={errCopy.title}>
          {#if errCopy.body}<p class="msg">{errCopy.body}</p>{/if}
          {#if errCopy.detail}<p class="msg detail">{errCopy.detail}</p>{/if}
        </Notice>
      </div>
    </div>
  {/if}
</SettingsSection>

<style>
  .slot {
    flex: 1 1 100%;
    min-width: 0;
  }
  .msg {
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
  }
  .detail {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
</style>
