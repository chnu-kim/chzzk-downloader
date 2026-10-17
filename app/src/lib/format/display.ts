// 외부 문자열 위생(content.md §13): 화면에 그리기 전 한 곳에서 정리하고, 토스트·접근 이름 안에서는 자소 경계로 자른다.
const STRIP = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g; // BIDI 제어·ZWSP·ZWNJ/ZWJ·LRM/RLM·WJ·격리·BOM·소프트하이픈
const SPACE = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g; // C0/C1·줄·문단 구분 → 공백

export function cleanDisplayText(s: string): string {
  return s.replace(STRIP, '').replace(SPACE, ' ').trim();
}

export function clipGraphemes(s: string, max: number): string {
  const seg =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment)
      : Array.from(s);
  return seg.length <= max ? s : seg.slice(0, max - 1).join('') + '…';
}
