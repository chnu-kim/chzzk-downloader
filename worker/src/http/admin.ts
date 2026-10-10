// 관리 화면과 POST 동작(docs/design/worker.md §8.1·§4.4, 구현 중 변경 38). 모든 POST는 guardWebPost(관리자, csrf)를 지난 뒤에만 움직이고,
// 경로 값 검사는 늘 그 뒤다(세션이 없으면 매개변수와 상관없이 303 /). 신원은 로그인 채널이다.
// /admin/sessions/:id/revoke·/admin/denied/:channelId/*·/admin/:channelId/disallow는 quiet 경로다(routes.ts): ctx.log가 아무것도 하지 않고 성공 이벤트는 DO가 남긴다.
// 이미 처리된 대상(없는 세션·지운 거부 기록·허가에 없는 채널)은 오류가 아니라 303 /admin + flash alreadyDone이다(멱등, web.md §6.3). 404는 형식이 틀린 경로 값에만 쓴다.
import { isId } from "../core/token";
import type { Ctx } from "../routes";
import { CHANNEL_ID } from "../store/allowlist";
import { ALLOW_CHANNEL_FIELD, renderAdmin, renderDisallowConfirm } from "./admin-view";
import { COPY } from "./copy";
import { flashCookie, readFlash } from "./flash";
import { noticePage } from "./pages";
import { oneField } from "./request";
import { guardWebPost, memberNav, readWebSession, seeOther, setCookieHeaders, toHome } from "./web-session";

const notFound = (ctx: Ctx): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "not_found" });
  // /auth/*가 아닌 곳의 404: 세션을 읽지 않았으니 비로그인 nav([로그인] 포함)로 낸다(web.md §15-9)
  return noticePage(ctx.config, 404, COPY.notFound.title, COPY.notFound.body, { nav: { kind: "anon" } });
};

const badBody = (ctx: Ctx): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "bad_body" });
  return noticePage(ctx.config, 400, COPY.badFormat.title, COPY.badBody);
};

const badChannel = (ctx: Ctx): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "bad_channel_id" });
  return noticePage(ctx.config, 400, COPY.badFormat.title, COPY.badChannelId);
};

// 이미 처리된 대상: 오류가 아니라 관리 화면으로 보내고 "이미 처리됐어요"를 한 번 알린다
const alreadyDone = (ctx: Ctx): Response => seeOther("/admin", [flashCookie(ctx.cookies, "alreadyDone")]);

// 관리자 채널은 secret(ADMIN_CHANNEL_IDS)에서만 정한다(§8.1): 허용목록 행을 만들면 secret에서 빼도 허용이 남고 화면에서 지울 길도 없다
const adminChannel = (ctx: Ctx): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "is_admin" });
  return noticePage(ctx.config, 409, COPY.adminNoAllow.title, COPY.adminNoAllow.body);
};

const isAdminRow = (ctx: Ctx, nav: ReturnType<typeof memberNav>): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "is_admin" });
  return noticePage(ctx.config, 409, COPY.isAdmin.title, null, { nav, back: { href: "/admin", label: COPY.reloadAdmin } });
};

/** GET /admin: 부트스트랩 403 → 세션 없음 303 / → 관리자 아님 403 → 200 */
export async function adminPage(req: Request, ctx: Ctx): Promise<Response> {
  if (ctx.config.adminChannelIds.length === 0) {
    ctx.log("web.page.rejected", { level: "warn", route: ctx.route, reason: "bootstrap" });
    return noticePage(ctx.config, 403, COPY.bootstrapAdmin.title, null);
  }
  const r = await readWebSession(req, ctx);
  if (!r.ok) return toHome(r.clear);
  if (!r.s.isAdmin) {
    ctx.log("web.page.rejected", { level: "warn", route: ctx.route, reason: "not_admin" });
    return noticePage(ctx.config, 403, COPY.adminOnly.title, null, { nav: memberNav(r.s) });
  }
  const view = await ctx.store.adminView(ctx.now);
  // flash(303 뒤 알림)는 한 번 그리고 같은 응답에서 지운다
  const f = readFlash(req, ctx.cookies);
  const headers = setCookieHeaders([f.clear]);
  return renderAdmin(ctx.config, { view, admins: ctx.config.adminChannelIds, csrf: r.s.csrf, nav: memberNav(r.s) }, { flash: f.kind, ...(headers === undefined ? {} : { headers }) });
}

/**
 * GET /admin/:channelId/disallow: 허가 빼기 확인 페이지(D54, 계약 §2.5). 상태·감사 기록을 바꾸지 않는다(GET이라 Origin 검사가 없다, 크롤러가 불러도 불변).
 * 부트스트랩 403 → 세션 없음 303 / → 관리자 아님 403(adminPage와 같은 순서) → 경로 값 형식 404 → 관리자 채널 409 → 허가에 없음 303 /admin + alreadyDone → 200.
 * URL에 채널 id가 실리는 quiet 경로다
 */
export async function adminDisallowConfirm(req: Request, ctx: Ctx): Promise<Response> {
  if (ctx.config.adminChannelIds.length === 0) {
    ctx.log("web.page.rejected", { level: "warn", route: ctx.route, reason: "bootstrap" });
    return noticePage(ctx.config, 403, COPY.bootstrapAdmin.title, null);
  }
  const r = await readWebSession(req, ctx);
  if (!r.ok) return toHome(r.clear);
  if (!r.s.isAdmin) {
    ctx.log("web.page.rejected", { level: "warn", route: ctx.route, reason: "not_admin" });
    return noticePage(ctx.config, 403, COPY.adminOnly.title, null, { nav: memberNav(r.s) });
  }
  const id = ctx.params.channelId ?? "";
  if (!CHANNEL_ID.test(id)) return notFound(ctx);
  if (ctx.config.adminChannelIds.includes(id)) return isAdminRow(ctx, memberNav(r.s));
  const row = (await ctx.store.adminView(ctx.now)).allowlist.find((a) => a.channelId === id);
  if (row === undefined) return alreadyDone(ctx);
  return renderDisallowConfirm(ctx.config, { channelId: id, channelName: row.channelName, activeSessions: row.activeSessions, csrf: r.s.csrf, nav: memberNav(r.s) });
}

/** POST /admin/allow. 채널 ID 형식이 틀리면 400 + 관리 화면 다시 그리기(오류 요약·입력값 채움, web.md §6.3) */
export async function adminAllow(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  // 같은 이름이 둘 이상이면 어느 쪽이 맞는지 알 수 없어 bad_body, 없음·형식 틀림은 오류 요약
  if (g.form.getAll("channelId").length > 1) return badBody(ctx);
  const channelId = oneField(g.form, "channelId");
  const notes = g.form.getAll("note");
  if (channelId === null || !CHANNEL_ID.test(channelId)) {
    ctx.log("admin.rejected", { route: ctx.route, reason: "bad_channel_id" });
    const view = await ctx.store.adminView(ctx.now);
    return renderAdmin(
      ctx.config,
      { view, admins: ctx.config.adminChannelIds, csrf: g.s.csrf, nav: memberNav(g.s) },
      {
        status: 400,
        errors: [{ fieldId: ALLOW_CHANNEL_FIELD, message: COPY.badChannelId }],
        // 입력값은 되돌려 채운다(이스케이프는 field가 한다). 길이는 입력 칸 상한까지만 되돌린다
        values: { channelId: (channelId ?? "").slice(0, 64), note: notes.length === 1 ? (notes[0] ?? "").slice(0, 64) : "" },
      },
    );
  }
  if (ctx.config.adminChannelIds.includes(channelId)) return adminChannel(ctx);
  // 메모는 store가 64자로 자르고, 비어 있으면 있던 메모를 그대로 둔다(구현 중 변경 38 (카)). 같은 이름이 둘 이상이면 어느 쪽이 맞는지 알 수 없어 거절한다
  if (notes.length > 1) return badBody(ctx);
  const r = await ctx.store.allow(channelId, notes[0] ?? "", g.s.channelId, ctx.now);
  if (!r.ok) return badChannel(ctx);
  ctx.log("admin.allow", { route: ctx.route });
  return seeOther("/admin");
}

/** POST /admin/disallow (확인 페이지의 최종 버튼) */
export async function adminDisallow(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  // 같은 이름이 둘 이상이면 어느 쪽이 맞는지 알 수 없어 bad_body, 없음·형식 틀림은 bad_channel_id
  if (g.form.getAll("channelId").length > 1) return badBody(ctx);
  const channelId = oneField(g.form, "channelId");
  if (channelId === null || !CHANNEL_ID.test(channelId)) return badChannel(ctx);
  const r = await ctx.store.disallow(channelId, g.s.channelId, ctx.config.adminChannelIds, ctx.now);
  if (r.ok) {
    ctx.log("admin.disallow", { route: ctx.route });
    return seeOther("/admin");
  }
  if (r.code === "is_admin") return isAdminRow(ctx, memberNav(g.s));
  // 허용목록에 없는 채널(이미 뺐다): 아무것도 쓰지 않았다(감사 없음). 오류가 아니다
  if (r.code === "not_found") return alreadyDone(ctx);
  return badChannel(ctx);
}

/** POST /admin/sessions/:id/revoke */
export async function adminRevokeSession(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  const id = ctx.params.id;
  if (!isId(id)) return notFound(ctx);
  // 성공 이벤트(admin.revoke_session)는 revoke RPC가 남긴다. 이미 끊긴 세션은 오류가 아니다
  if (!(await ctx.store.revoke(id, "admin", g.s.channelId, ctx.now))) return alreadyDone(ctx);
  return seeOther("/admin");
}

/** POST /admin/denied/:channelId/allow */
export async function adminDeniedAllow(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  const id = ctx.params.channelId ?? "";
  if (!CHANNEL_ID.test(id)) return notFound(ctx);
  if (ctx.config.adminChannelIds.includes(id)) return adminChannel(ctx);
  // 성공 이벤트(admin.denied_allow)는 allowDenied RPC가 남긴다. 거부 기록이 이미 없으면 오류가 아니다
  if (!(await ctx.store.allowDenied(id, g.s.channelId, ctx.now))) return alreadyDone(ctx);
  return seeOther("/admin");
}

/** POST /admin/denied/:channelId/dismiss */
export async function adminDeniedDismiss(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  const id = ctx.params.channelId ?? "";
  if (!CHANNEL_ID.test(id)) return notFound(ctx);
  // 성공 이벤트(admin.denied_dismiss)는 dismissDenied RPC가 남긴다
  if (!(await ctx.store.dismissDenied(id, g.s.channelId, ctx.now))) return alreadyDone(ctx);
  return seeOther("/admin");
}
