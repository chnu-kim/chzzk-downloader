// /health와 경로 표 뼈대(docs/design/worker.md §4.1·§10.1·§8.3, W1 수락 기준).
// exports.default.fetch는 실제 바인딩(.dev.vars.example 자리표시)으로, worker.fetch는 바꾼 env로 부른다.
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { ROUTES } from "../src/routes";
import { SCHEMA_VERSION } from "../src/store/schema";

const ORIGIN = "http://localhost:8787";

// 바꾼 env로 부른다(설정 가드가 요청마다 env를 읽는다)
function call(path: string, patch: Record<string, unknown> = {}, init?: RequestInit, origin = ORIGIN) {
  const e = { ...env, ...patch } as Env;
  // 테스트가 만든 Request에는 들어오는 요청의 cf 속성이 없다(핸들러는 cf를 읽지 않는다)
  return worker.fetch(new Request(origin + path, init) as Parameters<typeof worker.fetch>[0], e);
}

function logs(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => String(c[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/health", () => {
  it("200: 자리표시 설정(실제 바인딩), 공통 헤더", async () => {
    const res = await exports.default.fetch(ORIGIN + "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, schema: SCHEMA_VERSION, build: "dev" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("200 + bootstrap:true: ADMIN_CHANNEL_IDS가 비어 있음(부트스트랩 모드)", async () => {
    const res = await call("/health", { ADMIN_CHANNEL_IDS: "" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, schema: SCHEMA_VERSION, build: "dev", bootstrap: true });
  });

  it("BUILD_ID가 없으면 build는 unknown", async () => {
    const res = await call("/health", { BUILD_ID: "" });
    expect((await res.json()) as unknown).toMatchObject({ build: "unknown" });
  });

  it("503 config_error: ADMIN 형식이 틀림. 응답에 이름·값이 없고 로그에는 키 이름만", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = "not-a-channel-id-canary";
    const res = await call("/health", { ADMIN_CHANNEL_IDS: bad });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, code: "config_error" });
    expect(text).not.toContain("ADMIN");
    expect(text).not.toContain(bad);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const lines = logs(spy);
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ event: "config.error", level: "error", key: "ADMIN_CHANNEL_IDS" }]);
    expect(lines.join("\n")).not.toContain(bad);
  });

  it("503 config_error: 요청 출처가 PUBLIC_ORIGIN과 다름(127.0.0.1로 들어옴)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call("/health", {}, undefined, "http://127.0.0.1:8787");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: "config_error" });
    expect(logs(spy).map((l) => JSON.parse(l))).toEqual([{ event: "config.error", level: "error", key: "PUBLIC_ORIGIN", reason: "origin_mismatch" }]);
  });

  it("503 config_error: 운영 출처인데 치지직 주소가 가짜(덮어쓰기는 루프백에서만)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const origin = "https://dist.example.test";
    const res = await call("/health", { PUBLIC_ORIGIN: origin, START_RATE_10M: "", CHZZK_REDIRECT_URI: "" }, undefined, origin);
    expect(res.status).toBe(503);
  });
});

describe("dev 모드 설정 가드(HTTP)", () => {
  it("503: 모르는 문자열 바인딩. 로그에는 키 이름만, 값은 응답·로그 어디에도 없다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const canary = "other-service-canary-value";
    const res = await call("/health", { OTHER_SERVICE_TOKEN: canary });
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, code: "config_error" });
    expect(text).not.toContain(canary);
    const lines = logs(spy);
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ event: "config.error", level: "error", key: "OTHER_SERVICE_TOKEN" }]);
    expect(lines.join("\n")).not.toContain(canary);
  });

  it("503: CHZZK_REDIRECT_URI가 등록 값과 다름", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call("/health", { CHZZK_REDIRECT_URI: "http://localhost:8787/auth/callback/" });
    expect(res.status).toBe(503);
    expect(logs(spy).map((l) => JSON.parse(l))).toEqual([{ event: "config.error", level: "error", key: "CHZZK_REDIRECT_URI" }]);
  });
});

describe("경로 표 뼈대", () => {
  it("설정이 틀리면 /health가 아닌 경로는 500 config_error", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await call("/nope", { PUBLIC_ORIGIN: "" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: "config_error" });
  });

  it("모르는 경로는 404 not_found", async () => {
    const res = await exports.default.fetch(ORIGIN + "/nope?code=x");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "not_found" });
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("메서드가 다르면 405와 Allow", async () => {
    const res = await exports.default.fetch(ORIGIN + "/health", { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET");
    expect(await res.json()).toEqual({ code: "method_not_allowed" });
  });

  it("표: 경로·메서드 쌍이 겹치지 않고, 패턴은 /로 시작한다", () => {
    const keys = ROUTES.map((r) => `${r.method} ${r.pattern}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of ROUTES) expect(r.pattern.startsWith("/")).toBe(true);
    expect(keys).toContain("GET /health");
  });
});
