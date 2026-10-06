// 가짜 치지직 자체의 동작(docs/design/worker.md §12.1). Worker 없이 handle만 부른다.
import { describe, expect, it } from "vitest";
import { createFakeChzzk, FAKE_ACCOUNTS, FAKE_ORIGIN } from "../fake-chzzk.mjs";

const REDIRECT = "http://localhost:8787/auth/callback";
const authorizeUrl = (o: { clientId?: string; redirectUri?: string; state?: string } = {}) => {
  const u = new URL("/account-interlock", FAKE_ORIGIN);
  u.searchParams.set("clientId", o.clientId ?? "dev-client-id");
  u.searchParams.set("redirectUri", o.redirectUri ?? REDIRECT);
  u.searchParams.set("state", o.state ?? "st-1");
  return u.toString();
};
const tokenReq = (body: unknown) =>
  new Request(FAKE_ORIGIN + "/auth/v1/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const tokenBody = (code: string, over: Record<string, unknown> = {}) => ({
  grantType: "authorization_code",
  clientId: "dev-client-id",
  clientSecret: "dev-client-placeholder",
  code,
  state: "st-1",
  ...over,
});
const userReq = (token: string) => new Request(FAKE_ORIGIN + "/open/v1/users/me", { headers: { Authorization: `Bearer ${token}` } });

async function approve(fake = createFakeChzzk()) {
  const r = await fake.handle(new Request(authorizeUrl()));
  const loc = new URL(r.headers.get("Location") ?? "");
  return { fake, r, code: loc.searchParams.get("code") ?? "", loc };
}

describe("authorize", () => {
  it("승인: 302로 redirectUri에 code·state를 싣는다", async () => {
    const { r, code, loc } = await approve();
    expect(r.status).toBe(302);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("state")).toBe("st-1");
    expect(code).toMatch(/^fake-code-/);
  });

  it("취소: code 없이 state만", async () => {
    const fake = createFakeChzzk();
    fake.state.authorize = "cancel";
    const r = await fake.handle(new Request(authorizeUrl()));
    const loc = new URL(r.headers.get("Location") ?? "");
    expect(r.status).toBe(302);
    expect(loc.searchParams.has("code")).toBe(false);
    expect(loc.searchParams.get("state")).toBe("st-1");
    expect(fake.state.issuedCodes).toEqual([]);
  });

  it("clientId가 틀리면 400", async () => {
    const r = await createFakeChzzk().handle(new Request(authorizeUrl({ clientId: "other" })));
    expect(r.status).toBe(400);
  });

  it("state가 비면 400", async () => {
    const r = await createFakeChzzk().handle(new Request(authorizeUrl({ state: "" })));
    expect(r.status).toBe(400);
  });

  it.each([["끝 슬래시", REDIRECT + "/"], ["127.0.0.1", "http://127.0.0.1:8787/auth/callback"], ["대문자 Callback", "http://localhost:8787/auth/Callback"]])(
    "redirectUri가 한 바이트라도 다르면 400: %s",
    async (_n, redirectUri) => {
      const r = await createFakeChzzk().handle(new Request(authorizeUrl({ redirectUri })));
      expect(r.status).toBe(400);
    },
  );
});

describe("token", () => {
  it("래퍼 있음·expiresIn 문자열이 기본", async () => {
    const { fake, code } = await approve();
    const r = await fake.handle(tokenReq(tokenBody(code)));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { code: number; content: { accessToken: string; expiresIn: unknown } };
    expect(j.code).toBe(200);
    expect(j.content.accessToken).toMatch(/^fake-at-/);
    expect(j.content.expiresIn).toBe("86400");
    expect(fake.state.issuedTokens).toHaveLength(2);
  });

  it("wrapped false면 래퍼 없음, expiresIn 숫자", async () => {
    const { fake, code } = await approve();
    fake.state.wrapped = false;
    fake.state.expiresInType = "number";
    const j = (await (await fake.handle(tokenReq(tokenBody(code)))).json()) as Record<string, unknown>;
    expect(j.accessToken).toMatch(/^fake-at-/);
    expect(j.expiresIn).toBe(86400);
    expect("content" in j).toBe(false);
  });

  it("code는 한 번만(reject), allow면 다시 된다", async () => {
    const { fake, code } = await approve();
    expect((await fake.handle(tokenReq(tokenBody(code)))).status).toBe(200);
    expect((await fake.handle(tokenReq(tokenBody(code)))).status).toBe(401);
    fake.state.codeReuse = "allow";
    expect((await fake.handle(tokenReq(tokenBody(code)))).status).toBe(200);
  });

  it("secret·state·grantType가 틀리거나 모르는 code면 401", async () => {
    const { fake, code } = await approve();
    expect((await fake.handle(tokenReq(tokenBody(code, { clientSecret: "x" })))).status).toBe(401);
    expect((await fake.handle(tokenReq(tokenBody(code, { state: "st-2" })))).status).toBe(401);
    expect((await fake.handle(tokenReq(tokenBody(code, { grantType: "refresh_token" })))).status).toBe(401);
    expect((await fake.handle(tokenReq(tokenBody("fake-code-unknown")))).status).toBe(401);
  });

  it.each([401, 429, 500] as const)("tokenFail %s", async (status) => {
    const { fake, code } = await approve();
    fake.state.tokenFail = status;
    const r = await fake.handle(tokenReq(tokenBody(code)));
    expect(r.status).toBe(status);
    expect(await r.json()).toEqual({ code: status, message: "fake error", content: null });
  });

  it("tokenFail html: 200 text/html", async () => {
    const { fake, code } = await approve();
    fake.state.tokenFail = "html";
    const r = await fake.handle(tokenReq(tokenBody(code)));
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("text/html");
  });

  it("tokenFail timeout: 기다리지 않고 TimeoutError를 던진다", async () => {
    const { fake, code } = await approve();
    fake.state.tokenFail = "timeout";
    await expect(fake.handle(tokenReq(tokenBody(code)))).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

describe("users/me", () => {
  async function login(fake = createFakeChzzk()) {
    const { code } = await approve(fake);
    const j = (await (await fake.handle(tokenReq(tokenBody(code)))).json()) as { content: { accessToken: string } };
    return j.content.accessToken;
  }

  it("발급한 access의 계정(승인 때 고른 계정)을 돌려준다", async () => {
    const fake = createFakeChzzk();
    fake.state.account = "c3";
    const at = await login(fake);
    const j = (await (await fake.handle(userReq(at))).json()) as { content: { channelId: string; channelName: string } };
    expect(j.content).toEqual(FAKE_ACCOUNTS.c3);
  });

  it("모르는 토큰은 401", async () => {
    expect((await createFakeChzzk().handle(userReq("fake-at-unknown"))).status).toBe(401);
  });

  it("userIdField id면 channelId 대신 id", async () => {
    const fake = createFakeChzzk();
    const at = await login(fake);
    fake.state.userIdField = "id";
    const j = (await (await fake.handle(userReq(at))).json()) as { content: Record<string, unknown> };
    expect(j.content.id).toBe(FAKE_ACCOUNTS.b2.channelId);
    expect("channelId" in j.content).toBe(false);
  });

  it("userFail timeout", async () => {
    const fake = createFakeChzzk();
    const at = await login(fake);
    fake.state.userFail = "timeout";
    await expect(fake.handle(userReq(at))).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

it("모르는 경로는 404, 모든 요청이 calls에 쿼리 없이 남는다", async () => {
  const fake = createFakeChzzk();
  expect((await fake.handle(new Request(FAKE_ORIGIN + "/nope"))).status).toBe(404);
  await fake.handle(new Request(authorizeUrl()));
  expect(fake.state.calls).toEqual(["GET /nope", "GET /account-interlock"]);
});
