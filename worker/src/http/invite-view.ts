// 편집자 초대·완료 페이지 렌더러(docs/design/features/delegation.md §5, worker.md 구현 중 변경 106).
// 순수 함수: 모든 값은 태그드 템플릿을 거쳐 이스케이프된다(주인·편집자 이름은 공격자가 정한 문자열이다).
// 이 모듈은 라우터·저장소 클래스·핸들러 파일을 값으로 가져오지 않는다(design-worker가 Node에서 부른다, 계약 §2.1).
// 동작은 폼과 링크뿐이다(스크립트 없음, D52). 채움 버튼은 비로그인 1 · 확인 1 · 자기 초대 0 · 완료 0이다.
import type { Config } from "../config";
import type { EntryContext } from "../core/entry";
import { html } from "../core/html";
import { COPY } from "./copy";
import { htmlPage, type Nav } from "./layout";
import { statusTitle } from "./pages";
import { csrfInput, postButton } from "./ui";

/**
 * 비로그인: 고지 네 줄과 [치지직으로 로그인] 하나. 로그인이 곧 수락이다(delegation.md §5.1).
 * 헤더에 [로그인] 링크를 두지 않는다(nav auth): 이 페이지의 버튼이 로그인이다. 인앱 안내·휴대폰 차단은 두지 않는다
 */
export function renderInvite(config: Config, m: { ownerName: string; token: string }): Response {
  const owner = m.ownerName;
  const body = html`<h1>${COPY.invite.title(owner)}</h1><p>${COPY.invite.body}</p><p>${COPY.landing.consent.collect}</p><p>${COPY.invite.consent.use(owner)}</p><p>${COPY.landing.consent.exclude}</p><p>${COPY.invite.consent.revoke}</p><p><a href="/privacy">${COPY.privacyTitle}</a></p><div class="actions"><form method="post" action="/invite/${m.token}/start"><button type="submit" class="btn btn-primary">${COPY.loginWithChzzk}</button></form></div>`;
  return htmlPage(config, 200, COPY.invite.title(owner), body, { scale: "app", nav: { kind: "auth" } });
}

/** 이미 로그인한 브라우저의 확인: [편집자 되기] 한 번(다음 단계가 하나뿐이라 확인 한 번이 전부다) */
export function renderInviteConfirm(config: Config, m: { ownerName: string; me: string; csrf: string; token: string; nav: Nav }): Response {
  const owner = m.ownerName;
  const body = html`<h1>${COPY.invite.confirm.title(owner)}</h1><dl class="summary"><dt>${COPY.invite.confirm.owner}</dt><dd>${owner}</dd><dt>${COPY.myChannel}</dt><dd>${m.me}</dd></dl><p>${COPY.invite.confirm.body(owner)}</p><p>${COPY.invite.confirm.body2(owner)}</p><div class="actions"><form method="post" action="/invite/${m.token}/accept">${csrfInput(m.csrf)}<button type="submit" class="btn btn-primary">${COPY.invite.accept}</button></form><a href="/">${COPY.home}</a></div>`;
  return htmlPage(config, 200, COPY.invite.confirm.title(owner), body, { scale: "app", nav: m.nav });
}

/** 자기 초대: 상태 제목(info) + 한 줄. 채움 버튼 없음 */
export function renderInviteOwn(config: Config, nav: Nav): Response {
  const body = html`${statusTitle("info", "muted", COPY.invite.own.title)}<p>${COPY.invite.own.body}</p><p><a href="/">${COPY.home}</a></p>`;
  return htmlPage(config, 200, COPY.invite.own.title, body, { scale: "app", nav });
}

/**
 * 편집자 완료: 결과와 다음 할 일. [편집자 그만두기]는 되돌릴 수 있으므로 위험 표시 없는 테두리 버튼이다(D54).
 * 컴퓨터 설치 안내는 휴대폰·카카오톡 진입에서만 덧붙인다(막지 않는다)
 */
export function renderDelegationDone(
  config: Config,
  m: { ownerName: string; ownerChannelId: string; me: string; csrf: string; entry: EntryContext; nav: Nav },
): Response {
  const owner = m.ownerName;
  const desktop = m.entry.kind === "phone" || m.entry.inApp !== null ? html`<p>${COPY.inviteDone.desktop}</p>` : "";
  const leave = postButton("/me/delegations/leave", m.csrf, COPY.leaveDelegation, { fields: { owner: m.ownerChannelId } });
  const body = html`${statusTitle("circle-check", "muted", COPY.inviteDone.title(owner))}<dl class="summary"><dt>${COPY.myChannel}</dt><dd>${m.me}</dd></dl><p>${COPY.inviteDone.body(owner)}</p><p>${COPY.inviteDone.refresh}</p>${desktop}<p>${COPY.inviteDone.otherAccount}</p><div class="actions">${leave}<a href="/">${COPY.home}</a></div>`;
  return htmlPage(config, 200, COPY.inviteDone.title(owner), body, { scale: "app", nav: m.nav });
}
