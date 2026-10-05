// 다운로드 목록 상태(§10 JobsStore). `subscribe_jobs` Channel 하나로 Rust 매니저를 따라간다.
// 상태 판단은 Rust가 하고 여기서는 받은 레코드를 갈아 끼운 뒤(`applyEvent`), 버튼을 command로 잇는다.
import { SvelteSet } from 'svelte/reactivity';
import * as api from '../api';
import type { AppError, JobDto, JobEvent, JobId } from '../bindings';
import { errorCopy } from '../copy/errors';
import { t } from '../copy/ko';
import { formatBytes } from '../format/bytes';
import {
  groupJobs,
  needsCancelConfirm,
  nextQueueOrder,
  receivedBytes,
  transitionAnnouncement,
  visibleOrder,
  type JobAction,
} from '../jobs';
import { copyReport } from '../report';
import { announcer } from './announce.svelte';
import { applyEvent, emptyJobs, fromSnapshot, type JobsState } from './jobs.apply';
import { resolver } from './resolve.svelte';
import { settings } from './settings.svelte';
import { toasts } from './toast.svelte';
import { ui } from './ui.svelte';

/** 새로 추가된 항목 강조 시간(ui-visual §4 `--dur-highlight`) */
export const HIGHLIGHT_MS = 1000;

export interface CancelConfirm {
  id: JobId;
  title: string;
  bytes: number;
}

export class JobsStore {
  state: JobsState = $state.raw(emptyJobs());
  /** 매니저의 대기 줄 순서를 따라간 것(`nextQueueOrder`) */
  queueOrder: JobId[] = $state.raw([]);
  /** 스냅샷을 받았는가. 받기 전에는 빈 상태 문구를 띄우지 않는다 */
  ready = $state(false);
  /** 방금 추가된 항목(1초 강조) */
  highlight = new SvelteSet<JobId>();
  /** 이번에 받기 시작한 시각(ms). "이어받음" 표시가 10초만 보이게 한다 */
  runStartedAt = new Map<JobId, number>();
  /** D2: 받은 부분을 지우기 전 확인 */
  confirm: CancelConfirm | null = $state(null);
  /** B1을 이번 실행 동안 닫았는가 */
  bannerDismissed = $state(false);
  /** [목록에서 보기]·추가 뒤 그 항목으로 포커스를 옮겨 달라는 요청. `n`은 같은 id를 다시 부를 때 바뀐다 */
  focusRequest: { id: JobId; n: number } | null = $state(null);

  groups = $derived(groupJobs(this.state.jobs.values()));
  order = $derived(visibleOrder(this.groups));
  interruptedCount = $derived([...this.state.jobs.values()].filter((j) => j.status === 'interrupted').length);
  hasFinished = $derived([...this.state.jobs.values()].some((j) => j.status === 'completed' || j.status === 'skipped'));
  /** B1을 보일까: 중단된 작업이 있고 닫지 않았다 */
  showInterruptedBanner = $derived(this.interruptedCount > 0 && !this.bannerDismissed);

  #gen = 0;
  #focusN = 0;

  /**
   * 구독한다(앱 시작, 웹뷰 새로고침 뒤, 다시 맞출 때). 구독자를 이 Channel로 바꾸고 스냅샷으로 전부 바꾼다.
   * Rust는 구독 교체와 스냅샷을 같은 잠금에서 하므로 새 Channel의 이벤트는 모두 스냅샷 뒤의 일이다. 다만
   * `invoke` 응답보다 Channel 메시지가 먼저 도착할 수 있어, 스냅샷이 올 때까지 모아 두었다가 순서대로 반영한다.
   * 다시 구독하면 앞 Channel에 늦게 온 메시지는 버린다.
   */
  async start(): Promise<void> {
    const gen = ++this.#gen;
    let early: JobEvent[] | null = [];
    const channel = new api.Channel<JobEvent>();
    channel.onmessage = (e: JobEvent) => {
      if (gen !== this.#gen) return;
      if (early) early.push(e);
      else this.#apply(e);
    };
    let snapshot: JobDto[];
    try {
      snapshot = await api.subscribeJobs(channel);
    } catch (e) {
      if (gen === this.#gen) this.#toastError(e as AppError);
      return;
    }
    if (gen !== this.#gen) return;
    this.state = fromSnapshot(snapshot);
    this.queueOrder = nextQueueOrder([], this.state.jobs);
    this.ready = true;
    const pending = early;
    early = null;
    for (const e of pending) this.#apply(e);
  }

  /** 이벤트 하나(테스트가 직접 부르기도 한다) */
  #apply(e: JobEvent) {
    const prev = e.type === 'added' || e.type === 'status' ? this.state.jobs.get(e.job.id) : undefined;
    this.state = applyEvent(this.state, e);
    this.queueOrder = nextQueueOrder(this.queueOrder, this.state.jobs);
    if (e.type === 'removed') {
      this.runStartedAt.delete(e.id);
      this.highlight.delete(e.id);
      return;
    }
    if (e.type !== 'added' && e.type !== 'status') return;
    const job = e.job;
    if (job.status === 'running' && prev?.status !== 'running') this.runStartedAt.set(job.id, Date.now());
    if (e.type === 'added') {
      this.highlight.add(job.id);
      setTimeout(() => this.highlight.delete(job.id), HIGHLIGHT_MS);
      return;
    }
    // 완료 토스트는 상태가 완료로 바뀌는 순간만(복원된 완료 항목·스냅샷은 알리지 않는다, Rust `completed_title`과 같다)
    if (job.status === 'completed' && prev?.status !== 'completed') {
      toasts.push(t('toast.completed', { title: job.title }), 'success');
      return;
    }
    const say = transitionAnnouncement(prev, job);
    if (say) announcer.say(say);
  }

  /** 항목으로 포커스를 옮겨 달라고 목록에 알린다 */
  reveal(id: JobId) {
    this.focusRequest = { id, n: ++this.#focusN };
  }

  get(id: JobId): JobDto | undefined {
    return this.state.jobs.get(id);
  }

  /** 버튼·단축키 하나. 실패는 토스트로 알린다(동작이 실패해도 목록은 Rust 이벤트로 맞는다). */
  async act(id: JobId, action: JobAction): Promise<void> {
    const job = this.state.jobs.get(id);
    if (!job) return;
    try {
      switch (action) {
        case 'pause':
          await api.pauseJob(id);
          break;
        case 'resume':
        case 'retry':
        case 'overwrite':
          // `.part`가 있으면 이어받기, 없으면 다시 시도. 건너뜀은 매니저가 덮어쓰기로 바꾼다(§4)
          await api.resumeJob(id, false);
          break;
        case 'restartFresh':
          await api.resumeJob(id, true);
          break;
        case 'cancel':
        case 'remove':
          this.requestRemove(job);
          break;
        case 'openFile':
          await api.openOutput(id);
          break;
        case 'openFolder':
          await api.revealOutput(id);
          break;
        case 'copyUrl':
          await this.#copy(job.url);
          break;
        case 'copyReport':
          if (job.error) await copyReport(job.error, settings.info);
          break;
        case 'reresolve':
          // 그 주소를 입력줄에 넣고 다시 불러온다(§6.3). 옛 항목은 사용자가 지운다
          ui.goHome();
          void resolver.load(job.url);
          ui.urlTarget?.focus();
          break;
        case 'openCookieSettings':
        case 'reenterCookies':
          ui.goSettings({ cookies: true });
          break;
      }
    } catch (e) {
      this.#toastError(e as AppError);
    }
  }

  /** 취소·지우기: 받은 부분이 512 MiB를 넘으면 D2로 묻는다 */
  requestRemove(job: JobDto) {
    const p = this.state.progress.get(job.id);
    if (needsCancelConfirm(job, p)) {
      this.confirm = { id: job.id, title: job.title, bytes: receivedBytes(job, p) };
      return;
    }
    void this.#remove(job.id);
  }

  async confirmRemove() {
    const c = this.confirm;
    this.confirm = null;
    if (c) await this.#remove(c.id);
  }

  cancelConfirm() {
    this.confirm = null;
  }

  /** D2 본문의 크기 */
  get confirmSize(): string {
    return this.confirm ? formatBytes(this.confirm.bytes) : '';
  }

  async #remove(id: JobId) {
    try {
      await api.removeJob(id);
    } catch (e) {
      this.#toastError(e as AppError);
    }
  }

  async clearFinished() {
    try {
      await api.clearFinished();
    } catch (e) {
      this.#toastError(e as AppError);
    }
  }

  /**
   * B1 "모두 이어받기": 중단된 작업을 id 순으로 하나씩 다시 줄 세운다(§4, 프런트가 반복 호출).
   * 하나가 거부돼도(`duplicateOutput` 등) 나머지는 계속한다.
   */
  async resumeAllInterrupted() {
    const ids = [...this.state.jobs.values()]
      .filter((j) => j.status === 'interrupted')
      .map((j) => j.id)
      .sort((a, b) => a - b);
    for (const id of ids) {
      try {
        await api.resumeJob(id, false);
      } catch (e) {
        this.#toastError(e as AppError);
      }
    }
  }

  dismissBanner() {
    this.bannerDismissed = true;
  }

  async #copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.push(t('toast.copied'), 'copied');
    } catch {
      toasts.push(t('toast.copyFailed'), 'danger');
    }
  }

  #toastError(err: AppError) {
    const c = errorCopy(err, { place: 'other', cookiesEnabled: settings.cookiesEnabled });
    const text = c.detail ? `${c.title} (${c.detail})` : c.title;
    toasts.push(text, 'danger');
  }
}

export const jobs = new JobsStore();
