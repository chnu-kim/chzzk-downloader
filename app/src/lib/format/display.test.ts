import { describe, expect, it } from 'vitest';
import { cleanDisplayText, clipGraphemes, updateNoteLines } from './display';

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

describe('updateNoteLines: 업데이트 바뀐 점(셸 clean_notes와 같은 표)', () => {
  it('없거나 비면 빈 목록이다', () => {
    expect(updateNoteLines(null)).toEqual([]);
    expect(updateNoteLines('')).toEqual([]);
    expect(updateNoteLines('  \n\t\r\n \n')).toEqual([]);
    expect(updateNoteLines('-\n- \n* \n')).toEqual([]);
  });
  it('줄로 먼저 나눈 뒤 정리한다: 줄바꿈이 공백으로 합쳐지지 않고 표시 하나는 뗀다', () => {
    expect(updateNoteLines('- a\r\n* b\n\n\u2022 c')).toEqual(['a', 'b', 'c']);
    expect(updateNoteLines('a\rb')).toEqual(['a', 'b']);
    expect(updateNoteLines('메모')).toEqual(['메모']);
  });
  it('앞 5줄만 남긴다(빈 줄은 세지 않고 "외 n개"는 만들지 않는다)', () => {
    expect(updateNoteLines('1\n2\n3\n4\n5\n6\n7')).toEqual(['1', '2', '3', '4', '5']);
    expect(updateNoteLines('a\n\nb\n\nc\n\nd\n\ne\n\nf')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('줄마다 자소 80개로 자른다', () => {
    const out = updateNoteLines('가'.repeat(200))[0];
    expect([...out]).toHaveLength(80);
    expect(out.endsWith('…')).toBe(true);
    const exact = '나'.repeat(80);
    expect(updateNoteLines(exact)).toEqual([exact]);
    // 결합 문자는 앞 글자와 한 자소다(ZWJ는 cleanDisplayText가 지우므로 이모지 가족 대신 결합 악센트로 본다)
    const accent = 'e\u0301';
    expect(updateNoteLines(accent.repeat(100) + '끝')[0]).toBe(accent.repeat(79) + '…');
  });
  it('BIDI·ZWSP·소프트하이픈·BOM은 지우고 탭은 공백이 되며, HTML·마크다운은 글자 그대로다', () => {
    expect(updateNoteLines('\uFEFFa\u202Eb\u200Bc\u00ADd\t')).toEqual(['abcd']);
    expect(updateNoteLines('a\tb')).toEqual(['a b']);
    expect(updateNoteLines('<b>x</b>\n[a](https://x.invalid)')).toEqual(['<b>x</b>', '[a](https://x.invalid)']);
  });
});
