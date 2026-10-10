/* 생성물. 원천 design/tokens/·design/ui.css, 생성기 scripts/design/tokens.mjs. 손으로 고치지 않는다 */
export const SITE_CSS = `/* [root] 라이트 기본값. ref 팔레트와 sys 토큰 */
:root {
  color-scheme: light dark;
  --ref-gray-220: #1B1B1B;
  --ref-gray-240: #1F1F1F;
  --ref-gray-290: #2B2B2B;
  --ref-gray-320: #333333;
  --ref-gray-350: #3A3A3A;
  --ref-gray-400: #484848;
  --ref-gray-480: #5D5D5D;
  --ref-gray-540: #6F6F6F;
  --ref-gray-600: #808080;
  --ref-gray-620: #868686;
  --ref-gray-700: #9E9E9E;
  --ref-gray-720: #A4A4A4;
  --ref-gray-890: #DBDBDB;
  --ref-gray-930: #E8E8E8;
  --ref-gray-965: #F3F3F3;
  --ref-white: #FFFFFF;
  --ref-blue-33: #233651;
  --ref-blue-48: #0056C5;
  --ref-blue-50: #085DC7;
  --ref-blue-54: #0067DF;
  --ref-blue-57: #1E72E4;
  --ref-blue-74: #70ADFB;
  --ref-blue-95: #E2F0FF;
  --ref-red-33: #502824;
  --ref-red-52: #BE2323;
  --ref-red-53: #C51E21;
  --ref-red-56: #CC3430;
  --ref-red-75: #FA8880;
  --ref-red-95: #FFE7E4;
  --ref-amber-33: #433215;
  --ref-amber-51: #945500;
  --ref-amber-78: #E8AA4E;
  --ref-amber-96: #FFF0D4;
  --ref-black-a8: rgba(0, 0, 0, 0.08);
  --ref-black-a10: rgba(0, 0, 0, 0.10);
  --ref-black-a30: rgba(0, 0, 0, 0.30);
  --ref-black-a50: rgba(0, 0, 0, 0.50);
  --ref-white-a8: rgba(255, 255, 255, 0.08);
  --ref-white-a10: rgba(255, 255, 255, 0.10);
  --bg: var(--ref-gray-965);
  --surface: var(--ref-white);
  --surface-2: var(--ref-gray-930);
  --surface-pressed: var(--ref-gray-890);
  --raised: var(--ref-white);
  --track: var(--ref-gray-930);
  --fg: var(--ref-gray-220);
  --fg-muted: var(--ref-gray-480);
  --fg-disabled: var(--ref-gray-700);
  --separator: var(--ref-black-a10);
  --border-strong: var(--ref-gray-600);
  --accent: var(--ref-blue-54);
  --accent-pressed: var(--ref-blue-48);
  --accent-ink: var(--ref-blue-50);
  --accent-soft: var(--ref-blue-95);
  --on-accent: var(--ref-white);
  --danger: var(--ref-red-53);
  --danger-ink: var(--ref-red-52);
  --danger-soft: var(--ref-red-95);
  --warning-ink: var(--ref-amber-51);
  --warning-soft: var(--ref-amber-96);
  --focus: var(--accent-ink);
  --scrim: var(--ref-black-a30);
  --shadow-menu: 0 0 0 1px var(--ref-black-a8), 0 4px 12px rgba(0, 0, 0, 0.14);
  --shadow-toast: 0 0 0 1px var(--ref-black-a8), 0 6px 20px rgba(0, 0, 0, 0.16);
  --shadow-dialog: 0 0 0 1px var(--ref-black-a10), 0 16px 40px rgba(0, 0, 0, 0.22);
  --font-sans: system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans CJK KR', 'Noto Sans KR', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, 'Cascadia Mono', 'D2Coding', monospace;
  --text-caption: 12px;
  --leading-caption: 16px;
  --text-body: 13px;
  --leading-body: 16px;
  --text-title: 15px;
  --leading-title: 20px;
  --text-display: 17px;
  --leading-display: 22px;
  --leading-read: 20px;
  --weight-regular: 400;
  --weight-strong: 600;
  --space-2: 2px;
  --space-4: 4px;
  --space-6: 6px;
  --space-8: 8px;
  --space-12: 12px;
  --space-16: 16px;
  --space-20: 20px;
  --space-24: 24px;
  --space-32: 32px;
  --space-40: 40px;
  --edge: var(--space-20);
  --gap-sibling: var(--space-8);
  --gap-label: var(--space-6);
  --radius-badge: 4px;
  --radius-control: 6px;
  --radius-group: 10px;
  --radius-overlay: 12px;
  --radius-pill: 999px;
  --control-h-sm: 24px;
  --control-h: 28px;
  --control-h-lg: 36px;
  --row-h: 36px;
  --toolbar-h: 44px;
  --hit-min: 24px;
  --icon-sm: 16px;
  --icon-md: 20px;
  --icon-stroke: 1.5px;
  --switch-w: 54px;
  --switch-h: 24px;
  --switch-knob: 20px;
  --radio-size: 16px;
  --progress-h: 6px;
  --badge-h: 18px;
  --label-w: 80px;
  --pct-w: 40px;
  --content-max: 800px;
  --reading-max: 680px;
  --dialog-w: 440px;
  --motion-fast: 100ms;
  --motion-base: 200ms;
  --motion-slow: 300ms;
  --motion-spin: 800ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --progress-tween: 250ms;
  --z-sticky: 10;
  --z-menu: 20;
  --z-drop: 30;
  --z-toast: 40;
  --z-dialog: 50;
}

/* [dark-media] OS가 다크일 때. data-theme="light"로 고른 라이트는 제외 */
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    --bg: var(--ref-gray-240);
    --surface: var(--ref-gray-290);
    --surface-2: var(--ref-gray-350);
    --surface-pressed: var(--ref-gray-400);
    --raised: var(--ref-gray-320);
    --track: var(--ref-gray-240);
    --fg: var(--ref-gray-930);
    --fg-muted: var(--ref-gray-720);
    --fg-disabled: var(--ref-gray-540);
    --separator: var(--ref-white-a10);
    --border-strong: var(--ref-gray-620);
    --accent: var(--ref-blue-57);
    --accent-pressed: var(--ref-blue-50);
    --accent-ink: var(--ref-blue-74);
    --accent-soft: var(--ref-blue-33);
    --danger: var(--ref-red-56);
    --danger-ink: var(--ref-red-75);
    --danger-soft: var(--ref-red-33);
    --warning-ink: var(--ref-amber-78);
    --warning-soft: var(--ref-amber-33);
    --scrim: var(--ref-black-a50);
    --shadow-menu: inset 0 0 0 1px var(--ref-white-a8), 0 4px 12px rgba(0, 0, 0, 0.40);
    --shadow-toast: inset 0 0 0 1px var(--ref-white-a8), 0 6px 20px rgba(0, 0, 0, 0.45);
    --shadow-dialog: inset 0 0 0 1px var(--ref-white-a10), 0 16px 40px rgba(0, 0, 0, 0.55);
  }
}

/* [dark-theme] 사용자가 고른 다크(dark-media와 같은 선언) */
:root:where([data-theme="dark"]) {
  --bg: var(--ref-gray-240);
  --surface: var(--ref-gray-290);
  --surface-2: var(--ref-gray-350);
  --surface-pressed: var(--ref-gray-400);
  --raised: var(--ref-gray-320);
  --track: var(--ref-gray-240);
  --fg: var(--ref-gray-930);
  --fg-muted: var(--ref-gray-720);
  --fg-disabled: var(--ref-gray-540);
  --separator: var(--ref-white-a10);
  --border-strong: var(--ref-gray-620);
  --accent: var(--ref-blue-57);
  --accent-pressed: var(--ref-blue-50);
  --accent-ink: var(--ref-blue-74);
  --accent-soft: var(--ref-blue-33);
  --danger: var(--ref-red-56);
  --danger-ink: var(--ref-red-75);
  --danger-soft: var(--ref-red-33);
  --warning-ink: var(--ref-amber-78);
  --warning-soft: var(--ref-amber-33);
  --scrim: var(--ref-black-a50);
  --shadow-menu: inset 0 0 0 1px var(--ref-white-a8), 0 4px 12px rgba(0, 0, 0, 0.40);
  --shadow-toast: inset 0 0 0 1px var(--ref-white-a8), 0 6px 20px rgba(0, 0, 0, 0.45);
  --shadow-dialog: inset 0 0 0 1px var(--ref-white-a10), 0 16px 40px rgba(0, 0, 0, 0.55);
}

/* [theme-scheme] 고른 테마의 color-scheme */
:root:where([data-theme="light"]) {
  color-scheme: light;
}
:root:where([data-theme="dark"]) {
  color-scheme: dark;
}

/* [window-inactive] 비활성 창(macOS): 선택 면을 회색으로. 다크 블록 뒤에 온다 */
:root:where([data-window-active="false"]) {
  --accent-soft: var(--surface-2);
}

/* [reading] Worker 읽기 척도. main에 붙는다 */
[data-scale="reading"] {
  --text-caption: 13px;
  --leading-caption: 18px;
  --text-body: 15px;
  --leading-body: 22px;
  --text-title: 17px;
  --leading-title: 24px;
  --text-display: 22px;
  --leading-display: 28px;
  --text-hero: 28px;
  --leading-hero: 36px;
  --leading-read: 22px;
}
@media (max-width: 599px) {
  [data-scale="reading"] {
    --text-hero: 22px;
    --leading-hero: 28px;
  }
}

/* [contrast] 대비 증가. 다크 블록 뒤라 다크에서도 이긴다 */
@media (prefers-contrast: more) {
  :root:where(*) {
    --fg-muted: var(--fg);
    --separator: var(--fg);
    --border-strong: var(--fg);
  }
}

/* [coarse] 터치(2-in-1). any-pointer만 본다 */
@media (any-pointer: coarse) {
  :root:where(*) {
    --control-h-sm: 40px;
    --control-h: 40px;
    --control-h-lg: 44px;
    --row-h: 44px;
    --hit-min: 40px;
  }
}

/* [reduce] 움직임 줄이기: 이동·크기는 1ms, 눌림 피드백·불투명도는 남긴다 */
@media (prefers-reduced-motion: reduce) {
  :root:where(*) {
    --motion-base: 1ms;
    --motion-slow: 1ms;
    --progress-tween: 1ms;
  }
}

/* [ui] design/ui.css */
/* 기본 컴포넌트 CSS 원천(components.md 0.2). 앱의 ui/ 컴포넌트와 Worker 페이지가 같은 클래스를 쓴다.
   값은 전부 var() 토큰이다. 리터럴은 0 · 0px · 선 굵기 1px · 2px(border·outline) · 50% · 100% ·
   라디오 고리(inset 0 0 0 4px var(--surface)) · linear · infinite · forced-colors 시스템 색 키워드뿐이다.
   전역 리셋과 유틸(box-sizing · body · sr-only · num · ellipsis · 포인터 모양 · 선택 가능 여부 · 포커스 컨테이너)은
   앱 app.css와 Worker site.css의 몫이라 여기 없다. 상태는 HTML 속성과 의사 클래스로만 그린다. */

/* ---------- 아이콘 · 스피너 · 앱 마크 ---------- */

.icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.icon path {
  stroke-width: var(--icon-stroke);
}
.icon-md {
  width: var(--icon-md);
  height: var(--icon-md);
}

.mark {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: none;
}

.spinner {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: var(--icon-stroke);
  stroke-linecap: round;
  animation: spin var(--motion-spin) linear infinite;
}
.spinner * {
  vector-effect: non-scaling-stroke;
}
.spinner-sm {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }
}

/* ---------- 버튼 ---------- */

.btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  flex: none;
  min-height: var(--control-h);
  min-width: var(--hit-min);
  padding: 0 var(--space-12);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-regular);
  text-decoration: none;
  white-space: nowrap;
  transition: background-color var(--motion-fast) var(--ease-out);
}
.btn-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
}
.btn-sm {
  min-height: var(--control-h-sm);
  padding: 0 var(--space-8);
}
.btn-lg {
  min-height: var(--control-h-lg);
  padding: 0 var(--space-20);
  font-size: var(--text-title);
  line-height: var(--leading-title);
  font-weight: var(--weight-strong);
}
.btn.tone-danger {
  color: var(--danger-ink);
}
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.btn.btn-ghost {
  padding: 0 var(--space-6);
  background: transparent;
  border-color: transparent;
}
.btn-ghost .icon {
  color: var(--fg-muted);
}
.btn-ghost.edge-end {
  margin-inline-end: calc(0px - var(--space-6));
}
.btn-ghost.edge-start {
  margin-inline-start: calc(0px - var(--space-6));
}
/* 문장 속 링크: 색만으로 구별하지 않게 밑줄을 더한다(WCAG 1.4.1) */
.btn.btn-inline {
  text-decoration: underline;
}

/* hover는 유령 버튼만, 눌림은 모든 버튼에 있다. 비활성은 둘 다 받지 않는다 */
.btn-ghost:not([disabled], [aria-disabled="true"]):hover {
  background: var(--surface-2);
}
.btn:not([disabled], [aria-disabled="true"]):active {
  background: var(--surface-2);
}
.btn.tone-danger:not([disabled], [aria-disabled="true"]):active {
  background: var(--danger-soft);
}
.btn-primary:not([disabled], [aria-disabled="true"]):active {
  background: var(--accent-pressed);
  border-color: var(--accent-pressed);
}
.btn-ghost:not([disabled], [aria-disabled="true"]):active {
  background: var(--surface-pressed);
}
.btn-ghost.tone-danger:not([disabled], [aria-disabled="true"]):active {
  background: var(--danger-soft);
}

/* 비활성: 변형마다 따로 명세해 특이도로 서로 이기지 않게 한다 */
.btn[disabled],
.btn[aria-disabled="true"] {
  background: var(--surface);
  border-color: var(--separator);
  color: var(--fg-disabled);
}
.btn-primary[disabled],
.btn-primary[aria-disabled="true"] {
  background: var(--surface-2);
  border-color: var(--surface-2);
  color: var(--fg-disabled);
}
.btn.btn-ghost[disabled],
.btn.btn-ghost[aria-disabled="true"] {
  background: transparent;
  border-color: transparent;
  color: var(--fg-disabled);
}

/* 불러오는 중: 폭을 유지한 채 글자만 투명하게 하고 가운데에 스피너를 둔다.
   visibility: hidden은 접근성 트리에서 이름을 지우므로 쓰지 않는다 */
.btn[aria-busy="true"] .btn-label {
  opacity: 0;
}
.btn[aria-busy="true"] .spinner {
  position: absolute;
}
.btn[aria-busy="true"][aria-disabled="true"] {
  background: var(--surface);
  border-color: var(--border-strong);
  color: var(--fg-muted);
}
.btn-primary[aria-busy="true"][aria-disabled="true"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.btn.btn-ghost[aria-busy="true"][aria-disabled="true"] {
  background: transparent;
  border-color: transparent;
  color: var(--fg-muted);
}

/* ---------- 아이콘 버튼 ---------- */

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--control-h);
  height: var(--control-h);
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--fg-muted);
  transition: background-color var(--motion-fast) var(--ease-out);
}
.icon-btn > .icon {
  width: var(--icon-md);
  height: var(--icon-md);
}
.icon-btn-sm {
  width: var(--control-h-sm);
  height: var(--control-h-sm);
}
.icon-btn-sm > .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.icon-btn.edge-end {
  margin-inline-end: calc(0px - var(--space-4));
}
.icon-btn.edge-start {
  margin-inline-start: calc(0px - var(--space-4));
}
.icon-btn[aria-pressed="true"],
.icon-btn[aria-expanded="true"],
.icon-btn[aria-current="page"] {
  background: var(--surface-2);
  color: var(--fg);
}
.icon-btn:not([disabled]):hover {
  background: var(--surface-2);
}
.icon-btn:not([disabled]):active {
  background: var(--surface-pressed);
  color: var(--fg);
}
.icon-btn[disabled] {
  color: var(--fg-disabled);
}

/* ---------- 입력칸 · 비밀 입력칸 · 선택 상자 ---------- */

.field {
  width: 100%;
  min-width: 0;
  min-height: var(--control-h);
  padding: 0 var(--space-8);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-regular);
}
.field::placeholder {
  color: var(--fg-muted);
  opacity: 1;
}
.field[aria-invalid="true"] {
  border-color: var(--danger-ink);
}
.field[readonly] {
  background: var(--surface-2);
  border-color: var(--border-strong);
  color: var(--fg);
}
.field[disabled] {
  background: var(--surface-2);
  border-color: var(--separator);
  color: var(--fg-disabled);
}
.field[disabled]::placeholder {
  color: var(--fg-disabled);
}

/* 상자가 테두리와 면을 갖고 안의 입력칸은 테두리가 없다. 포커스 링은 상자에 그린다 */
.field-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: var(--control-h);
  padding-inline-end: var(--space-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface);
}
.field-wrap > input {
  flex: 1 1 auto;
  align-self: stretch;
  min-width: 0;
  padding: 0 0 0 var(--space-8);
  border: 0;
  background: transparent;
  color: var(--fg);
  font-family: var(--font-mono);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-regular);
}
.field-wrap > input::placeholder {
  color: var(--fg-muted);
  opacity: 1;
}
.field-wrap > input:focus-visible {
  outline-color: transparent;
}
.field-wrap > .icon-btn {
  border-radius: var(--radius-badge);
}
.field-wrap:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.field-wrap:has(input[aria-invalid="true"]) {
  border-color: var(--danger-ink);
}
.field-wrap:has(input[readonly]) {
  background: var(--surface-2);
  border-color: var(--border-strong);
}
.field-wrap:has(input:disabled) {
  background: var(--surface-2);
  border-color: var(--separator);
}
.field-wrap > input:disabled {
  color: var(--fg-disabled);
}
.field-wrap > input:disabled::placeholder {
  color: var(--fg-disabled);
}

.select-wrap {
  position: relative;
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
}
.select {
  appearance: none;
  -webkit-appearance: none;
  min-width: var(--hit-min);
  max-width: 100%;
  text-overflow: ellipsis;
  min-height: var(--control-h);
  padding: 0 var(--space-32) 0 var(--space-8);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-regular);
}
.select-wrap > .icon {
  position: absolute;
  right: var(--space-8);
  top: 0;
  bottom: 0;
  margin: auto 0;
  color: var(--fg-muted);
  pointer-events: none;
}
.select:not([disabled]):active {
  background: var(--surface-2);
}
.select[aria-invalid="true"] {
  border-color: var(--danger-ink);
}
.select[disabled] {
  background: var(--surface-2);
  border-color: var(--separator);
  color: var(--fg-disabled);
}
.select-wrap:has(.select[disabled]) > .icon {
  color: var(--fg-disabled);
}

/* ---------- 스위치 ---------- */

.switch {
  position: relative;
  flex: none;
  box-sizing: content-box;
  width: var(--switch-w);
  height: var(--switch-h);
  padding: 0;
  /* 거친 포인터에서 눌림 면을 hit-min까지 키운다(트랙 그림은 그대로). 보통 포인터에서는 0 */
  border: 0 solid transparent;
  border-block-width: calc((var(--hit-min) - var(--switch-h)) / 2);
  border-radius: var(--radius-pill);
  background: var(--border-strong);
  background-clip: padding-box;
  transition: background-color var(--motion-fast) var(--ease-out);
}
.switch::after {
  content: "";
  position: absolute;
  top: var(--space-2);
  left: var(--space-2);
  width: var(--switch-knob);
  height: var(--switch-knob);
  border-radius: var(--radius-pill);
  background: var(--surface);
  transition: transform var(--motion-fast) var(--ease-out);
}
.switch[aria-checked="true"] {
  background: var(--accent);
}
.switch[aria-checked="true"]::after {
  transform: translateX(calc(var(--switch-w) - var(--switch-h)));
}
.switch:not([disabled]):active::after {
  background: var(--surface-2);
}
.switch[disabled] {
  background: var(--surface-2);
}
.switch[disabled]::before {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid var(--separator);
  border-radius: var(--radius-pill);
}
.switch[disabled]::after {
  background: var(--fg-disabled);
}

/* ---------- 라디오 그룹 ---------- */

.radiogroup {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.radiogroup-inline {
  flex-direction: row;
  flex-wrap: wrap;
  gap: var(--gap-sibling);
}
.choice {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
  min-height: var(--control-h);
  padding: 0 var(--space-8);
  border-radius: var(--radius-control);
  color: var(--fg);
}
.choice:has(input:checked) {
  background: var(--accent-soft);
}
.choice:not(:has(input:disabled)):active,
.choice:not(:has(input:disabled)):has(input:checked):active {
  background: var(--surface-pressed);
}
.choice:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.radio {
  flex: none;
  width: var(--radio-size);
  height: var(--radio-size);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface);
}
.choice:has(input:checked) .radio {
  background: var(--accent-ink);
  border-color: var(--accent-ink);
  box-shadow: inset 0 0 0 4px var(--surface);
}
.choice-label {
  display: flex;
  align-items: baseline;
  gap: var(--space-8);
  flex: 1 1 auto;
  min-width: 0;
}
.choice-tail,
.choice-description {
  color: var(--fg-muted);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
}
.choice-description {
  /* 설명은 라벨 아래 줄로 내려 라벨 열이 눌리지 않게 한다(글자 시작은 라벨과 맞춘다) */
  order: 1;
  flex: 0 0 100%;
  padding-inline-start: calc(var(--radio-size) + var(--space-8));
  padding-bottom: var(--space-4);
}
.choice-trailing {
  flex: 0 1 auto;
  min-width: 0;
  margin-inline-start: auto;
  color: var(--fg-muted);
}
.choice:has(input:disabled) {
  background: transparent;
  color: var(--fg-disabled);
}
.choice:has(input:disabled) .radio {
  background: var(--surface-2);
  border-color: var(--separator);
}
.choice:has(input:disabled) .choice-tail,
.choice:has(input:disabled) .choice-description,
.choice:has(input:disabled) .choice-trailing {
  color: var(--fg-disabled);
}

/* ---------- 펼침 ---------- */

.disclosure {
  background: var(--surface);
  border: 1px solid var(--separator);
  border-radius: var(--radius-group);
}
.disclosure > summary {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  min-height: var(--row-h);
  padding: var(--space-6) var(--space-12);
  border-radius: var(--radius-group);
  color: var(--fg);
  font-weight: var(--weight-strong);
  list-style: none;
}
.disclosure > summary::-webkit-details-marker {
  display: none;
}
.disclosure > summary > h2,
.disclosure > summary > h3 {
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-strong);
}
.disclosure > summary .icon {
  color: var(--fg-muted);
  transition: transform var(--motion-fast) var(--ease-out);
}
.disclosure[open] > summary .icon {
  transform: rotate(90deg);
}
.disclosure > summary:active {
  background: var(--surface-2);
}
.disclosure-panel {
  padding: 0 var(--space-12) var(--space-12);
}
.disclosure-inline {
  background: transparent;
  border: 0;
}
.disclosure-inline > summary {
  display: inline-flex;
  min-height: var(--control-h-sm);
  padding: 0;
  border-radius: var(--radius-control);
  font-weight: var(--weight-regular);
}
.disclosure-inline > summary:active {
  background: transparent;
  color: var(--fg-muted);
}
.disclosure-inline > .disclosure-panel {
  margin-top: var(--gap-label);
  padding: 0;
}
/* group: 목록 그룹 머리(caption 600 muted, 상자 없음). 머리 줄이 토글이고 삼각형은 왼쪽. 패널은 호출부의 그룹 상자다 */
.disclosure-group > .disclosure-head {
  margin: 0;
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
  font-weight: var(--weight-strong);
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
}
.disclosure-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  min-height: var(--control-h-sm);
  padding: 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: inherit;
  font: inherit;
}
.disclosure-toggle .icon {
  transition: transform var(--motion-fast) var(--ease-out);
}
.disclosure-toggle[aria-expanded="true"] .icon {
  transform: rotate(90deg);
}
.disclosure-toggle:active {
  color: var(--fg);
}
.disclosure-group-panel {
  margin-top: var(--gap-label);
}

/* ---------- 메뉴 ---------- */

.menu-wrap {
  position: relative;
  display: inline-flex;
}
.menu {
  position: absolute;
  top: calc(100% + var(--space-4));
  right: 0;
  z-index: var(--z-menu);
  display: flex;
  flex-direction: column;
  padding: var(--space-6);
  border-radius: var(--radius-overlay);
  background: var(--raised);
  box-shadow: var(--shadow-menu);
}
.menu[data-placement="top"] {
  top: auto;
  bottom: calc(100% + var(--space-4));
}
.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  min-height: var(--control-h);
  padding: 0 var(--space-12);
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-regular);
  text-align: start;
  white-space: nowrap;
  transition: background-color var(--motion-fast) var(--ease-out);
}
.menu-item > .icon {
  color: var(--fg-muted);
}
.menu-item.tone-danger {
  color: var(--danger-ink);
}
.menu-item:not([aria-disabled="true"]):hover,
.menu-item:focus-visible {
  background: var(--surface-2);
}
.menu-item:not([aria-disabled="true"]):active {
  background: var(--surface-pressed);
}
.menu-item.tone-danger:not([aria-disabled="true"]):active {
  background: var(--danger-soft);
}
.menu-item[aria-disabled="true"],
.menu-item[aria-disabled="true"] > .icon {
  color: var(--fg-disabled);
}
.menu-separator {
  margin: var(--space-6) 0;
  border: 0;
  border-top: 1px solid var(--separator);
}

/* ---------- 대화상자 ---------- */

.scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: grid;
  place-items: center;
  background: var(--scrim);
}
.dialog {
  display: flex;
  flex-direction: column;
  width: var(--dialog-w);
  max-width: calc(100% - 2 * var(--edge));
  max-height: calc(100% - 2 * var(--edge));
  padding: var(--space-20);
  border-radius: var(--radius-overlay);
  background: var(--raised);
  color: var(--fg);
  box-shadow: var(--shadow-dialog);
}
.dialog > h2 {
  flex: none;
  margin: 0;
  font-size: var(--text-title);
  line-height: var(--leading-title);
  font-weight: var(--weight-strong);
}
.dialog-body {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: var(--space-12);
  overflow-y: auto;
  line-height: var(--leading-read);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-sibling);
}
.dialog > .actions {
  flex: none;
  justify-content: flex-end;
  margin-top: var(--space-20);
}
.dialog > .actions > .tone-danger {
  margin-inline-end: auto;
}

/* ---------- 알림 ---------- */

.notice {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--space-8);
  padding: var(--space-8) var(--space-12);
  border-radius: var(--radius-control);
  background: var(--surface-2);
  color: var(--fg);
  line-height: var(--leading-read);
}
.notice > .icon {
  color: var(--fg-muted);
}
.notice-inline > .icon,
.notice-banner > .icon,
.notice-toast > .icon {
  width: var(--icon-md);
  height: var(--icon-md);
}
.notice > p,
.notice-text {
  flex: 1 1 0;
  min-width: 0;
  margin: 0;
}
.notice-title {
  font-weight: var(--weight-strong);
}
.notice-actions {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: var(--gap-sibling);
  margin-inline-start: auto;
}
:where(.notice).tone-warning {
  background: var(--warning-soft);
}
:where(.notice).tone-warning > .icon {
  color: var(--warning-ink);
}
:where(.notice).tone-danger {
  background: var(--danger-soft);
}
:where(.notice).tone-danger > .icon {
  color: var(--danger-ink);
}
.notice-row {
  padding: 0;
  background: transparent;
  line-height: var(--leading-body);
}
.notice-row > .icon {
  width: var(--icon-sm);
  height: var(--icon-sm);
}
.notice-toast {
  align-items: center;
  min-height: var(--row-h);
  padding: var(--space-8) var(--space-8) var(--space-8) var(--space-16);
  border-radius: var(--radius-overlay);
  background: var(--raised);
  box-shadow: var(--shadow-toast);
  pointer-events: auto;
}

/* 토스트 띠: 본문 열 안쪽 폭으로 하단에 뜬다. 띠 자체는 클릭을 가로채지 않는다 */
.toaster {
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--edge);
  z-index: var(--z-toast);
  pointer-events: none;
}

/* ---------- 등장·퇴장(메뉴·토스트·대화상자, components.md §2.9·§2.10·§2.13) ----------
   @starting-style이 하한 밖이라(foundations §11) 속성 토글 + transition으로 한다: 컴포넌트가 붙일 때 data-motion="enter"를 두고
   다음 프레임에 지운다(등장). 닫을 때 data-motion="leave"를 두고 transitionend 뒤에 떼어 낸다(퇴장). 메뉴는 퇴장이 없다(즉시).
   reduce에서는 토큰이 1ms라 곧바로 끝난다(foundations §7.1). */
.menu {
  transition:
    opacity var(--motion-base) var(--ease-out),
    transform var(--motion-base) var(--ease-out);
}
.menu[data-motion="enter"] {
  opacity: 0;
  transform: translateY(var(--space-4));
}
.notice-toast {
  transition:
    opacity var(--motion-base) var(--ease-out),
    transform var(--motion-base) var(--ease-out);
}
.notice-toast[data-motion="enter"] {
  opacity: 0;
  transform: translateY(var(--space-8));
}
.notice-toast[data-motion="leave"] {
  opacity: 0;
  transition: opacity var(--motion-base) var(--ease-in);
}
.scrim,
.dialog {
  transition:
    opacity var(--motion-slow) var(--ease-out),
    transform var(--motion-slow) var(--ease-out);
}
.scrim[data-motion="enter"] {
  opacity: 0;
}
.scrim[data-motion="enter"] > .dialog {
  transform: scale(0.98);
}
.scrim[data-motion="leave"] {
  opacity: 0;
  transition: opacity var(--motion-base) var(--ease-in);
}

/* ---------- 빈 상태 ---------- */

.empty {
  text-align: center;
}
.empty > h2 {
  margin: 0;
  font-size: var(--text-display);
  line-height: var(--leading-display);
  font-weight: var(--weight-strong);
  color: var(--fg);
}
.empty > p {
  margin: var(--space-8) 0 0;
  color: var(--fg-muted);
  line-height: var(--leading-read);
}
.empty > .btn {
  margin-top: var(--space-16);
}
.empty-panel,
.empty-page {
  padding: var(--space-32) var(--edge);
}
.empty-inline {
  padding: var(--space-6) 0;
  text-align: start;
}
.empty-inline > p {
  margin: 0;
  line-height: var(--leading-body);
}
.empty > .steps {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-8) var(--space-24);
  margin: var(--space-16) 0 0;
  padding: 0;
  list-style: none;
  counter-reset: step;
}
.empty > .steps > li {
  display: flex;
  align-items: center;
  gap: var(--space-6);
  counter-increment: step;
}
.empty > .steps > li::before {
  content: counter(step);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--badge-h);
  height: var(--badge-h);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  color: var(--fg);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
  font-weight: var(--weight-strong);
  font-variant-numeric: tabular-nums;
}

/* ---------- 틀: 열 · 면 · 행 · 폼 행 · 툴바 ---------- */

.col {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--space-16) var(--edge) var(--space-32);
}
.col-reading {
  max-width: var(--reading-max);
}
.toolbar > .col,
.toaster > .col,
.site-header > .col {
  padding-top: 0;
  padding-bottom: 0;
}

.surface {
  background: var(--surface);
  border: 1px solid var(--separator);
  border-radius: var(--radius-group);
}
.surface-group > .row + .row {
  border-top: 1px solid var(--separator);
}
.card-header {
  display: flex;
  align-items: center;
  gap: var(--gap-sibling);
  min-height: calc(var(--control-h-sm) + 2 * var(--space-8));
  padding: var(--space-8) var(--space-8) var(--space-8) var(--space-16);
  border-bottom: 1px solid var(--separator);
}
.card-header > h2 {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-strong);
}
.card-body {
  padding: var(--space-16);
}
.card-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: var(--gap-sibling);
  padding: var(--space-12) var(--space-16);
  border-top: 1px solid var(--separator);
  border-bottom-left-radius: var(--radius-group);
  border-bottom-right-radius: var(--radius-group);
  background: var(--surface);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-sibling);
  min-height: var(--row-h);
  padding: var(--space-6) var(--space-12);
}
.row-main {
  display: flex;
  flex: 1 1 50%;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}
.row-label {
  color: var(--fg);
}
.row-help {
  color: var(--fg-muted);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
}
.row-value {
  min-width: 0;
  color: var(--fg-muted);
}
.row-control {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: var(--gap-sibling);
  margin-inline-start: auto;
}

.fieldrow {
  display: grid;
  grid-template-columns: var(--label-w) minmax(0, 1fr);
  column-gap: var(--gap-label);
  align-items: start;
}
.fieldrow:has(> .fieldrow-actions) {
  grid-template-columns: var(--label-w) minmax(0, 1fr) auto;
}
.fieldrow + .fieldrow {
  margin-top: var(--space-12);
}
.fieldrow-label {
  display: flex;
  align-items: center;
  min-height: var(--control-h);
  color: var(--fg);
}
.fieldrow-value {
  display: flex;
  align-items: center;
  gap: var(--gap-sibling);
  min-width: 0;
  min-height: var(--control-h);
  color: var(--fg-muted);
}
.fieldrow-actions {
  display: flex;
  align-items: center;
  gap: var(--gap-sibling);
  min-height: var(--control-h);
  margin-inline-start: calc(var(--gap-sibling) - var(--gap-label));
}
.fieldrow-help {
  grid-column: 2 / -1;
  margin-top: var(--space-4);
  color: var(--fg-muted);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
}

.toolbar {
  box-sizing: border-box;
  display: flex;
  align-items: stretch;
  min-height: var(--toolbar-h);
  background: var(--bg);
  border-bottom: 1px solid var(--separator);
}
.toolbar > .col {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--gap-sibling);
}
.toolbar-end {
  display: flex;
  align-items: center;
  gap: var(--gap-sibling);
  margin-inline-start: auto;
}
.app-name {
  color: var(--fg);
  font-weight: var(--weight-strong);
}
.toolbar-title {
  color: var(--fg);
  font-size: var(--text-display);
  line-height: var(--leading-display);
  font-weight: var(--weight-strong);
}

/* ---------- 표시: 배지 · 키 힌트 · 진행 막대 · 자리표시 ---------- */

.badge {
  display: inline-flex;
  align-items: center;
  flex: none;
  min-height: var(--badge-h);
  padding: 0 var(--space-6);
  border-radius: var(--radius-badge);
  background: var(--surface-2);
  color: var(--fg);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
  font-weight: var(--weight-strong);
  white-space: nowrap;
}

.kbd {
  display: inline-flex;
  align-items: center;
  min-height: var(--badge-h);
  padding: 0 var(--space-4);
  border-radius: var(--radius-badge);
  background: var(--surface-2);
  color: var(--fg-muted);
  font-family: var(--font-sans);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
  font-weight: var(--weight-regular);
}
.btn-primary .kbd {
  background: transparent;
  border: 1px solid var(--on-accent);
  color: var(--on-accent);
}

.progress {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  height: var(--progress-h);
  border-radius: var(--radius-pill);
  background: var(--track);
  overflow: hidden;
}
.progress > .fill {
  width: 100%;
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  transform: scaleX(var(--p, 0));
  transition: transform var(--progress-tween) linear;
}
.progress[data-instant] > .fill {
  transition: none;
}
.progress[data-state="paused"] > .fill {
  background: var(--border-strong);
}
.progress[data-state="failed"] > .fill {
  background: var(--danger);
}
.progress[data-state="waiting"] > .fill {
  background: repeating-linear-gradient(-45deg, var(--accent) 0 var(--space-4), transparent var(--space-4) var(--space-8));
}
.progress:not([aria-valuenow]) > .fill {
  background: repeating-linear-gradient(-45deg, var(--accent) 0 var(--space-4), transparent var(--space-4) var(--space-8));
  transform: none;
}
@media (prefers-contrast: more) {
  .progress {
    border: 1px solid var(--fg);
  }
}

.skeleton {
  display: block;
  width: 100%;
  background: var(--surface-2);
}
.skeleton-half {
  width: 50%;
}
.skeleton-line {
  height: var(--leading-body);
  border-radius: var(--radius-badge);
}
.skeleton-title {
  height: var(--leading-title);
  border-radius: var(--radius-badge);
}
.skeleton-control {
  height: var(--control-h);
  border-radius: var(--radius-control);
}
.skeleton-row {
  height: var(--row-h);
  border-radius: var(--radius-control);
}

/* ---------- 드롭 오버레이 ---------- */

.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-drop);
  display: grid;
  place-items: center;
  pointer-events: none;
}
.drop-overlay::before {
  content: "";
  position: absolute;
  inset: var(--edge);
  border: 2px dashed var(--accent-ink);
  border-radius: var(--radius-group);
}
.drop-label {
  display: flex;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-12) var(--space-20);
  border-radius: var(--radius-overlay);
  background: var(--raised);
  color: var(--fg);
  font-weight: var(--weight-strong);
  box-shadow: var(--shadow-toast);
}

/* ---------- forced-colors(Windows 고대비). components.md 3 · foundations 2.7 ---------- */

@media (forced-colors: active) {
  .btn,
  .btn.btn-ghost,
  .icon-btn,
  .field,
  .field-wrap,
  .select {
    border: 1px solid CanvasText;
    color: ButtonText;
  }
  .field,
  .field-wrap,
  .field-wrap > input {
    color: CanvasText;
  }
  /* 테두리가 생기면 상자가 보이므로 끝자리 보정을 접는다(상자 가장자리가 열 안쪽 x에 닿는다) */
  .btn-ghost.edge-end,
  .icon-btn.edge-end {
    margin-inline-end: 0;
  }
  .btn-ghost.edge-start,
  .icon-btn.edge-start {
    margin-inline-start: 0;
  }
  .btn-primary {
    background: Highlight;
    color: HighlightText;
  }
  .btn-primary .kbd {
    border-color: HighlightText;
    color: HighlightText;
  }
  .btn[disabled],
  .btn[aria-disabled="true"],
  .icon-btn[disabled],
  .field[disabled],
  .field-wrap > input:disabled,
  .select[disabled],
  .menu-item[aria-disabled="true"],
  .choice:has(input:disabled) {
    color: GrayText;
  }
  .badge,
  .kbd,
  .surface,
  .disclosure,
  .notice {
    border: 1px solid CanvasText;
  }
  .notice-row {
    border: 0;
  }
  /* summary는 forced-colors에서 LinkText로 나올 수 있다: 버튼 글자색으로 고정한다 */
  .disclosure > summary,
  .disclosure-toggle {
    color: ButtonText;
  }
  .menu,
  .dialog,
  .notice-toast {
    border: 2px solid CanvasText;
  }
  .switch {
    background: Canvas;
  }
  .switch::before {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid CanvasText;
    border-radius: var(--radius-pill);
  }
  .switch::after {
    background: CanvasText;
  }
  .switch[aria-checked="true"] {
    background: Highlight;
  }
  .switch[aria-checked="true"]::after {
    background: Canvas;
  }
  .switch[disabled]::before {
    border-color: GrayText;
  }
  .switch[disabled]::after {
    background: GrayText;
  }
  .radio {
    border-color: CanvasText;
  }
  .choice:has(input:checked) {
    outline: 1px solid Highlight;
  }
  .choice:has(input:checked) .radio {
    background: CanvasText;
    border-color: CanvasText;
  }
  .choice:has(input:focus-visible) {
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }
  .progress {
    border: 1px solid CanvasText;
  }
  .progress > .fill {
    background: Highlight;
  }
  .progress[data-state="paused"] > .fill {
    background: GrayText;
    border-right: 2px solid CanvasText;
  }
  .progress[data-state="failed"] > .fill {
    background: CanvasText;
  }
  .progress[data-state="waiting"] > .fill,
  .progress:not([aria-valuenow]) > .fill {
    background: Canvas;
    border: 1px dashed CanvasText;
  }
  .skeleton {
    border: 1px solid GrayText;
  }
  .toolbar {
    border-bottom: 1px solid CanvasText;
  }
  .drop-overlay::before {
    border-color: CanvasText;
  }
  .drop-label {
    border: 2px solid CanvasText;
  }
}

/* [site] worker/src/http/site.css */
/* Worker 웹 전용 CSS(docs/design/system/web.md §2·§3·§7·§8·§11). 토큰(생성물)과 design/ui.css 뒤에 이어 붙는다.
   값은 전부 var() 토큰이고, 앱 app.css가 가진 전역 규칙(리셋·글자 유틸·sr-only)을 웹에 다시 정의한다.
   요소 이름 규칙은 html·body·h1~h3·p·a·code·pre·table·th·td·ol·ul·details·summary·input·button·label·caption에만 두고
   나머지는 클래스다(헤더 .site-header, 본문 .page, 바닥글 .site-footer). 분기점은 600(599px)뿐이다.
   전환은 없다: ui.css의 transition은 아래 "전환 없음" 규칙이 웹에서 끈다. */

/* ---------- 리셋 · 전역 ---------- */

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  font-size: 16px;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-sans);
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-regular);
}
/* 웹은 앱의 default 커서 규칙을 쓰지 않는다. 글자는 선택할 수 있다 */
body.web {
  cursor: auto;
  user-select: text;
}

h1,
h2,
h3,
p,
ul,
ol,
dl,
dd,
pre,
figure,
fieldset {
  margin: 0;
}
fieldset {
  padding: 0;
  border: 0;
  min-width: 0;
}
ul,
ol {
  padding-inline-start: var(--space-20);
}
button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
  margin: 0;
}

/* 헤딩 위계: h3를 UA 기본으로 두지 않는다 */
h1 {
  font-size: var(--text-display);
  line-height: var(--leading-display);
  font-weight: var(--weight-strong);
}
h2 {
  font-size: var(--text-title);
  line-height: var(--leading-title);
  font-weight: var(--weight-strong);
}
h3 {
  font-size: var(--text-body);
  line-height: var(--leading-body);
  font-weight: var(--weight-strong);
}
/* 랜딩 h1만. 읽기 척도 블록이 600 미만에서 22/28로 바꾼다 */
.hero {
  font-size: var(--text-hero);
  line-height: var(--leading-hero);
}

/* 포커스 링은 전역 한 줄이다 */
:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

/* 링크: 색만으로 구별하지 않게 밑줄을 둔다. 버튼 모양 링크(.btn)는 ui.css가 그린다 */
a:not(.btn) {
  color: var(--accent-ink);
  text-decoration: underline;
  text-underline-offset: var(--space-2);
}
a,
button,
summary,
.btn {
  cursor: pointer;
}
/* 대상 크기: 요약은 --hit-min 이상(WCAG 2.5.8). 문단 안 링크만 예외다 */
summary {
  min-height: var(--hit-min);
}

/* 전환 없음: ui.css의 transition을 웹에서 끈다(정지가 기본) */
body.web .btn,
body.web .disclosure > summary .icon {
  transition: none;
}

/* ---------- 글자 유틸 ---------- */

.num {
  font-variant-numeric: tabular-nums;
}
.selectable {
  -webkit-user-select: text;
  user-select: text;
  cursor: text;
}
.muted,
.meta {
  color: var(--fg-muted);
}
.meta {
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
}
.lead {
  line-height: var(--leading-read);
}
.mono,
code {
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  word-break: break-all;
}
/* 화면에는 없고 스크린 리더만 읽는 글. 2px 토큰 상자를 잘라 숨긴다(DL2) */
.sr-only {
  position: absolute;
  width: var(--space-2);
  height: var(--space-2);
  margin: calc(0px - var(--space-2));
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* ---------- 문서 골격: skip · 헤더 · 본문 · 바닥글 ---------- */

/* 평소에는 화면 왼쪽 밖, 포커스를 받으면 열 가장자리에 나타난다 */
.skip {
  position: absolute;
  top: var(--space-8);
  left: calc(0px - 100vw);
  display: inline-flex;
  align-items: center;
  min-height: var(--hit-min);
  padding: 0 var(--space-12);
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-control);
}
.skip:focus {
  left: var(--edge);
}

.site-header {
  background: var(--bg);
  border-bottom: 1px solid var(--separator);
}
.site-header > .col {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-sibling);
  min-height: var(--toolbar-h);
}
a.site-name {
  display: inline-flex;
  align-items: center;
  min-height: var(--hit-min);
  color: var(--fg);
  font-weight: var(--weight-strong);
  text-decoration: none;
}
.site-nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gap-sibling);
  margin-inline-start: auto;
}
.site-nav a,
.site-user {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--hit-min);
  min-width: var(--hit-min);
}
.site-user {
  color: var(--fg-muted);
}

/* 본문 열: 위아래 간격과 문단 사이 간격 */
.page {
  padding-top: var(--space-24);
  padding-bottom: var(--space-32);
}
/* 읽기 척도: body가 먼저 13으로 계산해 상속하므로 main에서 글자 크기와 행간을 다시 선언한다(헤더·바닥글은 그대로 13) */
.page[data-scale="reading"] {
  font-size: var(--text-body);
  line-height: var(--leading-body);
}
.page > * + * {
  margin-top: var(--space-12);
}
.page > h2 {
  margin-top: var(--space-24);
}
.page[data-scale="reading"] > h2 {
  margin-top: var(--space-40);
}
.page > section {
  margin-top: var(--space-24);
}
.page[data-scale="reading"] > section {
  margin-top: var(--space-40);
}
.page section > * + * {
  margin-top: var(--space-12);
}
.page p,
.page li {
  line-height: var(--leading-read);
}

/* 랜딩 CTA 블록(로그인 전 고지 + 폼, 큰 버튼 + meta 줄): 안쪽 간격 */
.cta > * + * {
  margin-top: var(--space-12);
}

.site-footer {
  border-top: 1px solid var(--separator);
  color: var(--fg-muted);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
}
.site-footer > .col {
  padding-top: var(--space-32);
  padding-bottom: var(--space-32);
}
.site-footer ul {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-sibling) var(--space-16);
  margin: 0;
  padding: 0;
  list-style: none;
}
.site-footer a {
  display: inline-flex;
  align-items: center;
  min-height: var(--hit-min);
}
.site-footer p {
  margin-top: var(--space-12);
}

/* ---------- 상태 제목 · 알림 · 폼 ---------- */

/* 안내·결과 페이지의 h1: 상태 아이콘이 제목 앞에 온다 */
.status {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
}
.status > .icon {
  width: var(--icon-md);
  height: var(--icon-md);
  margin-top: calc((var(--leading-display) - var(--icon-md)) / 2);
}
.status-muted > .icon {
  color: var(--fg-muted);
}
.status-warning > .icon {
  color: var(--warning-ink);
}
.status-danger > .icon {
  color: var(--danger-ink);
}

.notice-text > * + * {
  margin-top: var(--space-4);
}
.notice-text ul {
  margin: 0;
}

form {
  margin: 0;
}
.actions {
  align-items: center;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--gap-label);
}
/* 표 아래 폼 제목과 폼 안 칸·버튼 사이 간격 */
.page section > h3 {
  margin-top: var(--space-24);
}
form > * + * {
  margin-top: var(--space-12);
}
.form-field > label {
  display: block;
  color: var(--fg);
}
.form-help {
  color: var(--fg-muted);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
}
.field {
  cursor: text;
  user-select: text;
}
.field[readonly] {
  cursor: default;
}
.field-mono {
  font-family: var(--font-mono);
}

/* ---------- 표 · 요약 · 코드 ---------- */

.scroll {
  overflow-x: auto;
  /* 안쪽의 .sr-only(absolute)가 스크롤 영역 밖으로 새어 문서를 가로로 넓히지 않게 한다 */
  position: relative;
}
table {
  width: 100%;
  border-collapse: collapse;
}
caption {
  padding-bottom: var(--space-6);
  color: var(--fg-muted);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
  text-align: start;
}
th,
td {
  padding: var(--space-6) var(--space-8);
  border-bottom: 1px solid var(--separator);
  text-align: start;
  vertical-align: top;
  /* 한글을 글자 단위로 끊지 않는다. 좁으면 .scroll이 가로로 스크롤한다 */
  overflow-wrap: normal;
}
th {
  white-space: nowrap;
  color: var(--fg-muted);
  font-weight: var(--weight-strong);
}
th[scope="row"] {
  color: var(--fg);
  font-weight: var(--weight-regular);
}
td.num,
th.num {
  text-align: end;
}
td.num {
  white-space: nowrap;
}

dl.summary {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-6) var(--space-16);
}
.summary dt {
  color: var(--fg-muted);
}
.summary dd {
  min-width: 0;
}

/* 대상 크기(WCAG 2.5.8): 목록·표·버튼 줄에서 혼자 놓인 링크는 --hit-min 이상이다. 문단 안 링크만 예외다 */
.page li > a:only-child,
.page td a,
.page th a,
.actions > a {
  display: inline-flex;
  align-items: center;
  min-height: var(--hit-min);
}

/* 코드 블록: 글자 단위로 끊지 않고 가로로 스크롤한다 */
pre {
  padding: var(--space-12);
  background: var(--surface-2);
  border-radius: var(--radius-control);
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  line-height: var(--leading-caption);
  white-space: pre;
  overflow-x: auto;
  user-select: text;
}
pre code {
  font-size: inherit;
  word-break: normal;
}
pre.license {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* 단계 목록 */
.steps {
  padding-inline-start: var(--space-20);
}
.steps > li + li {
  margin-top: var(--space-6);
}
.steps > li > pre {
  margin-top: var(--space-8);
}

@media (max-width: 599px) {
  /* 표는 쌓지 않고 가로로 스크롤한다 */
  th,
  td {
    white-space: nowrap;
  }
  /* 코드 블록은 좁은 폭에서 줄바꿈한다(복사하는 글자는 같다) */
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* 큰 버튼은 전폭 */
  .btn-lg {
    width: 100%;
  }
}

/* ---------- 강제 색상 ---------- */

@media (forced-colors: active) {
  .skip,
  pre {
    border: 1px solid CanvasText;
  }
  .site-header {
    border-bottom: 1px solid CanvasText;
  }
  .site-footer {
    border-top: 1px solid CanvasText;
  }
  th,
  td {
    border-bottom: 1px solid CanvasText;
  }
}
`;
export const SITE_CSS_HASH = "71d99ed4238a9ba4";
