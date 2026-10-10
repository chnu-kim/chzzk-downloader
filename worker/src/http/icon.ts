// 아이콘 그리기(docs/design/system/web.md §4 "아이콘"). SVG 출력은 이 파일에만 있다.
// 경로 데이터는 icons.generated.ts(앱 icons.ts와 같은 원천)이고, 굵기는 CSS(.icon path)가 정한다.
// 숨은 스프라이트·인라인 스타일은 쓰지 않는다. path마다 vector-effect를 단다(상속되지 않는 속성이라 루트에 달면 효과가 없다).
import { html, type SafeHtml } from "../core/html";
import { ICONS } from "./icons.generated";

export type WorkerIconName = keyof typeof ICONS;

/** 장식 아이콘(읽는 글은 곁의 문구가 맡는다). 크기는 문맥 CSS(.notice, .status)가 정한다 */
export function icon(name: WorkerIconName): SafeHtml {
  const paths = ICONS[name].paths.map((d) => html`<path d="${d}" vector-effect="non-scaling-stroke"/>`);
  return html`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor">${paths}</svg>`;
}
