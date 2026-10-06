// 앱 세션: refresh 회전·복구·재사용, /api/me, logout, 허용 제외·끊기(docs/design/worker.md §4.2·§5.2·§6, W4 수락 기준).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, B2 } from "../store/helpers";
import { advance, allowedChannel, AppClient, appFlow, HOUR, store, useClock } from "./harness";
import { iso } from "../../src/http/respond";

let fake: FakeChzzk;
let net: FakeNet;

beforeEach(async () => {
  useClock();
  fake = createFakeChzzk();
  net = installFakeChzzk(fake);
  await allowedChannel(B2, A1);
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const app = new AppClient();
const logLines = (spy: { mock: { calls: unknown[][] } }): string[] => spy.mock.calls.map((c) => String(c[0]));

async function login() {
  const f = await appFlow({ fake });
  expect(f.pollBody.status).toBe("ok");
  return f.pollBody as { accessToken: string; refreshToken: string; channelId: string };
}

describe("refresh", () => {
  it("회전: 새 쌍이 나오고 새 access로 me가 된다", async () => {
    const l = await login();
    advance(1000);
    const res = await app.refresh(l.refreshToken);
    expect(res.status).toBe(200);
    const b: any = await res.json();
    expect(b.status).toBe("ok");
    expect(b.refreshToken).not.toBe(l.refreshToken);
    expect(b.accessToken).not.toBe(l.accessToken);
    expect(b.channelId).toBe(B2);
    expect(b.serverTime).toBe(iso(Date.now()));
    expect((await app.me(b.accessToken)).status).toBe(200);
  });

  it("응답 유실 복구: 60초 안에 같은 부모는 새 쌍, 첫 자식은 session_expired(폐기 없음)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const l = await login();
    advance(1000);
    const first: any = await (await app.refresh(l.refreshToken)).json();
    advance(30_000);
    const res = await app.refresh(l.refreshToken);
    expect(res.status).toBe(200);
    const second: any = await res.json();
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(logLines(spy).map((l) => JSON.parse(l)).some((l) => l.event === "auth.refresh.recovered")).toBe(true);
    // 지연된 첫 쌍은 힘이 없지만 세션을 해치지 않는다
    const late = await app.refresh(first.refreshToken);
    expect(late.status).toBe(401);
    expect(await late.json()).toEqual({ code: "session_expired" });
    expect((await app.me(first.accessToken)).status).toBe(401);
    // 재시도 쌍은 그대로 된다
    advance(1000);
    expect((await app.refresh(second.refreshToken)).status).toBe(200);
  });

  it("60초 밖의 재사용은 세션 전체 폐기", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const l = await login();
    advance(1000);
    const child: any = await (await app.refresh(l.refreshToken)).json();
    advance(61_000);
    const reuse = await app.refresh(l.refreshToken);
    expect(reuse.status).toBe(401);
    expect(await reuse.json()).toEqual({ code: "session_revoked" });
    expect(logLines(spy).map((l) => JSON.parse(l)).some((l) => l.event === "auth.refresh.reuse_detected")).toBe(true);
    const next = await app.refresh(child.refreshToken);
    expect(next.status).toBe(401);
    expect(await next.json()).toEqual({ code: "session_revoked" });
    const me = await app.me(child.accessToken);
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ code: "session_revoked" });
  });

  it("입력: 400·401·429", async () => {
    const l = await login();
    const bad = (body: string, type = "application/json") => app.send(app.origin + "/auth/refresh", { method: "POST", headers: { "Content-Type": type }, body });
    expect((await bad("{")).status).toBe(400);
    expect((await bad("[]")).status).toBe(400);
    expect((await bad(JSON.stringify({ refreshToken: l.refreshToken }), "text/plain")).status).toBe(400);
    for (const token of [undefined, 1, "cdr_short", l.accessToken, "cdr_" + "A".repeat(43) + "x"]) {
      const res = await app.refresh(token);
      expect([String(token), res.status, await res.json()]).toEqual([String(token), 401, { code: "invalid_token" }]);
    }
    const unknown = await app.refresh("cdr_" + "A".repeat(43));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ code: "session_expired" });
    // 채널별 회전 상한 10회/10분: 열한 번째는 429 + Retry-After
    let token = l.refreshToken;
    for (let i = 0; i < 10; i++) {
      advance(1000);
      const r = await app.refresh(token);
      expect(r.status).toBe(200);
      token = ((await r.json()) as { refreshToken: string }).refreshToken;
    }
    advance(1000);
    const limited = await app.refresh(token);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ code: "rate_limited" });
    expect(limited.headers.get("Retry-After")).toMatch(/^\d+$/);
  });
});

describe("허용 제외·끊기", () => {
  it("disallow 즉시: me·refresh 모두 403 not_allowed", async () => {
    const l = await login();
    expect(await store().disallow(B2, A1, [A1], Date.now())).toEqual({ ok: true });
    const me = await app.me(l.accessToken);
    expect(me.status).toBe(403);
    expect(await me.json()).toEqual({ code: "not_allowed" });
    const rf = await app.refresh(l.refreshToken);
    expect(rf.status).toBe(403);
    expect(await rf.json()).toEqual({ code: "not_allowed" });
  });

  it("관리자 끊기 즉시: me·refresh 모두 401 session_revoked", async () => {
    const l = await login();
    const now = Date.now();
    const mine = (await store().adminView(now)).sessions.filter((s) => s.channelId === B2).sort((a, b) => b.createdAt - a.createdAt)[0];
    expect(mine).toBeDefined();
    expect(await store().revoke(mine?.id ?? "", "admin", A1, now)).toBe(true);
    const me = await app.me(l.accessToken);
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ code: "session_revoked" });
    const rf = await app.refresh(l.refreshToken);
    expect(rf.status).toBe(401);
    expect(await rf.json()).toEqual({ code: "session_revoked" });
  });
});

describe("/api/me", () => {
  it("200: 네 키만", async () => {
    const l = await login();
    const res = await app.me(l.accessToken);
    expect(res.status).toBe(200);
    const b: any = await res.json();
    expect(Object.keys(b).sort()).toEqual(["accessExpiresAt", "channelId", "channelName", "serverTime"]);
    expect(b.channelId).toBe(B2);
    expect(b.channelName).toBe(FAKE_ACCOUNTS.b2.channelName);
    expect(b.serverTime).toBe(iso(Date.now()));
  });

  it("자격이 없거나 형식이 틀리면 401 invalid_token", async () => {
    const l = await login();
    for (const send of [() => app.me(), () => app.me(l.refreshToken), () => app.me("cda_short")]) {
      const res = await send();
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ code: "invalid_token" });
    }
  });

  it("access가 24시간 뒤에 만료되면 401 invalid_token", async () => {
    const l = await login();
    advance(24 * HOUR);
    const res = await app.me(l.accessToken);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ code: "invalid_token" });
  });
});

describe("logout", () => {
  it("access로 204 → 그 세션은 끝나고, 다시 불러도 204. refresh만으로는 다른 세션을 끝낸다", async () => {
    const one = await login();
    const two = await login();
    const out = await app.logout({ access: one.accessToken });
    expect(out.status).toBe(204);
    expect(await out.text()).toBe("");
    const me = await app.me(one.accessToken);
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ code: "session_revoked" });
    expect((await app.logout({ access: one.accessToken })).status).toBe(204);
    // 다른 세션은 그대로, refresh 본문만으로 끝낼 수 있다
    expect((await app.me(two.accessToken)).status).toBe(200);
    expect((await app.logout({ refresh: two.refreshToken })).status).toBe(204);
    const rf = await app.refresh(two.refreshToken);
    expect(rf.status).toBe(401);
    expect(await rf.json()).toEqual({ code: "session_revoked" });
  });

  it("자격이 없으면 401, 본문이 깨졌으면 400", async () => {
    const none = await app.logout({});
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ code: "invalid_token" });
    expect((await app.logout({ raw: "{" })).status).toBe(400);
    const l = await login();
    expect((await app.logout({ access: l.accessToken, raw: "{" })).status).toBe(400);
    expect((await app.logout({ refresh: "cdr_nope" })).status).toBe(401);
  });
});
