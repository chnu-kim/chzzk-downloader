<script lang="ts">
  // 이전 버전(§8.7): 폴더를 골라 예전 명령줄 버전의 설정·최근 VOD를 가져온다. 경고(평문 쿠키 등)는
  // 사용자가 행동해야 하는 내용이라 토스트가 아니라 여기 InlineAlert로 남긴다(§7.2).
  import * as api from '../../api';
  import type { AppError } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { settings } from '../../stores/settings.svelte';
  import { toasts } from '../../stores/toast.svelte';
  import Button from '../ui/Button.svelte';
  import InlineAlert from '../ui/InlineAlert.svelte';

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

<section aria-labelledby="s-legacy">
  <h2 id="s-legacy" class="section-title">{t('settings.legacy.title')}</h2>
  <div class="group legacy">
    <p class="help">{t('settings.legacy.body')}</p>
    <div class="line">
      <Button disabled={busy} onclick={pick}>{t('settings.legacy.pick')}</Button>
      {#if last}<span class="last" title={last}>{t('settings.legacy.last', { path: last })}</span>{/if}
    </div>
    {#each settings.legacyWarnings as w, i (i)}
      <InlineAlert tone="warning" title={w} />
    {/each}
    {#if errCopy}
      <InlineAlert tone="danger" title={errCopy.title}>
        {#if errCopy.body}<p class="msg">{errCopy.body}</p>{/if}
        {#if errCopy.detail}<p class="msg detail">{errCopy.detail}</p>{/if}
      </InlineAlert>
    {/if}
  </div>
</section>

<style>
  .legacy {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    padding: var(--space-16);
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-12);
  }
  .last {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .msg {
    margin: 0;
    font-size: var(--text-sm);
  }
  .detail {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
</style>
