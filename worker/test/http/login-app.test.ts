// 앱 로그인 흐름 전체(docs/design/worker.md §7.1, 구현 중 변경 88·89: 루프백 grant 수령). 가짜 치지직은 전역 fetch 스파이다(구현 중 변경 27 (나)).
// 루프백 Location은 따라가지 않고 해석만 한다(앱 수신기는 L2).
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loopbackState } from "../../src/core/loopback";
import { isToken, newId, newSecret, sha256Hex } from "../../src/core/token";
import { OUTDATED_HANDLE, OUTDATED_LOGIN_ID, OUTDATED_USER_CODE } from "../../src/http/auth";
import { COPY } from "../../src/http/copy";
import { iso } from "../../src/http/respond";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk, type FakeFail } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, B2 } from "../store/helpers";
import { advance, allowedChannel, APP_PORT, AppClient, appFlow, Browser, countingSend, flowRows, HOUR, ORIGIN, parseLoopback, store, useClock, viaEnv } from "./harness";

let fake: FakeChzzk;
let net: FakeNet;
let t0: number;

beforeEach(async () => {
  t0 = useClock();
  fake = createFakeChzzk();
  net = installFakeChzzk(fake);
  await allowedChannel(B2, A1);
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const logs = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] => spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
const handleOf = (loginUrl: string): string => loginUrl.split("/").pop() as string;

describe("승인", () => {
  it("승인: 303 루프백 → redeem 한 번 → 두 번째는 404", async () => {
    const f = await appFlow({ fake });
    expect(Object.keys(f.start).sort()).toEqual(["expiresAt", "loginUrl"]);
    expect(f.start.loginUrl.startsWith(`${ORIGIN}/auth/login/`)).toBe(true);
    expect(f.start.expiresAt).toBe(iso(t0 + 10 * 60_000));
    const loop = f.loop;
    expect(loop).not.toBeNull();
    expect(isToken("grant", loop!.grant)).toBe(true);
    expect(f.callback.headers.get("Location")).toBe(`http://127.0.0.1:49152/chzzk-downloader/login?grant=${loop!.grant}&state=${await loopbackState(f.verifier)}`);
    expect(f.callback.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(f.callback.headers.getSetCookie()).toEqual(["cdl_f=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"]);
    expect(f.browser.jar.has("cdl_f")).toBe(false);
    expect(f.redeem?.status).toBe(200);
    const b = f.redeemBody;
    expect(b.status).toBe("ok");
    expect(b.channelId).toBe(B2);
    expect(b.channelName).toBe("합성허용B2");
    expect(b.isAdmin).toBe(false);
    expect(isToken("access", b.accessToken)).toBe(true);
    expect(isToken("refresh", b.refreshToken)).toBe(true);
    expect(b.serverTime).toBe(iso(Date.now()));
    expect(b.accessExpiresAt).toBe(iso(Date.now() + 24 * HOUR));
    expect(b.refreshExpiresAt).toBe(iso(Date.now() + 30 * 24 * HOUR));
    const again = await f.app.redeem(loop!.grant, f.loginSecret);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ code: "not_found" });
  });

  it.each([1024, 65535])("포트 경계 %i", async (port) => {
    const f = await appFlow({ fake, port });
    expect(f.loop?.port).toBe(port);
  });

  it.each([
    [true, "string"],
    [true, "number"],
    [false, "string"],
    [false, "number"],
  ] as const)("래퍼 %s × expiresIn %s", async (wrapped, expiresInType) => {
    fake.state.wrapped = wrapped;
    fake.state.expiresInType = expiresInType;
    const f = await appFlow({ fake });
    expect(f.redeemBody.status).toBe("ok");
    expect(f.redeemBody.channelId).toBe(B2);
  });

  it("인가 주소와 redirectUri가 바이트까지 맞는다", async () => {
    const app = new AppClient();
    const { body } = await app.start();
    const browser = new Browser();
    const cont = await browser.post(new URL(body.loginUrl).pathname);
    expect(cont.status).toBe(303);
    const loc = cont.headers.get("Location") ?? "";
    expect(loc).toMatch(/^http:\/\/127\.0\.0\.1:8788\/account-interlock\?clientId=dev-client-id&redirectUri=http%3A%2F%2Flocalhost%3A8787%2Fauth%2Fcallback&state=[A-Za-z0-9_-]{43}$/);
    expect(cont.headers.get("Referrer-Policy")).toBe("no-referrer");
    // 가짜는 등록 값과 바이트가 같을 때만 302
    expect((await fake.handle(new Request(loc))).status).toBe(302);
  });
});

describe("취소·거부", () => {
  it("취소: 토큰 교환을 부르지 않는다", async () => {
    fake.state.authorize = "cancel";
    const f = await appFlow({ fake });
    expect(f.loop).not.toBeNull();
    expect(f.redeemBody).toEqual({ status: "cancelled" });
    expect(fake.state.calls.some((c) => c.includes("/auth/v1/token"))).toBe(false);
  });

  it("거부: c3", async () => {
    fake.state.account = "c3";
    const f = await appFlow({ fake });
    expect(f.loop).not.toBeNull();
    expect(f.redeemBody).toEqual({ status: "denied", channelName: FAKE_ACCOUNTS.c3.channelName });
    // 거부된 시도가 기록된다(이름 이스케이프는 웹 거부와 admin-xss가 본다)
    const view = await store().adminView(Date.now());
    expect(view.denied.map((d) => d.channelId)).toContain(FAKE_ACCOUNTS.c3.channelId);
  });
});

describe("치지직 실패", () => {
  const fails: FakeFail[] = [401, 429, 500, "html", "timeout"];
  const statusOf = (f: FakeFail) => (f === "html" ? 200 : f === "timeout" ? 0 : f);

  it.each(fails)("token 실패 %s", async (fail) => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    fake.state.tokenFail = fail;
    const f = await appFlow({ fake });
    expect(f.loop).not.toBeNull();
    expect(f.redeemBody).toEqual({ status: "failed", code: fail === "timeout" ? "timeout" : "token" });
    expect(fake.state.calls.includes("GET /open/v1/users/me")).toBe(false);
    const entry = logs(spy).find((l) => l.event === "auth.login.failed");
    expect(entry).toMatchObject({ reason: fail === "timeout" ? "timeout" : "token", stage: "token", status: statusOf(fail), flowKind: "app" });
    if (fail === "timeout") expect(entry?.timedOut).toBe(true);
  });

  it.each([401, 500, "html", "timeout"] as const)("user 실패 %s", async (fail) => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    fake.state.userFail = fail;
    const f = await appFlow({ fake });
    expect(f.loop).not.toBeNull();
    expect(f.redeemBody).toEqual({ status: "failed", code: fail === "timeout" ? "timeout" : "user" });
    expect(logs(spy).find((l) => l.event === "auth.login.failed")).toMatchObject({ stage: "user", status: statusOf(fail) });
  });

  it("users/me가 id 필드만 주면 user_format", async () => {
    fake.state.userIdField = "id";
    const f = await appFlow({ fake });
    expect(f.loop).not.toBeNull();
    expect(f.redeemBody).toEqual({ status: "failed", code: "user_format" });
  });
});

describe("재사용·결합", () => {
  // 흐름 1의 code를 흐름 2의 콜백(흐름 2의 state)에 싣는다. 가짜가 code를 state에 묶지 않게 해서(codeBinding none)
  // 결과를 가르는 것이 가짜의 재사용 거부뿐이게 한다: allow면 ok, reject면 failed(token)인 대조 쌍(구현 중 변경 28)
  it.each([
    ["reject", { status: "failed", code: "token" }],
    ["allow", { status: "ok" }],
  ] as const)("쓴 code를 다른 흐름에 다시 쓴다: codeReuse %s", async (codeReuse, want) => {
    fake.state.codeBinding = "none";
    fake.state.codeReuse = codeReuse;
    const first = await appFlow({ fake });
    expect(first.redeemBody.status).toBe("ok");
    const usedCode = fake.state.issuedCodes[0] ?? "";
    const app = new AppClient();
    const browser = new Browser();
    const s = await app.start();
    const cont = await browser.post(new URL(s.body.loginUrl).pathname);
    const state = new URL(cont.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    const callback = await browser.get(`/auth/callback?code=${encodeURIComponent(usedCode)}&state=${state}`);
    const loop = parseLoopback(callback.headers.get("Location") ?? "");
    expect(loop).not.toBeNull();
    // 두 번째 교환이 실제로 일어났다(code 형식 거부 경로가 아니다)
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(2);
    expect(fake.state.issuedCodes).toHaveLength(1);
    expect(await (await app.redeem(loop!.grant, s.loginSecret)).json()).toMatchObject(want);
  });

  it("쓴 code를 다른 흐름에 다시 쓴다: 기본 가짜(state에 묶임)도 failed(token)", async () => {
    const first = await appFlow({ fake });
    expect(first.redeemBody.status).toBe("ok");
    const usedCode = fake.state.issuedCodes[0] ?? "";
    const app = new AppClient();
    const browser = new Browser();
    const s = await app.start();
    const cont = await browser.post(new URL(s.body.loginUrl).pathname);
    const state = new URL(cont.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    const callback = await browser.get(`/auth/callback?code=${encodeURIComponent(usedCode)}&state=${state}`);
    const loop = parseLoopback(callback.headers.get("Location") ?? "");
    expect(loop).not.toBeNull();
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(2);
    expect(await (await app.redeem(loop!.grant, s.loginSecret)).json()).toEqual({ status: "failed", code: "token" });
  });

  it("다른 브라우저의 콜백은 failed(binder)이고 grant가 없다", async () => {
    const app = new AppClient();
    const a = new Browser();
    const { body } = await app.start();
    const cont = await a.post(new URL(body.loginUrl).pathname);
    const callbackUrl = await a.authorize(cont, fake);
    const b = new Browser();
    const res = await b.get(callbackUrl);
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(await flowRows(handleOf(body.loginUrl))).toEqual([{ status: "failed", fail_code: "binder", port: APP_PORT, grant_hash: null, grant_exp: null }]);
    // A가 같은 URL을 열어도 state는 이미 소비됐다
    const again = await a.get(callbackUrl);
    expect(again.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(fake.state.calls.some((c) => c.includes("/auth/v1/token"))).toBe(false);
  });

  it("자기 F 쿠키를 가진 다른 브라우저가 남의 콜백을 열면 failed(binder), 자기 흐름은 그대로 끝난다", async () => {
    // A4(로그인 CSRF)의 실제 모양: 피해자 B는 자기 흐름의 유효한 F를 가진 채 공격자 A의 콜백 URL을 연다
    const appA = new AppClient();
    const a = new Browser();
    const sa = await appA.start();
    const callbackA = await a.authorize(await a.post(new URL(sa.body.loginUrl).pathname), fake);
    const appB = new AppClient();
    const b = new Browser();
    const sb = await appB.start();
    const contB = await b.post(new URL(sb.body.loginUrl).pathname);
    expect(b.jar.has("cdl_f")).toBe(true);
    const callbackB = await b.authorize(contB, fake);
    const res = await b.get(callbackA);
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(await flowRows(handleOf(sa.body.loginUrl))).toMatchObject([{ status: "failed", fail_code: "binder", grant_hash: null }]);
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(0);
    // B의 F는 그대로라 자기 콜백을 마친다(done을 거치지 않는다: done은 F를 지운다)
    expect(b.jar.has("cdl_f")).toBe(true);
    const own = await b.get(callbackB);
    const loop = parseLoopback(own.headers.get("Location") ?? "");
    expect(loop).not.toBeNull();
    expect(await (await appB.redeem(loop!.grant, sb.loginSecret)).json()).toMatchObject({ status: "ok", channelId: FAKE_ACCOUNTS.b2.channelId });
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(1);
  });

  it("콜백 처리 중 예외: 정리 finish가 흐름을 닫고 루프백으로 보낸다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    // DO 메서드가 던지면 workerd가 "uncaught exception … RangeError: boom"을 stderr에 찍는다(이 테스트의 예상 출력)
    const { AuthStore } = await import("../../src/store/AuthStore");
    const finish = vi.spyOn(AuthStore.prototype, "finish").mockImplementationOnce(() => {
      throw new RangeError("boom");
    });
    const app = new AppClient();
    const browser = new Browser();
    const s = await app.start();
    const callbackUrl = await browser.authorize(await browser.post(new URL(s.body.loginUrl).pathname), fake);
    const res = await browser.get(callbackUrl);
    const loop = parseLoopback(res.headers.get("Location") ?? "");
    expect(loop).not.toBeNull();
    expect(finish).toHaveBeenCalledTimes(2);
    expect(await (await app.redeem(loop!.grant, s.loginSecret)).json()).toEqual({ status: "failed", code: "user" });
    // 이벤트는 정리 finish가 DO에서 남긴다(콜백은 quiet 경로, 구현 중 변경 43)
    expect(logs(spy)).toContainEqual({ event: "auth.login.failed", level: "error", flowKind: "app", reason: "internal", errorName: "RangeError" });
  });

  it("정리 finish도 실패하면 done?why=internal", async () => {
    const { AuthStore } = await import("../../src/store/AuthStore");
    const finish = vi.spyOn(AuthStore.prototype, "finish").mockImplementation(() => {
      throw new RangeError("boom");
    });
    const app = new AppClient();
    const browser = new Browser();
    const s = await app.start();
    const callbackUrl = await browser.authorize(await browser.post(new URL(s.body.loginUrl).pathname), fake);
    const res = await browser.get(callbackUrl);
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed&why=internal");
    finish.mockRestore();
  });

  it("같은 콜백을 다시 열면 failed, 토큰 교환은 한 번뿐", async () => {
    const f = await appFlow({ fake });
    const again = await f.browser.get(f.callbackUrl);
    expect(again.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(1);
  });

  it("state 모양이 틀리면 DO를 부르지 않고 failed", async () => {
    const res = await new Browser().get("/auth/callback?code=x&state=short");
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed&why=state_format");
    expect(fake.state.calls).toEqual([]);
  });

  it("code 모양이 틀리면 교환하지 않고 루프백으로 failed", async () => {
    const app = new AppClient();
    const browser = new Browser();
    const s = await app.start();
    const cont = await browser.post(new URL(s.body.loginUrl).pathname);
    const state = new URL(cont.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    const res = await browser.get(`/auth/callback?code=${encodeURIComponent("a b")}&state=${state}`);
    const loop = parseLoopback(res.headers.get("Location") ?? "");
    expect(loop).not.toBeNull();
    expect(fake.state.calls).toEqual([]);
    expect(await (await app.redeem(loop!.grant, s.loginSecret)).json()).toEqual({ status: "failed", code: "token" });
  });

  it("배포 전 옛 흐름(port NULL)", async () => {
    const nullPort = (handle: string) =>
      runInDurableObject(store(), async (i) => i.db.run("UPDATE flow SET port = NULL WHERE handle_hash = ?", await sha256Hex(handle)));
    // (ㄱ) start 뒤: 확인 페이지·[계속]이 404
    const app = new AppClient();
    const browser = new Browser();
    const sessionsBefore = (await store().adminView(Date.now())).sessions.length;
    const s1 = await app.start();
    const path1 = new URL(s1.body.loginUrl).pathname;
    await nullPort(handleOf(s1.body.loginUrl));
    expect((await browser.get(path1)).status).toBe(404);
    expect((await browser.post(path1)).status).toBe(404);
    // (ㄴ) [계속]·authorize 뒤: 콜백이 done failed, 행 failed/user, grant 없음, 세션 0
    const s2 = await app.start();
    const path2 = new URL(s2.body.loginUrl).pathname;
    const cont = await browser.post(path2);
    const callbackUrl = await browser.authorize(cont, fake);
    await nullPort(handleOf(s2.body.loginUrl));
    const res = await browser.get(callbackUrl);
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(await flowRows(handleOf(s2.body.loginUrl))).toEqual([{ status: "failed", fail_code: "user", port: null, grant_hash: null, grant_exp: null }]);
    expect((await store().adminView(Date.now())).sessions).toHaveLength(sessionsBefore);
  });
});

describe("redeem", () => {
  it("verifier가 다르면 404이고 grant를 태우지 않는다", async () => {
    const f = await appFlow({ fake, redeem: false });
    expect((await f.app.redeem(f.loop!.grant, newSecret())).status).toBe(404);
    const ok = await f.app.redeem(f.loop!.grant, f.loginSecret);
    expect(ok.status).toBe(200);
    expect((await ok.json<{ status: string }>()).status).toBe("ok");
  });

  it("다른 흐름의 grant는 받지 못한다(A3·login-CSRF)", async () => {
    const a = await appFlow({ fake, redeem: false });
    const b = await appFlow({ fake, redeem: false });
    expect((await a.app.redeem(a.loop!.grant, b.loginSecret)).status).toBe(404);
    expect((await a.app.redeem(a.loop!.grant, a.loginSecret)).status).toBe(200);
  });

  it("grant는 2분: 119_999ms는 되고 120_000ms는 404", async () => {
    const x = await appFlow({ fake, redeem: false });
    advance(119_999);
    expect((await x.app.redeem(x.loop!.grant, x.loginSecret)).status).toBe(200);
    const y = await appFlow({ fake, redeem: false });
    advance(120_000);
    expect((await y.app.redeem(y.loop!.grant, y.loginSecret)).status).toBe(404);
  });

  it("입력이 형식 밖이면 DO를 부르지 않고 400", async () => {
    const { send, calls } = countingSend();
    const app = new AppClient(send);
    const g = `cdg_${"A".repeat(43)}`;
    const secret = "B".repeat(43);
    const cases: [string, string, string?][] = [
      ["깨진 JSON", "{"],
      ["text/plain", JSON.stringify({ grant: g, loginSecret: secret }), "text/plain"],
      ["배열", "[]"],
      ["null", "null"],
      ["빈 객체", "{}"],
      ["grant 접두 다름", JSON.stringify({ grant: `cda_${"A".repeat(43)}`, loginSecret: secret })],
      ["grant 42자", JSON.stringify({ grant: `cdg_${"A".repeat(42)}`, loginSecret: secret })],
      ["loginSecret 42자", JSON.stringify({ grant: g, loginSecret: "B".repeat(42) })],
    ];
    for (const [name, body, type] of cases) {
      const res = await app.raw("/auth/redeem", body, type);
      expect([name, res.status, await res.json()]).toEqual([name, 400, { code: "bad_request" }]);
    }
    expect(calls).toEqual([]);
  });
});

describe("확인 페이지", () => {
  it("GET: 헤더·폼·문구, handle과 확인 코드는 없다", async () => {
    const app = new AppClient();
    const { body } = await app.start();
    const res = await new Browser().get(new URL(body.loginUrl).pathname);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' http://127.0.0.1:8788 http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const text = await res.text();
    expect(text).not.toContain(handleOf(body.loginUrl));
    expect(text).toContain('<form method="post">');
    expect(text).toContain("<h1>치지직 다운로더 로그인</h1>");
    expect(text).toContain("치지직 다운로더 앱에서 직접 시작한 로그인이 아니면 이 창을 닫으세요.");
    expect(text).toContain("다른 사람이 보낸 링크라면 계속하지 마세요.");
    expect(text).toContain("로그인 뒤 주소창에 나오는 주소는 다른 사람에게 보내지 마세요.");
    expect(text).not.toContain("확인 코드");
    expect(text).not.toContain('class="code"');
  });

  it("다른 HTML 페이지의 CSP에는 루프백 출처가 없다", async () => {
    const res = await new Browser().get("/auth/login/abc");
    expect(res.status).toBe(404);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toBe("default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' http://127.0.0.1:8788; frame-ancestors 'none'; base-uri 'none'");
    expect(csp).not.toContain("127.0.0.1:*");
  });

  it.each([
    ["Origin 없음", { Origin: null }],
    ["Origin null", { Origin: "null" }],
    ["다른 Origin", { Origin: "http://evil.example.test" }],
    ["Sec-Fetch-Site cross-site", { "Sec-Fetch-Site": "cross-site" }],
  ] as const)("[계속] CSRF: %s → 403", async (_n, headers) => {
    const app = new AppClient();
    const { body } = await app.start();
    const browser = new Browser();
    const res = await browser.post(new URL(body.loginUrl).pathname, headers);
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.has("Location")).toBe(false);
    // 막혔으니 흐름은 그대로 started다: 맞는 요청은 된다
    expect((await browser.post(new URL(body.loginUrl).pathname)).status).toBe(303);
  });

  it("[계속] 성공: flow 쿠키(10분, HttpOnly, Lax)", async () => {
    const app = new AppClient();
    const { body } = await app.start();
    const res = await new Browser().post(new URL(body.loginUrl).pathname);
    expect(res.status).toBe(303);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(/^cdl_f=cdf_[A-Za-z0-9_-]{43}; Max-Age=600; Path=\/; HttpOnly; SameSite=Lax$/);
  });

  it("404·409", async () => {
    const browser = new Browser();
    const bad = await browser.get("/auth/login/abc");
    expect(bad.status).toBe(404);
    expect(bad.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect((await browser.get("/auth/login/" + "A".repeat(22))).status).toBe(404);
    expect((await browser.post("/auth/login/" + "A".repeat(22))).status).toBe(404);

    const app = new AppClient();
    const { body } = await app.start();
    const path = new URL(body.loginUrl).pathname;
    expect((await browser.post(path)).status).toBe(303);
    expect((await browser.post(path)).status).toBe(409);
    expect((await browser.get(path)).status).toBe(409);
    advance(10 * 60_000);
    expect((await browser.get(path)).status).toBe(404);
  });
});

describe("start 입력", () => {
  const verifier = "A".repeat(43);

  it("start 400이고 DO를 부르지 않는다", async () => {
    const { send, calls } = countingSend();
    const app = new AppClient(send);
    const ok = { port: 49152, loginVerifier: verifier, client: "c" };
    const j = (o: Record<string, unknown>) => JSON.stringify(o);
    const cases: [string, string, string?][] = [
      ["깨진 JSON", "{"],
      ["text/plain", j(ok), "text/plain"],
      ["배열", "[]"],
      ["null", "null"],
      ["문자열", '"x"'],
      ["port 문자열", j({ ...ok, port: "8080" })],
      ["port 소수", j({ ...ok, port: 80.5 })],
      ["port 1023", j({ ...ok, port: 1023 })],
      ["port 65536", j({ ...ok, port: 65536 })],
      ["port 음수", j({ ...ok, port: -1 })],
      ["port null", j({ ...ok, port: null })],
      ["loginVerifier 42자", j({ ...ok, loginVerifier: "A".repeat(42) })],
      ["loginVerifier 없음", j({ port: 49152, client: "c" })],
      ["client 없음", j({ port: 49152, loginVerifier: verifier })],
      ["client 129자", j({ ...ok, client: "c".repeat(129) })],
      ["client에 제어 문자", j({ ...ok, client: "a\tb" })],
    ];
    for (const [name, body, type] of cases) {
      const res = await app.raw("/auth/start", body, type);
      expect([name, res.status, await res.json()]).toEqual([name, 400, { code: "bad_request" }]);
    }
    expect(calls).toEqual([]);
  });

  it("start 경계 포트는 201이고 키는 둘뿐", async () => {
    const app = new AppClient();
    for (const port of [1024, 65535]) {
      const r = await app.start(undefined, port);
      expect(r.res.status).toBe(201);
      expect(Object.keys(r.body).sort()).toEqual(["expiresAt", "loginUrl"]);
    }
  });

  it("start 429: IP당 한도 + Retry-After", async () => {
    const send = viaEnv({ START_RATE_10M: "2" });
    const app = new AppClient(send);
    expect((await app.start("203.0.113.9")).res.status).toBe(201);
    expect((await app.start("203.0.113.9")).res.status).toBe(201);
    const third = await app.start("203.0.113.9");
    expect(third.res.status).toBe(429);
    expect(third.body).toEqual({ code: "rate_limited" });
    expect(third.res.headers.get("Retry-After")).toBe("600");
    // 다른 IP는 따로 센다
    expect((await app.start("203.0.113.10")).res.status).toBe(201);
  });

  it("start 503: 살아 있는 흐름이 32개면 busy", async () => {
    const app = new AppClient();
    for (let i = 0; i < 32; i++) expect((await app.start()).res.status).toBe(201);
    const r = await app.start();
    expect(r.res.status).toBe(503);
    expect(r.body).toEqual({ code: "busy" });
  });
});

describe("옛 앱(v0.1.1) 대응", () => {
  const oldBody = () => JSON.stringify({ pollVerifier: newSecret(), client: "app/0.1.1 macos" });

  it("포트 없는 start는 DO 없이 201 미끼", async () => {
    const { send, calls } = countingSend();
    const app = new AppClient(send);
    for (const body of [oldBody(), "{}"]) {
      const res = await app.raw("/auth/start", body);
      expect(res.status).toBe(201);
      expect(res.headers.get("Content-Type")).toMatch(/^application\/json/);
      const b = await res.json<Record<string, unknown>>();
      expect(Object.keys(b).sort()).toEqual(["expiresAt", "loginId", "loginUrl", "pollIntervalMs", "userCode"]);
      expect(b.loginId).toBe(OUTDATED_LOGIN_ID);
      expect(String(b.loginId)).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(b.loginUrl).toBe(`${ORIGIN}/auth/login/${OUTDATED_HANDLE}`);
      expect(OUTDATED_HANDLE).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(b.userCode).toBe(OUTDATED_USER_CODE);
      expect(String(b.userCode)).toMatch(/^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      expect(b.expiresAt).toBe(iso(Date.now() + 600_000));
      expect(Number.isFinite(Date.parse(String(b.expiresAt)))).toBe(true);
      expect(b.pollIntervalMs).toBe(30_000);
      expect(Number.isInteger(b.pollIntervalMs)).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it("미끼는 스로틀하지 않는다", async () => {
    const { send, calls } = countingSend({ START_RATE_10M: "1" });
    const app = new AppClient(send);
    for (let i = 0; i < 3; i++) expect((await app.raw("/auth/start", oldBody(), "application/json", "203.0.113.50")).status).toBe(201);
    expect(calls).toEqual([]);
  });

  it("예약 handle의 확인 페이지는 업데이트 안내이고 DO를 부르지 않는다", async () => {
    const { send, calls } = countingSend();
    const browser = new Browser(send);
    const path = `/auth/login/${OUTDATED_HANDLE}`;
    const get = await browser.get(path);
    expect(get.status).toBe(200);
    expect(get.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    const text = await get.text();
    expect(text).toContain(COPY.outdatedApp);
    expect(text).toContain('href="/"');
    expect(text).not.toContain("<script");
    expect(get.headers.get("Content-Security-Policy")).not.toContain("127.0.0.1:*");
    for (const headers of [undefined, { Origin: "null" }] as const) {
      const post = await browser.post(path, headers);
      expect(post.status).toBe(200);
      expect(await post.text()).toContain(COPY.outdatedApp);
    }
    expect(calls).toEqual([]);
  });

  it("/auth/poll 비석: 무엇이든 404 app_outdated, DO 0회", async () => {
    const { send, calls } = countingSend();
    const app = new AppClient(send);
    for (const [body, type] of [
      [JSON.stringify({ loginId: newId(), pollSecret: newSecret() }), "application/json"],
      ["{", "application/json"],
      ["", "text/plain"],
    ] as const) {
      const res = await app.raw("/auth/poll", body, type);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ code: "app_outdated" });
    }
    expect(calls).toEqual([]);
  });

  it("미끼·비석 로그", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = new AppClient();
    await app.raw("/auth/start", oldBody());
    await app.raw("/auth/poll", "{}");
    expect(logs(spy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "auth.start.outdated", level: "info", flowKind: "app" }),
        expect.objectContaining({ event: "auth.poll.rejected", level: "info", reason: "app_outdated" }),
      ]),
    );
  });
});
