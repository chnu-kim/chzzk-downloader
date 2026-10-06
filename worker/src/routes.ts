// 경로 표(데이터)와 진입 처리(docs/design/worker.md §4). 라우터 의존성 없이 표 + 정확한 경로 비교다.
//
// W1은 /health 하나다. W4~W6이 경로를 더하고, auth 값(자격 종류 §4)으로 자격 × 경로 행렬 테스트를 만든다(§4.5).
// 처리 순서: 설정 검사(실패하면 모든 경로 500, /health는 503) → 요청 출처 = PUBLIC_ORIGIN → 경로 표 → 핸들러.

import { type Config, loadConfig } from "./config";
import { log } from "./core/log";
import { health } from "./http/health";
import { errorJson, json, withCommonHeaders } from "./http/respond";

/** 자격 종류(§4). W1은 없음뿐이다. */
export type Auth = "none";
export type Method = "GET" | "HEAD" | "POST";

export interface Ctx {
  readonly config: Config;
  readonly env: Env;
  /** 요청 시각(epoch ms). 시간은 늘 주입한다 */
  readonly now: number;
}

export interface Route {
  readonly method: Method;
  readonly pattern: string;
  readonly auth: Auth;
  readonly handler: (req: Request, ctx: Ctx) => Response | Promise<Response>;
}

export const HEALTH_PATH = "/health";

export const ROUTES: readonly Route[] = [{ method: "GET", pattern: HEALTH_PATH, auth: "none", handler: health }];

function configError(url: URL, key: string, reason?: string): Response {
  log("config.error", { level: "error", key, ...(reason ? { reason } : {}) });
  // 배포 --var를 빠뜨리면 /health가 503이라 deploy-worker 검사가 빨개진다(§9.4)
  return url.pathname === HEALTH_PATH ? json(503, { ok: false, code: "config_error" }) : errorJson(500, "config_error");
}

async function route(req: Request, env: Env, now: number): Promise<Response> {
  const url = new URL(req.url);
  const loaded = loadConfig(env);
  if (!loaded.ok) return configError(url, loaded.key);
  const config = loaded.config;
  // 요청 출처가 PUBLIC_ORIGIN과 다르면 설정 어긋남이다(/health 포함). dev에서 127.0.0.1:8787로 들어오면 여기서 막힌다
  if (url.origin !== config.publicOrigin) return configError(url, "PUBLIC_ORIGIN", "origin_mismatch");

  const same = ROUTES.filter((r) => r.pattern === url.pathname);
  if (same.length === 0) return errorJson(404, "not_found");
  const r = same.find((x) => x.method === req.method);
  if (!r) return errorJson(405, "method_not_allowed", { Allow: same.map((x) => x.method).join(", ") });
  try {
    return await r.handler(req, { config, env, now });
  } catch (e) {
    // 메시지에는 URL이 들어 있을 수 있어 이름만 남긴다(§14)
    log("http.internal", { level: "error", route: r.pattern, method: r.method, errorName: e instanceof Error ? e.name : "unknown" });
    return errorJson(500, "internal");
  }
}

/** Worker fetch 진입점. 핸들러 밖(설정·경로 판정)에서 난 예외도 500 internal로 끝낸다. */
export async function handle(req: Request, env: Env): Promise<Response> {
  let res: Response;
  try {
    res = await route(req, env, Date.now());
  } catch (e) {
    log("http.internal", { level: "error", errorName: e instanceof Error ? e.name : "unknown" });
    res = errorJson(500, "internal");
  }
  return withCommonHeaders(res);
}
