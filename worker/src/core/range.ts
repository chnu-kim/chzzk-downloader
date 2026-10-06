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
