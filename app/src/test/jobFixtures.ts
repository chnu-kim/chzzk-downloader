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
