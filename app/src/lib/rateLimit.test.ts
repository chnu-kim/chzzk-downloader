import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_OFF, RATE_LIMIT_PRESETS_MB, rateLimitFromStored, rateLimitOptions, rateLimitToStored } from './rateLimit';

// 최소값(코어 `settings::MIN_RATE_LIMIT_BPS`)과 같다. 프리셋 맨 아래가 두 진법 모두 이 값 이상이어야 한다.
const MIN_RATE_LIMIT_BPS = 1_000_000;

describe('rateLimitOptions', () => {
  it('프리셋이 OS 진법을 따른다(macOS 5 -> 5,000,000, Windows 5 -> 5,242,880)', () => {
    const mac = rateLimitOptions(1000, null, '제한 없음');
    const win = rateLimitOptions(1024, null, '제한 없음');
    expect(mac.find((o) => o.label === '5.0MB/s')?.value).toBe(5_000_000);
    expect(win.find((o) => o.label === '5.0MB/s')?.value).toBe(5_242_880);
  });

  it('라벨은 formatSpeed 결과와 같고 맨 앞은 제한 없음(값 0)이다', () => {
    const o = rateLimitOptions(1000, null, '제한 없음');
    expect(o[0]).toEqual({ value: RATE_LIMIT_OFF, label: '제한 없음' });
    expect(o.slice(1).map((x) => x.label)).toEqual(['1.0MB/s', '2.0MB/s', '5.0MB/s', '10.0MB/s', '20.0MB/s', '50.0MB/s', '100.0MB/s']);
    expect(o).toHaveLength(RATE_LIMIT_PRESETS_MB.length + 1);
  });

  it('덧칸 라벨이 프리셋 라벨과 겹치지 않는다(1000 진법의 1,048,576 -> 1.05MB/s)', () => {
    const o = rateLimitOptions(1000, 1_048_576, '제한 없음');
    expect(o.find((x) => x.value === 1_048_576)?.label).toBe('1.05MB/s');
    // 프리셋 라벨은 그대로다
    expect(o.find((x) => x.value === 1_000_000)?.label).toBe('1.0MB/s');
    // 여러 저장값에서 라벨이 모두 다르다
    for (const base of [1000, 1024] as const) {
      for (const stored of [1_048_576, 1_000_000, 5_000_400, 5_242_880, 5_243_000, 10_485_760, 104_857_600, 100_000_100]) {
        const labels = rateLimitOptions(base, stored, '제한 없음').map((x) => x.label);
        expect(new Set(labels).size, `${base} ${stored}: ${labels.join(',')}`).toBe(labels.length);
      }
    }
  });

  it('프리셋 맨 아래는 두 진법 모두 최소값 이상이다(최소를 구조로 지킨다)', () => {
    for (const base of [1000, 1024] as const) {
      expect(rateLimitOptions(base, null, '-')[1].value).toBeGreaterThanOrEqual(MIN_RATE_LIMIT_BPS);
    }
  });

  it('프리셋에 없는 저장값은 크기 순으로 한 칸 더하고, 있는 값·꺼짐은 더하지 않는다', () => {
    const odd = rateLimitOptions(1000, 3_300_000, '제한 없음');
    expect(odd.map((x) => x.value)).toEqual([0, 1e6, 2e6, 3_300_000, 5e6, 1e7, 2e7, 5e7, 1e8]);
    expect(odd[3].label).toBe('3.3MB/s');
    // 다른 OS에서 옮긴 값(Windows 1 -> 1,048,576)은 macOS에서는 프리셋에 없다
    expect(rateLimitOptions(1000, 1_048_576, '-')).toHaveLength(RATE_LIMIT_PRESETS_MB.length + 2);
    expect(rateLimitOptions(1000, 5_000_000, '-')).toHaveLength(RATE_LIMIT_PRESETS_MB.length + 1);
    expect(rateLimitOptions(1000, null, '-')).toHaveLength(RATE_LIMIT_PRESETS_MB.length + 1);
    expect(rateLimitOptions(1000, 0, '-')).toHaveLength(RATE_LIMIT_PRESETS_MB.length + 1);
  });
});

describe('저장 값 <-> Select 값', () => {
  it('0(제한 없음)은 null, 나머지는 그대로', () => {
    expect(rateLimitToStored(0)).toBeNull();
    expect(rateLimitToStored(5_000_000)).toBe(5_000_000);
    expect(rateLimitFromStored(null)).toBe(0);
    expect(rateLimitFromStored(0)).toBe(0);
    expect(rateLimitFromStored(2_000_000)).toBe(2_000_000);
  });
});
