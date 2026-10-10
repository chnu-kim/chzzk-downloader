import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  UNIT_GAP,
  WINDOWS_ROUNDING,
  estimateSize,
  formatEstimate,
  formatFileSize,
  formatPercent,
  formatProgressSize,
  formatSpeed,
  formatSpokenPercent,
  formatSpokenSize,
  formatSpokenSpeed,
  sizeBaseOf,
} from './bytes';
import {
  formatAgo,
  formatDate,
  formatDateTime,
  formatWhen,
  parseKstWall,
  wallOf,
} from './date';
import {
  formatClock,
  formatCount,
  formatDaysAgo,
  formatElapsed,
  formatMmss,
  formatRemaining,
  formatSpan,
  formatSpokenRemaining,
} from './duration';

// design/format/*.json 골든: Rust(crates/shell/tests/format_golden.rs)도 같은 파일을 읽는다.
// `fn` 이름 → 함수 표. 표에 없는 fn은 실패한다(JSON에 케이스만 늘고 함수가 빠지는 일을 막는다).
// 인자는 위치 인자 배열이고 `null`은 그대로 넘긴다.
/* eslint-disable @typescript-eslint/no-explicit-any */
const FUNCTIONS: Record<string, (...args: any[]) => unknown> = {
  formatFileSize,
  formatProgressSize,
  formatEstimate,
  formatSpeed,
  formatPercent,
  formatRemaining,
  formatElapsed,
  formatDaysAgo,
  formatSpan,
  formatClock,
  formatMmss,
  formatCount,
  formatDate,
  formatDateTime,
  formatWhen,
  formatAgo,
  parseKstWall,
  wallOf,
  formatSpokenPercent,
  formatSpokenSize,
  formatSpokenSpeed,
  formatSpokenRemaining,
};

interface Case {
  name: string;
  args: unknown[];
  out: unknown;
}

const GOLDEN_DIR = fileURLToPath(new globalThis.URL('../../../../design/format/', import.meta.url));
const goldenFiles = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json')).sort();

describe('골든 JSON (design/format)', () => {
  it('파일이 모두 있다', () => {
    expect(goldenFiles.length).toBeGreaterThanOrEqual(16);
  });

  for (const file of goldenFiles) {
    const doc = JSON.parse(readFileSync(GOLDEN_DIR + file, 'utf8')) as {
      fn?: string;
      cases?: Case[];
      fns?: Record<string, { args: unknown[]; out: unknown }[]>;
    };
    const groups: [string, { name?: string; args: unknown[]; out: unknown }[]][] = doc.fns
      ? Object.entries(doc.fns)
      : [[doc.fn ?? '', doc.cases ?? []]];
    describe(file, () => {
      if (!doc.fns) {
        it('케이스가 8개 이상이다', () => {
          expect(doc.cases?.length ?? 0).toBeGreaterThanOrEqual(8);
        });
      }
      for (const [fnName, cases] of groups) {
        it(`${fnName}은 함수 표에 있다`, () => {
          expect(FUNCTIONS[fnName], `알 수 없는 fn: ${fnName}`).toBeTypeOf('function');
        });
        it.each(cases.map((c, i) => [c.name ?? `#${i}`, c] as const))(`${fnName}: %s`, (_n, c) => {
          const fn = FUNCTIONS[fnName];
          expect(fn(...c.args)).toEqual(c.out);
        });
      }
    });
  }
});

describe('새 크기 표기의 약속', () => {
  it('OS 진법: Windows만 1024', () => {
    expect(sizeBaseOf('windows')).toBe(1024);
    expect(sizeBaseOf('macos')).toBe(1000);
    expect(sizeBaseOf('linux')).toBe(1000);
  });

  it('상수: 단위 붙임, Windows는 반올림(실기 확인 전)', () => {
    expect(UNIT_GAP).toBe('');
    expect(WINDOWS_ROUNDING).toBe('round');
  });

  it('잘못된 값은 0으로 본다', () => {
    expect(formatFileSize(-1, 1000)).toBe('0B');
    expect(formatFileSize(Number.NaN, 1024)).toBe('0B');
    expect(formatPercent(Number.NaN, 100)).toBe('0%');
    expect(formatRemaining(-3)).toBe('곧 끝나요');
    expect(formatCount(-5)).toBe('0');
    expect(formatSpokenPercent(150)).toBe('100퍼센트');
  });

  it('2^53 근처도 정확하다', () => {
    expect(formatFileSize(Number.MAX_SAFE_INTEGER, 1000)).toBe('9007TB');
    expect(formatSpokenSize(Number.MAX_SAFE_INTEGER, 1000)).toBe('9007.2테라바이트');
    expect(formatSpokenSpeed(0, 1024)).toBe('초당 0바이트');
    expect(formatProgressSize(0, null, 1000)).toEqual({ received: '0B', total: null });
    expect(formatEstimate(Number.MAX_SAFE_INTEGER, 1024)).toBe('약 8192.0TB');
  });

  it('날짜 함수는 시간대·Intl을 거치지 않는다', () => {
    expect(wallOf(0, 540)).toEqual({ y: 1970, mo: 1, d: 1, h: 9, mi: 0 });
    expect(parseKstWall('2026-10-03 21:00:00')).toEqual({ y: 2026, mo: 10, d: 3, h: 21, mi: 0 });
    expect(formatAgo(0, 59)).toBe('방금');
    expect(formatDaysAgo(86400 * 3 + 5)).toBe('3일 전에');
    expect(formatElapsed(7200)).toBe('2시간째');
    expect(formatDate(wallOf(1767225600, 0))).toBe('2026. 1. 1.');
    expect(formatDateTime(wallOf(1767225600, 0))).toBe('2026. 1. 1. 오전 12:00');
    expect(formatWhen(wallOf(1767225600, 0), wallOf(1767225600 + 120, 0))).toBe('2분 전');
  });
});

describe('estimateSize', () => {
  it('대역폭 × 재생 시간 / 8, 모르면 null', () => {
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

describe('formatMmss', () => {
  it('분:초(분은 자리 맞춤 없음), 음수·NaN은 0:00', () => {
    expect(formatMmss(600)).toBe('10:00');
    expect(formatMmss(599)).toBe('9:59');
    expect(formatMmss(59)).toBe('0:59');
    for (const v of [0, -5, Number.NaN]) expect(formatMmss(v)).toBe('0:00');
  });
});
