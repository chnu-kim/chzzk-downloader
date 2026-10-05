// 받기 화면(§8.3)의 판단을 순수 함수로 둔다. 컴포넌트는 표시와 입력만 한다.
import type {
  ContentKind,
  EnqueueRequest,
  OutputCheck,
  PlaybackKind,
  QualityDto,
  ResolvedDto,
} from './bindings';
import { estimateSize, formatBytes } from './format/bytes';
import { formatKstDate, formatKstDateTime } from './format/date';
import { formatClock } from './format/duration';
import { t, type CopyKey } from './copy/ko';

export type KindTone = 'rewind' | 'vod' | 'clip';

/** 종류 라벨(§8.3): 클립 / 빠른 다시보기(Video + HLS) / 일반 VOD(Video + progressive) */
export function kindTone(kind: ContentKind, playback: PlaybackKind): KindTone {
  if (kind === 'clip') return 'clip';
  return playback === 'liveRewindHls' ? 'rewind' : 'vod';
}

const KIND_LABEL: Record<KindTone, CopyKey> = {
  rewind: 'kind.liveRewind',
  vod: 'kind.vod',
  clip: 'kind.clip',
};

export function kindLabel(tone: KindTone): string {
  return t(KIND_LABEL[tone]);
}

/** 메타 줄 조각: 채널 · 날짜 · 길이. 없는 것은 뺀다. */
export function metaParts(r: ResolvedDto): string[] {
  const parts = [r.meta.channelName];
  const live = formatKstDateTime(r.meta.liveOpenDate);
  const pub = formatKstDate(r.meta.publishDate);
  if (live) parts.push(t('meta.liveDate', { date: live }));
  else if (pub) parts.push(t('meta.publishDate', { date: pub }));
  if (r.meta.durationSecs != null && r.meta.durationSecs > 0) parts.push(formatClock(r.meta.durationSecs));
  return parts.filter(Boolean);
}

/** 화질 행: `60fps`(숫자가 아니면 그대로), 예상 크기 `약 7.8 GB`(모르면 null) */
export function qualityFps(q: QualityDto): string | null {
  if (!q.frameRate) return null;
  const n = Number.parseFloat(q.frameRate);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)}fps` : q.frameRate;
}

export function qualitySize(q: QualityDto, durationSecs: number | null): string | null {
  const size = estimateSize(q.bandwidth, durationSecs);
  return size == null ? null : t('quality.sizeEstimate', { size: formatBytes(size) });
}

/** 완성 파일이 있을 때 고르는 것(§6.4). 기본은 번호 붙이기 */
export type ExistingChoice = 'number' | 'overwrite';

export interface CardChoices {
  existing: ExistingChoice;
  /** 같은 작업의 `.part`가 있을 때 "처음부터 받기"를 눌렀는가 */
  partialFresh: boolean;
}

export const DEFAULT_CHOICES: CardChoices = { existing: 'number', partialFresh: false };

/** `check_output`을 다시 불러야 하는 입력. 결과가 이 열쇠와 같을 때만 믿는다. */
export function checkKey(folder: string | null, fileName: string, qualityId: string): string {
  return JSON.stringify([folder, fileName, qualityId]);
}

/** 이번 선택으로 실제로 쓸 파일이 번호 붙인 새 이름인가 */
export function usesFreeName(check: OutputCheck, choices: CardChoices): boolean {
  return check.exists && choices.existing === 'number' && check.freeFileName != null;
}

/** 카드가 보여 줄 충돌 안내(§8.3 ConflictNotice). 서로 독립이다(§6.4). */
export interface Notices {
  duplicate: boolean;
  exists: boolean;
  /** 같은 작업의 `.part`: 이어서 받는다(처음부터로 바꿀 수 있다) */
  partialSame: number | null;
  /** 다른 화질 등의 `.part`: 안내만(코어가 지우고 새로 받는다) */
  partialOther: boolean;
}

export function notices(check: OutputCheck, choices: CardChoices): Notices {
  // 번호 붙인 새 이름은 `.part`가 없는 이름이라 받다 만 안내가 해당하지 않는다.
  const fresh = usesFreeName(check, choices);
  const p = fresh ? null : check.partial;
  return {
    duplicate: check.duplicateJobId != null,
    exists: check.exists,
    partialSame: p && p.sameJob ? p.bytes : null,
    partialOther: !!p && !p.sameJob,
  };
}

/**
 * `EnqueueRequest`(§6.4 표).
 * - 완성 파일이 있음: 번호 → `freeFileName`, 덮어쓰기 → 그 이름 그대로. 둘 다 `onExisting = overwrite`.
 * - 같은 작업의 `.part`: 이어받기 `restart = false`, 처음부터 `restart = true`.
 * - 다른 `.part`: `restart = false`(코어가 sidecar 불일치로 지우고 새로 시작).
 * 이름은 `check_output`이 정리한 `fileName`을 보낸다(검사한 경로와 같게).
 */
export function buildEnqueueRequest(
  r: ResolvedDto,
  quality: QualityDto,
  folder: string | null,
  check: OutputCheck,
  choices: CardChoices,
): EnqueueRequest {
  const fresh = usesFreeName(check, choices);
  const fileName = fresh ? (check.freeFileName as string) : check.fileName;
  const restart = !fresh && check.partial != null && check.partial.sameJob && choices.partialFresh;
  return {
    url: r.url,
    content: r.content,
    title: r.meta.title,
    channelName: r.meta.channelName,
    channelId: r.meta.channelId,
    qualityId: quality.id,
    qualityLabel: quality.label,
    expectedKind: r.playbackKind,
    folder,
    fileName,
    onExisting: 'overwrite',
    restart,
  };
}

/** 다운로드 버튼을 누를 수 있는가: 지금 입력의 검사 결과가 있고, 같은 경로의 활성 작업이 없다. */
export function canDownload(args: {
  fileName: string;
  check: OutputCheck | null;
  checkedKey: string | null;
  currentKey: string;
  busy: boolean;
  ownership: ResolvedDto['ownership'];
  choices: CardChoices;
}): boolean {
  const { fileName, check, checkedKey, currentKey, busy, ownership, choices } = args;
  if (busy || !fileName.trim() || !check || checkedKey !== currentKey) return false;
  if (check.duplicateJobId != null) return false;
  // 번호를 골랐는데 빈 이름이 없으면 덮어쓰게 되므로 막는다(셸은 exists면 늘 채운다).
  if (check.exists && choices.existing === 'number' && check.freeFileName == null) return false;
  // Phase 3: 본인 영상이 아니거나 모르면 막는다(§12). Phase 2는 늘 unchecked.
  if (ownership === 'notOwn' || ownership === 'unknown') return false;
  return true;
}

/**
 * 창 포커스 때 클립보드 주소를 제안할까(ui-visual §6.4).
 * 입력줄이 비었고 카드·불러오기·오류가 없을 때, 닫은 적 없는 주소만.
 */
export function shouldSuggestClipboard(
  link: string | null,
  s: { inputEmpty: boolean; idle: boolean; dismissed: ReadonlySet<string> },
): link is string {
  return !!link && s.inputEmpty && s.idle && !s.dismissed.has(link);
}
