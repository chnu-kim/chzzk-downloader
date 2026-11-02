import { describe, expect, it } from 'vitest';
import { noticeSpeech, toastSpeech } from './spoken';

describe('알림 낭독 문장', () => {
  it('동작이 없으면 글 그대로, 있으면 끝 마침표를 떼고 이어 ".."를 만들지 않는다', () => {
    expect(noticeSpeech('저장했어요')).toBe('저장했어요');
    expect(noticeSpeech('중단된 작업이 있어요.', '모두 이어받기')).toBe('중단된 작업이 있어요. ‘모두 이어받기’ 버튼이 있어요');
  });

  it('undo 토스트: Windows·Linux는 Ctrl+Z, macOS는 버튼 이름만', () => {
    const item = { message: '지웠어요.', action: { label: '되돌리기', run: () => {} }, undo: true as const };
    expect(toastSpeech(item, 'linux')).toBe('지웠어요. Ctrl+Z 키로 되돌릴 수 있어요');
    expect(toastSpeech(item, 'windows')).toBe('지웠어요. Ctrl+Z 키로 되돌릴 수 있어요');
    expect(toastSpeech(item, 'macos')).toBe('지웠어요. ‘되돌리기’ 버튼이 있어요');
  });
});
