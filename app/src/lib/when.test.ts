import { describe, expect, it } from 'vitest';
import { dayText, localOffsetMin, whenText } from './when';

// 2025-10-05 12:41 UTC = 21:41 KST(오프셋 540분)
const T = Date.UTC(2025, 9, 5, 12, 41) / 1000;

describe('whenText: 사용자 시간대 오프셋으로 최근 표기를 낸다', () => {
  it('같은 해 지난 날은 연도 없는 날짜, 시간대마다 시각이 다르다', () => {
    const now = (T + 3 * 86400) * 1000;
    expect(whenText(T, now, 540)).toBe('10월 5일 오후 9:41');
    expect(whenText(T, now, 0)).toBe('10월 5일 오후 12:41');
  });

  it('오늘이면 방금·N분 전·N시간 전, 어제면 어제, 해가 다르면 연도를 붙인다', () => {
    expect(whenText(T, T * 1000 + 30_000, 540)).toBe('방금');
    expect(whenText(T, (T + 5 * 60) * 1000, 540)).toBe('5분 전');
    expect(whenText(T, (T + 2 * 3600) * 1000, 540)).toBe('2시간 전');
    expect(whenText(T, (T + 86400) * 1000, 540)).toBe('어제 오후 9:41');
    expect(whenText(T, (T + 400 * 86400) * 1000, 540)).toBe('2025. 10. 5. 오후 9:41');
  });

  it('기본 오프셋은 실행 환경의 시간대다', () => {
    expect(localOffsetMin()).toBe(-new Date().getTimezoneOffset());
    expect(whenText(T, (T + 3 * 86400) * 1000)).toBe(whenText(T, (T + 3 * 86400) * 1000, localOffsetMin()));
  });
});

describe('dayText: 날짜만, 사용자 시간대 오프셋으로 경계를 가른다', () => {
  // 2026-10-23 23:59 UTC = KST 10월 24일 08:59
  const edge = Date.UTC(2026, 9, 23, 23, 59) / 1000;
  const now = Date.UTC(2026, 9, 16, 0, 0);
  it('KST(540분)에서는 다음 날로 넘어간다', () => {
    expect(dayText(edge, now, 540)).toBe('10월 24일');
    expect(dayText(edge, now, 0)).toBe('10월 23일');
  });
  it('다른 해는 연도를 붙인다', () => {
    expect(dayText(Date.UTC(2027, 0, 2, 3) / 1000, now, 540)).toBe('2027년 1월 2일');
  });
});
