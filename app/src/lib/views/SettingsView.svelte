<script lang="ts">
  // 설정(patterns.md §14.4): 저장 위치 · 받기 · 보기 · 계정 · 고급 · 이전 버전 · 정보.
  // 열(폭·좌우 여백)은 App의 PageContainer가 소유한다. 이 뷰는 구역을 세로로 쌓기만 한다.
  // 즉시 저장 방식이다. 컨트롤은 저장된 값(`settings.dto`)을 읽기만 하고 바꾸면 패치를 보낸다. 저장이 실패하면
  // `settings.revision`이 올라 `{#key}`가 컨트롤을 저장된 값으로 되돌린다.
  import * as api from '../api';
  import type { AppError, SettingsPatch } from '../bindings';
  import AboutSection from '../components/settings/AboutSection.svelte';
  import AccountSection from '../components/settings/AccountSection.svelte';
  import CookieSection from '../components/settings/CookieSection.svelte';
  import LegacySection from '../components/settings/LegacySection.svelte';
  import SettingsSection from '../components/settings/SettingsSection.svelte';
  import ViewSection from '../components/settings/ViewSection.svelte';
  import Button from '../components/ui/Button.svelte';
  import Notice from '../components/ui/Notice.svelte';
  import Select from '../components/ui/Select.svelte';
  import SettingsRow from '../components/ui/SettingsRow.svelte';
  import Skeleton from '../components/ui/Skeleton.svelte';
  import Switch from '../components/ui/Switch.svelte';
  import { errorCopy } from '../copy/errors';
  import { t } from '../copy/ko';
  import { revealLabel } from '../platform';
  import { platform } from '../stores/platform.svelte';
  import { settings } from '../stores/settings.svelte';
  import { useDelayedLoading } from '../useDelayedLoading.svelte';

  const PARALLEL = [1, 2, 3].map((n) => ({ value: n, label: String(n) }));
  const SEGMENTS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: n, label: String(n) }));

  /** 이 화면의 저장 오류(설정 파일 문제는 B2가 따로 띄운다) */
  let error = $state<AppError | null>(null);
  const errCopy = $derived(error && error.code !== 'settings' ? errorCopy(error, { place: 'other' }) : null);

  const dto = $derived(settings.dto);
  // 설정을 아직 못 읽었으면 값 자리는 가짜 기본값이 아니라 Skeleton이다(지연 표시)
  const loading = useDelayedLoading(() => !settings.dto);

  async function save(p: SettingsPatch) {
    error = await settings.patch(p);
  }

  async function changeFolder() {
    try {
      const picked = await api.pickFolder(dto?.effectiveDownloadFolder || undefined);
      if (picked) await save({ downloadFolder: picked });
    } catch (e) {
      error = e as AppError;
    }
  }

  async function revealDownloads() {
    try {
      await api.openAppFolder('downloads');
    } catch (e) {
      error = e as AppError;
    }
  }
</script>

{#snippet pending()}
  {#if loading.visible}<span class="pending"><Skeleton variant="control" /></span>{/if}
{/snippet}

<div class="settings">
  {#if errCopy}
    <Notice tone="danger" title={errCopy.title}>
      {#if errCopy.body}<p class="line">{errCopy.body}</p>{/if}
      {#if errCopy.detail}<p class="line detail">{errCopy.detail}</p>{/if}
    </Notice>
  {/if}

  <SettingsSection title={t('settings.storage')}>
    <SettingsRow label={t('settings.defaultFolder')}>
      {#snippet control({ labelId })}
        {#if dto}
          <span class="path selectable ellipsis">{dto.effectiveDownloadFolder}</span>
        {:else}
          {@render pending()}
        {/if}
        <Button variant="ghost" size="sm" disabled={!dto} aria-describedby={labelId} onclick={changeFolder}>
          {t('folder.change')}
        </Button>
        <Button variant="ghost" size="sm" class="edge-end" disabled={!dto} aria-describedby={labelId} onclick={revealDownloads}>
          {revealLabel(platform.os)}
        </Button>
      {/snippet}
    </SettingsRow>
  </SettingsSection>

  <SettingsSection title={t('settings.download')}>
    {#key settings.revision}
      <SettingsRow label={t('settings.parallel')} help={t('settings.parallel.help')}>
        {#snippet control({ labelId, helpId })}
          {#if dto}
            <Select
              value={dto.maxParallelDownloads}
              options={PARALLEL}
              labelledby={labelId}
              aria-describedby={helpId}
              onchange={(n) => save({ maxParallelDownloads: n })}
            />
          {:else}
            {@render pending()}
          {/if}
        {/snippet}
      </SettingsRow>
      <SettingsRow label={t('settings.segments')} help={t('settings.segments.help')}>
        {#snippet control({ labelId, helpId })}
          {#if dto}
            <Select
              value={dto.segmentConcurrency}
              options={SEGMENTS}
              labelledby={labelId}
              aria-describedby={helpId}
              onchange={(n) => save({ segmentConcurrency: n })}
            />
          {:else}
            {@render pending()}
          {/if}
        {/snippet}
      </SettingsRow>
      <SettingsRow label={t('settings.autoResume')} help={t('settings.autoResume.help')}>
        {#snippet control({ labelId, helpId })}
          {#if dto}
            <Switch
              value={dto.autoResumeInterrupted}
              labelledby={labelId}
              aria-describedby={helpId}
              onchange={(on) => save({ autoResumeInterrupted: on })}
            />
          {:else}
            {@render pending()}
          {/if}
        {/snippet}
      </SettingsRow>
    {/key}
  </SettingsSection>

  <ViewSection {save} />

  <AccountSection />

  <CookieSection />

  <LegacySection />

  <AboutSection onerror={(e) => (error = e)} />
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
  }
  .pending {
    width: var(--label-w);
  }
  .path {
    color: var(--fg-muted);
  }
  .line {
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
  }
  .detail {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
</style>
