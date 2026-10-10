<script lang="ts">
  // 영상 카드(system/patterns.md §6.5·§14.2 (c)). 화질·폴더·파일 이름을 고르고 `enqueue`한다.
  // 파일 이름·화질·폴더가 바뀔 때마다 CHECK_DEBOUNCE_MS 뒤 `check_output`을 부르고, 지금 입력의 결과가 올 때까지
  // [받기]를 막는다(낡은 결과로 충돌 안내를 건너뛰지 않게). 같은 이름 파일을 "덮어쓰기"로 골랐으면 [받기]가 D7을 연다.
  // 영역(region)의 이름은 영상 제목이다(h3). 머리 h2는 섹션 제목 급의 `card.title`.
  // 카드와 `.main` 사이 어떤 조상에도 overflow를 두지 않는다: 바닥 줄(.card-footer)이 sticky라서다.
  import { onMount, untrack } from 'svelte';
  import * as api from '../../api';
  import type { AppError, OutputCheck, ResolvedDto } from '../../bindings';
  import { actionLabel, errorCopy, type ActionId } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { shortcutText } from '../../platform';
  import {
    BLOCK_REASON_ID,
    CHECK_DEBOUNCE_MS,
    DEFAULT_CHOICES,
    FILE_EXT,
    buildEnqueueRequest,
    canDownload,
    checkKey,
    downloadBlock,
    kindTone,
    metaParts,
    notices,
    type CardChoices,
  } from '../../receive';
  import { announcer } from '../../stores/announce.svelte';
  import { platform } from '../../stores/platform.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { modKey } from '../../stores/ui.svelte';
  import OverwriteDialog from '../app/OverwriteDialog.svelte';
  import Badge from '../ui/Badge.svelte';
  import Button from '../ui/Button.svelte';
  import { isImeKey } from '../ui/focus';
  import IconButton from '../ui/IconButton.svelte';
  import Notice from '../ui/Notice.svelte';
  import Surface from '../ui/Surface.svelte';
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
  /** D7: 덮어쓰기를 고르고 [받기]를 눌렀을 때의 확인 대화상자 */
  let confirmOverwrite = $state(false);
  /** 같은 입력으로 다시 검사하고 싶을 때 올린다 */
  let recheck = $state(0);

  function wantsOverwrite(c: OutputCheck | null, ch: CardChoices): boolean {
    return !!c && c.exists && ch.existing === 'overwrite';
  }

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
  /** 이 검사 결과가 지금 입력의 것인가(낡은 결과의 충돌 안내·사유를 보이지 않는다) */
  const fresh = $derived(check != null && checkedKey === key);
  /** [받기]를 막는 사유(없으면 null). 사유가 있으면 그 문장 요소를 aria-describedby로 잇는다 */
  const blocked = $derived(downloadBlock(view.ownership, fresh ? check : null));
  /** 같은 이름의 파일을 지우고 받는다: 확인(D7)을 거친다. 저장될 이름은 검사가 정리한 이름이다 */
  const overwriting = $derived(fresh && wantsOverwrite(check, choices));
  const shownError: AppError | null = $derived<AppError | null>(enqueueError ?? checkError);
  const errCopy = $derived(
    shownError ? errorCopy(shownError, { place: 'resolve', cookiesEnabled: settings.cookiesEnabled }) : null,
  );
  const errActions = $derived(
    (errCopy?.actions ?? []).map((a) => ({ id: a, label: actionLabel(a), onclick: () => onErrorAction(a) })),
  );

  /** 카드 안 경고가 하나라도 있는가(없으면 간격도 두지 않는다) */
  const hasWarnings = $derived.by(() => {
    const n = fresh && check ? notices(check, choices) : null;
    const conflict = !!n && (n.duplicate || n.exists || n.partialSame != null || n.partialOther);
    return conflict || view.ownership === 'notOwn' || view.ownership === 'unknown' || view.ownership === 'adminOverride' || !!shownError;
  });
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
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  });

  onMount(() => {
    // 불러오기가 끝나면 카드 제목으로 포커스(patterns.md §9 F-6)
    titleEl?.focus();
    announcer.say(t('a11y.resolved', { title: view.meta.title }));
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
    // 카드에서 바꾼 폴더는 다음에도 기본값이 된다(patterns.md §6.5, "마지막 화질"과 같은 기억 방식)
    void settings.patch({ downloadFolder: picked });
  }

  /** [받기]·Mod+Enter: 덮어쓰기면 확인을 먼저 묻고, 아니면 곧바로 등록한다 */
  function download() {
    if (!ready || !check || !quality) return;
    if (overwriting) confirmOverwrite = true;
    else void enqueueNow();
  }

  async function enqueueNow() {
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
      confirmOverwrite = false;
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
        download();
      } else {
        checkError = null;
        recheck += 1;
      }
    } else onaction(a, err);
  }

  function onwindowkeydown(e: KeyboardEvent) {
    if (isImeKey(e)) return;
    // 확인 대화상자가 열려 있으면 그 대화상자의 Enter가 맡는다
    if (e.key === 'Enter' && modKey(e) && !e.defaultPrevented && !confirmOverwrite) {
      e.preventDefault();
      download();
    }
  }
</script>

<svelte:window onkeydown={onwindowkeydown} />

<Surface variant="card" class="card video-card" aria-labelledby="card-title">
  {#snippet header()}
    <h2>{t('card.title')}</h2>
    <IconButton icon="x" size="sm" label={t('common.close')} onclick={onclose} />
  {/snippet}

  <div class="badges">
    <Badge kind={tone} />
    {#if view.meta.adult}
      <Badge kind="adult" />
    {/if}
  </div>
  <h3 id="card-title" class="video-title" tabindex="-1" data-focus-container bind:this={titleEl}>{view.meta.title}</h3>
  <p class="meta">
    {#each metaParts(view) as part, i (i)}
      {#if i > 0}<span aria-hidden="true">·</span>{/if}<span class="num">{part}</span>
    {/each}
  </p>

  <div class="fields">
    <QualityPicker qualities={view.qualities} durationSecs={view.meta.durationSecs} bind:selected={qualityIndex} />
    <FolderField path={folderPath} onchange={changeFolder} disabled={busy} />
    <FilenameField
      bind:value={fileName}
      suggested={view.suggestedFileName}
      willSaveAs={fresh && check?.truncated ? check.fileName : null}
      disabled={busy}
    />
  </div>

  {#if hasWarnings}
    <div class="warnings">
      {#if check && fresh}
        <ConflictNotice {check} bind:choices onshowinlist={() => check?.duplicateJobId != null && onshowjob(check.duplicateJobId)} />
      {/if}
      <OwnershipNotice ownership={view.ownership} channelName={view.meta.channelName} channelKnown={!!view.meta.channelId} />
      {#if errCopy}
        <Notice variant="inline" tone="danger" title={errCopy.title} actions={errActions}>
          {#if errCopy.body}<p class="line">{errCopy.body}</p>{/if}
          {#if errCopy.detail}<p class="line detail">{errCopy.detail}</p>{/if}
        </Notice>
      {/if}
    </div>
  {/if}

  {#snippet footer()}
    <Button onclick={onclose}>{t('common.close')}</Button>
    <!-- primary에는 disabled가 없다(타입). 못 받는 동안은 aria-disabled이고 download()가 ready를 다시 본다.
         사유가 있으면(목록에 있음·본인 영상 아님) 그 문장을 aria-describedby로 잇는다(patterns.md §6.4) -->
    <Button
      variant="primary"
      kbd={shortcutText(platform.os, 'submit')}
      aria-disabled={ready ? undefined : 'true'}
      aria-describedby={blocked ? BLOCK_REASON_ID[blocked] : undefined}
      onclick={download}
    >
      {t('card.download')}
    </Button>
  {/snippet}
</Surface>

<OverwriteDialog
  open={confirmOverwrite}
  name={`${check?.fileName ?? fileName}${FILE_EXT}`}
  {busy}
  onconfirm={() => void enqueueNow()}
  onclose={() => (confirmOverwrite = false)}
/>

<style>
  .badges {
    display: flex;
    gap: var(--space-4);
  }
  .video-title {
    margin: var(--space-8) 0 0;
    font-size: var(--text-title);
    line-height: var(--leading-title);
    font-weight: var(--weight-strong);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-8);
    margin: var(--space-4) 0 0;
    color: var(--fg-muted);
  }
  .fields {
    margin-top: var(--space-16);
  }
  .warnings {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin-top: var(--space-12);
  }
  .line {
    margin: 0;
  }
  .detail {
    color: var(--fg-muted);
  }
</style>
