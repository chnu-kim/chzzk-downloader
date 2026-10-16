// 알람·청소(worker.md 구현 중 변경 17·22). 첫 테스트가 §5 [확인 필요]를 닫는다: setAlarm을 두 번 부르면 getAlarm은 둘째 값이다.
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newSecret } from "../../src/core/token";
import type { Db } from "../../src/store/db";
import { sweep } from "../../src/store/sweep";
import { DAY, PORT, T0, dumpAll, freshStub } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("setAlarm과 시계", () => {
  it("[확인 필요 해소] setAlarm 두 번 → getAlarm은 둘째 값(늦은 값 → 이른 값, 이른 값 → 늦은 값)", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (_inst, state) => {
      await state.storage.setAlarm(T0 + 2000);
      await state.storage.setAlarm(T0 + 1000);
      expect(await state.storage.getAlarm()).toBe(T0 + 1000);
      await state.storage.setAlarm(T0 + 2000);
      expect(await state.storage.getAlarm()).toBe(T0 + 2000);
      await state.storage.deleteAlarm();
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("R6: vi.setSystemTime이 DO 안의 Date.now에 적용된다(Clock 주입이 필요 없다)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const stub = freshStub();
    expect(await runInDurableObject(stub, () => Date.now())).toBe(T0);
    vi.setSystemTime(T0 + DAY);
    expect(await runInDurableObject(stub, () => Date.now())).toBe(T0 + DAY);
    vi.useRealTimers();
    expect(await runInDurableObject(stub, () => Date.now())).toBeLessThan(T0);
  });

  it("첫 쓰기가 알람 하나를 예약하고 이후 쓰기는 바꾸지 않는다", async () => {
    const stub = freshStub();
    const start = (now: number) => stub.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.1", limit: 6 }, now);
    expect((await start(T0)).ok).toBe(true);
    const alarm = () => runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(await alarm()).toBe(T0 + 15 * 60_000);
    expect((await start(T0 + 60_000)).ok).toBe(true);
    expect(await alarm()).toBe(T0 + 15 * 60_000);
  });
});

// ---- 청소 표 ----

type Seed = { db: Db };
const chan = (i: number) => i.toString(16).padStart(32, "0");
const NOW = T0 + 31 * DAY;

function seedFlow(db: Db, flowId: string, expiresAt: number) {
  db.run("INSERT INTO flow (id, kind, status, created_at, expires_at) VALUES (?, 'app', 'started', ?, ?)", flowId, T0, expiresAt);
}
function seedSession(db: Db, sid: string, status: "active" | "unclaimed" | "revoked", expiresAt: number, revokedAt: number | null = null) {
  db.run(
    "INSERT INTO session (id, kind, channel_id, status, created_at, last_seen_at, expires_at, revoked_at, revoked_why) VALUES (?, 'app', ?, ?, ?, ?, ?, ?, ?)",
    sid,
    chan(1),
    status,
    T0,
    T0,
    expiresAt,
    revokedAt,
    status === "revoked" ? "admin" : null,
  );
}
function seedRefresh(db: Db, hash: string, sid: string, status: "active" | "used", expiresAt: number) {
  db.run("INSERT INTO refresh (hash, session_id, status, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)", hash, sid, status, T0, expiresAt);
}

// 표의 씨앗(now = T0 + 31일일 때의 기대는 expectSwept가 본다)
function seedAll({ db }: Seed) {
  seedFlow(db, "f-old", T0 + 10 * 60_000);
  seedFlow(db, "f-live", T0 + 31 * DAY + 1);
  seedSession(db, "s-dead", "active", T0 + 30 * DAY);
  seedRefresh(db, "r-dead-1", "s-dead", "used", T0 + 30 * DAY);
  seedRefresh(db, "r-dead-2", "s-dead", "active", T0 + 30 * DAY);
  seedSession(db, "s-live", "active", T0 + 40 * DAY);
  seedRefresh(db, "r-live-used", "s-live", "used", T0 + 20 * DAY);
  seedRefresh(db, "r-live-active", "s-live", "active", T0 + 40 * DAY);
  seedSession(db, "s-rev-old", "revoked", T0 + 40 * DAY, T0);
  seedSession(db, "s-rev-new", "revoked", T0 + 40 * DAY, T0 + 2 * DAY);
  seedSession(db, "s-unclaimed", "unclaimed", T0 + 2 * 60_000);
  db.run("INSERT INTO denied (channel_id, channel_name, first_at, last_at, attempts) VALUES (?, 'x', ?, ?, 1)", chan(900), T0, T0);
  for (let i = 0; i < 201; i++) {
    db.run("INSERT INTO denied (channel_id, channel_name, first_at, last_at, attempts) VALUES (?, 'x', ?, ?, 1)", chan(i + 1), T0 + 2 * DAY + i, T0 + 2 * DAY + i);
  }
  for (let i = 1; i <= 501; i++) db.run("INSERT INTO audit (id, at, actor, action, target) VALUES (?, ?, 'x', 'allow', NULL)", i, T0);
  seedDelegation({ db });
}

// 위임·초대 씨앗(구현 중 변경 105 (마)): 청소는 admins를 모르므로 시각 어긋남과 만료·회수 보존만 본다
function seedDelegation({ db }: Seed) {
  const O = chan(2000);
  const E = chan(2010);
  db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, 'o', NULL, NULL, 'x', ?)", O, T0);
  db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, 'e', NULL, NULL, 'x', ?)", E, T0 + 1);
  // 허가 행 없는 (옛) 관리자: NULL 관계는 admins를 모르는 청소가 지우지 않는다
  const N = chan(2001);
  const inv = (hash: string, expiresAt: number, ownerAllowedAt: number | null, owner = O, claim: [string, number] | null = null) =>
    db.run(
      "INSERT INTO invite (token_hash, owner_channel_id, owner_login_channel_id, owner_name, owner_allowed_at, created_at, expires_at, claimed_channel_id, claimed_name, claimed_at) VALUES (?, ?, ?, 'o', ?, ?, ?, ?, 'c', ?)",
      hash,
      owner,
      owner,
      ownerAllowedAt,
      T0,
      expiresAt,
      claim?.[0] ?? null,
      claim?.[1] ?? null,
    );
  inv("i-exp", T0 + 31 * DAY, T0);
  inv("i-live", T0 + 31 * DAY + 1, T0);
  inv("i-null", T0 + 31 * DAY + 1, null, N);
  inv("i-null-row", T0 + 31 * DAY + 1, null); // NULL인데 주인에게 허가 행이 있다
  inv("i-skew", T0 + 31 * DAY + 1, T0 + 99);
  // 청구 흔적: chan(201)의 거부 기록 first_at = T0 + 2일 + 200, chan(150)은 T0 + 2일 + 149
  inv("i-claim-ok", T0 + 31 * DAY + 1, T0, O, [chan(201), T0 + 2 * DAY + 200]);
  inv("i-claim-dead", T0 + 31 * DAY + 1, T0, O, [chan(150), T0 + 2 * DAY + 100]);
  const del = (editor: string, ownerAt: number | null, editorAt: number | null, revokedAt: number | null, owner = O) =>
    db.run(
      "INSERT INTO delegation (owner_channel_id, owner_login_channel_id, editor_channel_id, owner_name, editor_name, owner_allowed_at, editor_allowed_at, created_at, revoked_at, revoked_by) VALUES (?, ?, ?, 'o', 'e', ?, ?, ?, ?, ?)",
      owner,
      owner,
      editor,
      ownerAt,
      editorAt,
      T0,
      revokedAt,
      revokedAt === null ? null : "owner",
    );
  del(chan(2010), T0, T0 + 1, null); // 맞는 활성
  del(chan(2011), null, null, null, N); // 허가 행 없는 관리자로 맺은 NULL: 읽는 쪽 판정에 맡긴다
  del(chan(2012), T0 + 99, T0 + 1, null); // 주인 시각 어긋남
  del(chan(2013), T0, T0 + 99, null); // 편집자 시각 어긋남
  del(chan(2014), null, null, NOW - 31 * DAY, N); // 회수 31일 전
  del(chan(2015), null, null, NOW - 29 * DAY, N); // 회수 29일 전
  del(chan(2016), null, null, null); // 주인 NULL인데 허가 행이 있다
  del(E, null, null, null, N); // 편집자 NULL인데 허가 행이 있다
}

function names(db: Db, sql: string): string[] {
  return db.all<{ n: string }>(sql).map((r) => r.n);
}

function expectSwept(db: Db) {
  expect(names(db, "SELECT id AS n FROM flow")).toEqual(["f-live"]);
  expect(names(db, "SELECT id AS n FROM session ORDER BY id")).toEqual(["s-live", "s-rev-new"]);
  expect(names(db, "SELECT hash AS n FROM refresh ORDER BY hash")).toEqual(["r-live-active"]);
  // 오래된 denied 하나는 30일 보존이 지나 지워지고, 나머지 201행은 상한 200으로 가장 오래된 하나가 빠진다
  expect(db.first<{ n: number }>("SELECT count(*) AS n FROM denied")?.n).toBe(200);
  expect(db.first<{ n: number }>("SELECT count(*) AS n FROM denied WHERE channel_id = ?", chan(900))?.n).toBe(0);
  expect(db.first<{ n: number }>("SELECT count(*) AS n FROM denied WHERE channel_id = ?", chan(1))?.n).toBe(0);
  expect(db.first<{ n: number }>("SELECT count(*) AS n FROM denied WHERE channel_id = ?", chan(201))?.n).toBe(1);
  expect(db.first<{ n: number; lo: number }>("SELECT count(*) AS n, min(id) AS lo FROM audit")).toEqual({ n: 500, lo: 2 });
  // 만료·시각 어긋남·허가 행 있는 NULL·흔적 끊긴 청구는 지우고 미만료·허가 행 없는 NULL·흔적 있는 청구는 둔다
  expect(names(db, "SELECT token_hash AS n FROM invite ORDER BY token_hash")).toEqual(["i-claim-ok", "i-live", "i-null"]);
  // 맞는 활성·허가 행 없는 NULL 행·회수 29일 전 행은 유지, 회수 31일 전·시각 어긋남·허가 행 있는 NULL 행은 삭제
  expect(names(db, "SELECT owner_channel_id || ':' || editor_channel_id AS n FROM delegation ORDER BY owner_channel_id, editor_channel_id")).toEqual([
    `${chan(2000)}:${chan(2010)}`,
    `${chan(2001)}:${chan(2011)}`,
    `${chan(2001)}:${chan(2015)}`,
  ]);
}


describe("sweep", () => {
  it("표대로 지운다", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, (inst) => {
      seedAll(inst);
      const r = sweep(inst.db, NOW);
      expect(r.deleted).toBeGreaterThan(0);
      expect(r.remaining).toBe(true);
      expectSwept(inst.db);
    });
  });

  it("멱등: 다시 불러도 지우는 것·쓰기·내용이 없다", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, (inst) => {
      seedAll(inst);
      sweep(inst.db, NOW);
      const before = dumpAll(inst.db);
      const written = inst.db.rowsWritten;
      const r = sweep(inst.db, NOW);
      expect(r.deleted).toBe(0);
      expect(inst.db.rowsWritten).toBe(written);
      expect(dumpAll(inst.db)).toBe(before);
    });
  });

  it("runDurableObjectAlarm: 알람이 청소하고 멱등이며 남은 행이 있으면 1시간 뒤로 다시 예약한다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const stub = freshStub();
    await runInDurableObject(stub, async (inst, state) => {
      seedAll(inst);
      await state.storage.setAlarm(NOW);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const snap = await runInDurableObject(stub, async (inst, state) => {
      expectSwept(inst.db);
      return { dump: dumpAll(inst.db), alarm: await state.storage.getAlarm() };
    });
    expect(snap.alarm).toBe(NOW + 3_600_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const again = await runInDurableObject(stub, (inst) => dumpAll(inst.db));
    expect(again).toBe(snap.dump);
  });

  it("남은 행이 없으면 다음 알람을 예약하지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const stub = freshStub();
    await runInDurableObject(stub, async (inst, state) => {
      seedFlow(inst.db, "f-old", T0 + 60_000);
      await state.storage.setAlarm(NOW);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (inst, state) => {
      expect(dumpAll(inst.db)).not.toContain("f-old");
      expect(inst.db.first<{ n: number }>("SELECT count(*) AS n FROM flow")?.n).toBe(0);
      expect(await state.storage.getAlarm()).toBeNull();
    });
    expect(await runDurableObjectAlarm(stub)).toBe(false);
  });

  // remaining은 초대와 회수된 위임 행도 센다(활성 위임은 세지 않는다: 세면 알람이 영원히 돈다)
  it("활성 위임만 남으면 다음 알람을 예약하지 않는다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const stub = freshStub();
    await runInDurableObject(stub, async (inst, state) => {
      const O = chan(2000);
      inst.db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, 'o', NULL, NULL, 'x', ?)", O, T0);
      inst.db.run(
        "INSERT INTO delegation (owner_channel_id, owner_login_channel_id, editor_channel_id, created_at) VALUES (?, ?, ?, ?)",
        O,
        O,
        chan(2001),
        T0,
      );
      inst.db.run("UPDATE delegation SET owner_allowed_at = ?", T0);
      inst.db.run("UPDATE delegation SET editor_allowed_at = NULL");
      await state.storage.setAlarm(NOW);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (inst, state) => {
      expect(inst.db.first<{ n: number }>("SELECT count(*) AS n FROM delegation")?.n).toBe(1);
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });

  it("미만료 초대·회수된 위임 행이 남으면 다음 알람을 예약한다", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const stub = freshStub();
    await runInDurableObject(stub, async (inst, state) => {
      inst.db.run(
        "INSERT INTO invite (token_hash, owner_channel_id, owner_login_channel_id, owner_allowed_at, created_at, expires_at) VALUES ('i', ?, ?, NULL, ?, ?)",
        chan(2000),
        chan(2000),
        T0,
        NOW + DAY,
      );
      await state.storage.setAlarm(NOW);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (_inst, state) => {
      expect(await state.storage.getAlarm()).toBe(NOW + 3_600_000);
    });
  });
});
