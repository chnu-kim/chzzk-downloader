// 웹 흔적 지우기 가드(platform §4.3~4.5). `contextmenu`·`wheel` 리스너는 이 파일에만 둔다(design-lint DX4).
// installGuards는 **무조건** 설치한다. dev 여부는 부르는 쪽(main.ts)이 정한다: 함수 안에서 DEV를 보면
// vitest(DEV=true)에서 테스트가 무력해진다.
import { isImeKey } from './components/ui/focus';

/** 앱 컨텍스트 메뉴 예외: 입력칸·편집 가능한 곳·`data-native-menu`는 웹뷰 기본 메뉴를 남긴다(붙여넣기·복사 경로) */
export const NATIVE_MENU_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"]), [data-native-menu]';
/** 키 예외 대상: 편집 대상 안에서는 Alt+←/→·Ctrl+F/P/U를 막지 않는다 */
const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

function closestIn(target: EventTarget | null, selector: string): boolean {
  const el = target as { closest?: (s: string) => Element | null } | null;
  return typeof el?.closest === 'function' && el.closest(selector) !== null;
}

/** 눌린 글자 하나(소문자). 한글 자판 등 key가 ASCII 글자가 아니면 물리 키(code)로 */
function letterOf(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toLowerCase() : '';
  if (/^[a-z]$/.test(k)) return k;
  const m = /^Key([A-Z])$/.exec(e.code ?? '');
  return m ? m[1].toLowerCase() : k;
}

/**
 * 막아야 할 브라우저 단축키인지. OS를 모르는 채 두 표의 합집합(Windows·Linux 표 + macOS 표)이다.
 * - 메타(⌘) 조합: `⌘R`·`⌘⇧R`·`⌘P`·`⌘F`·`⌘[`·`⌘]`, `⌘⌥I/J/U`
 * - 메타 없는 조합: `F5`·`F3`·`F12`, `Ctrl+R`·`Ctrl+Shift+R`·`Ctrl+F`·`Ctrl+P`·`Ctrl+U`·`Ctrl+Shift+I/C/J`, `Alt+←/→`
 *   (Ctrl+Alt는 AltGr이라 건드리지 않는다)
 * 편집 대상 안에서는 `Alt+←/→`·`Ctrl+F/P/U`를 막지 않는다. 늘 통과: `Mod+C/V/X/A/Z`, Tab, Esc, Home/End/PageUp/PageDown,
 * 앱 단축키(`Mod+L`·`Mod+,`·`Mod+Enter`)는 표에 없으므로 여기서 false다.
 */
export function shouldBlockKey(e: KeyboardEvent, editable: boolean): boolean {
  const l = letterOf(e);
  if (e.metaKey) {
    if (e.ctrlKey) return false;
    if (e.altKey) return !e.shiftKey && (l === 'i' || l === 'j' || l === 'u');
    if (e.key === '[' || e.key === ']') return true;
    return l === 'r' || l === 'p' || l === 'f';
  }
  if (!e.ctrlKey && !e.altKey && (e.key === 'F5' || e.key === 'F3' || e.key === 'F12')) return true;
  if (e.ctrlKey && !e.altKey) {
    if (l === 'r') return true;
    if (e.shiftKey && (l === 'i' || l === 'c' || l === 'j')) return true;
    if (!e.shiftKey && (l === 'f' || l === 'p' || l === 'u')) return !editable;
    return false;
  }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return !editable;
  return false;
}

/** 가드 셋을 `win`에 단다. 돌려받은 함수로 뗀다(테스트용) */
export function installGuards(win: Window = window): () => void {
  // (가) 컨텍스트 메뉴: 캡처 단계에서 막고 예외 대상만 남긴다(터치 길게 누르기·펜 배럴도 같은 이벤트)
  const onContextMenu = (e: Event) => {
    if (!closestIn(e.target, NATIVE_MENU_SELECTOR)) e.preventDefault();
  };
  // (나) 브라우저 단축키
  const onKeyDown = (e: KeyboardEvent) => {
    if (isImeKey(e)) return;
    if (shouldBlockKey(e, closestIn(e.target, EDITABLE_SELECTOR))) e.preventDefault();
  };
  // (다) Windows 정밀 터치패드 핀치는 ctrlKey wheel로 온다 [잠정] 줌 설정이 막지 못하면 이 한 줄이 막는다(platform §4.5, 실기 M5)
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  win.addEventListener('contextmenu', onContextMenu, true);
  win.addEventListener('keydown', onKeyDown, true);
  win.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    win.removeEventListener('contextmenu', onContextMenu, true);
    win.removeEventListener('keydown', onKeyDown, true);
    win.removeEventListener('wheel', onWheel);
  };
}
