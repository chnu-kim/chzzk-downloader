// GET /update/{current}(docs/design/worker.md §9.3, 구현 중 변경 14 (사)·31). 판정: current(400 bad_version, R2 0회)
// → 자격(releaseAuth, 웹 쿠키 불가) → latest.json 1회 읽기 → decideUpdate. 롤백 직후에도 맞게 캐시하지 않는다.
import { LATEST_KEY } from "../core/keys";
import { decideUpdate, parseCurrentVersion } from "../core/updater";
import type { Ctx } from "../routes";
import { releaseBucket } from "./r2";
import { releaseAuth } from "./release-auth";
import { BODY_CACHE_CONTROL } from "./releases";
import { errorJson } from "./respond";

export const LATEST_MAX = 65_536;

export async function update(req: Request, ctx: Ctx): Promise<Response> {
  const current = parseCurrentVersion(ctx.params.current ?? "");
  if (current === null) return errorJson(400, "bad_version");
  const who = await releaseAuth(req, ctx, false);
  if (!who.ok) return who.response;
  const obj = await releaseBucket(ctx.env).get(LATEST_KEY, null);
  let d: ReturnType<typeof decideUpdate>;
  if (obj === null) d = decideUpdate(null, current);
  else if (obj.size > LATEST_MAX) {
    await obj.body.cancel();
    d = { kind: "invalid_latest" };
  } else d = decideUpdate(new Uint8Array(await obj.arrayBuffer()), current);
  switch (d.kind) {
    case "invalid_latest":
      ctx.log("release.latest_invalid", { level: "error", route: ctx.route });
      return errorJson(500, "internal");
    case "none":
      return new Response(null, { status: 204 });
    case "update":
      return new Response(d.body, {
        status: 200,
        headers: { "Content-Type": "application/json", "Content-Length": String(d.body.byteLength), "Cache-Control": BODY_CACHE_CONTROL },
      });
  }
}
