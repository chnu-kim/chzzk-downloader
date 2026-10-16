// 편집자 위임 store(docs/design/features/delegation.md §8·§14, worker.md 구현 중 변경 105): RPC 동작, V2 롤백 호환(V2 SQL 직접 실행),
// 초대 롤백 호환(3차 N3), 대안 B 키 규칙, 묶음·me. 테스트 채널 ID는 모두 합성 상수다.
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isToken } from "../../src/core/token";
import { DONE_WINDOW_MS, INVITE_TTL_MS, delegationsOf, editorsOf } from "../../src/store/delegation";
import { sweep } from "../../src/store/sweep";
import { A1, ADMINS, B2, C3, D4, DAY, T0, allowedLogin, appLogin, dumpAll, freshStub, meter, query, sha, webLogin, type Stub } from "./helpers";

const E5 = "0".repeat(30) + "e5";
const F6 = "0".repeat(30) + "f6";

// V2(df454c3) allow·disallow가 내던 SQL 그대로. 확장된 disallow를 부르면 롤백을 흉내 낼 수 없다: 고치지 않는다.
// V2 allow는 INSERT 뒤 denied 삭제와 감사 INSERT를 냈다. denied 삭제는 청구 흔적(구현 중 변경 105 (아))을 끊으므로 흉내 낸다.
// 감사 INSERT는 판정에 닿지 않아 뺐다
const V2_ALLOW =
  "INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, (SELECT channel_name FROM denied WHERE channel_id = ?), NULL, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET note = COALESCE(excluded.note, allowlist.note)";
const V2_ALLOW_DENIED = "DELETE FROM denied WHERE channel_id = ?";
const V2_DISALLOW_ROW = "DELETE FROM allowlist WHERE channel_id = ?";
const V2_DISALLOW_SESSIONS = "UPDATE session SET status = 'revoked', revoked_at = ?, revoked_why = 'disallowed' WHERE channel_id = ? AND status <> 'revoked'";
const v2Disallow = (stub: Stub, ch: string, now: number) =>
  runInDurableObject(stub, (i) => {
    i.db.run(V2_DISALLOW_ROW, ch);
    i.db.run(V2_DISALLOW_SESSIONS, now, ch);
  });
const v2Allow = (stub: Stub, ch: string, now: number) =>
  runInDurableObject(stub, (i) => {
    i.db.run(V2_ALLOW, ch, ch, null, A1, now);
    i.db.run(V2_ALLOW_DENIED, ch);
  });

const allowAt = (stub: Stub, ch: string, now: number) => stub.allow(ch, "", A1, now, ADMINS);
const altB = (stub: Stub, login: string, judge: string) => runInDurableObject(stub, (i) => i.db.run("UPDATE allowlist SET owner_channel_id = ? WHERE channel_id = ?", judge, login));
const invite = async (stub: Stub, ownerLogin: string, now: number) => {
  const r = await stub.createInvite(ownerLogin, "주인", ADMINS, now);
  if (!r.ok) throw new Error(r.code);
  return { token: r.token, hash: await sha(r.token), expiresAt: r.expiresAt };
};
const accept = (stub: Stub, hash: string, editor: string, now: number) => stub.acceptInvite(hash, editor, "편집자", ADMINS, now);
/** 초대에서 시작한 웹 로그인을 finish까지(거부·허가 모두) */
async function inviteLogin(stub: Stub, hash: string, channelId: string, now: number) {
  const s = await stub.startWebInvite(hash, "203.0.113.30", 1000, ADMINS, now);
  if (!s.ok) throw new Error(`startWebInvite ${s.code}`);
  const k = await stub.consume(await sha(s.state), await sha(s.binder), now);
  if (!k.ok) throw new Error(k.code);
  return stub.finish(k.flowId, { type: "user", channelId, channelName: "들어온 채널" }, ADMINS, now);
}
const delegations = (stub: Stub) => query(stub, "SELECT * FROM delegation ORDER BY owner_channel_id, editor_channel_id");
const invites = (stub: Stub) => query(stub, "SELECT * FROM invite ORDER BY token_hash");
const meOf = async (stub: Stub, access: string, now: number) => {
  const r = await stub.me(await sha(access), ADMINS, now);
  if (!r.ok) throw new Error(r.code);
  return r;
};
/** 합성 채널 ID(0x100 이상: A1·B2·C3·D4·E5·F6과 겹치지 않는다) */
const chan = (i: number) => (0x100 + i).toString(16).padStart(32, "0");
/** 세션 없이 판정만 볼 때: store 함수를 DO 안에서 직접 부른다 */
const mine = (stub: Stub, editor: string, admins: readonly string[] = ADMINS) => runInDurableObject(stub, (i) => delegationsOf(i.db, editor, admins));
const editorsSide = (stub: Stub, owner: string, now: number, admins: readonly string[] = ADMINS) => runInDurableObject(stub, (i) => editorsOf(i.db, owner, admins, now));
const sweepNow = (stub: Stub, now: number) => runInDurableObject(stub, (i) => sweep(i.db, now));

/** 허가 → 초대 → 수락으로 활성 위임 하나(주인은 이미 허가돼 있어야 한다) */
async function link(stub: Stub, owner: string, editor: string, t: number) {
  await allowAt(stub, editor, t);
  const inv = await invite(stub, owner, t + 1);
  const a = await accept(stub, inv.hash, editor, t + 2);
  if (!a.ok) throw new Error(`accept ${a.code}`);
}

/** 상한 준비용: 유효한 활성 위임 행을 직접 넣는다(편집자는 먼저 허가해 두고 그 added_at을 적는다) */
async function seedActive(stub: Stub, ownerLogin: string, ownerJudge: string, editor: string, createdAt: number) {
  await allowAt(stub, editor, createdAt - 1);
  await runInDurableObject(stub, (i) => {
    const o = i.db.first<{ added_at: number }>("SELECT added_at FROM allowlist WHERE channel_id = ?", ownerLogin);
    const ownerAt = ADMINS.includes(ownerLogin) ? null : (o?.added_at ?? null);
    i.db.run(
      "INSERT INTO delegation (owner_channel_id, owner_login_channel_id, editor_channel_id, owner_name, editor_name, owner_allowed_at, editor_allowed_at, created_at, revoked_at, revoked_by) VALUES (?, ?, ?, '주인', '편집자', ?, ?, ?, NULL, NULL)",
      ownerJudge,
      ownerLogin,
      editor,
      ownerAt,
      createdAt - 1,
      createdAt,
    );
  });
}

describe("createInvite", () => {
  it("CI1 토큰·해시·만료", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const r = await stub.createInvite(B2, "주인", ADMINS, T0 + 1);
    if (!r.ok) throw new Error(r.code);
    expect(isToken("invite", r.token)).toBe(true);
    expect(r.expiresAt).toBe(T0 + 1 + INVITE_TTL_MS);
    const rows = await invites(stub);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      token_hash: await sha(r.token),
      owner_channel_id: B2,
      owner_login_channel_id: B2,
      owner_allowed_at: T0,
      expires_at: T0 + 1 + 7 * DAY,
      claimed_channel_id: null,
      claimed_name: null,
      claimed_at: null,
    });
    const dump = await runInDurableObject(stub, (i) => dumpAll(i.db));
    expect(dump).not.toContain(r.token);
    expect(dump).not.toContain(r.token.slice(4));
  });

  it("CI2 관리자 주인은 owner_allowed_at NULL", async () => {
    const stub = freshStub();
    await invite(stub, A1, T0);
    expect((await invites(stub))[0]).toMatchObject({ owner_channel_id: A1, owner_allowed_at: null });
  });

  it("CI3 새로 만들면 이전 미청구 초대를 대체한다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const a = await invite(stub, B2, T0 + 1);
    const b = await invite(stub, B2, T0 + 2);
    const rows = await invites(stub);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(b.hash);
    expect(await stub.inviteView(a.hash, null, ADMINS, T0 + 3)).toBeNull();
  });

  it("CI4 청구된 초대는 대체하지 않는다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const a = await invite(stub, B2, T0 + 1);
    await inviteLogin(stub, a.hash, E5, T0 + 2);
    await invite(stub, B2, T0 + 3);
    expect(await invites(stub)).toHaveLength(2);
  });

  it("CI5 상한 10: 열한 번째는 limit이고 쓰기 0", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    for (let i = 0; i < 10; i++) await link(stub, B2, chan(i), T0 + 10 + i * 10);
    const before = await meter(stub);
    expect(await stub.createInvite(B2, "주인", ADMINS, T0 + 1000)).toEqual({ ok: false, code: "limit" });
    expect((await meter(stub)).written).toBe(before.written);
  });

  it("CI6 상한 셈에 기다리는 편집자가 들어간다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    for (let i = 0; i < 9; i++) await link(stub, B2, chan(i), T0 + 10 + i * 10);
    const inv = await invite(stub, B2, T0 + 500);
    await inviteLogin(stub, inv.hash, E5, T0 + 501);
    expect(await stub.createInvite(B2, "주인", ADMINS, T0 + 502)).toEqual({ ok: false, code: "limit" });
  });

  it("CI7 허가가 아니면 not_allowed이고 쓰기 0", async () => {
    const stub = freshStub();
    const before = await meter(stub);
    expect(await stub.createInvite(D4, "주인", ADMINS, T0)).toEqual({ ok: false, code: "not_allowed" });
    expect((await meter(stub)).written).toBe(before.written);
  });

  it("CI8 형식 밖은 bad_request", async () => {
    const stub = freshStub();
    expect(await stub.createInvite("x", "주인", ADMINS, T0)).toEqual({ ok: false, code: "bad_request" });
    expect(await stub.createInvite(B2, "주인", "a1" as never, T0)).toEqual({ ok: false, code: "bad_request" });
  });
});

describe("inviteView", () => {
  it("IV1 열림", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    const before = await meter(stub);
    expect(await stub.inviteView(inv.hash, null, ADMINS, T0 + 2)).toEqual({ ownerChannelId: B2, ownerName: "주인", expiresAt: T0 + 1 + 7 * DAY, relation: "open" });
    expect((await meter(stub)).written).toBe(before.written);
  });

  it("IV2 만료·사용·없음·형식 밖은 null이고 쓰기 0", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0);
    const inv = await invite(stub, B2, T0 + 1);
    const before = await meter(stub);
    expect(await stub.inviteView(inv.hash, null, ADMINS, inv.expiresAt - 1)).not.toBeNull();
    expect(await stub.inviteView(inv.hash, null, ADMINS, inv.expiresAt)).toBeNull();
    expect(await stub.inviteView("f".repeat(64), null, ADMINS, T0 + 2)).toBeNull();
    expect(await stub.inviteView("xyz", null, ADMINS, T0 + 2)).toBeNull();
    expect(await stub.inviteView(inv.hash, "nope", ADMINS, T0 + 2)).toBeNull();
    expect(await stub.inviteView(inv.hash, null, "a1" as never, T0 + 2)).toBeNull();
    expect((await meter(stub)).written).toBe(before.written);
    expect((await accept(stub, inv.hash, C3, T0 + 3)).ok).toBe(true);
    expect(await stub.inviteView(inv.hash, null, ADMINS, T0 + 4)).toBeNull();
  });

  it("IV3 relation: own·already·full, 쓰기 0", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 10);
    const inv = await invite(stub, B2, T0 + 100);
    const b1 = await meter(stub);
    expect((await stub.inviteView(inv.hash, B2, ADMINS, T0 + 101))?.relation).toBe("own");
    expect((await stub.inviteView(inv.hash, C3, ADMINS, T0 + 101))?.relation).toBe("already");
    expect((await stub.inviteView(inv.hash, D4, ADMINS, T0 + 101))?.relation).toBe("open");
    expect((await meter(stub)).written).toBe(b1.written);
    // 보는 사람이 이미 20채널을 맡았다
    const s2 = freshStub();
    await allowAt(s2, B2, T0);
    for (let i = 0; i < 20; i++) {
      await allowAt(s2, chan(i), T0);
      await link(s2, chan(i), C3, T0 + 10 + i * 10);
    }
    const inv2 = await invite(s2, B2, T0 + 1000);
    const b2 = await meter(s2);
    expect((await s2.inviteView(inv2.hash, C3, ADMINS, T0 + 1001))?.relation).toBe("full");
    expect((await meter(s2)).written).toBe(b2.written);
    // 주인의 편집자가 가득 찼다: 보는 사람이 없어도 full
    const s3 = freshStub();
    await allowAt(s3, B2, T0);
    for (let i = 0; i < 9; i++) await link(s3, B2, chan(i), T0 + 10 + i * 10);
    const inv3 = await invite(s3, B2, T0 + 500);
    await seedActive(s3, B2, B2, chan(50), T0 + 600);
    const b3 = await meter(s3);
    expect((await s3.inviteView(inv3.hash, null, ADMINS, T0 + 601))?.relation).toBe("full");
    expect((await meter(s3)).written).toBe(b3.written);
  });

  it("IV4 무효여도 지우지 않는다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    await v2Disallow(stub, B2, T0 + 2);
    await v2Allow(stub, B2, T0 + 5);
    const before = await meter(stub);
    expect(await stub.inviteView(inv.hash, null, ADMINS, T0 + 6)).toBeNull();
    expect(await stub.inviteView(inv.hash, C3, ADMINS, T0 + 6)).toBeNull();
    expect((await meter(stub)).written).toBe(before.written);
    expect(await invites(stub)).toHaveLength(1);
  });
});

describe("acceptInvite", () => {
  it("AC1 수락", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0 + 1);
    const inv = await invite(stub, B2, T0 + 2);
    expect(await accept(stub, inv.hash, C3, T0 + 3)).toEqual({ ok: true, ownerChannelId: B2, ownerName: "주인" });
    expect(await delegations(stub)).toEqual([
      {
        owner_channel_id: B2,
        owner_login_channel_id: B2,
        editor_channel_id: C3,
        owner_name: "주인",
        editor_name: "편집자",
        owner_allowed_at: T0,
        editor_allowed_at: T0 + 1,
        created_at: T0 + 3,
        revoked_at: null,
        revoked_by: null,
      },
    ]);
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AC2 self는 초대를 남긴다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    expect(await accept(stub, inv.hash, B2, T0 + 2)).toEqual({ ok: false, code: "own" });
    expect(await invites(stub)).toHaveLength(1);
  });

  it("AC3 self(대안 B): 로그인 ID 일치와 판정용 ID 일치", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    await altB(stub, C3, D4);
    const inv = await invite(stub, C3, T0 + 1);
    expect((await invites(stub))[0]).toMatchObject({ owner_channel_id: D4, owner_login_channel_id: C3 });
    expect(await accept(stub, inv.hash, C3, T0 + 2)).toEqual({ ok: false, code: "own" });
    await allowAt(stub, F6, T0 + 3);
    await altB(stub, F6, D4);
    expect(await accept(stub, inv.hash, F6, T0 + 4)).toEqual({ ok: false, code: "own" });
  });

  it("AC4 already: 초대가 지워진다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 1);
    const inv = await invite(stub, B2, T0 + 10);
    expect(await accept(stub, inv.hash, C3, T0 + 11)).toEqual({ ok: false, code: "already" });
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AC5 gone: 모르는 해시·두 번째·만료", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0);
    expect(await accept(stub, "f".repeat(64), C3, T0 + 1)).toEqual({ ok: false, code: "gone" });
    const inv = await invite(stub, B2, T0 + 1);
    expect((await accept(stub, inv.hash, C3, T0 + 2)).ok).toBe(true);
    expect(await accept(stub, inv.hash, C3, T0 + 3)).toEqual({ ok: false, code: "gone" });
    const inv2 = await invite(stub, B2, T0 + 4);
    expect(await accept(stub, inv2.hash, F6, inv2.expiresAt)).toEqual({ ok: false, code: "gone" });
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AC6 full(주인): 초대를 남긴다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    for (let i = 0; i < 9; i++) await link(stub, B2, chan(i), T0 + 10 + i * 10);
    const inv = await invite(stub, B2, T0 + 500);
    await seedActive(stub, B2, B2, chan(50), T0 + 600);
    await allowAt(stub, C3, T0 + 601);
    expect(await accept(stub, inv.hash, C3, T0 + 602)).toEqual({ ok: false, code: "full" });
    expect(await invites(stub)).toHaveLength(1);
  });

  it("AC7 full(편집자)", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    for (let i = 0; i < 20; i++) {
      await allowAt(stub, chan(i), T0);
      await link(stub, chan(i), C3, T0 + 10 + i * 10);
    }
    const inv = await invite(stub, B2, T0 + 1000);
    expect(await accept(stub, inv.hash, C3, T0 + 1001)).toEqual({ ok: false, code: "full" });
  });

  it("AC8 되살림: 같은 PK 행이 새 created_at으로 살아난다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 1);
    expect(await stub.leaveDelegation(C3, B2, T0 + 4)).toEqual({ ok: true });
    const inv = await invite(stub, B2, T0 + 5);
    expect((await accept(stub, inv.hash, C3, T0 + 5)).ok).toBe(true);
    const rows = await delegations(stub);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ revoked_at: null, revoked_by: null, created_at: T0 + 5 });
  });

  it("AC9 남이 청구한 초대는 gone이고 행이 남는다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0);
    const inv = await invite(stub, B2, T0 + 1);
    await inviteLogin(stub, inv.hash, E5, T0 + 2);
    expect(await accept(stub, inv.hash, C3, T0 + 3)).toEqual({ ok: false, code: "gone" });
    expect(await invites(stub)).toHaveLength(1);
  });

  it("AC10 not_allowed이고 쓰기 0", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    const before = await meter(stub);
    expect(await accept(stub, inv.hash, D4, T0 + 2)).toEqual({ ok: false, code: "not_allowed" });
    expect((await meter(stub)).written).toBe(before.written);
  });

  it("AC11 관리자 편집자: editor_allowed_at NULL", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    expect((await accept(stub, inv.hash, A1, T0 + 2)).ok).toBe(true);
    expect((await delegations(stub))[0]).toMatchObject({ editor_channel_id: A1, editor_allowed_at: null });
    expect(await mine(stub, A1)).toHaveLength(1);
    // 관리자에서 빠지면(admins에서 빠지고 허가 행도 없음) 그 위임은 비활성이다
    expect(await mine(stub, A1, [C3])).toHaveLength(0);
  });

  it("AC12 관리자 주인의 위임은 admins에서 빠지면 빈다", async () => {
    const stub = freshStub();
    const inv = await invite(stub, A1, T0);
    await allowAt(stub, B2, T0);
    expect((await accept(stub, inv.hash, B2, T0 + 1)).ok).toBe(true);
    expect(await mine(stub, B2)).toHaveLength(1);
    expect(await mine(stub, B2, [C3])).toHaveLength(0);
    expect(await mine(stub, B2, [])).toHaveLength(0);
  });
});

describe("청구·자동 완성(finish 경로)", () => {
  it("CL1 거부 채널이 열면 청구", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 2);
    expect(await inviteLogin(stub, inv.hash, E5, T0 + 3)).toEqual({ type: "denied", invitePending: "주인" });
    expect((await invites(stub))[0]).toMatchObject({ claimed_channel_id: E5, claimed_at: T0 + 3, expires_at: T0 + 3 + 30 * DAY });
    expect(await query(stub, "SELECT channel_id FROM denied")).toEqual([{ channel_id: E5 }]);
    expect(await editorsSide(stub, B2, T0 + 4)).toEqual({
      editors: [{ channelId: E5, channelName: "들어온 채널", since: T0 + 3, status: "pending" }],
      pendingInviteUntil: null,
    });
  });

  it("CL2 허가 채널이 열면 수락", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0);
    const inv = await invite(stub, B2, T0 + 2);
    const r = await inviteLogin(stub, inv.hash, C3, T0 + 3);
    expect(r).toMatchObject({ type: "web", invite: "accepted" });
    expect(await delegations(stub)).toHaveLength(1);
    expect(await query(stub, "SELECT id FROM session WHERE kind = 'web'")).toHaveLength(1);
    expect(await invites(stub)).toHaveLength(0);
  });

  it("CL3 콜백 self·full: 웹 세션은 생긴다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0);
    for (let i = 0; i < 9; i++) await link(stub, B2, chan(i), T0 + 10 + i * 10);
    const inv = await invite(stub, B2, T0 + 400);
    const self = await inviteLogin(stub, inv.hash, B2, T0 + 401);
    expect(self).toMatchObject({ type: "web", invite: "own" });
    await seedActive(stub, B2, B2, chan(60), T0 + 500);
    const full = await inviteLogin(stub, inv.hash, C3, T0 + 501);
    expect(full).toMatchObject({ type: "web", invite: "full" });
    expect(await query(stub, "SELECT id FROM session WHERE kind = 'web'")).toHaveLength(2);
  });

  it("CL4 초대 없는 흐름은 invite 키가 없다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const s = await stub.startWeb("203.0.113.40", 1000, T0);
    if (!s.ok) throw new Error("startWeb");
    const k = await stub.consume(await sha(s.state), await sha(s.binder), T0);
    if (!k.ok) throw new Error("consume");
    const f = await stub.finish(k.flowId, { type: "user", channelId: B2, channelName: "x" }, ADMINS, T0);
    expect(f.type).toBe("web");
    expect("invite" in f).toBe(false);
    const s2 = await stub.startWeb("203.0.113.40", 1000, T0);
    if (!s2.ok) throw new Error("startWeb");
    const k2 = await stub.consume(await sha(s2.state), await sha(s2.binder), T0);
    if (!k2.ok) throw new Error("consume");
    expect(await stub.finish(k2.flowId, { type: "user", channelId: E5, channelName: "x" }, ADMINS, T0)).toEqual({ type: "denied" });
    // webLogin 도우미도 그대로 동작한다
    expect((await webLogin(stub, { channelId: A1 })).cookieToken).toBeTruthy();
  });

  it("CL5 startWebInvite gone: 무효·청구됨·모르는 해시, flow 행 0", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    expect(await stub.startWebInvite("f".repeat(64), "203.0.113.30", 1000, ADMINS, T0 + 2)).toEqual({ ok: false, code: "gone" });
    expect(await stub.startWebInvite("zz", "203.0.113.30", 1000, ADMINS, T0 + 2)).toEqual({ ok: false, code: "gone" });
    await v2Disallow(stub, B2, T0 + 3);
    await v2Allow(stub, B2, T0 + 4);
    expect(await stub.startWebInvite(inv.hash, "203.0.113.30", 1000, ADMINS, T0 + 5)).toEqual({ ok: false, code: "gone" });
    const s2 = freshStub();
    await allowAt(s2, B2, T0);
    const inv2 = await invite(s2, B2, T0 + 1);
    await inviteLogin(s2, inv2.hash, E5, T0 + 2);
    expect(await s2.startWebInvite(inv2.hash, "203.0.113.30", 1000, ADMINS, T0 + 3)).toEqual({ ok: false, code: "gone" });
    expect(await query(stub, "SELECT id FROM flow")).toHaveLength(0);
    expect((await query(s2, "SELECT id FROM flow WHERE status = 'redirected'")).length).toBe(0);
  });

  async function claimed(stub: Stub) {
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 2);
    await inviteLogin(stub, inv.hash, E5, T0 + 3);
    return inv;
  }

  it("AU1 allow가 자동 완성한다", async () => {
    const stub = freshStub();
    await claimed(stub);
    await allowAt(stub, E5, T0 + 10);
    const rows = await delegations(stub);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner_channel_id: B2, editor_channel_id: E5, editor_allowed_at: T0 + 10, owner_allowed_at: T0, editor_name: "들어온 채널" });
    expect((await query(stub, "SELECT added_at FROM allowlist WHERE channel_id = ?", E5))[0]).toEqual({ added_at: T0 + 10 });
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AU2 allowDenied가 자동 완성한다", async () => {
    const stub = freshStub();
    await claimed(stub);
    expect(await stub.allowDenied(E5, A1, T0 + 10, ADMINS)).toBe(true);
    const rows = await delegations(stub);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ editor_channel_id: E5, editor_allowed_at: T0 + 10, owner_allowed_at: T0 });
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AU3 이미 허가된 채널의 청구는 흔적이 없어 다시 허가해도 위임이 되지 않고 지워진다", async () => {
    // 허가는 거부 기록을 지우므로 이미 허가된 채널이 흔적 있는 청구를 가질 길은 없다(구현 중 변경 105 (아))
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, E5, T0 + 1);
    const inv = await invite(stub, B2, T0 + 2);
    await runInDurableObject(stub, (i) => {
      i.db.run("UPDATE invite SET claimed_channel_id = ?, claimed_name = 'e', claimed_at = ?, expires_at = ? WHERE token_hash = ?", E5, T0 + 2, T0 + 2 + 30 * DAY, inv.hash);
    });
    await allowAt(stub, E5, T0 + 20);
    expect(await delegations(stub)).toHaveLength(0);
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AU4 꼬리 인자가 없으면 허가만 되고 초대는 남는다", async () => {
    const stub = freshStub();
    await claimed(stub);
    await stub.allow(E5, "", A1, T0 + 10);
    expect(await query(stub, "SELECT channel_id FROM allowlist WHERE channel_id = ?", E5)).toHaveLength(1);
    expect(await delegations(stub)).toHaveLength(0);
    expect(await invites(stub)).toHaveLength(1);
  });

  it("AU5 같은 트랜잭션: 위임 쓰기가 실패하면 허가도 되돌아간다", async () => {
    const stub = freshStub();
    await claimed(stub);
    await runInDurableObject(stub, (i) => i.db.run("DROP TABLE delegation"));
    // DO 안에서 직접 불러 던짐을 잡는다(RPC 경계로 나가면 러너가 미처리 거절로 보고한다)
    const threw = await runInDurableObject(stub, async (inst) => {
      try {
        await inst.allow(E5, "", A1, T0 + 10, ADMINS);
        return false;
      } catch {
        return true;
      }
    });
    expect(threw).toBe(true);
    expect(await query(stub, "SELECT channel_id FROM allowlist WHERE channel_id = ?", E5)).toHaveLength(0);
    expect(await query(stub, "SELECT channel_id FROM denied WHERE channel_id = ?", E5)).toHaveLength(1);
  });

  it("AU6 상한이면 위임 없이 초대를 지운다", async () => {
    const stub = freshStub();
    await claimed(stub);
    for (let i = 0; i < 10; i++) await seedActive(stub, B2, B2, chan(i), T0 + 100 + i * 10);
    await allowAt(stub, E5, T0 + 500);
    expect((await delegations(stub)).filter((r) => r.editor_channel_id === E5)).toHaveLength(0);
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AU7 청구한 초대 자신은 상한 셈에서 뺀다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    for (let i = 0; i < 9; i++) await link(stub, B2, chan(i), T0 + 10 + i * 10);
    const inv = await invite(stub, B2, T0 + 500);
    await inviteLogin(stub, inv.hash, E5, T0 + 501);
    await allowAt(stub, E5, T0 + 600);
    expect((await delegations(stub)).filter((r) => r.editor_channel_id === E5)).toHaveLength(1);
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AU8 같은 채널의 재청구는 멱등이고 다른 채널은 청구하지 못한다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    // 청구 전에 흐름 셋을 열어 둔다(청구된 초대는 startWebInvite가 gone으로 막는다)
    const flows: string[] = [];
    for (let n = 0; n < 3; n++) {
      const s = await stub.startWebInvite(inv.hash, "203.0.113.31", 1000, ADMINS, T0 + 2);
      if (!s.ok) throw new Error(s.code);
      const k = await stub.consume(await sha(s.state), await sha(s.binder), T0 + 2);
      if (!k.ok) throw new Error(k.code);
      flows.push(k.flowId);
    }
    const user = (channelId: string) => ({ type: "user", channelId, channelName: "들어온 채널" }) as const;
    expect(await stub.finish(flows[0]!, user(E5), ADMINS, T0 + 3)).toEqual({ type: "denied", invitePending: "주인" });
    const before = (await invites(stub))[0]!;
    expect(await stub.finish(flows[1]!, user(E5), ADMINS, T0 + 50)).toEqual({ type: "denied", invitePending: "주인" });
    const after = (await invites(stub))[0]!;
    expect(after.claimed_at).toBe(before.claimed_at);
    expect(after.expires_at).toBe(before.expires_at);
    expect(await stub.finish(flows[2]!, user(F6), ADMINS, T0 + 51)).toEqual({ type: "denied" });
    expect((await invites(stub))[0]!.claimed_channel_id).toBe(E5);
  });
});

describe("removeEditor·leaveDelegation·목록", () => {
  it("RM1 회수", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 1);
    expect(await stub.removeEditor(B2, C3, T0 + 9)).toEqual({ ok: true });
    expect((await delegations(stub))[0]).toMatchObject({ revoked_at: T0 + 9, revoked_by: "owner" });
    expect(await mine(stub, C3)).toEqual([]);
    const before = await meter(stub);
    expect(await stub.removeEditor(B2, C3, T0 + 10)).toEqual({ ok: false, code: "not_found" });
    expect((await meter(stub)).written).toBe(before.written);
    expect(await stub.removeEditor("x", C3, T0 + 10)).toEqual({ ok: false, code: "not_found" });
  });

  it("RM2 기다리는 편집자 빼기", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    await inviteLogin(stub, inv.hash, E5, T0 + 2);
    expect(await stub.removeEditor(B2, E5, T0 + 3)).toEqual({ ok: true });
    expect(await invites(stub)).toHaveLength(0);
  });

  it("LV1 그만두기", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 1);
    expect(await stub.leaveDelegation(C3, B2, T0 + 9)).toEqual({ ok: true });
    expect((await delegations(stub))[0]).toMatchObject({ revoked_by: "editor", revoked_at: T0 + 9 });
    expect(await stub.leaveDelegation(C3, B2, T0 + 10)).toEqual({ ok: false, code: "not_found" });
    expect(await stub.leaveDelegation("x", B2, T0 + 10)).toEqual({ ok: false, code: "not_found" });
  });

  it("LS1 delegationsOf는 20개까지, since 오름차순", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    for (let i = 0; i < 20; i++) {
      await allowAt(stub, chan(i), T0);
      const inv = await invite(stub, chan(i), T0 + 100 + i * 10);
      expect((await accept(stub, inv.hash, C3, T0 + 101 + i * 10)).ok).toBe(true);
    }
    await allowAt(stub, chan(20), T0);
    const inv = await invite(stub, chan(20), T0 + 1000);
    expect(await accept(stub, inv.hash, C3, T0 + 1001)).toEqual({ ok: false, code: "full" });
    await seedActive(stub, chan(20), chan(20), C3, T0 + 2000);
    const list = await mine(stub, C3);
    expect(list).toHaveLength(20);
    expect(list.map((d) => d.since)).toEqual([...list.map((d) => d.since)].sort((x, y) => x - y));
    expect(list.map((d) => d.channelId)).not.toContain(chan(20));
  });

  it("LS2 무효 행이 유효 행을 밀어내지 않는다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await runInDurableObject(stub, (i) => {
      for (let n = 0; n < 20; n++) {
        i.db.run(
          "INSERT INTO delegation (owner_channel_id, owner_login_channel_id, editor_channel_id, owner_name, editor_name, owner_allowed_at, editor_allowed_at, created_at) VALUES (?, ?, ?, 'x', 'y', ?, ?, ?)",
          chan(n),
          chan(n),
          C3,
          T0 + 999,
          T0 + 999,
          T0 + n,
        );
      }
    });
    await link(stub, B2, C3, T0 + 100);
    expect(await mine(stub, C3)).toEqual([{ channelId: B2, channelName: "주인", since: T0 + 102 }]);
  });

  it("LS3 recentDelegationFor: 2분 창", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0);
    const inv = await invite(stub, B2, T0 + 1);
    await accept(stub, inv.hash, C3, T0 + 3);
    expect(await stub.recentDelegationFor(C3, ADMINS, T0 + 3 + DONE_WINDOW_MS - 1)).toEqual({ channelId: B2, channelName: "주인", since: T0 + 3 });
    expect(await stub.recentDelegationFor(C3, ADMINS, T0 + 3 + DONE_WINDOW_MS)).toBeNull();
    expect(await stub.recentDelegationFor("x", ADMINS, T0 + 4)).toBeNull();
  });

  it("LS4 editorsOf 모양: 활성, 기다림, 미청구 만료", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 10);
    const a = await invite(stub, B2, T0 + 100);
    await inviteLogin(stub, a.hash, E5, T0 + 101);
    const b = await invite(stub, B2, T0 + 200);
    const v = await editorsSide(stub, B2, T0 + 300);
    expect(v.editors.map((e) => [e.channelId, e.status])).toEqual([
      [C3, "active"],
      [E5, "pending"],
    ]);
    expect(v.pendingInviteUntil).toBe(b.expiresAt);
  });
});

describe("disallow 확장", () => {
  it("DA1 주인 제외", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 1);
    const a = await invite(stub, B2, T0 + 10);
    await inviteLogin(stub, a.hash, E5, T0 + 11);
    await invite(stub, B2, T0 + 12);
    expect(await stub.disallow(B2, A1, ADMINS, T0 + 20)).toEqual({ ok: true });
    expect(await delegations(stub)).toHaveLength(0);
    expect(await invites(stub)).toHaveLength(0);
  });

  it("DA2 편집자 제외", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 1);
    expect(await stub.disallow(C3, A1, ADMINS, T0 + 20)).toEqual({ ok: true });
    expect(await delegations(stub)).toHaveLength(0);
  });

  it("DA3 대안 B: 로그인 ID로 지운다", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    await altB(stub, C3, D4);
    const inv = await invite(stub, C3, T0 + 1);
    await allowAt(stub, B2, T0 + 2);
    expect((await accept(stub, inv.hash, B2, T0 + 3)).ok).toBe(true);
    expect((await delegations(stub))[0]).toMatchObject({ owner_channel_id: D4, owner_login_channel_id: C3 });
    expect(await stub.disallow(D4, A1, ADMINS, T0 + 4)).toEqual({ ok: false, code: "not_found" });
    expect(await delegations(stub)).toHaveLength(1);
    expect(await stub.disallow(C3, A1, ADMINS, T0 + 5)).toEqual({ ok: true });
    expect(await delegations(stub)).toHaveLength(0);
  });
});

describe("키 규칙(대안 B)", () => {
  async function kb(stub: Stub) {
    await allowAt(stub, C3, T0);
    await altB(stub, C3, D4);
    const inv = await invite(stub, C3, T0 + 1);
    await allowAt(stub, B2, T0 + 2);
    expect((await accept(stub, inv.hash, B2, T0 + 3)).ok).toBe(true);
  }

  it("KB1 묶음·rotate·me에는 판정용 ID가 실린다", async () => {
    const stub = freshStub();
    await kb(stub);
    const l = await appLogin(stub, { channelId: B2, now: T0 + 10 });
    expect(l.bundle.delegatedChannels).toEqual([{ channelId: D4, channelName: "주인", since: T0 + 3 }]);
    const r = await stub.rotate(await sha(l.bundle.refreshToken), ADMINS, T0 + 20);
    if (!r.ok) throw new Error(r.code);
    expect(r.bundle.delegatedChannels).toEqual([{ channelId: D4, channelName: "주인", since: T0 + 3 }]);
    const m = await meOf(stub, r.bundle.accessToken, T0 + 21);
    expect(m.delegatedChannels[0]!.channelId).toBe(D4);
  });

  it("KB2 주인 쪽 me는 판정용 ID로 편집자를 찾는다", async () => {
    const stub = freshStub();
    await kb(stub);
    const l = await appLogin(stub, { channelId: C3, now: T0 + 10 });
    const m = await meOf(stub, l.bundle.accessToken, T0 + 11);
    expect(m.editors.map((e) => e.channelId)).toEqual([B2]);
  });

  it("KB3 V2 SQL로 제외·재허가하면 위임이 빈다", async () => {
    const stub = freshStub();
    await kb(stub);
    const l = await appLogin(stub, { channelId: B2, now: T0 + 10 });
    await v2Disallow(stub, C3, T0 + 20);
    await v2Allow(stub, C3, T0 + 50);
    await altB(stub, C3, D4);
    const m = await meOf(stub, l.bundle.accessToken, T0 + 51).catch(() => null);
    // B2의 세션은 그대로 살아 있다(B2를 제외하지 않았다)
    expect(m?.delegatedChannels).toEqual([]);
  });
});

describe("V2 롤백 호환(위임)", () => {
  async function setup(stub: Stub) {
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0 + 1);
    const inv = await invite(stub, B2, T0 + 2);
    expect((await accept(stub, inv.hash, C3, T0 + 3)).ok).toBe(true);
  }

  it("RB1 주인 쪽: 판정에서 빠지고 sweep이 지운다", async () => {
    const stub = freshStub();
    await setup(stub);
    await v2Disallow(stub, B2, T0 + 4);
    await v2Allow(stub, B2, T0 + 5);
    expect(await mine(stub, C3)).toEqual([]);
    expect((await editorsSide(stub, B2, T0 + 6)).editors).toEqual([]);
    expect(await delegations(stub)).toHaveLength(1);
    await sweepNow(stub, T0 + 6);
    expect(await delegations(stub)).toHaveLength(0);
  });

  it("RB2 편집자 쪽", async () => {
    const stub = freshStub();
    await setup(stub);
    await v2Disallow(stub, C3, T0 + 4);
    await v2Allow(stub, C3, T0 + 5);
    expect(await mine(stub, C3)).toEqual([]);
    expect((await editorsSide(stub, B2, T0 + 6)).editors).toEqual([]);
    expect(await delegations(stub)).toHaveLength(1);
    await sweepNow(stub, T0 + 6);
    expect(await delegations(stub)).toHaveLength(0);
  });

  it("RB3 대안 B", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    await altB(stub, C3, D4);
    await allowAt(stub, B2, T0 + 1);
    const inv = await invite(stub, C3, T0 + 2);
    expect((await accept(stub, inv.hash, B2, T0 + 3)).ok).toBe(true);
    await v2Disallow(stub, C3, T0 + 4);
    await v2Allow(stub, C3, T0 + 5);
    await altB(stub, C3, D4);
    expect(await mine(stub, B2)).toEqual([]);
    await sweepNow(stub, T0 + 6);
    expect(await delegations(stub)).toHaveLength(0);
  });

  it("RB4 음성 대조: 바뀌지 않으면 활성이고 sweep이 지우지 않는다", async () => {
    const stub = freshStub();
    await setup(stub);
    expect(await mine(stub, C3)).toHaveLength(1);
    await sweepNow(stub, T0 + 6);
    expect(await delegations(stub)).toHaveLength(1);
  });

  it("RB5 같은 ms에 재허가하면 활성으로 남는다(받아들인 구멍, 운영 롤백 대상은 V3 직전까지)", async () => {
    const stub = freshStub();
    await setup(stub);
    await v2Disallow(stub, B2, T0 + 4);
    await v2Allow(stub, B2, T0);
    expect(await mine(stub, C3)).toHaveLength(1);
  });

  it("RB6 관리자 NULL 함정: 관리자였던 채널이 admins에서 빠지면 위임이 빈다", async () => {
    const stub = freshStub();
    const inv = await invite(stub, A1, T0);
    await allowAt(stub, B2, T0);
    await accept(stub, inv.hash, B2, T0 + 1);
    // 행 없음 ∧ allowed_at NULL이 통과하는 함정(null === null)이 없다
    expect(await mine(stub, B2, [D4])).toEqual([]);
    expect(await mine(stub, B2)).toHaveLength(1);
  });
});

describe.each([
  ["보통", B2, B2],
  ["대안 B", C3, D4],
] as const)("초대 롤백 호환(N3) %s", (_name, L, J) => {
  const prepare = async (stub: Stub) => {
    await allowAt(stub, L, T0);
    if (L !== J) await altB(stub, L, J);
    await allowAt(stub, F6, T0 + 1);
  };
  const reAllow = async (stub: Stub, at: number) => {
    await v2Disallow(stub, L, at);
    await v2Allow(stub, L, at + 1);
    if (L !== J) await altB(stub, L, J);
  };

  it("N3-i 미청구: 무효 초대는 열리지도 수락되지도 않는다", async () => {
    const stub = freshStub();
    await prepare(stub);
    const inv = await invite(stub, L, T0 + 2);
    await reAllow(stub, T0 + 3);
    expect(await stub.inviteView(inv.hash, null, ADMINS, T0 + 6)).toBeNull();
    expect(await accept(stub, inv.hash, F6, T0 + 6)).toEqual({ ok: false, code: "gone" });
    expect(await delegations(stub)).toHaveLength(0);
    expect(await invites(stub)).toHaveLength(0);
    const l = await appLogin(stub, { channelId: L, now: T0 + 10 });
    expect((await meOf(stub, l.bundle.accessToken, T0 + 11)).pendingInviteUntil).toBeNull();
  });

  it("N3-ii 청구됨: allow가 위임을 만들지 않고 초대를 지운다", async () => {
    const stub = freshStub();
    await prepare(stub);
    const inv = await invite(stub, L, T0 + 2);
    await inviteLogin(stub, inv.hash, E5, T0 + 3);
    await reAllow(stub, T0 + 4);
    await allowAt(stub, E5, T0 + 10);
    expect(await delegations(stub)).toHaveLength(0);
    expect(await invites(stub)).toHaveLength(0);
    const l = await appLogin(stub, { channelId: L, now: T0 + 20 });
    expect((await meOf(stub, l.bundle.accessToken, T0 + 21)).editors.map((e) => e.channelId)).not.toContain(E5);
  });

  it("N3-iii 청구 전에 주인이 바뀌었다", async () => {
    const stub = freshStub();
    await prepare(stub);
    const inv = await invite(stub, L, T0 + 2);
    const s = await stub.startWebInvite(inv.hash, "203.0.113.30", 1000, ADMINS, T0 + 3);
    if (!s.ok) throw new Error(s.code);
    const k = await stub.consume(await sha(s.state), await sha(s.binder), T0 + 3);
    if (!k.ok) throw new Error(k.code);
    await reAllow(stub, T0 + 4);
    const r = await stub.finish(k.flowId, { type: "user", channelId: E5, channelName: "x" }, ADMINS, T0 + 7);
    expect(r).toEqual({ type: "denied" });
    expect("invitePending" in r).toBe(false);
    expect(await invites(stub)).toHaveLength(0);
    expect(await delegations(stub)).toHaveLength(0);
    expect(await stub.startWebInvite(inv.hash, "203.0.113.30", 1000, ADMINS, T0 + 8)).toEqual({ ok: false, code: "gone" });
  });

  it("N3-iv 음성 대조: 바뀌지 않으면 셋 모두 정상이다", async () => {
    const a = freshStub();
    await prepare(a);
    const ia = await invite(a, L, T0 + 2);
    expect((await accept(a, ia.hash, F6, T0 + 3)).ok).toBe(true);
    const b = freshStub();
    await prepare(b);
    const ib = await invite(b, L, T0 + 2);
    await inviteLogin(b, ib.hash, E5, T0 + 3);
    await allowAt(b, E5, T0 + 10);
    expect(await delegations(b)).toHaveLength(1);
    const c = freshStub();
    await prepare(c);
    const ic = await invite(c, L, T0 + 2);
    expect(await inviteLogin(c, ic.hash, E5, T0 + 3)).toHaveProperty("invitePending");
  });

  it("N3-vi 무효 청구 열 개가 상한을 막지 않는다", async () => {
    const stub = freshStub();
    await prepare(stub);
    for (let i = 0; i < 10; i++) {
      const inv = await invite(stub, L, T0 + 10 + i * 10);
      await inviteLogin(stub, inv.hash, chan(0x40 + i), T0 + 11 + i * 10);
    }
    expect(await stub.createInvite(L, "주인", ADMINS, T0 + 200)).toEqual({ ok: false, code: "limit" });
    await reAllow(stub, T0 + 300);
    const r = await stub.createInvite(L, "주인", ADMINS, T0 + 400);
    expect(r.ok).toBe(true);
  });
});

describe("N3-v 다시 SELECT하지 않는다", () => {
  // 허가 행이 세대다: 관리자여도 허가 행이 있으면 그 added_at을 적는다(구현 중 변경 105 (라), 처음의 "관리자는 NULL"을 뒤집었다)
  it("(1) 허가 행도 가진 관리자 주인의 owner_allowed_at은 그 added_at이고 위임이 그대로 옮긴다", async () => {
    const stub = freshStub();
    await allowAt(stub, A1, T0);
    await allowAt(stub, C3, T0 + 1);
    const inv = await invite(stub, A1, T0 + 2);
    expect((await invites(stub))[0]!.owner_allowed_at).toBe(T0);
    expect((await accept(stub, inv.hash, C3, T0 + 3)).ok).toBe(true);
    expect((await delegations(stub))[0]!.owner_allowed_at).toBe(T0);
  });

  it.each([
    ["보통", B2, B2],
    ["대안 B", C3, D4],
  ] as const)("(2) 초대 뒤 허가 시각이 바뀌면 gone %s", async (_n, L, J) => {
    const stub = freshStub();
    await allowAt(stub, L, T0);
    if (L !== J) await altB(stub, L, J);
    await allowAt(stub, F6, T0 + 1);
    const inv = await invite(stub, L, T0 + 2);
    expect((await invites(stub))[0]).toMatchObject({ owner_channel_id: J, owner_login_channel_id: L, owner_allowed_at: T0 });
    await runInDurableObject(stub, (i) => i.db.run("UPDATE allowlist SET added_at = added_at + 1 WHERE channel_id = ?", L));
    expect(await accept(stub, inv.hash, F6, T0 + 3)).toEqual({ ok: false, code: "gone" });
    expect(await delegations(stub)).toHaveLength(0);
  });

  it.each([
    ["보통", B2, B2],
    ["대안 B", C3, D4],
  ] as const)("(3) 관리자가 된 주인에게도 초대 값 그대로 옮긴다 %s", async (_n, L, J) => {
    const stub = freshStub();
    await allowAt(stub, L, T0);
    if (L !== J) await altB(stub, L, J);
    await allowAt(stub, F6, T0 + 1);
    const inv = await invite(stub, L, T0 + 2);
    expect((await invites(stub))[0]).toMatchObject({ owner_channel_id: J, owner_login_channel_id: L, owner_allowed_at: T0 });
    // admins에는 로그인 ID를 넣는다(관리자 판정은 로그인 ID로 한다)
    const r = await stub.acceptInvite(inv.hash, F6, "편집자", [A1, L], T0 + 3);
    expect(r.ok).toBe(true);
    expect((await delegations(stub))[0]).toMatchObject({ owner_channel_id: J, owner_login_channel_id: L, owner_allowed_at: T0 });
  });
});

describe("대안 B 판정용 ID 바꾸기", () => {
  // 손 SQL로 allowlist.owner_channel_id를 바꾸면 옛 판정용 ID로 맺은 위임·초대는 무효다(구현 중 변경 105 (라))
  it("JB1 맺은 뒤 판정용 ID가 바뀌면 위임이 빈다", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    await altB(stub, C3, D4);
    await allowAt(stub, B2, T0 + 1);
    const inv = await invite(stub, C3, T0 + 2);
    expect((await accept(stub, inv.hash, B2, T0 + 3)).ok).toBe(true);
    expect(await mine(stub, B2)).toEqual([{ channelId: D4, channelName: "주인", since: T0 + 3 }]);
    await altB(stub, C3, F6);
    expect(await mine(stub, B2)).toEqual([]);
    expect((await editorsSide(stub, D4, T0 + 4)).editors).toEqual([]);
    await sweepNow(stub, T0 + 5);
    expect(await delegations(stub)).toHaveLength(0);
  });

  it("JB2 판정용 ID가 NULL로 돌아가도(= 로그인 ID) 옛 위임은 빈다", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    await altB(stub, C3, D4);
    await allowAt(stub, B2, T0 + 1);
    const inv = await invite(stub, C3, T0 + 2);
    expect((await accept(stub, inv.hash, B2, T0 + 3)).ok).toBe(true);
    await runInDurableObject(stub, (i) => i.db.run("UPDATE allowlist SET owner_channel_id = NULL WHERE channel_id = ?", C3));
    expect(await mine(stub, B2)).toEqual([]);
  });

  it("JB3 초대 뒤 판정용 ID가 바뀌면 열리지도 수락되지도 않고 sweep이 지운다", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    await altB(stub, C3, D4);
    await allowAt(stub, B2, T0 + 1);
    const inv = await invite(stub, C3, T0 + 2);
    await altB(stub, C3, F6);
    expect(await stub.inviteView(inv.hash, null, ADMINS, T0 + 3)).toBeNull();
    expect(await accept(stub, inv.hash, B2, T0 + 3)).toEqual({ ok: false, code: "gone" });
    expect(await delegations(stub)).toHaveLength(0);
    const inv2 = await invite(stub, C3, T0 + 4);
    await altB(stub, C3, D4);
    await sweepNow(stub, T0 + 5);
    expect((await invites(stub)).map((r) => r.token_hash)).not.toContain(inv2.hash);
  });

  it("JB4 음성 대조: 허가 행 없는 관리자 주인과 판정용 ID를 가진 관리자 주인은 활성이다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const a = await invite(stub, A1, T0 + 1);
    expect((await accept(stub, a.hash, B2, T0 + 2)).ok).toBe(true);
    expect(await mine(stub, B2)).toEqual([{ channelId: A1, channelName: "주인", since: T0 + 2 }]);
    await sweepNow(stub, T0 + 3);
    expect(await mine(stub, B2)).toHaveLength(1);
    const s2 = freshStub();
    await allowAt(s2, A1, T0);
    await altB(s2, A1, D4);
    await allowAt(s2, B2, T0);
    const b = await invite(s2, A1, T0 + 1);
    expect((await invites(s2))[0]).toMatchObject({ owner_channel_id: D4, owner_allowed_at: T0 });
    expect((await accept(s2, b.hash, B2, T0 + 2)).ok).toBe(true);
    expect(await mine(s2, B2)).toEqual([{ channelId: D4, channelName: "주인", since: T0 + 2 }]);
  });
});

describe("받아들인 구멍(구현 중 변경 105)", () => {
  it("AH1 허가 행 없는 관리자로 맺은 위임은 강등되면 비고, sweep은 지우지 않으며, 다시 관리자가 되면 되살아난다", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    const inv = await invite(stub, A1, T0 + 1);
    expect((await accept(stub, inv.hash, C3, T0 + 2)).ok).toBe(true);
    expect(await mine(stub, C3, [F6])).toEqual([]);
    await sweepNow(stub, T0 + 400 * DAY);
    expect(await delegations(stub)).toHaveLength(1);
    expect(await mine(stub, C3, [A1])).toHaveLength(1);
  });
});

describe("남은 청구가 회수된 위임을 되살리지 않는다(Codex 리뷰)", () => {
  // 배포 창의 옛 isolate처럼 꼬리 인자 없이 허가하면 청구가 남는다(AU4)
  async function staleClaim(stub: Stub) {
    await allowAt(stub, B2, T0);
    const i1 = await invite(stub, B2, T0 + 1);
    expect(await inviteLogin(stub, i1.hash, E5, T0 + 2)).toHaveProperty("invitePending");
    await stub.allow(E5, "", A1, T0 + 3);
    return i1;
  }

  it("SC4 흔적 없는 청구는 청구자 자신도 수락할 수 없다(닫힌 쪽 실패: 새 초대로 다시 한다)", async () => {
    const stub = freshStub();
    const i1 = await staleClaim(stub);
    expect(await accept(stub, i1.hash, E5, T0 + 9)).toEqual({ ok: false, code: "gone" });
    expect(await invites(stub)).toHaveLength(0);
    const i2 = await invite(stub, B2, T0 + 10);
    expect((await accept(stub, i2.hash, E5, T0 + 11)).ok).toBe(true);
  });

  it("SC1 다른 초대를 수락하고 그만둔 뒤 메모만 바꾸는 허가가 위임을 되살리지 않는다", async () => {
    const stub = freshStub();
    await staleClaim(stub);
    const i2 = await invite(stub, B2, T0 + 4);
    expect((await accept(stub, i2.hash, E5, T0 + 5)).ok).toBe(true);
    // 수락이 같은 쌍의 남은 청구를 지운다
    expect((await invites(stub)).filter((r) => r.claimed_channel_id === E5)).toHaveLength(0);
    expect(await stub.leaveDelegation(E5, B2, T0 + 6)).toEqual({ ok: true });
    expect((await editorsSide(stub, B2, T0 + 7)).editors).toEqual([]);
    await stub.allow(E5, "메모", A1, T0 + 8, ADMINS);
    expect(await mine(stub, E5)).toEqual([]);
  });

  it("SC2 그만두기는 같은 쌍의 청구를 지운다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, E5, T0 + 1);
    // 활성 위임 옆에 청구가 남은 상태(손 SQL): 그만두기가 함께 지운다
    const inv = await invite(stub, B2, T0 + 10);
    await runInDurableObject(stub, (i) => i.db.run("UPDATE invite SET claimed_channel_id = ?, claimed_name = 'e', claimed_at = ? WHERE token_hash = ?", E5, T0 + 11, inv.hash));
    expect(await stub.leaveDelegation(E5, B2, T0 + 12)).toEqual({ ok: true });
    expect(await invites(stub)).toHaveLength(0);
  });

  it("SC3 흔적 없는 청구는 기다림으로 보이지 않고 허가가 위임으로 바꾸지 않으며 sweep이 지운다", async () => {
    const stub = freshStub();
    await staleClaim(stub);
    expect((await editorsSide(stub, B2, T0 + 4)).editors).toEqual([]);
    await allowAt(stub, E5, T0 + 5);
    expect(await mine(stub, E5)).toEqual([]);
    await sweepNow(stub, T0 + 6);
    expect(await invites(stub)).toHaveLength(0);
  });
});

describe("허가 제외는 청구의 취소 경계다(구현 중 변경 105 (아))", () => {
  async function claimedE5(stub: Stub) {
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    expect(await inviteLogin(stub, inv.hash, E5, T0 + 2)).toHaveProperty("invitePending");
    return inv;
  }

  it("AH2 V2로 되돌린 동안 허가·제외를 거친 청구는 V3의 다음 허가에서 위임이 되지 않는다", async () => {
    const stub = freshStub();
    await claimedE5(stub);
    await v2Allow(stub, E5, T0 + 3);
    await v2Disallow(stub, E5, T0 + 4);
    await allowAt(stub, E5, T0 + 5);
    expect(await mine(stub, E5)).toEqual([]);
    expect(await invites(stub)).toHaveLength(0);
  });

  it("AH3 V2에서 제외 뒤 다시 거부돼도(새 first_at) 옛 청구는 쓰이지 않는다", async () => {
    const stub = freshStub();
    await claimedE5(stub);
    await v2Allow(stub, E5, T0 + 3);
    await v2Disallow(stub, E5, T0 + 4);
    // V2 finish의 recordDenied 흉내: 새 행이라 first_at = 그때
    await runInDurableObject(stub, (i) => i.db.run("INSERT INTO denied (channel_id, channel_name, first_at, last_at, attempts) VALUES (?, 'e', ?, ?, 1)", E5, T0 + 5, T0 + 5));
    expect((await editorsSide(stub, B2, T0 + 6)).editors).toEqual([]);
    expect(await stub.allowDenied(E5, A1, T0 + 7, ADMINS)).toBe(true);
    expect(await mine(stub, E5)).toEqual([]);
  });

  it("AH4 음성 대조: 흔적이 이어지면(거부 기록이 청구 전부터 남아 있으면) 허가가 위임을 만든다", async () => {
    const stub = freshStub();
    await claimedE5(stub);
    expect((await editorsSide(stub, B2, T0 + 3)).editors.map((e) => e.status)).toEqual(["pending"]);
    await allowAt(stub, E5, T0 + 4);
    expect(await mine(stub, E5)).toHaveLength(1);
  });
});

describe("관리자로 맺은 관계의 세대(구현 중 변경 105 (라))", () => {
  const linkAs = async (stub: Stub, owner: string, editor: string, t: number, admins: readonly string[]) => {
    await stub.allow(editor, "", A1, t, admins);
    const r = await stub.createInvite(owner, "주인", admins, t + 1);
    if (!r.ok) return false;
    return (await stub.acceptInvite(await sha(r.token), editor, "편집자", admins, t + 2)).ok;
  };
  /** 주인 O의 권한을 받는 편집자 수 = O의 목록 길이 ≤ 10 */
  const invariant = async (stub: Stub, owner: string, editors: readonly string[], admins: readonly string[], now: number) => {
    let delegated = 0;
    for (const e of editors) if ((await mine(stub, e, admins)).some((d) => d.channelId === owner)) delegated++;
    const listed = (await editorsSide(stub, owner, now, admins)).editors.length;
    expect(delegated).toBe(listed);
    expect(listed).toBeLessThanOrEqual(10);
  };
  const all = Array.from({ length: 20 }, (_, i) => chan(i));

  it("GN1 허가 행이 있는 주인: 관리자 시절 관계와 강등 뒤 관계가 함께 살아나 상한을 넘지 않는다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const promoted = [A1, B2];
    for (let i = 0; i < 10; i++) expect(await linkAs(stub, B2, chan(i), T0 + 10 + i * 10, promoted)).toBe(true);
    // 강등(허가 행은 그대로): 같은 허가 세대라 관계가 살아 있고 열한 번째는 상한이다
    expect(await linkAs(stub, B2, chan(10), T0 + 1000, ADMINS)).toBe(false);
    expect((await editorsSide(stub, B2, T0 + 1001)).editors).toHaveLength(10);
    for (let i = 11; i < 20; i++) await linkAs(stub, B2, chan(i), T0 + 1000 + i * 10, ADMINS);
    await invariant(stub, B2, all, ADMINS, T0 + 2000);
    await invariant(stub, B2, all, promoted, T0 + 2000);
    await sweepNow(stub, T0 + 400 * DAY);
    await invariant(stub, B2, all, promoted, T0 + 400 * DAY);
  });

  it("GN2 허가 행 없는 관리자 주인: 강등 뒤 허가 행이 생기면 옛 관계는 끝나고 sweep이 지운다", async () => {
    const stub = freshStub();
    const promoted = [A1, D4];
    for (let i = 0; i < 10; i++) expect(await linkAs(stub, D4, chan(i), T0 + 10 + i * 10, promoted)).toBe(true);
    await allowAt(stub, D4, T0 + 900);
    for (let i = 10; i < 20; i++) await linkAs(stub, D4, chan(i), T0 + 1000 + i * 10, ADMINS);
    await invariant(stub, D4, all, promoted, T0 + 2000);
    await sweepNow(stub, T0 + 2001);
    expect((await delegations(stub)).filter((r) => r.owner_channel_id === D4)).toHaveLength(10);
    await invariant(stub, D4, all, promoted, T0 + 2002);
  });

  it("GN4 허가 행이 있는 관리자 편집자: 강등 뒤에도 같은 세대라 스물한 번째는 full이고 재등록 뒤에도 20을 넘지 않는다", async () => {
    const stub = freshStub();
    await allowAt(stub, D4, T0);
    const promoted = [A1, D4];
    const owners = Array.from({ length: 21 }, (_, i) => chan(100 + i));
    const acceptFrom = async (owner: string, t: number, admins: readonly string[]) => {
      await allowAt(stub, owner, t);
      const r = await stub.createInvite(owner, "주인", admins, t + 1);
      if (!r.ok) throw new Error(r.code);
      return stub.acceptInvite(await sha(r.token), D4, "편집자", admins, t + 2);
    };
    for (let i = 0; i < 20; i++) expect((await acceptFrom(owners[i]!, T0 + 10 + i * 10, promoted)).ok).toBe(true);
    expect(await mine(stub, D4, ADMINS)).toHaveLength(20);
    expect(await acceptFrom(owners[20]!, T0 + 1000, ADMINS)).toEqual({ ok: false, code: "full" });
    const active = async (admins: readonly string[]) => {
      let n = 0;
      for (const o of owners) if ((await editorsSide(stub, o, T0 + 2000, admins)).editors.some((e) => e.channelId === D4 && e.status === "active")) n++;
      return n;
    };
    expect(await active(promoted)).toBe((await mine(stub, D4, promoted)).length);
    expect(await active(promoted)).toBeLessThanOrEqual(20);
  });

  // 반대 당사자의 NULL 세대(허가 행 없는 관리자)가 강등 동안 빈 자리를 다른 관계가 채운 뒤 재등록으로 되살아나는 경우(구현 중 변경 105 (타))
  it("GN5 주인 쪽: 허가 행 없는 관리자 편집자의 관계가 되살아나도 권한을 받는 편집자 수 = 주인 목록 길이 ≤ 10", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const promoted = [A1, D4];
    const r = await stub.createInvite(B2, "주인", promoted, T0 + 1);
    if (!r.ok) throw new Error(r.code);
    expect((await stub.acceptInvite(await sha(r.token), D4, "편집자", promoted, T0 + 2)).ok).toBe(true);
    for (let i = 0; i < 9; i++) expect(await linkAs(stub, B2, chan(i), T0 + 10 + i * 10, promoted)).toBe(true);
    // 강등: D4 관계가 비어 목록은 9명, 열 번째 자리를 chan(9)가 채운다
    expect((await editorsSide(stub, B2, T0 + 500)).editors).toHaveLength(9);
    expect(await linkAs(stub, B2, chan(9), T0 + 1000, ADMINS)).toBe(true);
    await sweepNow(stub, T0 + 1100);
    const eds = [D4, ...Array.from({ length: 10 }, (_, i) => chan(i))];
    await invariant(stub, B2, eds, ADMINS, T0 + 1200);
    await invariant(stub, B2, eds, promoted, T0 + 1200);
    // 되살아난 쪽이 먼저 맺은 관계라 가장 늦은 chan(9)가 잠든다(닫힌 쪽: 권한도 목록도 없다)
    expect(await mine(stub, D4, promoted)).toHaveLength(1);
    expect(await mine(stub, chan(9), promoted)).toEqual([]);
    expect((await editorsSide(stub, B2, T0 + 1200, promoted)).editors.map((e) => e.channelId)).not.toContain(chan(9));
  });

  it("GN6 편집자 쪽: 허가 행 없는 관리자 주인의 관계가 되살아나도 맡은 채널 = 편집자를 active로 보는 주인 수 ≤ 20", async () => {
    const stub = freshStub();
    await allowAt(stub, C3, T0);
    const promoted = [A1, D4];
    const owners = Array.from({ length: 20 }, (_, i) => chan(200 + i));
    const acceptFrom = async (owner: string, t: number, admins: readonly string[]) => {
      if (owner !== D4) await allowAt(stub, owner, t);
      const r = await stub.createInvite(owner, "주인", admins, t + 1);
      if (!r.ok) throw new Error(r.code);
      return stub.acceptInvite(await sha(r.token), C3, "편집자", admins, t + 2);
    };
    expect((await acceptFrom(D4, T0 + 1, promoted)).ok).toBe(true);
    for (let i = 0; i < 19; i++) expect((await acceptFrom(owners[i]!, T0 + 10 + i * 10, promoted)).ok).toBe(true);
    // 강등: D4 관계가 비어 19, 스무 번째 자리를 owners[19]가 채운다
    expect(await mine(stub, C3, ADMINS)).toHaveLength(19);
    expect((await acceptFrom(owners[19]!, T0 + 1000, ADMINS)).ok).toBe(true);
    await sweepNow(stub, T0 + 1100);
    for (const admins of [ADMINS, promoted]) {
      let shown = 0;
      for (const o of [D4, ...owners]) if ((await editorsSide(stub, o, T0 + 1200, admins)).editors.some((e) => e.channelId === C3 && e.status === "active")) shown++;
      const got = await mine(stub, C3, admins);
      expect(shown).toBe(got.length);
      expect(got.length).toBeLessThanOrEqual(20);
    }
    const got = (await mine(stub, C3, promoted)).map((d) => d.channelId);
    expect(got).toContain(D4);
    expect(got).not.toContain(owners[19]);
  });

  it("GN3 허가 행 없는 관리자 편집자: 허가 행이 생기면 옛 관계는 끝난다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    const inv = await invite(stub, B2, T0 + 1);
    expect((await accept(stub, inv.hash, A1, T0 + 2)).ok).toBe(true);
    expect(await mine(stub, A1)).toHaveLength(1);
    await allowAt(stub, A1, T0 + 3);
    expect(await mine(stub, A1)).toEqual([]);
    await sweepNow(stub, T0 + 4);
    expect(await delegations(stub)).toHaveLength(0);
  });
});

describe("묶음·me", () => {
  it("BD1 위임이 없으면 빈 배열", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    expect(l.bundle.delegatedChannels).toEqual([]);
  });

  it("BD2 redeem·rotate 묶음", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await allowAt(stub, C3, T0);
    const inv = await invite(stub, B2, T0 + 1);
    await accept(stub, inv.hash, C3, T0 + 2);
    const l = await appLogin(stub, { channelId: C3, now: T0 + 5 });
    expect(l.bundle.delegatedChannels).toEqual([{ channelId: B2, channelName: "주인", since: T0 + 2 }]);
    const r = await stub.rotate(await sha(l.bundle.refreshToken), ADMINS, T0 + 6);
    if (!r.ok) throw new Error(r.code);
    expect(r.bundle.delegatedChannels).toEqual([{ channelId: B2, channelName: "주인", since: T0 + 2 }]);
  });

  it("BD3 회수가 반영된다", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 1);
    const l = await appLogin(stub, { channelId: C3, now: T0 + 10 });
    await stub.removeEditor(B2, C3, T0 + 11);
    const r = await stub.rotate(await sha(l.bundle.refreshToken), ADMINS, T0 + 12);
    if (!r.ok) throw new Error(r.code);
    expect(r.bundle.delegatedChannels).toEqual([]);
  });

  it("ME1 me는 check와 같은 거부를 준다", async () => {
    const stub = freshStub();
    expect(await stub.me("x", ADMINS, T0)).toEqual({ ok: false, code: "invalid_token", why: null });
    expect(await stub.me(await sha("zz"), ADMINS, T0)).toEqual({ ok: false, code: "invalid_token", why: null });
    const l = await allowedLogin(stub);
    await stub.logout(await sha(l.bundle.accessToken), null, T0 + 1);
    expect(await stub.me(await sha(l.bundle.accessToken), ADMINS, T0 + 2)).toEqual(await stub.check(await sha(l.bundle.accessToken), ADMINS, T0 + 2));
    const l2 = await appLogin(stub, { now: T0 + 3 });
    await v2Disallow(stub, B2, T0 + 4);
    expect(await stub.me(await sha(l2.bundle.accessToken), ADMINS, T0 + 5)).toEqual({ ok: false, code: "not_allowed", why: "disallowed" });
  });

  it("ME2 me의 쓰기 수는 check와 같다(0)", async () => {
    const stub = freshStub();
    const l = await allowedLogin(stub);
    const h = await sha(l.bundle.accessToken);
    const b0 = await meter(stub);
    await stub.check(h, ADMINS, T0 + 1);
    const b1 = await meter(stub);
    await stub.me(h, ADMINS, T0 + 2);
    const b2 = await meter(stub);
    expect(b2.written - b1.written).toBe(b1.written - b0.written);
    expect(b2.written - b1.written).toBe(0);
  });

  it("ME3 me 본문: 맡은 채널과 내 편집자", async () => {
    const stub = freshStub();
    await allowAt(stub, B2, T0);
    await link(stub, B2, C3, T0 + 1);
    const l = await appLogin(stub, { channelId: B2, now: T0 + 10 });
    const m = await meOf(stub, l.bundle.accessToken, T0 + 11);
    expect(m.editors).toEqual([{ channelId: C3, channelName: "편집자", since: T0 + 3, status: "active" }]);
    expect(m.delegatedChannels).toEqual([]);
    expect(m.pendingInviteUntil).toBeNull();
  });
});
