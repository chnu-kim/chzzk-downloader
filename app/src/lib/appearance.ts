// 뿌리 요소의 data 속성(system/foundations.md §3.2·§10, platform.md §3): 글자 크기·모양·비활성 창.
// 토큰 재정의는 생성물 tokens.css가 `:root:where([data-…])`로 한다. 여기서는 속성만 붙이고 뗀다.
import type { Os, TextScale, Theme } from './bindings';

export interface Appearance {
  textScale: TextScale;
  theme: Theme;
}

/**
 * `data-text-scale`: `default`면 뗀다(`large`·`x-large`만 붙인다).
 * `data-theme`: Linux에서 `light`·`dark`를 고른 때만 붙인다(D7: macOS·Windows는 OS를 따르고 설정 행이 없다).
 */
export function applyAppearance(root: HTMLElement, a: Appearance, os: Os): void {
  if (a.textScale === 'default') root.removeAttribute('data-text-scale');
  else root.setAttribute('data-text-scale', a.textScale);
  if (os === 'linux' && a.theme !== 'system') root.setAttribute('data-theme', a.theme);
  else root.removeAttribute('data-theme');
}

/** 비활성 창(macOS만, HIG): 포커스가 없으면 `data-window-active="false"`. 다른 OS에서는 속성을 두지 않는다 */
export function applyWindowActive(root: HTMLElement, focused: boolean, os: Os): void {
  if (os === 'macos') root.setAttribute('data-window-active', String(focused));
  else root.removeAttribute('data-window-active');
}
