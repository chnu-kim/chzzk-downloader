import { UPDATE_NOTES_LINE_MAX_GRAPHEMES, UPDATE_NOTES_MAX_LINES } from '../timing';

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

// 업데이트 "이번 버전에서 바뀐 점"(latest.json notes, 서명되지 않는 일반 텍스트, D69). 셸 `clean_notes`와 같은 순서와 표를 쓰는 이중 방어다
// (mock·e2e는 셸을 거치지 않는다). 줄로 먼저 나눈 뒤 줄마다 정리한다: cleanDisplayText는 `\n`도 공백으로 바꿔 전체에 쓰면 줄이 합쳐진다.
// HTML·마크다운은 해석하지도 지우지도 않는다(호출부가 텍스트 노드로만 그린다).
export function updateNoteLines(notes: string | null): string[] {
  if (!notes) return [];
  const out: string[] = [];
  for (const raw of notes.replace(/\r\n?/g, '\n').split('\n')) {
    let line = cleanDisplayText(raw);
    const marker = /^(?:[-*•]) /.exec(line);
    if (marker) line = line.slice(marker[0].length).trim();
    if (line === '' || line === '-' || line === '*' || line === '•') continue;
    out.push(clipGraphemes(line, UPDATE_NOTES_LINE_MAX_GRAPHEMES));
    if (out.length === UPDATE_NOTES_MAX_LINES) break;
  }
  return out;
}
