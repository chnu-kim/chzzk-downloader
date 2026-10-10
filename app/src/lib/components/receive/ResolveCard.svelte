<script lang="ts">
  // 영상 카드(S1-b, §8.3, ui-visual §6.3). 화질·폴더·파일 이름을 고르고 `enqueue`한다.
  // 파일 이름·화질·폴더가 바뀔 때마다 150ms 뒤 `check_output`을 부르고, 지금 입력의 결과가 올 때까지
  // 다운로드를 막는다(낡은 결과로 충돌 안내를 건너뛰지 않게).
  import { onMount, untrack } from 'svelte';
  import * as api from '../../api';
  import type { AppError, OutputCheck, ResolvedDto } from '../../bindings';
  import { actionLabel, errorCopy, type ActionId } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import {
    DEFAULT_CHOICES,
    buildEnqueueRequest,
    canDownload,
    checkKey,
    kindLabel,
    kindTone,
    metaParts,
    type CardChoices,
  } from '../../receive';
  import { announcer } from '../../stores/announce.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { modKey, modLabel } from '../../stores/ui.svelte';
  import Badge from '../ui/Badge.svelte';
  import Button from '../ui/Button.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import InlineAlert from '../ui/InlineAlert.svelte';
  import ConflictNotice from './ConflictNotice.svelte';
  import FilenameField from './FilenameField.svelte';
  import FolderField from './FolderField.svelte';
  import OwnershipNotice from './OwnershipNotice.svelte';
  import QualityPicker from './QualityPicker.svelte';

  interface Props {
    view: ResolvedDto;
    onclose: () => void;
    /** 목록에 넣은 뒤(카드를 접고 입력줄로 돌아간다) */
    onadded: () => void;
    /** 오류 동작 중 카드가 처리하지 않는 것(설정 열기·보고 복사 등) */
    onaction: (a: ActionId, err: AppError) => void;
    /** 충돌 안내의 [목록에서 보기] */
    onshowjob: (jobId: number) => void;
  }

  let { view, onclose, onadded, onaction, onshowjob }: Props = $props();

  // 카드는 불러올 때마다 새로 만들어지므로(부모가 {#key}) 처음 값만 쓴다.
  const initial = untrack(() => ({
    quality: Math.min(Math.max(view.defaultQualityIndex, 0), Math.max(view.qualities.length - 1, 0)),
    fileName: view.suggestedFileName,
  }));

  let qualityIndex = $state(initial.quality);
  /** null = 설정의 저장 폴더 */
  let folder: string | null = $state(null);
  let fileName = $state(initial.fileName);
  let choices: CardChoices = $state({ ...DEFAULT_CHOICES });
  let check: OutputCheck | null = $state(null);
  let checkedKey: string | null = $state(null);
  let checkError: AppError | null = $state(null);
  let enqueueError: AppError | null = $state(null);
  let busy = $state(false);
  let titleEl: HTMLHeadingElement | null = $state(null);
  /** 같은 입력으로 다시 검사하고 싶을 때 올린다 */
  let recheck = $state(0);

  const quality = $derived(view.qualities[qualityIndex]);
  const key = $derived(checkKey(folder, fileName, quality?.id ?? ''));
  const tone = $derived(kindTone(view.meta.kind, view.playbackKind));
  const folderPath = $derived(
    folder ?? settings.dto?.effectiveDownloadFolder ?? settings.info?.defaultDownloadFolder ?? '',
  );
  const ready = $derived(
    !!quality &&
      canDownload({ fileName, check, checkedKey, currentKey: key, busy, ownership: view.ownership, choices }),
  );
  const shownError: AppError | null = $derived<AppError | null>(enqueueError ?? checkError);
  const errCopy = $derived(
    shownError ? errorCopy(shownError, { place: 'resolve', cookiesEnabled: settings.cookiesEnabled }) : null,
  );

  // 가장 최근에 요청한 열쇠. 늦게 온 결과는 이것과 다르면 버린다.
  let latestKey = '';

  $effect(() => {
    const k = key;
    const name = fileName;
    const f = folder;
    const q = quality;
    void recheck;
    latestKey = k;
    if (!q || !name.trim()) {
      check = null;
      checkedKey = null;
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const c = await api.checkOutput({
          folder: f,
          fileName: name,
          content: view.content,
          qualityId: q.id,
          expectedKind: view.playbackKind,
        });
        if (latestKey !== k) return;
        check = c;
        checkedKey = k;
        checkError = null;
      } catch (e) {
        if (latestKey !== k) return;
        check = null;
        checkedKey = null;
        checkError = e as AppError;
      }
    }, 150);
    return () => clearTimeout(handle);
  });

  onMount(() => {
    // 불러오기가 끝나면 카드 제목으로 포커스(§8.10)
    titleEl?.focus();
    announcer.say(`${t('resolve.done')}: ${view.meta.title}`);
  });

  async function changeFolder() {
    let picked: string | null;
    try {
      picked = await api.pickFolder(folderPath || undefined);
    } catch (e) {
      checkError = e as AppError;
      return;
    }
    if (!picked) return;
    folder = picked;
    // 카드에서 바꾼 폴더는 다음에도 기본값이 된다(§8.3, "마지막 화질"과 같은 기억 방식)
    void settings.patch({ downloadFolder: picked });
  }

  async function download() {
    if (!ready || !check || !quality) return;
    busy = true;
    enqueueError = null;
    try {
      await api.enqueue(buildEnqueueRequest(view, quality, folder, check, choices));
      announcer.say(t('card.added'));
      void settings.refresh(); // 최근 VOD·마지막 화질이 바뀌었다
      onadded();
    } catch (e) {
      enqueueError = e as AppError;
      // 그 사이 목록이나 파일이 바뀌었을 수 있다. 같은 입력으로 다시 검사한다.
      checkedKey = null;
      recheck += 1;
    } finally {
      busy = false;
    }
  }

  function onErrorAction(a: ActionId) {
    const err = shownError;
    if (!err) return;
    if (a === 'close') onclose();
    else if (a === 'showInList' && err.payload?.type === 'duplicateOutput') onshowjob(err.payload.jobId);
    else if (a === 'retry') {
      if (enqueueError) {
        enqueueError = null;
        void download();
      } else {
        checkError = null;
        recheck += 1;
      }
    } else onaction(a, err);
  }

  function onwindowkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && modKey(e) && !e.defaultPrevented) {
      e.preventDefault();
      void download();
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<section class="card" aria-labelledby="card-heading">
  <div class="head">
    <span class="eyebrow">{t('card.title')}</span>
    <IconButton icon="x" label={t('card.close')} onclick={onclose} />
  </div>

  <div class="badges">
    <Badge tone={tone} title={tone === 'rewind' ? t('kind.liveRewind.tip') : undefined}>{kindLabel(tone)}</Badge>
    {#if view.meta.adult}
      <Badge tone="adult" label={t('badge.adult.label')}>{t('badge.adult')}</Badge>
    {/if}
  </div>
  <h2 id="card-heading" class="title" tabindex="-1" title={view.meta.title} bind:this={titleEl}>
    {view.meta.title}
  </h2>
  <p class="meta">
    {#each metaParts(view) as part, i (i)}
      {#if i > 0}<span class="dot" aria-hidden="true">·</span>{/if}<span class="tnum">{part}</span>
    {/each}
  </p>

  <div class="fields">
    <QualityPicker qualities={view.qualities} durationSecs={view.meta.durationSecs} bind:selected={qualityIndex} />
    <div class="paths">
      <FolderField path={folderPath} onchange={changeFolder} disabled={busy} />
      <FilenameField
        bind:value={fileName}
        suggested={view.suggestedFileName}
        willSaveAs={check && checkedKey === key && check.truncated ? check.fileName : null}
        disabled={busy}
      />
    </div>
    {#if check && checkedKey === key}
      <ConflictNotice {check} bind:choices onshowinlist={() => check?.duplicateJobId != null && onshowjob(check.duplicateJobId)} />
    {/if}
    <OwnershipNotice ownership={view.ownership} channelName={view.meta.channelName} />
    {#if errCopy}
      <InlineAlert tone="danger" title={errCopy.title}>
        {#if errCopy.body}<p class="err-line">{errCopy.body}</p>{/if}
        {#if errCopy.detail}<p class="err-line detail">{errCopy.detail}</p>{/if}
        {#snippet actions()}
          {#each errCopy.actions as a (a)}
            <Button size="sm" onclick={() => onErrorAction(a)}>{actionLabel(a)}</Button>
          {/each}
        {/snippet}
      </InlineAlert>
    {/if}
  </div>

  <div class="actions">
    <Button onclick={onclose}>{t('card.cancel')}</Button>
    <Button variant="primary" icon="drop" kbd={modLabel('Enter')} disabled={!ready} onclick={download}>
      {t('card.download')}
    </Button>
  </div>
</section>

<style>
  .card {
    margin-top: var(--space-12);
    padding: var(--space-16);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) 0 0;
  }
  .eyebrow {
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    color: var(--fg-muted);
  }
  .badges {
    display: flex;
    gap: var(--space-4);
    margin-top: var(--space-8);
  }
  .title {
    margin: var(--space-8) 0 0;
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-tight);
    letter-spacing: var(--tracking-tight);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .title:focus {
    outline: none;
  }
  .title:focus-visible {
    box-shadow: var(--focus-ring);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-8);
    margin: var(--space-4) 0 0;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .dot {
    color: var(--fg-faint);
  }
  .fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    margin-top: var(--space-12);
  }
  .paths {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .err-line {
    margin: 0;
  }
  .err-line.detail {
    color: var(--fg-muted);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-8);
    margin-top: var(--space-16);
  }
</style>
