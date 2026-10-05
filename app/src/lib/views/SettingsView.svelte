<script lang="ts">
  // 설정(S2, §8.7, ui-visual §6.8): 저장 · 다운로드 · 고급(네이버 로그인 정보) · 이전 버전 · 정보.
  // 즉시 저장 방식이다. 컨트롤은 저장된 값(`settings.dto`)을 읽기만 하고 바꾸면 패치를 보낸다. 저장이 실패하면
  // `settings.revision`이 올라 `{#key}`가 컨트롤을 저장된 값으로 되돌린다.
  import * as api from '../api';
  import type { AppError, AppFolder, SettingsPatch } from '../bindings';
  import CookieSection from '../components/settings/CookieSection.svelte';
  import LegacySection from '../components/settings/LegacySection.svelte';
  import Button from '../components/ui/Button.svelte';
  import InlineAlert from '../components/ui/InlineAlert.svelte';
  import Select from '../components/ui/Select.svelte';
  import Switch from '../components/ui/Switch.svelte';
  import { errorCopy } from '../copy/errors';
  import { t } from '../copy/ko';
  import { copyAppReport } from '../report';
  import { settings } from '../stores/settings.svelte';

  const PARALLEL = [1, 2, 3] as const;
  const SEGMENTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

  /** 이 화면의 저장 오류(설정 파일 문제는 B2가 따로 띄운다) */
  let error = $state<AppError | null>(null);
  const errCopy = $derived(error && error.code !== 'settings' ? errorCopy(error, { place: 'other' }) : null);

  const dto = $derived(settings.dto);
  const info = $derived(settings.info);

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

  async function openFolder(kind: AppFolder) {
    try {
      await api.openAppFolder(kind);
    } catch (e) {
      error = e as AppError;
    }
  }
</script>

<div class="settings">
  {#if errCopy}
    <InlineAlert tone="danger" title={errCopy.title}>
      {#if errCopy.body}<p class="line">{errCopy.body}</p>{/if}
      {#if errCopy.detail}<p class="line detail">{errCopy.detail}</p>{/if}
    </InlineAlert>
  {/if}

  <section aria-labelledby="s-storage">
    <h2 id="s-storage" class="section-title">{t('settings.storage')}</h2>
    <div class="group">
      <div class="row">
        <span class="label" id="l-folder">{t('settings.defaultFolder')}</span>
        <span class="value" title={dto?.effectiveDownloadFolder}>{dto?.effectiveDownloadFolder ?? ''}</span>
        <span class="buttons">
          <Button variant="link" aria-describedby="l-folder" onclick={changeFolder}>{t('folder.change')}</Button>
          <Button variant="link" aria-describedby="l-folder" onclick={() => openFolder('downloads')}>
            {t('action.openFolder')}
          </Button>
        </span>
      </div>
    </div>
  </section>

  <section aria-labelledby="s-download">
    <h2 id="s-download" class="section-title">{t('settings.download')}</h2>
    {#key settings.revision}
      <div class="group">
        <div class="row stacked">
          <div class="row-main">
            <span class="label" id="l-parallel">{t('settings.parallel')}</span>
            <Select
              value={dto?.maxParallelDownloads ?? 2}
              options={PARALLEL}
              labelledby="l-parallel"
              disabled={!dto}
              onchange={(n) => save({ maxParallelDownloads: n })}
            />
          </div>
          <p class="help">{t('settings.parallel.help')}</p>
        </div>
        <div class="row stacked">
          <div class="row-main">
            <span class="label" id="l-segments">{t('settings.segments')}</span>
            <Select
              value={dto?.segmentConcurrency ?? 4}
              options={SEGMENTS}
              labelledby="l-segments"
              disabled={!dto}
              onchange={(n) => save({ segmentConcurrency: n })}
            />
          </div>
          <p class="help">{t('settings.segments.help')}</p>
        </div>
        <div class="row stacked">
          <div class="row-main">
            <span class="label" id="l-autoresume">{t('settings.autoResume')}</span>
            <Switch
              checked={dto?.autoResumeInterrupted ?? false}
              labelledby="l-autoresume"
              disabled={!dto}
              onchange={(on) => save({ autoResumeInterrupted: on })}
            />
          </div>
          <p class="help">{t('settings.autoResume.help')}</p>
        </div>
      </div>
    {/key}
  </section>

  <CookieSection />

  <LegacySection />

  <section aria-labelledby="s-about">
    <h2 id="s-about" class="section-title">{t('settings.about.title')}</h2>
    <div class="group">
      <div class="row stacked">
        <p class="version tnum">
          {info ? t('settings.about.version', { app: info.version, core: info.coreVersion }) : ''}
        </p>
        <p class="links">
          <Button variant="link" onclick={() => openFolder('config')}>{t('settings.about.openConfig')}</Button>
          <span class="sep" aria-hidden="true">·</span>
          <Button variant="link" onclick={() => openFolder('logs')}>{t('settings.about.openLogs')}</Button>
          <span class="sep" aria-hidden="true">·</span>
          <Button variant="link" onclick={() => void copyAppReport(info)}>{t('action.copyReport')}</Button>
        </p>
      </div>
    </div>
  </section>
</div>

<style>
  .settings {
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    padding: 0 var(--gutter) var(--gutter);
  }
  @media (min-width: 840px) {
    .settings {
      padding-inline: var(--gutter-wide);
    }
  }
  .settings > :global(.alert) {
    margin-top: var(--space-4);
  }
  /* 섹션 제목은 선이 아니라 위 여백으로 구분한다(ui-visual §2.2) */
  .settings :global(.section-title) {
    margin: var(--space-6) 0 var(--space-2);
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }
  .settings :global(.group) {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .settings :global(.row) {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 48px;
    padding: var(--space-2) var(--space-4);
  }
  .settings :global(.row + .row) {
    border-top: 1px solid var(--border);
  }
  .settings :global(.row.stacked) {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
    padding-block: var(--space-3);
  }
  .settings :global(.row-main) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .settings :global(.label) {
    flex: none;
    font-size: var(--text-md);
    color: var(--fg);
  }
  .settings :global(.help) {
    margin: 0;
    font-size: var(--text-sm);
    line-height: var(--leading-body, 1.65);
    color: var(--fg-muted);
  }
  .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-muted);
  }
  .buttons {
    display: flex;
    flex: none;
  }
  .version {
    margin: 0;
    font-size: var(--text-md);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    margin: 0 0 0 -6px;
  }
  .sep {
    color: var(--fg-faint);
  }
  .line {
    margin: 0;
    font-size: var(--text-sm);
  }
  .detail {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
  /* 720~839: 값이 라벨 아래로(ui-visual §8) */
  @media (max-width: 839px) {
    .row:has(.value) {
      flex-wrap: wrap;
    }
    .value {
      order: 3;
      flex-basis: 100%;
    }
    .buttons {
      margin-left: auto;
    }
  }
</style>
