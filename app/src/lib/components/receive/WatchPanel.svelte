<script lang="ts">
  // 받기 전 미리보기 섹션(preview.md PV14, preview-ux2 PS5~PS8, system/components.md WatchPanel). 일반 VOD·클립(통짜 mp4) 카드 안 `Disclosure inline` 하나이고 기본 펼침이다.
  // 빠른 다시보기는 구간 편집 화면(RangeEditor, D67)이 대신하므로 여기에는 구간 기능이 없다(range-editor.md RE14).
  // 열림은 앱 메모리 `ui.previewOpen`이 기억한다(PS8). 펼쳐도 표지 자리(.stage)와 [영상 보기]만 보이고 요청은 없다. 그 단추를 눌렀을 때 `watch_open`을 부르고(preload=metadata, 네이티브 controls,
  // 준비되면 `play()`를 한 번 시도), 접거나 카드가 사라지면 `watch_close`를 부른다.
  // `src`는 Rust가 만든 `watch:` 주소뿐이고 서명 주소·토큰은 프런트에 오지 않는다. 상태는 closed·idle·opening·ready·failed 다섯.
  // HLS 종류가 오면(드물다) hls.js light를 동적으로 불러(PV9) MSE로 붙인다. 못 쓰면 네이티브 m3u8, 그것도 없으면 실패(PV16).
  import { onDestroy } from 'svelte';
  import * as api from '../../api';
  import type { ResolvedDto } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { ui } from '../../stores/ui.svelte';
  import Button from '../ui/Button.svelte';
  import Disclosure from '../ui/Disclosure.svelte';
  import Notice from '../ui/Notice.svelte';
  import { WatchSession } from './watchSession.svelte';

  interface Props {
    view: ResolvedDto;
  }

  let { view }: Props = $props();

  /** 이 섹션의 뿌리와 [영상 보기] 단추(포커스 판단용) */
  let rootEl: HTMLDivElement | null = $state(null);
  let startEl: HTMLButtonElement | null = $state(null);
  let videoEl: HTMLVideoElement | null = $state(null);

  /** 포커스가 [영상 보기] 단추나 body에 있는가(그 사이 다른 곳으로 옮겨 간 사용자를 끌어내지 않는다, PS6) */
  function focusIsFree(): boolean {
    const a = document.activeElement;
    return !a || a === document.body || a === startEl;
  }

  /** 줄 머리(summary)로 포커스를 옮긴다(포커스 있던 요소가 사라져 body로 떨어지지 않게) */
  function focusSummary() {
    rootEl?.querySelector<HTMLElement>('summary')?.focus();
  }

  function startPlay() {
    const v = videoEl;
    if (!v) return;
    try {
      // 웹뷰가 재생을 거부해도 조용히 넘어간다(controls가 남는다)
      void Promise.resolve(v.play()).catch(() => {});
    } catch {
      // 같다
    }
  }

  // 세션 수명은 watchSession이 맡는다. 여기서는 포커스 판단만 콜백으로 준다
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
  });

  const gateCopy = $derived(session.gateError ? errorCopy(session.gateError, { place: 'resolve' }) : null);

  function onchange(next: boolean) {
    if (next) session.expand();
    else session.collapse();
  }

  function openInChzzk() {
    void api.openContentPage(view.content).catch(() => {});
  }

  onDestroy(() => session.destroy());
</script>

<div class="watch" bind:this={rootEl}>
  <Disclosure variant="inline" title={t('watch.toggle')} bind:open={ui.previewOpen} {onchange}>
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
      ></video>
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
  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .player {
    object-fit: contain;
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
