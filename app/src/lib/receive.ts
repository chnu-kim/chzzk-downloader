// 받기 화면(system/patterns.md §6.5·§14)의 판단을 순수 함수로 둔다. 컴포넌트는 표시와 입력만 한다.
import type {
  ContentKind,
  EnqueueRequest,
  OutputCheck,
  PlaybackKind,
  QualityDto,
  RecentVodDto,
  ResolvedDto,
} from './bindings';
import { estimateSize, formatBytes } from './format/bytes';
import { formatKstDate, formatKstDateTime } from './format/date';
import { formatClock } from './format/duration';
import { t, type CopyKey } from './copy/ko';

export type KindTone = 'rewind' | 'vod' | 'clip';

/** 파일 이름·화질·폴더가 바뀐 뒤 `check_output`을 부르기까지 기다리는 시간(patterns.md §6.5) */
export const CHECK_DEBOUNCE_MS = 150;

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

/**
 * 최근 영상의 둘째 줄(patterns.md §14.1). 종류와 날짜가 있으면 `{kind} · {date}`, 날짜만 없으면 종류 글자만,
 * 종류가 없으면(옛 항목) null이라 둘째 줄을 그리지 않는다.
 */
export function recentSecondLine(item: Pick<RecentVodDto, 'kind' | 'date'>): string | null {
  if (!item.kind) return null;
  const kind = kindLabel(item.kind);
  const date = formatKstDate(item.date);
  return date ? t('recent.meta', { kind, date }) : kind;
}

/**
 * 꼬리표 `quality.best`가 붙을 가장 높은 화질 행의 위치(patterns.md §6.5). 기본 선택과 무관하다.
 * 해상도, 같으면 대역폭이 큰 쪽이고 그래도 같으면 앞쪽. 고를 것이 하나뿐이면 꼬리표가 뜻이 없어 null.
 */
export function bestQualityIndex(qualities: readonly QualityDto[]): number | null {
  if (qualities.length < 2) return null;
  let best = 0;
  for (let i = 1; i < qualities.length; i++) {
    const a = qualities[i];
    const b = qualities[best];
    const ra = a.resolution ?? 0;
    const rb = b.resolution ?? 0;
    if (ra > rb || (ra === rb && (a.bandwidth ?? 0) > (b.bandwidth ?? 0))) best = i;
  }
  return best;
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
 * `EnqueueRequest`(patterns.md §6.5 표).
 * - 완성 파일이 있음: 번호 → `freeFileName`, 덮어쓰기 → 그 이름 그대로.
 * - `onExisting`: 덮어쓰기를 직접 고른 때만 `overwrite`, 그 밖(충돌 없음·번호 붙인 새 이름)은 `skip`.
 *   검사 뒤 받는 동안 같은 이름의 파일이 생겨도 덮어쓰지 않는다(코어가 덮어쓰지 않고 마무리해 `skipped`로
 *   끝나고, 받은 `.part`는 남아 "덮어쓰고 받기"로 이어받는다).
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
    onExisting: check.exists && choices.existing === 'overwrite' ? 'overwrite' : 'skip',
    restart,
    // 최근 영상 둘째 줄의 날짜(바인딩 타입이 string이라 없으면 보내지 않는다)
    contentDate: r.meta.liveOpenDate ?? r.meta.publishDate ?? undefined,
  };
}

/** 산출 파일 이름의 확장자(문구가 아니라 코드 상수, content.md §15 `filename.ext` 삭제) */
export const FILE_EXT = '.mp4';

/** [받기]를 막는 사유(patterns.md §6.4: 사유가 있는 비활성은 `aria-describedby`로 문장을 잇는다) */
export type BlockReason = 'ownership' | 'duplicate';

/** 사유 문장 요소의 id. ConflictNotice·OwnershipNotice가 달고 [받기]의 aria-describedby가 가리킨다 */
export const BLOCK_REASON_ID = {
  ownership: 'ownership-notice',
  duplicate: 'conflict-in-queue',
} as const satisfies Record<BlockReason, string>;

/** 본인 영상이 아니거나 모르면 ownership, 같은 경로의 활성 작업이 있으면 duplicate. 먼저 맞는 쪽 */
export function downloadBlock(ownership: ResolvedDto['ownership'], check: OutputCheck | null): BlockReason | null {
  // Phase 3: 본인 영상이 아니거나 모르면 막는다(§12). Phase 2는 늘 unchecked.
  if (ownership === 'notOwn' || ownership === 'unknown') return 'ownership';
  if (check && check.duplicateJobId != null) return 'duplicate';
  return null;
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
  if (downloadBlock(ownership, check) != null) return false;
  // 번호를 골랐는데 빈 이름이 없으면 덮어쓰게 되므로 막는다(셸은 exists면 늘 채운다).
  if (check.exists && choices.existing === 'number' && check.freeFileName == null) return false;
  return true;
}

/**
 * 창 포커스 때 클립보드 주소를 제안할까(system/patterns.md §7).
 * 입력줄이 비었고 카드·불러오기·오류가 없을 때, 닫은 적 없는 주소만.
 */
export function shouldSuggestClipboard(
  link: string | null,
  s: { inputEmpty: boolean; idle: boolean; dismissed: ReadonlySet<string> },
): link is string {
  return !!link && s.inputEmpty && s.idle && !s.dismissed.has(link);
}
