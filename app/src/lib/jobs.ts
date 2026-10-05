// 다운로드 목록(§8.5·§8.11, ui-visual §6.5)의 판단을 순수 함수로 둔다. 상태 판단은 Rust가 하고,
// 여기서는 받은 레코드로 무엇을 어떻게 보일지만 정한다. 컴포넌트는 표시와 입력만 한다.
import type { JobDto, JobId, JobStatus, ProgressDto } from './bindings';
import { errorCopy, type ActionId } from './copy/errors';
import { t, type CopyKey } from './copy/ko';
import { formatBytes, formatSpeed } from './format/bytes';
import { formatTimeOfDay } from './format/date';
import { formatSpan } from './format/duration';
import type { IconName } from './components/ui/icons';

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
    out.push({ id, label: t(GROUP_LABEL[id], { n: list.length }), jobs: list });
  }
  return out;
}

/** 목록에 보이는 순서대로 펼친 id(키보드 위·아래 이동용) */
export function visibleOrder(groups: readonly JobGroup[]): JobId[] {
  return groups.flatMap((g) => g.jobs.map((j) => j.id));
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

export interface BarView {
  value: number | null;
  tone: 'accent' | 'muted' | 'danger';
  striped: boolean;
  /** 막대 오른쪽 `58%`. 총량을 모르면 `null` */
  percent: string | null;
  /** 스크린 리더 문장: "58퍼센트, 2분 18초 남음" */
  valueText: string;
}

/**
 * 진행 막대(ui-visual §6.5). 받는 중·멈추는 중은 늘, 멈춘 작업·실패는 마지막 진행률이 있을 때만,
 * 대기·완료·건너뜀과 마무리 전 진행률이 없는 실패에는 없다.
 */
export function barView(job: JobDto, p: ProgressDto | null | undefined): BarView | null {
  const s = job.status;
  if (s === 'queued' || s === 'completed' || s === 'skipped') return null;
  if ((s === 'paused' || s === 'interrupted' || s === 'failed') && !p) return null;
  if (s === 'failed' && !(job.partialBytes && job.partialBytes > 0)) return null;
  const preparing = s === 'running' && (!p || p.phase === 'resolving');
  const value = preparing ? null : progressFraction(job, p);
  const tone: BarView['tone'] = s === 'failed' ? 'danger' : s === 'running' ? 'accent' : 'muted';
  const percentN = value == null ? null : Math.floor(value * 100);
  const parts: string[] = [];
  if (percentN != null) parts.push(t('job.percent', { n: percentN }));
  if (s === 'running' && p?.phase === 'downloading') {
    parts.push(p.etaSecs != null ? t('job.eta', { t: formatSpan(p.etaSecs) }) : t('job.etaUnknown'));
  }
  if (!parts.length) parts.push(statusWord(job, p));
  return {
    value,
    tone,
    striped: s === 'running' && p?.phase === 'reresolving',
    percent: percentN == null ? null : `${percentN}%`,
    valueText: parts.join(', '),
  };
}

/**
 * 건너뜀 문구. 받은 `.part`가 남았으면(`partialBytes`) 시작 전이 아니라 받는 동안 같은 이름의 파일이 생겨
 * 덮어쓰지 않은 것이다(번호 붙인 새 이름이나 충돌 없던 이름은 `onExisting = skip`).
 */
function skippedKey(job: JobDto): CopyKey {
  return job.partialBytes != null ? 'job.skippedMeanwhile' : 'job.skipped';
}

/** 상태를 한 낱말로(스크린 리더·알림) */
export function statusWord(job: JobDto, p: ProgressDto | null | undefined): string {
  switch (job.status) {
    case 'running':
      return t(PHASE_KEY[p?.phase ?? 'resolving']);
    case 'queued':
      return t('job.word.queued');
    case 'pausing':
      return t('job.pausing');
    case 'paused':
      return t('job.pausedNoBytes');
    case 'interrupted':
      return t('job.interruptedNoBytes');
    case 'completed':
      return t('job.word.completed');
    case 'skipped':
      return t(skippedKey(job));
    case 'failed':
      return job.error ? errorCopy(job.error, { place: 'job', partialBytes: job.partialBytes }).title : '';
  }
}

const PHASE_KEY = {
  resolving: 'job.phase.resolving',
  downloading: 'job.phase.downloading',
  reresolving: 'job.phase.reresolving',
  finalizing: 'job.phase.finalizing',
} as const satisfies Record<NonNullable<ProgressDto['phase']>, CopyKey>;

// ───────────────────────── 상태 줄 ─────────────────────────

/** 상태 줄 조각. `value`는 숫자(fg, tnum), 아니면 설명(fg-muted) */
export interface StatusPart {
  text: string;
  value?: boolean;
  /** 괄호 보조(fg-faint): 이어받음 */
  faint?: boolean;
  /** 폭 720~839에서 숨김(HLS 조각, ui-visual §8) */
  wideOnly?: boolean;
}

/** 이어받음 표시는 받기를 다시 시작하고 10초 동안만(§8.11) */
export const RESUMED_NOTE_MS = 10_000;

export interface StatusContext {
  /** 줄에서 앞에 선 대기 작업 수 */
  ahead?: number;
  /** 이번에 받기 시작한 시각(ms). 이어받음 표시에 쓴다 */
  runStartedAt?: number | null;
  now?: number;
  /** 완료 시각 표시의 시간대(테스트) */
  timeZone?: string;
}

function sizeParts(job: JobDto, p: ProgressDto, ctx: StatusContext): StatusPart[] {
  const hls = job.playbackKind === 'liveRewindHls';
  const total = hls ? p.totalBytesEstimate : p.totalBytes;
  const size = total
    ? `${formatBytes(p.bytes)} / ${hls ? t('quality.sizeEstimate', { size: formatBytes(total) }) : formatBytes(total)}`
    : formatBytes(p.bytes);
  const out: StatusPart[] = [{ text: size, value: true }];
  const now = ctx.now ?? Date.now();
  if (p.resumedFrom > 0 && ctx.runStartedAt != null && now - ctx.runStartedAt < RESUMED_NOTE_MS) {
    out.push({ text: `(${t('job.resumedFrom', { size: formatBytes(p.resumedFrom) })})`, faint: true });
  }
  return out;
}

/** 상태 줄(§8.5·§8.11). 실패는 오류 줄이 따로라 빈 배열이다. 조각 사이는 ` · `로 잇는다(크기와 이어받음 괄호는 붙여 쓴다). */
export function statusParts(job: JobDto, p: ProgressDto | null | undefined, ctx: StatusContext = {}): StatusPart[] {
  switch (job.status) {
    case 'queued': {
      const n = ctx.ahead ?? 0;
      return [{ text: n > 0 ? t('job.queued', { n }) : t('job.queuedNext') }];
    }
    case 'running': {
      if (!p || p.phase === 'resolving') return [{ text: t('job.phase.resolving') }];
      if (p.phase === 'finalizing') return [{ text: t('job.phase.finalizing') }];
      if (p.phase === 'reresolving') return [{ text: t('job.phase.reresolving') }, ...sizeParts(job, p, ctx)];
      const parts: StatusPart[] = [{ text: t('job.phase.downloading') }, ...sizeParts(job, p, ctx)];
      if (job.playbackKind === 'liveRewindHls' && p.segmentsDone != null && p.segmentsTotal != null) {
        parts.push({
          text: t('job.segments', {
            done: p.segmentsDone.toLocaleString('en-US'),
            total: p.segmentsTotal.toLocaleString('en-US'),
          }),
          wideOnly: true,
        });
      }
      if (p.speedBps != null && p.speedBps > 0) parts.push({ text: formatSpeed(p.speedBps), value: true });
      parts.push(
        p.etaSecs != null ? { text: t('job.eta', { t: formatSpan(p.etaSecs) }) } : { text: t('job.etaUnknown') },
      );
      return parts;
    }
    case 'pausing':
      return [{ text: t('job.pausing') }];
    case 'paused':
    case 'interrupted': {
      const bytes = receivedBytes(job, p);
      const paused = job.status === 'paused';
      if (bytes <= 0) return [{ text: t(paused ? 'job.pausedNoBytes' : 'job.interruptedNoBytes') }];
      return [{ text: t(paused ? 'job.paused' : 'job.interrupted', { bytes: formatBytes(bytes) }) }];
    }
    case 'completed': {
      if (job.missing) return [{ text: t('job.completedMissing') }];
      return [
        {
          text: t('job.completed', {
            size: formatBytes(job.finalBytes ?? 0),
            time: job.finishedAt != null ? formatTimeOfDay(job.finishedAt, ctx.timeZone) : '',
          }).replace(/ · $/, ''),
        },
      ];
    }
    case 'skipped':
      return [{ text: t(skippedKey(job)) }];
    case 'failed':
      return [];
  }
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
  | 'reenterCookies';

export interface JobButtons {
  /** 상태 줄 옆 기본 버튼(1~3개) */
  primary: JobAction[];
  /** [×] 취소(= remove_job, §6.3) */
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
 * 상태별 버튼(ui-visual §6.5가 app.md §8.5보다 우선한다).
 * - 받는 중: [일시정지][×] / 준비 중: [×] / 마무리 중: 없음 / 멈추는 중: 없음
 * - 대기: [×] / 일시정지·중단: [이어받기][×]
 * - 실패: 오류 표(§9)의 동작 / 완료: [파일 열기][폴더 열기](파일이 없으면 [폴더 열기]) / 건너뜀: [파일 열기][덮어쓰고 받기]
 * 메뉴: 주소 복사(늘), 처음부터 다시 받기(`.part`가 있을 때), 문제 보고용 정보 복사(실패), 목록에서 지우기(끝난 항목).
 * 기본 버튼에 이미 있는 동작은 메뉴에 다시 넣지 않는다.
 */
export function jobButtons(job: JobDto, p: ProgressDto | null | undefined, cookiesEnabled = false): JobButtons {
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
      if (phase === 'downloading' || phase === 'reresolving') primary = ['pause'];
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
  const menu: JobAction[] = ['copyUrl'];
  const stopped = job.status === 'paused' || job.status === 'interrupted' || job.status === 'failed';
  if (stopped && (job.partialBytes ?? 0) > 0) menu.push('restartFresh');
  if (job.status === 'failed') menu.push('copyReport');
  if (job.status === 'completed' || job.status === 'skipped' || job.status === 'failed') menu.push('remove');
  return { primary, cancel, menu: menu.filter((a) => !primary.includes(a)) };
}

const ACTION_LABEL: Record<JobAction, CopyKey> = {
  pause: 'action.pause',
  resume: 'action.resume',
  retry: 'action.retry',
  restartFresh: 'action.restartFresh',
  cancel: 'action.cancel',
  openFile: 'action.openFile',
  openFolder: 'action.openFolder',
  remove: 'action.remove',
  copyUrl: 'action.copyUrl',
  copyReport: 'action.copyReport',
  reresolve: 'action.reresolve',
  overwrite: 'action.overwriteAndDownload',
  openCookieSettings: 'action.openCookieSettings',
  reenterCookies: 'action.reenterCookies',
};

const ACTION_ICON: Partial<Record<JobAction, IconName>> = {
  pause: 'pause',
  resume: 'play',
  retry: 'play',
  restartFresh: 'restart',
  cancel: 'x',
  openFile: 'file-play',
  openFolder: 'folder',
  remove: 'trash',
  copyUrl: 'copy',
  copyReport: 'copy',
};

export function jobActionLabel(a: JobAction): string {
  return t(ACTION_LABEL[a]);
}

export function jobActionIcon(a: JobAction): IconName | undefined {
  return ACTION_ICON[a];
}

/** 기본 동작을 안다는 표시(accent 글자): 이어받기·다시 시도(ui-visual §6.5) */
export function isAccentAction(a: JobAction): boolean {
  return a === 'resume' || a === 'retry';
}

// ───────────────────────── 취소 확인(D2) ─────────────────────────

/** 받은 부분이 이보다 크면 지우기 전에 묻는다(§6.3). 같으면 묻지 않는다 */
export const CANCEL_CONFIRM_BYTES = 512 * 1024 * 1024;

/**
 * `remove_job`이 받은 부분(`.part`)을 지우기 전에 D2로 물을까. 대기 중이거나 0바이트면 묻지 않는다.
 * 실패 항목의 "목록에서 지우기"도 `.part`를 지우므로 같은 규칙이다(구현 중 변경 45). 받은 `.part`가 남은
 * 건너뜀도 같다(구현 중 변경 53).
 */
export function needsCancelConfirm(job: JobDto, p: ProgressDto | null | undefined): boolean {
  if (job.status === 'queued') return false;
  return receivedBytes(job, p) > CANCEL_CONFIRM_BYTES;
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
    case 'failed':
      return t('job.failed', { title: next.title });
    case 'paused':
    case 'interrupted':
    case 'skipped':
    case 'running':
      return t('job.status', { title: next.title, status: statusWord(next, next.progress) });
    default:
      return null;
  }
}
