// quiet 경로(docs/design/worker.md §14, 구현 중 변경 43): URL에 로그 금지 값(code·state·handle, 채널 id, 세션 id 전체)이 실리는 경로는
// 그 Worker 호출 안에서 console.log가 한 번도 일어나지 않는다. Workers Logs는 Worker 호출의 로그 줄마다 요청 URL 전체를 붙이기 때문이다
// (W9 실측). 남길 이벤트는 그 경로가 부르는 DO RPC가 남긴다.
//
// vitest에서는 DO도 같은 isolate라 console 스파이가 DO 쪽 줄도 본다. 그래서 env.AUTH를 감싸 RPC가 도는 동안(depth > 0)의 줄을
// DO 쪽으로 가르고, 요청 경로마다 Worker 쪽 줄(depth = 0)이 없음을 단언한다.
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/core/token";
import worker from "../../src/index";
import { isQuietPath, ROUTES } from "../../src/routes";
import { createFakeChzzk, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, B2, C3, D4 } from "../store/helpers";
import { AppClient, appFlow, Browser, csrfIn, formBody, ORIGIN, parseLoopback, resetStore, store, useClock, type Send } from "./harness";

interface Rec {
  readonly path: string;
  readonly inDo: boolean;
  readonly line: string;
}

let fake: FakeChzzk;
let net: FakeNet;
let recs: Rec[] = [];
let depth = 0;
let current = "";

// RPC가 도는 동안을 세는 DO 이름공간. get은 스텁의 메서드를 감싼다(속성 접근은 그대로)
function trackedAuth(opts: { throwOnGet?: boolean } = {}): DurableObjectNamespace {
  const ns = env.AUTH;
  return {
    idFromName: (n: string) => ns.idFromName(n),
    get: (id: DurableObjectId) => {
      if (opts.throwOnGet) throw new RangeError("binding boom");
      const stub = ns.get(id);
      return new Proxy(stub, {
        get(t, p) {
          const v: unknown = Reflect.get(t, p);
          if (typeof v !== "function") return v;
          // RPC 메서드는 apply·call도 원격 메서드 이름으로 본다: 스텁에서 바로 부른다
          const call = t as unknown as Record<PropertyKey, (...a: unknown[]) => Promise<unknown>>;
          return async (...args: unknown[]) => {
            depth++;
            try {
              return await call[p]!(...args);
            } finally {
              depth--;
            }
          };
        },
      });
    },
  } as unknown as DurableObjectNamespace;
}

function sender(o: { patch?: Record<string, unknown>; throwOnGet?: boolean; envProxy?: (e: Env) => Env } = {}): Send {
  return async (u, i) => {
    current = new URL(u).pathname;
    try {
      const base = { ...env, ...o.patch, AUTH: trackedAuth({ throwOnGet: o.throwOnGet }) } as Env;
      return await worker.fetch(new Request(u, i) as Parameters<typeof worker.fetch>[0], o.envProxy ? o.envProxy(base) : base);
    } finally {
      current = "";
    }
  };
}

const send = sender();

/** quiet 경로에서 Worker 쪽이 남긴 줄 */
const workerSideOnQuiet = () => recs.filter((r) => !r.inDo && r.path !== "" && isQuietPath(r.path));
const doEvents = () => recs.filter((r) => r.inDo).map((r) => JSON.parse(r.line) as Record<string, unknown>);
const workerEvents = (path: string) => recs.filter((r) => !r.inDo && r.path === path).map((r) => JSON.parse(r.line) as Record<string, unknown>);

beforeEach(async () => {
  useClock();
  fake = createFakeChzzk();
  net = installFakeChzzk(fake);
  await resetStore();
  await store().allow(B2, "", A1, Date.now());
  recs = [];
  depth = 0;
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    recs.push({ path: current, inDo: depth > 0, line: String(a[0]) });
  });
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("경로 표", () => {
  it("quiet 행은 URL에 금지 값이 실리는 일곱 행이다", () => {
    expect(ROUTES.filter((r) => r.quiet).map((r) => `${r.method} ${r.pattern}`)).toEqual([
      "GET /auth/login/:handle",
      "POST /auth/login/:handle",
      "GET /auth/callback",
      "POST /me/sessions/:id/revoke",
      "POST /admin/sessions/:id/revoke",
      "POST /admin/denied/:channelId/allow",
      "POST /admin/denied/:channelId/dismiss",
    ]);
  });

  it("isQuietPath는 메서드와 상관없이 패턴으로 본다", () => {
    for (const p of ["/auth/callback", "/auth/login/x", "/me/sessions/x/revoke", "/admin/sessions/x/revoke", "/admin/denied/x/allow", "/admin/denied/x/dismiss"]) {
      expect([p, isQuietPath(p)]).toEqual([p, true]);
    }
    for (const p of ["/", "/health", "/auth/done", "/auth/start", "/auth/web/start", "/auth/poll", "/auth/redeem", "/admin", "/admin/allow", "/auth/login", "/auth/callback/x"]) {
      expect([p, isQuietPath(p)]).toEqual([p, false]);
    }
  });
});

describe("앱 로그인: 확인 페이지·콜백의 Worker 호출은 로그 0, 결과는 DO가 남긴다", () => {
  const run = async (setup?: (f: FakeChzzk) => void) => {
    fake.state.account = "b2";
    fake.state.authorize = "approve";
    fake.state.tokenFail = null;
    fake.state.userFail = null;
    setup?.(fake);
    return appFlow({ fake, browser: new Browser(send), app: new AppClient(send) });
  };

  it("승인·거부·취소·치지직 실패", async () => {
    expect((await run()).redeemBody.status).toBe("ok");
    expect((await run((f) => (f.state.account = "c3"))).redeemBody.status).toBe("denied");
    expect((await run((f) => (f.state.authorize = "cancel"))).redeemBody.status).toBe("cancelled");
    expect((await run((f) => (f.state.tokenFail = 401))).redeemBody).toEqual({ status: "failed", code: "token" });
    expect((await run((f) => (f.state.userFail = "timeout"))).redeemBody).toEqual({ status: "failed", code: "timeout" });
    // 같은 콜백 다시 열기(consume 실패: state)
    const again = await run();
    await again.browser.get(again.callbackUrl);

    expect(workerSideOnQuiet()).toEqual([]);
    // Worker 쪽 줄이 있었다면 그것은 quiet가 아닌 경로(/auth/start·/auth/redeem·/auth/done)뿐이다
    expect(recs.filter((r) => !r.inDo).every((r) => !isQuietPath(r.path))).toBe(true);
    const ev = doEvents();
    expect(ev.filter((e) => e.event === "auth.login.ok")).toEqual([
      { event: "auth.login.ok", level: "info", flowKind: "app" },
      { event: "auth.login.ok", level: "info", flowKind: "app" },
    ]);
    expect(ev).toContainEqual({ event: "auth.login.denied", level: "info", flowKind: "app" });
    expect(ev).toContainEqual({ event: "auth.login.cancelled", level: "info", flowKind: "app" });
    expect(ev).toContainEqual(expect.objectContaining({ event: "auth.login.failed", flowKind: "app", reason: "token", stage: "token", status: 401, timedOut: false }));
    expect(ev).toContainEqual(expect.objectContaining({ event: "auth.login.failed", flowKind: "app", reason: "timeout", stage: "user", timedOut: true }));
    expect(ev).toContainEqual({ event: "auth.login.failed", level: "info", reason: "state" });
  });

  it("콜백 실패 분기: state 형식·모르는 state·binder·code 형식·내부 예외", async () => {
    const b = new Browser(send);
    const app = new AppClient(send);
    // state 형식 밖: DO를 부르지 않는다. 사유는 done의 why로 넘긴다
    expect((await b.get("/auth/callback?code=x&state=bad")).headers.get("Location")).toBe("/auth/done?r=failed&why=state_format");
    // 형식은 맞지만 모르는 state
    expect((await b.get(`/auth/callback?code=x&state=${"S".repeat(43)}`)).headers.get("Location")).toBe("/auth/done?r=failed");
    // 다른 브라우저의 콜백(binder)
    {
      const { body } = await app.start();
      const cb = await b.authorize(await b.post(new URL(body.loginUrl).pathname), fake);
      expect((await new Browser(send).get(cb)).headers.get("Location")).toBe("/auth/done?r=failed");
    }
    // code 형식 밖
    {
      const { body } = await app.start();
      const cont = await b.post(new URL(body.loginUrl).pathname);
      const st = new URL(cont.headers.get("Location") ?? "").searchParams.get("state") ?? "";
      expect(parseLoopback((await b.get(`/auth/callback?code=${"Z".repeat(1100)}&state=${st}`)).headers.get("Location") ?? "")).not.toBeNull();
    }
    // 내부 예외: 정리 finish가 internal을 남긴다
    {
      const { AuthStore } = await import("../../src/store/AuthStore");
      vi.spyOn(AuthStore.prototype, "finish").mockImplementationOnce(() => {
        throw new RangeError("boom");
      });
      fake.state.account = "b2";
      const { body } = await app.start();
      const cb = await b.authorize(await b.post(new URL(body.loginUrl).pathname), fake);
      expect(parseLoopback((await b.get(cb)).headers.get("Location") ?? "")).not.toBeNull();
    }

    expect(workerSideOnQuiet()).toEqual([]);
    const failed = doEvents().filter((e) => e.event === "auth.login.failed");
    expect(failed).toEqual([
      { event: "auth.login.failed", level: "info", reason: "state" },
      { event: "auth.login.failed", level: "info", reason: "binder" },
      { event: "auth.login.failed", level: "info", flowKind: "app", reason: "code_format" },
      { event: "auth.login.failed", level: "error", flowKind: "app", reason: "internal", errorName: "RangeError" },
    ]);
  });

  it("DO가 남기지 못한 콜백 실패는 why 낱말로 done에 넘기고 done이 남긴다", async () => {
    const b = new Browser(send);
    const app = new AppClient(send);
    const { AuthStore } = await import("../../src/store/AuthStore");
    // consume 자체가 던진다: 콜백은 로그 0, 303 대상에 why=internal
    vi.spyOn(AuthStore.prototype, "consume").mockImplementationOnce(() => {
      throw new RangeError("do down");
    });
    const failed = await b.get(`/auth/callback?code=x&state=${"S".repeat(43)}`);
    expect(failed.headers.get("Location")).toBe("/auth/done?r=failed&why=internal");
    // consume 뒤 예외 + 정리 finish도 실패: DO 이벤트가 없으니 why=internal
    {
      vi.spyOn(AuthStore.prototype, "finish").mockImplementation(() => {
        throw new RangeError("do down");
      });
      fake.state.account = "b2";
      fake.state.authorize = "approve";
      const { body } = await app.start();
      const cb = await b.authorize(await b.post(new URL(body.loginUrl).pathname), fake);
      expect((await b.get(cb)).headers.get("Location")).toBe("/auth/done?r=failed&why=internal");
      vi.mocked(AuthStore.prototype.finish).mockRestore();
    }
    expect(workerSideOnQuiet()).toEqual([]);
    expect(doEvents().filter((e) => e.event === "auth.login.failed")).toEqual([]);

    recs = [];
    expect((await b.get("/auth/done?r=failed&why=internal")).status).toBe(200);
    expect(workerEvents("/auth/done")).toEqual([{ event: "auth.login.failed", level: "error", reason: "internal" }]);
    recs = [];
    expect((await b.get("/auth/done?r=failed&why=state_format")).status).toBe(200);
    expect(workerEvents("/auth/done")).toEqual([{ event: "auth.login.failed", level: "info", reason: "state_format" }]);
    // 모르는 낱말·실패가 아닌 r·why 없음은 로그 0
    recs = [];
    for (const q of ["r=failed&why=bad_origin", "r=failed&why=constructor", "r=failed&why=", "r=ok&why=internal", "r=failed", "why=internal%0A"]) {
      expect((await b.get(`/auth/done?${q}`)).status).toBe(200);
    }
    expect(recs).toEqual([]);
  });

  it("확인 페이지 GET·POST의 거절(404·409·403)도 로그 0", async () => {
    const b = new Browser(send);
    const { body } = await new AppClient(send).start();
    const path = new URL(body.loginUrl).pathname;
    const unknown = "/auth/login/" + "Q".repeat(22);
    expect((await b.get(unknown)).status).toBe(404);
    expect((await b.post(unknown)).status).toBe(404);
    expect((await b.get("/auth/login/%2E%2E")).status).toBe(404);
    expect((await b.post(path, { Origin: null })).status).toBe(403);
    expect((await b.get(path)).status).toBe(200);
    expect((await b.post(path)).status).toBe(303);
    expect((await b.post(path)).status).toBe(409);
    expect((await b.get(path)).status).toBe(409);
    expect(workerSideOnQuiet()).toEqual([]);
    expect(recs.some((r) => r.path.startsWith("/auth/login/"))).toBe(false);
  });
});

describe("웹: 콜백·내 기기·관리의 id 경로", () => {
  async function web(account: "a1" | "b2" | "c3" | "d4"): Promise<{ b: Browser; csrf: string }> {
    fake.state.account = account;
    fake.state.authorize = "approve";
    const b = new Browser(send);
    const cb = await b.get(await b.authorize(await b.post("/auth/web/start"), fake));
    expect(cb.status).toBe(303);
    const csrf = cb.headers.get("Location") === "/" ? (csrfIn(await (await b.get("/")).text()) ?? "") : "";
    return { b, csrf };
  }
  const sessionOf = async (b: Browser): Promise<string> => {
    const c = await store().webCheck(await sha256Hex(b.jar.get("cdl_s") ?? ""), [A1], Date.now());
    if (!c.ok) throw new Error(`webCheck ${c.code}`);
    return c.sessionId;
  };

  it("성공은 DO가 남기고 거절은 남기지 않는다", async () => {
    const admin = await web("a1");
    const member = await web("b2");
    await web("c3");
    await web("d4");
    const post = (s: { b: Browser; csrf: string }, path: string, csrf = s.csrf) => s.b.post(path, undefined, formBody({ csrf }));

    // 내 기기 끊기: 404·csrf 거절·성공
    expect((await post(member, "/me/sessions/" + "Q".repeat(22) + "/revoke")).status).toBe(404);
    // 같은 채널의 다른 브라우저 세션을 끊는다
    const other = await web("b2");
    const target = await sessionOf(other.b);
    expect((await post(member, `/me/sessions/${target}/revoke`, "B".repeat(43))).status).toBe(403);
    expect((await post(member, `/me/sessions/${target}/revoke`)).status).toBe(303);

    // 관리: 세션 끊기 404·성공, 거부 기록 허용(관리자 채널 409·csrf 거절·성공·404), 지우기(성공·404)
    expect((await post(admin, "/admin/sessions/" + "Q".repeat(22) + "/revoke")).status).toBe(404);
    expect((await post(admin, `/admin/sessions/${await sessionOf(member.b)}/revoke`)).status).toBe(303);
    expect((await post(admin, `/admin/denied/${A1}/allow`)).status).toBe(409);
    expect((await post(admin, `/admin/denied/${C3}/allow`, "B".repeat(43))).status).toBe(403);
    expect((await post(admin, `/admin/denied/${C3}/allow`)).status).toBe(303);
    expect((await post(admin, `/admin/denied/${C3}/allow`)).status).toBe(404);
    expect((await post(admin, `/admin/denied/${D4}/dismiss`)).status).toBe(303);
    expect((await post(admin, `/admin/denied/${D4}/dismiss`)).status).toBe(404);

    expect(workerSideOnQuiet()).toEqual([]);
    const ev = doEvents();
    expect(ev).toContainEqual({ event: "auth.login.ok", level: "info", flowKind: "web" });
    expect(ev).toContainEqual({ event: "auth.login.denied", level: "info", flowKind: "web" });
    for (const [event, route] of [
      ["me.revoke_session", "/me/sessions/:id/revoke"],
      ["admin.revoke_session", "/admin/sessions/:id/revoke"],
      ["admin.denied_allow", "/admin/denied/:channelId/allow"],
      ["admin.denied_dismiss", "/admin/denied/:channelId/dismiss"],
    ] as const) {
      expect(ev.filter((e) => e.event === event)).toEqual([{ event, level: "info", route }]);
    }
  });

  it("대조: quiet가 아닌 웹 경로의 거절은 Worker가 남긴다", async () => {
    const b = new Browser(send);
    expect((await b.post("/auth/web/start", { Origin: "http://evil.example.test" })).status).toBe(403);
    expect(workerEvents("/auth/web/start")).toEqual([{ event: "auth.start.rejected", level: "info", flowKind: "web", reason: "bad_origin" }]);
  });
});

describe("라우터의 로그(config.error·http.internal)도 quiet 경로에서는 남기지 않는다", () => {
  const callbackUrl = `${ORIGIN}/auth/callback?code=cfgcode&state=${"S".repeat(43)}`;

  it("설정 오류·출처 어긋남", async () => {
    const bad = sender({ patch: { ADMIN_CHANNEL_IDS: "not-a-channel-id" } });
    expect((await bad(callbackUrl, { method: "GET" })).status).toBe(500);
    expect((await send(`http://127.0.0.1:8787/auth/callback?code=x&state=${"S".repeat(43)}`, { method: "GET" })).status).toBe(500);
    expect(recs).toEqual([]);
    // 대조: 같은 설정 오류가 /health에서는 남는다
    expect((await bad(ORIGIN + "/health", { method: "GET" })).status).toBe(503);
    expect(workerEvents("/health")).toEqual([{ event: "config.error", level: "error", key: "ADMIN_CHANNEL_IDS" }]);
  });

  it("핸들러 예외(route의 catch)", async () => {
    const boom = sender({ throwOnGet: true });
    expect((await boom(callbackUrl, { method: "GET" })).status).toBe(500);
    expect((await boom(ORIGIN + "/auth/login/" + "Q".repeat(22), { method: "GET" })).status).toBe(500);
    expect(recs).toEqual([]);
    // 대조: quiet가 아닌 경로는 http.internal을 남긴다
    expect((await boom(ORIGIN + "/auth/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grant: "cdg_" + "A".repeat(43), loginSecret: "B".repeat(43) }) })).status).toBe(500);
    expect(workerEvents("/auth/redeem")).toEqual([{ event: "http.internal", level: "error", route: "/auth/redeem", method: "POST", errorName: "RangeError" }]);
  });

  it("라우터 밖 예외(handle의 catch)", async () => {
    // 설정을 읽다 던지는 env
    const throwing = sender({
      envProxy: (e) =>
        new Proxy(e, {
          get(t, p) {
            if (p === "PUBLIC_ORIGIN") throw new TypeError("env boom");
            return Reflect.get(t, p);
          },
        }),
    });
    expect((await throwing(callbackUrl, { method: "GET" })).status).toBe(500);
    expect(recs).toEqual([]);
    expect((await throwing(ORIGIN + "/health", { method: "GET" })).status).toBe(500);
    expect(workerEvents("/health")).toEqual([{ event: "http.internal", level: "error", errorName: "TypeError" }]);
  });
});
