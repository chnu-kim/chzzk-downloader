// 허용목록 자동 허가 + 하루 새 채널 상한(docs/design/features/allowlist-open.md §3·§6.1, worker.md 구현 중 변경 109).
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_LIST_MAX, AUTO_ALLOW_CAP_MAX, kstDay } from "../../src/store/allowlist";
import { A1, ADMINS, B2, C3, D4, T0, begin, closeAutoAllow, freshStub, meter, query, sha, type Stub } from "./helpers";

const chan = (i: number): string => i.toString(16).padStart(32, "0");

// KST 자정 직후(= UTC 15:00)를 하루의 시작으로 쓴다. T0(2030-01-01 UTC 00:00)는 KST 09:00이다
const KST_MIDNIGHT = Date.UTC(2030, 0, 1, 15, 0, 0, 0);

/** 앱 흐름 하나를 끝까지 진행하고 finish 결과와 redeem 결과를 돌려준다(redeem은 finish가 loopback일 때) */
async function login(stub: Stub, channelId: string, now = T0, name = "새 채널") {
  const b = await begin(stub, { now });
  const f = await stub.finish(b.flowId, { type: "user", channelId, channelName: name }, ADMINS, now);
  if (f.type !== "loopback") throw new Error(`finish ${f.type}`);
  const r = await stub.redeem(await sha(f.grant), b.verifier, ADMINS, now);
  return { f, r, b };
}

const rows = (stub: Stub, table: string) => query<Record<string, SqlStorageValue>>(stub, `SELECT * FROM ${table}`);
const metaOf = async (stub: Stub, k: string) => (await query<{ v: string }>(stub, "SELECT v FROM meta WHERE k = ?", k))[0]?.v ?? null;

describe("자동 허가", () => {
  it("S1 새 채널은 기본 상한에서 허가된다: added_by='auto', 센 수 1, 거부 기록 없음, 감사 0", async () => {
    const stub = freshStub();
    const { f, r } = await login(stub, B2, T0, "합성새채널");
    expect(f).toMatchObject({ type: "loopback", result: "ok" });
    expect(r.status).toBe("ok");
    expect(await query(stub, "SELECT channel_id, channel_name, owner_channel_id, note, added_by, added_at FROM allowlist")).toEqual([
      { channel_id: B2, channel_name: "합성새채널", owner_channel_id: null, note: null, added_by: "auto", added_at: T0 },
    ]);
    expect(await metaOf(stub, "auto_allow_count")).toBe("1");
    expect(await metaOf(stub, "auto_allow_day")).toBe(String(kstDay(T0)));
    expect(await rows(stub, "denied")).toEqual([]);
    expect(await rows(stub, "audit")).toEqual([]);
  });

  it("S2 20명 허가 뒤 21번째는 daily_limit 거부: 거부 기록 1행, 허가 행 20, 흐름에 이유", async () => {
    const stub = freshStub();
    for (let i = 1; i <= 20; i++) expect((await login(stub, chan(0xa00 + i))).r.status).toBe("ok");
    const { f, r, b } = await login(stub, chan(0xbad));
    expect(f).toMatchObject({ type: "loopback", result: "denied" });
    expect(r).toEqual({ status: "denied", channelName: "새 채널", reason: "daily_limit" });
    expect(await query(stub, "SELECT count(*) AS n FROM allowlist")).toEqual([{ n: 20 }]);
    expect(await query(stub, "SELECT channel_id, attempts FROM denied")).toEqual([{ channel_id: chan(0xbad), attempts: 1 }]);
    expect(await metaOf(stub, "auto_allow_count")).toBe("20");
    expect(await query(stub, "SELECT deny_reason FROM flow WHERE id = ?", b.flowId)).toEqual([{ deny_reason: "daily_limit" }]);
  });

  it("S3 21명이 동시에 와도 정확히 20명만 허가된다(DO 안에서 원자적으로 센다)", async () => {
    const stub = freshStub();
    const begun = [];
    for (let i = 1; i <= 21; i++) begun.push(await begin(stub, { now: T0, ip: `203.0.113.${i}` }));
    const results = await Promise.all(begun.map((b, i) => stub.finish(b.flowId, { type: "user", channelId: chan(0xc00 + i), channelName: `채널${i}` }, ADMINS, T0)));
    const ok = results.filter((r) => r.type === "loopback" && r.result === "ok");
    const denied = results.filter((r) => r.type === "loopback" && r.result === "denied");
    expect(ok).toHaveLength(20);
    expect(denied).toHaveLength(1);
    expect(await query(stub, "SELECT count(*) AS n FROM allowlist WHERE added_by = 'auto'")).toEqual([{ n: 20 }]);
    expect(await metaOf(stub, "auto_allow_count")).toBe("20");
    expect(await query(stub, "SELECT count(*) AS n FROM flow WHERE deny_reason = 'daily_limit'")).toEqual([{ n: 1 }]);
  });

  it("S4 같은 채널의 흐름 둘이 겹쳐도 둘 다 ok이고 센 수는 1이다", async () => {
    const stub = freshStub();
    const b1 = await begin(stub, { now: T0, ip: "203.0.113.1" });
    const b2 = await begin(stub, { now: T0, ip: "203.0.113.2" });
    const [f1, f2] = await Promise.all([
      stub.finish(b1.flowId, { type: "user", channelId: B2, channelName: "같은 채널" }, ADMINS, T0),
      stub.finish(b2.flowId, { type: "user", channelId: B2, channelName: "같은 채널" }, ADMINS, T0),
    ]);
    expect(f1).toMatchObject({ result: "ok" });
    expect(f2).toMatchObject({ result: "ok" });
    expect(await metaOf(stub, "auto_allow_count")).toBe("1");
    expect(await query(stub, "SELECT count(*) AS n FROM allowlist")).toEqual([{ n: 1 }]);
  });

  it("S5 한국 시간 자정이 하루의 경계다: 23:59:59.999에 채우고 +1ms(00:00)에 다시 받는다", async () => {
    const stub = freshStub();
    await stub.setAutoAllowCap(2, A1, T0);
    const lastMs = KST_MIDNIGHT - 1; // KST 23:59:59.999
    expect((await login(stub, chan(0xd01), lastMs)).r.status).toBe("ok");
    expect((await login(stub, chan(0xd02), lastMs)).r.status).toBe("ok");
    expect((await login(stub, chan(0xd03), lastMs)).r).toMatchObject({ status: "denied", reason: "daily_limit" });
    expect((await login(stub, chan(0xd03), KST_MIDNIGHT)).r.status).toBe("ok");
    expect(await metaOf(stub, "auto_allow_count")).toBe("1");
    expect(await metaOf(stub, "auto_allow_day")).toBe(String(kstDay(KST_MIDNIGHT)));
    expect(kstDay(KST_MIDNIGHT)).toBe(kstDay(lastMs) + 1);
  });

  it("S6 UTC 자정(KST 09:00)을 지나도 센 수는 초기화되지 않는다", async () => {
    const stub = freshStub();
    await stub.setAutoAllowCap(1, A1, T0);
    const beforeUtcMidnight = Date.UTC(2030, 0, 1, 23, 59, 59, 999); // KST 08:59:59.999 (1월 2일)
    expect((await login(stub, chan(0xe01), Date.UTC(2030, 0, 1, 15, 0, 1))).r.status).toBe("ok");
    expect((await login(stub, chan(0xe02), beforeUtcMidnight)).r).toMatchObject({ status: "denied", reason: "daily_limit" });
    expect((await login(stub, chan(0xe02), beforeUtcMidnight + 1)).r).toMatchObject({ status: "denied", reason: "daily_limit" });
  });

  it("S7 시계 역행: 저장된 날 키보다 작은 now는 같은 날로 센다(0부터 다시 세지 않는다)", async () => {
    const stub = freshStub();
    await stub.setAutoAllowCap(1, A1, T0);
    expect((await login(stub, chan(0xf01), KST_MIDNIGHT + 5)).r.status).toBe("ok");
    // 다른 isolate가 낸 더 이른 now(전날): 새 날로 보면 상한을 두 번 쓴다
    expect((await login(stub, chan(0xf02), KST_MIDNIGHT - 5)).r).toMatchObject({ status: "denied", reason: "daily_limit" });
    expect(await metaOf(stub, "auto_allow_count")).toBe("1");
    expect(await metaOf(stub, "auto_allow_day")).toBe(String(kstDay(KST_MIDNIGHT)));
  });

  it("S8 차단된 채널은 자동 허가되지 않는다: reason blocked, 센 수 그대로, 거부 기록", async () => {
    const stub = freshStub();
    expect(await stub.disallow(C3, A1, ADMINS, T0)).toEqual({ ok: true });
    const { r } = await login(stub, C3);
    expect(r).toEqual({ status: "denied", channelName: "새 채널", reason: "blocked" });
    expect(await metaOf(stub, "auto_allow_count")).toBeNull();
    expect(await rows(stub, "allowlist")).toEqual([]);
    expect(await query(stub, "SELECT channel_id FROM denied")).toEqual([{ channel_id: C3 }]);
  });

  it("S9 관리자·이미 허가된 채널은 세지 않고 새로 쓰지도 않는다", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0, ADMINS);
    expect((await login(stub, B2)).r.status).toBe("ok");
    expect((await login(stub, A1)).r.status).toBe("ok");
    expect(await metaOf(stub, "auto_allow_count")).toBeNull();
    expect(await query(stub, "SELECT channel_id, added_by FROM allowlist")).toEqual([{ channel_id: B2, added_by: A1 }]);
  });

  it("S10 부트스트랩(admins 비어 있음)은 거부이고 이유가 없으며 허가 행도 없다", async () => {
    const stub = freshStub();
    const b = await begin(stub, { now: T0 });
    const f = await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "새 채널" }, [], T0);
    expect(f).toMatchObject({ type: "loopback", result: "denied" });
    const r = await stub.redeem(await sha((f as { grant: string }).grant), b.verifier, [], T0);
    expect(r).toEqual({ status: "denied", channelName: "새 채널" });
    expect(await rows(stub, "allowlist")).toEqual([]);
    expect(await query(stub, "SELECT deny_reason FROM flow")).toEqual([{ deny_reason: null }]);
  });

  it("S10b admins가 문자열 배열이 아니면 자동 허가를 하지 않는다(fail closed)", async () => {
    const stub = freshStub();
    const b = await begin(stub, { now: T0 });
    const f = await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "새 채널" }, [A1, 7] as unknown as string[], T0);
    expect(f).toMatchObject({ result: "denied" });
    expect(await rows(stub, "allowlist")).toEqual([]);
  });

  it("S11 상한 0은 이유 없는 거부, meta 형식이 틀리면 0으로 보고 경고 로그를 남긴다", async () => {
    const stub = freshStub();
    await closeAutoAllow(stub);
    expect((await login(stub, B2)).r).toEqual({ status: "denied", channelName: "새 채널" });
    expect(await rows(stub, "allowlist")).toEqual([]);
    for (const bad of ["abc", "-1", "101", "007", "1.5", ""]) {
      const s = freshStub();
      await runInDurableObject(s, (i) => void i.db.run("INSERT INTO meta (k, v) VALUES ('auto_allow_cap', ?)", bad));
      const warn = vi.spyOn(console, "log").mockImplementation(() => {});
      const { r } = await login(s, B2);
      expect(r, `meta ${JSON.stringify(bad)}`).toEqual({ status: "denied", channelName: "새 채널" });
      expect(warn.mock.calls.some((c) => String(c[0]).includes("store.auto_allow_cap_invalid"))).toBe(true);
      warn.mockRestore();
    }
  });

  it("S12 상한을 오늘 수보다 낮추면 오늘은 더 받지 않고 높이면 그 자리에서 더 받는다", async () => {
    const stub = freshStub();
    await stub.setAutoAllowCap(3, A1, T0);
    for (let i = 1; i <= 3; i++) expect((await login(stub, chan(0x1000 + i))).r.status).toBe("ok");
    expect((await login(stub, chan(0x1004))).r).toMatchObject({ reason: "daily_limit" });
    await stub.setAutoAllowCap(1, A1, T0);
    expect((await login(stub, chan(0x1004))).r).toMatchObject({ reason: "daily_limit" });
    await stub.setAutoAllowCap(4, A1, T0);
    expect((await login(stub, chan(0x1004))).r.status).toBe("ok");
    expect(await metaOf(stub, "auto_allow_count")).toBe("4");
  });

  it("S12b 센 수 meta가 깨졌으면 cap으로 보고(그날은 더 받지 않는다) 다음 날에는 다시 받는다", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, (i) => {
      i.db.run("INSERT INTO meta (k, v) VALUES ('auto_allow_day', ?), ('auto_allow_count', 'zzz')", String(kstDay(KST_MIDNIGHT)));
    });
    expect((await login(stub, B2, KST_MIDNIGHT + 1)).r).toMatchObject({ reason: "daily_limit" });
    expect((await login(stub, B2, KST_MIDNIGHT + 86_400_000)).r.status).toBe("ok");
  });

  it("S13 어제 상한에 걸려 초대를 청구한 편집자가 오늘 자동 허가되면 위임이 생긴다(허가 → 청구 완성 → 거부 기록 삭제 순서)", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0, ADMINS);
    const inv = await stub.createInvite(B2, "주인", ADMINS, T0);
    if (!inv.ok) throw new Error("createInvite");
    const hash = await sha(inv.token);
    // 어제: 상한 0이라 거부 → 웹 흐름에서 초대를 청구한다
    await closeAutoAllow(stub);
    const s = await stub.startWebInvite(hash, "203.0.113.9", 1000, ADMINS, T0);
    if (!s.ok) throw new Error("startWebInvite");
    const k = await stub.consume(await sha(s.state), await sha(s.binder), T0);
    if (!k.ok) throw new Error("consume");
    expect(await stub.finish(k.flowId, { type: "user", channelId: C3, channelName: "편집자" }, ADMINS, T0)).toMatchObject({ type: "denied", invitePending: "주인" });
    // 오늘: 상한을 열고 앱 흐름으로 다시 로그인 → 자동 허가, 위임이 생긴다
    await stub.setAutoAllowCap(20, A1, T0 + 1000);
    const { r } = await login(stub, C3, T0 + 1000, "편집자");
    expect(r.status).toBe("ok");
    expect(await query(stub, "SELECT owner_channel_id, editor_channel_id, revoked_at FROM delegation")).toEqual([{ owner_channel_id: B2, editor_channel_id: C3, revoked_at: null }]);
    expect(await rows(stub, "denied")).toEqual([]);
  });

  it("S14 초대 웹 흐름 + 자동 허가는 같은 finish 안에서 invite accepted", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0, ADMINS);
    const inv = await stub.createInvite(B2, "주인", ADMINS, T0);
    if (!inv.ok) throw new Error("createInvite");
    const s = await stub.startWebInvite(await sha(inv.token), "203.0.113.9", 1000, ADMINS, T0);
    if (!s.ok) throw new Error("startWebInvite");
    const k = await stub.consume(await sha(s.state), await sha(s.binder), T0);
    if (!k.ok) throw new Error("consume");
    const f = await stub.finish(k.flowId, { type: "user", channelId: D4, channelName: "편집자" }, ADMINS, T0);
    expect(f).toMatchObject({ type: "web", invite: "accepted", inviteOwner: B2 });
    expect(await query(stub, "SELECT added_by FROM allowlist WHERE channel_id = ?", D4)).toEqual([{ added_by: "auto" }]);
  });

  it("S22 상한에 걸린 시도도 청구하고(이유와 무관), 차단된 시도도 같다", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0, ADMINS);
    await stub.setAutoAllowCap(0, A1, T0);
    await stub.setAutoAllowCap(1, A1, T0);
    expect((await login(stub, chan(0x2001))).r.status).toBe("ok"); // 상한 1 소진
    await stub.disallow(D4, A1, ADMINS, T0);
    for (const [who, reason] of [[C3, "daily_limit"], [D4, "blocked"]] as const) {
      const inv = await stub.createInvite(B2, "주인", ADMINS, T0 + 1);
      if (!inv.ok) throw new Error("createInvite");
      const s = await stub.startWebInvite(await sha(inv.token), "203.0.113.9", 1000, ADMINS, T0 + 1);
      if (!s.ok) throw new Error("startWebInvite");
      const k = await stub.consume(await sha(s.state), await sha(s.binder), T0 + 1);
      if (!k.ok) throw new Error("consume");
      expect(await stub.finish(k.flowId, { type: "user", channelId: who, channelName: "편집자" }, ADMINS, T0 + 1), reason).toMatchObject({ type: "denied", invitePending: "주인" });
      expect(await query(stub, "SELECT deny_reason FROM flow WHERE channel_id = ?", who)).toEqual([{ deny_reason: reason }]);
    }
  });
});

describe("차단", () => {
  it("S15 disallow: 허가 행 있음 → 행 삭제 + 세션 폐기 + 차단 행 + 감사, 로그인은 blocked", async () => {
    const stub = freshStub();
    await login(stub, B2);
    expect(await stub.disallow(B2, A1, ADMINS, T0 + 1)).toEqual({ ok: true });
    expect(await rows(stub, "allowlist")).toEqual([]);
    expect(await query(stub, "SELECT channel_id, channel_name, blocked_by, blocked_at FROM blocked")).toEqual([{ channel_id: B2, channel_name: "새 채널", blocked_by: A1, blocked_at: T0 + 1 }]);
    expect(await query(stub, "SELECT status, revoked_why FROM session")).toEqual([{ status: "revoked", revoked_why: "disallowed" }]);
    expect(await query(stub, "SELECT actor, action, target FROM audit")).toEqual([{ actor: A1, action: "disallow", target: B2 }]);
    expect((await login(stub, B2, T0 + 2)).r).toMatchObject({ status: "denied", reason: "blocked" });
  });

  it("S15b 허가도 차단도 없는 채널을 차단하면 차단 행만 쓴다(거부 기록의 이름), 이미 차단됐으면 not_found이고 쓰기 0", async () => {
    const stub = freshStub();
    await closeAutoAllow(stub);
    await login(stub, C3, T0, "거부된 채널");
    expect(await stub.disallow(C3, A1, ADMINS, T0 + 1)).toEqual({ ok: true });
    expect(await query(stub, "SELECT channel_id, channel_name FROM blocked")).toEqual([{ channel_id: C3, channel_name: "거부된 채널" }]);
    expect(await query(stub, "SELECT count(*) AS n FROM audit WHERE action = 'disallow'")).toEqual([{ n: 1 }]);
    const before = await meter(stub);
    expect(await stub.disallow(C3, A1, ADMINS, T0 + 2)).toEqual({ ok: false, code: "not_found" });
    expect((await meter(stub)).written).toBe(before.written);
    // 거부 기록은 남는다(관리 화면의 "차단함" 꼬리표)
    expect(await query(stub, "SELECT channel_id FROM denied")).toEqual([{ channel_id: C3 }]);
  });

  it("S15c 관리자·형식 밖은 차단할 수 없고 아무것도 쓰지 않는다", async () => {
    const stub = freshStub();
    const before = await meter(stub);
    expect(await stub.disallow(A1, A1, ADMINS, T0)).toEqual({ ok: false, code: "is_admin" });
    expect(await stub.disallow("xyz", A1, ADMINS, T0)).toEqual({ ok: false, code: "bad_channel_id" });
    expect(await meter(stub)).toEqual(before);
  });

  it("S16 allow·allowDenied는 차단을 함께 풀고 하루 센 수는 올리지 않는다", async () => {
    const stub = freshStub();
    await stub.disallow(B2, A1, ADMINS, T0);
    await stub.disallow(C3, A1, ADMINS, T0);
    expect((await login(stub, B2, T0 + 1)).r).toMatchObject({ reason: "blocked" });
    expect(await stub.allow(B2, "", A1, T0 + 2, ADMINS)).toEqual({ ok: true });
    expect(await query(stub, "SELECT channel_id FROM blocked")).toEqual([{ channel_id: C3 }]);
    expect((await login(stub, B2, T0 + 3)).r.status).toBe("ok");
    expect((await login(stub, C3, T0 + 3)).r).toMatchObject({ reason: "blocked" });
    expect(await stub.allowDenied(C3, A1, T0 + 4, ADMINS)).toBe(true);
    expect(await rows(stub, "blocked")).toEqual([]);
    expect(await metaOf(stub, "auto_allow_count")).toBeNull();
    expect((await login(stub, C3, T0 + 5)).r.status).toBe("ok");
  });

  it("S17 허가 행과 차단 행이 함께 있으면 허가가 이긴다(되돌리기 흔적)", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, (i) => {
      i.db.run("INSERT INTO blocked (channel_id, channel_name, blocked_by, blocked_at) VALUES (?, 'n', ?, 1)", B2, A1);
      i.db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, 'n', NULL, NULL, ?, 1)", B2, A1);
    });
    expect((await login(stub, B2)).r.status).toBe("ok");
    expect(await metaOf(stub, "auto_allow_count")).toBeNull();
  });

  it("disallowTarget: 허가·차단·거부 기록 상태를 한 채널만 읽는다(쓰기 0)", async () => {
    const stub = freshStub();
    await closeAutoAllow(stub);
    await login(stub, C3, T0, "거부된");
    await stub.allow(B2, "", A1, T0, ADMINS);
    const before = await meter(stub);
    expect(await stub.disallowTarget(B2, T0)).toEqual({ allowed: true, blocked: false, channelName: null, activeSessions: 0 });
    expect(await stub.disallowTarget(C3, T0)).toEqual({ allowed: false, blocked: false, channelName: "거부된", activeSessions: 0 });
    expect(await stub.disallowTarget(D4, T0)).toEqual({ allowed: false, blocked: false, channelName: null, activeSessions: 0 });
    expect((await meter(stub)).written).toBe(before.written);
    await stub.disallow(C3, A1, ADMINS, T0 + 1);
    expect(await stub.disallowTarget(C3, T0)).toEqual({ allowed: false, blocked: true, channelName: "거부된", activeSessions: 0 });
    expect(await stub.disallowTarget("xyz", T0)).toBeNull();
  });
});

describe("상한 설정과 관리 화면", () => {
  it("S18 setAutoAllowCap 검증: 소수·음수·101·문자열·관리자 ID 형식 아님은 bad_request이고 meta 그대로", async () => {
    const stub = freshStub();
    const before = await meter(stub);
    for (const bad of [1.5, -1, AUTO_ALLOW_CAP_MAX + 1, "5", Number.NaN, null]) {
      expect(await stub.setAutoAllowCap(bad as unknown as number, A1, T0), String(bad)).toEqual({ ok: false, code: "bad_request" });
    }
    expect(await stub.setAutoAllowCap(5, "xyz", T0)).toEqual({ ok: false, code: "bad_request" });
    expect(await meter(stub)).toEqual(before);
    expect(await stub.setAutoAllowCap(0, A1, T0)).toEqual({ ok: true });
    expect(await stub.setAutoAllowCap(AUTO_ALLOW_CAP_MAX, A1, T0 + 5)).toEqual({ ok: true });
    expect(await metaOf(stub, "auto_allow_cap")).toBe("100");
    expect(await metaOf(stub, "auto_allow_cap_by")).toBe(A1);
    expect(await metaOf(stub, "auto_allow_cap_at")).toBe(String(T0 + 5));
    // 감사 표에는 남기지 않는다
    expect(await rows(stub, "audit")).toEqual([]);
  });

  it("S19 adminView: autoAllow·blocked·전체 수, 허가 표는 최근 200행만(201번째는 보이지 않는다)", async () => {
    const stub = freshStub();
    expect((await stub.adminView(T0)).autoAllow).toEqual({ cap: 20, today: 0, capBy: null, capAt: null });
    await runInDurableObject(stub, (i) => {
      for (let n = 1; n <= ADMIN_LIST_MAX + 1; n++) {
        i.db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, ?, NULL, NULL, 'auto', ?)", chan(0x3000 + n), `채널${n}`, n);
        i.db.run("INSERT INTO blocked (channel_id, channel_name, blocked_by, blocked_at) VALUES (?, ?, ?, ?)", chan(0x4000 + n), `차단${n}`, A1, n);
      }
    });
    await stub.setAutoAllowCap(7, A1, T0);
    await login(stub, B2);
    const v = await stub.adminView(T0);
    expect(v.allowlist).toHaveLength(ADMIN_LIST_MAX);
    expect(v.allowlistTotal).toBe(ADMIN_LIST_MAX + 2);
    expect(v.allowlist.some((a) => a.channelName === "채널1")).toBe(false);
    expect(v.allowlist[0]?.channelId).toBe(B2);
    expect(v.allowlist[0]?.addedBy).toBe("auto");
    expect(v.blocked).toHaveLength(ADMIN_LIST_MAX);
    expect(v.blockedTotal).toBe(ADMIN_LIST_MAX + 1);
    expect(v.blocked[0]).toEqual({ channelId: chan(0x4000 + ADMIN_LIST_MAX + 1), channelName: `차단${ADMIN_LIST_MAX + 1}`, blockedBy: A1, blockedAt: ADMIN_LIST_MAX + 1 });
    expect(v.autoAllow).toEqual({ cap: 7, today: 1, capBy: A1, capAt: T0 });
  });

  it("adminView: 거부 기록에 차단 꼬리표(blocked)가 붙는다", async () => {
    const stub = freshStub();
    await closeAutoAllow(stub);
    await login(stub, C3);
    await login(stub, D4);
    await stub.disallow(C3, A1, ADMINS, T0);
    const v = await stub.adminView(T0);
    expect(Object.fromEntries(v.denied.map((d) => [d.channelId, d.blocked]))).toEqual({ [C3]: true, [D4]: false });
  });

  it("오늘 센 수는 날이 바뀌면 0으로 보인다", async () => {
    const stub = freshStub();
    await login(stub, B2, KST_MIDNIGHT + 1);
    expect((await stub.adminView(KST_MIDNIGHT + 2)).autoAllow.today).toBe(1);
    expect((await stub.adminView(KST_MIDNIGHT + 86_400_000)).autoAllow.today).toBe(0);
  });

  it("S19b doneView의 denyReason", async () => {
    const stub = freshStub();
    await stub.setAutoAllowCap(0, A1, T0);
    const s = await stub.startWeb("203.0.113.9", 1000, T0);
    if (!s.ok) throw new Error("startWeb");
    const k = await stub.consume(await sha(s.state), await sha(s.binder), T0);
    if (!k.ok) throw new Error("consume");
    await stub.finish(k.flowId, { type: "user", channelId: B2, channelName: "새" }, ADMINS, T0);
    expect(await stub.doneView(await sha(s.binder), T0)).toMatchObject({ status: "denied", denyReason: null });
    await stub.setAutoAllowCap(20, A1, T0);
    await stub.disallow(C3, A1, ADMINS, T0);
    const s2 = await stub.startWeb("203.0.113.9", 1000, T0);
    if (!s2.ok) throw new Error("startWeb");
    const k2 = await stub.consume(await sha(s2.state), await sha(s2.binder), T0);
    if (!k2.ok) throw new Error("consume");
    await stub.finish(k2.flowId, { type: "user", channelId: C3, channelName: "막힌" }, ADMINS, T0);
    expect(await stub.doneView(await sha(s2.binder), T0)).toMatchObject({ status: "denied", denyReason: "blocked" });
  });
});

describe("kstDay", () => {
  it("한국 시간 자정(UTC 15:00)에 날이 바뀐다", () => {
    expect(kstDay(Date.UTC(2030, 0, 1, 14, 59, 59, 999))).toBe(kstDay(Date.UTC(2030, 0, 1, 0, 0, 0)));
    expect(kstDay(Date.UTC(2030, 0, 1, 15, 0, 0, 0))).toBe(kstDay(Date.UTC(2030, 0, 1, 0, 0, 0)) + 1);
    expect(kstDay(0)).toBe(0); // 1970-01-01 09:00 KST
    expect(kstDay(-1)).toBe(0);
    expect(kstDay(Date.UTC(1969, 11, 31, 15, 0, 0))).toBe(0);
    expect(kstDay(Date.UTC(1969, 11, 31, 14, 59, 59))).toBe(-1);
  });
});
