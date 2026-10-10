// 로그인 흐름 핸들러(docs/design/worker.md §4.1·§7, 구현 중 변경 23·27). 앱 start·확인 페이지·웹 start·콜백·완료 페이지·redeem(앱 루프백 수령, 구현 중 변경 88).
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
import { entryContext } from "../core/entry";
import { isLoopbackPort, loopbackUrl } from "../core/loopback";
import { isId, isSecret, isToken, sha256B64url, sha256Hex } from "../core/token";
import type { Ctx } from "../routes";
import { redeemEvent } from "../store/login-log";
import type { ConsumeResult, FinishResult, LoginLogHint } from "../store/types";
import { COPY } from "./copy";
import { flashCookie } from "./flash";
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

/** 앱 종결의 303: 루프백 수신기로 보낸다. Location은 Worker가 상수 호스트·경로로 만들고, 흐름 쿠키는 지운다. 형식이 틀리면 던진다 */
const toLoopback = (ctx: Ctx, f: Extract<FinishResult, { type: "loopback" }>): Response =>
  new Response(null, {
    status: 303,
    headers: [["Location", loopbackUrl(f.port, f.grant, f.state)], ["Referrer-Policy", "no-referrer"], ["Set-Cookie", clearCookie(ctx.cookies, "flow")]],
  });

const toDone = (r: DoneR, why?: DoneWhy): Response =>
  new Response(null, { status: 303, headers: [["Location", `/auth/done?r=${r}${why === undefined ? "" : `&why=${why}`}`], ["Referrer-Policy", "no-referrer"]] });

// ---- 앱 흐름 시작 ----

/** v0.1.1(포트 없는 /auth/start)에 주는 상태 없는 201 미끼(구현 중 변경 88 (가)). v0.1.1 parse_start 요건: loginId·handle b64url 22자, userCode 확인 코드 문자표 */
export const OUTDATED_LOGIN_ID = "outdated-login-id-0000";
export const OUTDATED_HANDLE = "app-outdated-update-v2";
export const OUTDATED_USER_CODE = "UPDA-TE22";
export const OUTDATED_POLL_INTERVAL_MS = 30_000;
const OUTDATED_TTL_MS = 600_000;

/** POST /auth/start */
export async function authStart(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonObject(req);
  if (body === null) {
    ctx.log("auth.start.rejected", { flowKind: "app", reason: "bad_request" });
    return errorJson(400, "bad_request");
  }
  if (!Object.hasOwn(body, "port")) {
    // 옛 앱(v0.1.1): DO를 부르지 않고 스로틀도 하지 않는다. 업데이트 안내 페이지로 가는 미끼 응답이다
    ctx.log("auth.start.outdated", { flowKind: "app" });
    return json(201, {
      loginId: OUTDATED_LOGIN_ID,
      loginUrl: `${ctx.config.publicOrigin}/auth/login/${OUTDATED_HANDLE}`,
      userCode: OUTDATED_USER_CODE,
      expiresAt: iso(ctx.now + OUTDATED_TTL_MS),
      pollIntervalMs: OUTDATED_POLL_INTERVAL_MS,
    });
  }
  const port = body.port;
  const loginVerifier = body.loginVerifier;
  const client = body.client;
  if (!isLoopbackPort(port) || !isSecret(loginVerifier) || typeof client !== "string" || !CLIENT.test(client)) {
    ctx.log("auth.start.rejected", { flowKind: "app", reason: "bad_request" });
    return errorJson(400, "bad_request");
  }
  const r = await ctx.store.startApp({ port, verifier: loginVerifier, client, ip: req.headers.get("CF-Connecting-IP"), limit: ctx.config.startRate10m }, ctx.now);
  if (r.ok) return json(201, { loginUrl: `${ctx.config.publicOrigin}/auth/login/${r.handle}`, expiresAt: iso(r.expiresAt) });
  ctx.log("auth.start.rejected", { flowKind: "app", reason: r.code });
  if (r.code === "rate_limited") return errorJson(429, "rate_limited", { "Retry-After": String(r.retryAfterSec) });
  return errorJson(r.code === "busy" ? 503 : 400, r.code);
}

// ---- 확인 페이지 ----

/** GET /auth/login/:handle */
export async function loginPageGet(_req: Request, ctx: Ctx): Promise<Response> {
  const handle = ctx.params.handle;
  // 옛 앱 미끼의 handle: DO 없이 업데이트 안내(quiet 경로라 로그도 없다)
  if (handle === OUTDATED_HANDLE) return noticePage(ctx.config, 200, COPY.outdatedApp.title, COPY.outdatedApp.body);
  if (!isId(handle)) return noticePage(ctx.config, 404, COPY.linkGone.title, COPY.linkGone.body);
  const v = await ctx.store.loginPage(await sha256Hex(handle), ctx.now);
  if (v === null) return noticePage(ctx.config, 404, COPY.linkGone.title, COPY.linkGone.body);
  if (v.status !== "started") return noticePage(ctx.config, 409, COPY.linkUsed.title, COPY.linkGone.body);
  return loginConfirmPage(ctx.config);
}

/** POST /auth/login/:handle ([계속]) */
export async function loginContinue(req: Request, ctx: Ctx): Promise<Response> {
  if (ctx.params.handle === OUTDATED_HANDLE) return noticePage(ctx.config, 200, COPY.outdatedApp.title, COPY.outdatedApp.body);
  // Origin 거절은 DO를 부르기 전이라 남길 곳이 없다(이벤트 auth.continue.rejected를 버렸다, 구현 중 변경 43)
  if (!sameOriginPost(req, ctx.config.publicOrigin)) return noticePage(ctx.config, 403, COPY.badRequest.title, COPY.badRequest.body);
  const handle = ctx.params.handle;
  if (!isId(handle)) return noticePage(ctx.config, 404, COPY.linkGone.title, COPY.linkGone.body);
  const r = await ctx.store.continueApp(await sha256Hex(handle), ctx.now);
  if (!r.ok) return noticePage(ctx.config, r.code === "not_found" ? 404 : 409, r.code === "not_found" ? COPY.linkGone.title : COPY.linkUsed.title, COPY.linkGone.body);
  return toChzzk(authorizeRedirect(chzzkApp(ctx.config), r.state), setCookie(ctx.cookies, "flow", r.binder));
}

// ---- 웹 흐름 시작 ----

/** POST /auth/web/start */
export async function webStart(req: Request, ctx: Ctx): Promise<Response> {
  if (!sameOriginPost(req, ctx.config.publicOrigin)) {
    ctx.log("auth.start.rejected", { flowKind: "web", reason: "bad_origin" });
    return noticePage(ctx.config, 403, COPY.badRequest.title, COPY.badRequest.body);
  }
  const r = await ctx.store.startWeb(req.headers.get("CF-Connecting-IP"), ctx.config.startRate10m, ctx.now);
  if (r.ok) return toChzzk(authorizeRedirect(chzzkApp(ctx.config), r.state), setCookie(ctx.cookies, "flow", r.binder));
  ctx.log("auth.start.rejected", { flowKind: "web", reason: r.code });
  if (r.code === "rate_limited") return noticePage(ctx.config, 429, COPY.rateLimited.title, COPY.retryLater.body, { headers: { "Retry-After": String(r.retryAfterSec) } });
  return noticePage(ctx.config, 503, COPY.busy.title, COPY.retryLater.body);
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
    const f = await ctx.store.finish(k.flowId, { type: "failed", code: "user" }, ctx.config.adminChannelIds, ctx.now, hint).then(
      (x) => x,
      () => null,
    );
    if (f === null) return toDone("failed", "internal");
    try {
      // 정리 finish는 failed로 닫았으니 웹·앱 어느 쪽이든 실패로 보낸다(앱은 루프백으로 failed를 전한다)
      return f.type === "loopback" ? toLoopback(ctx, f) : toDone("failed");
    } catch {
      return toDone("failed");
    }
  }
}

// consume 뒤: code 검사 → 교환 → finish → 303. 결과 이벤트는 finish가 남긴다(실패 사유는 힌트로 넘긴다)
async function settle(ctx: Ctx, k: Extract<ConsumeResult, { ok: true }>, code: string | null, state: string): Promise<Response> {
  const admins = ctx.config.adminChannelIds;
  const flowKind = k.kind;
  if (code === null || code === "") {
    return afterFinish(ctx, await ctx.store.finish(k.flowId, { type: "cancelled" }, admins, ctx.now, { flowKind }));
  }
  if (!CODE.test(code)) {
    return afterFinish(ctx, await ctx.store.finish(k.flowId, { type: "failed", code: "token" }, admins, ctx.now, { flowKind, reason: "code_format" }));
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
    return afterFinish(ctx, await ctx.store.finish(k.flowId, { type: "failed", code: id.failCode }, admins, ctx.now, hint));
  }
  return afterFinish(ctx, await ctx.store.finish(k.flowId, { type: "user", channelId: id.channelId, channelName: id.channelName }, admins, ctx.now, { flowKind }));
}

/**
 * finish 결과 → 303. r은 outcome이 아니라 DO가 정한 결과를 따른다(port NULL 옛 앱 흐름은 취소여도 failed, 구현 중 변경 89 (바)).
 * 모르는 모양(배포 중 Worker·DO 판이 엇갈린 경우)은 예외 대신 failed로 끝낸다(구현 중 변경 89 (타))
 */
function afterFinish(ctx: Ctx, f: FinishResult): Response {
  switch (f?.type) {
    case "loopback":
      return toLoopback(ctx, f);
    case "web":
      // 웹 로그인은 세션 쿠키를 심고 F를 지운다(콜백이 state를 이미 소비했다). 다음 GET /가 한 번 "로그인했어요"를 보인다(flash)
      return new Response(null, {
        status: 303,
        headers: [
          ["Location", "/"],
          ["Referrer-Policy", "no-referrer"],
          ["Set-Cookie", setCookie(ctx.cookies, "session", f.cookieToken)],
          ["Set-Cookie", clearCookie(ctx.cookies, "flow")],
          ["Set-Cookie", flashCookie(ctx.cookies, "loggedIn")],
        ],
      });
    case "denied":
      return toDone("denied");
    case "cancelled":
      return toDone("cancelled");
    default:
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
  return donePage(ctx.config, r, view, clear, entryContext(req.headers));
}

// ---- 앱 수령 ----

/** POST /auth/redeem(88 (가)). grant + loginSecret → 결과 한 번. 모름·만료·이미 수령·secret 불일치는 구분하지 않고 404 */
export async function authRedeem(req: Request, ctx: Ctx): Promise<Response> {
  const body = await readJsonObject(req);
  const grant = body?.grant;
  const loginSecret = body?.loginSecret;
  if (!isToken("grant", grant) || !isSecret(loginSecret)) {
    ctx.log("auth.redeem.rejected", { reason: "bad_request" });
    return errorJson(400, "bad_request");
  }
  const r = await ctx.store.redeem(await sha256Hex(grant), await sha256B64url(loginSecret), ctx.config.adminChannelIds, ctx.now);
  ctx.log(...redeemEvent(r));
  switch (r.status) {
    case "not_found":
      return errorJson(404, "not_found");
    case "ok":
      return json(200, tokenBundleJson(r.bundle, ctx.now));
    case "denied":
      return json(200, { status: "denied", channelName: r.channelName });
    case "cancelled":
      return json(200, { status: "cancelled" });
    case "failed":
      return json(200, { status: "failed", code: r.code });
  }
}

/** POST /auth/poll 비석(88 (가)·(사)): 본문을 읽지 않고 DO 0회. 404라야 v0.1.1이 바로 LoginLost로 끝낸다 */
export function pollGone(_req: Request, ctx: Ctx): Response {
  ctx.log("auth.poll.rejected", { reason: "app_outdated" });
  return errorJson(404, "app_outdated");
}
