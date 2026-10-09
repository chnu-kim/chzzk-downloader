// 앱 세션 핸들러(docs/design/worker.md §4.2·§6.3, 구현 중 변경 27 (바)(사)): refresh·logout·/api/me.
// 자격이 없을 때: JSON이 깨졌거나 객체가 아니면 400, 토큰이 없거나 형식이 틀리면 401 invalid_token.
import { bearer, isToken, sha256Hex } from "../core/token";
import type { Ctx } from "../routes";
import type { TokenBundle } from "../store/types";
import { readJsonObject } from "./request";
import { errorJson, iso, json } from "./respond";

/** 토큰 묶음(redeem ok·refresh 성공 응답, §6.3) */
export function tokenBundleJson(b: TokenBundle, now: number): Record<string, unknown> {
  return {
    status: "ok",
    accessToken: b.accessToken,
    accessExpiresAt: iso(b.accessExpiresAt),
    refreshToken: b.refreshToken,
    refreshExpiresAt: iso(b.refreshExpiresAt),
    channelId: b.channelId,
    channelName: b.channelName,
    isAdmin: b.isAdmin,
    serverTime: iso(now),
  };
}

/** POST /auth/refresh */
export async function refresh(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonObject(req);
  if (body === null) return errorJson(400, "bad_request");
  const token = body.refreshToken;
  if (!isToken("refresh", token)) {
    ctx.log("auth.refresh.rejected", { reason: "invalid_token" });
    return errorJson(401, "invalid_token");
  }
  const r = await ctx.store.rotate(await sha256Hex(token), ctx.config.adminChannelIds, ctx.now);
  if (r.ok) {
    if (r.recovered) ctx.log("auth.refresh.recovered");
    return json(200, tokenBundleJson(r.bundle, ctx.now));
  }
  if (r.code === "rate_limited") {
    ctx.log("auth.refresh.rejected", { reason: "rate_limited" });
    return errorJson(429, "rate_limited", { "Retry-After": String(r.retryAfterSec) });
  }
  if (r.code === "session_revoked" && r.reuseDetected) ctx.log("auth.refresh.reuse_detected", { level: "warn" });
  else ctx.log("auth.refresh.rejected", { reason: r.code });
  return errorJson(r.code === "not_allowed" ? 403 : 401, r.code);
}

/** POST /auth/logout: 형식이 맞는 자격이 하나라도 있으면 204(세션이 이미 끝났어도) */
export async function logout(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonObject(req, true);
  if (body === null) return errorJson(400, "bad_request");
  const a = bearer(req.headers.get("Authorization"));
  const access = isToken("access", a) ? a : null;
  const rt = body.refreshToken;
  const refreshToken = isToken("refresh", rt) ? rt : null;
  if (access === null && refreshToken === null) return errorJson(401, "invalid_token");
  await ctx.store.logout(access === null ? null : await sha256Hex(access), refreshToken === null ? null : await sha256Hex(refreshToken), ctx.now);
  return new Response(null, { status: 204 });
}

/** GET /api/me */
export async function me(req: Request, ctx: Ctx): Promise<Response> {
  const a = bearer(req.headers.get("Authorization"));
  if (!isToken("access", a)) return errorJson(401, "invalid_token");
  const c = await ctx.store.check(await sha256Hex(a), ctx.config.adminChannelIds, ctx.now);
  if (c.ok) {
    return json(200, { channelId: c.ownerChannelId, channelName: c.channelName, accessExpiresAt: iso(c.accessExpiresAt), serverTime: iso(ctx.now) });
  }
  return errorJson(c.code === "not_allowed" ? 403 : 401, c.code);
}
