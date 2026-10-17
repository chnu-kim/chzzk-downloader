// 받기 화면(system/patterns.md §6.5·§14)의 판단을 순수 함수로 둔다. 컴포넌트는 표시와 입력만 한다.
import type {
  ContentKind,
  EnqueueRequest,
  OutputCheck,
  PlaybackKind,
  QualityDto,
  RecentVodDto,
  ResolvedDto,
  TimeRangeDto,
} from './bindings';
import { estimateSize, formatEstimate, type SizeBase } from './format/bytes';
import { formatDate, formatDateTime, parseKstWall } from './format/date';
import { formatClock, parseClock } from './format/duration';
import { t, type CopyKey } from './copy/ko';

export type KindTone = 'rewind' | 'vod' | 'clip' | 'live';

/** 파일 이름·화질·폴더가 바뀐 뒤 `check_output`을 부르기까지 기다리는 시간(patterns.md §6.5) */
export const CHECK_DEBOUNCE_MS = 150;

/** 종류 라벨(§8.3): 클립 / 생방송 / 빠른 다시보기(Video + HLS) / 일반 VOD(Video + progressive) */
export function kindTone(kind: ContentKind, playback: PlaybackKind): KindTone {
  if (kind === 'clip') return 'clip';
  if (kind === 'live' || playback === 'live') return 'live';
  return playback === 'liveRewindHls' ? 'rewind' : 'vod';
}

const KIND_LABEL: Record<KindTone, CopyKey> = {
  rewind: 'kind.liveRewind',
  vod: 'kind.vod',
  clip: 'kind.clip',
  live: 'kind.live',
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
  const wall = parseKstWall(item.date);
  return wall ? t('recent.meta', { kind, date: formatDate(wall) }) : kind;
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
  if (r.ownership === 'delegated') parts.push(t('delegated.title'));
  // API 날짜는 KST 벽시계 그대로다(시간대 변환 없음, content.md §7)
  const live = parseKstWall(r.meta.liveOpenDate);
  const pub = parseKstWall(r.meta.publishDate);
  if (live) parts.push(t('meta.liveDate', { date: formatDateTime(live) }));
  else if (pub) parts.push(t('meta.publishDate', { date: formatDate(pub) }));
  if (r.meta.durationSecs != null && r.meta.durationSecs > 0) parts.push(formatClock(r.meta.durationSecs));
  return parts.filter(Boolean);
}

/** 화질 행: `60fps`(숫자가 아니면 그대로), 예상 크기 `약 7.8GB`(모르면 null) */
export function qualityFps(q: QualityDto): string | null {
  if (!q.frameRate) return null;
  const n = Number.parseFloat(q.frameRate);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n)}fps` : q.frameRate;
}

export function qualitySize(q: QualityDto, durationSecs: number | null, base: SizeBase = 1000): string | null {
  const size = estimateSize(q.bandwidth, durationSecs);
  return size == null ? null : formatEstimate(size, base);
}

/** 완성 파일이 있을 때 고르는 것(§6.4). 기본은 번호 붙이기 */
export type ExistingChoice = 'number' | 'overwrite';

export interface CardChoices {
  existing: ExistingChoice;
  /** 같은 작업의 `.part`가 있을 때 "처음부터 받기"를 눌렀는가 */
  partialFresh: boolean;
}

export const DEFAULT_CHOICES: CardChoices = { existing: 'number', partialFresh: false };

/**
 * `check_output`을 다시 불러야 하는 입력. 결과가 이 열쇠와 같을 때만 믿는다.
 * range는 칸 글자가 아니라 `effectiveRange` 결과다(같은 구간을 다르게 적어도 같은 열쇠).
 */
export function checkKey(
  folder: string | null,
  fileName: string,
  qualityId: string,
  range: TimeRangeDto | null = null,
): string {
  return JSON.stringify([folder, fileName, qualityId, range]);
}

/** 구간 줄의 입력(카드 상태). open = Disclosure가 펼쳐져 있고 빠른 다시보기 카드다 */
export interface RangeInput {
  open: boolean;
  start: string;
  end: string;
}

/** 제출 검증 결과: 어느 칸이 왜 틀렸나(한 번에 하나, 앞 칸·앞 규칙 먼저) */
export interface RangeError {
  field: 'start' | 'end';
  kind: 'format' | 'order' | 'beyond';
}

/** 형식 오류 문구의 예시 시각(초). 문구에 숫자를 직접 쓰지 않는다(content.md W5) */
export const RANGE_FORMAT_EXAMPLE_SECS = 600;

/** 영상 길이(올림, ms). 모르면 null */
function knownMs(d: number | null): number | null {
  return d != null && Number.isFinite(d) && d > 0 ? Math.ceil(d) * 1000 : null;
}

/** 칸 초깃값이 보여 주는 길이(내림, ms). 모르면 null */
function floorMs(d: number | null): number | null {
  return d != null && Number.isFinite(d) && d > 0 ? Math.floor(d) * 1000 : null;
}

/** [받기] 때의 구간 검증(range.md §5.2). 처음 걸린 오류 하나만 돌려준다. 끝이 길이를 넘는 것은 오류가 아니다(자른다) */
export function rangeError(input: RangeInput, durationSecs: number | null): RangeError | null {
  if (!input.open) return null;
  const s = parseClock(input.start);
  if (s == null) return { field: 'start', kind: 'format' };
  const endBlank = input.end.trim() === '';
  const e = endBlank ? null : parseClock(input.end);
  if (!endBlank && e == null) return { field: 'end', kind: 'format' };
  const d = knownMs(durationSecs);
  if (d != null && s >= d) return { field: 'start', kind: 'beyond' };
  if (e != null && e <= s) return { field: 'end', kind: 'order' };
  return null;
}

/**
 * 실제로 보낼 구간. 검사 열쇠·`checkOutput`·`enqueue`·크기 미리보기가 모두 이 값 하나를 쓴다.
 * 접힘·못 읽음·오류·전체를 덮음이면 null(전체 받기). 길이를 모르면 끝 없음(`endMs: null`)을 그대로 둔다.
 */
export function effectiveRange(input: RangeInput, durationSecs: number | null): TimeRangeDto | null {
  if (!input.open || rangeError(input, durationSecs) != null) return null;
  const s = parseClock(input.start) as number;
  const e = input.end.trim() === '' ? null : parseClock(input.end);
  const d = knownMs(durationSecs);
  const f = floorMs(durationSecs);
  if (d != null && f != null) {
    // 끝 칸이 비었거나 보이는(내림) 길이 이상이면 영상 끝(올림)까지. 초깃값 그대로면 전체가 된다
    const endMs = e == null || e >= f ? d : e;
    return s === 0 && endMs === d ? null : { startMs: s, endMs };
  }
  return s === 0 && e == null ? null : { startMs: s, endMs: e };
}

/** 크기 미리보기에 쓸 길이(초). 구간이 없으면 영상 길이 그대로, 끝을 모르면 null(크기 예상 없음) */
export function rangeSecs(range: TimeRangeDto | null, durationSecs: number | null): number | null {
  if (!range) return durationSecs;
  if (range.endMs == null) return null;
  return (range.endMs - range.startMs) / 1000;
}

/** 작업 행 1줄의 구간 조각(content.md §6.5 범위 기호 `~`): `0:10:00~0:20:00`, 끝을 모르면 `0:10:00~` */
export function rangeChip(r: TimeRangeDto): string {
  const start = formatClock(r.startMs / 1000);
  return r.endMs == null ? t('range.chipToEnd', { start }) : t('range.chip', { start, end: formatClock(r.endMs / 1000) });
}

/** 이번 선택으로 실제로 쓸 파일이 번호 붙인 새 이름인가. 받다 만 녹화가 있는 이름은 늘 피한다(core.md 61) */
export function usesFreeName(check: OutputCheck, choices: CardChoices): boolean {
  if (check.freeFileName == null) return false;
  if (check.partial?.recording) return true;
  return check.exists && choices.existing === 'number';
}

/** 카드가 보여 줄 충돌 안내(§8.3 ConflictNotice). 서로 독립이다(§6.4). */
export interface Notices {
  duplicate: boolean;
  exists: boolean;
  /** 같은 작업의 `.part`: 이어서 받는다(처음부터로 바꿀 수 있다) */
  partialSame: number | null;
  /** 다른 화질 등의 `.part`: 안내만(코어가 지우고 새로 받는다) */
  partialOther: boolean;
  /** 다른 작업이 받다 만 녹화가 이 이름에 있다: 지우지 않고 번호 이름으로 받는다 */
  partialRecording: boolean;
}

export function notices(check: OutputCheck, choices: CardChoices): Notices {
  // 번호 붙인 새 이름은 `.part`가 없는 이름이라 받다 만 안내가 해당하지 않는다.
  const fresh = usesFreeName(check, choices);
  const recording = check.partial?.recording === true;
  const p = fresh || recording ? null : check.partial;
  return {
    duplicate: check.duplicateJobId != null,
    // 녹화 때문에 이름이 바뀌면 같은 이름 파일의 번호/덮어쓰기 선택은 뜻이 없다
    exists: check.exists && !recording,
    partialSame: p && p.sameJob ? p.bytes : null,
    partialOther: !!p && !p.sameJob,
    partialRecording: recording,
  };
}

/**
 * `EnqueueRequest`(patterns.md §6.5 표).
 * - 완성 파일이 있음: 번호 → `freeFileName`, 덮어쓰기 → 그 이름 그대로.
 * - `onExisting`: 덮어쓰기를 직접 고른 때만 `overwrite`, 그 밖(충돌 없음·번호 붙인 새 이름)은 `skip`.
 *   검사 뒤 받는 동안 같은 이름의 파일이 생겨도 덮어쓰지 않는다(코어가 덮어쓰지 않고 마무리해 `skipped`로
 *   끝나고, 받은 `.part`는 남아 "덮어쓰고 받기"로 이어받는다).
 * - 구간: `effectiveRange` 값이 있을 때만 `range`(없으면 키 없음 = 전체)
 * - 같은 작업의 `.part`: 이어받기 `restart = false`, 처음부터 `restart = true`.
 * - 다른 `.part`: `restart = false`(코어가 sidecar 불일치로 지우고 새로 시작).
 * - 받다 만 녹화: 늘 `freeFileName`, `restart = false`(녹화는 다시 받을 수 없어 지우지 않는다, core.md 61).
 * 이름은 `check_output`이 정리한 `fileName`을 보낸다(검사한 경로와 같게).
 */
export function buildEnqueueRequest(
  r: ResolvedDto,
  quality: QualityDto,
  folder: string | null,
  check: OutputCheck,
  choices: CardChoices,
  range: TimeRangeDto | null = null,
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
    onExisting: !fresh && check.exists && choices.existing === 'overwrite' ? 'overwrite' : 'skip',
    restart,
    // 최근 영상 둘째 줄의 날짜(바인딩 타입이 string이라 없으면 보내지 않는다)
    contentDate: r.meta.liveOpenDate ?? r.meta.publishDate ?? undefined,
    ...(range ? { range } : {}),
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
  // 받다 만 녹화가 있는 이름은 쓸 수 없는데 빈 번호 이름도 없다
  if (check.partial?.recording && check.freeFileName == null) return false;
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
