// 웹 로그인 흐름(docs/design/worker.md §7.2, W4 수락 기준)과 운영 모드 쿠키.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/core/token";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1 } from "../store/helpers";
import { AppClient, appFlow, Browser, parseLoopback, store, useClock, viaEnv } from "./harness";

let fake: FakeChzzk;
let net: FakeNet;

beforeEach(() => {
  useClock();
  fake = createFakeChzzk();
  net = installFakeChzzk(fake);
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function webStart(browser: Browser) {
  const start = await browser.post("/auth/web/start");
  expect(start.status).toBe(303);
  const callbackUrl = await browser.authorize(start, fake);
  return { start, callbackUrl };
}

describe("웹 승인·거부", () => {
  it("a1 웹 로그인: 세션 쿠키를 심고 F를 지운다", async () => {
    fake.state.account = "a1";
    const browser = new Browser();
    const { start, callbackUrl } = await webStart(browser);
    expect(start.headers.get("Referrer-Policy")).toBe("no-referrer");
    const cb = await browser.get(callbackUrl);
    expect(cb.status).toBe(303);
    expect(cb.headers.get("Location")).toBe("/");
    expect(cb.headers.get("Referrer-Policy")).toBe("no-referrer");
    const cookies = cb.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^cdl_s=cdw_[A-Za-z0-9_-]{43}; Max-Age=43200; Path=\/; HttpOnly; SameSite=Lax$/);
    expect(cookies[1]).toBe("cdl_f=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    // 항아리: 세션만 남는다
    expect([...browser.jar.keys()]).toEqual(["cdl_s"]);
    const w = await store().webCheck(await sha256Hex(browser.jar.get("cdl_s") ?? ""), [A1], Date.now());
    expect(w).toMatchObject({ ok: true, channelId: FAKE_ACCOUNTS.a1.channelId, isAdmin: true });
  });

  it("c3 웹 거부: 세션 쿠키 없음, done이 이름·ID를 보이고 F를 지운다", async () => {
    fake.state.account = "c3";
    const browser = new Browser();
    const { callbackUrl } = await webStart(browser);
    const cb = await browser.get(callbackUrl);
    expect(cb.headers.get("Location")).toBe("/auth/done?r=denied");
    expect(cb.headers.getSetCookie()).toEqual([]);
    expect([...browser.jar.keys()]).toEqual(["cdl_f"]);
    const done = await browser.get("/auth/done?r=denied");
    const text = await done.text();
    expect(text).toContain(`채널 ID ${FAKE_ACCOUNTS.c3.channelId}`);
    expect(text).toContain("&lt;script&gt;");
    expect(done.headers.getSetCookie().some((c) => c.startsWith("cdl_f=; Max-Age=0"))).toBe(true);
    expect(browser.jar.size).toBe(0);
    // 다시 열면 F가 없어 이름·ID 없는 일반 문구
    const again = await (await browser.get("/auth/done?r=denied")).text();
    expect(again).toContain("이 채널은 사용 허가가 없어요.");
    expect(again).not.toContain("채널 ID");
  });

  it("kind는 흐름이 정한다: 같은 콜백이라도 앱은 done, 웹은 /", async () => {
    fake.state.account = "a1";
    const app = await appFlow({ fake });
    expect(parseLoopback(app.callback.headers.get("Location") ?? "")).not.toBeNull();
    expect(app.callback.headers.getSetCookie()).toEqual(["cdl_f=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"]);
    expect(app.redeemBody.isAdmin).toBe(true);
    const web = new Browser();
    const { callbackUrl } = await webStart(web);
    const cb = await web.get(callbackUrl);
    expect(cb.headers.get("Location")).toBe("/");
    expect(cb.headers.getSetCookie().some((c) => c.startsWith("cdl_s=cdw_"))).toBe(true);
  });

  it("웹 흐름의 완료 페이지에는 확인 코드가 없다", async () => {
    fake.state.account = "a1";
    const web = new Browser();
    const { callbackUrl } = await webStart(web);
    await web.get(callbackUrl);
    const done = await (await web.get("/auth/done?r=ok")).text();
    expect(done).not.toContain('class="code"');
  });
});

describe("웹 start 입력", () => {
  it("Origin이 없거나 틀리면 403 HTML, 흐름은 만들어지지 않는다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const browser = new Browser();
    const variants: Record<string, string | null>[] = [{ Origin: null }, { Origin: "http://evil.example.test" }, { "Sec-Fetch-Site": "cross-site" }];
    for (const headers of variants) {
      const res = await browser.post("/auth/web/start", headers);
      expect(res.status).toBe(403);
      expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    // [계속]의 거절과 구별되는 이벤트(구현 중 변경 28)
    const events = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(events).toEqual(Array(3).fill({ event: "auth.start.rejected", level: "info", flowKind: "web", reason: "bad_origin" }));
  });

  it("IP당 한도: 둘째는 429 HTML + Retry-After", async () => {
    const browser = new Browser(viaEnv({ START_RATE_10M: "1" }));
    const ip = { "CF-Connecting-IP": "203.0.113.50" };
    expect((await browser.post("/auth/web/start", ip)).status).toBe(303);
    const res = await browser.post("/auth/web/start", ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Retry-After")).toBe("600");
  });
});

describe("운영 모드", () => {
  it("https 출처: __Host- + Secure, 운영 인가 주소", async () => {
    const origin = "https://dist.example.test";
    const send = viaEnv({ PUBLIC_ORIGIN: origin, CHZZK_AUTHORIZE_URL: "", CHZZK_API_BASE: "", START_RATE_10M: "", CHZZK_REDIRECT_URI: "" });
    const app = new AppClient(send, origin);
    const browser = new Browser(send, origin);
    const { res, body } = await app.start("203.0.113.77");
    expect(res.status).toBe(201);
    expect(body.loginUrl.startsWith(`${origin}/auth/login/`)).toBe(true);
    const path = new URL(body.loginUrl).pathname;
    const page = await browser.get(path);
    expect(page.status).toBe(200);
    // 운영 인가 주소의 출처가 CSP form-action에 실린다
    expect(page.headers.get("Content-Security-Policy")).toContain("form-action 'self' https://chzzk.naver.com http://127.0.0.1:*;");
    const cont = await browser.post(path);
    expect(cont.status).toBe(303);
    expect(cont.headers.get("Location")).toMatch(
      /^https:\/\/chzzk\.naver\.com\/account-interlock\?clientId=dev-client-id&redirectUri=https%3A%2F%2Fdist\.example\.test%2Fauth%2Fcallback&state=[A-Za-z0-9_-]{43}$/,
    );
    const cookie = cont.headers.getSetCookie()[0] ?? "";
    expect(cookie.startsWith("__Host-cdl_f=cdf_")).toBe(true);
    expect(cookie.endsWith("; Secure")).toBe(true);
    expect(cookie).toContain("; Max-Age=600; Path=/; HttpOnly; SameSite=Lax");
  });
});

describe("완료 페이지의 F 지우기", () => {
  it.each([
    ["형식 밖 값", "cdl_f=a.b"],
    ["빈 값", "cdl_f="],
    ["중복", `cdl_f=cdf_${"A".repeat(43)}; cdl_f=cdf_${"B".repeat(43)}`],
  ])("%s도 지운다(구현 중 변경 28)", async (_name, cookie) => {
    const res = await new Browser().get("/auth/done?r=ok", { Cookie: cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual(["cdl_f=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"]);
  });

  it("F가 없으면 Set-Cookie도 없다", async () => {
    const res = await new Browser().get("/auth/done?r=ok", { Cookie: "xcdl_f=1; other=2" });
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});
