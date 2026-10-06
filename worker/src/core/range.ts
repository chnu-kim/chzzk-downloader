// Range 헤더(docs/design/worker.md §9.2, 구현 중 변경 14 (마)). 단일 bytes=a-b·a-·-n만 인정한다.
// 다중 범위·문법 오류·공백·15자리를 넘는 숫자·b<a는 무시(null → 200 전체, RFC 9110 허용).
// 판정(resolveRange)은 크기만 받는 순수 함수라 핸들러가 get 한 번의 obj.size로 부를 수 있다(R2 호출 수 상한, 구현 중 변경 11 (라)).

export type RangeSpec = { readonly start: number; readonly end: number | null } | { readonly suffix: number };
export type ResolvedRange = { readonly offset: number; readonly length: number } | "unsatisfiable";

const RANGE = /^bytes=(\d{0,15})-(\d{0,15})$/i;

/** null = 무시(200 전체) */
export function parseRange(header: string | null): RangeSpec | null {
  if (header === null) return null;
  const m = RANGE.exec(header);
  if (!m) return null;
  const a = m[1] ?? "";
  const b = m[2] ?? "";
  if (a === "" && b === "") return null;
  if (a === "") return { suffix: Number(b) };
  const start = Number(a);
  if (b === "") return { start, end: null };
  const end = Number(b);
  if (end < start) return null;
  return { start, end };
}

/** 크기가 size인 객체에 대한 판정. size 0은 늘 만족 불가(릴리스 파일은 비지 않는다) */
export function resolveRange(spec: RangeSpec, size: number): ResolvedRange {
  if (!Number.isSafeInteger(size) || size <= 0) return "unsatisfiable";
  if ("suffix" in spec) {
    if (spec.suffix <= 0) return "unsatisfiable";
    const length = Math.min(spec.suffix, size);
    return { offset: size - length, length };
  }
  if (spec.start >= size) return "unsatisfiable";
  const last = Math.min(spec.end ?? size - 1, size - 1);
  return { offset: spec.start, length: last - spec.start + 1 };
}

/** "bytes a-b/size" */
export function contentRange(r: { readonly offset: number; readonly length: number }, size: number): string {
  return `bytes ${r.offset}-${r.offset + r.length - 1}/${size}`;
}

// 416 응답의 Content-Range(bytes */size)
export function unsatisfiedRange(size: number): string {
  return `bytes */${size}`;
}

/** 인정된 spec → 정규화된 Range 헤더 값. R2에 요청 헤더를 그대로 넘기지 않는다(R2는 공백·대문자 단위도 받아 위 판정과 어긋난다, 구현 중 변경 30 (가)) */
export function rangeHeader(spec: RangeSpec): string {
  if ("suffix" in spec) return `bytes=-${spec.suffix}`;
  return spec.end === null ? `bytes=${spec.start}-` : `bytes=${spec.start}-${spec.end}`;
}

/** R2가 돌려준 obj.range(모양이 셋: offset·length / offset만 / suffix)를 {offset,length}로. undefined는 전체 */
export function normalizeR2Range(
  r: { readonly offset?: number; readonly length?: number; readonly suffix?: number } | undefined,
  size: number,
): { readonly offset: number; readonly length: number } {
  if (r === undefined) return { offset: 0, length: size };
  if (r.suffix !== undefined) {
    const n = Math.min(r.suffix, size);
    return { offset: size - n, length: n };
  }
  const offset = r.offset ?? 0;
  // 끝이 크기를 넘는 요청 길이를 그대로 되돌려도 객체 끝에서 자른다(본문은 크기를 넘을 수 없다, 구현 중 변경 33 (가))
  return { offset, length: Math.max(0, Math.min(r.length ?? size - offset, size - offset)) };
}
