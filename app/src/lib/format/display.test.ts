import { describe, expect, it } from 'vitest';
import { cleanDisplayText, clipGraphemes } from './display';

describe('cleanDisplayText: 외부 이름 위생', () => {
  it('방향 제어(RLO)·ZWSP·BOM·소프트하이픈을 지운다', () => {
    expect(cleanDisplayText('‮이름​﻿­끝')).toBe('이름끝');
  });
  it('줄바꿈·문단 구분(U+2028)은 공백이 되고 앞뒤는 다듬는다', () => {
    expect(cleanDisplayText('  가\n나 다\t ')).toBe('가 나 다');
  });
  it('보통 글자는 그대로다', () => {
    expect(cleanDisplayText('편집자 하나')).toBe('편집자 하나');
  });
});

describe('clipGraphemes: 자소 경계로 자른다', () => {
  it('40자 이하는 그대로', () => {
    const s = '가'.repeat(40);
    expect(clipGraphemes(s, 40)).toBe(s);
  });
  it('41자면 39자와 말줄임표', () => {
    expect(clipGraphemes('가'.repeat(41), 40)).toBe('가'.repeat(39) + '…');
  });
  it('결합 이모지를 쪼개지 않는다', () => {
    const fam = '👩‍👩‍👧';
    expect(clipGraphemes(fam.repeat(3), 2)).toBe(fam + '…');
  });
});
