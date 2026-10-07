// 로그인 흐름 핸들러(docs/design/worker.md §4.1·§7, 구현 중 변경 23·27). 앱 start·확인 페이지·웹 start·콜백·완료 페이지·poll.
// 상태는 DO AuthStore가 갖고, 이 파일은 요청 해석·치지직 호출·응답 모양만 맡는다.
//
// 확인 페이지(/auth/login/:handle)와 콜백(/auth/callback?code&state)은 URL에 자격이 실리는 quiet 경로다(routes.ts, 구현 중 변경 43).
// 그 핸들러는 로그를 남기지 않는다(ctx.log도 아무것도 하지 않는다): 콜백의 결과 이벤트(auth.login.*)는 consume·finish RPC 안에서
// DO가 남기고, 이 파일은 DO만 아는 결과에 Worker만 아는 사유(code 형식·치지직 실패 단계·예외 이름)를 힌트로 넘긴다.
// DO가 남길 수 없는 콜백 실패(state 형식 밖, consume 전·consume 자체의 예외)는 사유 낱말을 303 대상(/auth/done?r=failed&why=)에
// 싣고, quiet가 아닌 완료 페이지가 허용 목록의 낱말일 때만 남긴다(구현 중 변경 43 (자)).
//
// 바깥 요청(치지직 호출)은 이 파일의 CHZZK_DEPS 한 곳뿐이다: scripts/ci/worker-config.mjs checkOutbound가 수를 고정한다.
import type { ChzzkApp, ChzzkDeps } from "../core/chzzk";
import { authorizeRedirect, identify } from "../core/chzzk";
import type { Config } from "../config";
import type { LogLevel } from "../core/log";
import { clearCookie, hasCookieName, readCookie, setCookie } from "../core/cookies";
import { isId, isSecret, isToken, sha256B64url, sha256Hex } from "../core/token";
import type { Ctx } from "../routes";
import type { ConsumeResult, LoginLogHint } from "../store/types";
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
// 콜백이 /auth/done에 싣는 실패 사유 낱말(값이 아니다)과 그 로그 등급. 이 목록 밖의 why는 무시한다
const DONE_WHY: ReadonlyMap<string, LogLevel> = new Map([
  ["state_format", "info"],
  ["internal", "error"],
]);
type DoneWhy = "state_format" | "internal";

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

const toDone = (r: DoneR, why?: DoneWhy): Response =>
  new Response(null, { status: 303, headers: [["Location", `/auth/done?r=${r}${why === undefined ? "" : `&why=${why}`}`], ["Referrer-Policy", "no-referrer"]] });

// ---- 앱 흐름 시작 ----

/** POST /auth/start */
export async function authStart(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonObject(req);
  const pollVerifier = body?.pollVerifier;
  const client = body?.client;
  if (body === null || !isSecret(pollVerifier) || typeof client !== "string" || !CLIENT.test(client)) {
    ctx.log("auth.start.rejected", { flowKind: "app", reason: "bad_request" });
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
  ctx.log("auth.start.rejected", { flowKind: "app", reason: r.code });
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
  // Origin 거절은 DO를 부르기 전이라 남길 곳이 없다(이벤트 auth.continue.rejected를 버렸다, 구현 중 변경 43)
  if (!sameOriginPost(req, ctx.config.publicOrigin)) return noticePage(ctx.config, 403, COPY.badOrigin);
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
    ctx.log("auth.start.rejected", { flowKind: "web", reason: "bad_origin" });
    return noticePage(ctx.config, 403, COPY.badOrigin);
  }
  const r = await ctx.store.startWeb(req.headers.get("CF-Connecting-IP"), ctx.config.startRate10m, ctx.now);
  if (r.ok) return toChzzk(authorizeRedirect(chzzkApp(ctx.config), r.state), setCookie(ctx.cookies, "flow", r.binder));
  ctx.log("auth.start.rejected", { flowKind: "web", reason: r.code });
  if (r.code === "rate_limited") return noticePage(ctx.config, 429, COPY.rateLimited, { "Retry-After": String(r.retryAfterSec) });
  return noticePage(ctx.config, 503, COPY.busy);
}

// ---- 콜백 ----

/** GET /auth/callback: 늘 303이다(상세 사유는 DO가 남기는 로그 이벤트, DO가 남길 수 없으면 done의 why 낱말로) */
export async function callback(req: Request, ctx: Ctx): Promise<Response> {
  try {
    return await callbackInner(req, ctx);
  } catch {
    // consume 전(또는 consume 자체)의 예외: DO가 남기지 못했으니 done이 internal로 남긴다.
    // consume 뒤의 예외는 아래 정리 finish가 internal로 남긴다
    return toDone("failed", "internal");
  }
}

async function callbackInner(req: Request, ctx: Ctx): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const code = q.get("code");
  const state = q.get("state");
  // state 형식 밖은 DO를 부르지 않는다: 사유는 done이 남긴다(구현 중 변경 43 (자))
  if (!isSecret(state)) return toDone("failed", "state_format");
  const cookie = readCookie(req.headers.get("Cookie"), ctx.cookies.flow);
  const binderHash = isToken("flow", cookie) ? await sha256Hex(cookie) : null;
  // 실패(state·binder)는 consume이 남긴다
  const k = await ctx.store.consume(await sha256Hex(state), binderHash, ctx.now);
  if (!k.ok) return toDone("failed");
  try {
    return await settle(ctx, k, code, state);
  } catch (e) {
    // state는 이미 소비됐다: 흐름을 닫지 않으면 앱은 만료까지 pending만 본다. 한 번 더 failed(user)로 닫아 본다
    // (이미 닫혔으면 gone이라 아무것도 바꾸지 않는다, 구현 중 변경 28). 이 finish가 internal 이벤트를 남긴다
    // (메시지에는 URL이 들어 있을 수 있어 이름만, §14). 이것도 실패하면 DO 이벤트가 없으니 done이 internal로 남긴다
    const hint: LoginLogHint = { level: "error", flowKind: k.kind, reason: "internal", errorName: e instanceof Error ? e.name : "unknown" };
    const logged = await ctx.store.finish(k.flowId, { type: "failed", code: "user" }, ctx.config.adminChannelIds, ctx.now, hint).then(
      () => true,
      () => false,
    );
    return logged ? toDone("failed") : toDone("failed", "internal");
  }
}

// consume 뒤: code 검사 → 교환 → finish → 303. 결과 이벤트는 finish가 남긴다(실패 사유는 힌트로 넘긴다)
async function settle(ctx: Ctx, k: Extract<ConsumeResult, { ok: true }>, code: string | null, state: string): Promise<Response> {
  const admins = ctx.config.adminChannelIds;
  const flowKind = k.kind;
  if (code === null || code === "") {
    await ctx.store.finish(k.flowId, { type: "cancelled" }, admins, ctx.now, { flowKind });
    return toDone("cancelled");
  }
  if (!CODE.test(code)) {
    await ctx.store.finish(k.flowId, { type: "failed", code: "token" }, admins, ctx.now, { flowKind, reason: "code_format" });
    return toDone("failed");
  }
  const id = await identify(CHZZK_DEPS, chzzkApp(ctx.config), code, state);
  if (!id.ok) {
    const hint: LoginLogHint = {
      flowKind,
      reason: id.failCode,
      stage: id.stage,
      status: id.status,
      timedOut: id.timedOut,
      ...(id.code === undefined ? {} : { chzzkCode: id.code }),
    };
    await ctx.store.finish(k.flowId, { type: "failed", code: id.failCode }, admins, ctx.now, hint);
    return toDone("failed");
  }
  const f = await ctx.store.finish(k.flowId, { type: "user", channelId: id.channelId, channelName: id.channelName }, admins, ctx.now, { flowKind });
  switch (f.type) {
    case "ok":
      return toDone("ok");
    case "web":
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
      return toDone("denied");
    case "cancelled":
      return toDone("cancelled");
    case "failed":
    case "gone":
      return toDone("failed");
  }
}

// ---- 완료 페이지 ----

/** GET /auth/done */
export async function done(req: Request, ctx: Ctx): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const q = params.get("r") ?? "";
  const r = (DONE_R.includes(q) ? q : "failed") as DoneR;
  // 콜백이 DO에 남기지 못한 실패 사유. 허용 낱말만 남기고 모르는 값은 버린다(값 자체는 싣지 않는다). 표시 문구는 r만 본다
  const why = params.get("why");
  const whyLevel = r === "failed" && why !== null ? DONE_WHY.get(why) : undefined;
  if (why !== null && whyLevel !== undefined) ctx.log("auth.login.failed", { level: whyLevel, reason: why });
  const header = req.headers.get("Cookie");
  const flowCookie = readCookie(header, ctx.cookies.flow);
  const view = isToken("flow", flowCookie) ? await ctx.store.doneView(await sha256Hex(flowCookie), ctx.now) : null;
  // 그 이름의 쿠키가 있었으면 값·중복과 상관없이 지운다(남은 F로는 아무것도 할 수 없다, 구현 중 변경 28)
  const clear = hasCookieName(header, ctx.cookies.flow) ? clearCookie(ctx.cookies, "flow") : null;
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
