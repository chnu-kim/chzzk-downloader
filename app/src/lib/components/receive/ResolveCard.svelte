<script lang="ts">
  // 영상 카드(system/patterns.md §6.5·§14.2 (c)). 화질·폴더·파일 이름을 고르고 `enqueue`한다.
  // 파일 이름·화질·폴더가 바뀔 때마다 CHECK_DEBOUNCE_MS 뒤 `check_output`을 부르고, 지금 입력의 결과가 올 때까지
  // [받기]를 막는다(낡은 결과로 충돌 안내를 건너뛰지 않게). 같은 이름 파일을 "덮어쓰기"로 골랐으면 [받기]가 D7을 연다.
  // 빠른 다시보기는 "미리보기·구간" 섹션 맨 아래에 구간 칸 줄(RangeField)이 있고(preview-ux2 PS7), 섹션이 펼쳐져 있으면 검사 열쇠·요청·크기 미리보기가 effectiveRange 하나를 쓴다.
  // 섹션이 접히면 구간은 적용되지 않고(칸 값은 남는다) 칸이 비면 전체다(PS9·PS10).
  // 구간 막대의 길이(`len`)의 주인은 이 카드다: meta 길이가 우선이고 없으면 WatchPanel이 알려 준 영상 길이(PVU7).
  // 영역(region)의 이름은 영상 제목이다(h3). 머리 h2는 섹션 제목 급의 `card.title`.
  // 카드와 `.main` 사이 어떤 조상에도 overflow를 두지 않는다: 바닥 줄(.card-footer)이 sticky라서다.
  import { onMount, untrack } from 'svelte';
  import * as api from '../../api';
  import type { AppError, OutputCheck, ResolvedDto } from '../../bindings';
  import { actionLabel, errorCopy, type ActionId } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { sizeBaseOf } from '../../format/bytes';
  import { noticeHelp } from '../../help';
  import { shortcutText } from '../../platform';
  import {
    BLOCK_REASON_ID,
    CHECK_DEBOUNCE_MS,
    DEFAULT_CHOICES,
    fileExt,
    buildEnqueueRequest,
    canDownload,
    checkKey,
    downloadBlock,
    effectiveRange,
    lengthLine,
    kindTone,
    metaParts,
    notices,
    rangeError,
    rangeSecs,
    qualitySize,
    savedFileName,
    usesFreeName,
    type CardChoices,
    type RangeError,
  } from '../../receive';
  import { announcer } from '../../stores/announce.svelte';
  import { auth } from '../../stores/auth.svelte';
  import { mark as markFields, nudge as nudgeFields, seekTargetOf, timelineLength, type Fields } from '../../rangeEdit';
  import { platform } from '../../stores/platform.svelte';
  import { resolver } from '../../stores/resolve.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { modKey, ui } from '../../stores/ui.svelte';
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
  import RangeField from './RangeField.svelte';
  import WatchPanel from './WatchPanel.svelte';

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

  // 구간(range.md §5, preview-ux2 PS9·PS10): 칸은 카드마다 빈칸으로 시작한다(다음 영상에서 실수로 구간을 받지 않게). 빈칸은 전체다.
  // 섹션 열림(`ui.previewOpen`)은 기억하지만 칸 값은 기억하지 않는다. 접힌 칸을 처음 고칠 때(rangeEdit.begin) 시작 칸은 0:00:00, 끝 칸은 이 빈칸으로 되돌려 넣는다.
  const initialEnd = '';
  let rangeStart = $state('');
  let rangeEnd = $state(initialEnd);
  let rangeErr: RangeError | null = $state(null);
  /** WatchPanel이 알려 준 영상 길이(미리보기가 닫히면 null) */
  let videoSecs: number | null = $state(null);
  const barLen = $derived(timelineLength(view.meta.durationSecs, videoSecs));
  /** 미리보기 편집 영역에 seek()를 부탁할 때 쓴다(PVU-5의 칸 → 영상) */
  let watchPanel: ReturnType<typeof WatchPanel> | null = $state(null);

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
    return !!c && c.exists && ch.existing === 'overwrite' && !usesFreeName(c, ch);
  }

  const quality = $derived(view.qualities[qualityIndex]);
  /** 산출 파일 확장자: 오디오만 행은 `.m4a` */
  const ext = $derived(fileExt(quality));
  const tone = $derived(kindTone(view.meta.kind, view.playbackKind));
  /**
   * 미리보기를 그리는 카드인가: 받을 수 있는 영상의 통짜 mp4(progressive)와 빠른 다시보기(liveRewindHls). 생방송은 없다.
   * tone이 아니라 재생 방식으로 판정한다(클립은 재생 방식과 무관하게 tone이 clip이다)
   */
  const watchable = $derived(
    (view.playbackKind === 'progressive' || view.playbackKind === 'liveRewindHls') && view.ownership !== 'notOwn' && view.ownership !== 'unknown',
  );
  /** 구간은 섹션이 펼쳐진 빠른 다시보기에서만 적용된다(R3·PS9·PS15: 그 밖의 카드에는 칸 줄이 없다) */
  const sectionOpen = $derived(ui.previewOpen && tone === 'rewind' && watchable);
  const rangeInput = $derived({ open: sectionOpen, start: rangeStart, end: rangeEnd });
  const range = $derived(effectiveRange(rangeInput, view.meta.durationSecs));
  const key = $derived(checkKey(folder, fileName, quality?.id ?? '', range));
  /** 화질 행 "약 N GB"의 길이: 칸이 파싱될 때만 구간 기준(조용한 미리보기) */
  const sizeSecs = $derived(rangeSecs(range, view.meta.durationSecs));
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
    shownError
      ? errorCopy(shownError, {
          place: 'resolve',
          cookiesEnabled: settings.cookiesEnabled,
          // notOwnContent 제목은 막힌 카드 Notice와 같은 규칙으로 맡은 채널 수를 본다(content.md §15.2)
          delegatedCount: auth.status?.delegatedChannels.length ?? 0,
        })
      : null,
  );
  const errActions = $derived(
    (errCopy?.actions ?? []).map((a) => ({
      id: a,
      label: actionLabel(a),
      loading: a === 'recheck' ? resolver.rechecking : undefined,
      onclick: () => onErrorAction(a),
    })),
  );
  /** 오류 Notice의 [다시 불러오기]가 실패했을 때의 줄. 막힌 카드면 OwnershipNotice가 같은 줄을 그리므로 여기서는 그리지 않는다 */
  const recheckFailLine = $derived.by(() => {
    const f = resolver.recheckFailure;
    if (!f || !errCopy?.actions.includes('recheck') || view.ownership === 'notOwn' || view.ownership === 'unknown') return null;
    return f.code === 'network' ? t('receive.recheck.offline') : errorCopy(f, { place: 'other' }).title;
  });
  function setFields(f: Fields) {
    rangeStart = f.start;
    rangeEnd = f.end;
  }

  /** 찍기: 그 칸만 채운다. 앞 [받기]의 rangeErr는 건드리지 않는다 */
  function markRange(field: 'start' | 'end', secs: number) {
    setFields(markFields({ open: sectionOpen, start: rangeStart, end: rangeEnd }, field, secs, initialEnd));
  }

  /** 손잡이로 고친 칸. 손잡이는 늘 바로 선 값을 만드니 앞 [받기]의 구간 오류는 이제 맞지 않다(검토 반영 V14) */
  function handleFields(next: Fields) {
    setFields(next);
    rangeErr = null;
  }

  /** 칸에 포커스가 들어올 때의 글자(PVU10: 바뀌었는지 비교) */
  let focusText: string | null = null;
  const fieldText = (f: 'start' | 'end') => (f === 'start' ? rangeStart : rangeEnd);

  function focusField(f: 'start' | 'end') {
    focusText = fieldText(f);
  }

  /**
   * 칸 → 영상(PVU10): 값이 바뀌었고, 포커스가 편집 영역 컨테이너·손잡이로 가는 게 아니고(막대를 누른 쪽이 이긴다),
   * 읽히면 영상을 그 시각으로 보낸다. 미리보기가 닫혀 있거나 메타데이터 전이면 watchPanel.seek이 아무것도 하지 않는다
   */
  function blurField(f: 'start' | 'end', to: EventTarget | null) {
    flushSeek(f); // keyup 없이 포커스가 떠나도 길게 누른 마지막 탐색은 보낸다(PS2)
    const before = focusText;
    focusText = null;
    const text = fieldText(f);
    if (before == null || before === text) return;
    if (to instanceof Element && (to.hasAttribute('data-local-keys') || to.getAttribute('role') === 'slider')) return;
    if (!barLen) return;
    const secs = seekTargetOf(text, barLen.secs, f);
    if (secs != null) watchPanel?.seek(secs);
  }

  /** 칸 → 영상 탐색 목표(초). 끝 칸이 빈칸("끝까지")이면 맨 끝(floor(길이)). 못 정하면 null */
  function seekSecsOf(f: 'start' | 'end', text: string): number | null {
    if (!barLen) return null;
    return f === 'end' && text.trim() === '' ? Math.floor(barLen.secs) : seekTargetOf(text, barLen.secs, f);
  }

  /** 길게 누르는 동안 미룬 마지막 탐색이 있는 칸(PS2). keyup이나 blur에서 한 번 보낸다 */
  let pendingSeek: 'start' | 'end' | null = null;

  function flushSeek(f: 'start' | 'end') {
    if (pendingSeek !== f) return;
    pendingSeek = null;
    const secs = seekSecsOf(f, fieldText(f));
    if (secs != null) watchPanel?.seek(secs);
  }

  /**
   * 칸의 ↑/↓(PS1~PS3): ±1초. 수식 키 조합은 처리하지 않아 칸의 기본 편집 동작을 남긴다(IME 조합 중 거름은 RangeField).
   * 그 밖의 ↑/↓는 늘 기본 동작(캐럿 이동)을 막는다. 칸을 못 읽으면 값은 그대로다.
   * 칸을 고치고 앞 [받기]의 구간 오류를 지운다. 영상은 첫 keydown에만 따라가고 길게 누른 뒤에는 keyup·blur에서 한 번이다
   */
  function fieldKey(f: 'start' | 'end', e: KeyboardEvent) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (busy) return;
    const next = nudgeFields({ open: sectionOpen, start: rangeStart, end: rangeEnd }, f, e.key === 'ArrowUp' ? 1 : -1, barLen, initialEnd);
    if (!next) return;
    handleFields(next);
    // 포커스 때 글자를 새 값으로 바꿔 blur가 같은 시각으로 한 번 더 탐색하지 않게 한다(PS3)
    focusText = next[f];
    if (e.repeat) {
      pendingSeek = f;
      return;
    }
    pendingSeek = null;
    const secs = seekSecsOf(f, next[f]);
    if (secs != null) watchPanel?.seek(secs);
  }

  function fieldKeyUp(f: 'start' | 'end', e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') flushSeek(f);
  }

  /**
   * 길이 줄(PS10): 받을 구간이 전체이면 "전체 길이"(길이를 모르면 "전체 구간"), 구간이 읽히면 "구간 길이". 끝을 모르는 구간이거나 칸이 틀렸으면 줄이 없다.
   * 고른 화질의 예상 크기가 있으면 곁들인다
   */
  const lengthText = $derived(
    tone !== 'rewind'
      ? null
      : lengthLine({
          error: rangeError(rangeInput, view.meta.durationSecs),
          range,
          durationSecs: view.meta.durationSecs,
          size: (secs) => (quality ? qualitySize(quality, secs, sizeBaseOf(platform.os)) : null),
        }),
  );

  // 섹션을 접으면 앞 [받기]의 구간 오류는 지운다(접힌 동안은 적용되지 않으므로)
  $effect(() => {
    if (!ui.previewOpen) rangeErr = null;
  });

  /** 소유권으로 막힌 카드: 생방송 안내("받기를 누르면 녹화가 시작돼요")가 막힘 안내와 반대 말을 하지 않게 그리지 않는다 */
  const ownershipBlocked = $derived(view.ownership === 'notOwn' || view.ownership === 'unknown');

  /** 카드 안 경고가 하나라도 있는가(없으면 간격도 두지 않는다) */
  const hasWarnings = $derived.by(() => {
    const n = fresh && check ? notices(check, choices) : null;
    const conflict = !!n && (n.duplicate || n.exists || n.partialSame != null || n.partialOther || n.partialRecording);
    return conflict || view.ownership === 'notOwn' || view.ownership === 'unknown' || view.ownership === 'adminOverride' || !!shownError;
  });
  // 가장 최근에 요청한 열쇠. 늦게 온 결과는 이것과 다르면 버린다.
  let latestKey = '';

  $effect(() => {
    const k = key;
    const name = fileName;
    const f = folder;
    const q = quality;
    const r = range;
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
          ...(r ? { range: r } : {}),
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
    if (!quality) return;
    // 구간 검증은 [받기] 때만(patterns.md §6.1). 틀리면 그 칸 아래 오류를 보이고 받지 않는다
    rangeErr = rangeError(rangeInput, view.meta.durationSecs);
    if (rangeErr) return;
    if (!ready || !check) return;
    if (overwriting) confirmOverwrite = true;
    else void enqueueNow();
  }

  async function enqueueNow() {
    if (!ready || !check || !quality) return;
    busy = true;
    enqueueError = null;
    try {
      await api.enqueue(buildEnqueueRequest(view, quality, folder, check, choices, range));
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
    else if (a === 'recheck') void resolver.recheck();
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

<!-- 구간 칸 줄: 섹션 맨 아래(영상 자리 → 막대 → 칸 줄). 접고 펴도 같은 요소다(<details>는 접혀도 자식을 둔다). 칸 상태의 주인은 이 카드다 -->
{#snippet rangeLine()}
  <RangeField
    open={sectionOpen}
    bind:start={rangeStart}
    bind:end={rangeEnd}
    error={rangeErr}
    disabled={busy}
    onfocusfield={focusField}
    onblurfield={blurField}
    onfieldkey={fieldKey}
    onfieldkeyup={fieldKeyUp}
    {lengthText}
  />
{/snippet}

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

  {#if watchable}
    <WatchPanel
      bind:this={watchPanel}
      {view}
      markable={tone === 'rewind'}
      disabled={busy}
      onmark={markRange}
      fields={{ open: sectionOpen, start: rangeStart, end: rangeEnd }}
      len={barLen}
      {initialEnd}
      onfields={(next) => handleFields(next)}
      onduration={(secs) => (videoSecs = secs)}
      below={tone === 'rewind' ? rangeLine : undefined}
    />
  {/if}

  <div class="fields">
    <QualityPicker qualities={view.qualities} durationSecs={sizeSecs} bind:selected={qualityIndex} />
    <FolderField path={folderPath} onchange={changeFolder} disabled={busy} />
    <FilenameField
      bind:value={fileName}
      suggested={view.suggestedFileName}
      willSaveAs={fresh && check?.truncated ? check.fileName : null}
      disabled={busy}
      {ext}
    />
  </div>

  {#if tone === 'live' && !ownershipBlocked}
    <!-- 생방송은 길이를 모르고 받기를 누르면 방송이 끝나거나 [녹화 마치기]를 누를 때까지 받는다(ADR-0025) -->
    <Notice variant="inline" tone="info">{t('card.live.body')}</Notice>
  {/if}

  {#if hasWarnings}
    <div class="warnings">
      {#if check && fresh}
        <ConflictNotice {check} bind:choices onshowinlist={() => check?.duplicateJobId != null && onshowjob(check.duplicateJobId)} />
      {/if}
      <OwnershipNotice
        ownership={view.ownership}
        channelName={view.meta.channelName}
        channelId={view.meta.channelId}
        live={view.meta.kind === 'live'}
        channelKnown={!!view.meta.channelId}
      />
      {#if errCopy}
        <Notice variant="inline" tone="danger" title={errCopy.title} actions={errActions} help={noticeHelp(errCopy.helpId)}>
          {#if errCopy.body}<p class="line">{errCopy.body}</p>{/if}
          {#if errCopy.detail}<p class="line detail">{errCopy.detail}</p>{/if}
          {#if recheckFailLine}<p class="line">{recheckFailLine}</p>{/if}
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
  name={savedFileName(check?.fileName ?? fileName, ext)}
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
