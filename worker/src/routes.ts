// 경로 표(데이터)와 진입 처리(docs/design/worker.md §4). 라우터 의존성 없이 표 + 정확한 경로 비교다.
//
// /health, 로그인 흐름(/auth/*, 앱은 루프백 수령 /auth/redeem, /auth/poll은 비석), 앱 세션(/auth/refresh·/auth/logout·/api/me), 릴리스 읽기(/update/:current·/releases/**),
// 랜딩(/)·스타일시트(/assets/:file)·웹 로그아웃·내 기기(/me/*)·관리(/admin*). auth 값(자격 종류 §4)으로 자격 × 경로 행렬 테스트를 만든다(§4.5).
// 처리 순서: 설정 검사(실패하면 모든 경로 500, /health는 503) → 요청 출처 = PUBLIC_ORIGIN → 경로 표 → 핸들러.
// 패턴의 ":이름" 조각은 비어 있지 않은 조각 하나와 맞는다(디코드하지 않는다. 값 검사는 핸들러가 한다, 구현 중 변경 27 (마)).

import { type Config, CALLBACK_PATH, loadConfig } from "./config";
import { type CookieSpec, cookieSpec } from "./core/cookies";
import { type Logger, log, silent } from "./core/log";
import { adminAllow, adminDeniedAllow, adminDeniedDismiss, adminDisallow, adminPage, adminRevokeSession } from "./http/admin";
import { authRedeem, authStart, callback, done, loginContinue, loginPageGet, pollGone, webStart } from "./http/auth";
import { health } from "./http/health";
import { landing, meRevoke, webLogout } from "./http/landing";
import { errorJson, json, withCommonHeaders } from "./http/respond";
import { logout, me, refresh } from "./http/session";
import { siteCss } from "./http/site-css";
import { update } from "./http/update";
import { releases } from "./http/releases";
import { AUTH_STORE_NAME, type AuthStore } from "./store/AuthStore";

/** 자격 종류(§4): 없음 · F(흐름 쿠키) · A(앱 access) · R(본문 refresh) · A 또는 R · release(A·W·CI) · update(A·CI) · web_optional(W 선택) · web(W) · admin(W+admin) */
export type Auth = "none" | "flow" | "app" | "refresh" | "app_or_refresh" | "release" | "update" | "web_optional" | "web" | "admin";
export type Method = "GET" | "HEAD" | "POST";

export interface Ctx {
  readonly config: Config;
  readonly env: Env;
  /** 요청 시각(epoch ms). 시간은 늘 주입한다 */
  readonly now: number;
  /** 경로 패턴의 ":이름" 값(디코드하지 않은 조각) */
  readonly params: Readonly<Record<string, string>>;
  readonly store: DurableObjectStub<AuthStore>;
  readonly cookies: CookieSpec;
  /** 경로 표의 패턴(로그 route 필드) */
  readonly route: string;
  /** 이 요청의 로거. quiet 경로면 아무것도 하지 않는다(핸들러는 core/log를 직접 부르지 않는다, 구현 중 변경 43) */
  readonly log: Logger;
}

export interface Route {
  readonly method: Method;
  readonly pattern: string;
  readonly auth: Auth;
  readonly handler: (req: Request, ctx: Ctx) => Response | Promise<Response>;
  /**
   * URL(경로·쿼리)에 로그 금지 값(§14: code·state·handle, 채널 id, 세션 id 전체)이 실린다. Workers Logs가 Worker 호출의 로그 줄마다
   * 요청 URL 전체를 붙이므로(W9 실측) 이 경로의 Worker 호출에서는 로그 줄이 하나도 나가지 않는다: config.error·http.internal도
   * 남기지 않고 Ctx.log는 아무것도 하지 않는다. 남길 이벤트는 DO RPC가 남긴다(구현 중 변경 43)
   */
  readonly quiet?: true;
}

export const HEALTH_PATH = "/health";

export const ROUTES: readonly Route[] = [
  { method: "GET", pattern: HEALTH_PATH, auth: "none", handler: health },
  { method: "POST", pattern: "/auth/start", auth: "none", handler: authStart },
  { method: "GET", pattern: "/auth/login/:handle", auth: "none", handler: loginPageGet, quiet: true },
  { method: "POST", pattern: "/auth/login/:handle", auth: "none", handler: loginContinue, quiet: true },
  { method: "POST", pattern: "/auth/web/start", auth: "none", handler: webStart },
  { method: "GET", pattern: CALLBACK_PATH, auth: "flow", handler: callback, quiet: true },
  { method: "GET", pattern: "/auth/done", auth: "none", handler: done },
  { method: "POST", pattern: "/auth/redeem", auth: "none", handler: authRedeem },
  { method: "POST", pattern: "/auth/poll", auth: "none", handler: pollGone },
  { method: "POST", pattern: "/auth/refresh", auth: "refresh", handler: refresh },
  { method: "POST", pattern: "/auth/logout", auth: "app_or_refresh", handler: logout },
  { method: "GET", pattern: "/api/me", auth: "app", handler: me },
  { method: "GET", pattern: "/update/:current", auth: "update", handler: update },
  { method: "GET", pattern: "/releases/**", auth: "release", handler: releases },
  { method: "HEAD", pattern: "/releases/**", auth: "release", handler: releases },
  { method: "GET", pattern: "/", auth: "web_optional", handler: landing },
  { method: "GET", pattern: "/assets/:file", auth: "none", handler: siteCss },
  { method: "POST", pattern: "/auth/web/logout", auth: "web", handler: webLogout },
  { method: "POST", pattern: "/me/sessions/:id/revoke", auth: "web", handler: meRevoke, quiet: true },
  { method: "GET", pattern: "/admin", auth: "admin", handler: adminPage },
  { method: "POST", pattern: "/admin/allow", auth: "admin", handler: adminAllow },
  { method: "POST", pattern: "/admin/disallow", auth: "admin", handler: adminDisallow },
  { method: "POST", pattern: "/admin/sessions/:id/revoke", auth: "admin", handler: adminRevokeSession, quiet: true },
  { method: "POST", pattern: "/admin/denied/:channelId/allow", auth: "admin", handler: adminDeniedAllow, quiet: true },
  { method: "POST", pattern: "/admin/denied/:channelId/dismiss", auth: "admin", handler: adminDeniedDismiss, quiet: true },
];

/** "/**"로 끝나는 패턴은 앞부분 뒤의 비지 않은 나머지와 맞는다(조각 수 무관, 디코드하지 않는다). 그 밖에는 패턴 조각 수 = 경로 조각 수, ":이름"은 비지 않은 조각 하나(디코드하지 않는다), 나머지는 글자 그대로 */
export function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  // params["**"] = 나머지
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -2);
    return pathname.startsWith(prefix) && pathname.length > prefix.length ? { "**": pathname.slice(prefix.length) } : null;
  }
  const want = pattern.split("/");
  const got = pathname.split("/");
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (const [i, w] of want.entries()) {
    const g = got[i] ?? "";
    if (w.startsWith(":")) {
      if (g === "") return null;
      params[w.slice(1)] = g;
    } else if (w !== g) return null;
  }
  return params;
}

/** 경로가 quiet 행의 패턴과 맞는가(메서드와 상관없이). 설정 검사보다 먼저 정해야 config.error도 막는다 */
export function isQuietPath(pathname: string): boolean {
  return ROUTES.some((r) => r.quiet === true && matchPattern(r.pattern, pathname) !== null);
}

// URL을 해석하지 못하면 무엇이 실렸는지 모르므로 조용히 둔다
function quietRequest(req: Request): boolean {
  try {
    return isQuietPath(new URL(req.url).pathname);
  } catch {
    return true;
  }
}

function configError(url: URL, say: Logger, key: string, reason?: string): Response {
  say("config.error", { level: "error", key, ...(reason ? { reason } : {}) });
  // 배포 --var를 빠뜨리면 /health가 503이라 deploy-worker 검사가 빨개진다(§9.4)
  return url.pathname === HEALTH_PATH ? json(503, { ok: false, code: "config_error" }) : errorJson(500, "config_error");
}

async function route(req: Request, env: Env, now: number, say: Logger): Promise<Response> {
  const url = new URL(req.url);
  const loaded = loadConfig(env);
  if (!loaded.ok) return configError(url, say, loaded.key);
  const config = loaded.config;
  // 요청 출처가 PUBLIC_ORIGIN과 다르면 설정 어긋남이다(/health 포함). dev에서 127.0.0.1:8787로 들어오면 여기서 막힌다
  if (url.origin !== config.publicOrigin) return configError(url, say, "PUBLIC_ORIGIN", "origin_mismatch");

  const hits = ROUTES.flatMap((r) => {
    const p = matchPattern(r.pattern, url.pathname);
    return p ? [{ r, p }] : [];
  });
  if (hits.length === 0) return errorJson(404, "not_found");
  const hit = hits.find((h) => h.r.method === req.method);
  if (!hit) return errorJson(405, "method_not_allowed", { Allow: [...new Set(hits.map((h) => h.r.method))].join(", ") });
  const r = hit.r;
  try {
    const store = env.AUTH.get(env.AUTH.idFromName(AUTH_STORE_NAME));
    return await r.handler(req, { config, env, now, params: hit.p, store, cookies: cookieSpec(config.publicOrigin), route: r.pattern, log: say });
  } catch (e) {
    // 메시지에는 URL이 들어 있을 수 있어 이름만 남긴다(§14)
    say("http.internal", { level: "error", route: r.pattern, method: r.method, errorName: e instanceof Error ? e.name : "unknown" });
    return errorJson(500, "internal");
  }
}

/** Worker 요청 진입점. 핸들러 밖(설정·경로 판정)에서 난 예외도 500 internal로 끝낸다. */
export async function handle(req: Request, env: Env): Promise<Response> {
  const say: Logger = quietRequest(req) ? silent : log;
  let res: Response;
  try {
    res = await route(req, env, Date.now(), say);
  } catch (e) {
    say("http.internal", { level: "error", errorName: e instanceof Error ? e.name : "unknown" });
    res = errorJson(500, "internal");
  }
  return withCommonHeaders(res);
}
