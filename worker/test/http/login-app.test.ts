// 앱 로그인 흐름 전체(docs/design/worker.md §7.1, W4 수락 기준). 가짜 치지직은 전역 fetch 스파이다(구현 중 변경 27 (나)).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isToken } from "../../src/core/token";
import { isUserCode } from "../../src/core/usercode";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk, type FakeFail } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, B2 } from "../store/helpers";
import { advance, allowedChannel, AppClient, appFlow, Browser, codeIn, HOUR, ORIGIN, store, useClock, viaEnv, viaExports } from "./harness";
import { iso } from "../../src/http/respond";

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

describe("승인", () => {
  it("승인: b2 허용, 토큰 묶음, 확인 코드 = 앱 코드", async () => {
    const f = await appFlow({ fake });
    expect(f.callback.headers.get("Location")).toBe("/auth/done?r=ok");
    expect(f.callback.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(f.poll.status).toBe(200);
    const b = f.pollBody;
    expect(b.status).toBe("ok");
    expect(b.channelId).toBe(B2);
    expect(b.channelName).toBe("합성허용B2");
    expect(b.isAdmin).toBe(false);
    expect(isToken("access", b.accessToken)).toBe(true);
    expect(isToken("refresh", b.refreshToken)).toBe(true);
    // poll은 흐름 시작 2초 뒤라 serverTime이 그 시각이다
    expect(b.serverTime).toBe(iso(Date.now()));
    expect(b.accessExpiresAt).toBe(iso(Date.now() + 24 * HOUR));
    expect(b.refreshExpiresAt).toBe(iso(Date.now() + 30 * 24 * HOUR));
    // 확인 코드
    expect(isUserCode(f.start.userCode)).toBe(true);
    expect(codeIn(f.loginHtml)).toBe(f.start.userCode);
    expect(codeIn(f.doneHtml)).toBe(f.start.userCode);
    expect(f.doneHtml).toContain("로그인했어요. 앱으로 돌아가세요.");
    expect(f.start.loginUrl.startsWith(`${ORIGIN}/auth/login/`)).toBe(true);
    expect(f.start.pollIntervalMs).toBe(2000);
    expect(f.start.expiresAt).toBe(iso(t0 + 10 * 60_000));
  });

  it("poll ok 뒤에도 done이 코드를 보인다(구현 중 변경 23·27 (가))", async () => {
    const f = await appFlow({ fake, pollFirst: true });
    expect(f.pollBody.status).toBe("ok");
    expect(codeIn(f.doneHtml)).toBe(f.start.userCode);
    expect(f.done.headers.getSetCookie().some((c) => /^cdl_f=; Max-Age=0/.test(c))).toBe(true);
    // 다시 열면 코드 없이 일반 문구
    const again = await f.browser.get(f.callback.headers.get("Location") ?? "");
    const text = await again.text();
    expect(codeIn(text)).toBeNull();
    expect(text).toContain("로그인했어요.");
    // 같은 poll을 한 번 더 → 이미 수령
    const app = new AppClient();
    const second = await app.poll(f.start.loginId, f.pollSecret);
    expect(second.status).toBe(404);
    expect(await second.json()).toEqual({ code: "not_found" });
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
    expect(f.pollBody.status).toBe("ok");
    expect(f.pollBody.channelId).toBe(B2);
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
    expect(f.callback.headers.get("Location")).toBe("/auth/done?r=cancelled");
    expect(f.pollBody).toEqual({ status: "cancelled" });
    expect(fake.state.calls.some((c) => c.includes("/auth/v1/token"))).toBe(false);
    expect(f.doneHtml).toContain("로그인을 취소했어요.");
  });

  it("거부: c3, 이름은 이스케이프된다", async () => {
    fake.state.account = "c3";
    const f = await appFlow({ fake });
    expect(f.callback.headers.get("Location")).toBe("/auth/done?r=denied");
    expect(f.doneHtml).toContain(`채널 ID ${FAKE_ACCOUNTS.c3.channelId}`);
    expect(f.doneHtml).toContain("&lt;script&gt;");
    expect(f.doneHtml).not.toContain("<script");
    expect(f.pollBody).toEqual({ status: "denied", channelName: FAKE_ACCOUNTS.c3.channelName });
    // 거부된 시도가 기록된다
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
    expect(f.callback.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(f.pollBody).toEqual({ status: "failed", code: fail === "timeout" ? "timeout" : "token" });
    expect(fake.state.calls.includes("GET /open/v1/users/me")).toBe(false);
    const entry = logs(spy).find((l) => l.event === "auth.login.failed");
    expect(entry).toMatchObject({ reason: fail === "timeout" ? "timeout" : "token", stage: "token", status: statusOf(fail), flowKind: "app" });
    if (fail === "timeout") expect(entry?.timedOut).toBe(true);
    expect(f.doneHtml).toContain("로그인하지 못했어요.");
  });

  it.each([401, 500, "html", "timeout"] as const)("user 실패 %s", async (fail) => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    fake.state.userFail = fail;
    const f = await appFlow({ fake });
    expect(f.pollBody).toEqual({ status: "failed", code: fail === "timeout" ? "timeout" : "user" });
    expect(logs(spy).find((l) => l.event === "auth.login.failed")).toMatchObject({ stage: "user", status: statusOf(fail) });
  });

  it("users/me가 id 필드만 주면 user_format", async () => {
    fake.state.userIdField = "id";
    const f = await appFlow({ fake });
    expect(f.pollBody).toEqual({ status: "failed", code: "user_format" });
  });
});

describe("재사용·결합", () => {
  // 흐름 1의 code를 흐름 2의 콜백(흐름 2의 state)에 싣는다. 가짜가 code를 state에 묶지 않게 해서(codeBinding none)
  // 결과를 가르는 것이 가짜의 재사용 거부뿐이게 한다: allow면 ok, reject면 failed(token)인 대조 쌍(구현 중 변경 28)
  it.each([
    ["reject", { status: "failed", code: "token" }, "/auth/done?r=failed"],
    ["allow", { status: "ok" }, "/auth/done?r=ok"],
  ] as const)("쓴 code를 다른 흐름에 다시 쓴다: codeReuse %s", async (codeReuse, want, location) => {
    fake.state.codeBinding = "none";
    fake.state.codeReuse = codeReuse;
    const first = await appFlow({ fake });
    expect(first.pollBody.status).toBe("ok");
    const usedCode = fake.state.issuedCodes[0] ?? "";
    const app = new AppClient();
    const browser = new Browser();
    const { body, pollSecret } = await app.start();
    const cont = await browser.post(new URL(body.loginUrl).pathname);
    const state = new URL(cont.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    const callback = await browser.get(`/auth/callback?code=${encodeURIComponent(usedCode)}&state=${state}`);
    expect(callback.headers.get("Location")).toBe(location);
    // 두 번째 교환이 실제로 일어났다(code 형식 거부 경로가 아니다)
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(2);
    expect(fake.state.issuedCodes).toHaveLength(1);
    expect(await (await app.poll(body.loginId, pollSecret)).json()).toMatchObject(want);
  });

  it("쓴 code를 다른 흐름에 다시 쓴다: 기본 가짜(state에 묶임)도 failed(token)", async () => {
    const first = await appFlow({ fake });
    expect(first.pollBody.status).toBe("ok");
    const usedCode = fake.state.issuedCodes[0] ?? "";
    const app = new AppClient();
    const browser = new Browser();
    const { body, pollSecret } = await app.start();
    const cont = await browser.post(new URL(body.loginUrl).pathname);
    const state = new URL(cont.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    const callback = await browser.get(`/auth/callback?code=${encodeURIComponent(usedCode)}&state=${state}`);
    expect(callback.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(2);
    expect(await (await app.poll(body.loginId, pollSecret)).json()).toEqual({ status: "failed", code: "token" });
  });

  it("다른 브라우저의 콜백은 failed(binder)", async () => {
    const app = new AppClient();
    const a = new Browser();
    const { body, pollSecret } = await app.start();
    const cont = await a.post(new URL(body.loginUrl).pathname);
    const callbackUrl = await a.authorize(cont, fake);
    const b = new Browser();
    const res = await b.get(callbackUrl);
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(await (await app.poll(body.loginId, pollSecret)).json()).toEqual({ status: "failed", code: "binder" });
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
    expect(await (await appA.poll(sa.body.loginId, sa.pollSecret)).json()).toEqual({ status: "failed", code: "binder" });
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(0);
    // B의 F는 그대로라 자기 콜백을 마친다(done을 거치지 않는다: done은 F를 지운다)
    expect(b.jar.has("cdl_f")).toBe(true);
    const own = await b.get(callbackB);
    expect(own.headers.get("Location")).toBe("/auth/done?r=ok");
    expect(await (await appB.poll(sb.body.loginId, sb.pollSecret)).json()).toMatchObject({ status: "ok", channelId: FAKE_ACCOUNTS.b2.channelId });
  });

  it("콜백 처리 중 예외: 303 failed이고 흐름도 failed로 닫혀 앱이 pending에 머물지 않는다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    // DO 메서드가 던지면 workerd가 "uncaught exception … RangeError: boom"을 stderr에 찍는다(이 테스트의 예상 출력)
    const { AuthStore } = await import("../../src/store/AuthStore");
    const finish = vi.spyOn(AuthStore.prototype, "finish").mockImplementationOnce(() => {
      throw new RangeError("boom");
    });
    const app = new AppClient();
    const browser = new Browser();
    const { body, pollSecret } = await app.start();
    const callbackUrl = await browser.authorize(await browser.post(new URL(body.loginUrl).pathname), fake);
    const res = await browser.get(callbackUrl);
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(finish).toHaveBeenCalledTimes(2);
    expect(await (await app.poll(body.loginId, pollSecret)).json()).toEqual({ status: "failed", code: "user" });
    // 이벤트는 정리 finish가 DO에서 남긴다(콜백은 quiet 경로, 구현 중 변경 43)
    expect(logs(spy)).toContainEqual({ event: "auth.login.failed", level: "error", flowKind: "app", reason: "internal", errorName: "RangeError" });
  });

  it("같은 콜백을 다시 열면 failed, 토큰 교환은 한 번뿐", async () => {
    const f = await appFlow({ fake });
    const again = await f.browser.get(f.callbackUrl);
    expect(again.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(fake.state.calls.filter((c) => c === "POST /auth/v1/token")).toHaveLength(1);
  });

  it("state 모양이 틀리면 DO를 부르지 않고 failed", async () => {
    const res = await new Browser().get("/auth/callback?code=x&state=short");
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(fake.state.calls).toEqual([]);
  });

  it("code 모양이 틀리면 교환하지 않고 failed", async () => {
    const app = new AppClient();
    const browser = new Browser();
    const { body, pollSecret } = await app.start();
    const cont = await browser.post(new URL(body.loginUrl).pathname);
    const state = new URL(cont.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    const res = await browser.get(`/auth/callback?code=${encodeURIComponent("a b")}&state=${state}`);
    expect(res.headers.get("Location")).toBe("/auth/done?r=failed");
    expect(fake.state.calls).toEqual([]);
    expect(await (await app.poll(body.loginId, pollSecret)).json()).toEqual({ status: "failed", code: "token" });
  });
});

describe("확인 페이지", () => {
  it("GET: 헤더·코드·폼, handle은 본문에 없다", async () => {
    const app = new AppClient();
    const { body } = await app.start();
    const res = await new Browser().get(new URL(body.loginUrl).pathname);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' http://127.0.0.1:8788; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(res.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const text = await res.text();
    const handle = body.loginUrl.split("/").pop() as string;
    expect(text).not.toContain(handle);
    expect(text).toContain('<form method="post">');
    expect(codeIn(text)).toBe(body.userCode);
    expect(text).toContain("치지직 다운로더 앱에서 직접 시작한 로그인이 아니면 이 창을 닫으세요.");
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

describe("start·poll 입력", () => {
  const post = (path: string, body: string, type = "application/json") => viaExports(ORIGIN + path, { method: "POST", headers: { "Content-Type": type }, body });
  const verifier = "A".repeat(43);

  it("start 400", async () => {
    const cases: [string, string, string?][] = [
      ["깨진 JSON", "{"],
      ["text/plain", JSON.stringify({ pollVerifier: verifier, client: "c" }), "text/plain"],
      ["pollVerifier 42자", JSON.stringify({ pollVerifier: "A".repeat(42), client: "c" })],
      ["client 없음", JSON.stringify({ pollVerifier: verifier })],
      ["client 129자", JSON.stringify({ pollVerifier: verifier, client: "c".repeat(129) })],
      ["client에 제어 문자", JSON.stringify({ pollVerifier: verifier, client: "a\tb" })],
      ["배열", "[]"],
    ];
    for (const [name, body, type] of cases) {
      const res = await post("/auth/start", body, type);
      expect([name, res.status, await res.json()]).toEqual([name, 400, { code: "bad_request" }]);
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

  it("poll 400·404·429", async () => {
    const app = new AppClient();
    const { body, pollSecret } = await app.start();
    expect((await post("/auth/poll", "{")).status).toBe(400);
    expect((await post("/auth/poll", JSON.stringify({ loginId: body.loginId }))).status).toBe(400);
    expect((await post("/auth/poll", JSON.stringify({ loginId: "x", pollSecret }))).status).toBe(400);
    // 틀린 pollSecret은 404(모름·불일치를 구분하지 않는다)
    expect((await app.poll(body.loginId, "B".repeat(43))).status).toBe(404);
    // 틀린 secret의 폴링은 다른 게이트 키라 바로 뒤의 올바른 폴링을 막지 못한다(구현 중 변경 28)
    expect(await (await app.pollNow(body.loginId, pollSecret)).json()).toEqual({ status: "pending" });
    // loginId만 아는 쪽이 1.5초보다 촘촘히 폴링해도(매번 다른 틀린 secret) 앱의 2초 간격 폴링은 매번 통과한다
    for (let i = 0; i < 4; i++) {
      advance(1000);
      expect((await app.pollNow(body.loginId, String.fromCharCode(65 + i).repeat(43))).status).toBe(404);
      advance(1000);
      expect(await (await app.pollNow(body.loginId, pollSecret)).json()).toEqual({ status: "pending" });
    }
    // 간격 안의 두 번째 폴링은 429(쓰기 없음)
    const early = await app.pollNow(body.loginId, pollSecret);
    expect(early.status).toBe(429);
    expect(await early.json()).toEqual({ code: "too_soon" });
    // 간격을 두면 다시 된다
    expect(await (await app.poll(body.loginId, pollSecret)).json()).toEqual({ status: "pending" });
    advance(10 * 60_000 + 1);
    expect((await app.poll(body.loginId, pollSecret)).status).toBe(404);
  });
});
