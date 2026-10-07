// 웹 세션 읽기와 웹 POST 가드(docs/design/worker.md §4.4, 구현 중 변경 38 (나)(다)). 웹 경로는 쿠키만 본다:
// Authorization(앱 access·CI 토큰)은 "없음"과 같다. 신원은 로그인 채널(channelId)이다(구현 중 변경 23).
import { clearCookie, hasCookieName, readCookie } from "../core/cookies";
import { isSecret, isToken, safeEqual, sha256Hex } from "../core/token";
import type { Ctx } from "../routes";
import { COPY } from "./copy";
import { noticePage } from "./pages";
import { FORM_MAX, isFormContentType, readCapped, sameOriginPost } from "./request";

export interface WebSession {
  readonly sessionId: string;
  /** 로그인한 치지직 채널(내 기기·감사 기록의 신원) */
  readonly channelId: string;
  readonly ownerChannelId: string;
  readonly channelName: string;
  readonly isAdmin: boolean;
  readonly csrf: string;
}
export type WebSessionResult = { readonly ok: true; readonly s: WebSession } | { readonly ok: false; readonly clear: string | null };

/**
 * 쿠키 → 웹 세션. 형식이 맞지 않으면 DO를 부르지 않는다. 실패하면 그 이름의 쿠키가 있었을 때만 지우는 헤더(clear)를 돌려준다
 * (값·중복과 상관없이 지운다: 남은 쿠키로는 아무것도 할 수 없다, 구현 중 변경 28).
 */
export async function readWebSession(req: Request, ctx: Ctx): Promise<WebSessionResult> {
  const header = req.headers.get("Cookie");
  const token = readCookie(header, ctx.cookies.session);
  const clear = hasCookieName(header, ctx.cookies.session) ? clearCookie(ctx.cookies, "session") : null;
  if (!isToken("web", token)) return { ok: false, clear };
  const c = await ctx.store.webCheck(await sha256Hex(token), ctx.config.adminChannelIds, ctx.now);
  if (!c.ok) return { ok: false, clear };
  return {
    ok: true,
    s: { sessionId: c.sessionId, channelId: c.channelId, ownerChannelId: c.ownerChannelId, channelName: c.channelName, isAdmin: c.isAdmin, csrf: c.csrf },
  };
}

/** 303. 위치는 쿼리 없는 두 곳뿐이다 */
export function seeOther(location: "/" | "/admin", cookies: readonly string[] = []): Response {
  const headers = new Headers({ Location: location });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}

export const toHome = (clear: string | null): Response => seeOther("/", clear === null ? [] : [clear]);

export type WebPost = { readonly ok: true; readonly s: WebSession; readonly form: URLSearchParams } | { readonly ok: false; readonly response: Response };

/**
 * 웹 POST 검사(순서가 계약이다, 구현 중 변경 38 (나)): 부트스트랩(관리 경로만) → Origin·Sec-Fetch-Site → Content-Type → 본문 크기·UTF-8
 * → 웹 세션 → 관리자 → csrf 필드. 앞의 네 단계는 DO를 부르지 않는다.
 */
export async function guardWebPost(req: Request, ctx: Ctx, opts: { readonly admin: boolean }): Promise<WebPost> {
  const reject = (status: number, message: string, reason: string): WebPost => {
    ctx.log("web.post.rejected", { level: "warn", route: ctx.route, reason });
    return { ok: false, response: noticePage(ctx.config, status, message) };
  };
  if (opts.admin && ctx.config.adminChannelIds.length === 0) return reject(403, COPY.bootstrapAdmin, "bootstrap");
  if (!sameOriginPost(req, ctx.config.publicOrigin)) return reject(403, COPY.badOrigin, "bad_origin");
  if (!isFormContentType(req)) return reject(415, COPY.unsupportedType, "unsupported_type");
  const text = await readCapped(req, FORM_MAX);
  if (text === null) return reject(400, COPY.badBody, "bad_body");
  const form = new URLSearchParams(text);
  const r = await readWebSession(req, ctx);
  if (!r.ok) {
    ctx.log("web.post.rejected", { level: "warn", route: ctx.route, reason: "no_session" });
    return { ok: false, response: toHome(r.clear) };
  }
  if (opts.admin && !r.s.isAdmin) return reject(403, COPY.notAdmin, "not_admin");
  const sent = form.getAll("csrf");
  const v = sent.length === 1 ? sent[0] : undefined;
  if (!isSecret(v) || r.s.csrf === "" || !(await safeEqual(v, r.s.csrf))) return reject(403, COPY.badCsrf, "bad_csrf");
  return { ok: true, s: r.s, form };
}
