<script lang="ts">
  // 구간 편집 화면(range-editor.md, D67): 빠른 다시보기 카드가 소유하는 창 전체 레이어. 위는 영상(모니터), 아래는 타임라인 패널이다.
  // 상태는 셋이다(RE2). 카드의 확정 구간 `applied`는 이 화면이 읽기만 하고, 여기서 고치는 것은 초안 `draft`(칸 두 글자)뿐이다.
  // [구간 적용하기]는 `applyDraft`로 검증해 통과할 때만 `onapply`로 확정값을 카드에 돌려주고, [닫기]·Esc는 초안만 버린다(RE17: 확인 없음).
  // 레이어는 공용 `modalLayer`로 body 직속에 붙고 다른 층은 inert다(RE1). 붙는 동안 `ui.rangeEditorOpen`이 true라 창 수준 처리기가 거른다(RE15).
  // 세션은 [영상 보기]를 눌렀을 때 연다(RE7, watchSession). 영상과 구간의 결합(`coupled` = hls.js로 붙고 메타데이터를 읽음, PS12/RE8)이 되면
  // 조작 줄·재생 위치·영상 탐색이 켜진다. 그 전에는 타임라인과 칸이 칸 편집기로만 동작한다(손잡이는 초안만 고친다).
  // RE-3 범위: 타임라인(막대)과 조작 줄은 옛 모양 그대로 이 화면으로 옮겼다(RE-4가 타임라인을, RE-5가 조작 줄을 바꾼다).
  import { onDestroy, onMount, untrack } from 'svelte';
  import * as api from '../../api';
  import type { ResolvedDto, TimeRangeDto } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t, type CopyKey } from '../../copy/ko';
  import { formatClock } from '../../format/duration';
  import { shortcutText } from '../../platform';
  import {
    consumeOwnSeek,
    mark as markFields,
    moveHandle,
    nudge as nudgeFields,
    playStep,
    reachesEnd,
    seekKey,
    seekTargetOf,
    selection,
    timelineLength,
    type Fields,
    type Handle,
    type PlayMode,
  } from '../../rangeEdit';
  import { VIDEO_MIN_H, controlsMinW, monitorSize } from '../../rangeView';
  import {
    RANGE_FORMAT_EXAMPLE_SECS,
    applyDraft,
    draftOf,
    effectiveRange,
    kindLabel,
    lengthLine,
    rangeError,
    type RangeError,
  } from '../../receive';
  import { platform } from '../../stores/platform.svelte';
  import { modKey, ui } from '../../stores/ui.svelte';
  import Button from '../ui/Button.svelte';
  import FieldRow from '../ui/FieldRow.svelte';
  import { editable, focusables, isImeKey, trapTab } from '../ui/focus';
  import Notice from '../ui/Notice.svelte';
  import Sheet from '../ui/Sheet.svelte';
  import Switch from '../ui/Switch.svelte';
  import TextField from '../ui/TextField.svelte';
  import RangeTimeline from './RangeTimeline.svelte';
  import { WatchSession } from './watchSession.svelte';

  interface Props {
    view: ResolvedDto;
    /** 카드의 확정 구간. 열 때 초안의 출발점이다(RE4) */
    applied: TimeRangeDto | null;
    /** 고른 화질의 예상 크기(길이 줄). 화질을 고를 수 없는 화면이라 열린 동안 고정이다 */
    sizeOf: (secs: number) => string | null;
    /** 연 단추([구간 편집…]). 닫을 때 포커스를 돌려준다. 없어졌으면 입력줄로 */
    opener?: HTMLElement | null;
    /** 검증을 통과한 확정값(전체이면 null). 카드가 `applied`를 바꾸고 이 화면을 닫는다 */
    onapply: (applied: TimeRangeDto | null) => void;
    /** [닫기]·Esc: 초안을 버리고 닫는다 */
    onclose: () => void;
  }

  let { view, applied, sizeOf, opener = null, onapply, onclose }: Props = $props();

  const durationSecs = $derived(view.meta.durationSecs);

  // 초안은 열 때 확정값에서 만든다(이후 확정값이 바뀌어도 따라가지 않는다: 열린 동안 카드는 inert다)
  let draft: Fields = $state(untrack(() => draftOf(applied, view.meta.durationSecs)));
  let draftErr: RangeError | null = $state(null);

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const subId = `${uid}-sub`;
  const panelTitleId = `${uid}-panel`;
  const errorId = `${uid}-error`;

  let rootEl: HTMLDivElement | null = $state(null);
  let probeEl: HTMLElement | null = $state(null);
  let videoboxEl: HTMLElement | null = $state(null);
  let h1El: HTMLHeadingElement | null = $state(null);
  let monitorEl: HTMLElement | null = $state(null);
  let controlsEl: HTMLDivElement | null = $state(null);
  let startEl: HTMLButtonElement | null = $state(null);
  let videoEl: HTMLVideoElement | null = $state(null);
  let startField: HTMLInputElement | null = $state(null);
  let endField: HTMLInputElement | null = $state(null);
  /** video의 메타데이터를 읽었는가(그 전의 currentTime은 믿지 않는다) */
  let metaReady = $state(false);
  /** 지금 위치(초). timeupdate·seeked에서 읽는다 */
  let position = $state(0);
  /** 영상이 알려 준 길이(meta가 없을 때만 막대 길이가 된다, PVU7) */
  let videoSecs: number | null = $state(null);
  /** 구간 보기 모드(§6.3). 탐색·손잡이 조작에서 'off' (RE-5가 지운다) */
  let playMode: PlayMode = $state('off');
  /** 구간 반복하기 스위치(열 때마다 새로 시작한다) */
  let loop = $state(false);
  /** 우리가 currentTime을 쓴 목표(다음 seeked가 byUs인지 가린다)와 우리가 부른 pause 깃발. 한 번 쓰고 버린다 */
  let pendingSeek: number | null = null;
  let pausedByUs = false;
  let reportedSecs: number | null | undefined;
  /** 칸에서 IME 조합 중인가(오류 포커스가 전체 선택을 하지 않는다) */
  let composingNow = false;

  const loopId = `${uid}-loop`;

  function resetPlay() {
    playMode = 'off';
    pendingSeek = null;
    pausedByUs = false;
    position = 0;
  }

  function reportDuration(secs: number | null) {
    if (secs === reportedSecs) return;
    reportedSecs = secs;
    videoSecs = secs;
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

  function focusTitle() {
    h1El?.focus();
  }

  const session = new WatchSession({
    // 편집 화면은 표지 자리(idle)부터다: 열기만으로는 watch_open을 부르지 않는다(RE7)
    initialOpen: true,
    target: () => ({ url: view.url, content: view.content }),
    video: () => videoEl,
    onready: () => {
      if (focusIsFree()) videoEl?.focus();
      startPlay();
    },
    // 실패 뒤 포커스: 열기 실패는 단추·body에 있을 때만, 재생 중 오류는 영상에 있었을 때만 제목(h1)으로(편집 화면에는 섹션 머리가 없다)
    onfailed: (videoFocused, cause) => {
      if (cause === 'video' ? videoFocused : focusIsFree()) focusTitle();
    },
    onclosed: () => {
      // 결합이 풀려 조작 줄이 disabled가 될 때 포커스가 그 줄에 있었으면 제목으로(포커스를 잃으면 키가 뿌리를 지나지 않는다)
      if (controlsEl?.contains(document.activeElement)) queueMicrotask(focusTitle);
      metaReady = false;
      resetPlay();
      reportDuration(null);
    },
  });

  /** 영상과 구간의 결합(PS12/RE8): hls.js로 붙었고 메타데이터를 읽었을 때만 */
  const coupled = $derived(session.usingHls && metaReady);
  const gateCopy = $derived(session.gateError ? errorCopy(session.gateError, { place: 'resolve' }) : null);

  // ---- 타임라인 길이·선택 ----
  const len = $derived(timelineLength(durationSecs, videoSecs));
  const sel = $derived(len ? selection(draft, len.secs) : null);
  const barShown = $derived(!!len && !!sel);

  // ---- 초안 ----
  function setDraft(next: Fields) {
    draft.start = next.start;
    draft.end = next.end;
  }

  /** 손잡이·↑/↓·찍기·[구간 지우기]로 초안이 바뀌면 앞 적용의 오류는 맞지 않다(타이핑은 지우지 않는다, §5.1) */
  function changeDraft(next: Fields) {
    setDraft(next);
    draftErr = null;
  }

  function mark(field: 'start' | 'end') {
    if (!videoEl || !metaReady) return;
    changeDraft(markFields(draft, field, Math.floor(videoEl.currentTime)));
  }

  /** 편집 화면 [구간 지우기]는 초안만 지운다(RE6). 단추는 늘 있고 늘 누를 수 있어 포커스가 그 자리에 남는다 */
  function clearDraft() {
    changeDraft({ start: '', end: '' });
  }

  const rangeInput = $derived({ open: true as const, start: draft.start, end: draft.end });
  /** 길이 줄(PS10): 받을 구간이 전체이면 "전체 길이", 읽히면 "구간 길이". 칸이 틀렸으면 줄이 없다 */
  const lengthText = $derived(
    lengthLine({
      error: rangeError(rangeInput, durationSecs),
      range: effectiveRange(rangeInput, durationSecs),
      durationSecs,
      size: sizeOf,
    }),
  );

  const ERROR_KEY = {
    format: 'range.error.format',
    order: 'range.error.order',
    beyond: 'range.error.beyond',
  } as const satisfies Record<RangeError['kind'], CopyKey>;

  function errorTextOf(e: RangeError | null): string {
    if (!e) return '';
    return e.kind === 'format' ? t(ERROR_KEY.format, { example: formatClock(RANGE_FORMAT_EXAMPLE_SECS) }) : t(ERROR_KEY[e.kind]);
  }
  const errorText = $derived(errorTextOf(draftErr));

  // 오류면 설명 요소(아래 Notice)를 aria-describedby로 잇는다(InvalidProps 타입이 강제)
  function fieldProps(field: 'start' | 'end', helpId: string | undefined) {
    return draftErr?.field === field
      ? { invalid: true as const, 'aria-describedby': helpId ? `${errorId} ${helpId}` : errorId }
      : { invalid: false as const, 'aria-describedby': helpId };
  }

  // 적용 실패: 그 칸에 포커스하고 IME 조합이 아닐 때만 전체 선택한다(RE3). 같은 오류가 다시 나도 새 객체라 다시 포커스한다
  $effect(() => {
    const e = draftErr;
    if (!e) return;
    const el = e.field === 'start' ? startField : endField;
    el?.focus();
    if (!composingNow) el?.select();
  });

  /** [구간 적용하기]·Mod+Enter (RE3) */
  function applyNow() {
    const r = applyDraft({ start: draft.start, end: draft.end }, durationSecs);
    if (!r.ok) {
      draftErr = r.error;
      return;
    }
    draftErr = null;
    onapply(r.applied);
  }

  // ---- 영상 탐색·구간 보기 ----
  /**
   * 영상을 secs초로 옮긴다(손잡이·키·막대·칸). 먼저 구간 보기를 끈다(§6.3): 그래서 이 탐색은 playStep에 닿지 않는다.
   * 목표는 [0, video.duration]으로 한 번 더 자른다(meta 길이가 실제 영상보다 길 수 있다, 검토 반영 V11)
   */
  function seek(secs: number) {
    playMode = 'off';
    const v = videoEl;
    if (!v || !coupled || Number.isNaN(secs)) return;
    const d = v.duration;
    const hi = Number.isFinite(d) && d > 0 ? d : Number.POSITIVE_INFINITY;
    const target = Math.min(Math.max(secs, 0), hi);
    v.currentTime = target;
    position = target;
  }

  /** 손잡이 이동. 끌기 중에는 초안만 바꾸고, 놓을 때·키에서는 영상도 그 손잡이 시각으로 간다 */
  function moveTo(h: Handle, secs: number, phase: 'drag' | 'commit') {
    if (!len) return;
    // 구간을 고치는 동안에는 끌기 중에도 restart·pause가 끼어들지 않는다(§6.3·V6)
    playMode = 'off';
    const next = moveHandle(draft, h, secs, len);
    if (!next) return;
    changeDraft(next);
    if (phase === 'commit') seek(selection(next, len.secs)[h]);
  }

  /** 시작 칸 값(초) 쪽 선택. 길이를 모르면 구간 보기는 없다 */
  function stepSel() {
    if (!sel || !len) return null;
    return { start: sel.start, end: sel.end, toEnd: reachesEnd(sel, draft.end, len.secs) };
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

  // ---- 칸 ↔ 영상(PVU10, 카드에서 옮겨 왔다) ----
  /** 칸에 포커스가 들어올 때의 글자(PVU10: 바뀌었는지 비교) */
  let focusText: string | null = null;
  const fieldText = (f: 'start' | 'end') => draft[f];

  function focusField(f: 'start' | 'end') {
    focusText = fieldText(f);
  }

  /**
   * 칸 → 영상(PVU10): 값이 바뀌었고, 포커스가 타임라인 영역·손잡이로 가는 게 아니고(막대를 누른 쪽이 이긴다),
   * 읽히면 영상을 그 시각으로 보낸다. 영상이 결합되기 전이면 seek이 아무것도 하지 않는다
   */
  function blurField(f: 'start' | 'end', to: EventTarget | null) {
    flushSeek(f); // keyup 없이 포커스가 떠나도 길게 누른 마지막 탐색은 보낸다(PS2)
    const before = focusText;
    focusText = null;
    const text = fieldText(f);
    if (before == null || before === text) return;
    if (to instanceof Element && (to.hasAttribute('data-timeline') || to.getAttribute('role') === 'slider')) return;
    if (!len) return;
    const secs = seekTargetOf(text, len.secs, f);
    if (secs != null) seek(secs);
  }

  /** 칸 → 영상 탐색 목표(초). 끝 칸이 빈칸("끝까지")이면 맨 끝(floor(길이)). 못 정하면 null */
  function seekSecsOf(f: 'start' | 'end', text: string): number | null {
    if (!len) return null;
    return f === 'end' && text.trim() === '' ? Math.floor(len.secs) : seekTargetOf(text, len.secs, f);
  }

  /** 길게 누르는 동안 미룬 마지막 탐색이 있는 칸(PS2). keyup이나 blur에서 한 번 보낸다 */
  let pendingFieldSeek: 'start' | 'end' | null = null;

  function flushSeek(f: 'start' | 'end') {
    if (pendingFieldSeek !== f) return;
    pendingFieldSeek = null;
    const secs = seekSecsOf(f, fieldText(f));
    if (secs != null) seek(secs);
  }

  /**
   * 칸의 ↑/↓(PS1~PS3): ±1초. 수식 키 조합은 처리하지 않아 칸의 기본 편집 동작을 남긴다(IME 조합 중 거름은 keydown 첫 줄).
   * 그 밖의 ↑/↓는 늘 기본 동작(캐럿 이동)을 막는다. 칸을 못 읽으면 값은 그대로다.
   * 칸을 고치고 앞 적용의 구간 오류를 지운다. 영상은 첫 keydown에만 따라가고 길게 누른 뒤에는 keyup·blur에서 한 번이다
   */
  function fieldKey(f: 'start' | 'end', e: KeyboardEvent) {
    if (isImeKey(e)) return;
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const next = nudgeFields(draft, f, e.key === 'ArrowUp' ? 1 : -1, len);
    if (!next) return;
    changeDraft(next);
    // 포커스 때 글자를 새 값으로 바꿔 blur가 같은 시각으로 한 번 더 탐색하지 않게 한다(PS3)
    focusText = next[f];
    if (e.repeat) {
      pendingFieldSeek = f;
      return;
    }
    pendingFieldSeek = null;
    const secs = seekSecsOf(f, next[f]);
    if (secs != null) seek(secs);
  }

  function fieldKeyUp(f: 'start' | 'end', e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') flushSeek(f);
  }

  // ---- 키 ----
  /** 영상이 전체 화면인가(웹뷰가 Esc로 전체 화면을 푼다, RE16 (2)) */
  function inFullscreen(): boolean {
    const v = videoEl as (HTMLVideoElement & { webkitDisplayingFullscreen?: boolean }) | null;
    return !!document.fullscreenElement || !!v?.webkitDisplayingFullscreen;
  }

  /**
   * Esc 순서(RE16, 첫 줄은 isImeKey). (0) 길게 누른 Esc는 거르기만 하고 아무것도 닫지 않는다. (2) 영상이 전체 화면이면 preventDefault 없이
   * 전파만 막는다(웹뷰가 전체 화면을 풀고, 창 처리기가 카드를 닫지 않게). (3) 편집 화면을 닫는다(초안을 버린다).
   * (1) 손잡이 끌기 취소는 새 손잡이가 오는 RE-4가 맡는다(옛 막대에서는 닫으면 끌기도 끝난다)
   */
  function onEscape(e: KeyboardEvent) {
    if (e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (inFullscreen()) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    onclose();
  }

  /**
   * 뿌리 keydown 하나가 받는다(§9.1). Esc·Mod+Enter·Tab 순환을 먼저 처리하고, 나머지는 편집 키다.
   * 손잡이가 이미 처리한 키(defaultPrevented)와 입력칸·IME 조합은 거른다.
   * I/O는 찍기 단추·영상·손잡이·뿌리에서만(다른 단추·스위치 위에서는 글자 그대로),
   * Space는 손잡이·뿌리에서 재생 ↔ 일시정지(단추·스위치는 자기가 누른다), ←/→는 단추·스위치·뿌리에서 재생 위치 ∓5초.
   * 영상 위의 나머지 키는 네이티브 몫이고, Alt·Ctrl·Meta 조합은 창·OS 몫이다
   */
  function onkeydown(e: KeyboardEvent) {
    if (isImeKey(e)) return;
    if (e.key === 'Escape') return onEscape(e);
    // Mod+Enter는 적용의 성공·실패와 관계없이 막고 전파를 끊는다: 카드의 창 Mod+Enter가 [받기]로 받지 않게(RE15)
    if (e.key === 'Enter' && modKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      applyNow();
      return;
    }
    // 제목(h1, tabindex -1)에서 Shift+Tab은 마지막 요소로 돈다(trapTab은 제목을 화면 밖 요소로 본다)
    if (e.key === 'Tab' && e.shiftKey && rootEl && document.activeElement === h1El) {
      const list = focusables(rootEl);
      if (list.length > 0) {
        e.preventDefault();
        list[list.length - 1].focus();
        return;
      }
    }
    if (rootEl && trapTab(e, rootEl)) return;
    if (e.defaultPrevented || editable(e.target)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const v = videoEl;
    if (!v || !coupled || !(e.target instanceof Element)) return;
    const el = e.target;
    const command = el.closest('button, [role="switch"]');
    const slider = el.closest('[role="slider"]');
    if (e.code === 'KeyI' || e.code === 'KeyO') {
      if (e.shiftKey || e.repeat) return;
      // 찍기 단추만 이 키를 받는다(aria-keyshortcuts가 달린 단추)
      if (command && !command.hasAttribute('aria-keyshortcuts')) return;
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

  // ---- 레이어 ----
  /**
   * 붙는 동안 `ui.rangeEditorOpen`이 true다(카드가 갑자기 사라져도 정리에서 false로 돌아온다, §5.1).
   * 포커스가 body로 떨어져 키가 뿌리를 지나지 않는 경우를 위해 Esc 사다리 맨 안쪽에도 같은 규칙의 처리기를 쌓는다(RE16):
   * 전체 화면이면 건드리지 않고(받은 것으로 친다) 아니면 닫는다. 열리면 제목(h1)으로 포커스를 옮긴다(F-10)
   */
  onMount(() => {
    ui.rangeEditorOpen = true;
    const offEscape = ui.onEscape(() => {
      if (!inFullscreen()) onclose();
      return true;
    });
    queueMicrotask(focusTitle);
    return () => {
      offEscape();
      ui.rangeEditorOpen = false;
    };
  });

  // ---- 크기(§6.2 monitorSize) ----
  // 영상 상자·조작 줄 폭은 모니터 크기에서 JS 한 곳이 계산한다(CSS만으로는 조작 줄 폭이 영상 폭과 최소 380에 묶이는 것을 못 쓴다).
  // 인라인 style 디렉티브는 쓰지 않는다(DS2): 계산값을 DOM에 직접 쓴다. ResizeObserver가 없으면(jsdom) 쓰지 않아 CSS가 폭 100%·16:9로 둔다
  let sizes: { videoW: number; videoH: number; rowW: number; floor: number } | null = $state(null);

  function px(v: string, fallback: number): number {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function measure() {
    const stage = monitorEl;
    if (!stage) return;
    const ss = getComputedStyle(stage);
    const padTop = px(ss.paddingTop, 0);
    const padBottom = px(ss.paddingBottom, 0);
    const stageW = stage.clientWidth - px(ss.paddingLeft, 0) - px(ss.paddingRight, 0);
    const stageH = stage.clientHeight - padBottom;
    const controlsH = controlsEl?.offsetHeight ?? 0;
    // 좁은 레이아웃 신호는 layout.css가 표지(.fullsheet-probe)를 block으로 바꾸는 것이다(폭 쿼리는 layout.css에만, DL13)
    const narrow = !!probeEl && getComputedStyle(probeEl).display === 'block';
    const controlH = px(ss.getPropertyValue('--control-h'), 28);
    const m = monitorSize({ stageW, stageH, controlsH, padTop, narrow, videoMinH: VIDEO_MIN_H, controlsMinW: controlsMinW(controlH) });
    // 좁은 레이아웃은 폭에서 정한 영상 높이를 바닥으로, 그 밖은 하한만 바닥으로 둔다: 이보다 모자라면 몸통이 스크롤된다
    sizes = { ...m, floor: (narrow ? m.videoH : VIDEO_MIN_H) + controlsH + padTop + padBottom };
  }

  $effect(() => {
    if (typeof ResizeObserver === 'undefined' || !monitorEl) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(monitorEl);
    if (controlsEl) ro.observe(controlsEl);
    measure();
    return () => ro.disconnect();
  });

  $effect(() => {
    const m = sizes;
    if (monitorEl) monitorEl.style.minHeight = m ? `${m.floor}px` : '';
    if (videoboxEl) {
      videoboxEl.style.width = m ? `${m.videoW}px` : '';
      videoboxEl.style.height = m ? `${m.videoH}px` : '';
    }
    if (controlsEl) controlsEl.style.width = m ? `${m.rowW}px` : '';
  });

  onDestroy(() => session.destroy());
</script>

<Sheet labelledby={titleId} describedby={subId} {opener} returnFocus={() => ui.urlTarget?.focus()} bind:el={rootEl} {onkeydown}>
  <header class="head">
    <div class="titles">
      <h1 id={titleId} class="title" tabindex="-1" data-focus-container bind:this={h1El}>{t('rangeEditor.title')}</h1>
      <p id={subId} class="context">{t('rangeEditor.context.label', { kind: kindLabel('rewind'), title: view.meta.title })}</p>
    </div>
    <div class="acts">
      <Button onclick={onclose}>{t('common.close')}</Button>
      <Button variant="primary" kbd={shortcutText(platform.os, 'submit')} onclick={applyNow}>{t('rangeEditor.apply.label')}</Button>
    </div>
  </header>
  <!-- 몸통: 머리 줄은 늘 보이고 이 안만 스크롤된다(VIDEO_MIN_H에 닿은 뒤·좁은 레이아웃) -->
  <div class="body">
    <span class="fullsheet-probe" aria-hidden="true" bind:this={probeEl}></span>

  <section class="monitor" bind:this={monitorEl}>
    <!-- 영상 자리: 표지 자리+[영상 보기] | <video controls> | 실패 Notice. 크기는 monitorSize가 정한다 -->
    <div class="videobox" bind:this={videoboxEl}>
      {#if session.phase === 'idle' || session.phase === 'opening'}
        <div class="stage">
          <Button icon="play" loading={session.phase === 'opening'} bind:el={startEl} aria-label={t('watch.start.a11y', { title: view.meta.title })} onclick={() => void session.start()}>
            {t('watch.start.label')}
          </Button>
        </div>
      {:else if session.phase === 'failed'}
        <div class="stage">
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
        </div>
      {:else if session.phase === 'ready'}
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
          {ontimeupdate}
          {onseeked}
          {onpause}
          {onended}
        ></video>
      {/if}
    </div>
    <!-- 조작 줄: 늘 그린다(배치가 흔들리지 않게, RE8). 결합 전에는 모두 disabled다 -->
    <div class="controls" bind:this={controlsEl}>
      <Button size="sm" aria-keyshortcuts="I" disabled={!coupled} onclick={() => mark('start')}>{t('watch.mark.start')}</Button>
      <Button size="sm" aria-keyshortcuts="O" disabled={!coupled} onclick={() => mark('end')}>{t('watch.mark.end')}</Button>
      <Button size="sm" disabled={!coupled || !len || !sel?.band} onclick={playRange}>{t('watch.range.play.label')}</Button>
      <Button size="sm" disabled={!coupled || !len} onclick={playFromStart}>{t('watch.range.fromStart.label')}</Button>
      <span class="loop">
        <span id={loopId}>{t('watch.range.loop.label')}</span>
        <Switch bind:value={loop} labelledby={loopId} disabled={!coupled} onchange={onloop} />
      </span>
    </div>
  </section>

  <section class="panel" aria-labelledby={panelTitleId}>
    <div class="panel-head">
      <h2 id={panelTitleId} class="panel-title">{t('rangeEditor.timeline.title')}</h2>
      {#if session.phase === 'ready' && !session.usingHls}
        <p class="note">{t('rangeEditor.uncoupled.body')}</p>
      {/if}
    </div>
    {#if barShown && len && sel}
      <!-- 시간 영역: 눌러도 포커스는 이 그룹이 받아 키가 뿌리로 올라간다. 칸 blur 탐색은 이 속성으로 알아본다 -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="timeline" role="group" aria-label={t('rangeEditor.timeline.title')} tabindex="-1" data-timeline>
        <RangeTimeline
          length={len.secs}
          start={sel.start}
          end={sel.end}
          band={sel.band}
          position={coupled ? position : null}
          onmove={moveTo}
          onseek={seek}
        />
      </div>
    {:else}
      <p class="note">{t('rangeEditor.noLength.body')}</p>
    {/if}

    <div class="range" role="group" aria-label={t('range.label')}>
      <FieldRow label={t('range.label')} help={t('range.help')}>
        {#snippet control({ helpId })}
          <span class="groups">
            <!-- 시작 칸과 `~`는 한 묶음이라 좁은 폭에서도 떨어지지 않는다(PVU-5 V23) -->
            <span class="group">
              <span class="clock">
                <TextField
                  label={t('range.start')}
                  bind:value={draft.start}
                  bind:el={startField}
                  placeholder={t('range.fromBegin')}
                  {...fieldProps('start', helpId)}
                  oncompositionstart={() => (composingNow = true)}
                  oncompositionend={() => (composingNow = false)}
                  onfocus={() => focusField('start')}
                  onblur={(e) => blurField('start', e.relatedTarget)}
                  onkeydown={(e) => fieldKey('start', e)}
                  onkeyup={(e) => fieldKeyUp('start', e)}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                />
              </span>
              <span aria-hidden="true">~</span>
            </span>
            <span class="group">
              <span class="clock">
                <TextField
                  label={t('range.end')}
                  bind:value={draft.end}
                  bind:el={endField}
                  placeholder={t('range.toEnd')}
                  {...fieldProps('end', helpId)}
                  oncompositionstart={() => (composingNow = true)}
                  oncompositionend={() => (composingNow = false)}
                  onfocus={() => focusField('end')}
                  onblur={(e) => blurField('end', e.relatedTarget)}
                  onkeydown={(e) => fieldKey('end', e)}
                  onkeyup={(e) => fieldKeyUp('end', e)}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                />
              </span>
            </span>
          </span>
        {/snippet}
        {#snippet actions()}
          <Button size="sm" onclick={clearDraft}>{t('range.clear.label')}</Button>
        {/snippet}
      </FieldRow>
      {#if lengthText}
        <!-- 값이 바뀔 때마다 읽으면 시끄러워 aria-live를 두지 않는다 -->
        <p class="range-length">{lengthText}</p>
      {/if}
      {#if draftErr}
        <div class="range-error">
          <Notice id={errorId} variant="inline" tone="danger">{errorText}</Notice>
        </div>
      {/if}
    </div>
  </section>
  </div>
</Sheet>

<style>
  /* 시트(.fullsheet, ui.css)는 세로 flex다: 머리 줄은 늘 보이고(스크롤되지 않는다) 몸통만 스크롤된다 */
  .head {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    padding: var(--space-8) var(--space-16);
    background: var(--surface);
    border-bottom: 1px solid var(--separator);
  }
  .body {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .titles {
    min-width: 0;
    flex: 1 1 auto;
  }
  .title {
    margin: 0;
    font-size: var(--text-title);
    line-height: var(--leading-title);
    font-weight: var(--weight-strong);
  }
  /* 부제는 어느 영상인지 말하는 유일한 글자라 --fg-muted가 아니다(foundations §3). 한 줄 말줄임, 좁으면 두 줄까지 */
  .context {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sibling);
  }
  /* 모니터: 남는 높이를 가져가고, 모자라면 레이어가 스크롤된다. 바닥 높이는 monitorSize가 inline min-height로 준다 */
  .monitor {
    flex: 1 1 0;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-16) var(--space-16) var(--space-8);
  }
  .videobox {
    flex: none;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-control);
    background: var(--surface-2);
    overflow: hidden;
  }
  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    overflow: auto;
  }
  .player {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: var(--surface-2);
  }
  .controls {
    flex: none;
    max-width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-8);
    padding: var(--space-8) 0;
  }
  .loop {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
  }
  .panel {
    flex: none;
    padding: var(--space-8) var(--space-16) var(--space-16);
    background: var(--surface);
    border-top: 1px solid var(--separator);
  }
  .panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-8);
  }
  .panel-title {
    margin: 0;
    font-size: var(--text-body);
    line-height: var(--leading-body);
    font-weight: var(--weight-strong);
  }
  .note {
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--fg-muted);
  }
  /* 손잡이의 누름 영역(::before, --hit-min)이 막대 가장자리 밖으로 반쯤 나온다: 몸통이 가로로 스크롤되지 않게 가장자리에서 안쪽으로 들인다 */
  .timeline {
    margin-top: var(--space-8);
    padding-inline: var(--space-8);
  }
  .range {
    margin-top: var(--space-12);
  }
  /* 시작 묶음과 끝 묶음은 좁은 폭에서 두 줄로 접힌다(PVU-5 V23) */
  .groups {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-sibling);
    min-width: 0;
  }
  .group {
    flex: 0 1 auto;
    max-width: 100%;
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
  }
  .range-length {
    margin: var(--space-4) 0 0;
    color: var(--fg-muted);
  }
  /* 줄 바꿈 판정은 min-width 기준(basis 0)이라 5글자 폭으로 한 줄에 들고, 남는 만큼 6글자까지 늘어난다 */
  .clock {
    flex: 1 1 0;
    min-width: calc(5 * var(--text-body));
    max-width: calc(6 * var(--text-body));
  }
  .range-error {
    margin-top: var(--space-4);
  }
  .line {
    margin: 0;
  }
  @media (forced-colors: active) {
    .videobox {
      border: 1px solid CanvasText;
    }
  }
</style>
