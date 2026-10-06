// 릴리스 읽기 자격(docs/design/worker.md §4.3·§4.5, 구현 중 변경 31 (나)). CI 토큰을 해석하는 유일한 곳이고,
// 이 함수는 releases.ts·update.ts만 부른다(worker-config.mjs가 낱말 ciVerifyToken·releaseAuth를 센다).
// 다른 경로에서 CI 토큰은 쓰레기 Bearer와 같다(별도 분기 없음).
//   1) Authorization 헤더가 있으면 그것만 본다(쿠키 무시): Bearer 모양 아님 → 401 invalid_token
//      → CI 토큰과 상수 시간 비교(safeEqual: 두 값의 SHA-256을 timingSafeEqual) → 같으면 ci
//      → cda_ 형식 아님 → 401 invalid_token → DO check → app | 401 invalid_token·session_revoked | 403 not_allowed
//   2) 헤더가 없고 allowWeb이면 세션 쿠키: 형식(cdw_)이 맞을 때만 DO webCheck → web | 401·403
//   3) 그 밖 401 invalid_token
import { readCookie } from "../core/cookies";
import { bearer, isToken, safeEqual, sha256Hex } from "../core/token";
import type { Ctx } from "../routes";
import { errorJson } from "./respond";

export type ReleaseCaller = "ci" | "app" | "web";
export type ReleaseAuthResult = { readonly ok: true; readonly caller: ReleaseCaller } | { readonly ok: false; readonly response: Response };

// 거절 코드는 /api/me와 같다: not_allowed만 403, 나머지는 401. 성공은 로그를 남기지 않는다
function reject(ctx: Ctx, code: string): ReleaseAuthResult {
  ctx.log("release.auth.rejected", { route: ctx.route, reason: code });
  return { ok: false, response: errorJson(code === "not_allowed" ? 403 : 401, code) };
}

const ok = (caller: ReleaseCaller): ReleaseAuthResult => ({ ok: true, caller });

export async function releaseAuth(req: Request, ctx: Ctx, allowWeb: boolean): Promise<ReleaseAuthResult> {
  const header = req.headers.get("Authorization");
  if (header !== null) {
    const value = bearer(header);
    if (value === null) return reject(ctx, "invalid_token");
    // 형식 검사보다 먼저 비교한다: 모든 Bearer 값이 같은 해시 비교를 지나 시간이 같다. 빈 설정(dev)이면 CI 자격이 없다
    const ci = ctx.config.ciVerifyToken;
    if (ci !== "" && (await safeEqual(value, ci))) return ok("ci");
    if (!isToken("access", value)) return reject(ctx, "invalid_token");
    const c = await ctx.store.check(await sha256Hex(value), ctx.config.adminChannelIds, ctx.now);
    return c.ok ? ok("app") : reject(ctx, c.code);
  }
  if (allowWeb) {
    const cookie = readCookie(req.headers.get("Cookie"), ctx.cookies.session);
    if (isToken("web", cookie)) {
      const c = await ctx.store.webCheck(await sha256Hex(cookie), ctx.config.adminChannelIds, ctx.now);
      return c.ok ? ok("web") : reject(ctx, c.code);
    }
  }
  return reject(ctx, "invalid_token");
}
