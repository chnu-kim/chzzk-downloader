// ui/ 컴포넌트 prop 어휘의 유일한 원천(docs/design/system/components.md §1, governance DP1).
// 배열은 `export const NAME = [ … ] as const;` 평평한 꼴만 쓴다: design-lint(DP1·DP2·DP5)와 spec-check(DX23)가
// 정규식으로 읽는다(타입 주석·중첩·계산 금지). 값을 더하면 갤러리(src/gallery)가 그 조합을 보여야 한다(design-gallery).

import type { IconName } from './icons';

// ---- 외형(variant): 컴포넌트마다 따로. design-lint DP1은 `<컴포넌트 variant=…>`를 그 컴포넌트의 배열로 본다
export const BUTTON_VARIANT = ['primary', 'secondary', 'ghost'] as const;
export const NOTICE_VARIANT = ['inline', 'banner', 'row', 'toast'] as const;
export const SURFACE_VARIANT = ['group', 'card'] as const;
export const DISCLOSURE_VARIANT = ['section', 'inline'] as const;
export const EMPTY_STATE_VARIANT = ['inline', 'panel', 'page'] as const;
export const SKELETON_VARIANT = ['line', 'title', 'control', 'row'] as const;
export const PAGE_CONTAINER_VARIANT = ['content', 'reading'] as const;
/** Menu 트리거 모양(prop 이름은 trigger) */
export const MENU_TRIGGER = ['icon', 'text'] as const;

// ---- 의미·크기·종류·진행 상태
export const TONE = ['neutral', 'info', 'warning', 'danger'] as const;
export const SIZE = ['sm', 'md', 'lg'] as const;
export const KIND = ['vod', 'clip', 'rewind', 'adult'] as const;
export const PROGRESS_STATE = ['active', 'paused', 'failed', 'waiting'] as const;

/** ui/ 컴포넌트가 가질 수 있는 불리언 prop 전부(DP2). HTML·ARIA 상태와 같은 뜻만 */
export const BOOLEAN_PROPS = ['disabled', 'open', 'loading', 'required', 'readonly', 'invalid'] as const;

/** 글자 없는 아이콘 버튼에 쓸 수 있는 모양(foundations §9 표가 원천, DX23·DI7·DP5) */
export const ICON_BUTTON_ICONS = ['x', 'ellipsis', 'chevron-down', 'chevron-up', 'chevron-left', 'chevron-right', 'eye', 'eye-off', 'arrow-left', 'settings'] as const;

export type ButtonVariant = (typeof BUTTON_VARIANT)[number];
export type NoticeVariant = (typeof NOTICE_VARIANT)[number];
export type SurfaceVariant = (typeof SURFACE_VARIANT)[number];
export type DisclosureVariant = (typeof DISCLOSURE_VARIANT)[number];
export type EmptyStateVariant = (typeof EMPTY_STATE_VARIANT)[number];
export type SkeletonVariant = (typeof SKELETON_VARIANT)[number];
export type PageContainerVariant = (typeof PAGE_CONTAINER_VARIANT)[number];
export type MenuTrigger = (typeof MENU_TRIGGER)[number];
export type Tone = (typeof TONE)[number];
export type Size = (typeof SIZE)[number];
export type Kind = (typeof KIND)[number];
export type ProgressState = (typeof PROGRESS_STATE)[number];
export type IconButtonIcon = (typeof ICON_BUTTON_ICONS)[number];

// IconButton 허용 모양이 실제 아이콘인지 타입으로 확인한다
const _iconButtonIconsExist: readonly IconName[] = ICON_BUTTON_ICONS;
void _iconButtonIconsExist;

/**
 * 접근 이름(§1 "접근 이름"): 보이지 않는 이름 `label`(aria-label) 또는 보이는 라벨 요소의 id `labelledby` 중 정확히 하나.
 * 이름 없는 입력·진행 막대는 컴파일되지 않는다.
 */
export type NameProps = { label: string; labelledby?: never } | { labelledby: string; label?: never };

/** 오류 표시는 설명 요소가 반드시 있어야 한다(§0.3 invalid). TextField·SecretField·Select가 교차한다 */
export type InvalidProps = { invalid: true; 'aria-describedby': string } | { invalid?: false };

/**
 * 동작 하나(Dialog primary·secondary, Notice actions, EmptyState action, Toast action).
 * 라벨은 copy deck 값을 호출부가 넣는다. id는 {#each} 키다(라벨은 바뀌고 겹칠 수 있다).
 */
export interface Action {
  id: string;
  label: string;
  onclick: () => void;
}
export type DialogAction = Action;
export type NoticeAction = Action;
