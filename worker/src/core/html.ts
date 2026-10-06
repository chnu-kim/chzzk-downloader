// 서버 렌더 HTML(docs/design/worker.md §8.1, 구현 중 변경 14 (아)). 출력은 모두 태그드 템플릿 html`…`을 거친다.
//   - 값: 문자열·유한 숫자는 이스케이프, SafeHtml은 그대로(이중 이스케이프 없음), 배열은 원소마다, false·null·undefined는 "".
//     그 밖(true·객체·함수·bigint·symbol·NaN)은 TypeError([object Object] 누출을 막는다).
//   - 정적 조각은 cooked 문자열만 쓴다(cooked가 없으면 던진다).
//   - 속성 값은 늘 따옴표로 감싼다(값이 따옴표 안에 있어야 이스케이프가 막는다).
//   - SafeHtml은 비공개 필드 브랜드라 같은 모양의 객체로 위조할 수 없다. 클래스는 내보내지 않고 생성자는 모듈 안의 열쇠를 요구한다.
//   - 이스케이프 없이 넣는 함수는 아래 하나이고, scripts/ci/worker-config.mjs RAW_ALLOWLIST가 src/의 사용처 수를 파일별로 고정한다.
//   - 페이지 골격은 W6에서 더한다.

// 생성자 열쇠: 인스턴스에서 constructor를 꺼내 new로 만드는 길도 막는다(모듈 밖에서는 이 값을 얻을 수 없다)
const MINT: unique symbol = Symbol("SafeHtml");

class SafeHtml {
  readonly #html: string;
  constructor(key: typeof MINT, text: string) {
    if (key !== MINT || typeof text !== "string") throw new TypeError("SafeHtml은 html 모듈만 만든다");
    this.#html = text;
  }
  static is(v: unknown): v is SafeHtml {
    return typeof v === "object" && v !== null && #html in v;
  }
  static text(v: SafeHtml): string {
    return v.#html;
  }
}

export type { SafeHtml };
export type HtmlValue = SafeHtml | string | number | false | null | undefined | readonly HtmlValue[];

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function render(v: unknown): string {
  if (typeof v === "string") return escapeHtml(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new TypeError("html 값: 유한한 숫자가 아니다");
    return escapeHtml(String(v));
  }
  if (v === false || v === null || v === undefined) return "";
  if (SafeHtml.is(v)) return SafeHtml.text(v);
  if (Array.isArray(v)) return v.map(render).join("");
  throw new TypeError(`html 값: 넣을 수 없는 형식(${typeof v})`);
}

export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    if (typeof s !== "string") throw new TypeError("html 정적 조각에 해석할 수 없는 이스케이프가 있다");
    out += s;
    if (i < values.length) out += render(values[i]);
  }
  return new SafeHtml(MINT, out);
}

/** 이스케이프 없이 넣는다. 문자열만 받는다 */
export function raw(s: string): SafeHtml {
  if (typeof s !== "string") throw new TypeError("이스케이프 없는 삽입은 문자열만 받는다");
  return new SafeHtml(MINT, s);
}

export function isSafeHtml(v: unknown): v is SafeHtml {
  return SafeHtml.is(v);
}

export function renderHtml(v: SafeHtml): string {
  if (!SafeHtml.is(v)) throw new TypeError("SafeHtml이 아니다");
  return SafeHtml.text(v);
}
