// 관리 화면과 POST 동작(docs/design/worker.md §8.1·§4.4, 구현 중 변경 38). 모든 POST는 guardWebPost(관리자, csrf)를 지난 뒤에만 움직이고,
// 경로 값 검사는 늘 그 뒤다(세션이 없으면 매개변수와 상관없이 303 /). 신원은 로그인 채널이다.
// /admin/sessions/:id/revoke·/admin/denied/:channelId/*는 quiet 경로다(routes.ts): ctx.log가 아무것도 하지 않고 성공 이벤트는 DO가 남긴다.
import { isId } from "../core/token";
import type { Ctx } from "../routes";
import { CHANNEL_ID } from "../store/allowlist";
import { adminBody } from "./admin-view";
import { COPY } from "./copy";
import { htmlPage, noticePage } from "./pages";
import { oneField } from "./request";
import { guardWebPost, readWebSession, seeOther, toHome } from "./web-session";

const notFound = (ctx: Ctx): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "not_found" });
  return noticePage(ctx.config, 404, COPY.notFound);
};

const badBody = (ctx: Ctx): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "bad_body" });
  return noticePage(ctx.config, 400, COPY.badBody);
};

const badChannel = (ctx: Ctx): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "bad_channel_id" });
  return noticePage(ctx.config, 400, COPY.badChannelId);
};

// 관리자 채널은 secret(ADMIN_CHANNEL_IDS)에서만 정한다(§8.1): 허용목록 행을 만들면 secret에서 빼도 허용이 남고 화면에서 지울 길도 없다
const adminChannel = (ctx: Ctx): Response => {
  ctx.log("admin.rejected", { route: ctx.route, reason: "is_admin" });
  return noticePage(ctx.config, 409, COPY.adminNoAllow);
};

/** GET /admin: 부트스트랩 403 → 세션 없음 303 / → 관리자 아님 403 → 200 */
export async function adminPage(req: Request, ctx: Ctx): Promise<Response> {
  if (ctx.config.adminChannelIds.length === 0) {
    ctx.log("web.page.rejected", { level: "warn", route: ctx.route, reason: "bootstrap" });
    return noticePage(ctx.config, 403, COPY.bootstrapAdmin);
  }
  const r = await readWebSession(req, ctx);
  if (!r.ok) return toHome(r.clear);
  if (!r.s.isAdmin) {
    ctx.log("web.page.rejected", { level: "warn", route: ctx.route, reason: "not_admin" });
    return noticePage(ctx.config, 403, COPY.notAdmin);
  }
  const view = await ctx.store.adminView(ctx.now);
  return htmlPage(ctx.config, 200, COPY.adminTitle, adminBody(view, ctx.config.adminChannelIds, r.s.csrf));
}

/** POST /admin/allow */
export async function adminAllow(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  // 같은 이름이 둘 이상이면 어느 쪽이 맞는지 알 수 없어 bad_body, 없음·형식 틀림은 bad_channel_id
  if (g.form.getAll("channelId").length > 1) return badBody(ctx);
  const channelId = oneField(g.form, "channelId");
  if (channelId === null || !CHANNEL_ID.test(channelId)) return badChannel(ctx);
  if (ctx.config.adminChannelIds.includes(channelId)) return adminChannel(ctx);
  // 메모는 store가 64자로 자르고, 비어 있으면 있던 메모를 그대로 둔다(구현 중 변경 38 (카)). 같은 이름이 둘 이상이면 어느 쪽이 맞는지 알 수 없어 거절한다
  const notes = g.form.getAll("note");
  if (notes.length > 1) return badBody(ctx);
  const r = await ctx.store.allow(channelId, notes[0] ?? "", g.s.channelId, ctx.now);
  if (!r.ok) return badChannel(ctx);
  ctx.log("admin.allow", { route: ctx.route });
  return seeOther("/admin");
}

/** POST /admin/disallow */
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
  if (r.code === "is_admin") {
    ctx.log("admin.rejected", { route: ctx.route, reason: "is_admin" });
    return noticePage(ctx.config, 409, COPY.isAdmin);
  }
  // 허용목록에 없는 채널: 아무것도 쓰지 않았다(감사 없음)
  if (r.code === "not_found") return notFound(ctx);
  return badChannel(ctx);
}

/** POST /admin/sessions/:id/revoke */
export async function adminRevokeSession(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  const id = ctx.params.id;
  // 성공 이벤트(admin.revoke_session)는 revoke RPC가 남긴다
  if (!isId(id) || !(await ctx.store.revoke(id, "admin", g.s.channelId, ctx.now))) return notFound(ctx);
  return seeOther("/admin");
}

/** POST /admin/denied/:channelId/allow */
export async function adminDeniedAllow(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  const id = ctx.params.channelId ?? "";
  if (!CHANNEL_ID.test(id)) return notFound(ctx);
  if (ctx.config.adminChannelIds.includes(id)) return adminChannel(ctx);
  // 성공 이벤트(admin.denied_allow)는 allowDenied RPC가 남긴다
  if (!(await ctx.store.allowDenied(id, g.s.channelId, ctx.now))) return notFound(ctx);
  return seeOther("/admin");
}

/** POST /admin/denied/:channelId/dismiss */
export async function adminDeniedDismiss(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: true });
  if (!g.ok) return g.response;
  const id = ctx.params.channelId ?? "";
  // 성공 이벤트(admin.denied_dismiss)는 dismissDenied RPC가 남긴다
  if (!CHANNEL_ID.test(id) || !(await ctx.store.dismissDenied(id, g.s.channelId, ctx.now))) return notFound(ctx);
  return seeOther("/admin");
}
