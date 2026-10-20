<script lang="ts">
  // 구간 막대(docs/design/features/preview-ux.md §5.2, ADR-0028). 영상 아래에 놓는 선택 구간 표시와 시작·끝 손잡이 둘.
  // 손잡이는 role="slider"(APG multi-thumb)이고 끌기·키로 `onmove`를 부른다. 값을 고치는 일(칸 문자열 만들기)은 부모 몫이다.
  // 막대(손잡이 밖)를 누르면 `onseek`만 부르고 포커스를 옮기지 않는다. 위치는 `style:--p`(0~1)만 쓴다(PVU15).
  import { t } from '../../copy/ko';
  import { formatClockLong } from '../../format/duration';
  import { clampHandle, fractionOf, handleBounds, handleKey, secsAt, type Handle } from '../../rangeEdit';
  import { isImeKey } from '../ui/focus';

  interface Props {
    /** 막대 길이(초, 정수가 아니어도 된다) */
    length: number;
    /** 손잡이 값(초, `rangeEdit.selection`의 결과) */
    start: number;
    end: number;
    /** 선택 띠를 그리는가. false면(순서가 뒤집힘) 손잡이 둘만 그린다 */
    band: boolean;
    /** 재생 위치(초). 영상이 결합되기 전(재생 전)에는 null이라 위치 선을 그리지 않는다(preview-ux2 PS11) */
    position: number | null;
    /** 카드 busy: 손잡이 조작을 무시한다(포커스는 닿는다) */
    disabled?: boolean;
    onmove: (h: Handle, secs: number, phase: 'drag' | 'commit') => void;
    /** 막대(손잡이 밖)를 눌렀을 때 */
    onseek: (secs: number) => void;
  }

  let { length, start, end, band, position, disabled = false, onmove, onseek }: Props = $props();

  let trackEl: HTMLDivElement | null = $state(null);
  /** 끌고 있는 손잡이와 마지막으로 낸 값(놓을 때 commit으로 다시 낸다) */
  let drag: { h: Handle; last: number | null; offset: number } | null = null;

  const bounds = $derived({
    start: handleBounds('start', { start, end, band }, length),
    end: handleBounds('end', { start, end, band }, length),
  });

  function secsFromX(clientX: number): number {
    const r = trackEl?.getBoundingClientRect();
    if (!r || !(r.width > 0)) return 0;
    return secsAt((clientX - r.left) / r.width, length);
  }

  function valueNow(h: Handle): number {
    const b = bounds[h];
    const v = Math.floor(h === 'start' ? start : end);
    return Math.min(b.max, Math.max(b.min, v));
  }

  function down(h: Handle, e: PointerEvent) {
    if (e.button !== 0) return;
    // 기본 동작(글자 선택·포커스)은 막고 포커스는 직접 준다
    e.preventDefault();
    (e.currentTarget as HTMLElement).focus();
    if (disabled) return;
    // 누른 지점과 앵커의 거리: 끌 때 빼서, 눌렀을 뿐인데 값이 튀지 않게 한다
    const r = trackEl?.getBoundingClientRect();
    const cur = h === 'start' ? start : end;
    const anchorX = r ? r.left + fractionOf(cur, length) * r.width : e.clientX;
    drag = { h, last: null, offset: e.clientX - anchorX };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // 캡처를 못 잡아도 끌기는 이어진다(손잡이 위에서만 움직임이 온다)
    }
  }

  function move(h: Handle, e: PointerEvent) {
    if (!drag || drag.h !== h) return;
    if (disabled) {
      drag = null;
      return;
    }
    const v = secsFromX(e.clientX - drag.offset);
    drag.last = v;
    onmove(h, v, 'drag');
  }

  function up(h: Handle, e: PointerEvent) {
    if (!drag || drag.h !== h) return;
    // 움직이지 않았으면(last == null) commit하지 않는다. 끌던 중 disabled가 되어도 마찬가지
    const v = disabled ? null : e.type === 'pointercancel' ? drag.last : drag.last == null ? null : secsFromX(e.clientX - drag.offset);
    drag = null;
    if (v != null) onmove(h, v, 'commit');
  }

  function trackDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as Element).closest('[role="slider"]')) return;
    onseek(secsFromX(e.clientX));
  }

  function keydown(h: Handle, e: KeyboardEvent) {
    if (isImeKey(e)) return;
    const step = handleKey(e.key, { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey });
    if (step == null) return;
    e.preventDefault();
    if (disabled) return;
    const cur = h === 'start' ? start : end;
    const target = step === 'min' ? -Infinity : step === 'max' ? Infinity : cur + step;
    const other = band ? (h === 'start' ? end : start) : null;
    const v = clampHandle(h, target, other, length);
    if (v != null) onmove(h, v, 'commit');
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="track" bind:this={trackEl} onpointerdown={trackDown}>
  <div class="bar">
    {#if band}
      <div class="upto-end" style:--p={fractionOf(end, length)}></div>
      <div class="before-start" style:--p={fractionOf(start, length)}></div>
    {/if}
    {#if position != null}
      <div class="position" style:--p={fractionOf(position, length)}></div>
    {/if}
  </div>
  {#each ['start', 'end'] as const as h (h)}
    <div class="anchor anchor-{h}" style:--p={fractionOf(h === 'start' ? start : end, length)}>
      <div
        class="thumb"
        role="slider"
        tabindex="0"
        data-side={h}
        aria-label={t(h === 'start' ? 'range.start' : 'range.end')}
        aria-valuemin={bounds[h].min}
        aria-valuemax={bounds[h].max}
        aria-valuenow={valueNow(h)}
        aria-valuetext={formatClockLong(valueNow(h))}
        aria-disabled={disabled ? 'true' : undefined}
        onpointerdown={(e) => down(h, e)}
        onpointermove={(e) => move(h, e)}
        onpointerup={(e) => up(h, e)}
        onpointercancel={(e) => up(h, e)}
        onkeydown={(e) => keydown(h, e)}
      ></div>
    </div>
  {/each}
</div>

<style>
  /* 누름 영역 높이는 --hit-min, 보이는 두께는 --progress-h. 눌러도 포커스는 가장 가까운 포커스 가능 조상(편집 영역)이 받는다 */
  .track {
    position: relative;
    display: flex;
    align-items: center;
    height: var(--hit-min);
    touch-action: none;
  }
  .bar {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    height: var(--progress-h);
    border-radius: var(--radius-pill);
    background: var(--track);
  }
  /* 선택 띠 두 겹: 끝까지 채운 뒤 시작 앞을 트랙 색으로 가린다 */
  .upto-end,
  .before-start {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: calc(var(--p) * 100%);
  }
  .upto-end {
    background: var(--accent);
    border-radius: var(--radius-pill);
  }
  .before-start {
    background: var(--track);
    border-radius: var(--radius-pill);
  }
  /* 재생 위치: 너비 0 앵커 + 왼쪽 선. 높이는 트랙 두께만(손잡이는 트랙 밖으로 튀어나온다) */
  .position {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--p) * 100%);
    width: 0;
    border-inline-start: 2px solid var(--fg);
  }
  /* 손잡이 앵커: 너비 0, 안의 손잡이를 flex로 가운데 둔다 */
  .anchor {
    position: absolute;
    top: 0;
    bottom: 0;
    left: calc(var(--p) * 100%);
    width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .thumb {
    position: relative;
    flex: none;
    box-sizing: border-box;
    width: var(--space-4);
    height: var(--control-h-sm);
    /* 몸통 자체는 누르지 않는다: 누름은 바깥쪽 절반(::before)만 받아 붙은 상대 손잡이를 가리지 않는다 */
    pointer-events: none;
    background: var(--accent);
    border: 1px solid var(--surface);
  }
  /* 대괄호 턱: 시작은 [ (구간 쪽인 오른쪽), 끝은 ] (왼쪽)으로 위·아래 끝에서 나온다 */
  .thumb::after {
    content: '';
    pointer-events: none;
    position: absolute;
    top: 0;
    bottom: 0;
    box-sizing: border-box;
    width: var(--space-4);
    border-block: 2px solid var(--accent);
  }
  .thumb[data-side='start']::after {
    left: 100%;
  }
  .thumb[data-side='end']::after {
    right: 100%;
  }
  /* 누름 영역은 앵커에서 바깥쪽으로만 편다: 두 손잡이가 붙어 있어도 겹치지 않는다 */
  .thumb::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: var(--hit-min);
    pointer-events: auto;
  }
  .thumb[data-side='start']::before {
    right: 50%;
  }
  .thumb[data-side='end']::before {
    left: 50%;
  }
  /* 눌림은 채움(foundations §1 규칙 6): 포인터를 쥔 동안만의 일시 상태 */
  .thumb:not([aria-disabled='true']):active {
    background: var(--accent-pressed);
  }
  .thumb:not([aria-disabled='true']):active::after {
    border-color: var(--accent-pressed);
  }
  @media (forced-colors: active) {
    .bar {
      border: 1px solid CanvasText;
    }
    .upto-end {
      background: Highlight;
    }
    .before-start {
      background: Canvas;
    }
    .position {
      border-inline-start-color: CanvasText;
    }
    .thumb {
      background: Highlight;
      border-color: CanvasText;
    }
    .thumb::after,
    .thumb:not([aria-disabled='true']):active::after {
      border-color: Highlight;
    }
    .thumb:not([aria-disabled='true']):active {
      background: Highlight;
    }
  }
</style>
