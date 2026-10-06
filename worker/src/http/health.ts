// GET /health(docs/design/worker.md §4.1). 설정이 틀리면 이 핸들러까지 오지 않고 503 config_error다(routes.ts).
// 부트스트랩 모드(ADMIN_CHANNEL_IDS 비어 있음, §8.3)면 bootstrap:true를 더한다. 이름·값은 싣지 않는다.

import type { Ctx } from "../routes";
import { SCHEMA_VERSION } from "../store/schema";
import { json } from "./respond";

export function health(_req: Request, ctx: Ctx): Response {
  const body: Record<string, unknown> = { ok: true, schema: SCHEMA_VERSION, build: ctx.config.buildId ?? "unknown" };
  if (ctx.config.bootstrap) body.bootstrap = true;
  return json(200, body);
}
