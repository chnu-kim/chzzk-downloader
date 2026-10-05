import { describe, expect, it } from 'vitest';
import { estimateSize, formatBytes, formatSpeed } from './bytes';
import { formatKstDate, formatKstDateTime, formatTimeOfDay } from './date';
import { formatClock, formatSpan } from './duration';

describe('formatBytes', () => {
  // crates/core/src/progress.rs `format_bytes_golden`과 같은 12건. 고치지 않는다.
  const golden: [number, string][] = [
    [1280, '1.2 KB'],
    [3328, '3.2 KB'],
    [1792, '1.8 KB'],
    [2662, '2.6 KB'],
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048575, '1024.0 KB'],
    [1048576, '1.0 MB'],
    [1073741824, '1.0 GB'],
    [5497558138880, '5.0 TB'],
  ];
  it.each(golden)('코어 golden %d → %s', (n, want) => {
    expect(formatBytes(n)).toBe(want);
  });

  it('2^53 근처와 잘못된 값', () => {
    expect(formatBytes(Number.MAX_SAFE_INTEGER)).toBe('8.0 PB');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(1023.9)).toBe('1023 B');
  });

  it('속도와 예상 크기', () => {
    expect(formatSpeed(13002342)).toBe('12.4 MB/s');
    expect(estimateSize(8_000_000, 3600)).toBe(3_600_000_000);
    expect(estimateSize(null, 3600)).toBeNull();
    expect(estimateSize(8_000_000, null)).toBeNull();
    expect(estimateSize(0, 10)).toBeNull();
  });
});

describe('formatSpan', () => {
  it.each([
    [0, '0초'],
    [45, '45초'],
    [60, '1분'],
    [138, '2분 18초'],
    [840, '14분'],
    [3600, '1시간'],
    [3720, '1시간 2분'],
    [3725, '1시간 2분'],
    [90061, '25시간 1분'],
    [-5, '0초'],
    [59.9, '59초'],
  ] as [number, string][])('%d초 → %s', (s, want) => {
    expect(formatSpan(s)).toBe(want);
  });
});

describe('formatClock', () => {
  it.each([
    [0, '0:00:00'],
    [45, '0:00:45'],
    [11565, '3:12:45'],
    [360000, '100:00:00'],
  ] as [number, string][])('%d → %s', (s, want) => {
    expect(formatClock(s)).toBe(want);
  });
});

describe('날짜', () => {
  it('KST 문자열을 시간대 변환 없이 바꾼다', () => {
    expect(formatKstDateTime('2026-10-03 21:00:00')).toBe('2026.10.03 21:00');
    expect(formatKstDateTime('2026-01-02T03:04:05')).toBe('2026.01.02 03:04');
    expect(formatKstDate('2026-10-03 21:00:00')).toBe('2026.10.03');
    expect(formatKstDateTime('어제')).toBeNull();
    expect(formatKstDateTime(null)).toBeNull();
    expect(formatKstDate('')).toBeNull();
  });

  it('완료 시각은 사용자 시간대의 오전/오후', () => {
    // 2026-10-03 12:41:00 UTC = 21:41 KST
    const t = Date.UTC(2026, 9, 3, 12, 41) / 1000;
    expect(formatTimeOfDay(t, 'Asia/Seoul')).toBe('오후 9:41');
    expect(formatTimeOfDay(t, 'UTC')).toBe('오후 12:41');
    expect(formatTimeOfDay(Date.UTC(2026, 9, 3, 0, 5) / 1000, 'UTC')).toBe('오전 12:05');
  });
});
