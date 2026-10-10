// 아이콘 원천(docs/design/system/foundations.md §9). Lucide(ISC, 일부 Feather MIT) lucide-static의 SVG를 그대로 벤더링했다.
// 고지는 licenses/lucide.txt와 설정 › 정보. 모든 도형(circle·rect·line)은 path d로 바꿨다: 굵기는 CSS
// `.icon path { stroke-width: var(--icon-stroke) }`가, 화면 px 고정은 Icon.svelte의 path마다 붙은 vector-effect가 맡는다(DI3).
// 항목마다 { set, name, version } 메타가 있고 버전은 하나다(design-icons DI1). 새 아이콘은 foundations §9.1 은유 표에 먼저 넣는다.
// 다시 만들기: lucide-static@<version>의 icons/<name>.svg에서 요소를 path d로 옮긴다(좌표·순서 그대로).

export interface IconDef {
  set: 'lucide';
  name: string;
  version: string;
  /** stroke로 그리는 path d. fill·stroke·stroke-width 속성은 두지 않는다 */
  paths: readonly string[];
}

export const ICON_SET_VERSION = '1.48.0';

export const ICONS = {
  x: { set: 'lucide', name: 'x', version: '1.48.0', paths: [
    'M18 6 6 18',
    'm6 6 12 12',
  ] },
  ellipsis: { set: 'lucide', name: 'ellipsis', version: '1.48.0', paths: [
    'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0z',
    'M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0z',
    'M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0z',
  ] },
  'chevron-down': { set: 'lucide', name: 'chevron-down', version: '1.48.0', paths: [
    'm6 9 6 6 6-6',
  ] },
  'chevron-up': { set: 'lucide', name: 'chevron-up', version: '1.48.0', paths: [
    'm18 15-6-6-6 6',
  ] },
  'chevron-left': { set: 'lucide', name: 'chevron-left', version: '1.48.0', paths: [
    'm15 18-6-6 6-6',
  ] },
  'chevron-right': { set: 'lucide', name: 'chevron-right', version: '1.48.0', paths: [
    'm9 18 6-6-6-6',
  ] },
  eye: { set: 'lucide', name: 'eye', version: '1.48.0', paths: [
    'M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0',
    'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z',
  ] },
  'eye-off': { set: 'lucide', name: 'eye-off', version: '1.48.0', paths: [
    'M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49',
    'M14.084 14.158a3 3 0 0 1-4.242-4.242',
    'M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143',
    'm2 2 20 20',
  ] },
  'arrow-left': { set: 'lucide', name: 'arrow-left', version: '1.48.0', paths: [
    'm12 19-7-7 7-7',
    'M19 12H5',
  ] },
  settings: { set: 'lucide', name: 'settings', version: '1.48.0', paths: [
    'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
    'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0z',
  ] },
  download: { set: 'lucide', name: 'download', version: '1.48.0', paths: [
    'M12 15V3',
    'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4',
    'm7 10 5 5 5-5',
  ] },
  pause: { set: 'lucide', name: 'pause', version: '1.48.0', paths: [
    'M15 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z',
    'M6 3h3a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-3a1 1 0 0 1 -1 -1v-16a1 1 0 0 1 1 -1z',
  ] },
  play: { set: 'lucide', name: 'play', version: '1.48.0', paths: [
    'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z',
  ] },
  'rotate-cw': { set: 'lucide', name: 'rotate-cw', version: '1.48.0', paths: [
    'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8',
    'M21 3v5h-5',
  ] },
  'circle-x': { set: 'lucide', name: 'circle-x', version: '1.48.0', paths: [
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z',
    'm15 9-6 6',
    'm9 9 6 6',
  ] },
  'trash-2': { set: 'lucide', name: 'trash-2', version: '1.48.0', paths: [
    'M10 11v6',
    'M14 11v6',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
    'M3 6h18',
    'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  ] },
  'file-video': { set: 'lucide', name: 'file-video', version: '1.48.0', paths: [
    'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z',
    'M14 2v5a1 1 0 0 0 1 1h5',
    'M15.033 13.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56v-4.704a.645.645 0 0 1 .967-.56z',
  ] },
  folder: { set: 'lucide', name: 'folder', version: '1.48.0', paths: [
    'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  ] },
  'clipboard-paste': { set: 'lucide', name: 'clipboard-paste', version: '1.48.0', paths: [
    'M11 14h10',
    'M16 4h2a2 2 0 0 1 2 2v1.344',
    'm17 18 4-4-4-4',
    'M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113',
    'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z',
  ] },
  copy: { set: 'lucide', name: 'copy', version: '1.48.0', paths: [
    'M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z',
    'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2',
  ] },
  'triangle-alert': { set: 'lucide', name: 'triangle-alert', version: '1.48.0', paths: [
    'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
    'M12 9v4',
    'M12 17h.01',
  ] },
  info: { set: 'lucide', name: 'info', version: '1.48.0', paths: [
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z',
    'M12 16v-4',
    'M12 8h.01',
  ] },
  check: { set: 'lucide', name: 'check', version: '1.48.0', paths: [
    'M20 6 9 17l-5-5',
  ] },
  'circle-check': { set: 'lucide', name: 'circle-check', version: '1.48.0', paths: [
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z',
    'm16 9-5.5 5.5L8 12',
  ] },
  clock: { set: 'lucide', name: 'clock', version: '1.48.0', paths: [
    'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z',
    'M12 6v6l4 2',
  ] },
  'log-in': { set: 'lucide', name: 'log-in', version: '1.48.0', paths: [
    'm10 17 5-5-5-5',
    'M15 12H3',
    'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4',
  ] },
  monitor: { set: 'lucide', name: 'monitor', version: '1.48.0', paths: [
    'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z',
    'M8 21L16 21',
    'M12 17L12 21',
  ] },
  'external-link': { set: 'lucide', name: 'external-link', version: '1.48.0', paths: [
    'M15 3h6v6',
    'M10 14 21 3',
    'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  ] },
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
