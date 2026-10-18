<script lang="ts">
  // 설정 › 받기의 파일 이름 규칙 행(docs/design/features/filename-template.md §5.1, patterns.md §14.4).
  // 입력칸 + [저장] + [기본값으로]. 검증은 [저장]을 누를 때만 하고(patterns.md §6.1: 타이핑 중·blur에는 오류가 없다),
  // 타이핑 중에는 CHECK_DEBOUNCE_MS 뒤 예시 이름만 갱신한다(읽을 수 없으면 예시 줄을 비운다, 오류는 보이지 않는다).
  // 검증과 예시는 Rust `preview_file_name_template` 한 곳이 한다(정리 규칙을 TS로 옮기지 않는다, T7).
  // 한글을 치는 칸이라 Enter에 동작을 달지 않는다.
  import { tick } from 'svelte';
  import * as api from '../../api';
  import type { AppError, TemplateErrorDto } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t, type CopyKey } from '../../copy/ko';
  import { DEFAULT_FILE_NAME_TEMPLATE } from '../../fileNameTemplate';
  import { CHECK_DEBOUNCE_MS } from '../../receive';
  import { settings } from '../../stores/settings.svelte';
  import Button from '../ui/Button.svelte';
  import Notice from '../ui/Notice.svelte';
  import SettingsRow from '../ui/SettingsRow.svelte';
  import TextField from '../ui/TextField.svelte';

  const uid = $props.id();
  const errorId = `${uid}-error`;

  /** 저장된 값. 규칙이 없으면(기본 이름) 기본 템플릿 문자열을 보인다 */
  const saved = $derived(settings.dto?.fileNameTemplate ?? DEFAULT_FILE_NAME_TEMPLATE);

  let draft = $state('');
  let synced: string | null = null;
  let el: HTMLInputElement | null = $state(null);
  let composing = false;
  let preview = $state<string | null>(null);
  let invalid = $state<TemplateErrorDto | null>(null);
  let failure = $state<AppError | null>(null);
  let busy = $state(false);

  // 저장된 값이 바뀌면(저장·기본값으로·설정을 다시 읽음) 입력칸도 그 값으로 맞춘다
  $effect(() => {
    if (saved === synced) return;
    synced = saved;
    draft = saved;
  });

  // 입력이 바뀌면 이전 오류를 걷고, 디바운스 뒤 예시 이름을 새로 받는다. 늦게 온 응답은 버린다.
  let seq = 0;
  $effect(() => {
    const value = draft;
    invalid = null;
    const timer = setTimeout(async () => {
      const mine = ++seq;
      let next: string | null = null;
      try {
        const p = await api.previewFileNameTemplate(value);
        next = p.status === 'ok' ? (p.names[0]?.name ?? null) : null;
      } catch {
        next = null;
      }
      if (mine === seq) preview = next;
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  });

  const changed = $derived(draft !== saved);
  const notDefault = $derived(draft.trim() !== DEFAULT_FILE_NAME_TEMPLATE);
  // `settings`(설정 파일을 못 씀)는 B2 배너가 알린다
  const failCopy = $derived(failure && failure.code !== 'settings' ? errorCopy(failure, { place: 'other' }) : null);

  const ERROR_KEY = {
    unbalancedBrace: 'settings.fileNameTemplate.error.brace',
    unknownToken: 'settings.fileNameTemplate.error.unknown',
    duplicateToken: 'settings.fileNameTemplate.error.duplicate',
    pathSeparator: 'settings.fileNameTemplate.error.separator',
    missingTitle: 'settings.fileNameTemplate.error.noTitle',
    tooLong: 'settings.fileNameTemplate.error.tooLong',
  } as const satisfies Record<TemplateErrorDto['kind'], CopyKey>;

  const invalidText = $derived(
    invalid ? t(ERROR_KEY[invalid.kind], { token: invalid.token === undefined ? '' : `{${invalid.token}}` }) : '',
  );

  function fieldProps(helpId: string | undefined) {
    return invalid
      ? { invalid: true as const, 'aria-describedby': helpId ? `${errorId} ${helpId}` : errorId }
      : { invalid: false as const, 'aria-describedby': helpId };
  }

  async function save() {
    busy = true;
    failure = null;
    invalid = null;
    try {
      // 마지막 미리보기가 아니라 지금 값으로 새로 검증한다
      const p = await api.previewFileNameTemplate(draft);
      if (p.status === 'invalid') {
        invalid = p.error;
        busy = false;
        await tick();
        el?.focus();
        if (!composing) el?.select();
        return;
      }
    } catch (e) {
      failure = e as AppError;
      busy = false;
      return;
    }
    failure = await settings.patch({ fileNameTemplate: draft });
    busy = false;
  }

  async function reset() {
    failure = null;
    invalid = null;
    if (settings.dto?.fileNameTemplate != null) {
      busy = true;
      failure = await settings.patch({ fileNameTemplate: null });
      busy = false;
    }
    draft = DEFAULT_FILE_NAME_TEMPLATE;
  }
</script>

<div class="template">
  <SettingsRow label={t('settings.fileNameTemplate')} help={t('settings.fileNameTemplate.help')}>
    {#snippet control({ labelId, helpId })}
      <span class="field">
        <TextField
          labelledby={labelId}
          bind:value={draft}
          bind:el
          disabled={busy}
          {...fieldProps(helpId)}
          oncompositionstart={() => (composing = true)}
          oncompositionend={() => (composing = false)}
        />
      </span>
      <!-- 이미 같은 값이면 할 일이 없어 그리지 않는다(사유 없는 비활성은 두지 않는다, patterns.md §6.4) -->
      {#if changed}
        <Button size="sm" loading={busy} onclick={save}>{t('common.save')}</Button>
      {/if}
      {#if notDefault}
        <Button variant="ghost" size="sm" disabled={busy} onclick={reset}>{t('settings.fileNameTemplate.reset')}</Button>
      {/if}
    {/snippet}
  </SettingsRow>
  {#if invalid}
    <div class="below">
      <Notice id={errorId} variant="inline" tone="danger">{invalidText}</Notice>
    </div>
  {:else if failCopy}
    <div class="below">
      <Notice variant="inline" tone="danger" title={failCopy.title}>
        {#if failCopy.body}<p class="line">{failCopy.body}</p>{/if}
        {#if failCopy.detail}<p class="line detail">{failCopy.detail}</p>{/if}
      </Notice>
    </div>
  {/if}
  {#if preview !== null}
    <p class="preview selectable">{t('settings.fileNameTemplate.preview', { name: preview })}</p>
  {/if}
</div>

<style>
  /* 설정 그룹의 행 사이 선(.surface-group > .row + .row)은 직계 자식 행에만 걸려 여기서 직접 긋는다 */
  .template {
    border-top: 1px solid var(--separator);
    padding-bottom: var(--space-6);
  }
  .field {
    flex: 1 1 calc(16 * var(--text-body));
    min-width: calc(10 * var(--text-body));
  }
  .below {
    padding: 0 var(--space-12) var(--space-6);
  }
  .preview {
    margin: 0;
    padding: 0 var(--space-12);
    color: var(--fg-muted);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    overflow-wrap: anywhere;
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
