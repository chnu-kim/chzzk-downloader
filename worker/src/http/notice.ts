// GET /notice(서비스 공지, 계약 §2.8). 자격 없음, 늘 200 application/json + no-store.
// 본문 {"schema":1,"notice":null} 또는 {"schema":1,"notice":{ id, level, kinds, text, expiresAt }}.
// 원천은 R2 service/notice.json 하나(요청당 get 최대 1회, 판정은 isolate 캐시 60초). 없음·해석 실패·R2 예외는 모두 null이다(fail-open: 공지가 없는 것과 같다).
// 로그는 ctx.log만(이벤트 notice.invalid·notice.unavailable, 필드는 reason·errorName뿐).
import { NOTICE_KEY } from "../core/keys";
import { Lru } from "../core/lru";
import { type Notice, noticeTooLarge, parseNotice } from "../core/notice";
import type { Ctx } from "../routes";
import { releaseBucket } from "./r2";
import { json } from "./respond";

export const NOTICE_CACHE_MS = 60_000;

interface Cached {
  readonly at: number;
  readonly notice: Notice | null;
  /** 공지의 실효 만료(epoch ms). 공지가 없으면 0 */
  readonly untilMs: number;
}

/** isolate마다 한 칸. 던진 결과는 넣지 않는다(다음 요청이 다시 읽는다) */
export const NOTICE_CACHE = new Lru<"notice", Cached>(1);

async function load(ctx: Ctx): Promise<Cached> {
  const obj = await releaseBucket(ctx.env).get(NOTICE_KEY, null);
  if (obj === null) return { at: ctx.now, notice: null, untilMs: 0 };
  if (noticeTooLarge(obj.size)) {
    await obj.body.cancel();
    ctx.log("notice.invalid", { level: "warn", reason: "too_large" });
    return { at: ctx.now, notice: null, untilMs: 0 };
  }
  const v = parseNotice(new Uint8Array(await obj.arrayBuffer()), obj.uploaded.getTime(), ctx.now);
  if (v.kind === "ok") return { at: ctx.now, notice: v.notice, untilMs: v.untilMs };
  if (v.kind === "invalid") ctx.log("notice.invalid", { level: "warn", reason: v.reason });
  return { at: ctx.now, notice: null, untilMs: 0 };
}

async function current(ctx: Ctx): Promise<Notice | null> {
  const hit = NOTICE_CACHE.get("notice");
  if (hit !== undefined && hit.at <= ctx.now && ctx.now - hit.at < NOTICE_CACHE_MS) {
    // 캐시 안에서 만료 시각이 지났으면 공지는 내려간다
    return hit.notice !== null && ctx.now >= hit.untilMs ? null : hit.notice;
  }
  try {
    const fresh = await load(ctx);
    NOTICE_CACHE.set("notice", fresh);
    return fresh.notice;
  } catch (e) {
    ctx.log("notice.unavailable", { level: "warn", errorName: e instanceof Error ? e.name : "unknown" });
    return null;
  }
}

export async function notice(_req: Request, ctx: Ctx): Promise<Response> {
  return json(200, { schema: 1, notice: await current(ctx) }, { "Cache-Control": "no-store" });
}
