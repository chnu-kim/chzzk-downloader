// 안내·결과·확인 페이지(docs/design/system/web.md §6). 모든 페이지가 layout.ts의 한 골격을 쓴다.
// 모든 값은 HTML 태그드 템플릿을 거쳐 이스케이프된다(이스케이프 없는 삽입 함수는 쓰지 않는다).
// 이 모듈은 라우터·저장소·핸들러 파일을 값으로 가져오지 않는다(순수 렌더 함수가 Node에서도 돈다, 계약 §2.1).
import type { Config } from "../config";
import type { EntryContext } from "../core/entry";
import { html, type SafeHtml } from "../core/html";
import type { DoneView } from "../store/types";
import { COPY } from "./copy";
import { icon, type WorkerIconName } from "./icon";
import { htmlPage, type Nav } from "./layout";
import { notice } from "./ui";

export type DoneR = "ok" | "denied" | "cancelled" | "failed";

/** 거부 페이지 [초대 취소]의 폼 주소(routes.ts의 POST 행과 같다) */
export const CLAIM_CANCEL_PATH = "/auth/claim/cancel";

type Tone = "muted" | "warning" | "danger";

/** 상태 제목(h1): 아이콘이 제목 앞에 온다. 색은 톤 클래스(site.css)가 정한다. 색만으로 전하지 않는다: 제목 글자가 상태를 말한다 */
export function statusTitle(name: WorkerIconName, tone: Tone, title: string): SafeHtml {
  return html`<h1 class="status status-${tone}">${icon(name)}<span>${title}</span></h1>`;
}

/**
 * 안내·오류 페이지: h1은 무슨 일인지(상태별 제목), 본문은 다음에 할 일(없을 수 있다), 링크는 갈 곳 하나(web.md §6.2).
 * 4xx는 triangle-alert(warning), 5xx는 circle-x(danger), 200인 옛 앱 안내도 triangle-alert다.
 * 오류 응답의 <title> 접두는 htmlPage가 붙인다(여기서 붙이면 "오류: 오류: "가 된다). nav 기본은 auth(도움말만): 로그인 길을 하나 더 열지 않는다
 */
export function noticePage(
  config: Config,
  status: number,
  title: string,
  body: string | null,
  o: { nav?: Nav; headers?: HeadersInit; back?: { href: "/" | "/admin"; label: string } } = {},
): Response {
  const head = status >= 500 ? statusTitle("circle-x", "danger", title) : statusTitle("triangle-alert", "warning", title);
  const bodyP = body === null ? "" : html`<p>${body}</p>`;
  const back = o.back ?? { href: "/", label: COPY.home };
  return htmlPage(config, status, title, html`${head}${bodyP}<p><a href="${back.href}">${back.label}</a></p>`, {
    scale: "app",
    nav: o.nav ?? { kind: "auth" },
    ...(o.headers === undefined ? {} : { headers: o.headers }),
  });
}

/** 확인 페이지: 폼에 action 속성이 없어(현재 주소로 POST) handle이 본문에 나오지 않는다. [계속]이 이 페이지의 유일한 채움 버튼이다 */
export function loginConfirmPage(config: Config): Response {
  const body = html`<h1>${COPY.loginTitle}</h1>${notice({ tone: "warning", body: COPY.loginWarning })}<div class="actions"><form method="post"><button type="submit" class="btn btn-primary">${COPY.loginContinue}</button></form></div>`;
  return htmlPage(config, 200, COPY.loginTitle, body, { scale: "app", nav: { kind: "auth" }, loopbackFormAction: true });
}

/** 상태별 제목(h1·<title>)·아이콘·본문. 웹 흐름의 failed는 webBody, 앱 흐름이거나 흐름을 모르면 body를 쓴다 */
function doneParts(r: DoneR, view: DoneView | null, entry: EntryContext): { readonly head: SafeHtml; readonly title: string; readonly body: SafeHtml } {
  const status = view?.status ?? r;
  switch (status) {
    case "ok":
      return { title: COPY.doneOk.title, head: statusTitle("circle-check", "muted", COPY.doneOk.title), body: html`` };
    case "denied": {
      // 본인에게 비밀이 아닌 채널 정보(worker.md §8.3). 콜론 대칭: 채널: 이름 · 채널 ID: id
      const who =
        view?.channelId
          ? notice({ tone: "info", body: `${COPY.channelLabel}: ${view.channelName ?? ""} · ${COPY.channelIdLabel}: ${view.channelId}` })
          : html``;
      // 초대로 들어온 거부: 청구는 기록됐고 관리자가 허가하면 이어진다. 초대받은 사람이 먼저 읽도록 채널 정보 바로 뒤에 둔다. ?? null이 옛 DO(필드 없음)의 응답을 받는다
      const owner = view?.inviteOwnerName ?? null;
      // 잘못된 계정이면 스스로 청구를 끊는다: 안내 한 줄 + 테두리 버튼(채움 아님). 폼은 세션이 없어 F 쿠키와 같은 출처 검사가 증거다(106 (차) ②)
      const inviteLine =
        owner === null
          ? html``
          : html`<p>${COPY.doneDenied.invite(owner)}</p><p>${COPY.doneDenied.cancelHint}</p><div class="actions"><form method="post" action="${CLAIM_CANCEL_PATH}"><button type="submit" class="btn">${COPY.cancelInvite}</button></form></div>`;
      // 거부 이유가 있으면 이유별 제목·본문이고 다음에 할 일은 본문에 들어 있다. ?? null이 옛 DO(필드 없음)의 응답을 받는다(allowlist-open.md §4.3)
      const reason = view?.denyReason ?? null;
      const d = reason === "daily_limit" ? COPY.doneDenied.dailyLimit : reason === "blocked" ? COPY.doneDenied.blocked : null;
      if (d !== null) {
        return { title: d.title, head: statusTitle("circle-x", "danger", d.title), body: html`${who}${inviteLine}<p>${d.body}</p>` };
      }
      return {
        title: COPY.doneDenied.title,
        head: statusTitle("circle-x", "danger", COPY.doneDenied.title),
        body: html`${who}${inviteLine}<p>${COPY.doneDenied.body}</p><p>${COPY.doneDenied.next}</p>`,
      };
    }
    case "cancelled":
      return { title: COPY.doneCancelled.title, head: statusTitle("info", "muted", COPY.doneCancelled.title), body: html`<p>${COPY.doneCancelled.body}</p>` };
    case "failed": {
      // 인앱 보충 단락은 실패 뒤에만, 카카오톡 안일 때만(막지 않는다)
      const hint = entry.inApp === "kakao" ? html`<p>${COPY.inAppHint}</p>` : html``;
      return {
        title: COPY.doneFailed.title,
        head: statusTitle("circle-x", "danger", COPY.doneFailed.title),
        body: html`<p>${view?.kind === "web" ? COPY.doneFailed.webBody : COPY.doneFailed.body}</p>${hint}`,
      };
    }
  }
}

/** 완료 페이지. view(F 쿠키로 찾은 흐름)가 있으면 그 상태를, 없으면 쿼리의 r을 따른다. clearFlowCookie가 있으면 F를 지운다 */
export function donePage(config: Config, r: DoneR, view: DoneView | null, clearFlowCookie: string | null, entry: EntryContext): Response {
  const { head, title, body } = doneParts(r, view, entry);
  const failed = (view?.status ?? r) === "failed";
  return htmlPage(config, 200, title, html`${head}${body}<p><a href="/">${COPY.home}</a></p>`, {
    scale: "app",
    nav: { kind: "auth" },
    // 실패는 200이어도 <title>에 오류 접두를 붙인다(web.md §6.1)
    error: failed,
    ...(clearFlowCookie === null ? {} : { headers: { "Set-Cookie": clearFlowCookie } }),
  });
}
