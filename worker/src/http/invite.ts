// 편집자 초대·완료 웹 핸들러(docs/design/features/delegation.md §5, worker.md 구현 중 변경 106).
// GET /invite/:token · POST /invite/:token/accept 는 URL에 초대 토큰이 실리는 quiet 경로다(routes.ts): ctx.log가 아무것도 하지 않는다.
// 로그인 시작(POST /invite/:token/start)은 치지직 호출 도우미가 있는 auth.ts에 있다.
// GET은 상태를 바꾸지 않는다(링크 미리보기 봇이 열어도 불변): 초대는 POST accept 또는 콜백에서만 소비된다.
// 인증 없는 요청의 DO 호출은 한 번뿐이다: 웹 세션 확인과 초대 보기를 invitePage 한 RPC에서 한다(38 (라), 106).
import { readCookie } from "../core/cookies";
import { entryContext } from "../core/entry";
import { isToken, sha256Hex } from "../core/token";
import type { Ctx } from "../routes";
import { CHANNEL_ID } from "../store/allowlist";
import { COPY } from "./copy";
import { flashCookie } from "./flash";
import { renderDelegationDone, renderInvite, renderInviteConfirm, renderInviteOwn } from "./invite-view";
import { noticePage } from "./pages";
import { oneField } from "./request";
import { doneLocation, guardWebPost, memberNav, readWebSession, seeOther, toHome, webSessionOf } from "./web-session";
import type { Nav } from "./layout";

/** 없음·만료·사용됨·형식 밖을 가르지 않는 하나의 404(delegation.md §11) */
const gonePage = (ctx: Ctx, nav: Nav): Response => noticePage(ctx.config, 404, COPY.invite.gone.title, COPY.invite.gone.body, { nav });

/** GET /invite/:token */
export async function inviteGet(req: Request, ctx: Ctx): Promise<Response> {
  const token = ctx.params.token ?? "";
  if (!isToken("invite", token)) return gonePage(ctx, { kind: "auth" });
  const cookie = readCookie(req.headers.get("Cookie"), ctx.cookies.session);
  const cookieHash = isToken("web", cookie) ? await sha256Hex(cookie) : null;
  // 배포 창에서 새 Worker가 invitePage가 없는 옛 DO를 부르면 RPC가 던진다: 500 JSON 대신 안내 페이지(106 (차) ⑤). quiet라 로그는 없다
  const p = await ctx.store.invitePage(await sha256Hex(token), cookieHash, ctx.config.adminChannelIds, ctx.now).catch(() => null);
  if (p === null) return noticePage(ctx.config, 503, COPY.invite.unavailable.title, COPY.retryLater.body);
  // 읽기 페이지는 상태를 바꾸지 않는다: 형식 밖·끝난 세션 쿠키도 지우지 않는다(106 D-12)
  const s = p.web !== null && p.web.ok ? webSessionOf(p.web) : null;
  const nav: Nav = s === null ? { kind: "auth" } : memberNav(s);
  const v = p.view;
  if (v === null) return gonePage(ctx, nav);
  switch (v.relation) {
    case "own":
      return renderInviteOwn(ctx.config, nav);
    case "already":
      return seeOther("/", [flashCookie(ctx.cookies, "alreadyEditor")]);
    case "full":
      return noticePage(ctx.config, 409, COPY.invite.full.title, COPY.invite.full.body, { nav });
    case "open":
      return s === null
        ? renderInvite(ctx.config, { ownerName: v.ownerName, token })
        : renderInviteConfirm(ctx.config, { ownerName: v.ownerName, me: s.channelName, csrf: s.csrf, token, nav });
  }
}

/** POST /invite/:token/accept: 이미 로그인한 브라우저의 [편집자 되기] */
export async function inviteAccept(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: false });
  if (!g.ok) return g.response;
  const token = ctx.params.token ?? "";
  if (!isToken("invite", token)) return gonePage(ctx, memberNav(g.s));
  const a = await ctx.store.acceptInvite(await sha256Hex(token), g.s.channelId, g.s.channelName, ctx.config.adminChannelIds, ctx.now);
  if (a.ok) return seeOther(doneLocation(a.ownerChannelId));
  switch (a.code) {
    case "already":
      return seeOther("/", [flashCookie(ctx.cookies, "alreadyEditor")]);
    case "own":
      return seeOther("/", [flashCookie(ctx.cookies, "inviteOwn")]);
    case "full":
      return seeOther("/", [flashCookie(ctx.cookies, "inviteFull")]);
    // 웹 세션 확인과 수락 사이에 허가가 빠진 경합도 열 수 없는 초대와 같이 낸다(콜백의 not_allowed → gone과 같은 규칙, 106 D-5)
    case "gone":
    case "not_allowed":
      return gonePage(ctx, memberNav(g.s));
  }
}

/**
 * GET /me/delegations/done/:owner (quiet: 주인 채널 ID가 경로에 실린다): 그 주인과 방금(2분 안에) 맺은 위임이 권한이 나갈 때만. 없으면 처음 화면으로.
 * 주인은 수락이 303 주소에 실어 보낸 값이다: 결과는 그 수락에 묶이고, 다른 탭의 수락이 이 화면을 바꾸지 못한다(106 (차) ③).
 * 주소를 손으로 바꿔도 내 세션의 내 위임만 보이므로 서명하지 않는다
 */
export async function delegationDone(req: Request, ctx: Ctx): Promise<Response> {
  const r = await readWebSession(req, ctx);
  if (!r.ok) return toHome(r.clear);
  const owner = ctx.params.owner ?? "";
  if (!CHANNEL_ID.test(owner)) return seeOther("/");
  const d = await ctx.store.recentDelegationFor(r.s.channelId, owner, ctx.config.adminChannelIds, ctx.now);
  if (d === null) return seeOther("/");
  return renderDelegationDone(ctx.config, {
    ownerName: d.channelName,
    ownerChannelId: d.channelId,
    me: r.s.channelName,
    csrf: r.s.csrf,
    entry: entryContext(req.headers),
    nav: memberNav(r.s),
  });
}

/** POST /me/delegations/leave: 편집자가 그만둔다(확인 없음, 되돌릴 수 있다: 새 초대를 받으면 된다) */
export async function delegationLeave(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: false });
  if (!g.ok) return g.response;
  const owner = oneField(g.form, "owner");
  if (owner === null || !CHANNEL_ID.test(owner)) {
    ctx.log("web.post.rejected", { level: "warn", route: ctx.route, reason: "bad_owner" });
    return noticePage(ctx.config, 400, COPY.badFormat.title, COPY.badBody, { nav: memberNav(g.s) });
  }
  // 앞은 편집자의 로그인 ID, 뒤는 주인의 판정용 ID다
  const r = await ctx.store.leaveDelegation(g.s.channelId, owner, ctx.now);
  return seeOther("/", [flashCookie(ctx.cookies, r.ok ? "delegationLeft" : "alreadyDone")]);
}
