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
    path: '/Movies/VOD Clip Downloader/[251003] 채널이름 - 금요 노가리 방송.mp4',
    truncated: false,
    exists: false,
    freeFileName: null,
    partial: null,
    duplicateJobId: null,
    ...over,
  };
}

/**
 * 영상 카드의 최악 조합(patterns.md §15, governance §2.6): 두 줄로 접히는 긴 제목 + 화질 5 + (시나리오 `outputs`로) 같은 이름 경고.
 * 화면 갤러리(e2e screens/shots)가 쓴다. 실제 채널·영상 값이 아닌 합성 데이터다.
 */
export const WORST_TITLE = '금요 저녁 방송 - 신작 게임 첫 플레이 전체 다시보기 모음 오프닝부터 엔딩까지 쉬지 않고 달린 날의 기록 (2부)';

export function worstCaseResolved(over: Partial<ResolvedDto> = {}): ResolvedDto {
  const base = resolved();
  return resolved({
    meta: { ...base.meta, title: WORST_TITLE },
    suggestedFileName: '[251003] 채널이름 - 금요 저녁 방송 - 신작 게임 첫 플레이 전체 다시보기 모음',
    qualities: [
      quality(),
      quality({ id: 'q720', label: '720p', resolution: 720, width: 1280, height: 720, bandwidth: 4_000_000 }),
      quality({ id: 'q480', label: '480p', resolution: 480, width: 854, height: 480, bandwidth: 2_000_000, frameRate: '30' }),
      quality({ id: 'q360', label: '360p', resolution: 360, width: 640, height: 360, bandwidth: 1_000_000, frameRate: '30' }),
      quality({ id: 'q144', label: '144p', resolution: 144, width: 256, height: 144, bandwidth: null, frameRate: '30' }),
    ],
    ...over,
  });
}
