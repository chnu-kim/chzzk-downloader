// HTML 응답(docs/design/worker.md §4 "공통"·§8.1, 구현 중 변경 27 (아)). W4 최소 골격: 스타일시트 링크와 나머지 화면은 W6.
// 모든 값은 html 태그드 템플릿을 거쳐 이스케이프된다(이스케이프 없는 삽입 함수는 쓰지 않는다).
import type { Config } from "../config";
import { html, renderHtml, type SafeHtml } from "../core/html";
import type { DoneView } from "../store/types";
import { COPY } from "./copy";

export type DoneR = "ok" | "denied" | "cancelled" | "failed";

/** HTML 응답 공통 헤더. CSP의 form-action에 치지직 인가 주소의 출처를 넣는다(폼 전송 뒤 303 대상에도 적용하는 브라우저가 있다) */
export function htmlHeaders(config: Config): Headers {
  const h = new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' ${new URL(config.authorizeUrl).origin}; frame-ancestors 'none'; base-uri 'none'`,
  );
  // no-referrer가 아니다: 정책이 no-referrer인 문서가 보내는 POST에는 Origin: null이 실려 [계속] 검사에 막힌다
  h.set("Referrer-Policy", "same-origin");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  return h;
}

export function htmlPage(config: Config, status: number, title: string, body: SafeHtml, extra?: HeadersInit): Response {
  const headers = htmlHeaders(config);
  if (extra !== undefined) {
    // 같은 이름(Set-Cookie)이 여럿일 수 있어 덮지 않고 더한다
    new Headers(extra).forEach((v, k) => headers.append(k, v));
  }
  const doc = html`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · ${COPY.siteName}</title></head><body><main>${body}</main></body></html>`;
  return new Response(renderHtml(doc), { status, headers });
}

export function noticePage(config: Config, status: number, message: string, extra?: HeadersInit): Response {
  return htmlPage(config, status, COPY.noticeTitle, html`<h1>${COPY.noticeTitle}</h1><p>${message}</p>`, extra);
}

/** 확인 페이지: 폼에 action 속성이 없어(현재 주소로 POST) handle이 본문에 나오지 않는다 */
export function loginConfirmPage(config: Config, userCode: string): Response {
  return htmlPage(
    config,
    200,
    COPY.loginTitle,
    html`<h1>${COPY.loginTitle}</h1><p>${COPY.loginLead}</p><p>${COPY.codeLabel}</p><p class="code">${userCode}</p><p class="warn">${COPY.loginWarning}</p><form method="post"><button type="submit">${COPY.loginContinue}</button></form>`,
  );
}

function doneBody(r: DoneR, view: DoneView | null): SafeHtml {
  const status = view?.status ?? r;
  switch (status) {
    case "ok":
      return view?.kind === "app" && view.userCode !== null
        ? html`<p>${COPY.doneOkApp}</p><p>${COPY.codeLabel}</p><p class="code">${view.userCode}</p>`
        : html`<p>${COPY.doneOk}</p>`;
    case "denied":
      return view?.channelId
        ? html`<p>${COPY.doneDenied}</p><p>${COPY.channelLabel}: ${view.channelName ?? ""} · ${COPY.channelIdLabel} ${view.channelId}</p><p>${COPY.doneDeniedHint}</p><p>${COPY.doneDeniedSwitch}</p>`
        : html`<p>${COPY.doneDenied}</p><p>${COPY.doneDeniedHint}</p><p>${COPY.doneDeniedSwitch}</p>`;
    case "cancelled":
      return html`<p>${COPY.doneCancelled}</p>`;
    case "failed":
      return html`<p>${COPY.doneFailed}</p>`;
  }
}

/** 완료 페이지. view(F 쿠키로 찾은 흐름)가 있으면 그 상태를, 없으면 쿼리의 r을 따른다. clearFlowCookie가 있으면 F를 지운다 */
export function donePage(config: Config, r: DoneR, view: DoneView | null, clearFlowCookie: string | null): Response {
  const extra = clearFlowCookie === null ? undefined : { "Set-Cookie": clearFlowCookie };
  return htmlPage(config, 200, COPY.doneTitle, html`<h1>${COPY.doneTitle}</h1>${doneBody(r, view)}`, extra);
}
