// 랜딩 `/`·내 기기·웹 로그아웃(docs/design/worker.md §8.2·§9.5, 구현 중 변경 35). 랜딩은 늘 200이다(내 기기를 함께 보인다).
// R2 호출: 비로그인·형식 밖 쿠키 0회, 허용 사용자 2회 이하(latest.json은 isolate 캐시 60초, SHA256SUMS는 /releases와 같은 캐시).
import { LATEST_KEY } from "../core/keys";
import { type LandingRow, landingRows, type LatestView, parseLatestView } from "../core/landing";
import { clearCookie } from "../core/cookies";
import { Lru } from "../core/lru";
import { log } from "../core/log";
import { isId } from "../core/token";
import type { Ctx } from "../routes";
import { COPY } from "./copy";
import { anonymousBody, memberBody } from "./landing-view";
import { htmlPage, noticePage } from "./pages";
import { releaseBucket } from "./r2";
import { loadSums } from "./releases";
import { guardWebPost, readWebSession, seeOther } from "./web-session";
import { LATEST_MAX } from "./update";

export const LATEST_VIEW_TTL_MS = 60_000;
/** 랜딩 전용 latest.json 요약 캐시(isolate마다). /update와 공유하지 않는다: 그쪽은 롤백 직후에도 맞아야 한다 */
export const LATEST_VIEW_CACHE = new Lru<"latest", { readonly at: number; readonly view: LatestView }>(1);

export type Downloads =
  | { readonly kind: "none" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ok"; readonly version: string; readonly pubDate: string | null; readonly rows: readonly LandingRow[] };

const unavailable = (reason: string): Downloads => {
  log("landing.release_unavailable", { level: "warn", reason });
  return { kind: "unavailable" };
};

async function latestView(ctx: Ctx): Promise<LatestView> {
  const hit = LATEST_VIEW_CACHE.get("latest");
  if (hit !== undefined && hit.at <= ctx.now && ctx.now - hit.at < LATEST_VIEW_TTL_MS) return hit.view;
  const obj = await releaseBucket(ctx.env).get(LATEST_KEY, null);
  let view: LatestView;
  if (obj === null) view = { kind: "none" };
  else if (obj.size > LATEST_MAX) {
    await obj.body.cancel();
    view = { kind: "invalid" };
  } else view = parseLatestView(new Uint8Array(await obj.arrayBuffer()));
  LATEST_VIEW_CACHE.set("latest", { at: ctx.now, view });
  return view;
}

/** 설치 파일 표. 호출하는 쪽이 허용된 웹 세션을 확인한 뒤에만 부른다 */
export async function loadDownloads(ctx: Ctx): Promise<Downloads> {
  const view = await latestView(ctx);
  if (view.kind === "none") return { kind: "none" };
  if (view.kind === "invalid") return unavailable("latest_invalid");
  const sums = await loadSums(releaseBucket(ctx.env), view.version);
  if (sums === null) return unavailable("sums");
  const rows = landingRows(view.version, sums);
  if (rows.length === 0) return unavailable("no_rows");
  return { kind: "ok", version: view.version, pubDate: view.pubDate, rows };
}

/** GET / */
export async function landing(req: Request, ctx: Ctx): Promise<Response> {
  const r = await readWebSession(req, ctx);
  if (!r.ok) return htmlPage(ctx.config, 200, COPY.landingTitle, anonymousBody(), r.clear === null ? undefined : { "Set-Cookie": r.clear });
  const downloads = await loadDownloads(ctx);
  const devices = await ctx.store.mySessions(r.s.channelId, ctx.now);
  return htmlPage(
    ctx.config,
    200,
    COPY.landingTitle,
    memberBody({ channelName: r.s.channelName, isAdmin: r.s.isAdmin, csrf: r.s.csrf, currentSessionId: r.s.sessionId, downloads, devices }),
  );
}

/** POST /me/sessions/:id/revoke: 자기(로그인 채널) 세션만 끊긴다. 지금 브라우저의 세션이면 쿠키도 지운다 */
export async function meRevoke(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: false });
  if (!g.ok) return g.response;
  const id = ctx.params.id;
  if (!isId(id) || !(await ctx.store.revokeMine(g.s.channelId, id, ctx.now))) {
    log("me.rejected", { route: ctx.route, reason: "not_found" });
    return noticePage(ctx.config, 404, COPY.notFound);
  }
  log("me.revoke_session", { route: ctx.route });
  return seeOther("/", id === g.s.sessionId ? [clearCookie(ctx.cookies, "session")] : []);
}

/** POST /auth/web/logout */
export async function webLogout(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: false });
  if (!g.ok) return g.response;
  await ctx.store.revoke(g.s.sessionId, "logout", g.s.channelId, ctx.now);
  log("auth.web.logout", { route: ctx.route });
  return seeOther("/", [clearCookie(ctx.cookies, "session")]);
}
