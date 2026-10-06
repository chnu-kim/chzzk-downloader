// Worker 요청 하나가 부르는 R2 연산 수(docs/design/worker.md 구현 중 변경 11 (라)·16 (다)·31 (바)): get + head ≤ 2, list·쓰기 0.
// 모든 경로(200·206·304·416·404·403·401·400·CI 토큰·/update 200/204, SUMS 캐시 미스 포함)를 호출 계수 래퍼로 센다.
// 이 파일의 부서진 fixture 버전: 0.5.0(목록에만 있고 객체는 없음).
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { SUMS_CACHE } from "../../src/http/releases";
import { createFakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { ORIGIN, useClock, viaEnv, viaExports } from "./harness";
import { type CountingOpts, type Cred, type Creds, countingDist, credHeaders, DEB, DMG, file, makeCreds, seedDist, seedListedMissing, V2 } from "./release-fixture";

let creds: Creds;
let net: FakeNet;
let etag = "";
const LISTED5 = file("0.5.0", "x.bin");
const R = (name: string, v = V2) => `/releases/${v}/${name}`;
const LATEST = "/releases/latest.json";

beforeAll(async () => {
  await seedDist();
  await seedListedMissing("0.5.0", LISTED5);
  etag = (await env.DIST.head(`releases/${V2}/${DMG}`))?.httpEtag ?? "";
});

beforeEach(async () => {
  useClock();
  net = installFakeChzzk(createFakeChzzk());
  SUMS_CACHE.clear();
  creds = await makeCreds();
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Row {
  readonly n: number;
  readonly cred: Cred | "ciWrong";
  readonly method?: "GET" | "HEAD";
  readonly path: string;
  readonly headers?: Record<string, string>;
  /** miss = SUMS 캐시를 비운다, hit = 같은 경로를 한 번 먼저 보내 캐시를 데운다(계수 없이), 없으면 상관없다 */
  readonly cache?: "miss" | "hit";
  readonly opts?: CountingOpts;
  readonly status: number;
  readonly get: number;
  readonly head: number;
}

// etag는 beforeAll이 R2에서 읽는다: 표에는 자리표시를 두고 실행 때 바꾼다
const ETAG = "$ETAG";
const INM = { "If-None-Match": ETAG };
const ROWS: readonly Row[] = [
  { n: 1, cred: "ci", path: LATEST, status: 200, get: 1, head: 0 },
  { n: 2, cred: "ci", method: "HEAD", path: LATEST, status: 200, get: 0, head: 1 },
  { n: 3, cred: "ci", path: R(DMG), status: 200, get: 1, head: 0 },
  { n: 4, cred: "ci", path: R(DMG), headers: { Range: "bytes=0-9" }, status: 206, get: 1, head: 0 },
  { n: 5, cred: "ci", path: R(DMG), headers: { Range: "bytes=5000-" }, status: 416, get: 1, head: 0 },
  { n: 6, cred: "ci", path: R("previous"), status: 200, get: 1, head: 0 },
  { n: 7, cred: "ci", path: "/releases/0.9.9/SHA256SUMS", status: 404, get: 1, head: 0 },
  { n: 8, cred: "ci", path: R(DMG), headers: INM, status: 304, get: 1, head: 0 },
  { n: 9, cred: "app", path: R(DMG), cache: "miss", status: 200, get: 2, head: 0 },
  { n: 10, cred: "app", path: R(DMG), cache: "hit", status: 200, get: 1, head: 0 },
  { n: 11, cred: "app", path: R(DMG), headers: { Range: "bytes=0-9" }, cache: "miss", status: 206, get: 2, head: 0 },
  { n: 12, cred: "app", path: R(DMG), headers: { Range: "bytes=5000-" }, cache: "miss", status: 416, get: 2, head: 0 },
  { n: 13, cred: "app", path: R(DMG), headers: { Range: "bytes=-10" }, cache: "hit", status: 206, get: 1, head: 0 },
  { n: 14, cred: "app", path: R(DMG), headers: INM, cache: "miss", status: 304, get: 2, head: 0 },
  { n: 15, cred: "app", method: "HEAD", path: R(DMG), cache: "miss", status: 200, get: 1, head: 1 },
  { n: 16, cred: "app", path: R("manifest.json"), cache: "miss", status: 200, get: 1, head: 0 },
  { n: 17, cred: "app", path: R("SHA256SUMS"), cache: "miss", status: 200, get: 1, head: 0 },
  { n: 18, cred: "app", path: R("previous"), cache: "miss", status: 403, get: 0, head: 0 },
  { n: 19, cred: "app", path: LATEST, status: 403, get: 0, head: 0 },
  { n: 20, cred: "app", path: R("unlisted.bin"), cache: "miss", status: 403, get: 1, head: 0 },
  { n: 21, cred: "app", path: R("x.dmg", "0.9.9"), cache: "miss", status: 403, get: 1, head: 0 },
  { n: 22, cred: "app", path: R(LISTED5, "0.5.0"), cache: "miss", status: 404, get: 2, head: 0 },
  { n: 23, cred: "app", path: R(LISTED5, "0.5.0"), headers: { Range: "bytes=0-9" }, cache: "miss", status: 404, get: 2, head: 0 },
  { n: 24, cred: "web", path: R(DEB), headers: { Range: "bytes=0-0" }, cache: "miss", status: 206, get: 2, head: 0 },
  { n: 25, cred: "web", path: R(DEB), headers: { Range: "bytes=5000-" }, cache: "miss", status: 416, get: 2, head: 0 },
  { n: 26, cred: "web", path: R(DEB), cache: "miss", status: 200, get: 2, head: 0 },
  { n: 27, cred: "app", path: R(DMG), headers: { Range: "bytes=0-9" }, cache: "miss", opts: { throwOnRange: true }, status: 416, get: 2, head: 0 },
  { n: 28, cred: "none", path: R(DMG), status: 401, get: 0, head: 0 },
  { n: 29, cred: "garbage", path: R(DMG), status: 401, get: 0, head: 0 },
  { n: 30, cred: "appRevoked", path: R(DMG), status: 401, get: 0, head: 0 },
  { n: 31, cred: "appDisallowed", path: R(DMG), status: 403, get: 0, head: 0 },
  { n: 32, cred: "ciWrong", path: R(DMG), status: 401, get: 0, head: 0 },
  { n: 33, cred: "none", path: "/releases/0.2.0/a%2Fb", status: 400, get: 0, head: 0 },
  { n: 34, cred: "ci", path: "/update/0.1.0", status: 200, get: 1, head: 0 },
  { n: 35, cred: "ci", path: "/update/0.2.0", status: 204, get: 1, head: 0 },
  { n: 36, cred: "app", path: "/update/0.1.0", status: 200, get: 1, head: 0 },
  { n: 37, cred: "app", path: "/update/bad", status: 400, get: 0, head: 0 },
  { n: 38, cred: "app", path: "/update/0.1.0", opts: { hide: [LATEST.slice(1)] }, status: 204, get: 1, head: 0 },
  { n: 39, cred: "none", path: "/update/0.1.0", status: 401, get: 0, head: 0 },
  { n: 40, cred: "web", path: "/update/0.1.0", status: 401, get: 0, head: 0 },
];

const authHeaders = (cred: Row["cred"]) => (cred === "ciWrong" ? { Authorization: "Bearer dev-ci-token-x" } : credHeaders(creds, cred));

it("etag를 읽었다", () => {
  expect(etag).toMatch(/^"[0-9a-f]+"$/);
});

it("표는 40행이고 번호가 1부터 이어진다", () => {
  expect(ROWS.map((r) => r.n)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
});

it.each(ROWS.map((r) => [`#${r.n} ${r.cred} ${r.method ?? "GET"} ${r.path} ${JSON.stringify(r.headers ?? {})} ${r.cache ?? ""}`, r] as const))("%s", async (_name, row) => {
  const extra = Object.fromEntries(Object.entries(row.headers ?? {}).map(([k, v]) => [k, v === ETAG ? etag : v]));
  const headers = { ...authHeaders(row.cred), ...extra };
  if (row.cache === "miss") SUMS_CACHE.clear();
  if (row.cache === "hit") {
    const warm = await viaExports(ORIGIN + row.path, { method: "GET", headers: authHeaders(row.cred) });
    expect(warm.status).toBeLessThan(400);
    await warm.arrayBuffer();
  }
  const c = countingDist(row.opts);
  const res = await viaEnv({ DIST: c.dist })(ORIGIN + row.path, { method: row.method ?? "GET", headers });
  await res.arrayBuffer();
  expect(res.status).toBe(row.status);
  expect([c.calls.get, c.calls.head]).toEqual([row.get, row.head]);
  expect([c.calls.list, c.calls.put, c.calls.delete, c.calls.multipart]).toEqual([0, 0, 0, 0]);
  expect(c.calls.get + c.calls.head).toBeLessThanOrEqual(2);
});
