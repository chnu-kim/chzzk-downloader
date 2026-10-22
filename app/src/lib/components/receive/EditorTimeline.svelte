<script lang="ts">
  // 구간 편집 타임라인(range-editor.md §7, D67). 시간 영역 group 하나: (확대했을 때만) 범위 막대 · 눈금 · 영상 트랙 · 소리 트랙 ·
  // 구간 밖 흐림 · 위아래 띠 · 지금 위치선 · 손잡이 둘. 좌표는 모두 `rangeView`의 순수 변환(`view` = 보이는 범위)을 거치고,
  // x와 폭은 트랙 칸(.track)의 rect에서 잰다(이름 칸을 뺀 시간 축. group의 rect를 쓰면 이름 칸만큼 어긋난다, §7.4).
  // 이 컴포넌트는 값을 고치지 않는다: 손잡이는 `onmove`(초안 쪽 계산은 부모), 보이는 범위는 `onview`, 탐색은 `onseek`으로 알린다.
  // 끌기 중에는 보이는 범위가 고정이다(RE13): 휠은 `preventDefault`만 하고 범위 막대·눈금 조작은 부모가 `dragging`으로 막는다.
  import { t } from '../../copy/ko';
  import { formatClock, formatClockLong } from '../../format/duration';
  import { clampHandle, handleBounds, handleKey, type Handle } from '../../rangeEdit';
  import {
    MIN_VIEW_SECS,
    dragViewEdge,
    panBy,
    placement,
    reveal,
    scrollThumb,
    secsAtX,
    startAtThumbX,
    visibleTicks,
    wheelIntent,
    wheelPanSecs,
    xOfSecs,
    zoomAt,
    zoomFactor,
    zoomed,
    type View,
  } from '../../rangeView';
  import { platform } from '../../stores/platform.svelte';
  import Icon from '../ui/Icon.svelte';
  import { isImeKey } from '../ui/focus';

  interface Props {
    /** 타임라인 길이(초, 정수가 아니어도 된다) */
    length: number;
    /** 손잡이 값(초, `rangeEdit.selection`의 결과) */
    start: number;
    end: number;
    /** 띠를 그리는가. false면(순서가 뒤집힘) 손잡이 둘만 그린다 */
    band: boolean;
    /** 지금 위치(초). 영상이 결합되기 전에는 null이라 위치선을 그리지 않는다(PS11) */
    position: number | null;
    /** 영상과 결합돼 있는가: 눈금·트랙 누름 탐색은 결합 중에만 한다 */
    coupled: boolean;
    /** 보이는 범위(부모가 가진다) */
    view: View;
    /** 시간 영역 group의 `aria-describedby`(안내 줄 id) */
    describedby?: string;
    /** 좁은 레이아웃: 이름 칸을 접는다(트랙 이름은 장식이라 정보 손실이 없다, §6.3). 신호는 부모가 읽는다(DL13) */
    narrow?: boolean;
    /** 시간 영역 group 요소(칸 blur 탐색의 예외 판정·포커스 보관용) */
    el?: HTMLElement | null;
    onmove: (h: Handle, secs: number, phase: 'drag' | 'commit') => void;
    onseek: (secs: number) => void;
    onview: (v: View) => void;
    /** 따라가기를 끌 때(휠·범위 막대·눈금 두 번 누르기·화면 밖 손잡이) */
    onfollow?: (following: boolean) => void;
    /** 손잡이 끌기가 시작·끝났을 때(끌기 중에는 키 확대·범위 조작을 막는다, RE13) */
    ondrag?: (active: boolean) => void;
    /** 끌기를 Esc로 취소했을 때(부모가 누르기 전 초안으로 되돌린다) */
    oncancel?: () => void;
  }

  let {
    length,
    start,
    end,
    band,
    position,
    coupled,
    view,
    describedby,
    narrow = false,
    el = $bindable(null),
    onmove,
    onseek,
    onview,
    onfollow,
    ondrag,
    oncancel,
  }: Props = $props();

  const uid = $props.id();
  const groupId = `${uid}-time`;

  let trackEl: HTMLDivElement | null = $state(null);
  /** 트랙 칸 폭(px). 눈금 간격 계산용. 첫 측정 전에는 0이라 눈금이 없다 */
  let trackW = $state(0);

  const isZoomed = $derived(zoomed(view, length));
  const sel = $derived({ start, end, band });
  const bounds = $derived({
    start: handleBounds('start', sel, length),
    end: handleBounds('end', sel, length),
  });
  const tickList = $derived(visibleTicks(view, trackW));

  /** 띠·흐림의 보이는 범위 안 비율(0..1로 자른다) */
  const fraction = (secs: number) => Math.min(1, Math.max(0, xOfSecs(secs, 1, view)));
  const bandA = $derived(fraction(Math.min(start, end)));
  const bandB = $derived(fraction(Math.max(start, end)));
  /** 띠 폭: 시작에서 시작한 바깥 상자 안의 비율. 요소마다 사용자 속성은 --p 하나뿐이라 두 겹으로 나눠 그린다(DL7) */
  const bandW = $derived(bandA < 1 ? (bandB - bandA) / (1 - bandA) : 0);
  /** 범위 막대의 구간 위치(전체 길이 기준 비율) */
  const selA = $derived(length > 0 ? Math.min(1, Math.max(0, Math.min(start, end) / length)) : 0);
  const selB = $derived(length > 0 ? Math.min(1, Math.max(0, Math.max(start, end) / length)) : 0);
  const selW = $derived(selA < 1 ? (selB - selA) / (1 - selA) : 0);

  function valueNow(h: Handle): number {
    const b = bounds[h];
    const v = Math.floor(h === 'start' ? start : end);
    return Math.min(b.max, Math.max(b.min, v));
  }
  const valueOf = (h: Handle) => (h === 'start' ? start : end);
  const placeOf = (h: Handle) => placement(Math.min(length, Math.max(0, valueOf(h))), view);
  /** 같은 쪽 밖에 둘이 쌓이면 세로로 반씩 나눈다(시작이 위, RE12) */
  const stackOf = (h: Handle): 'top' | 'bottom' | null => {
    const a = placeOf('start');
    if (a === 'inside' || a !== placeOf('end')) return null;
    return h === 'start' ? 'top' : 'bottom';
  };

  function measure() {
    if (trackEl) trackW = trackEl.getBoundingClientRect().width;
  }
  $effect(() => {
    if (!trackEl) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(trackEl);
    return () => ro.disconnect();
  });

  function trackRect(): { left: number; width: number } {
    const r = trackEl?.getBoundingClientRect();
    return { left: r?.left ?? 0, width: r?.width ?? 0 };
  }

  function setView(next: View) {
    if (next.start === view.start && next.span === view.span) return;
    onview(next);
  }

  /** `--hit-min`(마우스 24, coarse 40)을 px로. 읽지 못하면 24 */
  function hitMin(): number {
    const n = Number.parseFloat(el ? getComputedStyle(el).getPropertyValue('--hit-min') : '');
    return Number.isFinite(n) && n > 0 ? n : 24;
  }

  // ---- 손잡이 ----
  /** 끌고 있는 손잡이와 마지막으로 낸 값(놓을 때 commit으로 다시 낸다). offset = 누른 점과 앵커의 거리(px) */
  let drag: { h: Handle; last: number | null; offset: number; node: HTMLElement; pointerId: number } | null = null;

  function release(d: NonNullable<typeof drag>) {
    try {
      d.node.releasePointerCapture?.(d.pointerId);
    } catch {
      // 이미 놓인 캡처다
    }
  }

  function endDrag() {
    drag = null;
    ondrag?.(false);
  }

  /** 끌기를 취소한다. 끌고 있지 않았으면 false (Esc 사다리 처리기가 받은 것으로 칠지 정한다) */
  export function cancelDrag(): boolean {
    const d = drag;
    if (!d) return false;
    release(d);
    endDrag();
    oncancel?.();
    return true;
  }

  function down(h: Handle, e: PointerEvent) {
    if (e.button !== 0) return;
    // 기본 동작(글자 선택·포커스)은 막고 포커스는 직접 준다
    e.preventDefault();
    const node = e.currentTarget as HTMLElement;
    node.focus();
    const cur = valueOf(h);
    if (placeOf(h) !== 'inside') {
      // 화면 밖 손잡이는 끌지 않는다: 값은 그대로 두고 보이는 범위만 옮긴다(RE12)
      onfollow?.(false);
      setView(reveal(view, cur, length));
      return;
    }
    const r = trackRect();
    drag = { h, last: null, offset: e.clientX - (r.left + xOfSecs(cur, r.width, view)), node, pointerId: e.pointerId };
    ondrag?.(true);
    try {
      node.setPointerCapture?.(e.pointerId);
    } catch {
      // 캡처를 못 잡아도 끌기는 이어진다(손잡이 위에서만 움직임이 온다)
    }
  }

  function move(h: Handle, e: PointerEvent) {
    if (!drag || drag.h !== h) return;
    const r = trackRect();
    // 보이는 범위 밖은 자른다(RE13: 끌기 중에는 범위가 고정이고 가장자리 자동 이동은 없다)
    const v = secsAtX(e.clientX - drag.offset - r.left, r.width, view);
    drag.last = v;
    onmove(h, v, 'drag');
  }

  function up(h: Handle, e: PointerEvent) {
    if (!drag || drag.h !== h) return;
    const d = drag;
    // 움직이지 않았으면(last == null) commit하지 않는다. pointercancel은 마지막 끌기 값으로 commit한다
    let v: number | null = null;
    if (e.type === 'pointercancel') v = d.last;
    else if (d.last != null) {
      const r = trackRect();
      v = secsAtX(e.clientX - d.offset - r.left, r.width, view);
    }
    endDrag();
    if (v != null) onmove(h, v, 'commit');
  }

  function keydown(h: Handle, e: KeyboardEvent) {
    if (isImeKey(e)) return;
    if (e.key === 'Escape') {
      // 끌기 중이면 취소하고 여기서 멈춘다(RE16 (1)). 아니면 위(편집 화면 뿌리)가 규칙대로 처리한다
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      cancelDrag();
      return;
    }
    const step = handleKey(e.key, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });
    if (step == null) return;
    e.preventDefault();
    const cur = valueOf(h);
    const target = step === 'min' ? -Infinity : step === 'max' ? Infinity : cur + step;
    const other = band ? (h === 'start' ? end : start) : null;
    const v = clampHandle(h, target, other, length);
    if (v == null) return;
    onmove(h, v, 'commit');
    // 바뀐 값이 보이게 범위를 옮긴다(포커스만으로는 옮기지 않는다)
    const next = reveal(view, v, length);
    if (next.start !== view.start || next.span !== view.span) {
      onfollow?.(false);
      onview(next);
    }
  }

  // ---- 트랙 ----
  function trackDown(e: PointerEvent) {
    if (e.button !== 0 || !coupled) return;
    if ((e.target as Element).closest('[role="slider"], [role="scrollbar"]')) return;
    const r = trackRect();
    onseek(secsAtX(e.clientX - r.left, r.width, view));
  }

  /** 눈금 줄 두 번 누르기: 그 자리를 중심으로 ×2 확대(포인터 하나로 하는 확대, WCAG 2.5.1, §7.2) */
  function rulerDbl(e: MouseEvent) {
    const r = trackRect();
    const next = zoomAt(view, 2, secsAtX(e.clientX - r.left, r.width, view), length, MIN_VIEW_SECS);
    if (next.start === view.start && next.span === view.span) return;
    onfollow?.(false);
    onview(next);
  }

  // ---- 휠(§7.3) ----
  function onwheel(e: WheelEvent) {
    const r = trackRect();
    const intent = wheelIntent(e, { mac: platform.isMac, trackW: r.width });
    if (!intent) return;
    if (drag) {
      e.preventDefault();
      return;
    }
    if (intent.kind === 'zoom') {
      if (length < MIN_VIEW_SECS) return;
      // 상하한에 닿아 더 안 바뀌어도 처리한 것으로 친다(바깥 확대·스크롤로 새지 않게)
      e.preventDefault();
      const anchor = secsAtX(e.clientX - r.left, r.width, view);
      const next = zoomAt(view, zoomFactor(intent.dyPx), anchor, length, MIN_VIEW_SECS);
      if (next.start === view.start && next.span === view.span) return;
      onfollow?.(false);
      onview(next);
      return;
    }
    if (!isZoomed) return;
    const res = panBy(view, wheelPanSecs(intent.px, r.width, view.span), length);
    if (!res.moved) return;
    e.preventDefault();
    onfollow?.(false);
    onview(res.view);
  }

  // Svelte의 onwheel 속성은 passive라 preventDefault가 안 된다: 직접 { passive: false }로 단다
  $effect(() => {
    const node = el;
    if (!node) return;
    node.addEventListener('wheel', onwheel, { passive: false });
    return () => node.removeEventListener('wheel', onwheel);
  });

  // ---- 범위 막대(§7.5) ----
  let thumbEl: HTMLSpanElement | null = $state(null);
  // 엄지 폭·위치는 계산값이라 DOM에 직접 쓴다(DS2). 최소 폭은 --hit-min이고 끌기 식(startAtThumbX)과 같은 scrollThumb를 쓴다
  $effect(() => {
    if (!thumbEl) return;
    const th = scrollThumb(view, length, trackW, hitMin());
    thumbEl.style.width = `${th.w}px`;
    thumbEl.style.left = `${th.x}px`;
  });
  const valueNowPct = $derived(length - view.span > 0 ? Math.round((view.start / (length - view.span)) * 100) : 0);
  const viewText = $derived(
    t('rangeEditor.viewport.value.label', {
      from: formatClockLong(Math.floor(view.start)),
      to: formatClockLong(Math.floor(view.start + view.span)),
    }),
  );

  type SbDrag = { kind: 'move' | 'start' | 'end'; offset: number; node: HTMLElement; pointerId: number };
  let sbDrag: SbDrag | null = null;
  let sbEl: HTMLDivElement | null = $state(null);

  function barRect(): { left: number; width: number } {
    const r = sbEl?.getBoundingClientRect();
    return { left: r?.left ?? 0, width: r?.width ?? 0 };
  }

  function sbGrab(kind: SbDrag['kind'], e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    sbEl?.focus();
    const bar = barRect();
    const th = scrollThumb(view, length, bar.width, hitMin());
    const anchor = kind === 'move' ? th.x : kind === 'start' ? th.x : th.x + th.w;
    const node = e.currentTarget as HTMLElement;
    sbDrag = { kind, offset: e.clientX - bar.left - anchor, node, pointerId: e.pointerId };
    onfollow?.(false);
    try {
      node.setPointerCapture?.(e.pointerId);
    } catch {
      // 캡처를 못 잡아도 이어진다
    }
  }

  function sbMove(kind: SbDrag['kind'], e: PointerEvent) {
    if (!sbDrag || sbDrag.kind !== kind) return;
    const bar = barRect();
    const x = e.clientX - bar.left - sbDrag.offset;
    if (kind === 'move') {
      setView({ start: startAtThumbX(x, view, length, bar.width, hitMin()), span: view.span });
      return;
    }
    // 가장자리 끌기: 반대쪽 끝을 고정하고 span을 바꾼다. 막대 x를 시간으로 옮긴다(엄지가 비례 폭일 때 정확하다)
    if (!(bar.width > 0)) return;
    setView(dragViewEdge(view, kind, (x / bar.width) * length, length, MIN_VIEW_SECS));
  }

  function sbUp() {
    sbDrag = null;
  }

  /** 엄지 밖 막대를 누르면 그쪽으로 1 span 옮긴다 */
  function sbDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('.sb-thumb')) return;
    const bar = barRect();
    const th = scrollThumb(view, length, bar.width, hitMin());
    const x = e.clientX - bar.left;
    const dir = x < th.x ? -1 : x > th.x + th.w ? 1 : 0;
    if (dir === 0) return;
    onfollow?.(false);
    setView(panBy(view, dir * view.span, length).view);
  }

  function sbKey(e: KeyboardEvent) {
    if (isImeKey(e)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let next: View | null = null;
    const step = e.shiftKey ? view.span : view.span * 0.1;
    switch (e.key) {
      case 'ArrowLeft':
        next = panBy(view, -step, length).view;
        break;
      case 'ArrowRight':
        next = panBy(view, step, length).view;
        break;
      case 'PageUp':
        next = panBy(view, -view.span, length).view;
        break;
      case 'PageDown':
        next = panBy(view, view.span, length).view;
        break;
      case 'Home':
        next = { start: 0, span: view.span };
        break;
      case 'End':
        next = { start: length - view.span, span: view.span };
        break;
      default:
        return;
    }
    e.preventDefault();
    onfollow?.(false);
    setView(next);
  }
</script>

<!-- 시간 영역: 눌러도 포커스는 이 그룹이 받아 키가 뿌리로 올라간다. 칸 blur 탐색은 data-timeline으로 알아본다 -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class={['tl-area', narrow && 'narrow']}
  role="group"
  id={groupId}
  aria-label={t('rangeEditor.timeline.title')}
  aria-describedby={describedby}
  aria-keyshortcuts="Plus Minus 0"
  tabindex="-1"
  data-timeline
  bind:this={el}
>
  <div class="labels" aria-hidden="true">
    {#if isZoomed}<div class="label-sb"></div>{/if}
    <div class="label-ruler"></div>
    <div class="label label-video">{t('rangeEditor.track.video.label')}</div>
    <div class="label label-audio">{t('rangeEditor.track.audio.label')}</div>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="track" bind:this={trackEl} onpointerdown={trackDown}>
    {#if isZoomed}
      <!-- 보이는 범위 막대: 엄지 몸통 = 끌어 이동, 양 끝 8px = 끌어 폭 조절 -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="sb"
        role="scrollbar"
        tabindex="0"
        bind:this={sbEl}
        aria-label={t('rangeEditor.viewport.label')}
        aria-orientation="horizontal"
        aria-controls={groupId}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={valueNowPct}
        aria-valuetext={viewText}
        onpointerdown={sbDown}
        onkeydown={sbKey}
      >
        <span class="sb-rail"></span>
        {#if band}
          <span class="sb-sel" style:--p={selA}><span class="sb-sel-in" style:--p={selW}></span></span>
        {/if}
        <span class="sb-thumb" bind:this={thumbEl} onpointerdown={(e) => sbGrab('move', e)} onpointermove={(e) => sbMove('move', e)} onpointerup={sbUp} onpointercancel={sbUp}>
          <span class="sb-edge" data-edge="start" onpointerdown={(e) => sbGrab('start', e)} onpointermove={(e) => sbMove('start', e)} onpointerup={sbUp} onpointercancel={sbUp}></span>
          <span class="sb-edge" data-edge="end" onpointerdown={(e) => sbGrab('end', e)} onpointermove={(e) => sbMove('end', e)} onpointerup={sbUp} onpointercancel={sbUp}></span>
        </span>
      </div>
    {/if}

    <div class="axis">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ruler" aria-hidden="true" ondblclick={rulerDbl}>
        {#each tickList as s (s)}
          <span class="tick" style:--p={xOfSecs(s, 1, view)}><span class="tick-label">{formatClock(s)}</span></span>
        {/each}
      </div>
      <div class="lanes">
        <div class="lane lane-video" data-lane="video" aria-hidden="true"></div>
        <div class="lane lane-audio" data-lane="audio" aria-hidden="true"></div>
        {#if band}
          <!-- 흐림은 트랙 줄에만(눈금 줄은 덮지 않는다), 띠는 구간의 위아래 -->
          <div class="shade" aria-hidden="true">
            <span class="dim dim-before" style:--p={bandA}></span>
            <span class="dim dim-after" style:--p={bandB}></span>
            <span class="band band-top" style:--p={bandA}><span class="band-in" style:--p={bandW}></span></span>
            <span class="band band-bottom" style:--p={bandA}><span class="band-in" style:--p={bandW}></span></span>
          </div>
        {/if}
        {#each ['start', 'end'] as const as h (h)}
          {@const place = placeOf(h)}
          {@const stack = stackOf(h)}
          <div class={['anchor', `anchor-${h}`, place !== 'inside' && `pinned pinned-${place}`, stack && `stack-${stack}`]} style:--p={fraction(valueOf(h))}>
            <div
              class="thumb"
              role="slider"
              tabindex="0"
              data-side={h}
              data-placement={place}
              data-stack={stack ?? undefined}
              aria-label={t(h === 'start' ? 'range.start' : 'range.end')}
              aria-valuemin={bounds[h].min}
              aria-valuemax={bounds[h].max}
              aria-valuenow={valueNow(h)}
              aria-valuetext={place === 'inside'
                ? formatClockLong(valueNow(h))
                : t('rangeEditor.offscreen.label', { time: formatClockLong(valueNow(h)) })}
              onpointerdown={(e) => down(h, e)}
              onpointermove={(e) => move(h, e)}
              onpointerup={(e) => up(h, e)}
              onpointercancel={(e) => up(h, e)}
              onkeydown={(e) => keydown(h, e)}
            >
              {#if place !== 'inside'}<Icon name={place === 'before' ? 'chevron-left' : 'chevron-right'} size="sm" />{/if}
            </div>
          </div>
        {/each}
      </div>
      {#if coupled && position != null && placement(position, view) === 'inside'}
        <div class="position" aria-hidden="true" style:--p={xOfSecs(position, 1, view)}></div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* 이름 칸 + 트랙 칸 두 칸 격자. 좁은 레이아웃은 이름 칸을 접는다(부모가 표지 신호를 읽어 narrow를 준다, DL13) */
  .tl-area {
    display: grid;
    grid-template-columns: var(--timeline-label-w) minmax(0, 1fr);
    /* 끝 손잡이의 누름 영역(::before)이 트랙 오른쪽 밖으로 나오므로 가로 스크롤이 생기지 않게 안쪽으로 들인다 */
    padding-inline-end: var(--space-12);
    background: var(--surface);
  }
  .tl-area.narrow {
    grid-template-columns: minmax(0, 1fr);
    /* 이름 칸이 없으면 시작 손잡이의 누름 영역(왼쪽으로 24)이 화면 밖으로 나가므로 왼쪽도 들인다 */
    padding-inline-start: var(--space-8);
  }
  .tl-area.narrow .labels {
    display: none;
  }
  .labels {
    min-width: 0;
    overflow: hidden;
  }
  .label-sb,
  .label-ruler {
    height: var(--hit-min);
  }
  .label {
    display: flex;
    align-items: center;
    padding-inline-end: var(--space-8);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--fg-muted);
  }
  .label-video {
    height: var(--timeline-lane-h);
  }
  .label-audio {
    height: var(--timeline-lane-sm-h);
  }
  .track {
    position: relative;
    min-width: 0;
    touch-action: none;
  }

  /* 범위 막대 */
  .sb {
    position: relative;
    display: flex;
    align-items: center;
    height: var(--hit-min);
  }
  .sb-rail {
    position: absolute;
    inset-inline: 0;
    height: var(--space-4);
    border-radius: var(--radius-pill);
    background: var(--track);
  }
  /* 구간 위치: 바깥 상자가 시작에서 시작하고 안쪽 상자가 폭이다 */
  .sb-sel {
    position: absolute;
    left: calc(var(--p) * 100%);
    right: 0;
    height: var(--space-4);
  }
  .sb-sel-in {
    display: block;
    width: calc(var(--p) * 100%);
    height: 100%;
    background: var(--accent-ink);
  }
  /* 엄지: 폭·위치는 JS가 DOM에 쓴다(최소 폭 --hit-min) */
  .sb-thumb {
    position: absolute;
    top: calc((var(--hit-min) - var(--space-12)) / 2);
    box-sizing: border-box;
    height: var(--space-12);
    border: 2px solid var(--fg);
    border-radius: var(--radius-badge);
    background: transparent;
  }
  /* 가장자리 끌기 영역: 엄지 양 끝 8px, 누름 영역은 바깥으로 편다 */
  .sb-edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--space-8);
  }
  .sb-edge[data-edge='start'] {
    left: calc(0px - var(--space-4));
  }
  .sb-edge[data-edge='end'] {
    right: calc(0px - var(--space-4));
  }

  .axis {
    position: relative;
  }
  .ruler {
    position: relative;
    height: var(--hit-min);
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--p) * 100%);
    width: 0;
    border-inline-start: 1px solid var(--border-strong);
  }
  .tick-label {
    position: absolute;
    top: 0;
    left: var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--fg-muted);
    white-space: nowrap;
  }
  .lanes {
    position: relative;
  }
  .lane {
    width: 100%;
  }
  .lane-video {
    height: var(--timeline-lane-h);
    background: var(--surface-pressed);
  }
  .lane-audio {
    height: var(--timeline-lane-sm-h);
    background: var(--surface-2);
  }
  /* 흐림·띠: 트랙 줄 위. 클릭은 트랙으로 통과한다 */
  .shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .dim {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--range-dim);
  }
  .dim-before {
    left: 0;
    width: calc(var(--p) * 100%);
  }
  .dim-after {
    left: calc(var(--p) * 100%);
    right: 0;
  }
  /* 띠: 바깥 상자가 구간 시작에서 시작하고 안쪽 상자가 구간 폭이다. 두께는 --timeline-band-w(대비 증가에서 굵다) */
  .band {
    position: absolute;
    left: calc(var(--p) * 100%);
    right: 0;
    height: var(--timeline-band-w);
  }
  .band-in {
    display: block;
    width: calc(var(--p) * 100%);
    height: 100%;
    background: var(--accent-ink);
  }
  .band-top {
    top: 0;
  }
  .band-bottom {
    bottom: 0;
  }
  @media (prefers-contrast: more) {
    /* 흐림 α를 줄이지 않고 띠를 굵게 해 구분한다(foundations §2.5) */
    .band {
      height: calc(var(--timeline-band-w) * 1.5);
    }
  }
  /* 지금 위치선: 눈금 줄 위 머리 + 시간 영역 전체 높이. 손잡이보다 아래, 흐림·띠보다 위 */
  .position {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--p) * 100%);
    width: 0;
    border-inline-start: 2px solid var(--fg);
    pointer-events: none;
  }
  .position::before {
    content: '';
    position: absolute;
    top: 0;
    left: calc(0px - var(--space-6));
    width: var(--space-12);
    height: var(--space-8);
    background: var(--fg);
    border-bottom-left-radius: var(--radius-badge);
    border-bottom-right-radius: var(--radius-badge);
  }

  /* 손잡이 앵커: 너비 0, 구간 바깥쪽으로 12px 몸통과 24px 누름 영역 */
  .anchor {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--p) * 100%);
    width: 0;
  }
  .thumb {
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    width: var(--timeline-handle-w);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-ink);
    border: 1px solid var(--surface);
    /* 몸통은 누르지 않는다: 누름은 바깥쪽 영역(::before)만 받아 붙은 상대 손잡이를 가리지 않는다 */
    pointer-events: none;
  }
  .anchor:not(.pinned) .thumb[data-side='start'] {
    right: 0;
    border-top-left-radius: var(--radius-badge);
    border-bottom-left-radius: var(--radius-badge);
  }
  .anchor:not(.pinned) .thumb[data-side='end'] {
    left: 0;
    border-top-right-radius: var(--radius-badge);
    border-bottom-right-radius: var(--radius-badge);
  }
  /* 가운데 세로 그립 */
  .thumb::after {
    content: '';
    width: var(--space-2);
    height: var(--space-24);
    background: var(--surface);
  }
  .thumb::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--hit-min);
    pointer-events: auto;
  }
  .thumb[data-side='start']::before {
    right: 0;
  }
  .thumb[data-side='end']::before {
    left: 0;
  }
  .thumb:active {
    background: var(--accent-pressed);
  }

  /* 화면 밖 손잡이: 가장자리에 붙인 32×64 꼴(같은 쪽 둘이면 32×32). 안의 chevron 하나 */
  .anchor.pinned-before {
    left: 0;
  }
  .anchor.pinned-after {
    left: 100%;
  }
  .pinned .thumb {
    width: var(--space-32);
    top: 50%;
    bottom: auto;
    height: calc(2 * var(--space-32));
    margin-top: calc(0px - var(--space-32));
    pointer-events: auto;
    color: var(--surface);
  }
  .pinned .thumb::before,
  .pinned .thumb::after {
    display: none;
  }
  .pinned-before .thumb {
    left: 0;
    border-top-right-radius: var(--radius-control);
    border-bottom-right-radius: var(--radius-control);
  }
  .pinned-after .thumb {
    right: 0;
    border-top-left-radius: var(--radius-control);
    border-bottom-left-radius: var(--radius-control);
  }
  .pinned.stack-top .thumb {
    height: var(--space-32);
    margin-top: calc(0px - var(--space-32));
  }
  .pinned.stack-bottom .thumb {
    height: var(--space-32);
    margin-top: 0;
  }

  @media (forced-colors: active) {
    .lane {
      background: Canvas;
      border: 1px solid CanvasText;
    }
    .dim {
      display: none;
    }
    .band-in,
    .sb-sel-in {
      background: Highlight;
    }
    .thumb {
      background: Highlight;
      border-color: CanvasText;
    }
    .thumb::after {
      background: CanvasText;
    }
    .pinned .thumb {
      color: HighlightText;
    }
    .position {
      border-inline-start-color: CanvasText;
    }
    .position::before {
      background: CanvasText;
    }
    .sb-thumb {
      border-color: CanvasText;
    }
  }
</style>
