// 마이그레이션(worker.md 구현 중 변경 17·21): 빈 DB → 최신, 중간 버전 → 최신, 앞선 스키마는 던지지 않는다.
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { Db } from "../../src/store/db";
import { MIGRATIONS, SCHEMA_VERSION, migrate } from "../../src/store/schema";
import { SCHEMA_SQL, freshStub } from "./helpers";

const USER_TABLES = ["refresh", "session", "flow", "allowlist", "denied", "audit", "meta"];

function dropAll(db: Db) {
  // 외래 키가 강제된다: refresh가 session보다 먼저
  for (const t of USER_TABLES) db.run(`DROP TABLE IF EXISTS ${t}`);
}

describe("migrate", () => {
  it("새 DO: 표·인덱스·schema_version이 최신이다", async () => {
    await runInDurableObject(freshStub(), (inst) => {
      expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
      expect(SCHEMA_VERSION).toBe(1);
      const tables = inst.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name");
      expect(tables.map((t) => t.name)).toEqual(["allowlist", "audit", "denied", "flow", "meta", "refresh", "session"]);
      const idx = inst.db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name");
      expect(idx.map((t) => t.name)).toEqual(["denied_last", "flow_expires", "refresh_expires", "refresh_session", "session_channel", "session_expires"]);
      expect(inst.db.first("SELECT v FROM meta WHERE k = 'schema_version'")).toEqual({ v: "1" });
    });
  });

  it("빈 DB → 최신: 스키마가 처음과 같다", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const first = inst.db.all(SCHEMA_SQL);
      dropAll(inst.db);
      expect(inst.db.all(SCHEMA_SQL)).toEqual([]);
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 0, to: 1, ahead: false });
      expect(inst.db.all(SCHEMA_SQL)).toEqual(first);
    });
  });

  it("각 중간 버전 k에서 최신으로", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const first = inst.db.all(SCHEMA_SQL);
      for (let k = 0; k <= MIGRATIONS.length; k++) {
        dropAll(inst.db);
        for (let v = 0; v < k; v++) inst.db.run(MIGRATIONS[v]!);
        if (k > 0) inst.db.run("INSERT INTO meta (k, v) VALUES ('schema_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(k));
        expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: k, to: MIGRATIONS.length, ahead: false });
        expect(inst.db.all(SCHEMA_SQL)).toEqual(first);
      }
    });
  });

  it("다시 불러도 아무것도 쓰지 않는다", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      const before = inst.db.rowsWritten;
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 1, to: 1, ahead: false });
      expect(inst.db.rowsWritten).toBe(before);
    });
  });

  it("앞선 스키마(DB 버전 > 코드): 던지지 않고 그대로 둔다", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      inst.db.run("UPDATE meta SET v = '2' WHERE k = 'schema_version'");
      const before = inst.db.all(SCHEMA_SQL);
      expect(migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toEqual({ from: 2, to: 2, ahead: true });
      expect(inst.db.all(SCHEMA_SQL)).toEqual(before);
    });
  });

  it("schema_version이 숫자가 아니면 던진다", async () => {
    await runInDurableObject(freshStub(), (inst, state) => {
      inst.db.run("UPDATE meta SET v = 'x' WHERE k = 'schema_version'");
      expect(() => migrate(inst.db, (fn) => state.storage.transactionSync(fn))).toThrow("schema_version");
    });
  });
});
