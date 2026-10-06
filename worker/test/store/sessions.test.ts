// 세션·refresh 회전(worker.md 구현 중 변경 20): §5.2 표 전 행, 60일 경계, check·webCheck의 kind 조건, 폐기.
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isToken, newToken } from "../../src/core/token";
import { A1, ADMINS, B2, D4, DAY, T0, allowedLogin, appLogin, freshStub, meter, query, sha, webLogin, type Stub } from "./helpers";

const rot = async (stub: Stub, token: string, now: number, admins: readonly string[] = ADMINS) => stub.rotate(await sha(token), admins, now);
const chk = async (stub: Stub, token: string, now: number, admins: readonly string[] = ADMINS) => stub.check(await sha(token), admins, now);
const sidOf = async (stub: Stub, access: string) => {
  const r = await chk(stub, access, T0);
  if (!r.ok) throw new Error(r.code);
  return r.sessionId;
};
const REVOKED = { ok: false, code: "session_expired", why: null, reuseDetected: false } as const;

describe("rotate: §5.2 표", () => {
  it("R1 없는 토큰: session_expired, 쓰기 0", async () => {
    const stub = freshStub();
    const before = await meter(stub);
    expect(await rot(stub, newToken("refresh"), T0)).toEqual(REVOKED);
    expect((await meter(stub)).written).toBe(before.written);
  });

  it("R2 관리자가 끊은 세션: session_revoked/admin, 쓰기 0", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    expect(await stub.revoke(await sidOf(stub, l.bundle.accessToken), "admin", A1, T0 + 1)).toBe(true);
    const before = await meter(stub);
    expect(await rot(stub, l.bundle.refreshToken, T0 + 2)).toEqual({ ok: false, code: "session_revoked", why: "admin", reuseDetected: false });
    expect((await meter(stub)).written).toBe(before.written);
  });

  it("R3 허용에서 빠짐: not_allowed/disallowed", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    expect(await stub.disallow(B2, A1, ADMINS, T0 + 1)).toEqual({ ok: true });
    expect(await rot(stub, l.bundle.refreshToken, T0 + 2)).toEqual({ ok: false, code: "not_allowed", why: "disallowed", reuseDetected: false });
  });

  it("R4 refresh 만료: 30일 직전 ok, 30일에 session_expired(쓰기 0)", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    expect((await rot(stub, l.bundle.refreshToken, T0 + 30 * DAY - 1)).ok).toBe(true);
    const s2 = freshStub();
    const l2 = await allowedLogin(s2);
    const before = await meter(s2);
    expect(await rot(s2, l2.bundle.refreshToken, T0 + 30 * DAY)).toEqual(REVOKED);
    expect((await meter(s2)).written).toBe(before.written);
  });

  it("R5 허용 제외(행은 없고 관리자 집합만 바뀜): not_allowed, 세션 revoked, 다음도 not_allowed", async () => {
    const stub = freshStub();
    const l = await appLogin(stub, { channelId: A1 });
    expect(await rot(stub, l.bundle.refreshToken, T0 + 1000, [D4])).toEqual({ ok: false, code: "not_allowed", why: "disallowed", reuseDetected: false });
    expect(await query(stub, "SELECT status, revoked_why FROM session")).toEqual([{ status: "revoked", revoked_why: "disallowed" }]);
    expect(await rot(stub, l.bundle.refreshToken, T0 + 2000, [D4])).toMatchObject({ ok: false, code: "not_allowed" });
  });

  it("R6 active: 회전하고 옛 access는 죽고 새 access가 산다", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    const now = T0 + 3_600_000;
    const r = await rot(stub, l.bundle.refreshToken, now);
    if (!r.ok) throw new Error(r.code);
    expect(r.recovered).toBe(false);
    expect(isToken("access", r.bundle.accessToken) && isToken("refresh", r.bundle.refreshToken)).toBe(true);
    expect(r.bundle.accessToken).not.toBe(l.bundle.accessToken);
    expect(r.bundle.refreshToken).not.toBe(l.bundle.refreshToken);
    const rows = await query<{ hash: string; status: string; used_at: number | null; child_hash: string | null; expires_at: number }>(stub, "SELECT hash, status, used_at, child_hash, expires_at FROM refresh");
    const byHash = new Map(rows.map((x) => [x.hash, x]));
    expect(byHash.get(await sha(l.bundle.refreshToken))).toMatchObject({ status: "used", used_at: now, child_hash: await sha(r.bundle.refreshToken) });
    expect(byHash.get(await sha(r.bundle.refreshToken))).toMatchObject({ status: "active", expires_at: now + 30 * DAY });
    expect(await chk(stub, l.bundle.accessToken, now)).toMatchObject({ ok: false, code: "invalid_token" });
    expect((await chk(stub, r.bundle.accessToken, now)).ok).toBe(true);
  });

  it("R7 응답 유실 복구: 60초 안에 옛 토큰을 다시 내면 새 자식을 건다", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    const t1 = T0 + 3_600_000;
    const first = await rot(stub, l.bundle.refreshToken, t1);
    if (!first.ok) throw new Error(first.code);
    const again = await rot(stub, l.bundle.refreshToken, t1 + 60_000);
    if (!again.ok) throw new Error(again.code);
    expect(again.recovered).toBe(true);
    expect(again.bundle.refreshToken).not.toBe(first.bundle.refreshToken);
    expect(await query(stub, "SELECT count(*) AS n FROM refresh WHERE hash = ?", await sha(first.bundle.refreshToken))).toEqual([{ n: 0 }]);
    expect(await query(stub, "SELECT child_hash FROM refresh WHERE hash = ?", await sha(l.bundle.refreshToken))).toEqual([{ child_hash: await sha(again.bundle.refreshToken) }]);
    expect(await query(stub, "SELECT recovered FROM session")).toEqual([{ recovered: 1 }]);
    const sid = await query<{ id: string }>(stub, "SELECT id FROM session");
    expect(await query(stub, "SELECT actor, action, target FROM audit WHERE action = 'refresh_recovered'")).toEqual([{ actor: "system", action: "refresh_recovered", target: sid[0]!.id.slice(0, 6) }]);
    // 첫 자식 토큰은 이제 없는 토큰이다
    expect(await rot(stub, first.bundle.refreshToken, t1 + 61_000)).toEqual(REVOKED);
    expect((await chk(stub, again.bundle.accessToken, t1 + 60_000)).ok).toBe(true);
  });

  it("R8 두 번 복구: 창은 첫 사용부터이고 recovered는 2", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    const t1 = T0 + 3_600_000;
    await rot(stub, l.bundle.refreshToken, t1);
    expect((await rot(stub, l.bundle.refreshToken, t1 + 10_000)).ok).toBe(true);
    expect((await rot(stub, l.bundle.refreshToken, t1 + 20_000)).ok).toBe(true);
    expect(await query(stub, "SELECT recovered FROM session")).toEqual([{ recovered: 2 }]);
  });

  it("R9 60초 초과: 재사용 감지, 세션 폐기, refresh 행은 그대로", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    const t1 = T0 + 3_600_000;
    const first = await rot(stub, l.bundle.refreshToken, t1);
    if (!first.ok) throw new Error(first.code);
    const before = (await query<{ n: number }>(stub, "SELECT count(*) AS n FROM refresh"))[0]!.n;
    expect(await rot(stub, l.bundle.refreshToken, t1 + 60_001)).toEqual({ ok: false, code: "session_revoked", why: "reuse", reuseDetected: true });
    expect(await query(stub, "SELECT status, revoked_why FROM session")).toEqual([{ status: "revoked", revoked_why: "reuse" }]);
    expect(await query(stub, "SELECT count(*) AS n FROM audit WHERE action = 'reuse_detected'")).toEqual([{ n: 1 }]);
    expect(await query(stub, "SELECT count(*) AS n FROM refresh")).toEqual([{ n: before }]);
    // 피해자의 현재 토큰도 session_revoked로 답한다(reuseDetected는 한 번만)
    expect(await rot(stub, first.bundle.refreshToken, t1 + 70_000)).toEqual({ ok: false, code: "session_revoked", why: "reuse", reuseDetected: false });
    expect(await chk(stub, first.bundle.accessToken, t1 + 70_000)).toEqual({ ok: false, code: "session_revoked", why: "reuse" });
  });

  it("R10 60초 안이어도 자식이 이미 쓰였으면 재사용", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    const t1 = T0 + 3_600_000;
    const first = await rot(stub, l.bundle.refreshToken, t1);
    if (!first.ok) throw new Error(first.code);
    expect((await rot(stub, first.bundle.refreshToken, t1 + 10_000)).ok).toBe(true);
    expect(await rot(stub, l.bundle.refreshToken, t1 + 30_000)).toMatchObject({ ok: false, code: "session_revoked", why: "reuse", reuseDetected: true });
  });
});

describe("60일 절대 상한", () => {
  it("회전할 때마다 만료가 상한으로 잘리고 직후 session_expired", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    const r1 = await rot(stub, l.bundle.refreshToken, T0 + 29 * DAY);
    if (!r1.ok) throw new Error(r1.code);
    expect(r1.bundle).toMatchObject({ refreshExpiresAt: T0 + 59 * DAY, accessExpiresAt: T0 + 30 * DAY });
    const r2 = await rot(stub, r1.bundle.refreshToken, T0 + 58 * DAY);
    if (!r2.ok) throw new Error(r2.code);
    expect(r2.bundle).toMatchObject({ refreshExpiresAt: T0 + 60 * DAY, accessExpiresAt: T0 + 59 * DAY });
    const r3 = await rot(stub, r2.bundle.refreshToken, T0 + 60 * DAY - 1);
    if (!r3.ok) throw new Error(r3.code);
    expect(r3.bundle).toMatchObject({ refreshExpiresAt: T0 + 60 * DAY, accessExpiresAt: T0 + 60 * DAY });
    expect((await chk(stub, r3.bundle.accessToken, T0 + 60 * DAY - 1)).ok).toBe(true);
    expect(await chk(stub, r3.bundle.accessToken, T0 + 60 * DAY)).toEqual({ ok: false, code: "invalid_token", why: null });
    const before = await meter(stub);
    expect(await rot(stub, r3.bundle.refreshToken, T0 + 60 * DAY)).toEqual(REVOKED);
    expect((await meter(stub)).written).toBe(before.written);
  });
});

describe("check·webCheck", () => {
  it("K1 성공 경로는 쓰지 않는다", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    const before = await meter(stub);
    const r = await chk(stub, l.bundle.accessToken, T0 + 1000);
    expect(r).toMatchObject({ ok: true, channelId: B2, ownerChannelId: B2, channelName: "허용 채널", isAdmin: false, accessExpiresAt: T0 + DAY });
    expect((await meter(stub)).written).toBe(before.written);
    expect(await chk(stub, l.bundle.accessToken, T0 + DAY)).toEqual({ ok: false, code: "invalid_token", why: null });
  });

  it("K2 kind 조건: 앱 access는 webCheck에, 웹 쿠키는 check에 통하지 않는다", async () => {
    const stub = freshStub();
    const a = await appLogin(stub, { channelId: A1 });
    const w = await webLogin(stub, { channelId: A1 });
    expect(await chk(stub, w.cookieToken, T0 + 1)).toEqual({ ok: false, code: "invalid_token", why: null });
    expect(await stub.webCheck(await sha(a.bundle.accessToken), ADMINS, T0 + 1)).toEqual({ ok: false, code: "invalid_token", why: null });
    expect((await chk(stub, a.bundle.accessToken, T0 + 1)).ok).toBe(true);
    expect((await stub.webCheck(await sha(w.cookieToken), ADMINS, T0 + 1)).ok).toBe(true);
  });

  it("K3 끊거나 허용에서 빼면 지연 없이 다음 check부터 거부", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    expect(await stub.revoke(await sidOf(stub, l.bundle.accessToken), "admin", A1, T0 + 1)).toBe(true);
    expect(await chk(stub, l.bundle.accessToken, T0 + 2)).toEqual({ ok: false, code: "session_revoked", why: "admin" });

    const s2 = freshStub();
    const l2 = await allowedLogin(s2);
    await s2.disallow(B2, A1, ADMINS, T0 + 1);
    expect(await chk(s2, l2.bundle.accessToken, T0 + 2)).toEqual({ ok: false, code: "not_allowed", why: "disallowed" });
  });

  it("K4 관리자 집합에서 빠진 시점의 check는 not_allowed이고 세션이 revoked", async () => {
    const stub = freshStub();
    const l = await appLogin(stub, { channelId: A1 });
    expect(await chk(stub, l.bundle.accessToken, T0 + 1, [D4])).toEqual({ ok: false, code: "not_allowed", why: "disallowed" });
    expect(await query(stub, "SELECT status, revoked_why FROM session")).toEqual([{ status: "revoked", revoked_why: "disallowed" }]);
  });

  it("K5 웹 세션은 12시간 절대", async () => {
    const stub = freshStub();
    const w = await webLogin(stub, { channelId: A1 });
    expect(w.expiresAt).toBe(T0 + 12 * 3_600_000);
    const h = await sha(w.cookieToken);
    expect((await stub.webCheck(h, ADMINS, T0 + 12 * 3_600_000 - 1)).ok).toBe(true);
    expect(await stub.webCheck(h, ADMINS, T0 + 12 * 3_600_000)).toEqual({ ok: false, code: "invalid_token", why: null });
  });

  it("K6 logout: access로도 refresh로도, 모르는 해시는 조용히", async () => {
    const a = freshStub();
    const la = await allowedLogin(a);
    await a.logout(await sha(la.bundle.accessToken), null, T0 + 1);
    expect(await chk(a, la.bundle.accessToken, T0 + 2)).toEqual({ ok: false, code: "session_revoked", why: "logout" });
    const b = freshStub();
    const lb = await allowedLogin(b);
    await b.logout(null, await sha(lb.bundle.refreshToken), T0 + 1);
    expect(await chk(b, lb.bundle.accessToken, T0 + 2)).toEqual({ ok: false, code: "session_revoked", why: "logout" });
    await expect(b.logout(await sha("x"), await sha("y"), T0)).resolves.toBeUndefined();
    await expect(b.logout("x", null, T0)).resolves.toBeUndefined();
  });

  it("K7 해시 모양이 아닌 입력은 SQL 전에 거른다", async () => {
    const stub = freshStub();
    const before = await meter(stub);
    expect(await stub.check("x", ADMINS, T0)).toEqual({ ok: false, code: "invalid_token", why: null });
    expect(await stub.webCheck("x", ADMINS, T0)).toEqual({ ok: false, code: "invalid_token", why: null });
    expect(await stub.rotate("x", ADMINS, T0)).toEqual(REVOKED);
    expect(await meter(stub)).toEqual(before);
  });

  it("K8 owner: 허용목록의 owner_channel_id가 번들·check의 channelId가 된다", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    await runInDurableObject(stub, (i) => i.db.run("UPDATE allowlist SET owner_channel_id = ? WHERE channel_id = ?", D4, B2));
    const l = await appLogin(stub);
    expect(l.bundle.channelId).toBe(D4);
    expect(await chk(stub, l.bundle.accessToken, T0 + 1)).toMatchObject({ ok: true, channelId: B2, ownerChannelId: D4 });
  });
});
