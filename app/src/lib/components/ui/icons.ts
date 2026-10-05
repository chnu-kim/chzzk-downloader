// 인라인 SVG 아이콘 22개(ui-visual.md §5). viewBox 24, stroke 1.75, round, fill 없음, 색은 currentColor.
// 모양은 Feather Icons(MIT, https://feathericons.com)의 path를 바탕으로 했다. 외부 요청이 없어 CSP와 무관하다.

export interface IconShape {
  /** stroke로 그리는 path들 */
  paths: string[];
  /** 채운 점(cx, cy, r). `more`처럼 stroke로 그리면 너무 작은 것 */
  dots?: [number, number, number][];
}

const ring = (r: number) => `M12 ${12 - r}a${r} ${r} 0 1 0 0 ${2 * r}a${r} ${r} 0 1 0 0 -${2 * r}z`;

export const ICONS = {
  settings: {
    paths: [
      ring(3),
      'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    ],
  },
  'arrow-left': { paths: ['M19 12H5', 'M12 19l-7-7 7-7'] },
  x: { paths: ['M18 6 6 18', 'M6 6l12 12'] },
  spinner: { paths: ['M21 12a9 9 0 1 1-6.22-8.56'] },
  alert: {
    paths: [
      'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
      'M12 9v4',
      'M12 17h.01',
    ],
  },
  info: { paths: [ring(10), 'M12 16v-4', 'M12 8h.01'] },
  check: { paths: ['M20 6 9 17l-5-5'] },
  pause: { paths: ['M6 4h4v16H6z', 'M14 4h4v16h-4z'] },
  play: { paths: ['M6 3l14 9-14 9V3z'] },
  restart: { paths: ['M1 4v6h6', 'M3.51 15a9 9 0 1 0 2.13-9.36L1 10'] },
  folder: { paths: ['M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'] },
  'file-play': {
    paths: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M10 11.5v6l5-3z'],
  },
  more: {
    paths: [],
    dots: [
      [5, 12, 1.5],
      [12, 12, 1.5],
      [19, 12, 1.5],
    ],
  },
  copy: {
    paths: [
      'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z',
      'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    ],
  },
  trash: {
    paths: [
      'M3 6h18',
      'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
      'M10 11v6',
      'M14 11v6',
      'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
    ],
  },
  clipboard: {
    paths: [
      'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
      'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z',
    ],
  },
  // 앱 아이콘과 같은 모티프: 트레이로 내려오는 화살표
  drop: { paths: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'] },
  eye: { paths: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', ring(3)] },
  'eye-off': {
    paths: [
      'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94',
      'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19',
      'M14.12 14.12a3 3 0 1 1-4.24-4.24',
      'M1 1l22 22',
    ],
  },
  'chevron-down': { paths: ['M6 9l6 6 6-6'] },
  'chevron-right': { paths: ['M9 18l6-6-6-6'] },
  external: { paths: ['M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6', 'M15 3h6v6', 'M10 14 21 3'] },
  clock: { paths: [ring(10), 'M12 6v6l4 2'] },
} satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICONS;
