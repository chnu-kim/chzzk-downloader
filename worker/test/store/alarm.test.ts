// 알람·청소(worker.md 구현 중 변경 17·22). 첫 테스트가 §5 [확인 필요]를 닫는다: setAlarm을 두 번 부르면 getAlarm은 둘째 값이다.
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newSecret } from "../../src/core/token";
import type { Db } from "../../src/store/db";
import { sweep } from "../../src/store/sweep";
import { DAY, T0, dumpAll, freshStub } from "./helpers";

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
    const start = (now: number) => stub.startApp(newSecret(), "c", "203.0.113.1", 6, now);
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
}

const NOW = T0 + 31 * DAY;

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
});
