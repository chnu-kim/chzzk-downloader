// GET /update/{current}(docs/design/worker.md §9.3, 구현 중 변경 14 (사)·31): 200/204/400, 자격, latest.json 이상, deploy-worker 검사 계약(§9.4).
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LATEST_MAX } from "../../src/http/update";
import { SUMS_CACHE } from "../../src/http/releases";
import { createFakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { ORIGIN, useClock, viaExports } from "./harness";
import { type Cred, type Creds, credHeaders, makeCreds, seedDist } from "./release-fixture";

let seed: Map<string, Uint8Array>;
let creds: Creds;
let net: FakeNet;
const statuses: number[] = [];

beforeAll(async () => {
  seed = await seedDist();
});

beforeEach(async () => {
  useClock();
  net = installFakeChzzk(createFakeChzzk());
  SUMS_CACHE.clear();
  creds = await makeCreds();
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  expect(statuses.filter((s) => s >= 300 && s < 400)).toEqual([]);
  statuses.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function get(path: string, cred: Cred, headers: Record<string, string> = {}): Promise<Response> {
  const res = await viaExports(ORIGIN + path, { method: "GET", headers: { ...credHeaders(creds, cred), ...headers } });
  statuses.push(res.status);
  return res;
}
const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const latest = () => seed.get("releases/latest.json") as Uint8Array;

describe("200·204", () => {
  it("ci /update/0.1.0: 200, 본문 = latest.json 바이트, 헤더", async () => {
    const res = await get("/update/0.1.0", "ci");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    expect(res.headers.get("Content-Length")).toBe(String(latest().byteLength));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
    expect(await bytes(res)).toEqual(latest());
  });

  it("app /update/0.1.0: 200", async () => {
    const res = await get("/update/0.1.0", "app");
    expect(res.status).toBe(200);
    expect(await bytes(res)).toEqual(latest());
  });

  it.each(["0.2.0", "0.3.0", "0.2.1-rc.1"])("app /update/%s: 204, 본문 없음", async (v) => {
    const res = await get(`/update/${v}`, "app");
    expect(res.status).toBe(204);
    expect((await bytes(res)).byteLength).toBe(0);
  });

  it("0.2.0-rc.1은 prerelease가 낮아 200", async () => {
    const res = await get("/update/0.2.0-rc.1", "app");
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });
});

describe("400 bad_version(자격 없이도)", () => {
  it.each(["/update/not-semver", "/update/1.0", "/update/01.0.0", "/update/0.1.0%2Bbuild", "/update/0.1.0+build", "/update/%ZZ"])("%s", async (path) => {
    const res = await get(path, "none");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "bad_version" });
  });
});

describe("자격", () => {
  it("없으면 401, 웹 쿠키는 401(웹 불가)", async () => {
    const a = await get("/update/0.1.0", "none");
    expect([a.status, await a.json()]).toEqual([401, { code: "invalid_token" }]);
    const b = await get("/update/0.1.0", "web");
    expect([b.status, await b.json()]).toEqual([401, { code: "invalid_token" }]);
    const c = await get("/update/0.1.0", "webAdmin");
    expect(c.status).toBe(401);
    await c.text();
  });

  it("폐기된 세션 401 · 허용 해제 403", async () => {
    const a = await get("/update/0.1.0", "appRevoked");
    expect([a.status, await a.json()]).toEqual([401, { code: "session_revoked" }]);
    const b = await get("/update/0.1.0", "appDisallowed");
    expect([b.status, await b.json()]).toEqual([403, { code: "not_allowed" }]);
  });

  it.each(["Bearer dev-ci-token-x", "Bearer Dev-ci-token", "Bearer not-a-token", "Basic abc"])("틀린 Authorization %j는 401", async (value) => {
    const res = await get("/update/0.1.0", "none", { Authorization: value });
    expect(res.status).toBe(401);
    await res.text();
  });
});

describe("latest.json 상태", () => {
  async function withLatest(body: Uint8Array | null, run: () => Promise<void>): Promise<void> {
    try {
      if (body === null) await env.DIST.delete("releases/latest.json");
      else await env.DIST.put("releases/latest.json", body);
      await run();
    } finally {
      await env.DIST.put("releases/latest.json", latest());
    }
  }

  it("없으면 204(첫 릴리스 전·롤백 none)", async () => {
    await withLatest(null, async () => {
      const res = await get("/update/0.1.0", "ci");
      expect(res.status).toBe(204);
    });
  });

  it.each([
    ["version이 숫자", new TextEncoder().encode('{"version":1}')],
    ["JSON이 아님", new TextEncoder().encode("not json")],
    ["BOM + 정상 JSON", new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"version":"9.0.0"}')])],
    ["64KiB 초과", new Uint8Array(LATEST_MAX + 1).fill(0x20)],
  ])("%s는 500 internal + release.latest_invalid", async (_name, body) => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await withLatest(body, async () => {
      const res = await get("/update/0.1.0", "ci");
      expect([res.status, await res.json()]).toEqual([500, { code: "internal" }]);
    });
    expect(logSpy.mock.calls.map((c) => JSON.parse(String(c[0])))).toContainEqual(expect.objectContaining({ event: "release.latest_invalid", level: "error" }));
  });

  it("롤백 직후: latest.json이 바뀌면 다음 요청에 곧바로 맞는다(캐시 없음)", async () => {
    const old = seed.get("releases/0.1.0/manifest.json") as Uint8Array;
    await withLatest(old, async () => {
      const res = await get("/update/0.1.0", "app");
      expect(res.status).toBe(204);
    });
    const res = await get("/update/0.1.0", "app");
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });
});

describe("deploy-worker 검사 계약(§9.4, cicd.md)", () => {
  it("CI 토큰으로 /update·/releases/latest.json이 되고 토큰이 없거나 다른 경로면 거절된다", async () => {
    const a = await get("/update/0.0.0", "ci");
    expect(a.status).toBe(200);
    const body = await bytes(a);
    expect(body).toEqual(latest());
    expect((JSON.parse(new TextDecoder().decode(body)) as { version: string }).version).toBe("0.2.0");
    const b = await get("/update/0.2.0", "ci");
    expect(b.status).toBe(204);
    const c = await get("/releases/latest.json", "none");
    expect(c.status).toBe(401);
    await c.text();
    const d = await get("/api/me", "ci");
    expect(d.status).toBe(401);
    await d.text();
    // /admin 음성 검사(CI 토큰으로 303)는 경로가 생기는 W6에서 이 it에 더한다(지금은 경로가 없어 404다)
  });
});
