// 랜딩 `/`·내 기기·웹 로그아웃(docs/design/worker.md §8.2·§9.5, 구현 중 변경 38). 랜딩은 늘 200이다(내 기기를 함께 보인다).
// R2 호출: 비로그인·형식 밖 쿠키 0회, 허용 사용자 2회 이하(latest.json은 isolate 캐시 60초, SHA256SUMS는 /releases와 같은 캐시).
import { entryContext } from "../core/entry";
import { LATEST_KEY } from "../core/keys";
import { type LandingRow, landingRows, type LatestView, parseLatestView } from "../core/landing";
import { clearCookie } from "../core/cookies";
import { Lru } from "../core/lru";
import { isId } from "../core/token";
import type { Ctx } from "../routes";
import { COPY } from "./copy";
import { flashCookie, readFlash } from "./flash";
import { renderLanding } from "./landing-view";
import { noticePage } from "./pages";
import { releaseBucket } from "./r2";
import { loadSums } from "./releases";
import { guardWebPost, memberNav, readWebSession, seeOther, setCookieHeaders } from "./web-session";
import { LATEST_MAX } from "./update";

export const LATEST_VIEW_TTL_MS = 60_000;
/** 랜딩 전용 latest.json 요약 캐시(isolate마다). /update와 공유하지 않는다: 그쪽은 롤백 직후에도 맞아야 한다 */
export const LATEST_VIEW_CACHE = new Lru<"latest", { readonly at: number; readonly view: LatestView }>(1);

export type Downloads =
  | { readonly kind: "none" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ok"; readonly version: string; readonly pubDate: string | null; readonly rows: readonly LandingRow[] };

const unavailable = (ctx: Ctx, reason: string, errorName?: string): Downloads => {
  ctx.log("landing.release_unavailable", { level: "warn", reason, ...(errorName === undefined ? {} : { errorName }) });
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

/**
 * 설치 파일 표. 호출하는 쪽이 허용된 웹 세션을 확인한 뒤에만 부른다. R2가 던져도(바인딩 오류·일시 장애) 랜딩은 200이고
 * 표만 "불러오지 못함"이다: 내 기기·로그아웃이 같은 화면에 있다(구현 중 변경 38 (가)). 던진 결과는 캐시하지 않는다
 */
export async function loadDownloads(ctx: Ctx): Promise<Downloads> {
  try {
    return await readDownloads(ctx);
  } catch (e) {
    return unavailable(ctx, "r2", e instanceof Error ? e.name : "unknown");
  }
}

async function readDownloads(ctx: Ctx): Promise<Downloads> {
  const view = await latestView(ctx);
  if (view.kind === "none") return { kind: "none" };
  if (view.kind === "invalid") return unavailable(ctx, "latest_invalid");
  const sums = await loadSums(releaseBucket(ctx.env), view.version);
  if (sums === null) return unavailable(ctx, "sums");
  const rows = landingRows(view.version, sums);
  if (rows.length === 0) return unavailable(ctx, "no_rows");
  return { kind: "ok", version: view.version, pubDate: view.pubDate, rows };
}

/**
 * GET /: 읽기 척도, 늘 200. 요청에서 읽을 것(진입 맥락·웹 세션·flash)과 R2·DO에서 읽을 것(설치 파일·내 기기)을 모아 renderLanding을 부를 뿐이다.
 * flash(303 뒤 알림)는 한 번 그리고 같은 응답에서 지운다. 쿼리(?openExternalBrowser=1 등)는 읽지 않는다: 본문이 같다
 */
export async function landing(req: Request, ctx: Ctx): Promise<Response> {
  const r = await readWebSession(req, ctx);
  const f = readFlash(req, ctx.cookies);
  const headers = setCookieHeaders([r.ok ? null : r.clear, f.clear]);
  const base = { entry: entryContext(req.headers), flash: f.kind, ...(headers === undefined ? {} : { headers }) } as const;
  if (!r.ok) return renderLanding(ctx.config, { ...base, nav: { kind: "anon" }, member: null });
  const [downloads, devices] = await Promise.all([loadDownloads(ctx), ctx.store.mySessions(r.s.channelId, ctx.now)]);
  return renderLanding(ctx.config, {
    ...base,
    nav: memberNav(r.s),
    member: { csrf: r.s.csrf, currentSessionId: r.s.sessionId, downloads, devices },
  });
}

/**
 * POST /me/sessions/:id/revoke: 자기(로그인 채널) 세션만 끊긴다. 지금 브라우저의 세션이면 쿠키도 지운다.
 * URL에 세션 id가 실리는 quiet 경로다(routes.ts): 성공 이벤트(me.revoke_session)는 revokeMine RPC가 남기고 404는 남기지 않는다(구현 중 변경 43)
 */
export async function meRevoke(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: false });
  if (!g.ok) return g.response;
  const id = ctx.params.id;
  // 404는 형식이 틀린 경로 값에만 쓴다
  if (!isId(id)) return noticePage(ctx.config, 404, COPY.notFound.title, COPY.notFound.body, { nav: memberNav(g.s) });
  // 이미 끊겼거나 없는 대상은 오류가 아니다(멱등): 처음 화면으로 보내고 "이미 처리됐어요"를 한 번 알린다
  if (!(await ctx.store.revokeMine(g.s.channelId, id, ctx.now))) return seeOther("/", [flashCookie(ctx.cookies, "alreadyDone")]);
  return seeOther("/", id === g.s.sessionId ? [clearCookie(ctx.cookies, "session")] : []);
}

/** POST /auth/web/logout */
export async function webLogout(req: Request, ctx: Ctx): Promise<Response> {
  const g = await guardWebPost(req, ctx, { admin: false });
  if (!g.ok) return g.response;
  await ctx.store.revoke(g.s.sessionId, "logout", g.s.channelId, ctx.now);
  ctx.log("auth.web.logout", { route: ctx.route });
  return seeOther("/", [clearCookie(ctx.cookies, "session")]);
}
