// 다운로드 목록 테스트용 DTO.
import type { AppError, AuthStatusDto, JobDto, ProgressDto } from '../lib/bindings';

export function prog(over: Partial<ProgressDto> = {}): ProgressDto {
  return {
    phase: 'downloading',
    bytes: 2_469_606_195,
    totalBytes: 4_294_967_296,
    totalBytesEstimate: null,
    segmentsDone: null,
    segmentsTotal: null,
    mediaSecsDone: null,
    mediaSecsTotal: null,
    speedBps: 13_002_342,
    etaSecs: 138,
    resumedFrom: 0,
    refreshes: 0,
    ...over,
  };
}

export function hlsProg(over: Partial<ProgressDto> = {}): ProgressDto {
  return prog({
    bytes: 1_288_490_189,
    totalBytes: null,
    totalBytesEstimate: 5_476_083_302,
    segmentsDone: 1210,
    segmentsTotal: 5580,
    mediaSecsDone: 2420,
    mediaSecsTotal: 11160,
    speedBps: 8_493_465,
    etaSecs: 840,
    ...over,
  });
}

export function job(id: number, over: Partial<JobDto> = {}): JobDto {
  return {
    id,
    url: `https://chzzk.naver.com/video/${id}`,
    title: `영상 ${id}`,
    channelName: '채널',
    channelId: null,
    kind: 'video',
    playbackKind: 'progressive',
    qualityLabel: '1080p',
    output: `/v/${id}.mp4`,
    status: 'queued',
    progress: null,
    error: null,
    partialBytes: null,
    finalBytes: null,
    missing: false,
    createdAt: id,
    finishedAt: null,
    stoppedAt: null,
    ...over,
  };
}

export function err(code: AppError['code'], over: Partial<AppError> = {}): AppError {
  return { code, message: code, stage: 'download', resumable: false, payload: null, ...over };
}

/** 로그인한 사용자 상태(소유 판정·막힌 작업 테스트용) */
export function signedInAs(channelId: string | null, channelName: string | null = '내 채널'): AuthStatusDto {
  return {
    state: 'signedIn',
    channelId,
    channelName,
    reason: null,
    pending: null,
    offline: null,
    verifiedAt: null,
    canReconnect: false,
  };
}

// ───────────────────────── 화면 갤러리(e2e screens/shots)용 목록 ─────────────────────────
// 실제 채널·영상 값이 아닌 합성 데이터다.

/** 앞 40자가 같고 끝만 다른 제목 둘(2줄 clamp 뒤에도 구별되는지 본다) */
export const SAME_PREFIX_TITLES = [
  '금요 저녁 방송 - 신작 게임 첫 플레이 전체 다시보기 모음 오프닝부터 엔딩까지 쉬지 않고 달린 날 (1부)',
  '금요 저녁 방송 - 신작 게임 첫 플레이 전체 다시보기 모음 오프닝부터 엔딩까지 쉬지 않고 달린 날 (2부)',
] as const;

/** 다른 채널 작업(막힌 작업) 판정에 쓰는 채널 ID: 로그인한 채널과 다르다 */
export const OTHER_CHANNEL_ID = '000000000000000000000000000000c3';
export const MY_CHANNEL_ID = '000000000000000000000000000000a1';

/**
 * patterns.md §3.2 표의 상태 전부(연결 대기와 멈춘 지 30일 행 포함). 회복 직후 행은 스토어가 시계로 만드는 상태라 고정 데이터에 없다
 * (단위 테스트와 e2e가 본다). 순서가 곧 id다. `me`가 있으면 다른 채널의 멈춘 작업(막힌 작업) 한 행을 더한다.
 * `base`는 현재 시각(초): 멈춘 지 30일 행의 `stoppedAt`이 이것에서 45일 전이라 화면 글자가 실행마다 같다.
 */
export function jobStateSet(me = false, base = 1_767_322_800): JobDto[] {
  const jobs: JobDto[] = [
    job(1, { title: SAME_PREFIX_TITLES[0], status: 'running', playbackKind: 'liveRewindHls', progress: hlsProg() }),
    job(2, { title: '준비 중인 영상', status: 'running', progress: prog({ phase: 'resolving', bytes: 0, totalBytes: null, speedBps: null, etaSecs: null }) }),
    job(3, { title: '링크를 새로 받는 영상', status: 'running', progress: prog({ phase: 'reresolving' }) }),
    job(4, { title: '마무리하는 영상', status: 'running', progress: prog({ phase: 'finalizing', bytes: 4_294_967_296 }) }),
    job(5, { title: '멈추는 중인 영상', status: 'pausing', partialBytes: 1_288_490_189, progress: prog() }),
    job(6, { title: SAME_PREFIX_TITLES[1], status: 'queued' }),
    job(7, { title: '대기 중인 영상', status: 'queued' }),
    job(8, { title: '일시정지한 영상', status: 'paused', partialBytes: 2_469_606_195, progress: prog() }),
    job(9, { title: '중단된 영상', status: 'interrupted', partialBytes: 1_288_490_189, progress: hlsProg(), playbackKind: 'liveRewindHls' }),
    job(10, { title: '네트워크가 끊긴 영상', status: 'failed', error: err('network', { resumable: true }), partialBytes: 1_288_490_189, progress: prog(), finishedAt: base + 10 }),
    job(11, { title: '디스크가 가득 찬 영상', status: 'failed', error: err('diskFull'), finishedAt: base + 11 }),
    job(12, { title: '완료한 영상', status: 'completed', finalBytes: 4_294_967_296, finishedAt: base + 12 }),
    job(13, { title: '파일이 사라진 영상', status: 'completed', finalBytes: 2_147_483_648, missing: true, finishedAt: base + 13 }),
    job(14, { title: '같은 이름이 있어 받지 않은 영상', status: 'skipped', finishedAt: base + 14 }),
    job(15, { title: '받는 동안 같은 이름이 생긴 영상', status: 'skipped', partialBytes: 1024, finishedAt: base + 15 }),
    job(16, { title: '클립', kind: 'clip', status: 'completed', finalBytes: 52_428_800, finishedAt: base + 16, qualityLabel: '720p' }),
  ];
  jobs.push(
    job(17, { title: '연결을 기다리는 영상', status: 'running', progress: prog({ phase: 'waitingNetwork', speedBps: null, etaSecs: null }) }),
    job(18, { title: '오래전에 멈춘 영상', status: 'paused', partialBytes: 1_288_490_189, progress: prog(), stoppedAt: base - 45 * 86400 }),
  );
  if (me) jobs.push(job(19, { title: '다른 채널로 받던 영상', status: 'interrupted', channelId: OTHER_CHANNEL_ID, partialBytes: 1024, progress: prog() }));
  return jobs;
}

/** 완료 `n`개(기본 12 = 접는 개수 11을 넘는다): 완료 그룹이 기본 접힘이고 최신 5개만 미리 보인다 */
export function finishedSet(n = 12): JobDto[] {
  return Array.from({ length: n }, (_, i) =>
    job(i + 1, { title: `완료한 영상 ${i + 1}`, status: 'completed', finalBytes: 1_073_741_824 * (i + 1), finishedAt: 1_767_322_800 + i }),
  );
}
