<script lang="ts">
  // 받기 전 미리보기 줄(preview.md PV14, system/components.md WatchPanel). 카드 안 `Disclosure inline`이고 기본 접힘이다.
  // 펼칠 때 `watch_open`을 부르고(자동재생 없음, preload=metadata, 네이티브 controls), 접거나 카드가 사라지면 `watch_close`를 부른다.
  // `src`는 Rust가 만든 `watch:` 주소뿐이고 서명 주소·토큰은 프런트에 오지 않는다. 상태는 closed·opening·ready·failed 넷.
  // 빠른 다시보기(HLS)는 hls.js light를 동적으로 불러(PV9) MSE로 붙인다. 못 쓰면 네이티브 m3u8, 그것도 없으면 실패(PV16).
  // 구간 찍기(PV17): `markable`(빠른 다시보기 카드)이고 hls.js로 붙었을 때만 재생기 아래 [시작 찍기]·[끝 찍기]를 보인다.
  // 네이티브 m3u8 대체 경로는 시간축이 다를 수 있어 그리지 않는다. 누른 순간의 floor(currentTime)초를 `onmark`로 넘길 뿐이다.
  import { onDestroy, tick } from 'svelte';
  import type Hls from 'hls.js/light';
  import * as api from '../../api';
  import type { AppError, ResolvedDto, WatchOpenDto } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';
  import Disclosure from '../ui/Disclosure.svelte';
  import Notice from '../ui/Notice.svelte';

  interface Props {
    view: ResolvedDto;
    /** 빠른 다시보기 카드: hls.js 경로에서 찍기 버튼을 보인다 */
    markable?: boolean;
    /** 카드가 받기 요청 중이면 찍기를 막는다 */
    disabled?: boolean;
    /** 찍은 시각(초, 내림)을 카드의 구간 칸으로 보낸다 */
    onmark?: (field: 'start' | 'end', secs: number) => void;
  }

  let { view, markable = false, disabled = false, onmark }: Props = $props();

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

  const gateCopy = $derived(gateError ? errorCopy(gateError, { place: 'resolve' }) : null);

  /** 이 웹뷰가 mp4를 읽을 수 있는가(없으면 src를 달지 않고 곧바로 실패) */
  function canPlayMp4(): boolean {
    return document.createElement('video').canPlayType('video/mp4') !== '';
  }

  /** 이 웹뷰가 m3u8을 네이티브로 읽을 수 있는가(Safari 계열) */
  function canPlayNativeHls(): boolean {
    return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
  }

  function closeSession() {
    // 재생기를 먼저 떼야 세션을 닫은 뒤 세그먼트를 더 요청하지 않는다
    hls?.destroy();
    hls = null;
    usingHls = false;
    metaReady = false;
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
    if (!videoEl || !metaReady) return;
    onmark?.(field, Math.floor(videoEl.currentTime));
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
        bind:this={videoEl}
        src={src || undefined}
        aria-label={t('watch.player.a11y', { title: view.meta.title })}
        onerror={onvideoerror}
        onloadedmetadata={() => (metaReady = true)}
      ></video>
      {#if markable && usingHls}
        <div class="marks">
          <Button size="sm" disabled={disabled || !metaReady} onclick={() => mark('start')}>{t('watch.mark.start')}</Button>
          <Button size="sm" disabled={disabled || !metaReady} onclick={() => mark('end')}>{t('watch.mark.end')}</Button>
        </div>
      {/if}
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
  .marks {
    display: flex;
    gap: var(--space-8);
    margin-top: var(--space-8);
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
