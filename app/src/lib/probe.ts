// 웹뷰 엔진 기능 검사(docs/design/system/platform.md §5·§15). 화면이 기대는 CSS·DOM 기능이 있는지 본다.
// 결과는 `frontend_ready`의 인자로 Rust에 가고(스모크 마커에 실린다), 하나라도 false면 배너 경고가 뜬다.
// 사용자 환경에서 재는 값이라 외부 입력이 없다. `CSS.supports`가 없는 아주 오래된 엔진은 전부 false다.
import type { EngineProbe } from './bindings';

/** `CSS.supports`를 안전하게 부른다(없거나 던지면 false) */
function supports(...args: [string] | [string, string]): boolean {
  try {
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false;
    return args.length === 1 ? CSS.supports(args[0]) : CSS.supports(args[0], args[1]);
  } catch {
    return false;
  }
}

export function engineProbe(): EngineProbe {
  return {
    colorMix: supports('color', 'color-mix(in srgb, red 50%, blue)'),
    has: supports('selector(:has(a))'),
    oklch: supports('color', 'oklch(50% 0.1 200)'),
    containerQuery: supports('container-type: inline-size'),
    inert: typeof HTMLElement !== 'undefined' && 'inert' in HTMLElement.prototype,
  };
}

/** 다섯 기능이 모두 있는가 */
export function probeOk(p: EngineProbe): boolean {
  return p.colorMix && p.has && p.oklch && p.containerQuery && p.inert;
}
