// 미리보기 세션 수명(preview.md PV14, range-editor.md RE-2). WatchPanel에서 떼어 낸 것이고 동작은 그대로다.
// 단계는 closed·idle·opening·ready·failed 다섯. `watch_open`/`watch_close`와 hls.js 붙이기·떼기, 늦게 온 결과 버리기(`#attempt`),
// 포커스 판단을 부르는 쪽에 돌려주는 콜백이 전부다. 세션 ID와 hls 인스턴스는 밖으로 내지 않는다(서명 주소는 프런트에 오지 않는다,
// 밖에 보이는 값은 Rust가 만든 `watch:` 주소 `src`와 단계뿐).
import { tick } from 'svelte';
import type Hls from 'hls.js/light';
import * as api from '../../api';
import type { AppError, ContentRef, WatchOpenDto } from '../../bindings';

export type WatchPhase = 'closed' | 'idle' | 'opening' | 'ready' | 'failed';
/** 받기와 같은 문구로 알리는 게이트 거부(그 밖의 실패는 한 문구, preview.md Q2) */
const GATE_CODES: ReadonlySet<AppError['code']> = new Set(['notLoggedIn', 'notOwnContent', 'ownershipUnknown']);

export interface WatchSessionOptions {
  /** 마운트 때 이미 펼쳐져 있으면 표지 자리(idle)부터다 */
  initialOpen: boolean;
  /** 열 대상(열 때마다 읽는다) */
  target: () => { url: string; content: ContentRef };
  /** 지금 그려진 video(없으면 null) */
  video: () => HTMLVideoElement | null;
  /** 열기 성공(hls.js는 attachMedia 뒤): 화면이 그려진 뒤, 늦은 결과가 아닐 때만. 포커스 이동·재생 시도는 부른 쪽 몫 */
  onready?: () => void;
  /**
   * 실패 뒤(화면이 그려진 뒤, 늦은 결과가 아닐 때만). `videoFocused`는 실패 순간 포커스가 영상에 있었는가.
   * 포커스 복귀 대상(줄 머리)은 부른 쪽이 안다
   */
  onfailed?: (videoFocused: boolean, cause: 'open' | 'video') => void;
  /** 세션을 닫을 때마다(재생 상태·보고한 길이를 되돌린다) */
  onclosed?: () => void;
}

export class WatchSession {
  phase: WatchPhase = $state('closed');
  /** `watch:` 주소(mp4·네이티브 m3u8만, hls.js 경로는 비어 있다) */
  src = $state('');
  /** 게이트 거부로 실패했을 때의 오류(없으면 한 문구) */
  gateError: AppError | null = $state(null);
  /** hls.js로 붙었는가(찍기 버튼의 조건). 닫거나 실패하면 내린다 */
  usingHls = $state(false);

  /** 지금 열려 있는 세션 ID. 닫을 때 한 번만 쓰고 비운다 */
  #sessionId: string | null = null;
  /** 열기 요청마다 올린다: 접거나 다시 열면 늦게 온 결과를 버린다 */
  #attempt = 0;
  /** hls.js가 붙은 video(HLS 종류만) */
  #hls: Hls | null = null;
  readonly #opts: WatchSessionOptions;

  constructor(opts: WatchSessionOptions) {
    this.#opts = opts;
    this.phase = opts.initialOpen ? 'idle' : 'closed';
  }

  /** 펴기: 아무것도 열지 않는다(PS6). [영상 보기]를 눌러야 세션을 연다 */
  expand() {
    this.phase = 'idle';
  }

  /** 접기: 늦게 올 결과를 버리고 세션을 닫는다 */
  collapse() {
    this.#attempt += 1;
    this.#close();
    this.src = '';
    this.gateError = null;
    this.phase = 'idle';
  }

  /** 카드가 사라질 때 */
  destroy() {
    this.#attempt += 1;
    this.#close();
  }

  /** 영상이 오류를 냈다(서명 만료·세션 만료 등). 원인 구분 없이 실패 한 가지(Q2), 낡은 세션은 닫는다 */
  videoFailed() {
    // 포커스가 영상에 있었는지는 영상이 사라지기 전에 본다
    const v = this.#opts.video();
    const onVideo = !!v && document.activeElement === v;
    this.#attempt += 1;
    const mine = this.#attempt;
    this.#close();
    this.src = '';
    this.phase = 'failed';
    void tick().then(() => {
      if (mine === this.#attempt) this.#opts.onfailed?.(onVideo, 'video');
    });
  }

  async start() {
    const mine = ++this.#attempt;
    this.#close();
    this.gateError = null;
    this.src = '';
    this.phase = 'opening';
    const { url, content } = this.#opts.target();
    try {
      const dto = await api.watchOpen(url, content);
      if (mine !== this.#attempt) {
        // 그 사이 접었거나 다시 열었다: 늦게 온 세션은 바로 닫는다
        void api.watchClose(dto.id).catch(() => {});
        return;
      }
      if (dto.kind === 'hls') {
        await this.#openHls(dto, mine);
        return;
      }
      if (dto.kind !== 'mp4' || !canPlayMp4()) {
        // 낯선 종류나 mp4를 읽을 수 없는 웹뷰면 src를 달지 않고 세션을 닫는다
        void api.watchClose(dto.id).catch(() => {});
        this.#fail(mine);
        return;
      }
      this.#sessionId = dto.id;
      this.src = dto.src;
      this.phase = 'ready';
      void this.#ready(mine);
    } catch (e) {
      if (mine !== this.#attempt) return;
      const err = e as AppError;
      this.gateError = GATE_CODES.has(err.code) ? err : null;
      this.#fail(mine);
    }
  }

  /** 열기 실패 단계로 가고, 그려진 뒤 알린다(알림은 같은 순간 그려지는 Notice가 맡는다) */
  #fail(mine: number) {
    this.phase = 'failed';
    void tick().then(() => {
      if (mine === this.#attempt) this.#opts.onfailed?.(false, 'open');
    });
  }

  /** 열기 성공: 단추가 사라진 뒤(그려진 뒤)의 상태에서 부른 쪽에 넘긴다 */
  async #ready(mine: number) {
    await tick();
    if (mine !== this.#attempt || !this.#opts.video()) return;
    this.#opts.onready?.();
  }

  /** HLS 종류: hls.js(MSE) → 네이티브 m3u8 → 실패 순. 중간에 접거나 다시 열면(`#attempt`가 바뀜) 그 자리에서 손을 뗀다 */
  async #openHls(dto: WatchOpenDto, mine: number) {
    const fail = () => {
      void api.watchClose(dto.id).catch(() => {});
      this.#fail(mine);
    };
    let Ctor: typeof Hls;
    try {
      Ctor = (await import('hls.js/light')).default;
    } catch {
      if (mine === this.#attempt) fail();
      else void api.watchClose(dto.id).catch(() => {});
      return;
    }
    if (mine !== this.#attempt) {
      void api.watchClose(dto.id).catch(() => {});
      return;
    }
    if (!Ctor.isSupported()) {
      if (!canPlayNativeHls()) return fail();
      this.#sessionId = dto.id;
      this.src = dto.src;
      this.phase = 'ready';
      void this.#ready(mine);
      return;
    }
    this.#sessionId = dto.id;
    this.phase = 'ready';
    // video가 그려진 뒤에 붙인다
    await tick();
    const video = this.#opts.video();
    if (mine !== this.#attempt || !video) return;
    // 워커 없음(CSP worker-src를 더하지 않는다), 저지연 끔, 자격 증명 없음(PV9)
    const player = new Ctor({ enableWorker: false, lowLatencyMode: false });
    this.#hls = player;
    this.usingHls = true;
    // 오류는 fatal만 본다: 오류 객체의 url 필드에는 전체 세션 ID가 든 주소가 있어 화면·로그·IPC 어디에도 쓰지 않는다
    player.on(Ctor.Events.ERROR, (_event, data) => {
      if (data.fatal) this.videoFailed();
    });
    player.loadSource(dto.src);
    player.attachMedia(video);
    void this.#ready(mine);
  }

  #close() {
    // 재생기를 먼저 떼야 세션을 닫은 뒤 세그먼트를 더 요청하지 않는다
    this.#hls?.destroy();
    this.#hls = null;
    this.usingHls = false;
    this.#opts.onclosed?.();
    const id = this.#sessionId;
    this.#sessionId = null;
    if (id) void api.watchClose(id).catch(() => {});
  }
}

/** 이 웹뷰가 mp4를 읽을 수 있는가(없으면 src를 달지 않고 곧바로 실패) */
function canPlayMp4(): boolean {
  return document.createElement('video').canPlayType('video/mp4') !== '';
}

/** 이 웹뷰가 m3u8을 네이티브로 읽을 수 있는가(Safari 계열) */
function canPlayNativeHls(): boolean {
  return document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
}
