// 허용목록·거부 기록·관리 화면(worker.md 구현 중 변경 20·22).
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { recordDenied } from "../../src/store/allowlist";
import { A1, ADMINS, B2, C3, D4, T0, appLogin, begin, freshStub, meter, query, sha, webLogin } from "./helpers";

const deny = async (stub: ReturnType<typeof freshStub>, channelId: string, name: string, now: number) => {
  const b = await begin(stub, { now });
  return stub.finish(b.flowId, { type: "user", channelId, channelName: name }, ADMINS, now);
};

describe("allow·disallow", () => {
  it("L1 allow: 형식 검사, 행과 감사, 메모 갱신", async () => {
    const stub = freshStub();
    expect(await stub.allow("xyz", "", A1, T0)).toEqual({ ok: false, code: "bad_channel_id" });
    expect(await stub.allow(B2, "메모", A1, T0)).toEqual({ ok: true });
    expect(await query(stub, "SELECT channel_id, note, added_by, added_at FROM allowlist")).toEqual([{ channel_id: B2, note: "메모", added_by: A1, added_at: T0 }]);
    expect(await query(stub, "SELECT actor, action, target FROM audit")).toEqual([{ actor: A1, action: "allow", target: B2 }]);
    expect(await stub.allow(B2, "다른 메모", A1, T0 + 1)).toEqual({ ok: true });
    expect(await query(stub, "SELECT note, added_at FROM allowlist")).toEqual([{ note: "다른 메모", added_at: T0 }]);
  });

  it("L2 관리자는 disallow 409(is_admin): 행이 있어도 없어도 아무것도 쓰지 않는다", async () => {
    const stub = freshStub();
    await stub.allow(A1, "", A1, T0);
    const before = await meter(stub);
    expect(await stub.disallow(A1, A1, ADMINS, T0 + 1)).toEqual({ ok: false, code: "is_admin" });
    expect(await meter(stub)).toEqual(before);
    expect(await query(stub, "SELECT count(*) AS n FROM allowlist")).toEqual([{ n: 1 }]);
    const empty = freshStub();
    expect(await empty.disallow(A1, A1, ADMINS, T0)).toEqual({ ok: false, code: "is_admin" });
    expect(await empty.disallow("xyz", A1, ADMINS, T0)).toEqual({ ok: false, code: "bad_channel_id" });
  });

  it("L3 disallow: 행 삭제와 그 채널 세션 전부 폐기(unclaimed·active), 감사", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const l = await appLogin(stub);
    const pending = await begin(stub);
    await stub.finish(pending.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0);
    await stub.allow(C3, "", A1, T0);
    const other = await appLogin(stub, { channelId: C3 });
    expect(await stub.disallow(B2, A1, ADMINS, T0 + 1)).toEqual({ ok: true });
    expect(await query(stub, "SELECT count(*) AS n FROM allowlist WHERE channel_id = ?", B2)).toEqual([{ n: 0 }]);
    expect(await query(stub, "SELECT status, revoked_why, channel_id FROM session ORDER BY channel_id")).toEqual([
      { status: "revoked", revoked_why: "disallowed", channel_id: B2 },
      { status: "revoked", revoked_why: "disallowed", channel_id: B2 },
      { status: "active", revoked_why: null, channel_id: C3 },
    ]);
    expect(await query(stub, "SELECT actor, target FROM audit WHERE action = 'disallow'")).toEqual([{ actor: A1, target: B2 }]);
    expect(await stub.check(await sha(l.bundle.accessToken), ADMINS, T0 + 2)).toMatchObject({ ok: false, code: "not_allowed" });
    expect((await stub.check(await sha(other.bundle.accessToken), ADMINS, T0 + 2)).ok).toBe(true);
  });
});

describe("denied", () => {
  it("L4 같은 채널의 거부는 1시간에 한 번만 센다", async () => {
    const stub = freshStub();
    await deny(stub, C3, "이름1", T0);
    expect(await query(stub, "SELECT attempts, last_at FROM denied")).toEqual([{ attempts: 1, last_at: T0 }]);
    await deny(stub, C3, "이름2", T0 + 3_600_000);
    expect(await query(stub, "SELECT attempts, last_at, channel_name FROM denied")).toEqual([{ attempts: 1, last_at: T0, channel_name: "이름1" }]);
    await deny(stub, C3, "이름3", T0 + 3_600_001);
    expect(await query(stub, "SELECT attempts, last_at, channel_name FROM denied")).toEqual([{ attempts: 2, last_at: T0 + 3_600_001, channel_name: "이름3" }]);
  });

  it("L5 표는 200행 상한(가장 오래된 것부터 빠진다)", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, (inst) => {
      for (let i = 0; i < 201; i++) recordDenied(inst.db, i.toString(16).padStart(32, "0"), "x", T0 + i);
      expect(inst.db.first<{ n: number }>("SELECT count(*) AS n FROM denied")?.n).toBe(200);
      expect(inst.db.first("SELECT 1 AS x FROM denied WHERE channel_id = ?", (0).toString(16).padStart(32, "0"))).toBeNull();
      expect(inst.db.first("SELECT 1 AS x FROM denied WHERE channel_id = ?", (200).toString(16).padStart(32, "0"))).not.toBeNull();
    });
  });

  it("L6 allowDenied: 기록이 없으면 false, 있으면 허용목록으로 옮기고 다음 로그인이 통과", async () => {
    const stub = freshStub();
    expect(await stub.allowDenied(D4, A1, T0)).toBe(false);
    expect(await deny(stub, D4, "거부 때 이름", T0)).toEqual({ type: "denied" });
    expect(await stub.allowDenied(D4, A1, T0 + 1)).toBe(true);
    expect(await query(stub, "SELECT channel_id, channel_name FROM allowlist")).toEqual([{ channel_id: D4, channel_name: "거부 때 이름" }]);
    expect(await query(stub, "SELECT count(*) AS n FROM denied")).toEqual([{ n: 0 }]);
    const l = await appLogin(stub, { channelId: D4, now: T0 + 2 });
    expect(l.bundle.channelId).toBe(D4);

    // 이미 허용된 채널의 거부 기록(부트스트랩 때 거부): [허용]은 메모·추가자를 그대로 두고 거부 기록만 지운다
    const boot = freshStub();
    expect(await boot.allow(B2, "친구 메모", A1, T0)).toEqual({ ok: true });
    const b = await begin(boot);
    expect(await boot.finish(b.flowId, { type: "user", channelId: B2, channelName: "친구" }, [], T0)).toEqual({ type: "denied" });
    expect(await boot.allowDenied(B2, D4, T0 + 1)).toBe(true);
    expect(await query(boot, "SELECT channel_id, note, added_by, added_at FROM allowlist")).toEqual([{ channel_id: B2, note: "친구 메모", added_by: A1, added_at: T0 }]);
    expect(await query(boot, "SELECT count(*) AS n FROM denied")).toEqual([{ n: 0 }]);
    expect(await query(boot, "SELECT actor, action, target FROM audit ORDER BY id")).toEqual([
      { actor: A1, action: "allow", target: B2 },
      { actor: D4, action: "allow", target: B2 },
    ]);
  });

  it("L7 dismissDenied", async () => {
    const stub = freshStub();
    await deny(stub, C3, "x", T0);
    expect(await stub.dismissDenied(C3, A1, T0 + 1)).toBe(true);
    expect(await query(stub, "SELECT actor, action, target FROM audit WHERE action = 'dismiss'")).toEqual([{ actor: A1, action: "dismiss", target: C3 }]);
    expect(await stub.dismissDenied(C3, A1, T0 + 2)).toBe(false);
  });
});

describe("관리 화면·내 세션", () => {
  it("L8 adminView: 허용목록의 활성 세션 수, 세션의 recovered, 거부, 감사 최신순", async () => {
    const stub = freshStub();
    await stub.allow(B2, "메모", A1, T0);
    const l = await appLogin(stub, { channelId: B2 });
    await webLogin(stub, { channelId: A1 });
    await stub.allow(C3, "", A1, T0 + 10);
    await deny(stub, D4, "거부됨", T0 + 20);
    const first = await stub.rotate(await sha(l.bundle.refreshToken), ADMINS, T0 + 1000);
    expect(first.ok).toBe(true);
    await stub.rotate(await sha(l.bundle.refreshToken), ADMINS, T0 + 2000);
    const v = await stub.adminView(T0 + 3000);
    expect(v.allowlist.map((a) => [a.channelId, a.activeSessions])).toEqual([
      [C3, 0],
      [B2, 1],
    ]);
    expect(v.allowlist.find((a) => a.channelId === B2)).toMatchObject({ note: "메모", addedBy: A1, addedAt: T0 });
    expect(v.denied).toEqual([{ channelId: D4, channelName: "거부됨", firstAt: T0 + 20, lastAt: T0 + 20, attempts: 1 }]);
    expect(v.sessions.map((s) => [s.kind, s.channelId, s.recovered]).sort()).toEqual([
      ["app", B2, 1],
      ["web", A1, 0],
    ]);
    expect(v.audit[0]).toMatchObject({ action: "refresh_recovered", actor: "system" });
    expect(v.audit.at(-1)).toMatchObject({ action: "allow", target: B2 });
    expect(v.audit.length).toBeLessThanOrEqual(50);
  });

  it("L9 mySessions·revokeMine: 자기 채널의 세션만", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const mine = await appLogin(stub, { channelId: B2 });
    const web = await webLogin(stub, { channelId: B2 });
    const admin = await appLogin(stub, { channelId: A1, now: T0 + 1 });
    const list = await stub.mySessions(B2, T0 + 2);
    expect(list.map((s) => s.kind).sort()).toEqual(["app", "web"]);
    expect(list.every((s) => s.createdAt === T0 && s.lastSeenAt === T0)).toBe(true);
    const adminSid = (await stub.check(await sha(admin.bundle.accessToken), ADMINS, T0 + 2));
    if (!adminSid.ok) throw new Error(adminSid.code);
    expect(await stub.revokeMine(B2, adminSid.sessionId, T0 + 3)).toBe(false);
    const own = list.find((s) => s.kind === "app")!;
    expect(await stub.revokeMine(B2, own.id, T0 + 3)).toBe(true);
    expect(await stub.revokeMine(B2, own.id, T0 + 4)).toBe(false);
    expect(await stub.check(await sha(mine.bundle.accessToken), ADMINS, T0 + 5)).toEqual({ ok: false, code: "session_revoked", why: "user" });
    expect(await query(stub, "SELECT actor, target FROM audit WHERE action = 'revoke_session'")).toEqual([{ actor: B2, target: own.id.slice(0, 6) }]);
    expect((await stub.webCheck(await sha(web.cookieToken), ADMINS, T0 + 5)).ok).toBe(true);
    expect(await stub.mySessions("x", T0)).toEqual([]);
    expect((await stub.mySessions(B2, T0 + 5)).map((s) => s.kind)).toEqual(["web"]);
  });
});
