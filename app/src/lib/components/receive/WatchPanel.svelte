<script lang="ts">
  // 받기 전 미리보기 섹션(preview.md PV14, preview-ux2 PS5~PS12, system/components.md WatchPanel). 카드 안 `Disclosure inline` 하나이고 기본 펼침이다.
  // 열림은 앱 메모리 `ui.previewOpen`이 기억한다(PS8). 펼쳐도 표지 자리(.stage)와 [영상 보기]만 보이고 요청은 없다. 그 단추를 눌렀을 때 `watch_open`을 부르고(preload=metadata, 네이티브 controls,
  // 준비되면 `play()`를 한 번 시도), 접거나 카드가 사라지면 `watch_close`를 부른다.
  // `src`는 Rust가 만든 `watch:` 주소뿐이고 서명 주소·토큰은 프런트에 오지 않는다. 상태는 closed·idle·opening·ready·failed 다섯.
  // 빠른 다시보기(HLS)는 hls.js light를 동적으로 불러(PV9) MSE로 붙인다. 못 쓰면 네이티브 m3u8, 그것도 없으면 실패(PV16).
  // 구간 찍기(PV17): `markable`(빠른 다시보기 카드)이고 hls.js로 붙었을 때만 재생기 아래 [시작 찍기]·[끝 찍기]를 보인다.
  // 네이티브 m3u8 대체 경로는 시간축이 다를 수 있어 그리지 않는다. 누른 순간의 floor(currentTime)초를 `onmark`로 넘길 뿐이다.
  // 빠른 다시보기(`markable`)는 섹션 이름이 "미리보기·구간"이고, 영상 자리 아래에 구간 막대(RangeTimeline)를 재생 전에도 meta 길이로 그린다(PS11).
  // 영상과 구간의 결합(`coupled` = hls.js로 붙고 메타데이터를 읽음, PS12)이 되면 조작 줄(찍기·구간 보기·시작부터 보기·구간 반복하기)과 재생 위치가 더해진다.
  // 막대와 조작 줄은 한 편집 영역(role=group)으로 묶는다. 구간 칸 줄은 카드가 `below` 스니펫으로 섹션 맨 아래에 그린다(칸의 주인은 카드, PS7). 칸 문자열의 원천은 카드이고(`fields`), 손잡이는 `rangeEdit.moveHandle`이 만든 새 칸을 `onfields`로
  // 돌려줄 뿐이다. 영상 탐색은 `seek()` 하나를 거치고 그 앞에서 구간 보기를 끈다(§6.3: restart·pause가 손잡이 조작에 끼어들지 않게).
  import { onDestroy, type Snippet } from 'svelte';
  import * as api from '../../api';
  import type { ResolvedDto } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { ui } from '../../stores/ui.svelte';
  import {
    consumeOwnSeek,
    moveHandle,
    playStep,
    reachesEnd,
    seekKey,
    selection,
    type BarLength,
    type Fields,
    type Handle,
    type PlayMode,
  } from '../../rangeEdit';
  import Button from '../ui/Button.svelte';
  import Disclosure from '../ui/Disclosure.svelte';
  import { editable, isImeKey } from '../ui/focus';
  import Notice from '../ui/Notice.svelte';
  import Switch from '../ui/Switch.svelte';
  import RangeTimeline from './RangeTimeline.svelte';
  import { WatchSession } from './watchSession.svelte';

  interface Props {
    view: ResolvedDto;
    /** 빠른 다시보기 카드: hls.js 경로에서 찍기 버튼을 보인다 */
    markable?: boolean;
    /** 카드가 받기 요청 중이면 찍기를 막는다 */
    disabled?: boolean;
    /** 찍은 시각(초, 내림)을 카드의 구간 칸으로 보낸다 */
    onmark?: (field: 'start' | 'end', secs: number) => void;
    /** 카드의 구간 칸 상태(막대가 그리는 값의 원천) */
    fields?: Fields;
    /** 막대 길이(카드가 meta와 영상 길이로 만든다). 없으면 막대와 구간 보기를 그리지 않는다 */
    len?: BarLength | null;
    /** 접힌 구간 줄을 처음 고칠 때 끝 칸에 되돌려 넣는 전체 값 */
    initialEnd?: string;
    /** 손잡이로 고친 새 칸. 'handle'이면 카드가 앞 [받기]의 구간 오류도 지운다 */
    onfields?: (next: Fields, cause: 'handle') => void;
    /** 영상이 알려 준 길이(유한할 때, 접기·실패면 null) */
    onduration?: (secs: number | null) => void;
    /** 섹션 맨 아래에 그릴 것(빠른 다시보기의 구간 칸 줄, PS7) */
    below?: Snippet;
  }

  let {
    view,
    markable = false,
    disabled = false,
    onmark,
    fields = { open: false, start: '', end: '' },
    len = null,
    initialEnd = '',
    onfields,
    onduration,
    below,
  }: Props = $props();

  /** 이 섹션의 뿌리와 [영상 보기] 단추(포커스 판단용) */
  let rootEl: HTMLDivElement | null = $state(null);
  let startEl: HTMLButtonElement | null = $state(null);
  let videoEl: HTMLVideoElement | null = $state(null);
  /** video의 메타데이터를 읽었는가(그 전의 currentTime은 믿지 않는다) */
  let metaReady = $state(false);
  /** 재생 위치(초). timeupdate·seeked에서 읽는다 */
  let position = $state(0);
  /** 구간 보기 모드(§6.3). 접기·실패·다시 열기·seek()에서 'off' */
  let playMode: PlayMode = $state('off');
  /** 구간 반복하기 스위치(카드마다 새로 시작, 기억하지 않는다) */
  let loop = $state(false);
  /** 우리가 currentTime을 쓴 목표(다음 seeked가 byUs인지 가린다)와 우리가 부른 pause 깃발. 둘 다 한 번 쓰고 버린다 */
  let pendingSeek: number | null = null;
  let pausedByUs = false;
  /** 마지막으로 알린 영상 길이(같은 값을 거듭 알리지 않는다) */
  let reportedSecs: number | null | undefined;

  const uid = $props.id();
  const loopId = `${uid}-loop`;
  /** 영상과 구간의 결합(PS12): hls.js로 붙었고 메타데이터를 읽었을 때만. 찍기·조작 줄·재생 위치·영상 탐색이 모두 이 조건이다(PV17: 네이티브 m3u8은 제외) */
  function resetPlay() {
    playMode = 'off';
    pendingSeek = null;
    pausedByUs = false;
    position = 0;
  }

  function reportDuration(secs: number | null) {
    if (secs === reportedSecs) return;
    reportedSecs = secs;
    onduration?.(secs);
  }

  /** loadedmetadata: 이제부터 currentTime을 믿는다 */
  function onmeta() {
    metaReady = true;
    ondur();
  }

  /** durationchange: 길이만 알린다(MSE는 loadedmetadata 전에도 쏠 수 있어 metaReady는 세우지 않는다). 유한한 양수만 */
  function ondur() {
    const d = videoEl?.duration;
    reportDuration(d != null && Number.isFinite(d) && d > 0 ? d : null);
    if (videoEl && metaReady) position = videoEl.currentTime || 0;
  }

  /** 포커스가 [영상 보기] 단추나 body에 있는가(그 사이 다른 곳으로 옮겨 간 사용자를 끌어내지 않는다, PS6) */
  function focusIsFree(): boolean {
    const a = document.activeElement;
    return !a || a === document.body || a === startEl;
  }

  /** 줄 머리(summary)로 포커스를 옮긴다(포커스 있던 요소가 사라져 body로 떨어지지 않게) */
  function focusSummary() {
    rootEl?.querySelector<HTMLElement>('summary')?.focus();
  }

  // 세션 수명은 watchSession이 맡는다. 여기서는 포커스 판단과 재생 상태 되돌리기만 콜백으로 준다
  const session = new WatchSession({
    // 마운트 때 이미 펼쳐져 있으면 표지 자리부터다(Disclosure의 onchange는 사용자가 바꿀 때만 불린다)
    initialOpen: ui.previewOpen,
    target: () => ({ url: view.url, content: view.content }),
    video: () => videoEl,
    // 열기 성공: 포커스가 비어 있었으면 video로 옮기고 재생을 한 번 시도한다(거절은 조용히, controls가 남는다)
    onready: () => {
      if (focusIsFree()) videoEl?.focus();
      startPlay();
    },
    // 열기 실패: 포커스가 비어 있었으면 줄 머리로. 재생 중 오류: 포커스가 영상에 있었을 때만 줄 머리로(다른 곳은 그대로)
    onfailed: (videoFocused, cause) => {
      if (cause === 'video' ? videoFocused : focusIsFree()) focusSummary();
    },
    onclosed: () => {
      metaReady = false;
      resetPlay();
      reportDuration(null);
    },
  });

  const coupled = $derived(session.usingHls && metaReady);
  const gateCopy = $derived(session.gateError ? errorCopy(session.gateError, { place: 'resolve' }) : null);

  function onchange(next: boolean) {
    if (next) session.expand();
    else session.collapse();
  }

  function mark(field: 'start' | 'end') {
    if (!videoEl || !metaReady || disabled) return;
    onmark?.(field, Math.floor(videoEl.currentTime));
  }

  /** 막대에 그릴 값(접힘이면 전체). 길이를 모르면 null */
  const sel = $derived(len ? selection(fields, len.secs) : null);
  /** 구간 막대를 그리는가: 빠른 다시보기이고 길이를 알 때(재생 전에도, PS11) */
  const barShown = $derived(markable && !!len && !!sel);
  /** 편집 영역(role=group)의 이름·키 처리: 막대가 있거나 결합됐을 때(PS14) */
  const region = $derived(markable && (barShown || coupled));

  /**
   * 영상을 secs초로 옮긴다(손잡이·키·막대·칸). 먼저 구간 보기를 끈다(§6.3): 그래서 이 탐색은 playStep에 닿지 않는다.
   * 목표는 [0, video.duration]으로 한 번 더 자른다(meta 길이가 실제 영상보다 길 수 있다, 검토 반영 V11)
   */
  export function seek(secs: number) {
    playMode = 'off';
    const v = videoEl;
    if (!v || !coupled || Number.isNaN(secs)) return;
    const d = v.duration;
    const hi = Number.isFinite(d) && d > 0 ? d : Number.POSITIVE_INFINITY;
    const target = Math.min(Math.max(secs, 0), hi);
    v.currentTime = target;
    position = target;
  }

  /** 손잡이 이동. 끌기 중에는 칸만 바꾸고, 놓을 때·키에서는 영상도 그 손잡이 시각으로 간다 */
  function moveTo(h: Handle, secs: number, phase: 'drag' | 'commit') {
    if (!len || disabled) return;
    // 구간을 고치는 동안에는 끌기 중에도 restart·pause가 끼어들지 않는다(§6.3·V6)
    playMode = 'off';
    const next = moveHandle(fields, h, secs, len, initialEnd);
    if (!next) return;
    onfields?.(next, 'handle');
    if (phase === 'commit') seek(selection(next, len.secs)[h]);
  }

  /** 시작 칸 값(초) 쪽 선택. 길이를 모르면 구간 보기는 없다 */
  function stepSel() {
    if (!sel || !len) return null;
    return { start: sel.start, end: sel.end, toEnd: reachesEnd(sel, fields.open ? fields.end : '', len.secs) };
  }

  /** 우리가 currentTime을 쓴다: 다음 seeked를 byUs로 알아볼 수 있게 목표를 남긴다 */
  function ownSeek(secs: number) {
    if (!videoEl) return;
    pendingSeek = secs;
    videoEl.currentTime = secs;
  }

  function startPlay() {
    const v = videoEl;
    if (!v) return;
    try {
      void Promise.resolve(v.play()).catch(() => {
        // 웹뷰가 재생을 거부했다: 구간 보기는 켜지지 않은 것으로 되돌린다
        playMode = 'off';
      });
    } catch {
      playMode = 'off';
    }
  }

  function playRange() {
    const g = stepSel();
    if (!g || !sel?.band) return;
    playMode = loop ? 'loop' : 'range';
    ownSeek(g.start);
    startPlay();
  }

  function playFromStart() {
    if (!sel) return;
    playMode = 'off';
    ownSeek(sel.start);
    startPlay();
  }

  function onloop(next: boolean) {
    // 구간 보기 중에 스위치를 바꾸면 그 자리에서 range ↔ loop
    if (playMode !== 'off') playMode = next ? 'loop' : 'range';
  }

  function apply(r: { mode: PlayMode; action: 'none' | 'pause' | 'restart' }, start: number) {
    playMode = r.mode;
    if (r.action === 'pause') {
      pausedByUs = true;
      videoEl?.pause();
    } else if (r.action === 'restart') {
      ownSeek(start);
    }
  }

  function ontimeupdate() {
    if (!videoEl) return;
    position = videoEl.currentTime;
    const g = stepSel();
    if (!g) return;
    apply(playStep(playMode, { kind: 'time', t: position, byUs: false }, g), g.start);
  }

  function onseeked() {
    if (!videoEl) return;
    position = videoEl.currentTime;
    const c = consumeOwnSeek(pendingSeek, position);
    pendingSeek = null;
    const g = stepSel();
    if (!g) return void (playMode = 'off');
    apply(playStep(playMode, { kind: 'seeked', t: position, byUs: c.byUs }, g), g.start);
  }

  function onpause() {
    const byUs = pausedByUs;
    pausedByUs = false;
    // 끝에 닿아 브라우저가 건 일시정지는 사용자 일시정지가 아니다: 곧 오는 ended가 이어받는다
    if (videoEl?.ended) return;
    const g = stepSel();
    if (!g) return void (playMode = 'off');
    apply(playStep(playMode, { kind: 'pause', t: position, byUs }, g), g.start);
  }

  function onended() {
    const g = stepSel();
    if (!g) return void (playMode = 'off');
    const r = playStep(playMode, { kind: 'ended', t: position, byUs: false }, g);
    apply(r, g.start);
    // 끝에서 멈춘 영상은 처음으로 돌아간 뒤 다시 재생해야 이어진다
    if (r.action === 'restart') startPlay();
  }

  /**
   * 편집 영역 키(preview-ux §5.4). 손잡이가 이미 처리한 키(defaultPrevented)와 입력칸·IME 조합은 거른다.
   * I/O는 찍기 단추·영상·손잡이·컨테이너에서만(구간 보기·시작부터 보기·스위치 위에서는 글자 그대로),
   * Space는 손잡이·컨테이너에서 재생 ↔ 일시정지(단추·스위치는 자기가 누른다), ←/→는 단추·스위치·컨테이너에서 재생 위치 ∓5초.
   * 영상 위의 나머지 키는 네이티브 몫이고, Alt·Ctrl·Meta 조합은 창·OS 몫이다. Esc는 아무것도 하지 않는다(창 처리기가 카드를 닫지 않는다)
   */
  function onEditorKey(e: KeyboardEvent) {
    if (isImeKey(e) || e.defaultPrevented || editable(e.target)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const v = videoEl;
    if (!v || !coupled || !(e.target instanceof Element)) return;
    const el = e.target;
    const command = el.closest('button, [role="switch"]');
    const slider = el.closest('[role="slider"]');
    if (e.code === 'KeyI' || e.code === 'KeyO') {
      if (e.shiftKey) return;
      // 찍기 단추만 이 키를 받는다(aria-keyshortcuts가 달린 단추)
      if (command && !command.hasAttribute('aria-keyshortcuts')) return;
      if (disabled) return;
      e.preventDefault();
      mark(e.code === 'KeyI' ? 'start' : 'end');
      return;
    }
    if (el === v || command) {
      // 영상 위는 네이티브 몫. 단추·스위치에서는 화살표만 우리 몫이다
      if (el === v || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    }
    if (e.key === ' ' && !e.shiftKey) {
      e.preventDefault();
      if (v.paused) startPlay();
      else v.pause();
      return;
    }
    const step = slider ? null : seekKey(e.key, { shift: e.shiftKey, alt: false, ctrl: false, meta: false });
    if (step != null) {
      e.preventDefault();
      seek(v.currentTime + step);
    }
  }

  function openInChzzk() {
    void api.openContentPage(view.content).catch(() => {});
  }

  onDestroy(() => session.destroy());
</script>

<div class="watch" bind:this={rootEl}>
  <Disclosure variant="inline" title={markable ? t('watch.toggle.range') : t('watch.toggle')} bind:open={ui.previewOpen} {onchange}>
    {#if session.phase === 'idle' || session.phase === 'opening'}
      <!-- 표지 자리: 이미지 없는 장식 상자(PS5). 재생기와 같은 16:9라 눌러도 배치가 밀리지 않는다 -->
      <div class="stage">
        <Button icon="play" loading={session.phase === 'opening'} bind:el={startEl} aria-label={t('watch.start.a11y', { title: view.meta.title })} onclick={() => void session.start()}>
          {t('watch.start.label')}
        </Button>
      </div>
    {:else if session.phase === 'failed'}
      {#if gateCopy}
        <Notice variant="inline" tone="danger" title={gateCopy.title}>
          {#if gateCopy.body}<p class="line">{gateCopy.body}</p>{/if}
        </Notice>
      {:else}
        <Notice
          variant="inline"
          tone="danger"
          actions={[
            { id: 'retry', label: t('action.retry'), onclick: () => void session.start() },
            { id: 'open', label: t('watch.openInChzzk.label'), onclick: openInChzzk },
          ]}
        >
          {t('watch.error.body')}
        </Notice>
      {/if}
    {/if}
    <!-- 편집 영역: 영상 + 막대 + 조작 줄. 영상은 hls.js가 붙기 전후에 같은 요소여야 해서(coupled가 늦게 켜진다) 감싸는 요소를
         늘 두고 편집 영역의 이름·역할만 조건으로 붙인다. 표지 자리·실패 Notice는 이 영역 밖이라 그 위의 Esc는 카드를 닫는다.
         포커스 링은 전역 규칙을 그대로 받는다(data-focus-container 없음, V8) -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="editor"
      role={region ? 'group' : undefined}
      aria-label={region ? t('watch.editor.a11y', { title: view.meta.title }) : undefined}
      tabindex={region ? -1 : undefined}
      data-local-keys={region ? '' : undefined}
      onkeydown={region ? onEditorKey : undefined}
    >
      {#if session.phase === 'ready'}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          class="player"
          controls
          tabindex="0"
          preload="metadata"
          playsinline
          bind:this={videoEl}
          src={session.src || undefined}
          aria-label={t('watch.player.a11y', { title: view.meta.title })}
          onerror={() => session.videoFailed()}
          onloadedmetadata={onmeta}
          ondurationchange={ondur}
          ontimeupdate={ontimeupdate}
          onseeked={onseeked}
          onpause={onpause}
          onended={onended}
        ></video>
      {/if}
      {#if barShown && len && sel}
        <div class="timeline">
          <RangeTimeline
            length={len.secs}
            start={sel.start}
            end={sel.end}
            band={sel.band}
            position={coupled ? position : null}
            {disabled}
            onmove={moveTo}
            onseek={seek}
          />
        </div>
      {/if}
      {#if markable && coupled}
        <div class="controls">
          <Button size="sm" aria-keyshortcuts="I" {disabled} onclick={() => mark('start')}>{t('watch.mark.start')}</Button>
          <Button size="sm" aria-keyshortcuts="O" {disabled} onclick={() => mark('end')}>{t('watch.mark.end')}</Button>
          <Button size="sm" disabled={disabled || !len || !sel?.band} onclick={playRange}>
            {t('watch.range.play.label')}
          </Button>
          <Button size="sm" disabled={disabled || !len} onclick={playFromStart}>
            {t('watch.range.fromStart.label')}
          </Button>
          <span class="loop">
            <span id={loopId}>{t('watch.range.loop.label')}</span>
            <Switch bind:value={loop} labelledby={loopId} onchange={onloop} />
          </span>
        </div>
      {/if}
    </div>
    {#if below}{@render below()}{/if}
  </Disclosure>
</div>

<style>
  .watch {
    margin-top: var(--space-12);
  }
  .stage,
  .player {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-height: var(--watch-max-h);
    border-radius: var(--radius-control);
    background: var(--surface-2);
  }
  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .player {
    object-fit: contain;
  }
  /* 편집 영역 컨테이너(tabindex -1)는 키를 받는 조작 대상이라 포커스 링을 숨기지 않는다 */
  .timeline {
    margin-top: var(--space-8);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    margin-top: var(--space-8);
  }
  .loop {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
  }
  .line {
    margin: 0;
  }
  @media (forced-colors: active) {
    .stage,
    .player {
      border: 1px solid CanvasText;
    }
  }
</style>
