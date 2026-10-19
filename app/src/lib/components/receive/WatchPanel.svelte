<script lang="ts">
  // 받기 전 미리보기 줄(preview.md PV14, system/components.md WatchPanel). 카드 안 `Disclosure inline`이고 기본 접힘이다.
  // 펼칠 때 `watch_open`을 부르고(자동재생 없음, preload=metadata, 네이티브 controls), 접거나 카드가 사라지면 `watch_close`를 부른다.
  // `src`는 Rust가 만든 `watch:` 주소뿐이고 서명 주소·토큰은 프런트에 오지 않는다. 상태는 closed·opening·ready·failed 넷.
  import { onDestroy } from 'svelte';
  import * as api from '../../api';
  import type { AppError, ResolvedDto } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';
  import Disclosure from '../ui/Disclosure.svelte';
  import Notice from '../ui/Notice.svelte';

  interface Props {
    view: ResolvedDto;
  }

  let { view }: Props = $props();

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

  const gateCopy = $derived(gateError ? errorCopy(gateError, { place: 'resolve' }) : null);

  /** 이 웹뷰가 mp4를 읽을 수 있는가(없으면 src를 달지 않고 곧바로 실패) */
  function canPlayMp4(): boolean {
    return document.createElement('video').canPlayType('video/mp4') !== '';
  }

  function closeSession() {
    const id = sessionId;
    sessionId = null;
    if (id) void api.watchClose(id).catch(() => {});
  }

  async function openSession() {
    const mine = ++attempt;
    closeSession();
    gateError = null;
    src = '';
    phase = 'opening';
    try {
      const dto = await api.watchOpen(view.url, view.content);
      if (mine !== attempt) {
        // 그 사이 접었거나 다시 열었다: 늦게 온 세션은 바로 닫는다
        void api.watchClose(dto.id).catch(() => {});
        return;
      }
      if (dto.kind !== 'mp4' || !canPlayMp4()) {
        // 통짜 mp4만 그린다(HLS는 PV-6). 낯선 종류나 읽을 수 없는 웹뷰면 src를 달지 않고 세션을 닫는다
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
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        class="player"
        controls
        preload="metadata"
        playsinline
        {src}
        aria-label={t('watch.player.a11y', { title: view.meta.title })}
        onerror={onvideoerror}
      ></video>
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
