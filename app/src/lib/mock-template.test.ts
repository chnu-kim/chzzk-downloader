// 웹 E2E 가짜 백엔드의 파일 이름 규칙 흉내가 골든(design/naming/template.json)에 없는 입력을 조용히 받아 주지 않는지
// 확인한다. 받아 주면 E2E가 실제 셸과 다른 값을 기대한 채 통과한다.
import { describe, expect, it } from 'vitest';
import { previewTemplate, suggestedNameFor } from '../../e2e/mock/backend';
import { resolved } from '../test/fixtures';

describe('가짜 백엔드: 파일 이름 규칙', () => {
  it('골든 preview 표에 있는 입력만 답하고, 없는 입력(잘못된 규칙 포함)은 실패한다', () => {
    expect(previewTemplate('{prefix} {channel} - {title}').status).toBe('ok');
    expect(previewTemplate('{foo}')).toEqual({ status: 'invalid', error: { kind: 'unknownToken', token: 'foo' } });
    for (const unknown of ['{bar}', '{title', '', '{title}x']) {
      expect(() => previewTemplate(unknown), unknown).toThrow(/골든/);
    }
  });

  it('카드 제안 이름은 불러온 영상의 메타에 적용한 이름이다(예시 영상의 이름이 아니다)', () => {
    const r = resolved();
    expect(suggestedNameFor('{date}_{channel}_{title}', r.meta)).toBe('261003_채널이름_금요 노가리 방송 - 신작 게임 해보기');
    // 골든 예시 영상(제목 '저녁 방송')의 이름이 아니다
    expect(suggestedNameFor('{date}_{channel}_{title}', r.meta)).not.toContain('저녁 방송');
  });

  it('규칙·영상 조합이 골든에 없으면 다른 영상의 이름을 대신 주지 않고 실패한다', () => {
    const r = resolved();
    expect(() => suggestedNameFor('{title}', r.meta)).toThrow(/골든/);
    expect(() => suggestedNameFor('{date}_{channel}_{title}', { ...r.meta, title: '다른 제목' })).toThrow(/골든/);
    // 날짜 둘 중 하나만 달라도 같은 영상이 아니다(게시일은 시작일이 없을 때만 쓰이지만 메타는 통째로 맞춘다)
    expect(() => suggestedNameFor('{date}_{channel}_{title}', { ...r.meta, publishDate: null })).toThrow(/골든/);
  });
});
