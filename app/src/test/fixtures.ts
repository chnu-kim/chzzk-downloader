// 받기 화면 테스트용 DTO.
import type { OutputCheck, QualityDto, ResolvedDto } from '../lib/bindings';

export function quality(over: Partial<QualityDto> = {}): QualityDto {
  return {
    id: 'q1080',
    label: '1080p',
    resolution: 1080,
    width: 1920,
    height: 1080,
    bandwidth: 8_000_000,
    frameRate: '60.0',
    ...over,
  };
}

export function resolved(over: Partial<ResolvedDto> = {}): ResolvedDto {
  return {
    url: 'https://chzzk.naver.com/video/1234567',
    content: { kind: 'video', videoNo: 1234567 },
    meta: {
      kind: 'video',
      title: '금요 노가리 방송 - 신작 게임 해보기',
      channelName: '채널이름',
      channelId: 'ch1',
      liveOpenDate: '2026-10-03 21:00:00',
      publishDate: '2026-10-04 01:00:00',
      adult: false,
      durationSecs: 11565,
    },
    playbackKind: 'liveRewindHls',
    qualities: [
      quality(),
      quality({ id: 'q720', label: '720p', resolution: 720, bandwidth: 4_000_000 }),
      quality({ id: 'q480', label: '480p', resolution: 480, bandwidth: null, frameRate: '30' }),
    ],
    defaultQualityIndex: 0,
    suggestedFileName: '[251003] 채널이름 - 금요 노가리 방송',
    ownership: 'unchecked',
    ...over,
  };
}

export function check(over: Partial<OutputCheck> = {}): OutputCheck {
  return {
    fileName: '[251003] 채널이름 - 금요 노가리 방송',
    path: '/Movies/치지직/[251003] 채널이름 - 금요 노가리 방송.mp4',
    truncated: false,
    exists: false,
    freeFileName: null,
    partial: null,
    duplicateJobId: null,
    ...over,
  };
}
