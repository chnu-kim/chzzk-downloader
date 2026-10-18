// 받기 속도 상한 프리셋(rate-limit.md §6.1, R7). 저장 단위는 바이트/초이고 화면은 OS 진법의 MB를 곱해 만든다.
// 라벨은 `formatSpeed`가 만든다(copy deck에 숫자·단위를 쓰지 않는다, content.md W5).

import { formatSpeed, type SizeBase } from './format/bytes';

/** 프리셋 단계(MB/s). [잠정] 쓰는 사람의 회선 분포 근거가 없다(rate-limit.md §13). 맨 앞이 최소값(1MB/s) 이상이어야 한다. */
export const RATE_LIMIT_PRESETS_MB = [1, 2, 5, 10, 20, 50, 100] as const;

/** `Select`의 "제한 없음" 값(저장 값은 `null`). */
export const RATE_LIMIT_OFF = 0;

export interface RateLimitOption {
  value: number;
  label: string;
}

/**
 * 설정 › 받기의 속도 Select 옵션. 맨 앞은 "제한 없음"(값 0), 이어서 프리셋(`n × base²` 바이트/초).
 * 저장된 값이 프리셋에 없으면(손으로 고친 설정, 다른 OS에서 옮긴 설정) 그 값을 크기 순 자리에 한 칸 더해
 * 조용히 다른 값으로 보이지 않게 한다.
 */
export function rateLimitOptions(base: SizeBase, stored: number | null, offLabel: string): RateLimitOption[] {
  const unit = base * base;
  const presets = RATE_LIMIT_PRESETS_MB.map((n) => n * unit);
  const values = stored != null && stored > 0 && !presets.includes(stored) ? [...presets, stored].sort((a, b) => a - b) : presets;
  return [{ value: RATE_LIMIT_OFF, label: offLabel }, ...values.map((v) => ({ value: v, label: formatSpeed(v, base) }))];
}

/** `Select` 값 → 저장 값. 0(제한 없음)은 끔(`null`)이다. */
export function rateLimitToStored(v: number): number | null {
  return v > 0 ? v : null;
}

/** 저장 값 → `Select` 값. */
export function rateLimitFromStored(v: number | null): number {
  return v != null && v > 0 ? v : RATE_LIMIT_OFF;
}
