<script lang="ts">
  // 받기 전 미리보기 줄(preview.md PV14, system/components.md WatchPanel). 카드 안 `Disclosure inline`이고 기본 접힘이다.
  // 펼칠 때 `watch_open`을 부르고(자동재생 없음, preload=metadata, 네이티브 controls), 접거나 카드가 사라지면 `watch_close`를 부른다.
  // `src`는 Rust가 만든 `watch:` 주소뿐이고 서명 주소·토큰은 프런트에 오지 않는다. 상태는 closed·opening·ready·failed 넷.
  // 빠른 다시보기(HLS)는 hls.js light를 동적으로 불러(PV9) MSE로 붙인다. 못 쓰면 네이티브 m3u8, 그것도 없으면 실패(PV16).
  // 구간 찍기(PV17): `markable`(빠른 다시보기 카드)이고 hls.js로 붙었을 때만 재생기 아래 [시작 찍기]·[끝 찍기]를 보인다.
  // 네이티브 m3u8 대체 경로는 시간축이 다를 수 있어 그리지 않는다. 누른 순간의 floor(currentTime)초를 `onmark`로 넘길 뿐이다.
  // 구간 편집(preview-ux PVU-3): 같은 조건에서 영상 아래에 구간 막대(RangeTimeline)와 조작 줄(찍기·구간 보기·시작부터 보기·구간 반복하기)을
  // 한 편집 영역(role=group)으로 묶는다. 칸 문자열의 원천은 카드이고(`fields`), 손잡이는 `rangeEdit.moveHandle`이 만든 새 칸을 `onfields`로
  // 돌려줄 뿐이다. 영상 탐색은 `seek()` 하나를 거치고 그 앞에서 구간 보기를 끈다(§6.3: restart·pause가 손잡이 조작에 끼어들지 않게).
  import { onDestroy, tick } from 'svelte';
  import type Hls from 'hls.js/light';
  import * as api from '../../api';
  import type { AppError, ResolvedDto, WatchOpenDto } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
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
  }: Props = $props();

  type Phase = 'closed' | 'opening' | 'ready' | 'failed';
  /** 받기와 같은 문구로 알리는 게이트 거부(그 밖의 실패는 한 문구, preview.md Q2) */
  const GATE_CODES: ReadonlySet<AppError['code']> = new Set(['notLoggedIn', 'notOwnContent', 'ownershipUnknown']);

  let open = $state(false);
  let phase: Phase = $state('closed');
  let src = $state('');
  /** 게이트 거부로 실패했을 때의 오류(없으면 한 문구) */
  let gateError: AppError | null = $state(null);
  /** 지금 열려 있는 세션 ID. 닫을 때 한 번만 쓰고 비운다 */
  let sessionId: string | null = null;
  /** 열기 요청마다 올린다: 접거나 다시 열면 늦게 온 결과를 버린다 */
  let attempt = 0;
  /** hls.js가 붙은 video(HLS 종류만). 접거나 실패하면 destroy하고 비운다 */
  let hls: Hls | null = null;
  let videoEl: HTMLVideoElement | null = $state(null);
  /** hls.js로 붙었는가(찍기 버튼의 조건). 접거나 실패하면 내린다 */
  let usingHls = $state(false);
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
  /** 구간 편집 영역을 그리는가: 빠른 다시보기 카드이고 hls.js로 붙었을 때만(PV17·PVU2) */
  const editing = $derived(markable && usingHls);
  const gateCopy = $derived(gateError ? errorCopy(gateError, { place: 'resolve' }) : null);

  /** 이 웹뷰가 mp4를 읽을 수 있는가(없으면 src를 달지 않고 곧바로 실패) */
  function canPlayMp4(): boolean {
    return document.createElement('video').canPlayType('video/mp4') !== '';
  }

  /** 이 웹뷰가 m3u8을 네이티브로 읽을 수 있는가(Safari 계열) */
  function canPlayNativeHls(): boolean {
    return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
  }

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

  function closeSession() {
    // 재생기를 먼저 떼야 세션을 닫은 뒤 세그먼트를 더 요청하지 않는다
    hls?.destroy();
    hls = null;
    usingHls = false;
    metaReady = false;
    resetPlay();
    reportDuration(null);
    const id = sessionId;
    sessionId = null;
    if (id) void api.watchClose(id).catch(() => {});
  }

  async function openSession() {
    const mine = ++attempt;
    closeSession();
    gateError = null;
    src = '';
    metaReady = false;
    phase = 'opening';
    try {
      const dto = await api.watchOpen(view.url, view.content);
      if (mine !== attempt) {
        // 그 사이 접었거나 다시 열었다: 늦게 온 세션은 바로 닫는다
        void api.watchClose(dto.id).catch(() => {});
        return;
      }
      if (dto.kind === 'hls') {
        await openHls(dto, mine);
        return;
      }
      if (dto.kind !== 'mp4' || !canPlayMp4()) {
        // 낯선 종류나 mp4를 읽을 수 없는 웹뷰면 src를 달지 않고 세션을 닫는다
        void api.watchClose(dto.id).catch(() => {});
        phase = 'failed';
        return;
      }
      sessionId = dto.id;
      src = dto.src;
      phase = 'ready';
    } catch (e) {
      if (mine !== attempt) return;
      const err = e as AppError;
      gateError = GATE_CODES.has(err.code) ? err : null;
      phase = 'failed';
    }
  }

  /** HLS 종류: hls.js(MSE) → 네이티브 m3u8 → 실패 순. 중간에 접거나 다시 열면(`attempt`가 바뀜) 그 자리에서 손을 뗀다 */
  async function openHls(dto: WatchOpenDto, mine: number) {
    const fail = () => {
      void api.watchClose(dto.id).catch(() => {});
      phase = 'failed';
    };
    let Ctor: typeof Hls;
    try {
      Ctor = (await import('hls.js/light')).default;
    } catch {
      if (mine === attempt) fail();
      else void api.watchClose(dto.id).catch(() => {});
      return;
    }
    if (mine !== attempt) {
      void api.watchClose(dto.id).catch(() => {});
      return;
    }
    if (!Ctor.isSupported()) {
      if (!canPlayNativeHls()) return fail();
      sessionId = dto.id;
      src = dto.src;
      phase = 'ready';
      return;
    }
    sessionId = dto.id;
    phase = 'ready';
    // video가 그려진 뒤에 붙인다
    await tick();
    if (mine !== attempt || !videoEl) return;
    // 워커 없음(CSP worker-src를 더하지 않는다), 저지연 끔, 자격 증명 없음(PV9)
    const player = new Ctor({ enableWorker: false, lowLatencyMode: false });
    hls = player;
    usingHls = true;
    // 오류는 fatal만 본다: 오류 객체의 url 필드에는 전체 세션 ID가 든 주소가 있어 화면·로그·IPC 어디에도 쓰지 않는다
    player.on(Ctor.Events.ERROR, (_event, data) => {
      if (data.fatal) onvideoerror();
    });
    player.loadSource(dto.src);
    player.attachMedia(videoEl);
  }

  function onchange(next: boolean) {
    if (next) {
      void openSession();
    } else {
      attempt += 1;
      closeSession();
      src = '';
      gateError = null;
      phase = 'closed';
    }
  }

  function onvideoerror() {
    // 서명 만료·세션 만료 등. 원인 구분 없이 한 Notice(Q2). 낡은 세션은 닫는다
    attempt += 1;
    closeSession();
    src = '';
    phase = 'failed';
  }

  function mark(field: 'start' | 'end') {
    if (!videoEl || !metaReady || disabled) return;
    onmark?.(field, Math.floor(videoEl.currentTime));
  }

  /** 막대에 그릴 값(접힘이면 전체). 길이를 모르면 null */
  const sel = $derived(len ? selection(fields, len.secs) : null);

  /**
   * 영상을 secs초로 옮긴다(손잡이·키·막대·칸). 먼저 구간 보기를 끈다(§6.3): 그래서 이 탐색은 playStep에 닿지 않는다.
   * 목표는 [0, video.duration]으로 한 번 더 자른다(meta 길이가 실제 영상보다 길 수 있다, 검토 반영 V11)
   */
  export function seek(secs: number) {
    playMode = 'off';
    const v = videoEl;
    if (!v || !metaReady || Number.isNaN(secs)) return;
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
    if (!v || !metaReady || !(e.target instanceof Element)) return;
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

  onDestroy(() => {
    attempt += 1;
    closeSession();
  });
</script>

<div class="watch">
  <Disclosure variant="inline" title={t('watch.toggle')} bind:open {onchange}>
    {#if phase === 'opening'}
      <div class="stage" aria-hidden="true"></div>
    {:else if phase === 'ready'}
      <!-- 편집 영역: 영상 + 막대 + 조작 줄. 영상은 hls.js가 붙기 전후에 같은 요소여야 해서(usingHls가 늦게 켜진다) 감싸는 요소를
           늘 두고 편집 영역의 이름·역할만 조건으로 붙인다. 포커스 링은 전역 규칙을 그대로 받는다(data-focus-container 없음, V8) -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="editor"
        role={editing ? 'group' : undefined}
        aria-label={editing ? t('watch.editor.a11y', { title: view.meta.title }) : undefined}
        tabindex={editing ? -1 : undefined}
        data-local-keys={editing ? '' : undefined}
        onkeydown={editing ? onEditorKey : undefined}
      >
        <!-- svelte-ignore a11y_media_has_caption -->
        <video
          class="player"
          controls
          preload="metadata"
          playsinline
          bind:this={videoEl}
          src={src || undefined}
          aria-label={t('watch.player.a11y', { title: view.meta.title })}
          onerror={onvideoerror}
          onloadedmetadata={onmeta}
          ondurationchange={ondur}
          ontimeupdate={ontimeupdate}
          onseeked={onseeked}
          onpause={onpause}
          onended={onended}
        ></video>
        {#if editing}
          {#if metaReady && len && sel}
            <div class="timeline">
              <RangeTimeline
                length={len.secs}
                start={sel.start}
                end={sel.end}
                band={sel.band}
                {position}
                {disabled}
                onmove={moveTo}
                onseek={seek}
              />
            </div>
          {/if}
          <div class="controls">
            <Button size="sm" aria-keyshortcuts="I" disabled={disabled || !metaReady} onclick={() => mark('start')}>{t('watch.mark.start')}</Button>
            <Button size="sm" aria-keyshortcuts="O" disabled={disabled || !metaReady} onclick={() => mark('end')}>{t('watch.mark.end')}</Button>
            <Button size="sm" disabled={disabled || !metaReady || !len || !sel?.band} onclick={playRange}>
              {t('watch.range.play.label')}
            </Button>
            <Button size="sm" disabled={disabled || !metaReady || !len} onclick={playFromStart}>
              {t('watch.range.fromStart.label')}
            </Button>
            <span class="loop">
              <span id={loopId}>{t('watch.range.loop.label')}</span>
              <Switch bind:value={loop} labelledby={loopId} onchange={onloop} />
            </span>
          </div>
        {/if}
      </div>
    {:else if phase === 'failed'}
      {#if gateCopy}
        <Notice variant="inline" tone="danger" title={gateCopy.title}>
          {#if gateCopy.body}<p class="line">{gateCopy.body}</p>{/if}
        </Notice>
      {:else}
        <Notice
          variant="inline"
          tone="danger"
          actions={[
            { id: 'retry', label: t('action.retry'), onclick: () => void openSession() },
            { id: 'open', label: t('watch.openInChzzk.label'), onclick: openInChzzk },
          ]}
        >
          {t('watch.error.body')}
        </Notice>
      {/if}
    {/if}
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
