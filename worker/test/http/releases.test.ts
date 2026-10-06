// GET·HEAD /releases/**(docs/design/worker.md §9.1·§9.2, 구현 중 변경 30·31): 보이는 키 표, 헤더, Range, 조건부, HEAD, 자격, 즉시성.
// 이 파일의 부서진 fixture 버전: 0.3.0(SHA256SUMS 해석 실패), 0.4.0(목록에만 있고 객체는 없음).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SUMS_CACHE } from "../../src/http/releases";
import { sha256Hex } from "../../src/core/token";
import { createFakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, ADMINS, C3 } from "../store/helpers";
import { allowedLogin } from "../store/helpers";
import { ORIGIN, store, useClock, viaEnv, viaExports } from "./harness";
import { APPIMAGE, CI, countingDist, type Cred, type Creds, credHeaders, DEB, DMG, file, makeCreds, seedDist, seedInvalidSums, seedListedMissing, V2 } from "./release-fixture";

let seed: Map<string, Uint8Array>;
let creds: Creds;
let net: FakeNet;
const statuses: number[] = [];
const DMG3 = file("0.3.0", "darwin-aarch64.dmg");
const LISTED4 = file("0.4.0", "x.bin");

beforeAll(async () => {
  seed = await seedDist();
  await seedInvalidSums("0.3.0");
  await seedListedMissing("0.4.0", LISTED4);
});

beforeEach(async () => {
  useClock();
  net = installFakeChzzk(createFakeChzzk());
  SUMS_CACHE.clear();
  creds = await makeCreds();
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  // 리디렉션 0건: 3xx는 304(조건부 적중)뿐이다
  expect(statuses.filter((s) => s >= 300 && s < 400 && s !== 304)).toEqual([]);
  statuses.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function call(method: string, path: string, cred: Cred, headers: Record<string, string> = {}): Promise<Response> {
  const res = await viaExports(ORIGIN + path, { method, headers: { ...credHeaders(creds, cred), ...headers } });
  statuses.push(res.status);
  expect(res.headers.get("Location")).toBeNull();
  return res;
}
const get = (path: string, cred: Cred, headers?: Record<string, string>) => call("GET", path, cred, headers);
const bytes = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const seeded = (key: string) => seed.get(key) as Uint8Array;
const R = (name: string, v = V2) => `/releases/${v}/${name}`;

describe("보이는 키 표", () => {
  it.each([
    ["app", R(DMG), 200],
    ["app", R(DEB), 200],
    ["app", R(`${APPIMAGE}.sig`), 200],
    ["web", R(DEB), 200],
    ["app", R("SHA256SUMS"), 200],
    ["app", R("manifest.json"), 200],
    ["app", R("previous"), 403, "forbidden"],
    ["web", "/releases/latest.json", 403, "forbidden"],
    ["app", R("unlisted.bin"), 403, "forbidden"],
    ["ci", R("previous"), 200],
    ["ci", "/releases/latest.json", 200],
    ["app", "/releases/0.9.9/SHA256SUMS", 404, "not_found"],
    ["ci", R("x.bin", "0.9.9"), 404, "not_found"],
    ["app", R("x.bin", "0.9.9"), 403, "forbidden"],
    ["app", R(DMG3, "0.3.0"), 403, "forbidden"],
    ["app", R("SHA256SUMS", "0.3.0"), 200],
    ["app", R(LISTED4, "0.4.0"), 404, "not_found"],
  ] as [Cred, string, number, string?][])("%s %s → %d %s", async (cred, path, status, code) => {
    const res = await get(path, cred);
    expect(res.status).toBe(status);
    const body = await bytes(res);
    if (code !== undefined) expect(JSON.parse(new TextDecoder().decode(body))).toEqual({ code });
    else if (path === "/releases/latest.json") expect(body).toEqual(seeded("releases/latest.json"));
    else if (path === R("previous")) expect(new TextDecoder().decode(body)).toBe("0.1.0");
    else if (seed.has(path.slice(1))) expect(body).toEqual(seeded(path.slice(1)));
  });
});

describe("문법 400(자격 없이도)", () => {
  it.each([
    "/releases/0.2.0/a%2Fb",
    "/releases/v1/x",
    "/releases/01.0.0/x",
    "/releases/1.0.0/x/y",
    "/releases/x",
    "/releases/LATEST.json",
    "/releases/1.0.0+b/x",
    "/releases/0.2.0/",
  ])("%s", async (path) => {
    for (const cred of ["none", "app", "ci"] as const) {
      const res = await get(path, cred);
      expect([cred, res.status]).toEqual([cred, 400]);
      expect(await res.json()).toEqual({ code: "bad_key" });
    }
  });
});

describe("라우터", () => {
  it("/releases는 404, POST는 405(Allow: GET, HEAD), HEAD /update는 405(Allow: GET)", async () => {
    const a = await get("/releases", "app");
    expect(a.status).toBe(404);
    expect(await a.json()).toEqual({ code: "not_found" });
    const b = await call("POST", "/releases/x", "app");
    expect(b.status).toBe(405);
    expect(b.headers.get("Allow")).toBe("GET, HEAD");
    await b.text();
    const c = await call("HEAD", "/update/0.1.0", "app");
    expect(c.status).toBe(405);
    expect(c.headers.get("Allow")).toBe("GET");
  });
});

describe("헤더", () => {
  it("DMG 200", async () => {
    const res = await get(R(DMG), "app");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Length")).toBe("1024");
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]+"$/);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${DMG}"`);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(await bytes(res)).toEqual(seeded(`releases/${V2}/${DMG}`));
  });

  it.each([
    [R("SHA256SUMS"), "text/plain; charset=utf-8", "inline"],
    [R("manifest.json"), "application/json", "inline"],
    [R(`${APPIMAGE}.sig`), "text/plain; charset=utf-8", `attachment; filename="${APPIMAGE}.sig"`],
  ])("%s", async (path, type, disposition) => {
    const res = await get(path, "app");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(type);
    expect(res.headers.get("Content-Disposition")).toBe(disposition);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
    await res.arrayBuffer();
  });
});

describe("Range 표", () => {
  it.each([
    ["bytes=0-9", 206, "bytes 0-9/1024", "10", [0, 10]],
    ["bytes=1000-", 206, "bytes 1000-1023/1024", "24", [1000, 1024]],
    ["bytes=-10", 206, "bytes 1014-1023/1024", "10", [1014, 1024]],
    ["bytes=-2000", 206, "bytes 0-1023/1024", "1024", [0, 1024]],
    ["bytes=0-99999", 206, "bytes 0-1023/1024", "1024", [0, 1024]],
    ["BYTES=0-9", 206, "bytes 0-9/1024", "10", [0, 10]],
    ["bytes=1024-", 416, "bytes */1024", null, null],
    ["bytes=-0", 416, "bytes */1024", null, null],
    ["bytes=0-1,5-9", 200, null, "1024", [0, 1024]],
    ["bytes=5-1", 200, null, "1024", [0, 1024]],
    ["bytes= 0-9", 200, null, "1024", [0, 1024]],
    ["items=0-9", 200, null, "1024", [0, 1024]],
    ["bytes=1234567890123456-", 200, null, "1024", [0, 1024]],
  ] as [string, number, string | null, string | null, [number, number] | null][])("%s", async (range, status, cr, cl, slice) => {
    const res = await get(R(DMG), "app", { Range: range });
    expect(res.status).toBe(status);
    expect(res.headers.get("Content-Range")).toBe(cr);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
    if (status === 416) {
      expect(await res.json()).toEqual({ code: "range_not_satisfiable" });
      return;
    }
    expect(res.headers.get("Content-Length")).toBe(cl);
    expect(await bytes(res)).toEqual(seeded(`releases/${V2}/${DMG}`).slice(slice?.[0], slice?.[1]));
  });
});

describe("조건부", () => {
  async function etag(): Promise<string> {
    const head = await call("HEAD", R(DMG), "ci");
    expect(head.status).toBe(200);
    return head.headers.get("ETag") as string;
  }

  it.each([
    ["etag", (e: string) => e, 304],
    ["W/ + etag", (e: string) => `W/${e}`, 304],
    ["*", () => "*", 304],
    ["다른 값", () => '"other"', 200],
    ["형식이 틀린 값(500이 아니다)", () => "garbage", 200],
  ] as [string, (e: string) => string, number][])("GET If-None-Match %s", async (_name, make, status) => {
    const e = await etag();
    const res = await get(R(DMG), "ci", { "If-None-Match": make(e) });
    expect(res.status).toBe(status);
    const body = await bytes(res);
    if (status === 304) {
      expect(res.headers.get("ETag")).toBe(e);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
      expect(body.byteLength).toBe(0);
    } else {
      expect(body.byteLength).toBe(1024);
    }
  });

  it("etag + Range는 304(조건부가 먼저)", async () => {
    const e = await etag();
    const res = await get(R(DMG), "ci", { "If-None-Match": e, Range: "bytes=0-9" });
    expect(res.status).toBe(304);
    expect((await bytes(res)).byteLength).toBe(0);
  });

  it("HEAD + etag는 304", async () => {
    const e = await etag();
    const res = await call("HEAD", R(DMG), "ci", { "If-None-Match": e });
    expect(res.status).toBe(304);
    expect(res.headers.get("ETag")).toBe(e);
  });
});

describe("HEAD", () => {
  it("app DMG: 200, Content-Length 1024, 본문 0바이트. Range는 무시한다", async () => {
    for (const headers of [{}, { Range: "bytes=0-9" }] as Record<string, string>[]) {
      const res = await call("HEAD", R(DMG), "app", headers);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Length")).toBe("1024");
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect(res.headers.get("Content-Range")).toBeNull();
      expect((await bytes(res)).byteLength).toBe(0);
    }
  });

  it("없는 키(404)·previous(403)도 본문이 없다", async () => {
    const a = await call("HEAD", R("x.bin", "0.9.9"), "ci");
    expect(a.status).toBe(404);
    expect((await bytes(a)).byteLength).toBe(0);
    const b = await call("HEAD", R("previous"), "app");
    expect(b.status).toBe(403);
    expect((await bytes(b)).byteLength).toBe(0);
  });
});

describe("자격 우선순위·형식", () => {
  it("웹 쿠키 + 쓰레기 Authorization은 401(쿠키 무시)", async () => {
    const res = await get(R(DEB), "web", { Authorization: "Bearer junk" });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "invalid_token" });
  });

  it("웹 쿠키 + app Bearer는 200(A 경로)", async () => {
    const res = await get(R(DEB), "web", { Authorization: `Bearer ${creds.access.app}` });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });

  it("형식은 맞지만 모르는 cda_ 토큰은 401 invalid_token", async () => {
    const res = await get(R(DEB), "none", { Authorization: `Bearer cda_${"A".repeat(43)}` });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "invalid_token" });
  });

  it("웹 쿠키 값을 Bearer에 넣으면 401, app access를 쿠키에 넣으면 401", async () => {
    const a = await get(R(DEB), "none", { Authorization: `Bearer ${creds.cookie.web}` });
    expect(a.status).toBe(401);
    await a.text();
    const b = await get(R(DEB), "none", { Cookie: `cdl_s=${creds.access.app}` });
    expect(b.status).toBe(401);
    await b.text();
  });

  it.each([`Bearer ${CI}-x`, `Bearer ${CI.toUpperCase()}`, "Basic dXNlcjpwYXNz", "Bearer", "Token abc"])("틀린 Authorization %j는 401(404가 아니다)", async (value) => {
    const res = await get(R(DMG), "none", { Authorization: value });
    expect(res.status).toBe(401);
    await res.text();
  });

  it("자격이 없으면 401, 폐기된 세션 401, 허용 해제 403", async () => {
    const a = await get(R(DMG), "none");
    expect([a.status, await a.json()]).toEqual([401, { code: "invalid_token" }]);
    const b = await get(R(DMG), "appRevoked");
    expect([b.status, await b.json()]).toEqual([401, { code: "session_revoked" }]);
    const c = await get(R(DMG), "appDisallowed");
    expect([c.status, await c.json()]).toEqual([403, { code: "not_allowed" }]);
  });
});

describe("즉시성(§6.1): 폐기·허용 해제는 다음 요청에 곧바로 듣는다", () => {
  it("app 세션 revoke 뒤 같은 access는 401 session_revoked", async () => {
    const ok = await get(R(DMG), "app");
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
    const c = await store().check(await sha256Hex(creds.access.app), ADMINS, Date.now());
    if (!c.ok) throw new Error("check");
    expect(await store().revoke(c.sessionId, "admin", A1, Date.now())).toBe(true);
    const res = await get(R(DMG), "app");
    expect([res.status, await res.json()]).toEqual([401, { code: "session_revoked" }]);
  });

  it("허용 해제 뒤에는 403 not_allowed", async () => {
    const login = await allowedLogin(store(), { channelId: C3, now: Date.now() });
    const headers = { Authorization: `Bearer ${login.bundle.accessToken}` };
    const ok = await viaExports(ORIGIN + R(DMG), { method: "GET", headers });
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
    expect(await store().disallow(C3, A1, ADMINS, Date.now())).toEqual({ ok: true });
    const res = await viaExports(ORIGIN + R(DMG), { method: "GET", headers });
    expect([res.status, await res.json()]).toEqual([403, { code: "not_allowed" }]);
  });

  it("웹 세션 revoke 뒤에는 401", async () => {
    const ok = await get(R(DMG), "web");
    expect(ok.status).toBe(200);
    await ok.arrayBuffer();
    const c = await store().webCheck(await sha256Hex(creds.cookie.web), ADMINS, Date.now());
    if (!c.ok) throw new Error("webCheck");
    expect(await store().revoke(c.sessionId, "admin", A1, Date.now())).toBe(true);
    const res = await get(R(DMG), "web");
    expect(res.status).toBe(401);
    await res.text();
  });
});

describe("로그", () => {
  it("403은 release.forbidden_key 한 줄이고 파일 이름·버전이 없다", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await get(R("unlisted.bin"), "app");
    expect(res.status).toBe(403);
    await res.text();
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain('{"event":"release.forbidden_key","level":"info","route":"/releases/**","reason":"not_listed"}');
    for (const line of lines) {
      expect(line).not.toContain("unlisted");
      expect(line).not.toContain("0.2.0");
    }
  });
});

describe("Range 방어(R2가 기대와 다르게 답하는 경우)", () => {
  const sendVia = (dist: R2Bucket) => viaEnv({ DIST: dist });
  const ciGet = async (send: ReturnType<typeof viaEnv>, range?: string) => {
    const res = await send(ORIGIN + R(DMG), { method: "GET", headers: { Authorization: `Bearer ${CI}`, ...(range ? { Range: range } : {}) } });
    statuses.push(res.status);
    return res;
  };

  it("obj.range가 {suffix}면 정규화해 206", async () => {
    const c = countingDist({ rangeReport: () => ({ suffix: 10 }) });
    const res = await ciGet(sendVia(c.dist), "bytes=-10");
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 1014-1023/1024");
    await res.arrayBuffer();
  });

  it("obj.range가 {offset}만이면 정규화해 206", async () => {
    const c = countingDist({ rangeReport: () => ({ offset: 1000 }) });
    const res = await ciGet(sendVia(c.dist), "bytes=1000-");
    expect(res.status).toBe(206);
    await res.arrayBuffer();
  });

  it("obj.range가 요청 길이({offset:0,length:100000})를 그대로 주면 객체 끝에서 잘라 206", async () => {
    const c = countingDist({ rangeReport: () => ({ offset: 0, length: 100000 }) });
    const res = await ciGet(sendVia(c.dist), "bytes=0-99999");
    expect([res.status, res.headers.get("Content-Range"), res.headers.get("Content-Length")]).toEqual([206, "bytes 0-1023/1024", "1024"]);
    expect((await res.arrayBuffer()).byteLength).toBe(1024);
    expect(c.calls.get).toBe(1);
  });

  it("obj.range가 판정과 다르면 500 internal + release.range_mismatch", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const c = countingDist({ rangeReport: () => ({ offset: 0, length: 1 }) });
    const res = await ciGet(sendVia(c.dist), "bytes=0-9");
    expect([res.status, await res.json()]).toEqual([500, { code: "internal" }]);
    expect(logSpy.mock.calls.map((l) => JSON.parse(String(l[0])))).toContainEqual(expect.objectContaining({ event: "release.range_mismatch", level: "error" }));
  });

  it("R2가 10039를 던지면 416(Content-Range 없음) + release.range_error, Range가 없으면 던지지 않는다", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const c = countingDist({ throwOnRange: true });
    const res = await ciGet(sendVia(c.dist), "bytes=0-9");
    expect([res.status, res.headers.get("Content-Range")]).toEqual([416, null]);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    await res.arrayBuffer();
    expect(logSpy.mock.calls.map((l) => JSON.parse(String(l[0])))).toContainEqual(expect.objectContaining({ event: "release.range_error", level: "warn" }));
    expect(c.calls.get).toBe(1);
    const whole = await ciGet(sendVia(c.dist));
    expect(whole.status).toBe(200);
    await whole.arrayBuffer();
  });
});
