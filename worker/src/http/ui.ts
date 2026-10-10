// 페이지 부품(docs/design/system/web.md §7·§8, components.md §4 Worker 클래스 표). 순수 함수: 모든 출력은 HTML 태그드 템플릿을 거친다.
// 클래스는 design/ui.css의 것을 그대로 쓴다(웹 전용 클래스는 site.css). 스크립트·인라인 스타일 0개(CSP): 동작은 폼과 링크뿐이다.
import { html, type HtmlValue, type SafeHtml } from "../core/html";
import { COPY } from "./copy";
import { icon, type WorkerIconName } from "./icon";

/** `<input type="hidden" name="csrf" value="…">`. 글자 그대로의 모양이 e2e 정규식 계약이다(name="csrf" value= 순서) */
export function csrfInput(csrf: string): SafeHtml {
  return html`<input type="hidden" name="csrf" value="${csrf}">`;
}

/**
 * 한 번 누르는 POST 버튼(폼 하나). 여러 개는 호출하는 쪽이 `.actions`로 감싼다. 위험 표시(tone)는 되돌릴 수 없는 최종 단계에만 쓴다(§7.2).
 * fields는 숨은 입력이다
 */
export function postButton(
  action: string,
  csrf: string,
  label: string,
  o: { tone?: "danger"; primary?: boolean; fields?: Readonly<Record<string, string>> } = {},
): SafeHtml {
  const hidden = Object.entries(o.fields ?? {}).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`);
  const cls = `btn${o.primary === true ? " btn-primary" : ""}${o.tone === "danger" ? " tone-danger" : ""}`;
  return html`<form method="post" action="${action}">${csrfInput(csrf)}${hidden}<button type="submit" class="${cls}">${label}</button></form>`;
}

/** 버튼 모양 링크 `a.btn` */
export function linkButton(href: string, label: string, o: { primary?: boolean; lg?: boolean } = {}): SafeHtml {
  const cls = `btn${o.primary === true ? " btn-primary" : ""}${o.lg === true ? " btn-lg" : ""}`;
  return html`<a class="${cls}" href="${href}">${label}</a>`;
}

// 톤 → 아이콘 은유(foundations §9.1). 같은 아이콘을 다른 뜻에 쓰지 않는다(DI4)
const TONE_ICON = { info: "info", warning: "triangle-alert", danger: "circle-x" } as const;

/**
 * 알림(Notice). 라이브 영역 역할은 글자 요소(.notice-text)에 둔다(앱 Notice와 같다). 기본 역할: 위험은 alert, 그 밖은 status.
 * banner는 이름 붙은 영역(section) 안에 놓이고 main의 첫 자식이다(제목이 없으면 본문이 이름이다)
 */
export function notice(o: {
  tone: "info" | "warning" | "danger";
  /** 생략하면 톤의 은유를 쓴다(info → info, warning → triangle-alert, danger → circle-x). 다른 은유(완료·휴대폰)일 때만 고른다 */
  icon?: WorkerIconName;
  title?: string;
  body: HtmlValue;
  banner?: boolean;
  role?: "status" | "alert";
  id?: string;
}): SafeHtml {
  const base = o.id ?? "notice";
  const role = o.role ?? (o.tone === "danger" ? "alert" : "status");
  const body = typeof o.body === "string" ? html`<p>${o.body}</p>` : o.body;
  const title = o.title === undefined ? "" : html`<p class="notice-title" id="${base}-title">${o.title}</p>`;
  const box = html`<div class="notice ${o.banner === true ? "notice-banner" : "notice-inline"} tone-${o.tone}">${icon(o.icon ?? TONE_ICON[o.tone])}<div class="notice-text" role="${role}" aria-atomic="true">${title}<div id="${base}-body">${body}</div></div></div>`;
  if (o.banner !== true) return box;
  return html`<section aria-labelledby="${base}-${o.title === undefined ? "body" : "title"}">${box}</section>`;
}

/**
 * 입력 칸: 라벨은 위, 보조 설명은 라벨 아래, 오류는 칸 옆 한 줄(aria-invalid + aria-describedby). 비활성(disabled)은 쓰지 않는다
 */
export function field(o: {
  id: string;
  name: string;
  label: string;
  help?: string;
  value?: string;
  error?: string;
  mono?: boolean;
  readonly?: boolean;
  required?: boolean;
  maxlength?: number;
  pattern?: string;
  autocomplete?: string;
}): SafeHtml {
  const helpId = `${o.id}-help`;
  const errorId = `${o.id}-error`;
  const described = [o.help === undefined ? null : helpId, o.error === undefined ? null : errorId].filter((x) => x !== null).join(" ");
  const attrs = [
    o.value === undefined ? "" : html` value="${o.value}"`,
    o.readonly === true ? html` readonly` : "",
    o.required === true ? html` required` : "",
    o.maxlength === undefined ? "" : html` maxlength="${o.maxlength}"`,
    o.pattern === undefined ? "" : html` pattern="${o.pattern}"`,
    o.autocomplete === undefined ? "" : html` autocomplete="${o.autocomplete}"`,
    o.error === undefined ? "" : html` aria-invalid="true"`,
    described === "" ? "" : html` aria-describedby="${described}"`,
  ];
  const help = o.help === undefined ? "" : html`<p class="form-help" id="${helpId}">${o.help}</p>`;
  const error =
    o.error === undefined ? "" : html`<div class="notice notice-row tone-danger" id="${errorId}">${icon("circle-x")}<div class="notice-text">${o.error}</div></div>`;
  return html`<div class="form-field"><label for="${o.id}">${o.label}</label>${help}<input class="field${o.mono === true ? " field-mono" : ""}" type="text" id="${o.id}" name="${o.name}"${attrs}>${error}</div>`;
}

/** 오류 요약: main의 첫 자식. 필드로 가는 링크 목록(href="#필드 id")이다. 같은 화면에 flash와 함께 오지 않는다 */
export function errorSummary(errors: readonly { readonly fieldId: string; readonly message: string }[]): SafeHtml {
  const items = errors.map((e) => html`<li><a href="#${e.fieldId}">${e.message}</a></li>`);
  return notice({ tone: "danger", title: COPY.errorSummary, body: html`<ul>${items}</ul>`, banner: true, id: "error-summary" });
}

/**
 * 표: 가로 스크롤 영역(키보드로 스크롤할 수 있게 tabindex·role·이름)과 caption·th scope. 행(`<tr>`)은 호출하는 쪽이 만든다.
 * actions면 마지막 열 머리를 colAction(화면에서는 숨김)으로 덧붙인다(빈 th를 두지 않는다)
 */
export function dataTable(o: { id: string; caption: string; head: readonly string[]; actions?: boolean; rows: readonly SafeHtml[] }): SafeHtml {
  const heads = o.head.map((h) => html`<th scope="col">${h}</th>`);
  const last = o.actions === true ? html`<th scope="col"><span class="sr-only">${COPY.colAction}</span></th>` : "";
  return html`<div class="scroll" tabindex="0" role="region" aria-labelledby="${o.id}"><table><caption id="${o.id}">${o.caption}</caption><thead><tr>${heads}${last}</tr></thead><tbody>${o.rows}</tbody></table></div>`;
}

/** 행머리 셀 */
export function rowHead(v: HtmlValue): SafeHtml {
  return html`<th scope="row">${v}</th>`;
}

/** 접힘(details). 앵커 id는 이 안에 두지 않는다(닫힌 details 안의 앵커 이동은 확인되지 않았다) */
export function disclosure(summary: string, body: HtmlValue, o: { open?: boolean } = {}): SafeHtml {
  return html`<details class="disclosure"${o.open === true ? html` open` : ""}><summary>${icon("chevron-right")}${summary}</summary><div class="disclosure-panel">${body}</div></details>`;
}
