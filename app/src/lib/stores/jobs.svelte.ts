// 다운로드 목록 상태(§10 JobsStore). `subscribe_jobs` Channel 하나로 Rust 매니저를 따라간다.
// 상태 판단은 Rust가 하고 여기서는 받은 레코드를 갈아 끼운 뒤(`applyEvent`), 버튼을 command로 잇는다.
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import * as api from '../api';
import type { AppError, JobDto, JobEvent, JobId } from '../bindings';
import { actionLabel, errorCopy } from '../copy/errors';
import { t } from '../copy/ko';
import { formatFileSize, sizeBaseOf } from '../format/bytes';
import { formatCount } from '../format/duration';
import { lastInputWasKeyboard } from '../inputModality';
import {
  groupJobs,
  isClearable,
  isWaitingNetwork,
  jobSpeech,
  nextQueueOrder,
  outputFileName,
  needsStopConfirm,
  receivedBytes,
  removeRoute,
  resumableInterrupted,
  shouldNoticeRecovery,
  spokenPercent,
  statusWord,
  transitionAnnouncement,
  visibleOrder,
  type JobAction,
} from '../jobs';
import { copyReport } from '../report';
import { HIGHLIGHT_MS, RECOVERY_NOTICE_MS } from '../timing';
import { announcer } from './announce.svelte';
import { auth } from './auth.svelte';
import { applyEvent, emptyJobs, fromSnapshot, type JobsState } from './jobs.apply';
import { platform } from './platform.svelte';
import { resolver } from './resolve.svelte';
import { settings } from './settings.svelte';
import { toasts } from './toast.svelte';
import { ui } from './ui.svelte';

// 새로 추가된 항목 강조 시간의 원천은 timing.ts다(patterns.md §1.2)
export { HIGHLIGHT_MS };

/** D8: 녹화 마치기 전 확인. 받은 만큼 저장하고 끝내며 되돌릴 수 없다(지우는 것은 없다) */
export interface StopConfirm {
  id: JobId;
  title: string;
  bytes: number;
}

export interface CancelConfirm {
  id: JobId;
  title: string;
  bytes: number;
  /** 받는 중이면 안전 쪽 라벨이 [계속 받기], 멈춘 작업이면 [그대로 두기](content.md §5.3 D2) */
  running: boolean;
  /** 생방송이면 본문이 "녹화한 부분이 지워진다"로 달라진다(ADR-0025) */
  live: boolean;
}

/** D7: 건너뜀 행의 [덮어쓰고 받기…]가 묻고 있는 작업과 덮어쓸 파일 이름 */
export interface OverwriteConfirm {
  id: JobId;
  name: string;
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
  /** D8: 녹화 마치기 확인 */
  stopConfirm: StopConfirm | null = $state(null);
  /** D7: 덮어쓰고 받기 확인 */
  overwrite: OverwriteConfirm | null = $state(null);
  /**
   * 지연 삭제 중인 작업(patterns.md §4): 되돌리기 토스트가 사는 동안 목록에서만 숨긴다. 토스트가 닫히면
   * (동작 버튼이 아니라) `remove_job`을 부르고, [되돌리기]면 다시 보인다.
   */
  hidden = new SvelteSet<JobId>();
  /** 완료 그룹을 펼쳤는가(`COMPLETED_FOLD_AT`개부터 기본 접힘, README D39) */
  finishedOpen = $state(false);
  /** B1을 이번 실행 동안 닫았는가 */
  bannerDismissed = $state(false);
  /** 연결 대기(`waitingNetwork`)에 들어온 것을 처음 본 시각(ms). 상태 줄의 `{elapsed}`와 회복 판단의 기준(patterns.md §3.2) */
  waitingSince = new SvelteMap<JobId, number>();
  /** 연결 대기에서 막 풀려 회복 줄(`job.recovered.body`)을 `RECOVERY_NOTICE_MS` 동안 보이는 작업 */
  recovered = new SvelteSet<JobId>();
  /** 실패한 작업이 실패한 그때 네이버 로그인 정보를 보냈는가(이 실행에서 실패를 본 작업만). 문구 갈래를 실패 때의 상태로 정한다 */
  cookiesAtFailure = new Map<JobId, boolean>();
  /**
   * 지금 실행이 시작된 그때 네이버 로그인 정보를 보냈는가. 셸은 `queued → running`(manager `start`)에서 클라이언트를 잡아
   * 그 실행 내내 쓰므로 running으로 바뀐 것을 처음 본 때의 설정을 적는다. 실패를 적을 때 이 값을 쓰고, 없으면 지금 설정이다
   */
  #cookiesAtStart = new Map<JobId, boolean>();
  #recoveredTimers = new Map<JobId, ReturnType<typeof setTimeout>>();
  /** 작업마다 마지막으로 읽은(또는 기준으로 둔) 25% 단위. 반응형일 필요가 없다 */
  #spokenStep = new Map<JobId, number>();
  /** [목록에서 보기]·추가 뒤 그 항목으로 포커스를 옮겨 달라는 요청. `n`은 같은 id를 다시 부를 때 바뀐다 */
  focusRequest: { id: JobId; n: number } | null = $state(null);

  groups = $derived(groupJobs([...this.state.jobs.values()].filter((j) => !this.hidden.has(j.id))));
  /** 화면에 그려진 순서(숨긴 항목과 접힌 완료 항목은 없다). 키보드 이동·포커스 복귀의 기준 */
  order = $derived(visibleOrder(this.groups, this.finishedOpen));
  interruptedCount = $derived([...this.state.jobs.values()].filter((j) => j.status === 'interrupted').length);
  /** B1이 이어받을 수 있는 중단 작업 id(다른 채널·채널 모르는 작업은 뺀다, A5) */
  resumableIds = $derived(resumableInterrupted(this.state.jobs.values(), auth.status));
  resumableCount = $derived(this.resumableIds.length);
  /** 받는 중(멈추는 중 포함)·대기 중 작업 수. 로그인 화면의 안내에 쓴다(잠긴 동안에도 대기 작업은 차례로 시작된다, worker.md §11.5) */
  activeCount = $derived(
    [...this.state.jobs.values()].filter((j) => j.status === 'running' || j.status === 'pausing' || j.status === 'queued')
      .length,
  );
  /** "완료 항목 지우기"가 지울 것이 있는가. 받은 `.part`가 남은 건너뜀은 셸이 남긴다(manager `Job::clearable`). */
  hasFinished = $derived([...this.state.jobs.values()].some((j) => !this.hidden.has(j.id) && isClearable(j)));
  /** B1을 보일까: 이어받을 수 있는 중단 작업이 있고 닫지 않았다 */
  showInterruptedBanner = $derived(this.resumableCount > 0 && !this.bannerDismissed);

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
    this.#resetPhase();
    // 구독 전에 이미 돌던 실행: 시작한 때를 모르니 지금 설정으로 둔다(다시 구독이면 앞서 적은 값을 남긴다)
    for (const id of [...this.#cookiesAtStart.keys()]) if (!this.state.jobs.has(id)) this.#cookiesAtStart.delete(id);
    for (const j of this.state.jobs.values()) {
      if (j.status === 'running' && !this.#cookiesAtStart.has(j.id)) this.#cookiesAtStart.set(j.id, settings.cookiesEnabled);
    }
    // 다시 맞춘 스냅샷: 이미 연결 대기인 작업은 지금부터 센다(알림은 없다)
    this.#spokenStep.clear();
    for (const j of this.state.jobs.values()) {
      this.#trackPhase(j, false);
      this.#seedStep(j.id);
    }
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
    this.#dropStaleStopConfirm();
    if (e.type === 'removed') {
      this.#forgetPhase(e.id);
      this.#spokenStep.delete(e.id);
      this.runStartedAt.delete(e.id);
      this.highlight.delete(e.id);
      this.hidden.delete(e.id);
      this.cookiesAtFailure.delete(e.id);
      this.#cookiesAtStart.delete(e.id);
      return;
    }
    if (e.type === 'progress') {
      const j = this.state.jobs.get(e.id);
      if (j) {
        this.#trackPhase(j, true);
        this.#tickPercent(j);
      }
      return;
    }
    if (e.type !== 'added' && e.type !== 'status') return;
    const job = e.job;
    // 끝난 작업은 기준을 버린다: 다시 받으면 25%부터 다시 읽는다
    if (job.status === 'completed' || job.status === 'skipped') this.#spokenStep.delete(job.id);
    if (job.status === 'running' && prev?.status !== 'running') this.#cookiesAtStart.set(job.id, settings.cookiesEnabled);
    else if (job.status === 'queued') this.#cookiesAtStart.delete(job.id); // 다음 실행은 새로 잡는다
    if (job.status === 'failed') {
      if (prev?.status !== 'failed') {
        this.cookiesAtFailure.set(job.id, this.#cookiesAtStart.get(job.id) ?? settings.cookiesEnabled);
      }
    } else this.cookiesAtFailure.delete(job.id);
    this.#trackPhase(this.state.jobs.get(job.id) ?? job, e.type === 'status');
    if (job.status === 'running' && prev?.status !== 'running') {
      this.runStartedAt.set(job.id, Date.now());
      this.#seedStep(job.id);
    }
    if (e.type === 'added') {
      this.highlight.add(job.id);
      setTimeout(() => this.highlight.delete(job.id), HIGHLIGHT_MS);
      return;
    }
    // 완료는 상태가 완료로 바뀌는 순간만(복원된 완료 항목·스냅샷은 알리지 않는다, Rust `completed_title`과 같다).
    // 1차 표시는 행 상태이고(토스트는 토스트 store가 상주 영역으로 읽는다, ADR-0033), 토스트는 홈이 아닌 화면에서 창이 활성일 때만이다. 창이 비활성이면 OS 알림이 알린다
    // (Rust `should_notify`). 홈에서는 토스트가 없는 대신 라이브 영역이 한 줄 읽는다(patterns.md §1.1-1).
    if (job.status === 'completed' && prev?.status !== 'completed') {
      if (ui.view !== 'home' && ui.windowFocused) toasts.push(t('toast.completed', { title: job.title }), 'success');
      else announcer.say(t('a11y.jobStatus', { title: job.title, status: t('job.status.completed') }));
      return;
    }
    const say = transitionAnnouncement(prev, job);
    if (say) announcer.say(say);
  }

  /** 25% 틱의 기준을 지금 바닥으로 둔다(읽지 않는다) */
  #seedStep(id: JobId) {
    // 이어받기는 셸이 queued(퍼센트 바닥을 지운다)를 거쳐 running으로 오므로 이미 읽은 단위를 낮추지 않는다
    const floor = spokenPercent(this.state.percent.get(id)) ?? 0;
    this.#spokenStep.set(id, Math.max(floor, this.#spokenStep.get(id) ?? 0));
  }

  /**
   * 진행 25% 단위 낭독(patterns.md P-9, platform.md §12.2). 받는 중(`downloading`)일 때 단위를 처음 넘으면 polite 한 번.
   * 문장은 행 접근 이름과 같다(`jobSpeech`). 바닥(`state.percent`, P-4)을 쓰므로 값이 줄었다 다시 올라도 다시 읽지 않는다.
   * 한계: `announcer.say`는 프레임 안 마지막 문장만 남아 같은 프레임의 다른 polite 낭독과 겹치면 하나가 빠진다
   */
  #tickPercent(job: JobDto) {
    const p = this.state.progress.get(job.id);
    if (job.status !== 'running' || p?.phase !== 'downloading') return;
    // 포커스가 행(article) 자체에 있으면 25%마다 그 접근 이름이 같은 문장으로 바뀌어 보조 기술이 알리므로 틱은 건너뛴다
    // (이중 낭독 방지, ADR-0033). 행 안의 버튼에 포커스가 있으면 바뀌는 것은 조상의 이름뿐이라 알리지 않으므로 읽는다
    const skipSay = document.activeElement?.getAttribute('data-job-id') === String(job.id);
    const step = spokenPercent(this.state.percent.get(job.id));
    if (step == null || step <= (this.#spokenStep.get(job.id) ?? 0)) return;
    // 건너뛴 경우에도 단위를 올린다: 그 단위는 행 이름이 이미 알렸고, 올리지 않으면 포커스가 떠난 뒤 지난 단위를 늦게 읽는다
    this.#spokenStep.set(job.id, step);
    if (skipSay) return;
    announcer.say(jobSpeech(job.title, statusWord(job, p), step));
  }

  /**
   * 연결 대기 진입·이탈 추적(patterns.md §3.2·§1.2). 진입은 처음 본 시각을 적고 `polite`로 한 번 알린다.
   * 이탈은 `RECOVERY_SILENT_MS` 넘게 기다렸고 계속 받는 중이면 회복 줄을 `RECOVERY_NOTICE_MS` 동안 보인다.
   * 일시정지·실패·취소로 벗어난 것은 회복이 아니다.
   */
  #trackPhase(job: JobDto, announce: boolean) {
    const waiting = isWaitingNetwork(job, this.state.progress.get(job.id));
    const since = this.waitingSince.get(job.id);
    const now = Date.now();
    if (waiting && since === undefined) {
      this.waitingSince.set(job.id, now);
      if (announce) {
        announcer.say(
          t('a11y.jobStatus', { title: job.title, status: statusWord(job, this.state.progress.get(job.id)) }),
        );
      }
    } else if (!waiting && since !== undefined) {
      this.waitingSince.delete(job.id);
      if (job.status === 'running' && shouldNoticeRecovery(now - since)) this.#showRecovered(job.id);
    }
    if (job.status !== 'running') this.#clearRecovered(job.id);
  }

  #showRecovered(id: JobId) {
    this.#clearRecovered(id);
    this.recovered.add(id);
    this.#recoveredTimers.set(
      id,
      setTimeout(() => {
        this.recovered.delete(id);
        this.#recoveredTimers.delete(id);
      }, RECOVERY_NOTICE_MS),
    );
  }

  #clearRecovered(id: JobId) {
    const timer = this.#recoveredTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.#recoveredTimers.delete(id);
    this.recovered.delete(id);
  }

  #forgetPhase(id: JobId) {
    this.waitingSince.delete(id);
    this.#clearRecovered(id);
  }

  #resetPhase() {
    for (const id of [...this.waitingSince.keys()]) this.#forgetPhase(id);
    for (const id of [...this.recovered]) this.#clearRecovered(id);
  }

  /** 항목으로 포커스를 옮겨 달라고 목록에 알린다 */
  reveal(id: JobId) {
    this.focusRequest = { id, n: ++this.#focusN };
  }

  get(id: JobId): JobDto | undefined {
    return this.state.jobs.get(id);
  }

  /** 행의 버튼·단축키 하나. [덮어쓰고 받기…]만 D7을 거치고 나머지는 `act`다 */
  request(id: JobId, action: JobAction): Promise<void> {
    const job = this.state.jobs.get(id);
    if (job && action === 'overwrite') {
      this.overwrite = { id, name: outputFileName(job.output) };
      return Promise.resolve();
    }
    return this.act(id, action);
  }

  async confirmOverwrite() {
    const o = this.overwrite;
    this.overwrite = null;
    if (o) await this.act(o.id, 'overwrite');
  }

  cancelOverwrite() {
    this.overwrite = null;
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
        case 'stop':
          // 생방송: 취소가 아니라 받은 만큼 마무리한다. 받은 것이 있으면 되돌릴 수 없어 D8로 먼저 묻는다
          if (needsStopConfirm(job, this.state.progress.get(id))) {
            this.stopConfirm = { id, title: job.title, bytes: receivedBytes(job, this.state.progress.get(id)) };
          } else {
            await api.stopJob(id);
          }
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
          try {
            await api.openOutput(id);
          } catch (e) {
            // 파일이 없으면 그 작업의 폴더를 여는 버튼을 토스트에 단다(§9 `fileMissing` T, 43(가))
            this.#toastError(e as AppError, id);
          }
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
        case 'recordAgain':
        case 'reresolve':
          // 그 주소를 입력줄에 넣고 다시 불러온다(§6.3). 재시작으로 끝난 녹화는 카드의 [받기]로 새 녹화를 시작한다(app.md 82).
          // 옛 항목은 사용자가 지운다
          ui.goHome();
          void resolver.load(job.url);
          ui.urlTarget?.focus();
          break;
        case 'openCookieSettings':
        case 'reenterCookies':
          ui.goSettings({ cookies: true });
          break;
        case 'enableCookies':
          ui.goSettings({ cookies: 'switch' });
          break;
        case 'showTitle':
        case 'showDetail':
          // 행이 스스로 펼친다(셸에 보낼 일이 없다)
          break;
      }
    } catch (e) {
      this.#toastError(e as AppError);
    }
  }

  /**
   * 취소·지우기(`removeRoute`): 받은 부분(`.part`)이 있으면 크기와 무관하게 D2로 묻고, 끝난 항목은 숨기고
   * 되돌리기 토스트를 준 뒤 닫힐 때 지우고, 대기·준비 중은 바로 지운다.
   */
  requestRemove(job: JobDto) {
    const p = this.state.progress.get(job.id);
    switch (removeRoute(job, p)) {
      case 'confirm':
        this.confirm = {
          id: job.id,
          title: job.title,
          bytes: receivedBytes(job, p),
          running: job.status === 'running' || job.status === 'pausing',
          live: job.playbackKind === 'live',
        };
        return;
      case 'defer':
        this.#deferRemove([job.id], t('toast.removed'));
        return;
      case 'now':
        void this.#remove(job.id);
    }
  }

  async confirmRemove() {
    const c = this.confirm;
    this.confirm = null;
    if (c) await this.#remove(c.id);
  }

  cancelConfirm() {
    this.confirm = null;
  }

  async confirmStop() {
    const c = this.stopConfirm;
    this.stopConfirm = null;
    if (!c) return;
    try {
      await api.stopJob(c.id);
    } catch (e) {
      this.#toastError(e as AppError);
    }
  }

  cancelStopConfirm() {
    this.stopConfirm = null;
  }

  /** D8이 열린 사이 그 녹화가 받는 중이 아니게 됐거나(방송이 끝나 완료·끊김) 사라지면 닫는다: 확인해도 마칠 것이 없다 */
  #dropStaleStopConfirm() {
    const c = this.stopConfirm;
    if (!c) return;
    const status = this.state.jobs.get(c.id)?.status;
    if (status !== 'running' && status !== 'pausing') this.stopConfirm = null;
  }

  /** D8 본문의 크기 */
  get stopConfirmSize(): string {
    return this.stopConfirm ? formatFileSize(this.stopConfirm.bytes, sizeBaseOf(platform.os)) : '';
  }

  /** D2 본문의 크기 */
  get confirmSize(): string {
    return this.confirm ? formatFileSize(this.confirm.bytes, sizeBaseOf(platform.os)) : '';
  }

  async #remove(id: JobId) {
    try {
      await api.removeJob(id);
    } catch (e) {
      // 지우지 못했으면 숨겨 둔 채 두지 않는다
      this.hidden.delete(id);
      this.#toastError(e as AppError);
    }
  }

  /**
   * 지연 삭제(patterns.md §4): `ids`를 숨기고 [되돌리기] 토스트를 올린다. 토스트가 동작 버튼 말고 어떤 까닭으로든
   * (타이머·[×]·비움) 닫히면 숨긴 id마다 `remove_job`을 부른다. 동작 있는 토스트는 대체되지 않고 줄을 서므로
   * 둘째 지우기가 와도 첫 삭제는 먼저 확정되지 않는다. 마지막 입력이 키보드였으면 토스트를 닫을 때까지 둔다
   * (WCAG 2.2.1·2.1.1, ADR-0033): 닫힐 때 확정하는 규칙은 같고, [되돌리기]·Mod+Z·[×]가 닫는 길이다.
   */
  #deferRemove(ids: readonly JobId[], message: string) {
    for (const id of ids) this.hidden.add(id);
    toasts.push(message, 'info', {
      undo: true,
      sticky: lastInputWasKeyboard(),
      action: {
        label: t('action.undo'),
        run: () => {
          for (const id of ids) this.hidden.delete(id);
        },
      },
      onclose: (reason) => {
        if (reason === 'action') return;
        // 종료 전 비움(CloseGuard)이 기다릴 수 있게 Promise를 돌려준다(`#remove`는 실패를 스스로 처리해 거부하지 않는다)
        return Promise.all(ids.map((id) => this.#remove(id)));
      },
    });
  }

  /**
   * [완료 항목 지우기]: 그때의 완료·건너뜀 id 전부를 숨기고 되돌리기 토스트를 준다. 닫힐 때 숨긴 id마다
   * `remove_job`을 부른다(`clear_finished`는 그 사이에 끝난 작업까지 지우므로 부르지 않는다).
   */
  clearFinished() {
    const ids = [...this.state.jobs.values()].filter((j) => !this.hidden.has(j.id) && isClearable(j)).map((j) => j.id);
    if (ids.length === 0) return;
    this.#deferRemove(ids, t('toast.removedMany', { n: formatCount(ids.length) }));
  }

  /**
   * B1 "모두 이어받기": 이어받을 수 있는 중단 작업을 id 순으로 하나씩 다시 줄 세운다(§4, 프런트가 반복 호출).
   * 하나가 거부돼도(`duplicateOutput` 등) 나머지는 계속한다.
   */
  async resumeAllInterrupted() {
    for (const id of this.resumableIds) {
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
      toasts.push(t('action.copied'), 'copied');
    } catch {
      toasts.push(t('toast.copyFailed'), 'danger');
    }
  }

  /**
   * 오류 토스트. `jobId`를 주면 문구의 `openFolder` 동작을 그 작업의 폴더 열기 버튼으로 단다.
   * 토스트에는 오류 제목만 보인다: 코어 원문·경로(`detail`)는 L1 "자세히"에서만 보이고 토스트에는 없다(content.md §2·§9).
   */
  #toastError(err: AppError, jobId?: JobId) {
    const c = errorCopy(err, { place: 'other', cookiesEnabled: settings.cookiesEnabled, naverCookiesSaved: settings.naverCookiesSaved });
    const text = c.title;
    const action =
      jobId != null && c.actions.includes('openFolder')
        ? {
            label: actionLabel('openFolder', platform.os),
            run: () => void api.revealOutput(jobId).catch((e: AppError) => this.#toastError(e)),
          }
        : undefined;
    toasts.push(text, 'danger', { action });
  }
}

export const jobs = new JobsStore();
