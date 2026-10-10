// 다운로드 목록(§8.5·§8.11, docs/design/system/patterns.md §2·§3·§14.3)의 판단을 순수 함수로 둔다. 상태 판단은 Rust가 하고,
// 여기서는 받은 레코드로 무엇을 어떻게 보일지만 정한다. 컴포넌트는 표시와 입력만 한다.
import type { AuthStatusDto, JobDto, JobId, JobStatus, Os, ProgressDto } from './bindings';
import { actionLabel, errorCopy, type ActionId } from './copy/errors';
import { t, type CopyKey } from './copy/ko';
import {
  formatEstimate,
  formatFileSize,
  formatPercent,
  formatProgressSize,
  formatSpeed,
  type SizeBase,
} from './format/bytes';
import { formatCount, formatElapsed, formatRemaining, formatSpokenRemaining } from './format/duration';
import type { IconName } from './components/ui/icons';
import { COMPLETED_FOLD_AT, RECOVERY_SILENT_MS, STALE_DAYS } from './timing';
import { localOffsetMin, whenText } from './when';

// ───────────────────────── 그룹·정렬 ─────────────────────────

export type JobGroupId = 'running' | 'queued' | 'stopped' | 'finished';

const GROUP_OF: Record<JobStatus, JobGroupId> = {
  running: 'running',
  pausing: 'running',
  queued: 'queued',
  paused: 'stopped',
  interrupted: 'stopped',
  failed: 'stopped',
  completed: 'finished',
  skipped: 'finished',
};

const GROUP_ORDER: JobGroupId[] = ['running', 'queued', 'stopped', 'finished'];

const GROUP_LABEL: Record<JobGroupId, CopyKey> = {
  running: 'list.group.running',
  queued: 'list.group.queued',
  stopped: 'list.group.stopped',
  finished: 'list.group.finished',
};

export function groupOf(status: JobStatus): JobGroupId {
  return GROUP_OF[status];
}

export interface JobGroup {
  id: JobGroupId;
  /** `받는 중 2` */
  label: string;
  jobs: JobDto[];
  /** 완료 `COMPLETED_FOLD_AT`개부터 접을 수 있다(patterns.md §14.1, README D39) */
  foldable: boolean;
}

/** 접힌 완료 그룹이 머리 아래에 미리 보이는 최신 항목 수 */
export const FOLD_PREVIEW_COUNT = 5;

/** 지금 화면에 그려지는 항목: 접을 수 있는 그룹이 접혀 있으면 최신 `FOLD_PREVIEW_COUNT`개만 */
export function shownJobs(group: JobGroup, open: boolean): JobDto[] {
  return group.foldable && !open ? group.jobs.slice(0, FOLD_PREVIEW_COUNT) : group.jobs;
}

/** 진행 중 → 대기 → 일시정지·중단·실패 → 완료·건너뜀. 같은 그룹 안에서는 최신이 위(§8.5). 빈 그룹은 뺀다. */
export function groupJobs(jobs: Iterable<JobDto>): JobGroup[] {
  const by = new Map<JobGroupId, JobDto[]>();
  for (const j of jobs) {
    const g = groupOf(j.status);
    const list = by.get(g) ?? [];
    list.push(j);
    by.set(g, list);
  }
  const out: JobGroup[] = [];
  for (const id of GROUP_ORDER) {
    const list = by.get(id);
    if (!list?.length) continue;
    list.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
    out.push({
      id,
      label: t(GROUP_LABEL[id], { n: formatCount(list.length) }),
      jobs: list,
      foldable: id === 'finished' && list.length >= COMPLETED_FOLD_AT,
    });
  }
  return out;
}

/** 목록에 보이는 순서대로 펼친 id(키보드 위·아래 이동용). 접힌 완료 그룹은 미리 보이는 항목만 든다 */
export function visibleOrder(groups: readonly JobGroup[], finishedOpen = true): JobId[] {
  return groups.flatMap((g) => shownJobs(g, finishedOpen).map((j) => j.id));
}

// ───────────────────────── 대기 순서 ─────────────────────────

/**
 * 매니저가 다음에 시작할 순서(FIFO, `queued`가 된 순서)를 프런트에서 따라간다. `JobDto`에는 줄 번호가 없고,
 * 다시 줄 선 작업은 id와 순서가 다르다(구현 중 변경 29(나)). 그래서 `queued`가 아니게 된 것은 빼고,
 * 새로 `queued`가 된 것은 맨 뒤에 붙인다. 같은 때 여럿이면(스냅샷) id 순이다.
 */
export function nextQueueOrder(prev: readonly JobId[], jobs: ReadonlyMap<JobId, JobDto>): JobId[] {
  const queued = (id: JobId) => jobs.get(id)?.status === 'queued';
  const kept = prev.filter(queued);
  const seen = new Set(kept);
  const fresh = [...jobs.values()]
    .filter((j) => j.status === 'queued' && !seen.has(j.id))
    .map((j) => j.id)
    .sort((a, b) => a - b);
  const next = [...kept, ...fresh];
  return next.length === prev.length && next.every((id, i) => id === prev[i]) ? (prev as JobId[]) : next;
}

/** 앞에 선 대기 작업 수. 줄에 없으면 0 */
export function queueAhead(order: readonly JobId[], id: JobId): number {
  return Math.max(0, order.indexOf(id));
}

// ───────────────────────── 진행률 ─────────────────────────

/** 받은 바이트: 받는 중이면 마지막 진행률, 멈춘 작업이면 실제 `.part` 크기(§5) */
export function receivedBytes(job: JobDto, progress: ProgressDto | null | undefined): number {
  switch (job.status) {
    case 'running':
    case 'pausing':
      return progress?.bytes ?? job.partialBytes ?? 0;
    case 'paused':
    case 'interrupted':
    case 'failed':
    // 받는 동안 같은 이름의 파일이 생겨 건너뛴 작업은 다 받은 `.part`가 남고, 지우면 그것도 지운다(구현 중 변경 53)
    case 'skipped':
      return job.partialBytes ?? 0;
    default:
      return 0;
  }
}

/** 0~1, 모르면 `null`. HLS는 재생 시간 비율(ETA와 맞춘다), progressive는 바이트 비율(§8.11) */
export function progressFraction(job: JobDto, p: ProgressDto | null | undefined): number | null {
  if (!p) return null;
  if (job.playbackKind === 'liveRewindHls') {
    if (p.mediaSecsDone == null || !p.mediaSecsTotal || p.mediaSecsTotal <= 0) return null;
    return Math.min(1, Math.max(0, p.mediaSecsDone / p.mediaSecsTotal));
  }
  if (!p.totalBytes || p.totalBytes <= 0) return null;
  return Math.min(1, Math.max(0, p.bytes / p.totalBytes));
}

/**
 * 막대 오른쪽에 보일 퍼센트(정수, 내림). 100%는 완료 행에서만 보이므로(P-6) 완료 전에는 99에서 멈춘다:
 * 마무리 중(`finalizing`)에 받은 양이 총량과 같아져도 99%다. 준비 중이거나 총량을 모르면 `null`(P-1).
 */
export function displayPercent(job: JobDto, p: ProgressDto | null | undefined): number | null {
  if (!p || p.phase === 'resolving') return null;
  const f = progressFraction(job, p);
  return f == null ? null : Math.min(99, Math.floor(f * 100));
}

export interface BarView {
  /** 0~100 정수. 모르면 `null`(줄무늬 막대) */
  value: number | null;
  tone: 'accent' | 'muted' | 'danger';
  striped: boolean;
  /** 막대 오른쪽 칸 `58%`. 총량을 모르면 `null`(칸은 비워 두고 폭은 유지한다) */
  percent: string | null;
  /** 스크린 리더 문장: "58퍼센트 받았어요. 약 14분 남아요" */
  valueText: string;
}

/**
 * 진행 막대(patterns.md §3.1 P-2·P-4·P-6, §3.2 표). 받는 중·멈추는 중·멈춘 작업·실패 모두 퍼센트를 가진다.
 * 대기·완료·건너뜀과 진행률이 없는 멈춤·`.part` 없는 실패에는 막대가 없다. 준비 중은 `value = null`(스피너 없음).
 * `floor`는 이 작업이 지금까지 보인 가장 큰 퍼센트다: 코어 값이 줄어도 표시는 뒤로 가지 않는다(P-4).
 */
export function barView(job: JobDto, p: ProgressDto | null | undefined, floor = 0): BarView | null {
  const s = job.status;
  if (s === 'queued' || s === 'completed' || s === 'skipped') return null;
  if ((s === 'paused' || s === 'interrupted' || s === 'failed') && !p) return null;
  if (s === 'failed' && !(job.partialBytes && job.partialBytes > 0)) return null;
  const raw = displayPercent(job, p);
  const value = raw == null ? null : Math.min(99, Math.max(raw, floor));
  const tone: BarView['tone'] = s === 'failed' ? 'danger' : s === 'running' ? 'accent' : 'muted';
  // 낭독 문장은 deck의 `a11y.progress` 하나다(조각을 쉼표로 잇지 않는다). 받는 중에는 남은 시간을, 그 밖에는 상태 낱말을 잇는다
  const remaining = s === 'running' && p?.phase === 'downloading' ? formatSpokenRemaining(p.etaSecs) : statusWord(job, p);
  return {
    value,
    tone,
    striped: s === 'running' && (p?.phase === 'reresolving' || p?.phase === 'waitingNetwork'),
    percent: value == null ? null : formatPercent(value, 100),
    valueText: value == null ? remaining : t('a11y.progress', { percent: value, remaining }),
  };
}

/** 상태를 한 낱말로(스크린 리더·알림) */
export function statusWord(job: JobDto, p: ProgressDto | null | undefined): string {
  switch (job.status) {
    case 'running':
      return t(PHASE_KEY[p?.phase ?? 'resolving']);
    case 'queued':
      return t('job.status.queued');
    case 'pausing':
      return t('job.pausing');
    // 중단(앱 종료·치지직 끊김)도 사용자가 멈춘 것과 같은 말이다: 다시 받으면 이어 받는다
    case 'paused':
    case 'interrupted':
      return t('job.status.paused');
    case 'completed':
      return t('job.status.completed');
    case 'skipped':
      return t('job.status.skipped');
    case 'failed':
      return job.error ? errorCopy(job.error, { place: 'job', partialBytes: job.partialBytes }).title : '';
  }
}

const PHASE_KEY = {
  resolving: 'job.status.resolving',
  downloading: 'job.phase.downloading',
  waitingNetwork: 'job.phase.waitingNetwork',
  reresolving: 'job.phase.reresolving',
  finalizing: 'job.status.finalizing',
} as const satisfies Record<NonNullable<ProgressDto['phase']>, CopyKey>;

// ───────────────────────── 상태 줄·본문 줄 ─────────────────────────

/** 이어받음 표시는 받기를 다시 시작하고 10초 동안만(§8.11) */
export const RESUMED_NOTE_MS = 10_000;

export interface StatusContext {
  /** 줄에서 앞에 선 대기 작업 수 */
  ahead?: number;
  /** 이번에 받기 시작한 시각(ms). 이어받음 표시에 쓴다 */
  runStartedAt?: number | null;
  now?: number;
  /** 크기 진법(Windows 1024, 그 밖 1000, `sizeBaseOf(os)`). 기본 1000 */
  base?: SizeBase;
  /** 사용자 시간대의 UTC 오프셋(분). 기본은 실행 환경(테스트가 고정한다) */
  offsetMin?: number;
  /** 이 작업이 연결 대기(`waitingNetwork`)로 들어온 것을 처음 본 시각(ms). 경과 시간 `{elapsed}`의 기준 */
  waitingSince?: number | null;
}

/** 진행 "받은 양 / 전체"의 두 값. 빠른 다시보기의 전체는 예상치라 `약 …`이다. 전체를 모르면 `total`이 null */
function sizeParts(job: JobDto, p: ProgressDto, base: SizeBase): { received: string; total: string | null } {
  const hls = job.playbackKind === 'liveRewindHls';
  const total = hls ? p.totalBytesEstimate : p.totalBytes;
  if (!total) return formatProgressSize(p.bytes, null, base);
  const shown = formatProgressSize(p.bytes, total, base);
  return hls ? { received: shown.received, total: formatEstimate(total, base) } : shown;
}

/** 받는 중 상태 줄 하나(조각 결합도 deck이 한다, content.md §15.1 `job.running`) */
function runningLine(job: JobDto, p: ProgressDto, base: SizeBase): string {
  const size = sizeParts(job, p, base);
  const vars: Record<string, string | number> = {
    received: size.received,
    total: size.total ?? '',
    speed: formatSpeed(p.speedBps != null && p.speedBps > 0 ? p.speedBps : 0, base),
    remaining: formatRemaining(p.etaSecs),
  };
  const known = size.total != null;
  if (job.playbackKind === 'liveRewindHls' && p.segmentsDone != null && p.segmentsTotal != null) {
    vars.segDone = formatCount(p.segmentsDone);
    vars.segTotal = formatCount(p.segmentsTotal);
    return t(known ? 'job.runningSegmented' : 'job.runningSegmentedNoTotal', vars);
  }
  return t(known ? 'job.running' : 'job.runningNoTotal', vars);
}

/**
 * 상태 줄(patterns.md §3.2): **명사형 조각**만 담는다. 사건 설명은 본문 줄(`bodyKey`)이다. 조각 사이는 ` · `로 잇는다.
 * 실패는 오류 제목이 상태 줄이라 호출부가 `failedCopy`로 그리므로 빈 배열이다.
 */
export function statusParts(job: JobDto, p: ProgressDto | null | undefined, ctx: StatusContext = {}): string[] {
  const base = ctx.base ?? 1000;
  switch (job.status) {
    case 'queued': {
      const n = ctx.ahead ?? 0;
      return [n > 0 ? t('job.queued', { n: formatCount(n) }) : t('job.queuedNext')];
    }
    case 'running': {
      if (!p || p.phase === 'resolving') return [t('job.status.resolving')];
      if (p.phase === 'finalizing') return [t('job.status.finalizing')];
      // 연결 대기: 속도·남은 시간은 의미가 없어 숨기고 경과와 받은 양만 보인다(오류가 아니다, D40)
      if (p.phase === 'waitingNetwork') {
        const now = ctx.now ?? Date.now();
        const since = ctx.waitingSince ?? now;
        return [
          t('job.status.waitingNetwork', {
            elapsed: formatElapsed(Math.max(0, (now - since) / 1000)),
            received: formatFileSize(p.bytes, base),
          }),
        ];
      }
      // 주소를 새로 받는 동안은 속도·남은 시간이 의미가 없다: 상태 조각 하나만 보인다
      const parts = [p.phase === 'reresolving' ? t('job.phase.reresolving') : runningLine(job, p, base)];
      const now = ctx.now ?? Date.now();
      if (p.resumedFrom > 0 && ctx.runStartedAt != null && now - ctx.runStartedAt < RESUMED_NOTE_MS) {
        parts.push(t('job.resumedFrom', { size: formatFileSize(p.resumedFrom, base) }));
      }
      return parts;
    }
    case 'pausing':
      return [t('job.pausing')];
    case 'paused':
    case 'interrupted': {
      const bytes = receivedBytes(job, p);
      return [bytes <= 0 ? t('job.status.paused') : t('job.paused', { bytes: formatFileSize(bytes, base) })];
    }
    case 'completed': {
      if (job.missing) return [t('job.completedMissing')];
      const size = formatFileSize(job.finalBytes ?? 0, base);
      return [
        job.finishedAt != null
          ? t('job.completed', {
              size,
              time: whenText(job.finishedAt, ctx.now ?? Date.now(), ctx.offsetMin ?? localOffsetMin()),
            })
          : t('job.completedNoTime', { size }),
      ];
    }
    case 'skipped':
      return [t('job.status.skipped')];
    case 'failed':
      return [];
  }
}

/** 상태 줄 조각을 ` · `로 잇는다 */
export function statusLine(parts: readonly string[]): string {
  return parts.join(' · ');
}

/**
 * 본문 줄(해요체 한 문장)의 키. 완료인데 파일이 없을 때와 건너뜀에만 있다. 건너뜀은 받은 `.part`가 남았으면
 * (`partialBytes`) 시작 전이 아니라 받는 동안 같은 이름의 파일이 생겨 덮어쓰지 않은 것이다.
 * 실패의 본문은 오류 표(`failedCopy`)가, 막힌 작업의 안내는 `blockCopyKey`가 맡는다.
 */
export function bodyKey(job: JobDto): CopyKey | null {
  if (job.status === 'completed' && job.missing) return 'job.completedMissing.body';
  if (job.status === 'skipped') return job.partialBytes != null ? 'job.skippedMeanwhile.body' : 'job.skipped.body';
  return null;
}

/** 연결 대기 중인가(막대 줄무늬·본문·진입 알림의 기준) */
export function isWaitingNetwork(job: JobDto, p: ProgressDto | null | undefined): boolean {
  return job.status === 'running' && p?.phase === 'waitingNetwork';
}

/**
 * 멈춘 지 `STALE_DAYS`가 넘은 작업의 일수. 아니면 `null`. 멈춘 시각(`stoppedAt`)이 있고 받은 부분(`.part`)이 남은
 * paused·interrupted·failed만이다: 디스크를 차지하는 채 잊힌 작업을 알려 주는 줄이다(patterns.md §3.2).
 * 옛 레코드(`stoppedAt` 없음)는 줄이 없다.
 */
export function staleDays(job: JobDto, now: number = Date.now()): number | null {
  if (job.status !== 'paused' && job.status !== 'interrupted' && job.status !== 'failed') return null;
  if (job.stoppedAt == null || !(job.partialBytes && job.partialBytes > 0)) return null;
  const days = Math.floor((now / 1000 - job.stoppedAt) / 86400);
  return days >= STALE_DAYS ? days : null;
}

/** 단절에서 풀렸을 때 회복 줄을 보일 만큼 오래 기다렸는가(`RECOVERY_SILENT_MS` 안에 풀리면 조용히 넘어간다) */
export function shouldNoticeRecovery(waitedMs: number): boolean {
  return waitedMs >= RECOVERY_SILENT_MS;
}

export interface BodyContext {
  now?: number;
  base?: SizeBase;
  /** 회복 줄을 보이는 동안인가(스토어가 `RECOVERY_NOTICE_MS` 동안 true로 준다) */
  recovered?: boolean;
}

/**
 * 본문 줄(해요체 한 문장) 글자. 연결 대기 → 회복 직후 → 멈춘 지 30일 → 그 밖의 정해진 줄 순서다.
 * 실패 작업의 본문은 오류 표가 맡으므로 여기서는 멈춘 지 30일 줄만 더한다(호출부가 오류 본문 아래에 둔다).
 */
export function bodyLine(job: JobDto, p: ProgressDto | null | undefined, ctx: BodyContext = {}): string | null {
  if (isWaitingNetwork(job, p)) return t('job.waitingNetwork.body');
  if (job.status === 'running' && ctx.recovered) return t('job.recovered.body');
  const days = staleDays(job, ctx.now);
  if (days != null) {
    return t('job.stale.body', {
      days: formatCount(days),
      size: formatFileSize(job.partialBytes ?? 0, ctx.base ?? 1000),
    });
  }
  if (job.status === 'failed') return null;
  const key = bodyKey(job);
  return key ? t(key) : null;
}

// ───────────────────────── 버튼 ─────────────────────────

/** 목록 항목의 동작 하나 */
export type JobAction =
  | 'pause'
  | 'resume'
  | 'retry'
  | 'restartFresh'
  | 'cancel'
  | 'openFile'
  | 'openFolder'
  | 'remove'
  | 'copyUrl'
  | 'copyReport'
  | 'reresolve'
  | 'overwrite'
  | 'openCookieSettings'
  | 'reenterCookies'
  /** 제목 전체를 행 아래에 펼친다(화면 안의 일이라 셸 command가 없다) */
  | 'showTitle';

export interface JobButtons {
  /** 동작 줄의 기본 버튼(0~3개) */
  primary: JobAction[];
  /** [취소…]·[취소](= remove_job, §6.3). 라벨·확인은 `cancelLabel`·`removeRoute` */
  cancel: boolean;
  /** […] 메뉴 */
  menu: JobAction[];
}

const FROM_ERROR: Partial<Record<ActionId, JobAction>> = {
  retry: 'retry',
  resume: 'resume',
  restartFresh: 'restartFresh',
  remove: 'remove',
  openCookieSettings: 'openCookieSettings',
  reenterCookies: 'reenterCookies',
  reresolve: 'reresolve',
  copyReport: 'copyReport',
  openFolder: 'openFolder',
};

/** 실패 항목의 오류 줄과 버튼(§9 D 열) */
export function failedCopy(job: JobDto, cookiesEnabled: boolean) {
  if (!job.error) return null;
  return errorCopy(job.error, { place: 'job', partialBytes: job.partialBytes, cookiesEnabled });
}

/**
 * 상태별 버튼(patterns.md §3.2 표가 app.md §8.5보다 우선한다).
 * - 받는 중: [일시정지][취소…] / 준비 중: [취소] / 마무리 중·멈추는 중: 없음
 * - 대기: [취소] / 일시정지·중단: [이어받기][취소…]
 * - 실패: 오류 표(§9)의 동작 / 완료: [파일 열기][폴더에서 보기](파일이 없으면 [폴더에서 보기]) / 건너뜀: [파일 열기][덮어쓰고 받기…]
 * 메뉴: 제목 전체 보기(늘), 주소 복사(늘), 처음부터 다시 받기(`.part`가 있을 때), 문제 보고용 정보 복사(실패),
 * 목록에서 지우기(끝난 항목). 기본 버튼에 이미 있는 동작은 메뉴에 다시 넣지 않는다.
 */
export function jobButtons(
  job: JobDto,
  p: ProgressDto | null | undefined,
  cookiesEnabled = false,
  block: JobBlock | null = null,
): JobButtons {
  let primary: JobAction[] = [];
  let cancel = false;
  switch (job.status) {
    case 'queued':
      cancel = true;
      break;
    case 'running': {
      const phase = p?.phase ?? 'resolving';
      if (phase === 'finalizing') break;
      cancel = true;
      if (phase === 'downloading' || phase === 'reresolving' || phase === 'waitingNetwork') primary = ['pause'];
      break;
    }
    case 'pausing':
      break;
    case 'paused':
    case 'interrupted':
      primary = ['resume'];
      cancel = true;
      break;
    case 'failed': {
      const c = failedCopy(job, cookiesEnabled);
      primary = (c?.actions ?? ['retry'])
        .map((a) => FROM_ERROR[a])
        .filter((a): a is JobAction => !!a);
      break;
    }
    case 'completed':
      primary = job.missing ? ['openFolder'] : ['openFile', 'openFolder'];
      break;
    case 'skipped':
      primary = ['openFile', 'overwrite'];
      break;
  }
  const menu: JobAction[] = ['showTitle', 'copyUrl'];
  const stopped = job.status === 'paused' || job.status === 'interrupted' || job.status === 'failed';
  if (stopped && (job.partialBytes ?? 0) > 0) menu.push('restartFresh');
  if (job.status === 'failed') menu.push('copyReport');
  if (job.status === 'completed' || job.status === 'skipped' || job.status === 'failed') menu.push('remove');
  const open = (a: JobAction) => !block || !RESUMING.includes(a);
  primary = primary.filter(open);
  return { primary, cancel, menu: menu.filter((a) => open(a) && !primary.includes(a)) };
}

// ───────────────────────── 막힌 작업(A5) ─────────────────────────

/** 이어받기 계열 동작: 막힌 작업에서는 셸이 거부하므로 버튼을 보이지 않는다 */
const RESUMING: readonly JobAction[] = ['resume', 'retry', 'restartFresh', 'overwrite'];

export type JobBlock = 'otherChannel';

const REQUEUEABLE: readonly JobStatus[] = ['paused', 'interrupted', 'failed', 'skipped'];

/**
 * 이어받기를 셸이 거부할 멈춘 작업(worker.md §11.5 "채널이 바뀜"). 로그인을 쓰지 않거나(`disabled`) 로그인 전이거나
 * 내 채널을 모르면 `null`이다(비교 대상이 없으면 막지 않는다). 기록의 채널 ID는 안내용이다: 셸은 이어받을 때 작업의
 * 영상을 다시 판정하고 통과한 채널로 기록을 고친다(worker.md 86). 그래서 채널 ID가 없는 옛 작업도 막지 않고 셸에 맡긴다.
 */
export function jobBlock(job: JobDto, me: AuthStatusDto | null): JobBlock | null {
  if (!me || me.state !== 'signedIn' || !me.channelId) return null;
  if (!REQUEUEABLE.includes(job.status) || job.channelId == null) return null;
  return job.channelId.toLowerCase() === me.channelId.trim().toLowerCase() ? null : 'otherChannel';
}

/** B1이 이어받을 interrupted 작업 id(오름차순). 막힌 작업은 뺀다 */
export function resumableInterrupted(jobs: Iterable<JobDto>, me: AuthStatusDto | null): JobId[] {
  return [...jobs]
    .filter((j) => j.status === 'interrupted' && jobBlock(j, me) === null)
    .map((j) => j.id)
    .sort((a, b) => a - b);
}

export function blockCopyKey(_b: JobBlock): CopyKey {
  return 'job.otherChannel.body';
}

/** 폴더 보기(`openFolder`)는 OS마다 글자가 다르다(D39). 그 한 가지만 `actionLabel`이 OS로 고른다 */
const ACTION_LABEL: Record<Exclude<JobAction, 'openFolder'>, CopyKey> = {
  pause: 'action.pause',
  resume: 'action.resume',
  retry: 'action.retry',
  restartFresh: 'action.restartFresh',
  cancel: 'action.cancel',
  openFile: 'action.openFile',
  remove: 'action.remove',
  copyUrl: 'action.copyUrl',
  copyReport: 'action.copyReport',
  reresolve: 'action.reresolve',
  overwrite: 'action.overwriteAndDownload',
  openCookieSettings: 'action.openCookieSettings',
  reenterCookies: 'action.reenterCookies',
  showTitle: 'action.showTitle',
};

const ACTION_ICON: Partial<Record<JobAction, IconName>> = {
  pause: 'pause',
  resume: 'play',
  retry: 'play',
  restartFresh: 'rotate-cw',
  openFile: 'file-video',
  openFolder: 'folder',
  remove: 'trash-2',
  copyUrl: 'copy',
  copyReport: 'copy',
};

export function jobActionLabel(a: JobAction, os: Os): string {
  return a === 'openFolder' ? actionLabel('openFolder', os) : t(ACTION_LABEL[a]);
}

export function jobActionIcon(a: JobAction): IconName | undefined {
  return ACTION_ICON[a];
}

// ───────────────────────── 취소·지우기 확인(D2·지연 삭제) ─────────────────────────

/**
 * 지우면 받은 부분(`.part`)이 함께 사라지는가 = 비가역이라 D2로 묻는다(patterns.md §4, 크기와 무관하다).
 * 대기 중이거나 받은 바이트가 0이면(준비 중·막 멈춤) 잃을 것이 없다. 실패 항목의 "목록에서 지우기"도
 * `.part`를 지우므로 같은 규칙이고(구현 중 변경 45), 받은 `.part`가 남은 건너뜀도 같다(구현 중 변경 53).
 */
export function needsCancelConfirm(job: JobDto, p: ProgressDto | null | undefined): boolean {
  if (job.status === 'queued') return false;
  return receivedBytes(job, p) > 0;
}

/** 취소 버튼: D2를 여는 [취소…](danger 글자)와 즉시 지우는 [취소](neutral). 둘은 같은 조건으로 갈린다 */
export function cancelLabel(job: JobDto, p: ProgressDto | null | undefined): { label: string; tone: 'danger' | 'neutral' } {
  return needsCancelConfirm(job, p)
    ? { label: t('action.cancel'), tone: 'danger' }
    : { label: t('common.cancel'), tone: 'neutral' };
}

export type RemoveRoute = 'confirm' | 'defer' | 'now';

/**
 * 취소·지우기가 갈 길. `.part`가 있으면 D2(`confirm`), 끝난 항목(완료·건너뜀·실패)은 숨기고 되돌리기 토스트를 준 뒤
 * 닫힐 때 지우는 지연 삭제(`defer`), 그 밖(대기·준비 중)은 바로(`now`).
 */
export function removeRoute(job: JobDto, p: ProgressDto | null | undefined): RemoveRoute {
  if (needsCancelConfirm(job, p)) return 'confirm';
  return job.status === 'completed' || job.status === 'skipped' || job.status === 'failed' ? 'defer' : 'now';
}

/** [완료 항목 지우기]가 지울 수 있는 작업: 완료와 받은 `.part`가 없는 건너뜀(남은 `.part`는 셸도 남긴다, manager `Job::clearable`) */
export function isClearable(job: JobDto): boolean {
  return job.status === 'completed' || (job.status === 'skipped' && job.partialBytes == null);
}

/** 저장된 파일 이름(경로의 마지막 조각). Windows·POSIX 구분자 모두 */
export function outputFileName(output: string): string {
  return output.split(/[\\/]/).pop() ?? output;
}

// ───────────────────────── 키보드 ─────────────────────────

/** Space: 일시정지·이어받기(§10 단축키). 없으면 `null` */
export function spaceAction(b: JobButtons): JobAction | null {
  if (b.primary.includes('pause')) return 'pause';
  if (b.primary.includes('resume')) return 'resume';
  return null;
}

/** Enter: 완료 항목은 파일 열기, 그 밖은 기본 버튼의 첫째 */
export function enterAction(job: JobDto, b: JobButtons): JobAction | null {
  if (job.status === 'completed' && b.primary.includes('openFile')) return 'openFile';
  return b.primary[0] ?? null;
}

/** Delete: 끝난 항목은 지우기, 진행 항목은 취소(D2 규칙을 거친다) */
export function deleteAction(job: JobDto, b: JobButtons): JobAction | null {
  if (b.cancel) return 'cancel';
  if (job.status === 'completed' || job.status === 'skipped' || job.status === 'failed') return 'remove';
  return null;
}

// ───────────────────────── 읽어 주기 ─────────────────────────

/**
 * 상태 전이 때 LiveAnnouncer가 읽을 문장. 진행률 틱과 완료(토스트가 role=status로 읽는다)는 읽지 않는다.
 */
export function transitionAnnouncement(prev: JobDto | undefined, next: JobDto): string | null {
  if (prev && prev.status === next.status) return null;
  switch (next.status) {
    // 실패는 오류 제목이 상태 낱말이다. 오류 정보가 없으면 OS 알림과 같은 문장을 쓴다
    case 'failed':
    case 'paused':
    case 'interrupted':
    case 'skipped':
    case 'running':
      return t('a11y.jobStatus', {
        title: next.title,
        status: statusWord(next, next.progress) || t('notify.failed'),
      });
    default:
      return null;
  }
}
