// 앱 편집자 API(docs/design/features/delegation.md §8.3, worker.md 구현 중 변경 106): 초대 만들기·편집자 빼기·맡은 채널 그만두기.
// Bearer 앱 access만 본다(쿠키는 보지 않는다). 순서: Bearer 형식 → 본문 → check → 동작. 거절 코드는 /api/me와 같다.
// 초대 주소는 응답 본문에만 있고 로그에 남기지 않는다. 새 로그 이벤트는 없다.
import { bearer, isToken, sha256Hex } from "../core/token";
import type { Ctx } from "../routes";
import { CHANNEL_ID } from "../store/allowlist";
import type { CheckResult } from "../store/types";
import { readJsonObject } from "./request";
import { errorJson, iso, json } from "./respond";

type Granted = Extract<CheckResult, { ok: true }>;

/** Bearer 형식만 본다(DO 호출 없음). 형식 밖이면 null: 핸들러가 본문을 읽기 전에 401로 끝낸다 */
function accessOf(req: Request): string | null {
  const a = bearer(req.headers.get("Authorization"));
  return isToken("access", a) ? a : null;
}

/** 형식이 맞은 access로 check 한 번. 허가가 빠진 세션만 403, 나머지 401 */
async function authorize(access: string, ctx: Ctx): Promise<{ ok: true; c: Granted } | { ok: false; response: Response }> {
  const c = await ctx.store.check(await sha256Hex(access), ctx.config.adminChannelIds, ctx.now);
  return c.ok ? { ok: true, c } : { ok: false, response: errorJson(c.code === "not_allowed" ? 403 : 401, c.code) };
}

/** 본문의 channelId: 문자열이고 채널 ID 모양일 때만 */
const channelIdOf = (body: Record<string, unknown>): string | null => (typeof body.channelId === "string" && CHANNEL_ID.test(body.channelId) ? body.channelId : null);

/** POST /api/editors/invite: 새 초대 주소(이전 미청구 초대는 대체된다) */
export async function editorsInvite(req: Request, ctx: Ctx): Promise<Response> {
  const a = accessOf(req);
  if (a === null) return errorJson(401, "invalid_token");
  const body = await readJsonObject(req, true);
  if (body === null) return errorJson(400, "bad_request");
  const g = await authorize(a, ctx);
  if (!g.ok) return g.response;
  // 로그인 ID로 넘긴다: 판정용 주인 ID는 store가 허가 행에서 구한다(105 (사))
  const r = await ctx.store.createInvite(g.c.channelId, g.c.channelName, ctx.config.adminChannelIds, ctx.now);
  if (r.ok) return json(200, { inviteUrl: `${ctx.config.publicOrigin}/invite/${r.token}`, expiresAt: iso(r.expiresAt) });
  return errorJson(r.code === "limit" ? 409 : r.code === "not_allowed" ? 403 : 400, r.code);
}

/** POST /api/editors/remove: 주인이 편집자를 뺀다(기다리는 편집자도) */
export async function editorsRemove(req: Request, ctx: Ctx): Promise<Response> {
  const a = accessOf(req);
  if (a === null) return errorJson(401, "invalid_token");
  const body = await readJsonObject(req);
  const channelId = body === null ? null : channelIdOf(body);
  if (channelId === null) return errorJson(400, "bad_request");
  const g = await authorize(a, ctx);
  if (!g.ok) return g.response;
  // 주인 쪽 키는 판정용 ID다(/api/me의 editors와 같은 키)
  const r = await ctx.store.removeEditor(g.c.ownerChannelId, channelId, ctx.now);
  return r.ok ? new Response(null, { status: 204 }) : errorJson(404, r.code);
}

/** POST /api/delegations/leave: 편집자가 맡은 채널을 그만둔다 */
export async function delegationsLeave(req: Request, ctx: Ctx): Promise<Response> {
  const a = accessOf(req);
  if (a === null) return errorJson(401, "invalid_token");
  const body = await readJsonObject(req);
  const channelId = body === null ? null : channelIdOf(body);
  if (channelId === null) return errorJson(400, "bad_request");
  const g = await authorize(a, ctx);
  if (!g.ok) return g.response;
  // 앞은 편집자의 로그인 ID, 뒤는 주인의 판정용 ID다
  const r = await ctx.store.leaveDelegation(g.c.channelId, channelId, ctx.now);
  return r.ok ? new Response(null, { status: 204 }) : errorJson(404, r.code);
}
