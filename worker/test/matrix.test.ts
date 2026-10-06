// 자격 × 경로 행렬(docs/design/worker.md §4.5, 구현 중 변경 31 (타)). 표의 키는 경로 표(ROUTES)와 같아야 한다:
// 경로를 더하고 기대를 정하지 않으면 실패한다. W6이 /admin*·/me/*·/·/auth/web/logout을 더한다.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newId, newSecret, sha256B64url } from "../src/core/token";
import { type Auth, ROUTES } from "../src/routes";
import { SUMS_CACHE } from "../src/http/releases";
import { createFakeChzzk } from "./fake-chzzk.mjs";
import { ORIGIN, useClock, viaExports } from "./http/harness";
import { type Cred, type Creds, credHeaders, DMG, makeCreds, seedDist, V2 } from "./http/release-fixture";
import { installFakeChzzk, type FakeNet } from "./network";

const CREDS: readonly Cred[] = ["none", "app", "appRevoked", "appDisallowed", "web", "webAdmin", "ci", "garbage"];

interface MatrixCase {
  readonly name: string;
  readonly request: (c: Creds, cred: Cred) => Promise<{ path: string; init: RequestInit }> | { path: string; init: RequestInit };
  readonly expect: Readonly<Record<Cred, number>>;
}

const all = (n: number) => Object.fromEntries(CREDS.map((c) => [c, n])) as Record<Cred, number>;
const by = (none: number, app: number, appRevoked: number, appDisallowed: number, web: number, webAdmin: number, ci: number, garbage: number): Record<Cred, number> => ({
  none,
  app,
  appRevoked,
  appDisallowed,
  web,
  webAdmin,
  ci,
  garbage,
});

const plain = (path: string, method = "GET"): MatrixCase["request"] => (c, cred) => ({ path, init: { method, headers: credHeaders(c, cred) } });
const form = (path: string): MatrixCase["request"] => (c, cred) => ({
  path,
  init: {
    method: "POST",
    headers: { ...credHeaders(c, cred), Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded" },
    body: "",
  },
});
const jsonPost = (path: string, body: (c: Creds, cred: Cred) => unknown | Promise<unknown>): MatrixCase["request"] => async (c, cred) => ({
  path,
  init: { method: "POST", headers: { ...credHeaders(c, cred), "Content-Type": "application/json" }, body: JSON.stringify(await body(c, cred)) },
});

const R = (name: string) => `/releases/${V2}/${name}`;
const MATRIX: Readonly<Record<string, readonly MatrixCase[]>> = {
  "GET /health": [{ name: "health", request: plain("/health"), expect: all(200) }],
  "POST /auth/start": [
    {
      name: "start",
      request: jsonPost("/auth/start", async () => ({ pollVerifier: await sha256B64url(newSecret()), client: "app/0.2.0 macos" })),
      expect: all(201),
    },
  ],
  "GET /auth/login/:handle": [{ name: "모르는 handle", request: () => ({ path: `/auth/login/${newId()}`, init: { method: "GET" } }), expect: all(404) }],
  "POST /auth/login/:handle": [{ name: "모르는 handle", request: (c, cred) => form(`/auth/login/${newId()}`)(c, cred), expect: all(404) }],
  "POST /auth/web/start": [{ name: "web start", request: form("/auth/web/start"), expect: all(303) }],
  "GET /auth/callback": [{ name: "쿼리 없음", request: plain("/auth/callback"), expect: all(303) }],
  "GET /auth/done": [{ name: "done", request: plain("/auth/done?r=ok"), expect: all(200) }],
  "POST /auth/poll": [{ name: "모르는 loginId", request: jsonPost("/auth/poll", () => ({ loginId: newId(), pollSecret: newSecret() })), expect: all(404) }],
  "POST /auth/refresh": [
    {
      name: "refresh",
      request: jsonPost("/auth/refresh", (c, cred) => (cred === "app" || cred === "appRevoked" || cred === "appDisallowed" ? { refreshToken: c.refresh[cred] } : {})),
      expect: by(401, 200, 401, 403, 401, 401, 401, 401),
    },
  ],
  "POST /auth/logout": [{ name: "logout", request: (c, cred) => ({ path: "/auth/logout", init: { method: "POST", headers: { ...credHeaders(c, cred), "Content-Type": "application/json" }, body: "" } }), expect: by(401, 204, 204, 204, 401, 401, 401, 401) }],
  "GET /api/me": [{ name: "me", request: plain("/api/me"), expect: by(401, 200, 401, 403, 401, 401, 401, 401) }],
  "GET /update/:current": [
    { name: "갱신 있음", request: plain("/update/0.1.0"), expect: by(401, 200, 401, 403, 401, 401, 200, 401) },
    { name: "최신", request: plain("/update/0.2.0"), expect: by(401, 204, 401, 403, 401, 401, 204, 401) },
    { name: "문법 오류", request: plain("/update/not-semver"), expect: all(400) },
  ],
  "GET /releases/**": [
    { name: "DMG", request: plain(R(DMG)), expect: by(401, 200, 401, 403, 200, 200, 200, 401) },
    { name: "latest.json", request: plain("/releases/latest.json"), expect: by(401, 403, 401, 403, 403, 403, 200, 401) },
    { name: "previous", request: plain(R("previous")), expect: by(401, 403, 401, 403, 403, 403, 200, 401) },
    { name: "없는 버전의 SHA256SUMS", request: plain("/releases/9.9.9/SHA256SUMS"), expect: by(401, 404, 401, 403, 404, 404, 404, 401) },
    { name: "문법 오류", request: plain("/releases/0.2.0/a%2Fb"), expect: all(400) },
  ],
  "HEAD /releases/**": [
    { name: "DMG", request: plain(R(DMG), "HEAD"), expect: by(401, 200, 401, 403, 200, 200, 200, 401) },
    { name: "latest.json", request: plain("/releases/latest.json", "HEAD"), expect: by(401, 403, 401, 403, 403, 403, 200, 401) },
  ],
};

const keyOf = (r: { method: string; pattern: string }) => `${r.method} ${r.pattern}`;

// 자격 종류를 모두 다룬다: Auth에 값을 더하면 여기서 컴파일이 깨진다
function expectFor(auth: Auth): "public" | "flow" | "credentialed" {
  switch (auth) {
    case "none":
      return "public";
    case "flow":
      return "flow";
    case "app":
    case "refresh":
    case "app_or_refresh":
    case "release":
    case "update":
      return "credentialed";
    default: {
      const x: never = auth;
      throw new Error(`모르는 자격 종류 ${String(x)}`);
    }
  }
}

describe("표와 경로 표", () => {
  it("표의 키 = ROUTES(경로를 더하고 기대를 정하지 않으면 실패)", () => {
    expect(Object.keys(MATRIX).sort()).toEqual(ROUTES.map(keyOf).sort());
  });

  it("행마다 케이스가 1개 이상", () => {
    for (const [k, cases] of Object.entries(MATRIX)) expect([k, cases.length > 0]).toEqual([k, true]);
  });

  it("자격이 필요 없는 행(none·flow)은 모든 자격에서 같은 상태", () => {
    for (const r of ROUTES) {
      if (expectFor(r.auth) === "credentialed") continue;
      for (const c of MATRIX[keyOf(r)] ?? []) expect([keyOf(r), c.name, new Set(Object.values(c.expect)).size]).toEqual([keyOf(r), c.name, 1]);
    }
  });

  it("CI 토큰을 해석하는 경로 = {GET /update/:current, GET·HEAD /releases/**}", () => {
    const ciRoutes = ROUTES.filter((r) => r.auth === "release" || r.auth === "update").map(keyOf);
    expect([...ciRoutes].sort()).toEqual(["GET /releases/**", "GET /update/:current", "HEAD /releases/**"]);
  });

  it("그 밖의 모든 행·케이스에서 CI 토큰의 상태 = 쓰레기 Bearer의 상태", () => {
    const ciRoutes = new Set(ROUTES.filter((r) => r.auth === "release" || r.auth === "update").map(keyOf));
    for (const [k, cases] of Object.entries(MATRIX)) {
      if (ciRoutes.has(k)) continue;
      for (const c of cases) expect([k, c.name, c.expect.ci]).toEqual([k, c.name, c.expect.garbage]);
    }
  });
});

describe("실행", () => {
  let creds: Creds;
  let net: FakeNet;
  const statuses: number[] = [];

  beforeAll(async () => {
    await seedDist();
  });

  beforeEach(async () => {
    useClock();
    net = installFakeChzzk(createFakeChzzk());
    SUMS_CACHE.clear();
    creds = await makeCreds();
  });

  afterEach(() => {
    expect(net.unhandled).toEqual([]);
    statuses.length = 0;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  for (const [key, cases] of Object.entries(MATRIX)) {
    it(key, async () => {
      for (const c of cases) {
        for (const cred of CREDS) {
          const { path, init } = await c.request(creds, cred);
          const res = await viaExports(ORIGIN + path, init);
          await res.arrayBuffer();
          statuses.push(res.status);
          expect([key, c.name, cred, res.status]).toEqual([key, c.name, cred, c.expect[cred]]);
          // 릴리스 읽기는 리디렉션이 없다(304는 조건부 적중이라 여기서는 나오지 않는다)
          if (key.includes("/releases/") || key.includes("/update/")) expect(res.status < 300 || res.status >= 400).toBe(true);
        }
      }
    });
  }
});
