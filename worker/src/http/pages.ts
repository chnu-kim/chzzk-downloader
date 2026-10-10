// HTML 응답(docs/design/worker.md §4 "공통"·§8.1, 구현 중 변경 27 (아)). W6: 모든 페이지가 한 골격(htmlPage)·스타일시트를 쓴다.
// 모든 값은 HTML 태그드 템플릿을 거쳐 이스케이프된다(이스케이프 없는 삽입 함수는 쓰지 않는다).
import type { Config } from "../config";
import { LOOPBACK_HOST } from "../core/loopback";
import { html, renderHtml, type SafeHtml } from "../core/html";
import type { DoneView } from "../store/types";
import { COPY } from "./copy";
import { SITE_CSS_PATH } from "./site-css";

export type DoneR = "ok" | "denied" | "cancelled" | "failed";

/**
 * HTML 응답 공통 헤더. CSP의 form-action에 치지직 인가 주소의 출처를 넣는다(폼 전송 뒤 303 대상에도 적용하는 브라우저가 있다).
 * 88 (가): 폼 전송 뒤 리디렉션 사슬의 루프백 303에도 form-action이 적용된다(Chrome·Safari 실측): 확인 페이지만 루프백 출처를 더한다
 */
export function htmlHeaders(config: Config, o: { loopbackFormAction?: boolean } = {}): Headers {
  const h = new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set(
    "Content-Security-Policy",
    `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' ${new URL(config.authorizeUrl).origin}${o.loopbackFormAction ? ` http://${LOOPBACK_HOST}:*` : ""}; frame-ancestors 'none'; base-uri 'none'`,
  );
  // no-referrer가 아니다: 정책이 no-referrer인 문서가 보내는 POST에는 Origin: null이 실려 [계속] 검사에 막힌다
  h.set("Referrer-Policy", "same-origin");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  return h;
}

export function htmlPage(config: Config, status: number, title: string, body: SafeHtml, extra?: HeadersInit, o?: { loopbackFormAction?: boolean }): Response {
  const headers = htmlHeaders(config, o);
  if (extra !== undefined) {
    // 같은 이름(Set-Cookie)이 여럿일 수 있어 덮지 않고 더한다
    new Headers(extra).forEach((v, k) => headers.append(k, v));
  }
  // 랜딩 제목(siteTitle)은 이미 앱 이름을 품고 있어 꼬리를 붙이지 않는다
  const fullTitle = title === COPY.siteTitle ? title : `${title} · ${COPY.siteName}`;
  const doc = html`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${fullTitle}</title><link rel="stylesheet" href="${SITE_CSS_PATH}"></head><body><main><header><a href="/">${COPY.siteName}</a></header>${body}</main></body></html>`;
  return new Response(renderHtml(doc), { status, headers });
}

/**
 * 안내·오류 페이지: h1은 무슨 일인지(상태별 제목), 본문은 다음에 할 일(없을 수 있다), 링크는 처음으로 하나(web.md §6.2).
 * 오류 응답(4xx·5xx)의 <title>에는 "오류: " 접두를 붙인다. 200인 옛 앱 안내에는 붙이지 않는다
 */
export function noticePage(config: Config, status: number, title: string, body: string | null, extra?: HeadersInit): Response {
  const docTitle = status >= 400 ? `${COPY.errorTitlePrefix}${title}` : title;
  const bodyP = body === null ? html`` : html`<p>${body}</p>`;
  return htmlPage(config, status, docTitle, html`<h1>${title}</h1>${bodyP}<p><a href="/">${COPY.home}</a></p>`, extra);
}

/** 확인 페이지: 폼에 action 속성이 없어(현재 주소로 POST) handle이 본문에 나오지 않는다 */
export function loginConfirmPage(config: Config): Response {
  return htmlPage(
    config,
    200,
    COPY.loginTitle,
    html`<h1>${COPY.loginTitle}</h1><p class="warn">${COPY.loginWarning}</p><form method="post"><button type="submit">${COPY.loginContinue}</button></form>`,
    undefined,
    { loopbackFormAction: true },
  );
}

/** 상태별 제목(h1·<title>)과 본문. 웹 흐름의 failed는 webBody, 앱 흐름이거나 흐름을 모르면 body를 쓴다 */
function doneParts(r: DoneR, view: DoneView | null): { readonly title: string; readonly body: SafeHtml } {
  const status = view?.status ?? r;
  switch (status) {
    case "ok":
      return { title: COPY.doneOk.title, body: html`` };
    case "denied": {
      const who =
        view?.channelId
          ? html`<p>${COPY.channelLabel}: ${view.channelName ?? ""} · ${COPY.channelIdLabel}: ${view.channelId}</p>`
          : html``;
      return { title: COPY.doneDenied.title, body: html`${who}<p>${COPY.doneDenied.body}</p><p>${COPY.doneDenied.next}</p>` };
    }
    case "cancelled":
      return { title: COPY.doneCancelled.title, body: html`<p>${COPY.doneCancelled.body}</p>` };
    case "failed":
      return { title: COPY.doneFailed.title, body: html`<p>${view?.kind === "web" ? COPY.doneFailed.webBody : COPY.doneFailed.body}</p>` };
  }
}

/** 완료 페이지. view(F 쿠키로 찾은 흐름)가 있으면 그 상태를, 없으면 쿼리의 r을 따른다. clearFlowCookie가 있으면 F를 지운다 */
export function donePage(config: Config, r: DoneR, view: DoneView | null, clearFlowCookie: string | null): Response {
  const extra = clearFlowCookie === null ? undefined : { "Set-Cookie": clearFlowCookie };
  const { title, body } = doneParts(r, view);
  // 실패는 <title>에 오류 접두를 붙인다(web.md §6.1)
  const docTitle = (view?.status ?? r) === "failed" ? `${COPY.errorTitlePrefix}${title}` : title;
  return htmlPage(config, 200, docTitle, html`<h1>${title}</h1>${body}`, extra);
}
