import { describe, expect, it } from 'vitest';
import { jobRowName } from './jobRow';

describe('jobRowName', () => {
  it('제목의 정규식 문자를 이스케이프하고 제목 전체까지 맞춘다', () => {
    const re = jobRowName('(1부) 영상');
    expect(re.test('‘(1부) 영상’: 받는 중')).toBe(true);
    expect(re.test('‘(1부) 영상’: 받는 중, 50퍼센트')).toBe(true);
    expect(re.test('‘(1부) 영상 2’: 받는 중')).toBe(false);
    expect(re.test('‘x(1부) 영상’: 받는 중')).toBe(false);
  });
});
