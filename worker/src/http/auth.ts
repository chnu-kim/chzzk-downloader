// 로그인 흐름 핸들러(docs/design/worker.md §4.1·§7, 구현 중 변경 23·27). 앱 start·확인 페이지·웹 start·콜백·완료 페이지·poll.
// 상태는 DO AuthStore가 갖고, 이 파일은 요청 해석·치지직 호출·응답 모양만 맡는다.
//
// 바깥 요청(치지직 호출)은 이 파일의 CHZZK_DEPS 한 곳뿐이다: scripts/ci/worker-config.mjs checkOutbound가 수를 고정한다.
import type { ChzzkApp, ChzzkDeps } from "../core/chzzk";
import { authorizeRedirect, identify } from "../core/chzzk";
import type { Config } from "../config";
import { clearCookie, readCookie, setCookie } from "../core/cookies";
import { log } from "../core/log";
import { isId, isSecret, isToken, sha256B64url, sha256Hex } from "../core/token";
import type { Ctx } from "../routes";
import { COPY } from "./copy";
import { type DoneR, donePage, loginConfirmPage, noticePage } from "./pages";
import { readJsonObject, sameOriginPost } from "./request";
import { errorJson, iso, json } from "./respond";
import { tokenBundleJson } from "./session";

// 호출 때 전역을 찾는 화살표여야 테스트의 스파이가 보인다(바로 넘기면 만든 시점의 함수가 고정된다)
const CHZZK_DEPS: ChzzkDeps = { fetch: (url, init) => fetch(url, init) };

const CLIENT = /^[\x20-\x7E]{1,128}$/;
// 치지직이 준 인가 코드: 보이는 ASCII만, 길이 상한
const CODE = /^[!-~]{1,1024}$/;
const DONE_R: readonly string[] = ["ok", "denied", "cancelled", "failed"];

const chzzkApp = (c: Config): ChzzkApp => ({
  authorizeUrl: c.authorizeUrl,
  apiBase: c.apiBase,
  clientId: c.clientId,
  clientSecret: c.clientSecret,
  redirectUri: c.redirectUri,
});

// 치지직으로 보내는 303: referrer가 나가지 않게 한다(handle·state가 URL에 있다)
const toChzzk = (location: string, cookie: string): Response =>
  new Response(null, { status: 303, headers: [["Location", location], ["Set-Cookie", cookie], ["Referrer-Policy", "no-referrer"]] });

const toDone = (r: DoneR, extra: [string, string][] = []): Response =>
  new Response(null, { status: 303, headers: [["Location", `/auth/done?r=${r}`], ["Referrer-Policy", "no-referrer"], ...extra] });

// ---- 앱 흐름 시작 ----

/** POST /auth/start */
export async function authStart(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonObject(req);
  const pollVerifier = body?.pollVerifier;
  const client = body?.client;
  if (body === null || !isSecret(pollVerifier) || typeof client !== "string" || !CLIENT.test(client)) {
    log("auth.start.rejected", { flowKind: "app", reason: "bad_request" });
    return errorJson(400, "bad_request");
  }
  const r = await ctx.store.startApp(pollVerifier, client, req.headers.get("CF-Connecting-IP"), ctx.config.startRate10m, ctx.now);
  if (r.ok) {
    return json(201, {
      loginId: r.loginId,
      loginUrl: `${ctx.config.publicOrigin}/auth/login/${r.handle}`,
      userCode: r.userCode,
      expiresAt: iso(r.expiresAt),
      pollIntervalMs: r.pollIntervalMs,
    });
  }
  log("auth.start.rejected", { flowKind: "app", reason: r.code });
  if (r.code === "rate_limited") return errorJson(429, "rate_limited", { "Retry-After": String(r.retryAfterSec) });
  return errorJson(r.code === "busy" ? 503 : 400, r.code);
}

// ---- 확인 페이지 ----

/** GET /auth/login/:handle */
export async function loginPageGet(_req: Request, ctx: Ctx): Promise<Response> {
  const handle = ctx.params.handle;
  if (!isId(handle)) return noticePage(ctx.config, 404, COPY.linkGone);
  const v = await ctx.store.loginPage(await sha256Hex(handle), ctx.now);
  if (v === null) return noticePage(ctx.config, 404, COPY.linkGone);
  if (v.status !== "started") return noticePage(ctx.config, 409, COPY.linkUsed);
  return loginConfirmPage(ctx.config, v.userCode);
}

/** POST /auth/login/:handle ([계속]) */
export async function loginContinue(req: Request, ctx: Ctx): Promise<Response> {
  if (!sameOriginPost(req, ctx.config.publicOrigin)) {
    log("auth.continue.rejected", { reason: "bad_origin" });
    return noticePage(ctx.config, 403, COPY.badOrigin);
  }
  const handle = ctx.params.handle;
  if (!isId(handle)) return noticePage(ctx.config, 404, COPY.linkGone);
  const r = await ctx.store.continueApp(await sha256Hex(handle), ctx.now);
  if (!r.ok) return noticePage(ctx.config, r.code === "not_found" ? 404 : 409, r.code === "not_found" ? COPY.linkGone : COPY.linkUsed);
  return toChzzk(authorizeRedirect(chzzkApp(ctx.config), r.state), setCookie(ctx.cookies, "flow", r.binder));
}

// ---- 웹 흐름 시작 ----

/** POST /auth/web/start */
export async function webStart(req: Request, ctx: Ctx): Promise<Response> {
  if (!sameOriginPost(req, ctx.config.publicOrigin)) {
    log("auth.continue.rejected", { reason: "bad_origin" });
    return noticePage(ctx.config, 403, COPY.badOrigin);
  }
  const r = await ctx.store.startWeb(req.headers.get("CF-Connecting-IP"), ctx.config.startRate10m, ctx.now);
  if (r.ok) return toChzzk(authorizeRedirect(chzzkApp(ctx.config), r.state), setCookie(ctx.cookies, "flow", r.binder));
  log("auth.start.rejected", { flowKind: "web", reason: r.code });
  if (r.code === "rate_limited") return noticePage(ctx.config, 429, COPY.rateLimited, { "Retry-After": String(r.retryAfterSec) });
  return noticePage(ctx.config, 503, COPY.busy);
}

// ---- 콜백 ----

/** GET /auth/callback: 늘 303이다(상세 사유는 로그 이벤트로만) */
export async function callback(req: Request, ctx: Ctx): Promise<Response> {
  try {
    return await callbackInner(req, ctx);
  } catch (e) {
    // 메시지에는 URL이 들어 있을 수 있어 이름만 남긴다(§14)
    log("auth.login.failed", { level: "error", reason: "internal", errorName: e instanceof Error ? e.name : "unknown" });
    return toDone("failed");
  }
}

async function callbackInner(req: Request, ctx: Ctx): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const code = q.get("code");
  const state = q.get("state");
  if (!isSecret(state)) {
    log("auth.login.failed", { reason: "state_format" });
    return toDone("failed");
  }
  const cookie = readCookie(req.headers.get("Cookie"), ctx.cookies.flow);
  const binderHash = isToken("flow", cookie) ? await sha256Hex(cookie) : null;
  const k = await ctx.store.consume(await sha256Hex(state), binderHash, ctx.now);
  if (!k.ok) {
    log("auth.login.failed", { reason: k.code === "binder" ? "binder" : "state" });
    return toDone("failed");
  }
  const admins = ctx.config.adminChannelIds;
  if (code === null || code === "") {
    await ctx.store.finish(k.flowId, { type: "cancelled" }, admins, ctx.now);
    log("auth.login.cancelled", { flowKind: k.kind });
    return toDone("cancelled");
  }
  if (!CODE.test(code)) {
    await ctx.store.finish(k.flowId, { type: "failed", code: "token" }, admins, ctx.now);
    log("auth.login.failed", { flowKind: k.kind, reason: "code_format" });
    return toDone("failed");
  }
  const id = await identify(CHZZK_DEPS, chzzkApp(ctx.config), code, state);
  if (!id.ok) {
    await ctx.store.finish(k.flowId, { type: "failed", code: id.failCode }, admins, ctx.now);
    log("auth.login.failed", {
      flowKind: k.kind,
      reason: id.failCode,
      stage: id.stage,
      status: id.status,
      timedOut: id.timedOut,
      ...(id.code === undefined ? {} : { chzzkCode: id.code }),
    });
    return toDone("failed");
  }
  const f = await ctx.store.finish(k.flowId, { type: "user", channelId: id.channelId, channelName: id.channelName }, admins, ctx.now);
  switch (f.type) {
    case "ok":
      log("auth.login.ok", { flowKind: "app" });
      return toDone("ok");
    case "web":
      log("auth.login.ok", { flowKind: "web" });
      // 웹 로그인은 세션 쿠키를 심고 F를 지운다(콜백이 state를 이미 소비했다)
      return new Response(null, {
        status: 303,
        headers: [
          ["Location", "/"],
          ["Referrer-Policy", "no-referrer"],
          ["Set-Cookie", setCookie(ctx.cookies, "session", f.cookieToken)],
          ["Set-Cookie", clearCookie(ctx.cookies, "flow")],
        ],
      });
    case "denied":
      log("auth.login.denied", { flowKind: k.kind });
      return toDone("denied");
    case "cancelled":
      log("auth.login.cancelled", { flowKind: k.kind });
      return toDone("cancelled");
    case "failed":
    case "gone":
      log("auth.login.failed", { flowKind: k.kind, reason: f.type });
      return toDone("failed");
  }
}

// ---- 완료 페이지 ----

/** GET /auth/done */
export async function done(req: Request, ctx: Ctx): Promise<Response> {
  const q = new URL(req.url).searchParams.get("r") ?? "";
  const r = (DONE_R.includes(q) ? q : "failed") as DoneR;
  const flowCookie = readCookie(req.headers.get("Cookie"), ctx.cookies.flow);
  const view = isToken("flow", flowCookie) ? await ctx.store.doneView(await sha256Hex(flowCookie), ctx.now) : null;
  // 쿠키가 있었으면 형식과 상관없이 지운다(남은 F로는 아무것도 할 수 없다)
  const clear = flowCookie !== null ? clearCookie(ctx.cookies, "flow") : null;
  return donePage(ctx.config, r, view, clear);
}

// ---- 앱 폴링 ----

/** POST /auth/poll */
export async function poll(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonObject(req);
  const loginId = body?.loginId;
  const pollSecret = body?.pollSecret;
  if (!isId(loginId) || !isSecret(pollSecret)) return errorJson(400, "bad_request");
  const c = await ctx.store.claim(loginId, await sha256B64url(pollSecret), ctx.config.adminChannelIds, ctx.now);
  switch (c.status) {
    case "too_soon":
      return errorJson(429, "too_soon");
    case "not_found":
      return errorJson(404, "not_found");
    case "pending":
      return json(200, { status: "pending" });
    case "ok":
      return json(200, tokenBundleJson(c.bundle, ctx.now));
    case "denied":
      return json(200, { status: "denied", channelName: c.channelName });
    case "cancelled":
      return json(200, { status: "cancelled" });
    case "failed":
      return json(200, { status: "failed", code: c.code });
  }
}
