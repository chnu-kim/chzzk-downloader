// 문서 골격(docs/design/system/web.md §3, 계약 §2.4). 모든 페이지가 한 골격을 쓴다: 순서가 규칙이다.
// 머리(charset·viewport·color-scheme·theme-color 둘·제목·스타일시트·아이콘 셋[+ 랜딩만 description·og]) → skip link →
// 헤더(이름·배지·nav) → main(flash 한 장 → 본문) → 바닥글(링크 셋·비공식 고지). 모든 값은 HTML 태그드 템플릿을 거친다.
// 이 모듈은 라우터·저장소·핸들러 파일을 값으로 가져오지 않는다(순수 렌더 함수가 Node에서도 돈다, 계약 §2.1).
import type { Config } from "../config";
import { LOOPBACK_HOST } from "../core/loopback";
import { html, renderHtml, type SafeHtml } from "../core/html";
import { assetPath } from "./assets";
import { COPY } from "./copy";
import type { FlashKind } from "./flash";
import { notice } from "./ui";

export type Nav =
  | { readonly kind: "anon" }
  | { readonly kind: "auth" }
  | { readonly kind: "member"; readonly channelName: string; readonly isAdmin: boolean };

export interface PageOpts {
  /** reading이면 main에 data-scale="reading", 헤더·main·바닥글의 .col에 .col-reading */
  readonly scale: "app" | "reading";
  /** anon: [도움말] [로그인 → /#start], member: [도움말] [관리](관리자만) 채널 이름(링크 아님), auth(/auth/* 페이지): [도움말]만 */
  readonly nav: Nav;
  /** true(랜딩·읽기 페이지)만 색인한다. 아니면 X-Robots-Tag: noindex */
  readonly index?: boolean;
  /** 랜딩만: description·og:*(web.md §9.2) */
  readonly og?: boolean;
  /** main 첫 자식 알림(오류 요약과 함께 오지 않는다) */
  readonly flash?: FlashKind | null;
  /** 로그인 확인 페이지만: form-action에 루프백 출처를 더한다 */
  readonly loopbackFormAction?: boolean;
  /** Set-Cookie 등. 덮지 않고 더한다 */
  readonly headers?: HeadersInit;
  /** 제목 앞에 오류 접두. 기본은 status 400 이상. /auth/done의 실패(200)는 true를 준다 */
  readonly error?: boolean;
}

/** 브라우저 주소창 색(theme-color). SITE_CSS의 --bg(라이트·다크)와 같아야 한다(vitest가 대조한다) */
export const THEME_COLOR = { light: "#F3F3F3", dark: "#1F1F1F" } as const;

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

function navLinks(nav: Nav): SafeHtml {
  const help = html`<a href="/help">${COPY.helpTitle}</a>`;
  switch (nav.kind) {
    case "anon":
      return html`${help}<a href="/#start">${COPY.loginLink}</a>`;
    case "auth":
      return help;
    case "member":
      return html`${help}${nav.isAdmin ? html`<a href="/admin">${COPY.adminLink}</a>` : ""}<span class="site-user">${nav.channelName}</span>`;
  }
}

/** 알림 종류 → 알림 모양. 값 → 키를 리터럴 표로 고른다(키를 조립하지 않는다) */
function flashNotice(kind: FlashKind): SafeHtml {
  switch (kind) {
    case "loggedIn":
      return notice({ tone: "info", icon: "circle-check", body: COPY.doneOk.title, banner: true, id: "flash" });
    case "alreadyDone":
      return notice({ tone: "warning", body: COPY.alreadyDone, banner: true, id: "flash" });
    case "sessionGone":
      return notice({ tone: "warning", body: COPY.sessionGone, banner: true, id: "flash" });
  }
}

function headExtras(config: Config): SafeHtml {
  const origin = config.publicOrigin;
  return html`<meta name="description" content="${COPY.ogDescription}"><meta property="og:title" content="${COPY.siteTitle}"><meta property="og:type" content="website"><meta property="og:url" content="${origin}/"><meta property="og:description" content="${COPY.ogDescription}"><meta property="og:image" content="${origin + assetPath("og.png")}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${COPY.siteTitle}">`;
}

export function htmlPage(config: Config, status: number, title: string, body: SafeHtml, o: PageOpts): Response {
  const headers = htmlHeaders(config, { loopbackFormAction: o.loopbackFormAction === true });
  // 색인하는 페이지만 robots 헤더가 없다
  if (o.index !== true) headers.set("X-Robots-Tag", "noindex");
  if (o.headers !== undefined) {
    // 같은 이름(Set-Cookie)이 여럿일 수 있어 덮지 않고 더한다
    new Headers(o.headers).forEach((v, k) => headers.append(k, v));
  }
  // 랜딩 제목(siteTitle)은 이미 앱 이름을 품고 있어 꼬리를 붙이지 않는다
  const tail = title === COPY.siteTitle ? title : `${title} · ${COPY.siteName}`;
  const fullTitle = (o.error ?? status >= 400) ? `${COPY.errorTitlePrefix}${tail}` : tail;
  const reading = o.scale === "reading";
  const col = reading ? "col col-reading" : "col";
  const flash = o.flash === undefined || o.flash === null ? "" : flashNotice(o.flash);
  const doc = html`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="theme-color" media="(prefers-color-scheme: light)" content="${THEME_COLOR.light}"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="${THEME_COLOR.dark}"><title>${fullTitle}</title><link rel="stylesheet" href="${assetPath("site.css")}"><link rel="icon" href="${assetPath("icon.svg")}" type="image/svg+xml"><link rel="icon" href="${assetPath("favicon.ico")}" sizes="32x32"><link rel="apple-touch-icon" href="${assetPath("apple-touch-icon.png")}">${o.og === true ? headExtras(config) : ""}</head><body class="web"><a class="skip" href="#main">${COPY.skipLink}</a><header class="site-header"><div class="${col}"><a class="site-name" href="/">${COPY.siteName}</a><span class="badge">${COPY.pill}</span><nav class="site-nav" aria-label="${COPY.siteNav}">${navLinks(o.nav)}</nav></div></header><main id="main" class="${col} page"${reading ? html` data-scale="reading"` : ""}>${flash}${body}</main><footer class="site-footer"><div class="${col}"><ul><li><a href="/help">${COPY.helpTitle}</a></li><li><a href="/privacy">${COPY.privacyTitle}</a></li><li><a href="/licenses">${COPY.licensesTitle}</a></li></ul><p>${COPY.notice.unofficial}</p></div></footer></body></html>`;
  return new Response(renderHtml(doc), { status, headers });
}
