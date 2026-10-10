// 읽기 페이지의 핸들러(docs/design/system/web.md §10, 계약 §2.4 끝). 자격은 없다(누구나 읽는다).
// 헤더 nav만 세션을 보고 고른다: 로그인한 사람에게 [로그인] 길을 보이지 않으려는 것이다.
// 쿠키 형식이 틀리면 DO를 부르지 않는다(readWebSession). 쿠키를 지우지는 않는다: 읽기 페이지는 상태를 바꾸지 않는다.
import type { Ctx } from "../routes";
import type { Nav } from "./layout";
import { renderHelp, renderLicenses, renderPrivacy } from "./reading-view";
import { memberNav, readWebSession } from "./web-session";

async function navOf(req: Request, ctx: Ctx): Promise<Nav> {
  const r = await readWebSession(req, ctx);
  return r.ok ? memberNav(r.s) : { kind: "anon" };
}

/** GET /help */
export async function help(req: Request, ctx: Ctx): Promise<Response> {
  return renderHelp(ctx.config, await navOf(req, ctx));
}

/** GET /privacy */
export async function privacy(req: Request, ctx: Ctx): Promise<Response> {
  return renderPrivacy(ctx.config, await navOf(req, ctx));
}

/** GET /licenses */
export async function licenses(req: Request, ctx: Ctx): Promise<Response> {
  return renderLicenses(ctx.config, await navOf(req, ctx));
}
